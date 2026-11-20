# M5 plan

- **Status:** proposed by the ACA (2026-11-05), for the owner's approval.
- **Scope:** the owner's, in `docs/status.md`, "Milestone M5" (2026-11-05, decisions GC to GN): T-059, T-126, T-129 and T-131 to T-147. No cut-line: all of it is in M5 (GN).
- **Not in M5:**
  - **M6:** PostgreSQL/PostGIS persistence and OpenTelemetry (T-060);
  - **later:** the older enhancements list, spike S7 (3D), and the security review on demand.

  The overview's section 6 holds the milestones.

## The owner's answers for this plan (2026-11-05)

| | Answer |
|---|---|
| Q1 | **T-142's plugin id is `terrain`**, not `geotools`, which is the name of the LGPL GeoTools library that ADR-0016 rules out |
| Q2 | **GMTI follows STANAG 4607 Edition 4**: AEDP-4607 Edition A, Version 1 (February 2024), with its implementation guide AEDP-4607.1 Edition A, Version 1. Both are public NSDD documents in a local folder of the owner's. Agents read them there, and they are never copied into the repository |
| Q3 | **An object's data type stays changeable** after creation, as today (ADR-0023 point 6). A change keeps the object's field sets and their values |
| Q4 | **CR-0029 is approved:** the CC-BY-3.0 note in an unmodified mil-sym-ts may ship. `CLAUDE.md` section 4 says so on this branch; the MCA fills in the CR's decision |
| Q5 | **A viewshed is shown, not saved, in M5:** it is the user's own overlay, neither shared nor stored. A viewshed is many patches with holes, so saving one needs a MultiPolygon in the data model: a later CR |
| Q6 | **The simulator has two kinds of output:** a **Ground truth output** sends every simulated track as it is, and a **Sensor output** sends what a simulated sensor detects. CoT, AIS and ADS-B are offered in both; GMTI is offered only as a Sensor output |
| A1–A12 | The ACA's assumptions, accepted: they are written into the sections below |

## 1. Contracts: SDK 1.4.0 and data model 1.4.0, one change request

**One release, as 1.3.0 was:**
- the PDA writes one CR, under the next free number from the MCA;
- the ACA reviews what touches an ADR, and the owner decides;
- the PDA builds it in parts on `integration/sdk-v1.4`, one at a time, and the owner freezes it.

Plugins keep `sdkVersion` `^1.3.0` until they use an addition. The order runs from the longest chain of work behind a part, and from what unblocks the most agents (A8).

| Part | What | Tasks, ADRs |
|---|---|---|
| 1, in and out | **The layer picker's "New layer" button:** it asks for a name and creates the layer at once, as a change request with the admin's `layers.edit`, then picks it by id. The "New layer" entry and making a layer at the first object go. **An object writer for in/out plugins:** the target layer and the one-in-flight writes that `cot`, `ais` and `adsb` each wrote themselves; the PDA proposes in the CR whether it belongs in the SDK or the template. **Output kinds:** a channel says whether it takes ground truth, sensor reports or both (Q6) | T-133, T-147; ADR-0037 amended; ADR-0040 amended |
| 2, tactical graphics | ADR-0043 point 9: the amplifiers, among them `AM` and `AN`; the order of each graphic's points; a catalogue with geometry and point counts; the symbology call that draws a graphic at a scale and extent; the test kit's fakes. The model's example `object-multipoint-boundary.json` gets a boundary's code | T-144; ADR-0043 |
| 3, field sets and vessel symbols | **Field sets:** each plugin declares named sets of its fields in its manifest. An object lists the sets it carries; a change request adds a set; an object a plugin receives carries that plugin's set from the start; "Other fields" goes. The data type stays changeable (Q3). **Vessel symbols:** a symbol standard `vessel` with the AIS ship type as its code and the identity kept, drawn through the symbology service | T-132, T-139 (T-131's fields become `cot`'s set); ADR-0038 amended, ADR-0047 |
| 4, capabilities and time | **Capabilities:** a plugin declares them in its manifest and implements the matching optional SDK interface. ECore and the shell give each function only to the plugins that declare it, and refuse a plugin whose declaration and code disagree. **Temporal, the first capability:** the user's time (now, a time or an interval); the shell's time control, shown only when a loaded plugin is temporal; server parts get each session's time; a temporal test plugin in the test kit | T-135, T-136; ADR-0044, ADR-0045 |
| 5, display settings | A service for each user's display settings: symbol size; the speed vector as the distance in N minutes at the unit's speed and heading (GD); the labels shown next to a symbol. The admin sets the defaults. **Added by T-150 (owner, HC, HD, 2026-11-05):** one switch per declared relation kind, and one window for all of them, opened from the Map Pane (ADR-0052) | T-137, T-150; ADR-0046, ADR-0052 |
| 7, relations (added by T-150, owner, HB, 2026-11-05) | **Relations between objects:** `relations` in the object content, each a declared kind and the other object's id, with a limit per object; `relationKinds` in the manifest, with the line's colour and style and the switch's default; the declared kinds in the plugin context; the store rejects an undeclared kind. `gmti` declares `gmti.pairing`; detections carry it in View, the sensor platform in Simulation | T-150; ADR-0051 |
| 6, terrain's needs, if missing | **A local overlay in the map view** that shows a plugin's own features to one user only, for the viewshed (Q5). **A manifest declaration** that a plugin reads a folder the admin sets, so that the Monitor shows it, as for `internet`. The PDA checks first what SDK 1.3.0 already offers | T-142; ADR-0049 |

