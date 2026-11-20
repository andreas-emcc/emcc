# ADR-0019: Geometry edges are geodesic

- Status: Accepted (owner, 2026-10-05)
- Date: 2026-10-05
- Deciders: Owner (advised by the ACA; designed by the PDA in data model v0, rule 10)
- Extends: ADR-0007 (common data model)

## Context
Objects are stored in WGS84 longitude/latitude (ADR-0007), but shown in several projections, including polar ones (ADR-0009). A line between two positions has no single shape on its own. Drawn as a straight line in each projection, the same object would look different in Web Mercator and in a polar projection, and lines across the antimeridian or near a pole would take absurd detours.

GeoJSON (RFC 7946) defines an edge as a straight line in longitude/latitude, and recommends cutting geometries at the antimeridian. That definition produces exactly those problems in polar views.

## Decision
1. **The edge between two consecutive positions** of a LineString, a Polygon ring or a Corridor centre line is the **shorter geodesic** between them on the WGS84 ellipsoid, whatever the map projection.
2. **Geometries are never split at the antimeridian.** An edge from 179° to −179° is 2° long.
3. **Renderers densify edges**, so a shape looks the same in every projection.
4. **Areas are defined the same way.** The map view's visible area (`MapView.viewport.visibleArea`, SDK v0) is a ring with geodesic edges. Its inside is the side that contains the viewport's centre, so a view around a pole is expressed correctly.
5. **Limitation in data model v0:** a polygon that encloses a pole cannot be expressed as an object. Such areas are drawn as a Circle or ArcBand around the pole. Lifting the limitation later (for example with an orientation rule for the inside) is a model change.

## Alternatives considered
- **GeoJSON's straight lines in longitude/latitude:** standard, but shapes change with the projection, and polar views, an M1 demo requirement, show distorted lines.
- **Straight lines in the display projection:** each user would see a different shape for the same object.
- **Rhumb lines (constant bearing):** natural for some navigation uses, but neither the shortest path nor projection-independent in polar views.

## Consequences
- **Map views** (`map-view-2d`, a 3D view later) densify edges before drawing. The design pattern's FAQ explains this to plugin agents.
- **Format plugins** that read or write formats with other edge rules (GeoJSON, KML, NVG, CoT) densify on export and document how they read edges on import. This difference from RFC 7946 must be stated wherever emc2 geometry is called "GeoJSON-style".
- **Storage and spatial queries** (PostGIS from M1, area-of-interest queries from spike S3) must use geodesic semantics, for example PostGIS `geography` rather than planar `geometry` in EPSG:4326. Otherwise queries disagree with what users see.
- Tests for converters and renderers include edges across the antimeridian and near the poles.
