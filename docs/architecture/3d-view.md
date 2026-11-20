# A 3D view: options for the owner

- **Status:** written by the ACA on 2026-11-03, at the owner's request, for a later milestone. Nothing is decided. When a milestone takes up the 3D view, spike S7 (overview section 7) checks the chosen option, and an ADR records the decision.
- **Question:** how emc2 gets a 3D view that meets the owner's four goals (2026-11-01, below).
- **Sources:** written from the ACA's general knowledge of the libraries on 2026-11-03. **Versions, licences and limits were not checked for this paper.** Spike S7 checks each one against the packages themselves, as spike S1 did for mil-sym-ts.

## The owner's goals (2026-11-01)

| Goal | What |
|---|---|
| G1 | Show shapes that have a 3D placement, such as air corridors |
| G2 | A spatial sense of the battlespace: air, ground and sea assets in a view that can be navigated in 3D |
| G3 | Later, with an HLA/RTI simulation environment: a 3D view for the game control cell, to see what happens in the simulation |
| G4 | Ideally, elevation data with satellite imagery, giving navigable "melted chocolate" 3D worlds |

## 1. Where emc2 stands

- **The plan:** ADR-0009 made the 2D map a plugin (`map-view-2d`), so that a 3D view can come later as another map view plugin. The overview lists the 3D map view under "Later" (section 6).
- **The data model:**
  - Positions may carry an altitude, in metres above the ellipsoid (HAE).
  - Shapes have **no vertical extent**. A `Corridor` has a centre line and a width, but no floor or ceiling, and nothing says whether a height is above the ellipsoid, above mean sea level, above ground, or a flight level.
- **The simulator** already moves tracks with an altitude (ADR-0040).
- **One map view per pane** (overview 4.11). The SDK's `MapView` (picking, drawing, editing, dragging) was designed for 2D.
- **The live picture** subscribes to a rectangle and a zoom level (spike S3), with clusters when zoomed out. A tilted 3D camera sees no rectangle.
- **Offline** (ADR-0030): the browser talks only to the emc2 server, and every function has an offline way. For maps that is Natural Earth, and detailed maps come from the network's own WMS servers through a plugin's server part (ADR-0035).
- **Polar areas** are a requirement, and work in 2D since M1.
- **The full object count needs a GPU** (ADR-0017).

## 2. The options

