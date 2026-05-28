import { LightningElement, api, track } from 'lwc';
import getActiveFlows from '@salesforce/apex/LobbyFlowAuraAdapter.getActiveFlows';

export default class LobbyCpeFlowPicker extends LightningElement {

    @api value;

    @track options = [];
    @track isLoading = true;
    @track errorMessage = null;

    connectedCallback() {
        this._loadFlows();
    }

    async _loadFlows() {
        try {
            const flows = await getActiveFlows();
            this.options = flows.map(f => ({ label: f.label, value: f.value }));
        } catch (error) {
            this.errorMessage = error?.body?.message ?? 'Failed to load flows.';
        } finally {
            this.isLoading = false;
        }
    }

    get hasOptions() {
        return !this.isLoading && !this.errorMessage && this.options.length > 0;
    }

    get hasError() {
        return !!this.errorMessage;
    }

    get isEmpty() {
        return !this.isLoading && !this.errorMessage && this.options.length === 0;
    }

    handleChange(event) {
        this.dispatchEvent(new CustomEvent('valuechange', {
            bubbles: true,
            composed: true,
            detail: { value: event.detail.value }
        }));
    }
}
