# ADR-0009: OpenLayers as the 2D map engine, in a map view plugin

- Status: Accepted
- Date: 2026-10-02
- Deciders: Owner (advised by ACA)

## Context
The map must support several projections including polar ones, WMS/WMTS background maps, a layer structure with changeable draw order, and at least 100 000 objects (aggregation allowed). The requirements state that map handling itself is a plugin, and 3D may come later as separate modules.

## Decision
- The 2D map engine is **OpenLayers**, with **proj4js** for projection definitions.
- The map engine lives in a **map view plugin** (`map-view-2d`). Exactly one map view is active per Map Pane. A 3D map view can later be another plugin.
- Background maps (OpenStreetMap, WMS, WMTS) are **background map plugins** that supply tile sources to the map view.
- Other plugins work with the map through a **map view interface** in the web plugin SDK, not through OpenLayers directly. Whether an escape hatch to OpenLayers is allowed is an open item for the PDA.
- Large numbers of objects are drawn with OpenLayers' WebGL rendering (proven in spike S2).

## Alternatives considered
- **MapLibre GL JS:** excellent for vector tiles in Web Mercator, but supports only a fixed set of projections, not arbitrary or polar projections.
- **Leaflet:** simple, but weak support for projections and for very large numbers of objects.
- **CesiumJS:** 3D globe. Out of scope for now, but a candidate for a future 3D map view plugin.

## Consequences
- Any projection with a proj4 definition can be supported, including polar stereographic.
- Raster reprojection is possible, but tile quality suffers far from the source projection. Polar maps therefore come from WMS servers that serve polar projections natively.
- The map view interface in the SDK is extra design work, but keeps plugins independent of the map engine and keeps the 3D option open.
