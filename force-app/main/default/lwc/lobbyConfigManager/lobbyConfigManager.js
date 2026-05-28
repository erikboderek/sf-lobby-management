import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import getActiveFlows from '@salesforce/apex/LobbyFlowAuraAdapter.getActiveFlows';
import getQuickActions from '@salesforce/apex/QuickActionPickerController.getQuickActionsForObject';
import getConfig from '@salesforce/apex/LobbyConfigController.getConfig';
import saveConfig from '@salesforce/apex/LobbyConfigController.saveConfig';

const SA_DEFAULT_ACTIONS = [
    { label: 'Reschedule',                value: '__reschedule__' },
    { label: 'Mark as No-Show',           value: '__noshow__' },
    { label: 'Reassign Service Resource', value: '__reassign__' }
];

const WL_DEFAULT_ACTIONS = [
    { label: 'Move to First in Waitlist', value: '__wl_first__' },
    { label: 'Move to Last in Waitlist',  value: '__wl_last__' },
    { label: 'Mark as No-Show',           value: '__wl_noshow__' },
    { label: 'Remove Service Resource',   value: '__wl_removeres__' }
];

// Traversal / relationship fields that getObjectInfo doesn't expose but are valid SOQL fields.
// These are added to the top of the Available list so admins can select them.
const SA_TRAVERSAL_OPTIONS = [
    { label: 'Contact: Name (Contact.Name)',           value: 'Contact.Name' },
    { label: 'Account: Name (Account.Name)',           value: 'Account.Name' },
    { label: 'Work Type: Name (WorkType.Name)',         value: 'WorkType.Name' },
    { label: 'Appointment Number (AppointmentNumber)', value: 'AppointmentNumber' },
    { label: 'Status (Status)',                        value: 'Status' },
    { label: 'Description (Description)',              value: 'Description' }
];

const WL_TRAVERSAL_OPTIONS = [
    { label: 'Participant Identifier (ParticipantIdentifier)', value: 'ParticipantIdentifier' },
    { label: 'Participant: Name (Participant.Name)',            value: 'Participant.Name' },
    { label: 'Work Type: Name (WorkType.Name)',                 value: 'WorkType.Name' },
    { label: 'Waitlist: Name (Waitlist.Name)',                  value: 'Waitlist.Name' },
    { label: 'Status (Status)',                                 value: 'Status' }
];

// Fields rendered as the primary title/subtitle on every appointment card — always shown,
// never offered in the "Extra Fields" listbox.
const SA_CARD_BASE_FIELDS = new Set(['Contact.Name', 'Account.Name', 'WorkType.Name', 'AppointmentNumber']);

// Fields pre-selected in "Shown on Card" when no saved config exists
const SA_DEFAULT_FIELDS = ['Description'];
const WL_DEFAULT_FIELDS = ['Participant.Name', 'WorkType.Name'];

const KPI_OPTIONS = [
    { label: 'Total Appointments Today',           value: 'total_today' },
    { label: 'Checked In (% of Scheduled)',        value: 'checkin_rate' },
    { label: 'Currently Being Served',             value: 'in_progress' },
    { label: 'Avg Wait Time (minutes)',            value: 'avg_queue_wait' },
    { label: 'No-Show Rate (%)',                   value: 'noshow_rate' },
    { label: 'Completed Appointments',             value: 'completed' },
    { label: 'Remaining (Scheduled, not started)', value: 'remaining' },
    { label: 'Walk-Ins Currently Waiting',         value: 'wl_waiting' },
    { label: 'Throughput (completed last hour)',   value: 'throughput' }
];

const DISPLAY_OPTIONS = [
    { label: 'Number',     value: 'number' },
    { label: 'Percentage', value: 'percentage' },
    { label: 'Bar',        value: 'bar' },
    { label: 'Pie',        value: 'pie' },
    { label: 'Gauge',      value: 'gauge' }
];

// Sample values per KPI used in config-page previews only
const KPI_SAMPLE = {
    total_today:    { value: 42,   label: 'Appointments Today',        context: 'All statuses combined',            unit: '' },
    in_progress:    { value: 6,    label: 'Being Served Now',           context: 'Checked in or in progress',        unit: '' },
    completed:      { value: 28,   label: 'Completed Today',            context: 'Finished appointments',            unit: '' },
    remaining:      { value: 8,    label: 'Remaining Today',            context: 'Scheduled, not yet started',       unit: '' },
    checkin_rate:   { value: 81,   label: 'Check-In Rate',              context: '42 total appointments today',      unit: '%' },
    noshow_rate:    { value: 4.8,  label: 'No-Show Rate',               context: '2 of 42 today',                   unit: '%' },
    throughput:     { value: 11,   label: 'Throughput',                 context: 'Appointments completed last 60 min', unit: '/hr' },
    avg_duration:   { value: 18,   label: 'Avg Appointment Duration',   context: 'Based on scheduled times',         unit: 'min' },
    wl_waiting:     { value: 5,    label: 'Walk-Ins Waiting',           context: 'Currently in queue',               unit: '' },
    avg_queue_wait: { value: 12,   label: 'Avg Queue Wait',             context: 'Minutes for active walk-ins',      unit: 'min' },
    walkin_ratio:   { value: 22,   label: 'Walk-In vs Scheduled',       context: 'Percent of today\'s traffic',      unit: '%' },
    appt_type_top:  { value: 15,   label: 'Real ID Application',        context: '5 service types today',            unit: '' },
    peak_hour:      { value: 9,    label: 'Peak Traffic Hour',           context: 'Busiest hour: 9 AM (9 apts)',      unit: 'apts' }
};

