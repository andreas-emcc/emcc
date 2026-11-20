# basemap-osm

OpenStreetMap tiles as a background map, **for development and demonstrations only**. It is left out of disconnected installations (those use WMS servers, `basemap-wms`, M4). Task T-020; brief: `docs/plugins/briefs/basemap-osm.md`.

## What it does

- **Web part:** provides one `BackgroundMapProvider` named "OpenStreetMap" (id `osm`) under the service key `emc2.background-map`: XYZ tiles, EPSG:3857 only, zoom 0 to `maxZoom` (default 19), 256 px tiles. The tile URL is the plugin's own endpoint on the emc2 server, `/api/plugins/basemap-osm/tiles/{z}/{x}/{y}.png`; the browser contacts no other host. The attribution "© OpenStreetMap contributors" (link to `https://www.openstreetmap.org/copyright`) is part of the provider; the map view must always show it (OSM licence).
- **Server part (tile proxy):** serves `GET /api/plugins/basemap-osm/tiles/{z}/{x}/{y}.png`.
  - Invalid coordinates (z outside 0 to `maxZoom`, x or y outside 0 to 2^z - 1, anything that is not a plain ASCII number) get `400` without an upstream call.
  - A tile in the in-memory cache (LRU, `cacheTiles` tiles, lost on restart) is answered at once.
  - A missing tile is fetched from the upstream with the SDK's outbound HTTP. **No handler waits for the upstream**: the call starts and the handler returns; the answer (or the timeout) arrives later as a message, and only then are the waiting browser requests answered.
  - Requests for a tile that is already being fetched share that one fetch.
  - No prefetching: only tiles a browser asks for are fetched.

### Load and failure behaviour

| Situation | Answer |
|---|---|
| Cache hit | `200`, `Cache-Control: public, max-age=3600` |
| Miss, upstream answers a PNG | `200`, cached |
| Upstream `404` | `404`, not cached |
| Upstream error status, a body that is no PNG, or a failed call | `502` |
| Upstream gives no answer within `upstreamTimeoutSeconds` | `504` |
| More misses than 8 fetches at once | The rest wait in a queue (fetches start as slots free up) |
| Waited more than 3 s for a slot, or more than 256 tiles waiting, or 32 requests for one tile | `503` with `Retry-After: 1` |
| Mailbox full (1 000 requests) | `503` from ECore |

All error replies carry `Cache-Control: no-store`.

**Circuit breaker.** After 5 failures in a row (no answer, error status, no PNG) the proxy answers `502` at once, without calling the upstream, for 30 s, so a missing internet connection costs no 5 s timeout per tile and a map that is panned does not hammer a failing server. The tiles still waiting for a slot are answered `502` at the moment it opens. After 30 s one request is let through to find out whether the upstream is back; the others still fail fast until it answers. Any successful answer closes the breaker. The map stays usable without a background.

**Status and log.** The plugin is `OK` when ready, `DEGRADED` ("upstream tile server unreachable: ...") while the breaker is or was open, and `OK` again after the next successful tile. Failures are logged as `warn` **at most once per minute** (with the number of failures not logged); the return of the upstream is logged once as `info`.

## Settings

Declared in `plugin.json`. A user with `settings.admin` changes them in the settings view; ECore checks each value against the schema and refuses a bad one before it reaches the plugin. **A change applies at once, without a restart** (SDK v1 `subscribeSettings`, owner decision 2026-10-12):

- Everything that starts after the change uses the new values; **fetches already running finish with the old ones** (their tile is not cached if the upstream URL changed).
- A new `upstreamUrl` empties the cache (the tiles may look different) and forgets what was learned about the old upstream: the circuit breaker is closed again and the new upstream is tried at once.
- A smaller `cacheTiles` drops the least recently used tiles; a lower `maxZoom` applies to the next request, also for tiles that are cached.
- A value the plugin cannot use although it fits the schema (e.g. an `upstreamUrl` without `{y}`) is refused: the old values stay, the plugin is `DEGRADED` ("setting change refused, the old values stay: ...") and logs one warning; the next good change clears it.
- **A setting that is missing from the document takes its default** from the table below (owner, 2026-10-30, T-122), at a change and at start: ECore replaces the settings as a whole and fills in no defaults, so a script's `PUT` or settings stored by an older version may lack a property. A value that is present but wrong is still refused as above.
- Bad settings **at start** make the plugin `FAILED` ("bad setting: ..."); it answers `503` until a good change arrives. A restarted worker reads the settings in force at that moment, not the first ones.
- **A new upstream host works at once, also when it is not in `internet.hosts`** (owner, 2026-10-18, CLAUDE.md section 4): the manifest's `internet` field only declares that the plugin goes online (its default host and why); ECore does not check the hosts a server part calls. The host comes only from this setting, which only a user with `settings.admin` changes; never from a tile request (the tile numbers are the only part of a request that reaches the URL, and only as whole numbers). An upstream that cannot be reached gives `502`, the breaker opens after five and the plugin is `DEGRADED`, as before.
- A browser request for a tile that is **already being fetched** when the URL changes still joins that fetch and gets the old upstream's tile (not cached); the window is at most the upstream timeout.
- The web part follows `maxZoom` too, but the map view reads a background's `maxZoom` only when it builds its tile layer: the new value reaches the map the next time the background or the projection is selected, or after a reload. (The SDK has no "provider changed" signal.) Checked in the real system through the settings view (2026-10-13): an open map kept asking for the old maximum level (the server answered `400`) until the background was switched away and back; after that it asked only for the new maximum.
- **The browser keeps tiles for an hour** (`max-age=3600`, see below). After a new `upstreamUrl`, tiles the browser already has are not asked for again, so they stay the old upstream's tiles until they expire; only tiles it has not loaded come from the new upstream. (A reload was not tried; a normal reload may keep them, a hard reload should fetch them again.)

