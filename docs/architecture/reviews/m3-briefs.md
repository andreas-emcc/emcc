# ACA review of the M3 plugin briefs (T-078)

The ACA reviews the PDA's M3 briefs (T-077) before the owner approves them. Each is checked against ADR-0036 to ADR-0041, `docs/architecture/m3-simulator-decisions.md` (Q1 to Q30, A1 to A18), the frozen SDK 1.2.0, spike S6, and the ACA's notes on CR-0025 (`cr-0025-sdk-1-2-0.md`, N1 to N9). This file grows as the PDA delivers the briefs.

**Numbering:** Q and A numbers are those of the decisions record. A brief's own questions are written "open question N".

Owned by the ACA. Like the rest of this folder, it is not `docs/reviews/`, where the CRA's and SRA's reports stay with the reviewer (`CLAUDE.md` section 8).

## `cot` for M3 (2026-10-26)

- **Reviewed:** `pda/cot-brief-m3` `8826374`: `docs/plugins/briefs/cot.md`, the M3 update, functions 11 to 22 and criteria 14 to 26, with the owner's answers to its open questions 6 to 9.

### What fits

- **ADR-0036:** every connection runs in a connection task, and the listener goes. The rules on addresses hold:
  - a UDP link that listens binds to loopback unless an admin names an address (`ListenAddress.from`);
  - a multicast link needs an interface an admin names, and stays stopped without one (R4, P2-1);
  - hosts, ports and groups come only from the settings, the manifest declares `connections`, and each link reports its status.
- **ADR-0037:** links in, out and both on one connection; target layers by the picker; source layers; never sent back to the link it came from, checked by `dataSource` and by the last change's link, which is stricter than point 3; an output channel per output link, which can send a delete; coalescing per object; skips counted and logged at most once a minute; the highest classification, by default the default label's (Q30); symbols only, with the fall-backs of Q7.
- **The owner's answers of 2026-10-26:**
  - open question 6, no migration, as ADR-0037's index row now records (`ff39a4f` on `main`);
  - open question 7, the declared fields `team`, `role` and `staleSeconds`, editable by others and without `dataTypes` (ADR-0038);
  - open question 8 as amended, with `refreshSeconds` and one timer per link;
  - open question 9, as narrowed for channel items.
- **ADR-0039:** the picker offers View's layers, and every store query names its workspace.
- **The ACA's notes:**
  - N1: two links that name the same new layer share one, and the status shows each link's actual layer (function 13, criterion 22);
  - N8: a renamed link withdraws its old channel id (function 15, criterion 20);
  - N9: the queries name `core.view` (function 14).
- **The SDK:** every name the brief uses is in the frozen SDK 1.2.0: `channels().offer`, `ChannelCapability.DELETE`, `classifications().within` and `knows`, `ClassificationLimit.from`, `ConnectionRef.count`, `ListenAddress`, `TaskContext.tls`, `ObjectQuery.inWorkspaces`, and the manifest's field types `choice` and `integer` with `unit`.
- **Stored settings:** keeping the settings schema's top level open, so that stored `streams` still validate and the plugin can say it found them, is right. ECore delivers no settings that fail the schema (`sdk-v1.md`).

### Nits (PDA)

- **C1. The owner's answer to open question 6 and ADR-0037 are in line now.** Open question 6 says the difference is "for the ACA to bring in line", and function 11 that ADR-0037's consequences "speak of migrated settings". Both can cite ADR-0037's index row instead (`docs/adr/README.md`, `ff39a4f` on `main`).
- **C2. Multicast test peers are not on loopback.** The header of the M3 criteria speaks of "UDP and multicast test peers on loopback". ADR-0036's index row (2026-10-26) and `agents/ita.md` say that the multicast test peers use an interface that carries multicast. Criterion 14 already says "on a named interface".
- **C3. A UDP `both` link uses one port at both ends** (function 12). A test peer on the same host must then bind another address, for example `127.0.0.2`. One line for the PCA and the ITA avoids a test that sends to itself.

### Verdict

**The brief fits the decisions and the frozen SDK. It is ready for the owner's approval;** C1 to C3 can be fixed before or with it.

## The simulator (2026-10-26)

- **Reviewed:** `pda/simulator-brief` `e78aca5`: `docs/plugins/briefs/simulator.md` (new), with the PDA's questions to the ACA on its open questions 15 and 16.

### What fits

- **ADR-0039 and Q22 to Q29, A15 to A18:**
  - the workspace `simulator.simulation` after View, with the three permissions;
  - the simulation in users' layers marked with the workspace, and never in View's layers;
  - the server's filter;
  - panels and actions in Simulation only;
  - the web part's live picture naming its workspace.