function parseComma(str) {
    if (!str || typeof str !== 'string') return [];
    return str.split(',').map(s => s.trim()).filter(Boolean);
}

function joinComma(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr.join(',');
}

function parseRangesJson(json) {
    if (!json) return [];
    try { return JSON.parse(json); } catch (_) { return []; }
}

const DEFAULT_RANGE_COLORS = ['#F6538A', '#F8933A', '#4992FF'];

export default class LobbyConfigManager extends LightningElement {

    // ─── State ────────────────────────────────────────────────────────────────

    @track isLoading = true;
    @track isSaving = false;
    @track loadError = null;
    @track saveError = null;

    // Form values — Appointment Card
    @track targetLookupField = 'Case__c';
    @track saCustomActions = [];
    @track saDefaultHiddenActions = [];
    @track appointmentFields = [];

    // Form values — Waitlist Card
    @track checkInMethod = 'Custom LWC';
    @track checkinFlow = '';
    @track wlTargetLookupField = '';
    @track wlCustomActions = [];
    @track wlDefaultHiddenActions = [];
    @track waitlistFields = [];

    // Form values — Status Mapping
    @track useCustomStatusMapping = false;
    @track currentStatuses = [];
    @track upcomingStatuses = [];
    @track pastStatuses = [];
    @track missedStatuses = [];

    // Form values — Metric Appearance
    @track showMetricsByDefault = true;
    @track metricsBorderColor = '';
    @track metric1Ranges = [];
    @track metric2Ranges = [];
    @track metric3Ranges = [];
    @track metric4Ranges = [];
    @track metric5Ranges = [];
    @track metric6Ranges = [];

    // Form values — General
    @track refreshInterval = 30;
    @track maxAppointments = 50;
    @track enableMetrics = false;
    @track metric1Kpi = '';
    @track metric1Display = 'number';
    @track metric2Kpi = '';
    @track metric2Display = 'number';
    @track metric3Kpi = '';
    @track metric3Display = 'number';
    @track metric4Kpi = '';
    @track metric4Display = 'number';
    @track metric5Kpi = '';
    @track metric5Display = 'number';
    @track metric6Kpi = '';
    @track metric6Display = 'number';

    // Option lists
    @track flowOptions = [{ label: '-- None --', value: '' }];
    @track flowLoadError = null;
    @track saActionOptions = [];
    @track wlActionOptions = [];
    @track saFieldOptions = [];
    @track saReferenceFieldOptions = [];
    @track wlFieldOptions = [];
    @track wlReferenceFieldOptions = [];
    @track saActionsLoading = false;
    @track saActionsError = null;
    @track wlActionsLoading = false;
    @track wlActionsError = null;

    // ─── Static option lists ──────────────────────────────────────────────────

    get saDefaultActionOptions() { return SA_DEFAULT_ACTIONS; }
    get wlDefaultActionOptions()  { return WL_DEFAULT_ACTIONS; }
    get displayTypeOptions()      { return DISPLAY_OPTIONS; }
    get hasSaActionOptions()      { return !this.saActionsLoading && this.saActionOptions.length > 0; }
    get hasWlActionOptions()      { return !this.wlActionsLoading && this.wlActionOptions.length > 0; }
    get isReady()                 { return !this.isLoading && !this.loadError; }
    get showStatusMappingConfig() { return this.useCustomStatusMapping; }
    get showFlowPickerConfig()    { return this.checkInMethod === 'Flow'; }

    get checkInMethodOptions() {
        return [
            { label: 'Custom LWC (built-in walk-in form)', value: 'Custom LWC' },
            { label: 'Screen Flow (configure below)',       value: 'Flow' }
        ];
    }

    // ─── Filtered Status Getters ─────────────────────────────────────────────

    get _masterStatusOptions() {
        const picklistValues = this._saObjectInfo?.fields?.Status?.picklistValues;
        if (picklistValues?.length > 0) {
            return picklistValues
                .filter(p => p.active)
                .map(p => ({ label: p.label, value: p.value }));
        }
        return [
            { label: 'Scheduled',       value: 'Scheduled' },
            { label: 'Checked In',      value: 'Checked_In' },
            { label: 'In Progress',     value: 'In Progress' },
            { label: 'Completed',       value: 'Completed' },
            { label: 'Cannot Complete', value: 'Cannot Complete' },
            { label: 'Canceled',        value: 'Canceled' },
            { label: 'None',            value: 'None' }
        ];
    }

