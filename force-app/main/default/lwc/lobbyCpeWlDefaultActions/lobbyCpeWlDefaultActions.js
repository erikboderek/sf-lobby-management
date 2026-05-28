import { LightningElement, api } from 'lwc';

const WL_DEFAULT_OPTIONS = [
    { label: 'Move to first in the waitlist',    value: '__wl_first__' },
    { label: 'Move to last in the waitlist',     value: '__wl_last__' },
    { label: 'Mark as No-Show',                  value: '__wl_noshow__' },
    { label: 'Remove Selected Service Resource', value: '__wl_removeres__' }
];

export default class LobbyCpeWlDefaultActions extends LightningElement {

    @api value;

    options = WL_DEFAULT_OPTIONS;

    get selectedValues() {
        if (!this.value) return [];
        try { return JSON.parse(this.value); } catch (e) { return []; }
    }

    handleChange(event) {
        this.dispatchEvent(new CustomEvent('configurationeditorvaluechange', {
            bubbles: true,
            cancelable: false,
            detail: {
                name: 'wlDefaultHiddenActions',
                newValue: JSON.stringify(event.detail.value),
                newValueDataType: 'String'
            }
        }));
    }
}
