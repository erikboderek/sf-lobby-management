/**
 * Provides ServiceAppointment and WaitlistParticipant field options for
 * the lobbyPageContent Custom Property Editor component.
 *
 * Called by lobbyCpeFieldPicker to populate the dual-listbox of available fields.
 */
public with sharing class LobbyFieldDataSource {

    /**
     * Returns user-readable field options for a given SObject API name,
     * excluding system/base fields that are always fetched by the controller.
     *
     * @param objectApiName The SObject API name ('ServiceAppointment' or 'WaitlistParticipant').
     * @return List of label/value maps suitable for lightning-dual-listbox options.
     */
    @AuraEnabled(cacheable=true)
    public static List<Map<String, String>> getFieldOptions(String objectApiName) {
        if (String.isBlank(objectApiName)) {
            return new List<Map<String, String>>();
        }

        // Fields always included by the controller — excluded from picker to avoid duplicate confusion
        Set<String> baseFieldsLower = new Set<String>();
        if (objectApiName == 'ServiceAppointment') {
            baseFieldsLower.addAll(new List<String>{
                'id', 'appointmentnumber', 'status', 'statuscategory',
                'schedstarttime', 'schedendtime', 'serviceterritoryid',
                'worktypeid', 'worktype.name', 'contactid', 'contact.name',
                'accountid', 'account.name'
            });
        } else if (objectApiName == 'WaitlistParticipant') {
            baseFieldsLower.addAll(new List<String>{
                'id', 'participantidentifier', 'status', 'acceptancetime',
                'waitlistid', 'waitlist.serviceterritoryid', 'waitlist.name'
            });
        }

        try {
            Map<String, Schema.SObjectField> fieldMap =
                Schema.getGlobalDescribe().get(objectApiName)?.getDescribe().fields.getMap();

            if (fieldMap == null) {
                return new List<Map<String, String>>();
            }

            // Collect display keys for sorting, then look up API names
            List<String> sortKeys = new List<String>();
            Map<String, String> keyToApiName = new Map<String, String>();

            for (String fieldName : fieldMap.keySet()) {
                if (baseFieldsLower.contains(fieldName.toLowerCase())) {
                    continue;
                }
                Schema.DescribeFieldResult dfr = fieldMap.get(fieldName).getDescribe();
                if (!dfr.isAccessible()) {
                    continue;
                }
                String displayKey = dfr.getLabel() + ' (' + dfr.getName() + ')';
                sortKeys.add(displayKey);
                keyToApiName.put(displayKey, dfr.getName());
            }

            sortKeys.sort();

            List<Map<String, String>> options = new List<Map<String, String>>();
            for (String key : sortKeys) {
                options.add(new Map<String, String>{
                    'label' => key,
                    'value' => keyToApiName.get(key)
                });
            }
            return options;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }
}
