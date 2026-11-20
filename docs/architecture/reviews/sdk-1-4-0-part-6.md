# ACA review of SDK 1.4.0 part 6: local folders, the overlay's area and label, and the `terrain` brief

- **Reviewed:** `pda/sdk-1.4-part6` at `44441255`: the contract `63ac6593` (the manifest's `folders` and model rule 19; `dev.emcc.sdk.folder`; the web overlay's `area` and `label` with their caps; `sdk-v1.md` "Part 6"; the design pattern; the test kits) and the `terrain` brief `75ce1cba` (`docs/plugins/briefs/terrain.md`). The rest of the branch is part 5 and the brief marks already approved (JG, JW, JX).
- **Against:** CR-0030 part 6 and the owner's Q18 to Q20 (KC, 2026-11-07); ADR-0049; ADR-0044 point 6; ADR-0030; ADR-0004 and overview 4.2; the ADR index's rules; the ACA's review of CR-0030 (R2, R5); the ESA's sheet `external/terrain/README.md`.
- **By:** the ACA, 2026-11-07. The ACA did not run the tests; the PDA reports model 109, the Java SDK and test kit green (test kit 308, 1 skipped: the symbolic-link test needs a privilege on Windows), web SDK 305.

## Verdict

**Part 6: approve for `integration/sdk-v1.4`.** It is CR-0030 part 6 as the owner approved it (Q18), with the rule that question 4 brought: ECore reads for the plugin, and plugins do no file I/O. **The `terrain` brief: ready for the owner's approval once the PDA makes the edit T1** (the DTED spacing comes from each cell's header; the zones above 70° are not twice). **ADR-0049 and Q19:** a dated note on the ADR's index row, added on this branch (R1); the ADR's text does not change.

## Part 6 against the decisions

| Source | Result |
|---|---|
| CR-0030 part 6 | Built as written: `folders` `{ id, setting, reason }` with `setting` a JSON Pointer to the admin's settings string; `context.folders().folder(id)` with `list` and `read`, each answering one message as `OutboundHttp` does; ECore resolves every path with its links and refuses one outside; 64 MiB per read; never writes; a changed setting applies at once; the Monitor shows each folder; the test kit over a real directory with the same checks. Two additions the CR did not spell out and the ACA takes: at most 8 folders per manifest and 8 calls in progress per plugin (`BUSY`), and ten named reasons. |
| ADR-0049 point 4, the CR-0030 review's R2 | The path comes only from the settings (the pointer, which only an admin sets); the plugin only reads; the manifest declares it; `PluginRules` keeps file I/O forbidden and names the two folder types as services. Model rule 19 records it. |
| ADR-0030 | A result's message never names the absolute path. Right, even though A8 lets the path reach logged-in browsers through the settings: a log line or an answer travels further than the settings do. |
| ADR-0004, overview 4.2 | No I/O on a plugin's worker; every call has a timeout; the result is always delivered; `Bytes` is immutable, so a cell travels between workers by reference. |
| ADR-0044 point 6 | `folders()` is a default method that throws until ECore has it, abstract at the freeze: ECore's to implement, nothing a plugin must. |
| The overlay | `area` (rings, the first the exterior, closed, at least 4 positions, geodesic edges, a `Style` with fill and pattern) and `label` (1 to 256 characters, size 8 to 32 px, a halo); 20 000 items and 200 000 positions per overlay; `overlayProblem` names what the map view refuses, and on a problem the map view draws nothing of that overlay and logs why, as the CR says. `map-view-2d`'s switch has a `default`, so it compiles unchanged until it draws them. |
| The CR-0030 review's R5 | Met by the brief: `maxCells` bounds one request and `cacheMegabytes` bounds the parsed cells, both admin settings. The defaults fit together: a 50 km viewshed at level 2 is about 8.7 million cells, under the 10 million default. |

## The `terrain` brief against ADR-0049