- **ADR-0040:**
  - routes as `simulator.route` objects with markers (point 4);
  - movement along geodesics, with ramps, the time helper and units (point 5, A9, A10, Q11 to Q13);
  - editing while running (point 6, Q14);
  - convoys and formations (point 7, Q15, Q16, A13);
  - events, hiding and showing again (point 8, Q17, Q18, A12 to A14);
  - control, reset, stop and restart (point 9, Q19, A9);
  - outputs chosen by `plugin.simulator.edit`, with a removal on a hide (point 10, Q3b);
  - the engine once a second without a browser (point 1, A2);
  - the round trip of Q20.
- **ADR-0041:**
  - only moves are marked `notSaved()`, and only by the simulator (points 1 and 7);
  - the saving moments of point 4 with no periodic save;
  - the restore from its own state after a restart, paused (point 5);
  - the best-effort clean stop (point 6).
- **A8 with `cot`:**
  - each item sent carries an expiry of `outputStaleSeconds` after the tick, which `cot` takes as its stale time (`cot` function 18);
  - `cot` sends channel items as they come (its function 19, as narrowed), so standing tracks stay fresh, and a paused simulation's go stale.
- **The ACA's notes:** N8 (function 18, criterion 14), N9 (function 2), and W3 (function 22, criterion 23).
- **S6:** the figures quoted match `spikes/s6/README.md`: about 5 % of a core, submit to answer p95 15 ms, every tick answered within 44 ms, at most 82 ms on a saturated machine. The tick is one burst, as S6 measured it.
- **The SDK:** every name is in the frozen SDK 1.2.0 except POST endpoints. The brief leaves those to the change request the owner chose, now CR-0026 (`pda/cr-0026-post-endpoints`, proposed), and builds nothing in their place.

### Findings (PDA, before the owner approves)

- **S1. The server part's writes of derived values can undo a user's edit, and the brief names two places for those values.**
  - Function 6 has the server part write the lengths, the times and the speeds from typed times into the route's extension, with an update built on the latest version it holds.
  - An update replaces the core fields as a whole and the requester's namespace as a whole (model rule 5, ADR-0018; `ObjectStore.mergeExtensions`), and `baseVersion` is not enforced. So a user's edit that lands between the server part's read and its write is undone, the route's geometry included. It comes back only when the server part computes again from the user's version, so the route jumps back and forth on every map in between.
  - Function 24, meanwhile, serves "the computed lengths and times" from GET endpoints.
  - **Recommended:** the route's extension keeps only what users type: the value, its kind, its unit, whether it was typed last, and for a typed time whether it counts from the previous point or from the route's start. The server part computes the rest, uses it in the engine, and serves it through the GET endpoint of function 24, with the route version it computed from, so the editor knows when the values match what it shows. The ACA reads "both are kept and shown" (Q12, ADR-0040 point 5) as both always available to the editor and the engine, the one not typed last computed from the one typed. The server part then never writes derived values, so they race with nothing, and moving a point costs no second update.
  - If the PDA keeps the writes, the brief must say how a user's edit that lands in between is kept, and drop the GET for those values.
  - **The server part's other writes have the same exposure,** with a smaller window: "Put on route" and "Take off route" (function 10), taking a deleted track off its route (function 9a), the events' updates (function 13), and the saves of all tracks (function 20). Each is built from the state the worker holds, so a user's change in the moments before it can be undone. The brief should say that each is built from the latest version held, and that this small window is accepted.
- **S2. After a restart, two sources must agree.** With open question 16, a route's object list is in the route's extension, saved with each change, while each object's progress is in the documents, saved at the moments of ADR-0041 point 4.
  - Function 21 says that a track the state does not know "stays where it is, on no route". But the route's list, saved later than the documents, may name it.
  - **Add the rule:** after a restart, the routes' lists say which objects are on which route. An object on a list without saved progress is placed as "Put on route" places it (open question 9). Progress for an object on no list is dropped.
  - Open question 15's recommendation narrows the gap, but a crash between the route's write and the save still leaves one.
- **S3. Edits to a route by other plugins.** `draw-shapes` works in Simulation (Q27), and its Edit reshapes every `core.shape`, also one another plugin made. It can also change the data type and the layer. The brief should say what happens:
  - **An edit without the move-or-disconnect choice** (function 9), such as a reshape in `draw-shapes`: recommended, the objects move with the route, as when the user picks "move with it". The server part must also tell whether a stored choice belongs to this edit, since an edit by another plugin leaves the simulator's extension as it was (ADR-0018).
  - **A route that becomes invalid while it runs,** for example a point added without its entry: recommended, the route pauses, its objects stay in place, and the routes panel says why.
  - **A route whose data type is changed** is no longer a route: recommended, as for a deleted route (function 9a), its objects are disconnected.
  - The brief for the reused plugins in Simulation (T-077) could keep `draw-shapes`' Edit away from `simulator.route` objects, since the route editor is where routes are edited. The simulator must cope anyway, since the server does not trust a browser.

### Remarks (PDA, may go with the approval)

