# ADR-0043: Tactical graphics drawn with mil-sym-ts

- Status: Accepted (owner, 2026-10-30, DK)
- Date: 2026-10-30
- Deciders: Owner (advised by the ACA; the owner's CN and CO in `docs/status.md`, T-065 and T-119; the owner's answers to the spike's two questions, 2026-10-30, in the ACA's session)
- Extends: ADR-0010 (milsymbol for symbology), which left multipoint graphics to an ADR after spike S1

## Context
The data model has a type for multipoint APP-6 tactical graphics, `core.multipoint`: a symbol (standard and SIDC) and control points. Nothing draws it yet. `map-view-2d` shows a marker at the first point, and no editor offers it. milsymbol (ADR-0010) draws only single-point symbols.

The ACA's options paper (`docs/architecture/tactical-graphics.md`) compared mil-sym-ts, the US Army's renderer, with an own renderer. The owner chose mil-sym-ts (CN), with spike S1 in M4 and the build in M5 (CO).

Spike S1 (T-119, PCA-symbology, `spikes/s1-tactical-graphics/README.md`) used `@armyc2.c5isr.renderer/mil-sym-ts-web` 2.10.9 and met all six pass marks on a machine without a GPU:
- **Speed:** with 1 000 graphics in view, the worker draws them again after a zoom in 51–129 ms, and no task on the main thread takes over 100 ms. Beyond 1 000 graphics, the limit is parsing GeoJSON text and adding features on the main thread, not the renderer.
- **Projections:** EPSG:3857, 3413 and 3031, near the poles. Long edges follow great circles (ADR-0019).
- **Coordinate order:** points go in and come out as longitude, latitude, tested where latitude ≠ longitude (ADR-0007).
- **Standards:** every APP-6 D and APP-6 E multipoint graphic in its tables draws, 311 and 286 of them. No APP-6 B graphic draws.
- **Loading:** the 9.63 MB module loads in a worker in under 0.8 s, and only when asked.
- **Offline:** no request beyond emc2's server (ADR-0030).

Two findings needed the owner:
- **A licence note.** One deprecated function, `mdlGeodesic.IntersectLines`, says it is licensed under Creative Commons Attribution 3.0 Unported. Nothing calls it, and it names no author. The rest of the package is Apache-2.0. CC-BY-3.0 is not on the list for shipped code, and any other licence needs the owner's approval through a change request (`CLAUDE.md` section 4).
- **The version digits.** mil-sym-ts reads a SIDC's version digits as the standards define them:

  | Digits | mil-sym-ts |
  |---|---|
  | 10 | APP-6 D |
  | 11 | 2525D change 1 |
  | 12 | APP-6 D change 2 (withdrawn) |
  | 13 | 2525E |
  | 14 | APP-6 E change 1 (deprecated) |
  | 15 | 2525E change 1 |
  | 16 | APP-6 E change 2 |

  emc2's model follows milsymbol: APP-6D is 10, 11 or 12, and APP-6E is 13 or 14. The symbology plugin writes 13 for every APP-6E symbol it composes. So emc2's 13 and 11 would draw as MIL-STD-2525.

## Decision
1. **mil-sym-ts draws multipoint graphics** (`core.multipoint`). Single-point symbols stay with milsymbol (ADR-0010).
2. **Behind the symbology plugin's service.** Other plugins ask the symbology plugin, never mil-sym-ts. So the renderer stays replaceable (ADR-0010).
3. **In one Web Worker in the browser.**
   - The symbology plugin's web part starts one module worker when the first graphic is to be drawn, and keeps it. The module loads only then, never at start-up.
   - The worker gets copies of the requests and returns copies of the results, with no shared memory. Every request has a timeout.
   - Overview 4.2's rules govern the server's threads, where ECore provides them. This worker is the browser's first, and keeps their spirit.
4. **mil-sym-ts is the symbology plugin's own dependency,** pinned exactly (ADR-0016) and bundled into its worker. It is not a shared package of the import map, since no other plugin calls it.
5. **The object's `standard` decides, not the SIDC's version digits** (owner, 2026-10-30).
   - The symbology plugin sets digits 1–2 only in its call to mil-sym-ts: APP-6D as 10, APP-6E as 16 (APP-6 E change 2, the current APP-6 E edition in mil-sym-ts 2.10.9).
   - The stored SIDC never changes, and the model stays as it is.
   - A later mil-sym-ts with a newer APP-6 E edition may move the mapping with the plugin's update.