| Name | Default | Meaning |
|---|---|---|
| `upstreamUrl` | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | Upstream template; must contain `{z}`, `{x}`, `{y}` and be an absolute http or https URL. Its host need not be in `internet.hosts`: that field declares that the plugin goes online (its default host and why); it does not limit the upstream. |
| `maxZoom` | 19 | Highest zoom served and offered to the map view (0 to 19). |
| `cacheTiles` | 2 000 | Tiles in the cache (1 to 10 000; about 20 KB per tile). |
| `upstreamTimeoutSeconds` | 5 | Cut-off of one upstream request (1 to 30). |

The settings form (generated by the shell from the schema, SDK 1.8.0 part D; T-204) has two groups, **Upstream** (`upstreamUrl`, `upstreamTimeoutSeconds`) and **Tiles served** (`maxZoom`, `cacheTiles`), a short hint under `upstreamUrl` and `cacheTiles`, and the units `tiles` and `s`. The manifest's icon is `Map`. These are annotations (`x-emc2`): validation is unchanged.

The endpoint timeout is fixed at 35 s (the longest upstream timeout the settings allow, 30 s, + 3 s queue wait + 2 s), because the endpoint is registered once and the upstream timeout can change. The proxy answers on its own after the upstream timeout (at most 33 s), so ECore's `504` is only a safety net (a request that never reaches the worker, e.g. after a worker restart, waits the full 35 s for it).

## Messages and services

- **Provides** (web): `emc2.background-map` (`BackgroundMapProvider`). Requires no service.
- **Endpoint** (server): `GET /tiles/{z}/{x}/{y}.png`, answered by the worker `tiles`.
- **Worker `tiles`** (`TileMsg`): `Get(EndpointRequest)` from the endpoint, `Fetched(TileKey, HttpResult)` from the outbound call, `Tick` from one timer every 500 ms (queue wait limit, breaker, warning interval), `SettingsChanged(JsonObject)` from the settings subscription. Mailbox 1 000, `dropNewest`; restartable. After a restart the cache is empty and answers to fetches of the old instance are ignored.
- Outbound: `GET` to the upstream, at most 8 at once (the SDK allows 16 per plugin; the OSM tile usage policy asks for modest use), `User-Agent: emc2-basemap-osm/0.1 (...)`, timeout as above.
- No topics, no objects, no change requests.

## Permissions and internet

- **Permissions:** none. The tile endpoint serves public tiles and has no `requires(...)`: every user, also one without any permission, gets a tile (tested with `ctx.call(path, user)`). `plugin.basemap-osm.view` would be a decision for the owner if background maps become permission-controlled.
- **Internet:** the server part goes online to fetch tiles: by default from `tile.openstreetmap.org`, or from the host the admin sets (the manifest declares the default host and the reason; since M2 ECore does not limit the hosts). The web part makes no request outside the emc2 server (Content-Security-Policy `'self'`). The only external address in the web part is the attribution link, which the user clicks. The ITA's offline tests run without this plugin.

## Known limits

- **Development and demonstrations only.** The OSM tile servers are a shared community resource: do not use this plugin for production or heavy load (OSM tile usage policy). The proxy fetches only what a browser asks for and caches in memory, but it is not a tile cache for offline use (out of scope in M0).
- **The `User-Agent` is fixed** (`emc2-basemap-osm/0.1 (emc2 development and demonstration; OSM tile usage policy)`). The OSM policy asks for a way to contact the operator; the owner decided (2026-10-09) not to add a setting for it.
- No redirects (the SDK does not follow them): an upstream that redirects gives `502`. Upstream `Cache-Control` and `ETag` are ignored; replies use a fixed `max-age=3600`.
- The cache is per server process, in memory, and lost on restart or worker restart.
- Real OSM tiles need internet access and are not part of the offline tests. Browser-level checks (the attribution on screen, no request to another host, objects still drawn without a background) need `map-view-2d` and belong to the ITA's browser tests; the unit tests cover what the plugin itself provides.
