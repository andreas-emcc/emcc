# basemap-wms

WMS background maps (brief: `docs/plugins/briefs/basemap-wms.md`; ADR-0035). Built against SDK 1.3.0.

## What it does

Shows background maps from **WMS servers**, polar projections included. The browser talks only to the emc2 server: the **server part** reads each configured server's capabilities (`GetCapabilities`, WMS 1.3.0 or 1.1.1), tells the browsers which backgrounds are offered and in which projections, and passes checked `GetMap` requests on to the server. The **web part** provides one `BackgroundMapProvider` (a `wms` source) per offered background to the map view, and the plugin's own **settings panel**, which replaces the generated settings form.

A background is **one server, one or more of its layers (bottom first), and a name**. It is offered in the projections that **every** one of its layers lists (WMS 1.3.0 `CRS`, 1.1.1 `SRS`; a layer inherits its parents' projections), and only in those. The map view never redraws a WMS map in another projection.

- **Server part:** reads capabilities at start, after every settings change, every hour, after a failed map call, and when the settings panel asks again. A server that cannot be read is named in the plugin's status and retried after one minute, then less often (at most every 15 minutes). The map endpoint checks every parameter and builds its **own** request from the saved server's address and the checked values; it never forwards the browser's query.
- **Web part:** provides and takes back backgrounds as the settings and the server part's offer change (the `Unsubscribe` of `services.provide`), so changes apply without a reload. It asks the server part for the offered backgrounds at start (without making `activate` wait), after every accepted settings change, every 5 s while the server part is reading, and every 60 s while the page is visible.
- **Settings panel** (the plugin's entry in the Settings list): servers (add, edit, remove) and backgrounds (add, edit, remove). A background's layers are a checkbox list of its server's layers, with title, name and projections, once the **server is saved** ("Save the server to see its layers"); the chosen layers are listed in drawing order, top-most first, with Move up and Move down. The panel makes each id from the name (unique, kept when the name changes later), refuses a background whose server is not in the list, and refuses removing a server a background still uses. Save and Discard act on the whole settings; unsaved changes are reported to the shell, and another admin's save while changes are unsaved is offered as "Take their values". To add a server and a background: add and save the server first, then add the background.
- **WMTS is a stub:** each server has `protocol`, whose only allowed value is `"wms"`, and the server part reads capabilities and fetches maps behind one interface (`ServerProtocol`) with a single implementation. Nothing about WMTS is visible to users.

## Settings

Empty by default: there is no server and no background until an admin adds one. The settings reach every browser, so they hold no secrets and no logins (the address may not hold a user name or password).

| Name | Default | Meaning |
|---|---|---|
| `servers` | `[]` | Each: `id`, `name`, `url` (http or https, for WMS requests, may hold a query such as `?map=...`; a parameter of the plugin's own, e.g. `LAYERS`, already in it is replaced), `protocol` (`"wms"`), `version` (`1.3.0` or `1.1.1`, default `1.3.0`), `timeoutSeconds` (1 to 20, default 8) |
| `backgrounds` | `[]` | Each: `id`, `name`, `server` (a server's id), `layers` (1 to 20 names, bottom first), `mode` (`tiles` or `image`, default `tiles`), `format` (`image/png` or `image/jpeg`, default PNG), `transparent` (PNG only, default `false`), `attribution` (`text`, optional `url`) |

A property that is absent takes its default. What the schema cannot check (unique ids, a background's server exists, the layers exist) the panel checks before saving; the server part names any such problem in its status.

## Messages and services

- **Provides** the web service `emc2.background-map` (`BackgroundMapProvider`, id `basemap-wms.<background id>`, a `wms` source with the URL `<serverBase>map/<background id>`). Requires nothing.
- **Server worker `wms`** (`WmsMsg`; mailbox 2 000, `dropNewest`, restartable): `MapGet`, `BackgroundsGet`, `LayersGet`, `SettingsChanged`, `Start`, `Tick` (500 ms), `ReadDone`, `MapDone`.
- **Endpoints** (`/api/plugins/basemap-wms/…`):
  - `GET /map/{background}`: login only. The browser sends `SERVICE`, `REQUEST`, `VERSION`, `LAYERS`, `STYLES`, `FORMAT`, `TRANSPARENT`, `CRS` (1.3.0) or `SRS` (1.1.1), `BBOX`, `WIDTH` and `HEIGHT`, each once. Each is checked against the saved background (`LAYERS` exactly its layers in order, the projection one of its offered ones, `BBOX` four finite numbers with each minimum below its maximum, `WIDTH` and `HEIGHT` whole numbers from 1 to 4 096, `FORMAT` and `TRANSPARENT` as saved, `STYLES` empty, no name twice); any failure is `400` and the server gets no call. Names and the values of `SERVICE`, `REQUEST` and `TRANSPARENT` are matched ignoring case. The request to the server has its parameters in a fixed order (`SERVICE`, `VERSION`, `REQUEST`, `LAYERS`, `STYLES`, `FORMAT`, `TRANSPARENT`, `CRS`/`SRS`, `BBOX`, `WIDTH`, `HEIGHT`) and `BBOX` in plain decimal notation. Answers `200` with the image (`Cache-Control: private, max-age=3600`) when the server's content type is the background's format; `502` for a service exception (also with status `200`), another status, a timeout or a failed call; `503` when 200 requests already wait. The endpoint's timeout is 30 s.
  - `GET /backgrounds`: login only. `{backgrounds: [{id, projections}], reading, version}`; `version` rises whenever the offered set or a background's projections change.
  - `GET /servers/{server}/layers`: `settings.admin`. The saved server's layers from its last read (`name`, `title`, `projections`, `readAt`, `error`, `reading`); `?refresh=true` reads the capabilities again first. The request carries no address.
- No topics, no objects, no change requests.

## Permissions and internet

- Declares no permissions of its own; the layer list and the settings need `settings.admin` (ECore checks it).
- **Internet:** declared with `"hosts": []` (every host comes from the settings an admin fills in). The server part calls **only the servers its saved settings name**, never a host from a browser request, a message or an object's data (ADR-0030), with `GetCapabilities` and the `GetMap` requests above, and a `User-Agent` that names emc2 and the plugin. The SDK's limits apply: no redirects (a server that redirects is a failure and the status says so), 10 MB per answer, at most 16 calls at a time (further map requests wait in order, up to 200, for at most 30 s; a request that waited 30 s is dropped without a call). The capabilities are parsed with the JDK's parser. A bare `DOCTYPE` (as GeoServer sends in WMS 1.1.1) is accepted and its DTD is never loaded; a `DOCTYPE` with an internal subset, any declaration or any entity is refused (owner, 2026-10-31). The web part makes no request outside the emc2 server.
- **Offline is normal.** An unreachable server makes its backgrounds unavailable and is named in the status, with at most one logged warning per minute per server; the map falls back to another background and stays usable. Natural Earth (`basemap-naturalearth`) is the background that always works offline.

## Known limits

- No tile cache (the browser caches for an hour), no server logins, no WMTS beyond the stub, no redrawing in a projection the server does not list, no `GetFeatureInfo`, legends, styles other than the default, time or elevation, and users cannot choose layers.
- Boxes are passed on unchanged: the map view keeps them inside the projection's extent. In EPSG:4326 with WMS 1.3.0 the box is latitude first, as the map view sends it.
- The panel lists layers only for a saved server, so a server and its first background are saved in two steps.
- The test server for trying it for real is the ESA's GeoServer (`external/geoserver/README.md`, Windows only); the plugin's tests use the test kit's fake upstream and run anywhere.
