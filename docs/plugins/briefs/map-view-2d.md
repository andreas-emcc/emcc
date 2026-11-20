# Brief: map-view-2d

- Status: **Approved (2026-10-05)** · Milestone: M0 · Task: T-019 · Agent: PCA-map-view-2d (Opus, `agents/README.md`)
- Updated 2026-10-05 for ADR-0017, approved by the owner (functions 5 and 9, settings, criteria 8, 9, 13 and 14), and for the SDK v0 viewport (function 8), approved by the owner.
- Updated 2026-10-09 for the selection highlight (function 10, criterion 15), decided and approved by the owner.
- Updated 2026-10-10:
  - the double-click rule (function 8, criterion 16; T-032), decided and approved by the owner;
  - for M1: vector backgrounds in every projection (function 11, function 3, settings, criteria 17 to 19), approved by the owner (2026-10-10). Built against SDK v1 (T-034).
  - for M1: area of interest and clusters (function 12, settings, criteria 20 to 22; spike S3), approved by the owner (2026-10-10).
  - for M1: fading expired objects (function 13, criterion 23; ACA review B1), approved by the owner at the SDK v1 freeze (2026-10-10).
- Updated 2026-10-12: objects with no position inside the projection's world extent are not drawn in that projection (function 4, criterion 10; review R2), decided by the owner (2026-10-12).
- Updated 2026-10-14: a double-click on a cluster zooms in once (functions 8 and 12, criterion 21), owner's rule of 2026-10-13.
- Updated 2026-10-21: the Map Pane's controls are collapsible (functions 2, 3, 19 and 21, criterion 43), owner's decision of 2026-10-21 (T-054 part F2); function 21 no longer says "planned in T-049".
- **Updated 2026-10-14 for M2 (T-048): functions 14 to 21, Interfaces, Settings, criteria 24 to 43, open questions 1 and 2; approved by the owner (2026-10-15), with both open questions decided as recommended.** Function 21 for ADR-0034 (accepted 2026-10-15, after the approval) and the conformance review's fixes (2026-10-15: the selection keeps ids the map does not hold, functions 10, 12 and 14; Escape and the 1 000 limit, function 14; criteria 40 to 43) are confirmed by the owner (2026-10-15). After the ACA's check (2026-10-15), confirmed by the owner (2026-10-15): Centre on and Zoom to also as `MapView` methods (function 16). Corrected 2026-10-15 while briefing `draw-symbols`: a waiting `dragObject` leaves clicks to the selection (function 14), confirmed by the owner (2026-10-15). Updated 2026-10-21: a waiting `dragObject` leaves Escape to the selection too (function 14, criterion 41; owner, 2026-10-20). ADR-0031 to ADR-0033; the owner's open details of 2026-10-14 (box selection, the 1 000 limit, the Delete key).
- **Updated 2026-10-27 for T-066 (drag a selected shape; owner, 2026-10-19: for M3; 2026-10-27: now, in parallel with the rest): function 26 and criterion 51,** what is built (T-054) and one small fix (route markers in the preview). **Approved by the owner (2026-10-27)** and merged by the MCA as `0a35905`; no ADR, SDK member or model change.
- **Updated 2026-10-27 for M3 (T-077, for T-085): functions 22 to 25, Interfaces, criteria 44 to 50, open questions 3 to 6.** Reviewed by the ACA (T-078, `docs/architecture/reviews/m3-briefs.md`, U1 to U7 taken), with the owner's decisions of 2026-10-27, rechecked by the ACA, and **approved by the owner (2026-10-27)**. ADR-0039 (workspaces), ADR-0040 (fade lists), the workspace rules in the briefs README ("M3: the reused plugins in a workspace"). **Amended (owner, 2026-10-28, T-085 Q3):** function 24 and criterion 48: a fade list stays when its plugin stops, as an overlay does, since the map view cannot see a plugin stop; and function 24 names the map view's own bound of 10 000 ids per list.
- **Updated 2026-10-30 for M4 (T-090): functions 27 and 28, a sentence in function 17, criteria 52 to 54.** From the owner's M4 notes (2026-10-30: the mouse items, filled shapes) and the owner's answer to the PDA on right-click (2026-10-30). No ADR, model change or SDK member: SDK 1.3.0 documents right-click for `pickPoint` and drawing, and gives the fake map view a right click (CR-0028 part 4), but the map view builds it now. **For the owner's approval.**
- **Updated 2026-10-31 with the owner's DX and DY (T-072):** function 3's WMS backgrounds build their own GetMap URLs, and tiles only where the projection's extent tiles; criterion 60. Decided by the owner, so approved.
- **Updated 2026-10-30 for SDK 1.3.0 (CR-0028 part 1, which is CR-0023; ADR-0035; T-072): WMS backgrounds in function 3, Interfaces, the M0 out-of-scope line, criteria 55 to 59.** From CR-0023, approved by the owner (2026-10-30, CQ), and the owner's answer to the PDA (2026-10-30, Q3). **For the owner's approval.**
- **Updated 2026-11-06 for M5 (T-144; CR-0030 part 2, ADR-0043): functions 29 to 32, Interfaces, the out-of-scope lines, criteria 61 to 70.** Tactical graphics drawn, selected, dragged, placed and edited, with the owner's answers of 2026-11-06: Q1 (a graphic is previewed as itself while it is drawn), Q2 (APP-6 colours in every look, no halo in M5) and Q4 (graphics under symbols, by layer). Built against SDK 1.4.0 part 2. **Approved by the owner (2026-11-06, HQ).**
- **Updated 2026-11-06 for M5 (T-139; CR-0030 part 3b, ADR-0047): function 33, criterion 71.** Vessel symbols. Built against SDK 1.4.0 part 3. **Approved by the owner (2026-11-06, IB).**
- **Updated 2026-11-06 for M5 (T-150; ADR-0051 point 6, CR-0031): function 34, criteria 72 to 76.** The lines of relations between objects, first the GMTI pairing, with the ACA's R6 on CR-0031 (a line of zero length is skipped). Built against SDK 1.4.0 part 3 (`relations`, `ctx.relationKinds`), and part 5 for the user's switch. **Approved by the owner (2026-11-06, IQ).**
- **Updated 2026-11-07 for M5 (T-137, T-138; CR-0030 part 5, ADR-0046): function 35, Settings, criteria 77 to 83.** Each user's display settings: the symbol size, the labels and the speed vector, with the owner's Q13 (2026-11-07: the map view passes the size and the labels to `render`, and draws the name and the speed vector itself) and JF (the default labels add `direction`). Built against SDK 1.4.0 part 5. **Approved by the owner (2026-11-07, JG).**
- **Updated 2026-11-07 (PCA-gmti's finding in the browser, T-141): function 36, a line in function 4, criteria 84 to 88.** `ArcBand` and `Corridor` shapes are drawn as areas; until now no function named them, so they showed as the fallback marker (`gmti`'s dwell area, the simulator's sensor sector). No ADR, model change or SDK member: both geometries are in data model 1.0.0. **Approved by the owner (2026-11-07, JX).**
- **Updated 2026-11-08 for the owner's LB and LC (from `pca-map-view-2d/t138-display` `ab215884`): function 35, criteria 78 and 79.** Every speed vector is black; where one is drawn, the map view's own direction arrow is not (LB). Otherwise the arrow stays the map view's own and does not follow the `direction` label (LC). **Approved by the owner (2026-11-08, LI).**
- **Updated 2026-11-08 for the 1.4.0 freeze (owner, Q23): the part 2 line and criterion 63.** `renderGraphic` and `graphicCatalog` are required, so criterion 63 drops the service without the member. **Approved by the owner (2026-11-08, LN).**
- **Updated 2026-11-10 for M6 (owner, HW; CR-0039 part 2, approved by the owner, OB A; SDK 1.5.0 part 2): function 37, Interfaces, criteria 89 to 93.** The icons inside 21 graphics, which `symbology` now returns as `GraphicRendering.images`, are drawn with their graphic. **For the owner's approval.**
- **Updated 2026-11-10 for M6 (T-164, T-151; CR-0039 points 5 and 6, approved by the owner, OB A; SDK 1.5.0 part 3): function 35's speed vector, functions 38 and 39, Interfaces, criteria 94 to 100.** The speed vector in the owner's ten steps (MZ A, Q5 A), and sensor reports drawn with `symbology`'s sensor report symbol (owner, 2026-11-08), with the owner's Q41 to Q44 of 2026-11-10 in the PDA's session: a size setting, 10 px; a list of colours; an orange dot with a 1 px outline by default; no labels, arrow or speed vector. **Approved by the owner (2026-11-10, PI A; Q41 to Q44 confirmed, PH A).**
- **Updated 2026-11-11 for the 1.5.0 freeze (owner, Q49 A and Q51 A): functions 38 and 39, Interfaces, criteria 94 and 97.** The members that were optional until the freeze are required (`docs/plugins/sdk-v1.md`, "The freeze"), so the fallbacks for their absence go. Follows from the owner's decision, so approved.
- **Updated 2026-11-11 for M7 (T-182, T-183, T-186, T-181, T-176, T-173; CR-0041 parts A to E): functions 40 to 45, function 34's fade (now function 42), Interfaces, criteria 101 to 106.** Display filters, relation lines off screen, the pairing fade, relation colours from settings, Append, and `core.text` (this plugin's, by the ACA's note on ADR-0055). Functions 41 and 42 need no contract change and can start first. **Approved by the owner (2026-11-11, RJ A)**, with Q58 A, Q59 B and M7-S8.
- **Updated 2026-11-12 for M7 RC2 (T-192; CR-0042, proposed): function 46, criterion 107.** The fade in steps a data type takes from its plugin's settings, for `gmti`'s detections and dwell areas. **Chosen by the owner** (the `gmti` brief's FA A, 2026-11-12).
- **Updated 2026-11-13 for M8 (T-200; owner TY B, TZ A): function 33, criterion 108.** Vessel hulls turn in 10° steps (the image key and the direction sent to `symbology` alike, with text too), and the atlas swaps without a blank frame.
- Read also: **ADR-0032 (selection, object and map actions)**, **ADR-0033 (drawn shapes)**, ADR-0031 (setups), ADR-0027 (per-user data), ADR-0029 (design system), ADR-0009 (OpenLayers), **ADR-0025 (vector background maps)**, **ADR-0017 (client rendering needs a GPU)**, overview 4.5 and 4.7, `spikes/s2/README.md` (performance findings).

## Purpose

The 2D map engine in the Map Pane. It shows the background map and the whole live picture (all layers and objects; from M1 its area of interest, with clusters when zoomed out, function 12), and offers the `MapView` interface through which other plugins work with the map. It is the only plugin that uses OpenLayers. From M2 it also selects objects on the map, opens the right-click menus, and offers the drawing and editing service that other plugins draw with (ADR-0032, ADR-0033).

## Kind and parts

- Kind: **map view**. Exactly one map view is active per Map Pane.
- Properties: none (neither ingoing nor outgoing).
- Parts in M0: **web only.**

## Functions (M0)

1. **Map Pane:** fills the Map Pane with an OpenLayers map. Pan with drag, zoom with wheel and buttons, a scale line, and an attribution area for background maps.
2. **Projections:** the map projection comes from configuration: a list of projections, each with proj4 text, `extent` and `worldExtent` (S2 showed that polar projections need both). M0 default is EPSG:3857. The view can be switched to any configured projection, in the Map Pane's controls (function 21), which keeps the centre where possible. EPSG:3413 is configured as well, to show that polar works (S2), even though M0 has no polar background map.
3. **Background maps:** lists the `BackgroundMapProvider` services registered by background map plugins in the Map Pane's controls (function 21), offers only those that support the current projection, and shows the chosen one under all object layers. With none available, the map shows a neutral background and a graticule.
   - **(M1) Choosing after a switch:** when the user switches to a projection the chosen background does not support, the map view takes the user's last choice for that projection, otherwise the first available one in the order of the setting "Preferred backgrounds". Only installed providers count: a disconnected installation leaves `basemap-osm` out (its brief), so Natural Earth comes first there. It never leaves the map without a background while one is available. The choice per projection is kept per browser.
   - **(M4) WMS backgrounds** (SDK 1.3.0: `WmsSource`; ADR-0035; T-072). A provider with a `wms` source is drawn as a grid of `tileSize` images in `'tiles'` mode, one image per view in `'image'` mode. `WmsSource`'s TSDoc is the contract with the plugin's server part, and this function keeps it:
     - **The map view builds each GetMap URL itself** (owner, 2026-10-31: DX, T-072's deviation), as the test kit's `wmsGetMapUrl` does, not with OpenLayers' `TileWMS` or `ImageWMS`: those take the axis order from a projection object that emc2's EPSG:4326 lacks, and ask for fractional sizes. OpenLayers only draws the images (ADR-0009).
     - **Tiles only where the extent tiles** (owner, 2026-10-31: DY): `'tiles'` mode is used only where the sides of the projection's extent are in a whole-number ratio of at most 16:1 (EPSG:3857 1:1, EPSG:4326 2:1); in any other projection a `'tiles'` source is drawn as one image per view, as in `'image'` mode.
     - **checked like a tile source** before it is offered (function 3's problems, as for `xyz`): the URL on the emc2 server, at least one layer, `projections` a list of codes, a known version and format, `tileSize` a whole number from 64 to 1 024;
     - **only in the projections it lists,** polar ones included, matched by their codes; never redrawn in another projection (ADR-0035 point 3). The configured projection must carry the server's code;
     - **the GetMap parameters,** each once and nothing else, as the test kit's `wmsGetMapUrl` builds them, in any order; in WMS 1.3.0 with EPSG:4326 the box is latitude first;
     - **never a box beyond the projection's extent:** tiles wrap at the antimeridian; a single image is cut at the extent, and the rest of the view stays empty. `WIDTH` and `HEIGHT` stay within 1 to 4 096: a larger view asks for a smaller image and scales it up;
     - **an image that fails** is left empty, as a failed tile is; the map stays usable;
     - **a background that goes** (its provider removed with the `Unsubscribe` that `services.provide` returns, SDK 1.3.0) while shown: the map view falls back as after a switch, and says so, as for a background that is unavailable.

     Until T-072 builds this, a `wms` source is reported as not supported (function 3's problems), so that SDK 1.3.0's types compile (owner, 2026-10-30, Q3).
4. **Live picture:** subscribes to all layers and objects through the SDK (a snapshot, then change batches) and draws them:
   - one map layer per emc2 layer, ordered by `drawOrder` (ties broken by id), higher on top;
   - `core.symbol` objects drawn as images from the `SymbolService` (symbology plugin), with the symbol's anchor at the position;
   - `core.shape` objects (Point, LineString, Polygon, Circle) drawn with their `style`; **(M5)** `ArcBand` and `Corridor` too (function 36);
   - any other type (`core.multipoint`, plugin types) drawn as a neutral fallback marker at its first position, so no object is invisible.
   - **Exception** (owner, 2026-10-12; review R2): an object with no position inside the projection's `worldExtent` is not drawn in that projection, because it cannot be projected there (e.g. a point in Antarctica in EPSG:3857 or EPSG:3413). It is drawn again in a projection that covers it.
5. **Update handling (from S2, ADR-0017 point 4):** applies changes in batches. It merges changes per object id (latest wins) and decides the cadence itself: **by default about once per second** per layer, configurable (setting "Update cadence"). A small batch, such as a user's own edit, may be applied sooner, so that it appears within the 1 s of criterion 2. The cadence must never be set so fast that it blocks the main thread. The map view never rebuilds on every single change.
6. **Symbol text:** below a threshold of visible symbols (about 2 000, configurable), symbols are drawn with their text amplifiers (e.g. unique designation). Above it, they are drawn without text, from a shared image cache keyed by appearance (S2: per-object images do not scale).
7. **Local layer visibility:** each layer can be hidden or shown for this browser only (`MapView` interface). Initial state: the layer's `visible` field.
8. **`MapView` interface for other plugins:**
   - viewport, as the SDK defines it: centre (lon/lat), resolution (metres per pixel at the centre), projection code, and the visible area as a closed lon/lat polygon whose inside contains the centre (not a lon/lat bounding box, which fails at the poles and across the antimeridian); `goTo(centre, resolution?)`; viewport-changed events;
   - pointer: click and move events with position in lon/lat and screen pixels;
   - pick: object ids at a pixel with a tolerance, topmost first, not necessarily complete (S2);
   - interactions: "pick a point" (one click returns lon/lat) and "drag an object" (returns the new position when dropped, without changing the object);
   - **double-click** (owner, 2026-10-10): while "pick a point" or "drag an object" is active, a double-click does **not** zoom the map. Only that is switched off, and only while the interaction runs (as for panning); otherwise a double-click zooms as before, except on a cluster (function 12);
   - temporary graphics: a plugin-owned overlay for previews and highlights that is not part of the live picture (points, lines and symbols given as data, not OpenLayers objects);
   - shared state: the **selection** (object ids) and the **active layer** (layer id), each with change events.
9. **Rendering check (ADR-0017 point 3):** at start-up the map view finds out whether WebGL runs hardware-accelerated, and tells the user. It **never fails silently with an unusable map.**
    - **Detection:** request a WebGL context with `failIfMajorPerformanceCaveat: true`. If that fails while a plain context works, rendering is in software. Also read the renderer name (`WEBGL_debug_renderer_info`, where available); names such as "SwiftShader", "Basic Render Driver", "llvmpipe" or "Software" mean software rendering. Result: **hardware**, **software** or **none** (no WebGL).
    - **Software:** the map works, and a notice in the Map Pane says so, e.g. "This computer draws the map without a GPU. Up to about 10 000 symbols stay usable; with more, the map becomes slow." The user can dismiss the notice; it comes back once per session if the budget is exceeded.
    - **Budget without a GPU (ADR-0017 point 2):** about **10 000 individually drawn symbols** (setting "Software rendering budget"; from M1 the server keeps the area within this budget with clusters, function 12). When the live picture holds more, the map view shows a warning that the map may be slow. It **never drops objects** to stay under the budget.
    - **None:** the Map Pane shows a clear message that the browser cannot draw the map (WebGL unavailable), instead of an empty or broken map.
    - **Reporting:** the result (hardware, software or none, plus the renderer name) is logged once at start and reported through the SDK's plugin status, which the monitor view shows (monitor view: M1). Other plugins can read it through the `MapView` interface.
10. **Selection highlight** (owner, 2026-10-09): the map view highlights whatever `MapView.selection` holds, whichever plugin selected it:
    - a **frame around a symbol**, sized from the symbol's size on screen;
    - a **wider stroke** for lines and polygon outlines;
    - the highlight **follows a drag** of the object;
    - **ids of deleted objects**, and ids missing from a new snapshot, are **pruned from the selection**.
    - **From M2** (B1 of the conformance review, 2026-10-15): an id is pruned only when the map view learns that the object was **deleted** (a delete event). Ids of objects the map does not hold stay in the selection: objects outside the area or inside a cluster, and ids another plugin set (e.g. `object-list`, Edit from the list). The map highlights only what it draws. An action on an id whose object has gone meanwhile reports it as gone.
11. **Vector backgrounds (M1, ADR-0025):** a background map provider may give a **vector source** (SDK v1) instead of tiles: polygons and lines in lon/lat with a simple style. The map view projects and draws it in **every configured projection**, the polar ones included. The first one is `basemap-naturalearth`.
    - **Edges** of a vector background are straight in lon/lat, as the source data draws them (a parallel stays a parallel). This differs from objects, whose edges are geodesic (model rule 10). Long edges are densified before projecting, so that they bend correctly in polar projections.
    - **Clipping:** data is clipped to the projection's `worldExtent` before projecting, so that no point is projected where the projection is undefined: Antarctica in EPSG:3857 and EPSG:3413, for example.
    - **Antimeridian and poles:** longitudes in a vector source are between −180° and 180°, and since edges are straight in lon/lat, no edge crosses the antimeridian. Data that crosses it is **cut at ±180°** into pieces, as Natural Earth is (SDK v1, CR-0010 item 18). A polygon around a pole (Antarctica in Natural Earth) runs along latitude −90° between −180° and 180°. The map view draws such polygons closed and in place, with no seam along 180° and no polygon stretched across the map. Polygons are filled without outline where the provider's style says so, so that the cuts do not show; outlines come from line layers.
    - **Switching projection** re-projects the vector data; it is not loaded again.
    - **Load:** the data is loaded only when the background is shown (function 3). Drawing it must keep pan and zoom usable without a GPU (criterion 8: no frame gap above 0.5 s): simplify at the current resolution, and do not re-project on every frame.
    - **Attribution:** the provider's attribution is shown, as for tiles.
12. **Area of interest and clusters (M1, spike S3; SDK v1):** the map view subscribes to the live picture with `{ area: 'viewport', budget }`, not to the whole picture.
    - **Budget:** the setting "Object budget", by default 10 000 without a GPU and 100 000 with one (S3 recommendation 6, ADR-0017). It replaces function 9's software rendering budget, which stays as the default without a GPU.
    - **Leaving objects:** objects reported as `left` are removed from the map (they were not deleted), and their ids are pruned from the selection like deleted ones (function 10). **From M2** their ids stay in the selection (function 10).
    - **Clusters:** above the budget the server sends clusters. The map view draws each as one marker with its count, and colours or splits it by `byIdentity` (friend, hostile, neutral, unknown). A locally hidden layer (function 7) is subtracted at once with `byLayer`, without asking the server. A click on a cluster zooms in on it. **A double-click on a cluster zooms in once** (owner, 2026-10-13): the cluster's zoom only, not also the map's own double-click zoom. Clusters are never selectable objects.
    - **Function 9's warning** ("more than the budget may be slow") is no longer needed in area mode: the server keeps every view within the budget.
13. **Expired objects (M1, model rule 15, ADR-0023 point 7):** an object whose data type's effective behaviour (`DataType.behaviour`, SDK v1) has `fadeWhenExpired` is drawn **faded** from its expiry on (`expiresAt(object, behaviour)`): about 40 % opacity, the symbol and its highlight alike. It stays pickable and selectable.
    - **Against the clock:** expiry comes without a change event, so the map view checks the held objects' expiry as time passes, at least at its update cadence (function 5, about once per second), not only when a batch arrives.
    - **Behaviour changes** (`onDataTypesChange`) apply at once, without reload. An object whose data type is not available gets the default behaviour: never faded.
    - **Removal** is not the map view's: ECore deletes expired objects after `removeAfterExpirySeconds`, and the delete arrives as a change event.

## Functions (M2)

Built against SDK 1.x (T-049) and data model 1.1.0 (T-064). **A prototype comes first** (T-054): a hatched fill in the WebGL renderer, and the first call of the drawing service (function 17). Its findings may change details of functions 17 and 18; the PCA records them in the README and asks the PDA where a brief or the SDK must change.

14. **Selection (ADR-0032 point 1):** selecting objects on the map is the map view's job, for every kind of object. It moves here from `draw-symbols`.
    - **Click** on an object selects it and replaces the selection. Where objects overlap, the topmost (`pick`, function 8). **A click on empty map, or Escape, clears the selection** (as `draw-symbols` did). While an interaction runs (function 17, `pickPoint`), Escape goes to it first and cancels it; only the next Escape clears the selection. **A `dragObject` that only waits is no running interaction for Escape** (owner, 2026-10-20): one Escape ends the waiting drag (it resolves with `null`) and clears the selection. A grabbed drag, `pickPoint`, drawing and editing still take the first Escape. Escape in the open Map Pane controls is the box's (function 21).
    - **Ctrl+click** adds an object to the selection, or removes it if it is selected.
    - **Ctrl+drag** draws a box and **replaces the selection** with the objects in it (owner, 2026-10-14; the ACA had recommended adding). An object is in the box when its drawn position or outline reaches into it.
    - **Shift+drag** zooms to a box, as before.
    - **On a Mac the key is Cmd** instead of Ctrl, because there Ctrl+click opens the context menu.
    - **At most 1 000 objects.** A box with more selects the first 1 000, topmost layer first, and a notice says how many were left out and to zoom in (owner, 2026-10-14). A Ctrl/Cmd+click that would add the 1 001st object adds nothing, and the notice says so.
    - **Only objects the browser holds** can be selected: not those inside a cluster or outside the subscribed area (function 12), and not those in a locally hidden layer. A box over clusters selects the objects it can and the notice asks the user to zoom in.
    - While `pickPoint`, drawing or editing (function 17) runs, clicks belong to it and do not select. `dragObject` takes only a press and drag that starts on its object, so a click still selects while it waits (`draw-symbols` keeps it armed for the selected symbol). Ctrl/Cmd+drag and Shift+drag are always the box, also when they start on an object.
    - The selection stays the shared list of ids (`MapView.selection`), so other plugins (the properties panels, `object-list`) still read and set it. Function 10 highlights it.
15. **Right-click menus (ADR-0032 points 3 and 5):** the map view decides what a right click is on, and opens the shell's menu there (the lists and the menu are the shell's; planned in T-049):
    - **On a selected object:** the object actions, applied to the **whole selection**.
    - **On an object that is not selected:** that object becomes the selection first. Where several objects overlap, the menu first lets the user choose one.
    - **On empty map, or on a cluster:** the map actions, with the position in lon/lat.
    - Actions that take one object (such as Edit) are not offered for a selection of several, and actions the user may not use are not shown (the shell filters them).
16. **The map view's own actions (ADR-0032 point 6),** registered in the shell's lists (planned in T-049):
    - **Centre map** (map action): centres the map on the clicked position, keeping the zoom.
    - **Centre on object(s)**: centres the map on the middle of the objects' extent **in the map's own coordinates** (a quick approximation), keeping the zoom.
    - **Zoom to object(s)**: fits the map to the objects' extent, with a margin. For a single object, or objects all at one point, the view is **about 10 km wide**.
    - **The same as `MapView` methods** (planned in T-049): other plugins centre on and zoom to objects by id through them (e.g. `object-list` on a double-click), and the two actions call them too.
    - They also work for ids of objects the map does not hold (from `object-list`): the map view fetches them by id (planned in T-049). Objects with no position inside the current projection's `worldExtent` are left out; if none is left, a notice says so.
17. **Drawing and editing service (ADR-0033 point 3):** the map view offers drawing and editing through `MapView` (planned in T-049), built on OpenLayers' own drawing and editing tools. **The service changes nothing itself:** it returns geometry, and the calling plugin sends the change request.
    - **Draw** a shape of a given kind, with a preview in a given style: **circle, ellipse, square, rectangle, polygon and line** (an arrow and a route are lines; `draw-shapes` adds their style). The user **presses and drags** (circle, ellipse, square, rectangle) or **sets point by point** (polygon, line): a double-click or Enter finishes, Backspace (from M4 also a right click, function 27) removes the last point, Escape cancels.
    - **Returns** the geometry in lon/lat (data model 1.0.0): a circle as centre and radius in metres; an ellipse as centre, semi-axes in metres and rotation; squares and rectangles as polygons (ADR-0033 point 4; a square has equal sides on screen when drawn); `null` when cancelled.
    - **Edit** a given object's geometry: the user **moves the whole shape**, or **drags its corners or points** (a circle's radius, an ellipse's axes and rotation by handles), and finishes with Enter or Escape to cancel. Returns the new geometry, or `null`.
    - **One interaction at a time:** starting one cancels a running one. While it runs, a double-click does not zoom the map (as in function 8).
    - Drawing works in every configured projection, the polar ones included, and across the antimeridian. A point outside the projection's `worldExtent` cannot be set.
18. **Drawing shapes (ADR-0033 point 6; data model 1.1.0, T-064):**
    - **ellipses** as ellipses (until now a fallback marker), with geodesic outlines like circles;
    - **hatched fills**: lines across the area in the fill colour, instead of a solid fill;
    - **arrowheads** at the end of a line, pointing along its last segment;
    - **route markers** at each point of a line;
    - **text labels:** a shape's `properties.name`, at the middle of an area or of a line. Labels follow the text threshold of function 6, like symbol texts (open question 2);
    - **the selection highlight for shapes** (function 10): a wider stroke for outlines and lines, also for circles and ellipses; while editing, the handles of function 17;
    - shapes of data model 1.0.0 look as before.
19. **Dim (ADR-0027, ADR-0031; owner, 2026-10-10):** a slider in the Map Pane's controls (function 21) dims **only the background map**, from 0 (not dimmed, the default) to 90 %, towards black in light and dark mode alike (open question 1). Objects, labels and clusters are never dimmed. The dim level is part of the setup (function 20).
20. **Its share of a setup (ADR-0031 point 5):** the map view saves and restores, through the SDK (SDK 1.1.0):
    - the **map type** (projection and background), the **centre**, the **zoom** and the **dim level**;
    - the **layers' local visibility** (function 7; the layer panel's eye).

    Whether the Map Pane's controls are open is not part of it (function 21).

    It reports a change as the user works (no more often than about once per second while panning), so that the shell remembers the current setup, and applies a setup when the shell restores one: at start, and when the user picks a named setup. A layer that no longer exists is ignored; a new layer starts with its `visible` field. A projection or background that is not available falls back as in function 3, with a notice. Without a saved setup, the settings' initial view applies.
    - **For bookmarks** the map view also sets and reports the map type, centre and zoom on request (SDK 1.1.0): `bookmarks` saves and restores them.
21. **Panels and look (ADR-0029, ADR-0031, ADR-0034):** the map view's controls in the Map Pane (projection, background, dim) use the shell's design tokens and shared components. What it draws on canvas in the look's colours or fonts (label text, the count on a cluster) reads the current token values and follows a change of look, light or dark at once (`ctx.theme`, SDK 1.1.0). The APP-6 affiliation colours (also of clusters) and the selection highlight stay fixed in every look, and the density does not change symbols or labels (ADR-0034). The background maps do not change with the look; dimming stays the user's.
    - **The Map Pane's controls are collapsible** (owner, 2026-10-21), so that they cover as little of the map as possible. They are at the top right.
      - **They start collapsed,** as one icon button, "Map controls". It opens a box with the projection (function 2), the background (function 3) and the dim slider (function 19), headed in the look's heading style, with a close button. The focus goes to the first list.
      - **The close button, or Escape in the box** (not in an open list), collapses it, and the focus goes back to the button. That Escape is the box's: it does not clear the selection (function 14).
      - **Open or closed is remembered per browser,** not in the setup (function 20).
      - **While collapsed, a problem the box would show** (e.g. "Background unavailable") puts a warning marker on the button, and its text in the button's name (e.g. "Map controls: Background unavailable: …").

The **Delete key** belongs to the shell's shared Delete (owner, 2026-10-14; T-051): it deletes the selection after the same confirmation. The map view only keeps the selection it acts on.

## Functions (M3)

Built against SDK 1.2.0 (T-076) and the shell's workspaces (CDA, T-080), with the workspace rules 1 to 9 in the briefs README ("M3: the reused plugins in a workspace"). The draw order fix of T-087 is a task of its own.

22. **One map, for the workspace shown** (ADR-0039 point 3). The map view shows the workspace that the page shows (`ctx.workspace`). It works whether the shell keeps the Map Pane element on a switch or mounts it again (Q23; `MapViewMount.mount`, the CDA's in T-080): after a new mount it draws the map from the workspace's share and the fresh snapshot. Its controls (function 21) and its actions Centre map, Centre on and Zoom to (function 16) are in every workspace (rule 1). On a switch:
    - **at the switch's moment for the map view,** before the fresh snapshots and before any `ctx.workspace.onChange` listener (SDK 1.2.0 `CurrentWorkspace`; the shell gives the moment, for example by mounting the Map Pane again or with a step of its own, with no new SDK member: the CDA's, T-080): running interactions resolve with `null`, every fade list is cleared, and **the selection is cleared** (open question 4), so that the shared Delete and the object actions never act on objects of a workspace that is not shown. Nothing the map view does later in the switch ends an interaction or clears a list, so a list set from the fresh snapshot, and an interaction started from `onChange`, stay;
    - **the active layer**, from the map view's `onChange` listener, becomes the one last active in that workspace during this page, or none on the first visit. It takes the old workspace's active layer at its moment, and records no change of the active layer from its moment until its own `onChange` listener has run: a layer that `layer-panel` makes active in between fills a gap and is not the user's choice, so it never replaces the remembered one. It remembers per workspace only a layer of that workspace (`workspaceOf`). On a first visit, `layer-panel` then makes the workspace's top layer active (its function 21), in whatever order the plugins' listeners run;
    - **the map state** comes from the workspace's own setup share, which the shell restores (function 20, ADR-0039 point 8). On the first visit to a workspace, with no share saved for it, the map keeps the map type, centre, zoom and dim level it had (open question 5), and the workspace's layers start with their `visible` field;
    - the live picture follows the workspace shown (rule 2): the map draws the fresh snapshot, and only that.
23. **View's layers as a reference** (ADR-0039 point 6, A17; open questions 3 and 6). In a declared workspace the user may switch on View's layers as a read-only reference, with the eye in `layer-panel`'s reference group:
    - **Off by default.** Their local visibility in that workspace is part of its setup share (function 20), apart from the same layers' visibility in View. The SDK's local visibility is keyed by layer id only (`setLayerVisible`, `isLayerVisible`), so the map view keeps it per workspace: on a switch it applies the shown workspace's visibility and calls `onLayerVisibilityChange` for each layer whose visibility changed, so that `layer-panel`'s eyes follow, as after a restored setup.
    - **Drawn under all of the workspace's own layers**, in View's draw order among themselves (open question 3).
    - **Subscription:** while at least one is on, the map view's subscription names both workspaces (`workspaces: [the workspace shown, 'core.view']`), with the area and the budget of function 12; when none is on, it names only the workspace shown. It subscribes again only when that changes, not for each eye. Such a subscription names its workspaces, so it does not follow a switch (`LivePictureOptions.workspaces`): the map view ends and renews it from `ctx.workspace.onChange`. In View, and with no reference layer on, it subscribes without `workspaces`, so that it follows the workspace shown (rule 2).
    - **Drawn only** (open question 6): a click, a Ctrl/Cmd+click and a box do not select their objects, `pick` leaves them out, and a right click on one opens the map actions, as on empty map. So no edit, drag or Delete reaches them.
24. **Fade lists** (ADR-0040; SDK 1.2.0 `MapView.createFadeList`). The map view provides `createFadeList()`, for objects that a plugin wants shown faded in this browser and the workspace shown (the simulator's hidden tracks):
    - each handle is one plugin's list: `set` replaces it, `clear` empties it. A list stays until its plugin clears it, also when the plugin stops, as an overlay does: the map view cannot see a plugin stop (amended, owner, 2026-10-28, T-085 Q3);
    - at most 10 000 ids per list (the map view's own bound, `MAX_FADE_IDS`; inputs are bounded): of a longer list only the first 10 000 are faded, and the map view logs a warning;
    - the map view fades the **union** of all lists exactly as it fades an expired object (function 13): about 40 % opacity, the symbol and its highlight alike, still pickable and selectable. An object that is both expired and on a list is faded once;
    - ids of objects the map does not hold stay on the list and are faded when the objects arrive; a delete removes the id;
    - a workspace switch clears every list at the switch's moment for the map view (function 22), before the fresh snapshots and before any `onChange` listener, and never later. So the owner of a list sets it again from the fresh snapshot, when its subscription follows the workspace shown, or from `ctx.workspace.onChange`, from what it holds, when its subscription names its workspace and so gets no fresh snapshot (the simulator's web part, its function 22).
    - `createFadeList` is required in the SDK since W1 (2026-10-29), now that the map view provides it.
25. **The same settings in every workspace** (rule 8): projections, budgets, the update cadence and the symbol size do not change with the workspace. The object budget (function 12) applies to the one subscription of the workspace shown, reference layers included.
26. **Dragging a shape** (T-066; owner, 2026-10-19: for M3; 2026-10-27: now, in parallel with the rest): `dragObject` grabs, previews and drops any drawn object, shapes included, as built in T-054.
    - **The drop position is the geometry's first position moved by the drag:** the first position of a `Polygon`'s first ring, of a `LineString`, a `MultiPoint` or a `Corridor`; the centre of a `Circle`, an `Ellipse` or an `ArcBand`; a symbol's or a `Point`'s position. It is within −180 to 180 in longitude. So the plugin that drags moves the object by the difference between the drop and that position (`draw-shapes` function 16).
    - **The preview:** lines and polygons (circles and ellipses are drawn as rings) have every position shifted by that difference in lon/lat, with latitudes clamped at ±90. It does not wrap longitudes: after a drag across the antimeridian it is drawn one world away from the pointer, while the plugin's update wraps them. That is not a fault. A `MultiPoint`, a `Corridor`, an `ArcBand` and a `Point` are previewed as a marker at the pointer.
    - **The one fix (PCA-map-view-2d):** the preview also shifts a line's drawn vertices, so that a route's point markers move with the line. Today they stay at the old place. Nothing else in the map view, and nothing in the SDK, changes for T-066.

## Functions (M4)

27. **Right-click while placing and drawing** (the owner's M4 notes, 2026-10-30; the press-and-drag kinds and Edit: owner, 2026-10-30, asked by the PDA). While `pickPoint` or an interaction of function 17 runs, a right click opens no menu, as before, and:
    - **`pickPoint`** (placing, e.g. `draw-symbols`): acts as Escape. The interaction ends with `null`, and the calling plugin treats that as it treats Escape.
    - **A polygon or a line** (set point by point): removes the last point set, as Backspace does, and the preview follows. With no point left it acts as Escape: the drawing returns `null`.
    - **A circle, ellipse, square or rectangle:** before the press it acts as Escape; during the press and drag it does nothing.
    - **Edit** (function 17) **and a grabbed `dragObject`:** it does nothing, as before. A `dragObject` that only waits does not count: a right click opens the menu as before (function 15).
    - On a Mac, Ctrl+click counts as a right click (function 14).
28. **Filled shapes are picked by their lines only** (the owner's M4 notes, 2026-10-30), so that clicks pass through a fill. A shape with a fill, solid or hatched (function 18), is hit only on its outline, within the pick tolerance; inside the fill, what lies under it is hit, or empty map. This holds for everything that picks: `pick` (function 8), a click and a Ctrl/Cmd+click (function 14), a right click (function 15), and the press that grabs a selected shape (`dragObject`, function 26). The box of function 14 is unchanged (an outline that reaches into it). Symbols, lines and shapes without a fill are picked as before.

## Functions (M5)

Built against SDK 1.4.0 part 2 (`renderGraphic`, `graphicCatalog` and `MapView.draw`'s `graphic`; declare `^1.4.0`). The symbology service's two new members are required since the 1.4.0 freeze (owner, Q23, 2026-11-08; `symbology` functions 8 and 9).

29. **Drawing tactical graphics** (`core.multipoint`, ADR-0043 point 7):
    - **Through the symbology service:** for each graphic in the view the map view calls `renderGraphic` with its symbol, its control points (the geometry's positions; a `Polygon`'s ring without its closing position), the view's `resolution` and an extent somewhat larger than the view (e.g. one and a half times), and draws the result: fills, then lines, then labels, projected from longitude, latitude. It calls again after a zoom (a new resolution), when the view leaves the drawn extent, and when the object changes; an answer for an older state of the object or the view is dropped.
    - **In slices** (spike S1): results are added a slice at a time, so that no task on the main thread takes over 50 ms, and several requests may be in flight.
    - **The antimeridian:** in EPSG:3857 a result line that jumps across it (from +176° to −176°) is unwrapped, as shapes are (function 18). The polar projections draw it as it is.
    - **The look** (owner, Q2, 2026-11-06): the graphic's colours, widths, dashes and fonts are as the service gives them, in every look and density. No halo in M5.
    - **The order** (owner, Q4, 2026-11-06): within each layer, shapes first, then graphics, then symbols on top, so that a unit is never hidden by a boundary or an area. The layers keep their order (and function 23's reference layers stay under the workspace's own).
    - **Labels** of graphics follow the text threshold of function 6, as shape labels do (function 18).
    - **Fading** (function 13) and fade lists (function 24) apply to a graphic as to a shape: all its lines, fills and labels with the lower opacity.
    - **The budget:** a graphic counts as one object for the area of interest and the clusters (functions 9 and 12), as a shape does.
    - **The fallback marker** (function 4) stays at the first point while no answer has come yet, when the service or its member is missing, and when the answer is a refusal (an APP-6B graphic, a missing amplifier, a timeout). The reason is logged to the browser console once per object and state, not shown to the user.
30. **Selecting graphics** (functions 8, 14 and 15): a graphic is hit on its drawn lines within the pick tolerance, and a fill only on its outline, as function 28 says for shapes; a graphic shown as the fallback marker is hit on the marker. The box of function 14 selects a graphic whose drawn lines reach into it. The highlight (function 10) draws its lines again with the selection's wider stroke, as for shapes.
31. **Dragging a graphic** (function 26): `dragObject` works for a `core.multipoint` as for a shape. The preview is the drawn graphic moved by the difference in longitude and latitude, without drawing it again; the drop position is its first control point moved by the drag (as function 26 says for `LineString`, `MultiPoint` and `Polygon`).
32. **Placing and editing** (function 17; SDK 1.4.0, owner, Q1, 2026-11-06):
    - **`draw` with `graphic`** (`polygon` or `line`): the preview is the graphic itself, drawn through `renderGraphic` from the points set so far with the pointer's position as the next point. One request at a time; when it answers, the newest points are sent next, so the preview never lags behind by more than one answer. While the points are fewer than the graphic's `minPoints`, or the answer is a refusal, the preview is the plain line in `style`. Enter and the double-click do not finish before `minPoints` (the line stays, and the drawing goes on); the drawing finishes by itself when `maxPoints` is set (`graphicCatalog`). Backspace and the right click (function 27) remove the last point as before. A `polygon`'s ring comes back in the clicked order, its closing position last, and is never reoriented: `draw-tactical` stores an area whose points have roles as a `LineString` of it (ACA, R1).
    - **`edit` of a `core.multipoint`:** a handle on each control point, and the whole graphic moved by dragging it, as for a line; the preview is the graphic drawn again as a point moves, one request at a time. An edit neither adds nor removes points in M5. It resolves with the geometry type the object has.

33. **Vessel symbols** (ADR-0047, SDK 1.4.0 part 3): a `core.symbol` with `standard` `vessel` is drawn as any symbol, through `render` (function 4), with the same budget, clusters, labels, selection and drag. `symbology` turns the hull by `direction`, so the map view draws the image as it comes, at its anchor, and adds no direction line of its own for it. A vessel the service refuses (a `symbology` older than part 3) gets the fallback marker.
    - **The hull in 10° steps** (M8, T-200; owner TY B): before it asks `symbology`, the map view rounds `direction` to the nearest 10° (a half step up: 35 → 40; 355 and above → 0), and that stepped value goes both into the image's key (`appearanceKey`) and into the request, with text (`withText`) and without. So a turning ship changes its image only every 10°, and a hull look has at most 36 images. The object keeps its exact `direction`: the properties, the speed vector (function 35) and everything else read it unchanged.
    - **No blank frame when the atlas grows** (T-200): a new image (a hull step, a new appearance) is added to a **new atlas image that is built and fully loaded before** the layers' style switches to it; until then the layers keep drawing with the current atlas, and an object whose image is not in it yet is drawn when the swap comes. The swap happens **at most 4 times a second**, batching the images that came in between. (Cause: in OpenLayers 10.10 each `setStyle` clears the WebGL renderers and reloads the atlas as a new image, blank until it loads, so every turning ship blanked all symbols.)

34. **Relation lines** (ADR-0051 point 6; T-150). For each object in the live picture with `relations`, and each entry whose kind is declared (`ctx.relationKinds`) and **switched on for the user**, the map view draws a geodesic line from the carrying object's drawn position to the other object's, in the kind's `line` (colour, width, dash, arrowhead at the other object):
    - **The switch** is the user's display setting per kind (`ctx.display.relations`, SDK 1.4.0 part 5; ADR-0051 point 7): drawn when it is `true`. Until the shell has `ctx.display`, each kind's `defaultOn` decides. A change of the switch applies at once.
    - **The drawn position** of a point object is its point; of any other object, where the map view puts its label. A line follows both objects as they move, and goes when either leaves the live picture or is deleted (ADR-0051 point 5: nothing of a hidden object shows).
    - **Under the symbols:** within each layer, under the symbols and graphics (function 29's order), in every workspace. A line is never picked or selected and has no label (function 14).
    - **Once per pair:** when both objects carry a relation of one kind to each other, one line. A kind no loaded plugin declares, or an object the map view does not hold, draws nothing.
    - **Zero length** (the ACA's R6 on CR-0031): a line whose two ends are at the same drawn position is skipped.
    - **Faded:** a line takes the lower opacity of its two objects (functions 13 and 24). **From M7, its carrying object's** (function 42; T-186).
    - **The budget:** lines count against the frame time of function 9; at `gmti`'s default cap (1 000 detections per dwell, each paired with its platform) the map view keeps criterion 9's budget.

35. **The user's display settings** (ADR-0046; SDK 1.4.0 part 5, `ctx.display`; owner, Q13, 2026-11-07). The map view reads them, follows each change at once (`ctx.display.onChange`), and never writes them. The shell gives them with the defaults applied, so the map view applies none itself:
    - **The size:** every `render` call's `size` is `symbolSize`. The setting "Symbol size in pixels" is used only while the shell has no `ctx.display`, and goes at the 1.4.0 freeze: the admin's default is in ECore's display defaults.
    - **The labels:** every `render` call passes `labels` (SDK 1.4.0 part 5); `symbology` draws the APP-6 amplifiers among them (its function 14). The defaults are `name`, `uniqueDesignation` and `direction` (owner, JF, 2026-11-07). **The direction arrow is the map view's own** (owner, LC, 2026-11-08): it does not follow the `direction` label, so unticking Direction leaves it; only a speed vector replaces it (below). With `name` among them, the map view draws a symbol object's `properties.name` under its image, in the look's label colour, following the text threshold of function 6, as shape labels do (function 18).
    - **The speed vector:** with `speedVectorMinutes` above 0, each symbol object (APP-6 and `vessel`) with both a `speed` above 0 and a `direction` gets a line from its position along `direction`, as long as the geodesic distance `speed` × `speedVectorMinutes` × 60 m, **in black** for every identity (owner, LB, 2026-11-08; not the frame colour), about 2 px wide. **Where a speed vector is drawn, the map view's own direction arrow is not** (LB); a symbol without one keeps its arrow (LC). It is drawn under the symbols (function 29's order), unwrapped at the antimeridian as shapes are, faded with its object (functions 13 and 24), never picked, and it counts against function 9's frame time. With 0 there is none. **From M6** the length is in seconds (function 38).
    - **A change** draws the symbols in view again with the new size and labels (`symbology` keys its images on both), and adds or removes names and vectors, without a reload and without a new subscription.
    - **Relation lines** follow `relations` (function 34).

36. **Arc bands and corridors** (data model 1.0.0's geometries; PCA-gmti's finding, 2026-11-07). A `core.shape` with either is drawn as an area with its `style` (outline, fill, `fillPattern`), as a polygon is, instead of the fallback marker:
    - **`ArcBand`:** the area between `innerRadius` and `outerRadius` (metres) round `center`, clockwise from `startBearing` to `endBearing` (degrees from true north at the centre). The arcs are geodesic circles, as function 18's circles, and the two side edges geodesic lines along the bearings. `innerRadius` 0 gives a sector from the centre. A band across north (e.g. 300° to 60°) is drawn across north, never as its complement. Equal bearings give the full ring between the two circles.
    - **`Corridor`:** the area within `width` / 2 of the centre line on either side, measured geodesically: flat ends square to the first and last segments, rounded joins at the inner positions.
    - **As other areas:** in every projection, the polar ones included, and across the antimeridian (function 18); a label at the middle (function 18); picked on the outline only (function 28); the highlight (function 10); faded (functions 13 and 24); one object for the budget (functions 9 and 12). Dragging previews them as a marker, as before (function 26), and editing does not reshape them (`draw-shapes` function 4).

**Out of scope (M5):** a halo round graphics for dark maps (owner, Q2, 2026-11-06: a possible later addition), APP-6B graphics (they keep the marker), adding or removing a graphic's points while editing, 3D.

## Functions (M6)

37. **Images inside graphics** (SDK 1.5.0 part 2, CR-0039; owner, HW). From M6 `symbology` returns the icons of 21 graphics (minefields, the mine line, the CBRN contaminated areas) as `GraphicRendering.images`. The map view draws them with their graphic (function 29):
    - **Where and how:** each image's centre at its `position`, projected from longitude, latitude; `width` by `height` screen pixels, turned `angle` degrees clockwise on the screen. After the graphic's fills and lines, under its labels. Drawn again with the rest of the graphic after each zoom (function 29); the next answer's images replace the last ones.
    - **Only as an image** (`GraphicImage`): the `svg` is the source of an image element, decoded on the main thread, never put into the page as markup. An `svg` that is not a `data:image/svg+xml` URI is not drawn, and no request is made for it. Each `svg` text is decoded once and cached; while it decodes, the graphic draws without it.
    - **As the rest of the graphic:** faded with it (functions 13 and 24), counted with it (one object), and not picked by a click (as a graphic's fill, function 30). The preview while placing and editing (function 32) shows the images too.
    - **Without `images`** a graphic draws as in M5.

38. **The speed vector in steps** (T-164; SDK 1.5.0 part 3, CR-0039 point 5; owner, MZ A and Q5 A). The length comes from `ctx.display.speedVectorSeconds`, one of 5 s, 10 s, 15 s, 30 s, 1, 2, 5, 10, 20 and 30 min (`SPEED_VECTOR_STEPS_SECONDS`), or 0 for none: the geodesic distance `speed` × `speedVectorSeconds` m.
    - **Everything else stays** as function 35 says: black, under the symbols, replacing the direction arrow, faded with its object, never picked, unwrapped at the antimeridian, within the budget.
    - **The shell always gives the seconds** (required since the 1.5.0 freeze) and turns stored minutes into the nearest step (Q5), so the map view rounds nothing and does not read the deprecated `speedVectorMinutes`. The display settings window with the steps is the shell's (CDA).

39. **Sensor report symbols** (T-151; SDK 1.5.0 part 3, CR-0039 point 6; owner, 2026-11-08, and Q41 to Q44, 2026-11-10). An object whose data type (`ctx.dataTypes`, by its `dataType`) declares `sensorReport: true` (today `gmti.detection`) is drawn with `symbology`'s `sensorReportSymbol()` instead of its APP-6 symbol:
    - **The admin's image and nothing else:** drawn as it comes, its anchor at the position. The user's symbol size does not change it, and it gets no labels, no name, no direction arrow and no speed vector (owner, 2026-11-08; Q44). No `render` call is made for it.
    - **Otherwise as other symbols:** highlighted when selected (function 10), picked by a click or a box on its image, faded and removed by its data type's behaviour (functions 13 and 24), with its pairing line (function 34), in its layer's order (function 29), and counted as one object (functions 9 and 12).
    - **A change of the admin's symbol:** the map view asks for the image at every draw and at least once a second, and draws the sensor reports again when it is a different image, so a settings change shows within 2 s, without a reload.
    - **For an object whose data type is unknown or lacks the flag**, the APP-6 symbol as before. `sensorReportSymbol` is required of the symbol service since the 1.5.0 freeze; while no symbol service is there, or when it fails, the APP-6 symbol too.

## Functions (M7)

- **Built against:** SDK 1.6.0 (CR-0041) for functions 40 and 43 to 45: parts D, C, B and A. Functions 41 and 42 need no contract change.
- **Category** (T-174): `map-and-symbols`.
- **Can start first** (the M7 plan's lane D): functions 42 (T-186) and 41 (T-183).

40. **Display filters** (T-182; owner, QN B; SDK 1.6.0, CR-0041 part D; the mark: owner, Q58 A). The user's display switches `ctx.display.classes`, one per class of `DISPLAY_CLASSES`: "Dwell areas" (`dwell-area`) and "Sensor coverage" (`sensor-coverage`). Both are **on by default**.
    - **What a switched-off class hides:**
      - every object whose `displayClass` it is;
      - every overlay item whose `displayClass` it is, in any plugin's overlay.

      Such an object is not drawn, not picked and not selected by a click or a box, as an object of a locally hidden layer. The selection keeps its id.
    - **Nothing is deleted.** The platforms, detections and their relation lines stay. A switch's change applies at once, without a new subscription.
    - **The switches** are in the shell's Display settings window (CDA), beside the relation kinds'. The map view reads them and never writes them (function 35).
41. **Relation lines with one end off screen** (T-183; owner, QO A; **the map view alone, owner Q59 B**, no contract change; CR-0041's part E is dropped).
    - **How:**
      - **Fetching the far end:** for each relation of a held object whose other object the map view does not hold, it fetches that object with `ctx.objects.get`, at most `MAX_FETCH_IDS` ids per call, and draws the line to it (function 34).
      - **Following it:** it fetches again when a held object brings a new relation to it, and every 2 s while a line to it is drawn, so the line follows the far end at most about 2 s late.
      - **Forgetting it:** when no held object names it any more.
      - **What it draws:** the far end only as the line's end. Off screen, the object itself does not matter, and when it comes into view the subscription brings it as usual. An id the fetch does not return (deleted, or not visible to the user) draws no line.
      - **The bound:** at most 1 000 far ends. The lines to others are not drawn, and a warning is logged once.
    - **So** a pairing line stays when the platform is far outside the view. It goes when the far object is deleted or the carrier leaves the live picture.
42. **Relation lines fade with their carrier** (T-186). Replaces function 34's "Faded" bullet.
    - **A line's opacity** is **its carrying object's**, at every frame: the object whose `relations` hold the entry, for `gmti.pairing` the detection. That covers expired objects (function 13) and fade lists (function 24).
    - **So a line fades** in the same frame as its detection, and goes in the same frame as it, when it expires or is deleted.
    - **The other end's fading** does not fade the line (M7-S8). The line has **no setting of its own** for its fade.
    - **Once per pair** (function 34): when both objects carry the relation, the line takes the higher of the two opacities, so it fades only when both do.
43. **A relation kind's colour from settings** (T-181; owner, QM A; SDK 1.6.0, CR-0041 part C). Each line takes its kind's line from `ctx.relationLines`, not from `ctx.relationKinds`. The shell resolves its colour from the declaring plugin's setting (`gmti.pairing` from `gmti`'s `pairingColour`). On a change the lines are drawn again within a second, without a reload. Width, dash and arrowhead stay the manifest's.
44. **Append: continue a line** (T-176; owner, QG A, QH A; SDK 1.6.0, CR-0041 part B). The map view provides `MapView.append(id, options)` for a held `LineString` object:
    - **Adding points:** it starts at the line's last point. Each click adds a point, and a preview line runs from the last point to the pointer, in `style`. Snapping and the cursor are as in drawing a line (function 18).
    - **Finishing:** a double-click or Enter finishes, and resolves with the line's points followed by the added ones. With none added it resolves with `null`.
    - **Taking back:** Backspace, or a right click, takes back the last added point, never one the line had. With none left, a right click acts as Escape.
    - **Cancelling:** Escape, an abort, a workspace switch or another interaction resolves with `null`.
    - **Refusals:** it rejects at once with `NotOnMapError` for an object the map does not draw, and with `NotALineError` for any other geometry.
    - **It changes nothing** itself (function 17): the caller sends the update. While it runs, the line is highlighted and its own points do not move.
    - **Across the antimeridian** and in every projection, as drawing a line (function 18). A right click opens no menu while it runs (function 27).
45. **Text objects** (`core.text`; T-173; data model 1.6.0, CR-0041 part A; ADR-0055 point 4; PCA-map-view-2d's, by the ACA's note on ADR-0055 of 2026-11-11):
    - **The text:** a `core.text` is drawn as its `text.value` at its point, centred on it. Line breaks start new lines.
    - **Its look:**
      - turned by `text.rotation`, degrees clockwise from true north at the point, so it is upright at 0 in a north-up map and follows north in a polar projection;
      - `text.size` pixels (default 14);
      - the colour `style.strokeColor`, else the look's label colour, with the label halo (function 18).
    - **Like other objects:** in its layer's order (function 29), picked and selected on its text's box (functions 10 and 14), dragged by `dragObject` (moving its point), faded by its data type's behaviour (functions 13 and 24), counted as one object (functions 9 and 12), and in the right-click menus as any object.
    - **Always drawn,** at every zoom: it is the object, not a label, so function 6's text threshold does not hide it.
    - **Not edited by hand in M7** (`nvg` brief, N12): `edit` moves its point only.
46. **The fade in steps** (M7 RC2, T-192; **CR-0042 option A**, owner FA A, 2026-11-12; data model and web SDK 1.7.0). A data type may take a stepped fade from its plugin's settings (`fadeSetting`); the shell resolves it into `DataType.fade` (`SteppedFade`), absent when there is none. `gmti`'s detections and dwell areas are the first.
    - **The opacity** is the web SDK's `fadeOpacity(object, fade, now)`: full before `fromSeconds` after `time.observed`, one step down by `stepPercent` every (`invisibleAtSeconds` − `fromSeconds`) × `stepPercent` / 100 s, 0 from `invisibleAtSeconds`. An object without `time.observed` is not faded.
    - **In place of the expiry fade:** an object whose data type has a `fade` is drawn at that opacity, the symbol, its image and its highlight alike; its expiry fade (function 13) is not drawn on top. On a fade list (function 24) it takes the lower of that and the list's.
    - **At 0** it is neither drawn nor picked, as when a display filter hides it (function 40). It stays held, and ECore removes it by its data type (function 13's removal).
    - **Against the clock,** as function 13: checked at the update cadence, about once per second, and only objects whose step changed are styled again. Relation lines follow their carrier (function 42), so a detection's pairing line fades with it.
    - **A changed setting** comes as `onDataTypesChange` and applies at once, without reload.

## Out of scope (M0)

Aggregation and clustering in M0 (owner; clients without a GPU were supported up to the budget in function 9, ADR-0017; from M1: function 12), 3D, WMTS sources (ADR-0035 point 5; WMS from M4: function 3), drawing of multipoint tactical graphics (spike S1; from M5: function 29), label-based filtering, an OpenLayers escape hatch.

**Out of scope (M2):** selecting the objects inside a cluster through the server (ADR-0032 alternatives), military tactical graphics (decided near the end of M2, ADR-0033), undo, snapping, editing several shapes at once, measuring.

## Interfaces

| Direction | What |
|---|---|
| Provides | `MapView` (web SDK). **(M5)** `draw`'s `graphic` and `edit` of a `core.multipoint` (function 32). **(M2)** Also, planned in T-049: the drawing and editing service (function 17); setting and reading the map type, centre and zoom (function 20, for setups and `bookmarks`); the object actions Centre on and Zoom to, and the map action Centre map (function 16). **(M3)** `MapView.createFadeList` (function 24) |
| Requires | **(M7)** SDK 1.6.0 (CR-0041): `ctx.display.classes`, `ctx.relationLines`, `core.text`; it provides `MapView.append`. `SymbolService` (symbology); **(M5)** its `renderGraphic` and `graphicCatalog` (SDK 1.4.0), used when there, else the fallback marker; **(M6)** `GraphicRendering.images` (SDK 1.5.0 part 2), drawn when there (function 37); its `sensorReportSymbol` (SDK 1.5.0 part 3; required since the freeze; function 39); `ctx.display.speedVectorSeconds` and `ctx.dataTypes`' `sensorReport` (SDK 1.5.0 part 3); `BackgroundMapProvider` (zero or more, e.g. basemap-osm; from SDK 1.3.0 also with a `wms` source, e.g. basemap-wms); live picture subscription (SDK). **(M2)**, planned in T-049: the shell's object and map action lists and its menu (function 15); fetching objects by id (function 16); saving and restoring its share of a setup (function 20). **(M3)** `ctx.workspace` and its change, `LivePictureOptions.workspaces`, `workspaces` on its actions (SDK 1.2.0); the shell's switch and setups per workspace (T-080) |
| Objects | Reads all objects and layers. Never sends change requests, also not through the drawing service (function 17) or its actions (function 16) |

## Dependencies

- `ol` and `proj4`, shared through the shell's import map; versions pinned by the CDA (proj4 must be added to the import map: S4/T-007).
- No other third-party libraries expected.

## Settings

| Setting | Default |
|---|---|
| Projections (list of id, proj4 text, extent, worldExtent) | EPSG:3857, EPSG:3413; **(M1)** also EPSG:3031 (Antarctic polar stereographic) |
| **(M1)** Preferred backgrounds (provider names, in order; function 3) | OpenStreetMap, Natural Earth |
| Initial projection, centre (lon, lat) and zoom | EPSG:3857, 15° E 62° N, zoom 5 |
| Symbol size in pixels | 30; **(M5)** used only while the shell has no `ctx.display`, gone at the 1.4.0 freeze (function 35) |
| Text amplifier threshold (visible symbols) | 2 000 |
| Update cadence for large change streams | 1 s (ADR-0017 point 4) |
| Software rendering budget (symbols) | 10 000 (ADR-0017 point 2) |
| **(M1)** Object budget with a GPU / without (function 12) | 100 000 / 10 000 |
| **(M2)** Zoom to one object: view width (function 16) | 10 km |
| **(M2)** Highest dim level (function 19) | 90 % |

## Permissions

None. The map view only reads; what a user may see is filtered by the server. **(M2)** Selecting, the menus and Centre on and Zoom to need no permission; the actions of other plugins carry their own (ADR-0032 point 8).

## Internet access

**Not allowed.** Tiles come only through background map providers.

## Acceptance criteria

1. With `basemap-osm` installed, the M0 page shows the OpenStreetMap background in EPSG:3857, with its attribution visible.
2. A `core.symbol` object created in one browser appears in a second browser without reload, at the correct position, within 1 s.
3. Positions are correct: an object at 15° E, 60° N appears at that place in EPSG:3857 and EPSG:3413, tested by converting back from screen to lon/lat (latitude ≠ longitude).
4. Switching to EPSG:3413 shows the objects correctly around the North Pole, including over the pole and across the antimeridian.
5. Layers are drawn in `drawOrder` order. Changing a layer's `drawOrder` reorders the map without reload. Hiding a layer locally does not affect a second browser.
6. Pick returns the topmost object id under the pointer within the tolerance.
7. The "pick a point" and "drag an object" interactions return lon/lat positions; dragging does not change the object by itself.
8. **With a GPU:** 100 000 `core.symbol` objects render completely within 5 s, and pan and zoom run at least at 30 fps. **Without a GPU** (the dev VM): 10 000 symbols stay usable during pan and zoom (no frame gap above 0.5 s; S2 measured about 50 ms per frame), and 100 000 symbols still load and draw without errors, only slowly (ADR-0017).
9. 1 000 position changes per second over 100 000 objects, at the default cadence of 1 s, do not block the page: the main thread is blocked less than 30 % of the time (S2 measured 6 % with a GPU and 19 % without).
10. Objects of unknown types are shown as a fallback marker, never dropped. Their extensions are untouched (the map view never writes objects). The one exception: an object with no position inside the current projection's `worldExtent` is not drawn in that projection (function 4).
11. No request leaves the server origin except those of background map providers that declare internet use.
12. No OpenLayers type appears in anything the plugin exposes.
13. **Rendering check:** on a machine with a GPU, the result is "hardware" and no notice is shown. In a browser without hardware acceleration (the dev VM, or Chrome started with `--disable-gpu`), the result is "software", the notice is shown, and the result is logged and reported through the plugin status. With WebGL unavailable (simulated in a test), the Map Pane shows the "cannot draw the map" message, not an empty map.
14. In software mode, a live picture of more than 10 000 symbols shows the budget warning; all objects are still drawn. (M0, without an area of interest; from M1 criteria 20 to 22 apply.)
15. **Selection highlight:** an id set in `MapView.selection` by any plugin is highlighted: a symbol with a frame that fits its size on screen, a line or polygon with a wider stroke. During `dragObject` the highlight moves with the object. Deleting a selected object, or a new snapshot without it, removes its id from the selection. (From M2 only a delete does, criterion 40.)
16. **Double-click** (T-032): during `pickPoint` and `dragObject` a double-click does not zoom the map; after the interaction ends, it zooms again.

From M1 (with SDK v1):

17. **Vector background in every projection:** with `basemap-naturalearth`, the background is drawn in EPSG:3857, EPSG:3413 and EPSG:3031. In EPSG:3413 the Arctic coasts and in EPSG:3031 Antarctica are closed and in place, with no seam along 180° and no polygon stretched across the map. A polygon cut at ±180° (e.g. Chukotka, Fiji) shows no seam where its pieces meet. Tested with independent projection maths, as criterion 3.
18. Switching between EPSG:3857 (OpenStreetMap chosen) and EPSG:3413 switches to the Natural Earth background, and back to OpenStreetMap when returning (function 3).
19. A long lon/lat edge along a parallel (e.g. 49° N over 30° of longitude) is drawn as an arc along that parallel in EPSG:3413, not as a straight chord.
20. **Area of interest:** the map view subscribes with `area: 'viewport'` and the budget of its rendering mode. Objects reported as `left` disappear from the map and from the selection; objects that `entered` appear. (From M2 their ids stay in the selection, criterion 40.)
21. **Clusters:** with more objects in the area than the budget, the map shows clusters with their counts; hiding a layer locally lowers the counts at once; a click on a cluster zooms in; a double-click on a cluster zooms in once, by the cluster's zoom only (not also by the map's double-click zoom).
22. With 200 000 objects and the view zoomed out, the map draws at most about the budget in items (S3: about 4 100 with 64 px cells), with a GPU and without.
23. **Fading:** a `cot.cot` object whose `time.expires` is 2 s ahead is drawn normally, then faded within 1 s after the expiry, without any change event arriving; switching `fadeWhenExpired` off for the data type draws it normally again at once. An object of `core.general` (no expiry) is never faded.

From M2 (with SDK 1.x and data model 1.1.0):

24. **Click selection:** a click on an object selects it and replaces the selection; a click on empty map or Escape clears it. Clicking a symbol no longer needs `draw-symbols`.
25. **Ctrl/Cmd+click:** adds an unselected object and removes a selected one. On a Mac, Cmd does this and Ctrl+click opens the menu.
26. **Box:** Ctrl/Cmd+drag replaces the selection with the objects in the box; Shift+drag still zooms to a box.
27. **1 000:** a box over 1 500 objects selects exactly 1 000, from the topmost layer first, and the notice states the 500 left out.
28. **Held objects only:** objects inside a cluster, outside the subscribed area or in a locally hidden layer are not selected; the notice asks to zoom in.
29. **Menu on a selection:** a right click on a selected object of a selection of 3 offers the object actions, and the chosen action receives the 3 ids; Edit is not offered. A right click on an unselected object makes it the selection; where objects overlap, the user chooses one first.
30. **Map menu:** a right click on empty map offers the map actions with the position in lon/lat; Centre map centres there (tested with latitude ≠ longitude).
31. **Centre on, Zoom to:** for several objects the map centres on the middle of their extent in map coordinates; Zoom to one object shows a view 10 km wide (±10 %). Both work for ids of objects the map does not hold.
32. **Draw:** each kind of function 17 returns its geometry in lon/lat: a circle drawn with a 5 km radius returns 5 000 m (±1 %); an ellipse returns its semi-axes and rotation; a square and a rectangle return closed polygons. Escape returns `null`. The map view sends no change request (checked in the test).
33. **Edit:** moving a shape and dragging one corner return the new geometry; the object is unchanged until the calling plugin submits.
34. **Drawing everywhere:** a polygon drawn over the North Pole in EPSG:3413 and a line across the antimeridian in EPSG:3857 return correct lon/lat (tested by converting back, as criterion 3).
35. **New styles:** an ellipse is drawn as an ellipse; a hatched fill, an arrowhead and route markers are drawn as data model 1.1.0 describes them; a shape's name is drawn as its label; a 1.0.0 shape looks as before.
36. **Shape highlight:** a selected circle, ellipse, polygon and line get the wider stroke of function 10.
37. **Dim:** the slider dims the background map only; objects and clusters keep their colours. The level survives a reload and appears in a second browser of the same user.
38. **Setup share:** projection, background, centre, zoom, dim level and the layers' visibility are restored after a reload, in another browser of the same user, and when a named setup is picked. A layer deleted since is ignored.
39. **Performance:** with the new styles, criterion 8 still holds for 10 000 shapes with hatched fills without a GPU (labels as the threshold allows) (the prototype measures it first; the PCA records the numbers).
40. **Selection keeps what the map does not hold:** an id set by another plugin for an object outside the area stays in the selection, and so does a selected object that leaves the area; a delete event removes the id. A Ctrl/Cmd+click beyond 1 000 adds nothing and shows the notice.
41. **One interaction at a time:** starting a drawing cancels a running one (it returns `null`); while it runs, a double-click does not zoom and clicks do not select; Escape cancels it first, and only a second Escape clears the selection. With only a waiting `dragObject` (a selected symbol, `draw-symbols`), one Escape ends it with `null` and clears the selection; while the object is grabbed, Escape cancels the drag first (owner, 2026-10-20). A new `pickPoint` or drawing still replaces a waiting `dragObject`.
42. **Nothing to show:** Centre on and Zoom to for objects with no position inside the current projection's `worldExtent` leave the map where it is and show the notice.
43. **Look:** switching the look, or light and dark, changes the colour of label texts and cluster counts at once, without a reload; the affiliation colours, the selection highlight and the size of symbols and labels stay the same, also when the density changes. The Map Pane controls are checked in both densities, and in a light and a dark look (ADR-0034). They start collapsed as "Map controls"; opening puts the focus in the first list; the close button or Escape in the box collapses them, with the focus back on the button and the selection kept; open or closed is the same after a reload in the same browser; while collapsed, an unavailable background marks the button and names the problem in its name.

From M3 (with SDK 1.2.0 and the shell's workspaces; tested with the test kit's `switchWorkspace`, and once in the browser):

44. **Every workspace:** the Map Pane controls, Centre map, Centre on and Zoom to are there in View and in a declared workspace. A switch resolves a running `draw` with `null`, clears the selection and every fade list, and the map then draws only the new workspace's objects, from the fresh snapshot.
45. **Map state per workspace:** a centre, zoom, map type, dim level and layer visibility set in Simulation, and others set in View, are each restored when the user switches back, and after a reload (through the shell's setups per workspace; tested with latitude ≠ longitude). The first visit to Simulation shows the map type, centre, zoom and dim level that View had.
46. **Active layer per workspace:** with layer A active in View and layer S made active in Simulation, switching back to View makes A active again, and back to Simulation S. On the first visit to a workspace the map view sets none, and `layer-panel` then makes the top layer active. A layer made active between the moment and the map view's `onChange` listener (as `layer-panel` fills a gap from the fresh snapshot) does not replace the remembered one: switching back still restores A, and S.
47. **Reference layers:** in Simulation a View layer switched on is drawn under every Simulation layer; its objects are not selected by a click, a Ctrl/Cmd+click or a box, `pick` does not return them, and a right click on one opens the map actions. Its eye in Simulation and its eye in View are independent. With no reference layer on, the subscription names no workspace; with one on, both; after a switch back to View, none again (the test kit's `liveSubscriptions`). Switching to Simulation and back makes `layer-panel`'s eyes show each workspace's visibility (`onLayerVisibilityChange`).
48. **Fade lists:** ids set on a list are drawn faded within 1 s, also for an object that arrives later; `clear` draws them normally again, and a list stays when its plugin stops (amended, owner, 2026-10-28); of a list of more than 10 000 ids only the first 10 000 are faded, with a warning in the log; the lists of two plugins fade their union; a faded object can still be selected; a switch clears every list, and a list set again after the moment (criterion 50) stays.
49. **Load:** in Simulation, 1 000 tracks moving once per second (spike S6) keep criterion 9 (the main thread blocked less than 30 % of the time).
50. **The switch's moment** (function 22): the interaction ends and the lists and the selection are cleared at the shell's moment, before the fresh snapshots and before any `onChange` listener. So, with the shell's switch (T-080), both survive the switch: a fade list that another plugin sets from its fresh snapshot stays faded, and placing that `draw-symbols` starts again from its `onChange` listener is not ended by the moment. Whether its listener runs before or after the map view's, which sets the active layer, placing then runs in the workspace's active layer, or waits and starts again as `draw-symbols` function 19 says. The test includes the map view's setting of the active layer. Tested in the unit test with the moment as the shell gives it, and once in the browser.
51. **Dragging a shape** (function 26, T-066): a polygon and a line whose first position has latitude ≠ longitude, a route with point markers, and a circle are dragged with the test's pointer events by a difference that is not the same in longitude and latitude. The drop is the first position (the circle's centre) moved by the drag; the preview's positions are all moved by the same difference, with latitudes clamped at ±90; the route's point markers move with its line; the object itself is unchanged.

From M4:

52. **Right-click while placing:** during `pickPoint` a right click ends it with `null` and opens no menu; with nothing running, the next right click opens the menu as before.
53. **Right-click while drawing:** a line with three points set has two after a right click, in the preview too; three more right clicks remove the other two and then return `null`. A right click before the press of a circle returns `null`; one during the drag of a rectangle changes nothing. During an Edit a right click changes nothing and opens no menu.
54. **Filled shapes:** inside a filled polygon and a hatched circle, a click over empty map clears the selection and a click over a symbol selects the symbol; a click on the outline selects the shape. `pick` inside the fill does not return the shape, and a right click there opens the map actions. A press inside the fill of a selected filled shape does not grab it; a press on its outline does.

With SDK 1.3.0 (WMS, T-072; with fake providers and the test kit's `wmsGetMapUrl`, and once in the browser with GeoServer through `basemap-wms`, T-075):

55. **WMS tiles:** a provider with a `wms` source listing EPSG:3857 is offered there and drawn; every tile request has the same parameters as `wmsGetMapUrl` for its tile's box and `tileSize`, compared by name, not as a string (OpenLayers chooses their order); a tile at the antimeridian asks for a box inside the extent.
56. **Axis order:** in EPSG:4326 with WMS 1.3.0, a box from 10° E to 20° E and 55° N to 65° N is sent as `BBOX=55,10,65,20` with `CRS`; with 1.1.1 as `10,55,20,65` with `SRS`.
57. **One image:** in `'image'` mode one request per view, inside the extent, with `WIDTH` and `HEIGHT` at most 4 096; a view wider than that asks for a smaller image and draws it scaled up.
58. **Only listed projections:** a `wms` background listing EPSG:3413 is drawn there, around the pole; one that does not list the current projection is not offered, and none is redrawn in another projection. A provider with a URL on another host, no layers or `'any'` for projections is not offered, and says why.
59. **Failures and removal:** an image answered with an error leaves its area empty and the map usable; removing the shown provider falls back to another background, with the notice.
60. **Own URLs and the tile rule** (DX, DY): no request comes from OpenLayers' `TileWMS` or `ImageWMS`; every `WIDTH` and `HEIGHT` is a whole number; a `'tiles'` source in a projection whose extent's sides are not in a whole-number ratio of at most 16:1 is drawn as one image per view, with `'image'` mode's requests (criterion 57), while in EPSG:3857 and EPSG:4326 it is drawn as tiles.

From M5 (with SDK 1.4.0 part 2; unit tests with the fake symbol service, whose `renderGraphic` draws a line through the points, and in the browser with `symbology`'s):

61. **Drawn:** the boundary, axis of advance and range fan examples of `model/examples/valid/` are drawn as graphics, not as markers; with the fake service a graphic's line runs through its control points within a pixel, where latitude ≠ longitude.
62. **Again at a zoom:** a zoom calls `renderGraphic` again with the new `resolution`; a pan inside the drawn extent does not; a pan out of it does. An answer for an older state is not drawn.
63. **The marker:** with a refusal (`refuse(reason)` in the fake) and for an APP-6B graphic, the graphic is drawn as the fallback marker at its first point, and the reason is logged once.
64. **Order:** in one layer a symbol placed on an area graphic, and a graphic on a filled shape, are drawn on top of them; a graphic of a higher layer is drawn over a symbol of a lower one.
65. **Antimeridian:** in EPSG:3857 a phase line from 179° E to 179° W is drawn as a short line, not across the world.
66. **Selected:** a click on a graphic's line selects it, a click inside an area graphic's fill does not, and a box over part of a line selects it; the highlight shows on its lines.
67. **Dragged:** a selected graphic dragged by +2° in longitude and +1° in latitude previews moved, and the plugin that drags gets the drop position (function 26).
68. **Placed with a preview:** `draw('line', { graphic })` for an axis of advance shows the plain line with one point, then the graphic from `minPoints` on; Enter with fewer points does not finish; a graphic with `maxPoints` 2 finishes at the second click. The result is the same `LineString` as without `graphic`. `draw('polygon', { graphic })` clicked clockwise and anticlockwise returns each ring in the clicked order, closing position last.
69. **Edited:** `edit` of a graphic shows a handle on each control point; moving one draws the graphic again and resolves with the moved point; Escape resolves with `null`.
70. **Load** (with `symbology`, in the browser): 1 000 graphics in view keep criterion 9's main-thread budget after a zoom, and are all drawn again within 1 s.
71. **Vessels:** `object-vessel.json` is drawn with the image `render` gives for `vessel` `0470` (the fake symbol service's call has the standard `vessel` and the modifiers' `direction`), at [11.8512, 57.6934] (latitude ≠ longitude); a click on it selects it.
72. **A pairing line:** with the kind `gmti.pairing` declared and switched on, a detection at [15.20, 58.41] paired with a platform at [15.90, 58.95] (latitude ≠ longitude) draws one yellow line of width 1 between them, under both symbols; switched off, none; the platform moved, the line follows.
73. **Once and never:** two objects paired with each other in one kind draw one line; an entry of an undeclared kind, or to an object not in the live picture, draws none; a line of zero length is not drawn (no zero-length feature in the source).
74. **Not picked:** a click on a line selects nothing; a box over it selects only the objects.
75. **Faded:** a faded detection's line has the detection's lower opacity.
76. **Load:** 1 000 detections paired with one platform, switched on, keep criterion 9's main-thread budget after a pan and a zoom.
77. **Size** (function 35): with `ctx.display`'s `symbolSize` 48 in the fake, every `render` request has `size` 48 (`renderRequests`); `setDisplay({ symbolSize: 20 })` draws the symbols in view again at 20 without a reload. Without `ctx.display`, the setting's size.
78. **Labels:** every `render` request carries the user's `labels`; with `name` among them a symbol's `properties.name` is drawn under it below the text threshold, and not above it; without `name`, no name. With the defaults (owner, JF), the requests list `direction`. Unticking Direction leaves the map view's direction arrow (LC).
79. **Speed vector:** with `speedVectorMinutes` 10, a symbol at [15.20, 58.41] with `speed` 10 m/s and `direction` 90 gets a line ending 6 000 m east of it (within 1 m, geodesic); with 0, none; an object without `direction`, or with `speed` 0, gets none. The vector is black for a friend, a hostile and a vessel alike (LB); the symbol with a vector has no direction arrow, and with 0 minutes, or with `speed` 0, it has its arrow again (LB, LC).
80. **Under and faded:** a vector is drawn under its symbol and the others in its layer, is not picked by a click or a box, and fades with its object.
81. **Antimeridian:** in EPSG:3857 a vector from 179.9° E heading east is drawn as a short line, not across the world.
82. **At once:** changing the minutes, the labels and a relation switch in `setDisplay` changes the map within 1 s, without a new live-picture subscription.
83. **Load:** 1 000 moving symbols with vectors in view keep criterion 9's main-thread budget.
84. **Arc band:** a band round [15.20, 58.41] from 25 000 to 35 000 m between 82.5° and 97.5° (`gmti`'s criterion 4) is drawn as an area whose outer arc passes 35 000 m and whose inner arc 25 000 m from the centre at 90° (geodesic, within 1 m), and whose sides follow 82.5° and 97.5°.
85. **Sector and north:** `innerRadius` 0 gives a wedge from the centre; 300° to 60° is drawn across north (the 120° sector, not its complement); equal bearings give the full ring.
86. **Corridor:** a corridor along [15.0, 58.0] to [16.0, 58.5] of width 2 000 m is drawn as an area whose edges lie 1 000 m from the centre line (within 1 m), with flat ends.
87. **As other areas:** both in EPSG:3413 and across the antimeridian in EPSG:3857 (a short area, not across the world), with a hatched fill, a label, the highlight when selected, and a click inside the fill selecting nothing (function 28).
88. **In the browser:** `gmti`'s dwell area and the simulator's sensor sector are drawn as bands round the platform, not as markers at the centre.

From M6, SDK 1.5.0 part 2 (images inside graphics; the test kit's `withImages` and `fakeGraphicImage`):

89. **Drawn:** with `withImages([fakeGraphicImage([15.20, 58.41], 30)])`, a phase line from [15.10, 58.38] to [15.30, 58.44] is drawn with one 16 by 16 pixel image centred on [15.20, 58.41] (latitude ≠ longitude), turned 30° clockwise, after its lines and under its label (an engine spy); without `withImages` it is drawn as in M5.
90. **Only as an image:** the `svg` reaches the engine only as an image's source; an image whose `svg` is `data:text/html,…` or an `https:` URL is not drawn and no request is made.
91. **Cached:** 100 graphics with the same `svg` decode it once.
92. **Again, faded and previewed:** after a zoom the new answer's images replace the old ones; a faded graphic's image has the graphic's lower opacity; a click on an image selects nothing; the preview of `draw('area', { graphic })` shows the images.
93. **In the browser** (with `symbology`): an APP-6D minefield and an APP-6E chemical contaminated area show their icons in a light and a dark look, in EPSG:3857 and EPSG:3413, and after a zoom; no request goes beyond the emc2 server.

From M6, SDK 1.5.0 part 3 (the speed vector in steps; sensor report symbols, with the test kit's `FAKE_SENSOR_REPORT_SYMBOL` and a data type with `sensorReport`):

94. **Steps** (function 38): with `speedVectorSeconds` 5, a symbol at [15.20, 58.41] with `speed` 10 m/s and `direction` 90 gets a line ending 50 m east of it (within 1 m, geodesic); with 1800, 18 000 m; with 0, none. With `speedVectorSeconds` 600 it gives 6 000 m, as criterion 79 did with 10 minutes.
95. **At once:** `setDisplay({ speedVectorSeconds: 30 })` changes every vector in view within 1 s, without a new live-picture subscription.
96. **Sensor reports drawn** (function 39): with the fake service's `sensorReportSymbol` and `gmti.detection` declaring `sensorReport`, a detection at [15.20, 58.41] with `speed`, `direction` and a `name` is drawn with the 12 by 12 image at its anchor [6, 6], with no `render` request for it, no name, no arrow and no vector, while a `cot.cot` symbol beside it is drawn as before. With `symbolSize` 48 the detection's image stays 12 by 12.
97. **Without the flag:** a data type without `sensorReport`, or an object of an unknown data type, draws the detection through `render` as in M5.
98. **As other symbols:** a sensor report is selected by a click on its image and by a box, is highlighted, fades by its data type, and keeps its `gmti.pairing` line.
99. **A change:** when the service starts returning another image, the sensor reports in view show it within 2 s, without a reload or a new subscription.
100. **In the browser** (with `symbology` and `gmti` or the simulator): the detections are orange outlined dots by default and their platform keeps its APP-6 symbol; a new shape in `symbology`'s settings shows within 2 s; a moving track shows the 5 s and the 30 min vectors; in a light and a dark look.

**From M7** (functions 40 to 45):

101. **Display filters** (T-182): with a `core.shape` of `displayClass` `dwell-area`, one of `sensor-coverage`, one without, and an overlay `area` of `dwell-area`, switching "Dwell areas" off (`ctx.display` in the test kit) hides the first shape and the overlay area and leaves the others. A click on the hidden shape's outline picks nothing, and switching on shows both again. A user with no setting of their own sees both classes.
102. **Off screen** (T-183): zoomed in on a detection 150 km from its platform, with the platform outside the view and the subscription's area, the pairing line runs to the platform's position. It follows the platform's next move within about 2 s (Q59 B), and goes when the platform is deleted.
103. **The fade** (T-186): a detection that expires (its data type's `fadeWhenExpired`) fades its pairing line in the same frame. A detection on a fade list fades its line. A faded platform with a bright detection leaves the line bright. The line goes in the frame the detection goes.
104. **The colour** (T-181): with `ctx.relationLines` giving `#00FF00` for `gmti.pairing`, the line is green. A change to `#FF00FF` redraws it within a second, without a new subscription.
105. **Append** (T-176): `append` on a line of three points with two clicks and Enter resolves with five points, the first three unchanged (latitude ≠ longitude). Backspace after the first click resolves, after Enter, with four. Escape gives `null`. A polygon rejects with `NotALineError`. An object not drawn rejects with `NotOnMapError`. An aborted signal resolves with `null`.
106. **Text** (`core.text`): a text "Alpha" at [15.2, 58.4] with rotation 30 and size 20 is drawn there, turned 30° clockwise, 20 px, in its `strokeColor`, and stays drawn when zoomed out past the text threshold. A click on it selects it, and dragging moves its point.
107. **The fade in steps** (T-192, CR-0042 A): with a data type whose `fade` is `{ fromSeconds: 10, stepPercent: 5, invisibleAtSeconds: 100 }`, an object observed now is drawn fully, at 95 % from 14.5 s, at 50 % from 55 s, and is neither drawn nor picked from 100 s, without a change event; its expiry at 60 s does not draw it at 40 % on top; on a fade list it takes the lower opacity; its pairing line has its opacity (function 42); a changed `fade` (`onDataTypesChange`) applies within 1 s; 10 000 such objects at different ages keep criterion 9.
108. **Turning vessels** (T-200): a vessel with `direction` 34 is drawn with the hull of 30°, one with 35 or 36 with the hull of 40°, one with 356 with the hull of 0°, with and without text, and its properties still show 34; 200 vessels each turning 1° a second for a minute add at most 36 images per hull look to the atlas; in that playback no frame draws a symbol layer blank (each frame's symbols counted, also across an atlas swap), and the style is swapped at most 4 times a second.

## Open questions for the owner

**M7 (2026-11-11), answered by the owner (RJ A):** Q58 A (function 40, CR-0041 part D) and Q59 B (function 41: the map view alone; part E dropped). `core.text` (function 45) is this plugin's, by the ACA's note on ADR-0055. **The assumption M7-S8,** accepted (Q63): a relation line fades with its carrying object only; the other end's fading does not fade it (function 42).

**M5, answered by the owner (2026-11-06):**
- **Q1, the preview while placing** (function 32): the graphic itself, through `renderGraphic`, rather than a plain line until the object is made. It needed `MapView.draw`'s `graphic` in SDK 1.4.0 part 2.
- **Q2, the look** (function 29): APP-6's colours in every look; a halo for dark maps is left for a later milestone.
- **Q4, the order** (function 29): within a layer, graphics under symbols and over shapes, rather than mixed with them.

1 and 2 were answered by the owner on 2026-10-15, as recommended, and 3 to 6 on 2026-10-27, as recommended (the ACA supported each, T-078).

1. **Dim range and colour** (function 19). **Decided by the owner, 2026-10-15, as recommended: 0 to 90 %, towards black.** The recommendation was: a slider from 0 to 90 %, in the Map Pane next to the background choice, dimming the background towards black in light and dark mode alike. At 100 % the background would vanish, which "Hide background" could do better later. Alternative: dim towards the theme's background colour (lighter in light mode), which looks softer but loses contrast for dark symbols.
2. **Shape labels at scale** (function 18). **Decided by the owner, 2026-10-15, as recommended: labels follow the text threshold.** The recommendation was: labels follow the text threshold of function 6 (about 2 000 visible items), like symbol texts, so a large picture stays fast. Alternative: always draw shape labels, which costs drawing time with many shapes.
3. **Where View's reference layers are drawn** (function 23). **Decided by the owner, 2026-10-27, as recommended: under the workspace's own layers.** The recommendation was: under all of the workspace's own layers, in View's order among themselves, so that the simulation is never hidden under the reference and `layer-panel` lists them in the same place (its function 20). **Alternative:** by `drawOrder` among the workspace's layers, which lets a user put a reference above a simulation layer but mixes two orders that users set apart.
4. **The selection on a switch** (function 22). **Decided by the owner, 2026-10-27, as recommended: cleared.** The recommendation was: cleared, as the simplest rule that keeps the shared Delete and every action off the objects of a workspace not shown. **Alternative:** each workspace keeps its own selection during the page and gets it back on a switch; ids of objects deleted meanwhile then stay until an action reports them gone (function 10).
5. **The map on the first visit to a workspace** (function 22). **Decided by the owner, 2026-10-27, as recommended: the map it had.** The recommendation was: the map type, centre, zoom and dim level the map had, so that Simulation opens over the same area as View. **Alternative:** the settings' initial view (15° E 62° N, zoom 5), the same for every first visit.
6. **What a user can do with View's reference objects** (function 23). **Decided by the owner, 2026-10-27, as recommended: only see them.** The recommendation was: nothing but see them: they are not selected, and a right click on one opens the map actions. No editor, drag or Delete can reach them, so A17 holds without work in the shell or in other plugins. **Alternative:** selectable, read only: Centre on, Zoom to and the properties panels work, but then every editor and the shell's shared Delete must refuse objects of a View layer while another workspace is shown (`draw-symbols`, `draw-shapes`, the CDA in T-080).
