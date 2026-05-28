import { LightningElement, api } from 'lwc';

const SA_DEFAULT_OPTIONS = [
    { label: 'Reschedule',                value: '__reschedule__' },
    { label: 'Mark as No-Show',           value: '__noshow__' },
    { label: 'Reassign Service Resource', value: '__reassign__' }
];

export default class LobbyCpeSaDefaultActions extends LightningElement {

    @api value;

    options = SA_DEFAULT_OPTIONS;

    get selectedValues() {
        if (!this.value) return [];
        try { return JSON.parse(this.value); } catch (e) { return []; }
    }

    handleChange(event) {
        this.dispatchEvent(new CustomEvent('configurationeditorvaluechange', {
            bubbles: true,
            cancelable: false,
            detail: {
                name: 'saDefaultHiddenActions',
                newValue: JSON.stringify(event.detail.value),
                newValueDataType: 'String'
            }
        }));
    }
}
