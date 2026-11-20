# ADR-0035: WMS background maps through a `wms` source in the map view

- Status: Accepted (owner, 2026-10-19)
- Date: 2026-10-19
- Deciders: Owner (advised by the ACA's options paper of 2026-10-19)
- Extends: ADR-0009 (OpenLayers as the 2D map engine, in a map view plugin) and ADR-0025 (vector background maps)

## Context
In disconnected installations the background maps come from WMS map servers, which another project runs, polar projections included. They are existing external systems (`requirements.md`, which also names WMTS). ADR-0009 lets background map plugins supply tile sources to the map view, and expects polar maps from WMS servers that serve polar projections natively. ADR-0025 added vector data, and left WMS for later. The plugin is `basemap-wms`, planned for M3 (overview section 6).

The web SDK cannot carry a WMS map yet. A `BackgroundMapProvider` supplies `xyz` tiles or vector data (SDK 1.1.0). The map view derives an `xyz` source's tile grid from each projection's extent; the SDK cannot describe a server's own grid, nor ask a WMS server for a map.

Fixed by earlier decisions:
- the browser talks only to the emc2 server, so a plugin's server part fetches from the WMS server and passes the maps on, as `basemap-osm` does with tiles (ADR-0030);
- the server part's outbound HTTP may go to any host, but never to one taken from a browser request, a message or an object's data (owner, 2026-10-18; ADR-0030, kept by the owner on 2026-10-19);
- settings reach every browser and hold no secrets;
- Natural Earth stays the background that always works offline (ADR-0025).

A WMS server to test against is the ESA's test service GeoServer (T-070, its sheet `external/geoserver/README.md`), with WMS 1.1.1 and 1.3.0 and layers in EPSG:4326, 3857, 3413 and 3031.

## Decision
1. **The web SDK gets a `wms` background source.** The map view draws it with its map engine's own WMS support, in the current projection. It requests the map from the plugin's server part, at a URL on the emc2 server, and the server part forwards the request to the WMS server named in its settings.
2. **Tiles by default.** A background may be set to come as a single image instead, for servers whose labels suffer at tile edges.
3. **Native projections only.** A background is offered in the projections its server lists for its layers (the WMS capabilities). The map view never redraws a WMS map in another projection. In any other projection it falls back as it does for any background.
4. **The admin configures each background** in the plugin's settings: the server, its layers and a name. The plugin's server part reads the server's capabilities, to check each background and learn its projections. The plugin's admin page shows the server's layers as a checkbox list, from which the admin chooses (owner).
5. **WMTS is a stub in M3**, not implemented yet (owner).
6. **Only WMS servers without a login in M3.** Credentials come later, through local server configuration.
7. **No tile cache in M3.** The server part passes maps through and lets the browser cache them. A tile cache is noted for a later milestone (owner).

## Alternatives considered
- **The server part turns WMS into tiles:** the map view would keep only tile sources, but the SDK's tile source would then need a tile grid for each projection, and the plugin would redo what the map engine already does.
- **One whole image for each view only:** simplest, but every pan or zoom fetches a full new image.
- **Redrawing a WMS map in other projections in the browser:** full coverage, but blurry far from the source projection (ADR-0009).
- **Every layer and layer group of a server as a background:** no configuration, but a long background list; the test server alone has 22.
- **Users choose layers in a panel:** more flexible, but more interface to build and test.
- **The admin page as a panel in the View tab** (SDK 1.1.0's panels, no SDK change): but a plugin's settings belong in its entry of the Settings list (ADR-0031 point 2), and panels are shown to every user.
- **WMTS, server logins or a tile cache in M3:** not needed yet; there is no WMTS server to test against, and in a disconnected network the WMS servers are local.

## Consequences
- **Web SDK 1.2.0 (PDA, through a change request):**
  - the `wms` source: the URL of the plugin's server part, the layers, and what the map engine needs to request them (version, format, transparency, tiles or a single image); the projections stay in `BackgroundMapProvider.projections`;
  - **a plugin's own settings panel**, for the checkbox list of decision point 4. The owner set it aside in SDK 1.1.0 as a later compatible 1.x addition, "when a plugin needs it" (CR-0015 item 3, 2026-10-15). `basemap-wms` now needs it.
  - the test kit's fakes for both.
- **The admin page is the plugin's own settings panel** in its entry of the Settings list.
- **One background is one server, several layers and a name.** The checkbox list fills in the layers of the background being edited.
- **The server address comes from the saved settings, also for the checkbox list.** The settings panel asks the plugin's server part for the layers, and the server part reads the capabilities of the server the settings name. The panel never sends a server address of its own (ADR-0030). So the list appears once the admin has saved the server.
- **Permissions:** the server part's request for the layers needs `settings.admin`, like every read for the settings (overview 4.11); its map requests need a login only.
- **The server part forwards only map requests for the configured backgrounds**, within the limits the brief sets (layers, image size and format). It forwards no other WMS request from the browser.
- **`map-view-2d` (its PCA):** draws `wms` sources in every configured projection that a background lists, polar ones included, and handles WMS 1.3.0's axis order for any projection whose order is latitude, longitude (EPSG:4326). Projections match by their codes, so the map view's configuration must hold the server's code: a polar server that offers only, say, EPSG:3995 gets no background until that projection is configured.
- **`basemap-wms` (a new PCA; the brief is the PDA's):**
  - its settings: the servers, the backgrounds with their layers and names, tiles or a single image, and the attribution;
  - its manifest declares `internet`; its outbound calls keep the SDK's limits (no redirects, the body limit, calls at a time);
  - WMTS: the brief decides what the stub holds;
  - the GeoServer of T-070 as its test server.
- **The shell (CDA):** shows a plugin's own settings panel in the plugin's entry of the Settings list, with SDK 1.2.0.
- **SRA:** the server part's pass-through and its capabilities request must not reach any host but the one its settings name, nor forward other requests.
- **ITA:** a small WMS test double, as `agents/ita.md` plans, and flows for a WMS background in Web Mercator and in a polar projection, the fallback, and the settings panel.
- **Later milestones** (overview section 6): WMTS beyond the stub, server logins (with a change request then), and a tile cache.
