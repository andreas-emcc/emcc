# Brief: draw-shapes

- Status: **Approved (2026-10-15)**, with the owner's answers to the three open questions (below). The conformance review's fixes of the same day (the kind as a documented key, a shape not in view, the default pane, criteria 15 to 17) are confirmed by the owner (2026-10-15). After the ACA's check (2026-10-15), confirmed by the owner (2026-10-15): "a `Corridor` or an `ArcBand`" instead of "a `Sector`", which the data model does not have (function 4). **Function 7's subscription changed (owner, 2026-10-17):** the layers with `{ objects: false }`, the edited shape with a small fixed area; "not in view" means outside the map's view (criterion 17). · Milestone: M2 · Task: T-053 · Agent: PCA-draw-shapes (new)
- **Updated 2026-10-27 for M3 (T-077, for T-085): functions 10 to 15, Interfaces, Permissions, criteria 19 to 24, open question 4.** Reviewed by the ACA (T-078, `docs/architecture/reviews/m3-briefs.md`, U1 to U7 taken), with the owner's decisions of 2026-10-27, rechecked by the ACA, and **approved by the owner (2026-10-27)**. ADR-0039 (workspaces) with the workspace rules in the briefs README ("M3: the reused plugins in a workspace"); CR-0020 (`signal`); the `simulator` brief's function 9b (routes).
- **Updated 2026-10-27 for T-066 (drag a selected shape to move it; owner, 2026-10-19: for M3; 2026-10-27: now, in parallel with the rest): function 16, function 7 and criterion 18 (the selected shape followed; this widens the owner's decision of 2026-10-17 ("the layers and the edited shape only"), approved by the owner on 2026-10-27), Interfaces, criteria 25 to 30.** **Approved by the owner (2026-10-27)** and merged by the MCA as `0a35905`; no ADR, SDK member or model change. **Amended (owner, 2026-10-27):** function 16's "Armed again" and criterion 30: the end of its tool or of a reshape arms the drag again only when it did not end with `null` (Escape, or another plugin's interaction replacing it); function 2 records that such a `null` switches the tool off, as built.
- **Updated 2026-10-30 for M4 (CR-0028 step 1): function 17, criteria 34 and 35, the layer lock** (ADR-0042, SDK 1.3.0), with the owner's answers to the PDA, 2026-10-30. **For the owner's approval.**
- **Updated 2026-10-30 for M4 (T-090): functions 1, 2 and 3, criteria 31 to 33.** From the owner's M4 notes (2026-10-30: right-click while drawing, default panes BS) and the owner's answers to the PDA (2026-10-30: the edit panel's pane; a route's menu). No ADR, SDK member or model change. **For the owner's approval.**
- **Updated 2026-11-10 for M6 (T-165; CR-0038 points 6 and 7, the owner's NC A; SDK 1.5.0 part 1): function 18, criterion 36.** The data type selects leave out the types users do not choose. Shapes carry no field sets in M6. **Approved by the owner (NQ A, 2026-11-10)**; with Q31 A (NO A: a data type's sets go on symbols only) and Q32 A (NP A: SDK 1.5.0 from part 1).
- **Updated 2026-11-11 for M7 (T-176; owner, QG A, QH A; CR-0041 part B): function 19, criteria 37 and 38.** Append in the edit panel for line shapes. Waits for SDK 1.6.0 (part B). **Category** (T-174): `drawing`. **Approved by the owner (2026-11-11, RJ A)**, with Q61 A (routes get Append in the simulator's route editor).
- Read also: **ADR-0033 (drawn shapes)**, ADR-0032 (selection, object actions, the shared Delete), ADR-0023 (data types and data sources), ADR-0029 (design system), ADR-0031 (panels in every pane), ADR-0019 (geodesic edges), `model/README.md`.
- Built against **SDK 1.x** (T-049) and **data model 1.1.0** (T-064). Where this brief names an SDK or model addition, it is "planned in T-049" or "in T-064"; the names there win.

## Purpose

Lets users **draw plain shapes** on the shared map: circles, ellipses, squares, rectangles, areas, arrows and routes, each with an outline, an optional transparent or hatched fill, and a text label (owner, 2026-10-14). Users edit them later through the shared object actions. It is the shapes' counterpart to `draw-symbols`.

## Kind and parts

- Kind: **general** (it places objects). Properties: none.
- Parts in M2: **web only.**

## Functions (M2)

1. **Shapes panel** (registered with the left pane as its default from M4, BS, and the right before; the edit panel stays in the right, owner, 2026-10-30; planned in T-049; it works in every pane, ADR-0031): a tool for each kind of shape, the style for new shapes, the name, and the data type.
   - **Kinds:** circle, ellipse, square, rectangle, polygon (an area), arrow, route.
   - **Style:** outline colour, width and dash (solid, dashed, dotted); for kinds with an area, the fill: **none**, **transparent** (a colour and an opacity) or **hatched**: one pattern in M2, diagonal lines in the fill colour (open question 3; in T-064). An arrow gets an arrowhead, a route markers at its points (T-064).
   - **Data type picker** as in `draw-symbols` (ADR-0023): the available data types by name; the choice is kept per browser; the setting "Data type for new shapes" (`core.general`) applies without one.
2. **Draw:** with a kind chosen, the user draws on the map through the map view's **drawing service** (`map-view-2d` function 17, planned in T-049): circle, ellipse, square and rectangle by pressing and dragging; polygon, arrow and route point by point (double-click or Enter finishes, Escape cancels; from M4 a right click removes the last point, and with none left cancels, `map-view-2d` function 27). An arrow can bend: its arrowhead is at the last point (open question 2). When the service returns a geometry, the plugin sends one create change request for a `core.shape` object:
   - in the **active layer**, with a new UUID v7 id and the default security label;
   - with the chosen `dataType`, and `dataSource` `manual` (ADR-0033 consequences);
   - with the geometry as the service returns it: a circle as `Circle`, an ellipse as `Ellipse`, a square, a rectangle and a polygon as `Polygon` (ADR-0033 point 4), an arrow and a route as `LineString`;
   - with the chosen `style`, and the name as `properties.name` (the label);
   - with the kind as drawn in its own extension `draw-shapes`, e.g. `{ "kind": "rectangle" }` (open question 1), so that the panels show "Rectangle", not "Polygon". The kind is one of `circle`, `ellipse`, `square`, `rectangle`, `polygon`, `arrow`, `route`. **It is a documented key:** other plugins may read it (e.g. `object-list`), and fall back to the geometry type without it.

   Without an active layer, drawing is switched off with the hint "Select or create a layer in the layer panel". A drawing that is cancelled sends nothing. The tool stays on for the next shape until the user switches it off. A drawing that ends with `null` (Escape, or another plugin's interaction that replaced it) switches the tool off, so that it does not fight the other interaction (as built in M2; recorded with T-066, function 16); a switch keeps it on (function 13).
3. **Edit (object action, ADR-0032 point 6):** the plugin registers **Edit** in the shell's object action list (planned in T-049): for `type` `core.shape`, one object only, needing `objects.edit`. **From M4 not for the simulator's routes** (data type `simulator.route`; owner, 2026-10-30): their edit is the simulator's "Edit route". It selects the object and opens the **edit panel**. For an object the browser does not hold (Edit from `object-list`), the plugin fetches it by id (planned in T-049).
4. **Edit panel** for one shape:
   - name (the label), style (as in function 1), layer (moving the object to another layer), data type;
   - **Reshape:** starts the map view's **editing service** (`map-view-2d` function 17): the user moves the whole shape, or drags its corners or points (a circle's radius, an ellipse's axes and rotation). On finish the plugin sends one update with the new geometry; Escape sends nothing. Reshaping a square or rectangle does not keep its right angles (M2).
   - read only: the kind, the security label (classification), version, last modified (when and by whom), data source.
   - It edits **every `core.shape`**, also those other plugins created. Geometries the editing service does not reshape (e.g. a `Corridor` or an `ArcBand`) show the properties only.
   - The panel follows the selection: it shows the shape while exactly that one shape is selected, and closes when the selection changes to anything else.
5. **Updates** are sent when a field is committed (Enter or leaving the field), not on every keystroke. A shape's updates go one at a time, in order (from T-066 a drop too, function 16). As in `draw-symbols`: the complete core content from the latest state received, only the edited field changed, `baseVersion` set; `dataSource` unchanged; other plugins' extensions never sent as changes (model rule 5, ADR-0018). Its own extension `draw-shapes` is left out of updates, so the store keeps it (model rule 5: an absent namespace is kept).
6. **No Delete of its own:** shapes are deleted with the shell's shared Delete (ADR-0032 point 6), from the menu or with the Delete key (owner, 2026-10-14).
7. **Live updates:** a shape changed by someone else shows its new values in the edit panel; fields the user is editing are not overwritten (last write wins on commit). If it is deleted elsewhere, the panel closes and a notification says so.
   - **Subscription** (owner, 2026-10-17; SDK 1.1.0): two subscriptions, never one by the viewport. The plugin needs the layers and the one shape it works on, not the objects in view (the map view selects and picks).
     - **The layers** (for the target layer list): `{ objects: false }`, all the time.
     - **The shape being worked on**: while one is open in the edit panel, a second subscription with a small **fixed area** round it (`area: Area`: a small ring round the shape's centroid, with `inside` at the centroid). The store matches a shape whose bound, a cap round its centroid (spike S3), reaches the ring, so a large shape stays in it as long as it overlaps the ring. When the edit panel opens, the plugin fetches the shape by id (`ctx.objects.get`) and only then subscribes round it. It gives the newest version (for `baseVersion`) and the live updates above. It starts when the shape is opened for editing, and ends when that ends; from T-066 it also runs while the shape is the one selected and the user may edit (function 16; this widens the owner's decision of 2026-10-17 ("the layers and the edited shape only"), approved by the owner on 2026-10-27). If the shape moves out of the area, only its id arrives, as `left`: the protocol sends a change event only while the object is in the area after the change (`server/live-picture-protocol.md`, "How an area subscription follows changes"). The plugin then fetches it by id (`ctx.objects.get`) and subscribes again round its new position. A change of the map view does not touch it.
     - Why: a subscription by the viewport costs an area read in the object store at every map move and sends every object in view to the plugin. A later SDK option to subscribe by ids (`LivePictureOptions.ids`, a CR in a later milestone) would replace the fixed area.
   - **A shape outside the map's current view** (none of its points inside `MapView`'s `viewport.visibleArea`, followed with `onViewportChange`; the plugin's own point-in-ring test; e.g. Edit from `object-list`, or one that moved out of the view while edited): the panel stays open and shows its state, marked "not in view". It is fetched by id when the panel opens; the fixed-area subscription above then keeps it current, so live updates go on. Before each commit the plugin fetches it again by id, so that the update is based on the newest version. The mark goes when the shape is in the view again.
8. **Errors:** a rejected change request is shown as a notification with the reason; the panel keeps the user's input.
9. **Without `objects.edit`** (ADR-0022): the Shapes panel shows the tools switched off with the hint "You may not edit objects"; Edit is not shown (the shell filters it, ADR-0032 point 8). The server checks anyway; a `PERMISSION_DENIED` rejection is shown as in function 8.

## Functions (M3)

Built against SDK 1.2.0 (T-076) and the shell's workspaces (CDA, T-080), with the workspace rules 1 to 9 in the briefs README ("M3: the reused plugins in a workspace").

10. **In every workspace** (rules 1 and 4): the panels "Shapes" and the edit panel appear in every workspace. **Edit** (function 3) is registered once per workspace in `ctx.workspaces`, with `workspaces: [id]` and that workspace's edit permission.
11. **Where it draws** (rule 5, A17): new shapes go into the active layer, always a layer of the workspace shown; the edit panel's layer field lists only that workspace's layers. Shapes of View's layers shown as a reference are never selected (`map-view-2d` function 23), so the plugin never edits one. **A guard for selections that other plugins set** (the ACA's U4): a selected shape whose layer is not one of the workspace's layers is shown read only in the edit panel, with the hint "This shape is not in Simulation" (the workspace's name), and cannot be reshaped.
12. **Who may draw and edit** (rule 4): in a declared workspace drawing, editing and reshaping need its `editPermission` (`plugin.simulator.edit` in Simulation) instead of `objects.edit`. Without it the tools are off as in function 9, with the hint "You may not edit objects in Simulation" (the workspace's name).
13. **On a switch** (rule 3): a running drawing or reshape resolves with `null` and sends nothing; the edit panel closes with the selection (`map-view-2d` function 22) and its fixed-area subscription ends. A tool that was on stays on and draws in the new workspace, if it has an active layer the user may draw into.
14. **Routes of the simulator** (open question 4): Edit stays offered for every `core.shape`, the simulator's routes (`simulator.route`) included, and the plugin does not know the simulator. The simulator copes with a reshape, a data type change and a layer change made here (`simulator` brief, function 9b).
15. **CR-0020 and the look** (with T-085, owner, 2026-10-23): one `AbortController` per tool and per reshape ends the map view's drawing and editing (CR-0020's `signal`), instead of the token that ignores a late result, so the map leaves drawing mode when a tool is switched off or the active layer goes. The look test uses the test kit's `checkLookCss`.
16. **Drag a selected shape to move it** (T-066; owner, 2026-10-19: for M3; 2026-10-27: now, in parallel with the rest). Reshape (function 4) stays as it is.
    - **When the drag is armed:** while exactly one object is selected, it is a `core.shape` in one of the workspace's layers (function 11), the user may edit (`objects.edit`; in a declared workspace its edit permission, function 12), the shape is in the map's view (function 7's test), and none of the plugin's own interactions runs (no tool on, no reshape), the plugin keeps `MapView.dragObject(id)` armed, with one `AbortController` (CR-0020's `signal`). A press and drag on the shape moves it; a click still selects (`map-view-2d` function 14). Every geometry is dragged, also those Reshape does not offer (`Corridor`, `ArcBand`, function 4).
    - **Knowing the shape:** while one object is selected and the user may edit, the plugin reads it by id (`ctx.objects.get`) and, only when it proves a `core.shape`, follows it with function 7's fixed-area subscription (the same one when the panel is open for it; this widens the owner's decision of 2026-10-17 ("the layers and the edited shape only"), approved by the owner on 2026-10-27), so the tests above and the drop use its current state. It arms the drag only once the object proves an editable shape; an answer for an object that is no longer the one selected is ignored. It never arms one for an object it does not know yet; `draw-symbols` does that (its function 23). So its drag normally starts after `draw-symbols`' early one, and replaces it (`map-view-2d` function 17: one interaction at a time). A press made before the read answers belongs to `draw-symbols`' early drag, which `draw-symbols` ends once the object proves not to be a symbol: the shape goes back, and the next press drags it.
    - **Ending it:** the plugin aborts its drag as soon as a condition above stops holding: another selection, the permission gone, a tool switched on, a reshape started, the shape out of the view or out of the workspace's layers. A switch ends it as it ends every interaction (function 13).
    - **Escape:** while the drag only waits, one Escape ends it and clears the selection, as for a selected symbol (`MapView.dragObject`; `map-view-2d` function 14). On a grabbed shape, Escape cancels only the drag, and the shape stays selected.
    - **On a drop:** after any update of that shape still under way (function 5), with the shape's newest state as every other commit (function 7), the plugin moves the shape by the difference between the drop and that geometry's first position, in lon/lat, as the map view's preview does (`map-view-2d` function 26). If the selection, the workspace or the permission changed while it waited, it sends nothing, even if the selection is back to the same shape.
      - `Polygon` (every ring), `LineString` (an arrow, a route), `MultiPoint` and `Corridor`: every position. `Circle`, `Ellipse` and `ArcBand`: their centre, with every other value (radius, semi-axes, rotation, `innerRadius`, `outerRadius`, `startBearing`, `endBearing`) unchanged. `Point`: the drop's longitude and latitude.
      - An altitude stays as it is, for every position. So the drag does not use the plugin's geometry cleaning for drawn shapes, which drops altitudes and knows only the drawn geometries.
      - Latitudes clamp at ±90, as in the preview. Every longitude is wrapped into −180 to 180 (the plugin's `wrapLongitude`: ±180 stays, a value past it moves by 360°), since the data model allows no other. The map view's drop is itself within ±180, so a drag across the antimeridian gives a difference near 360° off, and the wrap makes it right. The edges stay the shorter geodesics (`model/README.md`, rule 10), so the shape does not change.
      - It sends one update with the new geometry, as function 5 sends updates: the complete core content and `baseVersion`, with other plugins' namespaces untouched. A rejection is shown as in function 8.
      - **Limits, as in the preview:** every position moves by the same degrees, so a large north–south move changes a polygon's or a line's size in metres a little, and near a pole (the polar projections) a short drag can be a large shift in longitude that distorts the shape. A circle, an ellipse and an arc band keep their size in metres.
    - **Escape or `null`** sends nothing.
    - **Armed again:** after a drop, at once while the conditions hold. After `null` (Escape, an abort, or another plugin's interaction that replaced it, such as `draw-symbols`' placing), only when something of its own happens: another selection, the end of its tool or of a reshape by the plugin's own doing or with a result (the user switched the tool off; a reshape finished with a geometry), the shape coming into the view again, a layer's visibility changing, the permission coming back. A tool or a reshape that ended with `null` (Escape, or another plugin's interaction that replaced it) does not arm the drag again (amended, owner, 2026-10-27): the map view's `null` does not tell the two apart. So it never takes the map from another plugin's running interaction by itself. After an Escape on a grabbed shape, another selection and then the shape again arm its drag again.
    - **Placing ends when a shape is selected elsewhere:** a shape selected in another plugin (e.g. `object-list`) while `draw-symbols` places a symbol arms the shape's drag, which ends the placing (its "pick a point" resolves with `null`, as for Escape, and placing switches off): the last action wins. No SDK member tells a plugin that another one's interaction runs.
    - **Routes of the simulator are shapes** (function 14), so a route can be dragged as a whole: every point moves by the same difference, and the simulator copes as with a reshape (`simulator` brief, function 9b). Edit stays offered for routes (open question 4). Its point markers move with the line in the preview once `map-view-2d` function 26's fix is in.
    - **Several selected objects** are not dragged, as several shapes are not edited at once (Out of scope, M2).

**Out of scope (M3):** the "+" for declared fields in the edit panel (ADR-0038 names `draw-symbols`; shapes can follow later; decided by the owner, 2026-10-27, the ACA's U3, choice C1, and the ACA records it in ADR-0038's index row), moving or copying shapes between workspaces.

## Functions (M4)

17. **Locked layers** (ADR-0042 point 8; the owner's answers to the PDA, 2026-10-30). A layer is locked while its `locked` is `true` (SDK 1.3.0), as the live picture's layers say; the store refuses every user's change to its content with `LAYER_LOCKED`.
    - **Drawing:** while the active layer is locked, the draw tools are disabled with the title `The active layer "<name>" is locked`. A drawing that runs when the active layer becomes locked is ended with its `signal`, and nothing is sent.
    - **Edit** on an object in a locked layer opens the edit panel **read only**: every field read only (`DeclaredFields` too), no Save, no reshape, and a notice `Layer "<name>" is locked`. It follows the lock live: an unlock makes it editable, and a lock while it is open makes it read only and sends nothing.
    - **No drag:** a selected object in a locked layer is not dragged; no `dragObject` is armed for it.
    - **A `LAYER_LOCKED` rejection** (the layer was locked in between) is shown like any other. The shell's shared Delete reports refused objects itself (CDA).

## Functions (M6)

Built against SDK 1.5.0 part 1 (`sdk-v1.md`, "SDK 1.5.0"; CR-0038), `sdkVersion` `^1.5.0` (SDK 1.5.0 since part 1, owner NP A).

18. **Data types users do not choose** (CR-0038 points 6 and 7; the owner's NC A; T-165): the data type select of the Shapes panel (function 1) and of the edit panel (function 4) offers `choosableDataTypes(ctx.dataTypes, type)`, `type` the edited shape's: no `simulator.route`, `gmti.detection` or `gmti.platform`, unless the shape has one (a route, or `gmti`'s dwell area, keeps its type in Edit). A kept choice, or the setting "Data type for new shapes", that names such a type falls back to `core.general`. **Shapes carry no field sets in M6** (NC A): the panels show no `DeclaredFields`, and the plugin lists no set. The store adds no data type's sets to a shape either (model rule 21, symbols only; owner NO A).

## Functions (M7)

Built against SDK 1.6.0 (CR-0041 part B, `MapView.append`).

19. **Append points to a line** (T-176; owner, QG A from the last point, QH A lines only, 2026-11-11). A button **"Append"** next to Reshape in the edit panel (function 4), for every shape whose geometry is a `LineString`. Polygons and the other kinds keep Reshape only and show no Append.
    - **Continuing the line:** it calls `MapView.append(id, { style, signal })` (`map-view-2d` function 44). The line continues from its **last point**, click by click, and a double-click or Enter finishes.
    - **The update:** on finish the plugin sends **one update** with the returned geometry, an ordinary change request, so the server checks the user's rights. Escape, or a finish with no point added, sends nothing.
    - **When it is off:** as Reshape (functions 12 and 17), on a locked layer and without the edit permission of the workspace, disabled with its title. Only one of Reshape, Append and the drag runs at a time (function 15's `AbortController` per interaction).
    - **A switch** of workspace ends it and sends nothing (function 13).
    - **Routes:** `draw-shapes` does not offer its Edit on `simulator.route` (function 3), so routes get their Append in the simulator's route editor (its function 49; owner, Q61 A).

## Out of scope (M2)

Military tactical graphics (`core.multipoint`, decided near the end of M2, ADR-0033), sectors and corridors as tools, free-hand drawing, snapping, keeping right angles while reshaping, editing several shapes at once, copy and paste, undo, measuring, editing security labels.

## Interfaces

| Direction | What |
|---|---|
| Provides | The panels "Shapes" and the edit panel; the object action **Edit** for `core.shape` (planned in T-049). **(M3)** Both in every workspace; Edit once per workspace |
| Requires | `MapView` (planned in T-049: the drawing and editing service; already in SDK v1: selection, active layer); live picture subscription; change requests; default label; data types; notifications. Planned in T-049: panels with a default pane, the object action list, fetching objects by id. **(M3)** `ctx.workspace`, `ctx.workspaces`, `workspaces` on panels and actions, `signal` (SDK 1.2.0); the shell's workspaces (T-080). **(T-066)** `MapView.dragObject` with `signal`; the fix in `map-view-2d` function 26 for route markers |
| Objects | Creates and updates `core.shape` objects. Deletes nothing (the shell's shared Delete does) |

## Dependencies

None beyond the SDK and React (shared).

## Settings

| Setting | Default |
|---|---|
| Data type for new shapes | `core.general` |
| Outline for new shapes: colour, width, dash | `#1f3a93`, 2 px, solid |
| Fill for new shapes | none |
| Fill colour and opacity when "transparent" is chosen | `#1f3a93`, 20 % |

Changes made in the plugin's entry in the Settings tab apply at once (ADR-0031).

## Permissions

Core permission `objects.edit` to draw and edit (function 9). **From M3** a declared workspace's objects need its `editPermission` instead (function 12).

## Internet access

**Not allowed.**

## Acceptance criteria

1. Drawing each kind (circle, ellipse, square, rectangle, polygon, arrow, route) creates exactly one schema-valid change request for a `core.shape` (data model 1.1.0) in the active layer, with a new id, the default label, the chosen data type and `dataSource` `manual`. The shape appears in a second browser within 1 s.
2. Geometry: a circle as `Circle` with its radius in metres; an ellipse as `Ellipse` with semi-axes and rotation; a square, a rectangle and a polygon as closed `Polygon`s; an arrow and a route as `LineString`s. Positions read back in lon/lat match the drawn points within 1 pixel (latitude ≠ longitude).
3. Style: outline colour, width and dash, a transparent fill, a hatched fill, an arrowhead and route markers end up in the object's `style` as data model 1.1.0 defines them, and the map view draws them.
4. The name is stored as `properties.name` and drawn as the label.
5. A cancelled drawing (Escape) sends no change request.
6. Edit is offered for one selected `core.shape`, not for a selection of several and not for symbols. It opens the edit panel for the object, also from `object-list` for an object the map does not hold.
7. Editing the name, the style, the layer or the data type updates the object in a second browser; the change request contains all core fields and `baseVersion`, and `dataSource` is unchanged.
8. Reshape: moving a shape and dragging one corner send one update with the new geometry when finished; Escape sends nothing.
9. Updating a shape that carries another plugin's extension leaves that extension unchanged; the plugin writes only its own namespace `draw-shapes`.
10. The plugin has no Delete button or key; the shell's shared Delete removes shapes.
11. Two browsers editing the same shape: the later commit wins, and both show the same state.
12. Without `objects.edit`: no tool can be used, Edit is not offered, and the hint is shown. A `PERMISSION_DENIED` rejection is shown as a notification.
13. Without an active layer, drawing is impossible and the hint is shown.
14. The panels work in the left, the right and the bottom pane (ADR-0031), in both densities, and in a light and a dark look (ADR-0034).
15. **The kind:** a drawn rectangle has `{ "kind": "rectangle" }` in its extension `draw-shapes`, the edit panel shows "Rectangle", and the kind is still there after the name and the style were changed.
16. **The panel follows the selection:** it shows the shape while that one shape is selected, and closes when the selection changes to another object, to several, or to none.
17. **Live updates:** a shape changed in a second browser shows the new values in the open edit panel, except a field being typed in; Edit from `object-list` for a shape outside the map's view opens the panel marked "not in view", a change in a second browser shows there too, and a commit updates the shape.
18. **Subscription** (function 7): the layers come from one `{ objects: false }` subscription; opening the edit panel adds one subscription with a small fixed area and closing it ends it (from T-066, unless the shape is still the one selected and the user may edit); moving the map adds none; moving the edited shape away in a second browser renews the area round its new centroid, and the panel follows it. The test kit's `liveSubscriptions` shows the options. From T-066 (function 16): selecting one shape while the user may edit adds that subscription too, and a selection of anything else ends it.

From M3 (with SDK 1.2.0 and the shell's workspaces; tested with the test kit's `switchWorkspace`, and once in the browser):

19. **Every workspace:** the panels are there in View and in Simulation. The unit test checks the registered Edit actions (the test kit's `objectActions`): one per workspace, each with its own id, its `workspaces` (`appearsIn`) and its permission, `plugin.simulator.edit` in Simulation and `objects.edit` in View. That the shell offers each only there is checked in the browser once T-080 is in.
20. **Drawing in Simulation:** a shape drawn there goes into Simulation's active layer (schema-valid request); the layer field lists Simulation's layers only. Without the workspace's edit permission no tool can be used, and the hint names the workspace. A View shape put into the selection while Simulation is shown (by the test, as another plugin could) is shown read only with the hint, and cannot be reshaped.
21. **Switch:** a switch during a drawing or a reshape resolves it with `null` and sends nothing; an open edit panel closes and its fixed-area subscription ends; a tool that was on draws in the new workspace.
22. **Routes:** Edit is offered for a `simulator.route` shape in Simulation, and a reshape sends one update with the new geometry, as for any shape.
23. **`signal`:** switching a tool off during a drawing, or the active layer going, aborts the map view's interaction (the fake map view shows it ended); no late result is used.
24. **Look:** the panels pass `checkLookCss`.

From T-066 (drag a selected shape, function 16). The plugin's tests use the fake map view, wrapping its `dragObject` to record each call's id (the fake keeps none); the checks with `draw-symbols` run in the browser, by the PCA whose branch is merged second, and in the ITA's spec with T-086:

25. **Drag a shape:** a polygon with a hole, a line, a circle and an ellipse, each where latitude ≠ longitude, are dragged by a difference that is not the same in longitude and latitude (e.g. +2° in longitude and +1° in latitude). Each sends one update: every position of the polygon's rings and of the line moved by exactly that difference; the circle's and the ellipse's centre at the drop, their other values unchanged; `baseVersion` the newest version; other plugins' namespaces unchanged. A `MultiPoint`, a `Corridor`, an `ArcBand` and a `Point` move in the same way, and a position's altitude stays. In the browser the shape ends within a pixel of where the preview showed it, for shapes of ordinary size.
26. **At the edges:** a drag after which some positions would pass 90° clamps them at 90; a drag across the antimeridian gives longitudes within −180 to 180, each moved by the difference modulo 360°, and the update is schema-valid.
27. **Nothing sent:** Escape during the drag, an abort, and a drag that ends with `null` send no change request. In the browser, one Escape while the drag only waits clears the selection; on a grabbed shape it cancels the drag and the shape stays selected.
28. **When no drag is armed** (no `dragObject` call for the id is running): without the edit permission (`objects.edit` in View, `plugin.simulator.edit` in Simulation); with a tool on; during a reshape; for a shape out of the view; for a View shape put into the selection while Simulation is shown (function 11); for several selected shapes; for a selected object that is not a shape (it gets no subscription either). A shape in a layer hidden in this browser: the map view answers `null` at once, and the drag is armed again when the layer is shown. Each condition that stops holding while the drag is armed aborts it. A selection changed while the drop waits sends nothing, also when it is back to the same shape.
29. **A route:** a `simulator.route` shape in Simulation is dragged as a whole: one update, every point moved by the same difference.
30. **One interaction at a time:**
    - (plugin) another caller's interaction on the fake map view (as `draw-symbols`' early drag or its placing would start) that is running before the read answers is replaced by the shape's drag; one started after it replaces the shape's drag, which is then not armed again until something in function 16's list happens; a reshape that ends with `null` (Escape, or replaced by another caller's interaction) does not arm the drag again, nor does a tool that ends with `null`; a reshape finished with a geometry, and the tool switched off by the user, do (amended, owner, 2026-10-27);
    - (browser, with `draw-symbols`) a shape selected after a symbol gets the shape's drag, and a symbol selected after a shape the symbol's; each drag sends one update, from the right plugin only. A press on a shape before its read answers moves nothing. Placing a symbol while a shape is selected goes on.

From M4:

31. **Right-click while drawing:** a line set with three points, then a right click and Enter, is created with its first two points; a right click with no point left cancels and sends nothing.
32. **Routes:** Edit is not offered for an object of data type `simulator.route`, on the map or in `object-list`; it still is for every other `core.shape`.
33. **Default panes:** in a fresh browser "Shapes" opens in the left pane and the edit panel in the right.
34. **Locked active layer** (SDK 1.3.0, with the test kit's default answer policy): the draw tools are disabled with the title; locking the active layer during a drawing ends it with nothing sent.
35. **Edit in a locked layer:** Edit opens the edit panel read only with the notice, offers no reshape, sends nothing and arms no drag; an unlock in a second browser makes it editable.

36. **(M6) The data type select** (function 18): with `simulator.route`, `gmti.platform` (`manual` false) and `ais.vessel` declared, the Shapes panel offers General and AIS vessel only; Edit on a shape of `gmti.platform` shows GMTI platform, and saving its name keeps it.
37. **(M7) Append** (function 19): for a polyline of three points, with the fake map view's `append` resolving with five points, Append sends one update with those five, and the data type, style and name are unchanged. With `append` resolving `null` nothing is sent. A polygon's edit panel shows no Append.
38. **(M7) Append, when off:** on a locked layer and without edit rights Append is disabled with its title. A workspace switch while it runs sends nothing.

## Open questions for the owner

1 to 3 were answered by the owner on 2026-10-15, as recommended, and 4 on 2026-10-27, as recommended (the ACA supported it, T-078).

1. **Keep the drawn kind** (function 2). **Decided by the owner, 2026-10-15, as recommended: in the extension `draw-shapes`.** The recommendation was: store it in the plugin's own extension `draw-shapes` (e.g. `{ "kind": "rectangle" }`), so that the panels name the shape as drawn and an arrow and a route stay apart after a style change. Other plugins forward it untouched (ADR-0018). Alternative: derive the kind from the geometry and the style each time; a square then shows as "Polygon".
2. **The arrow's points.** **Decided by the owner, 2026-10-15, as recommended: point by point, arrowhead at the last point.** The recommendation was: point by point like a route, with the arrowhead at the last point, so that an arrow can bend (e.g. an axis of advance). Alternative: a straight arrow from two points, drawn by pressing and dragging.
3. **Hatch patterns** (T-064). **Decided by the owner, 2026-10-15, as recommended: one diagonal pattern in M2, with room for more.** The recommendation was: one pattern in M2, diagonal lines in the fill colour, with room in the model for more later. Alternative: several patterns now (horizontal, vertical, cross), each one more case in the model, the map view and the tests.
4. **Edit on the simulator's routes** (function 14; the `simulator` brief's function 9b leaves it to this brief). **Decided by the owner, 2026-10-27, as recommended: Edit kept for routes.** The recommendation was: keep Edit for every `core.shape`, routes included: `draw-shapes` stays free of any knowledge of the simulator, and the simulator already copes with a reshape, a new data type or a new layer. **Alternative:** leave `simulator.route` out of Edit's scope (`appliesTo` with a `test` on the data type), so that routes are edited only in the simulator's route editor; this ties `draw-shapes` to the simulator's data type name.
