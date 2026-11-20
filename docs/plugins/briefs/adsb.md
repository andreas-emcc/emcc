# Brief: adsb

- Status: **Draft (2026-10-31), for the owner's approval** · Milestone: M4 · Task: T-094 (brief), T-097 (plugin) · Agent: PCA-adsb (new)
- **Updated 2026-10-31 with the owner's EM** (PCA-adsb's first round): a value out of its range drops only that value, not the line (sections 3, 4 and 6, criteria 1 and 2). Decided by the owner, so approved.
- **Updated 2026-11-06 for M5 (T-132; CR-0030 part 3, ADR-0050): section 10.** The field set `adsb.aircraft`. Built against SDK 1.4.0 part 3 (`^1.4.0`). **Approved by the owner (2026-11-06, IB).**
- **Updated 2026-11-10 for M6 (T-165; CR-0038 points 1, 3 and 10, SDK 1.5.0 part 1): section 11, criterion 18.** Section 10's set is not built yet (the manifest in `integration/sdk-v1.5` `6fbe3b18` declares no fields); CR-0038 point 10 asks for it in the same release, and the data type `adsb.aircraft` names it. **Approved by the owner (NQ A, 2026-11-10)**; with Q31 A (NO A: a data type's sets go on symbols only) and Q32 A (NP A: SDK 1.5.0 from part 1).
- **Updated 2026-11-11 for M6 (T-155; CR-0039 points 10 and 11, approved by the owner, OB A; SDK 1.5.0 part 5): section 11's item 4 and criterion 19.** A moved track stays where the user put it (ADR-0053 point 8). **Approved by the owner (2026-11-11, PR A).**
- **Built by the playbook** `docs/plugins/in-out/playbook.md` (v1), work packages 1 to 5. This brief has the playbook's nine sections (its section 4); each work package names the sections it reads.
- Read also: ADR-0036 (connection tasks), ADR-0037 (links), ADR-0023 (data types and data sources), ADR-0007 (extensions), ADR-0030 (hosts only from settings). From the M4 plan: the owner's BR (by the playbook, as its first test) and BU (input only; SBS-1/BaseStation over TCP 30003).
- **Built against SDK 1.2.0 from `main`** (`sdkVersion` `^1.2.0`; the PDA's recommendation): the plugin needs nothing from SDK 1.3.0, and `main` has the template's transport pattern. It runs unchanged on 1.3.0, whose layer lock lets a server part's changes pass (ADR-0042 point 5). So its branches start from `main` and merge there, independent of `integration/sdk-v1.3`.

## 1. Purpose

Shows **aircraft from ADS-B** on the map: it reads the SBS-1 (BaseStation) text stream that an ADS-B decoder such as dump1090 serves on TCP port 30003, and keeps one symbol per aircraft, at its last position, with its callsign, track and ground speed. **Input only** (BU): it sends nothing. Server part only, no web part: an admin sets up its links in the Settings list, and the aircraft are ordinary objects that every other plugin shows.

Task T-097 builds it, by PCA-adsb.

## 2. Specification

- **SBS-1 / BaseStation "port 30003" format**, as dump1090 and its successors (readsb) emit it. There is no formal standard; the field list in `external/playback/README.md` ("SBS-1 fields") is this brief's reference, with the notes below.
- **A line:** 22 comma-separated fields, `MSG,<type>,<session>,<aircraft id>,<hex>,<flight id>,<date generated>,<time generated>,<date logged>,<time logged>,<callsign>,<altitude>,<ground speed>,<track>,<latitude>,<longitude>,<vertical rate>,<squawk>,<alert>,<emergency>,<spi>,<on ground>`. A field without a value is empty.
- **Message types used:**

  | `MSG` type | Carries (used) |
  |---|---|
  | 1 | callsign |
  | 2 | surface position: altitude, ground speed, track, latitude, longitude, on ground |
  | 3 | airborne position: altitude, latitude, longitude, alert, emergency, SPI, on ground |
  | 4 | airborne velocity: ground speed, track, vertical rate |
  | 5 | altitude, alert, SPI, on ground |
  | 6 | altitude, squawk, alert, emergency, SPI, on ground |

- **Ignored:** `MSG` types 7 and 8, and the other record kinds (`SEL`, `ID`, `AIR`, `STA`, `CLK`), counted by kind. The session, aircraft and flight ids and the four date and time fields are not used: their time has no zone.
- **Latitude comes before longitude** in the fields; the values are WGS84 decimal degrees.

## 3. Mapping

One object per aircraft (ICAO 24-bit address, the `hex` field). It is created at the aircraft's **first position** (`MSG,2` or `MSG,3`); callsign, velocity and squawk that arrive earlier are kept (section 4) and go with it.

| Source | Model field | Unit, conversion | Notes |
|---|---|---|---|
| hex (field 5) | `externalRef` `{system: "icao24", id: <six hex digits, upper case>}` | – | model rule 16; found again by it after a restart |
| latitude, longitude (fields 15, 16) | `geometry`: `Point` [lon, lat] | degrees | **longitude first: swapped from the fields' order**. Out of range (\|lat\| > 90, \|lon\| > 180) or one of them empty: no position from this line; its other values are still used (EM) |
| track (field 14) | `symbol.modifiers.direction` | degrees, 0 ≤ d < 360 (360 → 0) | |
| ground speed (field 13) | `symbol.modifiers.speed` | knots → m/s (× 0.514444) | |
| callsign (field 11) | `properties.name` and `symbol.modifiers` `uniqueDesignation` | trimmed | absent: the hex is the name |
| altitude (field 12) | `extensions.adsb.altitudeFt` and `symbol.modifiers` `altitudeDepth` as a flight level, `FL` and the hundreds of feet in three digits (`FL350`, `FL025`; below 0, `FL000`) | feet, as received | **barometric (pressure) altitude, not height above the ellipsoid**: never the position's altitude, which the model defines as HAE |
| vertical rate (field 17) | `extensions.adsb.verticalRateFpm` | feet per minute | |
| squawk (field 18) | `extensions.adsb.squawk` | four octal digits, as text | |
| emergency (field 20) | `extensions.adsb.emergency` | `true` when set | `0` false; `-1` or `1` true; empty: unknown, absent |
| on ground (field 22) | `extensions.adsb.onGround` | as emergency | |
| the time the plugin received the line | `time.observed` | server clock, UTC | |

- **Object:** `type` `core.symbol`, `dataType` **`adsb.aircraft`** (declared in the manifest, name "ADS-B aircraft"), `dataSource` the link's name.
- **Symbol:** APP-6D (`standard` `APP-6D`), symbol set 01 (air), entity **civilian fixed wing, 120100**, standard identity from the link's setting (section 5), status present. SBS-1 has no emitter category, so every aircraft has the same entity. The code is checked once in the browser: the symbol draws without the error frame.
- **Label:** the link's `label`, else `context.defaultLabel()`.
- **Extension `adsb`:** only the fields in the table. No declared fields.
- **Updates:** each line that changes something updates the object with the complete core content (model rule 5); a line that changes nothing (the same values) sends nothing.
- **How objects end:** by expiry, through the data type's defaults in the manifest, which an admin changes per data type (ADR-0023 point 7): `expiresAfterSeconds` 60 (the playback's slice has positions every few seconds to every 30 s), `fadeWhenExpired` true, `removeAfterExpirySeconds` 300. ECore removes them; the plugin never deletes.
- **One aircraft, two links:** the first link that creates it keeps it, in its layer and with its data source; the other link's positions update it (`externalRef` is unique per system), as `cot` does (its function 5).

