# M6 plan

- **Status:** approved by the owner (NJ A, 2026-11-10), with Q1 to Q6 all A (NK A, NL A). Proposed by the ACA the same day.
- **Scope:** the owner's, in `docs/status.md` (2026-11-09 and 2026-11-10): T-151, T-153, T-154, T-155, T-160, T-161, T-162, T-164, T-165 (CR-0038, approved, NB A), T-168, T-169, T-170, T-171, and **images in tactical graphics** (owner, HW: must be in M6).
- **Every label stays cosmetic in M6** (owner, 2026-11-10). Access by label (ADR-0020) is not enforced yet, and nothing in this plan starts it.
- **Not in M6:** the board's M7 section. Among it: OpenTelemetry (T-060), PostgreSQL/PostGIS with the event table question and spike S8, everything on terrain (T-157, T-166, T-167, GeoTIFF), symbol labels (T-163), symbol palettes (T-156) and the Scenario button (T-152).

## The owner's answers for this plan (2026-11-10)

| | Answer |
|---|---|
| Q1 | **A moved live track stays** where the user put it; the link's layer is where new tracks appear (part 5) |
| Q2 | **A copy is a snapshot:** a hand-made object (`dataSource` `manual`, no observation or expiry time), so it stays |
| Q3 | **The current workspace only** for moves and copies in M6 |
| Q4 | **A data type declares `sensorReport: true`** for its objects to get symbology's sensor report symbol (part 3) |
| Q5 | **A stored speed vector in minutes becomes the nearest step,** at most 30 min |
| Q6 | **The CDA makes T-170's picture examples** |

Section 4 keeps the questions as they were asked.

## 1. Decisions and ADRs

**T-155 comes first:** its ADR settles what the CDA builds and whether the SDK changes (Q1).

