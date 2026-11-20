# ais

AIS (ships) for emc2. Owner: PCA-ais. Brief: `docs/plugins/briefs/ais.md` (T-094 and T-096), built by the in/out playbook `docs/plugins/in-out/playbook.md`. **Input only**, server part only, on SDK 1.8.0 (`sdkVersion` `^1.8.0`), writing through the SDK's `ObjectWriter` (T-147): an admin sets up the links in the Settings list, and the ships are ordinary objects that every other plugin shows.

## What it does

**Receives AIS as NMEA 0183 `!AIVDM` sentences and keeps one symbol per ship, at its last position, with its name, course and speed.** It sends nothing.

- **Links.** A *link* is one configured connection, an entry of the setting `links`, on a connection task (ADR-0036):
  - **`tcp-client`** (the default): connects to `host` and `port` of a receiver or a feed that serves the sentences as lines of text over TCP, such as the playback. It connects again when the connection ends or nothing has come for `idleSeconds`.
  - **`udp`**: receives datagrams of one or more sentences each on `listen` (address `127.0.0.1` unless an admin sets another, and the port).
  - Hosts, ports and addresses come only from the link's settings, never from a received sentence (ADR-0030). Only users with `settings.admin` change them; a change applies at once.
- **Sentences.** A line is one sentence (LF or CR LF; in UDP each line of a datagram). At most 512 bytes; longer is dropped. Talkers: any two letters with `VDM` or `VDO`. A tag block (`\...\`) before the `!` is skipped. The checksum is checked: missing or wrong, the sentence is dropped. Seven fields, a count of 1 to 9, the six-bit payload set and 0 to 5 fill bits are checked too.
- **Multi-sentence messages** (type 5, some 19) are joined in the task, **per connection**, by sequence id and channel. At most 16 wait; one that is not complete 5 s after its first fragment, a fragment out of order, or a 17th message drops the oldest.
- **Message types:** 1, 2, 3 (class A position), 18 and 19 (class B position), 5 (voyage data) and 24 (class B static data, parts A and B). Every other type is counted by its type and ignored.
- **Static data before a ship's first position** (type 5, 24, and the static part of 19) is kept in the worker, **per link**, by MMSI: at most 50 000 ships, each forgotten an hour after its last message, the oldest first when full. A ship is created at its first position and gets what is known.
- **Values out of range** (owner, 2026-10-31: EM): a course above 3 600 tenths of a degree, a heading from 360 to 510, a ship type above 99, a longitude beyond ±180 or a latitude beyond ±90 is left out like a value that is not available, and the rest of the message is used; counted as `value out of range`. A longitude or latitude out of range or not available (181, 91) leaves the message without a position (`no position`); only the sentence checks drop a whole sentence.
- **Mapping** (one object per ship; `type` `core.symbol`, `dataType` `ais.vessel` "AIS vessel", `dataSource` the link's name):

  | AIS | Object |
  |---|---|
  | MMSI | `externalRef` `{ais, <9 digits, leading zeros kept>}`; the ship is found again by it after a restart |
  | longitude, latitude (1/600 000 degree) | `geometry` `Point` `[lon, lat]`, longitude first |
  | course over ground (0.1°) | symbol modifier `direction` (degrees); 3600 = not available |
  | speed over ground (0.1 kn) | symbol modifier `speed` (m/s, × 0.514444); 1023 = not available |
  | name (5, 19, 24A) | `properties.name` and the symbol's `uniqueDesignation`; without one, the MMSI |
  | ship type | the symbol's entity: 30 fishing vessel, 60 to 69 passenger ship, 70 to 79 merchant ship, 80 to 89 oiler/tanker, otherwise generic civilian (APP-6D, symbol set 30) |
  | the time the plugin received the sentence | `time.observed` (AIS carries only the second of the minute) |
  | the rest | the plugin's extension `ais`, below |

- **Field set `ais.ship`** (ADR-0050; brief section 10): the manifest declares the keys of the extension `ais` as fields, all editable by others (users change them in "Symbol properties", group "AIS ship"), and `ObjectWriter.fieldSet` gives every ship the set from its create. The values stay where they are, in `extensions.ais`.
- **Extension `ais`** keeps what the core has no field for, and nothing else of the message: `class` (`"A"` or `"B"`), `heading` (0 to 359), `navStatus` (0 to 14), `callSign`, `imo`, `shipType` (0 to 99), `length` and `beam` (metres), `draught` (metres), `destination`. A value that is not available is absent. No declared fields.
- **Symbol type** (M5; owner, GL; brief section 10). The link's `symbolType` is `vessel` or `app6`.
  - **`vessel`** (the default for a link added in the Settings form): the ship's symbol is `{standard: "vessel", sidc: "<context><identity><ship type>"}`, four digits, such as `0471` (reality, neutral, ship type 71), drawn by `symbology` as a hull filled by its ship-type group. The ship type is `00` until a static message gives it. Direction, speed and the unique designation are the same as for APP-6.
  - **`app6`:** the APP-6D symbol below. **A link stored before M5 has no `symbolType` and is read as `app6`** until an admin changes it.
  - A change applies to each ship at its next update, without reconnecting. A ship follows the setting of the link that made it; if that link is gone it keeps its stored standard and identity.
- **Symbol (APP-6).** APP-6D, symbol set 30; the standard identity comes from the link's `standardIdentity` (owner, 2026-10-31: EJ; default `unknown`, `neutral` suits a civilian feed). A ship keeps the identity and label of the link that made it, and follows a change of that link's setting at its next write.
- **Layers** (ADR-0037). A link writes into **its target layer**: a layer picked in the settings form (the form's "+" button makes one at once and saves it with its id; a value with only a name, saved before SDK 1.4.0, still works); absent means a new layer named like the link. Two links that name the same new layer share one. A picked layer that is deleted later is made again under its name at the next ship (the `ObjectWriter`). The layers the plugin makes are kept in a plugin document, so a restart finds them again; a layer that is gone is made again at the next ship. A changed target layer applies to the next new ship; a ship stays where it is.
- **Label.** The link's `label`, else the server's default label, for its layer and its ships.
- **One ship, two links.** The first link that creates it keeps it, in its layer and with its data source; the other link's positions update it.
- **Writes.** At most one change request per ship is in flight; a newer message replaces one that waits, so a busy feed (20 sentences a second) never queues more than one request per ship, and each update is based on the state the store last reported. Static data that repeats unchanged costs no request.
- **Expiry.** The plugin sets no `time.expires`; the data type's defaults in the manifest do (ADR-0023): `expiresAfterSeconds` 600, shown faded from then, removed by ECore 1 800 s after the expiry. An admin changes them per data type. The plugin never deletes a ship.
- **Status** (monitor view): per link `name [in tcp-client to host:port]: up, N msg/min, N ships/min, layer 'x'` (UDP: `listening`; before that `connecting` or `starting`; `down: <reason>`; `switched off`). `OK` when every enabled link runs, else `DEGRADED`. The detail is cut at 512 characters. A link that goes down warns in the log at most once a minute per link and reason. `msg/min` counts the decoded messages of the used types; `ships/min` the ships created or updated.
- **Counters** (monitor view, per task, from `task.count`): `frames in` (every line), `messages` (sent to the worker), `dropped: too long`, `dropped: no checksum`, `dropped: checksum`, `dropped: malformed`, `dropped: fragment lost`, `dropped: too short`, `dropped: worker busy`, `ignored: type <n>`, `no position`, `value out of range`; and from the worker `ships created`, `ships updated`, `ships rejected`, `static data kept`, `static data forgotten`.

## Fields

The set `ais.ship` ("AIS ship"), each editable by others: `callSign` (text, 7), `imo` (1 to 999 999 999), `shipType` (0 to 99), `navStatus` (0 to 14), `heading` (`deg`, 0 to 359), `length`, `beam` and `draught` (`m`, 0 to 1 000), `destination` (text, 20), `class` (`A` or `B`).

Navigational status (ITU-R M.1371): 0 under way using engine, 1 at anchor, 2 not under command, 3 restricted manoeuvrability, 4 constrained by draught, 5 moored, 6 aground, 7 engaged in fishing, 8 under way sailing, 9 and 10 reserved, 11 towing astern, 12 pushing ahead or towing alongside, 13 reserved, 14 AIS-SART active.

## Settings

Edited in the settings view by users with `settings.admin`.

| Name | Default | Meaning |
|---|---|---|
| `links` | none | The connections that receive AIS: a list of entries with the fields below. The plugin does nothing until there is one |
| `links[].name` | – | The link's name: the data source of its ships, its status entry and its task. Lowercase words separated by hyphens, at most 64 characters; `manual` is reserved |
| `links[].mode` | `tcp-client` | `tcp-client` or `udp` |
| `links[].direction` | `in` | `in` only |
| `links[].host`, `links[].port` | – | `tcp-client`: where to connect |
| `links[].listen` | address `127.0.0.1` | `udp`: where to receive (`{address?, port}`); another address only when an admin chooses it |
| `links[].idleSeconds` | `300` | `tcp-client`: connect again when nothing has come for this long; `0`: never |
| `links[].targetLayer` | absent | The layer picker: a layer from the list, or one made at once with its "+" button (saved with its id). Absent: a new layer named like the link |
| `links[].label` | the server's default label | `{policy, classification}` of a new layer and of the ships |
| `links[].standardIdentity` | `unknown` | `pending`, `unknown`, `assumed-friend`, `friend`, `neutral`, `suspect` or `hostile`: the standard identity of every ship of the link |
| `links[].symbolType` | `vessel` for a new link; absent in a stored link: `app6` | `vessel`: vessel symbols (a hull by ship-type group); `app6`: APP-6D sea surface symbols |
| `links[].enabled` | `true` | Whether the plugin runs the link |

A bad entry is left out and reported in the status (`DEGRADED`), the others work.

## Messages and services

- Server worker `links` (`TransportMsg`): `SettingsChanged`, `LinkEvent` (ECore's news of a task), `Up`, `Down`, `ReceivedPosition` and `ReceivedStatic` (from the tasks), `Tick` (a timer, 1 s), `Writer` (the `ObjectWriter`'s own replies) and `Stop`. Mailbox 10 000, `dropNewest`; answers are always delivered. One connection task per link, with no inbox.
- Plugin document `object-writer.layers`: the layers the writer made, by name (the SDK's; the `layers` document of earlier versions is no longer read, so a layer made by name before T-147 is made once more after the update unless the link has ships in it).
- No endpoints, no topics, no web part.

## Permissions and internet

- No permissions of its own; the settings need `settings.admin`. A server part's changes carry no user, so the object store checks no user permission.
- **Internet:** declared in `internet` with no default host. A TCP link may point at an AIS feed on the internet, a UDP link may listen on an address an admin chooses; the host or address comes only from the link's settings. Without internet the plugin works with a receiver on the local network or a recording.

## Tests and the live check

- `mvn verify` for `plugins/ais/server` (and `node tools/test.mjs`): unit tests of the codec and the mapper, tests of the transport against real sockets on loopback, tests of the links, layers and ships against the fake store, a replay of a generated feed through a real UDP link, and the criteria tests `criterionN_…` of the brief. Frames are written for the tests by a small six-bit encoder (`codec/Ais.java` in the tests); no recording is kept in the repository.
- **Live check** against the ESA's playback (`external/playback/README.md`; start it with `node external/playback/start.mjs`): `mvn -f server/pom.xml -pl ../plugins/ais/server -am test -Dtest=LiveCheckTest -Dsurefire.failIfNoSpecifiedTests=false -Demc2.live=8111:180,8112:180,8110:600` runs the whole plugin on the fake context with one TCP link per port, each for the given seconds, and prints the counts (the test does nothing without `-Demc2.live`).

## Known limits

- Input only; no AIS over serial lines; no tracks (past positions), no ETA, rate of turn or alerts; no check of a ship against a register.
- Message types other than 1, 2, 3, 5, 18, 19 and 24 are counted and ignored (base stations, aids to navigation, binary and safety messages, SAR aircraft).
- The time of a ship is the time the plugin received the message (AIS carries only the second of the minute).
- A ship whose MMSI is 0 or has more than nine digits is dropped as `malformed`. An auxiliary craft's (MMSI 98…) part B has no size (it carries its mother ship's MMSI there).
- Multicast and TLS are not offered.
- The status shows messages and ships per minute; the sentences are in the task's counters in the monitor view.
- Two links that receive the same ship do not merge their static data: each link keeps its own, and the stored ship is the base.
