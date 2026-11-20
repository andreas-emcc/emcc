# Plugin briefs

One brief per planned plugin. A brief tells the plugin agent (PCA) **what** to build. **How** to build it is in the plugin design pattern (`docs/plugins/design-pattern.md`), the SDKs and the plugin template. **The owner approves each brief before its PCA starts** (`agents/pda.md`).

| Brief | Kind | Parts | Task | Status |
|---|---|---|---|---|
| [map-view-2d](map-view-2d.md) | Map view | web | T-019; M1: T-042; M2: T-054 | Approved (2026-10-05). M1 edit (vector backgrounds) approved (2026-10-10). M1 edits (area of interest, clusters; fading) approved (2026-10-10). Edit (objects outside the world extent) approved (2026-10-12). M2 update (selection, menus, drawing service, styles, dim, setup share) approved (2026-10-15); function 21 (ADR-0034) and the conformance review's fixes confirmed (2026-10-15). **M3 update** (T-077, for T-085: workspaces, View's layers as a reference, fade lists) approved by the owner (2026-10-27), after the ACA's review and recheck (T-078), with the owner's decisions of 2026-10-27; amended (owner, 2026-10-28, T-085 Q3): a fade list stays when its plugin stops, and the bound of 10 000 ids per list. **T-066** (drag a selected shape; owner, 2026-10-19 and 2026-10-27): function 26, criterion 51: what is built, and one small fix (route markers in the drag preview); approved by the owner (2026-10-27), merged as `0a35905`. **M5 edit** (T-144: drawing, selecting, dragging, placing and editing tactical graphics; owner Q1, Q2 and Q4, 2026-11-06), draft 2026-11-06, for the owner's approval. **M5 part 3 edit** (CR-0030 part 3, CR-0031; 2026-11-06), approved by the owner (IB): vessel symbols drawn (T-139). Its M5 part 2 edit is approved (HQ). **M5 edit** (T-150; 2026-11-06), approved by the owner (IQ): relation lines, first the GMTI pairing. **M5 part 5 edit** (CR-0030 part 5, ADR-0046; owner Q13 and JF; 2026-11-07), approved by the owner (JG): the user's size, labels and speed vector (T-138). **M5 edit** (PCA-gmti's finding; 2026-11-07), approved by the owner (JX): `ArcBand` and `Corridor` drawn as areas (function 36). **Edit** (owner LB and LC; 2026-11-08), approved by the owner (LI): the speed vector black, and the map view's direction arrow not drawn where a vector is and not tied to the `direction` label (function 35, criteria 78 and 79). **Edit** (the 1.4.0 freeze, owner Q23; 2026-11-08), approved by the owner (LN): criterion 63 without the service lacking its member. **Edit** (M6, CR-0039 part 2; 2026-11-10), for the owner's approval: graphic images drawn (function 37, criteria 89 to 93). **Edit** (M6, CR-0039 points 5 and 6; 2026-11-10), approved by the owner (PI A): the speed vector in steps and sensor report symbols (T-164, T-151; functions 38 and 39, criteria 94 to 100). **M7 edit** (2026-11-11, CR-0041), approved by the owner (RJ A): functions 40 to 45 (T-182, T-183, T-186, T-181, T-176, `core.text`), criteria 101 to 106 |
| [basemap-osm](basemap-osm.md) | Background map | server (tile proxy) + web | T-020 | Approved (2026-10-05). Edit (settings apply at once) approved (2026-10-12). **M3 update** (T-077, for T-085: nothing to build; criteria in Simulation) approved by the owner (2026-10-27), after the ACA's review and recheck (T-078), with the owner's decisions of 2026-10-27 |
| [symbology](symbology.md) | Utility | web | T-021 | Approved (2026-10-05). **M5 edit** (T-144; CR-0030 part 2, ADR-0043: the graphics catalogue and drawing with mil-sym-ts in a Web Worker; owner Q2, 2026-11-06), approved by the owner (2026-11-06, HQ). **M5 part 3 edit** (CR-0030 part 3, CR-0031; 2026-11-06), approved by the owner (IB): vessel symbols and their ship-type groups (T-139). **M5 part 5 edit** (CR-0030 part 5, ADR-0046; owner Q13 and JF; 2026-11-07), approved by the owner (JG): `render`'s `labels` (T-138). **Edit** (owner LS; 2026-11-08), approved by the owner (LS): the vessel outline's 1 px gap in the look's ground colour (function 12, criterion 19). **Edit** (M6, CR-0039 part 2; 2026-11-10), for the owner's approval: graphic images (function 15, criteria 25 to 28). **Edit** (M6, CR-0039 point 6; 2026-11-10), approved by the owner (PI A): the sensor report symbol (T-151; function 16, Settings, criteria 29 to 33) |
| [coordinates](coordinates.md) | Utility | web | T-022; M1: T-042 | Approved (2026-10-05). M1 edit (UPS) approved (2026-10-10). CR-0012 (`uses` the map view, settings at once) approved (2026-10-11). **M3 update** (T-077, for T-085: the cursor display and "go to" in every workspace) approved by the owner (2026-10-27), after the ACA's review and recheck (T-078), with the owner's decisions of 2026-10-27 |
| [draw-symbols](draw-symbols.md) | General | web | T-023; M1: T-042; M2: T-054 | Approved (2026-10-05). M1 edit (data type, permissions) approved (2026-10-10). M1 edit (subscription by area) approved (2026-10-10). M2 update (Edit only; selection and Delete move) approved (2026-10-15). Subscription: the layers and the selected symbol only (owner, 2026-10-17). **M3 update** (T-077, for T-085: workspaces; the "+" for declared fields, ADR-0038) approved by the owner (2026-10-27), after the ACA's review and recheck (T-078), with the owner's decisions of 2026-10-27. **T-066** (drag a selected shape; owner, 2026-10-19 and 2026-10-27): function 23, criteria 34 and 35; approved by the owner (2026-10-27), merged as `0a35905`. **M5 part 3 edit** (CR-0030 part 3, CR-0031; 2026-11-06), approved by the owner (IB): field sets in the editor, vessel symbols in the picker, `relations` forwarded (T-132, T-139, T-150). **Edit** (M6, T-165, CR-0038; 2026-11-10), approved by the owner (NQ A): function 30, criteria 50 to 53: the select without the types users do not choose, the type's sets at once, one set at a time. **M7 edit** (2026-11-11, CR-0041 part G), approved by the owner (RJ A): function 31, symbol palettes (T-156), criteria 54 to 56 |
| [layer-panel](layer-panel.md) | General | web | T-024; M1: T-042; M2: T-054 | Approved (2026-10-05). M1 edit (permissions) approved (2026-10-10). M1 edit (layers and counts without objects) approved (2026-10-10). Edit ("Layer N" numbering) approved (2026-10-12). M2 update (double-click opens `object-list`; the eye in setups) approved (2026-10-15). The owner's decisions of 2026-10-17 recorded (Enter and Space; status `OK` without `object-list`). **M3 update** (T-077, for T-085: the workspace's layers, its edit permission, View's layers as a reference) approved by the owner (2026-10-27), after the ACA's review and recheck (T-078), with the owner's decisions of 2026-10-27. **Edit** (M6, CR-0039 point 9; 2026-11-11), approved by the owner (PR A): a new layer's classification in a small dialog (T-171, Q46 A; function 23, criteria 27 to 31). **Edit** (M6; 2026-11-11), approved by the owner (PR A): the active layer's name over the map (T-154, Q47 A, Q48 A; function 24, criteria 32 to 35) |
| [cot](cot.md) | General, ingoing; outgoing from M3 | server | T-040 (M1); M3: T-077, T-084 | Approved (2026-10-10). Edit (one track from two streams) approved (2026-10-10). Renamed from `cot-in` (owner, 2026-10-11); "Later: outgoing" and criterion 13 approved (2026-10-11). **M3 update** (T-077: links in and out, connection tasks, output channels, declared fields; ADR-0036 to ADR-0038) approved by the owner (2026-10-26), after the ACA's review (T-078). The owner's decisions on PCA-cot's part 3 (2026-10-27): what a link remembers of channel items, items while a link is down, the echo as checked with the real TAK Server (functions 19 and 21, criteria 27 and 28); open question 10 on what they left open, decided as recommended (2026-10-27). The owner's N1 and S1 (2026-10-28): the echo of a source-layer object is not stored (functions 19 and 22, criterion 16). The owner's Z1 (2026-10-28): a write stall check, `writeStallSeconds` (functions 12 and 22, criterion 29), with AB, AD1 (restart at once, without the back-off) and AE1 (every write watched, the presence event's too). **M5 part 3 edit** (CR-0030 part 3, CR-0031; 2026-11-06), approved by the owner (IB): the field set `cot.unit` with the Callsign and every CoT unit field (T-132, T-131), vessels out (T-139). **Edit** (owner LU and LV; 2026-11-08), approved by the owner: a value outside `cot.unit`'s limits left out of the set; criterion 36's real-server check is the simulator's criterion 45 (function 23, criteria 33 and 36). **Edit** (T-129, owner MD A and ME A; 2026-11-09), for the owner's approval: the full symbol code and amplifiers to and from TAK, ATAK's format both ways and WinTAK's in, 2525C ↔ APP-6D through mil-sym-ts's `c2d_default`, no model or SDK change (functions 26 to 29, criteria 37 to 43, open question 11). **Edit** (M6, T-165, CR-0038; 2026-11-10), approved by the owner (NQ A): function 30, criterion 44: `cot.cot` names `cot.unit`. **Edit** (M6, CR-0039 points 10 and 11; 2026-11-11), approved by the owner (PR A): a moved track stays where the user put it (T-155). **M7 edit** (2026-11-11, CR-0041 part G), approved by the owner (RJ A): function 32, the palette "CoT" (T-156), criterion 46. **M9 edit** (D6p, ADR-0062; 2026-11-17), **approved by the owner (AAQ A)**: function 33, a TLS link picks its credential (`links[].tlsCredential`, kind `tls-credential`; empty: the link's name), criterion 47 |
| [basemap-naturalearth](basemap-naturalearth.md) | Background map | web | T-041 (M1) | Approved (2026-10-10). **M3 update** (T-077, for T-085: nothing to build; criteria in Simulation) approved by the owner (2026-10-27), after the ACA's review and recheck (T-078), with the owner's decisions of 2026-10-27 |
| [draw-shapes](draw-shapes.md) | General | web | T-053 (M2); T-066 (M3) | Approved (2026-10-15). Subscription: the layers and the edited shape only (owner, 2026-10-17). **M3 update** (T-077, for T-085: workspaces; Edit and routes) approved by the owner (2026-10-27), after the ACA's review and recheck (T-078), with the owner's decisions of 2026-10-27. **T-066** (drag a selected shape; owner, 2026-10-19 and 2026-10-27): function 16, criteria 25 to 30; the selected shape followed by function 7's subscription, which widens the owner's decision of 2026-10-17; approved by the owner (2026-10-27), merged as `0a35905`; amended (owner, 2026-10-27): a tool or a reshape ended with `null` does not arm the drag again. **Edit** (M6, T-165, CR-0038; 2026-11-10), approved by the owner (NQ A): function 18, criterion 36: the select without the types users do not choose. **M7 edit** (2026-11-11, CR-0041), approved by the owner (RJ A): function 19, Append (T-176), criteria 37 and 38 |
| [bookmarks](bookmarks.md) | Utility | web | T-053 (M2) | Approved (2026-10-15). **M3 update** (T-077, for T-085: nothing to build; criteria in Simulation) approved by the owner (2026-10-27), after the ACA's review and recheck (T-078), with the owner's decisions of 2026-10-27 |
| [object-list](object-list.md) | General | web | T-053 (M2) | Approved (2026-10-15). **M3 update** (T-077, for T-085: the workspace's own layers) approved by the owner (2026-10-27), after the ACA's review and recheck (T-078), with the owner's decisions of 2026-10-27 |
| [basemap-wms](basemap-wms.md) | Background map | server (capabilities, map pass-through) + web (settings panel) | T-071 (M4) | Draft (2026-10-20), with the owner's answers of that day; needs CR-0022 (SDK 1.2.0) and CR-0023 (SDK 1.3.0, CR-0028 part 1); SDK lines updated 2026-10-30 |
| [simulator](simulator.md) | General | server (engine) + web (Simulation workspace) | T-077 (brief), T-083 (M3) | Approved by the owner (2026-10-26), after the ACA's review and recheck (T-078), with the owner's answers to open questions 2 to 18. Commands need POST endpoints: CR-0026, approved and folded into SDK 1.2.0 (owner, 2026-10-26). Function 22: the fade list set again on a switch, with criterion 26 (owner, 2026-10-27; the ACA's U2). Amended with the owner's decision of 2026-10-27: what a reset restores lives on the track (functions 13 and 20, criterion 20). **M5 edit** (T-141, T-143, T-150; 2026-11-06), approved by the owner (IQ): the GMTI sensor and its Sensors panel, Sensor outputs, the pairing on its platform, the channels' field sets, scenarios (owner Q5 to Q7, Q9). **Edit** (CR-0033; 2026-11-07), approved by the owner (JW): the sensor's name and settings in each dwell (function 29, criterion 47). **Edit** (CR-0034, KF), approved by the owner (KI): the sensor's Mission (functions 27, 29 and 32). **Edit** (CR-0035, KL and KM; 2026-11-07), approved by the owner (KQ, 2026-11-08): the warning and `simulator.beyond-reach` for tracks beyond an output's `maxAreaDepth` (functions 28 to 30, criterion 48). **Edit** (owner KW and KX; 2026-11-08), approved by the owner (LA): every track type detected (A99), an error of 0 is none (A100), the Sensors panel's units, the kind's id `simulator.beyond-reach` (functions 27, 28 and 30, criteria 37 and 48). **Edit** (owner LJ; 2026-11-08), approved by the owner (LJ): Export and Import scenario two buttons in the Routes panel; the top-bar button is T-152 for M6 (function 32). **Edit** (T-158; 2026-11-09), approved by the owner (MW A) with Q25 to Q29 as recommended: each sensor's coverage drawn round its platform as a map overlay (function 33, criterion 49). **Edit** (owner MX; 2026-11-09): equal start and end bearings look all round, in detection and drawing (functions 27, 28 and 33, criterion 36). **Edit** (M6, T-165, CR-0038; 2026-11-10), approved by the owner (NQ A): functions 34 and 35, criteria 50 and 51: `simulator.route` `manual: false`; the Event panel one set at a time. **Edit** (M6, CR-0039 point 7 and CR-0040; 2026-11-10), approved by the owner (OU A): two sensor types, the ground radar's dwells, the generic sensor and the job area (T-168, T-169; functions 36 to 39, criteria 52 to 59). **Edit** (M6, CR-0039 points 10 and 11; 2026-11-11), approved by the owner (PR A): a moved track stays where the user put it (T-155). **Edit** (owner, PX; 2026-11-11), decided by the owner: no generic sensor in M6; a scenario file's generic sensor left out (Q52 B; functions 36 and 38, criteria 52 and 58). **M7 edit** (2026-11-11, CR-0041), approved by the owner (RJ A): functions 41 to 49 (T-177 to T-180, T-184, T-185, T-182, T-152, T-176), criteria 61 to 72, Q55 to Q57 and Q61 |
| [ais](ais.md) | General, ingoing | server | T-094 (brief), T-096 (M4) | Draft (2026-10-31), for the owner's approval: in the in/out playbook's format (v1; BR, BU), input only; built on SDK 1.2.0 from `main`. **M5 part 3 edit** (CR-0030 part 3, CR-0031; 2026-11-06), approved by the owner (IB): the symbol type per link, vessel by default (T-140, GL), and the field set `ais.ship` (T-132). **Edit** (M6, T-165, CR-0038; 2026-11-10), approved by the owner (NQ A): section 11, criterion 20: `ais.vessel` names `ais.ship`. **Edit** (M6, CR-0039 points 10 and 11; 2026-11-11), approved by the owner (PR A): a moved track stays where the user put it (T-155) |
| [adsb](adsb.md) | General, ingoing | server | T-094 (brief), T-097 (M4) | Draft (2026-10-31), for the owner's approval: in the in/out playbook's format (v1; BR, BU), input only; built on SDK 1.2.0 from `main`. **M5 part 3 edit** (CR-0030 part 3, CR-0031; 2026-11-06), approved by the owner (IB): the field set `adsb.aircraft` (T-132). **Edit** (M6, T-165, CR-0038; 2026-11-10), approved by the owner (NQ A): section 11, criterion 18: section 10's set built, `adsb.aircraft` names it. **Edit** (M6, CR-0039 points 10 and 11; 2026-11-11), approved by the owner (PR A): a moved track stays where the user put it (T-155) |
| [draw-tactical](draw-tactical.md) | General | web | T-144 (M5) | Approved by the owner (2026-11-06, HQ): new (owner, GM), with the owner's Q1 and Q3 of 2026-11-06; built on SDK 1.4.0 part 2; no field sets in M5 (HS). **Edit** (the 1.4.0 freeze, owner Q23; 2026-11-08), approved by the owner (LN): criterion 14 retired, `graphicCatalog` is required. **Edit** (M6, T-165, CR-0038; 2026-11-10), approved by the owner (NQ A): function 13, criterion 17: the select without the types users do not choose. **Edit** (M6, CR-0039 part 2; 2026-11-10), for the owner's approval: graphic images, nothing to build (function 14, criterion 18) |
| [gmti](gmti.md) | General, in and out | server | T-141 (M5) | Approved by the owner (2026-11-06, IQ): new (STANAG 4607, ADR-0048), by the playbook v3, with the owner's Q8 and A1 to A8; built on SDK 1.4.0. **Edit** (CR-0033; 2026-11-07), approved by the owner (JW): `P8` and the sensor's values out, with `J15` 0 for a revisit it cannot hold; the detection key of Q3, the classes and the reference day aligned (format rules G2, G4, G6, G10, G13); `D26` cut at 255.99 km from the near edge and the detections beyond dropped (owner, JS and KA; G12). **Edit** (CR-0034, KF), approved by the owner (KI): `M1` and `P9` from the sensor's mission. **Edit** (CR-0035, KL and KM; 2026-11-07), approved by the owner (KQ, 2026-11-08): `maxAreaDepth` 511 980 m, a `Circle` sent with its centre halfway out, the cut 511.98 km beyond the near edge ("Out", criterion 19). **Edit** (T-158; 2026-11-09), approved by the owner (MW A) with Q26 to Q28 and Q30 as recommended: an incoming sensor's coverage, the job definition's bounding area, beside the dwell area (section 3, the link setting `coverage`, criterion 21). **Edit** (T-159, owner MV A; 2026-11-09): the out link setting `oneSegmentPerPacket`, each segment in its own packet, approved by the owner (MY) **on by default** ("Out", section 5, criterion 22). **Edit** (after PCA-gmti's T-158 build; 2026-11-09), for the owner's approval of the wording: the dwell area 3 px solid (owner), the coverage's time before the first dwell, interleaved jobs (section 3). **Edit** (M6, T-165, CR-0038; 2026-11-10), approved by the owner (NQ A): section 3, criterion 23: `gmti.detection` names `gmti.report`; both types `manual: false`. **Edit** (M6, CR-0039 point 7 and CR-0040; 2026-11-10), approved by the owner (OU A): the job area, ground radars only and a revisit's dwells (T-168, T-169; "In", "Out", criteria 24 to 27). **Edit** (M6, CR-0039 point 6; 2026-11-10), approved by the owner (PI A): `gmti.detection` declares `sensorReport` (T-151; section 3, criterion 28). **Edit** (owner, PK A; 2026-11-10), decided by the owner: `J6`–`J13` clockwise, a job area that is not a convex four-corner area as its box, the dwell area names (criterion 29). **Edit** (M6, CR-0039 point 8; 2026-11-11), approved by the owner (PR A): the link fields by mode and direction (T-160, Q45 A; section 5, criteria 30 and 31). **Edit** (M6, CR-0039 points 10 and 11; 2026-11-11), approved by the owner (PR A): a moved track stays where the user put it (T-155). **M7 edit** (2026-11-11, CR-0041), approved by the owner (RJ A): the 2 px dwell area, colour settings, display classes and `defaultOn` (T-181, T-182, T-185), criteria 33 to 37 |
| [terrain](terrain.md) | Utility | server (height data, computing) + web (panel, overlay) | T-142 (M5) | Approved by the owner (2026-11-07, KH), after the ACA's review (T1, R2, R4 taken): new (ADR-0049), range and bearing and a viewshed from DTED; GeoTIFF moved to M6 (owner, Q19); assumptions A1 to A9 accepted (Q20); built on SDK 1.4.0 part 6. **Edit** (owner LE; 2026-11-08), approved by the owner (LI): `timeoutSeconds` 5 to 55. **M7 edit** (2026-11-11, CR-0041), approved by the owner (RJ A): functions 10 to 12, the height map (T-166), the spike T-167 and the `%emcc%/` default (T-157), criteria 15 to 20, Q53 and Q54 |
| [nvg](nvg.md) | General, in and out | server (parsing, links, endpoints) + web (panel) | T-173 (M7) | Approved by the owner (2026-11-11, RJ A), with RK A, RL B and RM A; its assumptions N1 to N12 not accepted, rewritten for the owner (2026-11-12): new (ADR-0055, `docs/architecture/nvg.md`), files and the NVG web service both ways, by the playbook v3; built on SDK 1.6.0 part A (CR-0041) |
| [fmv](fmv.md) | General, ingoing | server (links, transport stream, KLV, stream channel) + web (FMV panel, video window) | T-207 (brief), T-209 (M8); D6u (section 10), F1 and F2 (M9) | **Approved by the owner (2026-11-14, VP A, VR A)**; the draft merged as `4fed80e2` (VS A): new (ADR-0057, accepted by the owner, VL A, as CR-0045 records; spike S9), STANAG 4609 by the playbook v3, input only, with the owner's answers of 2026-11-14 (the camera a UAV with photographic reconnaissance, a floating window, waiting for a conversion slot; all A) and assumptions F1 to F8. **Updated 2026-11-15** after the first build (WA): `fmv.field-of-view` and the link's key as data source (WA A), a renamed link keeps its objects by a stable id (WA B; CR-0047, SDK 1.8.0 part F, for the owner's approval), the tags checked against ST 0601.14 and ST 0102.12; built on SDK 1.8.0 part E (CR-0044, approved as CR-0043's part E, VQ A; MPEG-2 with CR-0045, VN A). **M9 section 10, the output link (D6u), approved by the owner (2026-11-17)** with O1 to O12; **updated 2026-11-17** after PCA-fmv's F1 phase 2: the channel's link name `out-<id>`, the release limit's default, the destination a declared connection (AAA A) |
| [uav-simulation](uav-simulation.md) | General | server (cameras, pointing, poses) + web (Cameras panel in Simulation) | D6u (brief), V1 (M9, the UAV track) | **Approved by the owner (2026-11-16, YR A)**, with U1 to U10: new (ADR-0059, with ADR-0058 point 1; owner XQ A, Q6 A, Q7 A, Q8 M10); section 4, the pose's shape and its channel kind, written with CR-0048 (a kind `fmv` declares, `fmv.camera-pose`; approved with the CR, ZB A; GQ2 A) |

**M1 briefs and edits** (T-033, 2026-10-10) are built against SDK v1 and data model 1.0.0 (T-034, CR-0010). Their PCAs start after the freeze and the CDA's runtime side (T-038). The double-click edits in `map-view-2d` and `draw-symbols` (T-032) are approved by the owner and need no SDK v1.

**M2 briefs and updates** (T-048, 2026-10-14 and 2026-10-15) follow ADR-0027, ADR-0029 and ADR-0031 to ADR-0034, and the owner's open details of 2026-10-14. They are built against SDK 1.x (T-049) and data model 1.1.0 (T-064), both through change requests; each addition they need is listed below.

## M2: what the briefs need from T-049 and T-064

Additions the M2 briefs name as "planned in T-049" (web SDK 1.x, compatible) or "in T-064" (data model 1.1.0, compatible). The CRs for T-049 and T-064 start from this list; the names there win.

| Addition | For | Briefs |
|---|---|---|
| **T-049:** panels registered with a default pane (left, right, bottom), and a plugin showing its own panel: expanding it and bringing it to the front of its pane | ADR-0031 point 4 | `draw-shapes`, `draw-symbols`, `layer-panel`, `object-list` (and every plugin with a panel); showing its own panel: `draw-symbols` (function 14), `draw-shapes` (function 3), `object-list` (function 2) |
| **T-049:** the object action list (id, label, icon, group and order; applies by `type`, `dataType` or a test; one or several objects; permission; handler with ids) and the map action list (handler with a position); opening the shell's menu at a pointer for a selection or a position, with a first step where the user chooses one of several overlapping objects (the map view passes the candidates, the shell's menu shows the choice) | ADR-0032 points 2–5 | `map-view-2d` (functions 15, 16), `draw-shapes` (function 3), `draw-symbols` (function 14), `object-list` (function 6) |
| **T-049:** fetching objects by id, also objects the browser does not hold | ADR-0032 consequences | `map-view-2d` (function 16), `draw-shapes` (function 3), `draw-symbols` (function 14) |
| **T-049:** `MapView` methods that centre on and zoom to objects by id, which the map view's own actions Centre on and Zoom to also call (the ACA's recommendation, 2026-10-15; not running another plugin's action by its id, which would couple plugins in a hidden way) | ADR-0032 point 6 | `map-view-2d` (function 16), `object-list` (function 6) |
| **T-049:** the map view's drawing service (a kind, a preview style; press-and-drag or point by point; returns lon/lat geometry, circles and ellipses in metres and an ellipse with its rotation, or `null`) and editing service (move, drag corners or points, a circle's radius and an ellipse's axes and rotation by handles; returns the new geometry, or `null`) | ADR-0033 point 3 | `map-view-2d` (function 17), `draw-shapes` (functions 2, 4) |
| **T-049:** each part saving and restoring its share of a setup (reporting changes, applying a restored share) | ADR-0031 point 5 | `map-view-2d` (function 20) |
| **T-049:** setting and reading the map type (projection and background), centre and zoom through `MapView`, and the dim level as part of the map view's setup share | ADR-0031 consequences | `map-view-2d` (functions 19, 20), `bookmarks` (functions 2, 3) |
| **T-049:** a change event for the layers' local visibility (`MapView`), so that panels follow a restored setup | ADR-0031 point 5 | `layer-panel` (function 13) |
| **T-049:** the objects panel as a service that `object-list` provides (e.g. `emc2.object-list`, `open(layerId)`), used with `uses` (CR-0011) | Overview section 6 (M2) | `layer-panel` (function 12), `object-list` (function 2) |
| **T-049:** the design tokens (as ADR-0034 lists them), the shared components, and an icon component for Lucide, whose exact version joins the SDK's list of shared packages (installing it needs the owner's approval of the version and licence); reading the current token values, with an event when the look, light or dark, or the density changes | ADR-0029, ADR-0034 | every plugin with a panel; `map-view-2d` (function 21, for what it draws on canvas) |
| **T-049:** a plugin's entry in the Settings list: the form the shell generates from the declared settings (as in SDK v1; it replaces ADR-0026's settings tab). A plugin's own settings panel comes later, as a 1.x addition when a plugin needs it (owner, 2026-10-15) | ADR-0031 point 2; overview 4.11 | none of the M2 briefs needs its own panel |
| **T-049:** the top bar item slot (small controls on the right of the top bar) | ADR-0031 points 1 and 6 | `bookmarks` (function 1) |
| **T-049:** user documents for the web part: the current user's documents in the plugin's own namespace (ADR-0027) | ADR-0027 | `bookmarks` (function 5) |
| **T-049:** the query for a layer's objects, page by page, independent of the area of interest (the server side is T-051) | ADR-0031 consequences; overview section 6 (M2) | `object-list` (function 3) |
| **T-064:** a hatched fill: one pattern in M2, diagonal lines in the fill colour, with room for more (owner, 2026-10-15) | ADR-0033 point 5 | `map-view-2d` (function 18), `draw-shapes` (function 1) |
| **T-064:** an arrowhead at a line's end | ADR-0033 point 5 | `map-view-2d` (function 18), `draw-shapes` (function 1) |
| **T-064:** markers at a line's points (the route) | ADR-0033 point 5 | `map-view-2d` (function 18), `draw-shapes` (function 1) |

