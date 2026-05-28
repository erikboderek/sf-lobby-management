/**
 * Test class for LobbyManagementController.
 *
 * Covers: getServiceTerritories, getAppointmentsByTerritory,
 * getWaitlistParticipants, checkInAppointment, and error/guard-clause paths.
 */
@IsTest
private class LobbyManagementControllerTest {

    // ─── Test Data Setup ──────────────────────────────────────────────────────

    @TestSetup
    static void makeData() {
        // Operating hours required for ServiceTerritory
        OperatingHours hours = new OperatingHours(Name = 'Test Hours', TimeZone = 'America/Los_Angeles');
        insert hours;

        ServiceTerritory activeTerr = new ServiceTerritory(
            Name = 'Main Office',
            IsActive = true,
            OperatingHoursId = hours.Id
        );
        ServiceTerritory inactiveTerr = new ServiceTerritory(
            Name = 'Inactive Office',
            IsActive = false,
            OperatingHoursId = hours.Id
        );
        insert new List<ServiceTerritory>{ activeTerr, inactiveTerr };

        WorkType wt = new WorkType(Name = 'Driver License', DurationType = 'Minutes');
        insert wt;

        ServiceAppointment sa = new ServiceAppointment(
            Subject = 'Test Appointment',
            Status = 'Scheduled',
            SchedStartTime = Datetime.now().addHours(1),
            SchedEndTime = Datetime.now().addHours(2),
            ServiceTerritoryId = activeTerr.Id,
            WorkTypeId = wt.Id
        );
        insert sa;
    }

    // ─── getServiceTerritories ────────────────────────────────────────────────

    @IsTest
    static void getServiceTerritories_returnsOnlyActive() {
        Test.startTest();
        List<ServiceTerritory> results = LobbyManagementController.getServiceTerritories();
        Test.stopTest();

        Assert.isFalse(results.isEmpty(), 'Should return at least one active territory');
        for (ServiceTerritory t : results) {
            Assert.isTrue(t.IsActive, 'Only active territories should be returned');
        }
    }

    @IsTest
    static void getServiceTerritories_orderedByName() {
        Test.startTest();
        List<ServiceTerritory> results = LobbyManagementController.getServiceTerritories();
        Test.stopTest();

        for (Integer i = 1; i < results.size(); i++) {
            Assert.isTrue(
                results[i - 1].Name <= results[i].Name,
                'Territories must be ordered by Name ASC'
            );
        }
    }

    // ─── getAppointmentsByTerritory ───────────────────────────────────────────

    @IsTest
    static void getAppointmentsByTerritory_returnsAppointmentsForTerritory() {
        ServiceTerritory terr = [SELECT Id FROM ServiceTerritory WHERE Name = 'Main Office' LIMIT 1];

        Test.startTest();
        List<ServiceAppointment> results = LobbyManagementController.getAppointmentsByTerritory(
            terr.Id,
            null
        );
        Test.stopTest();

        Assert.isFalse(results.isEmpty(), 'Should return appointments for the territory');
        for (ServiceAppointment sa : results) {
            Assert.areEqual(terr.Id, sa.ServiceTerritoryId, 'All appointments must belong to requested territory');
        }
    }

    @IsTest
    static void getAppointmentsByTerritory_withExtraFields_includesExtraFields() {
        ServiceTerritory terr = [SELECT Id FROM ServiceTerritory WHERE Name = 'Main Office' LIMIT 1];

        Test.startTest();
        List<ServiceAppointment> results = LobbyManagementController.getAppointmentsByTerritory(
            terr.Id,
            new List<String>{ 'Subject' }
        );
        Test.stopTest();

        Assert.isFalse(results.isEmpty(), 'Should return results with extra field');
        Assert.isNotNull(results[0].Subject, 'Subject field should be populated');
    }

    @IsTest
    static void getAppointmentsByTerritory_blankTerritoryId_returnsEmpty() {
        Test.startTest();
        List<ServiceAppointment> results = LobbyManagementController.getAppointmentsByTerritory(
            '',
            null
        );
        Test.stopTest();

        Assert.isTrue(results.isEmpty(), 'Blank territoryId should return empty list');
    }

    @IsTest
    static void getAppointmentsByTerritory_nullTerritoryId_returnsEmpty() {
        Test.startTest();
        List<ServiceAppointment> results = LobbyManagementController.getAppointmentsByTerritory(
            null,
            null
        );
        Test.stopTest();

        Assert.isTrue(results.isEmpty(), 'Null territoryId should return empty list');
    }

