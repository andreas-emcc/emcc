# terrain

Three terrain tools for the operator (ADR-0049, T-142; the height map T-166), in one panel "Terrain" (default pane: right, in every workspace). Brief: [`docs/plugins/briefs/terrain.md`](../../docs/plugins/briefs/terrain.md). Built against SDK 1.8.0 (`sdkVersion` `^1.8.0`): part 6's local folder and the overlay's `area` and `label` (1.4.0), M7 part H's `%emcc%/` folder setting (1.6.0), which the default folder needs, and from M8 (T-204) the manifest's `icon` (Mountain), the panel's icon and the settings form's hints (1.8.0 parts C and D).

## What it does

- **Range and bearing** between two points the user picks on the map: the geodesic distance and the initial, final and back bearings on WGS84, by the SDK's geodesy on the server. Shown as a line, an end mark at each end and a label at the middle (`63.77 km  345.2°`); the panel lists the four values and both positions. It needs no height data.
- **A viewshed** from a point: the ground an observer at a height above the ground sees, for a target at a height above the ground, up to a range. Shown as the visible areas (green, 30 % opacity, thin outline), the observer's point and a thin circle of the range. The answer says which DTED level and how many cells it read, how long it took and "partly without data" when some ground in range has no height data (that ground is not shown as visible).
- **A height map in a circle** (M7, T-166): the user draws a circle (press on the centre, drag to the radius; 100 m up to the admin's `maxRange`, else "At most 50 km."). The server divides the ground between the lowest and the highest point inside it into **16 equal bands** of height (one band when the ground is flat) and the map shows them filled at 50 % with no outline, from **red (lowest) through yellow to green (highest)**, the circle's outline, a **white cross** on the highest ground (two lines, each **16 pixels** long **at every zoom**: owner, 2026-11-12, RV C) and its height above mean sea level as a label just above it, **"412 m"**. The cross and the label are in an overlay of their own, set after the bands' so that they are drawn above them (the map view stacks a plugin's overlays in the order they were first set; the SDK promises no order, so the plugin clears and sets its cross overlay after the bands each time; owner, 2026-11-12, SN A), and it is set again when the map is zoomed (Web Mercator's scale follows the latitude, so the pixel size is corrected for the cross's latitude; in another projection the map centre's scale is used). The panel lists the highest and the lowest height, the level and a 16-step legend. Ground without data is left out and the answer says "partly without data". It has its own overlay, so it does not use the viewshed's caps; a new height map replaces the shown one.
- The results are the user's own overlay: shown in this browser only, never shared or saved, gone on a reload or at **Clear** (ADR-0049 point 8).

### Height data

DTED levels 0, 1 and 2 (MIL-PRF-89020B) from one folder, `%emcc%/settings/terrain` unless the admin sets another: one file per 1 x 1 degree cell, `e<lon>/n<lat>.dt<level>` (`w` and `s` too, any case). GeoTIFF is M6. Nothing is shipped with the plugin: the demo data (the Sundsvall zip, CR-0037) is unpacked into the emcc folder's `settings/terrain` by the user, and works without a setting; a release without demo data ships an empty folder and gives "Height data: 0 cells", status OK (owner, 2026-11-12).

**The folder setting** is either an absolute path, as before (for example shared storage), or a value that starts with `%emcc%/` (`%emcc%\` too), which ECore replaces with the emcc folder and resolves below it (SDK 1.6.0 part H, T-157). A result that leaves the emcc folder (`%emcc%/../elsewhere`, a link included) is not readable: ECore's reason, "outside the emcc folder", reaches the Monitor status ("Height folder not readable: outside the emcc folder"), the 503 and the panel's notice. The plugin resolves nothing itself: it reads through `LocalFolder` as before, and the Monitor shows the setting as typed and the folder it resolves to.

- The folder is read only through the SDK's `LocalFolder` (ADR-0049 point 4): the plugin lists the folder and its `e…`/`w…` subfolders, reads the first 3 428 bytes of each file for the **index** (made at start and when the folder setting changes; a cell added later needs a change of the setting or a restart), and reads a whole cell when a viewshed needs it. It queues its own calls so that at most 8 are in progress, and a call answered `BUSY` waits for one to finish (the ACA's R2). No request names a path or a file.
- **Spacing comes from each cell's header** (the user header, UHL), checked against the standard's latitude zone table (the ACA's T1): the longitude interval is the latitude interval times 1 up to 50 degrees, 2 from 50 to 70, 3 to 75, 4 to 80 and 6 to 90, north or south. A file is **skipped with a log line** (and counted in the status) when its header does not match its name, its intervals or counts do not match its zone or level, its size is not what the header promises, or (when it is read) a record's checksum is wrong. A void (-32767) is no data.
- **One level per viewshed or height map:** the finest level with a cell at the observer's point; when its raster of the range's bounding box needs more height cells than `maxCells`, the next coarser level that fits is used and the answer says so; when none fits, the request is refused with the cells it needs and the cap (413).

### The line of sight

A target is visible when the straight line from the observer's eye (the ground at the observer plus the observer height) to the target's top (the cell's ground plus the target height) passes above every height between them. A height at distance d is lowered by `d² / (2 R) · (1 − k)`, R = 6 371 000 m, k the refraction coefficient; heights between the samples are bilinear. The vertical reference cancels out, since one data set is used.

The algorithm is a radial sweep: rays leave the observer so close together that two neighbours are at most half a cell apart at the maximum range, the ground is sampled every half cell along each, the largest elevation slope so far is the horizon, and every raster node takes the verdict of the sample nearest to it. It runs on compute workers. The tests compare it with a brute-force check of every cell (heights sampled every half cell along its line, bilinear): it agrees for at least 99 % of the cells (criterion 8).

The visible nodes are traced into rings along their cell edges (holes inside their exterior, exteriors counter-clockwise), simplified with a tolerance of one cell (Douglas-Peucker), and, while the result does not fit the overlay's caps (`OVERLAY_MAX_ITEMS` and `OVERLAY_MAX_POSITIONS` less 100 items and 2 000 positions for the circle, the observer's point and the range and bearing readout), with twice, four times and so on that tolerance; the answer says it did.

## Settings

| Name | Default | Meaning |
|---|---|---|
| `heightDataFolder` | `%emcc%/settings/terrain` | The DTED folder: an absolute path, or one under `%emcc%/` (the emcc folder; ECore resolves it). An admin sets it; it reaches every logged-in browser (a path is not a secret). Empty: not set. A change rebuilds the index |
| `refractionCoefficient` | 0.13 | k in the curvature term, 0 to 1 |
| `maxRange` | 50 000 | The longest range of a viewshed and the largest radius of a height map circle, metres, 1 000 to 200 000 |
| `maxCells` | 10 000 000 | The most height cells (raster nodes in the range's bounding box) one viewshed or height map may need, 100 000 to 100 000 000 |
| `timeoutSeconds` | 30 | How long a viewshed or height map may take, reading the data included, 5 to 55 (the SDK caps an endpoint's timeout and a compute worker's budget at 60 s) |
| `cacheMegabytes` | 256 | The memory of the cached cells together, 32 to 2 048; the least recently used go first |

The settings form (SDK 1.8.0 part D, T-204) has two groups, **Height data** (the folder, the cache) and **Viewshed and height map** (k, the longest range, the most cells, the time limit), a hint of at most 80 characters under every field (the longer description is behind the info button) and units (m, cells, s, MB).

Changes apply at once. A value outside its limits (which ECore's schema check should not let through) is replaced by the nearest allowed one.

## Messages and services

- **Provides / requires:** provides nothing. Requires the map view (`emc2.map-view`: `pickPoint`, `createOverlay` with `area` and `label`). Uses the coordinate service (`emc2.coordinates`) for positions in the user's format, else decimal degrees. Server side: `LocalFolder` (manifest `folders`: id `heights`, setting `/heightDataFolder`), `Geodesy`, compute workers.
- **Endpoints** (`/api/plugins/terrain/…`, each needs `plugin.terrain.use`; errors are `{ "error": "…" }`):

  | Endpoint | Body | Answer |
  |---|---|---|
  | `POST /range` | `{ "from": [lon, lat], "to": [lon, lat] }` | `{ distance, initialBearing, finalBearing, backBearing, midpoint }` (metres, degrees from true north, the geodesic's midpoint for the label) |
  | `POST /viewshed` | `{ "observer": [lon, lat], "observerHeight": m, "targetHeight": m, "maxRange": m }` | `{ areas, level, cells, heightCells, simplified, leftOut, positions, partlyWithoutData, millis, notes }` |
  | `POST /heightmap` | `{ "center": [lon, lat], "radius": m }` | `{ bands: [{ index, lowest, highest, areas }, …], highest: { position, height }, lowest, level, cells, heightCells, simplified, leftOut, positions, partlyWithoutData, millis, notes }` (heights in metres above mean sea level; the bands from the lowest) |
  | `GET /status` | – | `{ state, reason, cells, levels, skipped, area, cacheCells, cacheBytes, running }` |

  Refusals: 400 a value out of range (reason given), 403 no permission, 404 no height data at the observer's point or the circle's centre (or, for a height map, none inside the circle), 409 "a viewshed is already running for you" or "a height map is already running for you" (one of the two per user at a time), 413 over `maxCells` with nothing coarser that fits, 503 the folder is not set or not readable, or over the timeout.
- **Server workers:** `heights` (owns the index, the cache, the queue of folder calls and who is computing; mailbox 1 000), `viewshed-1` and `viewshed-2` (compute workers, mailbox 10), `range`. Messages are immutable: a cell travels as its `Bytes`.
- **Monitor status:** OK with "Height data: n cells (level 2: a, level 1: b, level 0: c)" (n may be 0: a readable folder without cells is not an error) or "Height folder not set"; DEGRADED with "Height folder not readable: <ECore's reason>".
- **Web:** one panel, id `terrain`, icon Mountain, default pane right, in every workspace, with no heading of its own (the shell's head shows the title) and **Clear**, which acts on all three tools' results, in the panel's foot; its own overlay on the map view; no services provided, no topics.

## Permissions and internet

- `plugin.terrain.use`, "Use the terrain tools": both tools and every endpoint. Without it the panel is not shown and the endpoints answer 403.
- **Internet: not allowed.** The server part reads only the folder the admin set; the browser talks only to the emc2 server.

## Known limits

- DTED only (GeoTIFF is M6); one file per cell, in the layout above; complete 1 x 1 degree cells only.
- A viewshed or a height map stays at least half a degree from a pole (400 otherwise); the longitude grid is the observer's (or the centre's) cell's.
- The height map's bands are traced and simplified one by one, to the same tolerance, so neighbouring bands can show a seam of up to a cell where their edges were simplified differently; a node counts as inside the circle when its distance on a sphere is at most the radius (within 0.5 % of the geodesic). Heights at the grid points are snapped to a micrometre so that rounding does not move a point across a band's edge.
- No data along a ray is skipped, not a blocker: ground beyond a void is judged by the data there ("partly without data" says so).
- Simplification (Douglas-Peucker) does not guarantee that rings never cross; the overlay does not need it.
- Memory: a viewshed holds about 5 bytes per raster node while it is traced (a byte of state, an int per vertical edge): 10 million nodes (the default cap) is about 50 MB, 100 million (the schema's maximum) about 500 MB, besides the cells themselves, which are shared with the cache.
- On an ECore without SDK 1.4.0 part 6 (no local folders) the server part reports "Height folder not readable: ECore does not provide local folders yet" and serves range and bearing only.
