# ADR-0033: Drawn shapes: a `draw-shapes` plugin and a drawing service in the map view

- Status: Accepted (owner, 2026-10-14)
- Date: 2026-10-14
- Deciders: Owner (advised by the ACA)
- Extends: ADR-0009 (OpenLayers as the 2D map engine, in a map view plugin)

## Context
The owner wants users to draw shapes in M2: circles, ellipses, squares, rectangles, areas, arrows and routes, with a text label, a colour, and a fill that is transparent or hatched (owner, 2026-10-14).

The data model already has most of this:
- a shape type, `core.shape`, drawn with a `style`: outline colour, width, opacity and dash, and fill colour and opacity;
- geometries for points, lines, polygons, circles and ellipses. Circles have a centre and a radius in metres; ellipses have a centre, two semi-axes in metres and a rotation;
- a `name` that can serve as the text label.

It lacks hatched fills, arrowheads and markers at a line's points. Military tactical graphics are another type, `core.multipoint`. They need a renderer that spike S1 has not chosen yet.

Plugins work with the map only through the map view's interface in the web SDK (ADR-0009), and there is no escape hatch to OpenLayers (owner, 2026-10-04, for SDK v0; SDK v1 has none either). A separate drawing plugin therefore cannot use OpenLayers' own drawing and editing tools. With today's interface it can draw only by clicking, and cannot reshape a drawn shape by dragging its corners.

## Decision
1. **Plain shapes first.** M2 builds `core.shape` objects:
   - circle, ellipse, square, rectangle, polygon area;
   - **arrow:** a line with an arrowhead;
   - **route:** a line through several points, with markers at the points.

   Each shape has an outline (colour, width, dash) and, where it has an area, a fill that is transparent or hatched. Its text label is its `name`. **Whether to add military tactical graphics is decided near the end of M2** (owner, 2026-10-14).
2. **A new plugin, `draw-shapes`,** offers the shapes and their styles, sends the change requests, and provides **Edit** for shapes (ADR-0032). `draw-symbols` stays with symbols.
3. **The map view offers a drawing and editing service** through the web SDK, built on its map engine's drawing and editing tools.
   - **Draw:** the user draws a shape of a given kind by pressing and dragging, or point by point. The service returns its geometry in longitude and latitude; circles and ellipses come with their lengths in metres (and an ellipse with its rotation).
   - **Edit:** the user moves a shape, or reshapes it by dragging its corners or points, and the service returns the new geometry.
   - **The service changes nothing itself.** The plugin that called it sends the change request (ADR-0005), and the server checks it like any other (overview 4.4).
4. **Squares and rectangles are stored as polygons**, circles and ellipses as their own geometries. A polygon's edges are geodesic (ADR-0019), so a square drawn in one projection does not look exactly square in another (owner, 2026-10-14).
5. **Data model 1.1.0 adds optional style fields**, through a change request: a hatched fill and an arrowhead (owner, 2026-10-14), and markers at a line's points, which the route needs. Version 1.0.0 data stays valid.
6. **The map view draws the shapes:** ellipses (today a fallback marker), hatched fills, arrowheads, the markers of a route, text labels and the selection highlight for shapes.
7. **Editing in M2** covers the properties and the style, moving the whole shape, and dragging its corners or points.

## Alternatives considered
- **Extend `draw-symbols`:** one plugin for two different kinds of drawing, and no parallel work.
- **Drawing by clicks with today's interface:** possible, but no pressing and dragging and no reshaping by the corners.
- **Give plugins OpenLayers:** it would tie every drawing plugin to one map engine and break the map view's interface (ADR-0009), which keeps a 3D map view possible.
- **Military tactical graphics now:** they need the renderer that spike S1 is to choose, and plain shapes cover the M2 need.

## Consequences
- **Web SDK 1.x (PDA, through a change request):** the drawing and editing service of the map view.
- **Data model 1.1.0 (PDA, through a change request):** the hatched fill, the arrowhead and the point markers. The Java and TypeScript codecs, the validation and the test kits follow.
- **`map-view-2d` (its PCA):**
  - the service, built on its map engine's drawing and editing tools;
  - the new drawing;
  - a prototype first, of the hatched fill in the engine's WebGL renderer and of the first drawing call.
- **`draw-shapes`:** a new PCA, with a brief from the PDA. Its shapes are drawn objects: `dataSource` is `manual`, and `dataType` is any available data type, `core.general` by default (ADR-0023).
- **ITA:** flows for drawing each kind of shape, editing it, and seeing it in a second browser.
- **Spike S1** (multipoint tactical graphics) stays open until the owner's decision near the end of M2.
