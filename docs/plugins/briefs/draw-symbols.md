# Brief: draw-symbols

- Status: **Approved (2026-10-05)** · Milestone: M0 · Task: T-023 · Agent: PCA-draw-symbols (Sonnet) · **Function 8's subscription changed (owner, 2026-10-17):** the layers with `{ objects: false }`, the selected symbol with a small fixed area; "not in view" means outside the map's view (function 14, criterion 21).
- Updated 2026-10-10:
  - the double-click rule (function 2, criterion 10; T-032), decided and approved by the owner;
  - for M1: data type and data source (functions 1, 2, 4 and 10, settings, criteria 11 to 13), and read only without `objects.edit` (function 11, criterion 14). These M1 edits are approved by the owner (2026-10-10). They are built against SDK v1 and data model 1.0.0 (T-034).
  - for M1: the live picture by area (function 8; ACA review B2), approved by the owner at the SDK v1 freeze (2026-10-10).
- **Updated 2026-10-15 for M2 (T-048): functions 3 and 7 replaced, functions 12 to 15, Interfaces, criteria 6 and 15 to 21; approved by the owner (2026-10-15); the conformance review's fixes of the same day (Delete wording, a symbol not in view, criterion 21) are confirmed by the owner (2026-10-15).** After the ACA's check (2026-10-15), confirmed by the owner (2026-10-15): the plugin does not move the map for a symbol not in view; the user runs Centre on or Zoom to (function 14). ADR-0032: selecting is the map view's, Delete is the shell's, Edit is an object action.
- **Updated 2026-10-27 for T-066 (drag a selected shape; owner, 2026-10-19: for M3; 2026-10-27: now, in parallel with the rest): function 23, criteria 34 and 35.** **Approved by the owner (2026-10-27)** and merged by the MCA as `0a35905`; no ADR, SDK member or model change.
- **Updated 2026-10-27 for M3 (T-077, for T-085): functions 16 to 22, Interfaces, Permissions, criteria 23 to 33, open question 1.** Reviewed by the ACA (T-078, `docs/architecture/reviews/m3-briefs.md`, U1 to U7 taken), with the owner's decisions of 2026-10-27, rechecked by the ACA, and **approved by the owner (2026-10-27)**. ADR-0039 (workspaces) with the workspace rules in the briefs README ("M3: the reused plugins in a workspace"); ADR-0038 (declared fields and the "+"); CR-0020 (`signal`).
- **Updated 2026-10-30 for M4 (T-090): functions 1 and 15, function 24, criteria 36 to 38.** From the owner's M4 notes (2026-10-30: more symbols, right-click while placing, default panes BS). No ADR, SDK member or model change. **For the owner's approval.**
- **Updated 2026-10-30 for SDK 1.3.0 (CR-0028 part 3; BO, CA; T-106): function 26, the fields list instead of the "+", and criteria 41 to 43, which replace the "+" in functions 20 and 21 and criteria 26, 30 and 31.** For the owner's approval; merged in one run with the SDK's step 3 (CR-0028, Compatibility).
- **Updated 2026-10-30 for M4 (CR-0028 step 1): function 25, criteria 39 and 40, the layer lock** (ADR-0042, SDK 1.3.0), with the owner's answers to the PDA, 2026-10-30. **For the owner's approval.**
- **Updated 2026-11-06 for M5 (T-132, T-139, T-150; CR-0030 part 3, CR-0031): functions 27 to 29, Interfaces, criteria 44 to 49.** Field sets in "Symbol properties" and the Symbols panel (function 27 replaces function 26's "Other fields", and criteria 44 to 47 replace criteria 41 to 43), vessel symbols in the picker, and `relations` forwarded. Built against SDK 1.4.0 part 3 (`^1.4.0`), in one run with the SDK's `DeclaredFields` change. **Approved by the owner (2026-11-06, IB).**
- **Updated 2026-11-10 for M6 (T-165; CR-0038 points 4 to 6, 8 and 9, SDK 1.5.0 part 1): function 30, criteria 50 to 53.** The data type select leaves out the types users do not choose, a chosen data type shows its sets at once, and the editor shows one set at a time with a "+" for the others. Where they differ, function 30 wins over functions 2, 10, 20, 21 and 27, and criteria 50 to 53 over 44 and 47. **Approved by the owner (NQ A, 2026-11-10)**; with Q31 A (NO A: a data type's sets go on symbols only) and Q32 A (NP A: SDK 1.5.0 from part 1).
- **Updated 2026-11-11 for the 1.5.0 freeze (owner, Q49 A and Q51 A): function 28.** The members that were optional until the freeze are required (`docs/plugins/sdk-v1.md`, "The freeze"), so the fallbacks for their absence go. Follows from the owner's decision, so approved.
- **Updated 2026-11-11 for M7 (T-156; the M7 plan's Q1 A, the ACA's note on ADR-0010; CR-0041 part G): function 31, criteria 54 to 56, assumptions P1 to P3.** Symbol palettes in the Symbols panel. Waits for SDK 1.6.0 part G. **Category** (T-174): `drawing`. **Approved by the owner (2026-11-11, RJ A)**, with P1 to P3 accepted. **Updated 2026-11-12 with the owner's RW A on P1:** the echelon choice "Unchanged", the default for a palette (function 31, criterion 55).
- Read also: ADR-0005 (change requests), ADR-0007 (data model), **ADR-0023 (data types and data sources)**, ADR-0022 (permissions), `model/README.md` (update semantics). **(M2)** ADR-0032 (selection, object actions, the shared Delete), ADR-0031 (panels in every pane), ADR-0029 (design system).

## Purpose

Lets users **place, select, edit, move and delete** single-point APP-6 symbols on the map. (From M2 the map view selects and the shell's shared Delete deletes; functions 12 and 13.) This is the core of the M0 demo ("draw symbols").

## Kind and parts

- Kind: **general**. Properties: none.
- Parts in M0: **web only.**

## Functions (M0)

1. **Symbol picker** (Control Pane panel "Symbols"): choose an entity from the `symbology` catalog, shown as symbol images, plus standard identity (friend, hostile, neutral, unknown) and echelon. A preview shows the resulting symbol. Advanced: type a SIDC directly, validated by `SymbolService`.
   - **Data type picker (M1):** the panel also offers the **available data types** (SDK v1: the list ECore builds from the manifests, ADR-0023), by display name. New symbols get the chosen one. The choice is kept per browser and wins on the next visit. The setting "Data type for new symbols" (`core.general`) applies when the browser has no choice yet, or when the kept one is no longer available.
   - **Categories (M4):** the catalog holds 10 to 20 common entities per symbol set (`symbology` function 6). The picker shows one category at a time, with a category chooser named by symbol set: Land unit, Land equipment, Land installation, Air, Air missile, Space, Sea surface, Sea subsurface, Mine warfare, and Signals intelligence: space, air, land, sea surface and subsurface. The plugin keeps these names for the symbol set codes (`CatalogEntry.symbolSet`); a set without a name is listed by its code. The category chosen is kept per browser, like the data type.
   - **Echelon (M4):** it applies to land units only (symbol set `10`). For any other set the picker hides it and a new symbol gets `00`; the properties panel (function 4) hides it too and keeps the symbol's own value.
2. **Place:** with a symbol chosen, the user clicks the map ("pick a point" interaction). The plugin sends a create change request for a `core.symbol` object:
   - in the **active layer** (`MapView`),
   - with a new UUID v7 id (SDK helper),
   - with the default security label (SDK),
   - with `standard` taken from the setting (APP-6D by default),
   - **(M1)** with the chosen `dataType`, and `dataSource` `manual`.
   If no layer is active, placing is disabled with the hint "Select or create a layer in the layer panel".
   - **Double-click** (owner, 2026-10-10): two clicks within the double-click time are **one** placement: one create, not two. The double-click time is the one the map view uses, which is OpenLayers' (250 ms in the version shipped). The PCA confirms the number and records it in the README. Clicks further apart in time still place one symbol each, and placing stays on. (The map view does not zoom on a double-click while "pick a point" runs: `map-view-2d`, function 8.)
3. **Select:** a click on a symbol selects it (`MapView` pick and selection). Escape or a click on empty map clears the selection. Only one object is selected at a time in M0. **Replaced in M2 by function 12:** the map view selects (ADR-0032).
4. **Properties panel** for the selected symbol:
   - symbol preview; standard identity, echelon and entity (or SIDC);
   - name; text modifiers `uniqueDesignation`, `higherFormation`, `additionalInformation`;
   - position in the user's coordinate format (`CoordinateService`), editable;
   - layer (can be changed to move the object to another layer);
   - **(M1)** data type, editable: the available data types (function 10);
   - read only: security label (classification), version, last modified (when and by which plugin or user), **(M1)** data source.
5. **Edit:** changes are sent as update change requests when a field is committed (Enter or leaving the field), not on every keystroke.
   - An update replaces all core fields (`model/README.md`, rule 5), so the plugin sends the complete core content from the latest state it received, with only the edited field changed, and `baseVersion` set to that state's version.
   - The plugin writes no extension namespace of its own in M0, and never sends other plugins' extensions as changes. The object store keeps them (rule 5).
6. **Move:** dragging the selected symbol (`MapView` "drag an object") sends one update with the new position when dropped.
7. **Delete:** a Delete button and the Delete key remove the selected symbol (delete change request). No undo in M0. **Replaced in M2 by function 13:** the shell's shared Delete.
8. **Live updates:** if the selected object is changed by someone else, the panel shows the new values. Fields the user is editing are not overwritten; last write wins on commit. If the object is deleted elsewhere, the selection is cleared and a notification says so.
   - **Subscription** (owner, 2026-10-17; SDK 1.1.0): two subscriptions, never one by the viewport. The plugin needs the layers and the one symbol it works on, not the objects in view (the map view selects and picks).
     - **The layers** (for the target layer list): `{ objects: false }`, all the time.
     - **The symbol being worked on**: while one is selected, a second subscription with a small **fixed area** round it (`area: Area`: a small ring round its position, e.g. a square of about 100 m, with `inside` at the position). On a selection change with exactly one id, the plugin fetches the object by id (`ctx.objects.get`), checks that it is a symbol (`core.point`), and only then subscribes round it; with none, several, or a shape (function 12), it has no second subscription. It gives the newest version (for `baseVersion`) and the live updates above. It starts when the symbol is selected, and ends when that ends. If the symbol moves out of the area, only its id arrives, as `left`: the protocol sends a change event only while the object is in the area after the change (`server/live-picture-protocol.md`, "How an area subscription follows changes"). The plugin then fetches it by id (`ctx.objects.get`) and subscribes again round its new position. A change of the map view does not touch it.
     - Why: a subscription by the viewport costs an area read in the object store at every map move and sends every object in view to the plugin. A later SDK option to subscribe by ids (`LivePictureOptions.ids`, a CR in a later milestone) would replace the fixed area.
   - Was (M1): `{ area: 'viewport' }`, where an object that left the area was pruned from the selection; from M2 it stays selected and the panel stays open (function 14).
9. **Errors:** a rejected change request is shown as a notification with the reason. The form keeps the user's input.
10. **Data type and data source (M1, ADR-0023):**
    - An update sends `dataType` and `dataSource` with the rest of the core content. `dataSource` is always sent unchanged: it is fixed at creation.
    - Changing the data type in the properties panel sends one update with the new `dataType`.
    - An object whose data type is no longer available (its plugin was removed) shows its data type with the mark "not available". It keeps it until the user picks an available one.
    - Objects from other sources (e.g. `cot`) can be edited like drawn ones. Their data source is shown, and the next report from that source may overwrite the edit (`cot` brief, function 5).
11. **Without `objects.edit` (M1, ADR-0022):** the user's permissions come from the SDK v1 (in the browser). Without `objects.edit`:
    - the panels are **read only**: placing, editing, dragging and deleting are switched off, with the hint "You may not edit objects" (from M2 deleting is the shell's, which hides its Delete without the permission);
    - selecting and viewing still work.

    The server checks the permission anyway. A rejection (`PERMISSION_DENIED`) is shown as a notification, as in function 9.

## Functions (M2)

Built against SDK 1.x (T-049).

12. **Selecting is the map view's** (`map-view-2d` function 14, ADR-0032 point 1). The plugin no longer listens to map clicks to select. Its properties panel (function 4) shows the selected symbol **while exactly one `core.symbol` is selected**. With several objects selected, it shows "N objects selected" and no fields; with another kind of object (a shape), it shows nothing.
    - **Move** (function 6) stays: while one symbol is selected and the user may edit, the plugin keeps `dragObject` armed for it, and a press and drag on the symbol moves it. A click still selects (`map-view-2d` function 14).
13. **No Delete of its own** (ADR-0032 point 6): the Delete button and the plugin's Delete key go. Symbols are deleted with the shell's **shared Delete**, from the right-click menu or with the Delete key, after a confirmation that states the number of objects (owner, 2026-10-14; T-051).
14. **Edit (object action, ADR-0032 point 6):** the plugin registers **Edit** in the shell's object action list (planned in T-049): for `type` `core.symbol`, one object only, needing `objects.edit`. It selects the symbol and brings the properties panel into view (expanded, in whichever pane it is). For a symbol the browser does not hold (Edit from `object-list`), the plugin fetches it by id (planned in T-049); the plugin does not move the map: the user brings the symbol into view with the map view's Centre on or Zoom to, from the menu (`map-view-2d` function 16).
    - **A symbol outside the map's current view** (its position outside `MapView`'s `viewport.visibleArea`, followed with `onViewportChange`; the plugin's own point-in-ring test; e.g. Edit from `object-list`, or one that moved out of the view while selected): the panel stays open and shows its state, marked "not in view". It is fetched by id when the panel opens; the fixed-area subscription of function 8 then keeps it current, so live updates go on. Before each commit the plugin fetches it again by id, so that the update is based on the newest version. The mark goes when the symbol is in the view again.
15. **Panels** register with a default pane (planned in T-049): from M4 "Symbols" the left pane and "Symbol properties" the right (BS, owner, 2026-10-30; before, both the right). They work in every pane (ADR-0031 point 4); they use the shell's design tokens and shared components (ADR-0029).

**Out of scope (M2):** shapes (`draw-shapes`), editing several symbols at once, copy and paste, undo, multipoint tactical graphics (spike S1).

## Functions (M3)

Built against SDK 1.2.0 (T-076), the shell's workspaces (CDA, T-080) and its declared fields (CDA, T-081), with the workspace rules 1 to 9 in the briefs README ("M3: the reused plugins in a workspace"). In Simulation the plugin places the simulator's tracks (ADR-0040 point 3).

16. **In every workspace** (rules 1 and 4): the panels "Symbols" and the properties panel appear in every workspace. **Edit** (function 14) is registered once per workspace in `ctx.workspaces`, with `workspaces: [id]` and that workspace's edit permission, so the shell offers it only where the user may edit.
17. **Where it places and moves** (rule 5, A17): new symbols go into the active layer, which is always a layer of the workspace shown (`layer-panel` function 21). The properties panel's layer field lists only that workspace's layers. Symbols of View's layers shown as a reference in another workspace are never selected (`map-view-2d` function 23), so the plugin never edits or drags one. **A guard for selections that other plugins set** (the ACA's U4): a selected symbol whose layer is not one of the workspace's layers is shown read only in the properties panel, with the hint "This symbol is not in Simulation" (the workspace's name), and is not offered for dragging.
18. **Who may edit** (rule 4): in a declared workspace, placing, editing and dragging need its `editPermission` (`plugin.simulator.edit` in Simulation) instead of `objects.edit`. Without it the panels are read only as in function 11, with the hint "You may not edit objects in Simulation" (the workspace's name).
19. **On a switch** (rule 3): the map view clears the selection, so the properties panel shows nothing and its fixed-area subscription (function 8) ends. A running "pick a point" resolves with `null`; if placing is on and the new workspace has an active layer the user may draw into, it starts again there, otherwise placing waits with the hint of function 2. The data type choice (function 1) is the same in every workspace.
20. **Declared fields and the "+"** (ADR-0038 point 5; from SDK 1.3.0 the list of function 26 instead of the "+"): the properties panel shows the symbol's declared fields under its core fields, with the web SDK's shared `DeclaredFields` editor (SDK 1.2.0):
    - its `fields` are `ctx.declaredFields`, its `values` `fieldValuesOf(symbol, fields)`, its `dataType` the symbol's, its `pluginId` `draw-symbols`, and it is `readOnly` without the edit permission (function 18);
    - it shows the fields that name the symbol's data type and those the symbol has a value for, grouped by plugin; the "+" offers the other fields that users may edit, those without `dataTypes` included, for example `cot`'s `team`, `role` and `staleSeconds`;
    - **committing** works as for the core fields (function 5): on Enter or leaving a text or number field, at once for a choice or a yes/no. It sends one update with the complete core content from the latest state, `baseVersion`, and **only the changed fields** (`changedFields`, `changeRequests.withFields`); a removed value goes as `null`. A value with a problem (`fieldProblems`) is shown at its field and not sent. Other plugins' extensions are still never sent (function 5);
    - a value set elsewhere shows at once (function 8), unless the user is typing in that field;
    - the store checks each field against its declaration and rejects the request with the reason (ADR-0038 point 2), which is shown as in function 9;
    - fields of a plugin that has been removed are not shown; their values stay on the object (ADR-0038 point 6). `ctx.declaredFields` is required since W1 (2026-10-28), once the shell provided it.
21. **Placing with declared fields** (open question 1): the Symbols panel has the same editor, under the data type, for the symbols about to be placed. Its values go with each create (`changeRequests.withFields`), checked first with `fieldProblems`, until the user changes them or reloads the page; they are not kept per browser. They are kept in the plugin, not in the panel component, so a switch that mounts the panel again keeps them: like the data type (function 19), they are the same in every workspace. Changing the data type keeps the values that still apply and shows the fields of the new one.
22. **CR-0020 and the look** (with T-085, owner, 2026-10-23): the plugin ends its "pick a point" and its waiting "drag an object" with CR-0020's `signal` (one `AbortController` each) instead of its token that ignores a late result, so the map leaves the interaction when placing is switched off, the active layer goes, or the selection changes. Its look test uses the test kit's `checkLookCss`. **The W3 check** (the ACA's): this is the first use of `DeclaredFields` in a browser, so the PCA checks it in the three looks, light and dark, and both densities, and records the result in the plugin README.
23. **Its drag next to `draw-shapes`'** (T-066; owner, 2026-10-19: for M3; 2026-10-27: now, in parallel with the rest; `draw-shapes` function 16):
    - **Armed early, as before:** the plugin arms its waiting drag (function 22) as soon as one object is selected, before it knows the object, so that a drag of a symbol right after the click is not lost.
    - **Ended once the object is known:** when the object proves not to be a symbol it may drag (another type, read only, out of the view, or outside the workspace's layers, function 17), the plugin ends that drag at once with its `signal`, so that `draw-shapes`' drag can take over. If `draw-shapes`' drag has already replaced it, the abort changes nothing (CR-0020). A drop for such an object is still ignored.
    - **Armed early once per selection:** while the object is not known yet, a drag that ended with `null` is not armed again on a change of the view, of a layer's visibility or of the objects it holds; only a new selection arms the early drag again. Once the object is known as an editable symbol, its drag resumes as before. So it never takes the map from `draw-shapes`' drag by itself.
    - **One interaction at a time:** the map view runs one; a new one ends the one before with `null` (`map-view-2d` function 17). A shape selected in another plugin while the user places a symbol arms `draw-shapes`' drag, which ends the placing as Escape does: placing switches off (`draw-shapes` function 16).

## Functions (M4)

24. **Right-click while placing** (the owner's M4 notes, 2026-10-30): a right click ends placing as Escape does. The map view ends "pick a point" with `null` (`map-view-2d` function 27); placing switches off, nothing is created, and the map is back to selecting.
25. **Locked layers** (ADR-0042 point 8; the owner's answers to the PDA, 2026-10-30). A layer is locked while its `locked` is `true` (SDK 1.3.0), as the live picture's layers say; the store refuses every user's change to its content with `LAYER_LOCKED`.
    - **Placing:** while the active layer is locked, the place buttons are disabled with the title `The active layer "<name>" is locked`. A placing that runs when the active layer becomes locked is ended with its `signal`, and nothing is sent.
    - **Edit** on an object in a locked layer opens "Symbol properties" **read only**: every field read only (`DeclaredFields` too), no Save, and a notice `Layer "<name>" is locked`. It follows the lock live: an unlock makes it editable, and a lock while it is open makes it read only and sends nothing.
    - **No drag:** a selected object in a locked layer is not dragged; no `dragObject` is armed for it.
    - **The layer field** of "Symbol properties" (function 17) offers no locked layer as a target, since a move into it is refused.
    - **A `LAYER_LOCKED` rejection** (the layer was locked in between) is shown like any other. The shell's shared Delete reports refused objects itself (CDA).
26. **The fields list** (SDK 1.3.0, CR-0028 part 3; the owner's BO and CA; T-106). The shared `DeclaredFields` editor no longer has the "+": in "Symbol properties" (function 20) and in the Symbols panel for placing (function 21) it shows the fields that name the symbol's data type, then **"Other fields"**, a group that opens and closes, with every other field the user may set, grouped by plugin, and every other field the symbol has a value for. It starts open when one of them has a value.
    - **The plugin's part:** a `key` per symbol on the editor in "Symbol properties" (the symbol's id), so that it starts afresh for each symbol; in the Symbols panel it keeps the editor while the data type stays.
    - **Committing is unchanged** (function 20): an emptied field sends `null` if the symbol had a value, and nothing otherwise; a yes/no set and cleared again sends `false`. When placing, only fields with a value go with the create (`changedFields` from no values).
    - **Read only** (function 18, function 25): "Other fields" lists only fields with a value, read only, and is absent when there is none.

## Functions (M5)

Built against SDK 1.4.0 part 3 (`sdk-v1.md`, "SDK 1.4.0", part 3). The SDK's `DeclaredFields` becomes the field-set editor in the same run, so this plugin changes with it, as for T-106.

27. **Field sets** (ADR-0050 point 5; T-132). In "Symbol properties" (function 20) and in the Symbols panel for placing (function 21), `DeclaredFields` gets `fieldSets={ctx.fieldSets}`, the symbol's sets as `objectSets`, and `onAddSet`. It shows the fields of the symbol's data type, then one group per set the symbol carries, then a drop-down of the declared sets with a **"+"**, grey for a set the symbol has. Function 26's "Other fields" goes.
    - **In "Symbol properties":** the "+" adds the set at once, as a committed field does (function 5): one update, `changeRequests.withFieldSets(changeRequests.updateObject(symbol, content), [setId])`. The set's group then shows, with its fields editable as the declaration allows.
    - **In the Symbols panel:** the sets added there are kept with the panel's field values while the panel lives, and go with each create (`changeRequests.withFieldSets` on the create, with `changeRequests.withFields` for the values).
    - **A value whose set the symbol lacks** shows read only in that set's group until the set is added; a set no loaded plugin declares any more is kept and not shown (the SDK does both).
    - **Read only** (functions 18 and 25): no drop-down, and every field read only.
    - **The data type stays changeable** (ADR-0050 point 8): changing it keeps the sets and their values.
28. **Vessel symbols** (ADR-0047 point 6; T-139). When the symbol service's `vesselGroups()` gives groups (required of it since the 1.5.0 freeze), the picker's category chooser (function 1) has **Vessels** after the APP-6 categories:
    - one entry per ship-type group, drawn with `render({ standard: 'vessel', sidc, size })` for the group's first type, with a direction of 0 so that the hull shows; under it a **Ship type** drop-down of the group's types by name (default the first);
    - the standard identity is the picker's (friend, hostile, neutral, unknown; APP-6D's digits); the context is reality (`0`); the echelon is hidden;
    - a vessel is placed as `{ standard: 'vessel', sidc: vesselSidc({ context: 0, identity, shipType }) }`, without `direction` (so it shows the mark until it has one), with the data type and placing rules of function 2;
    - "Symbol properties" shows a vessel's identity and ship type instead of the SIDC's parts, and its direction and speed as for APP-6; the advanced SIDC field validates with `validate('vessel', sidc)`;
    - the setting "standard" (APP-6D by default) stays APP-6's.
29. **Relations forwarded** (ADR-0051 point 9; CR-0031): every update the plugin sends spreads the symbol's newest content and changes only what the user changed, so `relations` (and `fieldSets`) go back as they came. It never builds the content from its form alone, which would empty the list (model rule 5).

## Functions (M6)

Built against SDK 1.5.0 part 1 (`sdk-v1.md`, "SDK 1.5.0"; CR-0038), `sdkVersion` `^1.5.0` (SDK 1.5.0 since part 1, owner NP A). The SDK's `DeclaredFields` shows one set at a time from part 1, so this plugin changes with it, in the same run.

30. **A data type brings its sets** (CR-0038; T-165). Where this differs from functions 2, 10, 20, 21 and 27, it wins.
    - **The data type select** in the Symbols panel and in "Symbol properties" offers `choosableDataTypes(ctx.dataTypes, type)`, `type` the symbol's in "Symbol properties": no `simulator.route`, `gmti.detection` or `gmti.platform` (point 6), unless the symbol has one, so that an edit does not change it unseen. A kept choice, or the setting "Data type for new symbols", that names such a type falls back to `core.general`, as an unavailable one does (function 2).
    - **The type's sets at once** (point 4): `DeclaredFields` gets `dataTypes={ctx.dataTypes}` and `objectSets={withDataTypeSets(sets, type)}`. In the Symbols panel `sets` are those added there, so choosing AIS vessel shows "AIS ship" before anything is placed. In "Symbol properties" `sets` are the symbol's, so a change of data type shows the new type's sets at once. Neither the create nor the update needs to list the type's sets: the store adds them (model rule 21). A data type change is still one update with the new `dataType` (function 10).
    - **One set at a time** (point 5): the drop-down of the symbol's sets opens on the data type's first set. The "+" offers the sets the symbol lacks, and is gone when none is left (the owner's Q1: a symbol may carry more sets than its type's). In "Symbol properties" a set chosen in it is one update, as function 27 has it; in the Symbols panel it goes with each create.
    - **No group for a field's `dataTypes`** (point 8): function 27's "fields of the symbol's data type" go, and `fieldBelongsTo` (deprecated) with them. After a data type change in the Symbols panel the values kept are those of fields in the sets the new symbols will carry (function 21's pruning, criterion 29).
    - **Expiry** (point 9): a symbol placed with an in plugin's type, e.g. `ais.vessel`, has no `time.observed`, and no longer fades or goes (ECore).

## Functions (M7)

Built against SDK 1.6.0 (CR-0041 part G, `ctx.symbolPalettes`).

31. **Symbol palettes** (T-156; the M7 plan's Q1 A; the ACA's note on ADR-0010). A drop-down at the top of the Symbols panel chooses what the panel offers.
    - **The choices:**
      - **"General symbols"** first: what the panel shows today, the catalogue with its categories and the Vessels category (function 28);
      - **then each palette** of `ctx.symbolPalettes`, by its name, in the context's order, for example `cot`'s "CoT".
    - **A palette's symbols:** shown in the palette's order as images, through the symbol service as the catalogue's are, each with its `label`, else the catalogue's name for its code. The panel's search filters them by that text.
    - **Placing one** works as placing a catalogue entry (functions 1 and 2), with the palette's code. The panel's identity and echelon choices apply to it as to a catalogue entry: they set those positions of the code (P1). **The echelon choice "Unchanged"** (owner, RW A, 2026-11-12): offered with a palette only, first in the echelon list and chosen when a palette is chosen, it keeps the palette code's own echelon; "None" sets no echelon, as for a catalogue entry, so a palette's echelon is wiped only when the user picks None. Back in "General symbols" the choice is the one there before.
    - **The choice is kept** per user in `ctx.userDocuments` (P2). A kept palette that is no longer offered, because its plugin is not enabled, falls back to "General symbols".
    - **A code the symbol service refuses** shows the error frame and cannot be placed (P3).
    - **Nothing is written** to a palette: they are declared in manifests only (CR-0041 part G).

## Out of scope (M0)

Multipoint tactical graphics (spike S1), shapes, multi-select, copy and paste, undo, editing security labels, symbol search across the full APP-6 catalog.

## Interfaces

| Direction | What |
|---|---|
| Provides | Control Pane panels "Symbols" and the properties panel. **(M2)** The object action **Edit** for `core.symbol` (planned in T-049). **(M3)** Both in every workspace; Edit once per workspace |
| Requires | `MapView` (pick, interactions, selection, active layer; **from M2** the map view selects, and the plugin only reads and follows the selection); `SymbolService` (catalog, render, validate, compose); `CoordinateService` (format, parse); live picture subscription; change requests; default label; notifications. **(M3)** `ctx.workspace`, `ctx.workspaces`, `ctx.declaredFields`, `DeclaredFields`, `fieldValuesOf`, `changedFields`, `fieldProblems`, `changeRequests.withFields`, `signal` (SDK 1.2.0); the shell's workspaces (T-080) and the store's declared fields (T-081); **(M5)** `ctx.fieldSets`, `changeRequests.withFieldSets`, `SymbolService.vesselGroups()` and `render` for `vessel` (SDK 1.4.0 part 3) |
| Objects | Creates, updates and deletes `core.symbol` objects. **From M2** it creates and updates them only; the shell's shared Delete deletes them. **From M3** it also sets other plugins' declared fields that users may edit, by naming them in the request (ADR-0038), and works only in layers of the workspace shown |

## Dependencies

None beyond the SDK and React (shared).

## Settings

| Setting | Default |
|---|---|
| Standard for new symbols | APP-6D |
| Symbol size in the picker (pixels) | 40 |
| Data type for new symbols (M1) | `core.general` |

## Permissions

Core permission `objects.edit` to create, edit and delete. Declared in M0; checked from M1 (function 11). From M2 the plugin no longer deletes; the shell's shared Delete needs `objects.edit` (ADR-0032). **From M3** a declared workspace's objects need its `editPermission` instead (function 18). Declared fields need no permission of their own: they come with the change (ADR-0038 point 4).

## Internet access

**Not allowed.**

## Acceptance criteria

1. Placing a symbol creates exactly one schema-valid change request (validated against `model/schemas/change-request.schema.json`), with the active layer, a new id and the default label. The symbol appears in a second browser within 1 s.
2. Editing the name, a text modifier, the echelon or the identity updates the object in a second browser. The change request contains all core fields and `baseVersion`.
3. Dragging a symbol moves it, and the new position read back in lon/lat matches the drop point within 1 pixel (latitude ≠ longitude).
4. Typing a position in MGRS, DMS or DD moves the symbol to that position (round trip through `CoordinateService`).
5. Updating an object that carries another plugin's extension (`model/examples/valid/object-track-from-cot.json`) leaves that extension unchanged.
6. Delete removes the symbol in both browsers. Deleting an object that another user deleted first gives a notification, not an error dialog. **From M2** this is the shell's shared Delete (criterion 16), not the plugin's; the notification for an object deleted first is the shell's too (T-051).
7. With no active layer, placing is impossible and the hint is shown.
8. An invalid typed SIDC cannot be placed; the reason is shown.
9. Two browsers editing the same symbol: the later commit wins, and both end up showing the same state.
10. **Double-click while placing** (T-032): two clicks within the double-click time create exactly one symbol, and the map does not zoom. Two clicks further apart create two symbols.

From M1 (with SDK v1 and data model 1.0.0):

11. A placed symbol has the data type chosen in the picker, `core.general` by default (the setting), and `dataSource` `manual` (schema-valid change request).
12. Changing an object's data type in the properties panel updates it in a second browser; `dataSource` stays unchanged.
13. An object with a data type that is not available shows it marked "not available", and an update of another field keeps that data type.
14. Without `objects.edit`, nothing can be placed, edited, dragged or deleted (from M2: no Delete is offered by the shell), and the hint is shown; selecting still works. A `PERMISSION_DENIED` rejection is shown as a notification.

From M2 (with SDK 1.x):

15. **Selection by the map view:** clicking a symbol selects it with the map view's selection only; the plugin sends no selection of its own on a click. The properties panel shows the symbol when it alone is selected, "N objects selected" for several, and nothing for one shape.
16. **No own Delete:** the plugin has no Delete button and handles no Delete key. The shell's shared Delete (menu or key, with its confirmation) removes symbols in both browsers.
17. **Edit:** the object action Edit is offered for one selected `core.symbol`, not for a selection of several and not for shapes. It selects the symbol and brings the properties panel into view, also from `object-list` for a symbol the map does not hold.
18. **Move with the map view's selection:** a selected symbol can still be dragged to a new position (one update on drop); a click on another object while the drag waits selects that object.
19. Without `objects.edit`, Edit is not offered (the shell filters it), and the panels are read only as in criterion 14.
20. The panels work in the left, the right and the bottom pane (ADR-0031), in both densities, and in a light and a dark look (ADR-0034).
21. **Not in view:** Edit from `object-list` for a symbol outside the map's view opens the panel with the fetched state, marked "not in view"; a commit is based on the newest version (fetched again first) and updates the symbol in a second browser.
22. **Subscription** (function 8): the layers come from one `{ objects: false }` subscription; selecting a symbol adds one subscription with a small fixed area and deselecting ends it; moving the map adds none; moving the selected symbol out of its area (in a second browser) renews the area round its new position, and the panel follows it. The test kit's `liveSubscriptions` shows the options.

From M3 (with SDK 1.2.0, the shell's workspaces and declared fields; tested with the test kit's `switchWorkspace` and `createFakeContext({ declaredFields })`, and once in the browser):

23. **Every workspace:** the panels are there in View and in Simulation. The unit test checks the registered Edit actions (the test kit's `objectActions`): one per workspace, each with its own id, its `workspaces` (`appearsIn`) and its permission, `plugin.simulator.edit` in Simulation and `objects.edit` in View. That the shell offers each only there is checked in the browser once T-080 is in.
24. **Placing in Simulation:** a symbol placed there goes into Simulation's active layer (schema-valid request); the layer field lists Simulation's layers only. Without the workspace's edit permission nothing can be placed, edited or dragged, and the hint names the workspace. A View symbol put into the selection while Simulation is shown (by the test, as another plugin could) is shown read only with the hint, and cannot be edited or dragged.
25. **Switch:** a switch while a symbol is selected closes the properties panel and ends its fixed-area subscription; a switch while placing resolves the pick with `null`, and placing goes on in the new workspace's active layer.
26. **The fields shown:** with declared fields from two fake plugins, one naming the symbol's data type and one without `dataTypes`, the panel shows the first at once and offers the second through the "+", grouped by plugin; a field that is not editable by others is not offered; a field with a value on the object is shown.
27. **Committing a field:** setting `cot`'s `team` sends one update with the complete core content, `baseVersion`, and `fields` holding only `cot.team`; clearing it sends it as `null`; a number out of its limits is shown at the field and nothing is sent. A store rejection is shown as a notification.
28. **Others' newer values survive:** after a second browser sets `role` on the same symbol, an edit of the name in the first browser leaves `role` as the second browser set it (the request names no field it did not change).
29. **Placing with fields:** values set in the Symbols panel go with each created symbol until changed, and are gone after a reload; a switch to Simulation and back, with the panel mounted again, keeps them. Changing the data type keeps the values of fields that still belong to the new one (`fieldBelongsTo`) and shows its fields.
30. **Read only:** without the edit permission the fields are shown read only and the "+" is not offered.
31. **Without declared fields:** with `ctx.declaredFields` empty (no loaded plugin declares a field), the panels work as in M2 and show no fields and no "+".
32. **`signal`:** switching placing off, or deselecting the symbol, aborts the map view's interaction (the fake map view shows it ended); no late result is used.
33. **Look and W3:** the panels pass `checkLookCss`; `DeclaredFields` in the properties panel is checked in the browser in the three looks, light and dark, and both densities, and the result is in the README.

From T-066 (function 23). The plugin's tests use the fake map view, wrapping its `dragObject` to record each call's id; the checks with `draw-shapes` run in the browser, by the PCA whose branch is merged second, and in the ITA's spec with T-086:

34. **The early drag ends:** a selected object that proves to be a shape (and one that proves read only, or out of the view) ends the plugin's waiting drag with its `signal`: no `dragObject` call for it is running, and a drop for it sends nothing. A symbol selected and dragged at once, before it is known, still moves.
35. **Next to `draw-shapes`:**
    - (plugin) an interaction another caller starts on the fake map view after the early drag (as `draw-shapes`' drag would) is not ended by the plugin's abort; and while the object is still unknown, a change of the view (`setViewport`), of a layer's visibility or of the objects held does not arm the early drag again, so that interaction keeps running;
    - (browser, with `draw-shapes`) a symbol selected after a shape gets the symbol's drag, and a shape selected after a symbol the shape's; each drag sends one update, from the right plugin only.

From M4:

36. **Right-click while placing:** a right click while placing creates nothing, switches placing off and opens no menu; a click on a symbol then selects it.
37. **Categories:** each category lists only its symbol set's entries, and every entry draws a valid symbol with each standard identity. An Air entry gets the echelon `00` and the echelon is not offered; a land unit gets the echelon chosen. The category chosen is the same after a reload.
38. **Default panes:** in a fresh browser "Symbols" opens in the left pane and "Symbol properties" in the right.
39. **Locked active layer** (SDK 1.3.0, with the test kit's default answer policy): the place buttons are disabled with the title; locking the active layer during placing ends it with nothing sent.
40. **Edit in a locked layer:** Edit opens "Symbol properties" read only with the notice, sends nothing and arms no drag; an unlock in a second browser makes it editable.
41. **The fields list** (SDK 1.3.0; replaces criterion 26's "+"): with declared fields from two fake plugins, one naming the symbol's data type and one without `dataTypes`, "Symbol properties" shows the first at once and the second under "Other fields", closed, grouped by plugin; a field that is not editable by others is not listed unless the symbol has a value for it, and then read only; a symbol with a value under "Other fields" opens with the group open; another symbol selected starts afresh.
42. **Sending from the list:** setting `cot`'s `team` from "Other fields" sends only `cot.team` (criterion 27); emptying it sends `null`; a field typed into and emptied again on a symbol that had no value sends nothing; when placing, only the fields with a value go with each create.
43. **Read only and none** (replaces criteria 30 and 31's "+"): without the edit permission or in a locked layer, "Other fields" lists only the values, read only; with `ctx.declaredFields` empty, no fields and no "Other fields" are shown.

From M5 (with SDK 1.4.0 part 3; criteria 44 to 47 replace criteria 41 to 43):

44. **A set added:** with `cot`'s set `cot.unit` declared (`createFakeContext({ fieldSets, declaredFields })`), "Symbol properties" for a symbol without sets shows the drop-down; the "+" sends one schema-valid update with `fieldSets: ['cot.unit']`; the group "CoT unit" appears with Callsign editable, and the "+" for it is grey.
45. **A value in a set:** setting Callsign in the group sends only `cot.callsign` in `fields`; emptying it sends `null`.
46. **Placing with a set:** a set added in the Symbols panel, with a Callsign, goes with each create, with that value.
47. **Read only:** without the edit permission, or in a locked layer, there is no drop-down and the sets' fields are read only.
48. **Vessels:** Vessels, Cargo, ship type 71 and identity neutral place `{ standard: 'vessel', sidc: '0471' }` at the clicked point (latitude ≠ longitude); the picker's image comes from `render` with `vessel`; "Symbol properties" shows Neutral and type 71. Without `vesselGroups()` there is no Vessels category.
49. **Relations forwarded:** a symbol with two relations, renamed in "Symbol properties", is sent with both relations and its sets unchanged.

From M6 (function 30; with `createFakeContext({ dataTypes, fieldSets, declaredFields })`, whose fake store adds a data type's sets as ECore does):

50. **The select:** with `simulator.route`, `gmti.detection` (`manual` false) and `ais.vessel` declared, the Symbols panel offers General and AIS vessel only; "Symbol properties" for a symbol of `gmti.detection` shows GMTI detection, and saving another field keeps it.
51. **Placing by type:** choosing AIS vessel in the Symbols panel shows the drop-down at "AIS ship" with its fields before placing; a symbol placed with an MMSI typed in that set carries `ais.ship` (from the fake store) and that value; the create lists no set the user did not add.
52. **A data type change:** in "Symbol properties", General to CoT sends one update with `dataType` `cot.cot`, and the editor shows "CoT unit" chosen; the stored symbol carries `cot.unit`. CoT on to AIS vessel keeps `cot.unit` and its values and adds `ais.ship`, shown chosen.
53. **The "+" and read only:** a symbol of AIS vessel with `ais.ship` offers CoT unit in the "+" menu; adding it sends one update and chooses it; with no set left the "+" is gone. Without the edit permission or in a locked layer there is no "+", and the drop-down still chooses the set to see, its fields read only.
54. **(M7) Palettes offered:** with the test kit's `symbolPalettes` holding "CoT" (3 symbols) and "Test" (1), the drop-down offers "General symbols", "CoT" and "Test" in that order. "General symbols" shows the catalogue as before.
55. **(M7) Placing from a palette:** choosing "CoT" shows its three symbols with their labels, and the search "Infantry" leaves one. Placing it with the identity hostile sends one create whose code is the palette's with the hostile identity. The echelon shows "Unchanged" and the code keeps the palette's echelon; with "None" chosen it has none; "General symbols" offers no "Unchanged".
56. **(M7) Kept and fallback:** the chosen palette survives a reload. With its plugin gone from the context it falls back to "General symbols". A palette symbol the fake service refuses shows the error frame and cannot be placed.

## Open questions for the owner

**M7 (2026-11-11), the assumptions P1 to P3, accepted by the owner (RJ A, Q63):** **P1** the identity and echelon choices apply to a palette's symbols (with the echelon choice "Unchanged", the default for a palette: owner, RW A, 2026-11-12); **P2** the chosen palette is kept per user; **P3** a refused code cannot be placed.

1. **Declared fields when placing** (function 21; ADR-0038's context speaks of the "+" when a symbol is created, and its consequences of `draw-symbols`' "create and edit dialog"). **Decided by the owner, 2026-10-27, as recommended: values for new symbols, kept until changed or reload.** The ACA supported it (T-078). The recommendation was: the Symbols panel has the "+" too, and its values go with every symbol placed until changed, so a user placing ten Blue-team tracks sets the team once. They are not kept over a reload, so nothing set long ago goes on new symbols unnoticed. **Alternative:** fields only in the properties panel, after placing; simpler, but each symbol needs its fields set one by one.
