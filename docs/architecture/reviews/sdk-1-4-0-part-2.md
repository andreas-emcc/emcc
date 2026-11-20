# ACA review of SDK 1.4.0 part 2: tactical graphics, and its three briefs

- **Reviewed:** `pda/sdk-1.4-part2` at `5cf2fb7`: the build in `8f9ce95`, `c14b835` and `74b799f`; the briefs in `4d4d4a4` (`symbology` functions 7 to 10, `map-view-2d` functions 29 to 32, `draw-tactical` new).
- **Against:** CR-0030 part 2 (owner GS, 2026-11-05); ADR-0043 point 9, with points 2, 3, 5, 7 and 8; the owner's answers Q1 to Q4 of 2026-11-06; `model/README.md` rules 1 and 13; mil-sym-ts 2.10.9's own lookup tables, read from the package installed in the S1 spike's folder (read only).
- **By:** the ACA, 2026-11-06. The PDA reports the tests green: model 92, web SDK 276, Java SDK 101, test kit 288.

## Verdict

**Approve part 2 for `integration/sdk-v1.4`, and the three briefs for the owner's approval.** The contract matches CR-0030 part 2 and ADR-0043 point 9, every addition is optional for plugins built for 1.3.0, and the owner's four answers are in the right places. The remarks below block nothing; R1 is the one the briefs should take before the PCAs start.

## The PDA's four points

| | Point | ACA |
|---|---|---|
| 1 | **The amplifier list from mil-sym-ts's table,** not the CR's tentative H1, H2, X1 | **Right, and checked.** The ACA decoded the `msd` (2525D, version 10) and `mse` (2525E, version 16) tables of mil-sym-ts 2.10.9 from the installed bundle. The control-measure graphics (symbol set 25) with the geometry Line or Area use exactly the codes AM, AN, AP, AS, B, H, N, T, T1, V, W, W1, X and Y, and in 2525E also T2. No graphic uses H1, H2 or X1. So the six additions (`distances`, `azimuths`, `targetNumber`, `uniqueDesignation1`, `uniqueDesignation2`, `dtg1`) are the complete set beyond milsymbol's names, and B is the SIDC's echelon, rightly a flag on the catalogue entry. The CR allowed the build to fix the list. See R6 for recording it. |
| 2 | **A `Polygon` only for areas without point roles** | **Right.** Rule 1 normalises a ring's orientation, so a `Polygon` cannot keep an order in which the first point means something. A `LineString` of the ring without its closing position keeps it. One consequence for the briefs: R1. |
| 3 | **`MapView.draw`'s `graphic` and the point limits** (owner Q1) | **Right, as an addition beyond the CR's text that the owner's Q1 made necessary.** An optional option, so no plugin is affected but `map-view-2d`, which provides `MapView`. The limits from `graphicCatalog` (no finish before `minPoints`, finish at `maxPoints`) keep the result drawable. See R6. |
| 4 | **The owner's Q1 to Q4** (Q2: no halo in M5) | In the right places: Q1 in the SDK, `map-view-2d` 32 and `draw-tactical` 2; Q2 in `symbology` 9 and `map-view-2d` 29, with the halo out of scope in both; Q3 in `draw-tactical` 1; Q4 in `map-view-2d` 29. See R3 on the word "halo". |

## Against CR-0030 part 2 and ADR-0043

| Source | Result |
|---|---|
| CR part 2, the amplifiers | Matches, with the list fixed in the build as the CR allowed (point 1 above). Java `Modifiers` keeps the 1.3.0 constructor; the web `Modifiers` and the test kit's exhaustive record gain the same names. |
| CR part 2, the order of the points | Matches: in the catalogue as text (`points`) and counts; the model's text in "Changes in 1.4.0" says the catalogue gives the meaning. |
| CR part 2, the catalogue | Matches: code, name, kind, counts, what each point is, required and allowed amplifiers; plus `path` for a palette, the stored geometry type and `echelon`, all useful. |
| CR part 2, the draw call | Matches: flat arrays, lines and fills with styles, labels with position, angle and font, or a refusal; a promise that never rejects, with the timeout inside (ADR-0043 point 3). `resolution` and an extent in longitude, latitude replace the sketch's scale and projection; the result is in longitude, latitude and the map view projects it, which is ADR-0043 point 7 as written. |
| CR part 2, the test kit | Matches: four graphics, a predictable line, refusals by reason, `refuse()`. |
| ADR-0043 points 2, 4 | The briefs: only `symbology` touches mil-sym-ts, as its own dependency, bundled in the worker; `draw-tactical` and `map-view-2d` ask the service. |
| ADR-0043 points 3, 5, 7, 8 | `symbology` 9: one worker, loaded at the first need, copies in and out, a timeout per request, the version digits 10 and 16, flat `Float64Array`s transferred, refusals as values. `map-view-2d` 29: slices, the antimeridian in EPSG:3857, the fallback marker. |
| ADR-0043 point 9, the looks | Settled in the briefs by the owner's Q2. |
| Model rules 1, 9, 13 | Rule 1 respected by point 2 above; rule 9's test with latitude ≠ longitude is in `map-view-2d` 61, `symbology` 11 and `draw-tactical` 2. Rule 13: see R2. |
| Compatibility | Optional members on `SymbolService` until `symbology` provides them, then required at the freeze, as `setSettingsPanel` was; an optional option on `draw`; optional content fields. Every 1.3.0 document stays valid. `symbology`'s `TEXT_MODIFIERS` stops compiling until it lists the four names, so part 2 lands in one run with that one-line change, as the PDA says; ECore's codec is covered by `CODEC_PENDING` until the CDA maps the arrays (R7). |