- **S4. The subscription's limit at 1 000 tracks.** The simulator's own subscription receives its 1 000 moves at each tick, against `Store.MAX_PENDING_UPDATES` of 1 000.
  - S6's stand-in subscription never fell behind: no new snapshot in any scenario, with a lag p95 of 6 to 13 ms. But it did almost no work (0.1 % of a core), while the simulator's worker computes the tick itself, so its result may differ.
  - Function 17a already counts new snapshots. Criterion 21 should state the count expected at 1 000 tracks: none. If there are any, the PCA raises it with the CDA and the PDA through the MCA before T-083 ends.
- **S5. Events move too.** ADR-0040 point 2 lists the events, as well as the groups, with the documents. The brief keeps each point's events in the route's extension (function 4). Open question 16 should name both, and so will the ADR's index line.

### Open question 15: changes while everything is paused

**The ACA confirms the PDA's reading and supports its recommendation:** save such a change at once.
- ADR-0041 point 4 lists when the simulator must save around a run. It replaced a periodic save, and does not forbid a save at another moment.
- Point 5 needs tracks and state to agree after a crash. A change while paused, such as "Put on route", a disconnect or the choice of outputs, writes the route and the tracks at once. But the objects' progress and the chosen outputs are in the documents, and would otherwise live only in memory until the next run.
- A save covers all tracks and the whole state, as point 4 says. Nothing moves while paused, so it costs one burst.
- **Once the owner approves it,** the ACA adds a line to ADR-0041's index row, with the date and the approved brief as where it is described:
  - a change to the simulation while everything is paused is saved at once, too;
  - with open question 16, "its own state (ADR-0040 point 2)" in points 4 and 5 no longer holds the groups and the points' events, and after a restart the routes' lists say which objects are on which route (S2).

### Open question 16: the groups in the route's extension

**The ACA supports the recommendation,** with S2 and S5:
- ADR-0040 point 4 already keeps the points' values in the route's extension. The groups and the points' events are the route's definition too.
- Users change them through change requests, so the store checks `plugin.simulator.edit` on each (ADR-0039 point 7). The server part's own writes, such as "Put on route", carry no user, and the endpoint's `requires` guards them (function 10).
- Each change is saved with the route at once. When one request carries both, it is atomic with an edit of the route's points.
- **The ACA reads it as a change of a detail of point 2,** not a reversal: two items point 2 lists move from the documents to the route object, while its decision stands. The simulation is still one, shared, kept over a restart and paused after it, and the documents keep its run state. `docs/adr/README.md` lets the owner take the index-note path for it. Approving the brief with open question 16 is that choice, and no new ADR is needed.
- **Once the owner approves it,** the ACA adds a line to ADR-0040's index row, with the date and the approved brief as where it is described: the groups and the points' events are kept in the route object's extension, not in the plugin's documents.

### Verdict

**The brief fits the decisions, the frozen SDK and S6, and carries N8 and N9.** It is ready for the owner's approval once S1 to S3 are fixed. S4 and S5 can go with it.

The ACA recommends that the owner approves open questions 15 and 16 as the PDA recommends. The commands wait for CR-0026.

### Recheck (2026-10-26)

- **Rechecked:** `pda/simulator-brief` `177b059`, with S1 to S5 taken, the owner's answers to open questions 2 to 17, and the owner's own open question 18 (2026-10-26).
- **S1:**
  - the route's extension keeps only what users type, with a time's reference and its rounding unit (function 4);
  - the server part computes the rest and serves it by GET with the route version (functions 6 and 24);
  - its other writes are built from the latest version held, and the small window is accepted (function 9a; owner, 2026-10-26).
- **S2:** the routes' lists decide which objects are on which route after a restart (function 21, criterion 20). Function 21 also counts progress saved for another route as none; criterion 20 does not test that case yet.
- **S3:** function 9b covers each case:
  - an edit without the choice moves the objects with the route, and a numbered choice tells a stored choice from a new one;
  - an invalid route pauses and says why;
  - a changed data type disconnects the objects;
  - a route moved out of Simulation is treated as deleted.

  Criterion 25 tests all but the last.
- **S4:** criterion 21 expects no new snapshot at 1 000 tracks.
- **S5:** open question 16 names the points' events.
- **The SDK references:** SDK 1.2.0 with CR-0026 folded in, and `sdkVersion` `^1.2.0`, as the CR says.
- **Open question 18, units:** the owner adds mph to Q13's units, and each user's choice is remembered in the user's setup (`ctx.setup`).
  - That fits ADR-0040 point 5's "kept in the user's own documents (ADR-0027)": setups are the user's documents under `core` on the server (ADR-0031 point 5 and its consequences), and each plugin saves its own share in them.
  - **But the units follow the setup:** a setup is per workspace, and picking a named setup restores its units too. They are not one choice for the user everywhere.
- **The owner's other answers** (the limits, `outputStaleSeconds` from 1 to 3 600 s) are the owner's and touch no decision.

**Nits for the PDA, which may go with the approval:**
- criterion 20 tests progress saved for another route;
- criterion 25 tests a route moved out of Simulation;
- the PCA tests that picking a named setup restores the units.

