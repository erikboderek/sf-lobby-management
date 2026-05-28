# Salesforce Lobby Management

<img width="1000" height="564" alt="image" src="https://github.com/user-attachments/assets/c30666b8-5cd0-43a7-8d01-8c7cde53ddef" />


I wanted more control over what I could do with lobby management in Salesforce Scheduler, so I built my own LWC with more control that doesn't require any code changes. 

<img width="2663" height="2544" alt="image" src="https://github.com/user-attachments/assets/77433794-92f1-426b-b90c-73d1a58831e7" />



---

## Features

- **Multi-territory selector** — switch between service territories; layout refreshes automatically
- **Appointment cards** — Appointments and Waitlist Participants have configurable fields, status badges, estimated wait times, per-card action menus (check in, reschedule, mark no-show, reassign resource)
- **Walk-in waitlist** — add walk-ins via a built-in modal or a custom Screen Flow; sort participants, mark no-shows, remove resources
- **Metrics carousel** — up to 6 KPI cards (total appointments, check-in rate, in-progress, avg wait, no-show rate, throughput, etc.) with configurable display types (number, %, bar, gauge, pie)
- **Custom status mapping** — map any Service Appointment status picklist value to Current / Upcoming / Past / Missed buckets for dashboard card grouping
- **Timezone-aware** — day boundaries computed from each territory's operating-hours timezone; no UTC drift
- **Admin config app** — `Lobby Config` Lightning App with a dedicated config page; all settings stored in `Lobby_Config__mdt` custom metadata

---

## Prerequisites

### Salesforce Org Requirements

| Requirement | Notes |
|-------------|-------|
| **Salesforce Scheduler** | The component queries `ServiceTerritory`, `ServiceAppointment`, `AssignedResource`, `WorkType` — all Scheduler standard objects |
| **Field Service (FSL) managed package** | Required if using resource assignment features. The FSL trigger `FSL.TR001_Service_BeforeInsert` fires on every `ServiceAppointment` insert. |
| **Waitlist feature enabled** | `WaitlistParticipant` and `Waitlist` objects must be available. Enable via **Setup → Salesforce Scheduler Settings → Enable Drop In Appointments**. |
| **Add "Checked In" status to Service Appointment** | In Object Manager, Service Appointment. Fields and Relationships -> Status -> in Status Picklist Values, click New. Label: Checked In, API Name: Checked_In, Status Category: Checked In |
| **Add "No-Show" status to Service Appointment** | Similar to the last step, Label: No Show, API: No-Show, Status Category: Canceled |
| **Add "At Branch" Appointment Type to Service Appointment** | In Object Manager, Service Appointment. Fields and Relationships -> Appointment Type -> in Appointment Type Picklist Values, click New. Label: At Branch, API Name: At Branch *Note: The API Name must be "At Branch."* |
| **Person Accounts enabled** | The built-in walk-in modal creates Person Accounts for new participants. Enable via **Setup → Account Settings → Allow Customer Support to enable Person Accounts**. |
| **API Version 66+** | `sourceApiVersion` in `sfdx-project.json` is `66.0`. |
| **Lightning Experience** | LWC only; Classic is not supported. |

### User Permissions

The running user needs:

- `FSL_Agent_Permissions` or `FSL_Dispatcher_Permissions` permission set (for SA read/write)
- `LightningSchedulerStandardUser` permission set (for Waitlist objects)
- Read access to `ServiceTerritory`, `ServiceAppointment`, `WaitlistParticipant`, `AssignedResource`, `ServiceResource`, `ServiceTerritoryMember`, `FlowDefinitionView`
- Write access to `ServiceAppointment` (Status, ActualStartTime, SchedStartTime, SchedEndTime), `AssignedResource`, `WaitlistParticipant`

A convenience script to assign permission sets is in [`scripts/apex/assign_permission_set.apex`](scripts/apex/assign_permission_set.apex).

### Local Developer Tools

- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf` v2+)
- Node.js 18+ and npm (for linting and Jest tests)
- VS Code with the [Salesforce Extension Pack](https://marketplace.visualstudio.com/items?itemName=salesforce.salesforcedx-vscode) (recommended)

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/<your-org>/sf-lobby-management.git
cd sf-lobby-management
npm install
```

### 2. Authenticate to your org

```bash
sf org login web --alias lobby-org --instance-url https://login.salesforce.com
```

For a scratch org:

```bash
sf org create scratch --definition-file config/project-scratch-def.json --alias lobby-scratch --duration-days 30 --set-default
```

### 3. Deploy metadata

