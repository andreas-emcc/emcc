# Plugin SDK v0 – design

> **History.** The SDK as it is today: [the SDK reference](reference/README.md). Below, "GET only" became GET and POST in 1.2.0, and the outline's `objects().submit` is `store().submit`.

- Owner: PDA · Task: T-005 · Date: 2026-10-05
- Status: **Frozen, 0.1.0** (2026-10-06, approved by the owner after the ACA's and the CDA's reviews; frozen together with data model v0, T-005). Frozen means: changes only through a change request (`CLAUDE.md` section 5); compatible additions become 0.1.x; no field or call may change its meaning in such a version; anything incompatible is 0.2.0 (before SDK v1, which is 1.0.0 for M1). The SDK's own documentation (Javadoc, TSDoc) is normative; this file is the overview. How each review point was handled: "Review log" at the end.
- **Superseded for M1 by SDK v1 (1.0.0):** `docs/plugins/sdk-v1.md` describes what v1 changes and adds; this file stays the description of everything v1 keeps.
- Sources: overview 4.1–4.11, ADR-0003–0010, 0014, 0017, the six approved briefs, spikes S2 and S4, `model/README.md`.

## Scope rule

SDK v0 covers **exactly what the six M0 plugins need** (`agents/pda.md`), plus the Java types of the data model, which the CDA's object store needs now (T-012). Everything else is listed under "Not in v0". Adding to the SDK later is cheap; taking something back after plugins use it is not.

## Common principles

- **Small, data-oriented, immutable.** Messages and data instead of callbacks where possible. Java: records and sealed interfaces. TypeScript: `readonly` types.
- **Every interaction is expressible as a serializable message**, so that a stub plugin can forward it to another process later (overview 4.1). The only handles that cross the boundary are `WorkerRef`, the reply handle and `ResponseHandle`. They are **immutable values with an opaque id (`HandleId`), equal by id**, so a stub can serialize them as ids.
- **Plugin code runs only inside the plugin's own workers.** Everything a plugin passes to the SDK that ECore calls later (handler factories, and the **mappers** of `subscribe`, `ask`, `http().send` and `endpoints()`) is plugin code. Mappers must be **pure and non-blocking**. ECore runs them **inside the target worker**, as part of handling the delivery, under that worker's watchdog budget. They never run on an ECore thread.
- **ECore never blocks on a plugin.** Deliveries from ECore (timer ticks, topic messages, HTTP results, endpoint requests) never block an ECore thread; see "Mailboxes".
- **Null handling (Java):** JSpecify `@NullMarked` in every SDK package. Optional values are `@Nullable`. No `Optional` in fields or return types.
- **No Spring, no OpenLayers, no third-party types in the SDK APIs** (ADR-0002, owner decision on the escape hatch). The Java SDK depends only on JSpecify.

## Versioning

- SemVer. Both SDKs start at **0.1.0**, frozen with data model v0 for M0. **0.1.1** (CR-0005, 2026-10-08): `dev.emcc.sdk.Sdk.VERSION`, and the caps on asks and timers below. Both SDKs always share one version, because a manifest has one `sdkVersion`; tests keep `Sdk.VERSION`, the web SDK's `SDK_VERSION`, its `package.json` and the Java SDK's Maven version (without `-SNAPSHOT`) equal.
- **Before 1.0.0:** compatible additions during M0 are **0.1.x**. **0.2.0 means breaking**. **SDK v1 for M1 is 1.0.0**; from then on SemVer as usual.
- The manifest's `sdkVersion` is a range with **npm semver semantics** (`^0.1.0` = `>=0.1.0 <0.2.0`). ECore and the shell decide compatibility with the same rules, tested against the shared cases in `model/examples/sdk-version-matching.json`.
- The manifest schema follows the **SDK** version, not the data model version.

## Plugin manifest (`plugin.json`)

Schema: `model/schemas/plugin-manifest.schema.json`, tested like the model schemas.

**Installed layout** (what the plugin host reads):

```
plugins/<id>/plugin.json
plugins/<id>/server/*.jar     optional: the server part and its own libraries
plugins/<id>/web/             optional: the built web part (entry module, CSS, assets)
```