**The brief is ready for the owner's approval.** Once it is approved, the ACA adds the index lines on ADR-0040 and ADR-0041 (open questions 16 and 15), and a line in `docs/architecture/m3-simulator-decisions.md` that open question 18 adds mph to Q13's units, kept in the user's setup.

## The reused plugins in a workspace (2026-10-27)

- **Reviewed:** `pda/m3-reused-briefs` `d6fee63`, from `integration/sdk-v1.2` `f66d062`, documentation only:
  - the briefs README's "M3: the reused plugins in a workspace" (rules 1 to 9, the table, the order, open question M3-1);
  - the M3 sections of `map-view-2d`, `layer-panel`, `draw-symbols`, `draw-shapes`, `object-list`, `coordinates`, `bookmarks`, `basemap-osm` and `basemap-naturalearth`.

  The head includes the PDA's fixes to its own conformance review (`dea0cf7`), so this review checks the fixed text.
- **Against:**
  - ADR-0038 to ADR-0041, with Q22 to Q29 and A15 to A18;
  - the approved `simulator` and `cot` briefs;
  - the frozen SDK 1.2.0: `sdk-v1.md` parts 4 and 5, the web SDK's `workspace.ts`, `services.ts`, `actions.ts` and `components/fields.tsx`, and the web test kit;
  - the ACA's W1 and W3.

### What fits

- **ADR-0039:**
  - one map for the workspace shown, restored per workspace from the shell's setups, with running interactions ended on a switch (points 3 and 8; `map-view-2d` function 22);
  - panels, overlays and actions name the workspaces they appear in, through the SDK's `workspaces` and `'*'` (point 4, A15), and the top bar stays the same (A16);
  - a layer made in a declared workspace carries that workspace's id, and an update never carries another one (point 5, Q29; `layer-panel` function 17);
  - each workspace shows its own layers. View's layers appear only as a read-only reference, off by default and listed apart (point 6, A17; `layer-panel` function 20, `map-view-2d` function 23);
  - in a declared workspace every change needs its `editPermission`, and the hint names the workspace. The server checks anyway (point 7; rule 4);
  - bookmarks are shared, and setups are per workspace (point 8);
  - all eight items of point 9 (Q27) are covered, and `draw-symbols` and `draw-shapes` draw only into the workspace's layers (A17).
- **ADR-0038, in `draw-symbols`:**
  - the "+" uses the shared editor;
  - an update names only the changed fields, so newer values that others set survive (point 3). Criterion 28 is the PCA's counterpart of the ADR's test case for the ITA;
  - the store checks each field and gives the reason (point 2);
  - declared fields need no permission of their own (point 4, read with ADR-0039 point 7);
  - a removed plugin's fields are not offered, and their values stay on the object (point 6);
  - the data type's fields show at once and the rest come through the "+", which is the reading of point 5 that the ACA accepted at part 4.
- **ADR-0040:**
  - tracks are placed with `draw-symbols` in Simulation (point 3);
  - hidden tracks are faded through `MapView.createFadeList` (point 8);
  - routes stay editable in `draw-shapes`, which the simulator's function 9b covers.
- **ADR-0041:** nothing here touches it. The web SDK has no `notSaved`, and the map view draws an unsaved move like any other.
- **The SDK:** every name the briefs use is in the frozen SDK 1.2.0:
  - `VIEW_WORKSPACE`, `EVERY_WORKSPACE`, `WorkspaceInfo.editPermission`, `ctx.workspace.onChange`, `appearsIn`, `workspaceOf` and `LivePictureOptions.workspaces`;
  - `MapView.createFadeList` and CR-0020's `signal`;
  - `DeclaredFields`, `fieldValuesOf`, `changedFields`, `fieldProblems`, `fieldBelongsTo` and `changeRequests.withFields`;
  - the test kit's `switchWorkspace`, `liveSubscriptions`, `objectActions`, `declaredFields` and `checkLookCss`.
- **The ACA's notes:**
  - W1: rule 7 (`ctx.workspace`, `ctx.workspaces`) and `map-view-2d` function 24 (`createFadeList`) work without the optional members and say they become required before M3 reaches `main`. `draw-symbols` function 20 works without `ctx.declaredFields` but does not say so (U7).
  - W3: `draw-symbols` function 22 and criterion 33.
  - N1 to N9: none applies here.
- **Project rules:**
  - the criteria test positions with latitude ≠ longitude (`map-view-2d` 45, `bookmarks` 14, `coordinates` 10);
  - nothing new reaches the internet;
  - S6's load is kept as a criterion (`map-view-2d` 49).

### Findings (PDA, before the owner approves)