| | A: CesiumJS | B: MapLibre GL JS with deck.gl | C: own, on three.js | D: OL-Cesium | E: a game engine |
|---|---|---|---|---|---|
| What | A 3D globe for the web: terrain, imagery draped over it, 3D Tiles, objects, a simulation clock | A tilted 2D map ("2.5D") with terrain and a globe view; deck.gl layers for objects at altitude | three.js, with NASA's 3D Tiles renderer for terrain and imagery; the rest written by emc2 | A bridge that shows OpenLayers' layers on a Cesium globe, beside the 2D map | Unreal or Unity (e.g. with Cesium's plugins), as a desktop application next to emc2 |
| G1 air corridors | **Yes**: corridors, polygons and volumes with a floor and a ceiling are built in | Partly: floating extruded polygons only; no tubes or arcs | Yes, written by us | Through Cesium only | Yes |
| G2 navigate in 3D | **Yes**, free camera | Partly: the camera tilts to about 85°, no free flight | Yes | Yes | Yes, the best looking |
| G3 game control | **Good**: a clock and a timeline, time-dynamic positions | Fair | Good, at our cost | Fair | Good, but outside the browser |
| G4 terrain and imagery | **Yes** | Yes | Yes | Yes | Yes |
| Polar areas | **Yes**, a real globe | **No**: Web Mercator data ends at about 85° | Yes | Yes | Yes |
| Many objects | Good with its low-level primitives; to be measured | **Very good** (deck.gl) | As good as we make it | As Cesium | Very good |
| Licence (not checked yet) | Apache-2.0 | BSD-3-Clause, MIT | MIT, Apache-2.0 | BSD-2-Clause | Commercial terms |
| Effort | **Medium** | Low to medium | High | Medium, but it fits our map poorly | High: a second product |
| Fits the architecture | Yes: a second map view plugin | Yes: a second map view plugin | Yes | Poorly | No: not a browser plugin |

### Option A: CesiumJS

- **What it gives:** a whole globe in WebGL, with the poles and the antimeridian handled. Terrain comes as quantized-mesh or heightmap tiles, and imagery from WMS, WMTS or tile servers, draped over the terrain. It shows 3D Tiles (photogrammetry, buildings) and objects at their altitudes, and has a clock with a timeline.
- **G1:** corridors, polygons, polylines with a cross-section, and cylinders can each have a floor and a ceiling, which covers most airspace shapes.
- **Offline:** by default it reaches Cesium ion, Cesium's commercial service, for terrain and imagery. That must be switched off and replaced by the emc2 server's own tiles (ADR-0030). Its static files (web workers, assets) are served by the emc2 server like any plugin code.
- **Size:** several MB of JavaScript, loaded only with the 3D view.
- **Risk:** 100 000 objects need its primitive collections, not its convenient Entity API. Imagery providers support EPSG:4326 and 3857 tiling only, so a WMS server must offer one of them.

### Option B: MapLibre GL JS with deck.gl

- **What it gives:** a vector and raster map with terrain, a tilted camera and, in recent versions, a globe. deck.gl draws large numbers of objects with the GPU, at altitudes, with paths and extruded polygons.
- **Limits:** its data is Web Mercator, so the polar requirement fails. The camera does not fly freely. Volumes in the air beyond floating prisms need custom code.
- **When it fits:** if polar 3D and free flight matter less than speed and a light page.

### Option C: our own, on three.js

- Full control, and only what emc2 needs. But the globe, terrain tiling, imagery, picking and camera would all be ours to write and keep. This only makes sense if A and B both fail the spike.

### Option D: OL-Cesium

- It shows OpenLayers layers on a Cesium globe and keeps the two cameras in step. `map-view-2d` draws objects with its own WebGL layers, which the bridge does not translate, so most of the work would be the same as option A, with a second dependency.

### Option E: a game engine

- The best visuals, and engines often join HLA federations directly. But it is a separate desktop product, outside the browser rule and the plugin model, with its own licence terms. It could suit a dedicated game control station later, and does not replace a 3D view in emc2.

## 3. Recommendation

**Option A, CesiumJS, as a second map view plugin, `map-view-3d`.** It is the only browser option that meets all four goals and the polar requirement, and its licence fits ADR-0016. B is the fallback if the spike shows A too slow for the object count. The decision waits for spike S7.

## 4. What emc2 needs, whatever the option

1. **Vertical extents in the data model** (a data model CR). Many airspace shapes have a floor and a ceiling. Each needs a reference: above the ellipsoid, above mean sea level, above ground, or a flight level.
   - Converting between them needs a geoid model (e.g. EGM2008) for mean sea level, and terrain heights for above ground. Flight levels need a pressure convention.
   - Where they are converted (the server, the map view, or both) is a design question for the ADR.
2. **Terrain as a source** (an SDK CR). A terrain provider service, like `BackgroundMapProvider`: a plugin offers elevation tiles, through its server part when they come from another server (ADR-0030, as for WMS). Imagery reuses the background map providers where their projection fits.
3. **Where the 3D view lives** (a question for the owner):
   - a workspace of its own, a "3D" tab (ADR-0039 makes this cheapest);
   - a 2D/3D switch in the Map Pane;
   - or a second browser window that follows the first.
4. **What it does first.** A first version could show, select and give the right-click menu (ADR-0032), while placing, drawing and editing stay in 2D. `MapView`'s 2D calls then become optional for a 3D view, or get 3D counterparts later.
5. **The live picture in 3D.** A tilted camera sees a trapezoid up to the horizon, not a rectangle. Subscribing needs the camera's footprint, a distance limit, and clusters that work at a slant. This is a protocol change for the CDA.
6. **Objects in 3D:**
   - single symbols as billboards, from milsymbol's images (ADR-0010), standing above the ground or at their altitude;
   - an optional line to the ground for air tracks;
   - tactical graphics from mil-sym-ts (ADR-0043), draped on the terrain;
   - objects without an altitude placed on the terrain.
7. **Speed:** 100 000 objects with a GPU (ADR-0017), measured in the spike, as spike S2 did for 2D.
8. **Coordinates:** WGS84 longitude, latitude and HAE inside, as always (ADR-0007). Every converter is tested with a point where latitude ≠ longitude, and the height conversions with a point where the geoid is far from zero.

## 5. Goal G3: HLA and RTI

- **The 3D view only shows.** Joining a simulation is a separate in/out plugin, built by the in/out playbook as `ais` and `adsb` were (M4):
  - it maps the federation's entities (the RPR FOM, for example) to objects and back;
  - it runs on connection tasks (ADR-0036), or on the RTI's own threads if its API needs that, which would be a question for an ADR.
- **Rates:** HLA entities update far more often than the live picture's roughly once per second. The plugin keeps the latest state per entity (as output channels coalesce, ADR-0037), and the 3D view extrapolates positions between updates (dead reckoning), which CesiumJS's clock supports.
- **Licences (not checked yet):**
  - **RTIs:** Pitch pRTI and MÄK RTI are commercial; Portico is CDDL and OpenRTI is LGPL, as far as known. None is on the list for shipped code. An RTI as an external test service of the ESA is allowed with the owner's approval (owner, 2026-10-14). A plugin linking an RTI's library needs a CR.
  - **DIS** (IEEE 1278) is a lighter first step: entity state over UDP, with permissively licensed libraries such as Open DIS. It could come before HLA.
- **The game control cell** would use the 3D view in a workspace of its own, following the simulation's time, with the timeline for replay once history exists (overview section 6, "Later").

## 6. Goal G4: elevation and imagery

The "melted chocolate" look is imagery draped over an elevation grid: CesiumJS, MapLibre and three.js all do it. The hard part is data that works offline.

| Data | Use | Licence, as far as known (to be checked) | Shipped needs |
|---|---|---|---|
| SRTM (NASA) | Land elevation, 30 or 90 m, between about 60° S and 60° N | Public domain | A CR, like CR-0009 for Natural Earth |
| GMTED2010 (USGS) | Coarse global land elevation | Public domain | A CR |
| GEBCO grid | Global elevation including the seabed | Public domain, with attribution asked | A CR |
| Copernicus DEM GLO-30 / GLO-90 | Better land elevation, worldwide | Its own free licence, with attribution | A CR for the licence |
| NASA Blue Marble | Global imagery, coarse | Public domain | A CR |
| Landsat | Imagery, 15 to 30 m | Public domain | A CR |
| Sentinel-2 cloudless (EOX) | Imagery, about 10 m | CC BY 4.0 for some years, non-commercial for others | A CR, and a choice of year |

- **Size:** detailed elevation and imagery of the whole world is far too large for a release. A realistic set-up ships coarse global data, like Natural Earth today, and takes detailed elevation and imagery for the area of operations from the deployment's own servers. For imagery those are the WMS servers of ADR-0035. For elevation it is a terrain tile server, or a WCS server, through a plugin.
- **Polar areas:** SRTM stops at about 60° N and S, so the poles need GMTED2010, GEBCO or regional models (e.g. ArcticDEM, REMA, whose licences are to be checked).
- **Tools:** turning elevation grids into terrain tiles needs a tiler (quantized-mesh or heightmap). Open-source tilers exist, and their licences are dev-only questions (CR-0001), since only the tiles ship.
- **Photogrammetric 3D Tiles** (buildings, true 3D terrain) look sharper than draped imagery, but need data the deployment provides. CesiumJS shows them; that would be a later step.

## 7. Spike S7 (when a milestone takes it up)

Question: can CesiumJS, as a `map-view-3d` plugin, meet the four goals offline, at emc2's object count? Pass marks, with a GPU client:

1. 100 000 symbols, 1 000 of them moving once per second, and 50 air corridors with floors and ceilings, at a usable frame rate, with the main thread's tasks under 100 ms.
2. Views over the North Pole, the South Pole and across the antimeridian, without gaps or jumps.
3. Terrain and imagery fully offline, served by the emc2 server, with no request beyond it (ADR-0030; Cesium ion switched off).
4. Imagery from the ESA's GeoServer by WMS (EPSG:4326), draped over terrain.
5. Coordinate order and heights tested with a point where latitude ≠ longitude, and a height above mean sea level converted where the geoid is far from zero.
6. The package's size, licence and notices checked, as for mil-sym-ts in spike S1.
7. The same marks measured for option B, as the fallback.

## 8. Questions for the owner, when a milestone takes it up

1. **The option:** A, CesiumJS (recommended), after spike S7, or B, if polar 3D can wait.
2. **Where the 3D view lives:** a workspace of its own (recommended), a 2D/3D switch, or a second window.
3. **The first version:** view and select only (recommended), or also placing and drawing in 3D.
4. **Vertical extents:** which references airspace shapes need (above mean sea level and flight levels are common in airspace orders), and whether the data model takes them in one CR.
5. **Shipped data:** coarse global elevation and imagery in the release (which sets), or none, with everything from the deployment's servers.
6. **G3:** DIS first, or HLA directly, and which RTI to test against.

## 9. Effort, roughly

To be estimated again after the spike. As a first view, about the size of a milestone:
- **CRs and briefs:** a data model CR for vertical extents, an SDK CR for terrain and the 3D view's place in `MapView`, and the briefs (PDA);
- **the live picture's 3D area of interest** (CDA);
- **`map-view-3d`** (a new PCA);
- **a terrain provider plugin** and the offline data, with their CRs (a new PCA, MCA, ESA);
- **the ITA's flows.**

The HLA or DIS plugin (G3) comes on top, in its own milestone or with the simulator's next steps.