| Field | Meaning |
|---|---|
| `id`, `name`, `version` | Plugin id (= extension namespace), display name, SemVer |
| `sdkVersion` | SDK range, npm semver semantics |
| `kind` | `map-view`, `background-map`, `utility`, `general`. At most one `map-view` plugin is active |
| `properties` | Optional: `ingoing`, `outgoing` |
| `dependsOn` | Plugin ids that must start first (start order, overview 4.1). The plugin host **rejects cycles** |
| `provides`, `requires` | Web service keys. The shell activates providers before users; a plugin may provide only keys listed here. Cycles between providers and users, together with `dependsOn`, are **rejected** by the plugin host and the shell |
| `required` | If true, the application does not start without this plugin |
| `internet` | Internet use (ADR-0014): `{ "hosts": […], "reason": "…" }`. Covers the **server part only**; web parts never contact hosts other than the emc2 server (the edge sends a Content-Security-Policy of `'self'`). Absent means no internet (**until M2**: from then a declaration only, and absent means none declared; CR-0013, `sdk-v1.md`). The ITA leaves such plugins out of the offline tests |
| `server` | Optional: `{ "entryClass": "…" }` |
| `web` | Optional: `{ "entry", "css", "shared" }`. `shared` is **written by the build**: the shared libraries the plugin imports, at the SDK's versions, never by hand (S4 rec. 11). The shell compares only those, and refuses the plugin if one differs from its own |
| `settings` | Optional: JSON Schema of the plugin's settings with a default for each. In v0 both parts get the defaults (no settings view until M1) |
| `permissions` | Optional: declared and checked permissions. Not enforced in M0 |

## Java Plugin SDK (`server/plugin-sdk`)

Maven module `plugin-sdk`, artifact `dev.emcc:emc2-plugin-sdk`, base package `dev.emcc.sdk`. A plugin's class loader sees only this jar (and JSpecify) plus the plugin's own jars, including bundled third-party libraries (ADR-0003).

### Life cycle

```java
public interface Plugin {
  void init(PluginContext context);   // create workers, register endpoints; no I/O yet
  void start();                       // begin work (timers, first requests)
  void stop();                        // stop timers; ECore stops the plugin's workers afterwards
}
```

The entry class has a public no-argument constructor. `init` and `start` must return quickly (budget 5 s); a plugin that throws or exceeds the budget fails to start and is disabled (overview 4.1).

### Plugin context

`PluginContext` gives: `pluginId()`, `log()`, `status()`, `settings()`, `workers()`, `topics()`, `timers()`, `http()` (outbound), `endpoints()` (inbound HTTP) and `defaultLabel()`.

- **Logging:** `PluginLog` with `debug/info/warn/error(String message, @Nullable Object... args)` (SLF4J-style `{}` placeholders) and `error(String, Throwable)`. ECore tags every entry with the plugin id. No SLF4J dependency in the SDK.
- **Settings:** `settings()` returns the plugin's settings as a `JsonObject` (below). In v0 these are the manifest defaults; from M1 the configured values.
- **Status:** `status().set(PluginState state, String detail)` with `OK`, `DEGRADED`, `FAILED`. ECore also sets a state, e.g. `DEGRADED` when a non-restartable worker hangs. The **effective status is the worse of the two**; the plugin cannot clear a state set by ECore. The same type (`state` + `detail`) is used in both SDKs.

### JSON values (`dev.emcc.sdk.json`)

The SDK's own sealed, immutable JSON type for opaque data (extensions, settings, plugin data later): `JsonValue` = `JsonObject` | `JsonArray` | `JsonString` | `JsonNumber` | `JsonBoolean` | `JsonNull`.

- `JsonNumber` keeps the number **exactly as written** (decimal text, comparable by value), so blind forwarding of extensions loses no precision (ADR-0007).
- `JsonObject` keeps member order and rejects duplicate names.
- No parser in the SDK: ECore's codec converts to and from Jackson.

### Messages and workers (overview 4.2, ADR-0004)

- A message is a **record** (or enum) implementing the marker interface `Message`, with immutable fields only: no arrays (use `Bytes`), collections created with `List.copyOf` and similar. The ArchUnit rule set checks it.
- A worker is created from a `WorkerSpec<M>`:

```java
WorkerRef<TileMsg> tiles = context.workers().spawn(
    WorkerSpec.of("tiles", TileMsg.class, TileWorker::new)   // factory: a fresh handler on restart
        .mailbox(1_000, Overflow.dropOldest())                 // or dropNewest() (default), coalesceByKey()
        .budget(Duration.ofSeconds(5))                         // watchdog budget per handler call
        .restartable(true));
```

