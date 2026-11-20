# draw-shapes

Lets users draw plain shapes on the shared map and edit them later (brief: `docs/plugins/briefs/draw-shapes.md`, ADR-0033). Web part only; no internet access.

## What it does

- **Shapes panel** (default pane: left from M4, right before; it works in every pane). A tool for each kind of shape: circle, ellipse, square, rectangle, area (polygon), arrow and route. Also the style and the name for new shapes, and the data type (the data types users choose, by name, from SDK 1.5.0 `choosableDataTypes`: a type declared with `manual: false`, such as `simulator.route` or `gmti.platform`, is left out; the choice is kept per browser in `localStorage`, and the setting applies without one; a kept choice or a setting that names a type left out falls back to `core.general`). The edit panel's select does the same for the shape's own type: a shape of a left-out type keeps it, and saving another field does not change it. Shapes carry no field sets in M6 (the panels show no `DeclaredFields`).
- **Draw.** With a tool on, the map view's drawing service (`MapView.draw`) runs: circle, ellipse, square and rectangle by pressing and dragging; area, arrow and route point by point (double-click or Enter finishes, Escape cancels). When a shape is drawn, the plugin sends one create change request for a `core.shape` in the active layer, with a new id, the default security label, the chosen data type, `dataSource` `manual`, the style, the name as `properties.name`, and the kind in its own extension. The tool stays on for the next shape; Escape, or another map interaction, switches it off. Without an active layer, or without `objects.edit`, the tools are switched off and the panel says why.
- **Edit** (object action, one `core.shape`, needs `objects.edit` in View and the workspace's edit permission in another workspace: see "Workspaces"). It selects the shape and opens the **edit panel**, which exists while that one shape is selected (it closes when the selection changes to anything else). The panel edits the name, the style, the layer and the data type, and shows the kind, classification, version, last modified and data source. **Reshape** starts the map view's editing service (`MapView.edit`): move the shape or drag its corners, a circle's radius, an ellipse's axes and rotation; one update is sent when it finishes, nothing on Escape. It edits every `core.shape`, also those other plugins created; geometries the editing service does not reshape (`Corridor`, `ArcBand`) show their properties only.
- **Append** (M7, T-176; brief, function 19; SDK 1.6.0). For a shape whose geometry is a `LineString`, the edit panel has an **Append** button next to Reshape (polygons and the other kinds show none: lines only). It calls `MapView.append(id, { style, signal })`: the line continues from its last point, click by click; a double-click or Enter finishes, Escape sends nothing. On finish the plugin sends **one update** with the returned line, an ordinary change request. It shares Reshape's guards: one of Reshape, Append and the drag runs at a time; it is off, with the reason as its title (the permission, the workspace, a locked layer, "Show the shape on the map first"), and a workspace switch, a lock or closing the panel ends it with nothing sent. `MapView.append` is required since the 1.6.0 freeze (the PDA removed the plugin's guard for a map view without it). Routes of the simulator (`simulator.route`) get no Edit from this plugin, so their Append is in the simulator's route editor. Reshape's title now names its reason in the same way.
- **Drag to move** (T-066). While exactly one `core.shape` is selected and the user may edit, a press and drag on the shape moves it; a click still selects. The plugin keeps the map view's `MapView.dragObject` armed for the selected shape, with one `AbortController`, and ends it as soon as a condition stops holding: another selection, a tool on, a reshape, the shape out of the view. After a drop it is armed again at once; after Escape (or when another plugin's interaction replaced it) only when something of its own happens (another selection, the shape back in view, a layer shown). A tool the user switches off, and a reshape that ends with a result, arm it again; a tool or reshape that ends with null (Escape, or another plugin's interaction replaced it, e.g. `draw-symbols`' placing) does not, so the drag never ends that plugin's interaction by itself. A drop moves every position by the difference between the drop and the geometry's first position, in longitude and latitude, as the map view's preview does: a polygon (every ring), a line, a set of points and a corridor move every position; a circle, an ellipse and an arc band move their centre, with the radius, axes, rotation and bearings unchanged. Latitudes clamp at ±90, longitudes wrap into −180 to 180, altitudes stay. It is one update (the complete core content and `baseVersion`, other plugins' namespaces untouched), sent after any update of that shape still under way, from the newest state; nothing is sent if the selection changed meanwhile, on Escape or on an abort. Reshape stays as it is.
- **No Delete of its own.** Shapes are deleted with the shell's shared Delete.