**No contract change** for:
- T-129, `cot`'s full SIDC and amplifiers to and from TAK (A9);
- T-138, the speed vector under the symbol;
- T-140, the symbol type per link: a playbook item;
- T-143, the simulator's scenarios: its own versioned JSON, in its brief;
- T-126, `cot`'s test.

## 2. ADRs

**Written after the owner approves this plan,** on their own branch, `aca/m5-adrs` (A1), so that the PDA's CR can cite them. Each states the decision points below.

**Written on 2026-11-05** as ADR-0044 to ADR-0050. Accepted ADRs are not edited (`docs/adr/README.md`), so the amendments took these forms:
- **ADR-0038:** field sets are the new ADR-0050, which extends it;
- **ADR-0040, and ADR-0037 point 4:** the output kinds are in ADR-0048;
- **ADR-0037 point 2:** T-133 is an index note on ADR-0037.

| ADR | Decision points |
|---|---|
| **0044 Capabilities** (new) | Optional plugin interfaces, declared in the manifest (`capabilities`), so the shell knows them before any plugin code runs and web-only plugins can have them (A2). The plugin implements each one's SDK interface, in Java, in the web part, or both, as the capability defines. ECore checks declaration against code at load and refuses a mismatch with a clear reason in the Monitor. No empty stubs: a plugin implements only what it declares. Temporal is the first |
| **0045 Temporal awareness** (new) | Each user picks **now**, **a time** or **an interval** (GE). The choice belongs to the browser session: it is not saved, and it starts at "now" (A3). The shell shows the time control only when a loaded plugin declares the temporal capability (GF). The choice goes to the server with the live picture, and the temporal plugins' server parts get each session's time. Only temporal plugins react; other objects show as now. No product plugin is temporal in M5; M6's GRIB plugin is the first. Tested with a test plugin |
| **0046 Display settings per user** (new) | Symbol size, the speed vector's length (N minutes at the unit's speed and heading, GD) and the labels shown, per user, the same in every workspace and browser (GC, A4). Stored on the server as the user's own data (ADR-0027) by an ECore service; the admin sets the defaults. The map view and the symbology plugin read them through the SDK. The no-login mode uses the defaults |
| **0047 Vessel symbols** (new) | emc2's own drawings in the style of vessel-tracking pages: a pointed hull rotated by heading, coloured by AIS ship type. No copied artwork (GK). A second symbol standard, `vessel`, beside APP-6 in data model 1.4.0, with the AIS ship type as its code and the identity kept (A5). The symbology plugin draws it; `draw-symbols` offers it; it goes out as CoT as a surface unit of its identity. For an `ais` link the symbol type is a setting, with vessel symbols the default for new links (T-140, GL) |
| **0048 GMTI, STANAG 4607** (new) | **The edition:** STANAG 4607 Edition 4, AEDP-4607 Ed. A V1, with the guide AEDP-4607.1 (Q2). **The `gmti` plugin in:** over TCP or UDP, by the playbook. The sensor platform becomes a symbol and each dwell area a shape. Target reports become detection objects of the data type `gmti.detection`, not tracks; their short history comes from the data type's expiry and fading (ADR-0023, A6). **Out:** a Sensor output only (Q6), so it sends target reports in dwells. **The simulator's GMTI sensor:** a simulated platform with its route, revisit time, area, detection probability, position error and minimum detectable speed. Its detections of simulated tracks go out through the Sensor outputs: `gmti`, and `cot`, `ais` and `adsb` (GG). **Test data:** the ESA generates it (A6) |
| **0049 Terrain analysis** (new) | **The `terrain` plugin** (Q1): range and bearing between two points, geodesic through the SDK's geodesy. **A viewshed from a point:** an observer height above ground, a target height and a maximum range (GH, GI). **Height data:** DTED levels 0–2 or GeoTIFF, from a folder the admin sets. The path comes only from settings, never from a request or an object; the plugin only reads it; nothing is shipped, and shipping height data later needs a CR. **Reading:** DTED with the plugin's own code; GeoTIFF with a library whose licence is checked first under ADR-0016, or the plugin's own reader (A7). The GeoTools library is LGPL and is not used. **Computing:** in the server part, on compute workers, with a timeout and a cap on cells; earth curvature included. **The result:** the user's own overlay, neither shared nor saved (Q5) |
| **0051 Relations between objects** (new, T-150, 2026-11-05) | A reference in an object's content, a kind and the other object's id, never an object of its own (HB). Kinds are declared in manifests with their line's colour and style. Any plugin writes them as content; ECore checks the kind and the limit, nothing else, and never cascades. A line only when both objects are in the user's picture; the id stays. `map-view-2d` draws, under the symbols. One switch per kind, per user on the server (HD). First: `gmti.pairing`, yellow, off by default |
| **0052 Display settings window** (new, T-150, 2026-11-05) | One icon in the Map Pane's corner, after Coordinates, owned by the shell; one window with T-137's settings, a check box per relation kind and "Use defaults" (HC). Replaces ADR-0046 point 4's top-bar entry |
| **0037 amended** | Point 2: "New layer" is a button that creates the layer at once, and the picker keeps its id (T-133). A deleted target layer is still made again at the next data. Point 4: a channel says which kinds of output it takes (Q6) |
| **0038 amended** | Field sets: the manifest groups a plugin's fields into named sets; an object carries a list of sets; the editor's dropdown with "+" adds a set and greys out a set the object has; an object received by a plugin carries its set from the start; "Other fields" goes. `cot`'s set has a Callsign, separate from the Name: incoming CoT fills both, and outgoing CoT sends the Callsign, else the Name (FS to FW). The data type stays changeable (Q3) |
| **0040 amended** | The simulator's outputs are **Ground truth outputs** and **Sensor outputs** (Q6), each chosen in its panel. A Sensor output belongs to one simulated sensor |

