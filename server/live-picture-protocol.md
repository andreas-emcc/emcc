# Live picture protocol, version 2

The browser's WebSocket to the live picture (overview 4.5, ADR-0006). Owner: CDA (core messages). Plugin channels (PDA) are not part of it.

Version 2 (T-039, owner 2026-10-12) carries **several subscriptions on one connection**, each with its own area of interest, budget, or `objects: false` (spike S3, `spikes/s3/README.md`; SDK v1 `LivePictureOptions`). It replaces version 1: the server and the shell are released together.

- **Endpoint:** `ws://<server>/api/live` (`wss://` behind TLS). One connection per browser session; the shell multiplexes it for all plugins.
- **Format:** plain WebSocket text frames, each one JSON object with a `type`. No sub-protocol (no STOMP).
- **Who may connect** (checked at the handshake; refused with `403`):
  - The `Host` header must name this server, against DNS rebinding: `localhost`, `127.0.0.1`, `[::1]`, the bound address (`server.address`) or a name in `emc2.allowed-hosts`, with the port the connection came in on. A server reached under another name (e.g. with `--server.address=0.0.0.0`) needs that name in `emc2.allowed-hosts`. The same check applies to every `/api/**` request.
  - **Behind a reverse proxy** on port 80 or 443 the name and the `Origin` are those the browser used, taken from the forwarded headers of a trusted proxy (`server/README.md`, "Behind a reverse proxy").
  - A browser's `Origin` must be the server itself: same scheme, host and port. `Origin: null` (sandboxed frames, local files) is refused.
  - A client without `Origin` is not a browser (scripts, test tools) and may connect if the `Host` is right.
  - Only a logged-in user may connect; otherwise the handshake gets `401`. With login the browser's `Origin` is required too (`403` without). The live session belongs to that user, in the no-login mode the local user `local` (ADR-0022).
- **Limits** (each with what happens beyond it):
  - at most `emc2.live.max-sessions` sessions (default 200); a connection beyond is closed with `1013`;
  - at most 32 subscriptions per connection; one more gets an `error`;
  - a browser message may be up to 1 MiB (1 048 576 characters); a larger one is read to its end (up to 16 MiB) and thrown away, then the connection is closed with `1009`;
  - at most 2 Mi characters of a browser's messages may wait for its session (two messages of the largest size); beyond, the connection is closed with `1008`;
  - at most 100 change requests of a session may wait for the object store; one more gets a `change-outcome` rejected with `INTERNAL_ERROR` ("send it again later") at once (a request refused for its permission does not count);
  - at most 8 object queries of a session may wait for the object store; one more gets a `query-failed` with `busy` at once;
  - at most one snapshot per subscription id every 2 s while it asks for the workspaces of the id's last snapshot (also across `unsubscribe` and `subscribe` of the same id; a subscribe for other workspaces, as at a workspace switch, is not held by it) and 32 per connection every 2 s; at most one area query per subscription every 250 ms, and 4 per connection every second; requests in between are served when the interval has passed, and of several `area` messages only the latest counts;
  - an area's ring has at most 256 positions (the shell thins a longer visible ring; the margin covers the difference);
  - a connection's area subscriptions may hold at most 600 000 objects together: a `subscribe` beyond gets an `error` and is not opened, an `area` beyond gets an `error` and the area stays;
  - a subscription's `budget` is capped by `emc2.live.max-budget` (default 100 000), which is also the budget of a subscription that names none;
  - binary frames are not part of the protocol and close the connection with `1003`.
