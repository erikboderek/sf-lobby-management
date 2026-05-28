import { LightningElement, api } from 'lwc';

export default class LobbyMasterCpe extends LightningElement {

    @api
    get inputVariables() { return this._inputVariables; }
    set inputVariables(vars) {
        this._inputVariables = vars ?? [];
        this._syncFromInputVariables();
    }

    _inputVariables = [];

    refreshIntervalSeconds = 30;
    maxAppointmentsShown   = 50;

    _syncFromInputVariables() {
        const get = name => {
            const found = this._inputVariables.find(v => v.name === name);
            return found ? (found.value ?? null) : null;
        };
        this.refreshIntervalSeconds = get('refreshIntervalSeconds') ?? 30;
        this.maxAppointmentsShown   = get('maxAppointmentsShown')   ?? 50;
    }

    _emit(name, value) {
        this.dispatchEvent(new CustomEvent('valuechange', {
            bubbles: true,
            cancelable: false,
            detail: { name, newValue: String(value), newValueDataType: 'String' }
        }));
    }

    handleRefreshIntervalChange(event) {
        this.refreshIntervalSeconds = parseInt(event.detail.value, 10) || 30;
        this._emit('refreshIntervalSeconds', this.refreshIntervalSeconds);
    }

    handleMaxAppointmentsChange(event) {
        this.maxAppointmentsShown = parseInt(event.detail.value, 10) || 50;
        this._emit('maxAppointmentsShown', this.maxAppointmentsShown);
    }
}
