import { LightningElement, api, track } from 'lwc';
import searchContacts         from '@salesforce/apex/WalkInCheckInController.searchContacts';
import getWorkTypesForTerritory from '@salesforce/apex/WalkInCheckInController.getWorkTypesForTerritory';
import checkInWalkIn          from '@salesforce/apex/WalkInCheckInController.checkInWalkIn';

const SCREEN_SEARCH  = 'search';
const SCREEN_DETAILS = 'details';
const SCREEN_SUCCESS = 'success';

const COLUMNS = [
    { label: 'Name',      fieldName: 'name',     type: 'text', wrapText: true },
    { label: 'Birthdate', fieldName: 'birthdate', type: 'text', wrapText: true },
    { label: 'Address',   fieldName: 'address',   type: 'text', wrapText: true }
];

export default class WalkInCheckInModal extends LightningElement {

    @api territoryId      = '';
    @api territoryName    = '';
    @api newContactLabel  = 'Create New Customer';

    // ─── Screen routing ───────────────────────────────────────────────────────
    @track _screen = SCREEN_SEARCH;

    get isSearch()  { return this._screen === SCREEN_SEARCH;  }
    get isDetails() { return this._screen === SCREEN_DETAILS; }
    get isSuccess() { return this._screen === SCREEN_SUCCESS; }

    // ─── Screen 1 — Search ────────────────────────────────────────────────────
    @track _searchTerm    = '';
    @track _searchResults = [];
    @track _isSearching   = false;
    @track _searchError   = null;
    @track _selectedRowIds = [];
    @track _selectedAccount = null;   // { id, name, birthdate, address }
    @track _isNewParticipant = false;

    get columns()       { return COLUMNS; }
    get hasResults()    { return this._searchResults.length > 0; }
    get noResults()     { return !this._isSearching && this._searchTerm.length >= 2 && this._searchResults.length === 0 && !this._searchError; }
    get nextDisabled()  { return !this._selectedAccount && !this._isNewParticipant; }

    _searchTimer = null;

    handleSearchChange(event) {
        this._searchTerm   = event.target.value;
        this._selectedAccount = null;
        this._selectedRowIds  = [];
        this._isNewParticipant = false;
        clearTimeout(this._searchTimer);
        if (this._searchTerm.length < 2) {
            this._searchResults = [];
            return;
        }
        this._searchTimer = setTimeout(() => this._runSearch(), 400);
    }

    async _runSearch() {
        this._isSearching = true;
        this._searchError = null;
        try {
            const results = await searchContacts({ searchTerm: this._searchTerm });
            this._searchResults = results;
        } catch (e) {
            this._searchError = e?.body?.message ?? e?.message ?? 'Search failed.';
            this._searchResults = [];
        } finally {
            this._isSearching = false;
        }
    }

    handleRowSelection(event) {
        const rows = event.detail.selectedRows;
        if (rows.length > 0) {
            this._selectedAccount  = rows[0];
            this._selectedRowIds   = [rows[0].id];
            this._isNewParticipant = false;
        } else {
            this._selectedAccount  = null;
            this._selectedRowIds   = [];
        }
    }

    handleNewParticipant() {
        this._isNewParticipant = true;
        this._selectedAccount  = null;
        this._selectedRowIds   = [];
        this._screen           = SCREEN_DETAILS;
    }

    disconnectedCallback() {
        clearTimeout(this._searchTimer);
    }

    handleNextFromSearch() {
        if (this.nextDisabled) return;
        if (!this._isNewParticipant) {
            this._firstName  = '';
            this._lastName   = '';
            this._birthdate  = '';
            this._street     = '';
            this._city       = '';
            this._province   = '';
            this._postalCode = '';
        }
        this._screen = SCREEN_DETAILS;
    }

    // ─── Screen 2 — Details ───────────────────────────────────────────────────
    @track _firstName    = '';
    @track _lastName     = '';
    @track _birthdate    = '';
    @track _street       = '';
    @track _city         = '';
    @track _province     = '';
    @track _postalCode   = '';
    @track _workTypeId   = '';
    @track _notes        = '';
    @track _isSaving     = false;
    @track _saveError    = null;
    @track _workTypeOptions = [];
    @track _wtLoading       = false;
    @track _wtError         = null;

    get selectedName()             { return this._selectedAccount ? this._selectedAccount.name : ''; }
    get submitDisabled()           { return this._isSaving || !this._workTypeId || (this._isNewParticipant && (!this._firstName || !this._lastName)); }
    get newParticipantBtnVariant() { return this._isNewParticipant ? 'brand' : 'neutral'; }

    connectedCallback() {
        this._loadWorkTypes();
    }

    async _loadWorkTypes() {
        if (!this.territoryId) return;
        this._wtLoading = true;
        this._wtError   = null;
        try {
            const opts = await getWorkTypesForTerritory({ territoryId: this.territoryId });
            this._workTypeOptions = opts.length > 0
                ? opts
                : [{ label: 'No work types configured', value: '' }];
        } catch (e) {
            this._wtError = e?.body?.message ?? e?.message ?? 'Could not load appointment types.';
        } finally {
            this._wtLoading = false;
        }
    }

    handleFirstNameChange(event)  { this._firstName  = event.target.value; }
    handleLastNameChange(event)   { this._lastName   = event.target.value; }
    handleBirthdateChange(event)  { this._birthdate  = event.target.value; }
    handleAddressChange(event)    {
        this._street     = event.detail.street     ?? '';
        this._city       = event.detail.city       ?? '';
        this._province   = event.detail.province   ?? '';
        this._postalCode = event.detail.postalCode ?? '';
    }
    handleWorkTypeChange(event)   { this._workTypeId = event.detail.value; }
    handleNotesChange(event)      { this._notes      = event.target.value; }

    handleBackToSearch() {
        this._screen    = SCREEN_SEARCH;
        this._saveError = null;
    }

    async handleSubmit() {
        if (!this._reportValidity()) return;
        this._isSaving  = true;
        this._saveError = null;
        try {
            const result = await checkInWalkIn({
                contactId:   this._isNewParticipant ? null               : this._selectedAccount.id,
                firstName:   this._isNewParticipant ? this._firstName    : null,
                lastName:    this._isNewParticipant ? this._lastName     : null,
                birthdate:   this._isNewParticipant ? this._birthdate    : null,
                street:      this._isNewParticipant ? this._street       : null,
                city:        this._isNewParticipant ? this._city         : null,
                province:    this._isNewParticipant ? this._province     : null,
                postalCode:  this._isNewParticipant ? this._postalCode   : null,
                workTypeId:  this._workTypeId,
                notes:       this._notes,
                territoryId: this.territoryId
            });
            if (result.success) {
                this._screen = SCREEN_SUCCESS;
            } else {
                this._saveError = result.errorMessage;
            }
        } catch (e) {
            this._saveError = e?.body?.message ?? e?.message ?? 'Check-in failed. Please try again.';
        } finally {
            this._isSaving = false;
        }
    }

    _reportValidity() {
        const inputs = [
            ...this.template.querySelectorAll('lightning-input'),
            ...this.template.querySelectorAll('lightning-combobox'),
            ...this.template.querySelectorAll('lightning-textarea')
        ];
        let valid = true;
        inputs.forEach(i => {
            if (!i.reportValidity()) valid = false;
        });
        return valid;
    }

    // ─── Screen 3 — Success ───────────────────────────────────────────────────

    handleClose() {
        this.dispatchEvent(new CustomEvent('checkinclose'));
    }
}