- **U1. Two plugins set the active layer at a switch, in no set order.**
  - On a switch, two plugins act on the active layer:
    - `map-view-2d` (function 22) sets the layer last active in that workspace, or none on a first visit, from its `onChange` listener, the last step of the switch (`CurrentWorkspace`);
    - `layer-panel` (function 21) makes the top layer active when there is none. It does not say when it acts: on the fresh snapshot, which comes before `onChange`, or from its own `onChange` listener.

    The SDK does not say in which order plugins' `onChange` listeners run.
  - If `layer-panel` acts first, the old workspace's layer is still active. It then either picks the new workspace's top layer, if it treats the old layer as missing, or does nothing, if it reads "with none" literally. The map view then sets none. Either way, a first visit ends with no active layer, and placing waits.
  - **Fix:** `layer-panel` makes the top layer active whenever the active layer is none or is not one of the workspace's layers, at any time, not only at the switch. Function 4 already does this when the active layer is deleted.
    - Whatever the order, it then ends right: the map view's remembered layer stands, and the top layer fills a gap.
    - The same rule covers a remembered layer that was deleted meanwhile.
    - A criterion covers both triggers and both orders.
- **U2. What the map view ends at a switch has no set moment, and the simulator gets no fresh snapshot.**
  - At a switch the map view ends running interactions and clears every fade list, "after the shell's own steps" (`map-view-2d` function 22).
  - The SDK's switch steps (`CurrentWorkspace`: the panels mounted, fresh snapshots, setups restored, then `onChange`) do not include that. So the map view does it from its own `onChange` listener, after the fresh snapshots and in no set order with other plugins' listeners. That is too late for plugins that react to the switch:
    - a plugin that follows the workspace sets its fade list again from the fresh snapshot, as `map-view-2d` function 24, the SDK's documentation of `createFadeList` and `docs/plugins/design-pattern.md` tell it to. The map view then clears that list;
    - a plugin that starts an interaction again from its own `onChange`, as `draw-symbols` function 19 does for placing, may have it ended if its listener runs before the map view's.
  - **The simulator's web part gets no fresh snapshot.** It subscribes with `workspaces: ['simulator.simulation']` (its function 22), and only subscriptions that follow the workspace shown get one (`CurrentWorkspace`).
    - After a switch from View back to Simulation, its hidden tracks show unfaded until its picture next changes.
    - While a simulation runs, that is the next tick, if the web part sets the list on each batch. With everything paused, it is when a user next changes something.
  - **Fix:**
    - the switch gives the map view a set moment to end interactions and clear the lists, before the fresh snapshots and before any `onChange` listener: for example when the shell mounts the Map Pane, or a step of its own. That is for the shell (CDA, T-080) and `map-view-2d`, and the SDK's switch steps name it. The criteria then test that a list set from the fresh snapshot, and placing started again from `onChange`, both survive the switch;
    - function 24 says that an owner whose subscription names its workspace sets its list again from `ctx.workspace.onChange`, from what it holds;
    - one line in the simulator's function 22 says the same, with a criterion: switch to View and back while paused, and the hidden tracks are faded again within 1 s. The simulator's brief is approved, so that line goes to the owner with this approval;
    - the SDK's sentence and the design pattern's line ("set it again from the fresh snapshot") change with it (see U6 on how).
- **U3. `draw-shapes` leaves out the "+", but ADR-0038 point 5 reads as a rule for every editor.**
  - Point 5 says: "Editors show declared fields … the core fields first, then a "+"". Its consequences name only `draw-symbols` and the simulator as editors.
  - `draw-shapes`' edit panel is an editor. `cot`'s fields have no `dataTypes`, so they belong to shapes too (point 1).
  - No M3 flow reads declared fields on shapes: the simulator sends only tracks, and `cot` sends only symbols.
  - **For the owner, with `draw-shapes`' approval:**
    - **Recommended:** keep the "+" out of M3, as the brief says, and the ACA adds that decision to ADR-0038's index row.
    - **Alternative:** add it now with the shared editor, as `draw-symbols` function 20 does, without the placing part. That needs no index line, but adds work to T-085.

### Remarks (PDA, may go with the approval)

- **U4. A17 depends on who fills the selection.**
  - The selection may hold ids of objects the map does not hold, set by any plugin (SDK 1.1.0).
  - With open question 6 as recommended, nothing in M3 puts a View object into Simulation's selection.
  - But A17 is a rule of the browser only (ADR-0039 point 6): the server does not know which tab is shown.
  - A cheap guard closes it for later plugins as well: `draw-symbols`' and `draw-shapes`' panels show a selected object whose layer is not one of the workspace's layers as read only, with a hint. They already hold those layers.
- **U5. The placing values and a switch.**
  - The shell may mount the panels again on a switch (`CurrentWorkspace`; rule 3), so whatever a panel component keeps is lost.
  - Function 19 keeps the data type the same in every workspace. Function 21 should say the same of the placing values, kept in the plugin rather than in the panel (recommended), or say that a switch clears them.
  - Criterion 29's "or no `dataTypes`" is already part of `fieldBelongsTo`.
