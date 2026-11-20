# ACA review of CR-0033: a dwell says which sensor made it and how it was set

- **Reviewed:** `docs/change-requests/CR-0033-sensor-details-in-a-dwell.md` on `main` at `09928f8e` (PCA-gmti, for the owner; Q1, Q2b, JH).
- **Against:** ADR-0048 points 4 to 7; ADR-0037 point 6 (the inbox keeps the latest item per key); the SDK's channel records on `integration/sdk-v1.4` (`ChannelItem.Dwell`, `Detection`, their constructors) and its `@Nullable` convention (`Modifiers`, `DeclaredField`); `docs/architecture/gmti-4607.md` section 4.3 and its field tables (sections 3 and 4); the `gmti` brief's "Out" and the simulator's functions 27 to 29 on `integration/sdk-v1.4`; the owner's statement of 2026-11-06 that `gmti` out serves the simulator only.
- **By:** the ACA, 2026-11-07.

## Verdict

**Recommend approval.** The gap is real: the reference's 4.3 and the `gmti` brief take the platform id and the job's nominal values "from the sensor's settings", and those settings are the simulator's (ADR-0048 point 7), which the dwell does not pass on. The CR closes it in the only place that works with the inbox, inside the dwell, with a compatible addition before the 1.4.0 freeze, and leaves every other receiver and every ADR as they are. Four remarks, none blocking; R2 and R3 are for the `gmti` brief when the mapping is built.

## Against the decisions

| Source | Result |
|---|---|
| ADR-0048 point 7 | Matches: the values the CR passes are point 7's settings (the revisit time, the probability of detection, the range and cross-range errors, the minimum detectable speed) and the platform track's own name, direction and speed. The maximum range and the dwell area are already in the item (`area`). No new setting. |
| ADR-0048 points 4 and 5 | Kept: each dwell is still one packet; `gmti` out still takes sensor reports only. Only the packet's content gets truer. |
| ADR-0037 point 6 | **The in-dwell shape is the only one that works.** The inbox keeps the latest item per key, and a dwell's key is its sensor's id. A separate "sensor description" item keyed by the sensor would coalesce with the sensor's dwells, and one keyed otherwise could be lost on a slow link while the dwells go through. Eight small values per dwell cost nothing against a dwell's detections. |
| The SDK's channel records | Matches their style: a record with its checks in the compact constructor, `@Nullable` boxed values as `Modifiers` has, the earlier constructor kept with `null`, as `MapObjectContent` and `EndpointRequest` did in 1.4.0. `name` required, 1 to 64 characters, fits `P8`'s rule that a sender always has an id. |
| The reference's 4.3 | The mapping is 4.3's, line by line: `P8` ten characters, `J15` deciseconds, `J21` cm, `J22` the angle at the area's centre, `J24` and `D31` dm/s, `J25` percent, `D15` to `D17` with the vertical speed 0, `D32.12` cm and `D32.13` dm, and `D12` to `D14` as 0 when report errors are sent (AEDP 3.4.32.12, the reference's section 4.3 and 5). "Detect all in range" with no errors, no minimum speed and a probability of 1 is right: it detects exactly. |
| Compatibility | A sixth component with the five-component constructor kept; channel items are never stored; the web SDK and the data model do not change; `cot`, `ais` and `adsb` ignore the part. A sender built against part 1 compiles and sends as before. |
| Alternatives | Right to reject: link settings in `gmti` would be typed twice and drift (against the owner's statement); a store lookup gives the name only; doing nothing keeps a valid stream that says nothing true. |

## Remarks

| | Remark | For |
|---|---|---|
| R1 | **Two of the eight values are the platform's motion at the dwell, not the sensor's settings.** `platformDirection` and `platformSpeed` belong with the dwell's `platform` position, as `D15` to `D17` belong with `D7` to `D9`. Keeping them in `Sensor` is acceptable, since it keeps the `Dwell` to one new component; let `Sensor`'s Javadoc say that these two are "at the dwell" while the rest are the sensor's settings, so that a reader does not take them for fixed. | PDA (Javadoc) |
| R2 | **`P8` from a name: the cut and the character set.** `P8` is ten BCS characters, and the CR cuts the name to ten and asks for uniqueness per link. Two platforms named "Platform A1" and "Platform A2" cut to the same ten; a Swedish name has characters BCS lacks. The `gmti` brief's "Out" should say how: characters outside BCS replaced, and a collision after the cut resolved by a suffix that stays for the sensor's life, so that a receiver sees one platform per sensor (its `{gmti, <link>/<P8>}` identity). The uniqueness is the link's, as today. | PCA-gmti (brief), PDA |
| R3 | **Values the fields cannot hold.** `J15` is 16 bits of deciseconds (a revisit up to about 109 minutes), `J24` and `D31` eight bits of dm/s (a minimum detectable speed up to 25.4 m/s), `J21` and `D32.12` 16 bits of cm (an error up to about 655 m). The simulator's settings may exceed them. Say in the brief that a value a field cannot hold is sent as "no statement", never clamped or wrapped, and counted, so that a receiver gets nothing rather than something false. | PCA-gmti (brief) |
| R4 | **Where it is built.** The CR is its own record, so CR-0030 needs no note; `sdk-v1.md`'s 1.4.0 notes list it under its own heading with the CR's number. It is a half-day addition on `integration/sdk-v1.4`, independent of part 6: the MCA orders it; the ACA has no preference beyond "before the freeze". | PDA, MCA |

## What the ACA checked beyond the CR

The reference's field tables for every mapped field's width and unit (`P8` A10; `J15` I16 ds; `J21` I16 cm; `J22` BA16 degrees; `J24` and `D31` I8 dm/s; `J25` I8 percent; `D15` BA16, `D16` I32 mm/s, `D17` S8 dm/s; `D32.12` I16 cm; `D32.13` I16 dm); the inbox's key on `integration/sdk-v1.4` (`ChannelItem.id()` is the dwell's `sensorId`, and `coalesceKey()` is `id()`); the simulator's functions 27 to 29 for the settings the CR names, and the `gmti` brief's "Out" for the words the CR replaces.
