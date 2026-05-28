({
    /**
     * Receives the valuechange event from the inner LWC and notifies
     * App Builder of the new property value via designAttributeManager.
     *
     * The notifyPropertyUpdate() pattern matches actionListEditor.cmp used
     * by the Highlights Panel — it is the correct App Builder mechanism for
     * custom attribute editors to persist a value change.
     */
    handleValueChange: function (component, event, helper) {
        var newValue = event.getParam('value');

        component.set('v.value', newValue);

        var manager = component.get('v.designAttributeManager');
        if (manager) {
            manager.notifyPropertyUpdate();
        }
    }
})
