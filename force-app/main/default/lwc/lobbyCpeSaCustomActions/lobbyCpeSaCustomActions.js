import { LightningElement, api, wire } from 'lwc';
import getQuickActions from '@salesforce/apex/LobbyFlowAuraAdapter.getQuickActions';

export default class LobbyCpeSaCustomActions extends LightningElement {

    @api value;

    options = [];
    isLoading = true;
    errorMessage = null;

    @wire(getQuickActions, { objectApiName: 'ServiceAppointment' })
    wiredActions({ data, error }) {
        this.isLoading = false;
        if (data) {
            this.options = data.map(a => ({ label: a.label, value: a.value }));
        } else if (error) {
            this.errorMessage = error?.body?.message ?? 'Failed to load actions.';
        }
    }

    get selectedValues() {
        if (!this.value) return [];
        try { return JSON.parse(this.value); } catch (e) { return []; }
    }

    get hasOptions() { return !this.isLoading && !this.errorMessage && this.options.length > 0; }
    get hasError()   { return !!this.errorMessage; }

    handleChange(event) {
        this.dispatchEvent(new CustomEvent('configurationeditorvaluechange', {
            bubbles: true,
            cancelable: false,
            detail: {
                name: 'saCustomActions',
                newValue: JSON.stringify(event.detail.value),
                newValueDataType: 'String'
            }
        }));
    }
}