### How a shape is stored

| Kind | Geometry | Style fields (data model 1.1.0) |
|---|---|---|
| circle | `Circle` (radius in metres) | outline; optional fill |
| ellipse | `Ellipse` (semi-axes in metres, rotation) | outline; optional fill |
| square, rectangle, area | closed `Polygon` | outline; optional fill |
| arrow | `LineString` | outline, `arrowhead: 'end'` |
| route | `LineString` | outline, `pointMarkers: 'circle'` |

- The outline is `strokeColor`, `strokeWidth` and `strokeDash` (`solid`, `dash`, `dot`). A **transparent** fill is `fillColor` and `fillOpacity`; a **hatched** fill adds `fillPattern: 'hatch'`; **none** has no `fillColor`.
- **The kind** is stored in the extension `draw-shapes`: `{ "kind": "rectangle" }`, one of `circle`, `ellipse`, `square`, `rectangle`, `polygon`, `arrow`, `route`. **It is a documented key:** other plugins (e.g. `object-list`) may read it, and fall back to the geometry type when it is missing or no longer fits the geometry.
- An update sends all core fields from the newest state with only the edited field changed, plus `baseVersion`; `dataSource` is unchanged; no extension is sent, so the store keeps this plugin's `draw-shapes` and every other plugin's extension (model rule 5).
- Coordinates are WGS84 longitude, latitude, as the drawing service returns them; a longitude outside ±180 is brought back, a latitude outside ±90 refuses the shape.

### Live updates and subscriptions

The plugin never subscribes by the viewport (brief, function 7), so a map move costs the object store nothing for it:

- **The layers:** one subscription `{ objects: false }`, all the time (the Layer field of the edit panel, and the check that the active layer exists).
- **The shape being edited or selected:** while one shape is open in the edit panel, or is the one selected object and the user may edit (T-066), a second subscription with a small fixed area: a ring of 500 m half side round the shape's centroid (the vertex centroid of a line or polygon, the centre of a circle or an ellipse), `inside` at the centroid, `budget` 500. The store matches a shape whose bound reaches the ring, so a large shape stays in it while it overlaps the ring. It starts after the shape was read by id, and ends with the edit or, for a merely selected shape, when the selection changes. The area is renewed (unsubscribe, subscribe) round the new centroid when the store reports the shape as `left` (someone moved it away), and when our own change moved the centroid out of the ring. The store also sends the other objects in the ring; the plugin ignores them. A shape the store does not send (clustered in a crowded ring) is simply not held: it is read by id before every commit.
- A shape changed elsewhere shows its new values in the open edit panel, except fields being typed in (the name and the colours keep the user's draft until it is committed or refused). A shape deleted elsewhere closes the panel with a notice.
- **Not in view:** the panel marks a shape **Not in view** when none of its points is inside the map's `viewport.visibleArea` (our own point-in-ring test, followed with `onViewportChange`; exact for any ring: the ring is unrolled onto a plane, one that winds round a pole is closed through that pole, and a view wider than the world is the band between its latitudes; a polygon or circle that covers the view's centre counts as in view). Reshape is off for it, **Show on map** centres the map on it, and the live updates go on. A shape that is not in view is read by id again before every commit, so that the update is based on the newest version.

## Workspaces (M3)

The plugin works in every workspace (`sdkVersion` `^1.3.0` from T-120, `^1.2.0` before; briefs README, "M3: the reused plugins in a workspace"; brief, functions 10 to 15). It never names a workspace of another plugin: ids come from `ctx.workspaces`.

