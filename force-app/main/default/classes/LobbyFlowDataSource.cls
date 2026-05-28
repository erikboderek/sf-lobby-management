/**
 * Dynamic picklist for App Builder: returns all active flows so the
 * flow selector properties show a searchable dropdown instead of a plain text box.
 *
 * Returns Screen Flows (ProcessType IN 'Flow','AutoLaunchedFlow') — same scope
 * as the native Salesforce Scheduler component's flow pickers.
 *
 * Registered via datasource="apex://LobbyFlowDataSource" in js-meta.xml.
 */
global with sharing class LobbyFlowDataSource extends VisualEditor.DynamicPickList {

    /** @return No default — forces an explicit selection. */
    global override VisualEditor.DataRow getDefaultValue() {
        return null;
    }

    /** @return All active Screen and Auto-Launched Flow definitions as label/value pairs. */
    global override VisualEditor.DynamicPickListRows getValues() {
        VisualEditor.DynamicPickListRows rows = new VisualEditor.DynamicPickListRows();

        for (FlowDefinitionView flow : [
            SELECT ApiName, Label
            FROM FlowDefinitionView
            WHERE IsActive = true
            ORDER BY Label ASC
        ]) {
            rows.addRow(new VisualEditor.DataRow(flow.Label, flow.ApiName));
        }

        return rows;
    }
}