```bash
sf project deploy start --source-dir force-app --target-org lobby-org
```

### 4. Assign permission sets

Open `scripts/apex/assign_permission_set.apex` in VS Code and run **SFDX: Execute Anonymous Apex with Editor Contents**, or via CLI:

```bash
sf apex run --file scripts/apex/assign_permission_set.apex --target-org lobby-org
```

### 5. Open the app

```bash
sf org open --target-org lobby-org
```

Navigate to the **Lobby Management** Lightning App. Two tabs are included:

- **Lobby Management** — the staff-facing dashboard
- **Lobby Config** — the admin configuration page

---

## Configuration

All settings are stored in the `Lobby_Config__mdt` custom metadata type under the `Default` record. Changes made in the **Lobby Config** app tab are saved there immediately and take effect on the next dashboard page load.

---

### General

In here, you can specify the refresh interval and the maximum number of appointments. Sorry, there's no paging capabilities at the moment.

---

#### Custom Status Mapping

Build out statuses on the LWC that align with your business processes.

![Custom Status Mapping](https://github.com/user-attachments/assets/5868095e-e2eb-49c3-aa8d-0e0fda30b9e9)

When custom status mapping is off, appointments are bucketed as follows:

| Bucket   | Condition                                                                                       |
|----------|-------------------------------------------------------------------------------------------------|
| Current  | Status is `Checked_In` or `In Progress` — OR — Status is `Scheduled` AND SchedStartTime ≤ now  |
| Upcoming | Status is `Scheduled` AND SchedStartTime > now                                                  |
| Past     | NOT `Checked_In`/`In Progress` AND SchedStartTime < now (catches Completed, No-Show, Canceled)  |
| Missed   | Always empty — only populated when custom status mapping is enabled                             |

---

#### Metrics

When enabled, can be toggled to display by default. If not, they can be toggled manually in the LWC by hitting the icon.

Up to six metrics can be displayed at once. Metrics displayed reflect data in the currently selected service territory. Each one can be changed to be a different visual: number, percentage, bar, and gauge. Colors can be defined using hex code values.

You can preview metrics in the config page.

![Metrics](https://github.com/user-attachments/assets/e238f768-100d-4dd6-9878-b5cede0672ea)

---

### Service Appointment

#### Navigate To

Pulls back a list of all lookup fields on a Service Appointment. This specifies which object you will go to upon clicking the appointment in the LWC. If nothing is selected, or the value is null, it'll default to the Service Appointment.

#### Actions

Actions are configurable. Mirrors OOTB Lobby Management behavior.

#### Extra Fields

Specify what fields you want to display on the appointment in the LWC.

![Service Appointment](https://github.com/user-attachments/assets/d2b626ed-0251-4bcb-b569-9762fef60f41)

---

### Waitlist

#### Walk-In Check-In Method

Can specify if you want to use the included screens to search for a contact, or use your own. If you select to use your own, the LWC exports the selected Service Territory ID and name. Create inpute variables in your flow for serviceTerritoryId and serviceTerritoryName and build to your heart's content. Works with Screen Flows and auto-launched flows.

#### Navigate To

Pulls back a list of all lookup fields on a Waitlist Participant. This specifies which object you will go to upon clicking the appointment in the LWC. If nothing is selected, or the value is null, it'll default to the Waitlist Participant.

#### Actions

Actions are configurable. Mirrors OOTB Lobby Management behavior.

---

## Wait Time
Wait time is displayed on these appointments in a few different ways. 

### 1. Per-Appointment Card Estimated Wait Time
*How long until a checked-in person is served*

**Source:** `LobbyEwtController.getAppointmentEwt()`

**Formula:**
EWT = projectedEnd − now
where projectedEnd = ActualStartTime + DurationInMinutes + BlockTimeAfterAppointment



**Logic:**
- Only applies to `Checked_In` appointments that have an assigned resource
- Finds the `In Progress` appointment that resource is currently serving
- Returns 0 if the blocking appointment has already passed its projected end
- **Fallbacks (LWC-side):**
  - If no server EWT: elapsed time since `ActualStartTime`
  - If not yet checked in: scheduled duration (`SchedEndTime − SchedStartTime`)

---

### 2. Per-Waitlist-Card Estimated Wait Time
*How long until a walk-in gets served*

**Source:** `LobbyEwtController.getWaitlistEwt()`

**Formula:**
EWT = (queuePosition × avgHandlingTime) / activeCapacity



| Variable | Source | Default |
|----------|--------|---------|
| `queuePosition` | Count of WaitlistParticipants with earlier `CreatedDate` on same waitlist | — |
| `avgHandlingTime` | `AVG(WorkType.DurationInMinutes)` for WorkTypes linked to the waitlist | 20 min |
| `activeCapacity` | Count of `WaitlistServiceResource` where `IsAvailable = true` | 1 |

- **Fallback (LWC-side):** `queueIndex × WorkType.EstimatedDuration` (or 20 min default) if Apex returns nothing

---

### 3. `avg_queue_wait` Metric Card
*Average time participants have already been waiting today*

**Source:** `LobbyManagementController.getMetrics()`

**Formula:**
avg_queue_wait = SUM(now − CreatedDate for each Waiting participant) / count / 60,000



**Logic:**
- Measures **actual elapsed wait time**, not a prediction
- Only counts `Waiting` participants created within the territory's day boundary
- Displayed with unit `min`

---

### Key Differences

| | What It Measures | Approach |
|---|---|---|
| Appointment EWT card | Predicted minutes until service starts | Current `In Progress` appointment's projected finish time |
| Waitlist EWT card | Predicted minutes until walk-in is served | Queue position formula |
| `avg_queue_wait` metric | Average time already spent waiting today | Simple elapsed time average |

---

### Display Format

All wait times are formatted by `_formatWaitMinutes()` in `lobbyPageContent.js`:

| Value | Display |
|-------|---------|
| < 60 min | `42 min` |
| ≥ 60 min | `1h 30m` or `2h` |
| Waitlist, just arrived | `Just arrived` |



---

## Data Model

```
ServiceTerritory
    └── ServiceAppointment  (SchedStartTime, Status, ContactId, ParentRecordId)
            └── AssignedResource  (ServiceResourceId)
    └── Waitlist
            └── WaitlistParticipant  (ParticipantIdentifier, Status)
                    └── WaitlistServiceResource

Lobby_Config__mdt  (Default record — all configuration)
```

---

## Development

### Lint

```bash
npm run lint
```

### Jest unit tests

```bash
npm test
```

### Deploy a single component

```bash
sf project deploy start --source-dir force-app/main/default/lwc/lobbyPageContent --target-org lobby-org
```

---

## Project Structure

```
force-app/main/default/
├── applications/          # Lobby Config Lightning App
├── aura/                  # actionPickerEditor (property editor for the CPE)
├── classes/               # Apex controllers
│   ├── LobbyManagementController.cls    # Main data controller (appointments, waitlist, metrics)
│   ├── LobbyEwtController.cls           # Bulk EWT calculation
│   ├── LobbyConfigController.cls        # Read/write Lobby_Config__mdt
│   ├── WalkInCheckInController.cls      # Walk-in SA + WaitlistParticipant creation
│   ├── LobbyFlowAuraAdapter.cls         # Active flow list for config picker
│   └── QuickActionPickerController.cls  # Quick Action list for config picker
├── customMetadata/        # Lobby_Config__mdt Default record
├── flexipages/            # Lobby Management Page + Lobby Config Page
├── flows/                 # Walk_In_Appointment sample Screen Flow
├── lwc/
│   ├── lobbyPageContent/      # Main dashboard component
│   ├── lobbyConfigManager/    # Admin configuration UI
│   ├── walkInCheckInModal/    # Built-in walk-in modal
│   ├── lobbyMasterCpe/        # Lightning App Builder CPE (property editor)
│   └── lobbyCpe*/             # CPE sub-components (field/action/flow pickers)
├── objects/               # Lobby_Config__mdt field definitions
└── tabs/                  # Lobby Management + Lobby Config tabs
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Appointments list is empty | No active `ServiceTerritory` records, or user lacks read access | Run `scripts/soql/verify_setup.soql`; assign FSL permission sets |
| Flow picker is empty in Lobby Config | `LobbyFlowAuraAdapter.getActiveFlows()` query failed | Ensure user has `ViewAllFlows` or `ManageFlow` permission |
| Walk-in check-in fails with `REQUIRED_FIELD_MISSING` | FSL trigger requires `ParentRecordId` on `ServiceAppointment` | Ensure Person Accounts are enabled; the controller sets `ParentRecordId` to the participant's Account ID |
| Check-in does not move SA to the "Current" column | Status API name mismatch | Confirm your org's `ServiceAppointment.Status` picklist API name for the checked-in value (default: `Checked_In`). Adjust `STATUS_CHECKED_IN` in `LobbyManagementController.cls` if different. |
| Metrics show wrong day totals | Territory timezone not configured | Assign an `OperatingHours` record with the correct `TimeZone` to the `ServiceTerritory` |

---

## License

MIT