- The handler is `interface Handler<M extends Message> { void handle(M message, WorkerContext ctx); }`. One message at a time; state lives in the handler object and is touched only by its worker (C2).
- **`BLOCK_SENDER` is not offered to plugins in v0** (ACA review). A plugin never blocks on a send.

### Mailboxes

- **`send(M)`** returns at once with `ACCEPTED`, `DROPPED` (by the overflow policy) or `CLOSED` (the target is stopped). Every drop is counted per worker (monitoring).
- **Overflow policies:** `dropOldest()`, `dropNewest()` (the default) and `coalesceByKey()`. With `coalesceByKey()`, a message **replaces a queued message with an equal key in place**. If the mailbox is full and nothing was replaced, the oldest is dropped.
  - **The key is data of the message:** a message that wants coalescing implements `Coalescing` and returns its key, usually a record component. So no plugin function runs when ECore queues a message, in line with "plugin code runs only inside its own worker".
  - Messages without a key, or with a `null` key, are never coalesced.
  - For deliveries that a mapper converts (topic messages), the key comes from the **original payload**, because the worker's message only exists once the mapper has run inside the worker.
- **Deliveries from ECore** (timer ticks, topic messages, endpoint requests) go through the same mailbox and policy. They never block an ECore thread. An **endpoint request** that cannot be queued, or that is evicted later, gets **`503` at once**.
- **Replies, `ask` timeouts and HTTP results are always delivered**, whatever the overflow policy, and never coalesced. They answer something the worker asked for, so dropping them would leave it waiting forever.
- **Topic publication never blocks**; each subscriber's mailbox applies its own policy.

### Request and reply (C5)

```java
ctx.ask(target, replyTo -> new GetTile(key, replyTo), Duration.ofSeconds(2),
        reply -> new TileAnswer(key, reply));    // Reply<R>: Ok(value) | TimedOut | Failed(reason)
```

- `R extends Message`. The target answers with `replyTo.reply(value)` or `replyTo.fail(reason)`.
- ECore answers `Failed` itself when the target is stopped, refuses the request (`DROPPED`, `CLOSED`) or evicts it, and **at once** when the plugin already has the maximum of **outstanding asks** (an ECore setting, default 10 000 per plugin; reason `"too many outstanding asks"`, CR-0005).
- The answer, or the timeout, arrives later as an ordinary message to the asking worker. No handler ever waits.

### A handler that throws

ECore logs the error with the worker's name and the message type, drops the message, counts the error, and lets the worker continue with the **same** handler. A thrown exception is not a hang, so there is no restart; keeping the handler's state consistent is the plugin's job. The test kit's fake context fails the test instead, unless told otherwise.

### Watchdog and restart

- A handler call that exceeds its budget marks the worker **HUNG** (overview 4.2).
- A restartable worker gets a fresh handler from its factory, on the same mailbox. The **old `WorkerContext` is fenced**: anything the stuck thread sends later is dropped. The message that hung is **not delivered again**.
- A new instance may receive replies to asks of the old instance; handlers must tolerate them, e.g. by ignoring unknown correlation keys.
- After a restart limit (e.g. 3 within 10 minutes) the worker is no longer restarted and the plugin becomes **DEGRADED**.

### Topics and timers

- `Topic<T extends Message>`: `Topic.of("basemap-osm.tile-fetched", TileFetched.class)`. Plugin topic names start with the plugin id.
- `topics().publish(topic, message)`; `topics().subscribe(topic, workerRef, mapper)`. The mapper runs in the subscriber's worker.
- `timers().once(delay, workerRef, message)` and `timers().every(period, workerRef, message)` return a `Cancellable`. `every` uses a **fixed delay**. A tick is **skipped while the previous one is still undelivered**. Minimum period: **10 ms**. At most **1 000 active timers** per plugin (an ECore setting; CR-0005): above that, `once` and `every` throw `IllegalStateException`. Refusals of asks and timers are counted and logged; the counters reach the monitor view in M1.

### Outbound HTTP (non-blocking; MCA/owner requirement)

```java
context.http().send(HttpCall.get(uri).header("User-Agent", "emc2/0.1"),
                    Duration.ofSeconds(5), self, result -> new Fetched(key, result));
```