## 4. Transport

- **Mode** (playbook, section 1): `tcp-client` with `direction` `in` only, to a decoder's port 30003 (BU). No `udp`, no `tcp-server`, no `out` or `both`.
- **Framing:** lines (`LineFramer`), ending in LF or CR LF. **Largest frame: 256 bytes** (`LinkWorker.MAX_FRAME_BYTES`; a full line is about 120). Longer: dropped.
- **Checks, in the parser** (each refusal counted by its reason, section 6). SBS-1 has no checksum, so the fields are checked:
  - 22 fields (a line with more or fewer: dropped);
  - the hex: six hex digits (a `~` prefix, used for non-ICAO addresses, is dropped as `not icao`);
  - each number used parses: one that does not drops the line as `malformed`;
  - each value lies in its range: latitude and longitude as in section 3; altitude −2 000 to 100 000 ft; ground speed 0 to 2 000 kt; track 0 to 360; vertical rate ±50 000 ft/min; squawk four digits 0 to 7. **A value out of its range is left out, and the rest of the line is used** (owner, 2026-10-31: EM), counted as `value out of range` (`task.count`; not a drop). A latitude or longitude out of range leaves out both: the line then has no position.
- **State across frames, in the worker, per link:** what each aircraft last sent (callsign, altitude, velocity, squawk, flags), by hex, so that a position line gets the callsign of an earlier `MSG,1`. At most 10 000 aircraft, each forgotten 5 minutes after its last line; the oldest goes first when full.
- **Writes:** at most one change request per aircraft in flight; a newer state replaces one that waits (the latest wins).