- **Panels:** Shapes and Edit shape have `workspaces: ['*']`.
- **Edit** is registered once per workspace in `ctx.workspaces`: id `edit` for View, `edit:<workspace id>` for another, each with `workspaces: [id]` and that workspace's `editPermission` (`objects.edit` for View), so the shell offers each only where the user may use it. It is offered for every `core.shape` except the simulator's routes (data type `simulator.route`, tested by `appliesTo.test`; from M4, owner 2026-10-30): their editor is the simulator's "Edit route". Centre on, Zoom to and Delete are the shell's and stay; a route can still be dragged.
- **Who may draw and edit:** the tools, the edit panel, Reshape and the drag need the shown workspace's `editPermission` (`plugin.simulator.edit` in Simulation), else `objects.edit` in View. Without it the tools are off, with the hint "You may not edit objects in Simulation" (View: "You may not edit objects").
- **Where it draws:** the plugin lists only the shown workspace's layers (`workspaceOf(layer)`); new shapes go into the active layer, and the edit panel's Layer field lists only those layers. A selected shape whose layer is not one of them (another plugin selected it) is shown read only with the hint "This shape is not in Simulation", cannot be reshaped or dragged, and no update is sent for it.
- **On a switch** (the shell's `current` changes first, the map view ends the running interactions and clears the selection at its moment, then `onChange`): the edit panel closes with the selection and its fixed-area subscription ends; a drawing or reshape that ran resolves with `null` and sends nothing; a tool that was on starts again in the new workspace if it has an active layer the user may draw into, else it goes off (if the active layer arrives within two seconds after the switch, the tool starts then: the order of the plugins' listeners is not set).
- **`signal`** (CR-0020): one `AbortController` per tool and per reshape ends the map view's drawing and editing when the tool is switched off or changed, the active layer goes, the edit panel closes, or the workspace changes. The token that ignored a late result is gone. Escape still ends a tool.

## Settings

| Name | Default | Meaning |
|---|---|---|
| `dataType` | `core.general` | The data type of new shapes until a user chooses one in this browser |
| `outlineColor` | `#1f3a93` | Outline colour of new shapes |
| `outlineWidth` | `2` | Outline width in pixels (1 to 20) |
| `outlineDash` | `solid` | `solid`, `dash` or `dot` |
| `fill` | `none` | `none`, `transparent` or `hatched` |
| `fillColor` | `#1f3a93` | Fill colour when the fill is transparent or hatched |
| `fillOpacity` | `0.2` | Fill opacity, 0 to 1 (20 %) |

A change in the plugin's entry in the Settings tab applies at once and resets the style in the Shapes panel to it. A bad value is reported (status `DEGRADED`) and the default is used.

## Messages and services

- Requires `emc2.map-view` (`MapView`: drawing and editing service, selection, active layer, `centreOn`); provides no services; no topics.
- Panels: `draw-shapes` (Shapes, default pane left) and `draw-shapes-edit` (Edit shape, default pane right). The edit panel is added when Edit opens it and removed when the selection changes.
- **SDK 1.8.0 (M8, T-204; "name once, icon always"; settings hints):**
  - Both panels give an `icon` (Shapes: `Shapes`; Edit shape: `Pencil`) and draw no heading of their own, since the shell's head shows the title. The edit panel's Close button is the first thing in its body.
  - **Reshape and Append are the edit panel's `PanelFoot`**, a direct child of the body and its last element, so the shell pins it at the bottom while the body scrolls. A polygon, circle or other reshapable shape has Reshape alone; a geometry that cannot be reshaped has no foot. The hints that appear while Reshape or Append runs stay in the body above it.
  - The manifest has `"icon": "Shapes"` and `sdkVersion` `^1.8.0`. The settings schema has `x-emc2` groups (**Outline**: colour, width, dash; **Fill**: fill, colour, opacity; the data type first and unheaded), a hint of at most 80 characters for every description that is longer, the unit `px` on the outline width and the width `short` on the two colours. Only annotations: validation does not change. `test/sdk18.test.tsx` runs the SDK's `settingsHintsProblem` and `formSections` on it.
- Object actions: `edit` for `core.shape` except data type `simulator.route` in View (one object, `objects.edit`, group `edit`), and `edit:<workspace id>` in each other workspace of `ctx.workspaces`, with that workspace's `editPermission`.
- Live picture: `{ objects: false }` for the layers, and while a shape is edited one subscription with a fixed area round it (see above). Reads objects by id (`ctx.objects.get`).
- Change requests: `create` and `update` of `core.shape` objects. It deletes nothing.

