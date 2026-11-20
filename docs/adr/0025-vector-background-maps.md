# ADR-0025: Background maps may also be vector data, drawn by the map view in any projection

- Status: Accepted (owner, 2026-10-10)
- Date: 2026-10-10
- Deciders: Owner (advised by the ACA)
- Extends: ADR-0009 (OpenLayers as the 2D map engine, in a map view plugin)

## Context
ADR-0009 lets background map plugins supply **tile sources** to the map view, and expects polar maps from WMS servers that serve polar projections natively. SDK v0 follows it: a `BackgroundMapProvider` offers only `xyz` tiles.

The M1 demo needs a map in a polar projection (`requirements.md`). The owner moved WMS to M2, because no WMS servers are available yet. Instead, the owner chose a background from **Natural Earth** data (CR-0009), available in every projection. It is also good for quick demonstrations and portable use, because it needs no internet and no map server (owner, 2026-10-10). OpenStreetMap tiles exist only in Web Mercator and do not reach the poles.

## Decision
1. **A background map plugin may supply vector data** as well as tiles: polygons and lines in WGS84 longitude, latitude order, with a simple style. The map view projects and draws them in every configured projection, including the polar ones.
2. **The data comes from the plugin's own web part**, served by the emc2 server like any other plugin file. The Content-Security-Policy stays `'self'`, and nothing is fetched from the internet (ADR-0014).
3. **SDK v1 (PDA)** adds a vector source type to `BackgroundMapProvider`, next to `xyz`. Its exact shape is the PDA's design. The map view (`map-view-2d`) draws it.
4. **A vector background declares all projections**, unless its data does not suit one, so the map view offers it everywhere.
5. Tile sources stay as they are. WMS servers with native polar projections still come, in M2 (`basemap-wms`).

## Alternatives considered
- **OpenStreetMap reprojected into the polar projection:** needs internet, and the area above about 85° N stays empty (ADR-0009: tile quality suffers far from the source projection).
- **Rendering the vector data into tiles on the server:** more work on the server, and a tile pyramid per projection, for data that the map view can draw directly.
- **The polar map in M2, together with WMS:** M1 would not meet the requirement.

## Consequences
- **The first plugin is `basemap-naturalearth`** (M1). Its brief (PDA) chooses the layers and the scale, and keeps the data small: a few MB, loaded once per browser session.
- **The map view must draw** polygons around a pole and across the antimeridian correctly in every projection. Antarctica and the Arctic coast in the polar views are the test cases.
- **Detail is limited** by the scale of the data. Zoomed far in, the background is coarse. WMS (M2) fills that gap.
- ADR-0009's decision is unchanged; this ADR adds a second kind of background source.
