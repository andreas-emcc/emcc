# M10 plan: the UAV camera made real, settings that move, and what is left from M9

- **Status:** **approved** by the owner (2026-11-23, through the MCA). The owner answered Q1 to Q15 as the ACA recommended (section 5's last column, AES to AFG). Two changes came with the answers:
  - the mass test's phase 4 waits for M10's video items, and the ground truth's position after a pause is PCA-simulator's (T5 and N8; owner AER B and AEQ);
  - the PDA writes the public agent setup (D5) after a later session of the owner's with the ACA on a better plugin template, and D5 follows what that session decides.

  The ADRs and the CR the answers lead to are in section 6.
- **The list** is the board's "Milestone M10 – planned" (`docs/status.md`), as **the owner trimmed it on 2026-11-23**:
  - **to M11:** Linux (M9's L1), PostgreSQL/PostGIS with spike S8 (L2), and three `fmv` WMS items: the faster fetch, EPSG:3857 and the cache's size as a setting;
  - **kept in M10:** GetCapabilities for an `fmv` WMS source, and the fixed WMS cache limit raised from 900 to 9000 tiles.

  This plan does not plan the M11 items.
- **The theme:** the simulated UAV camera made real enough to train with (its presets, its realism, its field of view on the map, a video window of its own), the settings moved from one installation to another, OpenTelemetry, GeoTIFF, an HLA spike, the agent setup for outside plugin developers, and M9's carried items.
- **The contracts:** **SDK and data model 1.10.0**, one CR by the PDA, with only what M10's items need (section 4). No object or layer schema changes.
- **The integration branch:** as in M9, `integration/sdk-v1.10` from `main`. Every M10 branch merges there, and `main` gets it at M10's end (the MCA's procedure).

## 1. Decisions this plan makes

Each row is a decision the plan makes, with the question the owner answered (section 5). The ADRs follow the answers (section 6).

| # | Point | The ACA's proposal | Question |
|---|---|---|---|
| 1 | **Settings export and import** | One JSON file with a format version, the emcc version and each plugin's version. It holds **what an admin has set**, not the defaults, for ECore's General and Data types entries and for every plugin's settings. Layers are data, not settings, so the Layers entry is not in it. **No secret is in the file**, since no secret is a setting: a setting names a credential, and the credential lives in `settings/credentials/` (ADR-0060). The import names the credentials and layers that the settings refer to and this installation lacks. **The unit** is one top-level setting of a plugin or ECore (a list of links counts as one setting), applied whole or skipped whole. Each plugin gets its complete new settings once. **No SDK hook:** ECore already checks each plugin's settings against its manifest's schema, and plugins receive changes through `subscribeSettings`. Both calls need `settings.admin`, checked on the server. ADR-0065 | Q1, Q2 |
| 2 | **What "skipped" tells the admin** | A list with one line per skipped setting: where it is (General, Data types, or a plugin id), the setting's name, and why. The reasons are: the plugin is not installed, the setting is unknown, the value is invalid (with the schema's message), or the server refused it. Warnings follow, for the missing credentials and layers. The shell shows the list after the import, and the server log has it too. A file with a newer format version is refused whole. ADR-0065 | Q2 |
| 3 | **GeoTIFF**, one reader for `terrain`'s height data (M9's L4) and `fmv`'s imagery | **An SDK addition in 1.10.0:** a GeoTIFF reader in the Java SDK. It reads a file from a declared folder (ADR-0049) with the JDK's ImageIO TIFF reader (`java.desktop`, already in the release runtime), with no new dependency and no GeoTools. It gives the raster by region, its georeference and its CRS, and converts between pixels and WGS84 (longitude, latitude) for EPSG:4326 and EPSG:3006. Rotated rasters and other CRSs are refused with a message the plugin shows. Classic TIFF only, as ImageIO reads it, so no BigTIFF. ImageIO's disk cache is off, so the reader does no file I/O of its own. The test kit serves test files, and the reader's own tests convert a point where latitude ≠ longitude in both CRSs | Q3 |
| 4 | **`fmv`'s presets** | **A settings hint in 1.10.0** (`x-emc2.presets`): named sets of values for a group of fields. Choosing one in the generated form fills those fields, and **Custom** shows them one by one. The form shows the preset whose values match, or Custom. No preset is stored, and `fmv`'s server part reads the fields as today | Q4 |
| 5 | **The WMS source's settings** (GetCapabilities, the tile count, the error) | **A settings field the plugin draws**, in 1.10.0 (gap G9's "M" fix): a plugin's web part draws one field of its own inside the generated form. The field gets its value, the other fields' values and its own endpoints. `fmv` draws its WMS source's capabilities button, the layer and format lists, the tile count and the reason a source does not work. A settings panel of its own (SDK 1.3.0, `setSettingsPanel`) would replace `fmv`'s whole generated form, its links and cameras' many fields included, for the sake of one group. The camera shows the same reason through its channel's state (SDK 1.9.0, G11), with no SDK change | – (in Q5) |
| 6 | **L7's gaps** | 1.10.0 takes only those with a user in M10: **G9**'s two field kinds (points 4 and 5), **G27** (a query and subscription by object ids, for `uav-simulation`'s platform and target), and a note that map pane overlays are hidden in Settings and Monitor (point 10). G4, G6, G8, G10, G12 to G18, G21 to G23 and G26 stay later, **each through its own CR** when a plugin needs it | Q5 |
| 7 | **The HLA 1516 spike** | **Spike S11, the ACA's** (as S9 was), in `spikes/s11-hla/`, against an RTI the ESA runs as an external test service (section 7) | Q6 |
| 8 | **Micro sway** | **In `uav-simulation`**, because it sends one pose per frame (its brief). The sway is added to the pose's yaw, pitch and roll before the pose is sent. `fmv` writes ST 0601's sensor angles from the pose, so the KLV includes the sway, as the owner decided, and so does the field of view (point 9). `fmv` changes nothing for it. Its settings are kept per camera. ADR-0066 | Q7 |
| 9 | **The camera's field of view on the map** | **A map overlay drawn by `uav-simulation`'s web part** in Simulation, as the simulator draws its coverage (SDK 1.4.0's `area` and `line`; not objects, not stored, not sent to any output). It draws the footprint (four rays from the pose to the ground) and the line of sight, from the latest pose, sway included. Its ground is **flat at 0 m HAE**, which is `fmv`'s ground where it has no height data (O5). Not the terrain in M10. ADR-0066 | Q8 |
| 10 | **The video window in Settings and Monitor** | **The shell hides every map pane overlay while Settings or Monitor is shown**, and keeps it mounted, so the video plays on and comes back where it was. This is the CDA's, with no SDK member; the SDK's `addMapPaneOverlay` gets a sentence saying so. `fmv` changes nothing | Q9 |
| 11 | **The video pop-out** | **`fmv` alone:** its web part opens a browser window of the same origin and renders the video into it from the main window (a portal), with the shell's style sheets copied in. The stream stays the main window's. Closing or reloading the main window closes the pop-out. No shell or SDK change | Q10 |
| 12 | **The ground radar's name** | **Into the SDK's `ChannelItem.Sensor.name`**, which exists (1 to 64 characters). `gmti` already writes it into `P8`, cut to 10 characters and unique per link. No SDK and no `gmti` change: a radar with a name of its own sends it, and one without keeps today's label. `P8` then names the radar, not the platform | Q11 |
| 13 | **The cameras' export and import** (L6) | **`uav-simulation`'s own file**, from its Cameras panel. Cameras are plugin documents, not settings, so they do not ride on the settings export. The file holds the cameras with their settings (the sway's included) and their platforms and targets by id and name. On import, a camera whose platform is not found in Simulation is kept stopped, with "Platform missing" | Q12 |
| 14 | **The agent setup in the public repository** | **In the plugin template, written for outside developers:** the plugin rules for an agent, a plugin conformance reviewer and two role files (designing and coding one plugin), with no internal decision ids, history or process roles. The internal `agents/`, `.claude/` and `CLAUDE.md` stay private (owner, ADL). The PDA writes it after the owner's later session with the ACA on a better plugin template, and follows what that session decides (owner, 2026-11-23) | Q13 |
| 15 | **EPSG:4326 in an installation's saved projections** | `map-view-2d`'s defaults get EPSG:4326. **A list an admin saved stays as it is**, and the manual says how to add 4326 | Q14 |
| 16 | **OpenTelemetry** (L3) | Within ADR-0013: ECore's metrics per plugin (workers, mailbox depth, messages, handler time, hung events, the connection and compute tasks' counters) over OTLP to an endpoint set in `settings/emcc.properties`. **Off by default**, so it works offline. No plugin API in M10. The CDA writes its design note first; a new ADR only if that note needs a choice ADR-0013 does not make | – |
| 17 | **The realism of the video** (the owner's three points, 2026-11-23) | Recorded in ADR-0066 with points 8 and 9: the degraded camera and the bit errors are `fmv`'s output link settings, so the settings export carries them. The sway is per camera, so the cameras' export carries it | – |
| 18 | **A cut-line** | If M10 runs late, **OpenTelemetry (C6) and the HLA spike (A4) move to M11** first; neither blocks another task | Q15 |

## 2. Tasks

**Task ids:**
- A: the ACA;
- D: the PDA;
- C: the CDA;
- B: the MCA's builds and the public repository;
- F: PCA-fmv;
- V: PCA-uav-simulation;
- N: the other plugins' PCAs;
- T: the ITA;
- E: the ESA;
- G: the UDA;
- U: the UXA;
- S: the SRA;
- W: the DMA;
- O: the owner.

The MCA gives them T-numbers on the board. "Q" names the question a task waits on.

| # | Task | Owner | After |
|---|---|---|---|
| A1 | This plan; the overview's M10 and M11 rows (this branch) | ACA | – |
| A2 | **ADR-0065**, settings export and import (points 1 and 2) | ACA | Q1, Q2 |
| A3 | **ADR-0066**, the simulated camera's realism and its field of view (points 8, 9 and 17). It extends ADR-0058 point 2 and ADR-0059 point 1 and changes neither | ACA | Q7, Q8 |
| A4 | **Spike S11, HLA 1516** (section 7), with its report and, if it finds a way, a proposed ADR for M11 | ACA | Q6, E2 |
| A5 | **Review of D5,** the public agent setup, against `CLAUDE.md` and `agents/pca.md` | ACA | D5 |
| D1 | **The SDK and data model 1.10.0 CR** (section 4): the presets hint, the field a plugin draws, the GeoTIFF reader, G27, and the map pane overlay note. The form's two parts come first in the CR and in the code | PDA | Q3 to Q5 |
| D2 | **1.10.0's code:** the web SDK's form parts first, then the Java GeoTIFF reader with the test kit's files, `ObjectQuery.ids`, and the freeze | PDA | D1 approved |
| D3 | **The briefs** (section 8) | PDA | the answers; D1 for the parts it names |
| D4 | The version step for 1.10.0 in `server/pom.xml` (`CLAUDE.md` section 3) | PDA | D2 frozen |
| D5 | **The public agent setup** in `plugins/_template/` (point 14): the plugin rules for an agent, a plugin conformance reviewer, two role files, linked from the template's readme and `docs/plugins/for-agents.md`. **It follows the owner's later session with the ACA on a better plugin template** (owner, 2026-11-23) | PDA | Q13; that session |
| C1 | **The generated form's two new parts** (D1): the presets, and a field a plugin draws. **First in the CDA's lane:** `fmv`'s presets and WMS field wait on it | CDA | D1 approved; with D2 |
| C2 | **Settings export and import** (ADR-0065): ECore's export and import, two endpoints with `settings.admin`, the Settings workspace's Export and Import, the report | CDA | A2 |
| C3 | **The help menu:** Status as an entry that opens today's content as a pop-over that can be closed, and the Status panel removed; **Licences**, showing the release's third-party notices (as the manual is served, M9-R17) | CDA | – |
| C4 | **Map pane overlays hidden in Settings and Monitor**, kept mounted (point 10) | CDA | Q9 |
| C5 | G27 in ECore's store: a query and a subscription by object ids | CDA | D2 |
| C6 | **OpenTelemetry and OTLP export** (L3, point 16): the design note first, then the code. **Last in the lane**, and the first to move to M11 (Q15) | CDA | – |
| C7 | **The Monitor's `fmv` row** lists every stopped encoder until the plugin restarts (owner, ACW A, finding 3): found with PCA-fmv, fixed by whichever owns the cause | CDA, PCA-fmv | – |
| B1 | **The release:** the third-party notices where the server serves them for C3; the demo height zip's readme, which still says the folder is set by hand (ACW A, finding 4) | MCA | C3 |
| B2 | **The public repository:** D5's files in the public tree; the 1.10.0 version step for the web parts | MCA | D5; D2 frozen |
| F1 | **The fixes:** the first encoder start with a large imagery set (ACS A); the old imagery kept when a camera starts again within about 2 s (ACW A, finding 2); with C7 the Monitor's row | PCA-fmv | – |
| F2 | **Small changes:** an output link without an address sends to 127.0.0.1, and the hint and status say so; a WMS source needs no source or licence (empty strings); the WMS cache holds 9000 tiles | PCA-fmv | – |
| F3 | **A WMS source that does not work says why:** server not reached, HTTP status, a service exception, an unknown layer or format, no imagery for the area. The reason goes into the server log and the channel's state (the camera shows it) | PCA-fmv | – |
| F4 | **The degraded camera:** haze toward grey growing with distance, lower contrast and colour, a light blur or a lower drawing resolution, sensor noise; a checkbox on the output link (ADR-0066) | PCA-fmv | A3 |
| F5 | **Bit errors, drawn** (owner, AFV, 2026-11-23; ADR-0066 point 2 as amended): every 15 ± 3 s, settable and with a seed, runs of 16 × 16 blocks drawn into the picture until the next keyframe. The stream is never damaged | PCA-fmv | A3 |
| F6 | **CR-0055,** the data overlay burned into the frames, switched by the pose's `overlay` | PCA-fmv | D3 (CR-0055's briefs) |
| F7 | **The video pop-out** (point 11) | PCA-fmv | Q10 |
| F8 | **GeoTIFF orthophotos** as an imagery set beside `imagery.json`'s tiles, through the SDK's reader | PCA-fmv | D2's reader |
| F9 | **The WMS source's field** (point 5): GetCapabilities from `fmv`'s server part to the configured server only, the layer list and the format list from the answer, the tile count (downloaded and cached), and F3's reason | PCA-fmv | C1, F3 |
| F10 | **The presets** (point 4): frame size, rate, bitrate, keyframes, sampling, haze; and Custom. **Last in the lane:** they set F4's fields | PCA-fmv | C1, F4 |
| V1 | **The fixes and buttons:** Save refused silently once a camera's target is deleted (ACW A, finding 1); "New camera" in the Cameras panel, as "New sensor"; "Select on map" for Track a point, through `map.pickPoint()` | PCA-uav-simulation | – |
| V2 | **CR-0055's checkbox** per camera, default off, carried in the pose's `overlay` | PCA-uav-simulation | D3 (CR-0055's briefs) |
| V3 | **Micro sway** (point 8), with its settings per camera | PCA-uav-simulation | A3, Q7 |
| V4 | **The field of view** as an overlay in Simulation (point 9) | PCA-uav-simulation | A3, Q8 |
| V5 | **The cameras' export and import** (L6, point 13) | PCA-uav-simulation | Q12 |
| V6 | G27: follow the platform and the target by id instead of keeping a record of every symbol in Simulation | PCA-uav-simulation | C5 |
| N1 | **GeoTIFF height data** (L4) beside DTED, through the SDK's reader, longitude before latitude, tested with a point where latitude ≠ longitude | PCA-terrain | D2's reader |
| N2 | **A ground radar's name** (point 12), in the Sensors panel, the dwells' and reports' labels and the scenario file | PCA-simulator | Q11 |
| N3 | **A moved `gmti` platform stays moved** (owner, ADW A): the race under load | PCA-gmti | – |
| N4 | **gmti's "dwells sent a minute" note** (L5) | PCA-gmti | – |
| N5 | **EPSG:4326** among the default projections; WMS backgrounds in 4326 (latitude first in 1.3.0) and the graticule tested in it | PCA-map-view-2d | Q14 |
| N6 | **nvg's text amplifiers,** written and read in the NVG `modifiers` attribute, for symbols and graphics | PCA-nvg | O1 |
| N7 | **T-129's ATAK phone check** (L5) | PCA-cot | O2 |
| N8 | **The ground truth's last position after a pause** (the mass test's finding 3; owner AEQ): a paused track's ground-truth copy ends where the track paused, with a test that catches it | PCA-simulator | – |
| T1 | **Specs:** the settings export and import (skips, warnings, permission); the help menu's Status and Licences (**the specs that open the Status panel change**); the presets; the WMS field against the ESA's WMS; the video window hidden in Settings and Monitor; the field of view; the radar's name in `P8`; EPSG:4326 | ITA | C1 to C4, F9, F10, V4, N2, N5 |
| T2 | **The WinTAK S1 to S5 fixtures** (L5) | ITA | – |
| T3 | **The moved-platform spec** made to catch N3's race | ITA | N3 |
| T4 | **Bit errors** against emcc's own player and the third-party receiver M9's T2 used: **a healthy stream with damaged pictures** (AFV). The stream decodes without errors, the KLV is intact, and the blocks are gone after the next keyframe | ITA | F5 |
| T5 | **The mass test:** phase 4, UAV video with WMS imagery, once M10's video items are in (owner, AER B); and it expects 0 m after a pause, once N8 is in (finding 3) | ITA | F4 to F7, F9, V3, N8 |
| T6 | **OTLP export** to the ESA's collector | ITA | C6, E1 |
| T7 | **The full run** on M10's RC | ITA | all above |
| E1 | **An OpenTelemetry collector** as an external test service (the owner approves it) | ESA | – |
| E2 | **An HLA RTI** as an external test service (section 7; the owner approves it) | ESA | Q6 |
| G1 | **The manual:** the settings export and import, the help menu's Status and Licences (chapter 3.16 and the places that send the reader to the Status panel), the presets, the WMS field and its errors, the pop-out, the realism, the field of view, the cameras' export, the radar's name, EPSG:4326 (chapter 5.5), GeoTIFF, and OpenTelemetry in the admin guide | UDA | each task |
| U1 | **The look:** the Status pop-over, Licences, the presets' drop-down, the export and import with its report, "New camera", "Select on map", the field of view's style, the pop-out window | UXA | each task |
| S1 | **Security review:** the settings file (nothing secret in it; the import's size and depth limits; the permission); GetCapabilities (the host from settings only, XML parsed without external entities); the GeoTIFF reader on malformed and oversized files; the OTLP export (what leaves the server, and no labelled content); the pop-out | SRA | C2, F9, D2, C6, F7 |
| W1 | **`marketing/`'s pointers to unpublished files:** reworded, or pointed at what M10 publishes (D5) | DMA | B2 |
| O1 | **The NVG spec check, point 3** (the `modifiers` attribute's format), the owner's own check of the NVG spec | owner | – |
| O2 | **The ATAK phone** for N7 | owner | – |

## 3. The lanes and the longest path

**The MCA's analysis, checked:**

- **The longest path is about 5 days, as the MCA found, but its body is PCA-fmv's lane, not the SDK.** `fmv` has 15 of the board's M10 items, in F1 to F10 (the MCA counted 14; CR-0055 is the fifteenth). They take about four days on their own. The SDK is on the path only for F9 and F10, and both come last in the lane. So the PDA's form parts (D1, D2) and the CDA's C1 must be on `integration/sdk-v1.10` by about day 3. The path is: this plan → the owner's answers → D1 → C1 with D2 → F9 and F10 → T7 → the RC.
- **A size-with-unit field is not needed in M10.** The cache's size as a setting moved to M11 (owner, 2026-11-23). G9's kinds for 1.10.0 are the presets and the field a plugin draws.
- **The presets need the CDA as well as the PDA.** The generated form is the shell's, so C1 is on the path, and it comes first in the CDA's lane. The owner chose Q4 A, so the presets and the SDK stay on the path.
- **The CDA's lane is about 4 to 4.5 days, not 3.5 to 4.** C1 is added at its start. In order: C1, C4, C5, C3, C2, then C6. OpenTelemetry comes last so that it can move to M11 (Q15).
- **PCA-uav-simulation's lane is about 3 days**, as the MCA found: V1 and V2 first, then V3 and V4 after ADR-0066, V5, then V6 once C5 is in.
- **Off the path:** the HLA spike (A4, E2), `terrain` (N1, after the reader), the simulator (N2, N8), `gmti` (N3, N4), `map-view-2d` (N5), `nvg` (N6, which waits for O1), `cot` (N7, which waits for O2), and the ITA's T2, T3 and T5. T5 runs beside F10, once the video items and N8 are in.
- **PCA-fmv starts with what needs no SDK or ADR:** F1, F2 and F3, then F7, and F6 once D3 has CR-0055's part. Then F4 and F5 after ADR-0066, F8 after the reader, F9, and F10 last.

## 4. SDK and data model 1.10.0

- **One CR by the PDA** (D1), a compatible 1.x addition. In this order:
  1. **The presets hint** (`x-emc2.presets`, data model, settings hints): named presets for a group's fields. The form fills the fields from a chosen preset and shows Custom when no preset matches. Nothing new is stored (point 4; Q4 A).
  2. **A settings field a plugin draws** (web SDK; G9): the web part registers a component for a field its own schema marks. The shell's form gives it the value, a change callback, the sibling values and nothing else. The plugin reaches its server part through its own endpoints, as a panel does (point 5).
  3. **A GeoTIFF reader** (Java SDK, with the test kit; point 3; Q3 A), tested with a point where latitude ≠ longitude in EPSG:4326 and EPSG:3006.
  4. **G27:** `ObjectQuery.ids(Set<UUID>)`, at most a few hundred ids, for queries and subscriptions (the PDA's proposal in the gap analysis).
  5. **A note:** map pane overlays are hidden while Settings or Monitor is shown (point 10; Q9 A).
- **The version:** **1.10.0** for the SDK and the data model, as 1.9.0 was.
- **The release point:**
  - the CR is approved before C1 and D2 start;
  - parts 1 and 2 are on `integration/sdk-v1.10` first, for `fmv`;
  - **1.10.0 is frozen** once each part has its first user merged there (F9 and F10 for parts 1 and 2; N1 and F8 for part 3; V6 for part 4), and before the full run on the RC (T7);
  - the tag `contracts-1.10.0` is set at the merge into `main`;
  - the version step (`CLAUDE.md` section 3) follows the freeze: D4 for the PDA, B2 for the MCA.
- **Not in 1.10.0:** the rest of L7, each through its own CR when a plugin needs it (point 6; Q5).

## 5. Questions for the owner

The owner answered them on 2026-11-23, through the MCA. The table keeps them as asked.

| # | Question | Options | The ACA recommended | The owner's answer |
|---|---|---|---|---|
| Q1 | **Secrets in the settings file** (ADR-0065)? | **A** none: no secret is a setting (ADR-0060). The file names credentials, the import lists the names this installation lacks, and the admin copies `settings/credentials/` by hand. **B** the export also packs the credentials files, encrypted with a password the admin gives. **C** the credentials files packed in clear | **A**: nothing secret leaves the server, and the credentials keep their own narrow permissions | **A** (AES) |
| Q2 | **The settings file's version and unit** (ADR-0065)? | **A** a format version with the emcc and plugin versions; a newer format refused whole; the unit is one top-level setting, applied or skipped whole; what an admin set, not the defaults; the report as point 2. **B** no version; a plugin's settings applied or skipped whole | **A**: one bad link does not cost a plugin's other settings, and defaults come from the installed version | **A** (AET) |
| Q3 | **The GeoTIFF reader** for `terrain` and `fmv`? | **A** in SDK 1.10.0: one reader with the pixel to WGS84 conversion for EPSG:4326 and EPSG:3006, tested once and open to outside plugins. **B** a reader of each plugin's own, `terrain`'s first and `fmv`'s after it, as `fmv`'s DTED reader followed S10's | **A**: two users now, coordinates and CRSs are where errors hide, and B would copy EPSG:3006 a third time. It is off the longest path (section 3) | **A** (AEU) |
| Q4 | **`fmv`'s presets**? | **A** a settings hint in 1.10.0: a preset fills the fields, and Custom starts from them. **B** `fmv` alone: a `preset` setting that its server part applies, with the fields shown, at their own values, only under Custom | **A**: "set together" and Custom "as today" mean the fields hold the preset's values. B takes the SDK off the longest path, if time matters more | **A** (AEV) |
| Q5 | **SDK 1.10.0's scope** (L7)? | **A** only what M10 uses: the presets hint, a field a plugin draws, the GeoTIFF reader, G27, the overlay note. **B** A, plus G10 (counters at plugin level, which OpenTelemetry would export) and G6's small steps (a position to a pixel, an image overlay). **C** all of L7 | **A**: each other gap gets its own CR when a plugin needs it | **A** (AEW) |
| Q6 | **The HLA spike's agent and first way** (section 7)? | **A** the ACA, as S9, trying a pure network protocol first, with no RTI library. **B** a new PCA-hla, which would also build the plugin. **C** the ACA, with an RTI library in the spike, through a CR for its licence | **A**: the spike answers whether a plugin is possible at all, before anyone builds one | **A** (AEX) |
| Q7 | **Where are the sway's settings kept**? | **A** per camera, stored with it and carried by the cameras' export. **B** `uav-simulation`'s plugin settings, one set for every camera, carried by the settings export | **A**: a camera on a mast sways less than one on a small UAV | **A** (AEY) |
| Q8 | **The field of view on the map**? | **A** `uav-simulation`'s overlay in Simulation, from its pose, on flat ground at 0 m HAE. **B** `fmv` writes ST 0601's corner points (tags 26 to 33) from its renderer, terrain included, and draws the footprint from them; the same code could later show a received video's footprint in View. **C** A, with the terrain once an SDK reads height data | **A** in M10: it is in the short lane. Over high ground it differs from the picture, which B would fix in M11 | **A** (AEZ) |
| Q9 | **The video window in Settings and Monitor**? | **A** the shell hides all map pane overlays there and shows them again on the way back. **B** an SDK member that tells a plugin which view is shown, and `fmv` hides its own window | **A**: no contract member, and every floating overlay behaves the same | **A** (AFA) |
| Q10 | **The video pop-out**? | **A** `fmv` alone, rendering into a window it opens; the window closes with the main one. **B** a page of a plugin's own served by the shell (gap G21), which survives a reload of the main window | **A** in M10; B is an SDK and shell change for later | **A** (AFB) |
| Q11 | **The ground radar's name in the GMTI output**? | **A** in `ChannelItem.Sensor.name`, so `P8` carries it, with no SDK or `gmti` change. **B** an SDK field for the platform's name beside it, with `P8` the platform and the radar's name in the job definition's sensor model (`J3`, 6 characters). **C** the name stays inside emcc | **A**: `gmti` already sends one `P8` per sensor. Under B, `J3` names a sensor model, not one radar | **A** (AFC) |
| Q12 | **The cameras' export** (L6)? | **A** `uav-simulation`'s own file from its panel. **B** inside the simulator's scenario file, which needs a contribution point between plugins (gap G8). **C** inside the settings export, which needs an SDK hook for plugin documents | **A**: no contract change, and the cameras' file can join a scenario later | **A** (AFD) |
| Q13 | **The agent setup in the public repository**? | **A** new files in the plugin template, written for outside developers (point 14). **B** the internal `agents/pca.md`, `agents/pda.md`, the conformance reviewer and a scrubbed `CLAUDE.md`, as they are. **C** a public `CLAUDE.md` at the public repository's root for developing emcc itself, swapped in by the MCA's publishing step | **A**: plugin development is the aim, the template is where an outsider starts, and there are not two versions of `CLAUDE.md` | **A** (AFE; D5 follows the owner's later session with the ACA on a better plugin template) |
| Q14 | **EPSG:4326 in a saved list of projections**? | **A** added once to a list an admin saved, at the first start of M10. **B** a saved list stays as it is, and the manual says how to add 4326 | **B**: emcc does not change what an admin saved | **B** (AFF) |
| Q15 | **A cut-line** if M10 runs late? | **A** OpenTelemetry (C6) and the HLA spike (A4) move to M11 first. **B** no cut-line | **A** | **A** (AFG) |

## 6. The ADRs and CRs it needs

| What | Kind | Owner | After |
|---|---|---|---|
| **ADR-0065:** settings export and import (points 1 and 2) | new ADR | ACA | Q1, Q2 |
| **ADR-0066:** the simulated camera's realism and its field of view. It extends ADR-0058 point 2 (the output link's degraded camera and bit errors) and ADR-0059 point 1 (the sway in the pose), and records the field of view's overlay and ground. ADR-0058 and ADR-0059 stay as they are; their index rows point to it | new ADR | ACA | Q7, Q8 |
| **SDK and data model 1.10.0** (section 4) | CR | PDA | Q3 to Q5 |
| **A dev-only licence** for an RTI library in the spike, only if Q6 C, or if the spike finds no other way | CR | ACA | A4 |
| **The way into an HLA federation**, if S11 finds one | ADR for M11 | ACA | A4 |
| CR-0055 (the overlay burned in) | approved (ADC A) | – | – |

No other ADR changes:
- ADR-0013 covers OpenTelemetry;
- ADR-0060 already keeps secrets out of settings;
- the help menu, the radar's name, the pop-out, EPSG:4326 and the fixes need none.

## 7. The HLA 1516 spike (S11)

- **Goal:** whether and how emcc can join an HLA federation (IEEE 1516-2010, HLA Evolved) through an RTI, to exchange simulated tracks both ways.
- **What it must settle:**
  - **the wire:** HLA 1516-2010 standardises the federate's API, not the protocol between a federate and the RTI. So joining normally needs the RTI vendor's library. The spike checks whether an RTI the ESA can run offers a standard network protocol instead, such as HLA 4's Federate Protocol, which a plugin could speak inside a connection task with no library;
  - **the licences:**
    - an RTI run outside emcc is the ESA's external test service: any licence that allows the use, approved by the owner;
    - a library linked into a plugin must be under `CLAUDE.md` section 4. Portico is CDDL, and OpenRTI and CERTI are LGPL or GPL, so any of them needs a CR, also in the spike, whose dev-only licences do not include them;
  - **the threads:** a vendor library starts its own threads, which ADR-0004 forbids in a plugin. Only a protocol inside a connection task (ADR-0036) fits without a new ADR;
  - **offline:** the RTI and the federation run on the local machine, with nothing from the internet;
  - **the data:** the RPR FOM's entities, with their geocentric coordinates converted to WGS84 longitude and latitude, tested with a point where latitude ≠ longitude.
- **The agent:** the ACA (Q6 A), in `spikes/s11-hla/`, after the ESA's RTI (E2). The spike's code ships in nothing.
- **Exit criteria:**
  1. a written report naming each way that was tried, what each needs (licence, threads, ADR or CR) and a recommendation;
  2. either a working check on the ESA's RTI, on loopback and offline, with one simulated track from emcc seen by a second federate and one track from the federation at the same position on the emcc side, or the report says why no way works;
  3. a time box of two days. At its end the report is written with what is known.
- **Not in the spike:** a plugin, a product dependency, or anything in `main` other than the spike's folder and its report.

## 8. The briefs the PDA writes (D3)

| Brief | What changes |
|---|---|
| `fmv` | F2 to F10: the empty address, no source or licence, 9000 tiles, the WMS errors, the degraded camera, the bit errors, the pop-out, GeoTIFF imagery, the WMS field, the presets. **CR-0055's part**, which no brief has yet |
| `uav-simulation` | V1 to V6: "New camera", "Select on map", the Save fix, the sway, the field of view, the cameras' file, G27. **CR-0055's checkbox** and the pose's `overlay` |
| `terrain` | N1: GeoTIFF height data beside DTED |
| `simulator` | N2: the radar's name; N8: the ground truth after a pause |
| `map-view-2d` | N5: EPSG:4326 among the defaults; a saved list stays as it is (Q14 B) |
| `nvg` | N6: the amplifiers, once O1 settles the format |
| `gmti` | A line saying that `P8` carries a radar's own name (Q11 A); no function changes |

## 9. The first prompt for each lane

The owner has answered section 5; the MCA relays them. Each lane works from `integration/sdk-v1.10`, writes its handover last, and reports to the MCA.

```
[MCA → PDA] M10: write the SDK and data model 1.10.0 CR (docs/architecture/m10-plan.md, section 4,
with the owner's answers to Q3 to Q5): the presets hint and the field a plugin draws first, then the
GeoTIFF reader, G27 and the overlay note. After its approval, the code in that order (D2), and the
briefs of section 8 (D3), fmv's first. D5, the public agent setup, waits for the owner's later
session with the ACA on a better plugin template, and follows what it decides.
```

```
[MCA → CDA] M10 (docs/architecture/m10-plan.md, sections 2 and 3): C1 first, the generated form's
presets and the field a plugin draws, as the approved 1.10.0 CR says; then C4, C5 and C3 (the help
menu's Status and Licences). Then C2, settings export and import, by ADR-0065. Then C6,
OpenTelemetry: your design note first, within ADR-0013. C7 with PCA-fmv.
```

```
[MCA → PCA-fmv] M10 (docs/architecture/m10-plan.md, section 3): start with F1 (the first encoder
start, the old imagery within 2 s, the Monitor's row with the CDA), F2 and F3; then F7, and F6 once
your brief has CR-0055's part. F4 and F5 after ADR-0066, F8 after the SDK's GeoTIFF reader,
then F9, and F10 last. Your brief's M10
section is the PDA's (D3).
```

```
[MCA → PCA-uav-simulation] M10 (docs/architecture/m10-plan.md): V1 first (the Save fix, "New
camera" in the Cameras panel, "Select on map"), then V2 (CR-0055's checkbox). V3, the sway, and V4,
the field of view as an overlay in Simulation, after ADR-0066. Then V5, the cameras' export and
import, and V6 once ECore has G27.
```

```
[MCA → PCA-terrain] M10, N1: GeoTIFF height data beside DTED, through SDK 1.10.0's GeoTIFF reader,
once it is on integration/sdk-v1.10. Test with a point where latitude ≠ longitude. Your brief's
M10 part is the PDA's.
```

```
[MCA → PCA-simulator] M10, N2: a ground radar's own name in the Sensors panel, set when it is made
and changed later, used in the dwells' and reports' labels and the scenario file, and sent as the
sensor's name (the plan's Q11). A radar without one keeps today's label. Then N8 (the mass test's
finding 3, owner AEQ): a paused track's ground-truth copy ends where the track paused, with a test.
```

```
[MCA → PCA-gmti] M10: N3, a moved platform that comes back into the link's layer under load
(owner ADW A): find and fix the race, with a test that catches it. Then N4, the "dwells sent a
minute" note.
```

```
[MCA → PCA-map-view-2d] M10, N5: EPSG:4326 among the default projections; a list an admin saved
stays as it is (the plan's Q14 B), and the manual says how to add 4326; WMS backgrounds in 4326
(latitude first in 1.3.0) and the graticule tested
in it, with a point where latitude ≠ longitude.
```

```
[MCA → ITA] M10: T2 (the WinTAK S1 to S5 fixtures) can start now; T3 after PCA-gmti's N3. T5, the
mass test's phase 4, once M10's video items are in (F4 to F7, F9, V3; owner AER B); and the mass
test expects 0 m after a pause once PCA-simulator's N8 is in (finding 3 is the simulator's, AEQ).
Then T1 and T4 as their tasks merge (docs/architecture/m10-plan.md, section 2). The specs that open
the Status panel change with C3.
```

```
[MCA → ESA] M10: E1, an OpenTelemetry collector, and E2, an HLA RTI (the plan's section 7: its
licence, platforms, and whether it offers a standard network protocol to federates), each proposed
to the owner before it is installed.
```

```
[MCA → UDA, UXA] M10: G1 and U1 follow each task as it merges (docs/architecture/m10-plan.md,
section 2). UDA: chapter 3.16 and every page that sends the reader to the Status panel change with C3.
```

The SRA's S1 and the DMA's W1 are asked for when their tasks are merged. PCA-nvg (N6) and PCA-cot (N7) wait for the owner's O1 and O2.
