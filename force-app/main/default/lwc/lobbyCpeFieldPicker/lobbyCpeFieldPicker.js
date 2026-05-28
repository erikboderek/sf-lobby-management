import { LightningElement, api, track, wire } from 'lwc';
import getFieldOptions from '@salesforce/apex/LobbyFieldDataSource.getFieldOptions';

export default class LobbyCpeFieldPicker extends LightningElement {

    // Provided by the CPE framework — the current property value (comma-separated string)
    @api value;
    // Which SObject's fields to show — set via the CPE registration in js-meta.xml
    @api objectApiName = 'ServiceAppointment';
    @api fieldLabel = 'Fields';

    @track options = [];
    @track isLoading = true;
    @track errorMessage = null;

    @wire(getFieldOptions, { objectApiName: '$objectApiName' })
    wiredFields({ data, error }) {
        this.isLoading = false;
        if (data) {
            this.options = data.map(opt => ({ label: opt.label, value: opt.value }));
        } else if (error) {
            this.errorMessage = error?.body?.message ?? 'Failed to load fields.';
        }
    }

    get selectedValues() {
        if (!this.value || typeof this.value !== 'string') return [];
        return this.value.split(',').map(f => f.trim()).filter(Boolean);
    }

    get hasOptions() {
        return !this.isLoading && !this.errorMessage && this.options.length > 0;
    }

    get hasError() {
        return !!this.errorMessage;
    }

    handleChange(event) {
        const selected = event.detail.value;
        // Fire the standard CPE value-change event so App Builder persists the value
        this.dispatchEvent(new CustomEvent('valuechange', {
            bubbles: true,
            composed: true,
            detail: { value: selected.join(',') }
        }));
    }
}