| Point | Result |
|---|---|
| 1, 6 | `terrain`, no GeoTools; DTED with the plugin's own code, parsing bytes from `LocalFolder` only. GeoTIFF is M6 (Q19). |
| 2 | Distance, initial and final bearings on WGS84 through `Geodesy.inverse`, on the server since the web SDK has no geodesy (A7); shown as the user's overlay with a label. Right. |
| 3 | Observer and target heights above ground, a maximum range, curvature and refraction through an admin coefficient (default 0.13, the usual value, with the usual lowering by d² / 2R × (1 − k)). Right. |
| 4 | One folder from the settings; no request names a path; the manifest declares `heights`; nothing shipped. Right. |
| 5 | Heights above ground from one data set at a time (A3: the finest level at the observer's point for the whole viewshed); longitude, latitude everywhere, and every test position has latitude ≠ longitude. Right. |
| 7 | Compute workers; a timeout and a cap on cells, admin settings with defaults, refused with the reason; one viewshed per user; one permission on every endpoint. Right. |
| 8 | The user's overlay, not shared or saved, gone on a reload or Clear; the rings within the overlay's caps, simplified until they fit. Right. |

## Remarks

| | Remark | For |
|---|---|---|
| R1 | **ADR-0049 and Q19.** Deferring GeoTIFF to M6 reverses nothing: the ADR's points 4 and 6 name no milestone, and the decision to read both stands. By the index's rules that is a dated note on the ADR's row, which the ACA adds on this branch (`docs/adr/README.md`): in M5 `terrain` reads DTED only; point 4's GeoTIFF, point 6's reader or approved library for it, and the Consequences' GeoTIFF test data move to M6. The M5 plan's row stays as the plan was approved; the brief's status line and the index note carry the change. | ACA (done here) |
| T1 | **The DTED spacing comes from the header.** Function 6 says "above 50° the longitude spacing is twice the latitude spacing". That is the 50° to 70° zone only; MIL-PRF-89020B has three times from 70° to 75°, four times from 75° to 80° and six times from 80° to 90°. The reader takes both intervals from the cell's user header (UHL) and checks them against the zone table, never the other way round. The ESA's Stockholm data (59° N) would pass either text; a PCA following the brief's words would misread an Arctic cell. **A required edit before the owner's approval**, since the brief's words would be followed as written. | PDA (brief) |
| R2 | **Eight calls at a time and the index.** The index lists the folder and each `e…`/`w…` subfolder: hundreds of `list` calls, against `MAX_CONCURRENT_CALLS` 8. Function 6 should say that the plugin queues its own calls and answers a `BUSY` by waiting for a result, never by retrying in a loop; the same for the reads of a viewshed's cells. The fake's `calls()` and `inFlight()` make it testable (criterion 4). | PDA (brief), PCA-terrain |
| R3 | **Open the resolved path.** ECore resolves a path with its links and then reads it; a link replaced between the two steps could lead outside. ECore opens the resolved real path, not the path as given, and reads from that; the SRA checks it in its next review, as ADR-0049's Consequences say. The symbolic-link test is skipped on Windows without the privilege, so the CDA's own test of the rule runs on Linux in the ITA's run, or on a Windows machine with the privilege. | CDA, SRA, ITA |
| R4 | **Lines and the circle in the overlay.** `OverlayArea`'s TSDoc says its edges are geodesic; the `line` item says nothing, and the brief's function 2 relies on the map view densifying the range line geodesically. One sentence on `OverlayItem` makes it a rule for lines as for areas (model rule 10): a TSDoc edit, no member change. The overlay has no circle, so function 3's range circle is a closed `line` the plugin densifies (72 positions suffice at 50 km), counted against the caps. | PDA (TSDoc, brief) |
| R5 | **The level 2 read and the limits.** A level 2 cell at 1 arc second is 3 601 × 3 601 × 2 bytes plus headers, about 25.9 MB, under the 64 MiB read; above 50° it is smaller. Function 6's "reads each cell whole" holds. Nothing to change; recorded so that the limit is not raised without need. | – |

## What the ACA checked beyond the branch

The ESA's terrain sheet on `main` (`external/terrain/`: SRTM N59E017 and N59E018 as DTED, the Stockholm area, with the pitfalls the brief cites); the web SDK for geodesy (none: the map view densifies, the model's edges are geodesic by rule 10), which bears out A7; the test names of `Part6TypesTest` and `FakeFoldersTest` against the contract's rules (byte ranges and sorted listings, paths outside and badly written, a link outside, `NOT_SET`, `MISSING`, `WRONG_KIND`, `TOO_LARGE`, a changed setting, eight calls and the timeout, the builder's checks); the overlay budget of a viewshed (a 10 km viewshed at level 2 covers about 350 000 cells, so function 5's simplification is needed, not optional).
