# Brief: terrain

- Status: **Reviewed by the ACA (2026-11-07, `docs/architecture/reviews/sdk-1-4-0-part-6.md`; T1, R2 and R4 taken). Approved by the owner (2026-11-07, KH).** With the owner's answers of 2026-11-07: Q19, **DTED only in M5; GeoTIFF moves to M6** (the ACA's note on ADR-0049 points 4 and 6, on `aca/sdk-1.4-part6-review`), and Q20, the assumptions A1 to A9, accepted (both confirmed as KC). · Milestone: M5 · Task: T-142 · Agent: PCA-terrain (new; worktree and browser-check port from the MCA)
- **Read first:** ADR-0049 (terrain analysis), ADR-0004 (workers), ADR-0019 (geodesy), ADR-0030 (offline, no paths from requests), ADR-0007 (coordinates), and the ESA's sheet `external/terrain/README.md` (the test data, and the DTED pitfalls it lists).
- **Updated 2026-11-08 for the owner's LE (PCA-terrain's decision 1, `pca-terrain/m5` `aeacd608`): Settings.** `timeoutSeconds` is 5 to 55, not 5 to 300: the SDK caps an endpoint and a compute worker at 60 s, so more had no effect. **Approved by the owner (2026-11-08, LI).**
- **Updated 2026-11-11 for M7 (T-166, T-167, T-157): functions 1 and 10 to 12, Settings, criteria 15 to 20, open questions Q53 and Q54, assumptions H1 to H3.** The height map in a circle, in 16 steps (no contract change), and the brief of the spike `terrain-live-drag`. The default `%emcc%/settings/terrain` (T-157; the M7 plan's Q2, the ACA's note on ADR-0049) waits for CR-0041 part H in ECore (lane H waits for lane C). **The height map and the spike can start first.** T-167 is the spike only in M7 (the plan's Q4). **Approved by the owner (2026-11-11, RJ A)**, with Q53 A (16 steps), Q54 A ("412 m") and H1 to H3. **Updated 2026-11-12 with the owner's RV C on H3:** the cross is a fixed size on screen, 16 px, not 1/20 of the radius (function 12, criterion 18). **Updated 2026-11-12 with the owner's SB A and SC A:** the release ships an empty `settings/terrain/` with a readme; a missing or unreadable folder stays **DEGRADED** with ECore's reason, an empty readable one is OK with "Height data: 0 cells" (functions 9 and 12, criterion 20; the owner's "error" meant a fault, not the ERROR level).
- **Built against SDK 1.4.0** (`sdkVersion` `^1.4.0`): part 6's local folder and the overlay's `area` and `label` (`docs/plugins/sdk-v1.md`, "Part 6").

## Purpose

Two terrain tools for the operator (ADR-0049; T-142):
- **Range and bearing** between two points on the map: the geodesic distance and the bearings, on WGS84.
- **A viewshed** from a point: the ground that an observer at a height above the ground sees, for a target at a height above the ground, up to a range.

The heights come from **DTED** (levels 0, 1 and 2) in **one folder the admin sets**. Nothing is shipped. The results are the user's own overlay: shown in this browser only, never shared or saved (ADR-0049 point 8; the M5 plan's Q5).

## Kind and parts

- Kind: **utility** (it creates no objects). Properties: none.
- Parts: **server** (the height data, the computing, the endpoints) and **web** (the panel and the overlay).

## Functions

1. **Terrain panel** (default pane: right; in every workspace, A1): the two tools (three from M7: function 10), their fields and results, and **Clear**, which removes this plugin's overlay. Users without `plugin.terrain.use` do not see the panel.
2. **Range and bearing** (ADR-0049 point 2):
   - With the tool on, the user picks two points (`MapView.pickPoint`, twice); Escape ends the tool. Picking again starts a new pair and replaces the result.
   - The server computes it with the SDK's geodesy (`Geodesy.inverse`; the web SDK has no geodesy): the **distance**, the **initial bearing** at the first point and the **final bearing** at the second, from true north, and the **back bearing** (the final bearing + 180°, normalised).
   - **Shown:** a line between the points (geodesic, densified by the map view), a mark at each end, and a **label** at the middle with the distance and the initial bearing; the panel lists all four values and both positions. Distances in m below 1 000 m, else in km with two decimals; bearings in degrees with one decimal, three digits before it (`045.2°`).
   - It needs no height data, so it works while the folder is not set.
3. **Viewshed** (ADR-0049 point 3):
   - **Fields:** observer height above the ground (default 2 m, 0 to 1 000 m), target height above the ground (default 2 m, 0 to 1 000 m), maximum range (default 10 000 m, 100 m to the admin's maximum). Then the user picks the observer's point.
   - **The answer:** the visible ground as areas with holes, the data used (level, cells read), the time it took, and **"partly without data"** when some ground within range has no height data (A4).
   - **Shown:** the visible areas filled (green, 30 % opacity, a thin outline), the observer's point, and a thin circle of the maximum range: a closed `line` the plugin densifies itself (the overlay has no circle), counted against the overlay's caps with the areas (the ACA's R4). A new viewshed replaces the shown one; Clear removes both tools' results.
   - **While it runs** the panel shows "Computing…"; **at most one viewshed per user at a time** (ADR-0049 point 7): a second request is refused (HTTP 409, "a viewshed is already running for you").
4. **Line of sight** (ADR-0049 points 3 and 5):
   - A target cell is visible when the straight line from the observer's eye (the ground height at the observer plus the observer height) to the target's top (the cell's ground height plus the target height) passes above every height between them.
   - **Curvature and refraction:** a height at distance d is lowered by d² / (2 R) · (1 − k), with R = 6 371 000 m and k the admin's refraction coefficient (default 0.13).
   - **Heights** between the grid's samples are bilinear. The vertical reference cancels out, since one data set is used at a time (ADR-0049 point 5).
   - **The algorithm is PCA-terrain's** (for example R3, or a sweep), as long as criterion 8 holds against a brute-force check.
5. **The result's areas** (ADR-0049 point 8):
   - The visible cells are traced into polygons with holes along their cell edges, merged, and simplified to the data's cell size. Rings are closed, in longitude, latitude.
   - **Within the overlay's caps** (`OVERLAY_MAX_ITEMS`, `OVERLAY_MAX_POSITIONS`; `overlayProblem`): when the areas do not fit, the server simplifies with twice the tolerance, then four times, and so on, and the answer says it did. The map view never gets an overlay it refuses.
6. **Height data** (ADR-0049 point 4; owner, Q19):
   - **DTED levels 0, 1 and 2** (MIL-PRF-89020B), one file per cell, as `e<lon>/n<lat>.dt<level>` under the folder (the names in any case, `w`/`s` too). The plugin lists the folder and its `e…`/`w…` subfolders through `LocalFolder.list`, and reads each cell whole through `LocalFolder.read` (a level 2 cell is at most about 26 MB). **It queues its own calls** so that at most `LocalFolder.MAX_CONCURRENT_CALLS` are in progress, and a call answered `BUSY` waits for one of them to finish before it is made again, never retried in a loop (the ACA's R2). It checks each cell's header (origin, spacing, counts, checksums) against its name, and skips a cell that does not match, with a log line.
   - **Spacing differs by latitude zone** (the ACA's T1): the reader takes **both intervals from each cell's user header (UHL)** and checks them against the standard's zone table: the longitude interval is the latitude interval times 1 up to 50°, 2 from 50° to 70°, 3 to 75°, 4 to 80° and 6 to 90° (north or south). A cell whose intervals do not match its zone is skipped with a log line. Never assume square cells; the ESA's data, at 59° N, has twice the latitude interval.
   - **Voids** (−32767) count as no data.
   - **The index** of cells is made at start and again when the folder setting changes. A cell added later needs a change of the setting or a restart (A5).
   - **The plugin never opens a file itself:** every byte comes from `LocalFolder` (model rule 19), and the reader parses bytes only (the ACA's note on CR-0030).
7. **Which data a viewshed uses** (A3): the finest level with a cell at the observer's point, for the whole viewshed. **When that level needs more height cells within the range than the admin's cap**, the next coarser level that fits is used, and the answer says so. When none fits, the request is refused with its reason: the cells it needs and the cap (ADR-0049 point 7).
8. **Limits** (ADR-0049 point 7; the ACA's R5 on CR-0030): a timeout per request, a cap on the height cells per request, a cap on the memory of parsed cells (least recently used go first), all admin settings. A request over a limit is refused with its reason (HTTP 413 for the cap, 503 for the timeout).
9. **Status** (the Monitor): "Height data: n cells (level 2: a, level 1: b, level 0: c)", or "Height folder not set", or "Height folder not readable", from `LocalFolder`'s reasons; the folder itself is shown by ECore from the manifest's `folders`. **The levels** (owner, SB A and SC A, 2026-11-12): a folder that is missing or cannot be read (`MISSING`, "outside the emcc folder" included) **stays DEGRADED with ECore's reason**, as before M7 and as built (PCA-terrain `ff0741cc`, `Heights.updateStatus`; the owner's "error" meant a fault, not the ERROR level); **an empty, readable folder is OK**, "Height data: 0 cells".

## Functions (M7)

- **Built against SDK 1.5.0:** the height map needs no contract change: overlay `area`, `line` and `label` (SDK 1.4.0 part 6), `MapView.draw('circle')`, and a POST endpoint.
- **Category** (T-174): `geometoc`, in the manifest from SDK 1.6.0 (CR-0041 part F).
- **Can start first.**

10. **A height map in a circle** (T-166; owner, 2026-11-09, NF A). A third tool in the Terrain panel, **"Height map"**:
    - **The circle:** the user draws a circle (`MapView.draw('circle')`), with a radius from 100 m up to the admin's `maxRange` (the viewshed's limit). A larger circle is refused at the field's message, "At most <maxRange> km".
    - **The server** (`POST /heightmap` with the centre and the radius) reads the heights inside the circle:
      - **The level** is the finest that fits `maxCells`, as a viewshed (function 7), and the answer says which.
      - **The bands:** it takes the lowest and the highest ground inside the circle and divides that span into **16 equal bands** (owner, Q53 A: steps). Each band's cells are traced into areas with holes, as function 5 does, within the overlay's caps.
      - **A flat circle** (lowest = highest) gives one band.
      - **Ground without data** is left out, and the answer says "partly without data" (A4).
    - **The answer:** the bands (each with its index and its lowest and highest height), the highest point's position and height, the lowest height, the level, the cells read, the time it took, and whether it simplified.
    - **Shown:**
      - **The bands** filled, with no outline, at 50 % opacity (H1). Their colours run in 16 steps **from green (highest) through yellow to red (lowest)**: the band's place in the span, from 0 at the lowest to 1 at the highest, gives a hue from 0° (red) to 120° (green) at full saturation (H2).
      - **The highest point:** a **white cross of a fixed size on screen, 16 px** (owner, RV C, 2026-11-12; not 1/20 of the radius): two `line` items, each 16 px long, crossing at the point. The web part sizes them from the viewport's `resolution` (metres per pixel) and sets the overlay again when the view's resolution changes, so the cross keeps its size at every zoom (no contract change).
      - **The label** with its height in metres above mean sea level, rounded to the metre: **"412 m"** (owner, Q54 A), white with a dark halo, beside the cross.
      - **The circle's outline:** a thin `line` the plugin densifies itself, as the viewshed's range circle.
    - **The panel** shows the lowest and highest heights, a 16-step legend, the level and "partly without data" when it is.
    - **Heights are above mean sea level:** DTED's are (MIL-PRF-89020B, EGM96), so the label needs no conversion.
    - **One at a time:** a new height map replaces the shown one, and Clear removes it. **At most one viewshed or height map per user at a time** (409, as function 3).
    - **The limits:** the viewshed's timeout, `maxCells` and cache (function 8).

11. **Spike terrain-live-drag** (T-167; owner, NH B, NF A). PCA-terrain writes it in `spikes/terrain-live-drag/`, with a `README.md` of its results, before M7's terrain work is final. It changes no product code.
    - **The question:** can the viewshed and the height map follow a shape dragged live?
    - **What it measures:**
      - the server's time for a coarse viewshed and a coarse height map at typical radii (5, 10 and 25 km) and at DTED levels 0, 1 and 2, on the ESA's Stockholm and Sundsvall data, median and 95th percentile over at least 20 runs each;
      - the map's redraw rate for such an overlay (its areas at the same sizes) set again and again while a shape is dragged: frames per second, measured in the browser with `map-view-2d`, for at least 10 s per size.
    - **"Coarse"** is the spike's choice: for example the next coarser level, or every second sample. The README says what it used and how far the result differs from the full one.
    - **It passes** for a tool when a coarse result comes within about **500 ms** and the map redraws at least **5 times a second** (owner, NH B).
    - **If it passes,** the PDA writes a CR for a `MapView` interaction that drags a plugin's own overlay shape and reports each position, for a later milestone: PCA-map-view-2d builds it, and PCA-terrain the tools. If only the height map passes, live drag for it alone.
    - **The spike's README** has the numbers per tool, radius and level, the machine, the browser, and a pass or fail per tool.

12. **The height data folder's default** (T-157; the M7 plan's Q2, the ACA's note on ADR-0049; SDK 1.6.0, CR-0041 part H).
    - **The default:** `heightDataFolder` becomes **`%emcc%/settings/terrain`** instead of empty. So the Sundsvall demo zip (CR-0037), unpacked into the emcc folder, works without a setting.
    - **What the folder setting may be:**
      - **an absolute path, as before:** for example shared storage that other apps use too;
      - **a value that starts with `%emcc%/`:** ECore resolves it below the emcc folder (part H). A result outside it is unusable, with the reason "outside the emcc folder".
    - **The plugin does nothing new:** `LocalFolder` and its reasons stay as they are, and the status (function 9) shows them. The Monitor shows the setting as typed and the folder it resolves to (CDA).
    - **The release** ships an empty **`settings/terrain/`** with a short readme saying where the height cells go (MCA; owner, SB A and SC A, 2026-11-12). With no demo data the folder exists and is readable, so the status is **OK** with "Height data: 0 cells" (function 9); a folder that is missing or cannot be read stays DEGRADED with ECore's reason.

## Server part

- **Workers** (ADR-0004; overview 4.2): one worker owns the index, the cache and who is computing; the line of sight runs on **compute workers** (`WorkerSpec.compute(true)`), never on threads of its own. Messages are immutable: a parsed cell travels as `Bytes` or an immutable form, never as a shared array (`PluginRules`).
- **Endpoints**, each needing `plugin.terrain.use` (overview 4.4):

  | Endpoint | Body | Answer |
  |---|---|---|
  | `POST /range` | `{ "from": [lon, lat], "to": [lon, lat] }` | `{ "distance": m, "initialBearing": °, "finalBearing": °, "backBearing": ° }` |
  | `POST /viewshed` | `{ "observer": [lon, lat], "observerHeight": m, "targetHeight": m, "maxRange": m }` | `{ "areas": [[ring, …], …], "level": 0–2, "cells": n, "simplified": n, "partlyWithoutData": bool, "millis": n }` |
  | `GET /status` | – | the index: levels, cells, the area they cover |

  The server checks every value (positions, heights, range within the admin's maximum) and answers 400 with the reason. **No request names a path or a file** (ADR-0030): the folder comes from the settings only.
- **Manifest:** `folders: [{ "id": "heights", "setting": "/heightDataFolder", "reason": "DTED height data for viewsheds" }]`.

## Out of scope (M5)

**GeoTIFF** (owner, Q19: M6), saving a viewshed (a MultiPolygon in the data model, a later CR; the M5 plan's Q5), height profiles, several observers at once, heights under the cursor, hill shading, shipping height data (a CR, as CR-0009), DTED in other layouts than one file per cell.

## Interfaces

| Direction | What |
|---|---|
| Provides | The panel "Terrain"; the endpoints above |
| Requires | `MapView`: `pickPoint`, `createOverlay` with `area` and `label` (SDK 1.4.0 part 6); `fetch` on `ctx.serverBase`; the server's `LocalFolder` (part 6), `Geodesy`, compute workers |
| Objects | None: it reads, creates and changes no objects |

## Dependencies

None beyond the SDKs and React (shared). No library for DTED (ADR-0049 point 6).

## Settings

| Setting | Default | Limits |
|---|---|---|
| `heightDataFolder`: the folder's absolute path, or from M7 one under `%emcc%/` (function 12) | empty (not set); **from M7 `%emcc%/settings/terrain`** | an admin sets it; the Monitor shows it |
| `refractionCoefficient` | 0.13 | 0 to 1 |
| `maxRange` (m) | 50 000 | 1 000 to 200 000 |
| `maxCells` (height cells per request) | 10 000 000 | 100 000 to 100 000 000 |
| `timeoutSeconds` | 30 | 5 to 55 (owner, LE, 2026-11-08: the SDK caps an endpoint and a compute worker at 60 s) |
| `cacheMegabytes` (parsed cells) | 256 | 32 to 2 048 |

Changes apply at once (ADR-0031); a changed folder rebuilds the index. The settings reach every logged-in browser, so the folder's path is visible to them (A8).

## Permissions

`plugin.terrain.use`, "Use the terrain tools": both tools and every endpoint (A2). Without it the panel is hidden and the endpoints answer 403.

## Internet access

**Not allowed.**

## Acceptance criteria

Every position in a test has latitude ≠ longitude (ADR-0007). The unit tests use small DTED cells written for the test; the ESA's Stockholm data is for the live check.

1. **Range:** from [18.0686, 59.3293] to [17.6389, 59.8586] (Stockholm to Uppsala) gives the distance and bearings of `Geodesy.inverse` within 1 mm and 1e-6°; the back bearing is the final + 180° normalised; a pair across the antimeridian gives the short way.
2. **Range on the map:** the line, the end marks and the label at the middle; the panel's four values in the units of function 2; picking again replaces them.
3. **DTED reading:** cells of levels 0, 1 and 2 written for the test, at 59° N (longitude interval twice the latitude's), 72° N (three times), 85° S (six times) and south of 50° (equal), each from its header (T1), read with their heights at known points; a bad checksum, a header that does not match the name, intervals that do not match the zone and a void are handled as function 6 says.
4. **The folder's rules:** the cells are found through `LocalFolder.list` and read through `read` only (`PluginRules` passes; the fake's `calls()` shows them); with the setting empty, missing or changed, the status and the answers say so, and a change rebuilds the index.
5. **Index and levels:** with levels 0, 1 and 2 present, a viewshed uses level 2; with `maxCells` too small for level 2 but enough for level 1, level 1 and the answer says so; too small for all, refused with the cells needed and the cap.
6. **A flat plain:** an observer 2 m above a flat cell sees a disc out to the range, minus what curvature hides: with k 0.13, a 2 m target beyond the horizon distance of both heights is not visible.
7. **A ridge:** a cell grid with one ridge hides the ground behind it, from a known distance on, within one cell.
8. **Against brute force:** on a 200 × 100 test grid with random hills, the visible cells equal a brute-force line-of-sight check of every cell (heights sampled every half cell along the line, bilinear) for at least 99 % of the cells.
9. **The areas:** the result's rings are closed, in longitude, latitude, holes inside their exterior; they pass `overlayProblem`; a result too large is simplified until it fits, and the answer says so.
10. **Limits:** a second viewshed of the same user while one runs is refused (409); one over the timeout is refused (503); the cache never holds more than `cacheMegabytes`.
11. **Permissions:** without `plugin.terrain.use` the panel is hidden and every endpoint answers 403.
12. **Values:** a range over `maxRange`, a negative height or a position out of range is refused with its reason (400).
13. **Partly without data:** a viewshed at the edge of the data says so, and the ground without data is not shown as visible.
14. **Live check** (in the browser, with the ESA's Stockholm data, recorded in the handover): range and bearing across Stockholm; a viewshed from a hill near 59.33 N, 18.07 E with the folder at `…\terrain\dted`, which crosses 18.0 E and so joins the two cells; the same at level 1 by `maxCells`; the folder emptied in the settings and set again.
15. **(M7) Bands:** on a test grid rising evenly from 100 m in the south to 260 m in the north, a circle over all of it gives 16 bands of 10 m each, from south to north, each band's rings closed and passing `overlayProblem`. The colours run from red (lowest) to green (highest), and the highest point is on the north edge with the label "260 m".
16. **(M7) A flat circle** gives one band and the label of its height; a circle partly without data says "partly without data" and leaves that ground out.
17. **(M7) Limits:** a radius above `maxRange` is refused with its reason (400); a height map while the same user's viewshed runs is refused (409); one over `maxCells` at every level is refused with the cells needed.
18. **(M7) In the browser** (the ESA's Sundsvall data): a 10 km circle near 62.39 N, 17.31 E shows 16 coloured bands, the white cross on the highest ground and its label; the cross is 16 px wide before and after a zoom in (RV C); Clear removes it.
19. **(M7) The spike** (function 11): its README has the numbers and a pass or fail per tool, and no product code changed.
20. **(M7) The default** (function 12): a fresh install's `heightDataFolder` is `%emcc%/settings/terrain`; with the fake folder resolved there and the demo cells in it the index finds them; with the setting `%emcc%/../elsewhere` the status is DEGRADED with ECore's reason "outside the emcc folder"; an absolute path works as before. With the folder empty and readable the status is OK with "Height data: 0 cells"; with it missing, or not readable, the status is DEGRADED with ECore's reason (SB A, SC A).

## Open questions for the owner

**M7 (2026-11-11), answered by the owner (RJ A):** Q53 A, Q54 **A**, and H1 to H3 accepted. The questions as asked:
- **Q53, steps or a smooth gradient** (function 10; T-166's row): A, **16 filled steps**, overlay areas, no contract change; B, a smooth gradient, which needs an image overlay in the map view and its own CR part. **Recommended: A.**
- **Q54, the label's form** (function 10): A, "412 m"; B, "412 m AMSL"; C, "Highest: 412 m". **Recommended: B**, since the owner asked for the height above mean sea level and outside users read it without the panel.
- **The assumptions H1 to H3** (with Q63): **H1** the bands at 50 % opacity without outlines; **H2** the hue from red (0°) to green (120°) over the span; **H3** the cross's arms 1/20 of the radius (**changed by the owner, RV C, 2026-11-12:** a fixed 16 px on screen).

**Answered by the owner (2026-11-07):**
- **Q19, GeoTIFF:** skipped in M5, for M6. The alternatives were the plugin's own reader for the common layouts, or a library approved first.
- **Q20, the assumptions A1 to A9:** accepted as written.

**The assumptions (accepted, Q20):**
- **A1:** the panel is in every workspace (View and Simulation), default pane right.
- **A2:** one permission, `plugin.terrain.use`, for both tools.
- **A3:** a viewshed uses the finest level at the observer's point for the whole result, and falls back to a coarser level when the finest exceeds `maxCells` (function 7).
- **A4:** ground within range without height data is not shown as visible, and the answer says "partly without data".
- **A5:** the index is made at start and when the folder setting changes; there is no rescan button.
- **A6:** the defaults: observer and target 2 m, range 10 km, admin maximum 50 km, refraction 0.13, 10 million cells, 30 s, 256 MB.
- **A7:** range and bearing go through the server, since the web SDK has no geodesy.
- **A8:** the folder's path is a normal setting, so every logged-in browser receives it (settings hold no secrets; a path is not one).
- **A9:** the viewshed's look: green fill at 30 %, a thin outline, the observer's point and the range circle.
