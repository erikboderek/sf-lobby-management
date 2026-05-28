/**
 * Unit tests for LobbyConfigController.
 *
 * getConfig() is tested against whatever the org has for DeveloperName='Default'.
 * saveConfig() validates input guarding and that a valid map enqueues without error.
 */
@IsTest
private class LobbyConfigControllerTest {

    @IsTest
    static void getConfig_ReturnsRecordOrNull() {
        Test.startTest();
        Lobby_Config__mdt result = LobbyConfigController.getConfig();
        Test.stopTest();

        // May be null in a fresh org — that is a valid first-run state.
        // If it exists, verify it has the expected developer name.
        if (result != null) {
            Assert.areEqual('Default', result.DeveloperName,
                'Expected the Default config record.');
        }
    }

    @IsTest
    static void saveConfig_ThrowsOnNullMap() {
        Test.startTest();
        try {
            LobbyConfigController.saveConfig(null);
            Assert.fail('Expected AuraHandledException for null configMap.');
        } catch (AuraHandledException e) {
            Assert.isTrue(String.isNotBlank(e.getMessage()),
                'Exception message should not be blank.');
        }
        Test.stopTest();
    }

    @IsTest
    static void saveConfig_ThrowsOnEmptyMap() {
        Test.startTest();
        try {
            LobbyConfigController.saveConfig(new Map<String, Object>());
            Assert.fail('Expected AuraHandledException for empty configMap.');
        } catch (AuraHandledException e) {
            Assert.isTrue(String.isNotBlank(e.getMessage()),
                'Exception message should not be blank.');
        }
        Test.stopTest();
    }

    @IsTest
    static void saveConfig_EnqueuesWithValidMap() {
        Map<String, Object> configMap = new Map<String, Object>{
            'Target_Lookup_Field__c' => 'Case__c',
            'Refresh_Interval__c'   => 30,
            'Max_Appointments__c'   => 50
        };

        Test.startTest();
        // enqueueDeployment is a no-op in test context — should not throw.
        try {
            LobbyConfigController.saveConfig(configMap);
        } catch (AuraHandledException e) {
            Assert.fail('saveConfig should not throw for a valid map: ' + e.getMessage());
        }
        Test.stopTest();
    }
}
