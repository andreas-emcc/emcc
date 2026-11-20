# Brief: symbology

- Status: **Approved (2026-10-05)** · Updated 2026-10-05 for the APP-6E SIDC length (20 or 30 digits), approved by the owner · Updated 2026-10-06 for the canonical SIDC (function 3), approved by the owner · Updated 2026-10-09 for the owner's decision of 2026-10-08 that multipoint tactical graphics are out of scope of criteria 1 and 3, approved by the owner (2026-10-09) · Milestone: M0 · Task: T-021 · Agent: PCA-symbology (Sonnet)
- **Updated 2026-10-30 for M4 (T-090): function 6, criteria 7 and 8.** From the owner's M4 notes (2026-10-30: more symbols, for the demo; a symbol shortcut editor comes later). No SDK member or model change: each `CatalogEntry` has its `symbolSet`. **For the owner's approval.**
- **Updated 2026-11-06 for M5 (T-144; CR-0030 part 2, ADR-0043): functions 7 to 10, Interfaces, Dependencies, Settings, criteria 9 to 17.** Tactical graphics drawn with mil-sym-ts in a Web Worker, with the owner's answer of 2026-11-06 on the looks (Q2: APP-6 colours in every look; no halo in M5). Built against SDK 1.4.0 part 2 (`sdk-v1.md`, "SDK 1.4.0", part 2). **Approved by the owner (2026-11-06, HQ).**
- **Updated 2026-11-06 for M5 (T-139; CR-0030 part 3b, ADR-0047): functions 11 to 13, Interfaces, the out-of-scope line, criteria 18 to 21.** Vessel symbols: emc2's own drawing (GK) and the ship-type groups. Built against SDK 1.4.0 part 3. **Approved by the owner (2026-11-06, IB).**
- **Updated 2026-11-07 for M5 (T-137, T-138; CR-0030 part 5, ADR-0046): function 14, Interfaces, criteria 22 to 24.** The user's labels, which the map view passes to `render` (owner, Q13, 2026-11-07); the size comes in `size` as before; the default labels list `direction` (owner, JF). Built against SDK 1.4.0 part 5. **Approved by the owner (2026-11-07, JG).**
- **Updated 2026-11-08 for the owner's LS: function 12's outline and shared images, criterion 19.** The vessel's outline gets the 1 px gap in the look's ground colour between fill and outline, the fallback the ACA's R3 named. **Approved by the owner (2026-11-08, LS).**
- **Updated 2026-11-10 for M6 (owner, HW; CR-0039 part 2, approved by the owner, OB A; SDK 1.5.0 part 2): function 15, Interfaces, criteria 25 to 28.** The 21 graphics' icons go into `GraphicRendering.images` instead of being left out. A dated note on ADR-0043 point 9 follows (ACA). **For the owner's approval.**
- **Updated 2026-11-10 for M6 (T-151; CR-0039 point 6, approved by the owner, OB A; SDK 1.5.0 part 3): function 16, Interfaces, Settings, criteria 29 to 33.** The sensor report symbol, one setting for all sensor reports (owner, 2026-11-08), with the owner's Q41 to Q44 of 2026-11-10 in the PDA's session: a size setting, 10 px; a list of colours; an orange dot with a 1 px outline by default; no labels, arrow or speed vector. **Approved by the owner (2026-11-10, PI A; Q41 to Q44 confirmed, PH A).**
- Read also: ADR-0010 (milsymbol, APP-6 B/D/E), `spikes/s2/README.md` (symbol images keyed by appearance). **From M5:** ADR-0043 (tactical graphics with mil-sym-ts), `spikes/s1-tactical-graphics/README.md` (its findings and surprises), CR-0029 (the CC-BY-3.0 note).

## Purpose

The single place where APP-6 symbols are understood and drawn. Other plugins get symbol images and symbol information from it through the `SymbolService`, never by calling milsymbol directly. This allows caching, and a later change of renderer (ADR-0010).

## Kind and parts

- Kind: **utility**. Properties: none.
- Parts in M0: **web only.**

## Functions (M0)

