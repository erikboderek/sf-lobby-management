import { LightningElement, api, wire } from 'lwc';
import getQuickActionsForObject from '@salesforce/apex/QuickActionPickerController.getQuickActionsForObject';

/**
 * Inner LWC used exclusively by actionPickerEditor.cmp.
 *
 * Fetches quick actions for `objectApiName` via Apex, renders them in a
 * lightning-dual-listbox, and fires a `valuechange` event upward to the Aura
 * editor wrapper whenever the selection changes.
 *
 * The Aura wrapper owns property persistence — this component is stateless.
 */
export default class ActionPickerDualList extends LightningElement {

    /** SObject API name to load quick actions for (e.g. 'ServiceAppointment'). */
    @api objectApiName;

    /** Current comma-delimited selection string received from the Aura parent. */
    @api selectedValue = '';

    /** Label shown above the Available column. */
    @api sourceLabel = 'Available';

    /** Label shown above the Selected column. */
    @api selectedLabel = 'Selected';

    /** Accessible label for the dual-listbox. Hidden via variant="label-hidden". */
    @api fieldLabel = 'Quick Actions';

    isLoading = false;
    loadError = null;
    options = [];

    @wire(getQuickActionsForObject, { objectApiName: '$objectApiName' })
    wiredActions({ data, error }) {
        this.isLoading = false;
        if (data) {
            this.options = data.map(opt => ({ label: opt.label, value: opt.value }));
            this.loadError = null;
        } else if (error) {
            this.loadError = error?.body?.message ?? 'Failed to load quick actions.';
            this.options = [];
        }
    }

    get selectedValues() {
        if (!this.selectedValue) return [];
        return this.selectedValue.split(',').map(v => v.trim()).filter(Boolean);
    }

    get hasError() {
        return Boolean(this.loadError);
    }

    get hasOptions() {
        return this.options.length > 0;
    }

    handleChange(event) {
        const newValues = event.detail.value;
        this.dispatchEvent(new CustomEvent('valuechange', {
            detail: { value: newValues.join(',') },
            bubbles: false
        }));
    }
}
