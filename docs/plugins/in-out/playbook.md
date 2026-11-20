# Playbook for in/out plugins

- Status: **v3** (2026-11-06, CR-0030 part 3; approved by the owner, IB), corrected 2026-11-16 (the `connections` key, gap analysis G5). Owner: PDA. Not yet brought up to SDK 1.5.0 to 1.8.0 (settings hints, `visibleWhen`, stable item ids, streams): that comes with the M9 plan's D4. v1 (2026-10-30, T-093) was first used for `ais` and `adsb` (T-096, T-097; owner, BR and BU). v2 takes in their PCAs' "Playbook notes" (`docs/handover/pca-ais.md`, `docs/handover/pca-adsb.md`) and SDK 1.4.0's `ObjectWriter` (T-147). Each PCA records where it fell short, and the PDA revises it before the next in/out plugin.
- For: a PCA, a local language model with about 100k tokens of context, or a human. Each work package lists what to read; read only that.
- Basis: the M4 plan, section 3; ADR-0036 (connection tasks), ADR-0037 (links and output channels), ADR-0007 (extensions), ADR-0038 (declared fields); the design pattern (`docs/plugins/design-pattern.md`), which stays normative.

## 1. What an in/out plugin is

An in/out plugin exchanges objects with another system over that system's protocol. Its server part:
- receives the protocol, maps it to map objects, and writes them into a layer (**input**);
- or sends objects of chosen layers in the protocol (**output**);
- or both.

Each connection is a **link** (ADR-0037), set up by an admin in the plugin's settings. The transport is always the plugin's own, on the SDK's connection tasks. ECore and the SDK have no protocol helpers (ADR-0036; owner, BQ).

**The template has the transport pattern:** `plugins/_template/server/src/main/java/dev/emcc/plugins/template/transport/`, taken from `cot`'s tested link tasks. Its six modes are a link's `mode` and `direction`:

| Mode | `in` (consumer) | `out` (provider) | `both` (one socket) |
|---|---|---|---|
| `udp` | receives on its listening address | sends to host and port | receives and sends on one socket |
| `tcp-client` | connects and reads | connects and writes | connects, writes and reads |
| `tcp-server` | each client that connects sends | each client gets what is sent | both, per client |

`TransportTest` in the template shows each one working against real sockets on loopback.

## 2. How to use this playbook

- **Your inputs:** your brief, `docs/plugins/briefs/<id>.md`, written by the PDA in the format of section 4, and this playbook.
- **Work packages:** do them in order, 1 to 5. Each one says:
  - **Read:** the only files you need, with their sections;
  - **Do:** the steps;
  - **Hand over:** what exists when it is done;
  - **Done when:** the checks that must pass.
- **About 100k tokens each.** The reading of a package is at most about 40k tokens (4 characters a token), which leaves room for your code and the tests. Do not read whole folders. When a package needs something not listed, write it down (section 6) and ask.
- **Commit after each package,** on your branch `pca-<id>/<topic>`, with `[PCA-<id>]` commits (`CLAUDE.md` section 6). Your handover file says which package you are in.
- **The rules always apply:** `CLAUDE.md` section 4. The ones an in/out plugin meets most:
  - sockets only in connection tasks (rule C6); no threads, no locks; immutable messages;
  - hosts, ports and addresses only from the settings, never from received data, a message or a browser request (ADR-0030);
  - coordinates in longitude, latitude order, and every conversion tested with a point where latitude ≠ longitude;
  - every object and layer has a security label;
  - write only your own extension namespace;
  - a library needs its licence checked first (ADR-0016), and a CR if it is not on the list.

## 3. The work packages

### Work package 1: the specification and its mapping to the model

- **Read:**
  - your brief, sections 2 and 3;
  - of the specification, only the parts the brief names;
  - `model/README.md`: "Conventions", rules 5, 8, 13 to 16, and "Security label";
  - `docs/adr/0007-common-data-model.md` and `docs/adr/0023-data-types-and-data-sources.md`;
  - the Javadoc of `MapObjectContent`, `Geometry`, `Symbol`, `TimeAttributes`, `Extensions` and `ExternalRef` in `server/plugin-sdk/api/src/main/java/dev/emcc/sdk/model/`.
