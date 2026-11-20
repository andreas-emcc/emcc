# Military tactical graphics: options for the owner

- **Status:** prepared by the ACA (T-065, 2026-10-30) for the owner's decision. **Decided:** option A, mil-sym-ts (the owner's CN), with spike S1 in M4 and the build in M5 (CO). The spike's answers and the decision are in ADR-0043.
- **Question:** spike S1 (overview section 7): whether and how emc2 draws multipoint APP-6 tactical graphics, such as boundaries, phase lines, axes of advance and obstacle lines. ADR-0010 left them out of milsymbol's scope, and ADR-0033 left them out of M2.
- **Sources,** read on 2026-10-30: the mil-sym-ts repository and its browser package 2.10.9; the milgraphics repository (links at the end).

## 1. Where emc2 stands

- The data model already has the type, `core.multipoint`: a `symbol` (standard and SIDC) and control points as a `LineString`, `Polygon` or `MultiPoint`.
- Nothing draws it. `map-view-2d` shows a fallback marker at the first point, and neither editor offers it.
- A renderer turns a graphic's code and control points into lines, areas, decorations and labels. The result depends on the map scale (the teeth on an obstacle line, the size of an arrowhead), so the map view draws each graphic again after a zoom.

## 2. Option A, the licence first: mil-sym-ts

| | |
|---|---|
| What | The US Army's MIL-STD renderer for the web (`missioncommand` on GitHub; the package's author is C5ISR ESI), a TypeScript port of the Java renderers in its Mission Command software. Single-point and multipoint symbols |
| Licence | **Apache-2.0**: the package's `license` field and its `LICENSE` file, the standard text, with no NOTICE file. Allowed in shipped code (ADR-0016, `CLAUDE.md` section 4), so no CR. Its `LICENSE` goes into the third-party notices |
| Dependencies | None at runtime in the browser package, `@armyc2.c5isr.renderer/mil-sym-ts-web`. The repository's only runtime dependency, `canvas`, is for the Node build, which emc2 would not use |
| Upkeep | Maintained: releases 2.10.1 to 2.10.9 from August to October 2026 |
| Standards | MIL-STD-2525D change 1, 2525E change 1 and APP-6 D in full. APP-6 E only in part ("icons only"). APP-6 B not at all |
| Output | GeoJSON, KML or SVG for a given map scale and extent (`WebRenderer.RenderSymbol`). Its examples run it in a web worker |
| Size | 9.6 MB as one ES module. The emc2 server serves it like any plugin code, so it works offline (ADR-0030) |

## 3. Option B: our own renderer, with milgraphics as reference

- **milgraphics** (Spatial Illusions, MIT) turns 2525D control points into GeoJSON lines and areas, on top of milsymbol. It is archived (2023-02-24) and, by its own README, still in initial development and not for production. So it can serve as a reference for some graphics' geometry, not as a dependency.
- **We would write, for each kind of graphic:**
  - the geometry from the points;
  - the decorations by scale;
  - where the labels go.

  We would then check each graphic against APP-6 by hand.
- **Gains:** small code, our own handling of APP-6 B, D and E, and the looks' styles (ADR-0034).
- **Costs:** effort for every graphic, and correctness rests on our own reviews.

## 4. Work and effort

The work is the same in both options except for the renderer itself. Effort is counted in work packages of about 100k tokens of context, as in the M4 plan. These are the ACA's estimates and may be off by half.

| Work | Owner | A: mil-sym-ts | B: own renderer |
|---|---|---|---|
| Spike S1 (section 5) | PCA-symbology | 1–2 | 1, with the first graphics |
| An ADR after S1 (ADR-0010 asks for one) | ACA | 1 | 1 |
| A CR for the data model and the web SDK (below the table) | PDA | 2 | 2 |
| The renderer behind the symbology service, in a web worker. ADR-0010 keeps it replaceable | PCA-symbology | 2 | 6–10 for about 20 common graphics, then 1–2 for each further family |
| Drawing the output, again after each zoom; selection and dragging | PCA-map-view-2d | 3 | 3 |
| Placing and editing graphics: a brief, then a new plugin `draw-graphics`, or `draw-shapes` extended | PDA, a PCA | 4 | 4 |
| ITA flows | ITA | 1–2 | 1–2 |
| **Total** | | **about 14–16** | **about 18–23, for a subset** |

The CR covers three things:
- the graphics' amplifiers: distances, angles and altitudes. Today's modifiers list is milsymbol's;
- the order of the points for each graphic, as APP-6 defines it;
- a symbology service call that draws a graphic at a given scale, with a catalogue of graphics and their point counts.

APP-6 B graphics need a table from APP-6 B to D codes in either option, if they are wanted: 1–2 more packages.

## 5. Spike S1, for A or B

The spike's README sets a pass mark for each question:
- **Speed:** about 1 000 graphics in view, drawn again after a zoom, in a worker, with and without a GPU (ADR-0017).
- **Projections:** the polar projections (EPSG:3413 and 3031) and geodesic edges (ADR-0019).
- **Coordinate order** (ADR-0007): a test where latitude ≠ longitude. mil-sym-ts's documentation says "lat and lon" but writes the points as x,y.
- **Standards:** which APP-6 E graphics and B codes draw, and which fall back to the marker.
- **Loading:** the 9.6 MB module, loaded only when a graphic is shown.

## 6. Options for the owner

- **A. mil-sym-ts, after spike S1 (recommended).** It brings the APP-6 D and 2525E graphics at the lowest effort, under an allowed licence, from a maintained project. Graphics it does not cover (APP-6 B, part of E) show the marker until a code table exists.
- **B. Our own renderer, for a first set of about 20 common graphics.** Small code and full control, but more effort, and each further graphic costs more.
- **C. Not now.** `core.multipoint` stays a marker. The owner decides again when an NVG plugin, which carries graphics, is planned.

For A or B, the owner also decides when:
- **(i)** spike S1 in M4, by PCA-symbology after its track B symbols, and the build in M5 (recommended);
- **(ii)** both in M5;
- **(iii)** later.

## Sources

- mil-sym-ts: <https://github.com/missioncommand/mil-sym-ts> (README, `LICENSE`, `package.json`, releases)
- The browser package: <https://www.npmjs.com/package/@armyc2.c5isr.renderer/mil-sym-ts-web> (2.10.9: `package.json`, file list, `C5Ren.d.mts`)
- milgraphics: <https://github.com/spatialillusions/milgraphics>
