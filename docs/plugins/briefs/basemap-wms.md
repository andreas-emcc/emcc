# Brief: basemap-wms

- Status: **Draft (2026-10-20)**, with the owner's answers of 2026-10-20 (below) · Milestone: M4 (owner, 2026-10-22: M3 became the Simulator) · Task: T-071 · Agent: PCA-basemap-wms (new)
- Read also: **ADR-0035 (WMS background maps)**, ADR-0030 (everything works offline; outbound HTTP), ADR-0031 point 2 (a plugin's entry in the Settings list), ADR-0009 and ADR-0025 (background maps), CR-0022 (an `internet` declaration without hosts), CR-0023 (the `wms` source and a plugin's own settings panel), the `basemap-osm` brief (the same server path for tiles), `external/geoserver/README.md` (the test server).
- **Updated 2026-11-15 for SDK 1.8.0 (T-204; CR-0043 part D): the SDK lines.** The plugin declares `^1.8.0` since T-204, for part D's settings hints and the manifest's `icon` (`sdk-v1.md`, "SDK 1.8.0", part D); what it needs from 1.3.0 is unchanged.
- **Updated 2026-10-30 for SDK 1.3.0 (CR-0028 part 1): the SDK lines** (built against, Interfaces, the manifest's `sdkVersion`, the order of building). For the owner's approval with the brief.
- Built against **SDK 1.3.0** (CR-0028 part 1, which is CR-0023, approved by the owner 2026-10-30; `docs/plugins/sdk-v1.md`, "SDK 1.3.0", step 2); CR-0022 is in SDK 1.2.0. Where this brief names an addition of CR-0023, the SDK's TSDoc wins. **Built after** the shell's settings panel (CDA, T-073) and the map view's WMS drawing (PCA-map-view-2d, T-072): `ctx.ui.setSettingsPanel` was optional in the SDK until the shell had it (owner, 2026-10-30, Q3), and is required since 2026-10-31. **Since T-204 (2026-11-15) against SDK 1.8.0** as well, for part D's hints and the manifest's `icon`.

## Purpose

Shows background maps from **WMS servers**, the ones disconnected installations run, polar projections included (`requirements.md`; ADR-0035). The browser talks only to the emc2 server: the plugin's server part fetches the maps from the WMS server its settings name and passes them on, as `basemap-osm` does with tiles (ADR-0030).

A background is **one server, one or more of its layers in a chosen order, and a name**. An admin configures the servers and backgrounds in the plugin's own settings panel, choosing each background's layers from the server's list. Natural Earth (`basemap-naturalearth`) stays the background that always works offline.

## Kind and parts

- Kind: **background map**. Properties: **ingoing** (pull: fetches maps from WMS servers).
- Parts in M4: **server part** (capabilities, map pass-through) **and web part** (background providers, the settings panel).

## Functions (M4)

1. **Server part, capabilities:**
   - Reads each configured server's capabilities (`GetCapabilities`) in the server's WMS version: at start, after every accepted settings change, every hour, and when the settings panel asks for the layers again (function 6).
   - Takes from them each named layer's name, title and projections, with the projections a layer inherits from its parent layers (WMS 1.1.1 `SRS`, 1.3.0 `CRS`). A named layer with child layers (a layer group, e.g. GeoServer's `background`) is a layer like any other.
   - **A background is offered in the projections that every one of its layers lists**, and only in those (ADR-0035 point 3). Projections match by their codes (e.g. `EPSG:3413`).
   - Parses the XML with the JDK's parser, **with DTDs and external entities switched off**. Nothing else is fetched to read it. **A bare DOCTYPE is accepted** (owner, 2026-10-31: EX), as in GeoServer's WMS 1.1.1 capabilities: a `<!DOCTYPE …>` with no internal subset, whose DTD is never loaded. A DOCTYPE with an internal subset (`[ … ]`), or any entity declaration or reference beyond XML's five predefined ones, is still refused.
   - A server that cannot be read, a background whose server is not configured, and a configured layer the server does not have are named in the plugin's status. The background is not offered until the next read succeeds. Reads that fail are retried after one minute, then less often (at most every 15 minutes).