- **Do:**
  1. **Start from the template** (design pattern, section 1). Keep its server part with the `transport` package; delete the web part if your brief has none. Then make the copy yours:
     - its tests are the template's: `InstalledPluginIT` calls `GET /greeting`, `InstalledLayoutTest` knows the folder `_template`, and `TransportTest` builds `FakePluginContext.builder("template")`. Change them to your plugin (the IT can check that the plugin starts and its status is OK);
     - rewrite the comments marked `YOUR PROTOCOL`, and the ones that name NMEA or SBS-1 if your protocol is another.
  2. **A parser:** one class, pure (no I/O), from one frame (a line, a datagram) to an immutable record. Received data is untrusted: check lengths, ranges and checksums, and give a reason for each frame it refuses, never an exception that escapes.
     - **A value out of its range is left out, not the frame** (owner, EM, 2026-10-31): the rest of the frame is used, and the value is counted (`value out of range`). Only the checks your brief names drop a whole frame.
     - **One record per kind of frame** (a position, static data): `ArchitectureTest` (rule C3) refuses a message component whose type is an interface, even a sealed one, so each kind travels as its own message.
  3. **State across frames,** if the protocol has it (AIS's multi-sentence messages; SBS-1, where position and callsign come in different messages): a small class with a limit and an expiry. Say in its comment whether it lives in the task (per connection) or the worker (per link).
  4. **A mapper:** from the parsed record to `MapObjectContent`:
     - the geometry in longitude, latitude, whatever order the protocol uses;
     - the symbol (SIDC), the time, the properties;
     - `externalRef` (the system and its id: model rule 16), `dataSource` (the link's name) and `dataType` (your brief);
     - the label: the link's label, else `context.defaultLabel()`.
  5. **Data outside the model:** what the protocol carries that the model has no field for (a header, an identifier, a status) goes into your extension, `extensions.<plugin-id>` (ADR-0007), if the brief asks to keep it. A field that users edit is a declared field instead (ADR-0038).
  6. **Your field set** (SDK 1.4.0, ADR-0050): declare the fields of your protocol in the manifest's `fields`, with the keys your extension already uses, and group them in `fieldSets` (`{ "id": "<name>", "label": "...", "fields": [...] }`), as your brief says. Its full id is `<plugin-id>.<name>`. Every object you receive carries it (work package 3).
- **Hand over:** the parser, the state class if any, the mapper, and their unit tests.
- **Done when:**
  - every row of the brief's mapping table has a test, from the specification's own examples where it has them;
  - a position test has latitude ≠ longitude;
  - the refused frames have tests: too long, a bad checksum (or, for a protocol without one, the brief's field checks), and each other reason the brief names; a value out of range has a test that it is left out and the rest used;
  - nothing in these classes opens a socket, reads a file or starts a thread.

### Work package 2: the transport

- **Read:**
  - your brief, section 4;
  - the template's `transport` package: `package-info.java`, `Link.java`, `LinkWorker.java`, `Inbound.java`, `LineFramer.java`, and the task class of your mode (`UdpLinkTask`, `TcpClientLinkTask` or `TcpServerLinkTask`);
  - the design pattern, section 5, "Connection tasks", and section 3, `connections` and `internet`;
  - `TransportTest.java` in the template's tests.
- **Do:**
  1. **Keep the task classes of your modes** and delete the others, with their branches in `LinkWorker.start` and `Link.Mode`. Write `Link.Mode` and `Link.Direction` (and their schema enums) with your values only.
     - **Input only:** `LinkInbox`, `TcpServerLinkTask` and the writer side are for output. Declare the connection's inbox as `Message` (`ConnectionSpec.of(name, Message.class)`, no inbox policy) and delete `LinkInbox`.
     - **Keep `closeOnStop` before `connect`,** as the template has it, so that a stop ends a connect that blocks.
  2. **The frames:** `LineFramer` cuts lines (NMEA 0183, SBS-1). Replace it if your frames are not lines, and set `LinkWorker.MAX_FRAME_BYTES` to your longest frame with a margin.
  3. **Parse in the task:** in `Inbound.frame`, call your parser from work package 1, count each refusal by its reason (`task.count("dropped: <reason>", 1)`), and send the parsed record in `TransportMsg.Received` instead of the text.
  4. **Wire the worker** in your plugin class, as `LinkWorker`'s class comment shows: spawn it in `init`, subscribe it to the settings in `start`, cancel that in `stop`.
  5. **The manifest:** declare `connections` (the `kinds` of your modes, the `direction`, `"settings": "/links"`, a JSON Pointer to the links in your settings, and the `reason`; the schema allows no other key). The connection covers the hosts an admin names, internet hosts included; declare `internet` only for the SDK's outbound HTTP (ADR-0036 point 7).
- **Hand over:** the plugin receives (or sends) frames over a real socket, and the worker gets parsed records.
- **Done when:**
  - a `TransportTest` of your own passes for your modes with your own frames: write it new rather than trim the template's six. A reconnect needs `task.awaitIdle()` and then `ctx.advance(back-off)` (virtual time), while the idle time is real time (the socket's read timeout);
  - `ArchitectureTest` passes (sockets only in the task classes and their nested classes).

### Work package 3: links and settings (ADR-0037)

- **Read:**
  - your brief, section 5;
  - the design pattern, section 5, "Links and output channels", and section 7, "Settings";
  - `docs/adr/0037-links-and-output-channels.md`;
  - the Javadoc of `LayerChoice` and, for output, `Channels` and `ClassificationLimit`;
  - `Link.java`'s settings schema;
  - for an example: `plugins/cot/plugin.json`, the `links` setting.
- **Do:**
  1. **The `links` setting** in `plugin.json`: the schema in `Link`'s Javadoc, inside `"links": {"type": "array", "default": [], "items": {...}}`, with a `description` on every property. Keep only the modes and directions your plugin offers.
  2. **Input links, with the SDK's `ObjectWriter`** (SDK 1.4.0; declare `^1.4.0`). It replaces the 600 lines `ais` wrote for this (T-147): create it in the links worker, give it the links' targets, and call `write(link, externalId, (stored, layerId) -> content)` for each record; the design pattern, section 5, shows the calls.
     - a `targetLayer` with the layer picker (`"x-emc2": {"kind": "layer"}`): from SDK 1.4.0 its "+" button makes the layer at once, so the setting holds its id;
     - the writer makes the layer when the setting names none or a layer that is gone, keeps it in its plugin document, and lets two links that name the same new layer share one; report each link's actual layer in your status (`ObjectWriter.stats`);
     - the writer creates and updates objects through change requests, one in flight per object, found again by `externalRef` after a restart. Your build function decides the content from the stored object, so a ship that two links receive keeps the label of the link that made it;
     - remove or expire what the peer no longer sends, as your brief says;
     - **your field set:** `writer.fieldSet("<plugin-id>.<name>")`, so that every object you write carries it from its create (ADR-0050 point 4);
     - **a symbol type per link,** where your brief offers one (only `ais` in M5, T-140): a link setting whose default is for new links, read as the old type when a stored link lacks it, so that existing links do not change.
  3. **Output links:**
     - `sourceLayers` (`"allowNew": false`) and `highestClassification`;
     - offer an output channel per link, naming your field set (`.fieldSet(...)`, SDK 1.4.0), with the kinds it takes (SDK 1.4.0: `GROUND_TRUTH`, `SENSOR_REPORTS` or both; ADR-0048 point 4); post each `ChannelItem` on to the link's task as a `LinkInbox.Send`, and map a `SensorReport`'s detections as your brief says;
     - never send an object whose `dataSource` is the link itself.
  4. **Settings changes at runtime:** `LinkWorker` already starts and stops tasks, but it restarts a task whenever the `Link` record differs. A changed layer, label or identity must not reconnect: compare only the connection's fields (`ais`'s `Link.sameConnection`), and give the writer the new targets.
- **Tests:**
  - give `FakePluginContext.builder(id).dataTypes(...)` your data types, or the store refuses every object (model rule 14);
  - a rig with the links switched off (`"enabled": false`, so no socket) and records put straight into the worker, as the task would, keeps the store tests free of sockets;
  - a restart is a second plugin on a context seeded with the first one's store content and documents (`cot`'s `CotPluginTest` shows it).
