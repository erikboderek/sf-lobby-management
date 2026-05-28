/**
 * AuraEnabled controller for the lobbyPageContent LWC.
 *
 * Provides read access to ServiceTerritory, ServiceAppointment, and WaitlistParticipant
 * records plus a check-in DML action for the Lobby Management Dashboard.
 *
 * All SOQL enforces USER_MODE for CRUD/FLS. Dynamic SOQL uses bind variables and
 * escapeSingleQuotes on caller-supplied field names to prevent injection.
 */
public with sharing class LobbyManagementController {

    // ─── Constants ────────────────────────────────────────────────────────────

    // FIX 1: API name is 'Checked_In'; the label 'Checked In' was silently accepted
    // by DML but left StatusCategory as 'None', causing FSL triggers to clear SchedStartTime
    private static final String STATUS_CHECKED_IN = 'Checked_In';

    /**
     * Required fields always included on ServiceAppointment queries.
     * The targetLookupField (e.g. Case__c) is appended dynamically by the LWC
     * before calling getAppointmentsByTerritory so it works across orgs.
     */
    private static final List<String> SA_BASE_FIELDS = new List<String>{
        'Id',
        'AppointmentNumber',
        'Status',
        'StatusCategory',
        'SchedStartTime',
        'SchedEndTime',
        'ActualStartTime',
        'ServiceTerritoryId',
        'WorkTypeId',
        'WorkType.Name',
        'ContactId',
        'Contact.Name',
        'AccountId',
        'Account.Name'
    };

    /** Required fields always included on WaitlistParticipant queries. */
    private static final List<String> WL_BASE_FIELDS = new List<String>{
        'Id',
        'ParticipantIdentifier',
        'Status',
        'CreatedDate',
        'WaitlistId',
        'Waitlist.ServiceTerritoryId',
        'Waitlist.Name',
        'WorkTypeId',
        'WorkType.Name',
        'WorkType.EstimatedDuration'
    };

    // TYPEOF clause appended to every WL query; ParticipantId is polymorphic (Contact, Account, Lead).
    private static final String WL_TYPEOF_CLAUSE =
        ', TYPEOF Participant WHEN Contact THEN Name WHEN Account THEN Name WHEN Lead THEN Name END';

    // ─── Read Methods ─────────────────────────────────────────────────────────

    /**
     * Returns all active ServiceTerritory records ordered alphabetically.
     *
     * @return Active ServiceTerritory records (Id, Name).
     */
    @AuraEnabled(cacheable=true)
    public static List<ServiceTerritory> getServiceTerritories() {
        return [
            SELECT Id, Name
            FROM ServiceTerritory
            WHERE IsActive = true
            WITH USER_MODE
            ORDER BY Name ASC
        ];
    }

    /**
     * Returns ServiceAppointment records for the given territory, including
     * any caller-specified extra fields on top of the required base set.
     *
     * @param territoryId The Id of the ServiceTerritory to filter by.
     * @param fields      Extra ServiceAppointment field API names to include (may be null/empty).
     * @return ServiceAppointment records ordered by SchedStartTime ASC.
     * @throws AuraHandledException on query error.
     */
    @AuraEnabled(cacheable=false)
    public static List<ServiceAppointment> getAppointmentsByTerritory(
        String territoryId,
        List<String> fields
    ) {
        if (String.isBlank(territoryId)) {
            return new List<ServiceAppointment>();
        }

        try {
            String fieldList = buildFieldList(SA_BASE_FIELDS, fields);
            String safeId = String.escapeSingleQuotes(territoryId);
            // ISSUE 3 FIX: use midnight-to-midnight in the territory's own timezone
            Datetime[] bounds = territoryDayBounds(territoryId);
            Datetime dayStart = bounds[0];
            Datetime dayEnd   = bounds[1];

            String soql =
                'SELECT ' + fieldList +
                ' FROM ServiceAppointment' +
                ' WHERE ServiceTerritoryId = :safeId' +
                ' AND ((SchedStartTime >= :dayStart AND SchedStartTime < :dayEnd)' +
                // FIX 2: use API names; 'In Progress' API value keeps its space (org-verified),
                // only 'Checked In' changes to 'Checked_In'
                '      OR (Status IN (\'Checked_In\', \'In Progress\')' +
                '          AND ActualStartTime >= :dayStart AND ActualStartTime < :dayEnd))' +
                ' WITH USER_MODE' +
                ' ORDER BY SchedStartTime ASC NULLS LAST';

            return Database.query(soql);
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Returns the API name of the SObject that a given lookup/master-detail
     * field on ServiceAppointment references (e.g. 'Case__c' → 'Case').
     * Used by the LWC to resolve navigation target without a hardcoded property.
     *
     * @param lookupFieldApiName The API name of the reference field (e.g. 'Case__c').
     * @return The referenced SObject API name, or null if not found.
     */
    @AuraEnabled(cacheable=false)
    public static String getReferencedObjectName(String lookupFieldApiName) {
        if (String.isBlank(lookupFieldApiName)) {
            return null;
        }
        try {
            Schema.SObjectField field =
                Schema.SObjectType.ServiceAppointment.fields.getMap()
                    .get(lookupFieldApiName.toLowerCase());
            if (field == null) {
                return null;
            }
            List<Schema.SObjectType> refs = field.getDescribe().getReferenceTo();
            return refs.isEmpty() ? null : refs[0].getDescribe().getName();
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Returns the API name of the SObject that a given lookup/master-detail
     * field on WaitlistParticipant references.
     *
     * @param lookupFieldApiName The API name of the reference field.
     * @return The referenced SObject API name, or null if not found.
     */
    @AuraEnabled(cacheable=false)
    public static String getWlReferencedObjectName(String lookupFieldApiName) {
        if (String.isBlank(lookupFieldApiName)) {
            return null;
        }
        try {
            Schema.SObjectField field =
                Schema.SObjectType.WaitlistParticipant.fields.getMap()
                    .get(lookupFieldApiName.toLowerCase());
            if (field == null) {
                return null;
            }
            List<Schema.SObjectType> refs = field.getDescribe().getReferenceTo();
            return refs.isEmpty() ? null : refs[0].getDescribe().getName();
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Returns WaitlistParticipant records for the given territory, including
     * any caller-specified extra fields on top of the required base set.
     *
     * @param territoryId The Id of the ServiceTerritory to filter by.
     * @param fields      Extra WaitlistParticipant field API names to include (may be null/empty).
     * @return WaitlistParticipant records ordered by AcceptanceTime ASC.
     * @throws AuraHandledException on query error.
     */
    @AuraEnabled(cacheable=false)
    public static List<WaitlistParticipant> getWaitlistParticipants(
        String territoryId,
        List<String> fields
    ) {
        if (String.isBlank(territoryId)) {
            return new List<WaitlistParticipant>();
        }

        try {
            String fieldList = buildFieldList(WL_BASE_FIELDS, fields);
            String safeId = String.escapeSingleQuotes(territoryId);
            // ISSUE 3 + 5 FIX: territory-aware day bounds; exclude walk-ins from prior days
            Datetime[] bounds = territoryDayBounds(territoryId);
            Datetime dayStart = bounds[0];
            Datetime dayEnd   = bounds[1];

            String soql =
                'SELECT ' + fieldList + WL_TYPEOF_CLAUSE +
                ' FROM WaitlistParticipant' +
                ' WHERE Waitlist.ServiceTerritoryId = :safeId' +
                '   AND Status IN (\'Waiting\', \'Unassigned\')' +
                '   AND CreatedDate >= :dayStart AND CreatedDate < :dayEnd' +
                ' WITH USER_MODE' +
                ' ORDER BY CreatedDate ASC';

            return Database.query(soql);
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    // ─── DML Methods ──────────────────────────────────────────────────────────

    /**
     * Sets the Status of the given ServiceAppointment to 'Checked In' and
     * returns the refreshed record so the LWC can update its card immediately.
     *
     * @param appointmentId The Id of the ServiceAppointment to check in.
     * @return The updated ServiceAppointment record.
     * @throws AuraHandledException when the Id is blank or any DML/query error occurs.
     */
    @AuraEnabled
    public static ServiceAppointment checkInAppointment(String appointmentId) {
        if (String.isBlank(appointmentId)) {
            throw new AuraHandledException('Appointment Id is required.');
        }

        try {
            ServiceAppointment appt = [
                SELECT Id, Status
                FROM ServiceAppointment
                WHERE Id = :appointmentId
                WITH USER_MODE
                LIMIT 1
            ];

            appt.Status          = STATUS_CHECKED_IN;
            // FIX 3: stamp ActualStartTime so the OR-branch in getAppointmentsByTerritory
            // can anchor the record to today even when SchedStartTime is null or a different day
            appt.ActualStartTime = Datetime.now();
            update as user appt;

            return [
                SELECT Id, Status, StatusCategory, AppointmentNumber
                FROM ServiceAppointment
                WHERE Id = :appointmentId
                WITH USER_MODE
                LIMIT 1
            ];
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Computes KPI metrics for the given service territory based on today's
     * ServiceAppointment and WaitlistParticipant records.
     * Returns a Map of KPI key -> { value (Decimal), label (String), context (String), unit (String) }.
     *
     * @param territoryId The ServiceTerritory Id.
     * @return Map of KPI key to metric data map.
     */
    @AuraEnabled(cacheable=false)
    public static Map<String, Object> getMetrics(String territoryId) {
        if (String.isBlank(territoryId)) {
            return new Map<String, Object>();
        }

        // ISSUE 3 + 4 FIX: use territory-aware midnight boundaries so KPIs match the board
        Datetime[] bounds = territoryDayBounds(territoryId);
        Datetime dayStart   = bounds[0];
        Datetime dayEnd     = bounds[1];
        Datetime oneHourAgo = Datetime.now().addHours(-1);
        String   safeId     = String.escapeSingleQuotes(territoryId);

        // ── Query 1: SA status aggregate — GROUP BY Status (not StatusCategory)
        // StatusCategory mapping varies by org setup; Status is the raw picklist
        // value set by DML and is always reliable.
        List<AggregateResult> statusAgg = Database.query(
            'SELECT Status sc, COUNT(Id) cnt' +
            ' FROM ServiceAppointment' +
            ' WHERE ServiceTerritoryId = :safeId' +
            '   AND SchedStartTime >= :dayStart AND SchedStartTime < :dayEnd' +
            ' WITH USER_MODE' +
            ' GROUP BY Status'
        );

        // Map raw Status strings to metric buckets.
        // "In Progress" and "Checked In" → currently being served.
        // "Complete" → finished.
        // "Cannot Complete" / "No Show" → no-show bucket.
        // "Scheduled" / "None" → not yet started (remaining).
        // "Canceled" → excluded from remaining but counted in total.
        Integer totalToday = 0, inProgress = 0, completed = 0, noShow = 0, remaining = 0, completedLastHour = 0;
        for (AggregateResult ar : statusAgg) {
            String sc   = (String)  ar.get('sc');
            Integer cnt = (Integer) ar.get('cnt');
            totalToday += cnt;
            // Compare against API names (values stored in the Status field, not labels)
            if (sc == 'In Progress' || sc == 'Checked_In')              inProgress += cnt;
            else if (sc == 'Completed')                                  completed  += cnt;
            else if (sc == 'Cannot Complete' || sc == 'No-Show')        noShow     += cnt;
            else if (sc == 'Scheduled' || sc == 'None' || sc == null)   remaining  += cnt;
        }

        // ── Query 2: throughput (completed in last hour) ───────────────────────
        List<AggregateResult> throughputAgg = Database.query(
            'SELECT COUNT(Id) cnt' +
            ' FROM ServiceAppointment' +
            ' WHERE ServiceTerritoryId = :safeId' +
            '   AND Status = \'Completed\'' + // API name; label is 'Complete'
            '   AND LastModifiedDate >= :oneHourAgo' +
            ' WITH USER_MODE'
        );
        if (!throughputAgg.isEmpty()) {
            completedLastHour = (Integer)(throughputAgg[0].get('cnt') ?? 0);
        }

        // ── Query 3: avg appointment duration (from SchedStart/End) ──────────
        List<ServiceAppointment> durationRecords = Database.query(
            'SELECT SchedStartTime, SchedEndTime' +
            ' FROM ServiceAppointment' +
            ' WHERE ServiceTerritoryId = :safeId' +
            '   AND SchedStartTime >= :dayStart AND SchedStartTime < :dayEnd' +
            '   AND SchedStartTime != null AND SchedEndTime != null' +
            ' WITH USER_MODE'
        );
        Decimal avgDuration = 0;
        if (!durationRecords.isEmpty()) {
            Long totalMins = 0;
            for (ServiceAppointment sa : durationRecords) {
                totalMins += (sa.SchedEndTime.getTime() - sa.SchedStartTime.getTime()) / 60000;
            }
            avgDuration = Decimal.valueOf(totalMins) / durationRecords.size();
        }

        // ── Query 4: top work type ─────────────────────────────────────────────
        List<AggregateResult> wtAgg = Database.query(
            'SELECT WorkType.Name wtn, COUNT(Id) cnt' +
            ' FROM ServiceAppointment' +
            ' WHERE ServiceTerritoryId = :safeId' +
            '   AND SchedStartTime >= :dayStart AND SchedStartTime < :dayEnd' +
            '   AND WorkTypeId != null' +
            ' WITH USER_MODE' +
            ' GROUP BY WorkType.Name' +
            ' ORDER BY COUNT(Id) DESC' +
            ' LIMIT 5'
        );
        String topWorkType  = null;
        Integer topWtCount  = 0;
        Integer apptTypeCount = wtAgg.size();
        if (!wtAgg.isEmpty()) {
            topWorkType = (String)  wtAgg[0].get('wtn');
            topWtCount  = (Integer) wtAgg[0].get('cnt');
        }

        // ── Query 5: peak hour ─────────────────────────────────────────────────
        List<AggregateResult> hourAgg = Database.query(
            'SELECT HOUR_IN_DAY(SchedStartTime) hr, COUNT(Id) cnt' +
            ' FROM ServiceAppointment' +
            ' WHERE ServiceTerritoryId = :safeId' +
            '   AND SchedStartTime >= :dayStart AND SchedStartTime < :dayEnd' +
            ' WITH USER_MODE' +
            ' GROUP BY HOUR_IN_DAY(SchedStartTime)' +
            ' ORDER BY COUNT(Id) DESC' +
            ' LIMIT 1'
        );
        Integer peakHour     = null;
        Integer peakHourCount = 0;
        if (!hourAgg.isEmpty()) {
            peakHour      = (Integer) hourAgg[0].get('hr');
            peakHourCount = (Integer) hourAgg[0].get('cnt');
        }

        // ── Query 6: walk-in waitlist ──────────────────────────────────────────
        List<WaitlistParticipant> wlRecords = Database.query(
            'SELECT CreatedDate, Status' +
            ' FROM WaitlistParticipant' +
            ' WHERE Waitlist.ServiceTerritoryId = :safeId' +
            '   AND Status = \'Waiting\'' +
            '   AND CreatedDate >= :dayStart AND CreatedDate < :dayEnd' +
            ' WITH USER_MODE'
        );
        Integer wlWaiting    = wlRecords.size();
        Decimal avgQueueWait = 0;
        if (wlWaiting > 0) {
            Long totalWaitMs = 0;
            Long nowMs = Datetime.now().getTime();
            for (WaitlistParticipant wp : wlRecords) {
                if (wp.CreatedDate != null) {
                    totalWaitMs += nowMs - wp.CreatedDate.getTime();
                }
            }
            avgQueueWait = Decimal.valueOf(totalWaitMs) / wlWaiting / 60000;
        }

        // ── Compute derived KPIs ───────────────────────────────────────────────
        Decimal checkinRate  = totalToday > 0
            ? ((Decimal)(inProgress + completed + noShow) / totalToday * 100).setScale(0) : 0;
        Decimal noShowRate   = totalToday > 0
            ? ((Decimal) noShow / totalToday * 100).setScale(1) : 0;
        Integer totalWithWl  = totalToday + wlWaiting;
        Decimal walkinRatio  = totalWithWl > 0
            ? ((Decimal) wlWaiting / totalWithWl * 100).setScale(0) : 0;

        String peakLabel = peakHour != null
            ? formatHour(peakHour) + ' (' + peakHourCount + ' apts)'
            : 'N/A';

        // ── Assemble result map ────────────────────────────────────────────────
        Map<String, Object> result = new Map<String, Object>();

        result.put('total_today',    kpi(totalToday,                    'Appointments Today',          'All statuses combined',                   ''));
        result.put('in_progress',    kpi(inProgress,                    'Being Served Now',             'Checked in or in progress',               ''));
        result.put('completed',      kpi(completed,                     'Completed Today',              'Finished appointments',                   ''));
        result.put('remaining',      kpi(remaining,                     'Remaining Today',              'Scheduled, not yet started',              ''));
        result.put('checkin_rate',   kpi(checkinRate,                   'Check-In Rate',                totalToday + ' total appointments today',  '%'));
        result.put('noshow_rate',    kpi(noShowRate,                    'No-Show Rate',                 noShow + ' of ' + totalToday + ' today',   '%'));
        result.put('throughput',     kpi(completedLastHour,             'Throughput',                   'Appointments completed in last 60 min',   '/hr'));
        result.put('avg_duration',   kpi(avgDuration.setScale(0),      'Avg Appointment Duration',     'Based on scheduled start and end times',  'min'));
        result.put('wl_waiting',     kpi(wlWaiting,                    'Walk-Ins Waiting',             'Currently in queue',                      ''));
        result.put('avg_queue_wait', kpi(avgQueueWait.setScale(0),     'Avg Queue Wait',               'Minutes waiting for active walk-ins',     'min'));
        result.put('walkin_ratio',   kpi(walkinRatio,                  'Walk-In vs Scheduled Ratio',   'Percentage of today\'s traffic as walk-ins', '%'));
        result.put('appt_type_top',  kpi(topWtCount, topWorkType != null ? topWorkType : 'N/A',       apptTypeCount + ' service types today',    ''));
        result.put('peak_hour',      kpi(peakHourCount,                'Peak Traffic Hour',            'Busiest hour: ' + peakLabel,              'apts'));

        return result;
    }

    private static Map<String, Object> kpi(Decimal value, String label, String context, String unit) {
        return new Map<String, Object>{
            'value'   => value,
            'label'   => label,
            'context' => context,
            'unit'    => unit
        };
    }

    private static String formatHour(Integer h) {
        if (h == 0)  return '12 AM';
        if (h < 12)  return h + ' AM';
        if (h == 12) return '12 PM';
        return (h - 12) + ' PM';
    }

    // ─── Action Methods ───────────────────────────────────────────────────────

    @AuraEnabled
    public static void rescheduleAppointment(String appointmentId, String newStartTime, String newEndTime) {
        if (String.isBlank(appointmentId) || String.isBlank(newStartTime) || String.isBlank(newEndTime)) {
            throw new AuraHandledException('Appointment Id, start time, and end time are required.');
        }
        try {
            ServiceAppointment appt = [
                SELECT Id FROM ServiceAppointment WHERE Id = :appointmentId WITH USER_MODE LIMIT 1
            ];
            // ISSUE 2 FIX: JSON.deserialize correctly interprets the ISO 8601 Z suffix as UTC;
            // Datetime.valueOf() strips the Z and treats the value as local time, causing TZ drift
            appt.SchedStartTime = (Datetime) JSON.deserialize('"' + newStartTime + '"', Datetime.class);
            appt.SchedEndTime   = (Datetime) JSON.deserialize('"' + newEndTime   + '"', Datetime.class);
            update as user appt;
        } catch (AuraHandledException ahe) {
            throw ahe;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static void markNoShow(String appointmentId, String serviceNote) {
        if (String.isBlank(appointmentId)) {
            throw new AuraHandledException('Appointment Id is required.');
        }
        try {
            ServiceAppointment appt = [
                SELECT Id FROM ServiceAppointment WHERE Id = :appointmentId WITH USER_MODE LIMIT 1
            ];
            appt.Status      = 'No-Show'; // API name; label is 'No Show'
            appt.ServiceNote = serviceNote;
            update as user appt;
        } catch (AuraHandledException ahe) {
            throw ahe;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled(cacheable=false)
    public static List<Map<String,String>> getResourcesForTerritory(String territoryId) {
        if (String.isBlank(territoryId)) return new List<Map<String,String>>();
        String safeId = String.escapeSingleQuotes(territoryId);
        List<ServiceTerritoryMember> members = [
            SELECT ServiceResourceId, ServiceResource.Name, ServiceResource.ResourceType
            FROM ServiceTerritoryMember
            WHERE ServiceTerritoryId = :safeId
            WITH USER_MODE
            ORDER BY ServiceResource.Name ASC
        ];
        List<Map<String,String>> result = new List<Map<String,String>>();
        for (ServiceTerritoryMember m : members) {
            result.add(new Map<String,String>{
                'id'   => m.ServiceResourceId,
                'name' => m.ServiceResource.Name,
                'type' => m.ServiceResource.ResourceType
            });
        }
        return result;
    }

    @AuraEnabled
    public static void reassignServiceResource(String appointmentId, String serviceResourceId) {
        if (String.isBlank(appointmentId)) {
            throw new AuraHandledException('Appointment Id is required.');
        }
        try {
            // FIX 3: cache SA fields before touching AssignedResource.
            // Deleting an AssignedResource can cause FSL background triggers to interpret
            // the removal as an "unschedule" event and wipe SchedStartTime/SchedEndTime/Status
            // when ActualStartTime is null. We restore those fields immediately after deletion
            // so the subsequent insert has a valid schedule to attach to.
            ServiceAppointment sa = [
                SELECT Id, Status, SchedStartTime, SchedEndTime
                FROM ServiceAppointment
                WHERE Id = :appointmentId
                WITH USER_MODE
                LIMIT 1
            ];

            List<AssignedResource> existing = [
                SELECT Id FROM AssignedResource
                WHERE ServiceAppointmentId = :appointmentId
                WITH USER_MODE
            ];
            if (!existing.isEmpty()) {
                delete as user existing;
            }

            // Restore appointment fields in case FSL triggers cleared them on deletion.
            // Explicitly re-stamping the values forces the update DML to fire even if
            // Salesforce's dirty-field tracking sees them as unchanged on the heap object.
            sa.Status        = sa.Status;
            sa.SchedStartTime = sa.SchedStartTime;
            sa.SchedEndTime   = sa.SchedEndTime;
            Database.update(sa, false); // allowPartialSuccess=false; errors surface normally

            if (String.isNotBlank(serviceResourceId)) {
                AssignedResource ar = new AssignedResource();
                ar.ServiceAppointmentId = appointmentId;
                ar.ServiceResourceId    = serviceResourceId;
                insert as user ar;
            }
        } catch (AuraHandledException ahe) {
            throw ahe;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static void markWaitlistNoShow(String participantId) {
        if (String.isBlank(participantId)) {
            throw new AuraHandledException('Participant Id is required.');
        }
        try {
            WaitlistParticipant wp = [
                SELECT Id, ServiceAppointmentId FROM WaitlistParticipant
                WHERE Id = :participantId WITH USER_MODE LIMIT 1
            ];
            // WaitlistParticipant has no No Show status — mark the linked SA and delete the WP
            if (wp.ServiceAppointmentId != null) {
                ServiceAppointment sa = [
                    SELECT Id FROM ServiceAppointment
                    WHERE Id = :wp.ServiceAppointmentId WITH USER_MODE LIMIT 1
                ];
                sa.Status = 'No Show';
                update as user sa;
            }
            delete as user wp;
        } catch (AuraHandledException ahe) {
            throw ahe;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static void removeWaitlistResource(String participantId) {
        if (String.isBlank(participantId)) {
            throw new AuraHandledException('Participant Id is required.');
        }
        try {
            WaitlistParticipant wp = [
                SELECT Id, ServiceAppointmentId FROM WaitlistParticipant
                WHERE Id = :participantId WITH USER_MODE LIMIT 1
            ];
            wp.Status = 'Unassigned';
            update as user wp;
            if (wp.ServiceAppointmentId != null) {
                List<AssignedResource> ars = [
                    SELECT Id FROM AssignedResource
                    WHERE ServiceAppointmentId = :wp.ServiceAppointmentId
                    WITH USER_MODE
                ];
                if (!ars.isEmpty()) {
                    delete as user ars;
                }
            }
        } catch (AuraHandledException ahe) {
            throw ahe;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled(cacheable=false)
    public static List<Map<String,Object>> getAvailableSlots(String territoryId, String appointmentId) {
        if (String.isBlank(territoryId)) return new List<Map<String,Object>>();
        // Return 30-min slots for the next 2 business days (9am–5pm)
        List<Map<String,Object>> slots = new List<Map<String,Object>>();
        Date today = Date.today();
        Integer daysAdded = 0;
        Integer daysCounted = 0;
        while (daysCounted < 2) {
            daysAdded++;
            Date candidate = today.addDays(daysAdded);
            Integer dow = Math.mod(candidate.toStartOfWeek().daysBetween(candidate), 7);
            // toStartOfWeek returns Sunday; 0=Sun, 1=Mon...6=Sat
            if (dow == 0 || dow == 6) continue;
            daysCounted++;
            Datetime slotStart = Datetime.newInstanceGmt(candidate.year(), candidate.month(), candidate.day(), 16, 0, 0); // 9am PT = 16 UTC (rough)
            for (Integer i = 0; i < 16; i++) {
                Datetime s = slotStart.addMinutes(i * 30);
                Datetime e = s.addMinutes(30);
                slots.add(new Map<String,Object>{
                    'startIso' => s.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\''),
                    'endIso'   => e.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\''),
                    'label'    => s.format('EEE, MMM d \'at\' h:mm a')
                });
            }
        }
        return slots;
    }

    // ─── Private Helpers ──────────────────────────────────────────────────────

    /**
     * Returns [dayStart, dayEnd] as UTC Datetime values representing midnight-to-midnight
     * for today in the ServiceTerritory's own OperatingHours timezone.
     *
     * Why: Salesforce stores all Datetimes in UTC. Date.today() and Datetime.newInstance()
     * resolve "today" relative to the running user's timezone, not the territory's.
     * A centralized operator viewing a territory in a different TZ will see the wrong
     * day window unless we anchor the boundary to the territory's timezone.
     *
     * How: We ask Apex for the current date string in the territory's TZ using
     * Datetime.now().format('yyyy-MM-dd', tzId), then reconstruct midnight UTC from that.
     */
    private static Datetime[] territoryDayBounds(String territoryId) {
        String tzId = null;
        try {
            ServiceTerritory st = [
                SELECT OperatingHours.TimeZone
                FROM   ServiceTerritory
                WHERE  Id = :territoryId
                WITH   USER_MODE
                LIMIT  1
            ];
            tzId = st.OperatingHours?.TimeZone;
        } catch (Exception e) {
            // If the territory has no OperatingHours, fall back to user TZ below
        }

        Datetime dayStart;
        if (String.isNotBlank(tzId)) {
            // Get today's date string in the territory's timezone (e.g. '2026-05-27')
            String localDateStr = Datetime.now().format('yyyy-MM-dd', tzId);
            // Parse back to a Datetime at midnight in that timezone
            // JSON.deserialize handles ISO 8601 with explicit offset; we need the UTC equivalent
            // of midnight in tzId. We use Datetime.newInstance on the local date parts and
            // correct for the offset by asking the TZ for its offset at that moment.
            List<String> parts = localDateStr.split('-');
            Integer yr  = Integer.valueOf(parts[0]);
            Integer mo  = Integer.valueOf(parts[1]);
            Integer dy  = Integer.valueOf(parts[2]);
            // Construct midnight in the territory TZ by formatting a known UTC anchor
            // and walking back: serialize midnight-UTC for that date string, then offset.
            // Salesforce doesn't expose a TZ offset API directly, so we use a format trick:
            // format the candidate midnight-UTC in the target TZ and check whether it reads '00:00'.
            // Binary-search the offset in 15-min steps over ±14 hours (±56 steps).
            Datetime midnightUtcCandidate = Datetime.newInstanceGmt(yr, mo, dy, 0, 0, 0);
            String formatted = midnightUtcCandidate.format('HH:mm', tzId);
            if (formatted == '00:00') {
                dayStart = midnightUtcCandidate;
            } else {
                // Walk the candidate in 15-min increments until format() returns '00:00' in tzId
                // Search window: ±14 hours = ±56 steps of 15 min
                Datetime found = null;
                for (Integer step = -56; step <= 56; step++) {
                    Datetime candidate = midnightUtcCandidate.addMinutes(step * 15);
                    if (candidate.format('HH:mm', tzId) == '00:00') {
                        // Verify the date part still matches (handles DST edge where two hits exist)
                        if (candidate.format('yyyy-MM-dd', tzId) == localDateStr) {
                            found = candidate;
                            break;
                        }
                    }
                }
                dayStart = found != null ? found : Datetime.newInstanceGmt(yr, mo, dy, 0, 0, 0);
            }
        } else {
            // Fallback: user's local timezone midnight
            dayStart = Datetime.newInstance(Date.today(), Time.newInstance(0, 0, 0, 0));
        }

        return new Datetime[]{ dayStart, dayStart.addDays(1) };
    }

    /**
     * Merges base fields with caller-supplied extra fields into a comma-separated
     * SELECT list, deduplicating and sanitizing each extra field name.
     *
     * @param baseFields Required fields always included.
     * @param extraFields Caller-supplied additional fields (may be null).
     * @return Comma-separated field list string safe for use in dynamic SOQL SELECT.
     */
    private static String buildFieldList(List<String> baseFields, List<String> extraFields) {
        Set<String> fieldSet = new Set<String>();
        for (String f : baseFields) {
            fieldSet.add(f);
        }

        if (extraFields != null) {
            for (String field : extraFields) {
                if (String.isNotBlank(field) && field.trim().toLowerCase() != 'participant.name') {
                    fieldSet.add(String.escapeSingleQuotes(field.trim()));
                }
            }
        }

        return String.join(new List<String>(fieldSet), ', ');
    }
}