    // ─── getWaitlistParticipants ──────────────────────────────────────────────

    @IsTest
    static void getWaitlistParticipants_blankTerritoryId_returnsEmpty() {
        Test.startTest();
        List<WaitlistParticipant> results = LobbyManagementController.getWaitlistParticipants(
            '',
            null
        );
        Test.stopTest();

        Assert.isTrue(results.isEmpty(), 'Blank territoryId should return empty list');
    }

    @IsTest
    static void getWaitlistParticipants_nullTerritoryId_returnsEmpty() {
        Test.startTest();
        List<WaitlistParticipant> results = LobbyManagementController.getWaitlistParticipants(
            null,
            null
        );
        Test.stopTest();

        Assert.isTrue(results.isEmpty(), 'Null territoryId should return empty list');
    }

    @IsTest
    static void getWaitlistParticipants_validTerritory_returnsResults() {
        ServiceTerritory terr = [SELECT Id FROM ServiceTerritory WHERE Name = 'Main Office' LIMIT 1];

        // Waitlist requires an active territory — create minimal waitlist + participant
        Waitlist wl = new Waitlist(
            Name = 'Test Waitlist',
            ServiceTerritoryId = terr.Id
        );
        insert wl;

        WaitlistParticipant wp = new WaitlistParticipant(
            WaitlistId = wl.Id,
            Status = 'Waiting'
        );
        insert wp;

        Test.startTest();
        List<WaitlistParticipant> results = LobbyManagementController.getWaitlistParticipants(
            terr.Id,
            null
        );
        Test.stopTest();

        Assert.isFalse(results.isEmpty(), 'Should return waitlist participants for the territory');
    }

    // ─── checkInAppointment ───────────────────────────────────────────────────

    @IsTest
    static void checkInAppointment_updatesStatusToCheckedIn() {
        ServiceAppointment sa = [SELECT Id FROM ServiceAppointment LIMIT 1];

        Test.startTest();
        ServiceAppointment updated = LobbyManagementController.checkInAppointment(sa.Id);
        Test.stopTest();

        Assert.areEqual('Checked In', updated.Status, 'Status must be updated to Checked In');
        Assert.isNotNull(updated.StatusCategory, 'StatusCategory must be populated on return');
    }

    @IsTest
    static void checkInAppointment_blankId_throwsAuraHandledException() {
        Test.startTest();
        try {
            LobbyManagementController.checkInAppointment('');
            Assert.fail('Expected AuraHandledException was not thrown');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e.getMessage(), 'Exception should carry a message');
        }
        Test.stopTest();
    }

    @IsTest
    static void checkInAppointment_nullId_throwsAuraHandledException() {
        Test.startTest();
        try {
            LobbyManagementController.checkInAppointment(null);
            Assert.fail('Expected AuraHandledException was not thrown');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e.getMessage(), 'Exception should carry a message');
        }
        Test.stopTest();
    }

    @IsTest
    static void checkInAppointment_invalidId_throwsAuraHandledException() {
        Test.startTest();
        try {
            LobbyManagementController.checkInAppointment('notAnId');
            Assert.fail('Expected AuraHandledException was not thrown');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e.getMessage(), 'Exception should carry a message');
        }
        Test.stopTest();
    }

    // ─── getReferencedObjectName ──────────────────────────────────────────────

    @IsTest
    static void getReferencedObjectName_knownField_returnsObjectName() {
        Test.startTest();
        // ContactId is a standard lookup on ServiceAppointment that references Contact
        String result = LobbyManagementController.getReferencedObjectName('ContactId');
        Test.stopTest();

        Assert.isNotNull(result, 'Should return a non-null object name for ContactId');
        Assert.areEqual('Contact', result, 'ContactId should reference Contact');
    }

    @IsTest
    static void getReferencedObjectName_unknownField_returnsNull() {
        Test.startTest();
        String result = LobbyManagementController.getReferencedObjectName('NonExistentField__c');
        Test.stopTest();

        Assert.isNull(result, 'Unknown field should return null');
    }

    @IsTest
    static void getReferencedObjectName_blankInput_returnsNull() {
        Test.startTest();
        String result = LobbyManagementController.getReferencedObjectName('');
        Test.stopTest();

        Assert.isNull(result, 'Blank input should return null');
    }
}