- **Hand over:** links that an admin sets up in the Settings list, and objects in their layers.
- **Done when:** tests with `FakePluginContext` show:
  - a link added, changed and removed at runtime;
  - received objects in the target layer, with the link as their data source;
  - "New layer" creating one layer, kept after a restart;
  - (output) channel items going out, and an object above the highest classification skipped and counted.

### Work package 4: status and counters

- **Read:**
  - your brief, section 6;
  - the design pattern, sections 8 and 9;
  - `LinkWorker.refreshStatus`;
  - ADR-0037 point 7.
- **Do:**
  1. **One status part per link:** its name, where it is (`Link.where()`), its state (up, connecting, listening and the clients, down with the reason, switched off, bad settings), and what it received or sent. `OK` when every enabled link runs, else `DEGRADED`. The detail is at most 512 characters.
  2. **Counters:** per task with `task.count` (frames in and out, each drop reason), and per link with `ref.count` for what the worker skips (not connected, above the classification). A task's counters are write-only for the worker, so a rate in the status counts what the worker sees.
  3. **"Per minute":** a one-second timer in the worker (`context.timers().every`) and a ring of 60 samples; the same tick can forget old state (`ais`'s `Rate`).
  4. **Warnings:** at most one a minute per link and reason (ADR-0037 point 7). Received data goes to the log at `debug` at most, and never whole objects (design pattern, section 9).
- **Hand over:** the monitor view and the status say what each link does, and why it does not.
- **Done when:** tests show the status for each state, and a counter for each drop reason.

### Work package 5: tests, and a check against reference data

- **Read:**
  - your brief, sections 7 and 8;
  - the design pattern, sections 10 and 11;
  - the reference data's sheet in `external/` (for `ais` and `adsb`: `external/playback/README.md`, and the port list in `external/README.md`).
- **Do:**
  1. **One test per acceptance criterion,** named after it (`criterion7_…`).
  2. **A replay test:** a few dozen frames of the reference data, through your parser and mapper, with the expected objects. Copy frames into the repository only if their licence allows it and the sheet names the licence; otherwise write frames of your own in the same format.
  3. **A live check, in two parts:**
     - **with real sockets and `FakePluginContext`:** start the ESA's playback with the commands in its sheet, point a link at it, and let it run for a few minutes (`ais`'s `LiveCheckTest`, which does nothing without `-Demc2.live=<port>:<seconds>,...`, can be copied);
     - **once in a live emc2** with a browser: start the server on the browser-check port the MCA gave you, with `--emc2.web.root` and `--emc2.data.directory` as absolute paths (else the web client is missing, 404 at `/`), set up a link in the Settings list, and see the objects on the map. Stop only the processes you started.

     For the first part, record in your handover: frames received, objects made, and drops by reason, against what the recording holds. Explain any drop you did not expect.
  4. **The README** (design pattern, section 11) and your handover.
