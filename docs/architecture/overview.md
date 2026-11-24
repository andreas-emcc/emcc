# emc2 – Architecture Overview

- Status: Draft v0.1
- Date: 2026-10-02, updated 2026-10-10 (M1 decisions)
- Maintained by: ACA (Architectural Consultant Agent). Approved by: the owner

This document describes **how** emc2 is built. **What** it must do is in [requirements.md](../../requirements.md). **Why** each major choice was made is in the decision records in [docs/adr](../adr/README.md).

Every agent reads this document before starting work. Sections marked **(normative)** are rules, not suggestions. If code and this document disagree, stop and raise it with the MCA. Do not silently pick one.

---

## 1. Quality goals

The goals that drive the architecture, in priority order:

| # | Goal | What it means for the design |
|---|---|---|
| 1 | Robust under concurrency | No deadlocks or race conditions by design. One hung part never hangs the whole application |
| 2 | Extensible through plugins | Everything beyond the core is a plugin, and all plugins are built the same way |
| 3 | Works disconnected | Every function has a way to work offline; the browser fetches nothing from the internet (ADR-0030) |
| 4 | Scales | At least 100 000 objects on the map, many users, more servers later |
| 5 | Secure | Real IAM from the first demo. A security label on every object |
| 6 | Maintainable by agents | Small parts with clear owners and written contracts between them |

---

## 2. System context

```
                    +---------------------------+
                    |   Browsers (users)        |
                    |   emc2 web client         |
                    +---------------------------+
                       |  HTTPS + WebSocket   |  login redirect (OIDC)
                       v                      v
+------------------------------------+     +------------------+
|            emc2 server             |<--->| Keycloak (IAM)   |
|  ECore + server parts of plugins   |     +------------------+
+------------------------------------+
     |            |             |             |
     v            v             v             v
 +--------+  +-----------+  +-----------+  +-----------+
 |Database|  | WMS/WMTS  |  | TAK       |  | NVG       |
 |        |  | map       |  | systems   |  | systems   |
 |        |  | servers   |  | (CoT)     |  |           |
 +--------+  +-----------+  +-----------+  +-----------+
```

- WMS/WMTS servers, TAK systems and NVG systems are provided by other projects. For emc2 they are existing external systems.
- Map tiles are requested through the server, via the server part of the map plugin. This gives the browser a single address to talk to, allows access control and allows caching for disconnected use.

---

## 3. Building blocks

### 3.1 Server (Java 25)

| Block | Responsibility | Owner |
|---|---|---|
| **app** (Spring Boot edge) | HTTP, WebSocket, login and sessions (ADR-0022), serving the web client files. Thin: translates requests into ECore messages and back | CDA |
| **ECore** (plain Java) | The core runtime, made up of the parts below | CDA |
| – Plugin host | Finds, validates, loads, starts and stops plugins (at start-up only) | CDA |
| – Worker runtime | Runs workers, connection tasks (ADR-0036), compute tasks (ADR-0064), listeners and timers for core and plugins. Watchdog for hung workers | CDA |
| – Message bus | Delivers messages between workers | CDA |
| – Object store | Holds the master copy of the live picture. Applies change requests, emits change events | CDA |
| – Live picture gateway | Keeps every browser session up to date | CDA |
| – Persistence manager | The only path to persistent storage | CDA |
| – Security | Users, groups, permissions, security labels | CDA |
| – Settings, logging, metrics, notifications | Central services offered to plugins | CDA |
| **Plugin SDK (Java)** | The only code that server parts of plugins may depend on | PDA |

### 3.2 Web client (TypeScript)

| Block | Responsibility | Owner |
|---|---|---|
| **Shell** | The workspace (ADR-0031): a top bar with the views (View and, from M3, the workspaces that plugins declare, such as Simulation, ADR-0039; Settings, a list of general and plugin settings; Monitor), the Map Pane with docked left, right and bottom panes, and the user's setups. Also the token values and the shared components' CSS, with the three looks (ADR-0029, ADR-0034), the lists of object actions and map actions with the shared Delete (ADR-0032), login, the connection to the server, and loading of plugin web parts | CDA |
| **Web plugin SDK** (TypeScript) | The only API that web parts of plugins may use | PDA |

### 3.3 Common data model

A language-neutral specification (JSON Schema) of the information exchanged between core, plugins and browsers. See section 4.6. Owner: PDA (first draft by ACA).

### 3.4 Plugins

A plugin is **one package** with a manifest and an optional server part and/or an optional web part. The parts are loaded, versioned and released together.

| Kind | Purpose | Examples |
|---|---|---|
| Map plugin – map view | The map engine shown in the Map Pane. Exactly one is active per Map Pane | `map-view-2d` (OpenLayers). A 3D map view later |
| Map plugin – background map | Provides a background map to the map view: tiles, vector data drawn in any projection (ADR-0025), or, from M4, a WMS map requested through the plugin's server part (ADR-0035) | `basemap-osm`, `basemap-naturalearth`, `basemap-wms` |
| Utility plugin | Provides services to other plugins, does not place objects itself | `symbology` (milsymbol), `coordinates` (MGRS/UTM/DMS) |
| General plugin | Places and edits objects on the map | `draw-symbols`, `draw-shapes` (M2), `layer-panel`, `simulator` (M3, ADR-0040) |

Properties (any kind may have them): **ingoing** (consumes external data) and **outgoing** (sends data out, e.g. `nvg-export`). A plugin may have both: `cot` receives CoT from M1, and from M3 also sends it, through links and output channels (ADR-0037). Each may use push or pull.

The exact plugin list per milestone is maintained by the MCA. Section 6 shows the expected first set.

---

## 4. Key mechanisms

### 4.1 Plugin lifecycle (normative)

- Plugins are installed in a `plugins/` directory on the server. Each plugin has a `plugin.json` manifest.
- **Start-up sequence:** read all manifests → validate them (unique id, SDK version compatible, dependencies present) → order by dependencies → create one class loader per plugin, which only sees the Plugin SDK and the plugin's own jars → instantiate the plugin entry class → `init(context)` → `start()` → register web parts so the browser can load them.
- **Shutdown:** `stop()` in reverse order.
- A plugin that fails to start is disabled and reported. The others continue, unless the failed plugin is marked as required.
- Plugins are **not** loaded or unloaded while the application is running.
- **Files:** a plugin writes only through the persistence manager (ADR-0024), and reads local files only through the folders its manifest declares, which ECore reads for it, confined to the folder the admin set (SDK 1.4.0; ADR-0049, CR-0030). Plugins do no file I/O of their own; the test kit's `PluginRules` checks it.
- **Manifest:** the normative field list is the schema `model/schemas/plugin-manifest.schema.json` (PDA), described in `docs/plugins/sdk-v0.md` and, from SDK v1, `docs/plugins/sdk-v1.md`. It is versioned with the SDK, not with the data model. Besides the identity, kind and start-order fields it declares the web services a plugin provides and requires, whether it is required, its internet use (`internet`: that the server part reaches outside hosts over the SDK's outbound HTTP, why, and its default hosts; a declaration shown in the monitor view, not an allow-list, ADR-0030; a plugin's own sockets are declared as connections instead, whatever host an admin names, ADR-0036 point 7 as amended by CR-0052), its settings with defaults, its permissions, from SDK v1 its data types (`dataTypes`, ADR-0023) and, from SDK 1.2.0, its connections (a declaration, ADR-0036), its declared fields (ADR-0038) and its workspaces (ADR-0039).
- **Installed layout:** `plugins/<id>/plugin.json`, `plugins/<id>/server/*.jar` (the server part and its bundled libraries), `plugins/<id>/web/` (the built web part).
- **The plugin template** (`plugins/_template/`) is built and tested like every plugin, so it cannot rot, but it is never installed or run: the plugin host and the packaging skip folders whose names start with `_`.
- **Future out-of-process plugins:** a *stub plugin* implements the same SDK interfaces and forwards everything to a separate process over inter-process communication. The rest of the system cannot tell the difference.
- Plugins are trusted. The class loader separation is there to avoid dependency conflicts, not as a security sandbox.

### 4.2 Concurrency model (normative)

These rules are what make "no deadlocks and no race conditions" achievable. They apply to core and plugins alike, and govern the server's threads. The browser's one Web Worker, the symbology plugin's for tactical graphics, keeps their spirit: copied messages, no shared memory, a timeout per request (ADR-0043).

