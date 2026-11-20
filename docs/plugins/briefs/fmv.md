# Brief: fmv

- Status: **Approved by the owner (2026-11-14, VP A and VR A)**; its draft was merged as `4fed80e2` (VS A) · Milestone: M8 · Task: T-207 (brief), T-209 (plugin) · Agent: PCA-fmv (new; its browser-check port from the MCA)
- **The owner's decisions:**
  - VJ C (2026-11-14): FMV in M8, MPEG-2 too;
  - ADR-0057's points as the owner gave them on 2026-11-14: the APP-6 camera, the open arc, an endless `GET`, ECore's conversion, never converting H.265;
  - in the PDA's session, 2026-11-14: the camera symbol a **UAV with photographic reconnaissance** (A), the video in a **floating window** (A), and an MPEG-2 stream that **waits for a free conversion slot** (A).
  - **Assumptions F1 to F8** (end of this brief), the PDA's, **accepted by the owner** (VR A, 2026-11-14); the three answers above confirmed (VP A).
- **Updated 2026-11-15 after PCA-fmv's first build** (`integration/sdk-v1.8` `d723fb75`; the owner's WA on its departures):
  - **Accepted (WA A):** the arc's data type is `fmv.field-of-view` (the data model refuses `fmv.fieldOfView`), and a link's data source is its key, its name in lower case with other characters turned into hyphens (section 3).
  - **Not accepted (WA B):** a renamed link keeps its camera and its arc. It needs a stable link id: **CR-0047** (SDK 1.8.0 part F, approved by the owner 2026-11-15, WF A) gives `x-emc2` `item.id`, filled in by ECore. Sections 3 to 5 and criteria 10 and 11 key by it (F5, built by PCA-fmv).
  - **A rename keeps the data source (WW A, 2026-11-15):** a renamed link's objects keep the `dataSource` they were made with, since the data model fixes it at creation (rule 14); their names follow the new name. An arc made after the rename takes its camera's data source, so the pair keeps one; a camera made after it takes the new key. Criterion 10. (CR-0047's F5 said the data source changes too; WW A overrides it.) The link's id is CR-0047's part F (approved, WF A and WE A).
  - **The tags checked against the MISB texts** by the PDA: ST 0601.14 (1 November 2018) and ST 0102.12 (22 June 2017), the editions MISP-2019.1 names. They are the Internet Archive's copies of `gwg.nga.mil/misb/docs/standards/`, read in the PDA's scratchpad and never copied into git. Every tag, length and scale of section 2 and of PCA-fmv's build agrees with them. Section 2 now gives their exact formats and special values; the build needs no change (section 2, "Checked against the texts"; criterion 21).
- **Updated 2026-11-16 for M9 (D6u; ADR-0058 points 2, 5, 6; ADR-0059 points 3, 7, 8 with CR-0049 part A; CR-0048 points 4 and 5; part U, CR-0050): section 10, the output link, approved by the owner with assumptions O1 to O12 (2026-11-17, in the PDA's session; O5's 0 m accepted; the tile cache's keys under the prefix `wms-tile-cache.`).** A simulated camera's poses (`fmv.camera-pose`, which `fmv` declares) come in from `uav-simulation`, are rendered and muxed on compute tasks, encoded by ECore and sent out as STANAG 4609 over paced UDP. Sections 1 to 9, the input link, do not change.
- **Updated 2026-11-17 after PCA-fmv's F1 phase 2** (`pca-fmv/output-link` `04c53e18`): the output channel's link name is `out-<the link's id>` (10.2 point 5, criterion 23); `highestClassification` defaults to the server's default label's classification (ADR-0037 point 8; 10.2 point 4, criterion 26); an admin-set destination is a declared connection, and `internet` comes with F2's WMS fetch (10.2 point 8; owner AAA A).
- **Updated 2026-11-17 after PCA-fmv's F2** (`pca-fmv/wms-cache` `132892a6`; the owner's three answers in PCA-fmv's session): the WMS fetches within 2 km of where the camera looks; WMS 1.3.0 only; a kept tile of another server, layer or format is used and fetched again, and the cache survives a settings change; the tile size is not in the key; the index document `wms-cache-index` (10.5 point 17, criterion 33, O6).
- **Updated 2026-11-17 after PCA-fmv's part U build** (`pca-fmv/wms-cache` `fe64c96b`; the owner's answers in PCA-fmv's session, numbered by the MCA): **ABT A**, an encoder's failure (10.4 point 13; points 7 and 22 gain "Encoder failed, started again after 60 s"); **ABU A**, criterion 34's playing within 2 s of the first pose (the first datagram measured at 2.52 s) and criterion 35's busy share below 90 % (10.8) are known limits of M9 and move to M10.
- **Built by the playbook** `docs/plugins/in-out/playbook.md` (v3), work packages 1 to 5, input only in M8 (from M9 also the output links of section 10). It has the playbook's nine sections; section 6 also holds the web part (the panel and the window).
- **Read first:**
  - ADR-0057 (FMV in, and the stream channel; the ACA; accepted by the owner, VL A, as CR-0045 records; the ADR's own status line, still Proposed, is the ACA's to update);
  - spike S9 `spikes/s9-fmv/README.md`, with its `KlvDump.java` and relay `web/server.mjs`;
  - CR-0044 (SDK 1.8.0 part E: the stream channel, the conversion call, `FloatingWindow`, the `Video` icon; **approved by the owner as CR-0043's part E**, VQ A, 2026-11-14);
  - CR-0045 (ffmpeg in shipped code; **approved by the owner**, VN A, 2026-11-14, with Windows' own encoder `h264_mf`: MPEG-2 converts on Windows x64 in M8, and the Linux release chooses again).
- **Read also:** ADR-0036 (connection tasks), ADR-0037 (links), ADR-0051 (relations), ADR-0050 (field sets), ADR-0023 (data types), ADR-0030 (offline).
- **Built against SDK 1.8.0 with part E** (`sdkVersion` `^1.8.0`; from `integration/sdk-v1.8`).
  - **It waits for:** CR-0044's build (PDA, on `pda/sdk-1.8-partE`), and ECore's channel (CDA, T-208).
  - **MPEG-2 also waits for:** the MCA's ffmpeg build (CR-0045) and ECore's conversion service (CDA, T-211).
  - **Until then:** H.264 and the map objects can be built and tested with the test kit's `FakeStreams`.

## 1. Purpose

Shows **full motion video** (STANAG 4609) from a camera, usually on a UAV, and where that camera is and looks.
- **The link:** an admin adds an incoming UDP link in Settings › FMV.
- **On the map**, per stream:
  - **the camera:** an APP-6 symbol at the sensor's position;
  - **the field of view:** an open arc from the camera towards the frame centre.
- **The FMV panel** in View lists the streams. An icon at the end of a row opens the live video in a floating window.

**Input only in M8:** it sends nothing. **From M9** an output link sends a simulated camera's video (section 10). It has a server part (the links, the transport stream, KLV, the objects, the stream channel) and a web part (the panel and the window). Task T-209 builds it, by PCA-fmv.

## 2. Specification

- **The standards:**
  - **STANAG 4609 Ed. 5**, which adopts the **MISB Motion Imagery Standards Profile 2019.1** (MISP). Both are public documents in a local folder, read there and never copied.
  - **Class 1 motion imagery:** an MPEG-2 transport stream (ISO/IEC 13818-1) to **MISB ST 1402**.
  - **KLV** to SMPTE ST 336, with BER lengths.
  - **Metadata:** **MISB ST 0601** (the UAS Datalink Local Set) and **MISB ST 0102** (security metadata, embedded as ST 0601 tag 48).
  - **Where to read them:** the MISB documents are public in the NSG Standards Registry (`nsgreg.nga.mil`), and the Internet Archive keeps the editions below from `gwg.nga.mil/misb/docs/standards/` (`ST0601.14.pdf`, `ST0102.12.pdf`). Where a text and this brief differ, the text wins, and the PCA tells the PDA.
  - **Checked against the texts** (the PDA, 2026-11-15): **ST 0601.14** (section 8) and **ST 0102.12** (Table 2). The tables below are theirs.
- **The ST 0601 set:** its 16-byte key is `06 0E 2B 34 02 0B 01 01 0E 01 03 01 01 00 00 00` (ST 0601.14 section 6). It ends with **tag 1, the checksum** (section 8.1): the lower 16 bits of a sum over the set from the key's first byte up to and including the checksum's own length byte, each even-placed byte (the first, the third, ...) shifted 8 bits up, as its `bcc_16` example does (S9: every checksum in the sample checks). Tags are BER-OID and lengths BER (section 6).
- **Tags used**, as ST 0601.14 section 8 gives them (KLV format and length; the value in the units of the last column):

  | Tag | Name | Conversion |
  |---|---|---|
  | 2 | Precision Time Stamp | uint64, 8 bytes: µs since 1970-01-01T00:00:00Z **without leap seconds** (ST 0603), so not strictly UTC; read as an epoch count, as Java's `Instant` counts |
  | 3 | Mission ID | UTF-8, 1 to 127 bytes |
  | 5 | Platform Heading Angle | uint16, 2 bytes → × 360 / 65 535, 0 to 360° |
  | 10 | Platform Designation | UTF-8, 1 to 127 bytes |
  | 11 | Image Source Sensor | UTF-8, 1 to 127 bytes |
  | 13, 14 | Sensor Latitude, Longitude | int32, 4 bytes → × 180 / 4 294 967 294 (±90°) and × 360 / 4 294 967 294 (±180°); `0x80000000` "Reserved" |
  | 15 | Sensor True Altitude | uint16, 2 bytes → × 19 900 / 65 535 − 900, −900 to 19 000 m |
  | 16, 17 | Sensor Horizontal, Vertical Field of View | uint16, 2 bytes → × 180 / 65 535, 0 to 180° |
  | 18 | Sensor Relative Azimuth Angle | uint32, 4 bytes → × 360 / 4 294 967 295, 0 to 360°, **relative to the platform's longitudinal axis** as seen from above (so heading + tag 18 is the bearing; S9's sample wrote a true bearing, hence the frame centre first, section 3) |
  | 19 | Sensor Relative Elevation Angle | int32, 4 bytes → × 360 / 4 294 967 294, ±180°; `0x80000000` "Reserved" |
  | 21 | Slant Range | uint32, 4 bytes → × 5 000 000 / 4 294 967 295, 0 to 5 000 000 m |
  | 23, 24 | Frame Center Latitude, Longitude | int32, 4 bytes, as tags 13 and 14, on WGS84; `0x80000000` "N/A (Off-Earth)": no frame centre |
  | 25 | Frame Center Elevation | uint16, 2 bytes, as tag 15 |
  | 48 | Security Local Set | ST 0102, below |
  | 65 | UAS Datalink LS Version Number | uint8, 1 byte; every version is read the same way |

  A value the standard reserves (`0x80000000` above) is absent, as is a value of another length than the table's or out of its range (the playbook's EM); the latter two are counted, but `0x80000000` in tags 23 and 24 is a valid statement (no frame centre on the earth) and is not counted. The rest of the set is used. PCA-fmv's first build reads all of these as the texts say; it also takes a 2-byte tag 65 and ST 0102 tag 22 of 1 byte, which is lenient and harmless.
- **ST 0102 tags used:**
  - 1, the security classification: 1 UNCLASSIFIED, 2 RESTRICTED, 3 CONFIDENTIAL, 4 SECRET, 5 TOP SECRET;
  - 2, the coding method of the classifying country and the releasing instructions, uint8: 0x01 ISO-3166 two letter, 0x02 ISO-3166 three letter, 0x03 FIPS 10-4 two letter, 0x04 FIPS 10-4 four letter, 0x05 ISO-3166 numeric, 0x06 STANAG 1059 two letter, 0x07 STANAG 1059 three letter, 0x08 and 0x09 omitted values, 0x0A FIPS 10-4 mixed, 0x0B ISO 3166 mixed, 0x0C STANAG 1059 mixed, 0x0D to 0x0F GENC two letter, three letter and numeric, 0x10 GENC mixed (ST 0102.12 Table 2; **not** tag 12's list, whose numbers differ);
  - 3, the classifying country, ISO/IEC 646 text preceded by `//`, e.g. `//SWE`;
  - 6, releasing instructions;
  - 22, the version, uint16, 2 bytes (12 for ST 0102.12).

  In tag 48 the ST 0102 local set's items come without its own key (ST 0601.14 section 8.48).

  Only tag 1 sets the label (section 3). The others are kept in the extension.
- **Ignored:**
  - every other ST 0601 tag, including the corner offsets (26 to 33), VMTI (74) and other nested sets;
  - KLV sets with other keys;
  - ST 0603/0604 time stamps in the video;
  - audio;
  - every program but the first with video.

  Each is counted where section 6 says, never an error.

## 3. Mapping

**One stream per link** (ADR-0057 point 1): the first program in the PAT whose PMT has video. Per stream there are two objects, linked by a relation, both with the link's **key** as `dataSource`: its name in lower case, every other character than `a`–`z`, `0`–`9` and `-` turned into `-` (WA A). The key is taken when the camera is made, and the arc takes its camera's; a rename does not change it (rule 14, WW A).

- **The camera:**
  - **the object:** a `core.symbol`, data type **`fmv.camera`** ("FMV camera"), external identity `{fmv, <the link's id>/camera}`;
  - **where:** `geometry` is `Point` [tag 14, tag 13], **longitude first**. The altitude goes to `extensions.fmv.sensorAltitude`;
  - **the symbol:** the link's `cameraSymbol`, APP-6D, by default **`10030100001103002000`**: air, military unmanned aircraft (`110300`) with sector 1 modifier 20, "Photographic (Reconnaissance)" (owner, 2026-11-14, A). The standard identity is the link's `cameraIdentity`;
  - **modifiers:** `symbol.modifiers.direction` from tag 5; `uniqueDesignation` the name.
  - **A check:** the PCA checks that `10030100001103002000` draws through `symbology` and matches the APP-6D tables (mil-sym-ts's), and tells the PDA if modifier 20's name differs.
- **The field of view:**
  - **the object:** a `core.shape` `ArcBand`, data type **`fmv.field-of-view`** ("FMV field of view"; the data model's pattern refuses capitals, WA A), external identity `{fmv, <the link's id>/fov}`;
  - **its relation:** `{ kind: 'fmv.view', objectId: <the camera's id> }`.
  - **The centre:** the camera's position. **The inner radius:** 0.
  - **Direction and length** (ADR-0057 point 3; S9 result 2):
    - **with the frame centre** (tags 23 and 24): the geodesic bearing and ground distance from the sensor to it;
    - **without it:** (tag 5 + tag 18) mod 360° and the slant range (tag 21).
  - **Width:** tag 16. The start bearing is the centre bearing − tag 16 / 2, the end + tag 16 / 2, both taken modulo 360°. The arc runs clockwise from start to end, so a start greater than the end crosses north. A very narrow arc shows as a line in its direction (ADR-0057; the map view draws it).
  - **Its style** (owner: an open arc): `strokeColor` the link's `fovColour`, `strokeWidth` 2, `fillOpacity` 0.
  - **When it is not written:** without a direction, a length above 0, or tag 16, the field of view is not written and keeps its last state. Counted as `no field of view`.
- **The name** of both objects (`properties.name`): tag 10, else tag 3, else the link's name.
- **The relation kind `fmv.view`** ("FMV camera and view"): declared with a dotted 1 px line in `#FFD400` and `defaultOn` false. The line joins two objects at one place, so it shows nothing until a user turns it on.
- **The label** (ADR-0057 point 4; as `gmti`'s `P4`):
  - **the setting:** the link's `classification`:
    - `map` turns ST 0102 tag 1 (1 to 5) into the link policy's names through `classificationNames` (NATO's by default);
    - `link label` gives the link's label to everything.
  - **The fallback:** a set without ST 0102, or with a value the mapping cannot place, gets the link's label, counted as `unmapped classification`.
  - **Above the layer:** an object above the target layer's label is written with its own label, counted as `above layer label`.
  - **The stream's label:** each new label is also set on the stream with `StreamRef.label` (CR-0044).
- **Time** (`time.observed`), by the link's `time` setting:
  - `received` (the default) uses the server's clock when the set arrived;
  - `stream` uses tag 2.

  `received` is the default because replayed recordings carry old times (F4).
- **Writes:**
  - through the `ObjectWriter`, **at most twice a second per stream** (ADR-0057 point 3); within each 500 ms the newest set wins;
  - a set that changes nothing writes nothing;
  - the camera is written first, so that the field of view's relation names an object that exists.
- **When the metadata stops**, both objects keep their last state (ADR-0057 point 3), and the panel marks the stream **stale** after the link's `staleSeconds`.
- **How the objects end:**
  - both data types have no expiry by default (F2). An admin may set one in Settings › Data types;
  - **removing a link deletes its two objects** (F3);
  - stopping or disabling a link keeps them.
- **The extension `fmv`**, on the camera only, through the field set **`fmv.camera`** ("FMV camera", not editable by others; ADR-0050), so Symbol properties shows it read-only:
  - the link;
  - the mission and the platform designation;
  - the image source sensor;
  - the sensor's altitude (m), its vertical field of view and its relative azimuth and elevation (degrees);
  - the slant range (m);
  - the frame centre's latitude, longitude and elevation;
  - the video format;
  - the classifying country and the releasing instructions;
  - the ST 0601 version;
  - the time of the last set.

  The data type `fmv.camera` names the set (CR-0038), with `manual: false`, as does `fmv.field-of-view`.

## 4. Transport

- **Modes:**
  - UDP unicast, in a connection task, at `ListenAddress.from(link)` (loopback unless an admin names an address);
  - **UDP multicast**, joined on the interface an admin names (`ListenAddress.multicast`; without one the link stays stopped and says so, ADR-0036 R4).
- **Framing:**
  - **the datagram:** a whole number of 188-byte packets, each starting with `0x47`, up to 65 507 bytes. Usually 1 316 bytes (7 packets).
  - **Not a transport stream:** any other datagram is dropped whole, counted as `not transport stream`.
- **What the task reads** (ADR-0057 point 2):
  - **the tables:** the PAT and the PMT, which choose the program and its PIDs. A PMT with a new version chooses again.
  - **Video stream types:**
    - `0x1B` H.264 and `0x24` H.265 are played;
    - `0x02` MPEG-2 video is converted;
    - anything else (e.g. `0x21` JPEG 2000, `0x01` MPEG-1) is listed and mapped, but not played (ADR-0057 point 7).
  - **The KLV stream:** stream type `0x06` with a `KLVA` registration descriptor (asynchronous), or `0x15` (synchronous); the first such stream.
  - **Random access:** the video packets' random access indicator.
  - **The size** (for the panel): the width and height from an MPEG-2 sequence header or an H.264 sequence parameter set, when the task meets one (F6).
- **KLV:**
  - **The PES:** assembled from its packets, at most 64 KiB, else dropped (counted as `KLV too long`). A continuity counter gap drops the PES being assembled (`continuity gap`).
  - **The items:** they are walked by their BER lengths, and only the ST 0601 key is read.
  - **The checksum:** a wrong one drops the set (`checksum`).
- **The video**, from the first video PID (CR-0044 E1):
  - **Opening the stream:** the worker opens it when it learns the stream's format: `StreamSpec(<the stream's name>, "video/mp2t", "plugin.fmv.view", <the label>)`. **The stream's name** is the link's id (CR-0047: a lower-case UUID v7, which fits CR-0044's pattern). Until part F is built, it is the link's key, cut to 64 characters, as the first build has it. It hands the `StreamRef` to the task in a message.
  - **H.264 and H.265:** every datagram goes to `StreamRef.write(datagram, startPoint)` unchanged. `startPoint` is true when the datagram holds the start of a video payload unit with the random access indicator. The latest PAT and PMT packets are the stream's `header`. (S9: the sample sets the indicator on all 782 keyframes, so no video parsing is needed.)
  - **MPEG-2** (CR-0044 E2; ADR-0057 point 8): the worker starts `Conversions.start(ConversionSpec.mpeg2ToH264(ref), …)`. Every datagram then goes to `ConversionRef.write`, and the plugin writes nothing to the stream itself.
    - `Waiting` (owner, A): the panel says "Waiting for a conversion slot". The stream converts once a slot frees.
    - `Failed`: the panel says why. The worker starts the conversion again after a minute, while the link runs.
  - **A changed video format:** a new PMT that changes the video stream type closes the stream (and stops any conversion) and opens it again.
- **Limits:**
  - **the rate:** CR-0044's `MAX_RATE` per stream; a `DROPPED` write is counted (`stream dropped`);
  - **the task's state:** the tables, the PIDs, the KLV being assembled, the latest set and the time of the last write. It is dropped when the link stops.
- **Links change** without a reconnect when only the layer, the label, the symbol, the identity, the colour, the classification, the time or `staleSeconds` changed (the playbook's work package 3).

## 5. Links and settings

**Manifest:**
- `icon` `Video` (CR-0044 E4);
- `connections`: kinds `udp` and `multicast`, direction `in` (from M9 `both`, section 10.2), `settings` `/links`;
- the permission **`plugin.fmv.view`** ("Watch FMV");
- the two data types, the field set and the relation kind of section 3.

The plugin's settings:

| Setting | Default | Meaning |
|---|---|---|
| `links[].id` | filled in by ECore | the link's stable id (CR-0047, SDK 1.8.0 part F: `x-emc2` `item.id`); not shown in the form, never changed by a rename |
| `links[].name`, `links[].enabled` | "FMV link N"; `true` | as for every link (ADR-0037); the key from the name is a new camera's data source (WW A) |
| `links[].mode` | `udp` | `udp` or `multicast` |
| `links[].address`, `links[].port` | absent (loopback); required | `udp`: where to listen |
| `links[].group`, `links[].interface`, `links[].port` | –; –; required | `multicast`: the group, the interface an admin names, the port |
| `links[].targetLayer`, `links[].label` | required; the layer's | the layer for both objects, and the link's label |
| `links[].classification`, `links[].classificationNames` | `map`; NATO's | section 3 |
| `links[].cameraSymbol` | `10030100001103002000` | the camera's APP-6D SIDC |
| `links[].cameraIdentity` | `friend` | its standard identity (F1) |
| `links[].fovColour` | `#FFD400` | the arc's line (F5) |
| `links[].time` | `received` | `received` or `stream` (F4) |
| `links[].staleSeconds` | 10 | 2 to 300: after this long without a set, the panel says "Stale" |

**The form** (SDK 1.8.0 part D):
- `links` has `item` `{ name: "name", noun: "link", state: "enabled", id: "id", columns: ["name", "mode", "port"] }` (`id` from CR-0047);
- the item's groups:
  - Connection: `mode`, `address`, `group`, `interface`, `port`;
  - Picture: `targetLayer`, `cameraSymbol`, `cameraIdentity`, `fovColour`;
  - Classification: `label`, `classification`, `classificationNames`;
  - Advanced, folded: `time`, `staleSeconds`;
- `visibleWhen` on `mode` for `address`, `group` and `interface`;
- a hint on `cameraSymbol`: "A 20-digit APP-6D code".

## 6. Status, counters and the web part

**Status per link:**
- `Stopped`, `Listening` (no datagram yet), or `Receiving <format>` (e.g. "Receiving H.264");
- "No video in the stream", when the PMT has none;
- `Waiting for a conversion slot`;
- `No converter installed` (`Failed` `unavailable`);
- "Not playable: <format>".

**Counters** (`task.count`, per minute as the playbook says):
- datagrams and bytes;
- `not transport stream`;
- KLV sets read, `checksum`, `continuity gap`, `KLV too long`;
- `unmapped classification`, `above layer label`, `no field of view`;
- `stream dropped`, and conversion input dropped.

**The FMV panel** (ADR-0057 point 6): a `ControlPanel` "FMV" in View (`workspaces: ['core.view']`), with its icon.
- **The rows:** a `List` with one row per link that has received a stream:
  - the stream's name and the link's name;
  - the format ("H.264", "H.265", "MPEG-2 → H.264", or the other format's name);
  - the size, where known;
  - the bit rate over the last 5 s;
  - the age of the last set ("3 s ago");
  - a state chip: Live, Stale, Waiting, Not playable or Stopped.
- **Watch:** an icon button at the row's end ("Watch", the `Video` icon) opens the window.
  - Without `plugin.fmv.view` it is not shown (the server checks it too).
  - It is disabled when the format cannot be played.
- **Where the rows come from:** `GET /streams`, needing only a login. Its JSON gives per link: the name, the stream's name, the format, the size, the bit rate, the time of the last set, the state and the stream's label. The panel reads it every 2 s while it is shown.
- **An empty list** says "No FMV streams. An admin adds links in Settings › FMV."

**The video window** (CR-0044 E3; owner, A): a `FloatingWindow` titled with the stream's name, one per stream, several at once.
- **Its label:** a line at its top shows the stream's classification, from the panel's data, so the label is seen beside the picture.
- **The player:** **mpegts.js 1.8.2** (Apache-2.0; es6-promise 4.2.8 and events 3.3.0, MIT), pinned exactly and bundled with the web part (ADR-0030; listed in the third-party notices by the MCA).
  - It plays `streamUrl(ctx, <the stream's name>)` live, the name from the panel's JSON, with the stash buffer off and latency chasing on (S9: about 0.1 s ahead).
  - It hands over the KLV PES too, which the window does not use in M8.
- **H.265:** where `MediaSource.isTypeSupported` says no, the window shows "This browser cannot play H.265." instead of the player (ADR-0057 point 7).
- **When the response ends** (the link restarted, or the stream closed), the window tries again every 2 s while it is open, with its own browser timer:
  - `503`: "Too many viewers. Trying again.";
  - `403`: "You may not watch this stream.", with no more tries;
  - `404`: "The stream has stopped.", and it keeps trying.
- **Closing the window** stops the player and frees the viewer.
- **The footer:** the format, the size and the delay behind live.

## 7. Reference data

- **The replay:** the ESA's FMV replay (T-210) sends a transport stream file over UDP, paced by its PCR, as the GMTI replay does.
- **The file:** the public sample **`Day Flight.mpg`** (S9), kept outside the repository in a local folder. **It has no licence, so it never enters git or a release.**
- **What a live check expects of it:**
  - **the layout:** PMT on PID 480, H.264 on 481, KLV on 497 (`0x06`, `KLVA`);
  - **the sets:** 6 ST 0601 sets in 200 s, every checksum right;
  - **the field of view:** a horizontal field of view of about 0.37°, a slant range that matches the ground distance and height within 5 % in 5 of 6 sets, and tag 18 matching the bearing to the frame centre within 0.1°;
  - **the start:** a first frame within about 0.2 s of opening the window.
- **MPEG-2:** the ESA makes a 60 s MPEG-2 version of the sample with ffmpeg, as S9 part 2 did, kept beside it and also outside git.

## 8. Acceptance criteria

1. **Link and transport:** a `udp` link on a port receives the replay. A `multicast` link without an interface stays stopped and says so. A link may be added, changed and removed at runtime. A datagram that is not 188-byte packets is dropped and counted.
2. **Tables:** the first program with video is chosen. A PMT with a new version and another video type closes the stream and opens it again.
3. **KLV:** asynchronous (`KLVA`) and synchronous (`0x15`) KLV both read. A wrong checksum drops the set, counted. A continuity gap drops the PES being assembled. Unknown keys and tags are skipped.
4. **Tags:** each tag of section 2 converts as its table says, tested with a set where latitude ≠ longitude. An error indicator or a value out of range leaves out that value only.
5. **The camera:** a `core.symbol` `fmv.camera` at [lon, lat] with the default SIDC `10030100001103002000`, the link's identity, the heading as `direction`, and the name from tag 10, else 3, else the link.
6. **The field of view, with the frame centre:** the sample's sets give an `ArcBand` from the camera, inner radius 0, centred on the bearing to the frame centre, its outer radius the ground distance, its width tag 16, `fillOpacity` 0, `strokeWidth` 2 in `fovColour`, and the relation `fmv.view` to the camera.
7. **The field of view, without the frame centre:** a set without tags 23 and 24 uses heading + relative azimuth and the slant range. A set without a direction, a length or tag 16 writes no arc and is counted. A bearing range across north (e.g. 359.9° ± 0.5°) is one arc across north.
8. **Label:** with `map`, ST 0102 1 is UNCLASSIFIED under the NATO names and 4 SECRET. `link label` gives the link's label. A set without ST 0102 gets the link's label, counted. The stream's label follows (`StreamRef.label`).
9. **Writes:** 30 sets a second give at most 2 writes per object a second, the newest set's. An unchanged set writes nothing.
10. **Stale and end:** with no set for `staleSeconds` the panel shows Stale and the objects stay. Removing the link deletes both objects. Disabling it keeps them. **Renaming it keeps both objects** (the same ids) and **their `dataSource` as first made** (data model rule 14), and changes their names where they came from the link's name (WA B, WW A; CR-0047). An arc made after the rename takes its camera's data source; a camera made after it, the new key.
11. **The stream, H.264:** with the test kit's `FakeStreams`:
    - the stream opens with the link's id as its name (section 4), `video/mp2t`, `plugin.fmv.view`;
    - every datagram is written unchanged;
    - the start points are exactly the datagrams with a random access video start, and the header is the latest PAT and PMT;
    - a `FakeStream.join()` after a few keyframes starts at the last one.
12. **The stream, H.265:** written as H.264 is, never converted.
13. **MPEG-2:** a conversion starts with the stream as its target, and the datagrams go to it, none to the stream. While `Waiting`, the panel says "Waiting for a conversion slot" and the stream converts once `Running`. After `Failed`, it starts again after a minute. With ECore's service, the converted stream plays and keeps its KLV (S9 part 2).
14. **Other formats:** a JPEG 2000 stream is listed "Not playable", and its camera and field of view are mapped.
15. **The panel:** it lists each stream with its format, size, bit rate, metadata age and state. Watch is hidden without `plugin.fmv.view` and disabled for a format that cannot be played. The empty list shows its text.
16. **The window:**
    - it opens per stream, several at once, moves and resizes, and stays open while the user pans the map;
    - it shows the classification line;
    - closing it ends the viewer (`StreamRef.viewers()` drops).
17. **The window's errors:** H.265 in a browser that cannot decode it shows the message. `503`, `403` and `404` show their texts. After the link restarts, the window plays again within 5 s.
18. **Permissions, on the server:** a user without `plugin.fmv.view` gets `403` from the stream, whatever the browser shows.
19. **Offline:** nothing is loaded from the internet. mpegts.js is in the web part's bundle.
20. **Live check (work package 5):**
    - in a live emcc with the ESA's replay, section 7 holds: the arc's direction, the first frame within about 0.2 s, no errors for 60 s;
    - checked in a **visible** browser window (S9: a hidden pane drops frames), in installed Edge or Chrome;
    - the MPEG-2 version plays when ECore's conversion exists.
21. **Checked against the texts:** a test set built from ST 0601.14's own examples (its section 8 example values for tags 2, 5, 13, 15, 16, 18, 21 and 23, and the section 8.1 checksum sample) decodes to their software values; `0x80000000` in tags 23 and 24 gives no frame centre; ST 0102 tag 2 0x0D is GENC two letter.

## 9. Out of scope

- **Transport:** RTP and RTSP, files, recording and playing back the past (ADR-0057 point 1).
- **More than one stream per link;** sending FMV or KLV out (in M8; from M9 a simulated camera's, section 10).
- **On the map:** the image footprint from the corner points (tags 26 to 33), VMTI targets (tag 74), and the frame centre as an object of its own.
- **Media:** converting H.265 (never, ADR-0057); audio.
- **In the window:** KLV shown over the video, snapshots, and pausing live video.

## Assumptions F1 to F8 (accepted by the owner, VR A, 2026-11-14)

- **F1:** the camera's standard identity is `friend` by default, since a feed an admin adds is usually one's own. (`gmti`'s platform is `unknown` by default.)
- **F2:** both data types have **no expiry** by default, so a camera whose feed stops stays where it was, marked stale in the panel (ADR-0057 point 3).
- **F3:** **removing a link deletes its camera and field of view.** Stopping or disabling it keeps them.
- **F4:** `time.observed` is the **server's receive time** by default, since recordings carry old times. `stream` uses tag 2.
- **F5:** the arc is `#FFD400` (yellow), 2 px, by default, settable per link.
- **F6:** the size in the panel comes from MPEG-2 sequence headers and H.264 sequence parameter sets. H.265's size is left blank in M8.
- **F7:** the panel's list (`GET /streams`) needs only a login, as the map objects do. Watching needs `plugin.fmv.view`.
- **F8:** the window does not use the KLV that mpegts.js hands over in M8; the map shows the metadata.

## 10. The output link: a simulated camera out as STANAG 4609 (M9, D6u)

**Approved by the owner (2026-11-17, in the PDA's session)**, with assumptions O1 to O12 (end of this section); O5 accepted as written; the WMS cache's documents under the key prefix `wms-tile-cache.` (the owner's "a folder named wms_tile_cache", as the documents' key rule allows). Milestone M9, the UAV track (may be cut to M10, owner XQ A) · Task: D6u (brief), F1 and F2 (PCA-fmv).
- **The owner's decisions:** ADR-0058 points 2, 5 and 6 (the output over UDP, what the video shows, the ffmpeg CR) and ADR-0059 points 3, 7 and 8 (the pose as `fmv`'s kind, the rendering and muxing on compute tasks, the imagery and the terrain); CR-0048 (approved, ZB A): the declared kind (point 4; ADR-0059 point 3 as CR-0049 part A amends it, owner ZH A), compute tasks (point 5), PQ1 A (the threads in the plugin's Settings entry), PQ2 A (ECore checks the pose), PQ4 A (pictures as `Bytes`); YM B (the WMS fetch and the cache stay in M9).
- **Read first:** ADR-0058, ADR-0059, ADR-0064, CR-0048, **the SDK 1.9.0 part U CR** (CR-0050: the encoder and a channel's state), spike S10 (`spikes/s10-uav-fmv/README.md`, its `java/RenderBench.java` and `java/LiveSender.java`), the `uav-simulation` brief (approved, YR A; its section 4 is this section's pose).
- **Built against SDK 1.9.0 parts P and U** (`sdkVersion` `^1.9.0`). **It waits for:** C7 (compute tasks) and C8 (declared kinds) for the pipeline, C10 and the MCA's B4 (the encoder) for H.264. **Until then** the renderer, the KLV and the muxer are plain Java with tests, after S10, and the test kit's fakes run the rest.
- **The numbering continues:** functions 1 to 26 run through 10.1 to 10.7, and the criteria (10.8) continue section 8's 1 to 21 as 22 to 36.
- **The input link of sections 1 to 9 does not change.** emcc's own FMV panel sees a simulated camera only through an input link listening to this output (ADR-0058 point 2: one way in).

### 10.1 The pose: the channel kind `fmv` declares

1. **The manifest's `channelKinds`** gets `camera-pose` ("Camera pose": "One simulated camera's pose for one frame: where it is, where it looks, how wide, and the frame."), so its id is **`fmv.camera-pose`**. Its `payload` schema is the `uav-simulation` brief's section 4, field by field:
   - `camera` (string, a UUID), `time` (string, ISO 8601 UTC with milliseconds);
   - `platform`: `position` (`[longitude, latitude, height]`, −180 to 180, −90 to 90, −1 000 to 20 000 m HAE), `heading` (0 to below 360), `pitch` (−90 to 90), `roll` (−180 to 180), `name` (1 to 256 characters, optional);
   - `pointing`: `azimuth` (0 to below 360, relative to the heading, clockwise), **`depression` (−90 to 90, positive down)**, `roll` (−180 to 180);
   - `fieldOfView`: `horizontal` (0.1 to 120), `vertical` (above 0 to 120);
   - `frame`: `width` and `height` (640 × 360, 1280 × 720 or 1920 × 1080), `rate` (1 to 30, an integer);
   - `mission` (1 to 64 characters, optional).

   `required`: everything but `platform.name` and `mission`; `additionalProperties: false` at every level. The item's `label` is the platform's (CR-0048 point 4).
2. **The sign of the pointing** (PCA-uav-simulation's finding 7): the pose says **`depression`, positive down**, as the brief does. ST 0601's tag 19, the sensor relative elevation, is **positive up**, so `fmv` writes **tag 19 = −depression**; tag 18, the relative azimuth, is `azimuth` as it is. A camera looking 30° down sends `depression` 30 and tag 19 −30°.
3. **A change of the shape** is compatible only (an optional member); an incompatible one is a new kind (CR-0048 point 4). `uav-simulation`'s brief and this section change together.

### 10.2 Output links

4. **An output link** is a `links[]` entry with `direction` `out` (the input links of section 5 are `in`, the default, so existing settings keep their meaning). It has the playbook's common fields (`id`, `name`, `enabled`) and:
   - **the destination** (ADR-0058 point 2, ADR-0036 points 3 and 4): `mode` `udp` (an `address` and a `port`) or `multicast` (a `group`, a `port`, an `interface` an admin names, and a `ttl`, 1 to 32, default 1). **A new output link has no destination and sends nothing until an admin sets one** (O1). The host comes only from these settings, never from a pose;
   - **`highestClassification`**, the release limit (ADR-0037 point 8, ADR-0058 point 2): a pose whose label is above it is not rendered, and is counted. **Its default is the classification of the server's default label** (ADR-0037 point 8);
   - **the video:** `bitrate` (0.5 to 20 Mbit/s, default 4), `keyframeSeconds` (0.5 to 10, default 1), `metadataEvery` (ST 0601 every Nth frame, 1 to 25, default 1, ADR-0058 point 2), `maxRate` (the pacing, 1 to 50 Mbit/s, default 20, S10);
   - **the picture:** `sampling` (`bilinear` or `nearest`, default `bilinear`), `haze` (default on), `imagerySet` (a set's name from the imagery folder, or empty for the first that covers the camera);
   - **ST 0102:** `classificationNames` (as an input link's, the policy's names for ST 0102's 1 to 5; NATO's by default) and `classifyingCountry` (`//` and 1 to 4 letters, default `//NATO`, O8).
5. **Each enabled output link offers a channel** (ADR-0037): `ChannelSpec.of("out-" + <the link's id>, <its name>, "stanag-4609").declaredKinds(Set.of("fmv.camera-pose")).kinds(Set.of())`, offered with a `toDeclared` mapper (CR-0048 point 4). A disabled or removed link withdraws it. A rename keeps the channel (its link name comes from the link's id, CR-0047). **The link name is `out-<the link's id>`, not the id itself:** `ChannelSpec` takes a link name that starts with a letter, and a UUID v7 may start with a digit (PCA-fmv's F1 phase 2, 2026-11-17); `out-` and 36 characters fit its 64.
6. **One camera per link** (ADR-0059 point 7; the `uav-simulation` brief's U10): the first camera whose pose arrives holds the link until no pose of it has come for 2 s (O2). Poses of another camera meanwhile are dropped and counted (`other camera`).
7. **The link's state for its senders** (part U, CR-0050): `READY` while it can render; `NOT_SENDING` with a detail when it cannot: "No destination", "No render thread", "Waiting for a conversion slot", "No encoder installed", "Encoder failed, started again after 60 s", "Disabled". `uav-simulation`'s panel shows the detail.
8. **The manifest's `connections`** gets `direction` `both` (kinds `udp` and `multicast`, `settings` `/links`); **`compute`** declares `"threads": 8, "reason": "Renders and muxes one simulated camera per thread for the output links."` (O3; an admin lowers it in Settings, PQ1 A); **`internet`** is declared with no default hosts (CR-0022) for the WMS (10.5), with F2's WMS fetch. **An output link's UDP or multicast destination is a declared connection** (`connections`, set by an admin; ADR-0036 point 7 as CR-0052 amends it; owner, 2026-11-17, AAA A and AAH A), whatever host an admin names.

### 10.3 The pipeline: compute tasks render and mux, ECore encodes

9. **When a link's first pose arrives**, its worker starts **one compute task for the link** (ADR-0059 point 7): `ComputeSpec.of("render-<the link's id>", …)` (the id is a lower-case UUID, so the name fits the pattern, 43 characters), `Restart.onFailure` with a back-off from 1 s to 1 min. **The worker**, not the task, also starts the link's encoder (10.4) and a connection task that sends (10.6), and hands both refs to the task in a message.
   - **The task's inbox** (capacity 1 000, `coalesceByKey`) takes three kinds of item, which never replace each other: **poses**, keyed by the camera, so only the newest waits; **encoded pictures**, keyed by their own sequence number, so none is ever replaced (the encoder lets at most 2 pictures wait, CR-0050, so a handful are in the inbox at once); **tiles and terrain cells**, keyed by the tile or cell, posted by the worker in batches of at most 200. So the inbox never fills in use; if it does, the oldest item goes and is counted (`inbox dropped`), and a lost access unit shows as a short glitch until the next keyframe.
   - **A refused start** (`ComputeEvent.Refused`): the link is `NOT_SENDING` "No render thread" with the reason, and the worker tries again every 10 s while poses arrive (ECore does not retry, CR-0048 point 5.3).
   - **When the camera's poses stop** (2 s, O2), the worker stops the task, the encoder and the sender, which frees the thread and the conversion slot; the next pose starts them again.
10. **The worker** maps each `DeclaredItem` to a pose and posts it to the task. A pose above `highestClassification` is not posted (`above release limit`). The worker also posts the imagery tiles the task needs (10.5) and the terrain cells it has read, as immutable messages.
11. **The compute task's loop**, for each pose it takes:
    - **items** are handled by kind: a pose is rendered (below), an encoded picture muxed, a tile or cell stored in the task's own state;
    - **late:** a pose older than one frame period (`1 / rate`) on ECore's clock is skipped (`late`); the newest one replaces it in the inbox anyway (ADR-0059 point 7: a late pose is never waited for);
    - **renders** the frame after S10's `RenderBench.java` (10.5), to a YUV 4:2:0 picture (part U's input format), and writes it to the encoder; a `DROPPED` write is counted (`encoder dropped`);
    - **keeps the pose** by its time in a small ring (the last 2 s), for the KLV of its encoded picture;
    - **takes the encoded pictures** back in the same inbox (part U: the encoder's output goes to the compute task), each with its input's time and whether it is a keyframe;
    - **muxes** each into the transport stream (10.6) with ST 0601 from the pose of the same time and ST 0102 from its label, and posts the datagrams to the sender (`ConnectionRef.post`);
    - **counts** `rendered`, `late`, `encoder dropped`, `encoded`, `muxed`, and the render time's median over the last 10 s as a detail.

    It reads the imagery and the terrain only from the messages its worker posts, and the declared folders (ADR-0064 point 3). It makes no HTTP call and does not use the store.
12. **Its state is its own:** the tiles and the terrain it was given, the pose ring, the mux state (continuity counters, the last PAT and PMT time). A restart starts clean, and the worker posts the tiles again.

### 10.4 The encoder (ECore's conversion service; part U)

13. **The worker starts the link's encoder** through ECore's conversion service (part U, CR-0050; ADR-0059 point 7): the frame's width, height and rate, the link's `bitrate` and `keyframeSeconds`, no B-frames; the output into the compute task's inbox. It holds one conversion slot (`emc2.conversions.max`), shared with the MPEG-2 conversions of section 4.
    - `Waiting`: `NOT_SENDING` "Waiting for a conversion slot"; the task's pictures are dropped until `Running`;
    - `Failed` `UNAVAILABLE`: "No encoder installed"; **the link stops its compute task and its sender until its own settings change or the plugin restarts** (owner ABT A, 2026-11-17);
    - **any other failure** keeps the task and the sender: the link is `NOT_SENDING` "Encoder failed, started again after 60 s", and the worker starts a new encoder after `RETRY_AFTER` (60 s), as section 4 does for MPEG-2 (ABT A);
    - **a new frame size or rate** in the poses stops the encoder and starts one for the new size.
14. **Only ECore starts ffmpeg** (CR-0045; ADR-0058 point 6). Raw-video input needs the MCA's ffmpeg CR (B4) before the encoder runs.

### 10.5 The picture: imagery, terrain, renderer

15. **The renderer** (ADR-0058 point 5; S10's method): rays through a grid of every 8th pixel, edge to edge, meet the terrain by a fixed-point search on the distance along each ray (bilinear heights); the ground points are upsampled to every pixel and sampled from the imagery, `bilinear` or `nearest`; haze grows with distance (`haze`); the sky lies above the horizon. **No occlusion test, a static scene** (ADR-0058 point 5). Where no imagery covers a ground point, it is a neutral grey (`#808080`) and counted (`no imagery`). One compute thread per link, no threads of its own (`PluginRules`).
16. **The two folders** (ADR-0059 point 8, ADR-0049), declared in the manifest, read-only and confined:
    - **`imagery`**, setting `imageryFolder`, default `%emcc%/settings/imagery`: one subfolder per **imagery set**, each with an `imagery.json` (its name, its `source`, its `licence`, its CRS `EPSG:4326` or `EPSG:3006`, and its tiles: a file, its corner coordinates and its pixel size) and the tiles as JPEG or PNG (O4). A set without a source or a licence is refused and named in the Monitor (ADR-0058 point 4);
    - **`terrain`**, setting `terrainFolder`, default `%emcc%/settings/terrain`: the same DTED files the `terrain` plugin reads by default (levels 0 to 2, `e<lon>/n<lat>.dt<n>`), read by `fmv`'s own DTED reader after S10's (plugins share no code). **Where no height data covers a point, the ground is flat at 0 m HAE** (O5).
    - **Reading** is the worker's, at a link's start and as the camera moves (the 10 km round it, O6); it posts the tiles and cells to the task.
17. **The WMS fetch and `fmv`'s own tile cache** (F2; ADR-0058 point 4, ADR-0059 point 8; owner YM B):
    - **The settings, plugin-wide** (`wms`): `enabled` (default off), `url` (the admin's; the host never from a pose or a request, ADR-0030), `layer`, `crs` (`EPSG:4326` or `EPSG:3006`), `format` (`image/jpeg` or `image/png`), `tilePixels` (256 or 512), `metresPerPixel` (0.25 to 10, default 1), `source` and `licence` (both required to fetch), `token` (the name of an HTTP credential, `emc2.http.credentials.<name>`, never the token itself; ADR-0060). **No version setting: WMS 1.3.0 only** (owner, 2026-11-17, in PCA-fmv's F2), GetMap with `BBOX` in the CRS's axis order: latitude first in EPSG:4326, northing first in EPSG:3006.
    - **What it fetches** (owner, 2026-11-17, in PCA-fmv's F2; not O6's 10 km round the camera, about 4 800 tiles at 1 m against the 900-tile cache): **the grid tiles within 2 km of where the camera looks**, its line of sight on flat ground at 0 m, or, where that meets nothing within 10 km, the point 2 km ahead; nearest first; planned again when that point has moved 500 m. Tiles the imagery folder covers are skipped. Through the SDK's outbound HTTP, at most 4 requests at a time and 20 a second (O7), each timed out by the SDK.
    - **The cache:** in `fmv`'s own **plugin documents**, one per tile, keyed **`wms-tile-cache.<crs number>-<metres per pixel>-<x>-<y>`**, e.g. `wms-tile-cache.3006-1.0-1234-5678`: the prefix works as the owner's folder `wms_tile_cache` (2026-11-17), with `-` for `_` (the documents' rule: lowercase words, digits, `-` and `.`, at most 128 characters; `sdk-v1.md`, Documents), the image as base64, at most 512 KiB, **at most 900 tiles**, the least recently used one removed first (part U's answer on storage, CR-0050 point 3). So the camera works offline once an area has been flown.
      - **A tile is looked up in the cache before it is fetched.** A kept tile from **another server, layer or format** is used, and fetched again when the server answers; **the cache is not emptied when the settings change** (owner, 2026-11-17, in PCA-fmv's F2).
      - The key holds no tile size, so a kept tile of **another `tilePixels`** is never used (its ground differs) and is overwritten when its key is fetched again.
      - **The order of use** is one more document, **`wms-cache-index`**, outside the prefix, since documents cannot be listed; a tile whose document outlived a lost index is taken in when it is next used.
    - **The licence:** cached tiles keep the set's `source` and `licence`; the Monitor names them. The video carries the imagery onward, so its terms decide where the video may go (ADR-0058 point 4).

### 10.6 The transport stream out

18. **The mux** (ST 1402; after S10's `LiveSender.java`):
    - **the program:** PAT; PMT on PID `0x0100`; H.264 (stream type `0x1B`) on PID `0x0101`, which carries the PCR; KLV on PID `0x0102`, stream type `0x06` with a `KLVA` registration descriptor (asynchronous);
    - **PAT and PMT every 3 frames**, padded with `0xFF` bytes, never with an adaptation field (S10's "what went wrong" 2);
    - **H.264 PES** with a PTS from the frame's time (90 kHz); a PCR 100 ms ahead; **the random access indicator on each keyframe's first packet**;
    - **the access units** as ECore's encoder gives them, one per picture; `fmv` adds no access unit delimiters (S10's "what went wrong" 1);
    - **KLV PES** with a PTS, an ST 0601 set every `metadataEvery` frames.
19. **ST 0601** (ST 0601.14, section 2's table, written the way section 2 reads it): tags 2 (the frame's time, µs), 3 (`mission`, cut to 127 bytes; absent without one), 5 (`platform.heading`), 6 and 7 (the platform's pitch and roll), 10 (`platform.name`, else the link's name), 11 ("emcc simulated camera"), 13 to 15 (the camera's position and height), 16 and 17 (the fields of view), 18 (`pointing.azimuth`), **19 (−`pointing.depression`)**, 20 (`pointing.roll`), 21 (the slant range to the frame centre), 23 to 25 (the frame centre, from an exact ray through the frame's centre; `0x80000000` when it does not meet the ground), 48 (ST 0102), 65 (14), and 1, the checksum, last.
20. **ST 0102** (tag 48, ST 0102.12): tag 1 from the pose's label through `classificationNames` (the name to 1 to 5; a name not in the list: the link's `highestClassification`'s, counted `unmapped classification`), tag 2 `0x07` (STANAG 1059 three letter, O8), tag 3 `classifyingCountry`, tag 22 12.
21. **The sender** is the link's connection task: UDP to the destination, datagrams of 7 × 188 bytes, **paced at `maxRate`** (it waits with `poll(timeout)` until the next datagram's time, never sleeps), a send buffer of 4 MiB. Its inbox holds 2 s of datagrams at `maxRate`; beyond it the oldest are dropped and counted (`send dropped`).

### 10.7 Status, the Monitor and the web part

22. **Status per output link:** `No destination`, `Waiting for a pose`, `Rendering <the platform's name> <width>×<height> <rate>`, `Above release limit`, `No render thread (<the refusal>)`, `Waiting for a conversion slot`, `No encoder installed`, `Encoder failed, started again after 60 s`, `Disabled`. **DEGRADED** while a link has poses but cannot render them.
23. **Counters per output link** (per minute, as the playbook says): poses in, `other camera`, `above release limit`, frames rendered, `late`, `encoder dropped`, encoded, datagrams and bytes sent, `send dropped`, `no imagery`, `unmapped classification`; WMS tiles fetched, from the cache, failed. The compute task's own counters, busy share and CPU time are ECore's Monitor entry (ADR-0064 point 5).
24. **The Monitor** also shows the two folders, the imagery sets with their source and licence, and the cache's tiles and size (ADR-0059 point 8).
25. **The web part:** only the Settings form changes (the output link's fields, `visibleWhen` on `direction` and `mode`; groups Destination, Video, Picture, Classification; the plugin-wide `wms` group). The FMV panel lists input links only, as now.
26. **Permissions:** no new one. Output links and the WMS are settings (`settings.admin`); poses come from another plugin's server part, which ECore checks (PQ2 A).

### 10.8 Acceptance criteria (output)

Criteria 22 to 33 run with the test kit (`FakePluginContext` with `compute(8)`, `FakeChannels.declare("fmv.camera-pose", …)`, `FakeConversions`, the fake folders and HTTP); 34 to 36 live.

22. **The kind:** the manifest declares `camera-pose` with section 10.1's schema; the `uav-simulation` brief's example pose passes it; a pose with `depression` 91, a `frame.width` of 1000 or an unknown member does not.
23. **The channel:** an enabled output link offers `fmv` / `out-<its id>` with `declaredKinds` `fmv.camera-pose` and no `ChannelKind`; disabling it withdraws the channel; a rename keeps its id.
24. **No destination:** a new output link sends nothing and is `NOT_SENDING` "No destination"; with an address and a port it renders on the first pose.
25. **One camera:** two cameras' poses on one link: the first is rendered, the second counted `other camera`; 2 s after the first stops, the second takes the link.
26. **The release limit:** with `highestClassification` RESTRICTED, a SECRET pose is not rendered and is counted; an UNCLASSIFIED one is. A new output link's limit is the server's default label's classification.
27. **Compute tasks:** the first pose starts one compute task per link; at `allowed()` 1 a second link's start is refused, its state says "No render thread (PLUGIN_LIMIT)", and it starts within 10 s of the first link freeing its thread; 2 s without poses stops the task and the encoder.
28. **Late poses:** a pose older than one frame period is skipped and counted; with 25 poses a second and a renderer slowed to 60 ms, about every second pose is rendered, always the newest.
29. **The renderer:** a camera at 700 m over S10's synthetic test image, tracking its crossing, renders the red and blue lines crossing at the frame's centre (±2 pixels at 1280 × 720); with no imagery the frame is grey and counted; with no terrain the ground is flat at 0 m.
30. **ST 0601:** a pose with heading 45°, azimuth 90°, depression 30° gives tag 5 45°, tag 18 90° and **tag 19 −30°** (±0.01°); the frame centre (tags 23, 24) lies on the line of sight within 10 m over the test image's flat ground; the checksum checks; S9's `KlvDump` reads every set.
31. **ST 0102:** an UNCLASSIFIED label gives tag 1 = 1, SECRET 4, with `//NATO` in tag 3; an unknown name is counted.
32. **The mux:** PAT and PMT every 3 frames without an adaptation field, the RAI on every keyframe's first packet and on no other, a PCR ahead of the PTS, continuity counters without a gap; 7 × 188-byte datagrams; the sender keeps to `maxRate` (±5 % over 10 s).
33. **The WMS and the cache:** with the WMS on, a camera over an area the folder does not cover fetches its tiles once, then renders them from the cache with the HTTP fake failing; the 901st tile removes the least recently used one; each tile's document key is `wms-tile-cache.<crs number>-<metres per pixel>-<x>-<y>` and passes the documents' key rule, and no other document of `fmv` starts with that prefix (the index is `wms-cache-index`); only tiles within 2 km of where the camera looks are fetched, nearest first; a kept tile from another layer is used and fetched again; the GetMap request is WMS 1.3.0 with `BBOX` latitude first in EPSG:4326; without `source` or `licence` nothing is fetched and the Monitor says why.
34. **Live, end to end (with the ITA's T2):** a `uav-simulation` camera on a simulator track over the Sundsvall data, through an output link to `127.0.0.1:<port>`, an input link on that port: View shows the camera symbol moving with the track and its field of view in the pose's direction, and the FMV window plays, for 60 s, without errors (**playing within 2 s of the first pose is M10:** owner ABU A, 2026-11-17; M9 measured the first datagram at 2.52 s, 1.16 s in `fmv` and 1.36 s in `h264_mf`'s start-up, a known limit of M9); S9's `KlvDump` on a recording finds every checksum right and no continuity error.
35. **Live, the cost:** one 720p camera at 25 frames a second, bilinear, with the 1 m imagery, uses about one compute thread and one conversion slot; the Monitor shows both. **A busy share below 90 % is M10** (owner ABU A, 2026-11-17): M9 measured about 99 %, a known limit of M9.
36. **Offline:** with the network off, the cached area still renders; nothing is loaded from the internet in the browser.

### Assumptions O1 to O12 (the PDA's, for the owner's approval)

- **O1:** a new output link has no destination (ADR-0058 point 2), and its `mode` is `udp`.
- **O2:** a link frees its camera **2 s** after that camera's last pose, so a stopped camera frees the thread and the conversion slot quickly, while a paused simulation (still poses) keeps it.
- **O3:** `fmv` declares **8 compute threads**: more cameras than a 12-core machine runs well; the admin lowers it.
- **O4:** imagery sets come as **JPEG or PNG tiles with an `imagery.json`**, in `EPSG:4326` or `EPSG:3006` (SWEREF 99 TM, Lantmäteriet's, as S10). No GeoTIFF in M9 (the M9 plan's L4). Decoding JPEG and PNG needs the JDK's `java.desktop` module in the release's runtime (the plugin gap analysis's G20, the MCA's list).
- **O5, a deviation from the ADRs' words, accepted by the owner (2026-11-17):** where no height data covers a point, the ground is **flat at 0 m HAE**. ADR-0058 point 4 and ADR-0059 point 8 say "flat at the frame's height", which the pose does not give (it carries the camera's height, not the ground's); 0 m is the PDA's reading. If the owner keeps the ADRs' words, the brief takes the frame centre's height from the last frame that met height data instead.
- **O6:** the worker reads imagery and terrain for **10 km round the camera**, and again when the camera has moved 5 km. **Not for the WMS:** it fetches within 2 km of where the camera looks (10.5 point 17; owner, 2026-11-17).
- **O7:** the WMS is fetched **at most 4 requests at a time and 20 a second**, as a fair default for a public service.
- **O8:** ST 0102's tag 2 is `0x07` (STANAG 1059 three letter) and tag 3 `//NATO` by default, settable per link.
- **O9:** `metadataEvery` is **1** by default: ST 0601 with every frame, as ADR-0058 point 2's first choice.
- **O10:** a pose whose frame size or rate changes **restarts the encoder**, so the stream has a short gap there.
- **O11:** ST 0601's tags 26 to 33 (the corners) are **not written in M9**; the input link ignores them too (section 9).
- **O12:** the WMS cache is **900 tiles** in `fmv`'s plugin documents (of the 1 000 a plugin may keep), about 7.7 km square at 1 m and 256 pixels a tile.
