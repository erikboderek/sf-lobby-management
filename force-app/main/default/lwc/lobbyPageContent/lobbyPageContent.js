import { LightningElement, api, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { subscribe, unsubscribe, isEmpEnabled } from 'lightning/empApi';
import { invokeQuickAction } from 'lightning/uiActionsApi';
import getServiceTerritories from '@salesforce/apex/LobbyManagementController.getServiceTerritories';
import getAppointmentsByTerritory from '@salesforce/apex/LobbyManagementController.getAppointmentsByTerritory';
import getWaitlistParticipants from '@salesforce/apex/LobbyManagementController.getWaitlistParticipants';
import checkInAppointment from '@salesforce/apex/LobbyManagementController.checkInAppointment';
import getReferencedObjectName from '@salesforce/apex/LobbyManagementController.getReferencedObjectName';
import getWlReferencedObjectName from '@salesforce/apex/LobbyManagementController.getWlReferencedObjectName';
import getMetrics from '@salesforce/apex/LobbyManagementController.getMetrics';
import getConfig from '@salesforce/apex/LobbyConfigController.getConfig';
import getAppointmentEwt from '@salesforce/apex/LobbyEwtController.getAppointmentEwt';
import getWaitlistEwt    from '@salesforce/apex/LobbyEwtController.getWaitlistEwt';
import rescheduleAppointment from '@salesforce/apex/LobbyManagementController.rescheduleAppointment';
import markNoShow from '@salesforce/apex/LobbyManagementController.markNoShow';
import getResourcesForTerritory from '@salesforce/apex/LobbyManagementController.getResourcesForTerritory';
import reassignServiceResource from '@salesforce/apex/LobbyManagementController.reassignServiceResource';
import getAvailableSlots from '@salesforce/apex/LobbyManagementController.getAvailableSlots';
import markWaitlistNoShow from '@salesforce/apex/LobbyManagementController.markWaitlistNoShow';
import removeWaitlistResource from '@salesforce/apex/LobbyManagementController.removeWaitlistResource';

const EMP_CHANNEL = '/event/ServiceAppointmentEvent';

const STATUS_COLOR_MAP = {
    Scheduled:         'warning',
    'In Progress':     'success',
    Checked_In:        'success',
    Completed:         'success-muted',
    'Cannot Complete': 'error',
    'No-Show':         'error'
};

function parseCommaSeparated(str) {
    if (!str || typeof str !== 'string') return [];
    return str.split(',').map(s => s.trim()).filter(Boolean);
}

const SA_DEFAULT_ACTIONS = [
    { value: '__reschedule__', label: 'Reschedule' },
    { value: '__noshow__',     label: 'Mark as No-Show' },
    { value: '__reassign__',   label: 'Reassign Service Resource' }
];

const WL_DEFAULT_ACTIONS = [
    { value: '__wl_first__',     label: 'Move to First in Waitlist' },
    { value: '__wl_last__',      label: 'Move to Last in Waitlist' },
    { value: '__wl_noshow__',    label: 'Mark as No-Show' },
    { value: '__wl_removeres__', label: 'Remove Service Resource' }
];

function formatFieldValue(val) {
    if (val === null || val === undefined || val === '') return null;
    if (typeof val === 'object') {
        const parts = ['street', 'city', 'state', 'postalCode', 'country']
            .map(k => val[k]).filter(Boolean);
        return parts.length > 0 ? parts.join(', ') : null;
    }
    if (typeof val === 'boolean') return val ? 'Yes' : 'No';
    return String(val);
}

export default class LobbyPageContent extends NavigationMixin(LightningElement) {

    // ─── Public API ───────────────────────────────────────────────────────────
    // All config is managed in the Lobby Config app (CMT).
    // Only pageTitle is actively used — all others are deprecated stubs retained
    // to avoid platform errors on existing live pages.

    @api pageTitle = 'Lobby Management';

    // ─── CMT Config Wire ──────────────────────────────────────────────────────

    _config = null;

    @wire(getConfig)
    wiredConfig({ data, error }) {
        if (data) {
            this._config = data;
            this.metricsVisible = this._showMetricsByDefault;
            this._resolveTargetObject();
            this._resolveWlTargetObject();
            // Re-load data now that config is available so metrics are populated on first render.
            // The territories wire fires first and calls loadData() before _config is set,
            // meaning _enableMetrics was false and getMetrics() was skipped.
            // FIX 1: pass force=true so the isLoading lock set by wiredTerritories doesn't
            // block this second call and leave the spinner running indefinitely.
            if (this.selectedTerritoryId) {
                this.loadData(true);
            }
        }
        if (error) {
            this._showToast('Config Warning',
                'Could not load lobby configuration. Using defaults.', 'warning');
        }
    }

    // Config accessors — read from CMT with safe fallbacks.
    get _targetLookupField()         { return this._config?.Target_Lookup_Field__c         ?? 'Case__c'; }
    get _wlTargetLookupField()       { return this._config?.WL_Target_Lookup_Field__c      ?? null; }
    get _waitlistCheckinFlowApiName() { return this._config?.Waitlist_Checkin_Flow__c       ?? null; }
    get _saCustomActions()           { return parseCommaSeparated(this._config?.SA_Custom_Actions__c); }
    get _saDefaultHiddenActions()    { return parseCommaSeparated(this._config?.SA_Hidden_Default_Actions__c); }
    get _wlCustomActions()           { return parseCommaSeparated(this._config?.WL_Custom_Actions__c); }
    get _wlDefaultHiddenActions()    { return parseCommaSeparated(this._config?.WL_Hidden_Default_Actions__c); }
    get _appointmentFields()         { return parseCommaSeparated(this._config?.Appointment_Fields__c); }
    get _waitlistFields()            { return parseCommaSeparated(this._config?.Waitlist_Fields__c); }
    get _enableMetrics()             { return this._config?.Enable_Metrics__c ?? false; }
    get _metricSlots() {
        if (!this._enableMetrics) return [];
        // Migrate stale KPI keys from prior config versions
        const KPI_KEY_MAP = { avg_wait: 'avg_queue_wait' };
        const slots = [];
        for (let i = 1; i <= 6; i++) {
            let kpi     = this._config?.[`Metric_${i}_KPI__c`];
            let display = this._config?.[`Metric_${i}_Display__c`] ?? 'number';
            if (!kpi) continue;
            kpi = KPI_KEY_MAP[kpi] ?? kpi;
            // Migrate removed display types (line was removed)
            if (display === 'line') display = 'number';
            slots.push({ kpi, display, index: i });
        }
        return slots;
    }
    get _refreshIntervalMs() {
        const val = this._config?.Refresh_Interval__c ?? 30;
        return Math.max(10, val) * 1000;
    }
    get _maxAppointments() {
        return this._config?.Max_Appointments__c ?? 50;
    }
    get _useCustomStatusMapping() { return this._config?.Use_Custom_Status_Mapping__c ?? false; }
    get _currentStatuses()        { return parseCommaSeparated(this._config?.Current_Statuses__c); }
    get _upcomingStatuses()       { return parseCommaSeparated(this._config?.Upcoming_Statuses__c); }
    get _pastStatuses()           { return parseCommaSeparated(this._config?.Past_Statuses__c); }
    get _missedStatuses()         { return parseCommaSeparated(this._config?.Missed_Statuses__c); }
    get _metricsBorderColor()       { return this._config?.Metrics_Border_Color__c || null; }
    get _showMetricsByDefault()     { return this._config?.Show_Metrics_By_Default__c ?? true; }
    get _checkInMethod()            { return this._config?.Check_In_Method__c ?? 'Custom LWC'; }
    get _selectedTerritoryName()    {
        const t = this.territories.find(t => t.value === this.selectedTerritoryId);
        return t ? t.label : '';
    }

    // ─── Reactive State ───────────────────────────────────────────────────────

    @track territories = [];
    @track appointments = [];
    @track waitlist = [];
    @track isLoading = false;
    @track lastUpdated = '';
    @track cardLoadingMap = {};
    @track cardErrorMap = {};
    @track apptError = null;
    @track waitlistError = null;

    @track showFlowModal = false;
    @track flowModalApiName = null;
    @track flowInputVariables = [];
    @track modalFlowError = null;

    @track showWalkInModal = false;

    // ── Reschedule modal ──
    @track showRescheduleModal = false;
    @track _rescheduleApptId = null;
    @track _rescheduleSlots = [];
    @track _rescheduleSlotsLoading = false;
    @track _rescheduleError = null;
    @track _rescheduleSelectedStart = null;
    @track _rescheduleSelectedEnd = null;
    @track _rescheduleSaving = false;

    // ── No Show modal ──
    @track showNoShowModal = false;
    @track _noShowApptId = null;
    @track _noShowNote = '';
    @track _noShowSaving = false;
    @track _noShowError = null;

    // ── Reassign modal ──
    @track showReassignModal = false;
    @track _reassignApptId = null;
    @track _reassignResources = [];
    @track _reassignResourcesLoading = false;
    @track _reassignSelectedId = null;
    @track _reassignSaving = false;
    @track _reassignError = null;

    // ── Waitlist client-side sort — keyed by territoryId ──
    _wlSortMap = {};   // { [territoryId]: [wpId, ...] }

    @track openDropdownId = null;
    @track metricsVisible = true;
    @track metricsData = [];
    @track metricsCarouselIndex = 0;
    @track ewtMap = {};
    @track wlEwtMap = {};

    // ─── Private Fields ───────────────────────────────────────────────────────

    selectedTerritoryId = null;
    _subscription = null;
    _pollingInterval = null;
    _targetObjectApiName = 'Case';
    _wlTargetObjectApiName = null;
    _hasLoadedOnce = false;
    _metricsLoaded = false;
    defaultActiveSections = ['current', 'upcoming'];

    // ─── Wire: territories ────────────────────────────────────────────────────

    @wire(getServiceTerritories)
    wiredTerritories({ data, error }) {
        if (data) {
            this.territories = data.map(t => ({ label: t.Name, value: t.Id }));
            if (!this.selectedTerritoryId && this.territories.length > 0) {
                this.selectedTerritoryId = this.territories[0].value;
                this.loadData();
            }
        } else if (error) {
            this._showToast('Error loading territories', this._errorMessage(error), 'error');
        }
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    connectedCallback() {
        this._subscribeToEmpApi();
    }

    disconnectedCallback() {
        if (this._subscription) {
            unsubscribe(this._subscription, () => {});
            this._subscription = null;
        }
        if (this._pollingInterval) {
            clearInterval(this._pollingInterval);
            this._pollingInterval = null;
        }
    }

    // ─── Event Handlers ───────────────────────────────────────────────────────

    handleManualRefresh() {
        this.loadData();
    }

    handleTerritoryChange(event) {
        this.selectedTerritoryId = event.detail.value;
        this.cardLoadingMap = {};
        this.cardErrorMap   = {};
        this.metricsCarouselIndex = 0;
        this.loadData();
    }

    handleMetricsToggle() {
        this.metricsVisible = !this.metricsVisible;
    }

    handleCarouselPrev() {
        const len = this._enableMetrics ? this._metricSlots.length : 0;
        if (len <= 3) return;
        this.metricsCarouselIndex = (this.metricsCarouselIndex - 1 + len) % len;
    }

    handleCarouselNext() {
        const len = this._enableMetrics ? this._metricSlots.length : 0;
        if (len <= 3) return;
        this.metricsCarouselIndex = (this.metricsCarouselIndex + 1) % len;
    }

    handleCarouselDot(event) {
        this.metricsCarouselIndex = parseInt(event.currentTarget.dataset.index, 10);
    }

    handleCardClick(event) {
        if (event.target.closest('button, lightning-button')) return;
        const { id, targetId } = event.currentTarget.dataset;
        this.openDropdownId = null;
        this._navigateToRecord(targetId, this._targetObjectApiName, id, 'ServiceAppointment');
    }

    handleCardKeydown(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.handleCardClick(event);
        }
    }

    handleWaitlistCardClick(event) {
        if (event.target.closest('button, lightning-button')) return;
        const { id, targetId } = event.currentTarget.dataset;
        if (!id) return;
        if (targetId && this._wlTargetObjectApiName) {
            this._navigateToRecord(targetId, this._wlTargetObjectApiName, id, 'WaitlistParticipant');
        } else {
            this[NavigationMixin.Navigate]({
                type: 'standard__recordPage',
                attributes: { recordId: id, objectApiName: 'WaitlistParticipant', actionName: 'view' }
            });
        }
    }

    handleWaitlistCardKeydown(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.handleWaitlistCardClick(event);
        }
    }

    async handleCheckIn(event) {
        event.stopPropagation();
        const apptId = event.currentTarget.dataset.id;
        if (!apptId) return;

        this.cardLoadingMap = { ...this.cardLoadingMap, [apptId]: true };
        this.cardErrorMap   = { ...this.cardErrorMap,   [apptId]: null };

        try {
            await checkInAppointment({ appointmentId: apptId });
            this._showToast('Checked In', 'Appointment checked in successfully.', 'success');
            await this.loadData(true);
        } catch (error) {
            this.cardErrorMap = { ...this.cardErrorMap, [apptId]: this._errorMessage(error) };
        } finally {
            this.cardLoadingMap = { ...this.cardLoadingMap, [apptId]: false };
        }
    }

    handleDropdownToggle(event) {
        event.stopPropagation();
        event.preventDefault();
        const id = event.currentTarget.dataset.id;
        this.openDropdownId = this.openDropdownId === id ? null : id;
    }

    handleDropdownAction(event) {
        event.stopPropagation();
        event.preventDefault();
        const { id, action } = event.currentTarget.dataset;
        this.openDropdownId = null;
        if (!action || !id) return;
        if (action.startsWith('__')) {
            this._handleBuiltInAction(action, id);
            return;
        }
        invokeQuickAction({ apiName: action, recordId: id })
            .then(() => this.loadData(true))
            .catch(err => {
                this._showToast('Action Failed', this._errorMessage(err), 'error');
            });
    }

    _handleBuiltInAction(action, recordId) {
        switch (action) {
            case '__reschedule__':   this._openRescheduleModal(recordId);  break;
            case '__noshow__':       this._openNoShowModal(recordId);       break;
            case '__reassign__':     this._openReassignModal(recordId);     break;
            case '__wl_first__':     this._moveWlFirst(recordId);           break;
            case '__wl_last__':      this._moveWlLast(recordId);            break;
            case '__wl_noshow__':    this._doWlNoShow(recordId);            break;
            case '__wl_removeres__': this._doWlRemoveResource(recordId);    break;
            default: break;
        }
    }

    // ── Reschedule ────────────────────────────────────────────────────────────

    async _openRescheduleModal(apptId) {
        this._rescheduleApptId = apptId;
        this._rescheduleSelectedStart = null;
        this._rescheduleSelectedEnd   = null;
        this._rescheduleError         = null;
        this._rescheduleSlotsLoading  = true;
        this.showRescheduleModal      = true;
        try {
            const slots = await getAvailableSlots({ territoryId: this.selectedTerritoryId, appointmentId: apptId });
            this._rescheduleSlots = slots.map(s => ({ ...s, selected: false, key: s.startIso }));
        } catch (e) {
            this._rescheduleError = this._errorMessage(e);
        } finally {
            this._rescheduleSlotsLoading = false;
        }
    }

    handleRescheduleSlotSelect(event) {
        const { start, end } = event.currentTarget.dataset;
        this._rescheduleSelectedStart = start;
        this._rescheduleSelectedEnd   = end;
        this._rescheduleSlots = this._rescheduleSlots.map(s => ({ ...s, selected: s.startIso === start }));
    }

    async handleRescheduleConfirm() {
        if (!this._rescheduleSelectedStart) return;
        this._rescheduleSaving = true;
        this._rescheduleError  = null;
        try {
            await rescheduleAppointment({
                appointmentId: this._rescheduleApptId,
                newStartTime:  this._rescheduleSelectedStart,
                newEndTime:    this._rescheduleSelectedEnd
            });
            this._showToast('Rescheduled', 'Appointment rescheduled successfully.', 'success');
            this.showRescheduleModal = false;
            await this.loadData(true);
        } catch (e) {
            this._rescheduleError = this._errorMessage(e);
        } finally {
            this._rescheduleSaving = false;
        }
    }

    handleRescheduleClose() {
        this.showRescheduleModal = false;
    }

    get rescheduleConfirmDisabled() {
        return !this._rescheduleSelectedStart || this._rescheduleSaving;
    }

    // ── No Show ───────────────────────────────────────────────────────────────

    _openNoShowModal(apptId) {
        this._noShowApptId = apptId;
        this._noShowNote   = '';
        this._noShowError  = null;
        this.showNoShowModal = true;
    }

    handleNoShowNoteChange(event) {
        this._noShowNote = event.target.value;
    }

    async handleNoShowConfirm() {
        this._noShowSaving = true;
        this._noShowError  = null;
        try {
            await markNoShow({ appointmentId: this._noShowApptId, serviceNote: this._noShowNote });
            this._showToast('No Show', 'Appointment marked as No Show.', 'success');
            this.showNoShowModal = false;
            await this.loadData(true);
        } catch (e) {
            this._noShowError = this._errorMessage(e);
        } finally {
            this._noShowSaving = false;
        }
    }

    handleNoShowClose() {
        this.showNoShowModal = false;
    }

    // ── Reassign ──────────────────────────────────────────────────────────────

    async _openReassignModal(apptId) {
        this._reassignApptId      = apptId;
        this._reassignSelectedId  = null;
        this._reassignError       = null;
        this._reassignResourcesLoading = true;
        this.showReassignModal    = true;
        try {
            const resources = await getResourcesForTerritory({ territoryId: this.selectedTerritoryId });
            this._reassignResources = resources.map(r => ({ label: r.name, value: r.id }));
        } catch (e) {
            this._reassignError = this._errorMessage(e);
        } finally {
            this._reassignResourcesLoading = false;
        }
    }

    handleReassignResourceChange(event) {
        this._reassignSelectedId = event.detail.value;
    }

    async handleReassignConfirm() {
        this._reassignSaving = true;
        this._reassignError  = null;
        try {
            await reassignServiceResource({
                appointmentId:     this._reassignApptId,
                serviceResourceId: this._reassignSelectedId
            });
            this._showToast('Reassigned', 'Service resource updated.', 'success');
            this.showReassignModal = false;
            await this.loadData(true);
        } catch (e) {
            this._reassignError = this._errorMessage(e);
        } finally {
            this._reassignSaving = false;
        }
    }

    handleReassignClose() {
        this.showReassignModal = false;
    }

    get reassignConfirmDisabled() {
        return !this._reassignSelectedId || this._reassignSaving;
    }

    // ── Waitlist Sort ─────────────────────────────────────────────────────────

    _moveWlFirst(participantId) {
        const ids = this._effectiveWlIds();
        const without = ids.filter(id => id !== participantId);
        this._wlSortMap = { ...this._wlSortMap, [this.selectedTerritoryId]: [participantId, ...without] };
    }

    _moveWlLast(participantId) {
        const ids = this._effectiveWlIds();
        const without = ids.filter(id => id !== participantId);
        this._wlSortMap = { ...this._wlSortMap, [this.selectedTerritoryId]: [...without, participantId] };
    }

    _effectiveWlIds() {
        const override = this._wlSortMap[this.selectedTerritoryId];
        if (override && override.length > 0) return [...override];
        return this.waitlist.map(w => w.Id);
    }

    // ── Waitlist No Show ──────────────────────────────────────────────────────

    async _doWlNoShow(participantId) {
        this.cardLoadingMap = { ...this.cardLoadingMap, [participantId]: true };
        try {
            await markWaitlistNoShow({ participantId });
            this._showToast('No Show', 'Walk-in marked as No Show.', 'success');
            await this.loadData(true);
        } catch (e) {
            this.cardErrorMap = { ...this.cardErrorMap, [participantId]: this._errorMessage(e) };
        } finally {
            this.cardLoadingMap = { ...this.cardLoadingMap, [participantId]: false };
        }
    }

    // ── Waitlist Remove Resource ──────────────────────────────────────────────

    async _doWlRemoveResource(participantId) {
        this.cardLoadingMap = { ...this.cardLoadingMap, [participantId]: true };
        try {
            await removeWaitlistResource({ participantId });
            this._showToast('Resource Removed', 'Service resource unassigned.', 'success');
            await this.loadData(true);
        } catch (e) {
            this.cardErrorMap = { ...this.cardErrorMap, [participantId]: this._errorMessage(e) };
        } finally {
            this.cardLoadingMap = { ...this.cardLoadingMap, [participantId]: false };
        }
    }

    handleWaitlistCheckin(event) {
        event.stopPropagation();
        const participantId = event.currentTarget.dataset.id;
        if (!participantId) return;
        if (!this._waitlistCheckinFlowApiName) {
            this._showToast('Configuration Required',
                'Set the Waitlist Check-In Flow in the Lobby Config app.', 'error');
            return;
        }
        this._openFlowModal(this._waitlistCheckinFlowApiName, participantId);
    }

    handleGlobalWaitlistCheckin(event) {
        event.stopPropagation();
        if (this._checkInMethod === 'Custom LWC') {
            this.showWalkInModal = true;
            return;
        }
        // Flow method
        if (!this._waitlistCheckinFlowApiName) {
            this._showToast('Configuration Required',
                'Set the Waitlist Check-In Flow in the Lobby Config app.', 'error');
            return;
        }
        const territory = this.territories.find(t => t.value === this.selectedTerritoryId);
        const territoryName = territory ? territory.label : '';
        this.flowModalApiName   = this._waitlistCheckinFlowApiName;
        this.flowInputVariables = [
            { name: 'serviceTerritoryId',   type: 'String', value: this.selectedTerritoryId },
            { name: 'serviceTerritoryName', type: 'String', value: territoryName }
        ];
        this.modalFlowError  = null;
        this.showFlowModal   = true;
        Promise.resolve().then(() => this.template.querySelector('.slds-modal')?.focus());
    }

    handleWalkInClose() {
        this.showWalkInModal = false;
        this.loadData(true);
    }

    // ─── Flow Modal ───────────────────────────────────────────────────────────

    _openFlowModal(flowApiName, recordId) {
        this.flowModalApiName   = flowApiName;
        this.flowInputVariables = [{ name: 'recordId', type: 'String', value: recordId }];
        this.modalFlowError     = null;
        this.showFlowModal      = true;
        Promise.resolve().then(() => this.template.querySelector('.slds-modal')?.focus());
    }

    handleFlowStatusChange(event) {
        const { status } = event.detail;
        if (status === 'FINISHED' || status === 'FINISHED_SCREEN') {
            this.showFlowModal      = false;
            this.flowModalApiName   = null;
            this.flowInputVariables = [];
            this.modalFlowError     = null;
            this.loadData(true);
        } else if (status === 'ERROR') {
            this.modalFlowError = 'The flow encountered an error. Please try again.';
        }
    }

    closeFlowModal() {
        this.showFlowModal      = false;
        this.flowModalApiName   = null;
        this.flowInputVariables = [];
        this.modalFlowError     = null;
    }

    // ─── Data Loading ─────────────────────────────────────────────────────────

    async loadData(force = false) {
        if ((!force && this.isLoading) || !this.selectedTerritoryId) return;

        if (force || !this._hasLoadedOnce) {
            this.isLoading = true;
        }
        this.apptError     = null;
        this.waitlistError = null;

        const apptExtraFields = [...this._appointmentFields];
        const tlf = this._targetLookupField;
        if (tlf && !apptExtraFields.map(f => f.toLowerCase()).includes(tlf.toLowerCase())) {
            apptExtraFields.push(tlf);
        }

        const [apptResult, wlResult, metricsResult] = await Promise.allSettled([
            getAppointmentsByTerritory({
                territoryId: this.selectedTerritoryId,
                fields: apptExtraFields
            }),
            getWaitlistParticipants({
                territoryId: this.selectedTerritoryId,
                fields: this._waitlistFields
            }),
            this._enableMetrics
                ? getMetrics({ territoryId: this.selectedTerritoryId })
                : Promise.resolve(null)
        ]);

        if (apptResult.status === 'fulfilled') {
            this.appointments = apptResult.value ?? [];
        } else {
            this.apptError = this._errorMessage(apptResult.reason);
        }

        if (wlResult.status === 'fulfilled') {
            this.waitlist = wlResult.value ?? [];
        } else {
            this.waitlistError = this._errorMessage(wlResult.reason);
        }

        if (metricsResult.status === 'fulfilled' && metricsResult.value) {
            this.metricsData = metricsResult.value;
            this._metricsLoaded = true;
        }

        this.lastUpdated = new Date().toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });

        this._hasLoadedOnce = true;
        this.isLoading = false;
        this._restartPolling();
        this._loadEwt();
    }

    async _loadEwt() {
        // Two bulk calls replace the previous N+1 per-record imperative calls.
        const apptIds = this.appointments
            .filter(a => a.Status === 'Checked_In' || a.Status === 'In Progress')
            .map(a => a.Id);
        const wlIds = this.waitlist
            .filter(w => w.Status === 'Waiting' || w.Status === 'Unassigned')
            .map(w => w.Id);

        const [apptEwtMap, wlEwtMap] = await Promise.all([
            apptIds.length > 0
                ? getAppointmentEwt({ appointmentIds: apptIds }).catch(() => ({}))
                : Promise.resolve({}),
            wlIds.length > 0
                ? getWaitlistEwt({ participantIds: wlIds }).catch(() => ({}))
                : Promise.resolve({})
        ]);

        this.ewtMap   = apptEwtMap  ?? {};
        this.wlEwtMap = wlEwtMap    ?? {};
    }

    _restartPolling() {
        if (this._pollingInterval) clearInterval(this._pollingInterval);
        this._pollingInterval = setInterval(() => this.loadData(), this._refreshIntervalMs);
    }

    _subscribeToEmpApi() {
        isEmpEnabled().then(enabled => {
            if (!enabled) return;
            subscribe(EMP_CHANNEL, -1, () => this.loadData())
                .then(resp => { this._subscription = resp; })
                .catch(() => {});
        }).catch(() => {});
    }

    async _resolveTargetObject() {
        if (!this._targetLookupField) return;
        try {
            const name = await getReferencedObjectName({ lookupFieldApiName: this._targetLookupField });
            this._targetObjectApiName = name ?? 'Case';
        } catch (e) {
            this._targetObjectApiName = 'Case';
        }
    }

    async _resolveWlTargetObject() {
        const f = this._wlTargetLookupField;
        if (!f) { this._wlTargetObjectApiName = null; return; }
        try {
            const name = await getWlReferencedObjectName({ lookupFieldApiName: f });
            this._wlTargetObjectApiName = name ?? null;
        } catch (e) {
            this._wlTargetObjectApiName = null;
        }
    }

    // ─── Computed Getters ─────────────────────────────────────────────────────

    get enrichedAppointments() {
        const max          = this._maxAppointments;
        const customActions = this._saCustomActions;
        const hiddenDefaults = this._saDefaultHiddenActions;
        const extraFieldKeys = this._appointmentFields;
        const timeFmt      = { hour: 'numeric', minute: '2-digit' };
        const menuItems    = [
            ...SA_DEFAULT_ACTIONS.filter(a => !hiddenDefaults.includes(a.value)),
            ...customActions.map(apiName => ({
                label: apiName.includes('.') ? apiName.split('.').pop() : apiName,
                value: apiName
            }))
        ];

        return this.appointments.slice(0, max).map(a => {
            const rec           = Object.assign({}, a);
            const statusColor   = STATUS_COLOR_MAP[rec.StatusCategory] ?? 'neutral';

            rec._workTypeName   = a.WorkType?.Name ?? '';
            rec._displayName    = a.Contact?.Name ?? a.Account?.Name ?? 'Unknown';
            rec._statusColor    = statusColor;
            rec._badgeClass     = `appt-status-badge appt-status-badge--${statusColor}`;

            rec._formattedStart = rec.SchedStartTime
                ? new Date(rec.SchedStartTime).toLocaleTimeString([], timeFmt) : '—';
            rec._formattedEnd   = rec.SchedEndTime
                ? new Date(rec.SchedEndTime).toLocaleTimeString([], timeFmt) : null;
            rec._timeRange      = rec._formattedEnd
                ? `${rec._formattedStart} to ${rec._formattedEnd}` : rec._formattedStart;

            rec._checkinTime    = a.ActualStartTime
                ? new Date(a.ActualStartTime).toLocaleTimeString([], timeFmt) : null;

            // Checked-in: show real elapsed time since ActualStartTime.
            // Otherwise: show scheduled duration as the EWT.
            const ewt = this.ewtMap[rec.Id];
            if (ewt != null) {
                rec._waitMinutes = ewt;
            } else if (rec._isCheckedIn && a.ActualStartTime) {
                rec._waitMinutes = Math.max(0, Math.round(
                    (Date.now() - new Date(a.ActualStartTime)) / 60000));
            } else if (a.SchedStartTime && a.SchedEndTime) {
                rec._waitMinutes = Math.max(0, Math.round(
                    (new Date(a.SchedEndTime) - new Date(a.SchedStartTime)) / 60000));
            } else {
                rec._waitMinutes = null;
            }
            rec._waitDisplay    = rec._waitMinutes != null
                ? this._formatWaitMinutes(rec._waitMinutes)
                : null;

            const ACTIVE_STATUSES   = ['In Progress', 'Checked_In'];
            const COMPLETE_STATUSES = ['Completed', 'Cannot Complete', 'No-Show'];
            rec._isCheckedIn    = ACTIVE_STATUSES.includes(rec.StatusCategory) || ACTIVE_STATUSES.includes(rec.Status);
            rec._isComplete     = COMPLETE_STATUSES.includes(rec.StatusCategory) || COMPLETE_STATUSES.includes(rec.Status);
            rec._showCheckin    = !rec._isCheckedIn && !rec._isComplete;
            rec._isLoading      = !!this.cardLoadingMap[rec.Id];
            rec._error          = this.cardErrorMap[rec.Id] ?? null;
            rec._extraFields    = this._extractExtraFields(a, extraFieldKeys);
            rec._hasExtraFields = rec._extraFields.length > 0;
            rec._targetId       = a[this._targetLookupField] ?? null;
            rec._ariaLabel      = `Appointment for ${rec._displayName}, ${rec._workTypeName}, ${rec._formattedStart}`;
            rec._isDropdownOpen = this.openDropdownId === rec.Id;
            rec._menuItems      = menuItems;
            rec._hasMenu        = menuItems.length > 0;
            rec._displayStatus  = (rec.Status || '').replace(/_/g, ' ');
            return rec;
        });
    }

    get enrichedWaitlist() {
        const extraFieldKeys = (this._waitlistFields || []).filter(
            f => f.toLowerCase() !== 'worktype.name'
        );
        const wlLookup = this._wlTargetLookupField;
        const customActions = this._wlCustomActions;
        const hiddenDefaults = this._wlDefaultHiddenActions;
        const menuItems = [
            ...WL_DEFAULT_ACTIONS.filter(a => !hiddenDefaults.includes(a.value)),
            ...customActions.map(apiName => ({
                label: apiName.includes('.') ? apiName.split('.').pop() : apiName,
                value: apiName
            }))
        ];
        const DEFAULT_HANDLING_MINS = 15;

        // Apply per-territory client-side sort override if set
        let orderedWaitlist = this.waitlist;
        const sortOverride = this._wlSortMap[this.selectedTerritoryId];
        if (sortOverride && sortOverride.length > 0) {
            const wpMap = new Map(this.waitlist.map(w => [w.Id, w]));
            orderedWaitlist = sortOverride
                .filter(id => wpMap.has(id))
                .map(id => wpMap.get(id));
            // Append any newly-arrived items not yet in the override
            for (const w of this.waitlist) {
                if (!sortOverride.includes(w.Id)) orderedWaitlist.push(w);
            }
        }

        return orderedWaitlist.map((w, queueIndex) => {
            const rec = Object.assign({}, w);
            const ewtWl = this.wlEwtMap[w.Id];
            let waitMins;
            if (ewtWl != null) {
                waitMins = ewtWl;
            } else {
                const handlingMins = (w.WorkType?.EstimatedDuration ?? DEFAULT_HANDLING_MINS);
                waitMins = queueIndex * handlingMins;
            }
            rec._waitMinutes    = waitMins;
            rec._showCheckin    = w.Status === 'Waiting' || w.Status === 'Unassigned';
            rec._isLoading      = !!this.cardLoadingMap[w.Id];
            rec._error          = this.cardErrorMap[w.Id] ?? null;
            rec._extraFields    = this._extractExtraFields(w, extraFieldKeys);
            rec._hasExtraFields = rec._extraFields.length > 0;
            rec._targetId       = wlLookup ? (w[wlLookup] ?? null) : null;
            rec._waitDisplay    = waitMins > 0 ? this._formatWaitMinutes(waitMins) : 'Just arrived';
            rec._participantName = w.Participant?.Name ?? null;
            rec._workTypeName   = w.WorkType?.Name ?? '';
            rec._displayStatus  = (w.Status || '').replace(/_/g, ' ');
            rec._ariaLabel      = `Walk-in: ${rec._participantName ?? w.ParticipantIdentifier ?? w.Id}, waiting ${rec._waitDisplay}`;
            rec._isDropdownOpen = this.openDropdownId === w.Id;
            rec._menuItems      = menuItems;
            rec._hasMenu        = menuItems.length > 0;
            return rec;
        });
    }

    get currentAppointmentsEnriched() {
        if (this._useCustomStatusMapping && this._currentStatuses.length > 0) {
            const set = new Set(this._currentStatuses);
            return this.enrichedAppointments.filter(a => set.has(a.Status));
        }
        const ACTIVE = ['In Progress', 'Checked_In'];
        const now = Date.now();
        return this.enrichedAppointments.filter(a =>
            (ACTIVE.includes(a.StatusCategory) || ACTIVE.includes(a.Status)) ||
            (a.StatusCategory === 'Scheduled' && new Date(a.SchedStartTime).getTime() <= now)
        );
    }

    get upcomingAppointmentsEnriched() {
        if (this._useCustomStatusMapping && this._upcomingStatuses.length > 0) {
            const set = new Set(this._upcomingStatuses);
            return this.enrichedAppointments.filter(a => set.has(a.Status));
        }
        const ACTIVE = ['In Progress', 'Checked_In'];
        const now = Date.now();
        return this.enrichedAppointments.filter(a =>
            (a.StatusCategory === 'Scheduled' || a.Status === 'Scheduled') &&
            !ACTIVE.includes(a.StatusCategory) && !ACTIVE.includes(a.Status) &&
            new Date(a.SchedStartTime).getTime() > now
        );
    }

    get pastAppointmentsEnriched() {
        if (this._useCustomStatusMapping && this._pastStatuses.length > 0) {
            const set = new Set(this._pastStatuses);
            return this.enrichedAppointments.filter(a => set.has(a.Status));
        }
        const ACTIVE = ['In Progress', 'Checked_In'];
        const now = Date.now();
        return this.enrichedAppointments.filter(a =>
            !ACTIVE.includes(a.StatusCategory) && !ACTIVE.includes(a.Status) &&
            new Date(a.SchedStartTime).getTime() < now
        );
    }

    get missedAppointmentsEnriched() {
        if (!this._useCustomStatusMapping || this._missedStatuses.length === 0) return [];
        const set = new Set(this._missedStatuses);
        return this.enrichedAppointments.filter(a => set.has(a.Status));
    }

    get showMissedSection() { return this._useCustomStatusMapping && this._missedStatuses.length > 0; }

    get currentSectionLabel()  { return `Current (${this.currentAppointmentsEnriched.length})`; }
    get upcomingSectionLabel() { return `Upcoming (${this.upcomingAppointmentsEnriched.length})`; }
    get pastSectionLabel()     { return `Past (${this.pastAppointmentsEnriched.length})`; }
    get missedSectionLabel()   { return `Missed (${this.missedAppointmentsEnriched.length})`; }
    get waitlistCount()        { return this.waitlist.length; }

    get hasAppointments()           { return this.appointments.length > 0; }
    get hasNoCurrentAppointments()  { return this.currentAppointmentsEnriched.length === 0; }
    get hasNoUpcomingAppointments() { return this.upcomingAppointmentsEnriched.length === 0; }
    get hasNoPastAppointments()     { return this.pastAppointmentsEnriched.length === 0; }
    get hasNoMissedAppointments()   { return this.missedAppointmentsEnriched.length === 0; }
    get hasNoTerritories()  { return this.territories.length === 0 && !this.isLoading; }
    get hasNoAppointments() { return this.appointments.length === 0 && !this.isLoading && !this.apptError; }
    get hasNoWaitlist()     { return this.waitlist.length === 0 && !this.isLoading && !this.waitlistError; }

    get showMetricsStrip()    { return this._enableMetrics && this._metricSlots.length > 0; }
    get showMetrics()         { return this.showMetricsStrip && this.metricsVisible && this._metricsLoaded; }
    get showMetricsLoading()  { return this.showMetricsStrip && this.metricsVisible && !this._metricsLoaded; }
    get metricsToggleLabel()  { return this.metricsVisible ? 'Hide Metrics' : 'Show Metrics'; }
    get metricsToggleIcon()   { return this.metricsVisible ? 'utility:hide' : 'utility:metrics'; }

    _resolveMetricColor(val, rangesJson) {
        if (!rangesJson) return null;
        try {
            const ranges = JSON.parse(rangesJson);
            if (!Array.isArray(ranges) || ranges.length === 0) return null;
            // Ranges are ordered low-to-high threshold; last matching wins
            let color = null;
            for (const r of ranges) {
                const threshold = Number(r.threshold);
                if (!isNaN(threshold) && val >= threshold && r.color) {
                    color = r.color;
                }
            }
            return color;
        } catch (_) {
            return null;
        }
    }

    _buildMetricCard(slot) {
        const raw = this.metricsData[slot.kpi];
        const rangesJson = this._config?.[`Metric_${slot.index}_Ranges__c`] ?? null;
        const borderColor = this._metricsBorderColor;
        if (raw == null) {
            const cardStyle = borderColor ? `border-top-color:${borderColor}` : '';
            return {
                label: slot.kpi, value: '—', context: '', unit: '', display: slot.display, kpi: slot.kpi,
                isNumber: true, isPercentage: false, isBar: false, isPie: false, isLine: false, isGauge: false,
                pct: 0, barWidthStyle: 'width:0%', gaugeDash: '0 251.3',
                piePath: 'M50,50 L50,10 A40,40 0 0,1 50.01,10 Z',
                linePoints: '0,40 100,40', lineAreaPoints: '0,40 100,40 100,40 0,40',
                cardStyle, valueColorStyle: ''
            };
        }
        const val  = Number(raw.value ?? 0);
        const pct  = Math.min(100, Math.max(0, val));
        const disp = slot.display;

        let displayValue;
        if (disp === 'percentage') displayValue = `${Math.round(val)}%`;
        else displayValue = raw.unit ? `${val}${raw.unit}` : String(val);

        const circ   = 2 * Math.PI * 40;
        const filled = (pct / 100) * circ;
        const gaugeDash = `${filled.toFixed(1)} ${(circ - filled).toFixed(1)}`;

        const rad = ((pct / 100) * 360 - 90) * (Math.PI / 180);
        const px  = 50 + 40 * Math.cos(rad);
        const py  = 50 + 40 * Math.sin(rad);
        const largeArc = pct > 50 ? 1 : 0;
        const piePath  = pct >= 100
            ? 'M50,50 m-40,0 a40,40 0 1,1 80,0 a40,40 0 1,1 -80,0'
            : (pct === 0
                ? 'M50,50 L50,10 A40,40 0 0,1 50.01,10 Z'
                : `M50,50 L50,10 A40,40 0 ${largeArc},1 ${px.toFixed(2)},${py.toFixed(2)} Z`);

        const barWidthStyle  = `width:${pct}%`;
        const linePoints     = '0,30 25,22 50,28 75,10 100,18';
        const lineAreaPoints = '0,30 25,22 50,28 75,10 100,18 100,40 0,40';

        const resolvedColor   = this._resolveMetricColor(val, rangesJson);
        const cardStyle       = borderColor   ? `border-top-color:${borderColor}` : '';
        const valueColorStyle = resolvedColor ? `color:${resolvedColor}` : '';

        return {
            label: raw.label,
            value: displayValue,
            rawValue: val,
            context: raw.context,
            unit: raw.unit ?? '',
            display: disp,
            kpi: slot.kpi,
            pct,
            barWidthStyle,
            gaugeDash,
            piePath,
            linePoints,
            lineAreaPoints,
            cardStyle,
            valueColorStyle,
            isNumber:     disp === 'number',
            isPercentage: disp === 'percentage',
            isBar:        disp === 'bar',
            isPie:        disp === 'pie',
            isLine:       disp === 'line',
            isGauge:      disp === 'gauge'
        };
    }

    get currentMetricCards() {
        const slots = this._metricSlots;
        if (!slots.length) return [];
        const len   = slots.length;
        const count = Math.min(3, len);
        const cards = [];
        for (let i = 0; i < count; i++) {
            const slot = slots[(this.metricsCarouselIndex + i) % len];
            cards.push({ ...this._buildMetricCard(slot), _key: slot.kpi + '_' + i });
        }
        return cards;
    }

    get currentMetricCard() {
        const cards = this.currentMetricCards;
        return cards.length > 0 ? cards[0] : null;
    }

    get carouselDots() {
        const len = this._metricSlots.length;
        if (len <= 3) return [];
        return this._metricSlots.map((s, i) => ({
            index: i,
            isActive: i === this.metricsCarouselIndex,
            dotClass: i === this.metricsCarouselIndex
                ? 'metrics-dot metrics-dot--active'
                : 'metrics-dot'
        }));
    }

    get hasPrevMetric() { return this._metricSlots.length > 3; }
    get hasNextMetric() { return this._metricSlots.length > 3; }
    get hasCarouselDots() { return this._metricSlots.length > 3; }

    get hasReassignResources() { return this._reassignResources.length > 0; }

    get rescheduleSlotOptions() {
        return this._rescheduleSlots.map(s => ({
            ...s,
            slotClass: s.selected
                ? 'action-slot action-slot--selected'
                : 'action-slot'
        }));
    }
    get rescheduleHasSlots()    { return this._rescheduleSlots.length > 0; }

    // ─── Private Helpers ──────────────────────────────────────────────────────

    _formatWaitMinutes(mins) {
        if (mins >= 60) {
            const h = Math.floor(mins / 60);
            const m = mins % 60;
            return m > 0 ? `${h}h ${m}m` : `${h}h`;
        }
        return `${mins} min`;
    }

    _extractExtraFields(record, fields) {
        if (!Array.isArray(fields) || fields.length === 0) return [];
        return fields
            .map(f => {
                // Dotted traversal: Contact.Name → record.Contact?.Name
                let val;
                if (f.includes('.')) {
                    const parts = f.split('.');
                    val = record;
                    for (const part of parts) {
                        val = val?.[part];
                        if (val === undefined || val === null) break;
                    }
                } else {
                    val = record[f];
                }
                return { label: f, value: formatFieldValue(val) };
            })
            .filter(p => p.value !== null);
    }

    _navigateToRecord(targetId, targetApiName, fallbackId, fallbackApiName) {
        if (targetId && targetApiName) {
            this[NavigationMixin.Navigate]({
                type: 'standard__recordPage',
                attributes: { recordId: targetId, objectApiName: targetApiName, actionName: 'view' }
            });
        } else if (fallbackId) {
            this[NavigationMixin.Navigate]({
                type: 'standard__recordPage',
                attributes: { recordId: fallbackId, objectApiName: fallbackApiName, actionName: 'view' }
            });
        }
    }

    _errorMessage(error) {
        return error?.body?.message ?? error?.message ?? 'An unexpected error occurred.';
    }

    _showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