| Rule | |
|---|---|
| **C1** | Plugins never create threads, executors or thread pools. They request **workers**, **connection tasks** (from SDK 1.2.0, ADR-0036), **compute tasks** (from SDK 1.9.0, ADR-0064), **listeners** (deprecated from SDK 1.2.0) and **timers** from ECore through the SDK |
| **C2** | A worker handles **one message at a time**. State owned by a worker is only touched by that worker, so it needs no locks |
| **C3** | Workers communicate **only through immutable messages** (Java records with immutable collections) |
| **C4** | **Plugins use no locks, monitors or blocking synchronizers.** They never need them: each worker owns its state (C2). ECore shares no lock between plugins, except **leaf locks** (below) (owner, 2026-10-05 and 2026-10-07; ADR-0021) |
| **C5** | Every request/reply has a **timeout**. Prefer events (send and forget) over request/reply |
| **C6** | Long blocking I/O (sockets, slow external calls) belongs in a **connection task** (from SDK 1.2.0, ADR-0036), or in the deprecated listener, or for HTTP in the SDK's non-blocking outbound HTTP, never in a worker's message handler. **Plugins open sockets only inside connection tasks**, with the JDK's classes (owner, 2026-10-22). They do no other networking and no file I/O of their own: storage goes through the persistence manager (ADR-0024), outbound HTTP through the SDK |
| **C7** | CPU-heavy work runs in a **compute worker** (a bounded pool of platform threads) when it is a job that ends, or in a **compute task** (from SDK 1.9.0, ADR-0064) when it is a loop that holds a core for as long as it runs, on compute threads the plugin declares. Either way it cannot starve everything else |
| **C8** | No Java preview features |

**Mechanisms provided by ECore:**

| Mechanism | Runs on | Used for |
|---|---|---|
| Worker | Virtual thread, one mailbox | Handling messages, owning state |
| Connection task (SDK 1.2.0) | Dedicated platform thread that ECore starts, restarts, caps and stops (CR-0027: not a virtual thread, because of JDK-8334574 on Windows; ADR-0036 decision 2) | The plugin's own sockets of any kind, receiving and sending (ADR-0036). Posts what it receives as messages; workers hand it data to send through its inbox |
| Listener (deprecated from SDK 1.2.0) | Dedicated virtual thread with a loop | A TCP or TLS client connection that ECore opens (SDK v1). Posts what it receives as messages |
| Timer | ECore scheduler | Sending a message to a worker periodically or once |
| Compute worker | Bounded platform thread pool | CPU-heavy jobs that end |
| Compute task (SDK 1.9.0) | Dedicated platform thread from the plugin's declared compute threads, which ECore creates, caps (per plugin by an admin setting, and in total, by default the cores minus one, counting running tasks) and stops (ADR-0064) | CPU-heavy work in a loop, for example rendering video. Takes what workers post to its inbox, and posts immutable messages to its plugin's workers and connection tasks. No sockets, HTTP or store changes; no watchdog budget, but a stop that does not end marks it hung |

- **Mailboxes are bounded.** Each worker declares what happens when its mailbox is full: `DROP_OLDEST`, `DROP_NEWEST` or `COALESCE_BY_KEY`. The last one keeps only the latest message per key, which is ideal for position updates of tracks; the key is data of the message, so no plugin code runs while ECore queues it. `BLOCK_SENDER` (with timeout) exists only inside ECore: **SDK v0 does not offer it to plugins**, so a plugin never blocks on a send.
- **Leaf locks (rule C4, ADR-0021).** ECore may guard its own internal structures with a lock that threads of several plugins take briefly, for example a worker's mailbox. Such a lock must be a **leaf lock**:
  1. no plugin code and no hook runs while it is held;
  2. no other lock is taken while it is held;
  3. plugins cannot see it or wait on it. `BLOCK_SENDER` waits on the mailbox lock with a timeout and is not offered to plugins.

  A leaf lock cannot take part in a deadlock, which needs two locks taken in opposite orders. Every other lock that threads of more than one plugin can take is forbidden. The conformance review checks ECore's locks against these conditions.

  **A connection task's inbox** (from SDK 1.2.0, ADR-0036) and **a compute task's inbox** (from SDK 1.9.0, ADR-0064) follow the same rules: senders never wait on it, and its lock is a leaf lock. The task's own `take` waits for the inbox without holding that lock, and returns when the task stops; that wait is allowed only in a connection task (like blocking I/O, rule C6) and in a compute task.
- **Caps per plugin** (CR-0005, owner, 2026-10-08). ECore limits what one plugin can hold in the scheduler, so that it cannot fill it for everyone. The defaults are set in ECore's configuration:
  - **10 000 outstanding asks.** One more is answered at once, through the usual single answer, with `Reply.Failed("too many outstanding asks")`.
  - **1 000 active timers:** a `once` that has neither fired nor been cancelled, or an `every` that has not been cancelled. One more makes `once` or `every` throw `IllegalStateException`. Thrown in a handler, ECore logs it, drops the message and the worker continues. Thrown in `init` or `start`, the plugin is disabled with the reason.
  - **Each refusal is counted and logged**, at most once a minute per plugin. The plugin's status does not change. **The refusal counters reach the monitor view in M1.**
  - The SDK's Javadoc (`WorkerContext.ask`, `Timers`) states the caps, and the test kit's fake context enforces the same defaults.
- **Deliveries from ECore never block an ECore thread.** Timer ticks, topic messages and endpoint requests go through the target's mailbox policy; an endpoint request that cannot be queued is answered with `503` at once. Replies, `ask` timeouts and HTTP results are always delivered, because the worker is waiting for them.
- **Plugin code runs only inside the plugin's own workers**, with two exceptions: the code of a connection task (from SDK 1.2.0, ADR-0036), and of the deprecated listener, runs on its own thread; so does the code of a compute task (from SDK 1.9.0, ADR-0064). Functions a plugin hands to the SDK (handler factories, and the mappers of subscriptions, requests, outbound HTTP and endpoints) are run by ECore inside the target worker, under its watchdog budget. That also keeps a future out-of-process plugin possible: only data and handle ids cross the process boundary.
- **A handler that throws** is logged, the message is dropped, and the worker continues with the same handler.
- **Watchdog.** Every message handler call has a time budget (default 5 s, configurable per worker). When the budget is exceeded, the worker is marked **HUNG**: this is logged, counted in metrics and shown in the monitor view. If the worker is declared *restartable*, ECore fences the stuck instance (whatever it sends later is dropped) and starts a fresh worker instance on the same mailbox; the message that hung is not delivered again. After a restart limit, or if the worker is not restartable, the plugin is marked **DEGRADED**. Other workers keep running, because nothing waits for a hung worker without a timeout (rule C5).
- **Enforcement, in three layers.** No single check catches everything:
  1. **Static:** the ArchUnit rule set from the SDK's test kit (`PluginRules`) runs in every plugin's build and fails it when plugin code breaks the rules that can be checked statically (threads, executors, timers, locks and blocking synchronizers, sleeping and waiting, parallel streams, sockets outside connection tasks, other networking or file I/O, Spring, ECore internals, mutable messages).
  2. **Runtime:** the watchdog catches handlers that block or run too long. ECore runs each plugin's handlers with the plugin's class loader as context class loader, so threads started by a plugin or its libraries can be attributed and reported.
  3. **Review:** the `conformance-reviewer` checks every branch before merge. The ITA runs concurrency stress tests.
- Bundled third-party libraries in a plugin must not start threads or block; that is checked in review, since the static rules only cover the plugin's own classes.
- Note: since Java 24, `synchronized` no longer pins virtual threads to their carrier threads, so ordinary libraries that use it are safe to call from workers.

### 4.3 Message bus

- **Addressing:** topics with publish/subscribe (e.g. `objects.changed`), direct sends to a worker reference, and request/reply with a timeout.
- **Typed:** every topic declares its payload type (a Java record).
- **Ordering:** messages from one sender to one receiver arrive in the order they were sent. There is no global ordering, except for change events (see 4.4).
- Messages that leave the process (to browsers, external systems or future out-of-process plugins) are serialized to JSON.

### 4.4 Object store and change events (normative)

```
 Source: user (browser), ingoing plugin or other plugin
        |
        |  ChangeRequest (object or layer; create | update | delete;
        |                 content, baseVersion, requestId)
        v
 +-----------------------------------------------+
 | Object store worker  (the ONLY writer)        |
 |  check permission -> validate -> assign       |
 |  version + sequence number -> apply           |
 +-----------------------------------------------+
        |                                  |
        |  ChangeEvent (sequenceNo,        |  ChangeRejection (code, message,
        |  entity, operation, new state,   |  details) -- to the requester
        |  previous version, who, when,    |  only
        |  source, label)                  v
        v
 topic "objects.changed"
   -> persistence manager      (stores the change)
   -> live picture gateway     (updates browsers)
   -> subscribed plugins       (e.g. outgoing CoT)
```