## Permissions and internet

- `objects.edit` to draw and edit in View, and a workspace's own edit permission (`plugin.simulator.edit` in Simulation) in that workspace; the plugin's manifest names `objects.edit` only, the other comes from the workspace's record. Without it the Shapes panel shows the tools switched off with "You may not edit objects" (in a workspace: "... in Simulation"), and Edit is not offered (the shell filters it). The server checks every request anyway; a `PERMISSION_DENIED` rejection is shown as a notification.
- Internet: not allowed.

## Locked layers (M4, T-120)

A layer is locked while its `locked` is `true` (SDK 1.3.0, ADR-0042; brief, function 17). The store refuses every user's change to its content with `LAYER_LOCKED`, so the plugin treats it as read only. It follows the lock live from the layers' subscription; an unlock in a second browser makes the layer editable at once.

- **Drawing:** while the active layer is locked, the seven tools are disabled with the title `The active layer "<name>" is locked`. A drawing that runs when the active layer becomes locked is ended with its `signal`, and nothing is sent; after an unlock the tool stays off.
- **Edit** on a shape in a locked layer opens the edit panel read only: every field is disabled, Reshape is disabled, and the notice `Layer "<name>" is locked` shows. A lock while the panel is open does the same, ends a running reshape and sends nothing; a name being typed is not sent (a notification says why).
- **Layer field:** a locked layer is listed but disabled, except the shape's own layer; a stale choice of one is refused without a request.
- **No drag:** no `dragObject` is armed for a selected shape in a locked layer; an unlock arms it, a lock ends it.
- **A `LAYER_LOCKED` rejection** (the lock came in between) is shown like any other: `Could not <what>: <message> (LAYER_LOCKED)`.

## Known limits

- **The drag is armed only for a selected shape the plugin has read by id** (one `ctx.objects.get` for every single selection while the user may edit; an object that is not a shape gets no subscription). A press before that read answers belongs to `draw-symbols`' early drag.
- Every position moves by the same degrees, so a large north–south move changes a polygon's or line's size in metres a little, and near a pole a short drag can be a large shift in longitude that distorts the shape. A circle, an ellipse and an arc band keep their size in metres.
- **Escape, or another map interaction, switches the tool off.** The plugin does not start a new drawing at once, so it cannot fight another interaction.
- Reshaping a square or rectangle does not keep its right angles (M2); the stored kind stays.
- Reshape needs the shape to be drawn by the map view; for a shape that is not in view use **Show on map** first. The map holds a margin round the screen, so a shape just outside the screen is marked "not in view" although `edit` would accept it.
- In a crowded ring (more than 500 objects) the store may send the edited shape as part of a cluster; it is then not held and gets no live updates, and every commit reads it by id first.
- The style form offers widths 1 to 20 px and opacities in steps of 10 %; a value outside these (set by another plugin) is shown and kept.
- Out of scope (brief): military tactical graphics, sectors and corridors as tools, free-hand drawing, snapping, editing several shapes at once, copy and paste, undo, measuring, editing security labels.
- The kinds and `edit` are tested against the SDK test kit's fake map view. In the real shell all seven kinds were drawn one by one, a circle and a rectangle corner were reshaped, and the panels were checked in all panes, both densities and a light and a dark look (2026-10-17 and 2026-10-18).
- **A shape that leaves the map's own area stays selected.** The map view removes an id from its selection only when the object is deleted (not when it leaves the map's area), so when someone moves the edited shape out of the map's area the panel stays open (it follows the selection), is marked "not in view" and renews its own area round the new place. The panel closes when the selection leaves the shape or the shape is deleted.
- "Not in view" looks only at the shape's points (vertices, and points on a circle, an ellipse or an arc band), and at whether a polygon or circle covers the view's centre: a line that crosses the view with both ends outside, or an ellipse that covers the view, is marked "not in view" although it is visible. `edit` stays the authority: it rejects a shape the map does not draw.
- **Show on map** uses `MapView.centreOn`; if the map view refuses, the plugin shows the error as a notification.
