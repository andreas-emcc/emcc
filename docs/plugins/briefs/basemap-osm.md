# Brief: basemap-osm

- Status: **Approved (2026-10-05)** · Milestone: M0 · Task: T-020 · Agent: PCA-basemap-osm (Sonnet)
- Updated 2026-10-12: settings changes apply at once ("Settings"), decided by the owner (2026-10-12).
- **Updated 2026-10-27 for M3 (T-077, for T-085): function 4, criterion 10; nothing to build.** Reviewed by the ACA (T-078, `docs/architecture/reviews/m3-briefs.md`, U1 to U7 taken), with the owner's decisions of 2026-10-27, rechecked by the ACA, and **approved by the owner (2026-10-27)**. ADR-0039 (workspaces), the workspace rules in the briefs README ("M3: the reused plugins in a workspace").
- Read also: ADR-0030 (everything works offline; settings may point to internet hosts; it superseded ADR-0014), CR-0013, overview section 2 (tiles through the server).

## Purpose

Provides OpenStreetMap tiles as a background map, **for development and demonstrations only**. It is left out of disconnected installations, where WMS servers are used instead (`basemap-wms`, M4; ADR-0025, overview section 6). The offline background in M1 is `basemap-naturalearth`.

It is also the M0 plugin that proves the **server plugin path** (plugin host, workers, plugin HTTP endpoints, outbound I/O) before M1 depends on it.

## Kind and parts

- Kind: **background map**.
- Properties: **ingoing** (pull: fetches tiles from the internet).
- Parts in M0: **server part (tile proxy) and web part** (owner decision, 2026-10-05).

## Functions (M0)

1. **Web part:** registers one `BackgroundMapProvider` named "OpenStreetMap": XYZ tiles from the plugin's own endpoint (function 2), projection EPSG:3857 only, zoom 0–19, attribution "© OpenStreetMap contributors" with a link to the copyright page. The attribution is required by the OSM licence and must always be visible.
2. **Server part, tile proxy:**
   - Serves `GET /api/plugins/basemap-osm/tiles/{z}/{x}/{y}.png` as a plugin HTTP endpoint, so the browser only talks to the emc2 server (overview section 2).
   - Rejects invalid tile coordinates (z outside 0–19, x or y outside 0 … 2^z − 1) without contacting the upstream.
   - Fetches missing tiles from the configured upstream URL with a timeout, sending a `User-Agent` that identifies emc2, as the OSM tile usage policy requires.
   - **No worker handler ever waits for the upstream.** The watchdog budget per handler call is 5 s by default (overview 4.2), the same as the upstream timeout, so a blocking call would mark the worker HUNG. The handler starts the upstream request through the SDK's outbound HTTP, which ECore runs outside the worker, and returns at once. The response (or the timeout) arrives later as a message to the worker, which then answers the waiting browser request and fills the cache. The SDK v0 design (PDA) provides exactly this. If it cannot, the fallback is a listener (C6), not a longer handler budget.
   - Keeps an in-memory cache of recent tiles (bounded, LRU) in its worker's state. No persistent cache in M0.
   - When the upstream is unreachable, returns an error status quickly; the map stays usable without a background.
3. Must not prefetch or bulk-download tiles (OSM tile usage policy).

## Functions (M3)

Built against SDK 1.2.0 (T-076) and the shell's workspaces (CDA, T-080), with the workspace rules 1 to 9 in the briefs README ("M3: the reused plugins in a workspace").

4. **Every workspace:** the provider is a service of the page, not of a workspace, so the map view offers it in every workspace (`map-view-2d` function 22), and each workspace keeps its own choice of background in its setup. **No code change is expected.**

## Out of scope (M0)

Persistent tile cache for offline use, other tile servers or styles, vector tiles.

## Interfaces

| Direction | What |
|---|---|
| Provides | `BackgroundMapProvider` (web SDK) |
| Requires | Java SDK: plugin HTTP endpoint, outbound HTTP with timeout, worker |
| Objects | None |

## Dependencies

None beyond the SDKs. The upstream call uses the SDK's outbound HTTP, not a third-party HTTP client.

## Settings

| Setting | Default |
|---|---|
| Upstream tile URL template | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` |
| Max zoom | 19 |
| Cache size in tiles | 2 000 |
| Upstream timeout | 5 s |

Changes made in the plugin's entry in the Settings tab apply at once (ADR-0031).

## Permissions

None in M0. From M1 perhaps `plugin.basemap-osm.view`, if background maps become permission-controlled (not decided).

## Internet access

**Allowed** for the server part, to the upstream tile URL only. Declared in the manifest. The web part makes no requests outside the emc2 server. The ITA's offline tests run without this plugin.

## Acceptance criteria

1. The OSM background appears in `map-view-2d` in EPSG:3857, with the attribution always visible.
2. The provider is not offered in other projections (e.g. EPSG:3413).
3. The browser makes no request to any host other than the emc2 server (checked in a browser test).
4. Repeated requests for the same tile within the cache size are served from the cache, without an upstream call (tested with a fake upstream in the plugin test kit).
5. An upstream that does not answer is cut off after the timeout, and does not block other tile requests or other plugins (tested with a fake upstream that never answers).
6. Invalid tile coordinates give an error status without an upstream call.
7. Without internet access, the map stays usable: no background, no error flood (at most one logged warning per minute), and objects are still drawn.
8. The plugin follows the concurrency rules: no threads of its own; the slow upstream call uses the SDK's outbound HTTP with a timeout (C5, C6). The ArchUnit rule set passes.
9. No handler call waits for the upstream: with a fake upstream that answers after 10 s, the worker is never marked HUNG, and other tile requests are still answered from the cache meanwhile.

From M3 (once in the browser, with the shell's workspaces):

10. The OpenStreetMap background can be chosen in Simulation, with its attribution, while View shows another background, and each workspace keeps its choice after a switch and a reload.

## Open questions for the owner

None. Decided 2026-10-05: tile proxy in the server part (option B).