- **Single writer for objects and layers** (ADR-0005, ADR-0018). All changes pass through one worker. This gives a total order (sequence numbers) and makes race conditions impossible. The expected load is far below what one worker can handle. If that ever changes, the store can be split by layer.
- **Exactly one answer per change request** (ADR-0018): a change event for everyone, or a change rejection with a fixed code for the requester only, both carrying the request's `requestId`.
- **Permissions are enforced here** (ADR-0005, ADR-0022; owner, 2026-10-14). The server enforces every permission; the browser only hides what a user may not do.
  - **A user's change request** is every change request from a browser session, whatever its `source.plugin` says. It is checked against the session's user, never against `source.plugin`.
  - It needs **`objects.edit`** for an object (create, update, delete) and **`layers.edit`** for a layer (create, update including its name, `drawOrder` and default visibility, delete). This holds for every object and layer, whoever created it, a plugin included.
  - **The layers of a declared workspace** (ADR-0039, from M3) and their objects need that workspace's edit permission instead of `objects.edit` and `layers.edit`, which are View's. A layer's `workspace` is set when the layer is created, which needs that workspace's edit permission, and does not change in M3.
  - **The check comes before every other check of the request**, the schema, the reserved plugin ids and the session's limit on waiting requests included, as soon as its `entityType` can be read. Where it runs (the session that holds the user's permissions, or the object store) is the CDA's choice; the order is the rule.
  - Without the permission the request is refused: with a `PERMISSION_DENIED` rejection when the request can be answered (as for `VALIDATION_FAILED`), otherwise with an `error`. Nothing changes either way, and no change event is sent.
  - The permissions are the login session's, fixed at login (SDK v1). In the no-login mode the local user has every permission (ADR-0022).
  - **Changes without a user are not checked:** those from a plugin's server part, which act as the plugin (SDK v1), and ECore's own, such as removing expired objects and creating the default layer.
  - **The layer lock** (ADR-0042, from data model 1.3.0, M4). While a layer's `locked` field is true, the store refuses a user's change request with `LAYER_LOCKED`, after the permission check. The refused changes are:
    - creating, updating or deleting an object in the layer;
    - moving an object into or out of the layer;
    - updating or deleting the layer, except an update that changes only `locked` and `drawOrder`.

    Setting or clearing the lock needs the layer's edit permission. Changes without a user pass the lock: plugins' server parts, the simulator's commands included, and ECore's own.
  - **Plugin endpoints:** endpoints are `GET`, and from SDK 1.2.0 also `POST` with a JSON body, for commands (CR-0026). For changes to objects and layers, prefer a change request from the browser, which the server checks, to an endpoint. An endpoint that does change objects or layers on a user's request requires the matching permission itself: `Endpoint.requires`, or `EndpointRequest.user().has(…)` when it needs more than one. Every `POST` endpoint requires a permission. ECore's origin check (`OriginCheckFilter`) refuses cross-site browser requests, and ECore checks the body (JSON, its size) before the plugin sees it. The same holds for any later channel or method.
  - A plugin's own permissions (`plugin.<id>.<name>`) are checked by its server part on its endpoints (SDK v1), not by the object store. The exception, from M3: the view and edit permissions a plugin names for a workspace it declares, which the server enforces (ADR-0039). A plugin permission per data type, checked by the object store, is planned for a later milestone (section 6).
  - **Reading** needs only a login until access by label comes (ADR-0020; ADR-0022 point 8). The exception, from M3: the layers of a declared workspace, their objects, counts and changes reach only users with the workspace's view permission, in subscriptions, queries and fetches by id alike (ADR-0039).
- **Extension ownership is enforced here** (ADR-0007, ADR-0018). On update, the object store applies only the requesting plugin's own namespace and takes every other namespace from the stored entity; foreign namespaces in a request are ignored, never rejected. On create, all namespaces are accepted. The SDKs do not filter. **From data model 1.2.0** a change request may also name declared fields of other plugins that are editable by others; the object store checks each against its declaration and applies them, and only them (ADR-0038). Setting them needs the permission of an ordinary change of that object (above).
- The object store implements the rules in `model/README.md` that the schema cannot express (rules 1–8 and 10–13; from data model 1.0.0 also 14–16: data type and data source, time attributes, external identity).
- **Last write wins.** A change request may carry the version it was based on (`baseVersion`). Version 1 records it but ignores it. Optimistic locking or explicit locks can later use it without changing the model.
- **Reads.** Other workers read immutable snapshots of objects. Area queries use a spatial index maintained by the writer.
- **History later, without redesign.** A change event contains everything needed for history. When history is added, the persistence manager also appends events to an event log. Audit means reading that log, and timeline playback means replaying events up to a chosen time. Unsaved moves (ADR-0041) are the exception: they are not stored, so they will not be in the event log.

### 4.5 Live picture in the browser

- One WebSocket per browser session, carrying JSON messages. The protocol is versioned.
- The client subscribes to an **area of interest** (its viewport plus a margin, and its zoom level). The server sends a snapshot of that area, then deltas derived from change events. A browser's change requests are checked against the user's permissions (section 4.4). Filtering what a user sees by security label comes after M1 (ADR-0020, ADR-0022). From M3 the server filters by workspace: a declared workspace's layers reach only users with its view permission, and a page subscribes to the layers of the workspace it shows (ADR-0039).
- When the client is zoomed out beyond a threshold, the server sends **aggregates** (clusters with counts) instead of individual objects. The thresholds come from spike S3 (`spikes/s3/README.md`). Aggregation comes in M1 (owner, 2026-10-10), with SDK v1.
- **Client capacity (ADR-0017):** the full 100 000 objects need hardware-accelerated WebGL (a GPU). Without one, about 10 000 individually drawn symbols stay usable; above that, the area of interest's budget and clusters (since M1) keep the map usable. Changes reach the map view in batches, and the map view applies them at its own cadence.
- Edits from the browser are sent as change requests over the WebSocket. The shell fills in `requestId` and `source.plugin` for the calling plugin; the server sets `source.user` from the login session. The answer (change event or change rejection) goes back to the requesting plugin. If none arrives, the SDK reports "outcome unknown".
- In M0 the browser receives the whole live picture as a snapshot followed by batches of change events (SDK v0, `livePicture.subscribe`). **From SDK v1** the area of interest and a budget are options of the same subscription (spike S3). Each subscription has its own area; a subscription without one still gets the whole picture, which only small pictures can afford.
- **Content-Security-Policy:** the edge serves the web client with a policy that allows only the emc2 server (`'self'`), so no web part can contact another host (ADR-0030).
- **Plugin channels.** The web part of a plugin talks to its own server part through plugin-scoped channels on the same WebSocket, and through plugin-scoped HTTP endpoints under `/api/plugins/{pluginId}/…`. ECore routes these into the plugin's workers. Plugin code never touches Spring.

### 4.6 Common data model (summary)

The normative schema is JSON Schema in `model/`, owned by the PDA. This section only gives the shape.

**MapObject**