2. **Server part, maps:** `GET /api/plugins/basemap-wms/map/{background}` passes a map request on to the background's server and the image back.
   - The map view adds the WMS `GetMap` parameters (CR-0023). The server part **checks each one and builds its own request** from the server's URL in the saved settings and the checked values. It never forwards the browser's query, a parameter it does not know, or any other WMS request (ADR-0035 consequences).
   - Checks, without contacting the server; any failure answers `400`:
     - the background is configured and offered;
     - `SERVICE` is `WMS`, `REQUEST` is `GetMap`, and `VERSION` is the server's version;
     - `LAYERS` is exactly the background's layers, in their order;
     - `CRS` (1.3.0) or `SRS` (1.1.1) is one of the background's projections;
     - `BBOX` is four finite numbers, each minimum below its maximum;
     - `WIDTH` and `HEIGHT` are whole numbers from 1 to 4 096;
     - `FORMAT` is the background's format, and `TRANSPARENT` is the background's `transparent` (`TRUE` or `FALSE`);
     - `STYLES` is empty (the server's default styles);
     - no parameter appears twice.
   - Parameter names, and the values of `SERVICE`, `REQUEST` and `TRANSPARENT`, are matched ignoring case, as WMS asks (OpenLayers sends `TRANSPARENT=true`). `EndpointRequest.query` is case-sensitive, so the plugin matches the names itself; the same name twice in different case counts as twice.
   - **The request it builds** is the saved server's URL with these parameters added, always in this order: `SERVICE`, `VERSION`, `REQUEST`, `LAYERS`, `STYLES`, `FORMAT`, `TRANSPARENT`, `CRS` or `SRS`, `BBOX`, `WIDTH`, `HEIGHT`. `BBOX` is written from the checked numbers in plain decimal notation (never `1.0E7`). A fixed order keeps the tests exact (the test kit's fake upstream matches whole URLs).
   - Answers `200` with the server's image when its type is the background's format, with `Cache-Control: private, max-age=3600`, so the browser caches it. There is no tile cache in M4 (ADR-0035 point 7).
   - Answers `502` for anything else: a WMS service exception (an XML answer, even with status `200`), another status, a timeout, or a failed call.
