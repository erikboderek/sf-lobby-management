/**
 * AuraEnabled controller that returns the quick actions registered on a
 * given SObject for use in the App Builder action-picker dual-listbox editor.
 *
 * Uses QuickAction.describeQuickActions() — a server-side describe API that
 * does not consume SOQL governor limits and respects the running user's
 * profile/permission-set access.
 *
 * Pattern: @AuraEnabled Controller (with sharing, cacheable reads only).
 */
public with sharing class QuickActionPickerController {

    // ─── Inner DTO ────────────────────────────────────────────────────────────

    /**
     * Lightweight label/value pair returned to the LWC dual-listbox.
     * Kept as an inner class so the LWC can deserialize via JSON.parse()
     * without needing a separate Apex type import.
     */
    public class ActionOption {
        /** Display label shown in the Available / Selected columns. */
        @AuraEnabled public String label;
        /** Action API name used as the stored value. */
        @AuraEnabled public String value;

        /** @param label Display label. @param value API name. */
        public ActionOption(String label, String value) {
            this.label  = label;
            this.value  = value;
        }
    }

    // ─── Read Methods ─────────────────────────────────────────────────────────

    /**
     * Returns quick actions defined on the given SObject as label/value pairs
     * suitable for a dual-listbox `options` attribute.
     *
     * Results are ordered by action label ascending for a consistent list.
     *
     * @param objectApiName SObject API name, e.g. 'ServiceAppointment' or 'WaitlistParticipant'.
     * @return List of ActionOption DTOs; empty list when objectApiName is blank.
     * @throws AuraHandledException when the describe call fails (invalid object name,
     *         permission error, etc.).
     * @example
     * List<QuickActionPickerController.ActionOption> opts =
     *     QuickActionPickerController.getQuickActionsForObject('ServiceAppointment');
     */
    @AuraEnabled(cacheable=true)
    public static List<ActionOption> getQuickActionsForObject(String objectApiName) {
        if (String.isBlank(objectApiName)) {
            return new List<ActionOption>();
        }

        try {
            List<ActionOption> options = new List<ActionOption>();
            for (QuickAction.DescribeQuickActionResult result :
                    QuickAction.describeQuickActions(new List<String>{ objectApiName })) {
                options.add(new ActionOption(result.getLabel(), result.getName()));
            }
            options.sort(new ActionOptionComparator());
            return options;
        } catch (Exception e) {
            throw new AuraHandledException(
                'Unable to load quick actions for ' + objectApiName + ': ' + e.getMessage()
            );
        }
    }

    // ─── Private Helpers ──────────────────────────────────────────────────────

    /** Sorts ActionOption instances alphabetically by label. */
    private class ActionOptionComparator implements Comparator<ActionOption> {
        public Integer compare(ActionOption a, ActionOption b) {
            return a.label.compareTo(b.label);
        }
    }
}