## Remarks (no approval needed)

| | Remark | For |
|---|---|---|
| R1 | **The drawn ring must come back in the clicked order.** `draw-tactical` 2 stores an `area` whose points have roles as a `LineString` of the ring returned by `draw('polygon', { graphic })`. That only works if `map-view-2d` returns the ring as clicked, never reoriented. `map-view-2d` 32 and criterion 68 say so ("the ring is in the clicked order, the closing position last"). The store may still reverse a stored `Polygon`, which is why the catalogue allows one only without roles. | PDA (briefs), PCA-map-view-2d |
| R2 | **Two small model points to write down.** `azimuths` allows 360 inclusive while `direction` excludes it: say why (a sector's right limit at 360 means a full circle) or make it exclusive. `distances` and `azimuths` have `minItems` 1 and are not in rule 13's list, so an empty array is invalid rather than "the same as absent"; the Java record's empty list is omitted by the codec. One sentence in "Changes in 1.4.0". | PDA |
| R3 | **Two halos.** `GraphicLabel.halo` is mil-sym-ts's own text outline, part of APP-6's look that the owner kept (Q2). The halo the owner deferred is one round a graphic's lines and labels for dark maps. `symbology` 9 ("Out") says the first is passed through as the renderer gives it, so the PCA neither strips it nor adds the second. | PDA (brief) |
| R4 | **The counts in `symbology` 8 are the spike's.** The ACA's read of 2.10.9's tables, all versions unfiltered, gives 292 line or area records for 2525D and 336 for 2525E, not 311 and 286. Criterion 10's comparison with the lookup is the truth; the brief says "about" or drops the numbers, and the PCA's README lists what it found. | PDA (brief), PCA-symbology |
| R5 | **Field sets on graphics.** CR-0030 part 3 brings field sets (ADR-0050) to editors. `draw-tactical`'s edit panel lists what it shows and does not mention them. The brief says whether a graphic's edit panel offers field sets in M5. The ACA recommends not: graphics carry no protocol fields today, and `draw-symbols` is where the sets live. The owner may want otherwise. | PDA (brief), owner |
| R6 | **Record the two departures from CR-0030's text in the CR.** The amplifier list as built (AP and T2 in, H1, H2 and X1 out) and `MapView.draw`'s `graphic` with its limits (owner Q1, 2026-11-06) are in `sdk-v1.md`. A dated note in CR-0030's Decision keeps the approved CR and the build in step, as the index notes do for ADRs. | MCA (the owner's word) |
| R7 | **The CDA's half before any writer of distances.** `ModelJson` must map `distances` and `azimuths` (today `CODEC_PENDING`), and `ObjectStore`'s "only a move" check must treat a change of them as a change, before `draw-tactical` or the simulator writes a graphic with them; until then such an object would not decode in ECore. The board puts the CDA's part 2 half before PCA-draw-tactical's start. | CDA, MCA |
| R8 | **A null list in `Modifiers`** fails with a bare `NullPointerException` in `checked`; `Objects.requireNonNull` with the name, as the other records do. Trivial. | PDA |

## What the ACA checked in mil-sym-ts

The bundle `C5Ren.mjs` of `@armyc2.c5isr.renderer/mil-sym-ts-web` 2.10.9 holds the lookup tables as the objects `msd_default` and `mse_default` (`SYMBOL` arrays; a record's `ss` carries over to the records after it). For symbol set 25, the records with `geometry` Line or Area carry a `modifiers` string of amplifier codes. The codes in use are listed in point 1 above; the four graphics of the test kit's catalogue have `B,T,T1,AS` (boundary), `T` (phase line), `T,W,W1` (main attack) and `AM,AN,X` (sector range fan), which is what `FAKE_GRAPHICS` says, with B as `echelon`. The throw-away script stayed in the ACA's scratchpad; nothing was copied.
