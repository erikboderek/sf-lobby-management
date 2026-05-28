import { LightningElement, api } from 'lwc';

export default class LobbyCpeApptFields extends LightningElement {
    @api value;

    handleChange(event) {
        this.dispatchEvent(new CustomEvent('valuechange', {
            bubbles: true,
            composed: true,
            detail: event.detail
        }));
    }
}
