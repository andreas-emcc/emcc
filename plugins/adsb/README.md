# ADS-B aircraft (`adsb`)

Shows aircraft from ADS-B on the map. It reads the SBS-1 (BaseStation) text stream that an ADS-B decoder serves on TCP port 30003 (dump1090, readsb) and keeps one symbol per aircraft at its last position, with its callsign, track and ground speed. **Input only:** it sends nothing. Server part only: an administrator sets up the links in the settings, and the aircraft are ordinary objects that every other plugin shows. Built by the in/out playbook (`docs/plugins/in-out/playbook.md`, v1); brief: `docs/plugins/briefs/adsb.md`.

## Settings

`links`: one entry per decoder (empty by default: the plugin does nothing).

| Name | Default | Meaning |
|---|---|---|
| `name` | – | The link's name: lowercase words joined by hyphens, at most 64 characters. It is the data source of what the link receives. |
| `mode` | `tcp-client` | The only mode. |
| `direction` | `in` | The only direction. |
| `host` | – | The decoder's host. Required. |
| `port` | `30003` | The decoder's SBS-1 port. |
| `idleSeconds` | `60` | The link reconnects when nothing came for this long. `0`: never. |
| `targetLayer` | absent: a layer named like the link | A layer picked in the form: the "+" beside the picker creates it at once and keeps its id. A picked layer that is gone is made again by its name at the next aircraft. Two links that name the same layer share one. A value saved before SDK 1.4.0 with a name and no id still works the same way. |
| `label` | the server's default label | The security label of the layer and of the aircraft. |
| `standardIdentity` | `unknown` | The APP-6D standard identity of every aircraft of the link: `pending`, `unknown`, `assumed-friend`, `friend`, `neutral`, `suspect` or `hostile`. ADS-B does not say friend or foe; set `neutral` for civil traffic. |
| `enabled` | `true` | Whether the plugin runs the link. |

## What it writes

- One object per aircraft, created at its first position (`MSG,2` or `MSG,3`): `type` `core.symbol`, `dataType` `adsb.aircraft` (declared in the manifest: expiry after 60 s, faded, removed 300 s after expiry), `dataSource` the link's name.
- `externalRef` `{system: "icao24", id: <hex>}`: after a restart the next position updates the same object.
- Position: `[longitude, latitude]`, WGS84. The SBS-1 fields carry latitude first; the mapper swaps them.
- Symbol: APP-6D, air, civilian fixed wing (`120100`), with the link's identity, status present. Modifiers: callsign (`uniqueDesignation`), flight level from the barometric altitude (`FL350`), track as direction, ground speed in metres per second.
- Extension `adsb`: `altitudeFt`, `verticalRateFpm`, `squawk`, `emergency`, `onGround`, each only when the decoder sent it.

A value out of range drops that value only (a latitude of 95 leaves out the position, which counts as `no position`; the callsign, altitude and speed of the line still apply), counted as `value out of range`. A line that does not parse at all is dropped whole.

Message types 1 to 6 are used. Types 7 and 8 and the record kinds `SEL`, `ID`, `AIR`, `STA` and `CLK` are ignored and counted.

## Messages and services

None. The worker (`LinkWorker`) owns the links and the aircraft; the object store is written only through change requests. The plugin provides and requires no services.

## Permissions and internet

No permission is checked: the plugin's changes carry the plugin, not a user. Its manifest declares one connection kind (`tcp-client`, `in`) for the links, and `internet` with no built-in hosts: a link's host comes only from the settings an administrator sets (ADR-0030). No host comes from received data.

## Status and counters

- Status per link: its state (`up`, `connecting`, `down: <reason>`, `switched off`), the lines received and the aircraft updated in the last minute, the aircraft it holds, and the layer. `OK` when every enabled link runs, else `DEGRADED`.
- Per task, drops and ignored lines: `dropped: too long`, `dropped: malformed`, `dropped: not icao`, `dropped: worker busy`, `ignored: <kind>`, `frames in`. Values left out, not drops: `value out of range`.
- Per link: `aircraft created`, `aircraft updated`, `aircraft waiting` (known without a position yet), `aircraft forgotten`, `no position`, `rejected: <code>`, `no answer from the store`.

## Known limits

- An aircraft with no line for five minutes is forgotten by the worker; its object expires by the data type. Its callsign is then gone for the next position.
- Per link, at most 10 000 aircraft are held; the one that waited longest goes first.
- At most one change request per aircraft is in flight; a newer state replaces one that waits.
- The layer is found by name: a layer of the same name, made by someone else, is used too.
- Aircraft have no emitter category, type or registration, and no tracks (past positions).
- The recording in the test is not in the repository (ODbL; see `external/playback/README.md`). The replay tests use frames written for them.
