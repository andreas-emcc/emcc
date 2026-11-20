# Plugin SDK v1 – design

> **The SDK as it is today:** [the SDK reference](reference/README.md), one page per concept. This file is the history: what each version from 1.0.0 changed, with its tasks, change requests and the owner's answers.

- Owner: PDA · Task: T-034 (1.0.0), T-049 and T-064 (1.1.0), T-076 (1.2.0), T-092 (1.3.0), T-147 and T-150 among others (1.4.0), T-165 among others (1.5.0) · Date: 2026-10-10, 1.1.0 section 2026-10-15, its second freeze 2026-10-16, 1.2.0 section 2026-10-22 to 2026-10-27, 1.3.0 section 2026-10-30 to 2026-10-31, 1.4.0 section 2026-11-05 to 2026-11-09, 1.5.0 section 2026-11-09 to 2026-11-11
- **1.9.0, frozen on 2026-11-18 at the merge of `pda/sdk-1.9-freeze-run` into `integration/sdk-v1.9` (from `237089b4`, sets 1 to 10; the run: owner ACH A); to `main` with M9 (tag `contracts-1.9.0`, MCA)** (part P: CR-0048, approved by the owner 2026-11-16, ZB A; PQ1 to PQ5 A; part U: CR-0050, approved 2026-11-16, ZL A, in it with the UAV track, ABO A) ("SDK 1.9.0" in `docs/plugins/sdk-v1.md`; the model's "Changes in 1.9.0"). **1.8.0, frozen on 2026-11-15 (owner XL A) at the merge of `pda/sdk-1.8-freeze-run` into `integration/sdk-v1.8` (from `f13baaa8`, with T-211); to `main` with M8 (tag `contracts-1.8.0`, MCA)** (CR-0043, approved by the owner 2026-11-13, UO A; with CR-0044 and CR-0047) ("SDK 1.8.0" in `docs/plugins/sdk-v1.md`; the model's "Changes in 1.8.0"). **1.7.0, frozen on 2026-11-12 at the merge of `pda/sdk-1.7` into `integration/sdk-v1.6` (from `30661b96`; its builders `cda/sdk-1.7` `5696e6de`, `pca-map-view-2d/m7` `4decd6d3` and `pca-gmti/m7` `086bf905` checked against it); to `main` with M7 (tag `contracts-1.7.0`, MCA)** (CR-0042, approved by the owner 2026-11-12, TC A; its version TD A) ("SDK 1.7.0" in `docs/plugins/sdk-v1.md`; the model's "Changes in 1.7.0"). **1.6.0, frozen on 2026-11-12 at the merge of `pda/sdk-1.6-freeze` into `integration/sdk-v1.6` (from `4c3de175`, after full runs 1 to 3 and the quick run m7q2 of parts A to H, with full run 4's plugin fixes `b7f9338a`); to `main` with M7 (tag `contracts-1.6.0`, MCA)** (CR-0041, approved by the owner 2026-11-11, RJ A; its version given 2026-11-12, RQ A) ("SDK 1.6.0" in `docs/plugins/sdk-v1.md`; the model's "Changes in 1.6.0"). **1.5.0, frozen by the owner on 2026-11-11 (Q51 A) at the merge of `pda/freeze-1.5.0` into `integration/sdk-v1.5` (from `7eae6708`, after the full run f23 of its five parts); to `main` with M6 (tag `contracts-1.5.0`, MCA)** (CR-0038, approved by the owner 2026-11-09, NB A and NC A; parts 2 to 5 with CR-0039, approved by the owner 2026-11-10, OB A and OC A). Section "SDK 1.5.0" below.
- **1.4.0, frozen by the owner on 2026-11-09 at `49c91962` (MG), after the ACA's reviews of its parts; on `main` since 2026-11-10 (`0ce6728f`, tag `contracts-1.4.0`, with M5)** (CR-0030, approved by the owner 2026-11-05, and CR-0031, approved 2026-11-06; given its version on 2026-11-06 after part 1): section "SDK 1.4.0" below. Changes only through a change request again.
- **1.3.0, frozen by the owner on 2026-10-31 at `461dd82`, after the ACA's review; on `main` since 2026-10-31 (`2a417da`, tag `contracts-1.3.0`, with M4)** (CR-0028, with CR-0023, approved by the owner 2026-10-30): section "SDK 1.3.0" below.
- **1.2.0, frozen by the owner on 2026-10-27 at `8c58da2` (with CR-0026), after the ACA's review; on `main` since 2026-10-29 (`f83cd70`, tag `contracts-1.2.0`, with M3)** (CR-0025, approved by the owner 2026-10-22): built in five parts on `integration/sdk-v1.2`, given its version in one step (2026-10-26); section "SDK 1.2.0" below.
- **1.1.0, frozen by the owner on 2026-10-15 at `a78aa83`, after the ACA's review; on `main` since 2026-10-22 (`fac299b`, tag `contracts-1.1.0`, with M2)** (CR-0014, CR-0015, approved by the owner 2026-10-15): section "SDK 1.1.0" below. Changes only through a change request again. **Second freeze:** CR-0018, CR-0019 and CR-0021 (approved by the owner 2026-10-16) are folded into 1.1.0, which the owner froze again at `22a45bd` (2026-10-16), after the ACA's review; on `integration/sdk-v1.1` since then (`4513c1f`), still 1.1.0 (section "Second freeze" below). The next additions are SDK 1.2.0 (`sdk-1.x-requests.md`).
- Status: **1.0.0, frozen** by the owner on 2026-10-10 at `ade6111`, after the ACA's review (T-035), together with data model 1.0.0 (`model/README.md`). On `main` since 2026-10-12 (`1619e3c`, tag `contracts-1.0.0`). Implements CR-0010 (approved by the owner 2026-10-10). Frozen means: changes only through a change request (`CLAUDE.md` section 5); compatible additions are 1.x; anything incompatible is 2.0.0.
- **This file describes what v1 changes and adds.** Everything SDK v0 defined stays as `docs/plugins/sdk-v0.md` describes it, unless a section below says otherwise. The SDK's own documentation (Javadoc, TSDoc) is normative; this file is the overview.
- Sources: CR-0010; ADR-0003, -0004, -0014, -0022, -0023, -0024, -0025; overview 4.1, 4.2 (C1–C7) and 4.9; the briefs `cot` (named `cot-in` until 2026-10-11), `basemap-naturalearth`, and the M1 edits of `coordinates`, `draw-symbols`, `layer-panel` and `map-view-2d`.

## Scope rule

As for v0: SDK v1 covers **what the M1 plugins and decisions need** (CR-0010 points 1–19; CR-0011, services a plugin uses when they are there; and spike S3's recommendations 1–6, the area of interest and clusters, owner 2026-10-10), and no more. 1.0.0 has **no teardown signal** (`ctx.signal`, owner, 2026-10-10); it can come later as a compatible addition.

## Versioning

- **Both SDKs and the manifest schema are 1.0.0**, the data model is 1.0.0. The Java SDK's and the test kit's Maven versions stay `1.0.0-SNAPSHOT` after the freeze, as v0's did. As in v0, tests keep `Sdk.VERSION`, `SDK_VERSION`, the web SDK's `package.json` and the Maven version (without `-SNAPSHOT`) equal.
- A plugin built for SDK v0 declares `^0.1.0`, which 1.0.0 does not satisfy. **ECore and the shell refuse it** (CR-0005), so every plugin moves to `^1.0.0` (CR-0010, merge order on the board).
- **Incompatible changes from v0**, all for CR-0010:
  - the model types gain the required `dataType` and `dataSource` (data model 1.0.0);
  - `EndpointRequest` gains the user (Java);
  - `BackgroundMapProvider.projections` may be `'any'`, and its `source` may be a vector source (web).

  Everything else is an addition.
- **The components' look is not an SDK change** (owner, 2026-11-13; `agents/uxa.md`, `agents/pda.md` rule 8): look-only changes to `web/plugin-sdk/src/components/components.css` (colours, spacing, radii, type, shadows, states) are the UXA's and need no change request and no new SDK version. Its class names and structure, the components' export, and anything that changes a component's size or layout (e.g. `box-sizing`) stay the PDA's and the SDK's, as item 20 and the tables below record them. `design.test.tsx` stays the PDA's; the UXA runs it and never edits it.

## Plugin manifest

Schema: `model/schemas/plugin-manifest.schema.json` (SDK 1.0.0). New fields:

| Field | Meaning |
|---|---|
| `dataTypes` | The data types the plugin declares (ADR-0023): `id`, `name`, optional `description` and `defaults` (`expiresAfterSeconds`, `fadeWhenExpired`, `removeAfterExpirySeconds`). |
| `uses` | Web service keys the plugin **uses when a provider is there** (CR-0011, approved 2026-10-10). See "Services a plugin uses when they are there" below. |
| `network` | Local-network connections of the server part's **listeners**: `endpoints`, JSON Pointers into the plugin's settings, each to an object with `host` and `port` or to an array of them; and a `reason`. |
| `connections` | Data model 1.2.0 (ADR-0036 point 7): the server part's own connections in connection tasks: `kinds` (`tcp-client`, `tcp-server`, `udp`, `multicast`, `other`), `direction` (`in`, `out`, `both`), an optional `settings` pointer to the links and a `reason`. A declaration; ECore checks no host. |

**What ECore checks at start (plugin host):**
- **`dataTypes`:**
  - every id is `<plugin-id>.<name>`, with the plugin's own id;
  - no id is declared twice, across all plugins;
  - `core.general` is built in.

  A plugin that breaks this is refused. The list of available data types is fixed while the server runs (plugins load only at start, ADR-0003).
- **`network`:** a listener may connect only to a `host` and `port` found at one of the declared places **in the plugin's current settings**. Only `settings.admin` can change settings. M1 does not restrict which addresses may be configured; that is for the SRA (T-046).
- **`settings`:** the configured values are validated against the plugin's settings schema, before they reach the plugin. Values that do not validate are refused in the plugin's settings entry (ADR-0031; in M1 its own tab) and never delivered.
- `permissions` are checked from M1 (below).

## Common principles (unchanged, and what they mean for the new parts)

- **Plugin code runs only inside the plugin's own workers, with one exception: a listener's loop** (overview 4.2: "a dedicated virtual thread with a loop"; from SDK 1.2.0 also a connection task's code, ADR-0036). The loop owns its connection and its own local state. It shares nothing with workers, and talks to them only by sending messages.
- **ECore never blocks on a plugin**, and **no handler ever waits**. Store submissions, queries, plugin documents and settings changes all answer with messages, like asks.
- **Every interaction is expressible as a serializable message** (out-of-process stubs later). The new handles (`ListenerRef`) are immutable values with an opaque id, like `WorkerRef`.

## Java Plugin SDK

### Plugin context

`PluginContext` gains `listeners()`, `store()`, `documents()`, `dataTypes()` and `subscribeSettings(...)`. `settings()` now returns the **current** configured values. `workers()` gains compute workers.

### Settings at runtime

```java
JsonObject now = context.settings();                        // the current values, an immutable snapshot
context.subscribeSettings(streams, SettingsChanged::new);   // after every accepted change
```

- `settings()` may be called from any handler; it returns the values valid at that moment.
- `subscribeSettings(worker, mapper)` delivers the complete new settings after each accepted change. **Settings messages are always delivered** (like replies). Each carries the complete settings, so when several wait undelivered only the latest is kept: the worker always ends with the current values.
- A plugin is never restarted for a settings change. It applies the change itself, e.g. by closing and opening listeners.

### Listeners (C6; CR-0010 point 8)

**Deprecated from SDK 1.2.0** (ADR-0036; owner, 2026-10-22). Rule C6 now puts long blocking I/O in a **connection task**, in which the plugin opens its own sockets of any kind; SDK 1.2.0 brings them (T-076). The listener stays in SDK 1.x for existing code and is removed in the next major version.

```java
ListenerRef north = context.listeners().start(
    ListenerSpec.tcp("tak-north", host, port)               // or .tls(name, host, port, "tak-north"): credentials by name
        .idleTimeout(Duration.ofMinutes(5))                  // no data for that long: the read fails, the loop ends
        .reconnect(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60))),
    () -> new CotReader(applier),                            // a fresh loop for every connection
    streams, StreamEvent::new);                              // Connected / Disconnected(reason) as messages

final class CotReader implements Listener {
  @Override public void run(ListenerConnection connection, ListenerContext ctx) throws IOException {
    InputStream in = connection.input();                     // blocking reads are allowed here, and only here
    connection.write(Bytes.utf8(PRESENCE));                  // a small write, e.g. a presence event
    for (Bytes frame; (frame = framer.next(in)) != null; ) {
      ctx.send(applier, parse(frame));                       // never blocks; the mailbox policy applies
    }
  }
}
```

- **ECore opens the connection:**
  - TCP, or TLS with the client key and trust store named by `credentials`, from local server configuration (never the repository, never the settings; the CDA defines where);
  - with a connect timeout;
  - only to an endpoint allowed by the manifest's `network` (above). Otherwise `start` throws `IllegalArgumentException`.
- **ECore runs the loop** on a dedicated virtual thread per connection. The loop may block in `input()` reads and in `write`. `write` is for small amounts (at most 64 KiB per call); a listener is for receiving.
- **When the loop ends** (it returns, throws, the peer closes, or `idleTimeout` passes):
  - ECore closes the connection and reports `Disconnected(reason)`;
  - after the back-off it connects again, with a **fresh** `Listener` from the factory;
  - `Connected` is reported on each success.

  Without `reconnect`, the listener stops after its first connection.
- **Stopping:** `ListenerRef.stop()`, or the plugin's `stop()`. ECore closes the connection, so a blocked read ends with an `IOException`, and the loop's context is **fenced**: anything it sends afterwards is dropped.
- **No watchdog budget** applies to a loop, because it is expected to block. It must not spend its time computing: parse small frames and pass the work on to workers (CPU-heavy work to a compute worker, C7). ECore reports per listener: connected or not, bytes read and written, reconnects.
- **Caps:** at most **100 listeners** per plugin (an ECore setting).
- **The factory** is plugin code too: ECore calls it on the loop's thread, before the loop. A factory that throws counts as a loop that threw.
- **Writes** block at most the idle timeout; a write that cannot complete by then fails with an `IOException` and ends the loop. Stopping the listener, and the peer closing, end a blocked write too.
- **Endpoints are checked when connecting.** A settings change does not close a live connection: the plugin stops the listeners whose endpoint is gone. A reconnect to an endpoint the settings no longer name is refused (`Disconnected` without a retry).
- **Events** (`Connected`, `Disconnected`) are always delivered, in order. When more than 100 of one listener wait undelivered (a worker that hangs), ECore keeps only the latest. The back-off's shortest delay is 100 ms.
- `ListenerContext` offers `send(worker, message)` (returns `SendResult`, never blocks), `log()` and `stopping()`. It is **not** a `WorkerContext`: a loop cannot `ask`, submit to the store or set timers. It sends to a worker that can.
- UDP (mesh SA) is not in v1 (owner, 2026-10-10). From SDK 1.2.0 a connection task covers it, and every other kind of socket (ADR-0036).

### Compute workers (C7)

```java
WorkerRef<TileJob> render = context.workers().spawn(WorkerSpec.of("render", TileJob.class, Renderer::new).compute(true));
```

- A compute worker is an ordinary worker (mailbox, ask, reply, watchdog, restart) that runs on ECore's **bounded pool of platform threads** instead of a virtual thread, so CPU-heavy work cannot starve the rest.
- Its default watchdog budget is **30 s** instead of 5 s.
- It still must not block on I/O.

### Object access (CR-0010 point 10)

`context.store()` returns `Store`. Every answer is a message to the given worker. Every submission and query counts as an **outstanding ask** under the cap of CR-0005 (10 000 per plugin).

**Changes:**

```java
Change create = Change.createObject(newId, content)
    .withExternalRef(new ExternalRef("cot", uid))           // data model rule 16; create only
    .bySystem("tak-north");                                  // source.system: the external system
store.submit(create, Duration.ofSeconds(10), self(), outcome -> new Applied(uid, outcome));
```

- `Change` carries what a change request carries, except `requestId` and `source.plugin`, which ECore fills in (as the shell does in the browser). Its factories:
  - `createObject`, `updateObject(object, content)` (with `baseVersion`), `deleteObject`;
  - `createLayer`, `updateLayer`, `deleteLayer`.
- A server part's changes have **no user**. Plugins are trusted (requirements), so the object store does not check user permissions for them. Every user's change request is checked first (overview 4.4).
- The answer is a `ChangeOutcome`:
  - `Applied(ChangeEvent)`;
  - `Rejected(ChangeRejection)`;
  - `Unknown(reason)`, on timeout. The change may or may not have been applied; a create may be sent again with the same id (`ENTITY_EXISTS` or `EXTERNAL_REF_EXISTS` then shows it arrived).

  Outcomes are always delivered, like replies.

**Queries:**

```java
store.query(ObjectQuery.byExternalSystem("cot"), Duration.ofSeconds(10), self(), Loaded::new);
```

- `ObjectQuery` selects objects by any combination of:
  - `inLayer(id)`, `ofDataType(id)`, `fromDataSource(name)`;
  - `withExternalSystem(system)` or `withExternalRef(ref)`;
  - `within(area)`, an `Area` (spike S3): a closed ring with geodesic edges, a position inside it, and a margin (`None`, `Metres`, `Share`), the same shape as the web SDK's `Area`.
- `ObjectQuery.all()` selects everything; `byExternalRef`, `byExternalSystem` and `byDataSource` start a query with one criterion. `limit(n)` caps the result.
- The result `QueryResult`:
  - `Found(objects, layers, sequenceNo)`, with **all layers** and the matching objects, consistent with `sequenceNo`;
  - `Failed(reason)`, e.g. more than `limit` objects (default and maximum 100 000);
  - `TimedOut`.

**Subscriptions:**

```java
store.subscribe(ObjectQuery.byDataSource("tak-north"), self(), StoreUpdate::new);
```

- First a `Snapshot` (as a query's `Found`), then `Changes(List<ChangeEvent>)` batches in sequence order with the events that touch a matching object (before or after the change) or any layer.
- **After a gap, a new `Snapshot`**, which replaces everything, as in the browser.
- Snapshot and change messages are always delivered, never coalesced. **Bound:** when more than `Store.MAX_PENDING_UPDATES` (1 000) updates wait undelivered, ECore drops them and later sends one new snapshot instead. Updates already queued may still arrive after `cancel()`.
- The query's `limit` does not apply to subscriptions.
- `subscribe` returns a `Cancellable`.

### Plugin documents (CR-0010 point 11; ADR-0024)

```java
context.documents().get("layers", self(), result -> new LayersLoaded(result));
context.documents().put("layers", json, self(), result -> new LayersSaved(result));
```

- A plugin's own small JSON documents in the persistence manager: key → `JsonObject`, in the plugin's own namespace.
- **Keys:** lowercase words, digits and `-` or `.`, at most 128 characters. **Limits:** at most 1 MiB per document and 1 000 documents per plugin.
- `get` answers `Found(key, value)`, `Missing(key)` or `Failed(reason)`. `put` and `delete` answer `Written(key)` or `Failed(reason)`.
- **Write-behind**, like all persistence: `Written` means applied in memory; a crash can lose the last moments (ADR-0024).
- Answers are always delivered and count as outstanding asks.

### Permissions (CR-0010 point 13; ADR-0022)

- **`EndpointRequest.user()`** is the logged-in user of the browser session that made the request: `User(id, name, permissions)` with `has(permission)`. In the no-login mode it is the local user, who has every permission (`User.noLogin()` in tests).
- **`Endpoint.get(path).requires(permission)`**: ECore answers **403** without delivering the request when the user lacks the permission. Use it for every endpoint that changes something or shows something not everyone may see. From SDK 1.2.0 a `POST` endpoint must name one (`Endpoint.post(path).requires(permission)`, CR-0026); an endpoint that changes objects or layers on a user's request requires `objects.edit` or `layers.edit` (overview 4.4).
- Permissions are strings:
  - core permissions such as `objects.edit`, `layers.edit`, `settings.admin`;
  - a plugin's own `plugin.<id>.<name>`, declared in its manifest.

  Which users have which is ECore's configuration (ADR-0022).

### Data types (CR-0010 point 14)

`context.dataTypes()` returns the available data types (`DataType(id, name, description, declaredBy, defaults)`), with `core.general` first. The list is fixed while the server runs. It carries the manifest's defaults only: in M1 no server part acts on expiry (ECore removes expired objects itself, the map view fades them), so the effective behaviour is in the web SDK only; it can come to Java as a compatible addition.

### Data model types

The records follow data model 1.0.0:
- `MapObjectContent` gains `dataType`, `dataSource` and `time` (`TimeAttributes(observed, validFrom, expires)`, all `@Nullable Instant`);
- `ChangeRequest` gains `externalRef` (create of an object only);
- `ChangeRejection.Code` gains `EXTERNAL_REF_EXISTS`;
- `Meta.ExternalRef` moves to `dev.emcc.sdk.model.ExternalRef`, as it is now used in requests too.

The codec contract test covers the new examples and the migration pairs' `after/` files.

### Test kit

`FakePluginContext` gains the new parts, all deterministic like the rest:
- **listeners** (`FakeListeners`, `FakeConnection`):
  - `ctx.connection("tak-north")` is the latest scripted connection: `feed(bytes or text)`, `close()` (the peer closes), `fail(reason)`, and `written()`;
  - the loop runs on a thread of its own, but only while the test thread waits for it: `runUntilIdle()` resumes a loop that has something to read, and waits until it reads again with nothing fed, or ends;
  - idle timeouts and the back-off run in virtual time (`advance`); `refuse(name, reason)` and `accept(name)` script connection attempts;
  - endpoints are allowed only as the settings name them at `Builder.networkEndpoints(...)`; `Builder.maxListeners(n)` lowers the cap;
  - a loop that throws fails the test, as a handler does.
- **store** (`FakeStore`): in memory, applying model rules 3, 5, 11, 14, 15 and 16. Test controls:
  - `seed(...)` and `seedLayer(name)` for setup;
  - `applyAs(actor, change)` for changes by others;
  - `loseNextAnswer()`, `dropNextRequest()` and `rejectNext(code, message)` for scripted outcomes, `timeOutNextQuery()` for a query;
  - `gap()` for a new snapshot;
  - `areaMatcher(...)` to decide `within` (an `Area`).
- **documents** (`FakeDocuments`): in memory with ECore's limits; `seed`, `failNext`, `stored()`.
- **settings:** `ctx.changeSettings(json)`.
- **data types:** `Builder.dataTypes(...)`, after `core.general`.
- **users** for endpoint calls: `ctx.call(path, user)`. Without a user, the no-login user (every permission) calls. An endpoint that `requires` a permission the user lacks answers 403. SDK 1.2.0: `ctx.post(path, body, user)` and `ctx.request(method, path, headers, bytes, user)` (CR-0026).
- **clock:** `ctx.clock()` (virtual time from 2026-01-01) for audit and event times.

`PluginRules`:
- the message allow list already takes every SDK value type and handle (all of `dev.emcc.sdk.*` but the services), so `ListenerRef`, `Change`, `ChangeOutcome`, `ObjectQuery`, `Area`, `QueryResult`, `StoreUpdate`, `DocumentResult`, `User`, `DataType` and `ListenerEvent` may travel in messages;
- the new service interfaces (`Listeners`, `Listener`, `ListenerConnection`, `ListenerContext`, `Store`, `Documents`) are refused in messages;
- the I/O rule is unchanged in 1.1.0: sockets and the rest stay forbidden, because ECore opens the connection (from SDK 1.2.0 sockets are allowed in connection task code only, ADR-0036); `java.io.InputStream` from a `ListenerConnection` is allowed.

## Web Plugin SDK

### Plugin context

| Member | Change in v1 |
|---|---|
| `user` | **New.** `{ id, name, permissions, noLogin, has(permission) }` for the logged-in user, fixed for the session. In the no-login mode `noLogin` is `true` and `has()` is always `true` (ADR-0022). A web part uses it to show read-only panels; the server checks anyway. The core permissions are in `PERMISSIONS` (`objectsEdit`, `layersEdit`, `settingsAdmin`) |
| `dataTypes` | **New.** The available data types, `core.general` first. Each has the manifest's `defaults` and its **effective `behaviour`**: ECore's configured value where there is one, the default otherwise (ADR-0023 point 7; ACA review B1). The list is fixed; the behaviour may change |
| `onDataTypesChange(listener)` | **New.** Called with the complete list after a user changed a data type's behaviour |
| `expiresAt(object, behaviour)` | **New** (a function). When an object expires (model rule 15), or null. Expiry has no change event: compare with the clock |
| `settings` | Now the **current** values, replaced as a whole on a change |
| `onSettingsChange(listener)` | **New.** Called with the complete new settings after each accepted change |
| `webBase` | **New.** `/plugins/{pluginId}/web/`, the base URL of the plugin's own built files (e.g. data files) |
| `changes.submit(content)` | A create of an object may carry `externalRef` (rule 16) |

### Services a plugin uses when they are there (CR-0011)

A plugin that works without a service, but uses it when a provider is loaded, lists its key in the manifest's **`uses`**, not in `requires`. Example: `map-view-2d` uses `emc2.symbols`, and draws markers without it (owner, 2026-10-09).

```json
{ "id": "map-view-2d", "provides": ["emc2.map-view"], "uses": ["emc2.symbols"] }
```

```ts
const symbols = await ctx.services.get(SYMBOLS).catch(() => null);   // null: draw markers, report DEGRADED
```

- **The shell (CDA, T-038)** treats `uses` keys like `requires` for the **order**: it activates loaded providers first, and rejects cycles across `requires`, `uses` and `dependsOn`. It **reports** a missing provider to the user (in M1 in the Control Pane: "uses emc2.symbols, which no loaded plugin provides"), but **never refuses** the plugin for it.
- `ctx.services.get(key)` on a `uses` key resolves when the provider has activated. It **rejects at once** when no loaded plugin provides the key, and when the provider fails or is disabled.
- A key is in `requires` or in `uses`, never both; the shell refuses such a manifest.
- **The rule of the design pattern becomes:** every key a plugin gets with `get` is in `requires` or `uses`. Keys read with `getAll` (cardinality `many`) need neither, as before.
- **Why a manifest list and not `getAll` for `one` keys:** the shell knows the order before any plugin code runs, the shell can report a missing optional service, and `get` keeps one meaning for every key.

### Area of interest and clusters (spike S3, recommendations 1–6; owner, 2026-10-10)

A map view does not need the whole picture: `livePicture.subscribe(listener, options)` takes the area it shows and a budget. Without options, a subscription gets everything, as in v0 (about 79 MB uncompressed at 100 000 objects).

```ts
ctx.livePicture.subscribe(
  { snapshot, changes, area: (c) => { add(c.entered); drop(c.left); }, clusters: (u) => drawClusters(u) },
  { area: 'viewport', budget: renderingMode === 'hardware' ? 100_000 : 10_000 },
);
```

- **`Area`** (both SDKs): `{ ring, inside, margin? }`, a closed lon/lat ring with geodesic edges, a position inside it, and a margin in metres or as a share. It is never a lon/lat box. `viewportArea(viewport, share = 0.5)` makes one from a `Viewport`.
- **`area: 'viewport'`** follows the map view. The shell adds the margin (half the screen's half diagonal) and asks again only when the view leaves the area it holds, or shrinks below a quarter of it. **`area: Area`** is fixed; to move it, unsubscribe and subscribe again.
- **`budget`**: the most objects shown individually; the server caps it by its own setting. Above it, clusters. The map view's defaults (S3, recommendation 6): 10 000 without a GPU (ADR-0017), 100 000 with one.
- **The listener in area mode** (new optional methods, so a v0 listener still compiles; it simply should not ask for an area):
  - `snapshot`: the area's objects shown individually;
  - `changes`: events in sequence; an event for an id the listener does not hold means "add", and a delete for such an id is ignored;
  - **`area(change)`**: `entered` objects and `left` ids, after a move or when a change took an object out of the area. It comes after every `changes` batch up to its `sequenceNo`. **Drop the left ids**: they were not deleted. This is the one new rule: in area mode, objects also go away without a delete event.
  - **`clusters(update)`**: `{ level, full, upsert, remove }`. A full set comes after a snapshot and with every new level; then only changed and removed cells per batch (about every 200 ms).
- **`Cluster`**: `cell` (id), `position` (mean), `count`, `byLayer` (layer id → count, so a browser can hide a layer at once), `byIdentity` (`friend`, `hostile`, `neutral`, `unknown`; assumed friend counts as friend, suspect, joker and faker as hostile, pending and objects without a symbol as unknown).
- **Layers and counts without objects** (ACA review B2): `{ objects: false }` gives only the layers (snapshot and layer events) and the object count per layer, kept by the server (`snapshot.objectCounts`, then `counts(counts)` after every batch that changed them). For panels such as the layer list; `area` and `budget` are then ignored.
- **Who subscribes how** (design pattern, section 6): the map view and plugins that act on the objects in view with `{ area: 'viewport' }`; plugins that need only layers and counts with `{ objects: false }`; no plugin to the whole picture unless it is known to be small.
- **One area per subscription:** each `subscribe` has its own area and budget; the shell does not merge them (S3 recommendation 5). How the shell carries several subscriptions on one WebSocket (subscription ids, protocol v2) is the CDA's protocol (T-039).

### Vector background maps (CR-0010 point 18; ADR-0025)

`BackgroundMapProvider`:
- `projections: readonly string[] | 'any'`. A vector source declares `'any'` (ADR-0025 point 4).
- `source` is `XyzSource | VectorSource`.

```ts
const naturalEarth: BackgroundMapProvider = {
  id: 'natural-earth', name: 'Natural Earth', projections: 'any',
  attribution: { text: 'Made with Natural Earth' },
  source: {
    type: 'vector',
    background: '#c9dbe8',                                   // water
    layers: [                                                // drawn in this order, first at the bottom
      { id: 'land', style: { fillColor: '#efeadf' } },
      { id: 'coastline', style: { strokeColor: '#7c8c99', strokeWidth: 1 } },
    ],
    load: () => fetch(`${ctx.webBase}data/natural-earth.json`).then((r) => r.json()),
  },
};
```

- `load()` is called by the map view **when the background is first shown**, at most once per page. It resolves to `{ features }`. Each feature is `{ layer, geometry }`: a GeoJSON `Polygon`, `MultiPolygon`, `LineString` or `MultiLineString` in lon/lat. A rejected `load()` is shown as "background unavailable", without breaking the map.
- **Coordinates:** longitudes in −180…180, latitudes in −90…90.
- **Edges are straight in lon/lat**, unlike objects (model rule 10):
  - so **no edge crosses the antimeridian**, and data that crosses it is **cut at ±180°**;
  - a polygon around a pole runs along latitude ±90° (e.g. Antarctica);
  - the map view densifies long edges, clips to the projection's `worldExtent`, and draws cut polygons without a seam (`map-view-2d` function 11).
- **Style:** `fillColor`, `fillOpacity`, `strokeColor`, `strokeWidth`, `strokeOpacity` and `strokeDash`, as the model's `Style`. A polygon layer without a stroke is filled only, so that the cuts do not show. The 1.1.0 fields (`fillPattern`, `arrowhead`, `pointMarkers`) are for objects and are not drawn on background maps.

### Data model types

`MapObjectContent` gains `dataType`, `dataSource` and `time` (`TimeAttributes`). A create of an object may carry `externalRef` (`ExternalRef`; `changeRequests.createObject(id, data, externalRef?)`), and `RejectionCode` gains `EXTERNAL_REF_EXISTS`. The constants `GENERAL_DATA_TYPE` and `MANUAL_DATA_SOURCE` name `core.general` and `manual`.

### Test kit (web)

`createFakeContext(options)` gains:
- `user`: by default the no-login user (every permission); `createFakeUser({ permissions: [...] })` for read-only tests;
- `dataTypes` (after `core.general`);
- `uses`: `services.get` on such a key rejects at once without a provider (CR-0011);
- `changeSettings(values)` and `onSettingsChange`;
- `webBase`;
- applied creates keep `externalRef` in `meta`.

`createFakeVectorBackground(features)` builds a vector background provider that counts its `load()` calls.

The fake live picture records each subscription's options (`liveSubscriptions`) and feeds `live.area(change)` and `live.clusters(update)` to area subscriptions, `live.counts(counts)` to `objects: false` subscriptions (which get no object events). `changeDataTypeBehaviour(id, behaviour)` changes a data type's effective behaviour.

## SDK 1.1.0 (M2; CR-0014, CR-0015)

Compatible additions to 1.0.0, approved by the owner on 2026-10-15 (T-049, T-064). A plugin built for `^1.0.0` keeps working on 1.1.0. A plugin that uses an addition declares `^1.1.0`. The TSDoc and Javadoc are normative; this section is the map.

### Versions

- **One SDK 1.1.0** for both CRs: the web SDK, the Java SDK and the test kit, with one equal version, as before. The Java SDK changes only its model types (CR-0014).
- **Data model 1.1.0** (CR-0014; `model/README.md`, "Changes in 1.1.0"): optional `style` fields `fillPattern` (`solid`, `hatch`), `arrowhead` (`none`, `end`) and `pointMarkers` (`none`, `circle`). Every 1.0.0 document stays valid; nothing migrates. The Java `Style` keeps its six-argument constructor, so 1.0.0 code still compiles. **But a Java plugin that rebuilds a `Style` with the six-argument constructor drops the 1.1.0 fields on update** (an update replaces `style` as a whole, model rule 5): to keep them, copy the received `Style` or use the nine-argument constructor.
- **Shared libraries:** `lucide-react` 1.49.0 joins them (ISC, with MIT parts from Feather), for the icons. The shell provides it through the import map; plugins import icons from it and never bundle it.
- **Two documented behaviours** are new only in writing:
  - the selection holds at most 1 000 ids (no M0 or M1 plugin sets more than one);
  - a waiting `dragObject` takes only a press that starts on its object (what `map-view-2d` 1.0 already does).
- **Interfaces that plugins implement grow:** `MapView` gains members, which its only provider, `map-view-2d`, implements in T-054. `PluginContext` and `Ui` are the shell's (CDA, T-050 to T-052).

### Web SDK additions

| Item | API | Source |
|---|---|---|
| 1 | `ui.addPanel({ id, title, icon?, defaultPane, order?, component })` returns `{ show(), remove() }`. `addControlPanel` stays and means the right pane. A panel must work in every pane | ADR-0031 point 4 |
| 2 | `ui.addTopBarItem({ id, order?, component })`: small controls on the right of the top bar | ADR-0031 points 1, 6 |
| 3 | No API: the shell shows the generated settings form in the plugin's entry of the Settings tab. A plugin's own settings panel is a later 1.x addition (owner, 2026-10-15) | ADR-0031 point 2 |
| 4 | `ctx.setup.register({ save, restore })`, `ctx.setup.changed()`: the plugin's share of the user's setup, at most 64 KiB (`MAX_SETUP_SHARE_BYTES`) | ADR-0031 point 5 |
| 5, 6 | `ctx.actions.addObjectAction(...)`, `addMapAction(...)`: scope by `types`, `dataTypes` or `test`; `multiple`; `permission`; `run(ids)` or `run(position)`. `applicableObjectActions` and `applicableMapActions` state the menu's rule (scope, one or several, permission; order `view`, `edit`, others, `delete`) | ADR-0032 points 2, 5, 8, 9 |
| 7 | `ctx.actions.openMenu(at, { objects } \| { position } \| { choose })`. After `choose`, the shell sets the selection to the chosen object | ADR-0032 point 3 |
| 8 | `ctx.objects.get(ids)`: `{ found, missing }`, at most 1 000 ids (`MAX_FETCH_IDS`), also objects the browser does not hold | ADR-0032 consequences |
| 9 | `ctx.objects.queryLayer(layerId, { page, pageSize })`: `{ objects, total, … }` in the order of creation (sorted by id, which is the order of creation for UUID v7 ids), pages of at most 500 (`MAX_PAGE_SIZE`, default 100), independent of the area and of local visibility. Failures reject with `ObjectQueryError`: no answer in time, a lost connection, an invalid request, a layer that does not exist, or a busy server (too many queries waiting; try again later) | ADR-0031 consequences |
| 10 | `SHELL_SOURCE_PLUGIN` = `core-shell`, the `source.plugin` of the shell's own change requests (the shared Delete, the Layers entry). `isReservedPluginId`: `core` and every id starting with `core-` are reserved, and ECore refuses a plugin with such an id. ECore accepting `core-shell` from the shell is T-051 | ADR-0032 consequences |
| 11 | `MapView.selection`, documented: at most 1 000 ids (`MAX_SELECTION`); it may hold ids the map does not hold, and the map prunes only deleted ones; the waiting `dragObject`; Escape and the Delete key only outside text fields | ADR-0032 point 1 |
| 12 | `MapView.centreOn(ids)`, `zoomTo(ids)`: the middle of the extent in map coordinates; one object about 10 km wide. They fetch what the map does not hold, and the map view's own actions call them | ADR-0032 point 6 |
| 13 | `MapView.draw(kind, { style })` and `edit(id, { style })`: geometry in lon/lat, circles and ellipses in metres, or `null`. They change nothing. `edit` rejects with `NotOnMapError` for an object the map does not draw (centre on it first); from SDK 1.2.0 an already aborted `signal` resolves with `null` instead | ADR-0033 point 3 |
| 14 | `MapView.mapType`, `onMapTypeChange`, `setMapType`: projection and background, for setups and bookmarks. The dim level is part of the map view's setup share | ADR-0031 consequences |
| 15 | `MapView.onLayerVisibilityChange` | ADR-0031 point 5 |
| 16 | `OBJECT_LIST` (`emc2.object-list`) with `open(layerId)`, provided by `object-list`, used under `uses` | Overview section 6 (M2) |
| 17 | `ctx.userDocuments.get`, `put`, `delete`, `list`: the user's own documents in the plugin's namespace. `USER_DOCUMENT_LIMITS`: 256 KiB per document, 200 per namespace and user, 4 MiB per user (CDA, owner 2026-10-15). Names as plugin document keys. Over HTTP. Errors: `UserDocumentError` with its `problem` | ADR-0027 |
| 18 | `TOKENS`: the CSS custom properties `--emc2-…` (colours, fonts and heading style, radius, shadows, the focus style, a backdrop, and the plugin sizes of the density table). The nine 1.0.0 tokens stay as aliases (`TOKEN_ALIASES`) | ADR-0029, ADR-0034, `docs/architecture/looks.md` |
| 19 | `ctx.theme`: `current` (look, light or dark, density), `tokens()`, `onChange`, for what a plugin draws on canvas | ADR-0034 |
| 20 | The shared components: `PanelFrame`, `Button`, `IconButton`, `TextField`, `ColorField` (second freeze), `Select`, `Checkbox`, `Slider`, `Tabs`, `Menu`, `Popover`, `ConfirmDialog`, `Notice`, `List`, `ListRow` and `Tree`. They are controlled and built from the tokens. Their CSS is `@emc2/plugin-sdk/components.css`, which the shell ships (owner, 2026-10-15); its look is the UXA's from 2026-11-13 ("Versioning" above). The second freeze adds their keys, `Tree`'s drag and drop, and the browser's top layer for `Popover` and `ConfirmDialog` | ADR-0029 point 2 |
| 21 | `Icon`: a Lucide icon at the density's icon size, with an absolute 1.75 px stroke | ADR-0034 point 6 |

### Second freeze (CR-0018, CR-0019, CR-0021)

Approved by the owner on 2026-10-16 with the collected SDK change requests, and folded into 1.1.0 before it reaches `main` (the version stays 1.1.0; no pin changes). All are compatible: the props of 1.1.0 keep their meaning, and only optional props and one component are added. The TSDoc is normative.

| CR | What | API |
|---|---|---|
| CR-0021 | `ConfirmDialog` is a modal `<dialog>` (`showModal()`) and `Popover` a `popover="manual"`, both in the browser's top layer, above everything in the page. Both stay controlled: Escape, the browser closing the dialog, and a press outside the popover and its anchor become `onCancel` and `onClose`. The popover stays in its place in the page (Tab order, `contains`) and is placed by the SDK against its anchor inside the window. The dialog traps the focus while open and returns it on close. Without the browser features (jsdom), both are plain elements with the same roles | `Popover`'s optional `anchor` (a ref; default: the element it is rendered in) |
| CR-0019 | `List`, `Tree` and `Menu` are one Tab stop each, with Up, Down, Home and End (the menu wraps and focuses its first enabled item when it appears); in the tree Right and Left open, close and move between levels. In `List` the keys move the focus only; Space selects (owner, 2026-10-16). Drag and drop in `Tree` for mouse and pen ("Move to…" is the keyboard way): into the middle half of a folder row, before or after a folder on its top or bottom quarter (owner, 2026-10-16), and before or after any other row by its half; never on the node itself or below it | `Tree`'s optional `onDrop(drop: TreeDrop)` and `canDrop(id, parentId)`; `TreeDrop` `{ id, parentId, index }`, `index` counted after the dragged node is taken out |
| CR-0018 | `ColorField`: the browser's picker as a swatch and the colour as text. `value` in either case, `onChange` always a valid lower-case `#rrggbb`, `onCommit` as `TextField`'s and once when the picker closes. Typed text that is not a colour is kept, and the field says so at Enter or blur (owner, 2026-10-16), or shows the plugin's `error` | `ColorField({ label, value, onChange, onCommit?, disabled?, error? })` |

- **Browser minimum** (CR-0021): the `popover` attribute, in every major browser since 2024 (Firefox ESR 128 or later); the ACA records it in overview 4.11.
- **Tests:** the SDK's components are tested in a page (jsdom, with `@testing-library/react` 16.3.3, `jsdom` 30.1.2, `react-dom` 19.3.0 and `@types/react-dom` 19.3.0 as test-only dev dependencies, owner 2026-10-16). Plugins' own Testing Library tests see the same roles and labels as before.
- **Not in it:** CR-0016 (option B: the bookmarks brief changes, `goTo` keeps its behaviour), CR-0017 (rejected: the object-list brief says when field changes show), CR-0020 (decided on its own).

### Not in 1.1.0

- A plugin's own settings panel, and user documents for the server part. Both are later compatible 1.x additions, when a plugin needs them (owner, 2026-10-15).

### The manifest (CR-0013)

The schema's form is unchanged. Its descriptions follow ADR-0030 and ADR-0031:
- **`internet`** is a **declaration**: that the server part reaches outside hosts **through the SDK's outbound HTTP**, why, and its default hosts. **A plugin's own sockets are declared as connections** (`connections`, ADR-0036 point 7), whatever host an admin names, internet hosts included; they need no `internet` (CR-0052, owner AAH A). It is shown in the monitor view. From M2, ECore no longer enforces it as an allow-list: the server part may reach any host (owner, 2026-10-18; CDA, T-058), but never one taken from a browser request, a message or an object's data (ADR-0030; owner, 2026-10-19). The test kit's fake lets every host through as well (`internetHosts(...)` stays, as the declaration). From data model 1.2.0, `hosts` may be empty (CR-0022): `"hosts": []` with the reason, when every outside host comes from settings an admin fills in. Every function must still work offline. The browser talks only to the emc2 server.
- **`settings`** are edited in the plugin's entry in the Settings tab. They reach every logged-in browser, so they hold no secrets.

### Test kit (web)

`createFakeContext` gives a fake for every addition:
- the panels, with how often each was shown (`addedPanels`, apart from `panels`, which lists `addControlPanel` as before: a plugin that moves to `addPanel` changes its tests to `addedPanels`), and the top bar items;
- the setup share: `saveSetup`, `restoreSetup`, `setupChanges`;
- the actions and the menus: `runObjectAction` and `runMapAction` follow the menu's rule;
- `createFakeObjectListService()` for plugins that open the objects panel;
- `objects.get` and `queryLayer` over `setServerObjects` (and `setServerLayers`, so that an unknown layer rejects), and `failObjectQueries`;
- user documents with the limits, and `failUserDocuments`;
- `theme` with `changeTheme`, starting from `FAKE_TOKEN_VALUES` (Night Watch, dark, compact).

`createFakeMapView` adds:
- a `goTo` that moves its viewport;
- one interaction at a time, with `completeDrawing` and `runningInteraction`, and `drawCalls` and `editCalls` with their options;
- `setObjectPositions`, so that `centreOn` and `zoomTo` move the viewport and report the ids they cannot show;
- `setNotDrawn` for `edit`;
- the 1 000-id selection;
- the map type with fallback, and visibility events.

## SDK 1.2.0 (M3; CR-0025, and CR-0026 folded in)

Approved by the owner on 2026-10-22 with CR-0020, CR-0022 and CR-0024 (`docs/change-requests/CR-0025-sdk-and-data-model-1-2-0.md`): compatible additions to 1.1.0, built on `integration/sdk-v1.2` in five parts. **The version moved to 1.2.0 in one step after the last part** (owner, 2026-10-22 and 2026-10-26): the PDA's SDKs and data model on `pda/sdk-1.2-version`, every plugin's and the shell's pin and the lock file on the MCA's `mca/sdk-1.2-pins`, merged together. Plugins keep `sdkVersion` `^1.1.0` until they use an addition. Then the ACA reviews the whole and the owner freezes it. The TSDoc and Javadoc marked "SDK 1.2.0" are normative; this section is the map, and grows with each part.

### Part 1: M2's fixes, CR-0020, CR-0022 and CR-0024

| Addition | Where |
|---|---|
| `Button` and `IconButton`: `expanded` and `hasPopup` (`aria-expanded`, `aria-haspopup`; `PopupKind`) | `components/index.tsx` |
| `IconButton`'s `title`, a tooltip apart from its `label` (CR-0024); `IconButtonProps` | `components/index.tsx` |
| `TextField`: `readOnly`, `inputMode`, `autoComplete`, `spellCheck`; its error outside the label, linked with `aria-describedby` | `components/index.tsx` |
| Text inputs and `ColorField`'s swatch `border-box`, as high as `Select` and `Button` | `components/components.css` |
| `Popover`: a press in an open dialog that is not around it (e.g. its own `ConfirmDialog`) is not a press outside | `components/index.tsx` |
| `MapView`: an optional `signal` for `pickPoint`, `dragObject`, `draw` and `edit` (`InteractionOptions`, CR-0020); a waiting `dragObject` and Escape | `services.ts` |
| Test kit: `checkLookCss(css, { pluginId, allow?, allowClasses? })`, the CSS part of check 9 as refined on 2026-10-23 (`var()` fallbacks, own custom properties where they are used, system colours outside forced colours, families in the `font` shorthand, `@keyframes` and nested rules included); the fake map view honours `signal` | `testing/look.ts`, `testing/index.ts` |
| Data model 1.2.0: `internet.hosts` may be empty (CR-0022) | `model/schemas/plugin-manifest.schema.json`, `model/README.md` |

### Part 2: connection tasks (ADR-0036)

| Addition | Where |
|---|---|
| `PluginContext.connections()`: `Connections.start(spec, factory[, events, toMessage])`, a fresh `ConnectionTask` per run on a thread of its own, a platform thread on every OS (CR-0027, owner 2026-10-28: JDK-8334574 on Windows; the test kit's `FakeConnections` too); the cap `MAX_TASKS` (100, children included) | `dev.emcc.sdk.connection`, `PluginContext` |
| `TaskContext`: `take`, `poll`, `closeOnStop`, `send` (fenced after the stop), `startChild`, `count`, `detail`, `listening`, `peer`, `lastActivity`, `tls` and `sslContext` by name, `stopping`, `log`, `self` | `connection/TaskContext.java` |
| `ConnectionSpec` (name, inbox type, capacity, `Overflow`, `Restart`), `Restart` (`never`, `onFailure`, `always`), `connection.Backoff`, `ConnectionRef` (`post`, `count`, `detail`, `stop`), `ConnectionEvent` (`Running`, `Restarting`, `Stopped`, `Failed`) | `dev.emcc.sdk.connection` |
| `ListenAddress.from(link)` (loopback unless the settings name another address) and `ListenAddress.multicast(link)` (an interface an admin names, R4); they only parse (R6) | `connection/ListenAddress.java` |
| The listener deprecated (`@Deprecated(since = "1.2.0")`), kept in SDK 1.x | `dev.emcc.sdk.listener`, `PluginContext.listeners()` |
| `PluginRules`: sockets, socket factories, NIO network channels and name lookups only in `ConnectionTask` classes and their nested classes; HTTP and files nowhere; the new services kept out of messages | `testkit/PluginRules.java` |
| Test kit: `FakeConnections` in `FakePluginContext` (`connections()`, `connectionTask(name)`, `Builder.maxConnectionTasks`, `Builder.tlsCredentials`) and `FakeTaskContext` for a task alone | `testkit/` |
| Data model 1.2.0: the manifest's `connections` declaration | `model/schemas/plugin-manifest.schema.json`, `model/README.md` |

`PluginContext.connections()` was a default method that threw until ECore ran connection tasks (T-079), so ECore kept building meanwhile; abstract since W1 (2026-10-28, below).

Multicast: no check was made of which platforms carry multicast on loopback, so the strict rule of R4 holds: `ListenAddress.multicast` needs an interface that an admin names, and without one the link stays stopped.

### Part 3: output channels, classifications and the layer picker (ADR-0037)

| Addition | Where |
|---|---|
| `PluginContext.channels()`: `Channels.offer(spec, worker, mapper)` (one channel per output link; `ChannelRef.withdraw()`), `watch(worker, mapper)` (the current `ChannelList`, then each change, latest only), `send(channelId, item)` (never blocks; `CLOSED` for a channel that is gone); the caps `MAX_OFFERED`, `MAX_IN_FLIGHT`, `MAX_PENDING` | `dev.emcc.sdk.channel`, `PluginContext` |
| `ChannelSpec` (link, name, output type, `ChannelCapability.DELETE`, fields), `ChannelInfo`, `ChannelId` (plugin and link, `plugin/link`), `ChannelList` (`find`, `ofType`), `ChannelItem` (`Update(id, content)`, `Removal(id)`; `Coalescing` by the object id) | `dev.emcc.sdk.channel` |
| `FieldRef(plugin, name)`, a declared field (part 4 uses it too) | `model/FieldRef.java` |
| `PluginContext.classifications()`: `Classifications` (each policy's order, `compare`, `within`, `knows`; `nato()`; policy names match ignoring case, as in the server's configuration), and `ClassificationLimit.from(setting, defaultLabel)` for a link's highest classification `{policy, classification}` (R7): another policy or a classification outside the order counts as above | `Classifications.java`, `ClassificationLimit.java` |
| The layer picker: `"x-emc2": {"kind": "layer"}` (`"allowNew": false` for existing layers only) on `{id?, name}`; `LayerChoice.from` and `LayerChoice.list` only parse | `LayerChoice.java`, `model/examples/valid/manifest-layer-picker.json` |
| `PluginRules`: `Channels` kept out of messages; channel items, lists, ids and handles, classifications and picked layers may travel in them | `testkit/PluginRules.java` |
| Test kit: `FakeChannels` (`offered`, `pending`, `sent`, `deliver`, `addOther`, `removeOther`, `list`), `Builder.maxChannels`, `Builder.classifications` (NATO by default). It hands over one item at a time, where ECore lets up to `MAX_IN_FLIGHT` wait in the worker's mailbox, so it coalesces more than ECore; and it is single-threaded: call it from the test thread or a handler | `testkit/` |

`channels()` and `classifications()` were default methods that threw until ECore had them (CDA, with T-079 or T-081); abstract since W1 (2026-10-28). Classifications are in the Java SDK only: output plugins filter on the server, and no web part needs the order in M3 (owner, 2026-10-24).

**Input channels** (ADR-0037 point 5) are specified here and **reserved**: they are not in the 1.2.0 API and come, compatibly, when a first plugin needs them. An input link offers `offerInput(InputChannelSpec spec)`, which returns a `ChannelRef`, and publishes each received object with `ChannelRef.publish(ChannelItem)`; another plugin's server part finds them with `watchInputs(worker, mapper)` and subscribes with `subscribe(inputChannelId, worker, mapper)`; the subscriber gets the items as messages, coalesced by object id as for output channels.

### Part 4: declared fields and updates that are not saved (ADR-0038, ADR-0041)

| Addition | Where |
|---|---|
| Data model 1.2.0: the manifest's `fields` and the change request's `fields` | `model/schemas/plugin-manifest.schema.json`, `change-request.schema.json`, `common.schema.json` (`fieldName`), `model/README.md` |
| Java: `DeclaredField` (with `problem(value)`, `belongsTo`, `ref`), `PluginContext.declaredFields()`, `model.FieldValue`, `ChangeRequest.fields`, `Change.withFields` | `DeclaredField.java`, `model/FieldValue.java`, `model/ChangeRequest.java`, `store/Change.java` |
| Java: `Change.notSaved()` (object updates only, no fields; the component is `saved`, true by default) | `store/Change.java` |
| `Change` and `ChangeRequest` keep their 1.1.0 constructors; a test checks the defaults (N5) | `DeclaredFieldsAndNotSavedTest` |
| Java test kit: `FakeStore` checks and applies declared fields, refuses an unsaved update that is more than a move, and has `unsaved()`, `restart()` and `snapshotNow()`; `Builder.declaredFields` | `testkit/FakeStore.java`, `testkit/FakePluginContext.java` |
| Web: `DeclaredField`, `FieldValue`, `ctx.declaredFields` (required since W1), `changeRequests.withFields`, `declaredFieldProblem`, `fieldProblems`, `parseFieldNumber`, `fieldBelongsTo`, `fieldEditableBy`, `fieldValuesOf`, `changedFields`; `withFields` refuses a number JSON cannot carry | `fields.ts`, `model.ts`, `context.ts` |
| Web: the `DeclaredFields` editor with its "+" | `components/fields.tsx` |
| Web test kit: `createFakeContext({ declaredFields })`; the default policy checks fields (`fieldsRejection`) and applies them to the event's state | `testing/index.ts` |

`declaredFields()` was a default method that threw until ECore had it (abstract since W1, 2026-10-28), and `ctx.declaredFields` was optional until the shell had it (CDA, T-081); both are plain since W1 (2026-10-28; section "Before the freeze", below). The SDK's codec contract test round trips `change-request-update-object-with-fields.json` since ECore's codec maps `fields` (2026-10-26; it was in `ModelCodecContractTest.CODEC_PENDING` until then, owner 2026-10-25).

The editor shows the fields that **name** the object's data type and every field in `values`; the "+" offers the other editable fields, those without `dataTypes` included. A field without `dataTypes` belongs to every object, so it is offered everywhere rather than shown on every editor.

### Part 5: workspaces, fade lists and geodesics (ADR-0039, ADR-0040; CR-0025 parts 5 to 7)

| Addition | Where |
|---|---|
| Data model 1.2.0: a layer's `workspace` (absent: View, `core.view`, kept as absent; on update absent keeps the stored one, an explicit other one is rejected; an object's move to another workspace's layer is rejected) and the manifest's `workspaces` | `model/schemas/layer.schema.json`, `plugin-manifest.schema.json`, `model/README.md` (rule 5's exception) |
| Java: `Workspace` (`VIEW`, `view()`, `editPermissionFor`), `PluginContext.workspaces()`, `LayerContent.workspace` (`inWorkspace`, `workspaceOrView`), `ObjectQuery.workspaces` (`inWorkspaces`, `matchesWorkspace`; **empty means every workspace**, N9); the 1.1.0 constructors kept | `Workspace.java`, `model/LayerContent.java`, `store/ObjectQuery.java` |
| Java test kit: `FakeStore` with the workspace rules (R1, R2), queries and subscriptions by workspace, `applyAs(Actor, User, Change)` with the edit permission per workspace; `Builder.workspaces` | `testkit/FakeStore.java`, `testkit/FakePluginContext.java` |
| Web: `Layer.workspace`, `WorkspaceInfo`, `VIEW_WORKSPACE`, `EVERY_WORKSPACE`, `CurrentWorkspace`, `ctx.workspace` and `ctx.workspaces` (required since W1), `appearsIn`, `workspaceOf`; `workspaces?` on `Panel`, `ControlPanel`, `MapPaneOverlay`, `ObjectAction` and `MapAction` (default View; `'*'` every workspace); `LivePictureOptions.workspaces` (absent: follows the workspace shown); interactions end with `null` on a switch | `workspace.ts`, `context.ts`, `actions.ts`, `services.ts` |
| Web: `MapView.createFadeList()` (optional until `map-view-2d` provided it in T-085; required since W1, 2026-10-29) and `FadeList` | `services.ts` |
| Web test kit: `createFakeContext({ workspace, workspaces })`, `switchWorkspace(id)` (fresh snapshots, the share saved for that workspace, `onChange`, in that order), the live picture filtered by workspace; the fake map view's `fadeLists`, `faded`, `asPlugin` and `switchWorkspace()` (the map view's moment: the interaction ended, the fade lists and the selection cleared; called before the context's) | `testing/index.ts` |
| Java: `dev.emcc.sdk.geo.Geodesy` (`inverse`, `direct`, `path`), `GeodesicLeg`, `GeodesicPath` (`lengthMetres`, `legLengths`, `at`), `PathPoint`: WGS84, lon/lat, azimuths 0 to below 360, altitudes passed through | `dev.emcc.sdk.geo` |
| GeographicLib-Java 2.1 (MIT) as a dependency of the SDK's `api`, pinned in `server/plugin-sdk/api/pom.xml` (owner, 2026-10-25); ECore does not share it with plugins (R3), `PluginRules` forbids it in plugin code, `SdkArchitectureTest` keeps it inside `dev.emcc.sdk.geo` | `api/pom.xml`, `testkit/PluginRules.java` |

`PluginContext.workspaces()` was a default method that threw until ECore had it, as `channels()` did (abstract since W1, 2026-10-28); `ObjectQuery.inWorkspaces()` needs at least one workspace. A change to a workspace's layers or their objects needs the workspace's `editPermission` instead of `objects.edit` and `layers.edit`, which stay View's; the server answers `PERMISSION_DENIED` without it (CDA, T-080), and `PERMISSIONS` stays as it is. The codec contract test round trips `layer-in-workspace.json` and `change-request-create-layer-in-workspace.json` since ECore's codec maps a layer's `workspace` (2026-10-26), and treats a layer's `workspace` `core.view` as equal to an absent one, except in an update's `data` (R2; `layer-in-view.json`; the ACA's P5-1).

**The owner's exception D1 to the freeze (2026-10-27),** documentation and the fake only, no new or changed member (the ACA's U2 and U6, T-078): `CurrentWorkspace` lists the switch's steps, with **the map view's moment** (interactions ended, the fade lists and the selection cleared) before the fresh snapshots and before `onChange`, which the shell gives (CDA, T-080); `createFadeList` says to set a list again from the fresh snapshot or, when the subscription names its workspace, from `onChange`; the fake map view's `switchWorkspace()` clears the selection too. With it (owner, 2026-10-27): the Java `DeclaredField.problem` refuses a number no double holds (`1e999999999`), as the web SDK does.

### Part 6: POST endpoints (CR-0026, folded in)

Approved by the owner on 2026-10-26 with the ACA's R2 to R5 (`docs/change-requests/CR-0026-post-endpoints.md`), **folded into 1.2.0**: the freeze of 2026-10-26 is reopened for this addition only and set again after its build. No version step. A plugin's web part sends commands to its server part, each needing a permission the server checks (the simulator first).

| Addition | Where |
|---|---|
| Java: `Endpoint.post(path)`, `Endpoint.maxBody` (1 B to `MAX_BODY`, 1 MiB; default `DEFAULT_MAX_BODY`, 64 KiB), `Endpoint.MAX_BODY_DEPTH` (1 000); `Endpoint`'s 1.1.0 constructor kept | `http/Endpoint.java` |
| Java: `EndpointRequest.method` (`GET`, also for a `HEAD`, or `POST`) and `body` (the parsed `JsonValue`, numbers exact; `null` for `GET`); the 1.1.0 constructor kept | `http/EndpointRequest.java` |
| Java: `HttpReply.json(status, JsonValue)` with `JSON_CONTENT_TYPE` | `http/HttpReply.java` |
| Java: what ECore answers itself, in order: `404`, `405` with `Allow` (a `HEAD` to a `POST`-only path too, R4), `403`, then for `POST` `415` (not `application/json`, optionally with `charset=utf-8`), `413` (over `maxBody`) and `400` (not one strict UTF-8 JSON value: a byte order mark, UTF-16 or UTF-32, a duplicate name, nesting past `MAX_BODY_DEPTH`; never `500`, R2); `register` refuses a `POST` endpoint without `requires` | `http/Endpoints.java` |
| Java test kit: `ctx.post(target, body)` with `User` and `Headers` variants; `ctx.request(method, target, headers, Bytes, user)` for raw bodies and other methods; both answer as ECore does, in its order. Its JSON parser keeps open arrays and objects on its own stack, so that a body nested to `MAX_BODY_DEPTH` parses on any thread (2026-10-27, after a `StackOverflowError` seen by PCA-draw-symbols; no member changed) | `testkit/FakePluginContext.java`, `testkit/TestJson.java` |
| Javadoc (item 15, the owner's exception at the freeze): `Channels.offer` and `watch` throw `IllegalStateException` once the plugin has stopped | `channel/Channels.java` |

**The edge is the CDA's** (CR-0026 items 7 to 11): the `POST` mapping, the bounded body read, the method in the dispatch, a log line for each delivered `POST` with plugin, path, user and status (R3), and `OriginCheckFilter` unchanged. **The web SDK has no new API:** a web part calls `fetch` with `ctx.serverBase` (design pattern, web part). A plugin that registers a `POST` endpoint declares `sdkVersion` `^1.2.0`.

### Before the freeze: what waits for ECore, the shell and map-view-2d (the ACA's W1, W2)

These stayed as they were at the version step, because making them plain needs another role's work first, else ECore or the shell stops compiling. The whole-SDK review (2026-10-26) found that none of them needs to be real before the freeze, and all of them before M3 reaches `main`:
- **Java default methods that throw** until ECore implements them (CDA, T-079 to T-081): `PluginContext.connections()`, `channels()`, `classifications()`, `declaredFields()` and `workspaces()`. Each becomes abstract once ECore has it (W1). **Done 2026-10-28 (`pda/w1-tighten`):** all five are abstract, since ECore's `PluginContextImpl` gives all five itself, with no fallback to the throwing defaults (`cda/w1-context`, `ddd98d7`); the test kit's `FakePluginContext` already did, and no other class implements `PluginContext`. The Javadoc of `Channels.offer` and `watch` says they throw `IllegalStateException` once the plugin has stopped (item 15, at the freeze).
- **Optional web members** until the shell or `map-view-2d` provides them: `ctx.declaredFields`, `ctx.workspace` and `ctx.workspaces` (CDA, T-080, T-081), and `MapView.createFadeList` (PCA-map-view-2d, T-085). The PDA makes each required once it is provided. Tightening these nine members needs no change request (owner, 2026-10-26); the PDA records each one here. **Done 2026-10-28 (`pda/w1-web`):** `ctx.declaredFields` (the shell gives it since T-081), `ctx.workspace` and `ctx.workspaces` (since `cda/workspaces-shell`, `f60484a`) are required; the web test kit's `createFakeContext` already gave all three, and the examples no longer read them with `?? []`. **Done 2026-10-29 (`pda/w1-web`; owner, 2026-10-28: T1):** `MapView.createFadeList` is required (`map-view-2d` gives it since T-085); the web test kit's fake map view already gave it. All nine members are now tightened; the guards in other owners' code that must go in the same run are listed in [w1-guards.md](w1-guards.md). **The owner's exception U (a) to the freeze (2026-10-29):** one sentence in `createFadeList`'s documentation states a list's bound, at most 10 000 ids, of a longer one only the first 10 000 faded, with a warning (`map-view-2d` function 24); no constant, so no new member.
- **`ModelCodecContractTest.CODEC_PENDING`** (W2): **empty** since ECore's codec maps a change request's `fields` and a layer's `workspace` (2026-10-26). The invalid `fields` and `workspace` examples are still rejected, by `ChangeRequest`, `FieldValue`, `LayerContent` and the schema.

## SDK 1.3.0 (M4; CR-0028, with CR-0023)

Approved by the owner on 2026-10-30 with CR-0023 and the ACA's R1 (`docs/change-requests/CR-0028-sdk-and-data-model-1-3-0.md`; review `docs/architecture/reviews/cr-0028-sdk-1-3-0.md`): compatible additions to 1.2.0, built on `integration/sdk-v1.3` in three steps. **The version moved to 1.3.0 right after step 1** (owner, 2026-10-30, CS), so that the plugins waiting for the lock and the right click can declare `^1.3.0`: the PDA's files on `pda/sdk-1.3-version`, and, by the owner's exception of 2026-10-26 given again, the pins and the lock file by the MCA and ECore's version lines by the CDA. Plugins keep their `sdkVersion` until they use a 1.3.0 addition. Nothing reaches `main` before the owner freezes the whole release. If a later step changes a member from step 1, that step says so. The TSDoc and Javadoc marked "SDK 1.3.0" are normative; this section is the map, and grows with each step.

### Step 1: the layer lock and the right click (CR-0028 parts 2 and 4; ADR-0042)

| Addition | Where |
|---|---|
| Data model 1.3.0: a layer's `locked` (absent or `false`: not locked, `false` kept as absent; on update an absent `locked` keeps the stored value, rule 5's second exception) and the rejection code `LAYER_LOCKED`, with its details, its place among the store's answers (R1) and no lock check on a layer's create (N3) | `model/schemas/layer.schema.json`, `change-rejection.schema.json`, `model/README.md` ("Changes in 1.3.0") |
| Java: `LayerContent.locked` (`@Nullable Boolean`), `isLocked()`, `withLocked(Boolean)`; `inWorkspace` keeps the lock; the 1.1.0 and 1.2.0 constructors kept, with `locked` `null`. `ChangeRejection.Code.LAYER_LOCKED`, which a server part never gets | `model/LayerContent.java`, `model/ChangeRejection.java` |
| Java test kit: `FakeStore` keeps `false` as absent and an absent lock on update; only `applyAs(by, user, change)`, a user's change, is refused, in ECore's order. `TestJson.normalize` treats a layer's `locked` `false` as absent, except in an update's `data` | `testkit/FakeStore.java`, `testkit/TestJson.java` |
| Web: `LayerContent.locked?` and `'LAYER_LOCKED'` in `RejectionCode` | `model.ts` |
| Web test kit: the default answer policy refuses a change to a locked layer's content, as the store does, from the layers and objects in the snapshots and batches a test sends; before the declared fields | `testing/index.ts` |
| Web, TSDoc only (`map-view-2d` functions 27 and 28): the right click in `pickPoint`, `dragObject`, `draw` and `edit`; `pick` takes a filled shape only at its outline; `MapPaneOverlay.order` states how the shell stacks a corner's overlays | `services.ts`, `context.ts` |
| Web test kit: the fake map view's `rightClick()` ends `pickPoint` and `draw` with null and leaves `edit` and `dragObject` running | `testing/index.ts` |

**What waited for ECore and the shell (CDA, T-098): done.** ECore enforces the lock, and its codec maps `locked`:
- `ModelCodecContractTest.CODEC_PENDING` is empty again, since ECore's codec round-trips `layer-locked.json` (step 4; the ACA's final review, F1);
- the store builds its layers with every part, so a stored lock is kept; no call to the 1.2.0 constructor is left in `ObjectStore`.

`map-view-2d` gives the right click and the outline picking (T-102). The `FakeChannels` fix (refusing calls once the plugin has stopped) is in step 3.

### Step 2: WMS background maps and a plugin's own settings panel (CR-0028 part 1, which is CR-0023; ADR-0035)

CR-0023's items 1 to 4 as written, with "SDK 1.2.0" read as 1.3.0, and one change by the owner (2026-10-30, Q3): `Ui.setSettingsPanel` is optional until the shell has it, as W1 did for 1.2.0's members.

| Addition | Where |
|---|---|
| Web: `WmsSource` (`type: 'wms'`, the plugin's endpoint as `url`, `layers` bottom first, `version` 1.1.1 or 1.3.0, `format`, `transparent`, `mode` tiles or one image, `tileSize`), in `BackgroundMapProvider.source`; its projections are codes, never `'any'`. Its TSDoc is the contract between the map view and the plugin's server part: the GetMap parameters, each once and nothing else, read by name in any order; sizes 1 to 4 096; latitude first in EPSG:4326 with WMS 1.3.0; never a box beyond the projection's extent; only the listed projections; a failed image left empty | `services.ts` |
| Web: `Services.provide` returns an `Unsubscribe`, which removes the implementation; `getAll` and its `onChange` follow. Meant for `many` keys such as background maps. A plugin may provide a `many` key more than once, each call with its own `Unsubscribe` (the ACA's step-2 review, F1) | `services.ts` |
| Web: `Ui.setSettingsPanel(panel)`, shown instead of the generated form in the plugin's entry of the Settings list, with `SettingsPanel`, `SettingsPanelProps` (`values`, `save`, `markUnsaved`), `SettingsSaveResult` and `SettingsProblem`. **Optional until the shell had it** (CDA, T-073); **required since 2026-10-31** (the step below) | `context.ts` |
| Web test kit: `services.provide` and `provideAs` return the `Unsubscribe`; the fake records the panel (`settingsPanel`), gives `settingsPanelProps()`, records `settingsSaves` and `settingsPanelUnsaved`, and answers with the new option `saveSettings` (default `ok`, which replaces `ctx.settings` and calls the listeners; a user without `settings.admin` gets a rejection); the fake's `ui` has `setSettingsPanel` always (`Required<Ui>`) | `testing/index.ts` |
| Web test kit: `wmsGetMapUrl(source, { projection, bbox, width, height })`, the URL the map view sends for one image, with the parameters in a fixed order; tests compare the parameters, since the contract fixes no order (the ACA's step-2 review, F2); `bbox` in the projection's own order (longitude, latitude for EPSG:4326), swapped where WMS 1.3.0 wants latitude first | `testing/index.ts` |

The Java SDK does not change: endpoints already have query parameters, a permission and binary replies, and outbound HTTP exists.

**What waits for the shell and the map view.**
- **Merged in one run with this step** (owner, 2026-10-30, Q3), as W1's web round was: the shell's `provide` returns a working `Unsubscribe` from its registry (CDA), and `map-view-2d` reports a `wms` source as not supported (PCA-map-view-2d): this step's types do not compile without both.
- **Later:** the shell shows a plugin's settings panel (T-073), and the PDA then makes `setSettingsPanel` required; `map-view-2d` draws `wms` sources (T-072, its brief's function 3). `basemap-wms` is built after both (T-075).

### Step 3: the declared-fields list, a settings field enabled by another field, and the fixes (CR-0028 parts 3 and 5)

Parts 3 and 5 as written, with the ACA's findings on steps 1 and 2 and one test kit member by the owner (2026-10-30, Q4).

| Addition | Where |
|---|---|
| Web: `DeclaredFields` keeps its props and helpers. It shows the fields that name the data type, then a collapsible **"Other fields"** (a disclosure button with `aria-expanded`, `aria-controls` and the number of fields): every other field the editor may set and every other field with a value (read only when the editor may not set it), grouped by plugin, open when one of them has a value. No "+" and no remove button: an emptied field is `null`, a check box set and cleared is `false`, and `changedFields` sends only what changed. The look and the keys change for every plugin that shows it: `draw-symbols` and the simulator, merged in one run with T-106 | `components/fields.tsx`, `components.css` |
| Settings schema: `x-emc2` may carry `enabledWhen` (`property`, a sibling, also in an array's items; `in`, 1 to 32 strings, numbers or booleans), with or without `kind`. An annotation: validation does not change, and no SDK member reads it; the shell's form greys the field (CDA, T-098) | `model/README.md` ("Changes in 1.3.0"), `model/examples/valid/manifest-layer-picker.json` |
| Java test kit: `FakeChannels.release()`, what ECore's plugin host does when the plugin stops: its watches cancelled and its channels withdrawn; from then on `offer` and `watch` throw `IllegalStateException`, as `Channels` states. Called by the test after the plugin's `stop()` (owner, Q4: one test kit member instead of none) | `FakeChannels.java` |
| Model: the lock's place among `ENTITY_EXISTS` (before it) and `EXTERNAL_REF_EXISTS` (after it), as in ECore's create and the Java fake (the ACA's step-1 review, F1) | `model/README.md` |
| Web: `Services.provide` may be called more than once for a `many` key, each with its own `Unsubscribe` (the ACA's step-2 review, F1; the shell follows with T-073) | `services.ts` |
| Web: `WmsSource`'s parameters have no fixed order, and a server part reads them by name; `wmsGetMapUrl`'s users compare parameters, not strings (step-2 review, F2) | `services.ts`, `testing/index.ts` |
| Web: `WmsSource.mode`: where a projection's extent does not tile (its sides not in a whole-number ratio of at most 16:1), the map view draws a `'tiles'` source as one image per view, so a server part accepts any size from 1 to 4 096 in either mode (owner, 2026-10-31: DY; with DX the map view builds its URLs itself, as `wmsGetMapUrl` does) | `services.ts` |

**What waits.** The CDA's form greys the fields (T-098); `cot` marks its link fields (T-107). Then `Ui.setSettingsPanel` becomes required (the step below), the ACA reviews the whole, and the owner freezes it.

### Step 4: the shell must offer `setSettingsPanel` (owner, 2026-10-30, Q3)

The shell has had `Ui.setSettingsPanel` since T-073, so the member is required in the `Ui` type now (every shell offers it; a plugin calls it only if it has its own settings panel), as W1 made 1.2.0's members required: `ctx.ui.setSettingsPanel(…)` without `?.`. No other member changes. The test kit's fake `ui` is typed `Ui` again (it was `Required<Ui>` while the member was optional). Two calls with `?.` fail lint (`no-unnecessary-condition`) and change in the same run: `basemap-wms`' `web/src/index.tsx` and the shell's `loader.test.ts`.

Also in step 4 (the ACA's final review, F1): `ModelCodecContractTest.CODEC_PENDING` is empty again, so the SDK's codec contract test checks `layer-locked.json` for every codec (step 1's "What waited for ECore and the shell").

## SDK 1.4.0 (M5; CR-0030)

Approved by the owner on 2026-11-05 with the ACA's review (`docs/change-requests/CR-0030-sdk-and-data-model-1-4-0.md`; review `docs/architecture/reviews/cr-0030-sdk-1-4-0.md`), with the owner's answers Q1 to Q7: compatible additions to 1.3.0, built on `integration/sdk-v1.4` one part at a time, in the M5 plan's order. **The version moved to 1.4.0 right after part 1** (Q6), as it did for 1.3.0: the PDA's files on `pda/sdk-1.4-version`, and, by the owner's exception of 2026-10-26 given again, the pins and the lock file by the MCA and ECore's version lines by the CDA. CR-0031 (relations between objects, approved by the owner 2026-11-06) is built in part 3 and part 5. **Frozen by the owner on 2026-11-09 at `49c91962` (MG); changes only through a change request.** Plugins keep `^1.3.0` until they use an addition. The TSDoc and Javadoc marked "SDK 1.4.0" are normative; this section is the map, and grows with each part.

### Part 1: the picker's button, the object writer and output kinds (ADR-0037's note, T-133, T-147, ADR-0048)

| Addition | Where |
|---|---|
| The layer picker: the form's "+" button creates the layer at once and saves it with its id (T-133); `allowNew: false` hides it. The annotation does not change. A picked layer that is gone is still made again by name | `LayerChoice.java`, `model/README.md` ("Changes in 1.4.0") |
| Java: `ObjectWriter` (owner, Q1: in the SDK), for in plugins: a link's target layer (picked, made by name, shared, kept in the plugin document `object-writer.layers`), objects found again by external identity, one change request in flight per external id with the latest winning, lost answers looked up, rejections counted per target. Built only on the public store, document, timer and subscription API | `store/ObjectWriter.java`; tests `ObjectWriterTest` (test kit) |
| Java: `ChannelKind` (`GROUND_TRUTH`, `SENSOR_REPORTS`); `ChannelSpec.kinds` and `ChannelInfo.kinds` (ground truth by default; the 1.2.0 constructors kept); `ChannelItem.kind()`; `ChannelItem.SensorReport` (a sensor's platform, time, area and up to 65 535 detections, keyed by the sensor) and `ChannelItem.Detection` (the detected object's id and content at the measured position; owner, Q7). `send` of a kind the channel does not take throws | `channel/` |
| Java test kit: `FakeChannels.send` checks the kinds, as ECore does | `FakeChannels.java` |

### Part 2: tactical graphics (ADR-0043 point 9, T-144)

| Addition | Where |
|---|---|
| Data model: the graphics' amplifiers `distances` (AM) and `azimuths` (AN), arrays of numbers, and the text amplifiers `targetNumber` (AP), `uniqueDesignation1` (T1), `uniqueDesignation2` (T2) and `dtg1` (W1), as in mil-sym-ts's table for the APP-6 D and E graphics (not CR-0030's tentative H1, H2 and X1, which no graphic there uses). The control points of a `core.multipoint` and their order | `map-object.schema.json`, `model/README.md` ("Changes in 1.4.0"), five examples |
| Java: `TextModifier` gains `TARGET_NUMBER`, `UNIQUE_DESIGNATION_1`, `UNIQUE_DESIGNATION_2` and `DTG_1`; `Modifiers.distances()` and `azimuths()` (empty when absent), the 1.3.0 constructor kept, the builder's `distances(...)` and `azimuths(...)` | `model/Modifiers.java`, `model/TextModifier.java` |
| Web: `TextModifierName` and `Modifiers` gain the same; `ModifierName` names any amplifier | `model.ts` |
| Web: the catalogue, `SymbolService.graphicCatalog(standard)`, a promise of `GraphicCatalogEntry` (code, name, path, `GraphicKind` `line`, `area`, `arrow` or `points`, the geometry type it stores, point counts, what each point is, required and allowed amplifiers, whether it shows the SIDC's echelon) | `services.ts` |
| Web: the draw call, `SymbolService.renderGraphic({ standard, sidc, points, modifiers, resolution, extent })`, a promise that never rejects: `GraphicRendering`, lines, fills and labels with flat longitude, latitude arrays (`Float64Array`), or `{ ok: false, reason }` for the fallback marker. Points go in and come out as longitude, latitude. `resolution` (metres per pixel) replaces the CR's sketch's scale, and the projection is left out: the result is in longitude, latitude and the map view projects it | `services.ts` |
| Both members are **optional until the symbology plugin provides them**, then required at the freeze, as `setSettingsPanel` was in 1.3.0 | `services.ts` |
| Web: `MapView.draw(kind, { graphic })` previews a tactical graphic as itself while it is placed (owner, Q1, 2026-11-06), through `renderGraphic`, and a plain line while its points are too few; it cannot finish before the graphic's `minPoints` and finishes by itself at its `maxPoints`; `edit` of a `core.multipoint` previews the graphic by its control points. The fake map view records `graphic` in `drawCalls` | `services.ts`, `testing/index.ts` |
| Web test kit: `createFakeSymbolService()` gains `graphicCatalog` (`FAKE_GRAPHICS`: a boundary, a phase line, an axis of advance with a width point, a sector range fan), `renderGraphic` (a line through the points with the unique designation as a label; a refusal for a code outside the catalogue, a wrong point count or a missing required amplifier), `refuse(reason)` and `renderGraphicCalls` | `testing/index.ts`; tests `part2.test.ts` |
| Java test kit: the fake store's "only a move" check counts a change of `distances` or `azimuths` as a change, not a move | `FakeStore.java` |

### Part 3: field sets, vessel symbols and relations (ADR-0050, ADR-0047, ADR-0051; T-132, T-139, T-150)

| Addition | Where |
|---|---|
| Data model: **field sets.** The manifest's `fieldSets` (`{ id, label, fields }`, at most 32, the plugin's own fields; full id `<plugin-id>.<id>`); the object's `fieldSets` (full ids, each once, at most 64) with **rule 5's third exception** (owner, Q3: an absent list keeps the stored one, a listed set is added, nothing removes one) and **rule 18** (a set a request adds must be declared; stored sets are not checked). Tactical graphics carry none in M5 (owner, HS) | `map-object.schema.json`, `plugin-manifest.schema.json`, `model/README.md` ("Rules", "Changes in 1.4.0") |
| Data model: **relations** (CR-0031). `content.relations`, `{ kind, objectId }`, each once, at most 1 024 (owner, Q1), replaced as a whole on update; **rule 17** (on create every kind declared; on update, per entry, an entry the stored object carries passes, owner Q2); the manifest's `relationKinds` (id, label, `line` with `strokeColor`, `strokeWidth`, `strokeDash`, `arrowhead`, and `defaultOn`; at most 16). The other object is never checked, and nothing cascades | the same |
| Data model: **vessel symbols.** `symbol.standard` `vessel`, its `sidc` 4 digits: context, standard identity, AIS ship type (owner, CR-0030 Q2; `^[0-2][0-6][0-9]{2}$`, e.g. `0470`) | the same ("Conventions") |
| Examples: valid `object-with-field-sets.json`, `object-vessel.json`, `object-with-relations.json`, `manifest-field-sets.json`, `manifest-relation-kinds.json`; invalid `object-vessel-bad-code.json`, `object-relations-over-limit.json`, `object-relation-bad-object-id.json`, `manifest-relation-kind-without-line.json`; invalid by rule `rule-17-object-relation-unknown-kind.json`, `rule-18-object-unknown-field-set.json` and `rule-18-manifest-field-set-unknown-field.json` (CR-0030 listed the last as invalid, but the schema cannot check it) | `model/examples/` |
| Java: `MapObjectContent.fieldSets()` and `relations()` (empty when absent; the 1.3.0 constructor kept; `withFieldSets`, `withFieldSet`, `withRelations`); `Relation` with `replace(stored, kind, ids)`, which keeps other kinds' entries; `FieldSet` (`id()`, `refs()`) and `RelationKind` with its `Line`; `context.fieldSets()` and `relationKinds()`, **default methods that throw until ECore has them**, abstract at the freeze, as `declaredFields()` was in 1.2.0 | `model/`, `FieldSet.java`, `RelationKind.java`, `PluginContext.java`; tests `Part3TypesTest` |
| Java: `ChannelSpec.fieldSet` and `ChannelInfo.fieldSet` (ADR-0050 point 7; the older constructors kept); `fields` is deprecated in the Javadoc and still listed | `channel/` |
| Java: `ObjectWriter.fieldSet(setId)` adds the plugin's own set to every object it writes, so that a received object carries it from the start (ADR-0050 point 4) | `store/ObjectWriter.java`; test `ObjectWriterTest` |
| Java: `SymbolStandard.VESSEL`; `Symbol.vessel(context, identity, shipType, modifiers)` (and without the context, for reality), `isVessel()`, `vesselContext()`, `vesselIdentity()`, `vesselShipType()`, the `CONTEXT_*` and `IDENTITY_*` digits; the constructor checks a vessel's code | `model/Symbol.java` |
| Java test kit: `FakePluginContext.builder(id).fieldSets(...)` (checked against `declaredFields`, as ECore refuses such a plugin) and `.relationKinds(...)`; the fake store applies rule 5's third exception and rules 17 and 18, after rule 16 and before the declared fields, as ECore orders its checks | `FakePluginContext.java`, `FakeStore.java`; tests `FakeStorePart3Test` |
| Web: `MapObjectContent.fieldSets` and `relations`, `Relation`; `FieldSet`, `RelationKind`, `RelationLine`, `replaceRelations`, `vesselSidc` and `parseVesselSidc`; `SymbolStandard` gains `vessel` | `model.ts`, `sets.ts` |
| Web: `ctx.fieldSets` and `ctx.relationKinds`, **optional until the shell has them**, then required; `changeRequests.withFieldSets(request, setIds)` | `context.ts` |
| Web: `SymbolService.vesselGroups()`, the ship-type groups with their fixed colours and their AIS types, **optional until `symbology` has it**. `render` and `validate` take `vessel`; `catalog()` stays APP-6's, since `vesselGroups()` lists the ship types (the CR said `catalog` would take it) | `services.ts` |
| Web: **`DeclaredFields` is the field-set editor** (ADR-0050 point 5): the data type's fields, then one group per set the object carries, then a read-only group for a set the object lacks whose fields have values, then a drop-down of the declared sets with a "+" that is grey for a set the object has. New props `fieldSets`, `objectSets` and `onAddSet`; the others kept. "Other fields" goes | `components/fields.tsx`; tests `part4.test.tsx` |
| Web test kit: `createFakeContext({ fieldSets, relationKinds })`, whose default policy checks rules 17 and 18 (`setsAndRelationsRejection`), knowing stored objects from the snapshots and batches a test sends; `appliedEvent` adds listed sets to a stored object's; the fake symbol service validates and renders `vessel` and gives `FAKE_VESSEL_GROUPS` | `testing/index.ts`; tests `part3.test.ts` |

The user's switch per relation kind (`display.relations`) comes in part 5.

### Part 5: display settings (ADR-0046, ADR-0052; CR-0030 part 5, CR-0031 section 3; T-137, T-150)

Web SDK only: the Java SDK and the data model do not change. With the owner's Q13 (2026-11-07): **the map view passes the size and the labels to `render`**, and `symbology` reads no display settings itself, so palettes and legends are unaffected.

| Addition | Where |
|---|---|
| `DisplaySettings` (`symbolSize` 16 to 96, `speedVectorMinutes` 0 to 60, both whole; `labels` from `LABEL_IDS`, each once, in the user's order; `relations` with **one switch for every loaded kind and no other**), `DEFAULT_DISPLAY` (30, 0, `name`, `uniqueDesignation` and `direction`: the owner's JF (Q14), 2026-11-07, so symbols keep today's direction arrow; the CR said the first two), the limits | `display.ts` |
| `DisplayChoices` (each part optional; `relations` may hold kinds that are not loaded), `displayChoicesProblem`, `displaySettingsProblem(value, kinds)`, `resolveDisplay(user, admin, kinds)`: the user's, else the admin's, else the SDK's, and per kind `defaultOn`; kinds not loaded are left out here, never dropped from what is saved (the ACA's R5 on CR-0031) | `display.ts`; tests `display.test.ts` |
| `ctx.display`, a **`ReadonlyState<DisplaySettings>`** (new: `value` and `onChange`, which `SharedState` now extends), so plugins cannot write it (ADR-0046 point 5); optional until the shell has it, then required (CR-0030, question 5). A departure from the CR's `SharedState`, for that reason | `context.ts`, `services.ts` |
| `SymbolService.render`'s optional `labels`: with `withText`, of the amplifiers on `LABEL_IDS` only these are drawn; the others as before; `name` is the map view's; absent, every amplifier (owner, Q13) | `services.ts` |
| Web test kit: `createFakeContext({ display, relationKinds })` with `ctx.display` and `setDisplay(choices)` (the parts given replace the current ones, a switch at a time included; checked as the shell does), the fake symbol service's `renderRequests` | `testing/index.ts` |

The labels' order is the one the user sets in the shell's window. In M5 the drawing follows APP-6's places, not this order: the amplifiers keep their places, and the map view draws `name` under the symbol (the ACA's R2).

**For the other agents (part 5).**
- **ECore and the shell (CDA):**
  - the storage: each user's `DisplayChoices` as a document of the user's own in `core` (ADR-0027; the no-login mode's single user), checked with the same rules as `displayChoicesProblem`; a switch for a kind that is not loaded stays saved (the ACA's R5);
  - the admin's defaults in ECore's settings, the same shape (ADR-0046 point 3, ADR-0052 point 5);
  - `ctx.display` from `resolveDisplay(user, admin, ctx.relationKinds)`, the same in every workspace and browser, a change at once in all the user's browsers, the last write winning (ADR-0046 point 6);
  - the window (ADR-0052): one icon in the Map Pane's corner after Coordinates, the size, the minutes and the labels (in the order the user sets), a check box per declared kind with its label (no section without kinds), and "Use defaults".
- **ITA:** the rules live in the web SDK and again in ECore, so a flow saves bad values past the window (a size of 100, an unknown label) and sees ECore refuse them, with the stored settings unchanged (the ACA's R3).
- **`map-view-2d` (PCA-map-view-2d, T-138):** its function 35 (the size and labels into `render`, the name, the speed vector) and the switch of function 34.
- **`symbology` (PCA-symbology, T-138):** its function 14 (`render`'s `labels`).

### Part 6: terrain's needs (ADR-0049; CR-0030 part 6; T-142)

With the owner's Q18 (2026-11-07): the plan as proposed. Range and bearing need nothing new (`Geodesy.inverse`), nor do compute workers (`WorkerSpec.compute(true)`).

| Addition | Where |
|---|---|
| Manifest: `folders`, at most 8, each `{ id, setting, reason }`; `setting` a JSON Pointer to the settings string that holds the absolute path, which only an admin sets. Rule 19: each id once, and the setting is a `string` property of the settings schema; ECore refuses the plugin otherwise | `plugin-manifest.schema.json`, `model/README.md`; examples `manifest-folders.json`, `manifest-folder-relative-setting.json`, `rule-19-manifest-folder-unknown-setting.json` |
| Java: package `dev.emcc.sdk.folder`: `context.folders()` (`LocalFolders`: `folder(id)`, `ids()`), a default method that throws until ECore has it; `LocalFolder.list(relativeDir, timeout, target, mapper)` (one level, sorted by name) and `read(relativePath, offset, length, timeout, target, mapper)`, each answering one `FolderResult` as a message, as `OutboundHttp` does: `Listing` (`Entry`: name, directory, size, modified), `Read` (`data`, `fileSize`; fewer bytes at the end, none past it), `Failed` (`Reason`: `NOT_SET`, `MISSING`, `INVALID_PATH`, `OUTSIDE`, `NOT_FOUND`, `WRONG_KIND`, `TOO_LARGE`, `BUSY`, `TIMEOUT`, `IO`; a message that never names the absolute path). Limits: `MAX_READ_BYTES` 64 MiB, `MAX_ENTRIES` 10 000, `MAX_CONCURRENT_CALLS` 8 per plugin. `LocalFolder.isWellFormed(path)`: relative, `/` between names, no drive letter, backslash or NUL; `..` is checked by resolving | `folder/`; tests `Part6TypesTest` |
| Java test kit: `FakePluginContext.builder(id).folder(id, path)` (`null` for an empty setting) over real test directories, with ECore's checks (a listing leaves out a broken link or an entry it cannot read instead of failing with `IO`, as ECore does; owner, LG, 2026-11-08); `ctx.folders()` (`FakeFolders`) with `setPath` (the admin's change), `hold()` and `release()` (for `BUSY` and `TIMEOUT`), `calls()`, `inFlight()`. `PluginRules`: `LocalFolders` and `LocalFolder` are services, never inside messages; own file I/O stays forbidden | `FakeFolders.java`, `FakePluginContext.java`, `PluginRules.java`; tests `FakeFoldersTest` |
| Web: `OverlayItem` gains `area` (`rings`, the first the exterior and the others holes, closed, at least 4 positions, geodesic edges, a `Style`) and `label` (`text` of 1 to 256 characters at a `position`, `OverlayLabelStyle`: `color`, `size` 8 to 32 px, `haloColor`). The caps `OVERLAY_MAX_ITEMS` 20 000 and `OVERLAY_MAX_POSITIONS` 200 000 per overlay; `overlayProblem(items)` names what the map view would refuse. **On a problem the map view draws nothing of that overlay until the next `set`, and logs why** | `services.ts`; tests `part6.test.ts` |
| Web test kit: the fake map view's `overlayProblems`, one per `set` or `clear` | `testing/index.ts` |

**For the other agents (part 6).**
- **ECore (CDA):**
  - read the manifests' `folders` and check rule 19; `context.folders()`: the path from the setting, a change at once for later calls;
  - the I/O off the plugin's workers, never on them, with the limits, the timeout and the reasons above; resolve every path with its links against the folder's real path and refuse one outside it; never write; never name the absolute path in a result;
  - the Monitor: each folder with its id, its reason, its path and whether it is readable, as for `internet` (ADR-0049 point 4).
- **`map-view-2d` (PCA-map-view-2d):** draw `area` (holes, fill, `fillPattern`, geodesic edges, in every projection and across the antimeridian) and `label` (centred, with the halo); `overlayProblem` before drawing, then nothing and a log line. Its `overlayItem` switch has a `default`, so it compiles unchanged until then.
- **`terrain` (PCA-terrain, T-142):** its brief.

### Part 4: capabilities and the user's time (ADR-0044, ADR-0045, CR-0032; T-135, T-136)

| Addition | Where |
|---|---|
| Manifest: `capabilities`, ids from a closed list (`temporal` in 1.4.0); an unknown id fails the schema (ADR-0044 point 5). **Every declared capability is implemented by at least one part, and a part implements only declared ones** (owner, Q11, 2026-11-06), so no part carries a stub (ADR-0044 point 6) | `plugin-manifest.schema.json`, `model/README.md`, `manifest-capabilities.json`, `manifest-unknown-capability.json` |
| Java: `UserTime`, a record of two independent parts (CR-0032): the set time `time()`, `null` for now, and the `interval()`, `null` for none, an `Interval` with its start not after its end and `contains`; both nullable accessors, not `Optional` (the ACA's R1). `NOW`, `now()`, `at(time)`, `withInterval(from, to)`, `withoutInterval()`; `isNow()` is the whole value at its defaults, the set time alone is now when `time() == null` (R2). The set time may lie outside the interval; an end that follows the clock is not in 1.4.0 | `UserTime.java` |
| Java: package `dev.emcc.sdk.capability`: `Capability` (ids, interfaces, `implementedBy`), `Temporal` (`timeDelivery()` gives a `Delivery` of a worker and a mapper, asked once after `init`), `SessionTimeChange(session, user, time)`: at a session's start, at each change, and **`now` once when the session ends** (owner, Q10) | `capability/`; tests `Part4TypesTest` |
| Java: `EndpointRequest.userTime()`, the requesting session's time, `now` for a plugin that is not temporal (the older constructors give `now`) | `http/EndpointRequest.java` |
| Java: `ObjectWriter.objectId(key)`, the id the writer reserves at a key's first write, so it answers while the create waits or is in flight (owner, IP; the ACA's R5 on the GMTI briefs) | `store/ObjectWriter.java`; tests `ObjectWriterTest` |
| Java test kit: `FakePluginContext.setSessionTime(plugin, session, user, time)` (and the user's endpoint requests carry it), `CapabilityCheck.assertMatches(pluginClass, manifest)` and `problem(...)`, `TemporalTestPlugin` (records the changes, keeps the sessions not at now, answers `GET /time`) | `FakePluginContext.java`, `CapabilityCheck.java`, `TemporalTestPlugin.java`; tests `Part4TemporalTest` |
| Web: `UserTime` `{ time?, interval?: { from, to } }`, a part not set left out, never `null` (R3), `NOW` `{}`, `userTimeProblem` (refuses `null`, a `null` part and unknown members); `CAPABILITY_IDS`, `WebCapabilities` with `TemporalCapability.timeChanged`; `WebPlugin.capabilities`; `capabilitiesOf` and `capabilityMismatch(module, declared, hasServerPart)` for the shell. **No `ctx.time`** (the ACA's R4): a web part learns the time only through `timeChanged`. A web part calls its endpoints with `fetch` on `ctx.serverBase`: the shell's `fetch` adds the session's header (`X-Emc2-Session`; owner, 2026-11-06), so the endpoint gets the session's time; one made with `XMLHttpRequest` gets `now` | `time.ts`, `context.ts` |
| Web test kit: `createFakeContext({ time })`, `ctx.setTime`, `ctx.currentTime`; `activatePlugin(module, ctx)` starts a module as the shell does and drives `timeChanged`; `createTemporalTestPlugin()` | `testing/index.ts`; tests `time.test.ts` |

**For the other agents (part 4).**
- **ECore and the shell (CDA):**
  - read `capabilities` (owner, Q11); the Monitor lists each plugin's capabilities (ADR-0044 point 7);
  - **at load**, refuse a server part that implements an undeclared capability, or a declared one when the plugin has no web part to implement it, with a reason that **names the capability**, also for an unknown id that fails the schema (the ACA's R3);
  - **when the shell reports** that the web part lacks a declared capability the server part also lacks, or implements an undeclared one, record the fault in the Monitor, naming the capability; the shell does not use the web part's capabilities. The plugin is running by then, so it is not stopped (the ACA's R1 on part 4);
  - `Temporal`: ask `timeDelivery()` after `init`, deliver every session's time at its start, at each change, and `now` once when it ends, also for a session that was at `now` (Q10; the ACA's R2); `EndpointRequest.userTime()`;
  - the live picture protocol carries the session's `UserTime`, both parts in one message, checked by ECore (ADR-0045 point 4; CR-0032); one delivery per change of either part (R4);
  - the shell: the time control in the top bar when a loaded plugin declares `temporal` (ADR-0045 point 3), `capabilityMismatch` after `activate` and its report, `timeChanged` after `activate` and at each change.
- **`gmti` (PCA-gmti):** `ObjectWriter.objectId` for the pairing (its brief, section 3).

**For the other agents (part 3).**
- **ECore and the shell (CDA): done** (`cda/sdk-1.4-part3` `99432159`, 2026-11-06): ECore checks rule 17, then rule 18, after rule 16 and before the declared fields, as the fake store does; `CODEC_PENDING` is empty again. **At the freeze** `context.fieldSets()` and `relationKinds()` become abstract and `ctx.fieldSets` and `ctx.relationKinds` required, since ECore and the shell provide them. **A channel's `fieldSet` is passed on unchecked** (owner, 2026-11-06): neither ECore nor the fake checks that the set is declared. What it built:
  - read and check the manifests' `fieldSets` (each id once, every field among the plugin's own) and `relationKinds` (in the plugin's namespace, each id once), refusing a plugin otherwise; `context.fieldSets()` and `relationKinds()`; `ctx.fieldSets` (the shell derives each web `FieldSet`'s `plugin`, `name` and full `id`, `<plugin>.<name>`, from the manifest; the ACA's R6) and `ctx.relationKinds` (the line's defaults filled in);
  - `ModelJson`: an object's `fieldSets` and `relations`, so that `CODEC_PENDING` empties again (`object-with-field-sets.json`, `object-with-relations.json`). `vessel` needs nothing beyond the SDK's enum; `Symbol`'s constructor rejects a bad vessel code;
  - `ObjectStore`: rule 5's third exception, rules 17 and 18 after rule 16 and before the declared fields, `VALIDATION_FAILED` at `/data/relations/<i>/kind` and `/data/fieldSets/<i>`; never checked on loading stored data;
  - **every `new MapObjectContent(...)` with the 11 arguments** in ECore drops `fieldSets` and `relations`; use the 13-argument form or the copying methods where content is rebuilt (the store's merge, the "only a move" check).
- **`symbology` (PCA-symbology):** `validate.ts`'s `Record<SymbolStandard, RegExp>` stops compiling until it has `vessel`, in the same run. Then the vessel drawing and `vesselGroups()`, in its brief's edit.
- **`draw-symbols` and the simulator (PCA-draw-symbols, PCA-simulator):** `DeclaredFields` changes its look, in the same run, as for T-106: pass `fieldSets={ctx.fieldSets}`, the object's `objectSets` and `onAddSet`, send added sets with `changeRequests.withFieldSets`, and **forward `relations`** in what they send (spread the object's content, never rebuild it). Their tests that open "Other fields" change.

**For the other agents (part 2).**
- **`symbology` (PCA-symbology):** its `TEXT_MODIFIERS` is a `Record` over `TextModifierName` on purpose, so it stops compiling until it lists the four new names, in the same run. Then the two new members, in its brief's graphics edit.
- **ECore (CDA): done** (`cda/sdk-1.4-part2`, 2026-11-06). `ModelJson` maps a symbol's `distances` and `azimuths` (arrays), so `CODEC_PENDING` is empty again (`object-multipoint-range-fan-sector.json`); `ObjectStore`'s "only a move" check keeps the new content's distances and azimuths, as the fake does. The new text amplifiers need nothing (`TextModifier.fromJson`).

**For the other agents (part 1).**
- **ECore (CDA):** `ChannelRegistry.send` refuses an item of a kind the channel does not take, with `IllegalArgumentException`, as the fake does. The shell's form gets the picker's "+" button, hidden without `layers.edit` (the ACA's R6).
- **`cot` (PCA-cot):** its `OutputEngine` switches over `ChannelItem` exhaustively, so it needs a case for `SensorReport` in the same run (its channels take ground truth only until it maps sensor reports).
- **The template** points to `ObjectWriter` where a link receives; the playbook's work package 3 uses it.

### CR-0033: the sensor in a sensor report (owner, JO, 2026-11-07)

Built in 1.4.0 before its freeze, independent of the parts (the ACA's R4).

| Addition | Where |
|---|---|
| Java: `ChannelItem.SensorReport.sensor()`, a nullable sixth part: `ChannelItem.Sensor(name, revisit, rangeError, crossRangeError, minimumDetectableSpeed, detectionProbability, platformDirection, platformSpeed)`. The name has 1 to 64 characters and is not blank; every other part may be `null`, which a receiver sends as "no statement". The constructor checks the ranges: revisit positive, errors and speeds finite and not negative, probability 0 to 1, direction at least 0 and below 360. The platform's direction and speed are at the report's time (the ACA's R1). **The values are generic** (owner, JQ, 2026-11-07): physical, in SI units, with ranges for sensors in general, not narrowed to 4607; each output maps them, and sends "no statement" for a value its field cannot hold. `Sensor.named(name)` says only the name. **The five-part `SensorReport` constructor stays** and gives `sensor` `null`, so senders built before CR-0033 compile and send | `channel/ChannelItem.java`; tests `ChannelTypesTest` |

**CR-0034** (owner, KF, 2026-11-07, with the ACA's R1 to R3): `Sensor.mission`, a nullable second part: the mission the sensor's platform flies, 1 to 64 characters of any letters, a blank text kept as `null`; generic, like the rest (JQ). CR-0033's eight-part constructor stays, with no mission; `withMission(text)`. Tests `ChannelTypesTest`. The simulator fills it from its sensor's Mission setting; `gmti` sends it as `M1` and derives `P9` from it (its brief).

**For the other agents (CR-0033).**
- **The simulator (PCA-simulator):** fill `Sensor` in every sensor report from the sensor's settings and its platform track (its brief, function 29).
- **`gmti` (PCA-gmti):** map the values in its packets, and send a value its field cannot hold as "no statement" (its brief, section 3, "Out").
- **`cot`, `ais`, `adsb`:** nothing; they may ignore the new part. Nothing is stored and the web SDK does not change.

### CR-0035: how deep an area an output carries (owner, KL and KM, 2026-11-07)

Built in 1.4.0 before its freeze, under its own heading (the ACA's R5). The goal (KL): the simulator warns exactly when units in a sensor's coverage are not sent because an output's protocol cannot carry them.

| Addition | Where |
|---|---|
| Java: `ChannelSpec.maxAreaDepth`, a nullable eighth part, set with `maxAreaDepth(double metres)`: **how deep beyond the near edge of a sensor report's area the channel carries detections**, finite and positive; `null`, the default, is no limit. The near edge is the area's distance from the report's platform at its nearest point: an `ArcBand`'s inner radius, 0 for an area that holds the platform (a `Circle` round it). **Both ways** (the ACA's R1, as re-checked): the channel carries every detection no farther from the platform than the near edge plus the depth, keeps the near edge and cuts the far edge there, and leaves out (and counts) the detections beyond. It is not a sensor's maximum range (ADR-0048 point 7). **Only on a channel that takes `SENSOR_REPORTS`**: the record refuses it otherwise, so set the kinds first. `gmti` declares 511 980 m. The constructors of 1.2.0 and parts 1 and 3 stay, with no limit | `channel/ChannelSpec.java`; tests `ChannelTypesTest` |
| `ChannelInfo.maxAreaDepth()`, the same, with the same checks; `ChannelInfo.of(plugin, spec)` carries it, so ECore's `ChannelRegistry` and the test kit's `FakeChannels` change nothing | `channel/ChannelInfo.java`; tests `ChannelTypesTest`, `FakeChannelsTest` |

**For the other agents (CR-0035).**
- **`gmti` (PCA-gmti):** offer the `out` channels with `maxAreaDepth(511_980)`, send a `Circle` round the sensor with its centre halfway out, and cut an area at its near edge plus 511.98 km (its brief, section 3, "Out", and criterion 19).
- **The simulator (PCA-simulator):** compare each detected track with the area's inner radius plus the smallest depth of the sensor's chosen outputs, warn in the map pane, and write `simulator.beyond-reach` for those tracks (its brief, functions 28 to 30, criterion 48).
- **ECore (CDA), `cot`, `ais`, `adsb`, the web SDK:** nothing. Channel infos are never stored.

### The rename: `ChannelItem.SensorReport` (owner, 2026-11-07)

**`ChannelItem.Dwell` is renamed `ChannelItem.SensorReport`** before the 1.4.0 freeze: "dwell" is STANAG 4607's word, and the record is generic, one sensor's report at one time (platform, time, area, detections), as `ChannelKind.SENSOR_REPORTS` already calls it. Only the name changes: its parts, its checks, its constructors, `MAX_DETECTIONS`, CR-0033's `Sensor`, CR-0034's mission and CR-0035's `maxAreaDepth` (the near edge of the report's area) keep their meaning. No behaviour changes. The owner had the PDA change the uses in `cot`'s `OutputEngine` and the tests of `cot`, ECore and `map-view-2d`, and the references to the SDK record in `gmti` (Q22); `gmti`'s own 4607 codec keeps "dwell". **A plugin built against an earlier 1.4.0 build renames `ChannelItem.Dwell` to `ChannelItem.SensorReport`** (the simulator's sensor, on its branch).

### The freeze step (owner, Q23 and Q24, 2026-11-08)

Every member that waited for ECore, the shell or a plugin is now plain, as W1 did for 1.2.0 and step 4 for 1.3.0:

| Now | Was | Given by |
|---|---|---|
| Java `PluginContext.fieldSets()`, `relationKinds()`, `folders()` abstract | default methods that threw | ECore (parts 3 and 6, CDA) |
| Web `ctx.fieldSets`, `ctx.relationKinds`, `ctx.display` required | optional | the shell (parts 3 and 5, CDA) |
| Web `SymbolService.graphicCatalog`, `renderGraphic` required | optional | `symbology` (part 2) |

- **`SymbolService.vesselGroups` stays optional** (owner, Q24): `symbology` does not provide it yet (T-139). It becomes required in the first SDK version after `symbology` provides it; check it before calling until then.
- **The guards** (owner, Q23): the PDA removed every `?.`, `??` and `=== undefined` on these members that the strict lint refuses, on the freeze branch, so that one branch builds green: `map-view-2d` (`activate.tsx`, `core/controller.ts`, `core/graphics.ts` and three tests), `draw-tactical` (`controller.ts` and two tests), `simulator` (`index.tsx`), `symbology` (two tests) and the shell (`loader.test.ts`). No behaviour changes: each removed branch handled a member that every server and shell now gives.
- **The freeze itself:** after this step the owner kept 1.4.0 open (LR, 2026-11-08) while `symbology`'s and `cot`'s work could still need a contract change. `cot`'s T-129 needs none (its brief, functions 26 to 29), and **the owner froze SDK 1.4.0 and data model 1.4.0 on 2026-11-09 (MG) at `integration/sdk-v1.4` `49c91962`**. `vesselGroups` stays optional in 1.4.0 (Q24).
- **Left to their owners:** `map-view-2d` removes its "Symbol size in pixels" setting (its function 35; the admin's default is in ECore's display defaults). `draw-tactical`'s catalogue status `unavailable` can no longer happen, so it may go.

## SDK 1.5.0 (M6; CR-0038, then CR-0039)

The M6 plan (`docs/architecture/m6-plan.md`, approved by the owner 2026-11-10, NJ A) makes SDK and data model 1.5.0 one release in five parts, built on `integration/sdk-v1.5` one at a time, as 1.4.0 was. Part 1 is CR-0038 (approved by the owner 2026-11-09, NB A and NC A); parts 2 to 5 come with CR-0039 (approved by the owner 2026-11-10, OB A and OC A). **The version moved to 1.5.0 right after part 1** (owner, NP A, 2026-11-10), as for 1.3.0 and 1.4.0: the PDA's files with part 1, and, by the owner's exception of 2026-10-26 given again, the pins and the lock file by the MCA and ECore's version lines by the CDA. Plugins keep `^1.4.0` until their own code uses an addition. The TSDoc and Javadoc marked "SDK 1.5.0" are normative; this section is the map, and grows with each part.

### Part 1: a data type brings its field sets (CR-0038; T-165)

| Addition | Where |
|---|---|
| Manifest: `dataTypes[].fieldSets` (ids of the plugin's own sets, at most 8, each once; rule 20) and `dataTypes[].manual` (default `true`); a field's `dataTypes` deprecated | `plugin-manifest.schema.json`, `model/README.md` (rules 15, 20, 21; "Changes in 1.5.0") |
| Java: `DataType.fieldSets()` (full ids, empty for none and for `core.general`) and `manual()`, `MAX_FIELD_SETS`, `withFieldSets`, `withManual`; the 1.4.0 constructor kept (no sets, manual) | `DataType.java`; tests `DataTypeSetsTest` |
| Java test kit: `FakeStore` adds the data type's sets to a `core.symbol` on a create and on a data type change (rule 21; symbols only, NO A), from the types given to `Builder.dataTypes` | `FakeStore.java`; tests `FakeStoreDataTypeSetsTest` |
| Web: `DataType.fieldSets` and `manual` (optional until the shell gives them; required at the freeze step, as `fieldSets` was for 1.4.0); `withDataTypeSets(objectSets, dataType)` for an editor to show a type's sets before it sends; `choosableDataTypes(dataTypes, current)` for the data type selects; `MAX_DATA_TYPE_FIELD_SETS` | `context.ts`, `sets.ts` |
| Web: `expiresAt` counts only from `time.observed` (point 9) | `context.ts` |
| Web: `DeclaredFields` shows **one set at a time**: a drop-down "Field set" of the object's sets (carried, then "(not added)" ones with values, read only), opening on the data type's first set (new prop `dataTypes`, usually `ctx.dataTypes`) and again when the data type changes; a "+" ("Add a field set") with a menu of the declared sets the object lacks, which chooses the one added; no drop-down without a set; no "+" when nothing is left, read only, or without `onAddSet`. The group for a field's `dataTypes` is gone, and `fieldBelongsTo` and `DeclaredField.dataTypes` are deprecated (point 8) | `components/fields.tsx`, `fields.ts`; tests `part4.test.tsx`, `sdk15part1.test.ts` |
| Web test kit: the fake store adds the data type's sets to symbols as ECore does (`appliedEvent` takes the data types) | `testing/index.ts` |

- **For the CDA (ECore and the shell):** the manifest check of rule 20 and `fieldSets` and `manual` read into `DataType` (`PluginManifest`; the 7-argument constructor); the store adds the sets (rule 21: to a `core.symbol` on a create and on a data type change, after rule 18's check, before the declared fields; none to shapes and graphics, NO A); `Removal` counts only from `time.observed` (rule 15); the shell's `ctx.dataTypes` carries `fieldSets` (full ids) and `manual`.
- **For the editors (PCA-draw-symbols, PCA-simulator):** pass `dataTypes={ctx.dataTypes}` and `objectSets={withDataTypeSets(sets, type)}`; build the data type select with `choosableDataTypes`; stop using `fieldBelongsTo` (draw-symbols' value pruning after a data type change). draw-shapes and draw-tactical only use `choosableDataTypes` (NC A: no field sets on shapes and graphics in M6).
- **Breaks until their lines are in, in the same joint run:** `draw-symbols`' web tests (42, in `fields.test.tsx` and others, which expect the data type's group and every set shown together) and the simulator's (3, `events.test.tsx` and `fields.test.tsx`). `draw-shapes` and `draw-tactical` pass unchanged. ECore and every Java plugin compile unchanged (the 5-argument `DataType` stays).
- **Answered by the owner** (2026-11-10, through the MCA): **Q31 A (NO A):** rule 21 adds sets to `core.symbol` objects only in 1.5.0, in ECore's store and both fakes. **Q32 A (NP A):** the version step right after part 1, with the 2026-10-26 exception for the MCA's pins and lock and the CDA's ECore lines. The questions as asked:
  - **Q31, a data type's sets on shapes and graphics.** CR-0038 point 3 has the store add a data type's sets on every create and data type change; point 7 (NC A) says drawn shapes and tactical graphics carry no sets in M6. A shape drawn as AIS vessel would then carry `ais.ship`, which no shape editor shows. **A:** rule 21 adds sets only to `core.symbol` objects in 1.5.0 (one condition in ECore's store and the two fakes); a later version may widen it. **B:** every object, as written today; shapes and graphics carry the sets unseen, and keep them. Part 1 is built as B (the CR's text) until the owner answers; A changes rule 21, both fakes and their tests.
  - **Q32, the version step to 1.5.0.** **A:** right after part 1, as for 1.3.0 and 1.4.0 (Q6 then): the PDA's files on their own branch, with the owner's exception of 2026-10-26 again for the MCA's pins and lock and the CDA's ECore lines, so that the plugins building part 1 can name `^1.5.0`. **B:** at the freeze, the plugins keeping `^1.4.0` until then.

### Part 2: graphic images (CR-0039 part 2; owner, HW)

CR-0039 (`docs/change-requests/CR-0039-sdk-and-data-model-1-5-0-parts-2-to-5.md`) is approved as written by the owner (2026-11-10, OB A), with the answers to its questions and assumptions (Q33 A, Q34 A, A1 changed to the shorter step, A2 and A3 as proposed; OC A). Part 2 is the web SDK only; no model or Java change.

| Addition | Where |
|---|---|
| Web: `GraphicImage` (`position` as longitude, latitude of the image's centre; `svg`, an SVG data URI as mil-sym-ts gives it; `width` and `height` in screen pixels; `angle`, degrees clockwise) and `GraphicRendering`'s `images?` on a drawn graphic. **Optional, also after the freeze** (A2): absent or empty means none | `services.ts` |
| Web test kit: the fake symbol service's `withImages(images)` (every drawn graphic carries them; `null` stops it, the default, so its 1.4.0 results do not change); `fakeGraphicImage(position, angle?)` and `FAKE_GRAPHIC_IMAGE_SVG`, a 16 px ring | `testing/index.ts`; tests `sdk15part2.test.ts` |

- **For PCA-symbology:** the worker keeps mil-sym-ts's image points (`properties.image`, `rotation`, the point's position) as `GraphicImage`s instead of leaving them out, with the size read from the SVG. The 21 graphics are its README's list ("Known limits").
- **For PCA-map-view-2d:** draw each image with its graphic, after the fills and lines and under the labels, centred on its position and turned by its angle, again after each zoom; decode the SVG on the main thread as an image only (never as markup), and cache it by its text. A graphic without `images` draws as before.
- **For PCA-draw-tactical:** nothing to build. Its preview while placing is the map view's, so the icons show there too; it checks that once in the browser.
- **Nothing breaks:** the member is optional and the fake gives no images unless asked, so every plugin and the shell compile and pass unchanged.

### Part 3: display and sensors (CR-0039 points 5 to 7, CR-0040; T-164, T-151, T-168, T-169)

CR-0040 (`docs/change-requests/CR-0040-a-revisits-dwells-in-sensor-reports.md`) is approved by the owner (2026-11-10, OT A), with the answers of the PDA's session confirmed (Q35 to Q40, A4 to A9; OS A).

| Addition | Where |
|---|---|
| Web: `SPEED_VECTOR_STEPS_SECONDS` (5, 10, 15, 30, 60, 120, 300, 600, 1 200, 1 800), `SpeedVectorSeconds`, `nearestSpeedVectorStep(seconds)` (0 stays 0; the nearest step, above 30 min 30 min, a tie the shorter: owner Q5, A1); `DisplaySettings.speedVectorSeconds` (optional until the freeze) and `DisplayChoices.speedVectorSeconds`; `resolveDisplay` takes the user's seconds, else their stored minutes' nearest step, else the admin's, and fills the deprecated `speedVectorMinutes` as seconds / 60 (now possibly a fraction); `displaySettingsProblem` checks that; `SPEED_VECTOR_MAX_MINUTES` and both `speedVectorMinutes` deprecated | `display.ts`; tests `sdk15part3.test.ts`, `display.test.ts` |
| Web test kit: `ctx.setDisplay` resolves steps the same way; a newer choice in one unit replaces the other | `testing/index.ts` |
| Manifest: `dataTypes[].sensorReport` (default `false`; no model rule) | `plugin-manifest.schema.json`, `model/README.md` ("Changes in 1.5.0"); examples `manifest-data-type-not-manual.json` (valid, with it), `manifest-data-type-sensor-report-not-boolean.json` (invalid) |
| Java: `DataType.sensorReport()`, `withSensorReport`; the 5- and 7-argument constructors kept | `DataType.java`; tests `DataTypeSensorReportTest` |
| Web: `DataType.sensorReport?`; `SymbolService.sensorReportSymbol?(): SymbolImage`, optional until `symbology` provides it (A3: a method of its own); the fake symbol service gives `FAKE_SENSOR_REPORT_SYMBOL` | `context.ts`, `services.ts`, `testing/index.ts` |
| Java: `SensorType` (`GENERIC`, `GROUND_RADAR`; CR-0040 point 3); `ChannelItem.Sensor.type()` and `jobArea()` (a `Polygon` without holes), `withType`, `withJobArea`, the 1.4.0 constructors kept | `SensorType.java`, `ChannelItem.java`; tests `SensorTypesAndDwellsTest` |
| Java: `ChannelSpec.sensorTypes` and `sensorTypes(Set)` (only with `SENSOR_REPORTS`; empty takes every type), `ChannelInfo.sensorTypes`, both with `takesSensorType(type)` (`null` counts as `GENERIC`); the 1.4.0 constructors kept | `ChannelSpec.java`, `ChannelInfo.java` |
| Java: `SensorReport.Sequence(revisit, dwell, lastOfRevisit)` (`MAX_DWELLS_PER_REVISIT` 65 535), `withSequence`; **`coalesceKey()` is the sensor and dwell number with a sequence**, the sensor without; the 1.4.0 constructors kept | `ChannelItem.java` |
| Java test kit: `FakeChannels` keeps the latest item per `coalesceKey()`, no longer per `id()` (the same for every item but a sensor report with a sequence) | `FakeChannels.java`; tests `FakeChannelsTest` |

- **For the CDA (ECore and the shell):**
  - **ECore's channel inbox keys by `item.id()`** (`ChannelRegistry`, line 302): it must key by `item.coalesceKey()`, as the test kit now does, or a ground radar's dwells replace each other (CR-0040 point 2). CR-0040 said ECore needs nothing; that was wrong, found while building this part.
  - The manifest's `sensorReport` read into `DataType` (`PluginManifest`; the 8-argument constructor) and sent to the browser's `ctx.dataTypes`.
  - The display settings: ECore's check (`DisplaySettings`) accepts `speedVectorSeconds` (0 or a step) beside the stored minutes; the shell's window offers the steps (T-164) and saves seconds. `resolveDisplay` already reads stored minutes as steps.
- **For the PCAs:** `map-view-2d` draws the speed vector from `speedVectorSeconds` and the sensor report symbol for a `sensorReport` type (T-164, T-151); `symbology` provides `sensorReportSymbol` with its settings (T-151); `gmti` declares `sensorReport` for `gmti.detection`, its out channels' `sensorTypes`, and maps `jobArea` and the sequence (T-168, T-169); the simulator sends both sensor types with their sequences and job areas (its functions 36 to 39). Their briefs for T-151 and T-164 follow; T-168 and T-169's are approved (OU A).
- **Breaks until their lines are in, from a run here:** the shell's `src/display/state.test.ts` ("resolves what the server keeps…"), which compares `ctx.display` with an object without `speedVectorSeconds`. The shell's `tsc`, `map-view-2d`'s `tsc` and its display and controller tests, and ECore, `gmti`, the simulator, `cot` and the template's test compile pass unchanged.

### Part 4: settings forms and the classification order (CR-0039 points 8 and 9; T-160, T-171)

The owner's Q45 (2026-11-10, in the PDA's session): A, `gmti`'s link fields are hidden **by mode**, within CR-0039's `visibleWhen` of one sibling. The peer (`host`, `port`) shows for `tcp-client` and `udp`, the listen address for `tcp-server` and `udp`; a `udp` link shows both, and the schema's own `if`/`then` requires the listen port for a `udp` `in` link.

| Addition | Where |
|---|---|
| Settings schema: `x-emc2` may carry `visibleWhen`, of `enabledWhen`'s shape (`property`, a sibling, also in an array's items; `in`, 1 to 32 strings, numbers or booleans), alone or with `enabledWhen` and `kind`. An annotation: validation does not change | `model/README.md` ("Changes in 1.5.0"); example `manifest-settings-visible-when.json` (valid; `examples.test.mjs` checks the shape, the siblings, that a hidden field's value is still validated, and the example's `if`/`then`) |
| Web: `PluginContext.classifications?` (`ClassificationOrders`, each policy's classifications lowest first; optional until the freeze), `classificationOrder(orders, policy)` (the name ignoring case, as the Java `Classifications.order`; empty without one), `NATO_CLASSIFICATIONS` | `context.ts`; tests `sdk15part4.test.ts` |
| Web test kit: `createFakeContext` gives `{ NATO: NATO_CLASSIFICATIONS }`; `classifications` sets another, `null` leaves it out (a shell before part 4) | `testing/index.ts` |

Nothing changes in the Java SDK: `context.classifications()` has been there since 1.2.0.

- **For the CDA (the shell):**
  - **The settings form's `visibleWhen`** (`ui/settings/`, beside `enabledWhen`): the field is hidden unless the sibling's value is in `in`; an absent sibling counts as its `default`, and with neither the field shows; a `visibleWhen` the form cannot use shows the field. **A hidden field keeps its value** and is still validated and saved. A field with both is hidden first, then greyed. **An error the server reports at a hidden field** (e.g. an `if`/`then`'s `required`) is shown at the field that hides it, or at the item, so it is never lost (CR-0039 point 8: the CDA checks that the form shows the `if`/`then` error at the field).
  - **`ctx.classifications`** from `GET /api/config`'s `classificationOrders`, the same as Settings › Layers already reads; and the "+" new-layer dialog's classification select (T-171, with T-133), from the same order, `ctx.defaultLabel`'s chosen.
- **For the PCAs:** `gmti` hides its link fields by mode and direction with `visibleWhen` and requires the listen port with `if`/`then` (T-160; its brief, section 5); `layer-panel`'s new-layer dialog offers `classificationOrder(ctx.classifications, ctx.defaultLabel's policy)` (T-171; its brief). Both briefs come with this part.
- **Breaks:** none expected; both additions are optional or annotations. From a run here: the web SDK's tests and `tsc`, the model's tests.

### Part 5: moved objects (CR-0039 points 10 and 11; T-155, ADR-0053 point 8)

| Change | Where |
|---|---|
| Java: `ObjectWriter` **promises** what it did: an update's `Build` gets the stored object's own `layerId`, so a track a user moved stays in its layer; the target's layer is only where new objects appear. **After a lost plugin document** it adopts only a View layer with the target's new-layer name (one holding an object of the target first, else the top one), never a layer just because an object of the link is in it | `ObjectWriter.java` (its Javadoc and `adoptLayer`); tests `ObjectWriterTest` (`cr0039…`, three) |

No new member, so no new `sdkVersion` is needed for it.

- **For the CDA:** nothing; the shared "Move to layer…" and "Copy to layer…" are T-155's (ADR-0053).
- **For the PCAs:** `ais`, `adsb` and `gmti` pass the `Build`'s `layerId` on unchanged for an update (their briefs, T-155); `cot` and the simulator write their own objects and keep the stored layer on an update (their briefs). A copy has no `externalRef`, so no writer updates it.
- **Breaks:** none; a plugin that moved an object back into the link's layer on purpose still can.

### The freeze (owner, Q49 to Q51, 2026-11-11)

**SDK 1.5.0 and data model 1.5.0 are frozen** (Q51 A) with this step, from `integration/sdk-v1.5` `7eae6708` (parts 1 to 5, full run f23: 279 passed, 1 skipped). Changes need a change request again. Every member that waited for the shell or `symbology` is now plain (Q49 A), as at the 1.4.0 freeze:

| Now | Was | Given by |
|---|---|---|
| Web `DisplaySettings.speedVectorSeconds` required; `displaySettingsProblem` reports a display without it | optional (part 3) | the shell's `resolveDisplay` (CDA, T-164) |
| Web `ctx.classifications` required | optional (part 4) | the shell, the NATO order when the configuration has none (CDA) |
| Web `SymbolService.vesselGroups` required | optional since 1.4.0 (owner, Q24) | `symbology` since M5 (T-139) |
| Web `SymbolService.sensorReportSymbol` required | optional (part 3) | `symbology` (T-151) |
| Web test kit: `createFakeContext`'s `classifications` takes no `null` | `null` left it out | – |

Optional by design, also after the freeze: `GraphicRendering.images`, `DataType.sensorReport`, `fieldSets` and `manual`, `ChannelItem`'s `Sensor.type`, `jobArea` and `SensorReport.sequence`. Nothing changes in the Java SDK or the model's schemas.

- **The guards** (owner, Q50 A, as Q23 for 1.4.0): the PDA removed, on this branch, the guards on these members that the strict lint refuses, so that one branch builds green:
  - the shell (CDA): `plugins/context.ts` always gives `classifications` (the NATO order without a configuration), `loader.test.ts` expects it, `display/names.ts` reads the seconds plainly;
  - `map-view-2d`: `core/vectors.ts` and `engine/olEngine.ts` (`sensorReportSymbol()`; the try and the null before the service is there stay);
  - `layer-panel`: `controller.ts`; its tests' "no orders" case is `{ classifications: {} }`;
  - `draw-symbols`: `PropertiesPanel.tsx` and `SymbolsPanel.tsx`; its harness's `vessels: false` is a service with no groups;
  - `symbology`: its tests' optional calls.
- **Left to their owners:** nothing needed. A plugin whose code still reads `speedVectorMinutes` keeps working (it is deprecated, not gone). `map-view-2d`'s brief function 38's fallback to the minutes and function 39's APP-6 symbol "without `sensorReportSymbol`" are gone with this step (their briefs).
- **From a run here:** the web SDK (333 tests, `tsc`), the shell (497), `map-view-2d` (735), `layer-panel` (135), `draw-symbols` (360) and `symbology` (494), each with its lint and `tsc`; `tsc` and the lint of every other web part. No Java change.

## SDK 1.6.0 (M7; CR-0041)

CR-0041 (approved by the owner 2026-11-11, RJ A; part E dropped, Q59 B) makes SDK and data model 1.6.0 in seven parts, each on its own branch and merged into `integration/sdk-v1.6` by the MCA, part A first (the M7 plan's lane B). **Given version 1.6.0 by the owner on 2026-11-12 (RQ A)**, after parts A and F; **frozen on 2026-11-12** ("The freeze" below). Plugins that use a 1.6.0 addition name `^1.6.0`.

### Part A: NVG (CR-0041 items 1 to 5; ADR-0055 point 5; T-173)

| Addition | Where |
|---|---|
| Java: `HttpCall.post(uri, mediaType, body)` (a body of at most `MAX_REQUEST_BODY_BYTES`, 1 MiB), `credential(name)` (ECore adds `Authorization: Bearer` from local configuration; an unknown name fails with `no credential <name>`), `maxResponseBytes` (up to `MAX_RESPONSE_BYTES`, 16 MiB; default `OutboundHttp.MAX_BODY_BYTES`); `header` refuses `Authorization`, `Content-Type`, `Content-Length`, `Host` and `Transfer-Encoding`; the SDK v1 constructor kept | `HttpCall.java`, `OutboundHttp.java`; tests `Sdk16PartATest` |
| Java: `Endpoint.accepts(mediaTypes...)` (a raw body as bytes, `maxBody` up to `MAX_RAW_BODY`, 16 MiB), `Endpoint.service(method, path)` (at `/api/services/{pluginId}`, no session, no permission in 1.6.0), `checksUserItself()` (a `POST` whose handler checks the user, so it names no permission: ADR-0055 point 3's import); the 1.1.0 and 1.2.0 constructors kept | `Endpoint.java`; tests `Sdk16PartATest` |
| Java: `EndpointRequest.rawBody()` and `caller()`; `Caller` (`USER` or `SERVICE`, the address; `SERVICE_USER` without permissions); the 1.2.0 and 1.4.0 constructors kept | `EndpointRequest.java`, `Caller.java` |
| Data model: `core.text` with `text` (`value` 1 to 1 024 characters, `rotation` 0 to < 360 clockwise from north, `size` 8 to 48 px), a `Point`, no `symbol`; `text` only on `core.text` | `map-object.schema.json`, `model/README.md` ("Changes in 1.6.0"); examples `object-text.json` (valid) and four invalid ones |
| Java: `Text`, `MapObjectContent.text()` and `TEXT`; the 1.4.0 constructor kept (no text) | `Text.java`, `MapObjectContent.java`; tests `TextObjectTest` |
| Web: `MapObjectContent.text?: TextContent`, `CORE_TEXT`, `TEXT_MAX_LENGTH`, `TEXT_SIZE_MIN`, `TEXT_SIZE_MAX`, `TEXT_SIZE_DEFAULT` | `model.ts`; tests `sdk16partA.test.ts`, `model.test.ts` |
| Java test kit: raw bodies and their `415` and `413` before the worker; `serviceRequest(method, target, headers, body, address)`, which reaches only service endpoints (a browser `request` never does); `Builder.httpCredentials(names...)`; each call's own response limit | `FakePluginContext.java`; tests `FakeSdk16PartATest` |

- **For the CDA** (ECore and the edge):
  - the edge's outbound `POST`, the named credential's token from local configuration, and the response limit per call;
  - the raw-body check (media type, `charset` only, size) before the worker;
  - the service endpoints under `/api/services/{pluginId}/`, without a session or CSRF check, each call logged with the caller's address (ADR-0055 point 5.3);
  - `checksUserItself` in the `POST` registration check;
  - **`ModelJson` must map `core.text`'s `text`:** ECore's `ModelJsonContractTest` refuses the new valid example `object-text.json` until it does.
- **For PCA-map-view-2d:** drawing `core.text` (its function 45).
- **For PCA-nvg:** the plugin, on these members.

### Part F: the shell (CR-0041 items 13 to 15; T-152, T-174, T-181, T-185)

| Addition | Where |
|---|---|
| Web: `TopBarItem.workspaces` (absent means every workspace, unlike a panel, so the bookmarks and setups stay); `topBarItemAppearsIn(item, workspaceId)` | `workspace.ts`; tests `sdk16partF.test.ts` |
| Manifest: `category`, one of `data-links`, `geometoc`, `map-and-symbols`, `drawing`, `simulation`, `general` (absent means general) | `plugin-manifest.schema.json`, `model/README.md` ("Changes in 1.6.0"); examples `manifest-category-and-colour.json` (valid), `manifest-unknown-category.json` (invalid) |
| Web: `PLUGIN_CATEGORIES` (ids and labels in the Settings workspace's order), `PluginCategory`, `DEFAULT_PLUGIN_CATEGORY`, `pluginCategory(value)`, `categoryLabel(value)` | `categories.ts`; tests `sdk16partF.test.ts` (the list equals the schema's) |
| Settings schema: `x-emc2` may carry `kind: "colour"` on a string with the pattern `^#[0-9A-Fa-f]{6}$` (`COLOUR_PATTERN`), alone or with `visibleWhen` and `enabledWhen`. An annotation: validation does not change; `isColour(value)` | `model/README.md`, `categories.ts`; `examples.test.mjs` checks the example's shape and that validation does not change |

- **For the CDA** (the shell):
  - the top bar shows an item only in its workspaces (`topBarItemAppearsIn`);
  - the Settings workspace groups the plugins' entries by `category` in `PLUGIN_CATEGORIES`' order, alphabetically within each, the shell's own entries under General;
  - the settings form shows a `kind: "colour"` string as a colour picker with its hex value, and a text field where it cannot;
  - and ECore's manifest check takes `category`.
- **For the PDA (lane J;** the owner's exception for T-174, CR-0041 part F): one branch that adds `"category"` to every `plugins/*/plugin.json`, as the briefs' index lists them, and nothing else.
- **For PCA-simulator** (T-152): the Scenario item with `workspaces: ['simulator.simulation']`; **for PCA-gmti and PCA-simulator** (T-181, T-185): their colour settings marked `kind: "colour"`.

### Part B: Append (CR-0041 item 6; T-176)

| Addition | Where |
|---|---|
| Web: `MapView.append(id, { style?, signal? })`, continuing a held `LineString` from its last point; resolves with the whole line, or null; rejects with `NotOnMapError` or the new `NotALineError`. Optional until `map-view-2d` provided it, **required since the freeze** ("The freeze" below) | `services.ts`; tests `sdk16partB.test.ts` |
| Web test kit: the fake map view's `append` (resolved by `completeDrawing` with a `LineString`, `runningInteraction` `append`, a right click leaves it running), `setNotLines(ids)` and `appendCalls` | `testing/index.ts` |

- **For PCA-map-view-2d:** `append` (its function 44). **For PCA-draw-shapes:** the Append button (its function 19). **For PCA-simulator:** Append in the route editor (its function 49).

### Part C: relation line colours from settings (CR-0041 items 7 and 8; T-181)

| Addition | Where |
|---|---|
| Manifest: a relation kind's `line.strokeColorSetting`, a JSON Pointer into the plugin's settings to a `#RRGGBB` string; `strokeColor` stays required as the fallback | `plugin-manifest.schema.json`; examples `manifest-relation-colour-setting.json` (valid), `manifest-relation-colour-setting-not-pointer.json` (invalid) |
| Web: `RelationLine.strokeColorSetting`; `settingAt(value, pointer)` (RFC 6901); `resolveRelationLines(kinds, settingsOf)`; `ctx.relationLines` (a `ReadonlyState`, optional until the shell gave it, **required since the freeze**) | `sets.ts`, `context.ts`; tests `sdk16partC.test.ts` |
| Web test kit: `createFakeContext({ pluginSettings })`, `ctx.relationLines` always, `setPluginSettings(pluginId, settings)` | `testing/index.ts` |
| Java: `RelationKind.Line.strokeColorSetting()` and `withStrokeColorSetting`; the 1.4.0 constructor kept | `RelationKind.java`; tests `RelationLineColourTest` |

- **For the CDA:** ECore's manifest reader keeps `strokeColorSetting` (`PluginManifest`), and the shell keeps it in `ctx.relationKinds` (`plugins/shared.ts` drops it today) and gives `ctx.relationLines`, resolved with `resolveRelationLines` and again after each settings change.
- **For PCA-map-view-2d:** the lines from `ctx.relationLines` (its function 43). **For PCA-gmti:** `"strokeColorSetting": "/pairingColour"` and the setting (its brief, section 5).

### Part D: display classes (CR-0041 items 9 to 11; T-182, owner QN B, Q58 A)

| Addition | Where |
|---|---|
| Data model: a map object's optional `displayClass`, `dwell-area` or `sensor-coverage` | `map-object.schema.json`, `model/README.md`; examples `object-with-display-class.json` (valid), `object-unknown-display-class.json` (invalid) |
| Java: `MapObjectContent.displayClass()` and `withDisplayClass`, `DisplayClass` (`DWELL_AREA`, `SENSOR_COVERAGE`, `ALL`); the 1.4.0 and part A constructors kept | `MapObjectContent.java`, `DisplayClass.java`; tests `DisplayClassTest` |
| Web: `MapObjectContent.displayClass`, `DISPLAY_CLASS_IDS`, `DisplayClass`; `OverlayItem.displayClass` (`OverlayClass`), refused by `overlayProblem` when unknown | `model.ts`, `services.ts` |
| Web: `DisplaySettings.classes` (optional until the shell gave it, **required since the freeze**), `DisplayChoices.classes`, checked by `displayChoicesProblem` and `displaySettingsProblem`, filled by `resolveDisplay` (on by default); `DISPLAY_CLASSES` (labels), `classShown(display, class)` | `display.ts`; tests `sdk16partD.test.ts`, `display.test.ts` |
| Web test kit: `setDisplay({ classes })` | `testing/index.ts` |

- **For the CDA:**
  - ECore's `ModelJson` maps `displayClass`: its `ModelJsonContractTest` refuses `object-with-display-class.json` until it does, as for part A's `text`;
  - ECore's display settings accept `classes` (`DisplaySettings.java`);
  - the shell's Display settings window shows the two switches beside the relation kinds';
  - its `src/display/state.test.ts` expects the display without `classes`, which `resolveDisplay` now fills.
- **For PCA-map-view-2d:** hiding by class (its function 40). **For PCA-gmti and PCA-simulator:** marking their dwell areas, coverage and job area.

### Part G: symbol palettes (CR-0041 items 16 to 18; T-156, the M7 plan's Q1 A)

| Addition | Where |
|---|---|
| Manifest: `symbolPalettes`, 1 to 8, each `{ id, name, symbols }` with 1 to 2 000 `{ standard, code, label? }`; `standard` `APP-6B`, `APP-6D` or `APP-6E` (no vessels), `code` valid for it as a `core.symbol`'s `sidc` | `plugin-manifest.schema.json`; examples `manifest-symbol-palettes.json` (valid), `manifest-palette-bad-code.json` and `manifest-palette-vessel.json` (invalid) |
| Web: `SymbolPalette` (`plugin`, full `id`, `name`, `symbols`), `PaletteSymbol`, `MAX_PALETTES_PER_PLUGIN`, `MAX_PALETTE_SYMBOLS`; `ctx.symbolPalettes` (optional until the shell gave it, **required since the freeze**) | `palettes.ts`, `context.ts`; tests `sdk16partG.test.ts` |
| Web test kit: `createFakeContext({ symbolPalettes })` | `testing/index.ts` |

- **For the CDA:** ECore refuses a manifest whose palette ids repeat (the schema cannot), and the shell gives `ctx.symbolPalettes` from every enabled plugin's manifest, server-only ones included, with the plugin and the full id.
- **For PCA-draw-symbols:** the palette drop-down (its function 31). **For PCA-cot:** the palette "CoT" and the test that keeps it in step with its table (its function 32).

### Part H: folders relative to emcc (CR-0041 items 19 to 21; T-157, the M7 plan's Q2)

| Addition | Where |
|---|---|
| Manifest: a folder's setting may hold an absolute path, as before, or a value starting with `%emcc%/` (or `%emcc%`), resolved by ECore below the emcc folder; outside it, links included, it is unusable | `plugin-manifest.schema.json` (`folder.setting`'s description) |
| Java: `LocalFolder.EMCC_PREFIX` and the documentation of the setting's value: such a result answers `MISSING` with "outside the emcc folder", as any other unusable value; no new reason, no API change | `LocalFolder.java`; tests `EmccPrefixTest` |

- **For the CDA:** ECore resolves the prefix below the folder the server was started in, refuses a real path outside it, and the Monitor shows the setting as typed and the folder it resolves to.
- **For PCA-terrain:** `heightDataFolder`'s default `%emcc%/settings/terrain` (its function 12). **For the MCA:** the release's empty `settings/` with a short readme.

### The freeze (MCA, 2026-11-12; owner, guards as for 1.5.0)

**SDK 1.6.0 and data model 1.6.0 are frozen** with this step, from `integration/sdk-v1.6` `4c3de175` (parts A to H with the CDA's ECore and shell sides and `map-view-2d`'s `append`; full runs 1 to 3 and the quick run m7q2 green), with full run 4's plugin fixes `b7f9338a` merged (green). Changes need a change request again. Every member that waited for its provider is now plain, as at the 1.5.0 freeze:

| Now | Was | Given by |
|---|---|---|
| Web `MapView.append` required | optional (part B) | `map-view-2d` (T-176, its function 44) |
| Web `ctx.relationLines` required | optional (part C) | the shell (CDA, T-181) |
| Web `DisplaySettings.classes` required; `displaySettingsProblem` reports a display without it ("classes is missing"); `classShown` reads the switch plainly | optional (part D) | the shell's `resolveDisplay` (CDA, T-182) |
| Web `ctx.symbolPalettes` required | optional (part G) | the shell, from every enabled manifest (CDA, T-156) |

Optional by design, also after the freeze: `RelationLine.strokeColorSetting`, `displayClass` on objects and overlay items, `TopBarItem.workspaces`, a manifest's `category` and `symbolPalettes`, `HttpCall`'s credential and response limit, `core.text`'s rotation and size. Nothing changes in the Java SDK or the model's schemas.

- **The guards** (the owner's A, 2026-11-12, as Q50 A for 1.5.0): the PDA removed, on this branch, the guards on these members that the strict lint or `tsc` refuses, so that one branch builds green:
  - the shell (CDA): `display/DisplayForm.tsx` reads the class switches plainly; `plugins/loader.test.ts` reads `relationLines` and `symbolPalettes` plainly;
  - `map-view-2d`: `activate.tsx` passes and follows `ctx.relationLines` plainly; its tests call `map.append` plainly, give their displays `classes`, and drop the case of a shell without `ctx.relationLines`;
  - `draw-shapes`: `controller.ts` and `EditPanel.tsx` lose `canAppend` and the hint "The map view cannot append points yet"; its test of that case goes;
  - `draw-symbols`: `controller.ts` returns `ctx.symbolPalettes` plainly;
  - the simulator: `editor.ts` loses `NO_APPEND` ("The map view cannot continue a line yet"); its test of that case goes.
- **Left to their owners:** nothing needed. No brief described the fallbacks, so no brief changes.
- **From a run here:** `tools/test.mjs` green on this branch, with run 4 merged: the Maven reactor (2 857 tests, 9 skipped), every web workspace with its lint and `tsc` (the web SDK 368, the shell 514, `map-view-2d` 788, `draw-shapes` 284, `draw-symbols` 382, the simulator 226, the others as before), the model (132), the plugin checks and the tools. Not run: the ITA.

## SDK 1.7.0 (M7 RC2; CR-0042)

CR-0042 (approved by the owner 2026-11-12, TC A; T-192, TA A) makes SDK and data model 1.7.0 in one part, on `pda/sdk-1.7` from `integration/sdk-v1.6` `30661b96`. **Given version 1.7.0 by the owner on 2026-11-12 (TD A)**, for M7 RC2; **frozen on 2026-11-12** ("The freeze" below). Every 1.6.0 manifest and plugin stays valid. The Java API does not change; its version moves with the SDK, since ECore checks a plugin's `sdkVersion` against `Sdk.VERSION`. Plugins that use a 1.7.0 addition name `^1.7.0`.

### A data type's stepped fade (CR-0042 option A; T-192)

| Addition | Where |
|---|---|
| Manifest: a data type's `fadeSetting`, a JSON Pointer into the plugin's settings (as part C's `strokeColorSetting`); `$defs/steppedFade`, the form it points to: `on`, `fromSeconds` (0 to 86 400), `stepPercent` (1, 2, 4, 5, 10, 20, 25 or 50) and `invisibleAtSeconds` (above `fromSeconds`, model rule 22) | `plugin-manifest.schema.json`; examples `manifest-data-type-fade-setting.json` (valid), `manifest-data-type-fade-setting-not-pointer.json` (invalid) |
| Web: `DataType.fadeSetting` (as declared) and `DataType.fade` (`SteppedFade`, from the plugin's current settings while it is on and valid); `steppedFadeOf(value)`, `withSteppedFades(dataTypes, settingsOf)`, `sameFade`, `fadeOpacity(object, fade, now)`, `STEP_PERCENTS`, `MAX_FADE_SECONDS` | `fade.ts`, `context.ts`; tests `sdk17.test.ts` |
| Web test kit: `ctx.dataTypes` with their fades, from `pluginSettings` (and the plugin's own `settings` for its own types); `setPluginSettings` and `changeSettings` resolve them again and call `onDataTypesChange` when one changed | `testing/index.ts` |

- **The steps** (owner, FC A): counted from `time.observed`; full before `fromSeconds`; then one step down by `stepPercent` every (`invisibleAtSeconds` − `fromSeconds`) × `stepPercent` / 100 s; 0 from `invisibleAtSeconds`. The owner's example, 10, 5 and 100: 95 % from 14.5 s, 50 % from 55 s, invisible from 100 s. An object without `time.observed` is not faded.
- **Optional by design, also after the freeze:** `fadeSetting` (absent: the type has none) and `fade` (absent: no stepped fade now). No member waits for a provider.
- **For the CDA:**
  - **ECore:** `PluginManifest` keeps a data type's `fadeSetting`; `PluginHost.dataTypesJson` sends it, as it sends `sensorReport`, in `/api/config` and the `data-types` message. ECore's own `SdkVersionsTest` lines move to 1.7.0.
  - **The shell:** keeps `fadeSetting` in the data types it reads, and gives `ctx.dataTypes` through `withSteppedFades` with the plugins' current settings (`plugins/shared.ts`, `settingsOf`), and calls the `onDataTypesChange` listeners again when a `settings` message changes a fade, as it does for `ctx.relationLines`.
- **For PCA-map-view-2d:** its function 46: draws an object whose data type has a `fade` at `fadeOpacity`, in place of the expiry fade, and not at all at 0; criterion 107.
- **For PCA-gmti:** `detectionFade` and `dwellAreaFade` in its settings (its brief, section 5); `gmti.detection`'s `fadeSetting`; the data type `gmti.dwell-area` (owner, TG A) for the dwell areas; `sdkVersion` `^1.7.0`; criteria 38 to 40.

### The freeze (MCA, 2026-11-12)

**SDK 1.7.0 and data model 1.7.0 are frozen** with this step, from `pda/sdk-1.7` (its one part on `integration/sdk-v1.6` `30661b96`, with the owner's name `gmti.dwell-area`, TG A). Changes need a change request again.

- **No member changes at the freeze:** `DataType.fadeSetting` and `DataType.fade` are optional by design (absent: no stepped fade), so nothing waited for a provider, and no guard in others' code goes.
- **Its builders, checked against it:** a scratch merge of this branch with `integration/sdk-v1.6` `ab47de02`, `cda/sdk-1.7` `5696e6de` (ECore's `fadeSetting`, the shell's `withSteppedFades`, the version lines), `pca-map-view-2d/m7` `4decd6d3` (function 46) and `pca-gmti/m7` `086bf905` (the settings, `gmti.dwell-area`, `^1.7.0`) merges without conflicts, and `tools/test.mjs` passes on it: the Maven reactor (2 868 tests, 9 skipped), every web workspace with its lint and `tsc` (the web SDK 381, the shell 515, `map-view-2d` 819, the others as before), the model (134), the plugin checks (20) and the tools (34). Not run: the ITA.

## SDK 1.8.0 (M8; CR-0043)

CR-0043 (approved by the owner 2026-11-13, UO A) makes SDK 1.8.0 in parts A to C on `pda/sdk-1.8` from `main` `c750f849`, a fourth, part D (owner UZ A; approved by the owner 2026-11-14), on `pda/sdk-1.8-partD` from `integration/sdk-v1.8` `55702420`, a fifth, part E (CR-0044, approved by the owner 2026-11-14 as CR-0043's part E, VQ A), on `pda/sdk-1.8-partE` from `integration/sdk-v1.8` `a5d1821f`, a sixth, part F (CR-0047, approved by the owner 2026-11-15, WF A, its choices WE A), on `pda/sdk-1.8-partF` from `integration/sdk-v1.8` `a8faa875`, and a seventh, part G (CR-0043, owner XD A, 2026-11-15), on `pda/sdk-1.8-partG` from `integration/sdk-v1.8` `bede0e94`. The Java SDK changes only with part E (streams and conversions), and the data model only by part D's optional manifest `icon`; both move to 1.8.0 with it, as at 1.7.0 (ECore checks `sdkVersion` against `Sdk.VERSION`). Every 1.7.0 plugin stays valid. Plugins that use a 1.8.0 addition name `^1.8.0`. **Frozen on 2026-11-15** (owner XL A; "The freeze" below).

### Part A: symbol labels by place (T-163; owner B, UH A; the answers of 2026-11-13)

| Addition | Where |
|---|---|
| `LABEL_PLACES` (top left, top right, bottom left, bottom right, below; owner A) with `LABEL_PLACE_NAMES`; `TEXT_LABEL_IDS` (every label but `direction`); `LabelPlaces` | `display.ts` |
| `DisplaySettings.labelPlaces` and `directionArrow` (the arrow its own switch, owner A), optional until the shell gave them, **required since the freeze**; `labels` still filled with the same labels, and **`@deprecated` since the freeze** (not before, since the strict lint, `no-deprecated`, would have refused its readers, the shell, `map-view-2d` and `symbology`, before they could move) | `display.ts` |
| `placesFromLabels` (a stored 1.7.0 list: `name` below; the others top right, bottom right, top left, bottom left; the rest dropped; the arrow always on, `direction` listed or not: owner WZ A, 2026-11-15) and `labelsOfPlaces` | `display.ts` |
| The checks: `displayChoicesProblem` refuses a stored `labels` beside `labelPlaces` or `directionArrow`; `displaySettingsProblem` takes the filled display, whose `labels` holds the same labels as its places and arrow; `resolveDisplay` per field: the user's, else the admin's, else the default, a stored list converted, its own order kept in `labels` | `display.ts`; tests `sdk18partA.test.ts` |
| Test kit: `setDisplay` lets places or the arrow replace a stored list, and a list replace them | `testing/index.ts` |

- **The default:** `name` below and `uniqueDesignation` top right, the arrow on: the same symbols as before.
- **Two points against CR-0043's wording, both safer for 1.7.0 readers:** `resolveDisplay` keeps a stored list's own order in `labels`, and the default's `DEFAULT_DISPLAY.labels` (`name, uniqueDesignation, direction`), rather than re-ordering it by place; so `displaySettingsProblem` checks that `labels` holds the same labels as the places and the arrow, not their order. The order never decided the drawing (M5, the ACA's R2 on part 5).
- **For the CDA:**
  - **The shell's window:** five drop-downs, one per place (`LABEL_PLACE_NAMES`, the choices `TEXT_LABEL_IDS` and none, each label in one place), and the "Direction arrow" check box, in place of the label list. It stores `labelPlaces` and `directionArrow`, never `labels` beside them. The same goes for the admin's defaults.
  - **ECore's display setting check** (`DisplaySettings.java`) takes the two new keys, as `displayChoicesProblem` does.
- **For PCA-map-view-2d:** draws each placed label as text at its place and the arrow by `directionArrow`, and asks `symbology` with `withText` and `labels: []` (owner A); it read `labels` until the shell gave `labelPlaces` (the fallback removed at the freeze). **PCA-symbology:** nothing.

### Part B: the design's tokens and components (T-202; ADR-0056)

| Addition | Where |
|---|---|
| Tokens `colorEdge`, `colorEdgeCard`, `colorRaised`, `edgeWidth`, `radiusControl`, `fontLabel`, `labelCase`, `labelLetterSpacing`, `labelWeight`, with the test kit's values | `theme.ts`, `testing/index.ts` |
| `PanelFoot` (actions on the right, an optional `status` on the left) | `components/design.tsx` |
| `Chip` (`tone` ok, warning, error, info, neutral; `label`; optional `icon` and `title`, a tooltip; always an icon and a word; `CHIP_ICONS`) | `components/design.tsx` |
| `TileGrid` with `Tile` and `TileGroup` (`groups` in folding groups, or a flat `tiles` list without headings; one selected, one Tab stop over all, List's keys by `nextTile`; each group's tiles a listbox of their own, its heading outside it) | `components/design.tsx`; tests `sdk18partB.test.tsx` |

- **Their CSS** in `components.css` gives the structure and a plain look that falls back to existing tokens; the look and the tokens' values are the UXA's (T-205; ADR-0056 point 2).
- **For the UXA (T-205):** the nine tokens in `tokens.css` for every look, scheme and density. Until then the shell's `tokens.test.ts` (the CDA's) finds them missing; a `:root` block that maps each to an existing token keeps the screen as it is.
- **For the CDA (T-203):** the panel body keeps a `PanelFoot` pinned at the bottom while it scrolls; the tests' rows for the new tokens; the Monitor's states as chips.
- **For the PCAs (T-204):** `draw-tactical`'s Graphics as tiles; a panel foot where a panel's actions apply to its body.

### Part C: name once, icon always (the UXA's P1 and P2)

- **The design pattern** (section 6) says it: no inner heading repeating the panel's title, and an icon for every panel; with the foot, chips and tiles.
- **`Panel.icon` stays optional** in the type: a plugin supplies it, so requiring it would break plugins built for 1.7.0 or earlier. A plugin that declares `^1.8.0` gives one (the conformance review checks it). The shell draws a neutral icon for a panel without one (CDA).

### Part D: the settings schema's hints (T-203 parts C to E; owner UZ A, approved 2026-11-14)

What the CDA's generated forms, Settings' lists and save bars need from a plugin's settings schema (the UXA's T-203 points 4 to 10, as the CDA answered them). All are annotations in `x-emc2` (`model/README.md`, "Changes in 1.8.0"): validation does not change, and a schema without them still gets a form.

| Addition | Where |
|---|---|
| `groups` on an object: `[{ id, label, properties, folded?, advanced? }]`, at most 32; the free properties first, unheaded; an `advanced` group folded and last; a nested object its own group under its `title` | `model/README.md`; `formSections` |
| `hint` on a property, 1 to 80 characters, under the field; `description` behind an info button; without a hint, a description of up to 80 characters is the hint | `fieldHint` |
| `item` on an array of objects: `{ name, noun, state?, columns? }`; "New link" for an unsaved item with no name, "Link 3" for a saved one; "Add link", "Delete link?"; up to 6 columns, else up to 3 short ones | `itemName`, `itemWords`, `itemColumns`, `isItemList` |
| `width`: `short` or `full`; short by default for numbers, integers, booleans, enums, colours and strings of `maxLength` 24 or less | `fieldWidth`, `isShortByType` |
| `unit` on a number or integer, 1 to 8 characters, after the field | `SettingsAnnotation` |
| The manifest's optional `icon`, a name from `PLUGIN_ICONS` (38 Lucide icons), also for server-only plugins; an unknown name or none is the shell's neutral icon | `pluginIcon`; `plugin-manifest.schema.json` |
| `settingsHintsProblem(schema)`: the first wrong `x-emc2` (every key from 1.2.0 to 1.8.0), as `<pointer>/x-emc2: <problem>`, or null; the SDK's tests run it on every plugin's settings in `plugins/` | `settings-form.ts`; tests `sdk18partD.test.ts` |

- **Meanings, no new keys (from 1.8.0):** a false `enabledWhen` greys the field and makes it read only, and keeps its value (corrected 2026-11-17 to the shell's behaviour, owner AAT A: this line said it hides the field, and that `readOnly` shows the value as text and `examples[0]` is the placeholder, which the shell never did); the order is the schema's, except where groups set it. The shell words a pattern problem itself, never showing the regular expression.
- **The save surfaces follow from the types:** the page's properties other than arrays of objects are one surface with one bar; each item of an array of objects is its own, in its side form.
- **Beyond the CR's text:** a colour setting counts as short (the simulator's page of numbers and colours side by side); `formSections` puts nested objects in no group after the declared groups and before the advanced ones; a list without `item` names its rows by the items' `title`, else the list's, and `itemWords` takes its noun from the same titles, else "item"; `noun` is a letter, then letters, spaces and hyphens; `settingsHintsProblem` also checks 1.3.0's and 1.5.0's `enabledWhen` and `visibleWhen` (a sibling, 1 to 32 values), and refuses `groups` deeper than one nested object (every plugin's schema in `plugins/` passes).
- **For the CDA (T-203 parts C to E):** the forms by `formSections`, `fieldHint`, `fieldWidth` and the unit; lists by `isItemList`, `itemName`, `itemWords` and `itemColumns`, each item's own Save, Discard and Delete in its side form; the hidden `enabledWhen`; the Settings list's icons by `pluginIcon`. **ECore:** the schema already lets `icon` through; `PluginManifest.java` reads it and passes it on with the plugin's entry, as it does `category` (to build).
- **For the PCAs (T-204):** the hints in their settings schemas and an `icon` in each manifest; the CDA's test cases first: `gmti`'s links (groups Connection, Picture, Classification and Advanced; the free fields `name`, `mode`, `direction`, `enabled` and, from M9.1, `edition` (out only); name `name`, state `enabled`), `cot`'s links, `map-view-2d`'s projections (name `code`), `basemap-wms`'s servers and backgrounds, the simulator and `draw-shapes`. Suggested icons: `ais` Ship, `adsb` Plane, `cot` Radio, `gmti` Radar, `nvg` Network, the basemaps Globe, Map and Server, `terrain` Mountain, `map-view-2d` MapPin, `symbology` Hexagon, `coordinates` Crosshair, `draw-shapes` Shapes, `draw-symbols` Flag, `draw-tactical` Swords, `simulator` Play, `layer-panel` Layers, `object-list` List, `bookmarks` Bookmark.

### Part E: streams to the web part, ECore's conversions, a floating window (CR-0044; ADR-0057, CR-0045; for FMV, T-207)

A plugin's server part streams bytes to its web part through ECore, e.g. MPEG-TS video; ECore converts MPEG-2 to H.264 for it; the web SDK gets a window that stays open beside the map. Built for `fmv` (`docs/plugins/briefs/fmv.md`); every addition is general.

| Addition | Where |
|---|---|
| **E1, streams:** `PluginContext.streams()` → `Streams.open(StreamSpec)` → `StreamRef` (`write(chunk, startPoint)`, `header`, `label`, `viewers`, `close`), a handle that travels in messages; `StreamSpec(name, mediaType, permission, label)`, a name `[a-z0-9][a-z0-9-]{0,63}`; the limits `MAX_OPEN` 32, `MAX_CHUNK` 64 KiB, `MAX_HEADER` 4 KiB, `MAX_RATE` 50 Mbit/s, `VIEWER_STALL` 30 s; `Streams.PATH` `/stream/`, which `Endpoint` refuses for a browser endpoint | `dev.emcc.sdk.stream`; `http/Endpoint.java` |
| **E2, conversions:** `PluginContext.conversions()` → `Conversions.start(spec, events, toMessage)` → `ConversionRef` (`write`, `stop`, `target`), a handle that travels in messages; `ConversionSpec.mpeg2ToH264(target)` with `bitrate` (0.5 to 20 Mbit/s, default 4) and `keyframeSeconds` (0.5 to 10, default 1); `ConversionEvent` `Waiting`, `Running`, `Stopped(reason)`, `Failed(failure, detail)` with `Failure` `UNAVAILABLE`, `START`, `STALLED`, `EXITED`; `START_TIMEOUT` 10 s, `STALL_TIMEOUT` 5 s, `STOP_GRACE` 2 s, `RETRY_AFTER` 1 min | `dev.emcc.sdk.stream` |
| **Test kit:** `FakePluginContext.streams()` (`FakeStreams`, `stream(name)` → `FakeStream` with its chunks, start points, header, label and `join()`, a viewer that gets what ECore would send it), `conversions()` (`FakeConversions`: `holdNew`, `conversion(name)` with `run()`, `fail(...)`, its input and drops; a running one copies its input to the target, marking the random access packets as start points), `Builder.maxStreams`; `PluginRules` keeps `Streams` and `Conversions` out of messages | `testkit/`; tests `FakeStreamsTest`, `StreamTypesTest` |
| **Web: `streamUrl(ctx, name)`**, `${ctx.serverBase}stream/<name>`, refusing a name outside `STREAM_NAME_PATTERN` | `stream.ts` |
| **E3, `FloatingWindow`** (`open`, `title`, `onClose`, `defaultSize`, `minSize`): stays open while the user works elsewhere; moves by its title bar (pointer, or the arrows, `WINDOW_STEP` 10 px, with Shift 50), resizes from its lower right corner (pointer or arrows) down to `WINDOW_MIN_SIZE` 240 × 160; kept in the browser window (`clampWindow`); several at once, each `WINDOW_OFFSET` 24 px from the one before, the last opened or pressed in front; its title bar takes the focus on opening, and the focus goes back on closing from inside; its close button or Escape closes it; the top layer, `role="dialog"`, not modal | `components/window.tsx`; its structure in `components.css` (`.emc2-window`, `-title`, `-title-text`, `-body`, `-resize`) for the UXA's look |
| **E4, `Video`** in `PLUGIN_ICONS` (39 names) | `settings-form.ts` |

- **The rules:**
  - a worker opens a stream and hands the `StreamRef` to the connection task that receives the data;
  - the task writes each chunk, never blocking;
  - no plugin thread, socket or lock serves a browser.
  - A conversion is ECore's process: the plugin feeds it, and its output goes straight into the stream, with no writes of the plugin's own meanwhile (they are `DROPPED`). Plugins still start no program (`PluginRules`).
- **What ECore serves and keeps** (the CDA, T-208 and T-211; `Streams`' and `Conversions`' Javadoc):
  - `GET /api/plugins/{id}/stream/{name}`, with `401`, `403`, `404` and `503`;
  - the start buffer, and the per-viewer queue that resumes at the next start point;
  - the viewer limits, the counters and the log lines;
  - the conversion slots, which wait when none is free (owner A), with its process and timeouts.
- **Until ECore gives them:** `streams()` and `conversions()` were default methods that throw `UnsupportedOperationException`, to become abstract before the 1.8.0 freeze, as in 1.2.0's W1. **`streams()` is abstract since 2026-11-15** (`pda/sdk-1.8-partF`; ECore gives it since T-208, merged as `01d4ffb6`). **`conversions()` is abstract since the freeze** (2026-11-15; ECore gives it since T-211, merged as `6040e6a0`).
- **For the CDA:** `PluginContextImpl`'s two members, the endpoint and its buffers (T-208), and the conversion service (T-211). ECore's own endpoint dispatch also keeps `/stream/` for itself; `Endpoint` already refuses it to plugins.
- **For the UXA:** `FloatingWindow`'s look.
- **For PCA-fmv (T-209):** the brief.

### Part F: a stable id for each item of a settings list (CR-0047; owner WF A and WE A, 2026-11-15)

A settings list such as `links[]` gets a stable id per item, so a plugin can tell a rename from a removal and an addition (the owner's WA B for `fmv`: a renamed link keeps its camera and arc). The Java SDK does not change: a plugin reads the id as any setting. No schema changes; `model/README.md`, "Changes in 1.8.0", has the annotation.

| Addition | Where |
|---|---|
| **F1, `item.id`** on an array of objects: a string property of the items, not the name, the state or a column, in none of the items' groups, holding a UUID v7 in lower case that emcc never changes | `model/README.md`; `SettingsItem.id` |
| **F4, `itemId(list, value)`:** the item's id, or null when the list has no `item.id` or the value no non-empty string there | `settings-form.ts` |
| **F4, `formSections(list.items, list)`:** an item's side form without the id, also out of its groups (a group left empty goes); without the list, nothing is left out. `itemColumns` never takes the id as a default column | `settings-form.ts` |
| **F4, `settingsHintsProblem`:** refuses an `item.id` that is not a string property of the items, is the name or the state, is a column or is in one of the items' groups | `settings-form.ts`; tests `sdk18partF.test.ts` |

- **ECore (CDA, F2):**
  - when it loads a plugin's settings, and at every settings change before it validates and delivers them, it gives a new UUID v7 to each item whose id is missing or empty, and stores the result;
  - it refuses a change with two items of one id in a list (`400`, with the item's path); at load the second gets a new id, and the event is logged;
  - a change that gives an item another id is a removal and an addition, as the plugin sees it.
- **The shell (CDA, F3):** Add gives a new item `uuidv7()`; the side form by `formSections(list.items, list)`; the id sent back unchanged on Save; rows kept by `itemId`.
- **The Java test kit** fills in nothing: `FakePluginContext` gives the settings as the test writes them, so a test writes the ids as ECore would have.
- **For PCA-fmv (F5):** the brief, section 5: the link items' `id` (a string, `readOnly`), `links`' `item.id`, and the stream, task and external ids keyed by it.

### Part G: a panel without its heading, its foot, closed tile groups (CR-0043; owner XD A, 2026-11-15)

PCA-draw-tactical's asks after T-204: part C's "name once" and part B's foot without a hand-built `<section className="emc2-panel">`. All additions; a 1.7.0 plugin sees no change.

| Addition | Where |
|---|---|
| **G1, `PanelFrame`'s `heading={false}`:** no `<h2>`; the title stays the section's accessible name; actions, if given, keep their bar (on the right) | `components/index.tsx` |
| **G2, `PanelFrame`'s `foot`** (a `PanelFoot`): drawn after the scrolling body, so full width (outside its padding) and pinned: `.emc2-panel > .emc2-panel-foot` does not shrink and is sticky at the bottom, also when the shell's panel scrolls | `components/index.tsx`; its structure in `components.css` |
| **G3, `TileGroup.closed`:** the group starts closed, also one that joins the grid later (e.g. "All graphics"); the user's opening and closing are kept against that | `components/design.tsx` |
| Tests | `sdk18partG.test.tsx` |

- **Structure, not look:** the foot's pinning and the actions' `margin-left: auto` (they stay right without a title) are layout, so the PDA's; the look of `.emc2-panel-head` and `.emc2-panel-foot` stays the UXA's.
- **For PCA-draw-tactical:** `PanelFrame heading={false} foot={<PanelFoot>…</PanelFoot>}` in place of its own section; "All graphics" as groups with `closed` from the start.

### The freeze (MCA, 2026-11-15; owner XL A, guards as for 1.5.0 and 1.6.0)

**Frozen on 2026-11-15**, on `pda/sdk-1.8-freeze-run` from `integration/sdk-v1.8` `f13baaa8` (T-211 and `main` merged in); its text prepared on `pda/sdk-1.8-freeze`. `tools/test.mjs` green on the branch; then the MCA's merge and, with M8 on `main`, the tag `contracts-1.8.0` (MCA). Changes need a change request again.

| Now | Was | Given by |
|---|---|---|
| Java `PluginContext.conversions()` abstract | a default that throws (part E) | ECore's `PluginContextImpl` (CDA, T-211); the test kit's `FakePluginContext` |
| Web `DisplaySettings.labelPlaces` required; `displaySettingsProblem` refuses a display without it | optional (part A) | the shell's `resolveDisplay` (CDA, T-203) |
| Web `DisplaySettings.directionArrow` required, checked the same way | optional (part A) | the same |
| Web `DisplaySettings.labels` and `DisplayChoices.labels` tagged `@deprecated` | to be deprecated (part A) | still filled with the placed labels and `direction` while the arrow is on; a stored 1.7.0 list is still read (`placesFromLabels`, the arrow on: WZ A). Removed only in a major version |

**Optional by design, also after the freeze:**
- `Panel.icon`: part C keeps it optional in the type so that 1.7.0 plugins load; a plugin that declares `^1.8.0` gives one, which the conformance review checks.
- The manifest's `icon`.
- `item.id` and `SettingsItem.id` (part F).
- `PanelFoot`'s `status`; `Chip`'s `icon` and `title`.
- `PanelFrame`'s `heading` and `foot`, and `TileGroup.closed` (part G).
- `FloatingWindow`'s `defaultSize` and `minSize`.
- `ConversionSpec`'s `bitrate` and `keyframeSeconds` (their defaults).

Nothing changes in the model's schemas at the freeze. `SymbolService.render`'s `labels` says that from 1.8.0 the map view passes `[]` (a 1.7.0 one passed `ctx.display.labels`). **One Javadoc point** (the CDA's note, owner XK A): `Conversions.start`'s first event is `Waiting` or `Running`, but without a converter the only event is `Failed` with `UNAVAILABLE`.

- **The guards removed** (found by a dry run on `integration/sdk-v1.8` `8274098a`, `tsc` and the strict lint in every web workspace, and found again on `f13baaa8`, nothing new). The PDA removed them on the freeze branch, so that one branch builds green, **with the owner's leave as at 1.5.0 and 1.6.0** (XL A):
  - **the shell (CDA):**
    - `src/display/names.ts:73-74`, `shownPlaces`' fallback to the list: it reads `shown.labelPlaces` and `directionArrow` plainly;
    - `src/display/DisplayControl.test.tsx:109`, an optional chain no longer needed;
    - `DisplayControl.test.tsx:121` checks what a 1.7.0 reader sees, so it keeps `labels` (the rule below); `state.test.ts:107` reads the places and the arrow of a stored 1.7.0 list;
  - **`map-view-2d`:**
    - `src/core/labelPlaces.ts:21-22`, the fallback to `labels`: it reads both plainly;
    - `test/core/controller.test.ts:1706` and `test/core/vectors.test.ts:47` (the shared `base` used on lines 48 to 50), displays that gain `labelPlaces` and `directionArrow`;
    - `test/core/labelPlaces.test.ts`, the two tests of the fallback (they deleted the members, so the dry run's types did not show them): one test that the places and the arrow are taken as given;
  - **`symbology`:** `test/labels.test.ts:73` and `74` check the list a 1.7.0 map view passes, so they keep `labels`; `109` takes a list equal to the default's;
  - **the SDK's own tests:** `sdk18partA.test.ts`, a display without the two is refused now ("labelPlaces is missing").
  - **A test that reads `labels`:** if it checks the deprecated list on purpose (what a 1.7.0 reader sees), it keeps it, with `// eslint-disable-next-line @typescript-eslint/no-deprecated` and the reason; any other reads the places or the arrow.
  - The Java side has no guard: no plugin calls `conversions()` but `fmv`, which needs it. `StreamTypesTest` checks that both members are abstract.
- **The version lines:** the 1.8.0 entry of the status lines of this file, `model/README.md` and both SDK READMEs; the model's "Changes in 1.8.0" begins with "Frozen on 2026-11-15". `Sdk.VERSION`, `SDK_VERSION` and the packages stay `1.8.0`.
- **Left to their owners:** nothing needed. No brief describes the fallbacks; `map-view-2d`'s README and handover may name the list's fallback (PCA-map-view-2d checks).

## SDK 1.9.0 (M9; CR-0048 part P, CR-0050 part U)

CR-0048 (approved by the owner 2026-11-16, ZB A; its questions PQ1 to PQ5 A) makes SDK and data model 1.9.0's **part P** on `pda/sdk-1.9` from `integration/sdk-v1.9` `89f79f1d`: the version step (`818e354b`), then the interfaces first (`902fb484`), so that the CDA builds C6 to C8 on them, then the test kit, the tests and these docs. **Part U** (raw pictures into the conversion service, a channel's state for its senders) is CR-0050 (approved by the owner 2026-11-16, ZL A; UQ1 to UQ4 A), on `pda/sdk-1.9-part-u` from part P's `2ccdc007`, and was frozen with part P, the UAV track being in M9 (ABO A; section "Part U" below). Every 1.8.0 plugin loads and builds unchanged, except point 1's texts rule, which is a build rule (below).

### Point 1: settings that explain themselves, and the TLS credential field (D1; ADR-0060, ADR-0062)

- **The texts rule** (ADR-0060 point 2, owner Q11 A): every property the Settings form shows has a `title` (1 to 64 characters) and a `description` (1 to 512), at every depth, inside an array's `items` too, and every group in `x-emc2.groups` a `description`. Exempt: the property an `item.id` names, and the properties inside a field with an `x-emc2` `kind`. **The web SDK's `settingsTextProblem(schema)` checks it**, and the template's manifest guard (`plugins/_template/web/test/manifest.test.ts`) calls it, with `settingsHintsProblem`. **ECore and the shell do not check it:** a plugin without the texts still loads. Every PCA adds the texts (the M9 plan's X1).
- **A group's `description`** (`SettingsGroup.description`, 1 to 512 characters): shown under its heading; `formSections` passes it on (`FormSection.description`, only when the group has one). A 1.8.0 shell refuses the key, so a plugin that uses it declares `^1.9.0`.
- **`"x-emc2": { "kind": "tls-credential" }`** on a string without `enum` or `pattern`: a TLS credential's name, or empty for the link's name (ADR-0062 point 3). The shell's form lists the names ECore serves to `settings.admin` (C3), and nothing else of a credential; a stored name ECore lacks shows as "<name> (missing)". The plugin passes the value, or the link's name when it is empty, to `TaskContext.tls` or `sslContext`: **the Java SDK's calls do not change**. Their javadoc now also names what ECore does since C3: an expired or unreadable credential is refused with an `IllegalStateException` naming the credential and its expiry date (ADR-0062 point 4), as a missing one is with an `IllegalArgumentException`; the task fails its start either way. **The test kit fakes both** (owner AAR A): `FakePluginContext.Builder.expiredTlsCredentials(name, date)` and `unreadableTlsCredentials(name, reason)`, and the same on `FakeTaskContext`, make `tls` and `sslContext` throw ECore's `IllegalStateException` (`the TLS credential <name>: its certificate expired on <date>`, `the TLS credential <name> cannot be read: <reason>`; ECore's expiry message also names the certificate's subject), so a link's test can check its failed start and the status it shows.

### Point 2: shared libraries by a compatibility rule (D7, gap G2; PQ3 A)

- **The SDK by the plugin's `sdkVersion` only:** the shell no longer compares `web.shared`'s `@emc2/plugin-sdk` (`SDK_PACKAGE`), which the build goes on writing.
- **Every other shared library by the caret of the built version:** `compatibleShared(library, built, shells)` is `satisfies('^' + built, shells)`, the same major and the shell's at least as new. The SDK's index exports it, so the shell's `incompatibility` can use it (CDA, C6). Shared cases: `model/examples/sdk-version-matching.json`'s `sharedCases`.
- **A new major version of a shared library is a breaking change of the web SDK** and needs its own CR.

### Point 3: service keys of a plugin's own (D7, gap G7)

- **`serviceKey<T, C>(id, cardinality)`**: a key `<plugin-id>.<name>`, which only that plugin provides (model rule 24; the shell refuses another provider, CDA, C6). It refuses `emc2.*`, the SDK's own. `serviceKeyOwner(id)` gives the plugin id.
- The manifest's `serviceKey` pattern takes a plugin id with hyphens before the dot; `emc2` is reserved as a plugin id.
- **The interface:** the provider documents it in its README, and a user declares the same TypeScript interface in its own code; plugins never import each other. Compatible changes only add optional members; **an incompatible change is a new key** (e.g. `acme-tracks.tracks-2`).

### Point 4: a channel kind a plugin declares (D8, gap G3; ADR-0059 point 3)

- **The manifest's `channelKinds`:** `{ "name", "title", "description", "payload" }`, at most 16; the kind's id is `<plugin-id>.<name>`; `payload` is a self-contained JSON Schema of an object (model rule 23: no `$ref` outside it).
- **Java:** `DeclaredItem(kind, id, label, payload)`, a `Message` and `Coalescing` by `id`, the payload at most `MAX_PAYLOAD_BYTES` (64 KiB) as compact UTF-8 JSON. **Not a `ChannelItem`:** `ChannelItem` and `ChannelKind` are unchanged, so no plugin's `switch` over them changes. `ChannelSpec.declaredKinds(Set)` (its own plugin's kinds only; with them, `kinds` may be empty), `ChannelSpec`/`ChannelInfo.takesDeclared`, `ChannelSpec.MAX_DECLARED_KINDS`; the records' old constructors stay. `Channels.offer(spec, worker, toMessage, toDeclared)` and `Channels.send(ChannelId, DeclaredItem)`: ECore checks the kind, the size and the schema at `send` (PQ2 A) and keeps the newest item per kind and id. **Both are default methods that throw until ECore has them** (C8).
- **The test kit:** `FakeChannels.declare(kind, schema)`, `sentDeclared`, `pendingDeclared`, `deliver(ChannelId, DeclaredItem)`; its payload check (`PayloadCheck`) covers a subset of JSON Schema (`type`, `properties`, `required`, `additionalProperties`, `items`, `minItems`, `maxItems`, `enum`, `const`, the four bounds, `minLength`, `maxLength`, `$ref` to `#/…`); ECore checks it all.
- **The first use:** `fmv` declares `camera-pose`; `uav-simulation` sends it (its brief, section 4).

### Point 5: compute tasks (D9; ADR-0064, YQ1 A, PQ1 A, PQ4 A)

- **The manifest's `compute`:** `{ "threads": 1 to 64, "reason" }`; absent means none.
- **Java, `dev.emcc.sdk.compute`:** `Computes` (`PluginContext.compute()`: `start` with or without an events target, `declared()`, `allowed()`, `STOP_GRACE` 5 s, `MAX_DECLARED` 64), `ComputeSpec` (name, inbox 1 to 100 000, overflow, `Restart`), `ComputeTask` (its own loop; **write it as a class**), `ComputeContext` (`take`, `poll`, `stopping`, `send` to its plugin's workers, `count`, `detail`, `folders`, `log`, `self`), `ComputeRef` (`post`, `stop`), and `ComputeEvent` (`Running`, `Restarting`, `Stopped` with a reason, `Failed`, `Refused` with `NOT_DECLARED`, `SWITCHED_OFF`, `PLUGIN_LIMIT` or `TOTAL_CAP`, and `Hung`). **`PluginContext.compute()` was a default that threw until ECore had it** (C7); **abstract since the freeze** (2026-11-18).
- **The limits:** a task counts from its start until it has stopped, its back-off included, against `allowed()` (the admin's, in the plugin's Settings entry, at run time; lowering it stops the newest first) and against `emc2.compute.max-threads` (`settings/emcc.properties`, by default the cores minus one). ECore does not retry a refused start.
- **A picture crosses as `Bytes`**, one copy (PQ4 A).
- **`PluginRules`:** a class that implements `ComputeTask`, and its nested classes, uses no `PluginContext`, `Store`, `Documents`, `Channels`, `Streams`, `Conversions`, `Topics`, `Timers`, `Workers`, `WorkerContext`, `Connections`, `Endpoints` or `OutboundHttp`; no class is both a compute and a connection task; `Computes`, `ComputeTask` and `ComputeContext` never travel in messages. The rules for every class still hold (no threads, locks, sleeps or waits, no sockets outside connection tasks, no file I/O, no process).
- **The test kit:** `FakeComputes` on real platform threads, as `FakeConnections`, with `FakePluginContext.Builder.compute(threads)`, `computeAllowed`, `computeTotalCap`, and `ctx.compute().allow(n)`, `refuseNext(refusal)`, `refused(refusal)`, `ctx.computeTask(name)` (`awaitIdle`, `posted`, `inbox`, `counter`, `details`, `state`). It does not mark a task `Hung`.

### Section 6: friendly control measures black or blue (owner YE B, PQ5 A)

- `DisplaySettings.friendlyGraphicColour?` and `DisplayChoices.friendlyGraphicColour?` (`'black' | 'blue'`), **optional for good**: `resolveDisplay` gives it only when a user or the admin chose one, so a 1.8.0 display and its tests are unchanged; a reader takes absent as black (`friendlyGraphicColourOf`). `FRIENDLY_GRAPHIC_COLOURS` for the display window, `FRIENDLY_GRAPHIC_BLUE` `#0060FF` (the UXA checks it).
- `GraphicRenderRequest.friendlyColour?`: the caller passes `ctx.display`'s value and keys its cache on it; APP-6's own colours still win.
- Builders: the CDA (the display window and the stored choice), PCA-map-view-2d and PCA-draw-tactical (the value in each request), PCA-symbology (the renderer's colours).

### Part U, point 1: an encoder, raw pictures in and H.264 back (CR-0050; ADR-0059 point 7; UQ1 A, UQ2 A)

- **`Conversions.encode(spec, output, toItem, events, toMessage)`**: starts an encoder and returns an `EncoderRef`. **The access units go into `output`, a compute task of the plugin's own**: each `EncodedPicture` through `toItem`, posted with the inbox's overflow policy, never blocking. The `ConversionEvent`s go to `events` as for `start`, their `stream()` the encoder's name. A running encoder takes **one conversion slot**, shared with the MPEG-2 conversions (`emc2.conversions.max`); the timeouts and `RETRY_AFTER` are `start`'s. **A default method that threw until ECore had it** (C10); **abstract since the freeze** (2026-11-18).
- **`EncoderSpec(name, width, height, frameRate, bitrate, keyframeSeconds)`**, `EncoderSpec.of(name, width, height, frameRate)`, `.bitrate`, `.keyframeSeconds`, `pictureBytes()`: a name as a stream's, unique among the plugin's encoders that run; an even width of 160 to 1920 and height of 120 to 1080 (1080p the ceiling; a simulated camera's default is 720p); 1 to 30 pictures a second; the bit rate and keyframe interval as `ConversionSpec`'s. No B-frames: one access unit a picture, in order.
- **`EncoderRef`**: `write(RawPicture)` never blocks: `ACCEPTED`; `DROPPED` while `Waiting` or when `MAX_WAITING` (2) pictures wait already, a late picture dropped, not queued; `CLOSED` once ended; `IllegalArgumentException` for a picture that is not `pictureBytes()`. **A compute task may call it** (the worker starts the encoder and posts the handle to the task); `Conversions` stays forbidden there. `id()`, `name()`, `stop()`.
- **`RawPicture(time, data)`**: one **I420** picture (Y, then U, then V), the only format, so the minimal ffmpeg build needs no scaler. **`EncodedPicture(sequence, time, keyframe, accessUnit)`**: one Annex B access unit, `sequence` from 0 per encoder, the `time` of its picture, `keyframe` for an IDR.
- **The inbox must not lose an access unit:** `EncodedPicture` is not `Coalescing`; an inbox item that carries it gives it a coalesce key of its own (e.g. its `sequence`), and the inbox leaves room for the pictures in flight.
- **The test kit:** `FakeConversions.encode` gives a `FakeEncoder`: `pictures()`, `waiting()`, `dropped()`, `emitted()`; `emit(keyframe, accessUnit)` gives the access unit of the oldest waiting picture into the task's inbox at once; `run()`, `fail(failure, detail)`, `holdNew` as for conversions; `ctx.conversions().encoder(name)`, `encoders()`, `stopEncoders()`.
- **ffmpeg (the MCA's B4):** the `rawvideo` demuxer and decoder, `h264_mf`, the `h264` muxer, an access unit delimiter before every picture; no scaler.

### Part U, point 2: a channel's state for its senders (CR-0050; ADR-0059 point 5; G11, UQ4 A)

- **`ChannelState`**: `READY` (the default), `DEGRADED` (it sends, with a fault), `NOT_SENDING` (it takes items but sends nothing).
- **The offering plugin:** `ChannelRef.state(state, detail)`, the detail plain text of 0 to `ChannelInfo.MAX_STATE_DETAIL` (128) characters, e.g. "No destination". Watchers get a new list at each change (the latest only); the same state again changes nothing; after `withdraw` it does nothing. **A default method that threw until ECore had it** (C8's registry); **abstract since the freeze** (2026-11-18).
- **Senders:** `ChannelInfo.state()` and `stateDetail()`, new components; the part P constructor is kept (`READY`, empty), and `withState(state, detail)` gives a copy. Only the channel's own state, not per item.
- **The test kit:** `FakeChannels` keeps the state of the plugin's channels and of scripted ones (`addOther(info.withState(…))`, `setOtherState(id, state, detail)`).

### Part U, point 3: tiles in plugin documents (CR-0050; ADR-0059 point 8; G15, UQ3 A)

No SDK change: `fmv`'s WMS cache keeps one tile a document (`Documents`), at most 900, the least recently used removed first, under the key prefix `wms-tile-cache.` (the owner's choice of 2026-11-17, in the `fmv` brief's section 10 on `pda/fmv-output-brief` `bc097f5e`, carried on `pda/uav-sim-findings`), so within the documents' key rule (lowercase words, digits, `-` and `.`, at most 128 characters).

### The template and the manifest guard (D3; owner, 2026-11-17, ZU A)

- **`manifestProblem(manifest, { schemasDir? })`** in `@emc2/plugin-sdk/build`: the manifest against the data model's plugin manifest schema, with the data model's own Ajv options; the schemas from the SDK package's `schemas/` (the SDK kit) or the repository's `model/schemas/`, refused when they are another SDK version's. Each problem with its JSON pointer, at most ten. Build and test time only, in Node; the web SDK depends on `ajv` 8.20.0 and `ajv-formats` 3.0.1 for it, never in the browser.
- **The template's guard** (`plugins/_template/web/test/manifest.test.ts`) calls it with `settingsTextProblem` and `settingsHintsProblem`. The template declares `^1.9.0`, runs one link end to end, and builds its server part on the stand-alone `dev.emcc:emc2-plugin-parent` (`server/plugin-sdk/plugin-parent/`).

### Left to their owners, and the freeze (all done by `237089b4`)

- **The CDA, part U:** the channel's state in the channel registry (with C8), then C10 (the encoder in the conversion service, with a fake ffmpeg in its tests; live with B4).
- **The CDA:** C6 (the shared rule and the service key check in `plan.ts` and the service registry, a group's description and the TLS field in the form, the friendly colour in the display window), C8 (declared kinds in ECore), C7 (compute tasks in ECore), and `ModelJson.DATA_MODEL` at 1.9.0.
- **The MCA:** the `@emc2/plugin-sdk` pins at 1.9.0 and the root lock (the owner's exception of 2026-10-26).
- **Every PCA:** the texts (X1), with the template's guard.
- **The freeze:** `PluginContext.compute()` and the two `Channels` methods abstract, the version lines, after C6 to C8 and C7; part U's `Conversions.encode` and `ChannelRef.state` with them, the UAV track being in M9 (ABO A). Done on 2026-11-18: [the freeze](#the-freeze-done-2026-11-18-on-pdasdk-19-freeze-run) below.

### The freeze (done 2026-11-18 on `pda/sdk-1.9-freeze-run`)

**Frozen on 2026-11-18** at the merge of `pda/sdk-1.9-freeze-run` into `integration/sdk-v1.9` (from `237089b4`, sets 1 to 10, quick run green; the run: owner ACH A, 2026-11-18); with M9 on `main`, the tag `contracts-1.9.0` (MCA). Prepared on `pda/sdk-1.9-freeze` (2026-11-17). Changes need a change request again.

| Now | Was | Given by |
|---|---|---|
| Java `PluginContext.compute()` abstract | a default that throws (part P point 5) | ECore's `PluginContextImpl` (CDA, C7); the test kit's `FakePluginContext` |
| Java `Channels.offer(spec, worker, toMessage, toDeclared)` abstract | a default that throws (part P point 4) | ECore's `PluginChannels` (CDA, C8); `FakeChannels` |
| Java `Channels.send(id, DeclaredItem)` abstract | the same | the same |
| Java `ChannelRef.state(state, detail)` abstract (part U) | a default that throws (part U point 2) | ECore's `ChannelRegistry` (CDA, with C8); `FakeChannels` |
| Java `Conversions.encode(...)` abstract (part U) | a default that throws (part U point 1) | ECore's `ConversionHub` (CDA, C10); `FakeConversions` |

- **Part U's two** are in this freeze: the owner freezes 1.9.0 with part U (ABO A, 2026-11-17), and ECore gives both.
- **The tests that changed:** `Sdk19TypesTest.theNewChannelCallsAndComputeAreAbstractSinceTheFreeze` checks the three part P members abstract; `Sdk19PartUTypesTest.encodeAndAChannelRefsStateAreAbstractSinceTheFreeze` checks the two part U members, in place of its two "throws until ECore gives it" tests.
- **The Javadoc:** the five members say since when they are abstract; none throws `UnsupportedOperationException` any more.
- **No guards in others' code:** the dry run on `38738f33` (2026-11-17) found none, and the freeze run compiled the main and test code of every server module again on `237089b4`: none.
- **The Maven versions lose `-SNAPSHOT`** (owner ACH A): the Java SDK, the test kit and the plugin parent are `1.9.0`, and so are `server/pom.xml`'s two managed SDK lines and the template's parent; the SDK kit's Maven artifacts are named `1.9.0`. Before 1.9.0 the Maven versions kept `-SNAPSHOT` after a freeze.

**Optional by design, also after the freeze:** `DisplaySettings.friendlyGraphicColour` and `DisplayChoices.friendlyGraphicColour` (section 6); `SettingsGroup.description` and `FormSection.description` (the texts rule is a build rule, not a type); `ChannelSpec.declaredKinds` (none by default); `ConversionSpec`'s and `EncoderSpec`'s `bitrate` and `keyframeSeconds` (their defaults); a compute task's events target. The web SDK has no member that becomes required. Nothing changes in the model's schemas at the freeze.

**The version lines:** the status lines of `docs/plugins/sdk-v1.md` (line 6), `model/README.md` (its status), `server/plugin-sdk/README.md` and `web/plugin-sdk/README.md` (line 5) say 1.9.0 is frozen; the model's "Changes in 1.9.0" begins with "Frozen on 2026-11-18". `Sdk.VERSION`, `SDK_VERSION`, `DATA_MODEL`, the packages and the 37 `@emc2/plugin-sdk` pins were `1.9.0` already.

**What it waited for,** all on `integration/sdk-v1.9` by `237089b4`: set 7 (the test kit's expired and unreadable TLS credentials, cot's K1, CR-0054 with ABM A); set 8 (X1's first 18 plugins, the cookbook, this text); X1's last three (`pda/x1-settings-texts-2`); the reference's TLS-fakes note and the cookbook's `ChannelRef.state` pitfall; the CDA's version lines (`690085fb`); the SDK kit (B5, MCA); the owner's go with part U (ABO A). The shell imports `compatibleShared` from the SDK (CDA), no longer a copy of its own.

## Not in v1

| Item | When |
|---|---|
| Teardown signal `ctx.signal` | When needed (owner, 2026-10-10) |
| User documents for the server part | Later 1.x, when a plugin needs them (owner, 2026-10-15). A plugin's own settings panel came in 1.3.0 (`Ui.setSettingsPanel`) |
| UDP listeners (mesh SA) | Covered by connection tasks in SDK 1.2.0 (ADR-0036; T-076) |
| Changes on behalf of a user from a server part | When a server part needs it |
| HTTP methods other than `GET` and `POST` (`POST` from 1.2.0, CR-0026), raw request bodies, and redirects; WebSocket channels between a plugin's web and server part (a one-way stream from the server part comes in 1.8.0 part E, CR-0044) | When a plugin needs them |
| Hosts from configuration for outbound HTTP (e.g. WMS) | Covered by CR-0013 from 1.1.0: the server part may reach any host, e.g. the hosts its settings name, but never one taken from a browser request, a message or an object's data (owner, 2026-10-18 and 2026-10-19; ADR-0030; ECore's side T-058) |
| Metrics beyond the plugin status and the listener counters | With the monitor view, if needed |
| `BLOCK_SENDER` for plugins | Only if a plugin really needs it |

## Open points

None. The ACA's points 1 and 2 on 1.1.0 (the `Popover`'s positioning and layering; arrow keys in `List`, `Tree` and `Menu`, and drag and drop in `Tree`) are in the second freeze (CR-0021, CR-0019).