- ECore performs the call **outside the worker** and delivers the `HttpResult` as a message: `Response(status, headers, Bytes body)`, `Failed(reason)` or `TimedOut`.
- Only `http` and `https`, only the hosts in the manifest's `internet.hosts` (**until M2**: from then any host, and `internet` only declares; CR-0013, `sdk-v1.md`), **no redirects** in v0, `GET` only, a body limit (10 MB), and a **per-plugin limit on concurrent calls**; above it the call fails at once (`Failed`).

### Inbound HTTP endpoints (overview 4.5)

```java
context.endpoints().register(Endpoint.get("/tiles/{z}/{x}/{y}.png").timeout(Duration.ofSeconds(10)),
                             tilesWorker, TileMsg.Get::new);
```

- **Path templates:** literal text and `{name}` placeholders. A placeholder matches one path segment, or part of one when literal text follows it in the same segment (`{y}.png`). Placeholders are returned as strings.
- Serves `GET /api/plugins/{pluginId}/…`. Each request arrives as a message carrying an `IncomingRequest` (path parameters, query, headers) and a `ResponseHandle`.
- The worker may answer **later, from another handler call**: `handle.respond(HttpReply.of(200, headers, bytes))`. `HttpReply` has a status, headers and a body.
- **Timeout per endpoint** (default 10 s): without an answer ECore sends `504`. A second answer is ignored and logged. A request the mailbox refuses or evicts gets `503` at once.
- v0: `GET` only. The edge (Spring) translates; plugin code never sees Spring (ADR-0002).

### Data model types (`dev.emcc.sdk.model`)

Hand-written records and sealed interfaces matching `model/` v0: `MapObject`, `MapObjectContent`, `Layer`, `LayerContent`, `Geometry` (sealed: `Point`, `MultiPoint`, `LineString`, `Polygon`, `Circle`, `Ellipse`, `Corridor`, `ArcBand`), `Position`, `Symbol`, `Modifiers`, `Style`, `SecurityLabel`, `Actor`, `Meta`, `Extensions` (plugin id → `JsonObject`), `ChangeRequest`, `ChangeEvent`, `ChangeRejection`. No JSON annotations, no JSON dependency.

`Symbol` stores a 30-digit APP-6E SIDC whose digits 21–30 are all zero in its 20-digit form, so both forms compare equal and writers write the short one (model README). The web SDK's `canonicalSidc` does the same.

**JSON mapping** is ECore's (Jackson, on the version Spring Boot manages). The SDK does not own the codec. The SDK ships an abstract **codec contract test** in two parts:

