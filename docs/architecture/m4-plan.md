# M4 plan

- **Status:** proposed by the ACA (2026-10-30), for the owner's approval.
- **Scope:** the owner's, in `docs/status.md`, "Milestone M4" (2026-10-30, decisions BO to BV), and the tasks T-061, T-065, T-066, T-068, T-069 and T-071 to T-075.
- **Not in M4:** PostgreSQL/PostGIS persistence and monitoring (T-059, T-060) are M5. The overview's section 6 holds the milestones.

## 1. Contracts: SDK 1.3.0 and data model 1.3.0, one change request

These are one release, as 1.2.0 was. The PDA writes one CR, under the next free number from the MCA, and folds CR-0023 into it, as CR-0025 folded in CR-0022 and CR-0024. The ACA reviews it and the owner decides. The PDA then builds it in parts on an integration branch `integration/sdk-v1.3`, and the owner freezes it. Plugins keep `sdkVersion` `^1.2.0` until they use an addition.

| Part | What | Why |
|---|---|---|
| 1 | CR-0023 as written: the `wms` background source, `services.provide` returning an `Unsubscribe`, a plugin's own settings panel, and the test-kit fakes | WMS (ADR-0035) |
| 2 | **The layer lock.** Data model 1.3.0: an optional `locked` field on the layer, and a rejection code for a user's change to a locked layer. Both SDKs' layer types, and the fake store rejects such a change too | BP, ADR-0042 |
| 3 | **The declared-fields editor** (`DeclaredFields`) shows the fields of the object's data type, then the other plugins' fields in a collapsible list instead of the "+". The component's props stay, if possible | BO |
| 4 | **Right-click**, in the documentation and the fake map view: while placing (`pickPoint`), it acts as Escape; while drawing a multi-point object, it removes the last point, and acts as Escape when no point is left | The mouse items |
| 5 | **A settings field that is enabled only for some values of another field**, in the generated settings form: the schema keyword (PDA) and the form (CDA). `cot` uses it for a link's target and source layers | `cot`'s greyed fields |

**No contract change for icons over the map.** `ctx.ui.addMapPaneOverlay` exists since SDK v0. `coordinates` already shows its cursor display that way, and `map-view-2d` its controls. `coordinates` moves its "Go to" panel into an icon with the shared popover, ordered in the corner with `order`. If the corners cannot line up with the map view's own icons, the PDA raises it in part 4.

## 2. ADRs

- **ADR-0042, the layer lock (new; the ACA, once the owner answers question 1).** The lock is stored with the layer and enforced by the server. Anyone who may edit the layer may set or clear it. Users' changes are refused, but changes by plugins' server parts pass: incoming data (BP), and the simulator's moves. Overview 4.4 (normative) gains the rule.
- **No new ADR for the in/out framework.** ADR-0036 already says the transport is always the plugin's, with no helpers in ECore. BQ says the same of the SDK, and ADR-0036's index row records it (this branch). Data outside the model goes into the plugin's own extension (ADR-0007), and is stored with the object. Fields that users edit are declared fields (ADR-0038).
- **Index notes on this branch:**
  - ADR-0038, for BO;
  - ADR-0036, for BQ;
  - ADR-0019 and ADR-0024, now M5.

## 3. The framework for in/out plugins (BQ, BR, BU)

- **The playbook** (`docs/plugins/in-out/playbook.md`, by the PDA) is one format for every in/out plugin. Its work packages each fit about 100k tokens of context, and each states its inputs, its outputs and when it is done, so a human can follow them too:
  1. the specification and its mapping to the model. Any specification is allowed, and a header outside the model goes into the plugin's extension;
  2. the transport: one mode from the template;
  3. links and settings (ADR-0037);
  4. status and counters;
  5. tests, and a check against reference data.
- **The transport pattern** lives in the plugin template's server part (`plugins/_template/server/`, by the PDA). It covers the six modes:
  - UDP send and receive;
  - a TCP server or a TCP client, each as provider or consumer;
  - sending and receiving on one socket.

  The modes run on connection tasks, on platform threads (CR-0027), and are taken from `cot`'s tested link tasks. They are a pattern that each plugin copies and owns, not SDK building blocks (BQ).
- **Its first test** (BR, BU): the PDA writes the `ais` and `adsb` briefs in the playbook's format. **PCA-ais** and **PCA-adsb** (new) then build them by it, input only:
  - AIS takes NMEA 0183 AIVDM over UDP or TCP. The decoder is the plugin's own code, or a library once its licence is checked (ADR-0016);
  - ADS-B takes SBS-1/BaseStation as a TCP client to port 30003.

  Each PCA records where the playbook fell short, and the PDA revises it before the next in/out plugin.
- **Reference data:** the ESA plays back recorded AIS and ADS-B data from `external/`. The owner approves each source first. The PCAs' checks and the ITA's flows use it.

## 4. Tracks and order

| Track | Work | Owner | Starts |
|---|---|---|---|
| A, contracts | ADR-0042; the 1.3.0 CR; its build in parts; the freeze | ACA, PDA (CDA for part 5's form) | at once |
| B, no contract change | the five bugs; the simulator's five UI items (BV's units included); 10 to 20 symbols per category (`symbology`); right-click and filled shapes picked by their lines (`map-view-2d`); the `coordinates` icon; default panel positions (BS, one line in each plugin); default layers (BT); callsigns on the simulator's CoT tracks; the three documentation lines; T-066 if still open | the board's owners; PCA-symbology, PCA-coordinates | at once, after the PDA's brief edits where behaviour changes |
| C, in/out | the playbook and the template pattern; then `ais` and `adsb` in parallel; the ESA's playback from the start | PDA, PCA-ais, PCA-adsb, ESA | at once |
| D, Keycloak | T-068, then T-061 and T-069 | ESA, ITA | at once |
| E, needs 1.3.0 | WMS: T-072, T-073, T-075, T-074. The lock: the server (CDA) and its icon (PCA-layer-panel). The fields list in `draw-symbols` and the simulator. `cot`'s greyed fields | as named | per part of A |
| F | T-065, the tactical graphics decision paper | ACA | any time |
| G | the M4 flows: the lock, WMS, `ais` and `adsb` with the playback, Keycloak, the default layers | ITA | as each lands |

- **The PDA is the bottleneck.** The proposed order is:
  1. one batch of brief edits for track B (as for T-077);
  2. the 1.3.0 CR;
  3. the playbook and the template;
  4. the `ais` and `adsb` briefs.

  The ACA reviews only what touches an ADR: the CR, the lock and the fields.
- **Everything else runs in parallel.** Each PCA works on its own plugin, and the CDA's lock and form parts follow A's parts.
