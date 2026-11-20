# Brief: cot

- Status: **Approved (2026-10-10)**, with the owner's answers to the four open questions (below) · Milestone: M1 · Task: T-040 · Agent: PCA-cot (started 2026-10-11, `pca-cot/plugin`)
- **Updated 2026-10-30 for M4: function 5's coalescing per link (T-115; owner, 2026-10-29, after the real TAK check), and function 17's callsign with criterion 30 (T-090; the owner's M4 notes, 2026-10-30).** **For the owner's approval.**
- **Updated 2026-11-06 for M5 (T-132, T-131, T-139; CR-0030 part 3, ADR-0050, ADR-0047): functions 23 to 25, criteria 32 to 36.** The field set `cot.unit` with the Callsign and every CoT unit field (T-131), the callsign in and out (ADR-0050 point 6), and vessel symbols out (ADR-0047 point 8). Built against SDK 1.4.0 part 3 (`^1.4.0`). **Approved by the owner (2026-11-06, IB).**
- **Updated 2026-10-31 to match the plugin** (the MCA's note from T-107): `writeStallSeconds` is one setting for all links, as PCA-cot built Z1, not `links[].writeStallSeconds`; so it is not greyed. Function 12, Settings, "M4: greyed link fields".
- **Updated 2026-10-30 for SDK 1.3.0 (CR-0028 part 5; T-107): greyed link fields** ("M4: greyed link fields" under Settings, criterion 31, Interfaces), and function 16's "Other fields" instead of the "+" (part 3). **For the owner's approval.**
- **Updated 2026-11-08 for the owner's LU and LV (PCA-cot's T-132 notes, `pca-cot/t132-field-sets` `138deb8f`): function 23, criteria 33 and 36.** A value outside `cot.unit`'s limits is left out of the set, as built; criterion 36's real-server check is the simulator's criterion 45. **Approved by the owner (2026-11-08, LU, LV).**
- **Updated 2026-11-09 for T-129 (owner, MD A and ME A, 2026-11-09): functions 26 to 29, criteria 37 to 43, open question 11, out of scope (M5).** cot sends and reads ATAK's format (`__milsym`, `unitmodifier`) and also reads WinTAK's (`mil2525c`, `amp`); 2525C ↔ APP-6D through mil-sym-ts's `c2d_default` and fixed tables checked against APP-6(E)(2) Annex A; no data model or SDK change. **For the owner's approval.**
- **Updated 2026-11-10 for M6 (T-165; CR-0038, SDK 1.5.0 part 1): function 30, the data type line under Settings, criterion 44.** The data type `cot.cot` names the set `cot.unit`, so the store gives it to every `cot.cot` object, a symbol placed by hand as CoT included. **Approved by the owner (NQ A, 2026-11-10)**; with Q31 A (NO A: a data type's sets go on symbols only) and Q32 A (NP A: SDK 1.5.0 from part 1).
- **Updated 2026-11-11 for M6 (T-155; CR-0039 points 10 and 11, approved by the owner, OB A; SDK 1.5.0 part 5): function 31, criterion 45.** A moved track stays where the user put it (ADR-0053 point 8). **Approved by the owner (2026-11-11, PR A).**
- **Updated 2026-11-11 for M7 (T-156; the M7 plan's Q1 A, the ACA's note on ADR-0010; CR-0041 part G): function 32, criterion 46.** `cot` declares the palette "CoT" from its APP-6D and APP-6E table. Waits for SDK 1.6.0 part G. **Category** (T-174): `data-links`. **Approved by the owner (2026-11-11, RJ A)**, with C1 accepted.
- **Updated 2026-11-17 for M9 (D6p, for PCA-cot's K1; ADR-0062 point 3; SDK 1.9.0 part P point 1, CR-0048): function 33, the setting `links[].tlsCredential`, criterion 47, out of scope (M9).** A `tls` link picks its TLS credential in Settings; empty uses the link's name, as before, so existing installations keep working. No data model change; the SDK calls do not change. **Approved by the owner (2026-11-17, AAQ A).**
- **Updated 2026-11-17 after the CDA's C3** (`cda/c3-tls-names` `e74ba83a`): function 33 names the keys `emc2.tls.<name>.*`, the form's select ("(the link's name)", the sorted names from `GET /api/settings/tls-credentials`, "<name> (missing)"), and an expired or unreadable credential refused by `task.tls` with an `IllegalStateException` that names the date, shown in the link's status.
- Read also: ADR-0023 (data types and data sources), ADR-0004 and overview 4.2 (listeners, C5, C6), ADR-0007 and ADR-0018 (extensions), `docs/architecture/ideas/atak-plugin-interop.md` sections 6.3, 7 and 11, `model/examples/valid/object-track-from-cot.json`.
- Updated 2026-10-10: one track from two streams (function 5; ACA review N3), approved by the owner at the SDK v1 freeze (2026-10-10).
- **Renamed 2026-10-11 from `cot-in` (owner's decision):** plugin id, extension namespace and folder `cot`, data type `cot.cot`. The plugin is to handle CoT both in and out; M1 builds only the ingoing side. New: "Later: outgoing" and criterion 13, approved by the owner (2026-10-11).
  - The frozen contracts still say `cot-in` in examples and descriptions (`model/`, Javadoc, SDK tests). They are examples only, not rules, and change with the next contract change. This brief wins.
- Updated 2026-10-14 for the owner's decisions of 2026-10-12 (PCA-cot session, built in `plugins/cot`): the callsign is also the symbol's `uniqueDesignation`, the whole `<detail>` is kept in the extension (function 4), and the presence event is on by default with the setting `sendPresence` (function 9, Settings).
- Built against **SDK v1 and data model 1.0.0** (T-034, CR-0010). SDK v1 is frozen (2026-10-10): where the name of an SDK call here differs, the SDK documentation wins.
- **M3 update (T-077, for T-084): approved by the owner on 2026-10-26,** after the ACA's review (T-078, `docs/architecture/reviews/m3-briefs.md`), with its nits C1 to C3 fixed: links in and out instead of streams, over a TCP client (with TLS), UDP and multicast on connection tasks; output channels; a highest classification per output link; declared fields (ADR-0036, ADR-0037, ADR-0038; the owner's answers of 2026-10-26 to open questions 6 to 9). New: "Functions (M3)", "Out of scope (M3)", the M3 settings and criteria 14 to 26. Built against **SDK 1.2.0 and data model 1.2.0** (frozen by the owner on 2026-10-26).
  - **Updated 2026-10-27 with the owner's decisions on PCA-cot's part 3** (decided, so approved): what a link remembers of channel items (function 19), the relayed echo as checked against the real TAK Server (function 19), channel items while a link is down (function 21), criteria 27 and 28. The final real TAK check of T-084 comes after the simulator's part B2 (owner; criteria 15 and 16). What the decisions left open is open question 10, decided by the owner on 2026-10-27 as the PDA read it.
  - **Updated 2026-10-28 with the owner's N1 and S1 on the echo** (decided, so approved; N1 and S1 of the echo finding, not the ACA's note N1 of function 13; T-084, built in `pca-cot/echo-uid`, merged as `dc1edf7`): the echo of a source-layer object is not stored (functions 19 and 22, criterion 16).
  - **Updated 2026-10-28 with the owner's Z1** (decided, so approved; for PCA-cot to build): a write stall check on every `out` or `both` link (functions 12 and 22, the setting `writeStallSeconds`, criterion 29). The same day the owner accepted the PDA's readings (AB) and amended it (AD1: a stalled link starts again at once, without the back-off; AE1: every write on the link is watched, the presence event's too).
  - **What M3 replaces:** links replace streams (functions 1, 7 and 8, and the settings), connection tasks replace the listener (functions 1, 2 and 9), and "Later: outgoing" is built. Functions 2 to 6 and 10 stay, with "stream" read as "input link". Criteria 1 to 13 stay in the same way (criteria 6, 7 and 8 included), except two. Criterion 11's listener gives way to criterion 26: the plugin opens its own sockets, in connection tasks only. Criterion 12 becomes "no link configured".

## Purpose

Receives **Cursor on Target (CoT)** from TAK systems and shows it on the shared map: units and markers sent by ATAK devices or a TAK Server appear for every user and move as new reports arrive (`requirements.md`, First demo: "CoT data received from a TAK system shown on the map"). Later it also sends emc2's objects to TAK systems as CoT ("Later: outgoing").

It is the first plugin with a **listener** (blocking network I/O in ECore, rule C6) and the first server part that creates and updates objects through the Java object access of SDK v1.

**In M3** it also sends: the objects of chosen layers, and what other plugins hand to its output channels, above all the simulator's tracks (ADR-0037, ADR-0040). The M3 demo sends the simulator's tracks to the ESA's TAK Server and receives them back into a View layer (Q20).

## Kind and parts

- Kind: **general** (it places objects). Properties: **ingoing** in M1 (push: the TAK system sends, emc2 listens); **outgoing** later ("Later: outgoing"). The M1 manifest lists only `ingoing`.
- Parts in M1: **server part only.** Its settings are edited in its entry in the Settings tab (ADR-0031, a form the shell generates from the manifest; in M1 a tab of its own). Its status per stream is shown in the monitor view through the plugin status.
- **M3:** properties **ingoing and outgoing** (the manifest lists both). Still a server part only: its links are edited in the Settings tab, with the shell's layer picker (ADR-0037), and each link shows in the monitor view.

## Functions (M1)

1. **Streams.** The plugin connects to each configured **stream**. A stream is one connection to one TAK system:
   - a name, which is the objects' **data source** (ADR-0023), e.g. `tak-north`;
   - host and port of a TAK Server's CoT streaming input, as a TCP client;
   - the transport: `tcp` (plain), or `tls` with a client certificate (TAK Server's usual port 8089). Certificates and their passwords are **local server configuration**, referenced by the stream name. They are never in the repository, never in the settings sent to a browser, and never logged;
   - enabled or not.

   The connection is opened and read through an SDK v1 **listener**. The plugin opens no socket itself (C6).
   - **Who may point it where:** ECore lets the plugin reach only the hosts and ports of its configured streams. Only a user with `settings.admin` can change the streams.
   - In M1 ECore does not restrict which addresses may be configured, so an administrator could point a stream at any host. This is for the SRA's review (T-046), and for the owner if a restriction (e.g. to configured address ranges) is wanted.
2. **Reading CoT.** A stream carries CoT XML events (`<event>…</event>`, TAK protocol version 0), one after another without a separator.
   - **The listener** splits the stream into events and parses each one with the JDK's own XML parser, with DTDs and external entities **switched off** (no XXE). It sends each parsed event to the plugin's worker as an immutable message keyed by uid (function 5). The listener never touches objects or the worker's state.
   - An event larger than 64 KiB, or one that does not parse, is dropped and counted; the stream continues. Warnings are logged at most once per minute per stream.
   - TAK protocol version 1 (protobuf) is not used: the plugin never asks the server to switch.
3. **Data type.** The plugin declares **one data type in its manifest**: `cot.cot`, display name "CoT", with its default behaviour (function 6). Every object it creates has `dataType` `cot.cot` and `dataSource` set to the stream's name.
4. **Mapping** (from `docs/architecture/ideas/atak-plugin-interop.md`, section 7):
   - **Which events become objects:** atoms (`a-…`, e.g. `a-f-G-U-C-I`) and map points (`b-m-p-…`). Other types (chat `b-t-f`, tasking `t-…`, drawings `u-d-…`, pings `t-x-c-t`) are counted and dropped in M1.
   - **Object type:** `core.symbol`.
     - An atom's SIDC is derived from its CoT type: affiliation, battle dimension and function in the MIL-STD-2525B style, as an **APP-6B** 15-character SIDC. Validate it with the same rules as `symbology` (a closed list in a table in the plugin; unknown functions fall back to the battle dimension's generic symbol).
     - A map point gets a generic point SIDC.
     - The original CoT type is kept in the extension.
   - **Position:** `point/@lon`, `@lat` → `[lon, lat]`; `@hae` → altitude, left out when CoT marks it unknown (`9999999.0`). Latitude ≠ longitude in every test.
   - **Text and movement:** `detail/contact/@callsign` → `properties.name`, and also the symbol's modifier `uniqueDesignation`, the text next to the symbol (owner, 2026-10-12); `detail/remarks` → `properties.description`; `detail/track/@course` and `@speed` → modifiers `direction` (degrees from true north) and `speed` (m/s).
   - **Time** (data model 1.0.0 time attributes): `@time` → the observation time, `@start` → valid from, `@stale` → the expiry.
   - **Everything else, unchanged, in the plugin's own extension `cot`:** `type`, `how`, `version`, `access`, `qos`, `opex`, `caveat`, `releasableTo`, `ce`, `le`, and the whole `<detail>` as XML text, exactly as received (owner, 2026-10-12). It includes `contact`, `remarks` and `track`, which are also mapped to core fields, because they carry attributes the core has no field for. This keeps CoT lossless for the outgoing side later ("Later: outgoing"; interop note, section 11). No other namespace is written; other plugins' extensions on an object are forwarded untouched (ADR-0018).
   - **Label:** the stream's configured label, by default the server's default label. Mapping CoT `access`, `caveat` and `releasableTo` to STANAG 4774 labels comes with access by label (after M1). Until then the raw values stay in the extension.
5. **Identity and updates.**
   - The object's external identity is `meta.externalRef` = `{system: "cot", id: <event uid>}`, set through SDK v1 when the object is created. A CoT uid is meant to be globally unique, so the same uid on two streams is **one** object.
     - Its `dataSource` stays the stream that created it, and so does its layer: an event from another stream updates it in place and never moves it.
     - This deliberately differs from the interop note's draft (`tak:<source>`, section 7), which would make one object per stream. `meta.created.by.system` and `meta.modified.by.system` still name the stream each change came from.
     - **Consequence for filters:** hiding one data source (later, ADR-0023) also hides tracks that another stream reports too, because such a track keeps the first stream's `dataSource`. The README says so.
   - An event whose uid is known **updates** the object: the complete core content, with `baseVersion`, as for every update (model rule 5). An event for an unknown uid **creates** one, with a new UUID v7 id.
   - An event older than the last one applied for that uid (by `@time`) is dropped, so a late or repeated event never moves an object back.
   - Events for the same uid **from the same link** are **coalesced** in the worker's mailbox (latest wins; owner, 2026-10-29), so a burst from one device costs one change request, and one link's event never replaces another link's there.
   - **At start** the plugin finds its existing objects through the SDK's object access (by `externalRef`), so a restart never duplicates objects.
   - **Objects changed by emc2 users** (with `objects.edit`): allowed. The next event for that uid overwrites the core fields (last write wins). A deleted object is created again by the next event for its uid.
6. **Expiry** (ADR-0023 point 7). The plugin sets the expiry from `@stale`. What happens after it is ECore's behaviour **per data type**, set in the Settings tab's "Data types" entry (ADR-0031). The plugin declares the defaults for `cot.cot`:
   - shown **faded** from the expiry on (ADR-0023);
   - **removed** 10 minutes after the expiry, **by ECore** (owner, 2026-10-10: open question 1). `cot` only declares the default; it never deletes expired objects itself.
7. **Layer.** Each stream's objects go into the stream's layer. Its name comes from the stream's settings, by default the stream's name. The plugin creates the layer if it does not exist, on top, with the stream's label, and keeps the layer's id in a plugin document (persistence manager). If the layer was deleted (only an empty one can be), it is created again at the next event.
8. **Connection handling.**
   - A failed or lost connection is retried with a growing delay: 1 s, doubling, at most 60 s.
   - A stream that sends nothing for the configured idle time (default 5 min) is closed and reconnected.
   - A failure in one stream never affects the others or other plugins.
   - **Status per stream** in the plugin status (monitor view): connected or not, since when, events received, objects created and updated, events dropped (and why), the last error.
9. **Announcing itself** (owner, 2026-10-10: open question 4). Some TAK Servers send a client nothing until it has sent one event. The plugin sends one presence event per connection on the same connection (a `t-x-c-t` ping with a configurable callsign), through the listener's write (CR-0010, item 8). It sends nothing else. **The presence event is on by default and can be switched off** with the setting `sendPresence` (owner, 2026-10-12), for a TAK Server that does not need it. Whether the real TAK Server needs it is checked by hand against a real TAK Server, for the M2 demo (owner, 2026-10-14).
10. **Load.** One plugin handles at least **1 000 events per second** over **10 000 uids** without falling behind. It stays within the caps on outstanding asks and active timers (CR-0005) and the object store's limits on change requests. The PCA measures it and records the result in the README.

## Functions (M3)

Read with ADR-0036 (connection tasks), ADR-0037 (links and output channels), ADR-0038 (declared fields), ADR-0039 (workspaces), the design pattern's sections on connection tasks and links, and `sdk-v1.md`, "SDK 1.2.0". Where an SDK name here differs from the SDK, the SDK wins.

11. **Links replace streams** (ADR-0037 point 1, A6). A **link** is one configured connection, an entry in the setting `links`:
    - **a name**, the link's key. It is the data source of what it receives (ADR-0023), the name of its TLS credentials unless the link picks one (M9, function 33), its entry in the status, and its output channel's id `cot/<name>`. It follows the M1 pattern for stream names; `manual` is reserved;
    - **a direction:** `in`, `out` or `both`. "Both" uses one connection, as TAK clients do;
    - **a transport** (function 12), and whether it is enabled.

    **No migration** (owner, 2026-10-26: open question 6). Stored `streams` entries from M1 and M2 are no longer read, and the manifest no longer has `streams`. If the stored settings still hold any, the plugin starts and says in its status that streams are no longer read and must be entered as links. So that it can see them, the M3 settings schema keeps its top level open (no `"additionalProperties": false`). ECore uses stored settings only if they validate against it. The layers the streams made stay as they are, so an admin can pick one as a link's target layer. (ADR-0037's index row records this choice, replacing the Consequences' clause on migrating the `streams` entries: `docs/adr/README.md`, `ff39a4f` on `main`.)
12. **Transports** (Q5, ADR-0036). **Every connection runs in a connection task**, and the plugin opens its sockets only there. The deprecated listener is no longer used, and the manifest declares `connections` (kinds `tcp-client`, `udp`, `multicast`; direction both; the pointer `/links`; the reason) instead of `network`.
    - **`tcp` and `tls`:** a TCP client to `host`:`port`, such as a TAK Server's streaming input. `in`, `out` and `both` use the one connection.
      - **TLS** uses a client certificate from local server configuration, named like the link (`task.tls(name)`; the same names as the M1 streams' credentials). The peer's certificate must name the host (`server/README.md`). **From M9 the link may pick its credential by name instead (function 33).**
      - Framing and parsing are as in function 2.
      - **The presence event** (function 9) is sent through the task on each connection of an `in` or `both` link.
      - The idle time (function 8) applies to `in` and `both` links.
    - **`udp`:** one datagram carries one event.
      - **`in`:** listens on `address`:`port`, read with `ListenAddress.from(link)`. That means loopback, unless an admin sets another address.
      - **`out`:** sends to `host`:`port`.
      - **`both`:** one socket bound to `address`:`port`, which also sends to `host`:`port`. The local and the remote port are therefore the same, as for peers of one SA network.
        **A test peer on the same host binds another address,** for example `127.0.0.2`, so that the link does not send to itself (the PCA's and the ITA's tests).
      - A datagram larger than the maximum event size is dropped and counted.
    - **`multicast`:** the group `address` and `port`, for example TAK's mesh SA, `239.2.3.1`:`6969`, on an `interface` that an admin names (`ListenAddress.multicast(link)`, R4). `in` joins the group, `out` sends to it, and `both` does both. **Without an interface the link stays stopped**, and its status says so.
    - **Restarts:** a failed or lost connection is restarted by ECore with the back-off of function 8 (1 s, doubling, at most 60 s); a write stall is restarted at once (below). One link failing never affects another.
    - **A write stall** (owner, 2026-10-28: Z1). While an `out` or `both` link is up, its worker watches **every write on the link**: the events it posted to the link's task, and the presence event of function 9 too, which a `both` link sends (owner, 2026-10-28: AE1). When they show no written progress for `writeStallSeconds` (default 60 s, 5 to 3 600; one setting for every link, as PCA-cot built it), that is, a write waits and none has completed for that long, the worker stops the link and **starts it again at once, without the back-off** (owner, 2026-10-28: AD1). Each stall takes the full `writeStallSeconds` again, at least 5 s, so a peer that never reads restarts the link no more often than that. The link's status says "write stalled, reconnecting", and its count "write stalls" rises by one. When the link is up again, all objects are sent again, as when the link starts (function 14), at the connection's pace (function 21): the link first forgets the last event it sent of each source-layer object (function 19), so none is held back as unchanged.
      - **Not a stall:** a slow peer whose reads let each write complete within `writeStallSeconds`, and a link with nothing to send. A UDP or multicast send never waits for a peer, so in practice the check fires on `tcp` and `tls` links.
      - **What the SDK gives for it** (SDK 1.2.0, no change): the worker cannot read the task's counters, so the task tells the worker by message of its writes, the presence event's included, and the worker checks with its per-link timer (function 18; the caps of CR-0005). `ConnectionRef.stop()` closes what the task registered, so a blocked write ends, and no restart follows: the worker starts the new task under the same name at once (AD1). ECore's counters belong to one task, so the worker carries the count "write stalls" over to the new one.
      - **Channel items waiting** in the stopped task's inbox (function 21) are lost with it; a sender's next item stands in for them (function 18).
      - **Why:** a write has no timeout, so a peer that stops reading, a real TAK Server included, would otherwise hang the link for good (PCA-cot's point in CR-0027's impact; that CR's own stall was a JDK bug, fixed by platform threads).
    - **Hosts, ports and groups come only from the link's settings**, never from a message, a received event or an object's data (ADR-0030, ADR-0036 point 3).
13. **Input** (ADR-0037 point 2, Q6). An `in` or `both` link writes into **its target layer**. The admin picks it with the layer picker: one of View's layers (ADR-0039 point 6), or "New layer" with a name.
    - **Reading, mapping, identity and expiry are those of functions 2 to 6,** with "stream" read as "link". A uid already known from another link keeps that link's layer and data source (function 5).
    - **Two links that name the same new layer share one** (ACA note N1).
    - **The plugin keeps the link's actual layer** in its plugin document, makes it again at the next event if it was deleted, and **reports it in the status**, since the setting keeps saying "New layer" (N1).
    - **The layer and the objects get the link's `label`**, by default the server's default label.
    - **Received `__group`** sets the declared fields `team` and `role` (function 16).
14. **Output from source layers** (ADR-0037 point 3). An `out` or `both` link sends the objects of its `sourceLayers`, picked with the layer picker (existing layers only, `"allowNew": false`).
    - **When the link starts,** it sends the layers' current objects. The subscription may deliver a new snapshot after a gap. Objects that were sent but are missing from it are then sent as stale at once.
    - **Then it sends each create and update as an event.**
    - **An object that leaves what the link sends** is sent as an event that is stale at once. That covers an object that is deleted, one moved to another layer, and one now above the link's highest classification (function 20).
    - **An object is never sent back to the link it came from:** not when its `dataSource` is the link, nor when its last change came in on the link (`meta.modified.by.system`).
    - **The plugin's store queries name the workspace** (`inWorkspaces("core.view")`, ACA note N9), since a query without one means every workspace.
15. **Output channel** (ADR-0037 point 4). Every enabled `out` or `both` link is offered as an output channel (`context.channels().offer`):
    - **What it offers:** the id `cot/<link>`, the link's name as display name, output type `cot`, the capability `DELETE`, and the declared fields of function 16.
    - **What it sends:** an `Update` goes out as an event (function 17), and a `Removal` as an event that is stale at once, when the link still remembers the item (function 19); otherwise it sends nothing.
    - **Changes to the link:** a link that is disabled or removed withdraws its channel. A renamed link withdraws the old id and offers the new one, so a sender that saved the old id shows it as missing (N8; the simulator's brief).
16. **Declared fields** (ADR-0038; owner, 2026-10-26: open question 7). The manifest declares three fields in the namespace `cot`, all editable by others, without `dataTypes` (so they belong to every object and are offered under "Other fields" in the shared editor; the "+" before SDK 1.3.0):

    | Field | Type | Values |
    |---|---|---|
    | `team` | choice | TAK's team colours: White, Yellow, Orange, Magenta, Red, Maroon, Purple, Dark Blue, Blue, Cyan, Teal, Green, Dark Green, Brown. Each value is TAK's exact `__group/@name` string, and the label is the same |
    | `role` | choice | TAK's roles: Team Member, Team Lead, HQ, Sniper, Medic, Forward Observer, RTO, K9. Each value is TAK's exact `__group/@role` string, and the label is the same |
    | `staleSeconds` | integer, unit `s`, 1 to 86 400 | The stale time of what is sent for this object (function 18) |

    - **Receiving:** a received `__group`'s `@name` and `@role` set `team` and `role`. A value outside the choices stays only in the raw `detail`, and an event without `__group` leaves both fields as they are.
    - **Sending:** `team` and `role` go out as `__group`. The channel names all three fields, so a sender such as the simulator can offer them.
17. **Mapping an object to CoT** (Q7; "Later: outgoing", points 1 and 2). The codec's object → CoT direction, in the same codec as function 4 (criterion 13). **M3 sends symbols only:** a `core.symbol` with a point. Anything else is skipped and counted (function 21).
    - **Type:** `a-<affiliation>-<dimension>-<function>`, from the SIDC.
      - APP-6B uses the M1 table in reverse.
      - APP-6D and APP-6E (APP-6D is `draw-symbols`' default) use the standard identity, the symbol set and the entity, through a closed table in the plugin.
      - A function CoT lacks falls back to its parent, then to the dimension's generic symbol. A symbol set with no CoT dimension is skipped ("no CoT type").
      - An object that came from CoT, with its SIDC unchanged, keeps the type in its extension.
    - **Identity:** the uid is the `externalRef` id for objects that came from CoT, and the object id for the others.
    - **Position:** `[lon, lat]` gives `point/@lon` and `@lat`. The altitude gives `@hae`, else `9999999.0`. `ce` and `le` come from the extension, else `9999999.0`.
    - **Times:** `@time` and `@start` are the sending time, and `@stale` follows function 18. For a channel item that waited while its link was down (function 21), "their own times" means (open question 10, decided): `@time` and `@start` are when it was handed to the channel, and function 18's "now" is that time too, so one without an expiry arrives stale after a long outage (function 21). `how` comes from the extension, else `h-e`.
    - **`<detail>`:**
      - For an object that came from CoT, the raw `detail` from the extension, with the changed core values and the declared fields put over it: `contact/@callsign`, `remarks`, `track/@course` and `@speed`, and `__group`.
      - For other objects, built from `properties.name` (else the `uniqueDesignation` modifier), `properties.description`, the modifiers `direction` and `speed`, and `team` and `role`.
    - **The callsign** (`contact/@callsign`) is the object's name, `properties.name`, else its `uniqueDesignation`, for every object sent: from a source layer and from a channel, such as the simulator's tracks (the owner's M4 notes, 2026-10-30). An object with neither is sent without one.
    - **Label:** `access`, `caveat` and `releasableTo` come from the extension when the object came from CoT. Otherwise there are none (mapping STANAG 4774 labels comes with access by label).
18. **Stale time and refresh** (A8; owner, 2026-10-26: open question 8, as amended).
    - **`@stale` is the first of these that applies:**
      - the object's expiry, if it is in the future;
      - else now plus the object's `staleSeconds`;
      - else now plus the link's `staleSeconds` (default 60 s).
    - **An object whose expiry has passed** is not sent again.
    - **Refresh:** the link's setting `refreshSeconds` (default 30 s) keeps TAK from showing a static marker as stale.
      - **What is sent again:** an object from a source layer, when nothing was sent for it on that link within `refreshSeconds`. A change sent resets that time.
      - **With or without an expiry,** until the expiry has passed.
      - **`0` means only changes go out.**
      - **One timer per link** drives it, not one per object (the caps of CR-0005). It fires often enough for the refresh to be on time, for example every second.
      - **Channel items are not refreshed:** a sender's next item is the refresh. So the tracks of a paused simulation go stale in TAK.
    - **The link's status warns** when `refreshSeconds` is `0`, or longer than the stale time it uses (the link's `staleSeconds`; the setting is checked, not each object), since static markers then go stale in TAK.
    - **A8's short stale time** for simulated tracks comes from the sender: the simulator sets its tracks' expiry or `staleSeconds` (its brief). Otherwise an admin shortens the link's `staleSeconds`; its default of 60 s is not short.
19. **Only real changes go out** (owner, 2026-10-26: open question 9). An output link sends an **object from its source layers** again only when the event it would send differs from the last one it sent on that link. **Channel items always go out as they come** (owner, 2026-10-26): a sender such as the simulator sends its standing tracks every second with the same content, and its next item is their refresh (function 18). Echo loops come from source layers, not from a sender. The comparison leaves out `@time`, `@start` and `@stale`, and the `<_flow-tags_>` that TAK Servers add when they relay.
    - **There are two exceptions:** the refresh of function 18 (an object sent again after `refreshSeconds` without a change), and an event that is stale at once (functions 14 and 15). Such an event always goes out. For a source-layer object it also clears the last event the link remembers having sent of it, so that an object that comes back is sent again (the uid it remembers against echoes stays, below).
    - **Of channel items** (owner, 2026-10-27) the link remembers the uid, CoT type and position of each item it sent, until that item's stale time (each refresh renews it), at most 200 000 per link. That is only so that a removal goes out as an event that is stale at once. Past the cap an item is sent, but its removal is not, and it is counted as "removal not kept" (function 21) when it is sent without being kept (open question 10, decided). A `Removal` for an item the link does not remember, for any reason (past the cap, past its stale time, never sent), sends nothing and is not counted.
    - **The echo of a source-layer object is not stored** (owner, 2026-10-28: N1 and S1). The plugin remembers the uid of each object from a source layer that any output link sent, with the layer it was sent from, until the sent event's stale time plus 60 s (for an event that is stale at once, 60 s from the send); each send renews it. It remembers at most 200 000 for all links together; past that, the uid that has gone longest without a send is forgotten, and its echo is stored as before. An incoming event with such a uid, on any input link, is the **echo** when that link's target layer is that same layer and no object is stored under that uid there: it is not stored, and is counted as "N echoes ignored" in the input link's status. Channel items and relayed CoT uids are not remembered, so criterion 15's round trip, also into another layer, keeps working. **Why:** with an echoing TAK network, the echo of a new object was otherwise stored as a second object, so a create went out twice before the echo stopped (the ITA's finding b, criterion 16).
    - **Checked against the real TAK Server** (PCA-cot; owner, 2026-10-27): a relayed echo differs only in the `<_flow-tags_>` and a whole-second `@time`, both left out of the comparison, and TAK drops a re-send that carries its own flow tag.
    - **Why:** an echo, such as an output to a TAK Server whose source layer is the target of an input from the same TAK network, then changes only the observed time and is not sent again, so a loop dies at once.
    - **Relaying** between two different TAK networks still works.
20. **Highest classification** (ADR-0037 point 8, Q30). Every `out` or `both` link has the setting `highestClassification`. When it is absent, the classification of the server's default label is used.
    - **The check** is `context.classifications().within(label, limit)`, with the limit read by `ClassificationLimit.from`. It covers objects from source layers and channel items alike (an item's label).
    - **What is skipped:** an object above the limit, of another policy, or with a classification outside the order.
    - **An unknown limit:** if `classifications().knows(limit)` is false, nothing passes, and the status says so.
21. **Rate and skips** (ADR-0037 points 6 and 7, Q4).
    - **An output sends at its connection's pace.** Its task's inbox coalesces by object id (the latest wins), never a growing queue.
    - **While a link is down** (owner, 2026-10-27), channel items for it wait in its task's inbox, one per object (a removal replaces a waiting update), at most 20 000. They go out with their own times when the link is up again, so after a long outage those without an expiry arrive stale (functions 17 and 18). Decided with open question 10 (owner, 2026-10-27):
      - while a link is down, the worker posts items for at most 20 000 objects; an item for another object is not posted, and is counted as "dropped" (the coalescing inbox would evict its oldest item without telling the worker, so the worker holds back the 20 001st object itself);
      - a waiting removal whose update was never sent sends nothing, and still clears the waiting update;
      - an item whose expiry passes while it waits is skipped as "expired" (function 18). One still within its expiry gets that expiry as its stale time, so it is not stale. An item with no expiry arrives stale if it waited longer than its `staleSeconds`. The simulator's tracks carry an expiry, so after a long outage they are skipped, and TAK lets them go stale itself.
    - **Skips are counted** per link and reason: not a symbol, no CoT type, above the highest classification, unknown limit, expired, "removal not kept" (function 19), and "dropped" (past 20 000 waiting objects). They show in the status and the monitor view (`ConnectionRef.count`), and are logged at most once a minute per link.
    - **The target:** the simulator's 1 000 tracks at 1 Hz on one `tcp` link, without a growing backlog (criterion 25).
22. **Status per link** (ADR-0036 point 6). The status shows, per link:
    - its direction and transport, and ECore's state;
    - the peer, or the address it listens on;
    - events in and out, with their rates;
    - the objects created and updated;
    - what was dropped and skipped, and why;
    - for an input link, the echoes ignored (function 19; owner, 2026-10-28);
    - for an output link, "write stalled, reconnecting" while it restarts after a write stall, and the count of write stalls (function 12; owner, 2026-10-28: Z1);
    - the actual target layer (N1);
    - the refresh warning of function 18;
    - the last error.

    Without a link the plugin starts, does nothing, and reports "no link configured".

## Functions (M5)

Built against SDK 1.4.0 part 3 (`sdk-v1.md`, "SDK 1.4.0", part 3). Where these differ from functions 4, 16 and 17, these win.

23. **The field set `cot.unit`** (ADR-0050 points 1, 4 and 6; T-132, T-131). The manifest declares the set `{ "id": "unit", "label": "CoT unit", "fields": ["callsign", "team", "role", "staleSeconds", "how", "ce", "le"] }` and four more fields, all editable by others and without `dataTypes`, as function 16's:

    | Field | Type | Values |
    |---|---|---|
    | `callsign` | text, at most 64 | The CoT callsign, `contact/@callsign`, separate from the object's Name (function 24) |
    | `how` | text, at most 16 | CoT's `@how`, e.g. `h-e` (human, estimated) or `m-g` (machine, GPS); the README lists the common values |
    | `ce` | number, unit `m`, 0 to 9 999 999 | The circular error; 9 999 999 is CoT's "unknown" |
    | `le` | number, unit `m`, 0 to 9 999 999 | The linear error; the same |

    - **The keys are the extension's own:** `how`, `ce` and `le` have been in `extensions.cot` since M1 (function 4), so the objects stored before show their values at once. `team`, `role` and `staleSeconds` stay as function 16 has them.
    - **A value outside the set's limits is left out of the set** (owner, LU, 2026-11-08): a callsign over 64 characters, a `how` over 16, a `ce` or `le` that is not a number or is outside 0 to 9 999 999. The object is still stored, its Name and its raw `detail` keep what was received, and what is sent falls back to function 24's defaults. The object store checks a declared field's limits only when a change request names the field (an editor); what a plugin writes in its own namespace it keeps within its declarations itself.
    - **Every CoT unit field editable** (T-131): through the set, every field above can be set on a manual symbol (`draw-symbols` function 27) and on a simulator track. The symbol's SIDC amplifiers are not fields: they are the symbol's own, and go to and from TAK with T-129 (functions 26 to 29).
    - **Received objects carry the set from the start** (ADR-0050 point 4; the ACA's R8 on CR-0030): `cot` writes without the `ObjectWriter`, so it adds `cot.unit` to the content of every create and update it builds (`content.withFieldSet("cot.unit")`). An object created before M5 gets it at its next event. If `cot` moves to the writer, `writer.fieldSet("cot.unit")` does it.
    - **Relations forwarded** (CR-0031; the ACA's R1): every update `cot` builds carries the stored object's `relations` (and its sets), since an update replaces the list (model rule 5), as `draw-symbols` function 29 does.
    - **The channel names the set** (ADR-0050 point 7): `ChannelSpec....fieldSet("cot.unit")`. Its `fields` (function 15) stay until the simulator reads `fieldSet`.
24. **The callsign** (ADR-0050 point 6; FS to FW):
    - **In:** `contact/@callsign` sets `cot.callsign`, and also `properties.name` and `uniqueDesignation`, as function 4 has it.
    - **Out:** `contact/@callsign` is `cot.callsign`, else `properties.name`, else `uniqueDesignation` (function 17's rule with the Callsign first). A Name that depends on the outgoing format comes in a later milestone.
    - **Out, the other fields:** `@how` is `cot.how`, else `h-e`; `point/@ce` and `@le` are `cot.ce` and `cot.le`, else 9 999 999, for every object sent, not only those that came from CoT.
25. **Vessel symbols out** (ADR-0047 point 8; T-139): a `core.symbol` with `standard` `vessel` goes out as a surface unit of its identity, `a-<affiliation>-S`, the affiliation from the code's identity digit: 0 `p`, 1 `u`, 2 `a`, 3 `f`, 4 `n`, 5 `s`, 6 `h`. Its context digit is not sent. Incoming CoT stays APP-6 (function 4).

### T-129: the full symbol code and its amplifiers (owner, MD A and ME A, 2026-11-09)

**Formats** (recordings: ATAK-CIV 5.6 in `pca-cot/t129-wintak` `2ebf1ca8`; WinTAK in `pca-cot/m5-track-d` `5194c4c0`). **cot sends and reads ATAK's format and also reads WinTAK's** (owner, MD A):
- **ATAK:** `<__milsym id="SFG*U-----*E***">`, a 15-character MIL-STD-2525C code, with the amplifiers as children, `<unitmodifier code="C">12</unitmodifier>`; `<__milicon id>` is the same element again. The echelon is only the code's 12th character (the type stays `a-f-G-U`); present is `*` in the 4th, planned `A`. Its `<remarks/>` is empty.
- **WinTAK:** `<mil2525c SIDC="SFGPUCI----F---"/>`, the amplifiers in `<amp unique_designation="…" higher_formation="…" quantity="…" status="…"/>`, the same facts as text in `<remarks>`, and a suffix on the type (`a-f-G-U-C-I-C`).

The code is converted to **APP-6D** on arrival and back to 2525C when sent (function 29). **No data model or SDK change:** the code goes into `symbol.sidc` and the amplifiers into `symbol.modifiers`, both as in data model 1.0.0. The sending half is checked on the owner's ATAK in M5 (criterion 43).

**What cot does today** with an arriving `__milsym` and `unitmodifier` (cot's code at `integration/sdk-v1.4` `d2de9e3e`; nothing else in emcc reads CoT): **it ignores them.** The symbol comes from the type alone (`CotSymbols`, function 4): `a-f-G-U` is the APP-6B `SFGPU----------`, a plain land unit with no echelon; `a-f-G-E` is `SFGPE----------`; `a-s-G-U` is `SSGPU----------`. Of the amplifiers only `uniqueDesignation` is set, from the callsign. `__milsym`, `__milicon` and their `unitmodifier`s stay unread in the raw `detail` (`extensions.cot`), and go out again unchanged with it when the object is sent back unchanged (function 17). So an echelon or an amplifier on emcc's map cannot have come from them.

26. **The symbol code in.** Where these differ from function 4, these win.
    - **Which element:** `__milsym/@id`, else `__milicon/@id`, else `mil2525c/@SIDC`, upper-cased. Without one, or when function 29 cannot convert it, the symbol comes from the type as today, and the raw `detail` keeps the element.
    - **The symbol:** `standard` `APP-6D`, `sidc` function 29's conversion. The CoT `type` stays in the extension, and still gives the type sent for the unchanged object (function 17).
    - **ATAK's plain unit** `S*G*U-----` is a land unit with no function, entity `000000`, plus its echelon, **not** `110000` Command and Control as `c2d_default` has it (owner, ME A).
    - **WinTAK's type suffix is not read:** the code carries the echelon. Without a code, a suffix the closed table lacks falls back to its parent, as today, so `a-f-G-U-C-I-C` stays infantry.
27. **The amplifiers in.** Each sets a text modifier of the model; the letters are the amplifier field IDs that milsymbol names in its options (ADR-0010), the same letters in 2525C:

    | ATAK `unitmodifier/@code` | Modifier | | ATAK `unitmodifier/@code` | Modifier |
    |---|---|---|---|---|
    | `C` | `quantity` (recorded) | | `P` | `iffSif` |
    | `F` | `reinforcedReduced` (recorded, `+` or `-`) | | `R2` | `sigint` |
    | `G` | `staffComments` | | `T` | `uniqueDesignation` (recorded) |
    | `H` | `additionalInformation` | | `V` | `type` |
    | `J` | `evaluationRating` | | `W` | `dtg` |
    | `K` | `combatEffectiveness` | | `X` | `altitudeDepth` |
    | `L` | `signatureEquipment` | | `Y` | `location` |
    | `M` | `higherFormation` (recorded) | | `AA` | `specialHeadquarters` |
    | `N` | `hostile` | | `AD`, `AE`, `AF`, `AG`, `AO` | `platformType`, `equipmentTeardownTime`, `commonIdentifier`, `auxiliaryEquipmentIndicator`, `engagementBar` |

    - **WinTAK's `<amp>`:** an attribute whose name in camelCase is one of these modifiers sets it (`unique_designation` → `uniqueDesignation`, `higher_formation` → `higherFormation`, `quantity`); `status` sets `combatEffectiveness`. `__milsym`'s `unitmodifier`s win over `<amp>`.
    - **Left out**, kept in the raw `detail`: a code or attribute not in the table (among them `AH`, `AI`, `AQ` and `AR`, which mean something else in 2525C or are not in it, and `Q` and `Z`, which come from `track`), the graphics' amplifiers, and a value that is empty (ATAK's empty `F`) or over 128 characters (the model's limit; as LU).
    - **`uniqueDesignation` (`T`) wins over the callsign**; the callsign still sets `cot.callsign` and the Name (function 24). Without `T`, `uniqueDesignation` is the callsign, as today.
    - **`<remarks>` stays the description** (function 4) and is not parsed: WinTAK writes there as text what `<amp>` has, and the two can differ (S4: `status="Excellent"`, "Status: Green").
    - **An event without amplifiers** leaves none: an update replaces the symbol, so amplifiers set in emcc are overwritten by the next event (last write wins, function 5).
28. **Out, in ATAK's format.** Every `core.symbol` that function 17 sends gets, besides its CoT type:
    - **`<__milsym id>`** with function 29's 2525C code, in ATAK's form (`*` for an empty position: `SFG*U-----*E***`), and **`<__milicon id>`** the same, as ATAK sends both. An APP-6B code goes out as stored. A vessel (function 25) and a code function 29 cannot convert get neither.
    - **A `<unitmodifier code>` child** for each text modifier in function 27's table that is set, in the table's order.
    - **The type:** function 17's, unchanged; no WinTAK suffix. WinTAK's format (`mil2525c`, `amp`, the suffix) is not sent.
    - **Over the raw `detail`:** for an object that came from CoT, the new `__milsym` and `__milicon` replace the received ones, and a received `mil2525c` and `amp` are taken out, so that what goes out never contradicts itself after an edit in emcc.
29. **The mapping between 2525C and APP-6D or APP-6E.** Three sources, each checked:
    - **The symbol (2525C positions 1, 3 and 5 to 10 ↔ APP-6D's symbol set, entity and sectors 1 and 2):** mil-sym-ts 2.10.9's table `c2d_default` (1 955 records, each a 2525C basic id such as `S*G*UCI---*****` with its `ss`, `ec`, `s1`, `s2` and version), read from the repository's own `node_modules` by a script in `plugins/cot` into a committed, generated Java table, as `CotSymbolsNumeric` is (function 17). mil-sym-ts is Apache-2.0 and already shipped (`symbology`, CR-0029); the table's origin goes into the third-party notices for `cot` too (the MCA's notices file).
      - **In:** the basic id (the code with positions 2, 4 and 11 to 15 starred, as mil-sym-ts's `getBasicSymbolID2525C` makes it) is looked up; one not found drops its last function character until it is found, then the dimension's empty frame (`S*G*------`); without that, no conversion. The SIDC version is the record's (10 or 11, both APP-6D in the model, APP-6E Table A-1). The 8 records of version 15 (MIL-STD-2525E Change 1, a draft) are not used: such a code falls back to its parent.
      - **Out:** the table turned round, by (`ss`, `ec`, `s1`, `s2`); not found, then with sectors `00`, then the entity's parent (its last two, then four digits zeroed), then the symbol set's empty frame. An APP-6E code uses its first 20 digits (the same layout, APP-6E Annex A). **The 14 keys with more than one 2525C id: the first record in the table's order** (where one id is the parent of the others, the parent comes first, e.g. `UCA` before `UCAT` and `UCAW` before `UCAWS` and `UCAWA`, 8 keys; otherwise the first, e.g. `UCDML` before `UCDMA` and `IR` before `IP`); 4 of the 14 are symbol set 25 graphics, which are not sent anyway. **ME A in reverse:** symbol set 10, entity `000000` with an echelon goes out as `U-----`, without one as `------`. Entity `110000` (Command and Control) goes out as `U-----`, as the table has it, so it arrives as a plain unit (criterion 42).
    - **The positions the table stars** (fixed tables in `cot`), from mil-sym-ts 2.10.9's own converter (`C2DLookup.getDCode`) and milsymbol 3.0.4's letter-code reading (`lettersidc/metadata.js`), which agree; the digits checked against **APP-6(E)(2), Annex A, tables A-2 and A-6 to A-8** (read in place in the owner's NATO folder). 2525C is not a NATO text, so its letters are checked against the two libraries and the ATAK recordings:

      | 2525C | APP-6D or APP-6E | Recorded |
      |---|---|---|
      | 2 identity: `P U A F N S H` | context 0 (reality), identity 0 to 6 | F, H, N, S (ATAK) |
      | 2 identity: `G W M D L J K` | context 1 (exercise), identity 0 to 6 | – |
      | 4 status: `P` or `*`, `A`, `C`, `D`, `X`, `F` | 0 present, 1 planned/anticipated/suspect, 2 fully capable, 3 damaged, 4 destroyed, 5 full to capacity | `*`, `A` (ATAK) |
      | 11 HQ, task force, dummy: `A` HQ, `B` task force HQ, `C` feint/dummy HQ, `D` feint/dummy task force HQ, `E` task force, `F` feint/dummy, `G` feint/dummy task force | 2, 6, 3, 7, 4, 1, 5; `-` or `*` 0 | – |
      | 12 echelon: `A` to `H`, `I` to `N` | 11 team/crew to 18 brigade, 21 division to 26 command | `A D E F H` (ATAK), `F G` (WinTAK) |
      | 11 and 12 mobility: `MO MP MQ MR MS MT MW`, `MU MV`, `MX MY`, `NS NL` | 31 to 37, 41 and 42, 51 and 52, 61 and 62 | – |

    - **Out, the other way:** the same tables. Present goes out as `*`, as ATAK writes it; an empty position 11, 12 or 13 to 15 as `*`. Contexts 1, 5 and 6 (exercise, and the restricted target and no-strike entity in exercise) give the exercise letters; every other context the reality letters (simulation has none in 2525C).
    - **Without an equivalent:** in, 2525C's installation (`H` in position 11; mil-sym-ts reads `HB` as feint/dummy but drops it) and the country code (positions 13 and 14) are left out; out, sectors that no 2525C id has, APP-6E's digits 21 to 30, the leadership indicator (71), and an HQ, task force or dummy beside a mobility or towed array (position 11 holds one; the mobility wins) are left out. A symbol set with no CoT dimension is skipped as today ("no CoT type", function 17).
    - **The amplifiers need no mapping:** they keep their milsymbol names (function 27).

**HQ, task force, feint/dummy and mobility were recorded in no client** (the owner: ATAK has no setting for HQ and task force, WinTAK sends none of them, and the owner's feint/dummy attempt came out as a suspect). Functions 26 and 29 define them from the 2525C positions above; criteria 40 and 43 check them against the standard and on the owner's ATAK, not against a recording.

## Functions (M6)

Built against SDK 1.5.0 part 1 (`sdk-v1.md`, "SDK 1.5.0"; CR-0038), `sdkVersion` `^1.5.0` (SDK 1.5.0 since part 1, owner NP A).

30. **The data type names its set** (CR-0038 points 1, 3 and 8; T-165). The manifest's `cot.cot` gains `"fieldSets": ["unit"]`. The object store then adds `cot.unit` to every object created with `cot.cot`, and to one whose data type changes to it (model rule 21), so a symbol a user places by hand as CoT shows "CoT unit" at once.
    - The plugin may go on listing the set itself (function 23); the store adds it only once.
    - The fields keep no `dataTypes` (deprecated, point 8).
    - **Expiry** (point 9; the owner's Q3): `cot`, from `@time` (function 2), keeps `time.observed` on every object, so its tracks fade and go by the data type as before. A symbol a user places by hand with this data type has none, and no longer expires by it (ECore's `Removal`).

31. **A moved track stays where the user put it** (T-155; SDK 1.5.0 part 5, CR-0039 points 10 and 11; ADR-0053 point 8; owner, Q1 A). A user may move a received object into another layer of the workspace ("Move to layer…", ADR-0053); it stays there. `cot` writes its own objects: an event for a stored uid updates it with **the stored object's `layerId`**, never the link's target layer, as an event from another link already does (function 5); a new uid goes to the link's target layer (function 13). A copy ("Copy to layer…") has no external identity (ADR-0053 point 3), so the plugin never updates it: it stays as copied, and the original goes on.


## Functions (M7)

Built against SDK 1.6.0 (CR-0041 part G, the manifest's `symbolPalettes`).

32. **The palette "CoT"** (T-156; the M7 plan's Q1 A). The manifest declares one palette, `{ "id": "cot", "name": "CoT", "symbols": [...] }`, which `draw-symbols` offers in its Symbols panel (its function 31).
    - **Its symbols:** one per row of the closed APP-6D and APP-6E table (function 17's closed table, 147 rows, `CotSymbolsNumeric` in the codec; the plugin's README, "closed and partial"), in the table's order.
    - **Each symbol:**
      - `standard` `APP-6D`;
      - `code`, the row's 20 digits with the standard identity friend and status present (`draw-symbols` sets the identity the user chooses, its P1);
      - `label`, the row's CoT type without its affiliation and its entity's name, e.g. "G-U-C-I – Infantry" (C1).
    - **So a symbol placed from it goes out as that CoT type** through an `out` link (function 17), since the table is the same.
    - **Kept in step by a test:** the manifest's palette and the table have the same rows in the same order. A row added to the table without its palette entry, or the other way round, fails the build.
    - **Nothing at runtime:** the palette is declared, never written.

## Functions (M9)

Built against SDK 1.9.0 part P (`sdk-v1.md`, "SDK 1.9.0", point 1; CR-0048), `sdkVersion` `^1.9.0`.

33. **A TLS link picks its credential** (D6p, K1; ADR-0062 points 2 and 3). A TLS credential is named on its own in ECore (the keys `emc2.tls.<name>.*` in `settings/credentials/tls-<name>.properties`; the CDA's C3), so renaming a link no longer loses its certificate.
    - **The setting `links[].tlsCredential`:** a string, default `""`, with `"x-emc2": { "kind": "tls-credential", "enabledWhen": { "property": "transport", "in": ["tls"] } }`, in the link's "Connection" group, after `port`. No `enum` or `pattern` (the kind's rule). Its `title` "TLS credential" and a `description` that says: the name of a TLS credential in the server's local configuration; empty uses the link's name.
    - **The form** (the shell's, C3): a select of "(the link's name)" (the empty value), the names ECore has, sorted, from `GET /api/settings/tls-credentials` (`settings.admin`), and, for a stored name ECore lacks, "<name> (missing)". Never paths, passwords or certificates. The plugin adds nothing to it.
    - **The plugin:** a `tls` link calls `task.tls(credential)` with the field's value, or with the link's `name` when it is empty or absent, as before. **A changed credential restarts a `tls` link's task**, so the new one is used at once (PCA-cot builds it, if a change of `host` or `port` does not already). Other transports ignore it, and keep its value (greyed).
    - **A name ECore lacks:** `task.tls` throws `IllegalArgumentException`; the link's task fails before it opens a connection and restarts with its back-off, as today with a missing credential. **New for PCA-cot:** the link's status says that the credential is missing and names it, never a path. ECore reads credentials at its start (ADR-0062 point 5), so a credential added later needs ECore restarted.
    - **An expired certificate** (ADR-0062 point 4; C3): ECore checks the client certificate's expiry at each `task.tls` call, and refuses with an **`IllegalStateException`** whose message names the credential and the date it expired on; so does a credential ECore cannot read. The link's task fails before it opens a connection and restarts with its back-off, and **the link's status shows that message**, which names no path. ECore's Monitor lists the expiry as well (the CDA's).
    - **The texts:** `links`' and `transport`'s descriptions say "the link's TLS credential, or the link's name" instead of "named like the link" (ADR-0060's texts, X1).
    - **Nothing else changes:** the stable link id (CR-0047) is not the credential's key; the name stays the fallback, so a link renamed without a picked credential still needs its credential renamed.

## Out of scope (M9)

- The credentials' files, PEM, `%emcc%/` paths, the Monitor's expiry list and the old keys' deprecation: ECore's (the CDA; ADR-0062 points 2 and 4).
- TLS for links that listen (ADR-0036 A5, ADR-0062 point 5), and a credential changed while ECore runs: it needs a restart in M9.

## Out of scope (M5)

- Sending WinTAK's format (`mil2525c`, `amp`, the type suffix): emcc reads it only (MD A).
- 20- or 30-digit codes in CoT, the country code, the protobuf form (TAK protocol version 1), reading amplifiers from `<remarks>` text.
- Tactical graphics (`G`) and METOC (`W`) codes: only symbols are sent (function 17); such a code arriving gives the type's symbol.
## Out of scope (M3)

- A TCP server that TAK clients connect to (emc2 as a TAK Server), and TLS over anything but a TCP client (A5).
- Shapes as TAK drawings (`u-d-…`), chat, tasking, routes, data packages, TAK protocol version 1 (protobuf), federation.
- Input channels (ADR-0037 point 5): no plugin needs them in M3.
- Mapping CoT labels to STANAG 4774 (access by label comes later).
- Migrating stored `streams` (owner, 2026-10-26).
- Layers of other workspaces as targets or sources: the picker offers View's layers in M3 (ADR-0039 point 6). Channel items from the simulator are sent, whichever workspace they come from.

## Out of scope (M1)

- Sending CoT (the outgoing side, "Later: outgoing"), apart from the presence event of function 9.
- Mesh SA over UDP multicast, and emc2 acting as a TAK Server that clients connect to.
- TAK protocol version 1 (protobuf), federation.
- Drawings (`u-d-…`), chat, tasking, routes, data packages and video.
- Mapping CoT labels to STANAG 4774 (after M1).
- APP-6D or APP-6E SIDCs from CoT.

## Later: outgoing (out of scope for M1; built in M3)

The plugin is to send CoT too (owner, 2026-10-11). M1 builds none of it, but must not block it. **M3 builds it** (functions 11 to 22). Points 1 and 2 still hold. Links replace point 3's `direction` field and point 4's subscription by area or data type (by source layer instead). SDK 1.2.0's connection tasks answer point 5.

1. **The codec works in both directions and is separate from the transport.**
   - The mapping of function 4 lives in a codec of its own: CoT event ↔ object content, with its own tests. It has no listener, store, settings or worker code (criterion 13).
   - M1 needs only CoT → object. Object → CoT comes later in the same codec, with round-trip tests next to the M1 ones.
   - Framing and parsing stay in the listener (function 2), with the codec called on each parsed event.
2. **The extension keeps what a round trip needs.** Function 4 keeps everything it does not map. An object that came from CoT and is sent back unchanged must give the same event, apart from `@time`. When in doubt, M1 keeps a field in the extension rather than dropping it (criterion 4).
3. **Stream settings can take a direction later.**
   - A stream is a list entry with named fields (function 1, Settings), not, for example, a `host:port` string. A later `direction` field (`in`, `out` or `both`, default `in`) is then an optional addition, and M1's stored settings stay valid.
   - M1 adds no such field.
   - The stream's name stays its key, for the data source, the layer and the status.
4. **What a sender would subscribe to.**
   - Per outgoing stream, a Java SDK v1 store subscription (`Store.subscribe`) to what the stream sends: a layer (`inLayer`), an area (`within`) or a data type (`ofDataType`), chosen in the stream's settings.
   - Creates and updates go out as events. A delete goes out as an event that is stale at once.
   - The CoT uid is the `externalRef` id for objects that came from CoT, and the object id for all others.
   - It never sends an object back to the stream it came from (by `dataSource` and `meta.modified.by.system`), so two systems do not echo each other.
5. **Not in SDK v1:** a worker cannot write on a stream's connection. Only the listener's own loop writes (small writes, function 9), and the loop has no inbox. Sending needs an SDK addition: a CR when the outgoing side is planned (open question 5, decided).

A server socket that TAK clients connect to (emc2 acting as a TAK Server) and mesh SA over UDP would be further `ListenerSpec` transports. Neither is planned.

## Interfaces

| Direction | What |
|---|---|
| Provides | Nothing to other plugins |
| Requires | Java SDK v1: listeners (TCP and TLS client connections to configured hosts, with a small write for function 9), workers, timers, object access (create, update, find by `externalRef`, change events as messages), layers, plugin documents, settings, plugin status, the default label |
| Objects | Creates and updates `core.symbol` objects with `dataType` `cot.cot`; creates one layer per stream. Never deletes objects |
| **M3: provides** | An output channel per `out` or `both` link: `cot/<link>`, output type `cot`, `DELETE`, the fields `team`, `role`, `staleSeconds` (function 15); the declared fields themselves (function 16) |
| **M3: requires** | Java SDK 1.2.0: connection tasks (`connections()`, with TLS by name and `ListenAddress`), output channels (`channels().offer`), `classifications()` and `ClassificationLimit`, the layer picker (`LayerChoice`), `declaredFields()`, `ObjectQuery.inWorkspaces`, store subscriptions by layer; and SDK v1's store, documents, settings, status and default label, as in M1. No listener |
| **M4: requires** | SDK 1.3.0: `x-emc2.enabledWhen` in the settings schema (CR-0028 part 5), read by the shell's form (CDA, T-098); no SDK member |
| **M3: objects** | As in M1, with one layer per input link's target (shared when two links name the same new layer). Reads the objects of the output links' source layers. Still never deletes objects |

## Dependencies

None beyond the SDK and the JDK (`javax.xml`, `javax.net.ssl` through the SDK's listener). No third-party XML or CoT library. TAK's `.proto` files are not used (licence, interop note section 8).

**M3:** still none. Its sockets are the JDK's (`Socket`, `DatagramSocket`, `MulticastSocket`), opened in connection tasks, and TLS uses the SDK's `task.tls(name)`.

## Settings

| Setting | Default |
|---|---|
| Streams (list of: name, host, port, transport `tcp` or `tls`, layer name, label, enabled) | none: the plugin does nothing until a stream is configured |
| Idle time before reconnecting | 5 min |
| Maximum event size | 64 KiB |
| Send the presence event (`sendPresence`, function 9) | on |
| Presence callsign (function 9) | `emcc` (T-134; the presence uid stays `emc2-<callsign>`) |
| `writeStallSeconds` (M3, function 12) | 60, from 5 to 3 600: an `out` or `both` link with no written progress for that long restarts. One setting for every link, not per link |

Data type `cot.cot` (manifest, ECore settings per data type): faded from the expiry; removed 10 minutes after it. From M6 it names the field set `unit` (function 30).

A stream's name follows the data source pattern of data model 1.0.0 (lowercase letters, digits and `-`, at most 64 characters, e.g. `tak-north`); `manual` is reserved.

**M3 settings** (replacing `streams`; the others stay). Every setting has a default, except a picked layer and `highestClassification`, which may be absent (design pattern, settings; SDK 1.2.0). The links schema follows `model/examples/valid/manifest-layer-picker.json`.

| Setting | Default | For |
|---|---|---|
| `links` (list) | none: the plugin does nothing until a link is configured | |
| `links[].name` | – | every link (function 11) |
| `links[].direction` | – | `in`, `out` or `both` |
| `links[].transport` | `tcp` | `tcp`, `tls`, `udp` or `multicast` (function 12) |
| `links[].host`, `links[].port` | – | `tcp` and `tls`: the peer; `udp` out: where to send; `port` also where `udp` in listens |
| `links[].address` | `127.0.0.1` | `udp` in and both: where to listen; `multicast`: the group (no default there) |
| `links[].interface` | none | `multicast`: required, chosen by an admin (R4) |
| `links[].targetLayer` | absent: a new layer named like the link | `in`, `both`: the layer picker (function 13) |
| `links[].label` | the server's default label | `in`, `both`: the layer's and the objects' label |
| `links[].sourceLayers` | none | `out`, `both`: the layer picker, existing layers only (function 14) |
| `links[].highestClassification` | absent: the server's default label's classification | `out`, `both` (function 20) |
| `links[].staleSeconds` | 60 | `out`, `both` (function 18), 1 to 86 400 |
| `links[].refreshSeconds` | 30 | `out`, `both` (function 18), 0 to 86 400; `0`: only changes go out |
| `links[].enabled` | `true` | every link |
| `links[].tlsCredential` (M9, function 33) | `""`: the link's name | `tls`: the TLS credential, picked from ECore's names; greyed for the other transports |

Only users with `settings.admin` change any setting (ADR-0036 point 4).

**M4: greyed link fields** (SDK 1.3.0, CR-0028 part 5; the owner's M4 notes; T-107). The settings schema marks each link field that only some links use with `x-emc2.enabledWhen` (`model/README.md`, "Changes in 1.3.0"), so that the shell's form shows it greyed and read only for the others and keeps its value:
- on `direction`, by the table's "For" column: `targetLayer` and `label` in `in` and `both`; `sourceLayers`, `highestClassification`, `staleSeconds` and `refreshSeconds` in `out` and `both`. `writeStallSeconds` is one setting for all links, outside `links`, so nothing greys it;
- on `transport`: `host` in `tcp`, `tls` and `udp`; `address` in `udp` and `multicast`; `interface` in `multicast`.

`enabledWhen` names one sibling, so a field that depends on both (`host` for `udp` only when sending) is greyed by the one that rules out most. **Validation does not change:** a greyed field's value is still validated and saved, and the plugin ignores it, as it already does (function 13 for an `out` link's target layer). The manifest declares `sdkVersion` `^1.3.0`.

## Permissions

None for users. Users see the objects like any others, and edit them with the core permission `objects.edit`. Changing the streams needs `settings.admin` (the plugin's entry in the Settings tab, ADR-0031; the server checks it).

## Internet access

**Not allowed.** The TAK systems are on the local network. The plugin connects only to the hosts of its configured streams (declared through the SDK v1 manifest field for network hosts from configuration).

**M3:** still no `internet` declaration. The plugin connects, sends and listens only where its links' settings say, and the manifest's `connections` declares it (ADR-0036 point 7). That is a declaration: ECore checks no host, and the reviews check the rule.

## Acceptance criteria

1. With a TAK test double streaming CoT over TCP, an atom appears on the map in every browser within 2 s, at the right position (latitude ≠ longitude), with the right symbol and callsign, `dataType` `cot.cot`, `dataSource` = the stream's name, and `meta.externalRef` `{system: "cot", id: uid}`.
2. Repeated events for the same uid move the same object. No second object is created, also after a restart of the server.
3. An older event (by `@time`) than one already applied is ignored.
4. Unmapped CoT is kept: an event with a private `<detail>` element and `how`, `ce`, `le` stores them unchanged in the `cot` extension. When a user moves the object, the extension stays unchanged (ADR-0018).
5. `@time`, `@start` and `@stale` end up in the object's time attributes; after the expiry the object is shown faded, and ECore removes it after the data type's removal time (T-039).
6. A stream sending malformed XML, an event of 1 MB, or a document with a DTD or an external entity: the event is dropped and counted, no entity is resolved, the stream continues, and at most one warning per minute is logged.
7. A TAK system that goes away is reconnected with the back-off of function 8; another stream and other plugins are not affected. The plugin status shows each stream's state.
8. Two streams with different names give objects with different `dataSource` values, each in its own layer. The same uid on both streams is one object, which keeps the `dataSource` and the layer of the stream that created it.
9. TLS with a client certificate works against a test double with a self-made certificate created at test time. No certificate, key or password is committed.
10. 1 000 events per second over 10 000 uids are applied without a growing backlog (measured in the plugin's test with the test kit, and once in the ITA's environment).
11. The plugin follows the concurrency rules: no threads, sockets or locks of its own; the blocking reads run in an SDK listener; every request has a timeout. The ArchUnit rule set passes.
12. Without a configured stream, the plugin starts, does nothing, and reports "no stream configured".
13. The CoT codec (CoT event → object content) is a part of its own with its own tests. It uses no listener, store, settings or worker types, and a test in the plugin's build checks that ("Later: outgoing", point 1).

**M3** (with the ITA's TAK test double, UDP and TCP test peers on loopback, and multicast test peers on an interface that carries multicast, which a receiving link names in its settings: ADR-0036 and its index row; and the test kit's fake tasks, channels and store):

14. **Each transport, both ways:** `tcp`, `tls`, `udp` and `multicast` (on a named interface).
    - An event received on an `in` link lands in its target layer.
    - An object in an `out` link's source layer is sent, and parses back with the same type, uid, position (latitude ≠ longitude), callsign, course and speed.
    - A `both` link does both on one connection.
15. **The round trip of Q20:** tracks handed to the output channel of link A come back through link B into a View layer.
    - Automatic: with the test double.
    - Once by hand: through the ESA's TAK Server (T-067). This final real TAK check of T-084 comes after the simulator's part B2 (owner, 2026-10-27).
16. **No echo** (functions 14 and 19):
    - An object received on a `both` link is not sent back on it.
    - With an output whose source layer is the target of an input on a double that echoes, each real change goes out once, a create included, and the echo stops.
    - **The echo of a source-layer object** (owner, 2026-10-28: N1 and S1): an object created in the source layer and sent comes back on the input link into that same layer as the echo: it is not stored, and the input link's "echoes ignored" count rises by one. It is handled as any incoming event: when the input link's target is another layer; when an object is already stored under that uid in that layer; and after the sent event's stale time plus 60 s, unless a send renewed it. Channel items and relayed CoT uids are never treated as echoes (criterion 15, also into another layer). This is checked once by hand through the ESA's TAK Server too (function 19), as part of criterion 15's final check after the simulator's part B2.
17. **Skips** (functions 17, 20 and 21): each of these is skipped, counted by reason in the status, and logged at most once a minute per link:
    - a shape;
    - a symbol with no CoT type;
    - an object above the highest classification, or of another policy;
    - every object while the limit is unknown.
18. **Deletes:** each of these sends one event that is stale at once:
    - deleting an object in a source layer;
    - moving it to another layer;
    - raising its label above the limit;
    - a channel's `Removal`, for an item the link still remembers; otherwise nothing goes out (criterion 27).
19. **Stale times** (function 18):
    - the expiry wins, then the object's `staleSeconds`, then the link's;
    - an unchanged object from a source layer is sent again once nothing was sent for it within `refreshSeconds`, also with an expiry, until the expiry has passed, and a change resets the time;
    - with `refreshSeconds` `0` only changes go out;
    - the status warns when `refreshSeconds` is `0` or longer than the link's `staleSeconds`;
    - a channel item is not refreshed by the link.
20. **The channel** (function 15):
    - Each enabled `out` or `both` link is a channel `cot/<link>`, with type `cot`, `DELETE` and the three fields.
    - Renaming the link withdraws the old id and offers the new one, and disabling it withdraws it.
    - Ten updates for one object while the task is busy send only the latest.
    - A sender's items with unchanged content, one a second, all go out while the task keeps up (function 19); only a busy or a down task coalesces them (function 21).
21. **Declared fields** (function 16):
    - The manifest's `fields` are valid.
    - A received `__group` sets `team` and `role`.
    - Values set through another plugin's editor go out as `__group`.
    - `staleSeconds` is honoured.
22. **Layers** (function 13):
    - Two links that name the same new layer share one.
    - The status shows each link's actual layer.
    - A deleted target layer is made again at the next event.
23. **Addresses** (function 12):
    - A `udp` link with no `address` listens on 127.0.0.1 only.
    - A `multicast` link with no `interface` stays stopped, and its status says so.
    - No host, port or group is taken from anything but the settings.
24. **Stored `streams`** from M1 and M2 are not read. The plugin starts and says so in its status (function 11).
25. **Load:** 1 000 objects at 1 Hz through the channel to one `tcp` link are sent without a growing backlog, measured with the test double. The monitor view shows the link's rates.
26. **Rules:**
    - The ArchUnit rule set passes, with sockets only in connection task classes and no listener.
    - The codec's independence (criterion 13) holds for both directions.
27. **Removals of channel items** (function 19):
    - a `Removal` for an item the link sent goes out as an event that is stale at once, with the item's uid, CoT type and position (latitude ≠ longitude);
    - a `Removal` after the item's stale time, or for an item past the 200 000 cap, sends nothing and is not counted; an item sent past the cap is counted as "removal not kept" when it is sent;
    - an item sent again renews what the link remembers of it, until its new stale time.
28. **A link that is down** (function 21):
    - channel items for it wait, one per object: ten updates for one object leave the latest, and a removal replaces a waiting update;
    - no more than 20 000 wait: the 20 001st object's item is not posted, and the count "dropped" rises;
    - a removal for an object whose update waited and was never sent sends nothing, and the waiting update is gone;
    - an item whose expiry passes while the link is down is not sent, and is counted as "expired";
    - when the link is up again they go out with the time they were handed to the channel (function 17), so an item without an expiry that waited longer than its `staleSeconds` arrives stale.
29. **A write stall** (function 12; owner, 2026-10-28: Z1), with test peers on loopback and a short `writeStallSeconds`, for example 5:
    - a peer that accepts the connection and never reads, sent enough to fill the socket buffers (or with a small receive buffer), so that a write blocks: once no write has completed for `writeStallSeconds`, the link is stopped and started again at once, without the back-off (AD1), and each further stall takes the full `writeStallSeconds` again; its status says "write stalled, reconnecting", and the count "write stalls" rises by one; when it is up again, all objects are sent again, at the connection's pace;
    - a slow peer that reads in bursts, so that each write completes within `writeStallSeconds`, is not a stall: the link stays up and the count stays as it is;
    - a link with nothing to send is not a stall;
    - on a `both` link, the presence event's write is watched like the events' (AE1): a presence event that cannot be written is a stall too (to test it, for example, a peer that never reads and a send buffer already full, or the test kit's fake task);
    - the setting defaults to 60 and accepts 5 to 3 600.

From M4:

30. **Callsigns** (function 17): a simulator track named "ALPHA 1", sent through a channel, and a symbol named "BRAVO" in a source layer each arrive with that callsign; a symbol without a name but with the `uniqueDesignation` "C3" arrives as "C3". Once with the ESA's TAK Server and a TAK client, which shows the callsigns.
31. **Greyed link fields** (M4, T-107): the manifest's settings schema compiles in strict mode with `x-emc2` as an annotation; every `enabledWhen` names `direction` or `transport` and lists only values of its enum, as "M4: greyed link fields" says; an `in` link that keeps `sourceLayers` from an earlier `both` is valid and sends nothing. In the browser (with the CDA's form, T-098), switching a link from `both` to `in` greys `sourceLayers` and keeps its layers, and switching back brings them back.

From M5 (SDK 1.4.0 part 3; functions 23 to 25):

32. **The set:** the manifest declares `cot.unit` with the seven fields, and the test kit's `FakePluginContext` built from it lists them; every object `cot` creates or updates from CoT carries `cot.unit`, also one created before M5, at its next event.
33. **Callsign in:** an event with `contact/@callsign` "VIPER 2" sets `cot.callsign` and the name "VIPER 2"; `@how` `m-g` and `@ce` 12.5 show as the set's How and CE. An event with a callsign of 65 characters, a `@how` of 17, or a `@ce` of "-5" or "x" is stored with that value left out of the set, its Name and raw `detail` as received, and goes out with the defaults (LU).
34. **Callsign out:** a simulator track with Callsign "ALPHA 6" and Name "Alpha HQ" goes out as "ALPHA 6", and without a Callsign as "Alpha HQ"; a manual symbol with `cot.how` `m-g` and `cot.ce` 12.5 goes out with `@how` `m-g` and `point/@ce` 12.5, without them with `h-e` and 9999999.0.
35. **Vessels out:** `object-vessel.json`'s ship (identity 4) goes out as `a-n-S` at its position (latitude ≠ longitude), with its name as the callsign; a hostile one (`0670`) as `a-h-S`.
36. **The channel** names `cot.unit` (`ChannelInfo.fieldSet`), in a unit test. The check on a real server is the simulator's criterion 45 with the real `cot` (owner, LV, 2026-11-08: no Monitor column for it).
From T-129 (functions 26 to 29):

37. **In, ATAK's events:** PCA-cot's recorded events (test fixtures, as recorded) give APP-6D symbols: T1 friend, T2 hostile and T3 neutral as land units with entity `000000`; T4, T5, T6, T7 and T8 the same with the echelons 11, 14, 15, 16 and 18 (ME A, not `110000`); `F.9.120619` suspect (identity 5) with 15; T12 and T13 `reinforcedReduced` `+` and `-`; T14 equipment, symbol set 15, with `quantity` "12"; the second "T14" `higherFormation` "1st BDE", with the empty `F` left out; T16 `uniqueDesignation` "A CO" and the Name "T16"; T18 planned (status 1). Each keeps its type in the extension.
38. **In, WinTAK's events:** S1 `SFGPUCI--------` gives infantry (10, `121100`); S2 echelon 17 (`G`); S4 echelon 16 with `uniqueDesignation` "Alpha Co", `higherFormation` "1st Mech Div", `quantity` "120", `combatEffectiveness` "Excellent" and the remarks as the description; S5 `SFSSCL---------` symbol set 30, `120200`; S3 (`A` at position 10) infantry with echelon 17 and no HQ, since position 10 is part of the function.
39. **In, the fallbacks:** an event without a code gives today's symbol (criterion 1); `__milsym` wins over a `mil2525c` in the same event; a function the table lacks gives its parent; a `G` code and a code of 14 characters give the type's symbol, with the element kept in the raw `detail`; `SFG*EWDLS-*****` (a version 15 record) gives its parent; a `unitmodifier` `AH` and a value of 129 characters are left out and kept in the raw `detail`.
40. **HQ, task force, dummy and mobility, against the standard** (not a recording; APP-6E Annex A and mil-sym-ts's `C2DLookup`): `SFG*UCI---AF***` gives HQ (2) and battalion (16); each of `B` to `G` in position 11 gives 6, 3, 7, 4, 1 and 5; `SFG*E-----MQ***` mobility 33 and `SFU*------NS***` 61; `SDG*U-----*E***` context 1, friend; `SKG*…` context 1, hostile. Each converts back to the same code (criterion 42).
41. **Out, ATAK's format:** `10031002161211000000` (a friendly infantry battalion HQ) goes out with `<__milsym id="SFG*UCI---AF***">` and `<__milicon>` the same, the type `a-f-G-U-C-I`, and `quantity` "12" as `<unitmodifier code="C">12</unitmodifier>`; planned gives `A` in position 4; tracked mobility `MQ`; exercise hostile `K`; simulation the reality letter; set 10, `000000` with echelon 15 `SFG*U-----*E***`; an armour code (10, `120500`) `UCA`, not `UCAT`; a code with a sector that no 2525C id has goes out with its parent's code; a WinTAK object whose raw `detail` has `mil2525c` and `amp` goes out with `__milsym` and without them; no `mil2525c`, `amp` or type suffix in any event; a vessel goes out without `__milsym` (criterion 35).
42. **Round trips:** every ATAK fixture of criterion 37, read and sent again, gives the same `__milsym` id and `unitmodifier`s (the empty `F` excepted); every `S` record of `c2d_default` (versions 10 and 11) outside the 14 keys of function 29 converts to APP-6D and back to the same basic id, except `S*G*U-----*****`, which becomes entity `000000` (ME A) and comes back as `------` without an echelon and as `U-----` with one; entity `110000` (Command and Control) goes out as `U-----` and so comes back as a plain unit.
43. **The owner's ATAK** (M5, through the ESA's TAK Server; MD A): emcc symbols with each of HQ, task force, feint/dummy, planned, a mobility, an echelon and the four recorded amplifiers draw in ATAK as made in emcc; ATAK's own markers arrive in emcc drawn as on the phone (the owner's browser check). A raw client on the server sees what emcc sends with `__milsym` and its `unitmodifier`s intact.

From M6 (function 30):

44. **The data type's set:** the manifest's `cot.cot` names `unit` and validates against the 1.5.0 schema; the test kit's `FakePluginContext` built from it lists `cot.cot` with `fieldSets` `['cot.unit']`; an event's new object, written through the fake store, carries `cot.unit` once.

45. **A moved track stays** (M6, T-155): through the test kit, a track a user moved into another layer (`applyAs`, an update with a new `layerId`) is updated there by the next report, while a new one goes to the link's layer, and an event from a second link keeps it there too; a copy of it, a create without `externalRef`, is not updated.
46. **(M7) The palette** (function 32): the manifest validates with `symbolPalettes` (one palette, 147 symbols); its codes equal the table's rows with identity friend, in order; each code, encoded through an `out` link with the identity friend, gives the row's CoT type; the test fails when one row is removed from the manifest only.
47. **(M9) The TLS credential** (function 33): the manifest validates with `links[].tlsCredential` (the kind on a string without `enum` or `pattern`, greyed unless `tls`) and passes the template's guard (`settingsTextProblem`, `settingsHintsProblem`); through the test kit (`FakePluginContext.Builder.tlsCredentials`), a `tls` link with an empty credential connects with the credential named like the link, and one with `tak-ca` with `tak-ca` only, also after the link is renamed; with a picked name the server lacks, the link fails before it connects, and its status names the credential and no path; a `tcp` link with a stored credential ignores it; changing a `tls` link's credential restarts its task with the new one. **With the ESA's TAK Server** (ITA): a TLS link with a picked credential, then renamed, keeps receiving.


## Open questions for the owner

**M7 (2026-11-11), the assumption C1, accepted by the owner (RJ A, Q63):** a palette symbol's label is its CoT type without the affiliation and its entity's name.

All five answered by the owner, as recommended: questions 1–4 on 2026-10-10, question 5 on 2026-10-11. Questions 6 to 9 (M3) were answered on 2026-10-26: 7 and 9 as recommended, 6 otherwise, and 8 amended by the owner (below). Question 10 was decided on 2026-10-27, as recommended.

1. **Who removes expired objects?** **Decided by the owner, 2026-10-10: ECore, per data type.** The recommendation was: **ECore**, per data type, as configured in the settings view (ADR-0023 point 7), with the defaults from the declaring manifest. One rule then serves every incoming plugin. Alternative: each plugin deletes its own expired objects with a timer, which repeats the same code in every ingoing plugin and cannot be configured in one place. Affects the CDA (T-039) and the data type declaration in SDK v1.
2. **The transport in M1.** **Decided by the owner, 2026-10-10: a TCP and TLS client to a TAK Server; no UDP mesh in M1.** The recommendation was: a **TCP client to a TAK Server's streaming input, plain and with TLS** (function 1). TLS with client certificates is what a real TAK Server usually requires, and the manual check before the demo is against a real TAK Server. Mesh SA over UDP multicast is left for later: it is a small addition when needed.
3. **Editing TAK objects in emc2.** **Decided by the owner, 2026-10-10: they stay editable.** The recommendation was: **allowed**, with `objects.edit`; the next event from TAK overwrites the change (function 5). Making them read-only would need a core rule per data type, which is not planned.
4. **The presence event** (function 9). **Decided by the owner, 2026-10-10: one presence event per connection, only if the real TAK Server needs it.** **Changed by the owner, 2026-10-12: on by default, with the setting `sendPresence` to switch it off (function 9).** The recommendation was: **allow it**, only when the real TAK Server sends nothing without it. It is one small event per connection, so the listener in CR-0010 (item 8) gets a write on its connection, and the plugin stays `ingoing`. Without it, `cot` may receive nothing from such a server.
5. **Sending from a worker (for the outgoing side, later).** **Decided by the owner, 2026-10-11: no SDK change now; a CR for a compatible SDK 1.x addition when the outgoing side is planned.** In SDK v1 only a listener's loop writes on its connection, and the loop cannot receive messages: it sits in blocking reads, and the plugin may have no second thread. So a worker that gets an object from its store subscription cannot hand the CoT event to the connection ("Later: outgoing", point 5).
   - The recommendation was: change nothing now. When the outgoing side is planned, write a CR for a compatible SDK 1.x addition: a worker writes on a listener's connection through its `ListenerRef` (for example `listeners().write(ref, bytes, timeout, replyTo, mapper)`). ECore queues the bytes per connection, bounded, and writes them on its own virtual thread. The outcome comes back as a message, and the write never blocks the worker. The CDA builds the runtime side.
   - **Alternative:** add it to SDK v1 now through a CR. M1 does not need it, and it would add to the CDA's T-038.

**M3: questions 6 to 9, answered by the owner on 2026-10-26.**

6. **Migrating the streams.** **Decided: no migration.** Admins enter their streams again as links, and the layers the streams made stay, to be picked as target layers (function 11).
   - The recommendation was that `cot` keep reading stored `streams` as input links, next to `links`.
   - The other option was a settings migration run by ECore. That needs new CDA work and an SDK change after the freeze.
   - ADR-0037's index row records the decision (`docs/adr/README.md`, `ff39a4f` on `main`). It replaces the Consequences' clause on migrating the `streams` entries.
7. **The declared fields.** **Decided as recommended: `team`, `role` and `staleSeconds`** (function 16). The alternatives were `team` and `role` only, or none in M3.
8. **The stale time of what is sent.** **Decided by the owner, amended on 2026-10-26 before approving the brief** (function 18).
   - **The stale time** is as recommended: the expiry if it is in the future, else the object's `staleSeconds`, else the link's (default 60 s).
   - **The refresh is the owner's own:** a link setting `refreshSeconds`, default 30 s, where `0` means only changes go out.
     - A source-layer object is sent again when nothing was sent for it on that link within `refreshSeconds` (a change resets it), with or without an expiry, until the expiry has passed.
     - Channel items are not refreshed.
     - The link's status warns when `refreshSeconds` is `0`, or longer than the stale time it uses.
   - **The recommendation was:** to send source-layer objects without an expiry again at half their stale time. The alternatives were no refresh, or the link's setting only.
9. **Echo loops.** **Decided as recommended: only real changes go out** (function 19). The alternative was ADR-0037's rule alone, which leaves a loop between two links to the same TAK network to the admin.
   - **Narrowed by the owner, 2026-10-26** (from the simulator brief's review): the rule applies to objects from source layers only. Channel items always go out, so a sender's standing tracks stay fresh in TAK (ADR-0040 point 9, A9).
10. **What the decisions on part 3 leave open** (functions 17, 19 and 21; the PDA's conformance review, 2026-10-27). **Decided by the owner, 2026-10-27: as recommended,** each as the PDA read it; the functions now say so. PCA-cot builds it on a follow-up branch. The recommendations were:
    - **"Their own times":** `@time` and `@start` of an item that waited are when it was handed to the channel, and its stale time counts from then. The alternative is the sending time, but then nothing arrives stale after an outage.
    - **"Removal not kept"** is counted when an item is sent past the 200 000 cap, since at removal time the link no longer knows why it has nothing for the item.
    - **The 20 001st waiting item:** it is not posted (`SendResult.DROPPED`) and is counted as "dropped", as for a full inbox. The alternative is to drop the oldest waiting item instead. *(As asked. The ACA's recheck, 2026-10-27: a coalescing inbox never answers `DROPPED`, so the worker holds back the 20 001st object itself; function 21.)*
    - **A waiting removal whose update was never sent:** nothing goes out, since TAK never got the item; the removal still clears the waiting update.
    - **An item whose expiry passes while it waits:** it is skipped as "expired" (function 18), and the link sends nothing for it. Only an item still within its expiry arrives stale. *(Corrected by the PDA's conformance review, 2026-10-27, after the decision: an item within its expiry gets that expiry as its stale time, so it does not arrive stale; only an item with no expiry can, function 21.)*

11. **Where a 2525C code from TAK goes** (T-129). **Decided by the owner, 2026-11-09 (ME A, with the MCA's mapping from `c2d_default`): converted to APP-6D on arrival** (functions 26 and 29). The PDA's first draft kept it as APP-6B; ME A reads ATAK's plain unit as entity `000000`, an APP-6D code.