1. **Render:** for a symbol (`standard`, `sidc`, optional `modifiers`) and a size in pixels, returns an image with its width, height and anchor point (the pixel that belongs at the object's position).
   - Results are cached by appearance key: standard + SIDC + the modifiers that change the drawing + size. Repeated calls for the same key return the cached image.
   - Text modifiers (e.g. `uniqueDesignation`) are included only when the caller asks for them, so that images without text can be shared by many objects (S2).
2. **Validate:** tells whether a SIDC is valid for its standard, using the `model/` patterns and milsymbol's own validity check. The patterns are: APP-6B 15 characters; APP-6D 20 digits; APP-6E 30 digits, or 20 when the last ten digits are zero and left out. Invalid symbols still render, as milsymbol's "invalid" frame, never as nothing.
3. **Compose and describe:** builds a SIDC from its parts and splits a SIDC back into its parts, for APP-6D and APP-6E. Parts: standard identity, symbol set, status, HQ/task force/dummy, echelon/mobility, entity. For APP-6B, validation and render only.
   - **Compose, describe and the cache key use the canonical SIDC** (`canonicalSidc` in the web SDK): a 20-digit and a 30-digit APP-6E SIDC for the same symbol (digits 21–30 all zero) share one cache entry, and compose returns the canonical form (model README, "Conventions").
4. **Catalog (small, M0):** a curated list of about 30 common land unit entities (e.g. infantry, armour, artillery, reconnaissance, engineer, signal, medical, supply, headquarters) with English names, plus the lists of standard identities and echelons. `draw-symbols` builds its symbol picker from this. A full APP-6 catalog is out of scope.
5. **Modifier names:** publishes the list of supported text and graphic modifier names (camelCase, as in `model/`), mapped to milsymbol options. This list becomes part of data model v0 (open item 5 in `model/README.md`).

## Functions (M4)

6. **More symbols** (the owner's M4 notes, 2026-10-30, for the demo). The catalog (function 4) grows to 10 to 20 common entities in each of these symbol sets, with English names, as numeric SIDC parts (APP-6D and APP-6E):
   - land unit (`10`, the M0 entries kept), land equipment (`15`), land installation (`20`);
   - air (`01`), air missile (`02`), space (`05`);
   - sea surface (`30`), sea subsurface (`35`), mine warfare (`36`);
   - signals intelligence: space (`50`), air (`51`), land (`52`), sea surface (`53`), subsurface (`54`).

   Where milsymbol has fewer than 10 entities in a set, all of them. "Common" is the PCA's choice: the ones a demo shows most (for air, e.g. fixed wing, rotary wing, fighter, bomber, transport, tanker and UAV). `draw-symbols` shows them by category (its function 1). The owner checks them in the browser (T-105).

## Functions (M5)

Built against SDK 1.4.0 part 2 (`GraphicCatalogEntry`, `GraphicRenderRequest`, `GraphicRendering` in `services.ts`; declare `^1.4.0`). The service's two new members are optional in the SDK until this plugin provides them, then required at the freeze.

7. **The graphics' amplifiers** (data model 1.4.0): `TEXT_MODIFIERS` gains `targetNumber`, `uniqueDesignation1`, `uniqueDesignation2` and `dtg1`; it is a `Record` over `TextModifierName` on purpose, so it stops compiling until it lists them, in the same run as the SDK's part 2. `modifierNames` lists them, and `distances` and `azimuths`. A single-point symbol ignores all six: they change neither its image nor its appearance key.
8. **The catalogue** (`graphicCatalog(standard)`, ADR-0043 point 9):
   - **Which graphics:** every graphic of mil-sym-ts's `MSLookup` that it draws from points: for APP-6D its version 10, for APP-6E its version 16 (function 9's mapping). In mil-sym-ts 2.10.9 that is every graphic with the geometry `Line` or `Area`: about 300 graphics with two or more points in each standard (spike S1's count), and the graphics with one point that draw with distances, such as circles and range fans (about 27 in each). Criterion 10's comparison with the lookup decides the exact list. Graphics whose geometry is a point are single-point symbols, which milsymbol draws, and are not listed. APP-6B has none (ADR-0043 point 8).
   - **Each entry** (`GraphicCatalogEntry`):
     - `symbolSet` and `entity` from the lookup's 8-digit code; `name`; `path` split at its slashes, without empty parts;
     - `kind`: `arrow` for the axes of advance and the other arrows with a width point (by draw rule), `points` for the one-point graphics and those whose points carry distances, `area` and `line` from the lookup's geometry otherwise;
     - `geometry`: `LineString` for lines and arrows, and for areas whose points have roles; `Polygon` only for areas whose points have none (the store may reverse a ring, model rule 1); `MultiPoint` for `points`;
     - `minPoints` and `maxPoints` from the lookup, with mil-sym-ts's "no limit" (`Number.MAX_VALUE`) as `null`;
     - `points`: what each point is, in English, written once per draw rule from the standard's draw rules (APP-6, Annex on control measures; MIL-STD-2525D's draw rules, which mil-sym-ts follows). For example an axis of advance: "the tip of the arrow", "the axis, from the tip back to the tail", "the width of the arrowhead";
     - `allowedModifiers`: the lookup's amplifiers in the model's names (T `uniqueDesignation`, T1 `uniqueDesignation1`, T2 `uniqueDesignation2`, H `additionalInformation`, N `hostile`, V `type`, W `dtg`, W1 `dtg1`, X `altitudeDepth`, Y `location`, AS `country`, AP `targetNumber`, AM `distances`, AN `azimuths`); `requiredModifiers`: those the draw rule needs, e.g. `distances` for a circle; `echelon`: whether the lookup lists B.
   - **Without the renderer:** the catalogue may be generated from the lookup when the plugin is built, so that a palette opens without loading 9.6 MB. Either way a test compares it with the lookup.
9. **Drawing** (`renderGraphic`, ADR-0043 points 3, 5, 7 and 8):
   - **One module worker,** started at the first call that needs the renderer and kept for the page's life. mil-sym-ts loads only in it. The worker gets copies and gives copies; every request has the timeout of the setting, and a late answer is dropped. A worker that fails is started again at the next call.
   - **The version digits** (ADR-0043 point 5): the call to mil-sym-ts gets digits 1–2 as `10` for APP-6D and `16` for APP-6E, whatever the stored SIDC holds (10, 11 or 12; 13 or 14). The stored SIDC never changes.
   - **In:** the points as mil-sym-ts's "lon,lat" pairs, in the catalogue's order; the scale from `resolution` at 96 dots per inch; the extent as its bounding box; the modifiers in mil-sym-ts's keys, `distances` and `azimuths` as its comma-separated lists.
   - **Out:** the worker parses mil-sym-ts's result itself and hands over `GraphicRendering` with flat `Float64Array`s, transferred, never GeoJSON text (the spike's finding: parsing on the main thread was the limit). Long edges stay bent as mil-sym-ts gives them. Colours, widths, dashes and fonts are mil-sym-ts's, so APP-6's, in every look (owner, Q2, 2026-11-06). `GraphicLabel.halo` is mil-sym-ts's own outline of a label's text, passed through; it is not the halo for dark maps that the owner left for later (Q2; ACA R3).
   - **Refusals** (`{ ok: false, reason }`, never a rejection): mil-sym-ts's error object with its message; a result with `NaN` (a view of zero width); fewer or more points than the catalogue allows; a missing required amplifier; an APP-6B graphic or a code that is not in the catalogue; the timeout ("timeout").
   - Requests that arrive together may go to the worker in one message per frame; each still gets its own answer.