| Field | Meaning |
|---|---|
| `id` | UUID. Globally unique and never reused |
| `type` | Namespaced object type: what the object is on the map, e.g. `core.symbol`, `core.multipoint`, `core.shape` |
| `dataType` | From data model 1.0.0 (ADR-0023): what kind of information the object is, e.g. `cot.cot` or the built-in `core.general`. Declared by plugins in their manifests |
| `dataSource` | From data model 1.0.0 (ADR-0023): where the object came from: `manual` for drawn objects, or the name of the input link (stream) it came through (ADR-0037). Fixed at creation |
| `layerId` | The layer the object belongs to |
| `version` | Increases by one with every change |
| `geometry` | GeoJSON-style geometry. Coordinates are WGS84 `[lon, lat]` or `[lon, lat, alt]` |
| `symbol` | Optional: symbol code (SIDC), standard (APP-6 B, D or E) and modifiers |
| `style` | Optional: stroke and fill, for shapes |
| `properties` | Core properties such as name and description |
| `label` | **Mandatory** security label with the STANAG 4774 structure |
| `extensions` | Map from plugin namespace to JSON. Blind-forwarded. From data model 1.2.0 a plugin may declare fields in its namespace that other plugins' editors set (ADR-0038) |
| `relations` | From data model 1.4.0 (ADR-0051): references to other objects, each a declared kind (`<plugin-id>.<name>`, from the manifests) and the other object's id. Written by any plugin as content; never cascaded. The map view draws them as lines, per user's switch |
| `time` | From data model 1.0.0: optional observation time, valid-from and expiry (e.g. CoT's `time`, `start` and `stale`) |
| `meta` | Set by the object store: created and modified (when, by which plugin, user and/or external system), and an external reference (e.g. a CoT uid). From data model 1.0.0 the external reference comes from the create request and is unique per system |

**Layer:** `id`, `name`, `drawOrder`, `visible`, `label`, and from data model 1.2.0 an optional `workspace` (without it, View; ADR-0039). **Messages:** change request, change event and change rejection (ADR-0018). The plugin manifest schema also lives in `model/`, but is versioned with the SDK.

Rules (normative):
- Coordinates are always WGS84 in **longitude, latitude order** (as in GeoJSON), in decimal degrees. Altitude is metres above the ellipsoid (HAE).
- **Edges are geodesic** (ADR-0019): the edge between two positions is the shorter geodesic, never split at the antimeridian. This differs from GeoJSON (RFC 7946).
- **Extensions:** only the owning plugin writes its own namespace, except the fields it declares as editable by others, which a change request names explicitly (ADR-0038). Everyone else, including ECore and outgoing plugins, forwards it untouched. ECore never drops unknown namespaces. The object store enforces this (section 4.4).
- External identifiers are kept, so repeated updates from an external system modify the same object.
- **Empty means absent** for optional objects and arrays (model rule 13). ECore's codec writes the canonical form, which omits them, so that stored documents and events are deterministic (needed for history and, later, for STANAG 4778 signatures).
- **Types:** Java records and TypeScript types are written by hand in the SDKs. **JSON mapping is ECore's** (Jackson, on the version Spring Boot manages); the SDK's codec contract test checks it against every example in `model/examples/`, and ECore validates incoming documents against the schemas.
- **Versioning:** before 1.0.0, compatible additions are 0.1.x and 0.2.0 is breaking; M1 brings 1.0.0. No field changes meaning in a minor version. A future event log is never rewritten: old events are read through upcasters.

### 4.7 Coordinates, projections and formats

- **Stored:** WGS84 geographic coordinates, in longitude, latitude order everywhere: code, wire format and storage. Mixing up the axis order is the most common bug in geographic software, so every converter has a test that uses a known point where latitude ≠ longitude.
- **Displayed:** the map projection is chosen per map view: Web Mercator, polar stereographic (north and south) and others defined as proj4 definitions in configuration. Background map plugins declare which projections they support. The map view only offers combinations that work, or reprojects raster tiles where that is possible. A WMS background is offered only in the projections its server lists, never reprojected (ADR-0035). A vector background (ADR-0025; Natural Earth, CR-0009, from M1) works in every projection, including the polar ones.
- **Edges are densified** when drawn, so a shape looks the same in every projection (ADR-0019).
- **Viewport** (web SDK `MapView`): centre in longitude/latitude, resolution in metres per pixel at the centre, the projection code, and the visible area as a longitude/latitude ring with geodesic edges. The inside of that ring is the side that contains the centre, so a view around a pole is expressed correctly. It is never a longitude/latitude bounding box.
- **Coordinate formats** for display and input: decimal degrees, degrees-minutes-seconds, UTM and MGRS to begin with. They are provided by the `coordinates` utility plugin: in the browser with proj4js and the `mgrs` library, on the server with Proj4J and NGA's `mgrs-java`.

### 4.8 Persistence manager

- The only path to persistent storage, for both core and plugins.
- Stores (conceptually): objects and layers (fed by change events), plugin documents (a namespaced key mapping to JSON), settings, and each user's own documents (ADR-0027). Later also the append-only event log.
- Implementations: a **file store** (JSON files), and **PostgreSQL + PostGIS** from M6 (ADR-0024; planning in section 6). The implementation is selected by configuration.
- **Write-behind:** a change counts as done when it is applied in memory, and persistence follows asynchronously. Consequence: a crash may lose the last moments of changes. This is acceptable for now and can be switched to write-through later.
- **Unsaved moves (ADR-0041, from M3):**
  - **What they are.** While a simulation runs, the simulator's moves are marked unsaved (`Change.notSaved()`, SDK 1.2.0). A move is an object update that changes nothing but the geometry, the time, and the symbol's direction and speed.
  - **Not journalled.** They are applied and sent as usual, but not written to the journal. The journal declares the sequence numbers and versions it skipped, so loading stays strict everywhere else, and the live sequence stays gapless (model rule 7). Snapshots may hold moved positions.
  - **When the simulator saves.** It saves all its tracks and its own state together: before a route runs; when a route pauses, stops at its end or is reset; when a user changes the simulation during a run; and when the simulation changes while everything is paused (owner, 2026-10-26).
  - **After a restart.** The simulator sets its tracks from its own saved state, the routes' lists say which objects are on which route, and the simulation is paused. A clean server stop during a run is best-effort, like a crash. Sequence numbers and versions used by unsaved moves may be issued again: `baseVersion` is only recorded (ADR-0018, model rule 12), and enforcing it later must settle that reuse.
  - **Who marks them.** Only server parts can mark an update unsaved, and in M3 only the simulator does. ECore does not check which plugin marks (owner, 2026-10-26): the briefs and the reviews do, and the monitor view shows each plugin's unsaved updates.
- At start-up the object store loads the current state through the persistence manager.

### 4.9 Security

- **Login (ADR-0022, from M1):** OpenID Connect against Keycloak, run **on the server side**. The edge runs the Authorization Code flow with PKCE as a confidential client, and tokens never reach the browser. The browser holds only a session cookie (`HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS), which also authenticates the WebSocket handshake. Any OIDC-compliant IAM can replace Keycloak, which runs as a separate local service.
- **Authorization:** the groups in the token are mapped to emc2 permissions (e.g. `objects.edit`, `settings.admin`, `plugin.<id>.<permission>`). The mapping is configuration. Plugins declare their permissions in the manifest and check them through the SDK. **The server enforces every permission; the browser only hides** what a user may not do: change requests in section 4.4, changes of settings and the monitor data in section 4.11, plugin endpoints through the SDK.
- **No-login mode (ADR-0022):** a supported mode for portable use, demonstrations and tests, chosen by configuration.
  - There is one local user, with all permissions.
  - A warning is logged at every start, and the browser shows a "No login" mark.
  - The server listens on loopback only, unless a second setting explicitly allows other addresses.
  - A server configured for login never falls back to this mode.
- **Labels:** every object and layer has a STANAG 4774 confidentiality label. A default label comes from configuration. Labels are stored, shown and forwarded, but not yet used for filtering. **Access by label comes after M1** (owner, 2026-10-10); then access decisions combine the label with the user's clearance from the IAM.
- **Object and layer labels (ADR-0020):** a user sees an object only if cleared for both the object's label and its layer's label, and sees a layer only if cleared for the layer's label. Stored labels are not constrained against each other.
- **Security policy definitions (later):** label-based access control needs, per security policy, the order of its classifications and the meaning of its categories (in the style of a SPIF). That is configuration, not part of the data model: labels already name their policy. From M2 the order of classifications is configuration already, for the Settings tab's Layers entry (ADR-0031); the rest comes with access by label.
- **Browser:** the Content-Security-Policy `'self'` (section 4.5) also keeps web parts from leaking data to other hosts.
- **Outbound HTTP (ADR-0030):** a plugin's server part may reach any host, internet hosts included: the hosts its settings name, which only admins change, and others too (owner, 2026-10-18; the internet handling is reworked in a later milestone). It never takes a host from a browser request, a message or an object's data (ADR-0030; kept by the owner, 2026-10-19). The manifest's `internet` field declares that it goes online, and the monitor view shows the declaration. Every function still has a way to work offline. **ECore does not check the host** (owner, 2026-10-18; T-058): a plugin may call out, declared or not. Declaring it, and never taking a host from a request, a message or an object's data, are the plugin's duty, which the reviews check. ECore's other limits on outbound calls stay: `http` and `https` only, `GET` only, no redirects, a timeout on every call (at most 10 minutes), a 10 MB body and 16 calls at a time per plugin.
- **Connections (ADR-0036, from M3):** a plugin's own sockets follow the same host rule: any host, taken from its settings, never from a browser request, a message or an object's data. **A connection that listens binds to loopback by default**; an admin chooses an interface address, or all interfaces, in the link's settings. **A multicast link that receives needs a network interface that an admin names**; without one it stays stopped, and its status says so. No check has shown that loopback carries multicast on both Windows and Linux (owner, 2026-10-22, R4; the ADR-0036 index note). ECore checks no endpoint: the manifest declares the connections, the monitor view shows what each plugin listens on and connects to, and the reviews check the rules. TLS certificates come from local server configuration.
- **Release limit (ADR-0037, from M3):** each output link has a highest classification it may send, by default the classification of the server's default label; objects above it are skipped and counted, until access by label comes.
- **Binding (STANAG 4778):** hidden behind a `LabelBinder` interface. The first version uses a mock implementation, and the real one replaces it later.

### 4.10 Logging, monitoring and notifications

- **Logging:** SLF4J. Plugins log through a logger from the SDK that tags every entry with the plugin id; its name is `plugin.<id>`, or `plugin.<id>.<worker>` in a worker, so an admin can set one plugin's level (`logging.level.plugin.<id>`). From M7 a release writes the log to `logs/emcc.log`, rolling, as well as to the console (owner, 2026-11-12, M7 plan Q9). A web part's `ctx.log` goes to the browser's console only.
- **Metrics and traces:** OpenTelemetry. Per plugin: number of workers and their states, mailbox depth, messages per second, handler time and hung events. **Memory allocation is not per plugin** (owner, GU, 2026-11-05, after spike S5): the monitor shows the **JVM's total allocation rate and ECore's share** only, averaged over 10 s (T-148). Per-plugin numbers are left out because ordinary workers run on ECore's shared virtual threads, and JFR counts a sample's bytes per carrier thread, so the split between plugins is wrong even though the total is right (`spikes/s5/README.md`). The total comes from the JDK's per-thread allocation counter, ECore's share from JFR's allocation samples; an admin can switch the share off with `emc2.monitor.allocation=false`, which leaves the total (owner, HA).
- **Plugin status:** each plugin reports `OK`, `DEGRADED` or `FAILED` with a detail text, in both SDKs. ECore also sets a status, e.g. `DEGRADED` after a hang. The **effective status is the worse of the two**; a plugin cannot clear a status set by ECore. A web part's status is per browser session and is not part of the server's health.
- **Monitor view:** in the web client, showing live health of core and plugins; from M3 also each plugin's connection tasks (state, counters, the addresses it listens on) and links (rates, objects skipped and why) (ADR-0036, ADR-0037). External dashboards (e.g. Grafana) can be connected through OTLP, but they are optional.
- **Notifications:** a core service that lets plugins show messages to users, with a severity level.

### 4.11 Web client and plugin web parts

- At start-up the shell fetches the list of active plugins and their web entry modules from the server and loads them with dynamic `import()`.
- Shared libraries (React, OpenLayers, milsymbol, proj4, the web plugin SDK, and from SDK 1.1.0 the Lucide icons) are provided once by the shell through an **import map**. Plugin builds treat them as external, so each library is loaded only once (spike S4).
- **Who owns what:** the **list of shared packages and their exact versions** is part of the SDK contract (PDA, web SDK). The **vendor bundle and the import map** are built by the shell from that list (CDA), and published as a build output that plugin builds read, so a plugin that imports a module the shell does not provide fails at build time. The shell's own dependencies must have exactly the listed versions; tests on both sides check it.
- **Web Worker (ADR-0043, from M5):** the symbology plugin's web part draws tactical graphics with mil-sym-ts in one module worker, started with the first graphic. mil-sym-ts is that plugin's own dependency, not a shared package of the import map.
- **Browsers** (owner, 2026-10-16, with CR-0021): the web client needs a browser with the `popover` attribute, which all major browsers have supported since April 2024: Chrome and Edge 114, Safari 17 and Firefox 125 or later, so **Firefox ESR 128 or later**. Older browsers are not supported. The shared confirmation dialog and popover are drawn in the browser's top layer, above the map and every pane, so the shell needs no `z-index` scheme for them.
- Extension points in the web SDK:
  - panels, with a default pane (ADR-0031), and items in the top bar;
  - object actions and map actions for the right-click menus (ADR-0032);
  - settings entries, with the form the shell generates from the declared settings, from SDK 1.2.0 with a field to pick a layer (ADR-0037), and later a plugin's own settings panel instead (`basemap-wms`, M4, ADR-0035);
  - from SDK 1.2.0, workspaces declared in the manifest, and the workspaces a panel, overlay or action belongs to (ADR-0039);
  - from SDK 1.2.0, an editor component for other plugins' declared fields (ADR-0038);
  - a hook through which each part saves and restores its share of a setup (ADR-0031);
  - map interactions and object layers (through the map view);
  - notifications.
- **Workspace (ADR-0031):**
  - **The top bar** has the view tabs on the left: View, from M3 the workspaces plugins declare (Simulation), Settings and Monitor. Settings and Monitor need `settings.admin`; a declared workspace needs its view permission. On the right are plugin items (bookmarks), the setups control, the clock (UTC by default) and logout.
  - **The Settings tab** is a list with a form beside it: General (the installation's default look, ADR-0034), Data types, Layers, then one entry per plugin with runtime settings. In **Layers** an admin changes a layer's classification and may raise its objects' lower classifications. Only the classification changes, in an order of classifications from configuration (the NATO order by default). For now this is cosmetic.
  - **The View tab** has the Map Pane with docked left, right and bottom panes. They can be resized and collapsed. Users move panels between them with buttons.
  - **Workspaces (ADR-0039, from M3):** a declared workspace has the View tab's layout, with its own map state, panel layout, setups and layers. A page shows one workspace at a time; a second browser window shows another. Panels, overlays and actions appear in View only, unless their plugin names other workspaces. In a declared workspace, View's layers can be shown as a read-only reference.
  - **Setups** (ADR-0027 storage), from M3 per workspace: the current setup is remembered automatically, and users save and restore named setups. A setup holds the panel layout, the layers' visibility, the map type, centre, zoom and dim level, the clock choice, and the look, light or dark, and density (ADR-0034). Bookmarks hold only the map type, centre and zoom.
- **Selection and actions (ADR-0032):** the selection is a list of object ids shared by all plugins, at most 1 000. Selecting on the map is the map view's job: a click, Ctrl+click and Ctrl+drag (Cmd on a Mac); Shift+drag zooms to a box. A right-click on a selected object offers the actions for the whole selection; on empty map it offers the map actions, such as Centre map. Edit comes from the plugin that edits that kind of object; **Delete is the shell's**, for any kind of object, with a confirmation and in batches.
- **Each user's own data (ADR-0027):** bookmarks and setups (the remembered one and the named ones) are kept per user on the server. Each plugin reaches only its own namespace, for the current user.
- **The objects panel** (`object-list`, M2) asks the server for the objects of a layer, page by page, independent of the area of interest the map has subscribed to. That includes hidden layers. Any logged-in user may read them, except the layers of a declared workspace, which need its view permission (ADR-0039); labels come later (ADR-0020). Actions on the listed objects come from the object action list (ADR-0032) and still go through change requests (ADR-0005, ADR-0018).
- **Look (ADR-0029, ADR-0034):** the web SDK defines the design tokens and holds a small set of shared components; the shell gives the tokens their values and ships the components' CSS (owner, 2026-10-15). From 2026-11-13 the values, the components' look and the shell's look CSS are the UXA's, and the token names and the components' API stay the PDA's (owner; `agents/uxa.md`). Plugins build their UI from them, with no fixed colours, sizes or fonts of their own. **Three looks** (Night Watch, Chart Room, Signal), each in light and dark, with two densities; each user chooses, and an admin sets the default. The values are in `docs/architecture/looks.md` (UXA). The APP-6 colours, the selection highlight and the background maps are the same in every look. **What a look may set** (ADR-0056): colours with the Edge and Raised surfaces, edge width, corner and control radius, the type of headings and field labels, shadows, the shape of controls and tabs, and card values; through tokens and, in the UXA's `components.css` and `shell-look.css` only, per-look rules of look properties. Never layout, sizes, icons, wording or behaviour.
- **Settings:** a plugin declares its settings as JSON Schema, and the shell generates the form in the plugin's entry of the Settings list (ADR-0031). A plugin's own settings panel instead of the form comes later, as a compatible SDK 1.x addition (owner, 2026-10-15): in M4, for `basemap-wms` (ADR-0035). **The server checks `settings.admin`** for every change of settings, for the settings view's reads and for monitor data; hiding the tab is not the protection. Every logged-in browser also receives the current settings of the started plugins, for their web parts (SDK v1), and the installation's default look, which only `settings.admin` changes (ADR-0034). A changed default look reaches open browsers at their next load, not live (owner, 2026-10-17); a user's own choice still applies at once. ECore's settings include behaviour per data type, such as expiry and fading, with defaults from the declaring manifest. Groups of data types come later (ADR-0023).
- **Map view abstraction:** plugins work with the map through the `MapView` service in the SDK, never through OpenLayers directly. There is no escape hatch to OpenLayers in SDK v0 (owner, 2026-10-04). From M2 the map view offers a **drawing and editing service** for shapes, built on its engine's own tools; the calling plugin sends the change requests (ADR-0033).

---

## 5. Repository layout (normative)

```
emc2/
├── LICENSE                  Project license: Apache License 2.0
├── README.md                The readme of the public GitHub repository (DMA)
├── package.json             npm workspace root: web/shell, web/plugin-sdk, plugins/*/web (MCA)
├── package-lock.json        The one lock file of all workspaces, generated by npm (MCA)
├── node_modules/            Installed packages of all workspaces (not in git)
├── requirements.md          Owner's requirements: what the system must do
├── CLAUDE.md                Rules every agent follows (ACA, approved by the owner)
├── .claude/agents/          Helper sub-agents, e.g. conformance-reviewer (ACA)
├── agents/                  One role description per agent role (ACA)
├── docs/
│   ├── architecture/        How the system is built (ACA)
│   ├── adr/                 Architecture decision records (ACA, approved by the owner)
│   ├── change-requests/     Change requests and the change control process (MCA)
│   ├── handover/            One handover file per role (each role its own)
│   ├── plugins/             Plugin design pattern and plugin briefs (PDA)
│   ├── test-reports/        Integration test reports (ITA)
│   ├── ux/                  The UI's mockups, usability findings and design notes (UXA)
│   ├── reviews/             On-demand reviews: code/ (CRA) and security/ (SRA), each with a findings register; on main once the owner releases them
│   └── status.md            Status board (MCA)
├── documents/
│   ├── design/              Presentation and Software Design Document, built from src/ (ACA)
│   └── manual/              The user manual for operators and admins, built from src/ (UDA)
├── marketing/               The website, contest entries, decks, print and video, built from their sources; CREDITS.md (DMA)
├── model/                   Common data model as JSON Schema (PDA)
├── server/                  Maven multi-module build
│   ├── plugin-sdk/          Java Plugin SDK (PDA)
│   ├── ecore/               Core runtime (CDA)
│   └── app/                 Spring Boot edge and launcher (CDA)
├── web/                     Web client (npm workspaces of the root package.json)
│   ├── plugin-sdk/          TypeScript plugin SDK (PDA)
│   └── shell/               Web client shell (CDA)
├── plugins/
│   ├── _template/           Plugin template that plugin agents copy (PDA)
│   └── <plugin-id>/         One folder per plugin (one PCA each)
│       ├── plugin.json
│       ├── server/          Optional Java part (Maven module)
│       └── web/             Optional TypeScript part
├── tests/
│   └── integration/         End-to-end and cross-part tests (ITA)
├── external/                The external test services' sheets and scripts; the installs are outside the repository (ESA)
├── spikes/                  Short-lived experiments, never used by production code
└── tools/                   Build and development scripts (MCA)
```

**Build wiring of plugins** (owner, 2026-10-05; workspace root moved on 2026-10-08, CR-0006):
- **Server part:** a Maven module of the server build, registered with one line in `server/pom.xml`.
- **Web part:** an npm workspace of the root `package.json`, picked up by the glob `plugins/*/web`. All web parts share one lock file and one `node_modules` at the repository root, and compile against exactly the versions the shell ships.
- **Why the root:** Node and npm look for packages and tools only in the `node_modules` folders of a folder and its parents, so the workspace root must sit above both `web/` and `plugins/`.
- `model/`, `tests/integration/`, `documents/design/src/`, `documents/manual/src/`, the build projects in `marketing/` and the spikes are separate npm projects with their own lock files. They are not workspaces.
- The template in `plugins/_template/` is built and tested the same way, but never installed.

**Every folder has exactly one owning agent.** Other agents may read it but do not change it. A needed change is requested from the owner, through the MCA. The full ownership table is in `CLAUDE.md` section 3.

**Agent operating model:** each role (CDA, PDA, each PCA, ITA, MCA) runs as a separate, long-lived session in its own git worktree, on branches named `<role>/<topic>`. Short, well-defined helper tasks (reviews, research, checks) run as sub-agents. The code review agent (CRA) and the security review agent (SRA) run as sessions on demand only, and change nothing but their own report folders and handover files. Their reports stay on their own branches until the owner releases them. The external services agent (ESA) installs and runs the services emc2 is tested against outside the repository; the other agents use them only through their network interfaces. The user documentation agent (UDA) writes the user manual against the running release. Agents cooperate only through files and git. Only the MCA merges into `main`, after the ITA's tests pass and the owner approves.

---

## 6. Milestones mapped to building blocks

| Milestone | Core (CDA) | SDK and model (PDA) | Plugins (PCAs) |
|---|---|---|---|
| **M0 – Internal demo** (no login, OpenStreetMap, draw symbols) | Plugin host, worker runtime, message bus, object store, file-based persistence, WebSocket live picture, shell with Map Pane and Control Pane | SDK v0 and data model v0, frozen before plugin work starts | `map-view-2d`, `basemap-osm`, `symbology`, `coordinates`, `draw-symbols`, `layer-panel` |
| **M1 – First demo** (Keycloak, polar map, two browsers live, CoT) | Login on the server side with Keycloak, and the no-login mode (ADR-0022); permissions; the list of data types (ADR-0023); the area of interest and aggregation (spike S3); the top bar with the view tabs, the settings and monitor views (ADR-0031, then with one tab per plugin; monitor: spike S5, since moved to M5), and logout or the "No login" mark (ADR-0022) | SDK v1 and data model 1.0.0: listeners and compute workers, Java object access, settings at runtime, permissions, `dataTypes` in the manifest, `dataType`, `dataSource` and time attributes on objects, a vector source for background maps (ADR-0025) | `cot` (ingoing side); `basemap-naturalearth` (offline, every projection, polar included; CR-0009); M0 plugins: UPS in `coordinates`, permissions and a data type picker in `draw-symbols`, permissions in `layer-panel` |
| **M2 – Beautify** (the workspace and its look) | The rest of the workspace (ADR-0031): docked panes with movable panels, plugin items, the setups control and the clock in the top bar, setups remembered and named; the Settings tab as a list instead of one tab per plugin, with the Layers entry (the order of classifications as configuration); each user's own data (ADR-0027); the lists of object actions and map actions and the shared Delete (ADR-0032); a server query for the objects of a layer, page by page, independent of the area of interest, for any logged-in user (labels later); the token values and the shared components' CSS in the shell, with the three looks in light and dark and two densities (ADR-0029, ADR-0034); outbound HTTP no longer limited to the manifest's hosts, and the `internet` declaration in the monitor view (ADR-0030, CR-0013) | Compatible additions to SDK v1, through a CR: panels with a default pane, top bar items, settings entries, a way for each part to save and restore its share of a setup, user documents, object actions (one or several objects) and map actions, fetching objects by id, setting the map's projection, background and dim level, the map view's drawing and editing service (ADR-0033), the query for a layer's objects, design tokens and components, covering what the looks change (ADR-0034). Data model 1.1.0, through a CR: a hatched fill, an arrowhead and markers at a line's points (ADR-0033). The `internet` field documented as a declaration (CR-0013) | `bookmarks` (new: map type, centre and zoom, in a folder tree); `object-list` (new: the objects of a layer, opened by a double-click in the layer panel, also for hidden layers); `draw-shapes` (new: plain shapes, ADR-0033); `map-view-2d`: dim the background map, selecting (click, and Ctrl or Cmd with click and drag), the menus with Centre map, Centre on and Zoom to objects, the drawing and editing service, ellipses, hatched fills, arrowheads, route markers and shape labels, its share of a setup (the layers' visibility included); `draw-symbols`: Edit as an object action (selecting moves to the map view, Delete to the shell); `layer-panel`: a double-click opens the objects panel; `basemap-osm`: any tile server its settings name (CR-0013); all plugins: panels in every pane, the looks and both densities |
| **M3 – Simulator** (simulated tracks sent out as CoT; ADR-0036 to ADR-0041) | Connection tasks for plugins' own sockets (ADR-0036); workspaces: the tabs, switching, setups per workspace, and the server's filter by a workspace's permissions (ADR-0039); declared fields checked and applied by the object store (ADR-0038); a layer picker in settings forms (ADR-0037); spike S6, and unsaved moves with declared gaps in the journal (ADR-0041) | SDK 1.2.0 and data model 1.2.0, one release through a CR at the start of M3: M2's fixes and CR-0022 (an `internet` declaration without default hosts; owner, 2026-10-19), connection tasks (the listener deprecated), output channels (input channels defined), declared fields, workspaces and the layer's `workspace` field; `Change.notSaved()` for a server part's moves (ADR-0041); `POST` endpoints for plugins' commands (CR-0026, folded in) | `simulator` (new: routes, convoys, formations, events and outputs, in the Simulation workspace; ADR-0040); `cot`: links in and out over a TCP client, UDP and multicast, on connection tasks, symbols only, a highest classification per output link (ADR-0037); `draw-symbols`: the "+" for declared fields (ADR-0038); `map-view-2d`, the background maps, `layer-panel`, `draw-symbols`, `draw-shapes`, `coordinates`, `object-list` and `bookmarks`: in the Simulation workspace too (ADR-0039) |
| **M4** (owner, 2026-10-30; decisions BO to BV; plan: [`m4-plan.md`](m4-plan.md)) | A plugin's own settings panel in the Settings list (ADR-0035); the layer lock, enforced by the server for users' changes, with incoming data still passing (BP, ADR-0042); a settings field enabled by another field's value; "Simulation" and "Drawing" as the first layers (BT); the default panel positions (BS); Keycloak run by the ESA, with a lasting demo realm (T-068, T-061) | SDK 1.3.0 and data model 1.3.0, one release through a CR: a `wms` background source and a plugin's own settings panel (CR-0023), the layer's lock, the declared-fields editor with a collapsible list instead of the "+" (BO), right-click while placing and drawing. The in/out playbook and the template's transport pattern (BQ: a pattern, not SDK building blocks) | `basemap-wms` (WMS background maps, polar ones included: tiles or a single image, only in the projections the server offers, layers chosen by the admin from the server's capabilities, WMTS as a stub; its hosts come from its settings; ADR-0035, ADR-0030); `ais` and `adsb` (new, input only, built by the playbook: AIS NMEA 0183 AIVDM over UDP or TCP, ADS-B SBS-1 over TCP 30003; BR, BU); `map-view-2d`: draws the `wms` source, right-click, filled shapes picked by their lines; `layer-panel`: the lock; `draw-symbols` and `simulator`: the new fields list; `simulator`: the route editor's units and controls; `symbology`: 10 to 20 more symbols per category; `coordinates`: an icon over the map; `cot`: greyed layer fields, callsigns on simulated tracks; `draw-shapes`: drag a selected shape (T-066); the decision on military tactical graphics (spike S1, T-065) |
| **M5** (owner, 2026-11-05; decisions GC to GN; plan: [`m5-plan.md`](m5-plan.md)) | Capabilities, optional plugin interfaces (ADR-0044); the user's time and the time control, shown only with a temporal plugin (ADR-0045); display settings per user (ADR-0046), in one window opened from the Map Pane (ADR-0052); relations between objects drawn as pairing lines, first the GMTI pairing (ADR-0051, T-150); the layer picker's "New layer" button that creates the layer at once (ADR-0037); a local overlay in the map view, if SDK 1.3.0 lacks one; spike S5 (memory per plugin, T-059); the product name emcc in the shell (T-134) | SDK 1.4.0 and data model 1.4.0, one release through a CR: the layer picker's button, an object writer for in/out plugins and the output kinds; tactical graphics' amplifiers, point order, catalogue and draw call (ADR-0043); field sets (ADR-0050) and the `vessel` symbol standard (ADR-0047); capabilities and the temporal interface; the display settings service, with one switch per relation kind; relations in the object content and relation kinds in the manifest (ADR-0051); what `terrain` needs | Tactical graphics with mil-sym-ts: `symbology` draws them in a Web Worker, `map-view-2d` shows, selects and drags them, the new `draw-tactical` places and edits them; the new `gmti` (STANAG 4607, ADR-0048) and the simulator's GMTI sensor with Ground truth and Sensor outputs; the new `terrain` (range, bearing, viewshed; ADR-0049); scenarios in the simulator; field sets and vessel symbols in `cot`, `ais`, `adsb`, `draw-symbols`, `symbology` and `map-view-2d`; `cot`'s full SIDC and amplifiers; the user manual in the release zip (UDA) |
| **M6** (owner, 2026-11-09 and 2026-11-10; plan: [`m6-plan.md`](m6-plan.md)) | Move and copy to layer (ADR-0053); a data type brings its field sets (ADR-0054); the speed vector in steps and sensor report data types. PostgreSQL/PostGIS and OpenTelemetry, first planned here, moved on to M7, M8 and M9 (owner, 2026-11-09, 2026-11-11 and 2026-11-13); a GRIB plugin, first planned here too, is not scheduled | SDK 1.5.0 and data model 1.5.0 (CR-0038, CR-0039, CR-0040): images in tactical graphics, the speed vector in steps, sensor report data types, sensor types and job areas | Images in tactical graphics in `symbology`, `map-view-2d` and `draw-tactical`; sensor report symbols; `gmti`'s revisit areas |
| **M7** (owner, 2026-11-09 and 2026-11-11; the first release for outside users; plan: [`m7-plan.md`](m7-plan.md)) | Settings categories; folders relative to emcc (`%emcc%/`); a log file in the release; listing and emptying a layer | SDK 1.6.0 and data model 1.6.0 (CR-0041: `core.text`, Append, relation colours, display classes, categories, colour fields, palettes, `%emcc%/` folders); SDK 1.7.0 and data model 1.7.0 (CR-0042: a data type's stepped fade) | `nvg` (new: NVG in and out, ADR-0055); symbol palettes; Append in `draw-shapes`; the Scenario item; terrain's height map; the sensor package T-177 to T-186; gmti's stepped fade |
| **M8** (owner, 2026-11-13 and 2026-11-14; scope and order on the board, `docs/status.md`) | Bug fixes; the UXA's look and usability work (ADR-0056); the stream channel from a plugin's server part to its web part and the conversion service for MPEG-2 (ADR-0057) | SDK 1.8.0 (CR-0043's parts: symbol labels by place, T-163; the new tokens, T-202; "name once, icon always"; part D, settings schema hints and the manifest icon; part E, the stream endpoint and the conversion call, ADR-0057, CR-0044; part F, a stable id per settings list item, CR-0047; part G, panel parts) | The sensor package; symbol labels per place (T-163); `fmv`, full motion video from STANAG 4609 (ADR-0057) |
| **M9** (proposed by the ACA, 2026-11-16: "productification" and the UAV camera; plan: [`m9-plan.md`](m9-plan.md)) | The settings and credentials files (ADR-0060); HTTPS on the server (ADR-0061); TLS credentials named apart from links (ADR-0062); the service's stop entry point (ADR-0063); compute tasks (ADR-0064; owner, YG A, 2026-11-16). **UAV track, which may be cut to M10:** raw pictures into the conversion service (ADR-0059; the rendering service of ADR-0058 is dropped, owner, YG A). Windows x64 only; Linux, PostgreSQL/PostGIS with S8 and OpenTelemetry move on to M10 (owner, 2026-11-16) | SDK 1.9.0 in two separable parts: P, the TLS credential field, compute tasks and the M9 plan's section 5 items; U, raw pictures into the conversion service. No object or layer schema changes | `cot`: the TLS credential field. **UAV track:** `uav-simulation` (new, ADR-0059) and `fmv`'s output link, which renders and muxes on compute tasks. The Windows service in the release (MCA); the admin guide (UDA); the developer cookbook and the instructions for LLM agents (PDA) |
| **M10** (the owner's list on the board, trimmed 2026-11-23; plan: [`m10-plan.md`](m10-plan.md), approved 2026-11-23) | Settings export and import (ADR-0065); OpenTelemetry and OTLP export (ADR-0013, T-060); the help menu's Status and Licences; map pane overlays hidden in Settings and Monitor; spike S11, HLA 1516 | SDK and data model 1.10.0 through a CR: a presets hint and a settings field a plugin draws (gap G9), a GeoTIFF reader, a query by object ids (G27) | `fmv`: presets, the WMS source's capabilities, errors and tile count, 9000 cached tiles, a degraded camera, bit errors, the data overlay (CR-0055), a pop-out, GeoTIFF imagery (ADR-0066); `uav-simulation`: micro sway, the field of view on the map, the cameras' export and import, "New camera" and "Select on map"; GeoTIFF height data in `terrain`; a ground radar's name and the ground truth after a pause in `simulator`; EPSG:4326 in `map-view-2d`; nvg's text amplifiers; the WinTAK S1 to S5 fixtures (ITA), T-129's ATAK phone check, gmti's "dwells sent a minute" note; the agent setup for outside plugin developers in the template |
| **M11** (owner, 2026-11-23, moved from M10) | Linux: a release bundle, the server and scripts tested on Linux, a `systemd` unit, the Linux H.264 encoder; PostgreSQL/PostGIS persistence with spike S8 and the event table question (ADR-0024) | | `fmv`: a faster WMS fetch, EPSG:3857, the WMS cache's size as a setting |
| Later | History (event log) and a data platform for a local LLM, several nodes and a data lake (options: [`data-platform.md`](data-platform.md), owner's goals of 2026-11-03), label-based access control, real 4778 binding, out-of-process stubs; the object store checks a plugin's permission per data type (owner, 2026-10-14; to be designed) | | NVG, KML, 3D map view (options: [`3d-view.md`](3d-view.md), owner's goals of 2026-11-01); `basemap-wms`: WMTS beyond the stub, logins to WMS servers, a tile cache (owner, 2026-10-19; ADR-0035) |

**Planning decisions** (owner, 2026-10-10):
- Access by security label comes after M1.
- Keycloak runs as a separate local service, not shipped with emc2.
- **PostgreSQL/PostGIS and WMS move to M3**, and on to M4 with the rest of M3's plans (owner, 2026-10-22); PostgreSQL/PostGIS on to M5 (owner, 2026-10-30), then to M6 (owner, 2026-11-05). GeoServer is the WMS test server (T-070).
- **M2 is "Beautify":** the workspace and its look.
- The polar map in M1 comes from Natural Earth data.
- The automatic tests use test doubles for TAK, plus one manual check against a real TAK server before the demo.
- The layer panel's eye (local visibility) stays as it is.
- The rest of M3 is decided when M2 ends (decided on 2026-10-22: M3 is "Simulator", below).
- **M2 in detail** (owner, 2026-10-14, after the M2 feasibility study): ADR-0031 (the settings list, the Layers entry, setups), ADR-0032 (selection, actions, the shared Delete) and ADR-0033 (plain shapes in `draw-shapes`, the map view's drawing service). **Whether M2 adds military tactical graphics** (spike S1) is decided near its end (the decision moved to M3, owner 2026-10-19, and with M3's plans to M4, owner 2026-10-22).
- **WMS background maps** (owner, 2026-10-19, after the ACA's options paper): ADR-0035. A `wms` source in the map view, requested through the plugin's server part; tiles by default, a single image as a setting; only the projections the server offers; the admin chooses each background's layers from a checkbox list of the server's layers; WMTS as a stub; no server logins and no tile cache in its first version (now M4).
- **The visual style** (owner, 2026-10-15, T-055): three selectable looks, each in light and dark, with two densities (ADR-0034, `docs/architecture/looks.md`).
- **A quick test run for M2** (owner, 2026-10-13): about 3 minutes of integration tests for most merges, instead of the full run of close to 20 minutes. Which run a merge needs: `agents/mca.md` (merge procedure, step 3); the run itself: `agents/ita.md`.
- **M3 is "Simulator"** (owner, 2026-10-22): data in and out of plugins through connection tasks, CoT in and out, declared plugin fields, a Simulation workspace and the simulator. Everything planned for M3 before moves to M4. The owner's answers are recorded in [`m3-simulator-decisions.md`](m3-simulator-decisions.md), the source for ADR-0036 to ADR-0040.
- **M4 and M5** (owner, 2026-10-30): M4 is the owner's list on the board (`docs/status.md`, "Milestone M4", decisions BO to BV), planned in [`m4-plan.md`](m4-plan.md); PostgreSQL/PostGIS persistence and monitoring (T-059, T-060) move to M5.
- **M5 and M6** (owner, 2026-11-05, decisions GC to GN): M5 is the owner's list on the board (`docs/status.md`, "Milestone M5"), planned in [`m5-plan.md`](m5-plan.md), with no cut-line. PostgreSQL/PostGIS persistence and OpenTelemetry (T-060) move to M6; spike S5 (T-059) stays in M5.
- **Spike S6** (owner, 2026-10-22): a running simulation's moves are not written to disk; the tracks are saved before a run and when it pauses or stops (ADR-0041). It replaces the spike's proposal 1, which would have saved moving objects once per window.

Milestones named in ADRs are planning; this section holds the current plan (`docs/adr/README.md`).

**Parked ideas**, to be looked at again after most or all milestones, are kept with their research in `docs/architecture/ideas/`. Example: running ATAK plugins with emc2 (owner, 2026-10-07).

---

## 7. Risks and spikes

Spikes are short experiments that answer one question before the design depending on it is frozen.

| Id | Question | Why it matters | Before |
|---|---|---|---|
| S1 | How do we draw multipoint APP-6 tactical graphics? Candidates: mil-sym-ts (US Army renderer; Apache-2.0, checked 2026-10-30) or our own renderer using Spatial Illusions' archived milgraphics as reference. Options and effort: [`tactical-graphics.md`](tactical-graphics.md). **Done 2026-10-30** (T-119, `spikes/s1-tactical-graphics/README.md`): mil-sym-ts (the owner's CN) met all six pass marks and draws every APP-6 D and E multipoint graphic, none of APP-6 B. See ADR-0043 | milsymbol only draws single-point symbols | The owner's decision whether to add them, in M4 (T-065; ADR-0033). The build is in M5 (CO) |
| S2 | Can OpenLayers (WebGL) draw 100 000 symbols smoothly, including in a polar projection, with live updates? **Done 2026-10-05:** yes with a GPU, if updates are batched; about 4.5 fps without one. See ADR-0017 | Core requirement | SDK v0 map interface |
| S3 | Area-of-interest subscriptions and aggregation: thresholds, message sizes, update rates. **Done 2026-10-10** (`spikes/s3/README.md`) | Scales the live picture | M1 |
| S4 | Plugin web parts as separate ES modules sharing libraries through an import map | Web plugin loading | SDK v0 |
| S5 | Approximate per-plugin memory through JFR. **Done 2026-11-05** (T-059, `spikes/s5/README.md`): JFR's allocation sampling is within 4 % for plugin code on platform threads, but ordinary workers share virtual threads and the split between plugins is wrong there; the total is right. The owner chose the JVM's total and ECore's share, no per-plugin numbers (GU; T-148, section 4.10) | Monitoring requirement | M5 (T-059) |
| S6 | Can 1 000 tracks move once per second through the object store, persistence and the live picture to several browsers, and at what cost? Does a moving position need a lighter path than an ordinary persisted change? | The simulator's target (ADR-0040). **Done 2026-10-22** (`spikes/s6/README.md`): the ordinary path carries it; persistence was the cost, and the owner chose not to save a running simulation's moves (ADR-0041) | The simulator's brief, M3 |
| S7 | Can CesiumJS, as a `map-view-3d` plugin, meet the owner's four 3D goals (air corridors, navigating the battlespace, a view for HLA game control, terrain with imagery) offline, at emc2's object count and in polar areas? Options and pass marks: [`3d-view.md`](3d-view.md). **Planned, not scheduled** (owner, 2026-11-03) | The 3D view (ADR-0009, "Later") | The milestone that takes up the 3D view |
| S8 | Can an event log with PostgreSQL read models (PostGIS, MobilityDB) answer the owner's two LLM examples from a local LLM, offline, at AIS volumes on one node, with the user's permissions applied by row-level security? Options and pass marks: [`data-platform.md`](data-platform.md). **Planned, not scheduled** (owner, 2026-11-05: not M5) | The data platform's design | The milestone that takes up the data platform |
| S9 | Can a plugin receive STANAG 4609 full motion video over UDP, play it live in the browser and draw the camera's field of view? **Done 2026-11-14** (the ACA, at the owner's request; `spikes/s9-fmv/README.md`): ST 0601 and ST 0102 decode in pure Java; mpegts.js 1.8.2 (Apache-2.0) plays live H.264 with a first frame after about 0.1 s when the relay starts each viewer at the last keyframe; MPEG-2 converts to H.264 with an LGPL ffmpeg at about half a core per 720p stream. Open: visible-window checks in Edge, Chrome and Firefox, and the live conversion's delay | The FMV plugin's SDK channel (server part to web part), its brief, and the CR for ffmpeg | The FMV plugin |
| S10 | Can emcc simulate a UAV whose full motion video leaves the server as STANAG 4609, rendered from an orthophoto over the terrain? **Done 2026-11-15** (the ACA, at the owner's request; `spikes/s10-uav-fmv/README.md`): Lantmäteriet's historical orthophotos (published under CC0, to be confirmed; the current ones need a licence) over the Sundsvall DTED, rendered per frame with exact ST 0601; plain Java renders 720p in 36 ms on one core (Python 300+ ms); live over UDP with its own transport stream muxing, about 1.4–1.6 cores per UAV, played without errors in the browser. No GPU needed | A simulator feature, which would need (a proposal): an ECore rendering service next to ADR-0057's conversion, a CR for ffmpeg's encoding, and the simulator's camera brief | Decided: ADR-0058, with ADR-0059 proposed; M9's UAV track |

---

## 8. Open items

| Item | Owner | Needed by |
|---|---|---|
| – | – | – |

Resolved: the OpenLayers escape hatch (none in SDK v0), the altitude reference (HAE) and the extra geometry types (Circle, Ellipse, Corridor, ArcBand) in data model v0; the exact versions are pinned in the build files by the CDA; the meaning of object and layer labels (ADR-0020); the build wiring of plugins (section 5).

---

## 9. Glossary

| Term | Meaning |
|---|---|
| ECore | The core runtime of the server |
| Map Pane | The large map area in the View tab |
| Pane, panel | A pane is one of the docked areas around the Map Pane: left, right or bottom (ADR-0031). A panel is one plugin's part of the UI inside a pane; users move panels between panes. The M0 "Control Pane" is today's right pane |
| Setup | A user's arrangement of the workspace: the panel layout, the layers' visibility, the map type, centre, zoom and dim level, the clock choice, and the look, light or dark, and density. Remembered automatically, and saved by name (ADR-0031, ADR-0034) |
| Look | One of the three visual styles a user can choose: Night Watch, Chart Room or Signal, each in light and dark (ADR-0034) |
| Live picture | The shared set of objects all users see, held by the server |
| Worker | A unit that handles messages one at a time and owns its state |
| Compute task | Plugin code that ECore runs in a loop on one of the plugin's declared compute threads, for CPU-heavy work that runs continuously (ADR-0064) |
| Connection task | Plugin code that ECore runs on its own thread for the plugin's own sockets, receiving and sending (ADR-0036) |
| Listener | A long-running loop for blocking I/O over a connection ECore opens; deprecated from SDK 1.2.0 |
| Link, output channel | A link is one configured connection of an in or out plugin, with a target layer or source layers; every output link is also an output channel that other plugins send to directly (ADR-0037) |
| Workspace | A top-bar tab with a map, panes, setups and layers of its own: View, and those plugins declare, such as Simulation (ADR-0039) |
| Change request / change event | A request to change an object / the record that a change happened |
| Label | A STANAG 4774 confidentiality label attached to an object or layer |
| Extension | Plugin-specific data attached to an object, forwarded untouched by others |
| Spike | A short experiment that answers one design question |
| SIDC | Symbol identification code (APP-6 / MIL-STD-2525) |