| Task | Form | Decision points |
|---|---|---|
| T-155 | **New ADR-0053, Move and copy to layer** (extends ADR-0005, 0032, 0042) | See below |
| T-165 | **New ADR-0054, A data type brings its field sets** (CR-0038; supersedes ADR-0050 points 4 and 5; refines ADR-0023 point 7 and ADR-0038's `dataTypes` on a field) | CR-0038's points 1 to 10 and the owner's Q1 to Q4, as approved. No new decision |
| Graphic images | Dated note on ADR-0043's index row | Point 9's draw result also carries images (part 2) |
| T-164 | Dated note on ADR-0046's index row | The speed vector's length is a step from a fixed list, not N minutes (part 3) |
| T-151 | Dated note on ADR-0023's index row | A data type may declare that its objects are sensor reports, drawn with symbology's sensor report symbol (part 3, Q4) |
| T-169 | Dated note on ADR-0048's index row | A simulated sensor has a type: Generic, or the GMTI radar, the only type a `gmti` output takes |
| T-170, T-171 | **No ADR in M6** | Both stay cosmetic. T-170's premade labels are stored in the existing label shape (`security-label.schema.json`: policy, classification, and categories for releasability), so later milestones can use them without a migration. Their use elsewhere gets its ADR then |
| T-153, T-154, T-160, T-161, T-162, T-168 | None | Brief or shell work inside the existing ADRs |

**ADR-0053, Move and copy to layer.** Its decision points:
1. **Two shared object actions from the shell,** like Delete (ADR-0032 point 6): "Move to layer…" and "Copy to layer…". The map's right-click menu and the objects panel show them with no work of their own (ADR-0032 point 4). They take one object or a selection, at most 1 000 (ADR-0032 point 1). Each opens a choice of layer: the shell's layer picker, without its "+".
2. **A move is an update,** never a delete and a create. The browser sends one update per object with the new `layerId` and the complete core content (model rule 5). So the id stays, relations to the object hold (ADR-0051), and the store keeps every extension (rule 5). Each move is one change event. The store already knows moves: rule 5 refuses one into another workspace's layer, and the lock covers both layers (ADR-0042 point 3).
3. **A copy is a create** of a new object in the chosen layer, with a new id. It carries the original's core content, its field sets and its namespaces, as an import does (rule 5). It never carries the `externalRef` (rule 16), so it is never taken for the original's external track. Q2 settles whether it keeps the data source and the observation time.
4. **Permissions are the server's,** with no new permission. A move needs the edit permission for objects of the workspace (`objects.edit` in View), and a copy the same for the target. A move is refused with `LAYER_LOCKED` when its source or its target layer is locked; a copy only when its target is, since copying out of a locked layer changes nothing there (ADR-0042 point 3). The picker lists only the current workspace's layers (Q3) that are not locked and that the user may add objects to. The browser only hides; the store decides (overview 4.4).
5. **Labels:** the object keeps its own label. ADR-0020 point 3 sets no rule between an object's label and its layer's, and labels are cosmetic in M6. When access by label comes, the target layer must be one the user is cleared for (ADR-0020 point 4).
6. **Not atomic.** Each object is its own request. The shell reports the outcome once, for example "8 of 10 moved; 2 refused: layer locked". No confirmation is asked: a move is undone by moving back, and a copy by deleting it.
7. **Live objects:** an in plugin's next report keeps the object where the user moved it (Q1). The object writer of in and out plugins (T-147) takes an existing object's layer from the stored object; the link's layer is where new objects appear. That is part 5.

## 2. Contracts: SDK 1.5.0 and data model 1.5.0, in parts

**One release, as 1.4.0 was.** CR-0038 is approved and is part 1. The PDA writes **one more CR** for parts 2 to 5, under the next free number from the MCA. The ACA reviews what touches an ADR, and the owner decides. The PDA builds the parts on `integration/sdk-v1.5`, one at a time, and the owner freezes the release. Plugins keep `sdkVersion` `^1.4.0` until their own code uses an addition.

| Part | What | Tasks |
|---|---|---|
| 1, data types and field sets | CR-0038 as approved: `fieldSets` and `manual` on a `dataTypes` entry and their model rules; `DataType.fieldSets` in both SDKs; the store adds the sets on a create and on a data type change; the expiry counts from `time.observed`; `DeclaredFields` shows one set at a time, with the drop-down and the "+"; a field's `dataTypes` and `fieldBelongsTo` deprecated | T-165 |
| 2, graphic images | The tactical graphic draw result (ADR-0043 point 9) carries images, each with its position in longitude and latitude, its anchor, size and rotation. Symbology's worker returns mil-sym-ts's inner icons for the 21 graphics drawn without them in M5 (minefields, the mine line, CBRN contaminated areas). `map-view-2d` draws them with the graphic, offline like everything else | HW |
| 3, display | **Speed vector in steps:** `speedVectorSeconds`, one of 5, 10, 15, 30, 60, 120, 300, 600, 1 200 and 1 800 s, or 0 to hide; `speedVectorMinutes` deprecated; stored values move to the nearest step (Q5). **Sensor reports:** a `dataTypes` entry may declare `sensorReport: true`, and `gmti` declares it for `gmti.detection` (Q4) | T-164, T-151 |
| 4, settings forms, if needed | The PDA first checks what 1.4.0 offers. **Fields by direction:** a `visibleWhen` beside `enabledWhen` (CR-0028), so that `gmti` hides the remote fields of an `in` link. **Collapsible sections:** a hint naming an array item's title field, if the shell cannot find one by itself. **A layer's classification:** the policy's classifications in their configured order in the plugin context, for the new-layer dialogs, if the context lacks them. **Map Pane icons:** a shared style for the corner icons, if one belongs in the web SDK | T-160, T-161, T-171, T-162 |
| 5, moved objects | The object writer keeps an existing object's layer (ADR-0053 point 7), if Q1 is answered as recommended | T-155 |

**No contract change** for:
- T-153, panels start collapsed: the shell's default, unless the SDK's panel defaults say otherwise (the PDA checks);
- T-154, the active layer on the map: the map view's `activeLayer` exists already; a brief edit for `map-view-2d`;
- T-155's actions themselves: the shell's, as Delete is;
- T-168 and T-169, unless the output kinds or the sensor report change: the PDA decides in their brief edit and adds a part if needed;
- T-170, the Labeling setting: ECore's settings store and the Settings workspace, connected to nothing.

## 3. Tracks and order

| Track | Work | Owner | Starts |
|---|---|---|---|
| A, design | ADR-0053 (T-155) and ADR-0054 (CR-0038) on `aca/m6-adrs`; then the index notes on ADR-0023, 0043, 0046 and 0048 as their parts are approved | ACA | when the owner approves this plan |
| B, contracts | part 1 from CR-0038; the CR for parts 2 to 5 after ADR-0053; each part built and merged into `integration/sdk-v1.5`; the freeze | PDA | at once (part 1) |
| C, briefs | part 1's edits (`draw-symbols`, `draw-shapes`, `draw-tactical`, `cot`, `ais`, `gmti`, `adsb`, the simulator); part 2's (`symbology`, `map-view-2d`, `draw-tactical`); T-168 with T-169 in one edit of the simulator's and `gmti`'s briefs; T-160 (`gmti`); T-154 (`map-view-2d`); T-151 (`symbology`); T-171 (`layer-panel`) | PDA | with B |
| D, core | **at once, in parallel:** T-153, T-161 and T-162 (the shell's parts). **Then:** part 1's store and expiry; T-155's two actions after ADR-0053; T-171's "+" dialog; part 4's form changes | CDA | at once |
| E, plugins | part 1: the three editors and the in plugins' sets; part 2: `symbology`, then `map-view-2d`, then a check in `draw-tactical`; T-151 (`symbology`); T-154 (`map-view-2d`); T-160 (`gmti`); T-162 (`coordinates`); T-171 (`layer-panel`); part 5 in `cot`, `ais`, `adsb`, `gmti` and the simulator | those PCAs | per part and brief |
| F, simulator sensors | T-168 with T-169: the job area and the two sensor types; the GMTI radar's dwells computed from the targets (the owner's priority rule: every target in range is sent first) | PCA-simulator, PCA-gmti | after T-158 is merged (M5) and the brief |
| G, Labeling (T-170) | **Its own track, iterated with the owner** (below) | CDA; the PDA for the brief | at once, round 1 |
| H, tests | the M6 flows: field sets by data type, the drop-down and "+", the select without the three types, a hand-placed `ais.vessel` that does not fade; move and copy, with a locked layer and without permission; graphic images; the speed vector's steps; sensor report symbols; the simulator's sensor types and job area into `gmti` | ITA | as each lands |
| I, release | the M6 release, in the name emcc, with the UDA's manual | MCA, UDA | when E, F and H are done |

**T-170, the Labeling setting, in short rounds.** Each round ends at an owner checkpoint. Nothing is built past a checkpoint before the owner answers.
1. **Round 1, three ways of doing it,** as picture examples. For example: one table with a row per label; a form of three parts (Policy, Classification, Releasable To) that shows the label's string as it is built; a list of policies, each with its classifications and releasability values.
2. **Round 2, the chosen way in detail:** pictures of adding, editing and deleting a label, an empty list, a long Releasable To, and the errors.
3. **Round 3, built** in the Settings workspace with its storage; the owner checks it in the browser.
4. **Round 4, the owner's fixes,** as often as the owner wants within M6.

The pictures are static mock-ups in a spike folder, `spikes/t170-labeling/`, which the owner relays (Q6: the CDA makes them).

**The order:**
- **T-165's chain is the longest and starts first:** part 1, eight brief edits, the CDA's store and expiry, three editors and five in plugins, then the ITA. The PDA starts part 1 from CR-0038 at once; ADR-0054 follows without holding it.
- **Part 2 is the second longest:** the SDK, then `symbology`, then `map-view-2d`. The PDA writes the CR for parts 2 to 5 next and builds part 2 first.
- **T-168 and T-169 go together,** in one brief edit and one build by PCA-simulator, with PCA-gmti for the dwells in and out.
- **The CDA's UI tasks T-153, T-161 and T-162 start at once** and run in parallel with everything else. T-170's rounds run beside them.
- **The PDA is the bottleneck again.** Its proposed order: part 1 and its briefs; the CR for parts 2 to 5; part 2 and its briefs; the T-168 and T-169 brief; part 3 with T-151; part 4 with T-160 and T-171; part 5; T-154's brief.

## 4. Questions for the owner

| | Question | Options | Recommended |
|---|---|---|---|
| Q1 | An incoming track is moved to another layer. Where does the in plugin's next report put it? | **A** it stays where the user moved it; the link's layer is where new tracks appear (part 5). **B** it goes back to the link's layer | **A:** otherwise a move of a live track lasts only seconds |
| Q2 | What is a copy of a live track? | **A** a snapshot: a hand-made object with the user as its source and no observation time, so it stays. **B** an exact copy, which fades and goes with the original's data type | **A:** a copy is made to keep something |
| Q3 | Can objects be moved or copied to another workspace's layer, e.g. from Simulation to View? | **A** no, the current workspace only in M6. **B** copy to other workspaces too; a move cannot, since the store refuses it today | **A:** the simplest; B can follow later |
| Q4 | How does `symbology` know that an object is a sensor report (T-151)? | **A** its data type declares `sensorReport: true` (part 3). **B** a list of data types in symbology's settings | **A:** the declaring plugin keeps it, as with `manual` (CR-0038) |
| Q5 | What happens to stored speed vectors in minutes when the steps come (T-164)? | **A** each becomes the nearest step; above 30 min it becomes 30 min. **B** every user starts again from the default | **A** |
| Q6 | Who makes T-170's picture examples? | **A** the CDA, who builds the setting. **B** the ACA, then the CDA builds the chosen way | **A** |