- **U6. Other plugins rely on the selection being cleared at a switch.**
  - `draw-symbols` function 19, `object-list` function 12 and rule 3 rely on it.
  - But the SDK's switch steps (`CurrentWorkspace`) do not name it, and the fake map view does not do it (rule 9; the PDA's follow-up).
  - Once the owner decides `map-view-2d` open question 4, the SDK documentation and the fake should say it, together with U2's moment and sentence.
  - Neither change adds a member, but both change the frozen SDK folders, and the owner's W1 decision covers only tightening the nine members. Allowing them is the owner's decision: a change request, or the owner's explicit exception.
- **U7. Wording.**
  - `draw-symbols` open question 1 quotes "when a symbol is created" as point 5's words. They are ADR-0038's context; its consequences say "create and edit dialog".
  - Rule 1 says "a plugin never names another plugin's workspace id", but rule 4 names ids taken from `ctx.workspaces`. Say "never writes one in its code".
  - Rule 2: `layer-panel`'s reference subscription names `['core.view']` alone, not "as well".
  - `draw-symbols` function 20 works without `ctx.declaredFields`, but unlike rule 7 and `map-view-2d` function 24 it does not say that the member becomes required before M3 reaches `main` (W1). Add the clause.

### The PDA's open questions

The ACA's view on each, for the owner:

- **M3-1, every workspace (`'*'`): supported.**
  - ADR-0039 point 4 lets each plugin choose.
  - With `'*'`, a later workspace gets the map, the layers and the tools without a change to each plugin.
  - No plugin needs the simulator's id. It is the same reasoning by which the owner kept the shell from knowing the simulator (ADR-0039, alternatives).
  - Rule 4 keeps the permissions right in each workspace.
  - The cost appears with a later workspace that wants fewer tools, such as a read-only Replay. That is decided when such a workspace comes.
- **`map-view-2d` open question 3, View's reference layers drawn under the workspace's own layers: supported.**
  - One more reason: `layer-panel` orders each workspace's layers within that workspace (its function 19). So View's and Simulation's `drawOrder` values are separate ranges, and mixing them by number would give an order that no user set.
- **`map-view-2d` open question 4, the selection cleared on a switch: supported.**
  - It is what ADR-0039 point 3 describes: a switch works "like a new connection with another filter".
  - It keeps the shared Delete and every action on the workspace shown.
  - With U6.
- **`map-view-2d` open question 5, the first visit keeps the map: supported.**
  - Q23 restores a workspace's own state. On a first visit there is none, so either option fits.
  - Keeping the map opens Simulation over the area the user was already working in.
- **`map-view-2d` open question 6, reference objects drawn only: supported, and the ACA would keep it.**
  - It makes ADR-0039 point 6 and A17 hold in one place.
  - The alternative needs a check of each object in `draw-symbols`, `draw-shapes` and the shell's Delete, and in every later editor.
  - U4 is a backstop, not a replacement.
- **`draw-symbols` open question 1, values for new symbols kept until changed or reload: supported.**
  - It is what ADR-0038 asks: its context speaks of the "+" when a symbol is created, and its consequences of `draw-symbols`' "create and edit dialog".
  - The alternative, fields only after placing, departs from that and would need a line in ADR-0038's index row.
  - With U5.
- **`draw-shapes` open question 4, Edit kept for routes: supported.**
  - The simulator copes with a reshape, a new data type and a new layer (its function 9b), as it must, since the server does not trust a browser.
  - `draw-shapes` stays free of the simulator's data type.
  - A reshape that adds a point pauses a running route until the route editor gives the point its values (function 9b), and the routes panel says why. That is visible and safe.
  - The ACA's S3 left this open. With 9b in place, keeping Edit costs the simulator nothing.

### The points for the CDA (T-080)

The PDA raised two; the ACA adds a third.

- **The shell's shared Delete needs a declared workspace's edit permission in that workspace: this fits ADR-0039.**
  - Point 7 makes a change to a declared workspace's objects need its edit permission "instead of `objects.edit`", which stays View's.
  - ADR-0032's Delete with `objects.edit` is then View's case, so no ADR changes.
  - **The ACA adds:** the Delete fetches each object before deleting it, so it knows each object's layer.
    - It should delete only objects in a layer of the workspace shown, in View too, and list the others as not in that workspace.
    - Then A17 holds for the one action that deletes in bulk, whoever filled the selection (U4).
- **"Default" when Simulation has layers but View has none: ADR-0039 does not decide it.**
  - Today ECore creates "Default" at start when the store has no layers at all (`ECore.start`), so Simulation's layers would prevent it.
  - **The ACA recommends counting View's layers only:**
    - the owner's rule of 2026-10-05 was made when every layer was View's;
    - View is ECore's own workspace (point 1);
    - whether View gets "Default" should not depend on layers that some of View's users may not see (point 7).
  - ECore never creates a layer in a declared workspace. There, `layer-panel` shows "Create first layer".
  - The case arises only when users have deleted View's last layer before a restart.
  - This applies the owner's rule to workspaces, so the owner confirms it. `layer-panel` functions 8 and 17 then say "when View has no layers".
  - Keeping the rule as written also works: View then shows "Create first layer".
