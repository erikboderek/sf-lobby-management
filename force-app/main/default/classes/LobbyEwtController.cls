/**
 * Calculates Estimated Wait Times (EWT) for the Lobby Management dashboard.
 *
 * Both methods are bulkified: they accept a list of IDs and return a map so the
 * LWC makes exactly two Apex calls per refresh cycle instead of N calls.
 */
public with sharing class LobbyEwtController {

    // ─── SA Estimated Wait Time (bulk) ────────────────────────────────────────

    /**
     * Calculates the dynamic EWT for a set of checked-in ServiceAppointments.
     *
     * Logic per appointment:
     *  1. Skip any appointment whose Status is not 'Checked_In'.
     *  2. Find the ServiceResource assigned to it via AssignedResource.
     *  3. Find any 'In Progress' appointment for that resource.
     *  4. Project completion = ActualStartTime + DurationInMinutes + BlockTimeAfterAppointment.
     *  5. EWT = max(0, projected completion − now) in minutes.
     *
     * All SOQL is bulk — 3 queries total regardless of list size.
     *
     * @param appointmentIds List of ServiceAppointment Ids to evaluate.
     * @return Map of appointmentId → Integer minutes (omits IDs where EWT cannot be determined).
     */
    @AuraEnabled(cacheable=false)
    public static Map<String, Integer> getAppointmentEwt(List<String> appointmentIds) {
        Map<String, Integer> result = new Map<String, Integer>();
        if (appointmentIds == null || appointmentIds.isEmpty()) return result;

        Datetime now = Datetime.now();

        // ── Query 1: load target appointments ────────────────────────────────
        List<ServiceAppointment> targets = [
            SELECT Id, Status, SchedStartTime
            FROM ServiceAppointment
            WHERE Id IN :appointmentIds
              AND Status = 'Checked_In'
            WITH USER_MODE
        ];
        if (targets.isEmpty()) return result;

        Set<Id> checkedInIds = new Set<Id>();
        Map<Id, ServiceAppointment> targetMap = new Map<Id, ServiceAppointment>();
        for (ServiceAppointment sa : targets) {
            checkedInIds.add(sa.Id);
            targetMap.put(sa.Id, sa);
        }

        // ── Query 2: load all AssignedResource rows for these appointments ────
        // Includes the blocking 'In Progress' appointment details via sub-select traversal.
        List<AssignedResource> assignments = [
            SELECT ServiceAppointmentId, ServiceResourceId
            FROM AssignedResource
            WHERE ServiceAppointmentId IN :checkedInIds
            WITH USER_MODE
        ];

        // Build apptId → resourceId map; one resource per appointment is sufficient
        Map<Id, Id> apptToResource = new Map<Id, Id>();
        Set<Id> resourceIds = new Set<Id>();
        for (AssignedResource ar : assignments) {
            if (!apptToResource.containsKey(ar.ServiceAppointmentId)) {
                apptToResource.put(ar.ServiceAppointmentId, ar.ServiceResourceId);
                resourceIds.add(ar.ServiceResourceId);
            }
        }

        // ── Query 3: find any 'In Progress' appointment per resource ──────────
        List<AssignedResource> blockingArs = [
            SELECT ServiceResourceId,
                   ServiceAppointment.ActualStartTime,
                   ServiceAppointment.DurationInMinutes,
                   ServiceAppointment.WorkType.BlockTimeAfterAppointment
            FROM AssignedResource
            WHERE ServiceResourceId IN :resourceIds
              AND ServiceAppointment.Status = 'In Progress'
            WITH USER_MODE
        ];

        // resourceId → projected completion time of the blocking appointment
        Map<Id, Datetime> resourceToProjectedEnd = new Map<Id, Datetime>();
        for (AssignedResource ar : blockingArs) {
            ServiceAppointment blocking = ar.ServiceAppointment;
            if (blocking.ActualStartTime == null || blocking.DurationInMinutes == null) continue;
            Decimal bufferMins = blocking.WorkType?.BlockTimeAfterAppointment ?? 0;
            Datetime projectedEnd = blocking.ActualStartTime
                .addMinutes((Integer)(blocking.DurationInMinutes + bufferMins));
            // Keep the latest projected end if a resource has multiple blocking SAs
            if (!resourceToProjectedEnd.containsKey(ar.ServiceResourceId)
                    || projectedEnd > resourceToProjectedEnd.get(ar.ServiceResourceId)) {
                resourceToProjectedEnd.put(ar.ServiceResourceId, projectedEnd);
            }
        }

        // ── Compute EWT for each target appointment ───────────────────────────
        for (Id apptId : checkedInIds) {
            ServiceAppointment target = targetMap.get(apptId);
            Id resourceId = apptToResource.get(apptId);

            if (resourceId == null) {
                // No assigned resource — no EWT computable
                continue;
            }

            Datetime projectedEnd = resourceToProjectedEnd.get(resourceId);

            if (projectedEnd == null) {
                // Resource is already free — EWT is remaining time to SchedStartTime (or 0)
                if (target.SchedStartTime == null) {
                    result.put(apptId, 0);
                } else {
                    Long msToStart = target.SchedStartTime.getTime() - now.getTime();
                    result.put(apptId, (Integer) Math.max(0, Math.ceil((Decimal) msToStart / 60000)));
                }
                continue;
            }

            // Handle early-arrival: resource free before scheduled start
            if (target.SchedStartTime != null && projectedEnd < target.SchedStartTime) {
                Long msToStart = target.SchedStartTime.getTime() - now.getTime();
                result.put(apptId, (Integer) Math.max(0, Math.ceil((Decimal) msToStart / 60000)));
                continue;
            }

            Long msRemaining = projectedEnd.getTime() - now.getTime();
            result.put(apptId, (Integer) Math.max(0, Math.ceil((Decimal) msRemaining / 60000)));
        }

        return result;
    }

    // ─── Waitlist Estimated Wait Time (bulk) ──────────────────────────────────

    /**
     * Calculates EWT for a set of WaitlistParticipants using queue-position arithmetic.
     *
     * Formula per participant:  EWT = (queuePosition × avgHandlingTime) / activeCapacity
     *
     * All SOQL is bulk — 3 queries total regardless of list size.
     *
     * @param participantIds List of WaitlistParticipant Ids to evaluate.
     * @return Map of participantId → Integer minutes (omits IDs not in Waiting/Unassigned status).
     */
    @AuraEnabled(cacheable=false)
    public static Map<String, Integer> getWaitlistEwt(List<String> participantIds) {
        Map<String, Integer> result = new Map<String, Integer>();
        if (participantIds == null || participantIds.isEmpty()) return result;

        // ── Query 1: load target participants ─────────────────────────────────
        List<WaitlistParticipant> participants = [
            SELECT Id, WaitlistId, Status, CreatedDate
            FROM WaitlistParticipant
            WHERE Id IN :participantIds
              AND Status IN ('Waiting', 'Unassigned')
            WITH USER_MODE
        ];
        if (participants.isEmpty()) return result;

        // Collect unique waitlist IDs
        Set<Id> waitlistIds = new Set<Id>();
        for (WaitlistParticipant wp : participants) {
            waitlistIds.add(wp.WaitlistId);
        }

        // ── Query 2: load all Waiting/Unassigned participants across those waitlists ──
        // Used to compute queue position for each target participant.
        List<WaitlistParticipant> allInQueue = [
            SELECT Id, WaitlistId, CreatedDate
            FROM WaitlistParticipant
            WHERE WaitlistId IN :waitlistIds
              AND Status IN ('Waiting', 'Unassigned')
            WITH USER_MODE
            ORDER BY CreatedDate ASC
        ];

        // Build waitlistId → ordered list of CreatedDate values (ascending = queue order)
        Map<Id, List<Datetime>> waitlistQueue = new Map<Id, List<Datetime>>();
        for (WaitlistParticipant wp : allInQueue) {
            if (!waitlistQueue.containsKey(wp.WaitlistId)) {
                waitlistQueue.put(wp.WaitlistId, new List<Datetime>());
            }
            waitlistQueue.get(wp.WaitlistId).add(wp.CreatedDate);
        }

        // ── Query 3: active capacity per waitlist ─────────────────────────────
        List<AggregateResult> capacityAgg = [
            SELECT WaitlistId wlId, COUNT(Id) cnt
            FROM WaitlistServiceResource
            WHERE WaitlistId IN :waitlistIds
              AND IsAvailable = true
            WITH USER_MODE
            GROUP BY WaitlistId
        ];
        Map<Id, Integer> waitlistCapacity = new Map<Id, Integer>();
        for (AggregateResult ar : capacityAgg) {
            waitlistCapacity.put((Id) ar.get('wlId'), (Integer) ar.get('cnt'));
        }

        // Avg handling time is a sub-query per waitlist — cache results to avoid re-querying
        Map<Id, Decimal> ahtCache = new Map<Id, Decimal>();

        // ── Compute EWT for each target participant ───────────────────────────
        for (WaitlistParticipant wp : participants) {
            List<Datetime> queue = waitlistQueue.get(wp.WaitlistId);
            if (queue == null) {
                result.put(wp.Id, 0);
                continue;
            }

            // Queue position = number of entries with CreatedDate strictly before this participant
            Integer position = 0;
            for (Datetime d : queue) {
                if (d < wp.CreatedDate) position++;
                else break; // list is ordered ASC
            }

            if (!ahtCache.containsKey(wp.WaitlistId)) {
                ahtCache.put(wp.WaitlistId, getAvgHandlingTime(wp.WaitlistId));
            }
            Decimal avgHandlingTime = ahtCache.get(wp.WaitlistId);

            Integer capacity = waitlistCapacity.containsKey(wp.WaitlistId)
                ? waitlistCapacity.get(wp.WaitlistId)
                : 1;
            if (capacity == 0) capacity = 1;

            Decimal ewt = (Decimal.valueOf(position) * avgHandlingTime) / capacity;
            result.put(wp.Id, (Integer) Math.ceil(ewt));
        }

        return result;
    }

    // ─── Private Helper ───────────────────────────────────────────────────────

    /**
     * Returns the average appointment duration for the waitlist's associated WorkTypes.
     * Falls back to 20 minutes when no WorkType data is available.
     */
    private static Decimal getAvgHandlingTime(Id waitlistId) {
        final Decimal DEFAULT_AHT = 20;
        try {
            List<AggregateResult> agg = [
                SELECT AVG(DurationInMinutes) avgDur
                FROM WorkType
                WHERE Id IN (
                    SELECT WorkTypeId
                    FROM WaitlistWorkType
                    WHERE WaitlistId = :waitlistId
                      AND WorkTypeId != null
                )
                WITH USER_MODE
            ];
            if (!agg.isEmpty()) {
                Decimal avg = (Decimal) agg[0].get('avgDur');
                if (avg != null && avg > 0) return avg;
            }
        } catch (Exception e) {
            // Fall through to default
        }
        return DEFAULT_AHT;
    }
}
