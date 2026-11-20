# gmti

GMTI (ground moving target indication) radar data as STANAG 4607 (AEDP-4607 Edition A, Version 1), in and out. Brief: [`docs/plugins/briefs/gmti.md`](../../docs/plugins/briefs/gmti.md); ADR-0048; the ACA's reference [`docs/architecture/gmti-4607.md`](../../docs/architecture/gmti-4607.md). Server part only: an admin sets up its links in Settings, under "GMTI". **What STANAG 4607 asks of the rest of emc2**, rule by rule, for designers and the user manual: [`FORMAT-RULES.md`](FORMAT-RULES.md).

## What it does

- **In:** a link reads 4607 packets and writes into its target layer. It reads every version ("21", "30" and "41") by the existence mask alone; a version other than "41" is logged once per link. It writes:
  - **the sensor platform**, a symbol of data type `gmti.platform`, at the dwell's sensor position, with its heading and speed, named by its platform id (`P8`). Each dwell and each platform location segment moves it. Its extension holds the mission (platform type, plans) and the job definition (sensor, mode, bounding area, nominal errors).
  - **its dwell areas**, shapes of data type `gmti.dwell-area` (from M7 RC2, T-192): an arc band round the sensor, or a circle when the half angle is 180° or more. Each is a solid outline of 2 px (M7, owner QL C; 3 px in M5 and M6) in the colour of the setting `dwellAreaColour`, by default `#7EF26A` (M8, T-189), no fill. It carries the display class `dwell-area` (SDK 1.6.0 part D, T-182), so a user's switch "Dwell areas" hides it.
    - **Every dwell its own area** (M8, T-195; owner TP A, and again on 2026-11-16 after M8 RC1, in place of one area per revisit, VD C, whose growing band did not match the simulator's plan; replaces M6's one area per dwell index, T-169): each dwell with a size writes a new area, known by `<link>/<P8>/area/<dwell time, UTC ms>/<D2>/<D3>`, **without a name** (owner, 2026-11-13: a name is a map label, and a sensor leaves up to about 150 areas; the brief had "<P8> dwell <D2>.<D3>"). The dwell's time, as recorded, is in the key because `D3` repeats every revisit and `D2` wraps at 65 535; a dwell received again is the same area. A dwell of size 0 writes none (A4).
    - **It goes by its fade and its data type**, never by `gmti`: it fades in steps by `dwellAreaFade`, counted from its dwell's time, and ECore removes it at its expiry, by default 15 s after its dwell, when the default fade has made it invisible (owner, 2026-11-16: full until 5 s, gone at 15 s, so that a sensor keeps few). No later dwell, revisit (`D2`, `D4`) or job end (`J5` 255) removes it, so the fade shows while a sensor sends, as the detections' does. `gmti` keeps no list of the areas and no cap (owner, A): at AFSERS's rate, a dwell about every 0.1 s, a platform has about 150 areas at a time.
  - **its coverage** (T-158), a shape of data type `gmti.platform` known by `<link>/<P8>/coverage`: the latest job definition's bounding area (`J6`–`J13`), a polygon of its four corners, a dashed outline of 1.5 px in the colour of the setting `coverageColour`, by default `#BDCF3D` (M8, T-189), no fill. One per platform. It is written when its corners change, and otherwise refreshed at most every 30 s while the platform's dwells or job definitions come, with the time of its latest dwell. It is not drawn while the corners enclose no area, and is removed when its job ends. It carries the display class `sensor-coverage`, which a user's switch "Sensor coverage" hides; the link setting `coverage` switches it off for everyone.
  - **each target report as a detection**, a symbol of data type `gmti.detection` with the field set `gmti.report` and one `gmti.pairing` relation to its platform's object, from the link's first dwell on (the writer's `objectId`, SDK 1.4.0 part 4). It is never updated, so its pairing ends with it. Detections are not tracks: they fade and go by their data type's expiry, by default 60 s and then 120 s faded. From M7 RC2 they fade in steps by the setting `detectionFade` instead (below), and an invisible one stays until its data type removes it (owner, FB A).
- **Out:** a link offers an output channel that takes **sensor reports only**, the simulator's GMTI sensor, and from M6 (T-169) **ground radars only** (`sensorTypes` `GROUND_RADAR`). A report of another sensor type is not sent and is counted (`not a ground radar`); a report without a type is sent as in M5. Each dwell goes as packets with the packet header (`P1` "41") and these segments:
  - the mission segment. `M1` is the sensor's mission cut to 12 characters, and `P9` its CRC-32, so a restart keeps the mission; without a mission, `M1` is spaces and `P9` the second of the link's start day (CR-0034; format rules G6);
  - the job definition first, again with the next dwell when the sensor's job area changes, and at least every 30 s. Its bounding area `J6`–`J13` (T-168):
    - the sensor's job area (`Sensor.jobArea`) when it has one: its four corners, A its first and then clockwise, as 4607 asks, so a counter-clockwise ring goes the other way round (owner, 2026-11-10);
    - a job area that is not a convex four-corner area goes as the box round it, counted once per sensor as `not held: J6` (owner, 2026-11-10);
    - without a job area, the box round the dwell area, as in M5;
  - the dwell in segments of at most `maxReportsPerSegment` reports. With the report's sequence (CR-0040), `D2` is its revisit modulo 65 536, `D3` its dwell and `D4` set on the revisit's last dwell only; without one, the link's own revisit count, `D3` 0 and `D4` set, as in M5. The link's inbox keeps the latest packets per sensor and dwell number, so a revisit's dwells do not replace each other.

  With `oneSegmentPerPacket` on, the default (T-159; owner MV A and MY), each segment goes in a packet of its own, in that order, with the same header fields and each packet's own size `P2`. Receivers that read only a packet's first segment see every segment. Off, they go as one packet, more only when the reports do not fit the link (65 535 bytes over TCP, one datagram over UDP), each with the mission segment.

  The inbox keeps the latest dwell per sensor, so a slow peer loses whole dwells, which are counted.
- **Skipped and counted by type:** HRR, free text (logged at debug), test and status, processing history, job request and acknowledge, and the reserved and extension types.

## Links (the `links` setting)

| Setting | Default | |
|---|---|---|
| `name`, `mode` (`tcp-client`, `tcp-server`, `udp`), `direction` (`in`, `out`), `host`, `port`, `listen` (`address`, `port`), `idleSeconds`, `enabled` | `tcp-client`, `in`, listen address `127.0.0.1`, 120 s, on | The connection; a change reconnects the link. A server or a receiver binds to loopback unless an admin sets another address |
| `multicastGroup`, `multicastInterface` | none | `udp`: a group to join (in) or send to (out), on an interface given by name or address (`127.0.0.1` for this computer only) |
| `targetLayer`, `label` | a new layer named like the link; the server's default label | in: the layer and the objects' label. out: the least classification a packet says |
| `platformSymbol`, `platformIdentity` | from the platform type; `unknown` | in |
| `maxReportsPerDwell` | 1 000 | in: the rest of a dwell's reports are skipped and counted |
| `time` | `as-recorded` | in: `as-received` shifts the link's times so that its newest dwell is now (for replays) |
| `classification`, `classificationNames` | `map`; NATO's names | in: `map` gives objects the packet's classification (`P4` 1 to 5 by the names); `link-label` gives them the link's label |
| `highestClassification` | the label policy's highest | out: detections above it are not sent |
| `coverage` | on | in: draw each sensor's coverage, the job's bounding area (T-158); off removes the drawn ones |
| `nationality`, `exercise`, `maxReportsPerSegment` | `XN`, off, 120 | out: `P3` and `P5`; `P7` 129 instead of 1; reports per dwell segment |
| `oneSegmentPerPacket` | on | out: each segment in a packet of its own (T-159) |

Everything but the connection applies at once, without a reconnect.

**The colours** (M7, T-181, T-185; owner QM A, QR A; from M8 fixed by default, T-189, owner SU A, SV A): three settings beside `links`, set by an admin and the same for every user and link:

| Setting | Default | |
|---|---|---|
| `dwellAreaColour` | `{ "use": "fixed", "colour": "#7EF26A" }` (M7: `identity`) | the dwell areas' solid outline: `fixed`, the `colour` `#RRGGBB`, shown only with `fixed`, or `identity`, the platform identity's colour (each link's `platformIdentity`), still selectable |
| `coverageColour` | `{ "use": "fixed", "colour": "#BDCF3D" }` (M7: `identity`) | the coverage's dashed outline, the 4607 job's bounding area, the same way |
| `pairingColour` | `#FFFF00` | the pairing lines, through the relation kind's `strokeColorSetting` `/pairingColour` (SDK 1.6.0 part C); the map view draws them in it, yellow while it is missing |

Each colour is marked `"x-emc2": { "kind": "colour" }` (SDK 1.6.0 part F, owner Q60 A), so the settings form shows a colour picker; where the shell has none yet, a text field. The settings schema refuses a colour that is not `#RRGGBB`.
- **An outline's colour** applies from each shape's next write, without a reconnect: a dwell area from its sensor's next dwell, whose new area takes it while the older ones keep theirs until they go, a coverage at its next write (new corners, or its refresh within 30 s). Should a bad value reach the plugin, it draws the default colours and names the problem in the status.
- **The pairing colour** is not the plugin's: the shell resolves it from the settings (`ctx.relationLines`) and the map view follows a change without a reload. It colours every `gmti.pairing` line, the Simulation's sensors' too.
- **The Simulation's own dwells and coverage** follow Settings › Simulator, not these (owner, ST C); each setting's text says so.

**The fades in steps** (M7 RC2, T-192; CR-0042 option A, owner FA A, FB A, FC A; SDK 1.7.0): two more settings, set by an admin and the same for every user:

| Setting | Default | |
|---|---|---|
| `detectionFade` | `{ "on": true, "fromSeconds": 10, "stepPercent": 5, "invisibleAtSeconds": 100 }` | the detections, through `gmti.detection`'s `fadeSetting` `/detectionFade` |
| `dwellAreaFade` | `{ "on": true, "fromSeconds": 5, "stepPercent": 5, "invisibleAtSeconds": 15 }` (owner, 2026-11-16; M7 and M8 RC1: as `detectionFade`) | the dwell areas, through `gmti.dwell-area`'s `fadeSetting` `/dwellAreaFade` |

- **The steps** (owner, FC A): counted from an object's `time.observed`, full until `fromSeconds`, then one `stepPercent` less every (`invisibleAtSeconds` − `fromSeconds`) × `stepPercent` / 100 s, and 0 from `invisibleAtSeconds`: by default for the detections 95 % from 14.5 s, 50 % from 55 s, gone at 100 s; for the dwell areas 95 % from 5.5 s, 50 % from 10 s, gone at 15 s. The form: "Fade in steps", "From (s)", "Step (%)" (1, 2, 4, 5, 10, 20, 25 or 50) and "Invisible at (s)", the last three only while it is on.
- **The map view draws them** (`map-view-2d` function 46), in place of the data type's expiry fade; `gmti` writes nothing for them. A change reaches the objects on the map without a reload. Off: the expiry fade only.
- **An end not above the start:** the schema cannot refuse it (model rule 22), so it gives no fade in steps, and the plugin names it in its status (DEGRADED), as it does a bad colour.
- **The data type `gmti.dwell-area`** ("GMTI dwell area", `"manual": false`; from M8 RC2 expires 15 s after the dwell, owner 2026-11-16, and 100 s in M8 RC1, not faded at expiry, removed at once, T-195; M7: `gmti.platform`'s 300 s, faded, removed 600 s after): the areas fade apart from the platform and the coverage, which keep `gmti.platform`. An admin's data type settings for `gmti.platform` no longer reach the areas. The brief and CR-0042 spelled it `gmti.dwellArea`, which the model's type names refuse; `gmti.dwell-area` is the owner's choice (2026-11-12).
- **With `time` `as-recorded`**, an old recording's detections and areas have their old times, so they are invisible at once; use `as-received` for a replay.

**The form shows what a link uses** (M6, T-160; SDK 1.5.0 part 4, `visibleWhen`; owner Q45 A and PQ A):
- by mode: `host` and `port` for `tcp-client` and `udp`, `listen` for `tcp-server` and `udp`, and the multicast fields for `udp`. A `udp` link shows both the peer and `listen`, since a field is shown by one other field only;
- by direction: the fields marked "in" or "out" above for that direction only, hidden rather than greyed as in M5;
- for both: `name`, `mode`, `direction`, `idleSeconds`, `enabled` and `label`.

A hidden field keeps its value and is still validated, so switching a link's mode and back keeps its `host`. The schema requires what is used, with its own `if`/`then`: `listen` for `tcp-server` and for a `udp` `in` link, and `host` and `port` for `tcp-client` (also when `mode` is absent) and for a `udp` `out` link. ECore refuses such a link when it is saved; the plugin's own check (`Link`) refuses the same links, so a link saved before M6 is reported in the status as before.

**A moved object stays where the user put it** (M6, T-155; SDK 1.5.0 part 5, ADR-0053): a platform, its areas and its coverage moved into another layer are updated there, while new ones go to the link's layer. A copy has no external id, so the link never updates it.

## Symbols

| What | APP-6D (digit 3 the context from `P7`, digit 4 the identity) |
|---|---|
| Detection, tracked vehicle (classes 1, 129) | land equipment, mobility tracked: `10x11500330000000000` |
| Detection, wheeled vehicle (2, 130) | land equipment, mobility wheeled: `10x11500310000000000` |
| Detection, rotary wing (3, 131) | air, rotary wing: `10x10100001102000000` |
| Detection, fixed wing (4, 132) | air, fixed wing: `10x10100001101000000` |
| Detection, maritime (6, 13, 134, 141) | sea surface, no entity: `10x13000000000000000` |
| Detection, anything else | land equipment, no entity (a ground track): `10x11500000000000000` |
| Platform, aircraft types (`M3`) | air, fixed wing |
| Platform, UGS and ground based (`M3` 13 to 15) | land equipment, sensor: `220100` |
| Platform, unidentified or other (0, 255) | air, no entity |

- The classes are AEDP Table 3-11's: 1 and 129 are tracked, 2 and 130 wheeled.
- `symbology`'s catalogue has no generic vehicle, so the mobility amplifier (digits 9 and 10) marks tracked and wheeled.
- Each code was checked in the shell's symbol preview on 2026-11-07: it draws without an error frame.

**Out, the simulated class (`D32.10`) from a track's symbol:**
- Land equipment with mobility 33 or 34, armoured vehicles and tanks: 129.
- Other land equipment, and land units: 130 (armour and mechanized units: 129).
- Air: 131 or 132.
- Sea surface, or a `vessel` symbol: 134.
- Dismounted individuals: 137.
- Anything else: 255.

## Status and counters

- **Status per link:** `<name> [<where>]: <state>, <rates>`.
  - States: `up`, `connecting`, `listening, N clients`, `down: <reason>`, `switched off`. A bad entry shows its problem in place of a link.
  - Rates, in: `P packets, D dwells, R reports a minute, N platforms`; out: `S dwells sent a minute, X dropped`.
  - `OK` while every enabled link runs, else `DEGRADED`.
- **Counters (monitor view):**
  - transport: `packets in`, `bytes in`, `dropped: too long | malformed | size mismatch | worker busy`;
  - in: `dropped: no mission`, `skipped: segment <type>`, `skipped: over cap`, `value out of range`, `above layer label`, `label not mapped`, `platforms`, `detections written`, `detections not paired` (the platform's write was dropped), `areas written`, `coverages written`, `rejected: area removal <code>` and `rejected: coverage removal <code>`;
  - out: `dwells out`, `packets out`, `dwells dropped`, `detections above highest`, `mission cut` (once per sensor while the link runs: its mission is longer than `M1`'s 12 characters), `not held: <field>` (once per dwell and field: `D26` when its area was cut; the sensor's `J15`, `J21`, `J22`, `J24`, `D31`, `D32.12`, `D32.13` or `D16`; a report's `D32.6` or `D32.7`; `J6` once per sensor for a job area sent as its box), `beyond reach` (detections left out beyond a cut area), `not a ground radar` (a report of another sensor type, not sent), `skipped: not connected`;
  - the object writer's own counts.
- **Warnings:** at most once a minute per link and reason, for a dwell dropped for want of its mission, reports over the cap, an unmapped or too high label, detections above the highest classification, a value not held (one warning per field), detections beyond a cut area, and a refused area or coverage removal.

## Messages and services

- **Receives:** the output channel's items (`ChannelItem.SensorReport`) on each `out` link's channel (`ChannelSpec` kinds `SENSOR_REPORTS`, `sensorTypes` `GROUND_RADAR`, field set `gmti.report`, `maxAreaDepth` 511 980 m).
- **Provides:** the data types `gmti.detection`, `gmti.platform` and, from SDK 1.7.0, `gmti.dwell-area`, the declared fields and field set `gmti.report` (measurements, not editable by others), and the relation kind `gmti.pairing` ("GMTI Pairing", on by default from M7: owner, 2026-11-11, T-182; its colour the setting `pairingColour` from SDK 1.6.0, yellow as the fallback).
  - From SDK 1.7.0 (CR-0042; `sdkVersion` `^1.7.0`): the fades in steps, `fadeSetting` on `gmti.detection` and `gmti.dwell-area`.
  - From SDK 1.6.0 (CR-0041): the pairing colour (part C), the display classes `dwell-area` and `sensor-coverage` (part D), the colour pickers and the category `data-links` (part F).
  - From SDK 1.5.0 (CR-0038; T-165): `gmti.detection` names its set (`"fieldSets": ["report"]`), so the store adds `gmti.report` to each detection; `gmti.platform` names none.
  - Both are `"manual": false`: a detection belongs to a dwell and a platform to a sensor, so editors leave both out of their data type select. The store does not check it.
  - `gmti.detection` is `"sensorReport": true` (M6, T-151): the map view draws detections with `symbology`'s sensor report symbol. Each detection keeps its class's APP-6 code, so other plugins and the properties panel still see it.
- **No endpoints and no web part.**

## Permissions

None of its own. An admin sets up the links in Settings (`settings.admin`). The plugin writes as itself; the store checks each change.

## Network

The links are connection tasks (ADR-0036), declared in the manifest's `connections` and `internet` (`hosts: []`). Hosts, ports, groups and interfaces come only from the links' settings, never from received data.

## Known limits

- **Out, the sensor** (CR-0033; format rules G2, G10): `P8` is the sensor's name, cut to 10 characters, with a suffix such as "~2" when another sensor on the link holds it, and kept while the link runs. A value its 4607 field cannot hold is "no statement" or left out and counted, never clamped; a revisit above 6 553.5 s is sent as `J15` 0, "not revisiting". The platform's own errors are not stated (`J16`–`J20`; `D12`–`D14` are 0 when the reports carry errors), and the job's bounding area is the sensor's job area, else the box round the dwell area (a box crossing the antimeridian is wrong). A dwell without a sensor sends "SIM" and seven hex digits of the sensor's id, and "no statement".
- **Out, area:** `D26` holds at most 255.99 km either side of the area's centre, so an area goes whole up to 511.98 km beyond its near edge; the out channels declare that as their `maxAreaDepth` (CR-0035; format rules G12). A circle round the sensor goes with its centre halfway out, so one of up to 511.98 km goes whole. A deeper area keeps its near edge and is cut 511.98 km beyond it (owner, JS and Q5), and the detections beyond are left out and counted.
- **Out, a dwell near a moving sensor** (T-193): an arc band goes by its own shape (its middle, half its depth, half its angle) wherever its centre lies, and the dwell with the platform's position at its time. **How a dwell is centred:** before T-193 the simulator centred a revisit's bands where the platform was when the revisit began; since T-193 it centres each dwell on the platform where its report puts it (PCA-simulator `0b91a88d`), so a simulated band reads back exact. Another sender may still send a band centred elsewhere, and `gmti` sends it by its own shape. A receiver draws the band from the platform's position: its middle, far edge and width stay, its point moves to the platform, and what lies behind the platform is lost; a platform within 1 m of the band's middle reads back as a circle (format rules G12).
- **Out, reference day:** a dwell outside the 49.7 days that `D6` counts from the link's reference day moves the day to the dwell's; every packet carries its mission segment.
- **"above layer label"** compares a packet's label with the link's label, else the server's default. A layer an admin picked may have another label; the plugin does not read layers' labels.
- **`dwells dropped`** counts what the link's own inbox replaced. ECore's channel inbox also keeps only the latest dwell per sensor, without a count.
- **A report without an index** (`D32.1`, e.g. VISTA's) is known by its place to 1e-7°. Two reports of one dwell at one place are one detection.
- **One coverage per platform:** interleaved jobs on one platform share it. The dwell areas are one per dwell (M8, T-195), whichever job sent them.
- **The last 1 024 platforms:** a link keeps the coverages of its last 1 024 platforms (their ids come from received data, so the memory is bounded). An older platform's coverage then stays until its data type's expiry removes it. The dwell areas are not kept at all (M8): each goes at its own expiry.
- **Many dwell areas:** about 150 per platform at AFSERS's rate (M8, T-195; owner, 2026-11-16: 15 s, against 1 000 at M8 RC1's 100 s); a faster sender makes more, bounded by their 15 s expiry and the link's own limits (the cap per dwell, the writer's limits). Areas written in M7, under `<link>/<P8>/area` and `.../area/<n>`, keep their old type and go at its expiry.
- **In, the coverage's time:** before its platform's first dwell, the coverage has the time its job definition arrived, with `time` `as-recorded` too.
- **In, a full ring:** an area whose `D27` is 180° or more is read as a `Circle` of its outer radius round the sensor (brief criterion 4; owner, LH, 2026-11-08). A band all round the sensor that starts at a near edge loses its hole. For example, a simulator sensor set to 0° to 360° and 100 to 350 km is drawn as a disc of 350 km. The detections are not affected.
- **Not built (brief section 9):** HRR, tasking, processing history, the reduced position form when sending, NSIF/NITF, relaying received GMTI, code words to label categories, geoid heights, tracking.
- **In the shell on 2026-11-07:**
  - `map-view-2d` drew no `ArcBand` (only polygons, circles and ellipses), so the dwell area showed as a marker at the sensor. It draws arc bands since its T-145, checked with `gmti` on 2026-11-08;
  - Symbol properties shows no field set yet, so a detection's `gmti.report` values are in the store but not in the panel;
  - `map-view-2d` drew no relation lines yet (ADR-0051 point 6), so the pairing was in the store but not on the map. It draws them since M5 ("GMTI Pairing" in the Display settings), on by default from M7.
