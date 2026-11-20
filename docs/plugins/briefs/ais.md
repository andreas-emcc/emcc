# Brief: ais

- Status: **Draft (2026-10-31), for the owner's approval** · Milestone: M4 · Task: T-094 (brief), T-096 (plugin) · Agent: PCA-ais (new)
- **Updated 2026-10-31 with the owner's EM** (from PCA-adsb's first round, written here too): a value out of its range is left out, not the message (section 3, section 6, criterion 4). Decided by the owner, so approved.
- **Updated 2026-11-06 for M5 (T-140, T-139, T-132; CR-0030 part 3, ADR-0047 point 7, ADR-0050): section 10.** The symbol type per link (vessel symbols by default for new links, GL) and the field set `ais.ship`. Built against SDK 1.4.0 part 3 (`^1.4.0`). **Approved by the owner (2026-11-06, IB).**
- **Updated 2026-11-10 for M6 (T-165; CR-0038, SDK 1.5.0 part 1): section 11, criterion 20.** The data type `ais.vessel` names the set `ais.ship`, so a symbol placed by hand as an AIS vessel shows "AIS ship" at once and no longer fades. **Approved by the owner (NQ A, 2026-11-10)**; with Q31 A (NO A: a data type's sets go on symbols only) and Q32 A (NP A: SDK 1.5.0 from part 1).
- **Updated 2026-11-11 for M6 (T-155; CR-0039 points 10 and 11, approved by the owner, OB A; SDK 1.5.0 part 5): section 11's item 3 and criterion 21.** A moved track stays where the user put it (ADR-0053 point 8). **Approved by the owner (2026-11-11, PR A).**
- **Built by the playbook** `docs/plugins/in-out/playbook.md` (v1), work packages 1 to 5. This brief has the playbook's nine sections (its section 4); each work package names the sections it reads.
- Read also: ADR-0036 (connection tasks), ADR-0037 (links), ADR-0023 (data types and data sources), ADR-0007 (extensions), ADR-0030 (hosts only from settings). From the M4 plan: the owner's BR (by the playbook, as its first test) and BU (input only; NMEA 0183 AIVDM over UDP or TCP).
- **Built against SDK 1.2.0 from `main`** (`sdkVersion` `^1.2.0`; the PDA's recommendation): the plugin needs nothing from SDK 1.3.0, and `main` has the template's transport pattern. It runs unchanged on 1.3.0, whose layer lock lets a server part's changes pass (ADR-0042 point 5). So its branches start from `main` and merge there, independent of `integration/sdk-v1.3`.

## 1. Purpose

Shows **ships from AIS** on the map: it receives AIS messages as NMEA 0183 `!AIVDM` sentences from a receiver or a feed, and keeps one symbol per ship, at its last position, with its name, course and speed. **Input only** (BU): it sends nothing. Server part only, no web part: an admin sets up its links in the Settings list, and the ships are ordinary objects that every other plugin shows.

Task T-096 builds it, by PCA-ais.

## 2. Specification

- **AIS messages:** ITU-R M.1371-5, Annex 8 ("AIS messages"). The free, complete reference to read is **"AIVDM/AIVDO protocol decoding"** by Eric S. Raymond (gpsd project, `https://gpsd.gitlab.io/gpsd/AIVDM.html`): the sentence layout, the six-bit payload armouring, and a bit table per message type. Read only the parts below.
- **Sentences:** NMEA 0183 (IEC 61162-1) encapsulation, as that document describes it ("AIVDM/AIVDO Sentence Layer"): `!AIVDM,<count>,<number>,<sequence id>,<channel>,<payload>,<fill bits>*<checksum>`.
  - **Talkers:** any two-letter talker with `VDM` (other ships) or `VDO` (the receiver's own ship), e.g. `!AIVDM`, `!AIVDO`, `!BSVDM`, `!ABVDM`. All are read the same way.
  - **A tag block** before the `!` (`\…\`, IEC 61162-450) is skipped; its contents are ignored.
- **Message types used** (sections of the gpsd document):

  | Type | Name | Used for |
  |---|---|---|
  | 1, 2, 3 | Position Report Class A | position, course, speed, heading, navigational status |
  | 18 | Standard Class B CS Position Report | position, course, speed, heading |
  | 19 | Extended Class B CS Position Report | position, course, speed, heading, name, ship type, size |
  | 5 | Static and Voyage Related Data | name, call sign, IMO number, ship type, size, draught, destination |
  | 24 | Static Data Report (parts A and B) | A: name; B: ship type, call sign, size |

- **Ignored:** every other type (base stations, aids to navigation, SAR aircraft, binary and safety messages, and the rest). Each is counted by its type, never an error.

## 3. Mapping

One object per ship (MMSI). It is created at the ship's **first position**; static data that arrives earlier is kept (section 4) and goes with it.

| Source | Model field | Unit, conversion | Notes |
|---|---|---|---|
| MMSI (all types, 30 bits) | `externalRef` `{system: "ais", id: <MMSI as 9 digits, leading zeros kept>}` | – | model rule 16; the object is found again by it after a restart |
| longitude, latitude (1, 2, 3, 18, 19) | `geometry`: `Point` [lon, lat] | 1/600 000 degree → degrees | **longitude first**. Not available: lon 181, lat 91; out of range: \|lon\| > 180, \|lat\| > 90. Either: no position from this message |
| course over ground (COG) | `symbol.modifiers.direction` | 0.1° → degrees, 0 ≤ d < 360 | 3600: not available → absent |
| speed over ground (SOG) | `symbol.modifiers.speed` | 0.1 kn → m/s (× 0.514444) | 1023: not available → absent |
| true heading | `extensions.ais.heading` | degrees, 0 to 359 | 511: not available → absent |
| navigational status (1, 2, 3) | `extensions.ais.navStatus` | the code, 0 to 15 | 15: not defined → absent |
| name (5, 19, 24A) | `properties.name` and `symbol.modifiers` `uniqueDesignation` | six-bit text, trailing `@` and spaces removed | absent or empty: the MMSI is the name |
| call sign (5, 24B) | `extensions.ais.callSign` | six-bit text, trimmed | |
| IMO number (5) | `extensions.ais.imo` | integer | 0: not available → absent |
| ship type (5, 19, 24B) | `symbol.sidc` (the entity, below) and `extensions.ais.shipType` | the code, 0 to 99 | |
| dimensions (5, 19, 24B) | `extensions.ais.length`, `extensions.ais.beam` | metres: to bow + to stern, to port + to starboard | 0: not available → absent |
| draught (5) | `extensions.ais.draught` | 0.1 m → metres | 0: not available → absent |
| destination (5) | `extensions.ais.destination` | six-bit text, trimmed | |
| AIS class | `extensions.ais.class` | `"A"` (1, 2, 3, 5), `"B"` (18, 19, 24) | |
| the time the plugin received the sentence | `time.observed` | server clock, UTC | AIS carries only the second of the minute; it is not used |

- **Values out of range** (owner, 2026-10-31: EM): a value outside the range the table gives (e.g. COG 3 601 to 4 095, heading 360 to 510, a longitude beyond ±180) is left out like a value that is not available, and the rest of the message is used; counted as `value out of range` (`task.count`; not a drop). A longitude or latitude out of range leaves out both: the message then has no position. Only the sentence checks of section 4 drop a whole sentence.
- **Object:** `type` `core.symbol`, `dataType` **`ais.vessel`** (declared in the manifest, name "AIS vessel"), `dataSource` the link's name.
- **Symbol:** APP-6D (`standard` `APP-6D`), symbol set 30 (sea surface), standard identity from the link's setting (section 5), status present. The entity by ship type:

  | Ship type | Entity | APP-6D code |
  |---|---|---|
  | 30 | Fishing vessel | 140200 |
  | 60 to 69 | Passenger ship | 140110 |
  | 70 to 79 | Merchant ship | 140100 |
  | 80 to 89 | Oiler/tanker | 140109 |
  | any other, or not known yet | Civilian (generic) | 140000 |

  Each code is checked once in the browser: the symbol draws without the error frame.
- **Label:** the link's `label`, else `context.defaultLabel()`.
- **Extension `ais`:** only the fields in the table. Nothing else of the message is kept. No declared fields.
- **Updates:** a position message updates `geometry`, the modifiers and `time.observed`; a static message updates the name and the extension. Each update carries the complete core content (model rule 5).
- **How objects end:** by expiry, through the data type's defaults in the manifest, which an admin changes per data type (ADR-0023 point 7): `expiresAfterSeconds` 600 (a Class B ship at anchor reports every 3 minutes), `fadeWhenExpired` true, `removeAfterExpirySeconds` 1 800. ECore removes them; the plugin never deletes.
- **One ship, two links:** the first link that creates it keeps it, in its layer and with its data source; the other link's positions update it (`externalRef` is unique per system), as `cot` does (its function 5).

## 4. Transport

- **Modes** (playbook, section 1): `udp` with `direction` `in` (a receiver that sends datagrams, one or more sentences each) and `tcp-client` with `direction` `in` (a receiver or feed that serves a TCP stream, such as the playback). No `tcp-server`, no `out` or `both`.
- **Framing:** lines (`LineFramer`), ending in LF or CR LF; in UDP each line of a datagram is a frame. **Largest frame: 512 bytes** (`LinkWorker.MAX_FRAME_BYTES`): NMEA 0183 allows 82 characters, a tag block adds more. Longer: dropped.
- **Checks, in the parser** (each refusal counted by its reason, section 6):
  - the checksum: two hex digits after `*`, the XOR of every character between `!` and `*`. Missing or wrong: dropped;
  - seven fields, `count` 1 to 9, `number` 1 to `count`, payload characters in the six-bit set (`0` to `W`, `` ` `` to `w`), `fill bits` 0 to 5;
  - a message type with fewer bits than the fields this brief uses (type 5 is often 420 bits instead of 424: fine, if it reaches the destination's end, else the destination is absent).
- **State across frames:**
  - **Multi-sentence messages** (`count` > 1; type 5 and some 19s), **in the task, per connection** (the playbook's work package 1, step 3): fragments are joined by `sequence id` and `channel`, in order; at most 16 messages waiting; a message not complete 5 s after its first fragment, a fragment out of order, or a 17th waiting message drops the oldest, counted as `fragment lost`.
  - **Static data before the first position, in the worker, per link:** name, call sign, type, size and the rest, by MMSI; at most 50 000 ships, each forgotten an hour after its last message; the oldest goes first when full.
- **Writes:** at most one change request per ship in flight; a newer record replaces one that waits (the latest position wins). A busy feed (the playback's `ais-zenodo` sends 20 sentences a second) so never queues more than one request per ship.

## 5. Links and settings

The `links` setting, from `Link`'s schema in the template:

| Setting | Default | Notes |
|---|---|---|
| `links[].name` | – | the data source of what it receives |
| `links[].mode` | `tcp-client` | `udp` or `tcp-client` |
| `links[].direction` | `in` | `in` only (an enum of one, so that the schema says so) |
| `links[].host`, `links[].port` | – | `tcp-client`: where to connect |
| `links[].listen` | address `127.0.0.1` | `udp`: where to receive; another address only when an admin chooses it |
| `links[].idleSeconds` | 300 | `tcp-client`: reconnect when nothing came for this long; 0 never |
| `links[].targetLayer` | absent: a new layer named like the link | the layer picker (`"x-emc2": {"kind": "layer"}`), as `cot`'s |
| `links[].label` | the server's default label | the layer's and the ships' label |
| `links[].standardIdentity` | `unknown` | the SIDC's standard identity for every ship of the link: `unknown`, `neutral`, `friend`, `hostile` and the others of APP-6D (open question 1, decided: EJ) |
| `links[].enabled` | `true` | |

- **The manifest:** `connections` with the kinds `udp` and `tcp-client`, `direction` `in`, `"settings": "/links"`, and the reason; `internet` with `hosts: []` (CR-0022), since an admin may point a link at an AIS feed on the internet.
- Only users with `settings.admin` change settings (ADR-0036 point 4). Changes apply at once: `LinkWorker` starts and stops tasks, and the worker follows a changed target layer, label or identity for the ships it writes next.

## 6. Status and counters

- **Status per link** (playbook, work package 4): name, where (`Link.where()`), state, and per minute the sentences received and the ships updated. Up to 512 characters in all; `OK` when every enabled link runs, else `DEGRADED`.
- **Drop reasons** (`task.count("dropped: <reason>", 1)`): `too long`, `no checksum`, `checksum`, `malformed`, `fragment lost`, `too short`. And `ignored: type <n>` for the types of section 2 that are not used, and `no position` for a position message without a valid one.
- **Values left out** (`task.count`, not drops): `value out of range` (EM).
- **Per link** (`ref.count`): `ships created`, `ships updated`, `static data kept` (ships waiting for their first position), `static data forgotten`.

## 7. Reference data

The ESA's playback (`external/playback/README.md`; T-095, approved by the owner source by source, 2026-10-30), on loopback:

| Dataset | Port | What the live check expects |
|---|---|---|
| `ais-gpsd` | 8111 | 123 sentences every 12 s, many message types: the ignored types counted by type; the sentences with a wrong checksum or a trailing tag (8) dropped as `checksum` or `malformed`, never more |
| `ais-zenodo` | 8112 | every checksum valid: no `checksum` drops; ships created and moving |
| `ais-vernon` | 8110 | real time, one station on the Seine at Vernon: 211 of 56 211 sentences (0.4 %) with a wrong checksum; ships near 1.48° E, 49.09° N (a swapped position would lie in the Indian Ocean) |

- UDP: the playback sends a dataset as datagrams with `start.mjs --udp ais-vernon=127.0.0.1:<port>` (a port from `external/README.md`'s list).
- **No frame of the recordings goes into the repository** (the sheet: keep the data out of emc2's repository). The replay test (work package 5) uses frames written for the test: a small six-bit encoder in the tests, with the checksum, is enough.

## 8. Acceptance criteria

1. **Sentence:** a valid single-sentence `!AIVDM` type 1 gives one record; the same with one character of the payload changed is dropped as `checksum`; without `*hh`, `no checksum`; 513 bytes, `too long`; nine fields, `malformed`.
2. **Talkers and tag blocks:** `!AIVDO` and `!BSVDM` read as `!AIVDM`; a leading `\s:station,c:1700000000*hh\` is skipped.
3. **Position (1, 2, 3, 18, 19):** a ship at 18.0723° E, 59.3311° N (latitude ≠ longitude) is created at [18.0723, 59.3311]; lon 181 or lat 91 creates nothing and counts `no position`.
4. **Course and speed:** COG 2 705 is `direction` 270.5; SOG 100 is `speed` 5.144 m/s (± 0.001); 3600 and 1023 leave them absent; heading 511 is absent. **Out of range (EM):** COG 3 700 leaves `direction` absent and keeps the position and speed of the same message, counting `value out of range`; heading 400 leaves `heading` absent.
5. **Multi-sentence type 5:** two fragments in order give the name, call sign, IMO, type, size, draught and destination; the second fragment alone, or the first without the second for 5 s, is dropped as `fragment lost`; fragments of two messages with different sequence ids interleaved are both joined.
6. **Static before position:** a type 5 for a ship with no position creates nothing; its first position creates the ship with the name and the SIDC of its type; 24A then 24B give name, then type and call sign.
7. **SIDC by ship type:** types 30, 65, 71, 84 and 0 give the entities of section 3's table, with the link's standard identity; every code draws in the browser without the error frame.
8. **Identity and restart:** the ship's `externalRef` is `{ais, <MMSI>}`, with leading zeros kept (`002190047`); after a restart its next position updates the same object, found by `externalRef`.
9. **Data type and expiry:** objects have `dataType` `ais.vessel` and the link's name as `dataSource`; the manifest declares the type with the defaults of section 3.
10. **Ignored types:** types 4, 8 and 21 create nothing and are counted by type.
11. **Links (the playbook's work package 3):** a link added, changed and removed at runtime; "New layer" makes one layer, kept after a restart; the link's label on the layer and the ships.
12. **UDP and TCP:** with real sockets on loopback, a datagram holding two sentences gives two records; a TCP link reconnects after `idleSeconds` without data.
13. **Coalescing:** 50 positions of one ship sent while its update is in flight end as at most two change requests, the last with the 50th position.
14. **Status:** each link state shows in the status, and each drop reason of section 6 has a counter test.
15. **Live check** (work package 5, recorded in the handover): `ais-gpsd` and `ais-zenodo` for a few minutes each, and `ais-vernon` for at least ten: sentences, ships, drops by reason, against section 7.

## 9. Out of scope

- Sending AIS (output), and AIS over serial lines.
- Message types other than those of section 2, among them aids to navigation (21), base stations (4) and safety messages.
- The ships' tracks (past positions), ETA, rate of turn, and alerting.
- Checking a ship's data against registers (IMO, MMSI country).

## 10. M5: vessel symbols and the field set

Built against SDK 1.4.0 part 3 (`sdk-v1.md`, "SDK 1.4.0", part 3). Where this section differs from sections 3 and 5, it wins.

1. **The symbol type per link** (T-140; ADR-0047 point 7; owner, GL): a link setting `links[].symbolType`, `vessel` or `app6`, described in the schema.
   - **New links get `vessel`:** the schema's default, which the Settings form fills in for a link an admin adds.
   - **Existing links keep APP-6:** a stored link without the key is read as `app6` by the plugin, until the admin changes it. The shell's Settings form fills a schema default only into a new list item, so stored links keep no `symbolType` (the ACA's check of the shell's form). Since the form's hint reads "Default: vessel", the schema's description of `symbolType` says "absent: APP-6, for links stored before M5" (the ACA's R2).
   - **`vessel`:** the ship's symbol is `{ standard: 'vessel', sidc: vesselSidc({ context: 0, identity, shipType }) }`, the identity from the link's `standardIdentity` (APP-6D's digit), the ship type 0 until a static message gives it. `direction`, `speed` and `uniqueDesignation` as section 3 has them.
   - **`app6`:** section 3's APP-6D symbol, as today.
   - **A change of the setting** applies to each ship at its next update, without reconnecting (the playbook's work package 3).
2. **The field set `ais.ship`** (ADR-0050 points 1 and 4; T-132): the manifest declares the extension's keys as fields, all editable by others and without `dataTypes`, and groups them in `{ "id": "ship", "label": "AIS ship", "fields": [...] }` (named apart from the data type `ais.vessel`):

   | Field | Type |
   |---|---|
   | `callSign` | text, at most 7 |
   | `imo` | integer, 1 to 999 999 999 |
   | `shipType` | integer, 0 to 99 |
   | `navStatus` | integer, 0 to 14, the navigational status code of ITU-R M.1371 (the README names them) |
   | `heading` | integer, unit `deg`, 0 to 359 |
   | `length`, `beam`, `draught` | number, unit `m`, 0 to 1 000 |
   | `destination` | text, at most 20 |
   | `class` | choice, `A` or `B` |

   - **The values stay where section 3 puts them,** so the ships stored before show them at once.
   - **Every ship carries the set from its create:** `writer.fieldSet("ais.ship")` (the `ObjectWriter`, T-147).
   - The set is for users and for the simulator's tracks sent out later in AIS; in M5 `ais` only receives.

**Criteria (M5),** continuing section 8:

16. **Vessel symbols:** on a link with `symbolType` `vessel` and `standardIdentity` `neutral`, a ship of type 71 at 18.0723° E, 59.3311° N (latitude ≠ longitude) has `{ standard: 'vessel', sidc: '0471' }`, with its direction and speed; before its static message, `0400`.
17. **APP-6 kept:** a stored link without `symbolType` keeps section 3's APP-6D symbols; changing the setting to `vessel` turns its ships at their next update, without a reconnect.
18. **The set:** the manifest declares `ais.ship` and its fields; every ship carries `fieldSets: ['ais.ship']` from its create, with section 3's values as the set's fields.
19. **In the browser:** the ships of a `vessel` link draw as hulls in their group colours (`symbology` function 12), and "Symbol properties" shows the group "AIS ship".

## 11. M6: the data type names its set

Built against SDK 1.5.0 part 1 (`sdk-v1.md`, "SDK 1.5.0"; CR-0038), `sdkVersion` `^1.5.0` (SDK 1.5.0 since part 1, owner NP A). Where this section differs from section 10, it wins.

1. **The data type names its set** (CR-0038 points 1 and 3; T-165): the manifest's `ais.vessel` gains `"fieldSets": ["ship"]`. The object store adds `ais.ship` to every object created with `ais.vessel`, and to one whose data type changes to it (model rule 21), so a symbol a user places by hand as an AIS vessel shows "AIS ship" at once. `writer.fieldSet("ais.ship")` (section 10) may stay; the store adds the set only once.
2. **Expiry** (point 9; the owner's Q3): `ais` (section 3) keeps `time.observed` on every object, so its tracks fade and go by the data type as before. A symbol a user places by hand with this data type has none, and no longer expires by it (ECore's `Removal`). This is the case CR-0038 was written for: such a symbol faded 10 minutes after its last edit before M6.

3. **A moved ship stays where the user put it** (T-155; SDK 1.5.0 part 5, CR-0039 points 10 and 11; ADR-0053 point 8; owner, Q1 A). A user may move a received object into another layer of the workspace ("Move to layer…", ADR-0053); it stays there. The `ObjectWriter` does it from SDK 1.5.0 part 5: an update is built with the stored object's `layerId`, which the plugin's `Build` passes on unchanged, and the link's target layer is only where new objects appear; after a lost plugin document it adopts only a View layer with the link's layer name. A copy ("Copy to layer…") has no external identity (ADR-0053 point 3), so the plugin never updates it: it stays as copied, and the original goes on.


**Criteria (M6),** continuing section 10:

20. **The data type's set:** the manifest's `ais.vessel` names `ship` and validates against the 1.5.0 schema; the test kit's context built from it lists `ais.vessel` with `fieldSets` `['ais.ship']`; a ship created through the fake store carries `ais.ship` once.

21. **A moved ship stays** (M6, T-155): through the test kit, a ship a user moved into another layer (`applyAs`, an update with a new `layerId`) is updated there by the next report, while a new one goes to the link's layer; a copy of it, a create without `externalRef`, is not updated.


## Open questions for the owner

1. **The ships' standard identity:** AIS does not say whether a ship is friend or foe. **Decided by the owner (2026-10-31, EJ), as recommended: a link setting, `standardIdentity`, with the default `unknown`** (section 5), so that an admin sets `neutral` for a civilian feed.