## 5. Links and settings

The `links` setting, from `Link`'s schema in the template:

| Setting | Default | Notes |
|---|---|---|
| `links[].name` | – | the data source of what it receives |
| `links[].mode` | `tcp-client` | `tcp-client` only (an enum of one) |
| `links[].direction` | `in` | `in` only (an enum of one) |
| `links[].host`, `links[].port` | –, `30003` | where the decoder serves SBS-1 |
| `links[].idleSeconds` | 60 | reconnect when nothing came for this long; 0 never |
| `links[].targetLayer` | absent: a new layer named like the link | the layer picker (`"x-emc2": {"kind": "layer"}`), as `cot`'s |
| `links[].label` | the server's default label | the layer's and the aircraft's label |
| `links[].standardIdentity` | `unknown` | the SIDC's standard identity for every aircraft of the link (open question 1, decided: EJ) |
| `links[].enabled` | `true` | |

- **The manifest:** `connections` with the kind `tcp-client`, `direction` `in`, `"settings": "/links"`, and the reason; `internet` with `hosts: []` (CR-0022), since an admin may point a link at a decoder on the internet.
- Only users with `settings.admin` change settings (ADR-0036 point 4). Changes apply at once: `LinkWorker` starts and stops tasks, and the worker follows a changed target layer, label or identity for the aircraft it writes next.

## 6. Status and counters

- **Status per link** (playbook, work package 4): name, where (`Link.where()`), state, and per minute the lines received and the aircraft updated. Up to 512 characters in all; `OK` when every enabled link runs, else `DEGRADED`.
- **Drop reasons** (`task.count("dropped: <reason>", 1)`): `too long`, `malformed` (field count, a number that does not parse), `not icao`. And `ignored: <kind>` for `MSG,7`, `MSG,8` and the other record kinds, and `no position` for a position line without a valid one.
- **Values left out** (`task.count`, not drops): `value out of range` (EM).
- **Per link** (`ref.count`): `aircraft created`, `aircraft updated`, `aircraft waiting` (known without a position yet), `aircraft forgotten`.

## 7. Reference data

The ESA's playback (`external/playback/README.md`; T-095, approved by the owner, 2026-10-30), dataset `adsb` on `127.0.0.1:30003`: one hour of aircraft over Denmark, the Öresund and Skåne (longitude 10 to 14, latitude 54.5 to 57.5), `MSG,1`, `2`, `3`, `4` and `6`, in real time; `--speed 10` plays it ten times faster.