    get currentStatusOptions() {
        const allocated = [...this.upcomingStatuses, ...this.pastStatuses, ...this.missedStatuses];
        return this._masterStatusOptions.filter(opt => !allocated.includes(opt.value));
    }

    get upcomingStatusOptions() {
        const allocated = [...this.currentStatuses, ...this.pastStatuses, ...this.missedStatuses];
        return this._masterStatusOptions.filter(opt => !allocated.includes(opt.value));
    }

    get pastStatusOptions() {
        const allocated = [...this.currentStatuses, ...this.upcomingStatuses, ...this.missedStatuses];
        return this._masterStatusOptions.filter(opt => !allocated.includes(opt.value));
    }

    get missedStatusOptions() {
        const allocated = [...this.currentStatuses, ...this.upcomingStatuses, ...this.pastStatuses];
        return this._masterStatusOptions.filter(opt => !allocated.includes(opt.value));
    }

    _rangesForSlot(n) {
        return this[`metric${n}Ranges`];
    }
    get hasRangeSlot1() { return this.metric1Kpi !== ''; }
    get hasRangeSlot2() { return this.metric2Kpi !== ''; }
    get hasRangeSlot3() { return this.metric3Kpi !== ''; }
    get hasRangeSlot4() { return this.metric4Kpi !== ''; }
    get hasRangeSlot5() { return this.metric5Kpi !== ''; }
    get hasRangeSlot6() { return this.metric6Kpi !== ''; }
    get rangeRows1() { return this._rangesForSlot(1).map((r, i) => ({ ...r, index: i })); }
    get rangeRows2() { return this._rangesForSlot(2).map((r, i) => ({ ...r, index: i })); }
    get rangeRows3() { return this._rangesForSlot(3).map((r, i) => ({ ...r, index: i })); }
    get rangeRows4() { return this._rangesForSlot(4).map((r, i) => ({ ...r, index: i })); }
    get rangeRows5() { return this._rangesForSlot(5).map((r, i) => ({ ...r, index: i })); }
    get rangeRows6() { return this._rangesForSlot(6).map((r, i) => ({ ...r, index: i })); }
    get canAddRange1() { return this.metric1Ranges.length < 3; }
    get canAddRange2() { return this.metric2Ranges.length < 3; }
    get canAddRange3() { return this.metric3Ranges.length < 3; }
    get canAddRange4() { return this.metric4Ranges.length < 3; }
    get canAddRange5() { return this.metric5Ranges.length < 3; }
    get canAddRange6() { return this.metric6Ranges.length < 3; }

    // KPI options per slot — each excludes values already chosen in other slots
    _kpiOptionsFor(ownValue) {
        const others = [
            this.metric1Kpi, this.metric2Kpi, this.metric3Kpi,
            this.metric4Kpi, this.metric5Kpi, this.metric6Kpi
        ].filter(v => v && v !== ownValue);
        return KPI_OPTIONS.filter(o => !others.includes(o.value));
    }
    get kpiOptions1() { return this._kpiOptionsFor(this.metric1Kpi); }
    get kpiOptions2() { return this._kpiOptionsFor(this.metric2Kpi); }
    get kpiOptions3() { return this._kpiOptionsFor(this.metric3Kpi); }
    get kpiOptions4() { return this._kpiOptionsFor(this.metric4Kpi); }
    get kpiOptions5() { return this._kpiOptionsFor(this.metric5Kpi); }
    get kpiOptions6() { return this._kpiOptionsFor(this.metric6Kpi); }

    // ─── Preview computed getters ─────────────────────────────────────────────

    get apptPreviewFields() {
        return this.appointmentFields.map(apiName => {
            const opt = this.saFieldOptions.find(o => o.value === apiName);
            const label = opt ? opt.label.replace(/\s*\(.*\)$/, '') : apiName;
            return { label, value: '—' };
        });
    }
    get hasApptPreviewFields() { return this.appointmentFields.length > 0; }

    get wlPreviewFields() {
        return this.waitlistFields.map(apiName => {
            const opt = this.wlFieldOptions.find(o => o.value === apiName);
            const label = opt ? opt.label.replace(/\s*\(.*\)$/, '') : apiName;
            return { label, value: '—' };
        });
    }
    get hasWlPreviewFields() { return this.waitlistFields.length > 0; }

    get hasSaCustomActionsSelected() { return this.saCustomActions.length > 0; }
    get hasWlCustomActionsSelected()  { return this.wlCustomActions.length > 0; }

    get saCustomActionsPreview() {
        return this.saCustomActions.map(v => {
            const opt = this.saActionOptions.find(o => o.value === v);
            return opt ? opt.label : v;
        });
    }

    get wlCustomActionsPreview() {
        return this.wlCustomActions.map(v => {
            const opt = this.wlActionOptions.find(o => o.value === v);
            return opt ? opt.label : v;
        });
    }

    get saDefaultVisiblePreview() {
        return SA_DEFAULT_ACTIONS.filter(a => !this.saDefaultHiddenActions.includes(a.value));
    }

    get wlDefaultVisiblePreview() {
        return WL_DEFAULT_ACTIONS.filter(a => !this.wlDefaultHiddenActions.includes(a.value));
    }