1. **Round trip:** every valid example parses and serializes back to an equal JSON tree. **Core numbers have IEEE 754 double precision and are compared as doubles**, as the model types hold them; **only free-form JSON** (extension data, a manifest's settings) **keeps exact decimals**, compared by value (CR-0004, model README "Conventions"). Includes a high-precision extension example, whose core coordinates have more digits than a double keeps (`model/examples/valid/object-extension-high-precision.json`).
2. **Rejection:** every invalid example is rejected. ECore validates against the JSON Schemas in `model/` with a validator library (owner decision, 2026-10-05).

The `invalid-by-rule` examples are for the object store's own tests.

**Object access for Java plugins is not in v0.** The intended M1 shape is outlined below, so that T-012 can align.

### Test kit

Module `server/plugin-sdk/testkit`, artifact `dev.emcc:emc2-plugin-sdk-testkit`, test scope only.

- `FakePluginContext`: deterministic and single-threaded. Messages are delivered when the test calls `runUntilIdle()`. Timers advance with `advance(Duration)`. Outbound HTTP is answered by a scripted fake upstream (`respond`, `respondAfter`, `fail`, `never`). It follows the same mailbox, reply and fencing rules as ECore, and the same caps (`Builder.caps(asks, timers)` lowers them for tests). Before each delivery it checks the message's **actual values** (`MessageCheck`): a record or enum, no arrays, and only unmodifiable collections. That catches what the static rules cannot, such as an `ArrayList` in a `List` field.
- **Package convention:** a plugin's classes live in `dev.emcc.plugins.<id without hyphens>`, e.g. `dev.emcc.plugins.basemaposm`. `PluginRules.checkPlugin("basemap-osm")` checks that package.
- **ArchUnit rule set** (`PluginRules`) that every plugin build runs, each rule with a negative test in the test kit:
  - **Concurrency:** no threads, executors, futures, timers, locks or synchronizers, matched by assignability, so subclasses count too. No `TimeUnit.sleep`, `timedWait` or `timedJoin`, and no `Object.wait`. No `synchronized` methods.
  - **Parallel streams:** none, because they run on the common thread pool.
  - **I/O:** no network or file I/O of its own (`HttpClient`, sockets, URL connections, channels, `Files`, `File`, file streams, `ZipFile`).
  - **Process control:** no `System.exit`, `Runtime` exit, halt, exec or shutdown hooks, and no `ProcessBuilder`.
  - **Dependencies:** no Spring; only the SDK, never ECore internals, other plugins' code, or the test kit in main code.
  - **Static state:** no non-final static fields. Static final fields hold immutable values: no arrays, atomics, or concurrent or mutable collection classes. A field declared as `List`, `Set` or `Map` and filled with `List.of` and similar is fine.
  - **Messages:** records or enums. Their component types must come from an **allow list**:
    - primitives and their wrappers, `String`, `BigDecimal`, `BigInteger`, `UUID`, `URI`, `java.time` values and enums;
    - the SDK's value types and handles (`WorkerRef`, `ReplyTo`, `ResponseHandle`). Its **service interfaces are not allowed**: `Plugin`, `PluginContext`, `PluginLog`, `Status`, `Cancellable`, `Workers`, `WorkerContext`, `Handler`, `Topics`, `Timers`, `OutboundHttp`, `Endpoints`. The runtime check refuses them too;
    - `List`, `Set` and `Map` of allowed types;
    - the plugin's own records (checked the same way), enums and message interfaces.

    No arrays and no `Optional`.
  - **Null handling:** every package is `@NullMarked`.
  - **Bundled third-party libraries are allowed** (`agents/pca.md`, ADR-0003). The design pattern requires that they neither start threads nor block.
  - **Not detectable** with ArchUnit: `synchronized` blocks. The design pattern forbids them like `synchronized` methods.

## Web Plugin SDK (`web/plugin-sdk`)

npm workspace `web/plugin-sdk`, package **`@emc2/plugin-sdk`**, shared through the shell's import map (S4). TypeScript strict.

### Entry module (S4 rec. 10)

```ts
import { definePlugin } from '@emc2/plugin-sdk';
export default definePlugin({
  activate(ctx) { /* register panels, provide or get services */ },
});
```

`activate` may be async. The shell's **10 s timeout covers `activate()` only**. A plugin that throws or times out is reported, and its later registrations are ignored; the others continue.

### Plugin context

| Member | Purpose |
|---|---|
| `pluginId`, `log` | As on the server |
| `status.set(state, detail)` | Same type as on the server. The web status is **per browser session**: shown in the monitor view (M1), never part of the server's status or health |
| `settings` | The plugin's settings (v0: the manifest defaults) |
| `services` | `provide(key, impl)`, `get(key)`, `getAll(key)` (below) |
| `ui.addControlPanel({ id, title, order, component })` | A React component in the Control Pane |
| `ui.addMapPaneOverlay({ id, position, order, component })` | A small React component over the map (cursor coordinates, rendering notice) |
| `ui.setMapView({ mount(element) → unmount })` | Gives the map view plugin the Map Pane element. Allowed only for the active `map-view` plugin |
| `notify({ severity, message })` | User notification (`info`, `warning`, `error`) |
| `livePicture.subscribe(listener, options?)` | The live picture as a **snapshot**, then **batches** of change events (S2, ADR-0017). The listener must accept **a new snapshot at any time** (after a reconnect or a gap). `options` is empty in v0; the S3 area of interest is added there later as a minor change |
| `changes.submit(content)` | Sends a change request **without `requestId` and `source`**; the shell fills them in. Resolves with `{ outcome: 'applied', event }` or `{ outcome: 'rejected', rejection }`. It **rejects only on transport failure or timeout** (`outcome unknown`), which is separate from the model's rejection codes |
| `defaultLabel` | The configured default security label |
| `newId()` | A UUID v7 |
| `serverBase` | `/api/plugins/{pluginId}/` |

### Services between plugins

A service is identified by a typed key defined **in the SDK**, so plugins never import each other:

| Key | Interface | Provided by (M0) | Cardinality |
|---|---|---|---|
| `emc2.map-view` | `MapView` | `map-view-2d` | exactly one |
| `emc2.background-map` | `BackgroundMapProvider` | `basemap-osm` | zero or more |
| `emc2.symbols` | `SymbolService` | `symbology` | exactly one |
| `emc2.coordinates` | `CoordinateService` | `coordinates` | exactly one |

- A plugin may only `provide` keys listed in its manifest's `provides`.
- `get(key)` resolves when the provider has activated, and **rejects** when the provider failed or is disabled.
- `getAll(key)` returns the current list and change events.

**`MapView`** (no OpenLayers types):
- **Viewport:** `center` (lon/lat), `resolution` (metres per pixel at the centre), `projection` (code), and the **visible area as a lon/lat polygon**. Not a lon/lat bounding box: a polygon also works at the poles and across the antimeridian, and is the base for the S3 area of interest. **The inside of `visibleArea` is the side that contains `center`**, which matters for views around a pole. Plus `goTo(center, resolution?)` and change events.
- **Pointer events:** click and move, with lon/lat and pixel.
- **Pick:** `pick(pixel, tolerance)` returns object ids, topmost first, not necessarily complete (S2).
- **Interactions:** `pickPoint()` and `dragObject(id)`, returning positions.
- **Overlay:** a plugin-owned overlay of temporary graphics given as data.
- **Shared state:** the **selection** and the **active layer**, each with change events.
- **Local layer visibility**, and the **rendering mode** (`hardware`, `software`, `none`, ADR-0017).

**`BackgroundMapProvider`** (data): `id`, `name`, `projections`, `source: { type: 'xyz', url, minZoom, maxZoom, tileSize }`, `attribution: { text, url }`.

**`SymbolService`**: `render({ standard, sidc, modifiers?, size, withText? })` returns `{ image, width, height, anchor }` from a cache keyed by appearance. Also `validate`, `compose` and `describe`, `catalog()`, `modifierNames`.

**`CoordinateService`**: `format(position, format, options?)`, `parse(text)`, and the user's chosen format with a change event. Formats: `dd`, `dms`, `utm`, `mgrs`.

### Shared libraries, build and global state

- **The SDK owns the list of shared libraries** (`SHARED_LIBRARIES`, with exact versions). It is part of the plugin contract and frozen with the SDK; changing a shared version is an SDK change (CDA proposal, ACA review).
  - Every shared library is a **peer dependency** of `@emc2/plugin-sdk` with the same exact version. A test checks that the two agree, and that `SDK_VERSION` equals the package version.
  - The shell never defines a second list: its build fails if an installed version differs from the SDK's.
- **The vendor bundle** (CDA, shell build):
  - **Content:** the shell's vendor step builds one entry per module of every listed package, plus `@emc2/plugin-sdk` from its TypeScript sources (main entry only). `@emc2/plugin-sdk/build` and `@emc2/plugin-sdk/testing` are never in the import map.
  - **Output:** the shell writes `web/shell/dist/importmap.json`, and the shell is built first (build order: the workspaces in the root `package.json`, CR-0006).
- **Plugin builds** use the **build plugin** from S4 (`emc2Plugin` in `@emc2/plugin-sdk/build`), and the shell's import map is required:
  - it keeps shared modules external;
  - it fails on a shared module the import map lacks;
  - it writes the built `plugin.json` with `web.shared` listing **only the shared libraries the plugin actually imports**, at the SDK's versions.
- **At runtime** the shell compares only the libraries a plugin lists in `web.shared`, and refuses the plugin if one differs.
- CSS is never shared (S4 rec. 13).
- **Global library state has one owner** (S4 rec. 14): only `map-view-2d` registers projections with proj4; only `symbology` changes milsymbol settings.
- The edge's **Content-Security-Policy** allows only the emc2 server (`'self'`), so web parts cannot fetch external URLs (ADR-0014).

### Test kit (web)

`@emc2/plugin-sdk/testing`: `createFakeContext()` with in-memory services, a scripted live picture (snapshots and batches, including a second snapshot), a recording `changes.submit` that answers with events, rejections or "outcome unknown", and fake `MapView`, `SymbolService` and `CoordinateService`. Vitest.

## Not in v0

| Item | When |
|---|---|
| Listeners (blocking I/O loops), compute workers | v1 (M1, `cot`) |
| Object access for Java plugins | v1 (M1, `cot`); outline below |
| Plugin documents in the persistence manager | v1, when a plugin needs to store data |
| Settings view and settings changes at runtime | v1 (M1) |
| Permissions enforcement | v1 (M1, Keycloak) |
| Metrics beyond the plugin status | v1 (M1, monitor view) |
| WebSocket channels between a plugin's web and server part | v1, when a plugin needs them |
| `BLOCK_SENDER` for plugins | Only if a plugin really needs it |
| Other HTTP methods, redirects | v1, when a plugin needs them |
| Local-network hosts from configuration instead of `internet`: for listeners | v1 (M1, `cot`) |
| Local-network hosts from configuration for outbound HTTP (e.g. WMS) | M4 (`basemap-wms`; ADR-0025, overview section 6) |

## Outline of the M1 Java object API (not normative)

So that the object store (T-012) can align now:

- `objects().submit(changeRequest, self, mapper)`: the change event or change rejection arrives later as a message, never blocking.
- A subscription to `objects.changed` in **batches**: `List<ChangeEvent>`, in sequence order, with a new snapshot after a gap.
- Snapshot and area query through `ask` to the object store, with the result as a message.

## Open points

1. ~~Owner: Java SDK v0 scope.~~ **Decided by the owner, 2026-10-05:** no object access and no listeners in the Java SDK until `cot-in` (M1; renamed `cot` on 2026-10-11).
2. ~~Owner: how ECore validates incoming documents.~~ **Decided by the owner, 2026-10-05:** ECore validates against the JSON Schemas in `model/` with a JSON Schema validator library. The CDA picks a permissively licensed library and asks the owner before adding it. Contract test part 2 therefore checks that ECore's validation rejects every invalid example.
3. **ACA:** overview 4.2 (normative) lists `BLOCK_SENDER` among the mailbox policies. SDK v0 does not offer it to plugins. Please add a note there, together with the overview updates already planned.

## Review log

| Review point | Where handled |
|---|---|
| ACA 1: mappers are plugin code, run in the target worker | Common principles |
| ACA 2, CDA mailboxes: delivery into a full mailbox, 503 | Mailboxes; Endpoints |
| ACA 3: no `BLOCK_SENDER` for plugins | Messages and workers; open point 3 |
| ACA 4, CDA shell: "no answer" outcome of `changes.submit`; shell fills `requestId` and `source` | Web plugin context |
| ACA 5: viewport as centre + resolution + projection + lon/lat polygon | `MapView` |
| ACA 6, CDA gap 3: SDK JSON value type with exact numbers; high-precision example | JSON values; data model types; `model/examples/valid/object-extension-high-precision.json` |
| ACA 7, CDA status: effective status, same type, web status per session | Plugin context (Java); web plugin context |
| ACA 8, CDA manifest: 0.1.x / 0.2.0 / 1.0.0; npm semver; shared cases | Versioning; `model/examples/sdk-version-matching.json` |
| ACA 9: handles as immutable values with opaque ids | Common principles |
| ACA 10: options for `livePicture.subscribe` | Web plugin context |
| ACA: ArchUnit allows bundled libraries | Test kit |
| ACA: `internet.hosts` is server-only; manifest follows the SDK version | Manifest; versioning; schema description |
| ACA: outline of the M1 Java object API | Outline section |
| ACA: no change of meaning in a minor version; event log via upcasters; verify ADatP-4774 later | `model/README.md` (Versioning, Security label) |
| CDA gap 1: settings for Java plugins | Plugin context (Java) |
| CDA gap 2: Map Pane for the map view | `ui.setMapView` |
| CDA ask/Reply: always delivered, `fail`, ECore answers `Failed`, `R extends Message` | Request and reply; Mailboxes |
| CDA: `coalesceByKey` semantics, `CLOSED`, topic publication | Mailboxes |
| CDA watchdog: fencing, no redelivery, stale replies, restart limit | Watchdog and restart |
| CDA timers: fixed delay, skip, 10 ms minimum | Topics and timers |
| CDA outbound HTTP: no redirects, http/https, concurrency limit; local hosts in v1 | Outbound HTTP; Not in v0 |
| CDA endpoints: template syntax, 503, per-endpoint timeout, status and headers | Endpoints |
| CDA JSON: ECore owns the codec; contract test in two parts | Data model types; open point 2 |
| CDA shell: `get` rejects, `provide` only listed keys, timeout covers `activate`, overlay order, snapshot any time | Web plugin context; services |
| CDA manifest: installed layout | Manifest |
| CDA null handling: no `Optional` returns, `@Nullable Object...` | Common principles; logging |
| CDA, ACA: Content-Security-Policy `'self'` | Shared libraries section; manifest `internet` |
| ACA, CDA: Jackson on the Spring Boot managed version | Data model types (ECore's task) |
