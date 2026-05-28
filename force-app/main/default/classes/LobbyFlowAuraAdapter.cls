/**
 * Thin @AuraEnabled adapter exposing active flows and quick actions
 * to lobbyPageContent Custom Property Editor components.
 */
public with sharing class LobbyFlowAuraAdapter {

    /**
     * Returns all active Screen Flows as label/value pairs.
     *
     * @return List of maps with 'label' and 'value' (flow API name).
     */
    @AuraEnabled
    public static List<Map<String, String>> getActiveFlows() {
        try {
            List<FlowDefinitionView> rows = [
                SELECT ApiName, Label
                FROM FlowDefinitionView
                WHERE ProcessType = 'Flow'
                AND ActiveVersionId != null
                ORDER BY Label ASC
                LIMIT 2000
            ];
            List<Map<String, String>> flows = new List<Map<String, String>>();
            for (FlowDefinitionView flow : rows) {
                flows.add(new Map<String, String>{
                    'label' => flow.Label,
                    'value' => flow.ApiName
                });
            }
            return flows;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Returns quick actions defined on the given SObject using the
     * QuickAction.describeQuickActions() API.
     *
     * @param objectApiName SObject API name (e.g. 'ServiceAppointment').
     * @return List of maps with 'label' and 'value' (action API name).
     */
    @AuraEnabled(cacheable=true)
    public static List<Map<String, String>> getQuickActions(String objectApiName) {
        if (String.isBlank(objectApiName)) {
            return new List<Map<String, String>>();
        }
        try {
            List<Map<String, String>> actions = new List<Map<String, String>>();
            for (QuickAction.DescribeQuickActionResult r :
                    QuickAction.describeQuickActions(new List<String>{ objectApiName })) {
                actions.add(new Map<String, String>{
                    'label' => r.getLabel(),
                    'value' => r.getName()
                });
            }
            return actions;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }
}