**`CLAUDE.md`** section 4 gains CR-0029's allowance (Q4, this branch). ADR-0043 is unchanged.

## 3. Tracks and order

| Track | Work | Owner | Starts |
|---|---|---|---|
| A, design | ADRs 0044 to 0049 and the three amendments; ADR-0051 and ADR-0052 (T-150, 2026-11-05) | ACA | when the owner approves this plan |
| B, contracts | the 1.4.0 CR; its build in parts 1 to 6 (section 1); the freeze | PDA; the CDA builds ECore's and the shell's sides (track E) | after A |
| C, briefs | in this order: `draw-tactical` (new); `gmti` (new) and the simulator's sensor, with the scenarios (T-143) in the same brief edit; `terrain` (new); the field-set and vessel edits in `cot`, `ais`, `adsb`, `draw-symbols`, `symbology` and `map-view-2d` | PDA | with B, each after its part |
| D, no contract change | T-059 (spike S5, CDA); T-126 (`cot`); T-129, then T-131 with part 3 (PCA-cot checks TAK and WinTAK first, then the PDA's brief, A9); T-138 (`symbology`, `map-view-2d`); T-146 (MCA); T-134's other parts (CDA, MCA, ESA, the PCAs) | as named | at once |
| E, core | per part: the picker's button, the writer if in the SDK, capabilities, the time control, display settings, the map view's local overlay | CDA | per part of B |
| F, plugins | `symbology` and `map-view-2d` for tactical graphics, then `draw-tactical`; `gmti` and the simulator's sensor and two output kinds; `terrain`; field sets and vessel symbols in the plugins; `ais`'s symbol choice (T-140) | PCA-symbology, PCA-map-view-2d, PCA-draw-tactical, PCA-gmti, PCA-terrain (three new PCAs, A10), PCA-simulator, PCA-cot, PCA-ais, PCA-adsb, PCA-draw-symbols | per part and brief |
| G, test data | generated GMTI; a public-domain height area (e.g. SRTM), each approved by the owner first | ESA | at once |
| H, tests | the M5 flows: tactical graphics, field sets, vessel symbols, the time control with the test plugin, display settings and the pairing lines (T-150), `gmti` in and out with the simulator's sensor, `terrain` | ITA | as each lands |
| I, release | the M5 release with the UDA's manual shipped in the zip (T-145, `tools/release.mjs`), in the name emcc (T-134) | MCA, UDA | when F and H are done |

- **The PDA is the bottleneck again.** Its proposed order:
  1. the 1.4.0 CR;
  2. part 1;
  3. part 2 with the `draw-tactical` brief;
  4. part 3 with the field-set and vessel brief edits;
  5. the `gmti` and simulator briefs;
  6. part 4;
  7. part 5;
  8. part 6 with the `terrain` brief.

  T-147's writer in part 1 comes before `gmti` is built on it.
- **Tactical graphics is the longest chain:** part 2, then `symbology`, then `map-view-2d`, then `draw-tactical`. It starts as early as the CR allows. mil-sym-ts may ship, since CR-0029 is approved; the MCA's notices carry the note when it reaches the root lock file.
- **New agents:** PCA-gmti, PCA-terrain and PCA-draw-tactical, with worktrees and browser-check ports from the MCA (A10).
- **Everything else runs in parallel,** each PCA on its own plugin, the CDA following the parts.
