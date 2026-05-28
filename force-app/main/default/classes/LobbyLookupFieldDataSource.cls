/**
 * Dynamic picklist for App Builder: returns all lookup and master-detail
 * fields on ServiceAppointment so the "Target Lookup Field" property shows
 * a searchable dropdown instead of a plain text box.
 *
 * Registered via datasource="apex://LobbyLookupFieldDataSource" in js-meta.xml.
 */
global with sharing class LobbyLookupFieldDataSource extends VisualEditor.DynamicPickList {

    global override VisualEditor.DataRow getDefaultValue() {
        return new VisualEditor.DataRow('Case (Case__c)', 'Case__c');
    }

    global override VisualEditor.DynamicPickListRows getValues() {
        VisualEditor.DynamicPickListRows rows = new VisualEditor.DynamicPickListRows();

        Map<String, Schema.SObjectField> fieldMap =
            Schema.SObjectType.ServiceAppointment.fields.getMap();

        List<String> sortKeys = new List<String>();
        Map<String, String> keyToApiName = new Map<String, String>();

        for (String fieldName : fieldMap.keySet()) {
            Schema.DescribeFieldResult dfr = fieldMap.get(fieldName).getDescribe();
            Schema.DisplayType dt = dfr.getType();
            if (dt != Schema.DisplayType.REFERENCE) {
                continue;
            }
            if (!dfr.isAccessible()) {
                continue;
            }
            String label = dfr.getLabel() + ' (' + dfr.getName() + ')';
            sortKeys.add(label);
            keyToApiName.put(label, dfr.getName());
        }

        sortKeys.sort();
        for (String key : sortKeys) {
            rows.addRow(new VisualEditor.DataRow(key, keyToApiName.get(key)));
        }

        return rows;
    }
}
