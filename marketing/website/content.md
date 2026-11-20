# Website copy (shared by every design)

The text that every design of the emcc website uses (owner, 2026-11-12: the page is about emcc's concepts, parts and workspaces; one short section on how it was built, Q7 A). A design may shorten, reorder or split it, but adds no claims of its own. Every statement here is checked against the repository and the M6 release; the sources are in brackets and are not shown on the page.

Product name: **emcc**, always lower case. English. No owner name, no contact address, no download link.

## Hero

- **Title:** emcc. Extensible Modular Command and Control – a lightweight C2 (and simulation) system. (Owner, 2026-11-19; before: "A command and control picture for the browser.")
- **Line:** A shared live map for units, tactical graphics and tracks, with links to other systems and a simulator; extend the functionality with plugins. (Owner, 2026-11-19: "and extend the functionality with plugins" for "and a plugin for everything".)
- **Mock-up tag:** Mock-up · demonstration system
- **One line on how it was built:** Built by Claude Code agents, with humans as architects making every decision (owner, 2026-11-19; before: "with one human making every decision"). (No "in 41 days": the owner, 2026-11-12, found it boastful and it dates quickly.)
- **Picture:** `view-light.jpg` / `view-dark.jpg` (by the reader's light or dark). Caption: The View workspace of the M8 release, with a made-up exercise on Natural Earth's map of Gotland. Every unit, name and position is fictional.

## Highlights (owner, 2026-11-12; the third slide 2026-11-16; the fourth 2026-11-18; M8 and M9 screenshots)

A card of its own **before** "The four workspaces" card, at the start of the route. Four pictures slide sideways by themselves (pure CSS, 8 s each: 7 s shown, 1 s sliding; a round of 32 s), pause on hover and keyboard focus, have dots to choose one (the sliding stops once the reader picks), stay still with reduced motion, and open at full size like the other screenshots. More slides may follow.

1. **Ground moving target radar.** "A simulated ground radar on an aircraft looks to its right: its coverage is the arc between two bearings. Dwell by dwell it reports the vehicles it sees in STANAG 4607, and emcc’s GMTI link draws them back as dwell areas and detections. Every name and position is fictional." [manual 3.17 "Trying it without a radar" and 4.4 Sensors; simulator README, functions 33 and 37] Picture: `gmti.jpg` (M7 RC2, `assets/src/gmti-scene.mjs`): bearings 60° to 120°, 10 to 50 km, custom dwells; the Simulation layer hidden in that browser and the layer "GMTI in" shown, so the detections are not under the tracks; pairing lines and names off in Display settings.
2. **Security labels by design.** "Every object and layer carries a STANAG 4774 security label, by design since the first data model. The label designer in Settings prepares premade labels per policy; using them to control access comes later." [ADR-0007; manual 5.22 Labeling, T-170; the RC2 page itself says "In this version the labels are not offered anywhere else yet"] No policy named in the text (owner: leave out SWE). Picture: `labeling.jpg`: Settings › Labeling, the NATO policy with `scene.mjs`'s premade labels and the New label form's preview, the SWE policy folded.
3. **Full motion video** (owner, 2026-11-16: a third slide). "STANAG 4609 video comes in over UDP: the camera and its field of view on the map, and the stream in a window with its classification. MPEG-2 video is converted to H.264 on the server. The video shown is our own test stream, a simulated camera over public-domain height data. From M9, emcc's own UAV simulator sends such video too." [fmv README; ADR-0057; uav-simulation README] Picture: `fmv.jpg`, M8 RC2: the fmv link "Demo UAV" (`assets/src/fmv-scene.mjs`) receiving **our own stream** (owner, 2026-11-16: the S9 sample recordings have no licence, so none of their frames is shown): spike S10's `LiveSender` (run unchanged) renders a camera flying `assets/src/fmv/route.json` over a grey texture that `assets/src/fmv/FmvTexture.java` draws from the release's Sundsvall SRTM heights (public domain; hillshade, water, seeded noise), encoded by S9's LGPL ffmpeg with `h264_mf`. The camera name "SIM-UAV-1" is LiveSender's.
4. **A UAV simulator** (owner, 2026-11-18: "now that it is in M9", a slide of its own; M9 released 19 November 2026). "Put a camera on a track in the Simulation workspace, point it at a place, an object, a fixed angle or a sweep, and emcc makes live video from it: drawn from orthophotos and height data that you add, with the metadata a real camera sends, and sent out as STANAG 4609 to any receiver, emcc itself included. Here a simulated UAV circles Sundsvall's harbour; the orthophotos are Lantmäteriet's of 2001." [manual 4.6 A simulated camera, 5.24 FMV output links; uav-simulation and fmv READMEs; ADR-0058, ADR-0059] Picture: `uav.jpg`, **the M9 release** (`emcc-M9-2026-11-19-0575b37d`, the same app as the final build; first taken from M9 RC1), the release's own video (owner, 2026-11-18: View + video, orthophotos): `assets/src/uav-scene.mjs` puts the friendly UAV track "UAV 1" on a 4 km orbit round the harbour at 2 500 m in Simulation, a uav-simulation camera on it (Track a point, the harbour, 30°), the fmv output link "UAV out" and the input link "UAV 1 video" on loopback 15610. The release draws the video from the ESA's Sundsvall demo heights (SRTM, public domain; not part of the public release, owner ADH, 2026-11-19, so the copy says "height data that you add") and an imagery set of **Lantmäteriet's historical orthophotos of 2001** (OI.Histortho_bw_2001, CC0; fetched by the owner for spike S10, kept outside the repository), put in `settings/imagery/` by hand. View in the dark look: the video window, the camera and its field of view, the FMV panel.

## The four workspaces

The tabs across the top of emcc. View and Simulation are workspaces with a map and panels; Settings and Monitor are pages for administrators. Users only see the tabs they may use. [manual 2.0]

### View: the shared picture
Picture: `view-light.jpg`, `view-select.jpg` (a unit selected, its properties on the right).
- The map in the middle, with panels in the panes around it: Symbols, Shapes, Graphics, Symbol properties, Terrain, Status, Objects and Layers.
- Place APP-6 symbols, draw shapes and tactical graphics, and organise them in layers.
- What one user changes, everyone sees at once.
- Select, move, edit, copy or delete objects on the map or in the Objects list.

### Simulation: a second map that moves
Picture: `simulation.jpg` (three routes running: a hostile air raid, a friendly patrol, a ship convoy).
- Draw routes and put units on them one by one, as a convoy or in a formation.
- Give each point a speed or a time, an altitude, and events that change a unit's fields or hide it.
- Add ground radar sensors that report what they detect.
- Put a simulated camera on a track, as on a UAV: emcc draws its live video from orthophotos and height data that you add, and sends it out as STANAG 4609 full motion video (owner, 2026-11-18; M9; "that you add": not part of the public release, owner ADH, 2026-11-19) [manual 4.6].
- Start, pause and reset each route or all of them, and send the tracks to other systems as if they were real.
- Kept apart from View, with its own layers and its own permissions: to see, to edit and to run.
[manual 4.0; simulator README]

### Settings: everything in one list
Picture: `settings.jpg` (the Cursor on Target entry).
- General settings, display, data types, layers and labeling, and one entry for each plugin with settings, grouped by kind: data links, maps and symbols, drawing, simulation. [manual 5.0; categories from M7, T-174]
- Changes apply at once, without a reload. The server checks every value.
[manual 5.0; README.txt of the release]

### Monitor: how it is doing
Picture: `monitor.jpg`.
- The core and every plugin, updated every 2 seconds: state, workers, messages per second, queues, connections.
- A worker that fails or hangs is restarted by the server and counted.
- Plain about limits: it says when the map is drawn without a GPU.
[manual 6.0]

## The ideas behind it

Each in one or two sentences.

- **A live picture, shared.** The server holds the master copy of every layer and object. Every browser shows the part its user looks at, and every change reaches everyone who needs it. [manual 1.0]
- **Change requests.** Objects change only through change requests to the server, which checks each one against the user's permissions. The browser only hides what a user may not do. [CLAUDE.md 4; overview 4.4]
- **Layers and security labels.** Every object is in a layer. Layers are drawn in order, and can be shown, hidden and locked. Every layer and object carries a security label after STANAG 4774. [manual 1.0]
- **Data types and data sources.** An object's data type (General, CoT, AIS vessel, ADS-B aircraft, Route) decides how long it stays current. Its data source says where it came from: placed by hand, or the name of a link. [manual 1.0]
- **Field sets.** Plugins add their own fields to objects, such as a CoT unit's team or an AIS ship's details, and pass on every field they do not understand. [manual 1.0; CLAUDE.md 4]
- **Symbols, shapes and tactical graphics.** APP-6 unit symbols and vessels; circles, ellipses, rectangles, polygons, arrows and routes with hatched fills and arrowheads; boundaries, phase lines, axes of advance, objectives, minefields and more. [release README.txt]
- **Links to other systems.** Cursor on Target (CoT) in and out; ships from AIS; aircraft from ADS-B; ground moving target radar data in STANAG 4607 format, in and out; NATO Vector Graphics (NVG), in and out; full motion video in STANAG 4609, in (from M8) and out (from M9) [nvg, fmv and uav-simulation READMEs]. Background maps from Natural Earth, OpenStreetMap or WMS servers. [release README.txt; manual 1.0]
- **Maps in any projection.** Web Mercator, and polar maps of the Arctic (EPSG:3413) and the Antarctic (EPSG:3031). [release README.txt] An ordinary card without a picture (owner, 2026-11-12); `arctic.jpg` stays in `assets/screenshots/` but is no longer on the page.
- **Positions.** Always WGS84. Shown and typed as degrees, minutes and seconds, decimal degrees, UTM/UPS or MGRS, polar regions included. [manual 1.0]
- **Terrain.** The wide card, with `terrain.jpg` (owner, 2026-11-12): "Range and bearing between two points, the ground an observer can see, and a height map: the ground inside a circle in 16 colour bands, with its highest point marked. From DTED height data that you add." [manual 3.13 Terrain] The picture: the ESA's Sundsvall demo height data (`emcc-demo-height-data-sundsvall-2026-11-10.zip`, made for the release candidates and unpacked into the emcc folder by hand; not part of the public release, owner ADH, 2026-11-19), a circle of 18 km west of Sundsvall, its highest point 502 m.
- **Your own workspace.** Movable panels, saved setups, bookmarks, three looks (Night Watch, Chart Room, Signal) in light or dark, and display settings for symbol size, labels and speed vectors. They follow the user to another computer. [manual 2.0; release README.txt]
- **Login and permissions.** Login through OpenID Connect, with groups that decide what each user may see and do; or a no-login mode for demonstrations. [readme; requirements]
- **Works without internet.** The browser talks only to the emcc server, and Natural Earth maps ship with it. Online maps are optional. [CLAUDE.md 4; ADR-0030]

## Standards (owner, 2026-11-12; D3b's waypoint after WP 4)

What emcc reads, writes and follows; named only to say that, emcc is not certified against any of them. Each with a tag: In, Out, Core, Planned or Mock.

- **Data links:** Cursor on Target (CoT), in and out [cot README] (MIL-STD-2525C is not named: owner, 2026-11-12); AIS (NMEA 0183 AIVDM), in [ais README]; ADS-B (SBS-1 BaseStation stream, TCP 30003), in [adsb README; **not ASTERIX**, which emcc does not read]; STANAG 4607 (GMTI, AEDP-4607 Edition A), in and out [gmti README]; NVG 2.0, in and out: files and NVG web services [ADR-0055; docs/plugins/briefs/nvg.md, approved 2026-11-11]. Shown as released, with M7 (owner, 2026-11-12; see Status).
- **Video:** STANAG 4609 (FMV), in and out: in, H.264, H.265 or MPEG-2 video with MISB ST 0601 metadata in a transport stream over UDP; MPEG-2 converted to H.264 on the server (ECore's conversion service, ADR-0057, CR-0045). Out: the H.264 video of the UAV simulator's cameras (M9) [fmv README, output links; manual 5.24]. On the page it is a row of the Data links group.
- **Maps and positions:** WMS 1.3.0 and 1.1.1 [basemap-wms README]; WGS84; MGRS, UTM/UPS, DMS; EPSG:3857, 3413, 3031; DTED height data [terrain README].
- **Symbols:** APP-6 (D) and (E): unit symbols drawn through Spatial Illusions' milsymbol (MIT, 3.0.4); tactical graphics in APP-6 D and E too, drawn by mil-sym-ts [symbology README; milsymbol's package.json].
- **Security:** STANAG 4774 (ADatP-4774) labels on every layer and object, and Labeling in Settings [model README, T-170]; STANAG 4778 binding **a mock for now** (`LabelBinder`; the real one later, overview 4.9 and 6); OpenID Connect login, the Keycloak integration [ADR-0012, ADR-0022].

## Thank you, Spatial Illusions (owner, 2026-11-12; at the bottom of the page)

Every APP-6 unit symbol in emcc, and in the screenshots, is drawn by milsymbol, the open-source (MIT) symbol library from Spatial Illusions; it made APP-6 D and E symbols possible from emcc's first demo on (symbology is an M0 plugin). Link: https://spatialillusions.com/ (the author's address in milsymbol's `package.json`). Text and link only, no logo (`agents/dma.md` rule 6). Tactical graphics come from mil-sym-ts, not from Spatial Illusions, so the shout-out names unit symbols only.

## The parts

How emcc is put together. [overview 2 and 3]

- **In the browser:** the web shell (top bar, workspaces, panes and panels, looks, login) and the web parts of the plugins. TypeScript; the map is drawn with OpenLayers and WebGL.
- **On the server:** one Java 25 process.
  - A thin Spring Boot edge: HTTP, the WebSocket of the live picture, login.
  - **ECore**, the core: the plugin host, the worker runtime with its watchdog, the message bus, the object store, the live picture gateway, the persistence manager, the video streams and their conversion (M8, ADR-0057), security, settings, logging and metrics.
  - The server parts of the plugins.
- **Outside:** the systems emcc talks to: TAK systems over CoT, NVG systems, video from UAVs, AIS and ADS-B receivers, ground radars, WMS map servers, and the Keycloak integration for login (owner, 2026-11-12).
- **Plugins:** everything beyond the core is one of 21 plugins (with nvg, M7, fmv, M8, and uav-simulation, M9; the M9 release has 21 in `plugins/`), each with a server part, a web part or both, built on a Java and a TypeScript SDK. Plugins never create threads: ECore runs their workers, connection tasks and timers, and reports any that hang. [CLAUDE.md 4; overview 4.2]
  - Maps: 2D map view, Natural Earth background, OpenStreetMap background, WMS background maps
  - Drawing: Draw symbols, Draw shapes, Draw tactical graphics, Symbology
  - Organising: Layers, Objects, Bookmarks, Coordinates
  - Links: Cursor on Target, AIS, ADS-B aircraft, GMTI, NVG
  - Analysis and training: Terrain, Simulator

## The plugins, one by one (D3b's pop-overs; owner, 2026-11-12)

Two to five sentences each, from each plugin's `README.md`, and the line "Built and kept by its own agent, PCA-<plugin-id>."

- **2D map view** (`map-view-2d`): The map in the middle of every workspace, drawn with OpenLayers and WebGL. It pans and zooms, draws symbols, shapes and graphics, selects and drags them, and shows clusters when zoomed out over many objects. It switches between Web Mercator and the polar projections.
- **Natural Earth background** (`basemap-naturalearth`): An offline background map in every projection, polar ones included. Land, lakes, coastlines, ice shelves and borders from Natural Earth 1:50m, muted so that the symbols stand out. It ships with emcc and needs no internet.
- **OpenStreetMap background** (`basemap-osm`): OpenStreetMap tiles in Web Mercator, for development and demonstrations. The emcc server fetches the tiles, so the browser talks to no other host. Disconnected installations use WMS servers instead.
- **WMS background maps** (`basemap-wms`): Background maps from WMS servers, polar projections included. The server part reads each server's capabilities and passes checked map requests on. A background is offered only in the projections that its server offers.
- **Draw symbols** (`draw-symbols`): Place, edit and move APP-6 unit symbols and vessels. The Symbols panel chooses and places them; Symbol properties edits the selected symbol, including the field sets that other plugins add.
- **Draw shapes** (`draw-shapes`): Draw circles, ellipses, squares, rectangles, areas, arrows and routes, and edit them later. Each shape has a style, a name and a data type, with hatched fills and arrowheads where they fit.
- **Draw tactical graphics** (`draw-tactical`): Place APP-6 tactical graphics: boundaries, phase lines, axes of advance, areas, fire support areas, range fans and more. Choose the identity, the status and the echelon, from a short list of common graphics or the whole catalogue.
- **Symbology** (`symbology`): The one place where APP-6 symbols are understood and drawn, for every other plugin. Unit symbols are drawn with milsymbol, and tactical graphics with mil-sym-ts in a Web Worker.
- **Layers** (`layer-panel`): The layer list: show, hide, lock and reorder layers, and give each its classification. It lists the layers of the workspace shown.
- **Objects** (`object-list`): The objects of one layer as a list, page by page, also for a layer that is hidden on the map. Its rows share the map's selection and its actions.
- **Bookmarks** (`bookmarks`): Saved map views in a folder tree: the projection, the background, the centre and the zoom, back in one click. They are each user's own and follow the user to any browser.
- **Coordinates** (`coordinates`): Positions shown and typed as decimal degrees, degrees, minutes and seconds, UTM/UPS and MGRS. Everything inside emcc stays WGS84 longitude and latitude; only what the user sees and types changes. Other plugins use its service.
- **Cursor on Target** (`cot`): Receives CoT from TAK systems and shows it on the shared map, and sends the objects of chosen layers to them. Its links run over TCP or TLS, UDP and multicast, and the simulator sends its tracks through them too.
- **AIS** (`ais`): Ships from AIS receivers, as NMEA 0183 sentences over UDP or TCP. It keeps one symbol per ship at its last position, with its name, course and speed. Input only.
- **ADS-B aircraft** (`adsb`): Aircraft from an ADS-B decoder's SBS-1 stream on TCP port 30003. It keeps one symbol per aircraft at its last position, with its callsign, track and ground speed. Input only.
- **GMTI** (`gmti`): Ground moving target radar data in STANAG 4607, in and out. Incoming data shows the radar platform, its coverage and its detections on the map; the simulator's sensors send their reports in the same format.
- **FMV** (`fmv`): Full motion video in STANAG 4609, over UDP. It shows each camera as a symbol and its field of view as an arc on the map, lists the streams in the FMV panel and plays them in a window with their classification. MPEG-2 video is converted to H.264 by the server; H.264 and H.265 pass unchanged. Its output links draw the video of the UAV simulator's cameras and send it.
- **Terrain** (`terrain`): Range and bearing between two points, and a viewshed: the ground that an observer can see, from DTED height data that you add. Range and bearing need no height data.
- **Simulator** (`simulator`): The Simulation workspace: routes with speeds, altitudes and events, convoys and formations, and ground radar sensors. The server moves the tracks once a second, even with no browser open, and sends them out through the links.
- **UAV simulation** (`uav-simulation`, M9): Simulated cameras on the tracks of the Simulation workspace, as on a UAV, in the Cameras panel: each tracks a point or an object, holds fixed angles or sweeps a sector. For every frame it works out where the camera is and where it looks, and an FMV output link turns that into video. [uav-simulation README] In the group Analysis and training, after Simulator.

## The milestones (D3b's status timeline; owner, 2026-11-12; M8 and M9 2026-11-16; M9 released and no M10, 2026-11-18)

M9 is shown first: released on 19 November 2026 (owner, 2026-11-19; the MCA: "M9 is approved and released today"). The builds refuse a placeholder such as `__M9_DATE__`, which held the date until then. Before, M8 was shown first and M9 marked as planned. [M0 to M5: `docs/architecture/overview.md` section 6 and `docs/status.md`; M6: `docs/status.md` and `docs/handover/uda.md`; M7: `docs/architecture/m7-plan.md` and `docs/status.md`, "Milestone M7"; M8: `docs/status.md`, "Milestone M8"; M9: `docs/architecture/m9-plan.md`]

- **M0 · Internal demo** (Released 10 October 2026): A shared live map in the browser, without login; OpenStreetMap as the background map; APP-6 symbols placed on the map; Layers with a draw order; Positions in MGRS, UTM and degrees, minutes and seconds; The core: plugin host, workers, message bus and object store.
- **M1 · First demo** (Released 14 October 2026): Login with Keycloak, and a no-login mode for demonstrations; Permissions checked by the server; Natural Earth maps offline, in every projection, the Arctic included; Two browsers on one live picture; CoT from TAK systems shown on the map; Clusters when zoomed out over many objects; The Settings and Monitor tabs.
- **M2 · Beautify** (Released 22 October 2026): Docked panes with movable panels, and saved setups; Three looks in light and dark, with two densities; Selection, object and map actions, and a shared Delete; Plain shapes with hatched fills and arrowheads; Bookmarks in a folder tree; The Objects list: a layer's objects, page by page; Settings as one list.
- **M3 · Simulator** (Released 30 October 2026): The Simulation workspace, with its own layers and permissions; Routes with speeds, altitudes and events; Convoys and formations; CoT out as well as in: simulated tracks sent to TAK systems; Plugins' own connections, run as connection tasks; Plugins' own fields on objects.
- **M4 · Maps, links and locks** (Released 3 November 2026): WMS background maps, polar ones included; Ships from AIS and aircraft from ADS-B; Layer locks, enforced by the server; Plugins' own settings panels; Right-click menus on the map, and dragging a selected shape; More symbols in every category.
- **M5 · Graphics, radar and terrain** (Released 10 November 2026): APP-6 tactical graphics: boundaries, phase lines, axes, areas; GMTI radar data in STANAG 4607, in and out, and a GMTI sensor in the simulator; Terrain: range and bearing, and viewsheds from DTED; Scenarios in the simulator, exported and imported; Field sets and vessel symbols; Display settings per user: symbol size, labels, speed vectors; The name emcc, and the user manual in the release.
- **M6 · Refinements** (Released 11 November 2026): Pictures inside tactical graphics, such as minefields; A Labeling entry in Settings; Move to layer and Copy to layer; A new-layer box with the layer's classification; A ground radar sensor with presets, dwells and a job area; A mark for sensor reports, and data types that bring their field sets.
- **M7 · The first release for outside users** (Released 13 November 2026: RC3 `c2d7dc9e` approved by the owner, docs/status.md): NVG in and out; A Scenario button in the top bar; Symbol palettes, one of them for CoT; Categories in the Settings list; Listing and emptying a layer; Adding points to the end of a line; A height map in Terrain, and better sensors. [checked in RC2 and its manual: 3.18 NVG, the Scenario button and the palettes in the pictures, 5.4 Layers "Delete all objects" (T-175), 3.11 Shapes "Append", 3.13 Terrain, 4.4 Sensors]
- **M8 · Full motion video and a new look** (Released 16 November 2026: RC2 `ab29d8f7`, "RC2 looks good", docs/status.md): Full motion video in STANAG 4609, with the camera and its field of view on the map; MPEG-2 video converted to H.264 on the server; A new look for every workspace, and Settings as tables with one Save (the UXA's design, T-198, T-203); Symbol labels set by place round a symbol (T-163); A Systematic scan for ground radars, and dwells at the rate their settings ask (T-197, T-196); New default colours for dwells, sensor ranges and job areas (T-189); Bug fixes, among them vessel symbols that no longer flicker (T-200).
- **M9 · Ready for others to try and extend** (Released 19 November 2026; checked against the release `emcc-M9-2026-11-19-0575b37d`) [docs/architecture/m9-plan.md; docs/status.md, "Milestone M9"]: HTTPS on the server, and TLS certificates kept apart from the links (ADR-0061, ADR-0062); Settings and credentials in files of their own (ADR-0060); emcc as a Windows service (ADR-0063); An admin guide for existing infrastructure (G1); A plugin template, a developer cookbook and instructions for AI agents (D3, D5, `docs/plugins/for-agents.md`); A help menu, "?", with the manual and the version (M9-R17; the "?" at the top bar's right in the release); A start without login by a double-click: start_standalone.bat (the release's `start_standalone.bat`, "the same as start.bat -standalone"); A UAV simulator whose cameras send STANAG 4609 full motion video, drawn from orthophotos and height data that you add (ADR-0058, ADR-0059, `uav-simulation`; not part of the public release, owner ADH, 2026-11-19). No note about M10 (owner, 2026-11-18: remove mentions of M10).

## Built by AI agents (one short section)

emcc is an experiment in running a software project with AI agents as the team. Claude Code agents in 12 roles (an architect, a core developer, a plugin designer, one coder per plugin, an integration tester, a manager, reviewers, a service agent, a user-experience designer and writers; the UXA from 2026-11-13) wrote almost all of the code, the tests and the documents. Humans as architects wrote the requirements and made every decision (owner, 2026-11-19, to match the hero; before: "One human owner wrote the requirements and made every decision"). The agents work only through files in git, each in its own part of the repository.

No counts of tokens, commits, ADRs or change requests (owner, 2026-11-19: take them out, on the site and in the readme; before, they were counted on 17 November 2026). No day count (owner, 2026-11-12).

## Status

- Released: M9, 19 November 2026 (ten releases since 10 October: M0 to M9).
- Manual: a user manual of 74 chapters comes with the release [the M9 release's `manual/`, 74 numbered chapter pages: RC1's 73 and "UAV simulation"; the final build changes only the manual, so recount if it differs].
- Source: "The source code is published on GitHub." (owner, 2026-11-18: "under source just mention that source code is published on GitHub"; true once the repository is public, before the site goes up). No Next or Later line (owner, 2026-11-18: no M10).

## Footer

- **emcc is a demonstration.** It is not an operational system, it does not protect classified information, and it is not certified for any use. It is not affiliated with or endorsed by NATO, any armed force or any company. Standards are named only to say what emcc reads and writes.
- The pictures show the real user interface of the M8 and M9 releases, with a fictional scenario; the video in the FMV picture is our own test stream, rendered from public-domain height data, and the UAV picture's video is drawn by emcc from Lantmäteriet's historical orthophotos of 2001 (CC0). Map data: Made with Natural Earth (public domain). emcc is licensed under the Apache License 2.0.
- This site sets no cookies, runs no scripts and loads nothing from other servers.
- **The sources** (owner, 2026-11-19: a disclaimer at the end of the page and of the readme). "No classified STANAGs or specifications were used to make emcc, and no document marked NATO UNCLASSIFIED: only unmarked or public documents. Most of them were downloaded from NATO's NSDD, the NATO Standardization Document Database, or from other publicly available sources."

## Pictures

In `img/` next to the page, each 1600 × 900 JPEG (about 120–175 KB), from M8 RC2 (`emcc-M8-RC2-2026-11-16-ab29d8f7`, the UXA's new look): `view-dark.jpg` (the hero), `view-select.jpg`, `simulation.jpg` (dark look), `settings.jpg`, `monitor.jpg` (dark look), `gmti.jpg`, `labeling.jpg` and `fmv.jpg` (Highlights, dark look), `terrain.jpg` (dark look); `uav.jpg` (Highlights, dark look) from the M9 release (`emcc-M9-2026-11-19-0575b37d`); and `emcc-logo.svg`. The build copies only the pictures the page uses; `view-light.jpg` is the root readme's, and `arctic.jpg` is kept for later use.