    // Track how many KPI slots are visible — user presses "+ Add KPI" to reveal more
    @track numKpiSlots = 1;

    get showMetricSlot1() { return this.numKpiSlots >= 1; }
    get showMetricSlot2() { return this.numKpiSlots >= 2; }
    get showMetricSlot3() { return this.numKpiSlots >= 3; }
    get showMetricSlot4() { return this.numKpiSlots >= 4; }
    get showMetricSlot5() { return this.numKpiSlots >= 5; }
    get showMetricSlot6() { return this.numKpiSlots >= 6; }
    get canAddKpiSlot()   { return this.numKpiSlots < 6; }

    get metricSlots() {
        return [
            { index: 0, num: 1, kpiValue: this.metric1Kpi, displayValue: this.metric1Display, kpiOptionsProp: 'kpiOptions1' },
            { index: 1, num: 2, kpiValue: this.metric2Kpi, displayValue: this.metric2Display, kpiOptionsProp: 'kpiOptions2' },
            { index: 2, num: 3, kpiValue: this.metric3Kpi, displayValue: this.metric3Display, kpiOptionsProp: 'kpiOptions3' },
            { index: 3, num: 4, kpiValue: this.metric4Kpi, displayValue: this.metric4Display, kpiOptionsProp: 'kpiOptions4' },
            { index: 4, num: 5, kpiValue: this.metric5Kpi, displayValue: this.metric5Display, kpiOptionsProp: 'kpiOptions5' },
            { index: 5, num: 6, kpiValue: this.metric6Kpi, displayValue: this.metric6Display, kpiOptionsProp: 'kpiOptions6' }
        ];
    }

    get metricSlots1() { return this.metricSlots.slice(0, 3); }
    get metricSlots2() { return this.metricSlots.slice(3, 6); }

    get metricPreviews() {
        const slots = [
            { num: 1, kpi: this.metric1Kpi, display: this.metric1Display, ranges: this.metric1Ranges },
            { num: 2, kpi: this.metric2Kpi, display: this.metric2Display, ranges: this.metric2Ranges },
            { num: 3, kpi: this.metric3Kpi, display: this.metric3Display, ranges: this.metric3Ranges },
            { num: 4, kpi: this.metric4Kpi, display: this.metric4Display, ranges: this.metric4Ranges },
            { num: 5, kpi: this.metric5Kpi, display: this.metric5Display, ranges: this.metric5Ranges },
            { num: 6, kpi: this.metric6Kpi, display: this.metric6Display, ranges: this.metric6Ranges }
        ];
        return slots
            .filter(s => s.kpi)
            .map(s => this._buildMetricPreview(s.num, s.kpi, s.display, s.ranges));
    }

    get hasMetricPreviews() { return this.enableMetrics && this.metricPreviews.length > 0; }
    get metricsPreviewEmpty() { return this.enableMetrics && this.metricPreviews.length === 0; }

    _resolvePreviewColor(val, ranges) {
        if (!Array.isArray(ranges) || ranges.length === 0) return null;
        let color = null;
        for (const r of ranges) {
            const threshold = Number(r.threshold);
            if (!isNaN(threshold) && val >= threshold && r.color) {
                color = r.color;
            }
        }
        return color;
    }

    _buildMetricPreview(num, kpi, display, ranges = []) {
        const sample = KPI_SAMPLE[kpi] ?? { value: 0, label: kpi, context: '', unit: '' };
        const rawVal = sample.value;
        const pct    = Math.min(100, Math.max(0, Number(rawVal)));

        // Bar: value as % of 100 → width
        const barWidth = `${pct}%`;

        // Gauge (donut) stroke math
        const r  = 40;
        const circ = 2 * Math.PI * r;
        const filled = (pct / 100) * circ;
        const gaugeDash = `${filled.toFixed(1)} ${(circ - filled).toFixed(1)}`;

        // Pie: two-segment SVG arc
        const pieAngle = (pct / 100) * 360;
        const rad = (pieAngle - 90) * (Math.PI / 180);
        const x   = 50 + 40 * Math.cos(rad);
        const y   = 50 + 40 * Math.sin(rad);
        const largeArc = pct > 50 ? 1 : 0;
        const piePath  = pct >= 100
            ? 'M50,50 m-40,0 a40,40 0 1,1 80,0 a40,40 0 1,1 -80,0'
            : `M50,50 L50,10 A40,40 0 ${largeArc},1 ${x.toFixed(2)},${y.toFixed(2)} Z`;

        // Line: simple 5-point sparkline across 100×40 viewport
        const linePoints     = '0,30 25,22 50,28 75,10 100,18';
        const lineAreaPoints = '0,30 25,22 50,28 75,10 100,18 100,40 0,40';

        let displayValue;
        if (display === 'percentage') displayValue = `${Math.round(rawVal)}%`;
        else if (display === 'number') displayValue = sample.unit ? `${rawVal}${sample.unit}` : String(rawVal);
        else displayValue = String(rawVal);

        const accentColor     = this._resolvePreviewColor(rawVal, ranges);
        const valueColorStyle = accentColor ? `color:${accentColor}` : '';
        const accentFill      = accentColor ?? 'var(--slds-g-color-brand-base-50,#0176d3)';
        const barFillStyle    = `width:${barWidth};background-color:${accentFill}`;

        return {
            num,
            kpi,
            display,
            label:        sample.label,
            context:      sample.context,
            displayValue,
            rawVal,
            pct,
            barWidth,
            barWidthStyle:    `width:${barWidth}`,
            barFillStyle,
            valueColorStyle,
            accentFill,
            gaugeDash,
            piePath,
            linePoints,
            lineAreaPoints,
            isNumber:     display === 'number',
            isPercentage: display === 'percentage',
            isBar:        display === 'bar',
            isPie:        display === 'pie',
            isLine:       display === 'line',
            isGauge:      display === 'gauge'
        };
    }