- **What the live check expects:** aircraft created and moving; **every position inside the box** (a swapped latitude and longitude would put them at longitude 54 to 58, outside it); callsigns on most aircraft; few drops, each explained.
- **No line of the recording goes into the repository** (the sheet: the slice is ODbL and stays on the ESA's computer). The replay test (work package 5) uses lines written for the test, in the same format.

## 8. Acceptance criteria

1. **Lines:** a valid `MSG,3` gives one record; 21 or 23 fields, `malformed`; 257 bytes, `too long`; a hex `~4CA2D6`, `not icao`; a ground speed `fast`, `malformed`.
2. **Position:** `MSG,3` with latitude 55.6181 and longitude 12.6561 (latitude ≠ longitude) creates the aircraft at [12.6561, 55.6181]; an empty latitude creates nothing and counts `no position`. **Out of range (EM):** `MSG,3` with latitude 95 and altitude 35 000 gives no position but keeps the altitude for the aircraft, and counts `value out of range` and `no position`; `MSG,4` with track 400 and ground speed 450 keeps the speed and leaves the track as it was; neither line counts as dropped.
3. **Callsign before position:** `MSG,1` with `SAS1234 ` then `MSG,3` for the same hex creates one aircraft named `SAS1234`, with that `uniqueDesignation`; without an `MSG,1` the name is the hex.
4. **Velocity:** `MSG,4` with ground speed 450 and track 270 gives `speed` 231.5 m/s (± 0.1) and `direction` 270; track 360 is 0.
5. **Altitude:** 35 000 ft gives `altitudeFt` 35 000 and `altitudeDepth` `FL350`; 2 500 ft gives `FL025`; −200 ft gives `FL000`; the position has no altitude.
6. **Flags and squawk:** `MSG,6` with squawk 7700 and emergency `-1` sets `squawk` `7700` and `emergency` `true`; `0` sets `false`; empty leaves it absent.
7. **Identity and restart:** the aircraft's `externalRef` is `{icao24, 4CA2D6}` (upper case, also from `4ca2d6`); after a restart its next position updates the same object, found by `externalRef`.
8. **Data type and expiry:** objects have `dataType` `adsb.aircraft` and the link's name as `dataSource`; the manifest declares the type with the defaults of section 3.
9. **Ignored kinds:** `MSG,7`, `MSG,8`, `SEL`, `ID`, `AIR`, `STA` and `CLK` lines create nothing and are counted by kind.
10. **Links (the playbook's work package 3):** a link added, changed and removed at runtime; "New layer" makes one layer, kept after a restart; the link's label on the layer and the aircraft.
11. **TCP:** with a real socket on loopback, lines split across reads give whole records; the link reconnects after `idleSeconds` without data.
12. **Coalescing and no-change:** 50 lines for one aircraft while its update is in flight end as at most two change requests; a line equal to the last state sends nothing.
13. **Forgetting:** an aircraft with no line for 5 minutes is forgotten by the worker (its callsign is gone for a new position), and its object expires by the data type.
14. **Status:** each link state shows in the status, and each drop reason of section 6 has a counter test.
15. **Live check** (work package 5, recorded in the handover): the `adsb` dataset for at least ten minutes (or one round at `--speed 10`): lines, aircraft, drops by reason, and every position inside the box.

## 9. Out of scope

- Sending (output), the Beast and raw Mode S formats, and decoding Mode S or ADS-B messages ourselves.
- Aircraft types and registrations (no database lookups), emitter categories, and alerting on emergency squawks.
- The aircraft's tracks (past positions), and altitude as the position's height.
- MLAT and TIS-B data as such: they arrive as ordinary lines, and are read as such when their hex is an ICAO address.

## 10. M5: the field set

Built against SDK 1.4.0 part 3 (`sdk-v1.md`, "SDK 1.4.0", part 3).

1. **The field set `adsb.aircraft`** (ADR-0050 points 1 and 4; T-132): the manifest declares the extension's keys as fields, all editable by others and without `dataTypes`, and groups them in `{ "id": "aircraft", "label": "ADS-B aircraft", "fields": [...] }`:

   | Field | Type |
   |---|---|
   | `squawk` | text, at most 4 |
   | `altitudeFt` | integer, unit `ft` (feet, as ADS-B gives them; not SI, on purpose, as section 3 stores it) |
   | `verticalRateFpm` | integer, unit `ft/min` |
   | `emergency` | boolean |
   | `onGround` | boolean |

   - **The values stay where section 3 puts them,** so the aircraft stored before show them at once.
   - **Every aircraft carries the set from its create:** `writer.fieldSet("adsb.aircraft")` (the `ObjectWriter`, T-147).
   - No vessel or other symbol change: aircraft stay APP-6D (section 3).

**Criteria (M5),** continuing section 8:

16. **The set:** the manifest declares `adsb.aircraft` and its fields; every aircraft carries `fieldSets: ['adsb.aircraft']` from its create, with section 3's values as the set's fields (an aircraft at 12.6561° E, 55.6181° N; latitude ≠ longitude).
17. **In the browser:** "Symbol properties" for an aircraft shows the group "ADS-B aircraft" with its squawk and altitude.

## 11. M6: the fields, the set and the data type

Built against SDK 1.5.0 part 1 (`sdk-v1.md`, "SDK 1.5.0"; CR-0038), `sdkVersion` `^1.5.0` (SDK 1.5.0 since part 1, owner NP A). Where this section differs from section 10, it wins.

1. **Section 10 is built in M6** (CR-0038 point 10): the manifest declares the five fields and the set `adsb.aircraft` as section 10 has them. The values stay where section 3 puts them, so the aircraft stored before show them at once, editors show them, and outputs can name them.
2. **The data type names its set** (CR-0038 points 1 and 3; T-165): the manifest's `adsb.aircraft` gains `"fieldSets": ["aircraft"]` (the data type and the set have the same full id, `adsb.aircraft`, in two lists; section 10 chose the name). The object store adds the set to every object created with the data type, and to one whose data type changes to it (model rule 21). `writer.fieldSet("adsb.aircraft")` (section 10) may stay; the store adds it only once.
3. **Expiry** (point 9; the owner's Q3): `adsb` (section 3) keeps `time.observed` on every object, so its tracks fade and go by the data type as before. A symbol a user places by hand with this data type has none, and no longer expires by it (ECore's `Removal`).

4. **A moved aircraft stays where the user put it** (T-155; SDK 1.5.0 part 5, CR-0039 points 10 and 11; ADR-0053 point 8; owner, Q1 A). A user may move a received object into another layer of the workspace ("Move to layer…", ADR-0053); it stays there. The `ObjectWriter` does it from SDK 1.5.0 part 5: an update is built with the stored object's `layerId`, which the plugin's `Build` passes on unchanged, and the link's target layer is only where new objects appear; after a lost plugin document it adopts only a View layer with the link's layer name. A copy ("Copy to layer…") has no external identity (ADR-0053 point 3), so the plugin never updates it: it stays as copied, and the original goes on.


**Criteria (M6),** continuing section 10 (whose criteria 16 and 17 are built with item 1):

18. **The data type's set:** the manifest's `adsb.aircraft` names `aircraft` and validates against the 1.5.0 schema; the test kit's context built from it lists the data type with `fieldSets` `['adsb.aircraft']`; an aircraft created through the fake store carries the set once, with section 3's values as its fields.

19. **A moved aircraft stays** (M6, T-155): through the test kit, a aircraft a user moved into another layer (`applyAs`, an update with a new `layerId`) is updated there by the next report, while a new one goes to the link's layer; a copy of it, a create without `externalRef`, is not updated.


## Open questions for the owner

1. **The aircraft's standard identity:** ADS-B does not say whether an aircraft is friend or foe. **Decided by the owner (2026-10-31, EJ), as recommended: a link setting, `standardIdentity`, with the default `unknown`** (section 5), as for `ais`, so that an admin sets `neutral` for civil traffic.
