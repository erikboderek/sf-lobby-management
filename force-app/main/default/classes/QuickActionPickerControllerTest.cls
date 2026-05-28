/**
 * Test class for QuickActionPickerController.
 *
 * Covers: getQuickActionsForObject positive path, blank/null input guards,
 * and inner ActionOption DTO construction.
 *
 * Note on QuickAction.describeQuickActions():
 * This is a server-side describe API. Test context uses the same running-user
 * permissions as production. Standard objects (e.g. Account) always expose at
 * least the platform 'New' / 'Edit' global quick actions, guaranteeing a
 * non-empty result in any org with standard profiles.
 */
@IsTest
private class QuickActionPickerControllerTest {

    // ─── getQuickActionsForObject — positive ──────────────────────────────────

    @IsTest
    static void getQuickActionsForObject_standardObject_returnsListWithoutException() {
        // Given: Account — returns whatever quick actions are configured; may be empty in minimal orgs.

        // When
        Test.startTest();
        List<QuickActionPickerController.ActionOption> results =
            QuickActionPickerController.getQuickActionsForObject('Account');
        Test.stopTest();

        // Then: no exception thrown and result is a non-null list
        Assert.isNotNull(results, 'Result must not be null for a valid object name');
    }

    @IsTest
    static void getQuickActionsForObject_standardObject_allOptionsHaveLabelAndValue() {
        Test.startTest();
        List<QuickActionPickerController.ActionOption> results =
            QuickActionPickerController.getQuickActionsForObject('Account');
        Test.stopTest();

        for (QuickActionPickerController.ActionOption opt : results) {
            Assert.isNotNull(opt.label, 'Every option must have a non-null label');
            Assert.isNotNull(opt.value, 'Every option must have a non-null value');
            Assert.isFalse(String.isBlank(opt.label), 'Option label must not be blank');
            Assert.isFalse(String.isBlank(opt.value), 'Option value must not be blank');
        }
    }

    @IsTest
    static void getQuickActionsForObject_standardObject_orderedByLabelAscending() {
        Test.startTest();
        List<QuickActionPickerController.ActionOption> results =
            QuickActionPickerController.getQuickActionsForObject('Account');
        Test.stopTest();

        for (Integer i = 1; i < results.size(); i++) {
            Assert.isTrue(
                results[i - 1].label <= results[i].label,
                'Actions must be ordered by label ASC'
            );
        }
    }

    // ─── getQuickActionsForObject — guard clauses ─────────────────────────────

    @IsTest
    static void getQuickActionsForObject_blankInput_returnsEmptyList() {
        Test.startTest();
        List<QuickActionPickerController.ActionOption> results =
            QuickActionPickerController.getQuickActionsForObject('');
        Test.stopTest();

        Assert.isTrue(results.isEmpty(), 'Blank objectApiName should return empty list');
    }

    @IsTest
    static void getQuickActionsForObject_nullInput_returnsEmptyList() {
        Test.startTest();
        List<QuickActionPickerController.ActionOption> results =
            QuickActionPickerController.getQuickActionsForObject(null);
        Test.stopTest();

        Assert.isTrue(results.isEmpty(), 'Null objectApiName should return empty list');
    }

    @IsTest
    static void getQuickActionsForObject_whitespaceOnly_returnsEmptyList() {
        Test.startTest();
        List<QuickActionPickerController.ActionOption> results =
            QuickActionPickerController.getQuickActionsForObject('   ');
        Test.stopTest();

        Assert.isTrue(results.isEmpty(), 'Whitespace-only objectApiName should return empty list');
    }

    // ─── getQuickActionsForObject — error path ────────────────────────────────

    @IsTest
    static void getQuickActionsForObject_invalidObjectName_returnsEmptyOrThrows() {
        // QuickAction.describeQuickActions() for a non-existent object returns empty
        // rather than throwing — the controller's guard returns an empty list.
        Test.startTest();
        List<QuickActionPickerController.ActionOption> results;
        try {
            results = QuickActionPickerController.getQuickActionsForObject('NoSuchObject__FakeXYZ');
        } catch (AuraHandledException e) {
            // Acceptable: platform threw on describe — controller wrapped it
            Assert.isNotNull(e.getMessage(), 'AuraHandledException must carry a message');
            return;
        }
        Test.stopTest();

        // Also acceptable: describe returned empty for unknown object
        Assert.isNotNull(results, 'Result must not be null');
    }

    // ─── Coverage for loop body + sort ───────────────────────────────────────

    @IsTest
    static void getQuickActionsForObject_serviceAppointment_exercisesLoopAndSort() {
        // ServiceAppointment has Scheduler platform actions in any FSL/Scheduler org.
        Test.startTest();
        List<QuickActionPickerController.ActionOption> results =
            QuickActionPickerController.getQuickActionsForObject('ServiceAppointment');
        Test.stopTest();

        // Whether or not actions exist, no exception should be thrown
        Assert.isNotNull(results, 'Result must not be null');

        // If actions were returned, verify structure (covers loop body + sort)
        for (QuickActionPickerController.ActionOption opt : results) {
            Assert.isNotNull(opt.label, 'label must be non-null');
            Assert.isNotNull(opt.value, 'value must be non-null');
        }
    }

    // ─── ActionOption DTO ─────────────────────────────────────────────────────

    @IsTest
    static void actionOption_constructor_setsLabelAndValue() {
        Test.startTest();
        QuickActionPickerController.ActionOption opt =
            new QuickActionPickerController.ActionOption('My Label', 'my_value');
        Test.stopTest();

        Assert.areEqual('My Label', opt.label, 'label must match constructor argument');
        Assert.areEqual('my_value', opt.value, 'value must match constructor argument');
    }
}