- **Keepalive:** the server pings every browser every 30 s; browsers answer by themselves. A connection from which nothing arrives for `emc2.live.idle-timeout` (default 2 min) is closed.
- **Workspaces are enforced** (ADR-0039 point 7; data model 1.2.0, T-080): a session gets the layers of View, ECore's own workspace, and of each workspace a plugin declares whose view permission its user has, and those layers' objects, counts and changes, in snapshots, batches and queries. **For the user, what is in another workspace does not exist** (owner, 2026-10-27): a change to it is `ENTITY_NOT_FOUND`, one naming its layer `LAYER_NOT_FOUND`, a new layer in it is refused as in a workspace nobody declares, so editing there needs the view permission too. A workspace no loaded plugin declares any more keeps its layers, but no user sees them.
- **Labels are not enforced yet** (overview 4.9): within the workspaces it may see, every session gets every object and layer. Access by label comes after M1 (owner, 2026-10-10); it belongs in each subscription's classification of a change (below, S3 recommendation 14), in its snapshots, and in the object counts of `objects: false` subscriptions.
- **Model documents** (layers, map objects, change requests, change events, change rejections) are exactly as in `model/schemas/`, in their canonical form (rule 13: empty is absent). A position is `[longitude, latitude]`, as in the model.
- **Versioning:** the server says its version in `welcome`. Adding message types or optional fields is compatible. Anything else is a new version. A client that does not know the version should reload the page, since the server serves the matching shell.

## Subscriptions

A browser opens a subscription with `subscribe`, naming it with an id of its own choice (1 to 64 characters: letters, digits, `-`, `_`). Every server message about the live picture names the subscription it belongs to. There are three kinds:

| Kind | `subscribe` fields | What it receives |
|---|---|---|
| Whole picture | neither `area` nor `objects` | every layer and object: a snapshot, then every change event |
| Layers and counts | `objects: false` | every layer, the number of objects per layer (kept by the server), and only layer change events; `area` and `budget` are ignored |
| Area of interest | `area`, and optionally `resolution` and `budget` | every layer; the objects that reach into the area, individually up to the budget, and above it in clusters |

**Workspaces** (`workspaces`, data model 1.2.0; owner, 2026-10-27): the workspaces whose layers and objects a subscription gets, any kind. Without it, View only (`core.view`), so a client that knows nothing of workspaces sees what it saw before. `["*"]` means every workspace the user may see. Otherwise those named that the user may see; one the user may not see, or that no plugin declares, is left out without a word, so a browser cannot learn which workspaces exist. At most 64 ids; anything but a list of strings gets an `error` and the subscription is not opened. The web SDK's "follows the workspace shown" is the shell's: it names that workspace, and subscribes again on a switch.

Each subscription has its own sequence: its snapshot is consistent with a sequence number, and its messages continue from there without a gap. **A change in a workspace the subscription does not get is judged but not sent:** its `changes` message carries no event for it, but its `sequenceNo` still moves past it, so the browser knows when its own change has been judged. So a browser can tell how often the picture changes elsewhere, never what changed: accepted, as one gapless sequence for all requires it (owner, 2026-10-27). A new snapshot of a subscription may come at any time and replaces everything the browser holds for it. The server sends one when events were lost on the way to the session, so a browser never misses a change silently.

**Area** (the SDK's `Area`): `{ "ring": [[lon, lat], …], "inside": [lon, lat], "margin": {"metres": m} | {"share": s} }`. A closed ring (at least four positions, the first equal to the last) with geodesic edges, a position inside it, and an optional margin the server adds: metres, or a share of the greatest distance from `inside` to the ring. Never a lon/lat box, so it works at the poles and across the antimeridian. An object belongs to the area when the bound of its geometry reaches into the ring grown by the margin (spike S3, "How the area test works").

**Resolution:** the map's metres per CSS pixel at the centre (the SDK's `Viewport.resolution`). It sizes the cluster cells (64 px). Without it, the cells are a twentieth of the area's extent, as for a 1 280 px wide view.

### How an area subscription follows changes

Each change is judged by the bound of the object's geometry before and after it (S3 recommendation 8):

- **in the area after:** the change event is sent (an event for an id the browser does not hold means "add");
- **in the area before, not after:** the id is sent as `left` (drop it, it was not deleted); a delete is sent as the delete event;
- **in neither:** nothing.

Layer events always go to every subscription of the layer's workspace.

**Clusters.** When the area holds more objects than the budget, it is divided into cube cells about 64 px across (S3 recommendation 11). A cell with at most 3 objects still sends them as objects; a denser cell becomes one cluster; a shape wider than half a cell is always sent as an object. Objects in a cluster are not held individually: their change events are not sent, and the cluster's `clusters` update says what changed. When a cell turns into a cluster, its objects are sent as `left`; when it falls to 3 or fewer, they are sent as `entered`. Below 90 % of the budget the subscription returns to single objects (the `left` and `entered` of that switch, and an empty full set of clusters).

