# draw-tactical

Lets users place APP-6 tactical graphics (`core.multipoint`) on the shared map and edit them later: boundaries, phase lines, axes of advance, areas, fire support areas, range fans and the rest that the symbology service draws (brief: `docs/plugins/briefs/draw-tactical.md`, ADR-0043). It is the graphics' counterpart to `draw-symbols` and `draw-shapes`. Web part only; no internet access; built against SDK 1.8.0 (`sdkVersion` `^1.8.0`, icon `Swords`). The product name users see is emcc.

## What it does

- **Graphics panel** (default pane: left; it works in every pane). The shell's head shows the title once and the panel icon; the panels have no heading of their own (T-204, "name once, icon always"): they are SDK `PanelFrame`s with `heading={false}` (SDK 1.8.0 part G), and the Edit panel's Close button is in the frame's action bar, on the right.
  - **Identity** (friend, hostile, neutral, unknown), **status** (present, or planned, which the renderer draws dashed) and, for a graphic whose catalogue entry shows an echelon (the boundary, the battle position), the **echelon**. They go into the SIDC, composed with `SymbolService.compose`.
  - **The graphic**, as picture tiles (T-204; the UXA's finding P3) in the SDK's `TileGrid`: one search field ("Find a graphic", over the names and the path), then the short list of 40 in four folding groups, then "All graphics" (a button below the grid): the symbology service's whole catalogue for the setting's standard, whose folder groups are added to the same grid when it is opened, or by a search. The folders start closed (`TileGroup.closed`, SDK 1.8.0 part G), so opening "All graphics" adds no tiles until the user opens a folder, and no picture is asked for before; while a search is on they start open, and what the user opened or closed before it is kept. "All graphics" has one folding group per folder of each entry's `path` (a folder of more than 40 graphics, such as Control Measure, is split into its own folders, "Control Measure › Maneuver Lines"). One tile is chosen, one Tab stop over the whole grid, the arrow keys, Home, End, Enter and Space as in the lists. A name several graphics share is shown with its place, e.g. "Block (Mission Tasks)". A graphic that is in the short list is also in its folder; only the tile that was clicked shows as chosen.
  - **A tile's picture** is the graphic itself, drawn small: the plugin asks `SymbolService.renderGraphic` for it once, friend and present, through generic sample points (a wave for a line, a box for an area, an arrow's tip, axis and head) in a small view, and draws the lines, fills and labels as an SVG of plain numbers and text on a light paper (APP-6's colours are made for it, so the patch is light in every look, as the map's own drawing is, ADR-0034). The graphic is asked for only when its tile is near the screen. A graphic that needs amplifiers (a range fan's distance and azimuths), or that the service does not draw, shows its kind's icon. The plugin never calls mil-sym-ts.
  - **The points.** The chosen graphic's point count and its `points` texts in order ("1: the tip of the arrow", "2 to n−1: the axis, from the tip back to the tail", "n: the width of the arrowhead"), so the user knows where to click.
  - **The amplifiers** the graphic allows (`allowedModifiers`): a text field for each text amplifier, labelled with its APP-6 letter and name (e.g. "T1 Unique designation 2"), and for `distances` (AM, metres) and `azimuths` (AN, degrees) a list of numbers, one field per line, in the order the graphic's `points` text describes. Required ones are marked "(required)"; while one is empty or any is invalid (a distance outside 0 to 20 000 000 m, an azimuth outside 0 to 360°, more than 64 values, text over 128 characters) the tool is disabled and its title says why.
  - **The name** (`properties.name`). **No data type picker and no data type setting** (M8, T-190; owner SW A and US): a new graphic is always `core.general`. A graphic stored with another type keeps it; Edit sends it unchanged, and nothing is migrated. A `dataType` setting or a browser choice left by an earlier build is ignored. Graphics carry no field sets in M6.
  - **Place graphic** starts the tool; **Stop placing** ends it. The button is at the top of the panel and in the panel foot (`PanelFrame`'s `foot`, a `PanelFoot` full width after the scrolling body and pinned at the bottom; T-190, T-204, SDK 1.8.0 part G): the same control twice, with the same label, state and disabled reasons. The panel asks the symbology service for the catalogue when it is first shown, not when the plugin starts, so the renderer loads only for someone who looks.
- **Place.** With the tool on, the map view's drawing runs for the chosen graphic and previews the graphic itself while the points are set (`MapView.draw` with `graphic`):
  - `line` and `arrow` with `draw('line', { graphic })`; `area` with `draw('polygon', { graphic })`;
  - `points` (a circular target, a range fan: one point) with `pickPoint` per point, with the plugin's own overlay of the points set so far.

  The points are stored as clicked, in the catalogue's order. An area drawn as a polygon is stored as the catalogue's `geometry` says: a `Polygon` as returned (closed), or a `LineString` of the ring's points without its closing position. The map view keeps the drawing within the graphic's `minPoints` and `maxPoints`; the plugin checks the count again and sends nothing outside them. Escape cancels and sends nothing. While a line, arrow or area is drawn a right click takes back the last point (with none left it cancels); while a `points` graphic is picked a right click is Escape (the map view's `pickPoint` rule). The tool stays on for the next graphic; a placing that ends with `null` (Escape, or another plugin's interaction replacing it) switches it off, as `draw-shapes` does. Choosing another graphic while the tool is on starts the placing again for it (the points set so far are dropped).
- **Create.** One create request for a `core.multipoint` in the active layer: a new UUID v7 id, the default security label, the data type `core.general`, `dataSource` `manual`, `symbol` (the standard, the composed SIDC and the amplifiers filled in as `modifiers`), `geometry` and `properties.name`. No extension of its own is written. After a create the name and the text amplifiers are cleared; distances and azimuths stay, since the tool needs them for the next graphic of that kind. Without an active layer the tool is off with "Select or create a layer in the layer panel".
- **Edit** (object action, one `core.multipoint`, needs `objects.edit`, or the workspace's edit permission). It selects the graphic and opens the **edit panel**, which exists while that one graphic is selected. It edits every `core.multipoint`, also those other plugins made, and an object the browser does not hold is fetched by id.
  - The panel edits the name, the identity, the status, the echelon (where the graphic has one), the amplifiers and the layer (no data type: an update sends it unchanged), and shows the graphic's name and the standard, the classification, version, last modified and data source. Each field commits when it is committed (Enter, leaving the field, a choice, removing a value of a list), as one update with the complete core content from the newest state and `baseVersion`; other plugins' namespaces are never sent, so the store keeps them. Changing the identity, status or echelon changes those digits of the SIDC and leaves the others.
  - An amplifier the object carries that the graphic does not allow (set by another plugin) is kept on every update and shown read only. A required amplifier cannot be emptied; an invalid value is refused and nothing is sent.
  - **Reshape** starts `MapView.edit(id)`, which moves the graphic or its control points with the graphic itself as the preview; on finish one update with the new geometry, nothing on Escape. A result with a point count outside the graphic's or another geometry type is refused.
  - **A graphic the catalogue lacks** (APP-6B, or a code the service does not draw) shows its properties (name, layer) with "This graphic is not drawn", and cannot be reshaped.
  - **Not in view, live updates, rejections** are as in `draw-shapes`: a graphic outside the map's view is marked "Not in view" (Show on map centres on it), a change made elsewhere shows in the open panel except in a field being typed in, a graphic deleted elsewhere closes the panel with a notice, a rejected request is shown as a notification and the input stays.
- **Drag to move.** While exactly one `core.multipoint` is selected and the user may edit, a press and drag on it moves it (`MapView.dragObject`, one `AbortController`); a drop moves every control point by the difference between the drop and the first point, in longitude and latitude, in one update. Latitudes clamp at ±90, longitudes wrap into −180 to 180, altitudes stay. The arming rules (no tool, no reshape, in view, in the workspace's layers, not locked, armed again after a drop but not by an Escape alone) are `draw-shapes`' function 16.
- **No Delete of its own.** The shell's shared Delete removes graphics.

### The short list

Chosen by PCA-draw-tactical from the APP-6 D catalogue (all 40 are in APP-6 E too); one the catalogue of the setting's standard lacks is not shown. The owner checks the list in the browser.

| Group | Graphics |
|---|---|
| Boundaries and lines | Boundary, Forward Line of Troops, Forward Edge of the Battle Area, Line of Contact, Phase Line, Line of Departure, Limit of Advance, Final Coordination Line, Fire Support Coordination Line (FSCL), No Fire Line, Main Supply Route |
| Areas | Area of Operations, Assembly Area, Objective, Battle Position, Engagement Area, Landing Zone, Attack Position |
| Axes and tasks | Main Attack and Supporting Attack (axes of advance), Friendly Main Attack / Decisive and Friendly Supporting Attack (directions of attack), Counterattack by Fire, Delay, Withdraw, Breach, Block (Mission Tasks) |
| Fires and obstacles | Circular Target, Rectangular Target, Area Target, Weapon/Sensor Range fan Circular and Sector, No Fire Area Irregular and Rectangular, Free Fire Area Irregular and Rectangular, Fire Support Area Irregular, Mined Area (the minefield), Obstacle Belt, Obstacle Line |

### How a graphic is stored

| Catalogue `kind` | `geometry` | Control points |
|---|---|---|
| `line`, `arrow` | `LineString` | The positions, in order |
| `area` | `Polygon` (points without fixed roles) or `LineString` (points with roles) | The ring without its closing position |
| `points` | `MultiPoint` | One position for a circle or a range fan |

`symbol` is `{ standard, sidc, modifiers? }`; `modifiers.distances` and `azimuths` are arrays of numbers (data model 1.4.0). Coordinates are WGS84 longitude, latitude, as the map view returns them; a longitude outside ±180 is brought back, a latitude outside ±90 refuses the graphic. The drawing colours, line widths and dashes are APP-6's, from the symbology service (owner, Q2, 2026-11-06); this plugin writes no `style`.

### Live updates and subscriptions

The plugin never subscribes by the viewport. One subscription `{ objects: false }` gives the layers all the time. While a graphic is open in the edit panel, or is the one selected object and the user may edit, a second subscription with a fixed area of 500 m half side round its centroid follows it, as `draw-shapes` does (`watch.ts`); it starts after the graphic was read by id and ends with the edit or the selection. A selected object that is not a `core.multipoint` gets no subscription.

## Workspaces

The plugin works in every workspace (briefs README, "M3: the reused plugins in a workspace"; brief, function 10). Both panels have `workspaces: ['*']`. **Edit** is registered once per workspace in `ctx.workspaces`: id `edit` for View, `edit:<workspace id>` for another, each with that workspace's `editPermission` (`objects.edit` for View). The tool, the edit panel, Reshape and the drag need the shown workspace's edit permission, else the tool is off with "You may not edit objects" (in a workspace: "... in Simulation"). New graphics go into the shown workspace's active layer; the Layer field lists only that workspace's layers; a selected graphic outside them is read only with "This graphic is not in Simulation". A switch ends a running placing or reshape with `null` (nothing is sent), closes the edit panel with its subscription, and a tool that was on places in the new workspace if the user may place into it.

## Locked layers

A graphic in a locked layer (ADR-0042) is read only in the edit panel (notice `Layer "<name>" is locked`), is not reshaped or dragged, and the Layer field offers locked layers disabled. A locked active layer disables the tool with the title `The active layer "<name>" is locked`; a placing running when the layer becomes locked is ended and sends nothing. A `LAYER_LOCKED` rejection is shown like any other.

## Settings

| Name | Default | Meaning |
|---|---|---|
| `standard` | `APP-6D` | The standard of new graphics, and of the catalogue the panel offers (`APP-6D` or `APP-6E`) |
| `standardIdentity` | `Friend` | The identity a new graphic starts with (`Friend`, `Hostile`, `Neutral`, `Unknown`) |

Each setting has a short hint under its field in the Settings tab (`x-emc2.hint`, T-204); the manifest's icon is `Swords`.

A change in the plugin's entry in the Settings tab applies at once (the identity in the panel starts again from it; a new standard loads its catalogue). A bad value is reported (status `DEGRADED`) and the default is used.

## Messages and services

- Requires `emc2.map-view` (`MapView`: `draw` with `graphic`, `edit`, `pickPoint`, `dragObject`, selection, active layer, overlay, `centreOn`) and `emc2.symbols` (`SymbolService`: `graphicCatalog`, `compose`, `describe`, `catalog`). Provides no services; no topics. It never calls mil-sym-ts (ADR-0043 point 2).
- Panels: `draw-tactical` (Graphics, default pane left) and `draw-tactical-edit` (Edit graphic, default pane right). The edit panel is added when Edit opens it and removed when the selection changes.
- Object actions: `edit` for `core.multipoint` (one object) and `edit:<workspace id>` in each other workspace.
- Change requests: `create` and `update` of `core.multipoint` objects. It deletes nothing.

## Permissions and internet

- `objects.edit` to place and edit in View, and a workspace's own edit permission in that workspace. The server checks every request anyway; a `PERMISSION_DENIED` rejection is shown as a notification.
- Internet: not allowed.

## Known limits

- **Out of scope in M5 (brief):** field sets (ADR-0050) in the panel and the edit panel (other plugins' fields on a graphic are kept untouched, not shown), APP-6B graphics (shown by the map view as a marker, not placed here), adding or removing points while reshaping, the user's own favourites or recently used graphics, copying graphics, undo, editing several graphics at once, editing security labels, altitudes beyond the X amplifier's text.
- **21 graphics draw without mil-sym-ts's inner icon in M5** (owner, HW; for M6). That is the renderer's, not this plugin's.
- **Changing the identity, status, amplifiers or name while the tool is on** applies to the next graphic, not to the preview of the running placing; choosing another graphic restarts it. The graphic created is composed from the choices at the moment of the last click.
- **A tile's picture is the graphic drawn through generic sample points**, not through its real geometry: graphics of one kind look alike except for their lines, fills and labels (PL, LD, FLOT); a graphic that needs amplifiers shows its kind's icon. In the comfortable density a narrow pane shows one column of tiles (the SDK's grid).
- **`points` graphics** have no live preview at the pointer: the point is picked, and the graphic appears when the object is created. The overlay shows the points set so far (only one point exists today).
- **A graphic with many points** is limited by the catalogue's `maxPoints`; a polygon area has a closing position the plugin drops and writes again, so a ring the user clicked clockwise stays clockwise (the store may reverse a ring: model rule 1, which is why the catalogue uses `Polygon` only for areas whose points have no roles).
- **The panels were checked in the browser** (2026-11-06; below) in the left pane, the right pane and the bottom pane, in the Night Watch look and in a light one, and in the compact and the comfortable density. The unit tests cover the CSS part (`checkLookCss`), not the panes, densities and looks.
- The reshape result must have the object's geometry type and a point count the graphic takes; the map view's own limits (`minPoints`, `maxPoints`) apply while it runs.
- "Not in view" looks only at the control points (vertices) and at whether a polygon covers the view's centre: a long line that crosses the view with both ends outside is marked "not in view" although it is visible. `edit` stays the authority.
- Several selected graphics are not dragged or edited at once.

## Browser check (T-144, 2026-11-06, port 18101)

Built-in browser, `node tools/build.mjs` on this branch, fresh data folder, `symbology` and `map-view-2d` from `integration/sdk-v1.4`. The catalogue loaded when the panel was first shown, and the short list showed the real graphics (all 40 are in the APP-6 D and E catalogues, checked by script against the symbology plugin's own engine). Seen and read back from the store through the live socket:
- **An axis of advance (Main Attack) grows as points are set, and the finished graphic matches the preview** (criterion 16): four points stored in the clicked order, `LineString`, SIDC `10032500001514030000`, `dataSource` `manual`, by `draw-tactical`.
- **A sector range fan** with distance 40 000 and azimuths 20 and 110: one pick, `MultiPoint` with one position, `modifiers.distances` and `azimuths` as numbers; the map draws the sector with its labels. Edit from the object menu (one Edit) opened the panel in the right pane; changing the distance to 90 000 gave version 2 with the azimuths unchanged; a drag moved the one control point (version 3, modifiers kept).
- **An area (Assembly Area):** stored as a closed `Polygon` in the clicked order; Reshape with a dragged corner gave version 2 with the same number of points.
- No console error.