- **One more for T-080, outside these briefs:**
  - The Settings tab's Layers entry changes a layer's classification with `layers.edit` and raises objects with `objects.edit`.
  - For a declared workspace's layer, the server needs that workspace's edit permission (point 7).
  - T-080 should say which layers the entry lists and which permission it checks.

### Verdict

**The briefs fit ADR-0038 to ADR-0041, the approved `simulator` and `cot` briefs and the frozen SDK, and they carry W1 and W3.**

- They are ready for the owner's approval once U1 and U2 are fixed.
- U3 is the owner's choice, with `draw-shapes`.
- U4 to U7 may go with the approval.

The ACA recommends that the owner decides M3-1, `map-view-2d`'s open questions 3 to 6, `draw-symbols`' open question 1 and `draw-shapes`' open question 4 as the PDA recommends.

### Recheck (2026-10-27)

- **Rechecked:** `pda/m3-reused-briefs` `9b47a70` (the PDA's branch, merged up to `integration/sdk-v1.2` `218a8a3`), documentation only. Since the review's `d6fee63`, it holds:
  - the owner's decisions A to E of 2026-10-27, and U1 to U7 (`b69ec27`, with the PDA's own review fixes in `8caa31d`);
  - `cot`'s amendments: the owner's decisions on PCA-cot's part 3 and on open question 10 (`67c57ec`, `f2b669a`, `e3c2aaf`, with the PDA's own review fixes in `f9f170d`);
  - the `simulator` brief's amendment: the owner's answer to PCA-simulator's question 8 (`e3c2aaf`, `f9f170d`).
- **Against:**
  - the review's U1 to U7 and the owner's A to E;
  - SDK 1.2.0 on the integration branch, with D1 (`dd71948`);
  - what is built: `cot`'s part 3 (`pca-cot/m3-channels` `aefec48`, merged as `6d8038d`), and the simulator's part B2 (`218a8a3`).

**The reused plugins:**

- **U1 is fixed.**
  - `layer-panel` function 21 fills a missing or foreign active layer with the top layer at any time: when the active layer changes, and when the layer list changes. Criterion 22 tests both triggers and both orders of the `onChange` listeners.
  - `map-view-2d` function 22:
    - takes the old workspace's active layer at its moment;
    - records no change of the active layer until its own `onChange` listener has run;
    - remembers per workspace only a layer of that workspace.

    So a layer that `layer-panel` fills in from the fresh snapshot never replaces the remembered one (criterion 46).
  - Whatever the order, a switch ends with the remembered layer, or with the top layer on a first visit or when the remembered one was deleted.
- **U2 is fixed.**
  - SDK 1.2.0's `CurrentWorkspace` now lists the switch's steps, with the map view's moment before the fresh snapshots and `onChange` (D1).
  - Rule 3, `map-view-2d` functions 22 and 24, criteria 44, 48 and 50, and the design pattern's two lines say the same.
  - **The simulator's function 22** has the owner's line (B): its web part sets its fade list again from `ctx.workspace.onChange`, since its subscription names its workspace. Criterion 26 tests that the tracks are faded again within 1 s.
- **D1 stayed within its limit.** On the integration branch it changed only documentation comments and the fake map view's `switchWorkspace()`, which now also clears the selection, with a test.
  - The comments are on `CurrentWorkspace`, `InteractionOptions`, `createFadeList`, `selection` and `activeLayer`, and on the test kit's two `switchWorkspace` methods.
  - No member was added or changed.
- **U4, U5 and U7 are taken.**
  - Both editors show a selected object outside the workspace's layers as read only, with criteria.
  - The placing values are kept in the plugin.
  - The wording is fixed, and `draw-symbols` function 20 has W1's clause.
- **C1:** `draw-shapes`' "Out of scope (M3)" names the decision, as ADR-0038's index line cites it.
- **The open questions** are marked as decided as recommended (A).

**`cot`'s amendments:**

- **They fit ADR-0037:**
  - a removal still goes out as a delete where the link can send one (point 4);
  - "removal not kept", "dropped" and "expired" are skips, counted per link and reason (point 7).
- **Criteria 27 and 28** test function 19's removals and the decided cases (c) to (e) of open question 10. Criteria 15 and 16 put the final real TAK check after the simulator's part B2, which is now on the integration branch.
- **The PDA's correction of (e)** (`f9f170d`) is right. Function 18 makes an item's expiry its `@stale` whenever that expiry is in the future (a past one is skipped), so an item still within its expiry is not stale, and one past it is skipped as "expired".
  - Only an item without an expiry, whose stale time comes from `staleSeconds`, can arrive stale. Function 21, criterion 28 and a dated note on open question 10 say so.
  - The simulator's items always carry an expiry: the tick plus `outputStaleSeconds`, 5 s by default. So after an outage longer than that, all its waiting items are skipped, and none is sent stale.
