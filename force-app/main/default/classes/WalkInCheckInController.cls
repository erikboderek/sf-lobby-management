public with sharing class WalkInCheckInController {

    // ─── Search ───────────────────────────────────────────────────────────────

    @AuraEnabled
    public static List<ContactResult> searchContacts(String searchTerm) {
        if (String.isBlank(searchTerm) || searchTerm.trim().length() < 2) {
            return new List<ContactResult>();
        }
        String q = '%' + String.escapeSingleQuotes(searchTerm.trim()) + '%';
        List<Contact> contacts = [
            SELECT Id, AccountId, Name, FirstName, LastName, Birthdate,
                   MailingStreet, MailingCity, MailingState
            FROM Contact
            WHERE (Name LIKE :q OR FirstName LIKE :q OR LastName LIKE :q)
            WITH USER_MODE
            ORDER BY LastName ASC, FirstName ASC
            LIMIT 10
        ];
        List<ContactResult> results = new List<ContactResult>();
        for (Contact c : contacts) {
            ContactResult r = new ContactResult();
            r.id        = c.Id;
            r.accountId = c.AccountId;
            r.name      = c.Name;
            r.birthdate = c.Birthdate != null ? String.valueOf(c.Birthdate) : '';
            r.address   = buildAddress(c.MailingStreet, c.MailingCity, c.MailingState);
            results.add(r);
        }
        return results;
    }

    // ─── Work Types for Territory ─────────────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static List<WorkTypeOption> getWorkTypesForTerritory(String territoryId) {
        if (String.isBlank(territoryId)) return new List<WorkTypeOption>();
        String safeId = String.escapeSingleQuotes(territoryId.trim());
        List<ServiceTerritoryWorkType> stWts = [
            SELECT WorkTypeId, WorkType.Name
            FROM ServiceTerritoryWorkType
            WHERE ServiceTerritoryId = :safeId
            WITH USER_MODE
            ORDER BY WorkType.Name ASC
        ];
        List<WorkTypeOption> options = new List<WorkTypeOption>();
        for (ServiceTerritoryWorkType stwt : stWts) {
            WorkTypeOption opt = new WorkTypeOption();
            opt.value = stwt.WorkTypeId;
            opt.label = stwt.WorkType.Name;
            options.add(opt);
        }
        return options;
    }

    // ─── Check-In ─────────────────────────────────────────────────────────────

    @AuraEnabled
    public static CheckInResult checkInWalkIn(
        String  contactId,
        String  firstName,
        String  lastName,
        String  birthdate,
        String  street,
        String  city,
        String  province,
        String  postalCode,
        String  workTypeId,
        String  notes,
        String  territoryId
    ) {
        Savepoint sp = Database.setSavepoint();
        try {
            // 1. Resolve Contact — use existing or create a new Person Account + its Contact
            Id resolvedContactId;
            Id resolvedAccountId;

            if (String.isNotBlank(contactId)) {
                resolvedContactId = (Id) contactId;
                Contact c = [
                    SELECT AccountId FROM Contact WHERE Id = :resolvedContactId WITH USER_MODE LIMIT 1
                ];
                resolvedAccountId = c.AccountId;
            } else {
                if (String.isBlank(firstName) || String.isBlank(lastName)) {
                    throw new AuraHandledException('First Name and Last Name are required.');
                }
                Account newAccount = new Account();
                newAccount.FirstName         = firstName;
                newAccount.LastName          = lastName;
                newAccount.PersonBirthdate   = String.isNotBlank(birthdate) ? Date.valueOf(birthdate) : null;
                newAccount.BillingStreet     = street;
                newAccount.BillingCity       = city;
                newAccount.BillingState      = province;
                newAccount.BillingPostalCode = postalCode;
                newAccount.BillingCountry    = 'US';
                newAccount.RecordTypeId      = getPersonAccountRecordTypeId();
                insert as user newAccount;
                resolvedAccountId = newAccount.Id;

                Account inserted = [
                    SELECT PersonContactId FROM Account WHERE Id = :resolvedAccountId WITH USER_MODE LIMIT 1
                ];
                if (inserted.PersonContactId == null) {
                    throw new AuraHandledException('Could not resolve a Contact for this customer. Please verify Person Accounts are enabled.');
                }
                resolvedContactId = inserted.PersonContactId;
            }

            // 2. Resolve work type duration
            WorkType wt = [
                SELECT Id, EstimatedDuration, DurationType
                FROM WorkType
                WHERE Id = :workTypeId
                WITH USER_MODE
                LIMIT 1
            ];
            Integer durationMins = 30;
            if (wt.EstimatedDuration != null) {
                durationMins = wt.DurationType == 'Hours'
                    ? (Integer)(wt.EstimatedDuration * 60)
                    : (Integer) wt.EstimatedDuration;
            }

            // 3. Create ServiceAppointment
            // WorkTypeId and ServiceTerritoryId are intentionally omitted.
            // FSL.TR001_Service_BeforeInsert dereferences OperatingHours and FSL work
            // type config via those FK traversals; if either config record is absent it
            // NPEs in System Code.  Territory is already captured on the Waitlist (and
            // therefore the WaitlistParticipant) so it does not need to be on the SA.
            ServiceAppointment sa = new ServiceAppointment();
            sa.ContactId        = resolvedContactId;
            sa.ParentRecordId   = resolvedAccountId;
            sa.Status           = 'None';
            sa.Subject          = 'Walk-In';
            sa.SchedStartTime   = Datetime.now();
            sa.SchedEndTime     = Datetime.now().addMinutes(durationMins);
            sa.Description      = notes;
            insert as user sa;

            // 4. Find the Waitlist for this territory
            List<Waitlist> waitlists = [
                SELECT Id
                FROM Waitlist
                WHERE ServiceTerritoryId = :territoryId
                WITH USER_MODE
                ORDER BY CreatedDate ASC
                LIMIT 1
            ];
            if (waitlists.isEmpty()) {
                Database.rollback(sp);
                return errorResult('No waitlist found for this service territory. Please contact a supervisor.');
            }

            // 5. Create WaitlistParticipant — ParticipantId must be an Account Id
            WaitlistParticipant wp = new WaitlistParticipant();
            wp.WaitlistId           = waitlists[0].Id;
            wp.ParticipantId        = resolvedAccountId;
            wp.ServiceAppointmentId = sa.Id;
            wp.WorkTypeId           = workTypeId;
            wp.Status               = 'Unassigned';
            insert as user wp;

            CheckInResult result = new CheckInResult();
            result.success               = true;
            result.serviceAppointmentId  = sa.Id;
            result.waitlistParticipantId = wp.Id;
            result.accountId             = resolvedAccountId;
            return result;

        } catch (AuraHandledException ahe) {
            Database.rollback(sp);
            throw ahe;
        } catch (Exception ex) {
            Database.rollback(sp);
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private static Id getPersonAccountRecordTypeId() {
        List<RecordType> rts = [
            SELECT Id
            FROM RecordType
            WHERE SObjectType = 'Account'
              AND IsPersonType = true
            WITH USER_MODE
            LIMIT 1
        ];
        if (rts.isEmpty()) {
            throw new AuraHandledException('No Person Account Record Type found. Please ensure Person Accounts are enabled.');
        }
        return rts[0].Id;
    }

    private static String buildAddress(String street, String city, String state) {
        List<String> parts = new List<String>();
        if (String.isNotBlank(street)) parts.add(street);
        if (String.isNotBlank(city))   parts.add(city);
        if (String.isNotBlank(state))  parts.add(state);
        return String.join(parts, ', ');
    }

    private static CheckInResult errorResult(String message) {
        CheckInResult r = new CheckInResult();
        r.success      = false;
        r.errorMessage = message;
        return r;
    }

    // ─── Inner DTOs ───────────────────────────────────────────────────────────

    public class ContactResult {
        @AuraEnabled public String id        { get; set; }
        @AuraEnabled public String accountId { get; set; }
        @AuraEnabled public String name      { get; set; }
        @AuraEnabled public String birthdate { get; set; }
        @AuraEnabled public String address   { get; set; }
    }

    public class WorkTypeOption {
        @AuraEnabled public String value { get; set; }
        @AuraEnabled public String label { get; set; }
    }

    public class CheckInResult {
        @AuraEnabled public Boolean success               { get; set; }
        @AuraEnabled public String  errorMessage          { get; set; }
        @AuraEnabled public String  serviceAppointmentId  { get; set; }
        @AuraEnabled public String  waitlistParticipantId { get; set; }
        @AuraEnabled public String  accountId             { get; set; }
    }
}
