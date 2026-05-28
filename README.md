# Salesforce Lobby Management

A Salesforce Field Service / Scheduler LWC dashboard that gives front-desk staff a real-time view of scheduled appointments and the walk-in waitlist for a selected service territory. An admin-facing configuration page controls all display and behavior settings with no code changes required.

---

## Features

- **Multi-territory selector** — switch between service territories; layout refreshes automatically
- **Appointment cards** — configurable fields, status badges, EWT, per-card action menus (check in, reschedule, mark no-show, reassign resource)
- **Walk-in waitlist** — add walk-ins via a built-in modal or a custom Screen Flow; sort participants, mark no-shows, remove resources
- **Metrics carousel** — up to 6 KPI cards (total appointments, check-in rate, in-progress, avg wait, no-show rate, throughput, etc.) with configurable display types (number, %, bar, gauge, pie)
- **Auto-refresh** — configurable polling interval (default 30 s)
- **Custom status mapping** — map any SA picklist value to Current / Upcoming / Past / Missed buckets for dashboard card grouping
- **Timezone-aware** — day boundaries computed from each territory's operating-hours timezone; no UTC drift
- **Admin config app** — `Lobby Config` Lightning App with a dedicated config page; all settings stored in `Lobby_Config__mdt` custom metadata

---

## Prerequisites

### Salesforce Org Requirements

| Requirement | Notes |
|-------------|-------|
| **Salesforce Scheduler** | The component queries `ServiceTerritory`, `ServiceAppointment`, `AssignedResource`, `WorkType` — all Scheduler standard objects |
| **Field Service (FSL) managed package** | Required if using resource assignment features. The FSL trigger `FSL.TR001_Service_BeforeInsert` fires on every `ServiceAppointment` insert. |
| **Waitlist feature enabled** | `WaitlistParticipant` and `Waitlist` objects must be available. Enable via **Setup → Salesforce Scheduler Settings → Enable Waitlist**. |
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

### Key settings

| Setting | Description |
|---------|-------------|
| **Appointment Extra Fields** | SOQL API names of additional fields to display on each appointment card (e.g. `Description`, `WorkType.Name`) |
| **Waitlist Extra Fields** | Same for waitlist participant cards |
| **Check-In Method** | `Custom LWC` (built-in walk-in modal) or `Flow` (a named Screen Flow) |
| **Waitlist Check-In Flow** | API name of the Screen Flow to launch when method = Flow |
| **SA Custom Actions** | Quick Actions to add to the appointment card action menu |
| **WL Custom Actions** | Quick Actions to add to the waitlist card action menu |
| **Default Hidden Actions** | Built-in actions to hide from the default action menus |
| **Custom Status Mapping** | Toggle on to map specific SA status API names to Current / Upcoming / Past / Missed buckets |
| **Refresh Interval** | Auto-refresh polling interval in seconds (10–300) |
| **Max Appointments** | Maximum SA records fetched per territory per load |
| **Enable Metrics** | Toggle the KPI metrics carousel strip on/off |
| **KPI Slots 1–6** | Choose KPI type and display style per carousel card |

### Walk-In Flow (optional)

A sample Screen Flow (`Walk_In_Appointment`) is included. It accepts `serviceTerritoryId` and `serviceTerritoryName` input variables from the LWC, collects participant identity, and creates a `ServiceAppointment` + `WaitlistParticipant`. To use it:

1. Activate the flow in **Setup → Flows → Walk In Appointment**
2. In Lobby Config, set **Check-In Method** to `Flow` and select `Walk In Appointment` from the flow picker

> **Note:** The included flow sets `ServiceAppointment.ParentRecordId` to the participant's Account ID to satisfy the FSL before-insert trigger. If your org's FSL trigger requires a Work Order as `ParentRecordId`, modify the flow or `WalkInCheckInController.cls` accordingly.

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