- **What `aefec48` already builds as decided:**
  - what a link remembers of channel items (function 19): uid, type and position until the item's stale time. Each new item renews it, at most 200 000 are kept, and stale ones are forgotten first;
  - past the cap, "removal not kept" is counted when the item is sent (open question 10 (b));
  - a removal of an item the link does not remember sends nothing (criterion 27);
  - a waiting item's times are when the worker took it from the channel (open question 10 (a));
  - items wait one per object in the task's inbox, which holds 20 000.
- **Not built yet:** (c) to (e) of open question 10. PCA-cot builds them on a follow-up branch, as the brief says. On `aefec48`:
  - (c): when the inbox is full, it evicts the oldest waiting item and counts nothing. It coalesces by object id;
  - (d): an item posted while the link was down keeps its identity. So its removal posts a stale event that replaces the waiting update, and TAK gets a stale event for a track it never had;
  - (e): the expiry is checked when the worker takes the item, not when the task writes it. So an item whose expiry passed while it waited is written, and is not counted as "expired".

**The simulator's amendment:**

- **Functions 13 and 20 and criterion 20 match part B2** (`Effects.java`):
  - the first value each event replaced is kept in the track's `simulator` extension, next to the hidden mark (`null` for an absent value);
  - it is written in the same update as the event's change;
  - a reset writes the values back and clears both.

  Criterion 20 tests that, with a worker restart between an event and a reset.
- **ADR-0040 point 2** lists "the values to restore" among the plugin's documents, and ADR-0041 points 4 and 5 rely on that list for "its own state". So, as for open question 16, the ACA notes the owner's decision in both index rows (`aca/t078-recheck`).

**Findings (PDA, before the merge):**

- **V1. Decision E is not in `layer-panel`.**
  - Functions 8 and 17 and "Depends on" still say ECore seeds "Default" when the store has no layers. Function 17 still calls the case the CDA's to confirm.
  - The owner decided on 2026-10-27 that ECore seeds it whenever View has no layers, and that functions 8 and 17 follow (`docs/status.md`, T-080).
  - **Fix:**
    - function 8: the server creates "Default" when View has no layers, also when another workspace has layers (ECore, CDA; owner, 2026-10-05 and 2026-10-27);
    - function 17: drop "whether it also seeds one … (T-080)", and say that "Default" is a View layer;
    - "Depends on" follows.
- **V2. `cot` names a mechanism the SDK does not give.**
  - Function 21 and criterion 28 say the 20 001st waiting item "is not posted (`SendResult.DROPPED`)". But the inbox must coalesce by object id (function 21), and a coalescing inbox (`Overflow.coalesceByKey()`) never answers `DROPPED`. When nothing is replaced and it is full, it evicts the oldest item and accepts the new one (`SendResult.ACCEPTED`).
  - Only `dropNewest()` answers `DROPPED`, and it does not coalesce.
  - So the worker must hold back the 20 001st object itself. It knows which objects it has posted since the link went down.
  - For the same reason, "dropped (a full inbox, …)" under "Skips are counted" cannot be counted: a full inbox loses its oldest item without telling the worker.
  - **Fix:**
    - function 21: "while a link is down, the worker posts items for at most 20 000 objects; an item for another object is not posted, and is counted as "dropped"";
    - criterion 28: "the 20 001st object's item is not posted, and the count "dropped" rises";
    - under "Skips are counted": "dropped" (past 20 000 waiting objects).

    The record of open question 10 may keep the question as it was asked.
- **V3. One sentence left over from (e).** Function 17's "Times" still says a waiting channel item "arrives stale after a long outage". **Fix:** "so one without an expiry arrives stale after a long outage (function 21)".

**Remarks:**

- **For the CDA (T-080): the fresh snapshots come before `onChange`.**
  - U1's fix relies on step 3 of `CurrentWorkspace` coming before step 5, as the SDK says. So the shell calls `onChange` only once every subscription that follows the workspace shown has its fresh snapshot.
  - If `onChange` came first, `layer-panel` would still hold the old workspace's layers. It would take the remembered layer for a foreign one and replace it with the top layer.
- **For PCA-cot's follow-up: what "never sent" means in (d).**
  - The worker can only judge it from what it knows: the item was posted while the link was down, and no connection has been reported since.
  - A removal that races the reconnect may come after the task has already written the update. TAK then keeps the track until its stale time, as for an item past the cap.
  - That is acceptable, and the brief need not change.
- **The PDA's handover** still says that the ACA adds the index lines on ADR-0040 and ADR-0041 and the units line "(its recheck)". Those are on the integration branch since `3154f78`.

**Verdict:**

- **U1 and U2 are fixed,** and the simulator's new line and criterion are as the owner decided.
- **D1 stayed within its limit.**
- **`cot`'s amendments fit ADR-0037 and the decisions,** and the simulator's amendment matches part B2.
- **The briefs are ready for the owner's approval once V1 to V3 are fixed.** They are text edits with the wording given above, which the MCA can check when the PDA reports; they need no further ACA round.
- **PCA-cot's follow-up branch** builds (c) to (e) of open question 10, against criterion 28 with V2's wording.
