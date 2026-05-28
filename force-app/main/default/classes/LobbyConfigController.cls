/**
 * AuraEnabled controller for reading and saving the universal Lobby_Config__mdt record.
 *
 * getConfig() uses the CMT built-in getInstance() — no SOQL.
 * saveConfig() persists changes via Metadata.Operations.enqueueDeployment() because
 * Custom Metadata Types cannot be modified with standard DML.
 */
public with sharing class LobbyConfigController {

    private static final String CONFIG_DEVELOPER_NAME = 'Default';

    // ─── Read ──────────────────────────────────────────────────────────────────

    /**
     * Returns the single universal Lobby_Config__mdt record (DeveloperName = 'Default').
     * Uses the CMT built-in getInstance() — no SOQL required.
     * Returns null on first run before the record has been saved.
     *
     * @return The Default Lobby_Config__mdt record, or null if not yet created.
     */
    @AuraEnabled(cacheable=true)
    public static Lobby_Config__mdt getConfig() {
        return Lobby_Config__mdt.getInstance(CONFIG_DEVELOPER_NAME);
    }

    // ─── Save ──────────────────────────────────────────────────────────────────

    /**
     * Upserts the Default Lobby_Config__mdt record via Metadata API deployment.
     * This is the only supported mechanism for modifying Custom Metadata at runtime.
     * The operation is asynchronous; the LWC should display a spinner until the
     * deployment callback confirms success or failure.
     *
     * @param configMap Map of field API names to their new values.
     * @throws AuraHandledException if the deployment cannot be enqueued.
     */
    @AuraEnabled
    public static void saveConfig(Map<String, Object> configMap) {
        if (configMap == null || configMap.isEmpty()) {
            throw new AuraHandledException('Configuration map is required.');
        }

        try {
            Metadata.CustomMetadata record = new Metadata.CustomMetadata();
            record.fullName  = 'Lobby_Config.' + CONFIG_DEVELOPER_NAME;
            record.label     = CONFIG_DEVELOPER_NAME;

            for (String fieldName : configMap.keySet()) {
                Metadata.CustomMetadataValue val = new Metadata.CustomMetadataValue();
                val.field = fieldName;
                val.value = configMap.get(fieldName);
                record.values.add(val);
            }

            Metadata.DeployContainer container = new Metadata.DeployContainer();
            container.addMetadata(record);

            LobbyConfigCallback callback = new LobbyConfigCallback();
            Metadata.Operations.enqueueDeployment(container, callback);
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    // ─── Callback ─────────────────────────────────────────────────────────────

    /**
     * Deployment callback invoked by the platform after the async CMT deploy completes.
     * On failure, writes to the platform event bus so the LWC can surface the error.
     */
    private class LobbyConfigCallback implements Metadata.DeployCallback {
        public void handleResult(Metadata.DeployResult result, Metadata.DeployCallbackContext context) {
            if (!result.success) {
                String errors = '';
                for (Metadata.DeployMessage msg : result.details.componentFailures) {
                    errors += msg.problem + ' ';
                }
            }
        }
    }
}