3. **Server part, the backgrounds for the web part:** `GET /api/plugins/basemap-wms/backgrounds` answers:
   - `backgrounds`: each offered background's id and its projections; backgrounds that are not offered are left out;
   - `reading`: true while a capabilities read is under way;
   - `version`: a number that rises whenever the offered set or a background's projections change.

   Everything else about a background (name, layers, format, transparency, mode, the server's version, attribution) is in the settings, which every browser has.
4. **Server part, the layers for the settings panel:** `GET /api/plugins/basemap-wms/servers/{server}/layers` answers the saved server's layers from its last read: name, title and projections, in the capabilities' order, with the time of the read or the reason it failed.
   - Needs `settings.admin` (`Endpoint.get(…).requires(…)`; ECore answers `403`), like every read for the settings (ADR-0035 consequences).
   - With `?refresh=true`, it reads the capabilities again before answering.
   - The server is the one the **saved** settings name, by its id. The request carries no address (ADR-0030).
5. **Web part, the backgrounds:** registers one `BackgroundMapProvider` per offered background (function 3):
   - id `basemap-wms.<background id>`, and from `ctx.settings` its name and its attribution, always visible;
   - its projections, the only thing taken from function 3;
   - a `wms` source (CR-0023) with the URL `${ctx.serverBase}map/<background id>` and, from `ctx.settings`, the background's layers, the server's version, the format, transparency, and tiles or a single image.

   **Following changes** (owner, 2026-10-20: changes apply at once). The server part reads the capabilities after a settings change, and on its own after an outage or the hourly read, so the browser asks:
   - at start, without `activate` waiting for the answer (the shell's activation timeout is 10 s);
   - after every accepted settings change;
   - every 5 s while `reading` is true;
   - every 60 s while the page is visible.

   When `version` or the settings changed, it removes the providers that went or changed and adds the new ones (`services.provide` returns an `Unsubscribe`, CR-0023). The map view falls back as usual when the shown background goes.
6. **Web part, the settings panel** (CR-0023: `ctx.ui.setSettingsPanel`; ADR-0035 point 4): the plugin's entry in the Settings list shows this panel **instead of** the generated form (owner, 2026-10-20). It edits the whole settings and saves them with `save(values)`. ECore validates them and checks `settings.admin`, and the panel shows the problems at their fields. It holds:
   - **Servers:** add, edit and remove. Each has a name, a URL, the WMS version and a timeout.
   - **Backgrounds:** add, edit and remove. Each has a name, a server, tiles or a single image, the format, transparency (PNG only), and the attribution text and link.
   - **What the schema cannot check, the panel does before it saves:** it makes each id itself (from the name, unique), refuses a background whose server is not in the list, and refuses removing a server that a background still uses. The server part still names any such problem in its status (Settings, below), for values saved another way.
   - **The background's layers,** as a checkbox list of its server's layers (function 4), with each layer's title, name and projections.
     - The list appears once the server is saved (ADR-0035 consequences). Until then the panel says "Save the server to see its layers".
     - "Read the layers again" asks with `?refresh=true`.
     - A chosen layer the server no longer has stays in the list, marked missing, until the admin removes it.
   - **The drawing order** (owner, 2026-10-20): the chosen layers are listed in their drawing order, top-most first, as the layer panel does. "Move up" and "Move down" change it, also from the keyboard. They are stored bottom first, which is the order WMS draws `LAYERS` in.
   - **The projections** the background is offered in: those every chosen layer lists, as function 1 computes them.
   - "Save" and "Discard" act on the whole settings. While changes are unsaved, the panel reports them (`markUnsaved`, CR-0023), so the shell marks the entry as it does for a form.
   - **Another admin's save** while changes are unsaved: the panel keeps its changes, says that the settings were changed by someone else, and offers "Take their values", as the generated form does (`web/README.md`, "Settings"). The panel's own save is not such a change. Unsaved changes last as long as the page.

   It uses the shared components and the design tokens (ADR-0029), and needs no styling of its own beyond layout.
7. **WMTS is a stub** (ADR-0035 point 5; owner, 2026-10-20: a seam and a one-value setting):
   - each server has `protocol`, whose only allowed value in M4 is `"wms"`, so that adding `"wmts"` later is a compatible change of the settings schema;
   - the server part reads capabilities and fetches maps behind one interface of its own, with only the WMS implementation.

   Nothing about WMTS is visible to users.

## Out of scope (M4)

WMTS beyond the stub, servers that need a login (ADR-0035 point 6), a tile cache (point 7), redrawing a WMS map in a projection its server does not list (point 3), `GetFeatureInfo`, legends, styles other than the default, time and elevation dimensions, and users choosing layers.

## Interfaces

| Direction | What |
|---|---|
| Provides | `BackgroundMapProvider` with a `wms` source (web SDK, CR-0023), one per offered background |
| Requires | Java SDK: plugin HTTP endpoints (one with `settings.admin`), outbound HTTP with timeout, a worker, settings at runtime, a timer (the hourly read). Web SDK 1.3.0 (declared `^1.8.0` since T-204, for part D's hints and `icon`): the `wms` source, `services.provide` with its `Unsubscribe`, `ctx.ui.setSettingsPanel`; the shared components. Tests: the test kit's `wmsGetMapUrl` (the query strings the server part's tests copy), `settingsPanelProps()`, `settingsSaves` and the `saveSettings` option |
| Objects | None |

## Dependencies

None beyond the SDKs. The calls use the SDK's outbound HTTP, and the XML is read with the JDK's own parser.

## Settings

Changes apply at once (ADR-0031). The settings reach every logged-in browser, so they hold no secrets and no logins (ADR-0035 point 6).

| Setting | Default | Notes |
|---|---|---|
| `servers` | `[]` | Each: `id` (lower case, digits and `-`, unique), `name`, `url` (the server's `http` or `https` address for WMS requests, e.g. `http://127.0.0.1:8280/geoserver/ows`; no user name or password in it, which the schema refuses (ADR-0035 point 6); it may hold a query such as `?map=…`, to which the server part adds its parameters, and a parameter of function 2 already in that query is replaced by the server part's value), `protocol` (`"wms"` only, function 7), `version` (`"1.3.0"` (default) or `"1.1.1"`), `timeoutSeconds` (1 to 20, default 8: below the map endpoint's timeout of 30 s, Internet access below) |
| `backgrounds` | `[]` | Each: `id` (as above, unique), `name`, `server` (a server's id), `layers` (1 to 20 layer names, bottom first; no comma in a name, since `LAYERS` is a comma list), `mode` (`"tiles"` (default) or `"image"`, ADR-0035 point 2), `format` (`"image/png"` (default) or `"image/jpeg"`), `transparent` (default `false`, PNG only), `attribution` (`text`, and an optional `url`) |

**Empty by default** (owner, 2026-10-20): there is no server and no background until an admin adds one. Tests and demonstrations set the GeoServer test server in their own settings.

The schema checks the form. What it cannot check (unique ids, a background's server exists, the layers exist) the settings panel checks before it saves (function 6), and the server part names any such problem in the plugin's status, since ECore has accepted the values by then.

## Permissions

- Map requests (function 2) and the backgrounds list (function 3) need a login only (ADR-0035 consequences).
- The layer list (function 4) needs `settings.admin`.
- Settings changes need `settings.admin`; ECore checks it on save.
- The plugin declares no permissions of its own.

## Internet access

**Allowed** for the server part: it calls the servers its saved settings name, and only those (ADR-0035 consequences, for the SRA). Hosts never come from a browser request, a message or an object's data (ADR-0030). It sends only `GetCapabilities` and the `GetMap` requests of function 2, with a `User-Agent` that names emc2 and the plugin.

- **Manifest:** declares `internet` with `"hosts": []` (CR-0022: no default host, since every host comes from the settings) and the reason "WMS background maps from the servers an admin configures". It declares `sdkVersion` `^1.8.0` (`^1.3.0` until T-204, 2026-11-15) and, from 1.8.0, an `icon`.
- **The SDK's limits apply** (ADR-0035 consequences):
  - **No redirects:** a server that redirects answers as a failure (the SDK does not pass the new address on), and the status says that the server redirects, so that the admin enters the address it redirects to.
  - **10 MB per answer.**
  - **At most 16 calls at a time:** further map requests wait in the worker, in order, up to 200; beyond that the endpoint answers `503`. The map endpoint's timeout is 30 s (`Endpoint.timeout`). A waiting request whose 30 s have passed is dropped without a call, since ECore has already answered `504`.
- **Offline is normal.** An unreachable server makes its backgrounds unavailable and is named in the status, with at most one logged warning per minute per server. The map stays usable with another background, and objects are still drawn.

The web part makes no request outside the emc2 server. The ITA's offline tests run without this plugin (it declares `internet`).

## The test server

The ESA's GeoServer (T-070; its sheet `external/geoserver/README.md`) is the WMS server to develop and test against.
- Use it only through its commands: `node external/geoserver/start.mjs`, `status.mjs`, `logs.mjs`, and `stop.mjs` for a GeoServer you started yourself. Never read or change its install folder (`CLAUDE.md` section 8).
- It runs on **Windows only**, on loopback, port 8280.

What it offers:
- **URL:** `http://127.0.0.1:8280/geoserver/ows` (also `/geoserver/wms`), WMS 1.1.1 and 1.3.0, anonymous reading; no login needed.
- **Layers:** 22 layers and layer groups, all `emc2:<name>`. The groups `emc2:background`, `emc2:background-satellite` and `emc2:background-polar` are each a full background map.
- **Projections:** EPSG:4326, EPSG:3857, EPSG:3413 and EPSG:3031, with a bounding box for each layer.

What the plugin must cope with:
- **Boxes inside ±180.** GeoServer does not wrap a box that crosses the antimeridian. The map view keeps its requests inside the projection's extent (CR-0023), and the server part passes boxes on unchanged.
- **WMS 1.3.0's axis order in EPSG:4326** is latitude, longitude: `BBOX=minLat,minLon,maxLat,maxLon`. The map view sends it that way (CR-0023). The server part passes it on and must not swap it. Criterion 4 tests it.
- **EPSG:4326 is not one of the map view's default projections** (EPSG:3857, EPSG:3413, EPSG:3031). A test of criterion 4 adds it to the map view's configuration.

Plugin tests use the Java test kit's fake upstream, with small capabilities documents written for the tests in both versions, so that they run without GeoServer and on Linux. GeoServer is for trying it for real (the ITA has its own small WMS test double; ADR-0035 consequences).

## Acceptance criteria

1. **A background in Web Mercator:** with GeoServer, a background of `emc2:background` is offered in EPSG:3857 and drawn, as tiles, with its attribution visible.
2. **A polar background:** a background of `emc2:background-polar` is drawn in EPSG:3413 and in EPSG:3031, around the pole, in the server's own projection.
3. **Only native projections** (fake capabilities, since GeoServer lists all four projections for every layer): a background whose layers list only EPSG:4326 and EPSG:3857 is not offered in EPSG:3413. The map view falls back as for any background.
4. **Axis order:** in EPSG:4326 with WMS 1.3.0, a map of a box where latitude ≠ longitude (e.g. 10° E to 20° E, 55° N to 65° N) shows that area, not its mirror. The same view with WMS 1.1.1 shows the same area.
5. **A single image:** a background set to `"image"` asks for one image per view, and is drawn.
6. **Drawing order:** with two layers, "Move up" on the lower one, then Save, draws it on top. The request's `LAYERS` follow the new order.
7. **The checkbox list:** after saving a new server, the panel lists its layers with titles and projections. Before saving, it says "Save the server to see its layers". "Read the layers again" reads the capabilities again.
8. **Only admins see the layers:** a user without `settings.admin` gets `403` from the layer list.
9. **Refused map requests,** each `400`, and in each case the fake upstream gets no call:
   - an unknown background;
   - other or reordered `LAYERS`;
   - a projection the background is not offered in;
   - `WIDTH` 4 097;
   - a bad `BBOX`;
   - another `FORMAT`;
   - `REQUEST=GetFeatureInfo`.
10. **Nothing forwarded:** an extra parameter in the browser's request (e.g. `&url=http://other/`) does not reach the upstream call, which has only the server part's own parameters and the saved server's address.
11. **Hosts only from the settings:** no call goes to any host but the configured servers', checked with the fake upstream. The browser makes no request to any host other than the emc2 server, checked in a browser test.
12. **Changes apply at once:** after an admin adds, changes or removes a background, every open browser's background choices follow without a reload, once the server part's read after the change is done. A shown background that is removed falls back.
13. **Offline:** with GeoServer stopped, the backgrounds are unavailable and the status names the server. There is at most one logged warning per minute. The map stays usable and objects are still drawn. After GeoServer starts again, the next read offers them again, and open browsers show them within 60 s of that read.
14. **Service exceptions:** a server answering a `GetMap` with an XML service exception gives `502`, and the browser gets no image.
15. **Safe XML** (owner, 2026-10-31: EX), tested with the fake upstream, with nothing fetched in any case but the capabilities request:
    - a bare DOCTYPE without an internal subset (e.g. `<!DOCTYPE WMT_MS_Capabilities SYSTEM "http://schemas.opengis.net/wms/1.1.1/WMS_MS_Capabilities.dtd">`, as GeoServer's WMS 1.1.1 sends) is **accepted**: the document is read, and its DTD is never requested;
    - a DOCTYPE with an internal subset, an entity declaration (internal or external), or a reference to an entity other than XML's five predefined ones is **refused**.
16. **Limits:** with 16 calls in flight, more map requests wait and are answered in order. The 201st waiting request gets `503`. A request that waited 30 s is dropped without an upstream call. A server that redirects is a failure, and the status says it redirects.
17. **No handler waits:** with a fake upstream that answers after 10 s, the worker is never marked HUNG, and other requests are still answered.
18. **Concurrency rules:** no threads of its own; outbound calls through the SDK with a timeout (C5, C6). The ArchUnit rule set passes.
19. **The WMTS stub:** the settings schema accepts only `"wms"` as a server's `protocol`, and nothing about WMTS is visible.

## Open questions for the owner

None. Answered on 2026-10-20:
- the plugin's own settings panel replaces the generated form;
- the panel also orders the chosen layers, which sets their drawing order;
- background changes apply at once;
- WMTS is a seam and a one-value setting;
- the settings are empty by default.