10. **The licence:** mil-sym-ts ships unmodified, with its `LICENSE` and the CC-BY-3.0 note of `mdlGeodesic.IntersectLines` in the third-party notices (CR-0029; the MCA's notices file). The plugin's README names both.

11. **Vessel codes** (data model 1.4.0, ADR-0047): `validate('vessel', sidc)` accepts `^[0-2][0-6]\d{2}$` (context, standard identity, AIS ship type) and names the problem otherwise. `validate.ts`'s `Record<SymbolStandard, RegExp>` stops compiling until it has `vessel`, in the same run as the SDK's part 3. `catalog()` stays APP-6's: the ship types are in `vesselGroups()` (function 13).
12. **Drawing a vessel** (`render`, ADR-0047 point 4; emc2's own drawing in the style of vessel-tracking pages, GK; no copied artwork):
    - **Moving:** with `direction` and a `speed` that is absent or above 0, a **pointed hull**: about the symbol size long and a third of it wide, its point along `direction` (the image is turned; its anchor is the hull's centre).
    - **Not moving or no heading:** without `direction`, or with `speed` 0, a **separate mark**: a filled circle about half the symbol size.
    - **Fill:** the ship-type group's colour (function 13), the same in every look, as APP-6's affiliation colours are (ADR-0034).
    - **Outline:** the standard identity's frame colour, as the plugin draws APP-6 frames (friend and assumed friend blue, hostile and suspect red, neutral green, unknown and pending yellow), 2 px, so that the identity shows (ADR-0047 point 3), **with a 1 px gap in the look's ground colour between fill and outline** (owner, LS, 2026-11-08: the fallback of the ACA's R3), so that the identity also reads on fills close to its colour (cargo, tanker, passenger, high-speed craft).
    - **Text:** with `withText`, the text amplifiers beside the hull as for APP-6 (e.g. `uniqueDesignation`). The context digit is not drawn in M5.
    - **Shared images** (spike S2): the image key is the code, the size, the direction rounded to whole degrees, whether it moves and the look (its ground colour, for the gap; LS), so ships of one type and identity share images in one look. From M8 the map view sends a vessel's `direction` in 10° steps (its function 33; T-200), so a turning ship changes its image every 10°; `symbology` rounds what it gets as before.
    - **The display settings** (part 5) apply as for APP-6 (ADR-0047 point 9): the size through `size`, the labels through `labels` (function 14); the speed vector is the map view's.
13. **Ship-type groups** (`vesselGroups()`, ADR-0047 point 4): the nine groups, in this order, every AIS type 0 to 99 in exactly one, each type with its name from ITU-R M.1371 (e.g. 31 "Towing", 52 "Tug", 70 "Cargo"):

    | Group (`id`) | Label | AIS types | Colour |
    |---|---|---|---|
    | `cargo` | Cargo | 70 to 79 | `#5A9E3A` |
    | `tanker` | Tanker | 80 to 89 | `#C23B30` |
    | `passenger` | Passenger | 60 to 69 | `#2F6FD0` |
    | `fishing` | Fishing | 30 | `#E08A2E` |
    | `pleasure` | Pleasure craft | 36, 37 | `#B248B8` |
    | `highSpeed` | High-speed craft | 40 to 49 | `#D8B820` |
    | `tugSpecial` | Tug and special craft | 31 to 35, 50 to 59 | `#2AA6A6` |
    | `other` | Other | 1 to 29, 38, 39, 90 to 99 | `#808080` |
    | `unknown` | Unknown | 0 | `#D0D0D0` |

    The colours are a proposal: the owner checks them in the browser in each look, and the README records them.
14. **The user's labels** (`render`'s `labels`, SDK 1.4.0 part 5; ADR-0046; owner, Q13, 2026-11-07). The map view passes the user's labels from `ctx.display`; `symbology` reads no display settings itself, so a palette or legend that passes none looks as before.
    - **With `labels`:** of the APP-6 amplifiers on the closed list (`LABEL_IDS`: `uniqueDesignation` T, `higherFormation` M, `additionalInformation` H, `staffComments` G, `type` V, `dtg` W, `altitudeDepth` X, `speed` Z, `direction` Q), only those listed are drawn, at their APP-6 places. Amplifiers not on the list (e.g. `quantity`, `reinforcedReduced`) are drawn as before. `name` is the map view's and is ignored here. The text amplifiers still need `withText` (function 1); `direction`'s arrow is drawn when it is listed, with or without `withText`.
    - **Without `labels`:** every amplifier, as before.
    - **The appearance key** (function 1) holds the labels that change the drawing, so images with and without a label are kept apart, and images that do not use them (no amplifiers to filter) are still shared.
    - **Vessels** (function 12): the text amplifiers beside the hull follow `labels` in the same way; the hull keeps turning by `direction` whatever the labels.

**Out of scope (M5):** drawing a vessel's context (exercise, simulation); silhouettes or photographs of ships; a halo round graphics' lines and labels for dark maps (owner, Q2, 2026-11-06: a possible addition for a later milestone); APP-6B graphics (a code table from B to D, if the owner wants one later; ADR-0043 point 8); 3D output (mil-sym-ts's KML and its altitude modes); a server part.

## Functions (M6)

15. **Images inside graphics** (SDK 1.5.0 part 2, CR-0039; owner, HW). For 21 graphics (14 in APP-6D, 7 in APP-6E: the mined areas, the dummy and dynamic minefields, the mine line, and the biological, chemical, nuclear and radiological contaminated areas; this README's "Known limits" list) mil-sym-ts's result holds image points, which M5 left out. From M6 the worker hands them over as `GraphicRendering.images`:
    - **From each image point** of mil-sym-ts's result (a `Point` feature with `properties.image`): `position` the point's longitude, latitude; `svg` the `image` text as it is, an SVG data URI; `angle` its `rotation`, degrees clockwise; `width` and `height` the SVG's own size in pixels, read in the worker. mil-sym-ts centres the image on that point in its own drawing, as `GraphicImage` says. Its `anchorPoint` and offsets (for a leader line) are not used.
    - **Left out, as before:** an image point whose `image` is not a `data:image/svg+xml` URI or whose size cannot be read. The graphic still draws without it.
    - **Nothing else changes:** lines, fills and labels as in function 9; a graphic without image points gives no `images`. The images are strings, so they are copied, not transferred.

16. **The sensor report symbol** (`sensorReportSymbol()`, SDK 1.5.0 part 3, CR-0039 point 6; T-151; owner, 2026-11-08, and Q41 to Q44, 2026-11-10). One image for every object whose data type declares `sensorReport` (today `gmti.detection`); the map view draws it instead of the APP-6 symbol (its function 39):
    - **From three settings** (Settings; one for all sensor reports, owner 2026-11-08): `sensorReportShape`, one of `dot` (a filled circle), `cross` (an upright cross), `ring` (an unfilled circle), `diamond` (a filled square on its point) and `square` (a filled square); `sensorReportColor`, one of `yellow` (#ffff00), `orange` (#ff8000), `red` (#ff0000), `magenta` (#ff00ff), `cyan` (#00ffff), `green` (#00c000), `blue` (#0060ff), `white` (#ffffff) and `black` (#000000) (Q42); and `sensorReportSize`, 4 to 32 pixels (Q41). The shape fills a size by size image, its anchor at the centre; the cross's and the ring's lines are size / 5 wide, at least 2 px.
    - **Outlined** (Q43): every shape has a 1 px black outline, white for a black symbol, so it shows on light and dark maps and in every look. No look, user setting or label changes the image.
    - **The same image until the settings change:** drawn once on the main thread into a canvas and kept. A change of `ctx.settings` draws it again, and the next call returns the new image, a different object, so the map view sees the change.
    - **The object keeps its SIDC:** `render` still draws a detection's APP-6 symbol for anyone who asks (a legend, a properties panel), unchanged by these settings, and the sensor report image is not in `render`'s cache (CR-0039, A3).

## Out of scope (M0)

Multipoint tactical graphics (spike S1), a server part (server-side rendering, e.g. for exports), the full APP-6 catalog, APP-6C.

## Interfaces

| Direction | What |
|---|---|
| Provides | `SymbolService` (web SDK): render, validate, compose/describe, catalog, modifier names. **(M5)** `graphicCatalog` and `renderGraphic` (SDK 1.4.0); `vesselGroups`, and `render` and `validate` for `vessel` (SDK 1.4.0 part 3); `render`'s `labels` (SDK 1.4.0 part 5). **(M6)** `GraphicRendering.images` (SDK 1.5.0 part 2); `sensorReportSymbol` (SDK 1.5.0 part 3) |
| Requires | Nothing besides the SDK |
| Objects | None |

## Dependencies

- `milsymbol` (MIT), shared through the shell's import map.
- **(M5)** `@armyc2.c5isr.renderer/mil-sym-ts-web` **2.10.9**, exactly (Apache-2.0, with the CC-BY-3.0 note allowed by CR-0029), the plugin's own dependency, bundled into its worker and served by the emc2 server (ADR-0043 point 4). Not in the import map.

## Settings

| Setting | Default |
|---|---|
| Image cache size (entries) | 2 000 |
| **(M5)** Graphic draw timeout (seconds, 1 to 30) | 5 |
| **(M6)** Sensor report symbol shape (`dot`, `cross`, `ring`, `diamond`, `square`) | `dot` |
| **(M6)** Sensor report symbol colour (yellow, orange, red, magenta, cyan, green, blue, white, black) | orange |
| **(M6)** Sensor report symbol size (pixels, 4 to 32) | 10 |

## Permissions

None.

## Internet access

**Not allowed.** milsymbol draws locally; no fonts or images are fetched.

## Acceptance criteria

1. Render returns a non-empty image and an anchor for valid APP-6B, APP-6D and APP-6E examples (at least the SIDCs of the `core.symbol` examples in `model/examples/valid/`). **Multipoint tactical graphics are out of scope** (owner, 2026-10-08): the SIDC of a `core.multipoint` object, such as `object-multipoint-boundary.json`, need not render. That file stays a valid model example.
2. The same appearance key returns the identical cached image object; a different size or a drawing-relevant modifier gives a different image. Text modifiers are ignored unless requested.
3. Validate accepts the SIDCs of the valid `core.symbol` examples (including the 30-digit APP-6E one; not the multipoint graphics of criterion 1) and rejects SIDCs of the wrong length, with letters in D/E codes, or with a version that does not match the standard (as in `model/examples/invalid/`).
4. Compose followed by describe returns the original parts, for every catalog entry with every standard identity and echelon.
5. Rendering 120 distinct symbols takes under 100 ms on the dev VM (S2: 30–45 ms), and 100 000 cached lookups take under 50 ms.
6. No network request is made (checked in a browser test).

From M4:

7. Each of the 14 symbol sets of function 6 has at least 10 catalog entries (or all that milsymbol has), each with a name. Compose and describe round-trip every entry (criterion 4), and every entry renders with each standard identity as a symbol milsymbol reports valid.
8. The README lists the entries per symbol set, so that the owner can check them.

From M5 (unit tests with mil-sym-ts in Node where it runs there, the worker in a browser test):

9. **Amplifiers:** `modifierNames` contains the four new text names, `distances` and `azimuths`; a single-point symbol with them renders the same image, under the same key, as without them.
10. **Catalogue:** for APP-6D and APP-6E it lists exactly the graphics of function 8 (a test compares with the lookup: count, codes, names, point counts, amplifiers, echelon); every entry has a non-empty `points`, a `kind` and a `geometry` by function 8's rules, and `requiredModifiers` within `allowedModifiers`. The README lists the draw rules with their `points` texts, so that the owner can check them.
11. **Drawing and coordinate order:** the graphics of `model/examples/valid/` (the boundaries, the axis of advance, the range fan), drawn for a view round them, resolve with `ok: true`; for a phase line from (17.60, 59.90) to (17.85, 59.86), every output position lies within the points' box widened by 0.1°, so longitude and latitude are not swapped (latitude ≠ longitude).
12. **Versions:** the same graphic with digits 10, 11 and 12 reaches mil-sym-ts as 10, with 13 and 14 as 16 (a spy on the call), and the object's SIDC is unchanged.
13. **Refusals:** a range fan without `distances`, an axis of advance with two points, a code outside the catalogue, an APP-6B graphic and an extent of zero width each resolve with `ok: false` and a reason; none rejects or throws.
14. **Loaded when needed:** in the browser, no worker starts and no request for mil-sym-ts's module is made before the first `renderGraphic` (or `graphicCatalog`, if it needs the renderer); after it, exactly one worker.
15. **Timeout:** a request held longer than the setting resolves with `{ ok: false, reason: "timeout" }`, and the next request draws.
16. **Speed** (spike S1): with the spike's sample, 1 000 graphics in view are drawn again after a zoom in under 300 ms in the worker, and no task of this plugin on the main thread takes over 100 ms.
17. **Offline:** drawing graphics makes no request beyond the emc2 server (criterion 6).

From M5, part 3 (vessel symbols):

18. **Codes:** `0470` and `2607` are valid; `3470`, `0770` and `470` are not, each with a problem.
19. **Drawn:** `object-vessel.json`'s ship (`0470`, direction 212.5, speed 6.4) gives a hull pointing 212.5° (a test on the drawing calls or the image key), filled in the cargo colour and outlined in the neutral colour, with a 1 px gap in the look's ground colour between them (LS), which follows a change of look; without `direction`, and with `speed` 0, the mark. In the browser, in each look.
20. **Groups:** every AIS type 0 to 99 is in exactly one group, in function 13's order and colours, and each has a name.
21. **Shared images:** 100 ships of one type and identity at 100 headings within 10 whole degrees make at most 10 images.

From M5, part 5 (the user's labels):

22. **Filtered:** a symbol with `uniqueDesignation`, `higherFormation` and `quantity`, rendered `withText` with `labels` `['uniqueDesignation']`, draws T and the quantity but not M (a spy on milsymbol's options); with `labels` `[]`, only the quantity; without `labels`, all three.
23. **Direction:** with `direction` 90 and `labels` without `direction`, no arrow, with or without `withText`; with it listed, the arrow. The default labels list it (owner, JF, 2026-11-07), so a user who changes nothing sees the arrow as before. A vessel's hull turns to 90 either way.
24. **Keys:** the same symbol with two label lists that change its drawing gives two cached images; a symbol with no amplifiers on the list gives one image for any list.

From M6, SDK 1.5.0 part 2 (images inside graphics):

25. **The 21 graphics:** a test over the whole catalogue, with sample points for each graphic, finds `images` on exactly the 21 graphics of function 15 (14 APP-6D, 7 APP-6E), each image with a `data:image/svg+xml` `svg` and a width and height above 0; every other graphic gives no `images`.
26. **Placing:** for one APP-6D minefield and one APP-6E contaminated area, each image's `position` and `angle` equal mil-sym-ts's own result for the same request (longitude first, points with latitude ≠ longitude), and its size equals the SVG's.
27. **Left out:** an image point with an `image` that is not an SVG data URI is left out, and the graphic still draws (a test with a doctored result).
28. **Offline:** drawing the 21 graphics makes no request beyond the emc2 server (criterion 17 still holds).

From M6, SDK 1.5.0 part 3 (the sensor report symbol; the test kit's `FAKE_SENSOR_REPORT_SYMBOL` is the map view's stand-in):

29. **The default:** with the default settings, `sensorReportSymbol()` returns a 10 by 10 image with anchor [5, 5]: an orange dot with a black outline (pixel samples: the centre orange, the dot's edge black, a corner transparent).
30. **Every shape and colour:** each of the five shapes in each of the nine colours, at 4 and at 32 pixels, gives an image of that size with its anchor at the centre; a black symbol has a white outline; the ring's centre and the cross's corners are transparent.
31. **The same until changed:** two calls return the same image; after the settings change to `square`, `red` and 20, the next call returns a new 20 by 20 red square. The manifest's schema refuses a size of 3 or 33, the shape `star` and the colour `pink`.
32. **Apart from APP-6:** `render` for a detection's SIDC gives the same image and key with any sensor report settings, and changing the user's symbol size or labels does not change the sensor report image.
33. **In the browser** (with `map-view-2d` and `gmti` or the simulator): the plugin's Settings entry shows the three settings (two selects and a number); a new shape shows on the map's detections within 2 s, without a reload; in a light and a dark look.

## Open questions for the owner

**M5, answered by the owner (2026-11-06):** Q2, the looks: graphics keep APP-6's colours and widths in every look. A halo round lines and labels, so that black lines stay readable on a dark map, is left for a later milestone (the owner, after the PDA pointed out that a halo in the look's ground colour does not help on a dark map). The other option was colours that follow the look.

M0: none. The SIDCs in `model/examples/` are syntactically valid, but their meaning has not been checked against the standards (`model/README.md`). The PCA checks the catalog entries against milsymbol's documentation and reports doubtful ones.