6. **The licence** (owner, 2026-10-30).
   - The package is Apache-2.0, which is allowed in shipped code.
   - The CC-BY-3.0 note is allowed through a change request, only for that note, in an unmodified mil-sym-ts, as CR-0003 did for EPL-1.0. The CR is approved before mil-sym-ts ships.
   - The note's text and the licence's link go into the third-party notices, with the package's `LICENSE`.
7. **Drawing.**
   - mil-sym-ts draws each graphic for the view's scale and extent, from points in longitude, latitude order. The map view draws the result, and again after each zoom.
   - The worker hands over flat coordinate arrays, not GeoJSON text, and the map view adds features in slices.
   - In EPSG:3857 the map view unwraps a line that crosses the antimeridian, as it does for shapes.
8. **What does not draw keeps today's marker** at the first point:
   - APP-6 B graphics, which need a table from B to D codes, if the owner wants one later;
   - graphics that mil-sym-ts refuses, for example ones whose amplifiers are missing. It answers with an error object, not an exception.
9. **The contract (PDA, a CR in M5)** adds:
   - the graphics' amplifiers, among them distances (`AM`) and azimuths (`AN`), which 27 graphics need;
   - the order of the points for each graphic, as APP-6 defines it;
   - a catalogue of graphics, with their geometry and point counts;
   - a symbology call that draws a graphic at a given scale and extent.

   mil-sym-ts's output carries APP-6's colours, line widths and label fonts. How the looks (ADR-0034) apply to graphics is settled in the brief.

## Alternatives considered
- **An own renderer, with milgraphics as reference** (option B in the options paper): small code and full control, but more effort, for a subset of the graphics. The owner chose mil-sym-ts (CN).
- **Not now** (option C): `core.multipoint` would stay a marker. The owner chose the build in M5 (CO).
- **mil-sym-ts for single-point symbols too:** one renderer, but milsymbol is proven in emc2, and the owner preferred it (ADR-0010).
- **On the main thread:** no worker, but every zoom would block the map for the whole render.
- **A shared package of the import map:** it would load with the shell, and no other plugin needs it.
- **Versions: read the digits as the standards do** (a data model CR): matches the standards' texts. But it breaks the model, and every stored APP-6E object with 13 would have to be converted.
- **Versions: add MIL-STD-2525 as standards:** wider than the requirements' APP-6, and milsymbol draws both alike.
- **Licence: accept the note as part of the Apache-2.0 package, without a CR:** quicker, but departs from `CLAUDE.md` section 4.
- **Licence: strip the function in emc2's build:** emc2 would ship a modified dependency and redo the step on every update.
- **Licence: wait for mil-sym-ts to drop the note:** M5 would wait for another project.

## Consequences
- **M5, about 15–17 work packages** (the spike's estimate):
  - the PDA's CR and briefs;
  - the renderer behind the symbology service, with the version mapping and the error checks (PCA-symbology);
  - drawing, selecting and dragging graphics (PCA-map-view-2d);
  - placing and editing graphics: a new plugin or `draw-shapes` extended, decided in M5's plan;
  - the ITA's flows.
- **The licence CR** comes before the build. The MCA's notices file carries the note.
- **Size:** the symbology plugin's web part grows by 9.63 MB (1.49 MB gzipped), loaded only with the first graphic. The emc2 server serves it, so it works offline (ADR-0030).
- **Tests:**
  - the version mapping, for 10, 11, 12, 13 and 14;
  - the coordinate order, with a point where latitude ≠ longitude (ADR-0007);
  - the fallback marker for an APP-6 B graphic and for a refused one.
- **For the PDA:** the model's example `object-multipoint-boundary.json` has the code of a forward line of troops (`25 140100`), not a boundary (`25 110100`).
- **Overview:**
  - section 4.2 says its rules are the server's;
  - section 4.11 names the worker;
  - section 6 lists the work in M5;
  - section 7 marks spike S1 done.