**Moving.** An `area` message replaces the area (the browser's view moved). The server answers with one `area-objects` message: the objects that entered and the ids that left, and with a `clusters` full set when there are clusters. Not a new snapshot (S3 recommendation 4).

## Object queries

Two reads that ask the object store, independent of every subscription, its area and the browser's local visibility (CR-0015 items 8 and 9; the SDK's `ctx.objects`). Any logged-in user may read, **in every workspace it may see** (above): an object in another is `missing` and a layer in another is `no-layer`, as if they did not exist. Access by label comes with the labels.

- **`get-objects`:** the objects with up to 1 000 ids. The answer lists the objects found and the ids no object has (deleted, never there, or a layer's id), both in the order asked for, each id once.
- **`query-layer`:** one page of a layer's objects, `pageSize` 1 to 500, `page` from 0, **in the order of their ids' text**, which for UUID v7 ids is the order of their creation (`model/README.md`). A page past the end is empty; `total` is the layer's objects when the page was read. A layer that does not exist is a `query-failed` with `no-layer`. Paging through a layer that changes meanwhile may skip or repeat an object at a page boundary.
- **Each answer is consistent with its `sequenceNo`.** It may come before or after the `changes` of the subscriptions up to that number.
- **Every query with a readable `queryId`** (1 to 64 letters, digits, `-`, `_`, chosen by the browser) **gets exactly one answer:** `objects`, `layer-page` or `query-failed`. One without a readable `queryId` gets an `error`.
- **Ids** are lowercase UUIDs, as the model writes them; anything else is `invalid`.

| `problem` of `query-failed` | Why |
|---|---|
| `invalid` | A field is missing or out of range: more than 1 000 ids, an id that is not one, `page` not a whole number from 0, `pageSize` not 1 to 500 |
| `no-layer` | `query-layer` for a layer that does not exist |
| `busy` | 8 queries of the session are waiting already; ask again when one is answered |
| `unavailable` | The object store failed or did not answer within 10 s |

## Server to browser

| `type` | Fields | When |
|---|---|---|
| `welcome` | `protocol` (2), `session` (SDK 1.4.0: the session's id, a UUID) | First message after the connection opens. The shell names `session` in its requests to the plugins' endpoints, header `X-Emc2-Session`, so that a temporal plugin's endpoint gets the page's time (owner, 2026-11-06) |
| `data-types` | `dataTypes`: every available data type, `core.general` first, each with `id`, `name`, `description` (if any), `declaredBy` (null for `core.general`), from SDK 1.5.0 `fieldSets` (the full ids of the sets the store adds to a symbol of this type, `[]` for none; CR-0038) and `manual` (`false` for a type users do not make by hand), from SDK 1.5.0 part 3 `sensorReport` (`true` for a type whose objects are sensor reports, drawn with the sensor report symbol; CR-0039 point 6), the manifest's `defaults` and the effective `behaviour` (`expiresAfterSeconds`, `fadeWhenExpired`, `removeAfterExpirySeconds`) | Right after `welcome`, and after every change of a data type's behaviour (SDK v1, `ctx.dataTypes` and `onDataTypesChange`) |
| `settings` | `plugin` (id), `values` (its complete settings) | Right after `welcome`, one per started plugin, and after every accepted change of a plugin's settings (SDK v1, `ctx.settings` and `onSettingsChange`) |
| `display` | nothing | To every browser of a user after that user's display settings were stored (`PUT /api/display`), and to every browser after the admin's display defaults were (`PUT /api/settings/display`; SDK 1.4.0 part 5, ADR-0046 point 6). The browser reads both again (`GET /api/display`), one read at a time, also after each `welcome`, so all of a user's browsers end on what was stored last (owner, 2026-11-07) |
| `labeling` | nothing | To every browser after an admin saved the premade security labels (`PUT /api/settings/labeling`; Settings › Labeling, T-170). The Labeling entry, if open, reads them again (`GET /api/settings/labeling`, `settings.admin` only); everything else ignores it |
| `snapshot-begin` | `subscription`, `sequenceNo`, `layers` (all layers), `objectCount`, and for `objects: false` `objectCounts` (every layer's id → its objects, 0 for an empty layer) | Start of a subscription's snapshot: after `subscribe`, and again whenever the server cannot guarantee continuity |
| `snapshot-objects` | `subscription`, `objects` (up to 1 000 map objects) | Repeated until `objectCount` objects have been sent. Only objects shown individually |
| `snapshot-end` | `subscription`, `sequenceNo` | The snapshot is complete, consistent with `sequenceNo`. An area subscription's `clusters` full set follows at once |
| `changes` | `subscription`, `sequenceNo`, `events` (up to 1 000 change events, in sequence order) | After the snapshot, about every 200 ms while the picture changes, **also with no events**: `sequenceNo` is the last change the subscription has been brought up to, so the browser knows when a change it made has been judged for every subscription |
| `area-objects` | `subscription`, `sequenceNo`, `entered` (map objects), `left` (ids) | Area subscriptions: after an `area` move, after changes that took objects out of the area, and when cells turn into clusters or back. Comes after the `changes` up to its `sequenceNo` |
| `clusters` | `subscription`, `sequenceNo`, `level`, `full`, `upsert` (clusters), `remove` (cell ids) | Area subscriptions: a full set after each snapshot, after each move and with every new level (`full: true` replaces all clusters held, and may be empty); then the changed and removed clusters of each batch. A cluster changes when its counts change or its mean moves by at least 1 px |
| `counts` | `subscription`, `sequenceNo`, `counts` (every layer's id → its objects, 0 for an empty layer) | `objects: false` subscriptions: the complete counts after every batch that changed them |
| `change-outcome` | `requestId`, `outcome` (`applied`, `rejected` or `unknown`), `event` (if applied) or `rejection` (if rejected) | Exactly one per `change-request` whose `requestId` the server could read |
| `objects` | `queryId`, `sequenceNo`, `found` (map objects), `missing` (ids) | The answer to `get-objects` |
| `layer-page` | `queryId`, `sequenceNo`, `layerId`, `page`, `pageSize`, `total`, `objects` (map objects) | The answer to `query-layer` |
| `query-failed` | `queryId`, `problem` (`invalid`, `no-layer`, `busy`, `unavailable`), `message` | A query that got no answer (Object queries, above) |
| `error` | `message`, `requestId` (if the error concerns a readable change request), `subscription` (if it concerns one) | A message the server could not use: not JSON, unknown `type`, a change request without a usable `requestId`, a query without a usable `queryId`, an invalid subscription, or the session is too busy to take a message |

**Cluster** (the SDK's `Cluster`): `cell` (id, stable while the level stays), `position` (`[lon, lat]`, the mean of its objects), `count`, `byLayer` (layer id → objects), `byIdentity` (`friend`, `hostile`, `neutral`, `unknown`). Identities by the SIDC's standard identity: friend with assumed friend; hostile with suspect, joker and faker; neutral; unknown with pending, and objects without a symbol.

- **`data-types` and `settings` carry complete values,** never differences: the page loads them over HTTP first (`/api/config`, `/api/plugins`), and the messages after `welcome` make it current again if something changed in between. They belong to no subscription.
- `unknown` means the object store did not answer within 10 s. The change may or may not have been applied; the live picture shows what happened.
- **A lost connection means "outcome unknown" for every change request still waiting for its `change-outcome`.** The server keeps no answers for a later connection; the shell reports `OutcomeUnknownError` for each and the live picture (after the new snapshots) shows what happened.
- The applied event of a browser's own request also arrives in `changes`, in every subscription it concerns.
- **Every change request is the session user's** (overview 4.4), whatever its `source.plugin` says, and needs the user's permission: in View `objects.edit` for an object, `layers.edit` for a layer (create, update including its name, draw order and default visibility, delete), whoever created the entity; in a declared workspace its edit permission instead, for its layers and their objects (ADR-0039 point 7), and in a workspace the user may not see nothing (above). The permissions are the login session's, fixed for the life of the connection (it closes with `4401` when the login session ends); in the no-login mode the local user has every one.
- **The checks of a change request, in this order:**
  1. **the permission,** as soon as the request's `entityType` can be read: without it the request is refused with a `change-outcome` rejected with `PERMISSION_DENIED` (the message names the permission), if its `requestId`, `entityType`, `operation` and `entityId` can be read, otherwise with an `error`. Nothing changes, and it does not count toward the limit of waiting requests. The session cannot tell which workspace an object's layer, or a stored layer, is in, so here it refuses only a user who holds none of the permissions that could allow the change (View's, or any declared workspace's edit permission); a layer create names its workspace and is checked exactly (owner, 2026-10-27). The object store checks every request exactly (step 5);
  2. the schema (`VALIDATION_FAILED`, below);
  3. ECore's own plugin ids (`VALIDATION_FAILED`, below);
  4. the limit of waiting requests (`INTERNAL_ERROR`, above);
  5. the object store's own rules (`model/README.md`), which checks the permission again first. From data model 1.3.0 a user's change to a locked layer's content is refused with `LAYER_LOCKED` (ADR-0042; below).
- **The layer lock** (data model 1.3.0, ADR-0042, T-098): a layer may carry `locked: true`; snapshots, batches and queries send it as stored (`false` is stored as absent). While it is set, the object store refuses every change request from a session that would change the layer's content with `LAYER_LOCKED`: an object's create, update or delete in it, a move into or out of it, the layer's delete, and its update unless it changes nothing but `locked` and `drawOrder`. It comes after the permission, `ENTITY_NOT_FOUND` and `LAYER_NOT_FOUND`, and before every other rule (`VALIDATION_FAILED`, the declared fields, `LAYER_NOT_EMPTY`; CR-0028 R1). Its one detail names the layer, at `/data/layerId` when the request names the locked layer there, else at `""`. An update without `locked` keeps the stored lock; `false` clears it. Plugins' server parts and ECore pass the lock; a client built before 1.3.0 gets the code like any other rejection.

  A request whose `entityType` cannot be read as either `object` or `layer` goes to the schema check, which refuses it.
- **The server sets `source.user`** of every change request from the login session (model rule 8): the IAM's `sub` with login, `local` in the no-login mode. What a browser sends there is ignored, and so is `source.system` (a browser is no external system).
- **`source.plugin` is taken from the request:** the shell fills it in for the calling web part. ECore's own ids (`core`, `core-…`) are rejected with `VALIDATION_FAILED`, except **`core-shell`**, the shell's own requests (CR-0015 item 10). No web part can send that: the shell fills in the calling plugin's own id, and ECore refuses a plugin whose id is ECore's. **Risk:** any other plugin id is believed, so a web part, or anyone with access to the WebSocket, can act in another plugin's name and write that plugin's extension namespace (ADR-0018). Acceptable while web parts are trusted; to be revisited before any untrusted web part.
- A change request the schema refuses gets a `change-outcome` with a `VALIDATION_FAILED` rejection and the schema's problems in `details`, if its `requestId`, `entityType`, `operation` and `entityId` can be read. Otherwise it gets an `error`.

## Browser to server

| `type` | Fields | Effect |
|---|---|---|
| `subscribe` | `subscription`, and optionally `objects` (false), `area`, `resolution`, `budget`, `workspaces` (data model 1.2.0: the workspace ids, or `["*"]`; Subscriptions, above) | Open a subscription: a snapshot, then its updates. An id already open gets an `error` |
| `area` | `subscription`, `area`, optionally `resolution` | Move an area subscription's area: one `area-objects` answer |
| `unsubscribe` | `subscription` | Close the subscription. Messages for it that were already on their way may still arrive; the browser ignores them |
| `change-request` | `request` (a change request, `model/schemas/change-request.schema.json`) | Apply a change. The answer is a `change-outcome`. From data model 1.2.0 the request may carry `fields`, the declared fields it sets (ADR-0038): `[{"plugin":"cot","name":"callsign","value":"ALPHA-1"}]`, on an object's create or update; the server checks each against its declaration and refuses the request at `/fields/<i>` if one fails |
| `get-objects` | `queryId`, `ids` (at most 1 000 object ids) | Read objects by id. The answer is `objects` or `query-failed` |
| `query-layer` | `queryId`, `layerId`, `page` (from 0), `pageSize` (1 to 500) | Read one page of a layer's objects. The answer is `layer-page` or `query-failed` |
| `time` | `time`: the web SDK's `UserTime` (CR-0032): `{"time":…, "interval":{"from":…,"to":…}}`, two independent parts, each left out at its default (the set time at now; no interval), never `null`, no other members; `{}` is now. UTC timestamps as the data model writes them (at most milliseconds), an interval's start not after its end; the set time may lie outside the interval | SDK 1.4.0 (ADR-0045 point 4): the time the page's user picked. Each session starts at now, so the shell sends it after `welcome` when it is not now, and at each change. It needs no permission and changes nothing on the server; the plugin host delivers it to the temporal plugins (`SessionTimeChange`), and `now` once when the session ends. A malformed one gets an `error` and changes nothing |

## Slow browsers and closing

The server never waits for a browser. Each session has its own sender, and a snapshot goes out with flow control (at most 4 parts waiting at a time), so a snapshot of any size reaches a slow browser, only more slowly. If a browser reads so slowly that about 1 000 messages wait for it anyway (e.g. a very large batch of changes), the server closes the connection with `1013`. The shell then reconnects, subscribes again and gets fresh snapshots.

| Close status | Why |
|---|---|
| `1003` | The browser sent a binary frame |
| `1008` | The browser sends faster than its session is served (more than 2 Mi characters waiting) |
| `1009` | A message larger than 1 MiB |
| `1011` | A server error: the session's sending failed, or one of its workers hung or failed |
| `1013` | Try again later: too many sessions, or the browser does not keep up |
| `4401` | The login session has ended (logout, the IAM's logout, a refused renewal, timeout). Reconnecting cannot help: the shell stops and asks the user to log in again |

## Example

```
<- {"type":"welcome","protocol":2}
-> {"type":"subscribe","subscription":"layers","objects":false}
-> {"type":"subscribe","subscription":"map","area":{"ring":[[17,58],[20,58],[20,60],[17,60],[17,58]],"inside":[18.5,59],"margin":{"share":0.5}},"resolution":150,"budget":10000}
<- {"type":"snapshot-begin","subscription":"layers","sequenceNo":41,"layers":[{"id":"…","name":"Drawing",…}],"objectCount":0,"objectCounts":{"…":2}}
<- {"type":"snapshot-end","subscription":"layers","sequenceNo":41}
<- {"type":"snapshot-begin","subscription":"map","sequenceNo":41,"layers":[…],"objectCount":1}
<- {"type":"snapshot-objects","subscription":"map","objects":[{…}]}
<- {"type":"snapshot-end","subscription":"map","sequenceNo":41}
<- {"type":"clusters","subscription":"map","sequenceNo":41,"level":11,"full":true,"upsert":[],"remove":[]}
-> {"type":"change-request","request":{"requestId":"0199…","entityType":"object","operation":"create","entityId":"0199…","data":{…},"source":{"plugin":"draw-symbols"}}}
<- {"type":"change-outcome","requestId":"0199…","outcome":"applied","event":{"sequenceNo":42,…}}
<- {"type":"changes","subscription":"layers","sequenceNo":42,"events":[]}
<- {"type":"counts","subscription":"layers","sequenceNo":42,"counts":{"…":3}}
<- {"type":"changes","subscription":"map","sequenceNo":42,"events":[{"sequenceNo":42,…}]}
-> {"type":"area","subscription":"map","area":{…},"resolution":300}
<- {"type":"area-objects","subscription":"map","sequenceNo":42,"entered":[{…}],"left":["…"]}
<- {"type":"clusters","subscription":"map","sequenceNo":42,"level":10,"full":true,"upsert":[],"remove":[]}
-> {"type":"query-layer","queryId":"0199…","layerId":"…","page":0,"pageSize":100}
<- {"type":"layer-page","queryId":"0199…","sequenceNo":42,"layerId":"…","page":0,"pageSize":100,"total":3,"objects":[{…},{…},{…}]}
```