Not an SDK addition: the Delete key and the shared Delete are the shell's (T-051); selecting is the map view's own work and keeps the SDK v1 selection (a list of ids). **The selection may hold ids of objects the map does not hold** (set by another plugin, or outside the area); the map view prunes only deleted ones (`map-view-2d` function 10). T-049 states this in the SDK's documentation of `MapView.selection`, and also:
- the selection's limit of 1 000 ids and what setting more does;
- that a waiting `dragObject` takes only a press and drag that starts on its object, so clicks still select (`map-view-2d` function 14; the SDK v1 documentation of `dragObject` says nothing about clicks);
- that the map view's Escape and the shell's Delete key act only when the focus is not in a text field (the Delete key: T-051).

## M3: the reused plugins in a workspace

**Approved by the owner (2026-10-27; PDA; T-077, for T-085),** reviewed by the ACA (T-078, `docs/architecture/reviews/m3-briefs.md`, U1 to U7 taken), with the owner's decisions of 2026-10-27 (M3-1 and the briefs' open questions, as recommended), and rechecked by the ACA (2026-10-27). In M3 the Simulation workspace reuses `map-view-2d`, the background maps, `layer-panel`, `draw-symbols`, `coordinates`, `object-list`, `bookmarks` and `draw-shapes` (ADR-0039 point 9; the owner's Q27 and A15 to A17 in `docs/architecture/m3-simulator-decisions.md`). Each of those briefs has a section "Functions (M3)" and criteria of its own; `draw-symbols` also gets the "+" for declared fields (ADR-0038). They are built against SDK 1.2.0 (`docs/plugins/sdk-v1.md`, part 5) and the shell's workspaces (CDA, T-080).

**The workspace rules,** for every plugin in this list (each brief refers to them by number):

1. **Where it appears** (open question M3-1): the panels, map overlays, object actions and map actions of these plugins name `workspaces: ['*']` (`EVERY_WORKSPACE`), so they appear in View, in Simulation, and in any workspace a later plugin declares. A plugin never writes another plugin's workspace id in its code; it takes ids from `ctx.workspaces` (rule 4). Top-bar items are the same in every workspace already (A16).
2. **What it receives:** a live picture subscription without `workspaces` follows the workspace shown and gets a fresh snapshot on a switch. Every plugin already replaces its state on a new snapshot (as after a reconnect), so most panel code is unchanged. Only the plugins that show View's layers as a reference name workspaces: `layer-panel`'s reference subscription names `['core.view']` alone, and `map-view-2d`'s names the workspace shown and `core.view` while a reference layer is on.
3. **On a switch** (`ctx.workspace.onChange`): the shell has already unmounted the old workspace's panels and mounted the new one's; the plugin's code keeps running. Before the fresh snapshots and before any `onChange` listener, the map view ends running interactions (they resolve with `null`), clears every fade list and clears the selection, at a moment the shell gives it (SDK 1.2.0 `CurrentWorkspace`; the CDA, T-080; `map-view-2d` function 22). So what a plugin sets again from the fresh snapshot or from `onChange` (a fade list, placing) stays. What belongs to one workspace's objects ends: an open editor closes, a subscription round a selected object ends with the selection.
4. **Who may change** (ADR-0039 point 7): in a declared workspace a change to its layers or objects needs the workspace's `editPermission` (`plugin.simulator.edit` in Simulation) instead of `objects.edit` and `layers.edit`, which stay View's. So:
   - a panel's read-only check uses `ctx.workspace.current.editPermission`, or the core permission in View; its hint names the workspace ("You may not edit objects in Simulation");
   - an object or map action that changes objects is registered **once per workspace** in `ctx.workspaces`, with `workspaces: [id]`, an id of its own (action ids are unique within a plugin, e.g. `edit` and `edit:simulator.simulation`) and that workspace's `editPermission`, or the core permission for View, which has none (`PERMISSIONS.objectsEdit`). The shell then offers each only where the user may use it. Actions that change nothing (Centre on, Zoom to) are registered once, with `['*']`;
   - **the shell's shared Delete** needs the workspace's edit permission in a declared workspace too (the shell's, CDA, T-080), and **the server** checks every change anyway; a `PERMISSION_DENIED` is shown as before.
5. **Where it writes** (A17): only into layers of the workspace shown. New objects go into the active layer, which is always one of them; a layer field lists only them. The store rejects a move into another workspace's layer (data model 1.2.0).
6. **View's layers in another workspace** are a read-only reference (ADR-0039 point 6, A17): `layer-panel` lists them apart, off by default; `map-view-2d` draws them under the workspace's own layers and does not select them; no tool changes them, draws into them, or makes one active, and `object-list` does not list them (open questions 3 to 6 of `map-view-2d`).
7. **Since the shell has workspaces** (CDA, T-080): `ctx.workspace` and `ctx.workspaces` are required (W1, 2026-10-28). Until then they were optional, and without them everything was View: the id `core.view` (`VIEW_WORKSPACE`), with `objects.edit` and `layers.edit`, so every plugin worked as in M2 meanwhile.
8. **Setups and settings:** the shell keeps a setup per workspace and restores each plugin's share for the workspace shown (ADR-0039 point 8), so a share's format needs no change. Settings are the same in every workspace. Bookmarks are shared by all workspaces.
9. **SDK and tests:** `sdkVersion` `^1.2.0` only when the plugin's own code uses an SDK 1.2.0 addition (the owner's C1, 2026-10-27); a plugin that changes nothing for M3 keeps its range. Test the workspace functions with the web test kit's `createFakeContext({ workspace, workspaces })` and `switchWorkspace(id)`, and the fake map view's `switchWorkspace()` (`sdk-v1.md`, part 5). Call the fake map view's `switchWorkspace()` first, then the fake context's `switchWorkspace(id)`, as the shell's moment comes first (rule 3). The fake map view's switch ends the interaction, clears the fade lists and clears the selection (the owner's exception D1 to the freeze, 2026-10-27); it does not bring back a workspace's active layer, which is `map-view-2d`'s own (function 22): in a test, set it after the switch (`activeLayer.set(…)`). The ITA's M3 flows (T-086) check the server's filter and several users.

| Plugin | M3 work | Needs |
|---|---|---|
| `map-view-2d` | one map for the workspace shown; selection, active layer and map state on a switch; View's layers as a reference; fade lists (`MapView.createFadeList`, ADR-0040) | T-080 |
| `layer-panel` | the workspace's own layers; new layers marked with the workspace; its edit permission; the reference group | T-080 |
| `draw-symbols` | the workspace rules; the "+" for declared fields (ADR-0038); CR-0020's `signal` instead of its token | T-080, T-081 (`ctx.declaredFields`, the store's fields) |
| `draw-shapes` | the workspace rules; CR-0020's `signal` instead of its token | T-080 |
| `object-list` | the workspace's own layers only | T-080 |
| `coordinates` | its cursor display and "go to" in every workspace | – |
| `bookmarks` | nothing to build: its control is in the top bar already; criteria in Simulation | T-080 |
| `basemap-osm`, `basemap-naturalearth` | nothing to build: the map view offers them in every workspace | – |

With T-085 every plugin whose look test does not use the shared `checkLookCss` yet switches to it (owner, 2026-10-23; `map-view-2d` did on 2026-10-23). **Order:** `map-view-2d` first, as in M2, because the others' criteria need its switch and its reference layers; then `layer-panel`; the rest in any order. Each can start with the test kits before the shell's switch is in.

**Open question M3-1, where the reused plugins appear.** **Decided by the owner, 2026-10-27, as recommended: in every workspace.** The ACA supported it (T-078). The recommendation was: in every workspace (`'*'`), so that a later workspace (Replay, Planning) gets the map, layers and tools without touching each plugin again, and no plugin names the simulator's workspace. Rule 4 keeps the permissions right in each. **Alternative:** name `['core.view', 'simulator.simulation']`, so that a later workspace starts without them; each plugin then knows the simulator's id and needs a change per new workspace.

## M4: the edits without a contract change (T-090)

**For the owner's approval (PDA, 2026-10-30; T-090),** from the owner's M4 notes (2026-10-30, decisions BO to BV, and BX) and the owner's answers to the PDA's four questions of 2026-10-30 (below). No ADR, SDK member or model change. Right-click is also documented in SDK 1.3.0 (CR-0028 part 4), but the map view and the plugins build it now. Each edited brief has its own status line.

| Brief | What | Task |
|---|---|---|
| `map-view-2d` | right-click while placing and drawing (function 27); filled shapes picked by their lines (function 28) | T-102 |
| `draw-symbols` | right-click while placing (function 24); categories and the echelon (function 1); default panes | T-103, T-108; the categories have no task row yet |
| `draw-shapes` | right-click while drawing (function 2); no Edit on routes (function 3); default pane | T-102 (the map view's), T-108 |
| `simulator` | the "Simulation" layer (function 2); units (function 8); the route editor, "Put on route" as a dialog, a route's menu, default panes (functions 10 and 22) | T-101, T-108 |
| `coordinates` | an icon over the map instead of the panel (function 8) | T-104 |
| `symbology` | 10 to 20 common symbols per symbol set (function 6) | T-105 |
| `layer-panel` | "Drawing" instead of "Default" (function 8); default pane | T-100 (the CDA's), T-108 |
| `cot` | the callsign (function 17); coalescing per link (function 5, T-115) | T-107 |

**Default panes** (BS; owner, 2026-10-30). A fresh browser opens each panel here; users still move them (ADR-0031 point 4).

| Pane | Panels |
|---|---|
| Bottom | Layers (`layer-panel`), Objects (`object-list`) |
| Left | Symbols (`draw-symbols`), Shapes (`draw-shapes`), Routes (`simulator`) |
| Right | Symbol properties (`draw-symbols`), the edit panel (`draw-shapes`), the route editor, Outputs and the event panel (`simulator`) |

"Coordinates" is no longer a panel (an icon over the map), and "Put on route" is a dialog over the map.

**The owner's answers to the PDA (2026-10-30):**
1. A route's menu loses only `draw-shapes`' Edit; Centre on, Zoom to and Delete stay.
2. The units keep m/s, and are kept in the browser, not in the setup (BV otherwise as written).
3. `draw-shapes`' edit panel and the simulator's event panel default to the right pane.
4. A right click before the press of a press-and-drag shape acts as Escape; during an Edit it does nothing.

## M7: the briefs and SDK 1.6.0 (2026-11-11)

M7 is the first release for outside users (owner, 2026-11-11). Its plan is the ACA's `docs/architecture/m7-plan.md` (approved by the owner), whose lanes A to K set the order. Its briefs on `pda/m7-briefs` are **approved by the owner (RJ A, 2026-11-11)**, with the answers written into each, and CR-0041 is approved (parts A to H, part E dropped). Contract changes go in one umbrella CR, **CR-0041** (SDK and data model 1.6.0), in eight parts, E dropped (Q59 B), built in parallel, part A first (the plan's lane B):
- **A**, NVG: outbound `POST`, a named credential, raw bodies, service endpoints, `core.text`;
- **B**, Append (`MapView.append`);
- **C**, relation line colours from settings;
- **D**, display classes;
- **E**, related objects in the live picture: **dropped** (owner, Q59 B);
- **F**, the shell: a top-bar item's workspaces, categories and a colour field;
- **G**, symbol palettes (`symbolPalettes`, `ctx.symbolPalettes`);
- **H**, folders relative to emcc (`%emcc%/`).

| Task | Briefs | Contract | Can start first |
|---|---|---|---|
| T-177 job area look | simulator 41 | none | yes |
| T-178 all round by default | simulator 42 | none | yes |
| T-179 dwells in Simulation | simulator 43 | none | yes |
| T-180 empty dwells spread | simulator 44 | none | yes |
| T-181 gmti's colours and 2 px | gmti 3 and 5; map-view-2d 43 | part C (the pairing colour only) | the 2 px and the dwell area colour: yes |
| T-182 display filters | map-view-2d 40; gmti 3; simulator 47 | part D | `gmti.pairing`'s `defaultOn: true`: yes |
| T-183 relation lines off screen | map-view-2d 41 | none (owner, Q59 B) | yes |
| T-184 bearing and range labels | simulator 45 | none | yes |
| T-185 colours of job area and coverage | simulator 46; gmti 3 and 5 | none (part F's colour field is a nicety) | yes |
| T-186 pairing fade | map-view-2d 42 | none | yes |
| T-174 categories | this section, "Categories" | part F | no |
| T-176 Append | map-view-2d 44; draw-shapes 19; simulator 49 | part B | no |
| T-152 Scenario button | simulator 48 | part F | no |
| T-166 height map | terrain 10 | none (steps, Q53 A) | yes |
| T-167 spike | terrain 11 | none | yes |
| T-173 NVG | [nvg](nvg.md); map-view-2d 45 | part A | the parser and mapping, against the test kit |
| T-156 palettes | draw-symbols 31; cot 32 | part G | no |
| T-157 `%emcc%/` folders | terrain 12 | part H (ECore, CDA) | no |
| T-175 list and empty a layer | none (the shell's, CDA) | none: `Objects.queryLayer` and the shared Delete | yes |

### Categories (T-174; owner, QC A, QD A)

From SDK 1.6.0 (CR-0041 part F) each plugin names its `category` in its manifest, one line. **None named means General.** The Settings workspace groups the entries in this order, alphabetically within each (CDA):

| Category (`category`) | Plugins |
|---|---|
| Data Links (`data-links`) | ais, adsb, cot, gmti, nvg |
| GeoMetoc (`geometoc`) | basemap-naturalearth, basemap-osm, basemap-wms, terrain (weather later) |
| Map and Symbols (`map-and-symbols`) | map-view-2d, symbology, coordinates |
| Drawing (`drawing`) | draw-shapes, draw-symbols, draw-tactical |
| Simulation (`simulation`) | simulator |
| General (`general`, or none) | layer-panel, object-list, bookmarks, and the shell's own entries (Labeling, Display and the others) |

**The PDA adds the line to every plugin's manifest** in one branch after part F (the owner's exception for T-174, the plan's Q3 A and lane J; CR-0041 part F). It changes nothing else in a plugin it does not own.

## How the M0 plugins fit together

```
                       live picture (snapshot + change batches)
 object store ──────────────────────────────────────────────► map-view-2d ──► Map Pane
      ▲                                                        │  ▲   ▲
      │ change requests                     MapView interface  │  │   │ BackgroundMap
      │                                    (pick, interact,    │  │   │ provider
 draw-symbols ◄────────────────────────────  selection, active │  │   │
 layer-panel  ◄────────────────────────────  layer, viewport)  ┘  │  basemap-osm
      │                                                           │
      └──► SymbolService (symbology) ◄────────────────────────────┘  (map-view-2d draws symbols)
      └──► CoordinateService (coordinates)
```

- **The map view draws the whole live picture.** It subscribes to all objects and layers itself and draws every core object type. General plugins do not push objects to the map. They send change requests, and the result appears for every user through the live picture. This gives one drawing path for all objects and all users, and lets the map view batch updates (spike S2).
- **Plugins never depend on each other's code.** Every interface between plugins (`MapView`, `BackgroundMapProvider`, `SymbolService`, `CoordinateService`; from M2 also the map view's drawing service and the `object-list` service, planned in T-049) is defined in the web plugin SDK. A plugin *provides* or *requires* a service, and the manifest says which.
- **No OpenLayers types outside `map-view-2d`** (owner decision, 2026-10-04: no escape hatch in SDK v0).
- **`basemap-osm` is the only M0 plugin with a server part** (tile proxy, owner decision 2026-10-05). It proves the Java plugin path in M0.

## Owner decisions on the briefs (2026-10-05)

| Brief | Decision |
|---|---|
| basemap-osm | Tiles through a server-side proxy (option B) |
| coordinates | Default display format: DMS |
| layer-panel | The server (ECore) seeds a "Default" layer when there is none (from 2026-10-27: when View has none, `layer-panel` function 8; from M4 named "Drawing", BT); only empty layers can be deleted, enforced by the object store |

## Applies to every brief

- **Names are provisional.** Interface and service names in the briefs (`MapView`, `SymbolService`, …) are working names until SDK v0 is frozen (T-005). The SDK documentation is then normative; if it differs from a brief, the SDK wins and the PDA updates the brief.
- **Settings:** settings listed in a brief are declared in the manifest with their defaults. From M1 (SDK v1) a user with `settings.admin` edits them in the plugin's entry in the Settings tab (ADR-0031; in M1 a tab of its own); the behaviour per data type (expiry, fading) is in its "Data types" entry. M0 used the defaults only.
- **Permissions:** M0 runs without login, so nothing is enforced. From M1 the server checks them (ADR-0022), and web parts read the user's permissions through SDK v1 to show read-only panels. In the no-login mode the local user has all permissions.
- **Labels:** every object and layer a plugin creates carries a security label, by default the configured default label, which the SDK provides. Access by label comes after M1 (ADR-0022 point 8).
- **Data type and data source (from data model 1.0.0, ADR-0023):** every object a plugin creates has a `dataType`, one of the available ones, and a `dataSource`: `manual` for drawn objects, or the name of the incoming stream. A plugin declares its own data types in its manifest, prefixed with its id.
- **Internet:** every function must work offline (ADR-0030, which superseded ADR-0014 on 2026-10-12). A plugin's server part may reach any host, internet hosts included (owner, 2026-10-18), but never one taken from a browser request, a message or an object's data (ADR-0030; owner, 2026-10-19). It declares that it goes online in the manifest's `internet` field, which ECore does not check (CR-0013); the browser talks only to the emc2 server. A brief says whether its plugin reaches outside hosts at all.
- **Pinned dependencies:** third-party libraries are pinned to exact versions and must follow the license rule in `CLAUDE.md` section 4 (see also CR-0001 for dev-only tools and CR-0002 for shipped code). Libraries the shell shares through the import map (React, OpenLayers, milsymbol, the web SDK) are not bundled by the plugin.
- **Panels (from M2, ADR-0031 point 4):** a plugin registers its panels with a default pane (left, right or bottom; planned in T-049), and every panel works in every pane, narrow and tall as well as wide and low. "Control Pane panel" in the M0 and M1 text of a brief means the right pane.
- **Selection and object actions (from M2, ADR-0032):** selecting objects on the map is the map view's job, and the selection stays one shared list of ids. A plugin that edits a kind of object provides **Edit** for it as an object action. **No plugin has a Delete of its own for objects:** the shell's shared Delete, from the menu or the Delete key, deletes any selection after one confirmation (owner, 2026-10-14). Every action changes objects only through change requests.
- **Look (from M2, ADR-0029, ADR-0034):** panels, controls and menus take colours, fonts, sizes, spacing, corner radii and shadows **from the shell's design tokens only**, and use its shared components and its icons (Lucide). Users choose one of three looks, light or dark, and a density; a plugin never chooses one. Each plugin checks its panels in both densities and in at least one light and one dark look. The APP-6 affiliation colours and the selection highlight stay fixed in every look.
- **Personal data (from M2, ADR-0027):** what should follow a user to another browser (bookmarks, a setup) is kept as the user's own documents in the plugin's namespace, through the SDK, never in browser storage. A small convenience kept per browser (such as the last data type chosen) may stay in browser storage, as a brief says.
- **Done** means all acceptance criteria in the brief have tests and pass, plus `agents/pca.md` and `CLAUDE.md` section 7.

## Start order and hints

PDA, updated 2026-10-09, for the PCAs: read this right after your brief, then `docs/plugins/design-pattern.md` and `plugins/_template/`. It changes no brief. State: **all six M0 plugins are merged** (2026-10-09), with the shell (T-014) and SDK 0.1.1 (CR-0005). The hints stay for later plugins and as a record of what the M0 plugins met.

### M2 (SDK 1.x, data model 1.1.0)

The M2 plugin work starts when the CRs for SDK 1.x (T-049) and data model 1.1.0 (T-064) are approved and built, and the CDA's shell and server parts it needs are in (T-050 to T-052). First comes **a `map-view-2d` prototype** (T-054): a hatched fill in the WebGL renderer and the first call of the drawing service. Its findings may change the drawing service before `draw-shapes` builds on it. Read the briefs, the list "M2: what the briefs need from T-049 and T-064" above, and the design pattern as T-049 updates it.

| Plugin | M2 work | Needs |
|---|---|---|
| `map-view-2d` (T-054) | the prototype first; then selecting, the menus, Centre map, Centre on and Zoom to, the drawing and editing service, the new shape styles, dim, its share of a setup | T-049 (actions, fetch by id, drawing service, setup share, map type), T-064 |
| `draw-shapes` (T-053, new) | plain shapes, Edit for shapes | the map view's drawing service; T-049, T-064 |
| `draw-symbols` (T-054) | Edit as an object action; its selection and Delete go | the map view's selection (above); T-049 (actions, fetch by id) |
| `layer-panel` (T-054) | a double-click opens `object-list`; the eye in setups | T-049 (visibility event, the `object-list` service) |
| `bookmarks` (T-053, new) | the control in the top bar, the folder tree | T-049 (top bar slot, user documents, map type) |
| `object-list` (T-053, new) | a layer's objects page by page; shared selection and actions | T-049 (layer query, actions), T-051 (the server query) |
| every plugin (T-054) | panels in every pane, the shared look in all three looks and both densities (ADR-0034) | T-049 (panels with a default pane, tokens), T-052 (the shell's tokens and components) |

- **Order:** providers before users, as in M0: `map-view-2d`'s service before `draw-shapes`, `object-list` before `layer-panel`'s double-click (which does nothing without it, so the two can also merge in either order).
- **Test with the test kits first:** the PDA adds a fake for every T-049 addition to the test kits, so no PCA waits for another's code.

### M1 (SDK v1)

The M1 work starts after the owner freezes SDK v1 and the CDA's runtime side is in (T-038). Every plugin moves to `sdkVersion` `^1.0.0` and `@emc2/plugin-sdk` `1.0.0` at the same time, on one integration branch (CR-0010, merge order on the board). Read `docs/plugins/sdk-v1.md` and the design pattern v1.

| Plugin | M1 work | Uses from SDK v1 |
|---|---|---|
| `map-view-2d` (T-042) | vector backgrounds in every projection; `uses` `emc2.symbols` (CR-0011); EPSG:3031; the area of interest and clusters (spike S3); fading expired objects | `VectorSource`, `projections: 'any'`, `uses`, `LivePictureOptions`, `area`/`clusters` |
| `basemap-naturalearth` (T-041, new) | the offline background; needs `map-view-2d`'s vector drawing to be seen | `VectorSource`, `ctx.webBase` |
| `cot` (T-040, new) | CoT from TAK; server part only; outgoing later | listeners, store, documents, settings at runtime, `dataTypes`, `network` |
| `draw-symbols`, `layer-panel`, `coordinates` (T-042) | data type picker and read only, subscription by area; permissions, layers and counts without objects; UPS, `uses` `emc2.map-view` and settings changes at once (CR-0012) | `ctx.user`, `ctx.dataTypes`, `{ area: 'viewport' }`, `{ objects: false }`, `uses`, `ctx.onSettingsChange` |
| `symbology`, `basemap-osm` | only the SDK version | – |

- *(M1. Listeners are deprecated since SDK 1.2.0: a plugin today uses connection tasks, `FakeConnections` in its tests; see [the SDK reference](../reference/README.md).)*
- **Test with the test kits first:** `FakeStore`, `FakeListeners`/`FakeConnection`, `createFakeUser`, `createFakeVectorBackground` (sdk-v1.md, "Test kit"). The TAK test double and Keycloak are the ITA's (T-043).
- **No PCA starts a new dependency without the owner's approval**: e.g. no XML or CoT library for `cot` (the JDK has one) and no converter for `basemap-naturalearth` (a Node script of its own).

### Build order (M0)

Every interface between plugins (`MapView`, `SymbolService`, `CoordinateService`, `BackgroundMapProvider`) is defined in the web SDK, and the test kit fakes each of them, so no PCA waits for another's code in its unit tests. The order puts providers before their users.

| Plugin | Provides | Uses from other plugins | State |
|---|---|---|---|
| `layer-panel` (T-024) | panel "Layers" | `MapView` (local visibility, active layer) | merged |
| `coordinates` (T-022) | `CoordinateService` | `MapView`, for the cursor display and "go to" | merged |
| `symbology` (T-021) | `SymbolService` | nothing | merged |
| `map-view-2d` (T-019) | `MapView` | `SymbolService`; `BackgroundMapProvider` (zero or more) | merged |
| `basemap-osm` (T-020) | `BackgroundMapProvider`; tile proxy (server part) | nothing (the map view consumes it) | merged; the only M0 plugin with a server part |
| `draw-symbols` (T-023) | panels "Symbols" and properties | `MapView`, `SymbolService`, `CoordinateService` | merged |

**The map view comes first.** `layer-panel` and `draw-symbols` declare `requires: emc2.map-view`. The shell does not load a web part whose required service has no provider; its Control Pane says "not loaded: requires emc2.map-view, which no loaded plugin provides". Their panels appear only together with `map-view-2d`. `coordinates` lists `emc2.map-view` under `uses` from SDK v1 (CR-0012): it loads after the map view when there is one, and without one it still provides `CoordinateService` and reports `DEGRADED`.

### Trying plugins in the browser

- **Build and run:** `node tools/build.mjs`, then `node tools/start.mjs`, then open `http://127.0.0.1:8080`. The build assembles every plugin into `build/plugins/<id>/` (design pattern section 4). The Control Pane lists each plugin with its server and web status, and the reason when one is not loaded.
- The Vite dev server (`npm run dev -w @emc2/shell`) does **not** load plugins.
- **Unit tests stay with the test kits.** jsdom (Vitest) has no canvas and no WebGL: keep logic in plain functions and test those. Real pixels, timing and several users are the ITA's browser tests.

### symbology (T-021)

- CR-0007 (`canvas` for tests) was rejected: keep the stubbed 2D context; real pixels and the render time go to the ITA's browser tests.
- The modifier names are a closed list in `model/` (`Modifiers`). A modifier milsymbol cannot draw, or one the model lacks, is a CR to the PDA.
- Only `symbology` changes milsymbol's global settings. The cache key and `compose` use `canonicalSidc`.

### coordinates (T-022) and layer-panel (T-024)

- **What the others get:** `CoordinateService` (format, parse, the chosen format) is real now. The layer panel sets the **active layer** and the local visibility through `MapView`.
- **Their limits:** in their READMEs.

### map-view-2d (T-019)

- **Fake in unit tests:** the live picture (snapshots, batches, a second snapshot), `createFakeSymbolService()`, and a `BackgroundMapProvider` provided with `provideAs(BACKGROUND_MAP, …)`. Test the logic apart from OpenLayers:
  - batching and the merge per id;
  - layer order (`drawOrder`, ties by id);
  - the visible-area polygon at a pole and across the antimeridian;
  - densifying geodesic edges;
  - renderer detection with fake WebGL contexts.
- **Try in the browser:** with `symbology`, `coordinates` and `layer-panel` loaded, the map, symbols, the cursor display and the layer panel together.
- **Open points:**
  - The only plugin that registers proj4 projections (`proj4.defs`, `ol/proj/proj4`).
  - `ctx.ui.setMapView` is for the active map view only (the shell refuses a second `map-view` plugin).
  - The projections come from settings defaults (no settings view in M0).
  - A new snapshot can come at any time (after a reconnect or a gap): replace your state completely.
  - Tile URLs must be on the emc2 server (CSP `'self'`).
  - Overlay items are `point`, `line` and `symbol`; needing more is a CR. No OpenLayers type may appear in the `MapView` API.

### basemap-osm (T-020)

- **Fake in unit tests:** the whole server part with `FakePluginContext`:
  - `ctx.upstream()`: `respond`, `respondAfter`, `fail`, `never`;
  - `ctx.call("/tiles/…")` gives a `FakeHttpExchange`;
  - `advance(...)` for timeouts;
  - 503 when the mailbox is full, 504 after the endpoint timeout (default 10 s).

  The web part: `createFakeContext()`, providing `BACKGROUND_MAP`.
- **Try for real:** `node tools/build.mjs` assembles the server jar too, and `node tools/start.mjs` starts it in the plugin host. Tiles from the real OSM server need the internet (left out of the ITA's offline tests); tiles on the map need `map-view-2d`.
- **Open points:**
  - At most **16 concurrent outbound calls** per plugin (`OutboundHttp.MAX_CONCURRENT_CALLS`); one more fails at once. A map load asks for dozens of tiles, so queue fetches in the worker instead of answering 502.
  - Keep the upstream timeout below the endpoint timeout, so that you answer before ECore sends 504.
  - Declare the default upstream host in `internet.hosts` (ECore does not check it from M2); never use a host taken from a browser request, a message or an object's data; redirects are not followed.
  - Set `User-Agent` with `HttpCall.header(...)`.
  - 10 MB body limit; set `Cache-Control` on tile replies.
  - The ask and timer caps (CR-0005: 10 000 outstanding asks, 1 000 active timers per plugin) are enforced by the plugin host since 2026-10-09, and by `FakePluginContext` in tests.

### draw-symbols (T-023)

- **Fake in unit tests:** `createFakeMapView()` (`setPickResult`, `completeInteraction`, `selection`, `activeLayer`), `createFakeSymbolService()`, `createFakeCoordinateService()`, and `ctx.answerWith` for rejections and "outcome unknown".
- **Try in the browser:** with all other M0 plugins; the ITA's flow tests cover several users.
- **Open points:**
  - New ids come from `ctx.newId()`.
  - On `OutcomeUnknownError`, a create may be sent again **with the same id**: if the first one arrived, the store answers `ENTITY_EXISTS`.
  - An update sends the complete core content of the latest state, with `baseVersion` (not checked in M0: last write wins). Never send other plugins' extensions as changes.
  - At most **100 change requests waiting** per browser; one more is rejected at once with `INTERNAL_ERROR` ("send it again later").
  - A typed SIDC is checked with `SymbolService.validate`; compare SIDCs with `canonicalSidc`.

### Pitfalls from the reviews (all plugins)

- **APP-6E:** compare and cache SIDCs with `canonicalSidc` (a 20-digit and a 30-digit SIDC can be the same symbol).
- **Coordinates:** lon/lat everywhere; every conversion test uses a point where latitude ≠ longitude.
- **Labels:** everything you create carries a security label (`defaultLabel`).
- **Extensions:** your namespace is your plugin id; forward all others untouched.
- **Promises:** never `void someAsyncCall()` without handling its rejection: catch it and notify the user, or the error vanishes (layer-panel review).
- **Double submits:** disable a button while its change request is pending, so a double-click does not send two (layer-panel review).
- **Inputs:** bound sizes and lengths you accept (text fields, render sizes), and parse what users really type, e.g. the Unicode minus (coordinates and symbology reviews).
- **Map interactions:** an interaction (pick a point, drag an object) must not switch off panning or other interactions for the whole map; switch off only what conflicts, and only while it runs (map-view-2d review, B1: the map could not be panned while a symbol was selected).
- **Dragging:** take the dragged object's position when the drag starts (at the press), not later from the live picture, which may have changed meanwhile (map-view-2d review).
- **Tests must be able to fail:** no assertion that is true whatever the code does. Break the code once and see the test fail (symbology review).
- **npm:** `npm install` at the repository root only, and commit the regenerated `package-lock.json`, never edited or merged by hand. The MCA merges lock file branches one at a time, so expect to merge `main` and run `npm install` again before your merge. When that merge conflicts in the lock file, take `main`'s version (`git checkout --theirs package-lock.json`, then `git add`) and let `npm install` regenerate it; never resolve its conflicts by hand. `npm run build --workspaces` and `npm test --workspaces` run at the root.
- **Dependencies:** none without the owner's approval of the exact version and licence (`CLAUDE.md` section 4); shared libraries are never bundled.
- **CSP `'self'`:** no external URLs, no inline scripts, no `eval`; inline style attributes are allowed.

### Who answers what

- **Questions about the SDKs or the design pattern:** to the PDA through the owner. The answers go into the FAQ of `docs/plugins/design-pattern.md`.
- **Missing SDK features:** a change request (`docs/change-requests/`, next free number); continue with what you can do meanwhile.
- **The shell, ECore, the edge:** the CDA. **Tests of the whole system:** the ITA. **Merges and status:** the MCA.
