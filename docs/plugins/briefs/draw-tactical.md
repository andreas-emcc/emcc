# Brief: draw-tactical

- Status: **Approved by the owner (2026-11-06, HQ).** With the owner's answers of 2026-11-06: Q1 (a graphic is previewed as itself while it is placed) and Q3 (a short list of common graphics, and all of them behind "All graphics"). · Milestone: M5 · Task: T-144 · Agent: PCA-draw-tactical (new; browser-check port 18101)
- Read also: **ADR-0043 (tactical graphics with mil-sym-ts)**, ADR-0033 (drawn shapes), ADR-0032 (selection, object actions, the shared Delete), ADR-0039 (workspaces), ADR-0042 (the layer lock), ADR-0023 (data types), ADR-0029 and ADR-0034 (design system, looks), `model/README.md` ("Changes in 1.4.0", tactical graphics), the `draw-shapes` brief (this plugin follows it wherever this brief says "as `draw-shapes`"), the `symbology` brief (functions 8 and 9) and the `map-view-2d` brief (functions 29 to 32).
- **Updated 2026-11-08 for the 1.4.0 freeze (owner, Q23): function 1's last line, criterion 14 retired.** `SymbolService.graphicCatalog` and `renderGraphic` are required, so a symbology service without them no longer exists. **Approved by the owner (2026-11-08, LN).**
- **Updated 2026-11-10 for M6 (T-165; CR-0038 points 6 and 7, the owner's NC A; SDK 1.5.0 part 1): function 13, criterion 17.** The data type selects leave out the types users do not choose. Graphics carry no field sets in M6. **Approved by the owner (NQ A, 2026-11-10)**; with Q31 A (NO A: a data type's sets go on symbols only) and Q32 A (NP A: SDK 1.5.0 from part 1).
- **Updated 2026-11-10 for M6 (owner, HW; CR-0039 part 2, approved by the owner, OB A; SDK 1.5.0 part 2): function 14, criterion 18.** The icons inside 21 graphics come from `symbology` and `map-view-2d`; nothing to build here, one browser check. **For the owner's approval.**
- **Updated 2026-11-13 for M8 (T-190; owner SW A, SX A): functions 1, 3, 6 and 13, criteria 7, 17 and 19.** No data type picker for graphics, when placing or editing: a new graphic takes the setting's type, an existing one keeps its own. A second "Place graphic" button at the top of the Graphics panel.
- **Updated 2026-11-14 for M8 (T-190; owner US, 2026-11-13: "Tactical graphics can only have type general"; owner, 2026-11-14, A): functions 1, 3 and 13, the settings, the Requires row, criteria 2 and 17.** The setting "Data type for new graphics" goes: every new graphic is `core.general`. A graphic stored with another type keeps it, and Edit sends it unchanged (no migration).
- Built against **SDK 1.4.0** (CR-0030 part 2; `sdk-v1.md`, "SDK 1.4.0"), `sdkVersion` `^1.4.0`, and **data model 1.4.0**.

## Purpose

