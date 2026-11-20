# GMTI format rules: what STANAG 4607 asks of emc2

Kept by PCA-gmti (owner's request, 2026-11-07). It lists the rules of STANAG 4607 that make GMTI unlike emc2's other in and out plugins, what `gmti` does with each, and what the rest of emc2 must keep so that `gmti` keeps working.

- **For designers** (PDA, CDA, PCA-simulator, PCA-map-view-2d, the ITA, the ESA): check a design against the "Keep" lines; quote a rule by its number (G1 …) in a brief, a CR or a review. Numbers are never reused.
- **For the UDA:** the last section lists what operators and admins see, by rule.
- **Sources:** AEDP-4607 Edition A Version 1 and its guide AEDP-4607.1 (read in the owner's folder, never copied; cited as "AEDP 3.4.6" and "Guide G.7.3"). The fields and their encodings are in the ACA's reference [`gmti-4607.md`](../../docs/architecture/gmti-4607.md); this file does not repeat them. Where this file and the standard differ, the standard wins.
- **State:** `gmti` as on `integration/sdk-v1.4` `2132fca2`, with CR-0033's `ChannelItem.Sensor` (owner JW), CR-0034's mission (owner KF; G6) and G12's cut (KA), plus, on `pca-gmti/plugin`, CR-0035's depth and circle (owner KL, KM and KQ; G12).

## Why GMTI is not a generic in or out

STANAG 4607 does not report objects. It reports what one radar saw in one look, a **dwell**. Each detection exists only inside a dwell; each dwell belongs to a **job** of a **sensor** on a **platform**, within a **mission**. The format has no tracks, names, identities, symbols or free-form fields for them. So:

- **In:** any 4607 stream can be read. `gmti` makes three kinds of object from it: the platform, its dwell area and the detections.
- **Out:** only a GMTI sensor has what the format demands. In emc2 that is the simulator's sensor: "GMTI out is only available from the simulator. The protocol has too many business rules to be a generic output" (owner, 2026-11-06; ADR-0048).

## A. Sensor and platform

**G1. A detection exists only inside a dwell, and a dwell only with its sensor.**
- 4607: a dwell's time (`D6`), the sensor's position (`D7`–`D9`) and the dwell area (`D24`–`D27`) are mandatory. Reports come only inside a dwell segment, in a packet whose job id `P10` is not 0 (AEDP 3.4, 3.1.10).
- In: one platform object per `P8` per link, moved by every dwell and platform location segment. Detections are written only from dwells.
- Out: `gmti` takes `ChannelItem.SensorReport` only, through channels of kind `SENSOR_REPORTS`, and from M6 of ground radars only (`sensorTypes` `GROUND_RADAR`; T-169): a report of another type is counted `not a ground radar` and not sent, one without a type is sent. A dwell has the sensor's id, the platform's position, the time, the area and the detections. A platform without an altitude is sent at 0 m. Tracks, drawn objects and received GMTI cannot be sent: there is no relay (brief section 9).
- Keep: `ChannelItem.SensorReport` with those five parts (PDA). One dwell per revisit, empty ones too (simulator function 29). `gmti`'s channels are never offered as ground-truth outputs (simulator criterion 41).

**G2. The platform id `P8` is ten characters, and it is the platform's identity.**
- 4607: `P8` is in every packet. It holds 10 characters of the basic set (`0x20`–`0x7E`, LF, FF, CR), padded with spaces; the owning nation keeps it unique (AEDP 3.1.8).
- In: the platform's name is `P8` without the padding, or "GMTI platform" when it is empty. The platform object is known by `<link>/<P8>`, so a sender that changes `P8` makes a new platform. Senders cut long names: the AFSERS recording's platform name of 11 characters arrives as its first 10.
- Out (CR-0033, ACA R2):
  - the sensor's name with each character outside `0x20`–`0x7E` as "?", cut to 10 characters;
  - when another sensor on the link holds it, the name cut to 8 plus "~2" to "~9", then cut to 7 plus "~10" to "~99";
  - a sensor keeps its `P8` from its first dwell while the link runs, also when its track is renamed;
  - a dwell without a sensor (a sender built before CR-0033) gets "SIM" plus seven hex digits of the sensor's id (assumption B2).
- Keep: the name in `ChannelItem.Sensor.name` (CR-0033: 1 to 64 characters, of which a receiver sees 10).

**G3. The format has no identity, symbol, name or track number.**
- 4607: there is no friend or hostile, no APP-6 code and no track number. The report index `D32.1` counts within its dwell only (AEDP 3.4.32.1). Associating reports is a tracker's job.
- In: the platform's symbol and identity are link settings (`platformSymbol`, by default from the platform type `M3`; `platformIdentity`, by default unknown). A detection's symbol comes from its class (G13), its identity is unknown, and its context comes from `P7` (G16). Detections have no display name (owner, JK).
- Out: the detected track's name, identity, symbol and fields are not sent. Only its measured position, height and radial speed go, with a class taken from its symbol (G13).
- Keep: nothing in emc2 expects a `gmti` detection to have a name or an identity, or to be the track it saw.

**G4. Detections are new objects. They are never updated, and they expire.**
- 4607: a report is one look. The next dwell's report of the same vehicle is another report.
- In: each report is one object, known by `<link>/<P8>/<P10>/<dwell time, UTC ms>/<D2>/<D3>/<D32.1, or the place to 1e-7°>`. This is the owner's Q3, recorded in [`docs/handover/pca-gmti.md`](../../docs/handover/pca-gmti.md). The brief's section 3 still gives the older key, without `P10` and the time, and that key is not unique in the owner's recordings; the PDA is to align the brief. A detection is written once and goes by its data type's expiry: 60 s, then 120 s faded, both configurable by an admin.
- From M7 RC2 (T-192; CR-0042 option A, owner FA A, FB A, FC A; SDK 1.7.0), detections and dwell areas fade in steps, counted from `time.observed`: `gmti.detection` and `gmti.dwell-area` (the dwell areas' own type, G12) name the settings `detectionFade` and `dwellAreaFade` as their `fadeSetting`. By default the detections are full until 10 s, 5 % less every 4.5 s, gone at 100 s, and the dwell areas full until 5 s, 5 % less every 0.5 s, gone at 15 s (owner, 2026-11-16); the map view draws it in place of the expiry fade, and `gmti` writes nothing for it. An invisible detection stays until its data type removes it (FB A). An end not above the start (model rule 22, which the schema cannot say) gives no steps and is named in the plugin's status.
- Keep:
  - expiry counted from `time.observed` (`model/README.md`, the time rules; see G9), and from SDK 1.7.0 the stepped fade too;
  - a store that takes bursts. One simulator set (B) sends 10 dwells and about 2 600 reports a second; `gmti` caps them per dwell (G14).

**G5. Each detection points to its platform.**
- 4607: a report is tied to its sensor only by its packet (`P8`) and its dwell.
- In: each detection is written with one `gmti.pairing` relation to its platform's object, from the link's first dwell on. If the platform's write was dropped, the detection is written without the relation and counted (`detections not paired`).
- Keep:
  - `ObjectWriter.objectId(key)`, answering while the platform's create is in flight (SDK 1.4.0 part 4, owner IP);
  - the relation kind `gmti.pairing`, declared by `gmti`; others use it only when `gmti` is loaded (simulator function 30);
  - the map view drawing relation lines while the user's switch is on (ADR-0051 point 6, ADR-0052); `gmti.pairing`'s is on by default from M7 (owner, 2026-11-11, T-182; off in M5 and M6, ADR-0051 point 8);
  - from SDK 1.6.0 (CR-0041 part C; T-181), the line's colour from the setting `pairingColour` (`strokeColorSetting`), resolved by the shell (`ctx.relationLines`); yellow while it is missing.

## B. Mission and job

**G6. Nothing has a date until the mission segment arrives.**
- 4607 (AEDP 3.3, 3.1.9, 3.1.10):
  - the mission segment is mandatory and sent at least every two minutes. It holds the mission plan `M1` (12 characters), the flight plan `M2` (12), the platform type `M3`, the platform configuration `M4` (10) and the reference day `M5`–`M7`;
  - dwell times mean nothing until it has arrived;
  - `M1` and `M2` may be all spaces;
  - every packet carries a mission id `P9`, unique for the platform. Job ids are unique within a mission.
- In:
  - missions are kept per (`P8`, `P9`);
  - a dwell that comes before its mission waits up to 10 s, at most 100 per platform, then is dropped and counted (`dropped: no mission`);
  - a new mission segment changes the day for later dwells only;
  - the texts and the platform type go into the platform's extension;
  - two recordings send their mission segment only once, at the start. A link that joins such a stream later drops every dwell.
- Out: a mission segment in every packet, or, with `oneSegmentPerPacket` on (the default; G17), in a packet of its own before the report's other segments. It has `M2` as spaces, `M3` 255 ("other") and `M4` "emcc". `M1` and `P9` come from the sensor's mission (CR-0034, owner Q4; approved KF, 2026-11-07, with the ACA's R1 to R3; criterion 20), an optional setting of each simulator sensor, a generic text of 1 to 64 characters (JQ) in `ChannelItem.Sensor`:
  - `M1` is the mission with each character outside `0x20`–`0x7E` as "?", one per code point, as `P8` (G2; R3), cut to 12 characters and padded with spaces. A mission longer than 12 characters counts `mission cut` once per sensor while the link runs; a replaced character alone counts nothing. Two missions that differ only after their twelfth character show the same `M1`, and their `P9`s tell them apart;
  - `P9` is the CRC-32 (ISO-HDLC, as `java.util.zip.CRC32`) of the mission's whole text as UTF-8, before the replacement and the cut, with 0 sent as 1 (R2). It is a contract between releases: the same mission gives the same `P9` across restarts, links and releases, so a receiver sees one mission per sortie, and only the reference day moves when a restart falls on another day;
  - with no mission, `M1` is spaces and `P9` the second of the day the link started, so a receiver sees each restart of the link as a new mission.
- Keep: the mission in the dwell (CR-0034), generic, not narrowed to `M1`'s 12 characters.

**G7. A job is one area and one mode, and its definition is resent every 30 s.**
- 4607 (AEDP 3.7):
  - a job definition comes before its job's first dwell and repeats at least every 30 s;
  - one job has one radar mode;
  - `J5` 255 ends the job;
  - the bounding area `J6`–`J13` is a convex quadrilateral, clockwise.
- In:
  - jobs are kept per (`P8`, `J1`). Their sensor, mode, bounding area and nominal errors go into the platform's extension;
  - `J5` 255 removes the coverage; from M8 the job's dwell areas stay until they expire (T-195);
  - the latest job definition's bounding area is the platform's **coverage** (T-158; owner Q30 A): a polygon of the four corners in the order sent, dashed 1.5 px in the colour of the setting `coverageColour`, by default `#BDCF3D` from M8 (T-189; the identity's in M7, T-185), with the display class `sensor-coverage` (SDK 1.6.0 part D, T-182). It is written when the corners change, else refreshed at most every 30 s with the time of the latest dwell, and not drawn while the corners enclose no area. The link setting `coverage` switches it off;
  - there is one coverage per platform, so interleaved jobs share it, and one dwell area per dwell (M8, G12). Job ids may churn: simulator set B starts a new job before nearly every dwell.
- Out:
  - one job per sensor, with ids from 1, and `J14` 1 (MTI);
  - the definition goes before the sensor's first dwell, then whenever 30 s of dwell time have passed;
  - the bounding area is the sensor's job area (T-168): a convex four-corner area as its corners, A its first and then clockwise (owner, 2026-11-10: the standard's order wins over a counter-clockwise ring), any other as its box, counted `not held: J6` once per sensor; without one, the box round the dwell area. A changed job area sends the job definition again with the next dwell;
  - the nominal values come from the sensor: `J15`, `J21`, `J22`, `J24` and `J25` (G10). The platform's own errors (`J16`–`J20`), `J23` and `J26` are "no statement".

## C. Time and sizes

**G8. Times are 32-bit milliseconds from a reference day.**
- 4607: `D6` (and `L1`, `T4`) counts UTC milliseconds since midnight of the reference day, which is the day the mission started. It holds about 49.7 days (AEDP 3.4.6, Annex C-3). Every report of a dwell has the dwell's time; a report has no time of its own.
- In: a detection's `time.observed` is its dwell's time. A `D6` days past the reference day is placed on the right day.
- Out: the reference day is the day the link started. A dwell outside the 49.7 days moves it, and every packet's mission segment states the new day.
- Keep: the dwell's `time`, to the millisecond.

**G9. Recorded times are history.**
- Recordings carry their own days, often years old. Since expiry counts from `time.observed` (G4), their detections would expire as they arrive.
- In: the link setting `time` decides. `as-recorded` (the default) keeps the times; `as-received` shifts the link's times so that its newest dwell is now. Replays (the ESA's playback, the ITA's tests) use `as-received`.

**G10. Values have fixed sizes, such as the 109-minute revisit.**

| Value | Field | Largest | When it does not fit |
|---|---|---|---|
| Revisit interval | `J15`, 16 bits of 0.1 s | 6 553.5 s, about **109 min** | **no "no statement" value**: sent as 0, "not revisiting", and counted |
| Range error | `J21`, `D32.12`, 16 bits of cm | about 655 m | `J21` 65 535; `D32.12` left out |
| Cross-range error | `D32.13`, 16 bits of dm; `J22` as an angle | 6 553.5 m | left out; `J22` 180° when the area's centre is on the sensor |
| Minimum detectable speed | `J24`, `D31`, 8 bits of dm/s | 25.4 m/s | `J24` 255; `D31` left out |
| Detection probability | `J25`, percent | 100 % | 255 |
| Radial speed | `D32.7`, signed 16 bits of cm/s | ±327.67 m/s | left out |
| Target height | `D32.6`, signed 16 bits of m | ±32 767 m | left out: the target is then on the job's earth model |
| Sensor vertical speed | `D17`, signed 8 bits of dm/s | ±12.7 m/s | `D15`–`D17` go together; sent as 0 |
| Range half extent of the area | `D26`, km | 255.99 km | mandatory: cut, counted, detections beyond left out (G12) |
| Revisit index, reports per segment | `D2`, `D5`, 16 bits | 65 535 | `D2` wraps; reports go into more segments |

- **Rule** (ACA R3 on CR-0033, approved with it): a value that a field cannot hold is sent as "no statement" or left out, never clamped or wrapped, and counted. The owner confirmed it in JQ. **`J15`** has no such value: a revisit above 6 553.5 s is sent as 0, "not revisiting", the only value that claims nothing false, and counted (the `gmti` brief; owner JW).
- Out (CR-0033 built, owner JW):
  - each value is rounded to its field's unit, then sent when the field holds it. Otherwise it goes as the table's last column says, counted as `not held: <field>` once per dwell and field;
  - `J22` is the cross-range error seen from the sensor at the range of the area's centre (`D24`, `D25`). A `Circle` round the sensor has its centre halfway out (G12, CR-0035), so it is seen at half the radius, as a full `ArcBand` is. An area whose centre is on the sensor, such as an ellipse round it, gives no angle, so `J22` is "no statement" and counted;
  - `D15`–`D17` go only when the sensor gives both the platform's direction and its speed;
  - when the reports carry `D32.12` or `D32.13`, the dwell gets `D12`–`D14` as 0, since the format needs them (AEDP 3.4.32.12);
  - a target's height or radial speed beyond its `S16` is left out and counted (`D32.6`, `D32.7`), no longer clamped.
- Keep (owner, JQ, 2026-11-07):
  - sensor settings stay generic, for any type of sensor. They are physical values in SI units with general ranges, and `ChannelItem.Sensor` carries them that way;
  - nothing in the simulator is narrowed to 4607's sizes; `gmti` fits each value or sends "no statement";
  - the simulator's present settings: the revisit time of 1 to 600 s fits. The range and cross-range errors (up to 10 000 m) and the minimum detectable speed (up to 100 m/s) can exceed `J21`, `D32.12`, `J24` and `D31`.

**G11. Revisits and dwells are counted, not named.**
- 4607: `D2` counts the revisits of the job's area, `D3` the dwells within a revisit, and `D4` marks a revisit's last dwell (AEDP 3.4.2–3.4.4). A dwell may be split over several segments with the same indices.
- In: a dwell is known by `P8`, `P10`, its time, `D2` and `D3`. The cap per dwell (G14) counts across its segments.
- Out: with the report's sequence (CR-0040; the simulator's ground radar), `D2` is the revisit modulo 65 536, `D3` the dwell and `D4` 1 on the revisit's last dwell only. Without one, `D2` counts the sensor's dwells on the link and wraps at 65 535, `D3` is 0 and `D4` is 1, one dwell per revisit (reference 3.2).
- Keep: one `ChannelItem.SensorReport` per revisit (the simulator).

## D. The dwell area

**G12. The dwell area is a band round the sensor, at most 255.99 km either side of its centre, so at most 511.98 km deep.**
- 4607: the area has a centre (`D24`, `D25`), a range half extent (`D26`, 0 to 255.99 km) and an angle half extent (`D27`) seen from the sensor (AEDP 3.4.24–3.4.27). It is what the beam looked at, not the job's bounding area.
- In: an `ArcBand` centred at the sensor, or a `Circle` when the half angle is 180° or more, a solid outline of 2 px (M7, owner QL C; 3 px in M5 and M6) in the colour of the setting `dwellAreaColour`, by default `#7EF26A` from M8 (T-189; the identity's in M7, T-181), with the display class `dwell-area` (SDK 1.6.0 part D, T-182), of data type `gmti.dwell-area` from M7 RC2 (T-192; the brief's `gmti.dwellArea` is no valid type name, owner 2026-11-12), so that it fades in steps by `dwellAreaFade` (G4) apart from the platform and the coverage. The job's bounding area is drawn apart, as the coverage (G7).
  - **Every dwell its own area** (M8, T-195; owner TP A, and again on 2026-11-16 in place of one area per revisit, VD C; replacing M6's one per dwell index, T-169): known by `<link>/<P8>/area/<dwell time, UTC ms>/<D2>/<D3>`, since `D3` repeats every revisit and `D2` wraps at 65 535; without a name, so without a map label (owner, 2026-11-13; the brief had "<P8> dwell <D2>.<D3>"); none for a dwell of size 0. `gmti` writes each once and keeps no list and no cap (owner, A): no later dwell, revisit or job end removes it; its fade does, and its data type's expiry, by default 15 s after the dwell (`gmti.dwell-area`: 15 s, not faded at expiry, removed at once; owner, 2026-11-16). About 150 areas per platform at AFSERS's rate.
- Out: made from the dwell's `ArcBand` (exact), a `Circle` round the sensor, or another shape (by its extent seen from the sensor). Since `D26` is a half extent, an area up to 511.98 km deep beyond its near edge fits whole.
  - An `ArcBand` goes by its own shape wherever its centre lies (T-193, 2026-11-12): `D24`/`D25` its middle, `D26` half its depth, `D27` half its angle, the beam's half width (AEDP 3.4.27). `D7`/`D8` stay the report's platform, where the sensor was at the dwell's time (AEDP 3.4.7). The simulator's band is centred where the platform was when the revisit began; seen from where it is now, a 2° band only 1.5 m off grew to a half disc or a circle. A cut (below) is measured from the band's own centre.
  - A receiver draws the band from `D7`/`D8` ("In"): its middle, its far edge and its width stay; its point moves to the platform, and what lies behind the platform is lost. A platform within 1 m of the band's middle reads back as a `Circle` of `D26`.
  - A `Circle` round the sensor goes as 4607 allows (CR-0035, owner KM; AEDP Annex C-1.12): `D24`/`D25` the point halfway out at bearing 0°, `D26` half the radius and `D27` 180°. That is the whole disc, inner radius 0, which "In" reads back as the same circle, so a circle of up to 511.98 km goes whole.
  - The out channels declare the depth, `maxAreaDepth` 511 980 m (CR-0035, owner KL), so the simulator can warn about the tracks it would send beyond it (its function 30).
- Out, an area deeper than `D26` holds (owner, JS and Q5, 2026-11-07): `gmti` cuts it, counted once per dwell (`not held: D26`).
  - The area keeps its near edge (an `ArcBand`'s inner radius, 0 for a `Circle` round the sensor) and reaches 511.98 km beyond it: `D26` 255.99 km and the centre 255.99 km past the near edge. A wider `Circle` is sent as one of 511.98 km.
  - Each detection farther from the sensor than the near edge plus the declared 511 980 m is left out and counted (`beyond reach`), so a packet never reports a target outside its own area, and leaves out what the simulator warns about. `D26`'s largest value is 255.992 km, so the area sent reaches a few metres beyond and holds every detection sent. Only the range is cut; the bearings stay.
- Keep:
  - `Geometry.ArcBand` and `Circle` in the model, and `ChannelSpec.maxAreaDepth` in the SDK (CR-0035);
  - the map view drawing an `ArcBand` (map-view-2d's T-145, on integration `171451b6`; not yet checked in the browser with `gmti`);
  - the simulator's reach generic, not cut for `gmti` (owner JS, replacing JI; simulator function 28): `gmti` does the cut.

## E. What a detection can say

**G13. A detection carries a position, perhaps a height, a radial speed and a class, and nothing else of the target.**
- 4607 report fields:
  - the position (full or reduced precision) and the height `D32.6`, in metres above the ellipsoid;
  - the radial speed `D32.7`, along the line of sight with away from the sensor positive; it may be aliased by `D32.8`;
  - the SNR, the class `D32.10` and its probability;
  - the measurement errors, a truth tag and the radar cross section.
  
  Radial speed is not the target's speed: a vehicle crossing the beam shows about 0.
- Classes: 0 to 127 are live targets, 128 to 255 simulated ones. 1 and 129 are tracked vehicles, 2 and 130 wheeled (AEDP Table 3-11; the brief had these two swapped, and the standard wins).
- In:
  - the position is a `Point`, longitude first;
  - the other fields go into `extensions.gmti`, as the declared fields of the field set `gmti.report`. They are measurements, not editable by others. From SDK 1.5.0 the data type `gmti.detection` names the set, so the store adds it too (CR-0038);
  - none of `gmti.detection`, `gmti.platform` and `gmti.dwell-area` is made by hand (`manual: false`): a detection exists only in its dwell, a platform and its areas only as a sensor's (G1);
  - the class picks the APP-6 symbol (README, "Symbols").
- Out:
  - full-precision positions, with the height when the content has an altitude;
  - the radial speed when the track has a speed and a direction: its part along the line from the sensor;
  - a simulated class (128 to 255) from the track's symbol, with probability 100.
- Keep:
  - the detection content's `Point` is the measured position;
  - `symbol.modifiers.speed` and `direction` give the radial speed;
  - the symbol gives the class (README, "simulated class").

**G14. There are many detections per dwell, so caps apply.**
- 4607: `D5` counts the reports in one segment (16 bits). One dwell may span segments and packets. Senders and receivers must handle at least 120 reports per dwell (Guide G.9.5).
- In: `maxReportsPerDwell` (default 1 000). The rest are skipped and counted.
- Out: `maxReportsPerSegment` (default 120). Packets are at most 65 535 bytes over TCP and 65 507 over UDP.
- Keep: the simulator's "Most detections per dwell" (1 to 1 024) stays within those caps.

## F. Classification and exercise

**G15. Each packet has one classification.**
- 4607: `P4` runs from 1 (TOP SECRET) to 5 (UNCLASSIFIED) and has no "none" value. `P5` names the scheme (2 characters), and `P6` holds 16 bits of releasability codes. All three apply to the whole packet, not to each report (AEDP 3.1.4–3.1.6).
- In:
  - `classification: map` (the default) gives each object the packet's `P4`, through `classificationNames` (NATO's five by default);
  - `link-label` gives each object the link's label instead. This is for the AFSERS test files, which are marked SECRET on purpose (owner, GY);
  - a packet above the link's label is counted as `above layer label`, and an unmapped one as `label not mapped`;
  - `P6` is kept as a number.
- Out:
  - `P4` is the highest of the link's label and its detections' labels;
  - detections above `highestClassification` are left out and counted;
  - a label that the names do not know goes as 1, never lower;
  - `P5` is the link's `nationality` and `P6` is 0. emc2's label categories and caveats are not sent.
- Keep: the label policy's classifications, ordered, five of them for `P4` 1 to 5.

**G16. Every packet says whether it is an operation or an exercise, with real or simulated data.**
- 4607: `P7` is 0, 1 or 2 for an operation with real, simulated or synthesized data, and 128, 129 or 130 for an exercise (AEDP 3.1.7).
- In: `P7` sets the APP-6 context: 0 is reality, 1 and 2 simulation, 128 to 130 exercise.
- Out: 1, or 129 when the link's `exercise` setting is on. Never 0 or 128, because the data is simulated.
- `P3`, the platform's nation, is two characters: `nationality`, "XN" (NATO) by default.

## G. Transport and editions

**G17. The format has no framing, checksum or sequence number.**
- 4607 assumes the network delivers whole packets or none (AEDP 2.2, Guide D.3). Losses cannot be seen.
- TCP: packets come back to back, framed by `P2`. After a bad size the stream cannot be resynchronised, so the link reconnects. `gmti` takes packets of up to 65 535 bytes, the guide's minimum (G.7.3); the format allows more. A larger packet is counted `too long` and the link reconnects.
- UDP: one packet per datagram, so at most 65 507 bytes. A datagram whose `P2` differs from its length is dropped (`size mismatch`). Multicast groups are joined on a named interface; the tests use the test groups 239.255.46.1:46001 and 239.255.46.2:46002.
- Out: the inbox keeps only the latest dwell per sensor, so a slow peer loses whole dwells, which are counted.
- Out, `oneSegmentPerPacket` (T-159; owner MV A, on by default from MY): each segment in a packet of its own, under the same header with its own `P2`, for receivers that read only a packet's first segment. The guide's minimum receiver needs no more (G.7.3). "In" reads both forms alike.
- Keep: connection tasks for TCP client, TCP server and UDP with multicast (ADR-0036), with hosts from settings only (ADR-0030).

**G18. `gmti` reads every edition and writes "41".**
- 4607: the edition is in `P1`. "41" is Edition A; every one of the owner's recordings is "21" or "30".
- In: every edition is parsed by the existence mask alone, and a version other than "41" is logged once per link. Real senders break the format's conditions (report errors without the sensor errors), and the mask wins.
- Out: "41".

**G19. Coordinates are latitude first, with longitude from 0 to 360° east.**
- 4607:
  - every pair is latitude, then longitude;
  - longitudes run from 0 to 360° east, so a western one decodes above 180°;
  - heights are above the WGS84 ellipsoid, in centimetres for the sensor and in metres for a target (reference 4.4).
- `gmti` converts to emc2's longitude-first −180..180 (ADR-0007). Heights stay ellipsoidal: there is no geoid conversion (brief section 9).

## What emc2 must keep, by role

- **PDA (SDK):**
  - `ChannelItem.SensorReport`, its `Sensor` part (G1, G2, G10; CR-0033) and the `SENSOR_REPORTS` channel kind (G1);
  - `ObjectWriter.objectId` answering while a create is in flight (G5);
  - `ArcBand` and `Circle`, and `ChannelSpec.maxAreaDepth` (G12; CR-0035);
  - expiry from `time.observed` (G4, G9);
  - declared fields and field sets that are not editable by others (G13), and relation kinds (G5);
  - from SDK 1.5.0 (CR-0038), a data type's field sets and `manual` (G13);
  - from SDK 1.6.0 (CR-0041), a relation line's `strokeColorSetting` (G5), a map object's `displayClass` (G7, G12) and a setting's `kind: "colour"`;
  - from SDK 1.7.0 (CR-0042), a data type's `fadeSetting` and the stepped fade's form (G4).
- **CDA (ECore):**
  - sensor-report channels and their inbox (G1, G17);
  - a store that takes `gmti`'s bursts (G4);
  - connection tasks with multicast (G17);
  - the label policy (G15);
  - from SDK 1.6.0: `displayClass` kept by the store (`ModelJson`), `strokeColorSetting` kept and `ctx.relationLines` given (G5), the switches "Dwell areas" and "Sensor coverage", and the colour picker.
  - from SDK 1.7.0: `fadeSetting` kept and sent (`PluginManifest`, `PluginHost.dataTypesJson`), and the shell's `ctx.dataTypes` with the fades from the settings (G4).
- **PCA-simulator:**
  - one dwell per revisit, empty ones too (G1, G11);
  - the dwell area that the sensor looked at, whatever its reach; `gmti` cuts it (G12, JS), and the channel's `maxAreaDepth` says where (CR-0035);
  - the sensor's name, mission and settings in the dwell (CR-0033, CR-0034), generic and in SI units (JQ); `gmti` fits them (G10);
  - detections with the measured `Point`, the track's speed, direction and symbol (G13).
- **PCA-map-view-2d:** it draws `ArcBand` (G12; T-145) and relation lines (G5), from SDK 1.6.0 in `ctx.relationLines`' colours, and hides objects by display class (G7, G12); from SDK 1.7.0 it draws the fades in steps (its function 46; G4).
- **PCA-draw-symbols:** Symbol properties shows the field set `gmti.report` (G13; not yet, its field-set task).
- **ESA, ITA:** replays use `time: as-received` (G9). The AFSERS files test both classification settings (G15).

## For the user manual (UDA)

**Operators:**
- GMTI comes in from radars and recordings. It goes out only from the simulator's GMTI sensors (G1).
- A platform's name is its radar's id: at most 10 characters, with long names cut and letters such as å, ä and ö replaced (G2).
- Detections are dots, not tracks. They have no name and no identity and never move. From M7 RC2 they fade in steps from 10 s after the report and are invisible at 100 s; they are gone after 3 minutes by default (G3, G4). The dwell areas fade in steps the same way: from M8 each dwell leaves its own area, which is full until 5 s, then fades and is gone at 15 s, so a sensor's recent dwells show as a trail of fading areas (G12).
- A detection's speed is its speed towards or away from the radar, not its speed over the ground (G13).
- A dwell area, a solid line (green by default from M8), is a patch of ground the radar looked at; the newest is drawn fully, older ones fade. The coverage, a dashed box, is the area its job covers (G7, T-158). Each user may hide them with the display switches "Dwell areas" and "Sensor coverage"; both are on by default, and the detections and their lines stay. GMTI holds at most 255.99 km either side of its centre. The simulator's sensors may reach farther: a sector, or a "Detect all in range" circle, deeper than 511.98 km beyond its near edge is cut when sent as GMTI, and the detections beyond the cut are not sent (G12).
- The pairing line between a detection and its platform, yellow by default, shows while "GMTI Pairing" is switched on in the display settings, as it is by default from M7 (G5).
- From M8 the dwell areas are #7EF26A and the coverage #BDCF3D by default; an admin may choose other fixed colours in Settings › GMTI, or the platform identity's colour, and another colour for the pairing lines (G5, G7, G12).
- Nothing shows until the stream's mission segment arrives. That can take up to two minutes, and never happens if the sender sent it only once, before the link joined (G6).

**Admins:**
- Links connect by TCP as client or server, or by UDP with multicast (G17).
- For a replay, set `time` to `as-received`, or the detections expire, and are invisible, at once (G9).
- Settings › GMTI's "Detection fade" and "Dwell area fade" set the steps for every user: from, step and invisible at, the last above the first; off, only the data type's fade at expiry (G4).
- `classification` is `map` or `link-label`. `highestClassification` keeps detections above it from being sent (G15).
- `exercise` marks outgoing data as an exercise (G16).
- `coverage` switches the incoming sensors' coverages off (G7). `oneSegmentPerPacket` sends each segment in its own packet, on by default; switch it off for a receiver that wants one packet per dwell (G17).
- The caps per dwell and per segment are settings (G14).
- A receiving system sees each restart of an out link as a new mission, unless the sensor has a mission: then it keeps its mission id. A mission longer than 12 characters is cut in what the receiver shows (G6).
- The counters and warnings are in the README. `not held: D26` and `beyond reach` say that an out link cut a sensor's area and left detections out (G12).

## Changes

- 2026-11-07: first version, G1 to G19.
- 2026-11-07: G6's open point became CR-0034 (owner, Q4).
- 2026-11-07: G6, G10 and the role list follow the owner's JQ: sensor settings are generic, and `gmti` fits them.
- 2026-11-07: G12 follows the owner's JS and Q5: `gmti` cuts a too deep area at its near edge and leaves out the detections beyond; the simulator no longer cuts its reach.
- 2026-11-07: G2, G7 and G10 describe CR-0033's mapping as built (owner JW): `P8` from the sensor's name, the values in 4607's units, "no statement" or left out and counted, `J15` 0 above 6 553.5 s.
- 2026-11-07: G6 records CR-0034's approval (owner KF; R2 and R3), and G12 map-view-2d's arc bands (T-145).
- 2026-11-07: G6 describes CR-0034's mapping as built: `M1` from the sensor's mission, replaced as `P8` and cut to 12, `mission cut` once per sensor; `P9` its CRC-32.
- 2026-11-08: G10 and G12 describe CR-0035 as built (owner KL, KM and KQ): the out channels' `maxAreaDepth` 511 980 m; a `Circle` round the sensor sent with its centre halfway out, whole up to 511.98 km; the cut and `beyond reach` at the declared depth; a circle's `J22` seen at half its radius.
- 2026-11-09: G6, G7, G12 and G17 follow T-158 and T-159 as built: the coverage, the job's bounding area, drawn dashed per platform (owner Q26 to Q28, Q30 A); the dwell area at 3 px (owner); one segment per packet, on by default (owner MV A, MY).
- 2026-11-10: G13 follows SDK 1.5.0 part 1 (CR-0038; owner NQ A): `gmti.detection` names its set `gmti.report`, and both data types are `manual: false`.
- 2026-11-10: G1, G7, G11 and G12 follow T-168, T-169 and T-151 (owner OU A, PI A; CR-0039, CR-0040): out takes ground radars only; the job's bounding area from the sensor's job area, clockwise, or its box (owner, in PCA-gmti's session); `D2` to `D4` from the report's sequence; in draws a revisit's dwells together; detections are a sensor report type.
- 2026-11-12: G5, G7 and G12 follow M7's T-181, T-182 and T-185 (owner QL C, QM A, QR A): the dwell area at 2 px; the dwell areas' and the coverage's colours from the admin's settings, by default the identity's; the pairing on by default.
- 2026-11-16: G4, G7 and G12 (the owner, after M8 RC1): every dwell its own area again, in place of one per revisit (VD C, 2026-11-14), whose band grew with each dwell of a pass; the dwell areas full until 5 s, gone at 15 s, and `gmti.dwell-area` expires at 15 s.
- 2026-11-13: G7 and G12 follow M8's T-195 and T-189 (owner TP A, A, SU A, SV A): every dwell its own area, gone by its fade and expiry, not by a later dwell, revisit or job end, and without a name (owner); `gmti.dwell-area` expires at 100 s; the default colours fixed, `#7EF26A` and `#BDCF3D`.
- 2026-11-12: G4 and G12 follow SDK 1.7.0 (CR-0042 option A; T-192, owner TA A, FA A, FB A, FC A): the fades in steps `detectionFade` and `dwellAreaFade`, and the dwell areas' own data type `gmti.dwell-area` (owner, 2026-11-12, for the brief's `gmti.dwellArea`).
- 2026-11-12: G12, out (T-193, owner TB A): an `ArcBand` goes by its own shape wherever its centre lies, its cut measured from that centre; before, one not centred within 1 m of the platform was measured from the platform.
- 2026-11-12: G5, G7 and G12 follow SDK 1.6.0 parts C, D and F (CR-0041; owner Q58 A, Q60 A): the pairing line's colour from `pairingColour`; the dwell areas marked `dwell-area` and the coverage `sensor-coverage`; the three colours shown as colour pickers.