    // ─── Flows (imperative — not cacheable) ──────────────────────────────────

    async _loadFlows() {
        this.flowLoadError = null;
        try {
            const data = await getActiveFlows();
            this.flowOptions = [
                { label: '-- None --', value: '' },
                ...data.map(f => ({ label: f.label ?? f.value, value: f.value }))
            ];
        } catch (e) {
            this.flowLoadError = e?.body?.message ?? e?.message ?? 'Could not load flows.';
            this.flowOptions = [{ label: '-- None --', value: '' }];
        }
    }

    // ─── Wire: ServiceAppointment fields ──────────────────────────────────────

    // Retained so saStatusOptions can read live picklist values from the wire result
    _saObjectInfo = null;

    @wire(getObjectInfo, { objectApiName: 'ServiceAppointment' })
    wiredSaObjectInfo({ data, error }) {
        if (data) {
            this._saObjectInfo = data;
            const fields = Object.values(data.fields);
            this.saFieldOptions = [
                ...SA_TRAVERSAL_OPTIONS.filter(o => !SA_CARD_BASE_FIELDS.has(o.value)),
                ...fields
                    .filter(f => !SA_TRAVERSAL_OPTIONS.some(t => t.value === f.apiName) && !SA_CARD_BASE_FIELDS.has(f.apiName))
                    .map(f => ({ label: `${f.label} (${f.apiName})`, value: f.apiName }))
                    .sort((a, b) => a.label.localeCompare(b.label))
            ];
            this.saReferenceFieldOptions = [
                { label: '-- Service Appointment (default) --', value: '' },
                ...fields
                    .filter(f => f.dataType === 'Reference')
                    .map(f => ({ label: `${f.label} (${f.apiName})`, value: f.apiName }))
                    .sort((a, b) => a.label.localeCompare(b.label))
            ];
        }
        if (error) {
            this.saFieldOptions = SA_TRAVERSAL_OPTIONS.filter(o => !SA_CARD_BASE_FIELDS.has(o.value));
            this.saReferenceFieldOptions = [];
        }
    }

    // ─── Wire: WaitlistParticipant fields ─────────────────────────────────────