Lets users **place and edit APP-6 tactical graphics** (`core.multipoint`) on the shared map: boundaries, phase lines, axes of advance, areas, fire support areas, range fans and the rest that the symbology service draws (ADR-0043; the owner's decision GM: a new plugin, not `draw-shapes` extended). It is the graphics' counterpart to `draw-symbols` and `draw-shapes`.

## Kind and parts

- Kind: **general** (it places objects). Properties: none.
- Parts: **web only.**

## Functions

1. **Graphics panel** (left pane by default; it works in every pane, ADR-0031): what the next graphic is, and its tool.
   - **The standard identity** (friend, hostile, neutral, unknown; from `SymbolService.catalog().standardIdentities`), the **status** (present or planned; a planned graphic is dashed) and, for a graphic whose catalogue entry has `echelon`, the **echelon** (from `catalog().echelons`). They go into the SIDC.
   - **The graphic** (owner, Q3, 2026-11-06): first a **short list** of 30 to 40 common graphics, grouped as boundaries and lines, areas, axes, fires and obstacles, for example the boundary, the phase line, the line of departure, the forward line of own troops, the assembly area, the objective, the main and the supporting attack, the circular and the rectangular target, the weapon and sensor range fans, the no-fire and the free-fire area, and a minefield. The PCA chooses them from the catalogue, the README lists them, and the owner checks them in the browser (as `symbology` function 6). Then **"All graphics"**: the whole catalogue of the setting's standard (`graphicCatalog`) as a tree by each entry's `path`, with a search field over the names. A graphic of the short list that the catalogue lacks is not shown.
   - **What its points are:** the chosen graphic's `points` texts, in order, and its point counts, so the user knows where to click (e.g. "1: the tip of the arrow; 2 to n−1: the axis, from the tip back to the tail; n: the width of the arrowhead").
   - **Its required amplifiers** (e.g. a range fan's distances and azimuths), as fields that must be filled before the tool can start (function 4).
   - **The name** (`properties.name`). **No data type picker** (M8, T-190; owner SW A; M5 to M7 had one, as `draw-shapes`): a new graphic is always **`core.general`** (owner US, 2026-11-13; the setting "Data type for new graphics" of M8's first build is gone).
   - **"Place graphic" twice** (M8, T-190; owner SX A): the button that starts the tool ("Place graphic", "Stop placing" while it is on) is at the top of the panel as well as at the bottom, since the list is long and the top is what shows. Both are the same control in two places: the same label, state, hint and disabled reasons (functions 4, 11 and 12).
   - The panel opens without loading the renderer: the catalogue may come without it (`symbology` function 8). Every symbology service offers `graphicCatalog` since the 1.4.0 freeze (owner, Q23, 2026-11-08), so there is no "not available" state any more.
2. **Place** (`MapView.draw` with `graphic`, owner, Q1, 2026-11-06): with a graphic chosen and the tool on, the user sets its points on the map, and the map view previews the graphic itself from the points so far (`map-view-2d` function 32).
   - **By kind:** `line` and `arrow` with `draw('line', { graphic })`; `area` with `draw('polygon', { graphic })`; `points` with one `pickPoint` per point (one point for a circle or a range fan), the preview being the plugin's own overlay of the points set.
   - **The points' order** is the catalogue's: the user clicks them in that order (function 1 shows it), and the plugin stores them as clicked. An `area` drawn as a polygon is stored as the catalogue's `geometry` says: a `Polygon` as returned, or a `LineString` of the ring's points without its closing position.
   - **Counts:** the map view keeps the drawing within `minPoints` and `maxPoints` (`map-view-2d` function 32); the plugin checks the count again and sends nothing if it is outside them.
   - Escape cancels and sends nothing; a right click removes the last point (`map-view-2d` function 27). The tool stays on for the next graphic; a drawing that ends with `null` switches it off, as in `draw-shapes` (its function 2).
3. **Create:** one create change request for a `core.multipoint` object:
   - in the **active layer**, with a new UUID v7 id, the default security label, the data type `core.general` (from M8, T-190, owner US) and `dataSource` `manual`;
   - `symbol`: the setting's standard and the SIDC from the identity, status, echelon and the graphic's symbol set and entity, composed with `SymbolService.compose`; `modifiers`: the amplifiers filled in;
   - `geometry`: the catalogue's type with the points in order (function 2);
   - `properties.name`: the name. No extension of its own is written.
   Without an active layer, the tool is off with the hint "Select or create a layer in the layer panel", as in `draw-shapes`.
4. **Amplifiers** (data model 1.4.0): the panel and the edit panel show a field for each of the graphic's `allowedModifiers`:
   - text amplifiers as text fields (1 to 128 characters), labelled with their APP-6 letter and name, e.g. "T1 Unique designation 2";
   - `distances` (AM) and `azimuths` (AN) as lists of numbers, one per line, in the order the graphic's `points` text describes (e.g. a sector range fan: the ranges, and for each the left and right azimuth), in metres and degrees, within the model's ranges;
   - required ones (function 1) marked, and the tool or a save disabled while one is empty.
   An amplifier the object carries that the graphic does not allow is kept and shown read only.
5. **Edit (object action, ADR-0032 point 6):** **Edit** for `type` `core.multipoint`, one object, needing `objects.edit` (in a declared workspace its edit permission, function 10). It selects the object and opens the **edit panel**; an object the browser does not hold is fetched by id. It edits every `core.multipoint`, also those other plugins made.
6. **Edit panel** for one graphic, as `draw-shapes`' (its functions 4, 5, 7 and 8: updates on commit, one at a time, the complete core content with `baseVersion`, other plugins' namespaces untouched, live updates, "not in view", rejections shown):
   - the name, the identity, the status, the echelon (where the graphic has one), the amplifiers (function 4) and the layer. **No data type select** (M8, T-190, SW A): an existing graphic keeps its data type, and an update sends it unchanged;
   - **Reshape:** `MapView.edit(id)`, which moves the graphic or its control points with the graphic as its preview (`map-view-2d` function 32), and on finish one update with the new geometry; Escape sends nothing;
   - read only: the graphic's name from the catalogue, the standard, the security label, version, last modified and data source.
   - **A graphic the catalogue lacks** (APP-6B, or a code the service does not draw): the properties only, with the hint "This graphic is not drawn", and no reshape.
   - The panel follows the selection: it shows the graphic while exactly that one is selected.
7. **Drag a selected graphic:** as `draw-shapes` function 16, for a selected `core.multipoint` the user may edit, in one of the workspace's layers, in view, with none of the plugin's own interactions running. On a drop every control point moves by the difference in longitude and latitude, with `draw-shapes`' rules for the poles and the antimeridian, in one update. Its drag replaces `draw-symbols`' early one in the same way.
8. **No Delete of its own:** the shell's shared Delete removes graphics (ADR-0032 point 6).
9. **Subscription:** as `draw-shapes` function 7: the layers with `{ objects: false }`, and the graphic worked on or selected with a small fixed area round it, fetched by id first.
10. **Workspaces** (the workspace rules in the briefs README, as `draw-shapes` functions 10 to 13 and 15): the panels in every workspace, Edit once per workspace with its permission, new graphics in the workspace's active layer, a selected graphic outside the workspace's layers read only, and a switch ending a running placing or reshape with `null`. Every interaction has its own `AbortController`.
11. **Permissions:** without `objects.edit` (or the workspace's edit permission) the tool is off with the hint "You may not edit objects" (naming the workspace in a declared one); Edit is not offered. The server checks anyway.
12. **Locked layers** (ADR-0042): as `draw-shapes` function 17: no placing into a locked active layer, the edit panel read only for a graphic in a locked layer, no drag for it, and a `LAYER_LOCKED` rejection shown.

## Functions (M6)

Built against SDK 1.5.0 part 1 (`sdk-v1.md`, "SDK 1.5.0"; CR-0038), `sdkVersion` `^1.5.0` (SDK 1.5.0 since part 1, owner NP A).

13. **Data types users do not choose** (CR-0038 points 6 and 7; the owner's NC A; T-165). **From M8 a graphic's data type is not chosen at all** (T-190, SW A and US): no select when placing or editing (functions 1 and 6) and no setting; a new graphic is `core.general`, and one stored with another type keeps it (owner, 2026-11-14, A). M5 to M7's selects offered `choosableDataTypes(ctx.dataTypes, current)`, as `draw-shapes` function 18 does. **Graphics carry no field sets in M6** (NC A, as in M5, HS); the store adds no data type's sets to a graphic either (model rule 21, symbols only; owner NO A).
14. **Icons inside graphics** (SDK 1.5.0 part 2, CR-0039; owner, HW): nothing to build. The 21 graphics that drew without mil-sym-ts's inner icon in M5 (minefields, the mine line, the CBRN contaminated areas) get it from `symbology` (its function 15), and the map view draws it, also in the preview while placing and editing (`map-view-2d` function 37). This plugin writes the same objects as before; it checks the icons once in the browser (criterion 18).

## Out of scope (M5)

Field sets (ADR-0050) in the panel and the edit panel: other plugins' fields on a graphic are kept untouched (function 6), not shown (owner, HS, 2026-11-06; the ACA's R5); APP-6B graphics (they are shown, not placed), adding or removing points while reshaping, the user's own favourites or a list of recently used graphics, copying graphics, undo, editing several graphics at once, editing security labels, graphics' 3D altitudes beyond the X amplifier's text.

## Interfaces

| Direction | What |
|---|---|
| Provides | The panels "Graphics" and the edit panel; the object action **Edit** for `core.multipoint`, once per workspace |
| Requires | `SymbolService` (`requires`): `graphicCatalog`, `compose`, `catalog`, and the map view's preview through `renderGraphic` (SDK 1.4.0); `MapView`: `draw` with `graphic`, `edit`, `pickPoint`, `dragObject`, selection, active layer, overlay; the live picture; change requests; fetching by id; the default label; notifications; `ctx.workspace`, `ctx.workspaces`; panels with a default pane; the object action list |
| Objects | Creates and updates `core.multipoint` objects. Deletes nothing |

## Dependencies

None beyond the SDK and React (shared). It never calls mil-sym-ts (ADR-0043 point 2).

## Settings

| Setting | Default |
|---|---|
| Standard for new graphics | APP-6D (as `draw-symbols`) |
| Standard identity for new graphics | Friend |

Changes made in the plugin's entry in the Settings tab apply at once (ADR-0031).

## Permissions

Core permission `objects.edit` to place and edit; in a declared workspace its `editPermission` instead (function 11).

## Internet access

**Not allowed.**

## Acceptance criteria

Unit tests use the test kit's fake symbol service (`FAKE_GRAPHICS`: a boundary, a phase line, an axis of advance, a sector range fan) and fake map view; the browser checks use `symbology` and `map-view-2d` with their M5 functions.

1. **Short list and All:** the panel shows the short list grouped; "All graphics" shows the catalogue as a tree by `path`, and a search for "phase" finds the phase line. Choosing a graphic shows its `points` texts and counts.
2. **Placing a line:** with the boundary chosen, friend, echelon brigade and two units' designations, `draw('line', { graphic })` is called with the composed SIDC; the returned points become one schema-valid create request for a `core.multipoint` in the active layer, with a `LineString` of the points in order, the default label, the data type `core.general` (from M8, T-190, owner US) and `dataSource` `manual`. Positions read back match within a pixel, where latitude ≠ longitude. A second browser shows the graphic within 1 s.
3. **An arrow:** an axis of advance placed with four points is stored with the four points in the clicked order; with two points (the fake map view answering with two) nothing is sent.
4. **A range fan:** with the sector range fan chosen, the tool is disabled until distances and azimuths are filled; one click stores a `MultiPoint` with one position and `modifiers.distances` and `azimuths` as numbers.
5. **Amplifiers:** the fields shown are the graphic's `allowedModifiers`; a distance of −1 or an azimuth of 400 cannot be saved; an amplifier the graphic does not allow, set by another plugin, is kept on update.
6. **Cancel:** Escape while placing sends nothing; a drawing that ends with `null` switches the tool off.
7. **Edit:** Edit is offered for one selected `core.multipoint`, not for a symbol, a shape or several objects, and also from `object-list` for one the map does not hold. Changing the name, the identity, an amplifier or the layer sends one update (from M8 the data type is not offered and goes unchanged, T-190) with the complete core content and `baseVersion`; other plugins' namespaces are unchanged.
8. **Reshape:** `edit(id)` is called; a moved point gives one update with the new geometry; Escape sends nothing. A graphic outside the catalogue (an APP-6B one) shows its properties with the hint and no reshape.
9. **Drag:** a selected graphic dragged by +2° in longitude and +1° in latitude sends one update with every control point moved by exactly that, and longitudes within −180 to 180.
10. **No Delete** button or key; the shell's shared Delete removes graphics.
11. **Subscription:** as `draw-shapes` criterion 18, for graphics.
12. **Workspaces:** the panels are in View and in Simulation, Edit once per workspace with its permission (the test kit's `objectActions`); a graphic placed in Simulation goes into its active layer; a switch while placing sends nothing.
13. **Permissions and lock:** without the edit permission the tool is off with the hint and Edit is not offered; a locked active layer disables the tool, and Edit on a graphic in a locked layer is read only.
14. **Retired at the 1.4.0 freeze** (owner, Q23, 2026-11-08): `graphicCatalog` is required, so a symbology service without it no longer exists.
15. **Look:** the panels work in the left, right and bottom pane, in both densities and in a light and a dark look, and pass `checkLookCss`.
16. **In the browser** (with `symbology` and `map-view-2d`): placing an axis of advance shows the arrow growing as points are set (Q1), and the finished graphic matches the preview.

17. **(M8) No data type select** (T-190; functions 1, 6 and 13; owner SW A and US; replaces M6's criterion): neither the Graphics panel, the Edit panel nor the plugin's settings show a data type; a placed graphic's create has `dataType` `core.general`; Edit on a stored graphic of `ais.vessel` changes its name and sends `dataType` `ais.vessel` unchanged (owner, 2026-11-14, A).
18. **(M6) Icons inside graphics** (function 14): in the browser, with `symbology` and `map-view-2d` on SDK 1.5.0 part 2, placing an APP-6D minefield shows its icons in the preview, and the placed graphic and the edit preview show them too. Nothing in this plugin's tests changes.
19. **(M8) "Place graphic" at the top** (T-190): the Graphics panel has the button at its top and at its bottom; pressing either starts the tool and both read "Stop placing"; without an active layer, both are disabled with the same hint.

## Open questions for the owner

Answered by the owner, 2026-11-06:

1. **Q1, the preview while placing** (function 2): the graphic itself, drawn by the map view through the symbology service, rather than a plain line until the object is made. It added `MapView.draw`'s `graphic` to SDK 1.4.0 part 2.
2. **Q3, finding a graphic** (function 1): a short list of common graphics first, and the whole catalogue as a searchable tree behind "All graphics". The other options were the tree with search alone (and the last ten used), or the short list alone.