- **Hand over:** a plugin ready for the conformance review and the MCA.
- **Done when:**
  - `mvn verify` for your plugin and `node tools/test.mjs` pass;
  - the live check is in your handover, and its counts make sense.

## 4. The brief of an in/out plugin

The PDA writes each in/out brief (owner, BY) with these sections, so that each work package finds its input:

1. **Purpose:** what the plugin does, input, output or both, and which tasks build it.
2. **Specification:** its name and version, where it is published, and the subset the plugin uses (message types, fields). What the plugin ignores.
3. **Mapping:** a table, one row per field used: where it comes from, the model field it goes to, the unit and conversion, and what is kept in the plugin's extension. The data type and the external system's name for `externalRef`. How objects end: expiry, or removal.
4. **Transport:** the modes from section 1, the framing, the largest frame, the limits (state across frames, its expiry), and the protocol's own checks (checksums).
5. **Links and settings:** the `links` entry (which modes and directions), the target or source layers, and the plugin's other settings with their defaults.
6. **Status and counters:** what the status says per link, and the drop reasons.
7. **Reference data:** the recording in `external/`, approved by the owner, and what a live check expects of it.
8. **Acceptance criteria:** numbered and testable.
9. **Out of scope.**

## 5. When the template's pattern is not enough

- **TLS for a TCP client:** `cot`'s `TcpLinkTask` takes the credentials from `task.tls(name)`; the keys stay local server configuration.
- **Multicast:** `cot`'s `DatagramLinkTask` joins a group on the interface an admin names (`ListenAddress.multicast`).
- **A peer that stops reading:** a provider's write can then block. `cot`'s `WriteWatch` notices a write that does not finish and restarts the link.
- **A new client must get the current picture:** send it from the worker when `TransportMsg.Up` arrives for that run.
- **Another framing** (length-prefixed, XML documents): `cot`'s `EventFramer` cuts a stream of XML events.
- **Sensor reports** (SDK 1.4.0; ADR-0048): an output that takes `SENSOR_REPORTS` gets `ChannelItem.SensorReport`, keyed by its sensor, so a slow output loses whole reports, which it counts. `cot`, `ais` and `adsb` send each detection as an ordinary position of the detected object; `gmti` sends dwells.

## 6. Where the playbook falls short

Write each gap in your handover, under "Playbook notes": the package, what was missing or wrong, and what you did instead. The PDA reads them, revises this playbook, and notes the version here.

**Versions:**
- **v1** (2026-10-30, T-093): first used for `ais` and `adsb`.
- **v2** (2026-11-05, CR-0030 part 1): the `ObjectWriter` in work package 3; input-only links; one record per kind of frame; values out of range left out (EM); the template's tests and comments to change; a new `TransportTest`; data types and a socket-free rig in the store tests; links that change without reconnecting; per-minute rates; the live check with `FakePluginContext` and once in a live emc2; output kinds and sensor reports. From PCA-ais's and PCA-adsb's notes.
- **v3** (2026-11-06, CR-0030 part 3; approved by the owner, IB): the field set in work packages 1 and 3 (ADR-0050), the writer's `fieldSet`, the channel's set, and a symbol type per link (T-140).
- **v3, corrected** (2026-11-16, the ACA's gap analysis G5): work package 2's manifest names the links with `"settings": "/links"`; it said `"links"`, which the manifest schema refuses.