    @wire(getObjectInfo, { objectApiName: 'WaitlistParticipant' })
    wiredWlObjectInfo({ data, error }) {
        if (data) {
            const fields = Object.values(data.fields);
            this.wlFieldOptions = [
                ...WL_TRAVERSAL_OPTIONS,
                ...fields
                    .filter(f => !WL_TRAVERSAL_OPTIONS.some(t => t.value === f.apiName))
                    .map(f => ({ label: `${f.label} (${f.apiName})`, value: f.apiName }))
                    .sort((a, b) => a.label.localeCompare(b.label))
            ];
            this.wlReferenceFieldOptions = [
                { label: '-- WaitlistParticipant (default) --', value: '' },
                ...fields
                    .filter(f => f.dataType === 'Reference')
                    .map(f => ({ label: `${f.label} (${f.apiName})`, value: f.apiName }))
                    .sort((a, b) => a.label.localeCompare(b.label))
            ];
        }
        if (error) {
            this.wlFieldOptions = WL_TRAVERSAL_OPTIONS;
            this.wlReferenceFieldOptions = [];
        }
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    connectedCallback() {
        this._loadConfig();
        this._loadFlows();
        this._loadSaActions();
        this._loadWlActions();
    }

    async _loadConfig() {
        try {
            const cfg = await getConfig();
            if (cfg) {
                this.targetLookupField      = cfg.Target_Lookup_Field__c   ?? 'Case__c';
                this.saCustomActions        = parseComma(cfg.SA_Custom_Actions__c);
                this.saDefaultHiddenActions = parseComma(cfg.SA_Hidden_Default_Actions__c);
                this.appointmentFields      = (cfg.Appointment_Fields__c
                    ? parseComma(cfg.Appointment_Fields__c)
                    : [...SA_DEFAULT_FIELDS]).filter(f => !SA_CARD_BASE_FIELDS.has(f));
                this.checkInMethod          = cfg.Check_In_Method__c        ?? 'Custom LWC';
                this.checkinFlow            = cfg.Waitlist_Checkin_Flow__c ?? '';
                this.wlTargetLookupField    = cfg.WL_Target_Lookup_Field__c ?? '';
                this.wlCustomActions        = parseComma(cfg.WL_Custom_Actions__c);
                this.wlDefaultHiddenActions = parseComma(cfg.WL_Hidden_Default_Actions__c);
                this.waitlistFields         = cfg.Waitlist_Fields__c
                    ? parseComma(cfg.Waitlist_Fields__c)
                    : [...WL_DEFAULT_FIELDS];
                this.refreshInterval        = cfg.Refresh_Interval__c   ?? 30;
                this.maxAppointments        = cfg.Max_Appointments__c   ?? 50;
                this.enableMetrics          = cfg.Enable_Metrics__c     ?? false;
                this.metric1Kpi             = cfg.Metric_1_KPI__c       ?? '';
                this.metric1Display         = cfg.Metric_1_Display__c   ?? 'number';
                this.metric2Kpi             = cfg.Metric_2_KPI__c       ?? '';
                this.metric2Display         = cfg.Metric_2_Display__c   ?? 'number';
                this.metric3Kpi             = cfg.Metric_3_KPI__c       ?? '';
                this.metric3Display         = cfg.Metric_3_Display__c   ?? 'number';
                this.metric4Kpi             = cfg.Metric_4_KPI__c       ?? '';
                this.metric4Display         = cfg.Metric_4_Display__c   ?? 'number';
                this.metric5Kpi             = cfg.Metric_5_KPI__c       ?? '';
                this.metric5Display         = cfg.Metric_5_Display__c   ?? 'number';
                this.metric6Kpi             = cfg.Metric_6_KPI__c       ?? '';
                this.metric6Display         = cfg.Metric_6_Display__c   ?? 'number';
                this.useCustomStatusMapping = cfg.Use_Custom_Status_Mapping__c ?? false;
                this.currentStatuses        = parseComma(cfg.Current_Statuses__c);
                this.upcomingStatuses       = parseComma(cfg.Upcoming_Statuses__c);
                this.pastStatuses           = parseComma(cfg.Past_Statuses__c);
                this.missedStatuses         = parseComma(cfg.Missed_Statuses__c);
                this.showMetricsByDefault   = cfg.Show_Metrics_By_Default__c ?? true;
                this.metricsBorderColor     = cfg.Metrics_Border_Color__c ?? '';
                this.metric1Ranges          = parseRangesJson(cfg.Metric_1_Ranges__c);
                this.metric2Ranges          = parseRangesJson(cfg.Metric_2_Ranges__c);
                this.metric3Ranges          = parseRangesJson(cfg.Metric_3_Ranges__c);
                this.metric4Ranges          = parseRangesJson(cfg.Metric_4_Ranges__c);
                this.metric5Ranges          = parseRangesJson(cfg.Metric_5_Ranges__c);
                this.metric6Ranges          = parseRangesJson(cfg.Metric_6_Ranges__c);
                // Set numKpiSlots to highest slot that has a KPI saved (minimum 1)
                let highest = 1;
                if (cfg.Metric_1_KPI__c) highest = 1;
                if (cfg.Metric_2_KPI__c) highest = 2;
                if (cfg.Metric_3_KPI__c) highest = 3;
                if (cfg.Metric_4_KPI__c) highest = 4;
                if (cfg.Metric_5_KPI__c) highest = 5;
                if (cfg.Metric_6_KPI__c) highest = 6;
                this.numKpiSlots = highest;
            } else {
                // No saved config — apply sensible defaults
                this.appointmentFields = [...SA_DEFAULT_FIELDS];
                this.waitlistFields    = [...WL_DEFAULT_FIELDS];
            }
        } catch (e) {
            this.loadError = e?.body?.message ?? e?.message ?? 'Failed to load configuration.';
        } finally {
            this.isLoading = false;
        }
    }

    async _loadSaActions() {
        this.saActionsLoading = true;
        try {
            const actions = await getQuickActions({ objectApiName: 'ServiceAppointment' });
            this.saActionOptions = actions.map(a => ({ label: a.label, value: a.value }));
        } catch (e) {
            this.saActionsError = 'Unable to load appointment actions.';
        } finally {
            this.saActionsLoading = false;
        }
    }

    async _loadWlActions() {
        this.wlActionsLoading = true;
        try {
            const actions = await getQuickActions({ objectApiName: 'WaitlistParticipant' });
            this.wlActionOptions = actions.map(a => ({ label: a.label, value: a.value }));
        } catch (e) {
            this.wlActionsError = 'Unable to load waitlist actions.';
        } finally {
            this.wlActionsLoading = false;
        }
    }

    // ─── Handlers — Appointment Card ─────────────────────────────────────────

    handleTargetLookupFieldChange(event)  { this.targetLookupField = event.detail.value; }
    handleSaCustomActionsChange(event)    { this.saCustomActions = event.detail.value; }
    handleSaDefaultHiddenChange(event)    { this.saDefaultHiddenActions = event.detail.value; }
    handleAppointmentFieldsChange(event)  { this.appointmentFields = event.detail.value; }

    // ─── Handlers — Waitlist Card ─────────────────────────────────────────────

    handleCheckInMethodChange(event)      { this.checkInMethod = event.detail.value; }
    handleCheckinFlowChange(event)        { this.checkinFlow = event.detail.value; }
    handleWlTargetLookupFieldChange(event){ this.wlTargetLookupField = event.detail.value; }
    handleWlCustomActionsChange(event)    { this.wlCustomActions = event.detail.value; }
    handleWlDefaultHiddenChange(event)    { this.wlDefaultHiddenActions = event.detail.value; }
    handleWaitlistFieldsChange(event)     { this.waitlistFields = event.detail.value; }

    // ─── Handlers — Status Mapping ────────────────────────────────────────────

    handleUseCustomStatusMappingChange(event) {
        this.useCustomStatusMapping = event.detail.checked;
        if (this.useCustomStatusMapping &&
            this.currentStatuses.length === 0 &&
            this.upcomingStatuses.length === 0 &&
            this.pastStatuses.length === 0 &&
            this.missedStatuses.length === 0) {
            this.currentStatuses  = ['Checked_In', 'In Progress'];
            this.upcomingStatuses = ['Scheduled'];
            this.pastStatuses     = ['Completed', 'Cannot Complete', 'Canceled'];
            this.missedStatuses   = [];
        }
    }
    handleCurrentStatusesChange(event)        { this.currentStatuses  = event.detail.value; }
    handleUpcomingStatusesChange(event)       { this.upcomingStatuses = event.detail.value; }
    handlePastStatusesChange(event)           { this.pastStatuses     = event.detail.value; }
    handleMissedStatusesChange(event)         { this.missedStatuses   = event.detail.value; }

    // ─── Handlers — Metric Appearance ────────────────────────────────────────

    handleMetricsBorderColorChange(event)    { this.metricsBorderColor    = event.detail.value; }
    handleShowMetricsByDefaultChange(event)  { this.showMetricsByDefault  = event.detail.checked; }

    handleAddRange(event) {
        const slot = parseInt(event.currentTarget.dataset.slot, 10);
        const prop = `metric${slot}Ranges`;
        const existing = this[prop];
        if (existing.length >= 3) return;
        const color = DEFAULT_RANGE_COLORS[existing.length] ?? '#4992FF';
        this[prop] = [...existing, { threshold: 0, color }];
    }

    handleRemoveRange(event) {
        const slot  = parseInt(event.currentTarget.dataset.slot, 10);
        const index = parseInt(event.currentTarget.dataset.index, 10);
        const prop  = `metric${slot}Ranges`;
        this[prop]  = this[prop].filter((_, i) => i !== index);
    }

    handleRangeThresholdChange(event) {
        const slot  = parseInt(event.currentTarget.dataset.slot, 10);
        const index = parseInt(event.currentTarget.dataset.index, 10);
        const prop  = `metric${slot}Ranges`;
        this[prop]  = this[prop].map((r, i) =>
            i === index ? { ...r, threshold: parseFloat(event.detail.value) || 0 } : r
        );
    }

    handleRangeColorChange(event) {
        const slot  = parseInt(event.currentTarget.dataset.slot, 10);
        const index = parseInt(event.currentTarget.dataset.index, 10);
        const prop  = `metric${slot}Ranges`;
        this[prop]  = this[prop].map((r, i) =>
            i === index ? { ...r, color: event.detail.value } : r
        );
    }

    // ─── Handlers — General ───────────────────────────────────────────────────

    handleRefreshIntervalChange(event)    { this.refreshInterval = parseInt(event.detail.value, 10) || 30; }
    handleMaxAppointmentsChange(event)    { this.maxAppointments = parseInt(event.detail.value, 10) || 50; }
    handleEnableMetricsChange(event)      { this.enableMetrics = event.detail.checked; }

    handleMetricKpiChange(event) {
        const slot = parseInt(event.currentTarget.dataset.slot, 10);
        const val  = event.detail.value;
        const kpiProps = ['metric1Kpi','metric2Kpi','metric3Kpi','metric4Kpi','metric5Kpi','metric6Kpi'];
        if (kpiProps[slot] !== undefined) {
            this[kpiProps[slot]] = val;
        }
    }

    handleMetricDisplayChange(event) {
        const slot = parseInt(event.currentTarget.dataset.slot, 10);
        const val  = event.detail.value;
        const props = ['metric1Display','metric2Display','metric3Display','metric4Display','metric5Display','metric6Display'];
        if (props[slot] !== undefined) this[props[slot]] = val;
    }

    handleAddKpiSlot() {
        if (this.numKpiSlots < 6) this.numKpiSlots += 1;
    }

    handleMetricClear(event) {
        const slot = parseInt(event.currentTarget.dataset.slot, 10); // 0-indexed
        const kpiProps  = ['metric1Kpi','metric2Kpi','metric3Kpi','metric4Kpi','metric5Kpi','metric6Kpi'];
        const dispProps = ['metric1Display','metric2Display','metric3Display','metric4Display','metric5Display','metric6Display'];
        // Shift subsequent slots down to fill the gap
        for (let i = slot; i < 5; i++) {
            this[kpiProps[i]]  = this[kpiProps[i + 1]];
            this[dispProps[i]] = this[dispProps[i + 1]];
        }
        // Clear the now-vacated last slot
        this[kpiProps[5]]  = '';
        this[dispProps[5]] = 'number';
        // Reduce visible count by 1
        this.numKpiSlots = Math.max(0, this.numKpiSlots - 1);
    }

    // ─── Validation ───────────────────────────────────────────────────────────

    _validateRanges() {
        let valid = true;
        for (let slot = 1; slot <= 6; slot++) {
            const ranges = this[`metric${slot}Ranges`];
            if (!ranges.length) continue;
            const inputs = this.template.querySelectorAll(
                `lightning-input[data-slot="${slot}"][data-field="threshold"]`
            );
            inputs.forEach((input, i) => {
                const val = parseFloat(input.value) || 0;
                const prev = i > 0 ? (parseFloat(ranges[i - 1].threshold) || 0) : -Infinity;
                if (val < prev) {
                    input.setCustomValidity(`Threshold must be ≥ ${prev}`);
                    input.reportValidity();
                    valid = false;
                } else {
                    input.setCustomValidity('');
                }
            });
        }
        return valid;
    }

    // ─── Save ─────────────────────────────────────────────────────────────────

    async handleSave() {
        if (!this._validateRanges()) return;
        this.isSaving  = true;
        this.saveError = null;

        const configMap = {
            Target_Lookup_Field__c:        this.targetLookupField   || 'Case__c',
            SA_Custom_Actions__c:          joinComma(this.saCustomActions),
            SA_Hidden_Default_Actions__c:  joinComma(this.saDefaultHiddenActions),
            Appointment_Fields__c:         joinComma(this.appointmentFields),
            Check_In_Method__c:            this.checkInMethod         || 'Custom LWC',
            Waitlist_Checkin_Flow__c:      this.checkinFlow          || null,
            WL_Target_Lookup_Field__c:     this.wlTargetLookupField  || null,
            WL_Custom_Actions__c:          joinComma(this.wlCustomActions),
            WL_Hidden_Default_Actions__c:  joinComma(this.wlDefaultHiddenActions),
            Waitlist_Fields__c:            joinComma(this.waitlistFields),
            Refresh_Interval__c:           this.refreshInterval,
            Max_Appointments__c:           this.maxAppointments,
            Enable_Metrics__c:             this.enableMetrics,
            Metric_1_KPI__c:               this.metric1Kpi          || null,
            Metric_1_Display__c:           this.metric1Display       || 'number',
            Metric_2_KPI__c:               this.metric2Kpi          || null,
            Metric_2_Display__c:           this.metric2Display       || 'number',
            Metric_3_KPI__c:               this.metric3Kpi          || null,
            Metric_3_Display__c:           this.metric3Display       || 'number',
            Metric_4_KPI__c:               this.metric4Kpi          || null,
            Metric_4_Display__c:           this.metric4Display       || 'number',
            Metric_5_KPI__c:               this.metric5Kpi          || null,
            Metric_5_Display__c:           this.metric5Display       || 'number',
            Metric_6_KPI__c:               this.metric6Kpi          || null,
            Metric_6_Display__c:           this.metric6Display       || 'number',
            Use_Custom_Status_Mapping__c:  this.useCustomStatusMapping,
            Current_Statuses__c:           joinComma(this.currentStatuses),
            Upcoming_Statuses__c:          joinComma(this.upcomingStatuses),
            Past_Statuses__c:              joinComma(this.pastStatuses),
            Missed_Statuses__c:            joinComma(this.missedStatuses),
            Metrics_Border_Color__c:       this.metricsBorderColor  || null,
            Metric_1_Ranges__c:            this.metric1Ranges.length ? JSON.stringify(this.metric1Ranges) : null,
            Metric_2_Ranges__c:            this.metric2Ranges.length ? JSON.stringify(this.metric2Ranges) : null,
            Metric_3_Ranges__c:            this.metric3Ranges.length ? JSON.stringify(this.metric3Ranges) : null,
            Metric_4_Ranges__c:            this.metric4Ranges.length ? JSON.stringify(this.metric4Ranges) : null,
            Metric_5_Ranges__c:            this.metric5Ranges.length ? JSON.stringify(this.metric5Ranges) : null,
            Metric_6_Ranges__c:            this.metric6Ranges.length ? JSON.stringify(this.metric6Ranges) : null,
            Show_Metrics_By_Default__c:    this.showMetricsByDefault
        };

        try {
            await saveConfig({ configMap });
            this.dispatchEvent(new ShowToastEvent({
                title:   'Configuration Saved',
                message: 'Settings will take effect on the next lobby page load.',
                variant: 'success'
            }));
        } catch (e) {
            this.saveError = e?.body?.message ?? e?.message ?? 'Save failed. Please try again.';
        } finally {
            this.isSaving = false;
        }
    }
}
