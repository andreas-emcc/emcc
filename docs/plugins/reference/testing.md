# Testing

Each SDK has a test kit that fakes ECore or the shell, so a plugin's tests run fast, alone and deterministically. This page lists the fakes, the tests every plugin has, and how to run them. The rules the tests guard are in [rules.md](rules.md) (R86 to R90).

## Server part (Java)

The test kit is the Maven artifact `dev.emcc:emc2-plugin-sdk-testkit` (test scope; the template's parent POM pins it), package `dev.emcc.sdk.testkit`.

### `FakePluginContext`

A single-threaded `PluginContext`. Nothing runs by itself: messages are delivered when the test calls `runUntilIdle()`, and virtual time moves only with `advance(duration)`, which fires timers, ask timeouts and delayed answers in order. It keeps ECore's rules: bounded mailboxes with their overflow, one answer per `ask`, `503` and `504` from endpoints, `403` for a user without the endpoint's permission, and ECore's caps (10 000 outstanding asks, 1 000 timers). Unlike ECore, a handler that throws fails the test (`Builder.rethrowHandlerErrors(false)` collects them in `handlerErrors()` instead).

```java
var ctx = FakePluginContext.builder("acme-tracks").settings(defaults).build();
plugin.init(ctx);
plugin.start();
FakeHttpExchange call = ctx.call("/tracks", User.of("u1", "Una", Set.of()));
ctx.runUntilIdle();
assertThat(call.reply().status()).isEqualTo(403);
```

| Area | Builder | At run time |
|---|---|---|
| Settings | `settings(json)` | `changeSettings(json)` calls every `subscribeSettings` worker |
| Label, data types | `defaultLabel(…)`, `dataTypes(…)` | `dataTypes()`; `core.general` is always first |
| Classifications | `classifications(…)` (NATO by default) | |
| Declared fields, field sets, relation kinds, workspaces | `declaredFields(…)`, `fieldSets(…)`, `relationKinds(…)`, `workspaces(…)` | the store checks them as ECore does |
| Caps | `caps(asks, timers)`, `maxConnectionTasks`, `maxStreams`, `maxChannels`, `maxListeners` | `outstandingAsks()`, `activeTimers()` |
| Workers and time | | `runUntilIdle()`, `advance(…)`, `now()`, `clock()` (starts at `CLOCK_START`), `worker(name)`, `queued(ref)`, `dropped(ref)`, `restart(ref)`, `stop(ref)` |
| Endpoints | | `call(target[, user])`, `post(target, body[, user])`, `request(method, target, headers, body, user)`, `serviceRequest(…)`; each gives a `FakeHttpExchange` (`reply()`, `isAnswered()`) |
| Topics | | `publishAsCore(topic, message)` |
| Outbound HTTP | `httpCredentials(names…)` | `upstream()`: `respond`, `respondAfter`, `fail`, `never` per URI; `httpCalls()` records the calls |
| Status and log | | `pluginStatus()`, `effectiveStatus()`, `setEcoreStatus(…)`, `logEntries()` |
| Temporal capability | | `setSessionTime(plugin, session, user, time)` |

### The fakes behind it

| Fake | Get it | What a test does with it |
|---|---|---|
| `FakeStore` | `ctx.store()` | `seed(…)`, `seedLayer(name)`; `rejectNext(code, message)`, `loseNextAnswer()`, `dropNextRequest()`, `timeOutNextQuery()`; `restart()` (each object comes back as last saved), `snapshotNow()`, `unsaved()`; `applyAs(actor, user, change)` for a user's change; `objects()`, `layers()`, `requests()` |
| `FakeDocuments` | `ctx.documents()` | `seed(key, json)`, `failNext(reason)`, `stored()` |
| `FakeFolders` | `ctx.folders()`; `Builder.folder(id, path)` | a real temporary folder; `setPath`, `hold()`/`release()`, `calls()`, `inFlight()` |
| `FakeConnections` | `ctx.connections()`, `ctx.connectionTask(name)` | tasks run on real platform threads, as in ECore, and may open real sockets on loopback. A `FakeTask` gives `state()`, `inbox()`, `posted()`, `counter(name)`, `details()`, `listening()`, `peer()`, `children()`, `fail(reason)`, `stop()`, `awaitIdle()`. TLS: `Builder.tlsCredentials(name, sslContext)` |
| `FakeTaskContext` | `FakeTaskContext.of(name, items…)` | runs one connection task alone on the test thread: `run(task)`, then `sent()`, `counter(name)`, `children()`, `registered()`, `logEntries()` |
| `FakeChannels` | `ctx.channels()` | your offered channel: `deliver(id, item)`, `pending(id)`, `offered()`; as a sender: `addOther(info)`, `removeOther(id)`, `setOtherState(id, state, detail)`, `sent(id)`; declared kinds: `declare(kind, schema)`, `deliver(id, declaredItem)`, `sentDeclared(id)` |
| `FakeComputes` | `ctx.compute()`, `ctx.computeTask(name)`; `Builder.compute(threads)`, `computeAllowed`, `computeTotalCap` | tasks on real platform threads; `allow(n)`, `totalCap(n)`, `refuseNext(refusal)`, `refused(refusal)`; a `FakeCompute` gives `state()`, `inbox()`, `counter(name)`, `awaitIdle()` |
| `FakeStreams` | `ctx.streams()`, `ctx.stream(name)` | a `FakeStream` gives `chunks()`, `startPoints()`, `header()`, `label()`, `dropped()`, `isClosed()`; `join()` gives a viewer (`received()`, `bytes()`, `leave()`) |
| `FakeConversions` | `ctx.conversions()` | runs no program. `holdNew(true)` makes the next start wait; `conversion(stream)` gives `run()`, `fail(failure, detail)`, `state()`, `input()`. Encoders: `encoder(name)` gives `pictures()`, `waiting()`, `emit(keyframe, accessUnit)`, `emitted()`, `run()`, `fail(…)`; `stopEncoders()` |
| `FakeListeners`, `FakeConnection` | `ctx.listeners()`, `ctx.connection(name)` | only for the deprecated listeners: `feed(…)`, `close()`, `fail(…)`, `written()` |

A connection task, a compute task and a conversion's events reach their workers at the next `runUntilIdle()`. Call `awaitIdle()` on a real-thread task before you assert on what it sent.

### Checks

- **`PluginRules`**: the ArchUnit rule set every server part passes. `PluginRules.checkPlugin(id)` checks the classes in `PluginRules.packageFor(id)` (threads, locks, sleeping, sockets outside connection tasks, own HTTP and file I/O, process control, Spring, GeographicLib, other plugins and ECore, static state, message types, `@NullMarked`: the rules marked *PluginRules* in [rules.md](rules.md)). It fails when it finds no classes.
- **`CapabilityCheck.assertMatches(pluginClass, manifestPath)`**: the check ECore makes at load: every declared capability (e.g. `temporal`) is known, and the plugin class implements only declared ones.
- **`MessageCheck.requireImmutable(message)`**, **`PayloadCheck.problem(schema, value)`** (a declared channel kind's payload), **`SdkVersionRange.accepts(range, version)`**, **`TestJson.parse`/`write`**.

## Web part (TypeScript)

The test kit is `@emc2/plugin-sdk/testing`; the tests run with Vitest, jsdom and Testing Library.

### `createFakeContext` and `activatePlugin`

`createFakeContext(options)` gives a `FakeContext`: a `PluginContext` that records what the plugin does. Its default answer policy applies every change request and returns the change event, checking declared fields, field sets, relation kinds and layer locks as the store does. `activatePlugin(plugin, ctx)` starts a module as the shell does, including the temporal capability's first `timeChanged`.

```ts
import { createFakeContext, createFakeUser, activatePlugin } from '@emc2/plugin-sdk/testing';

const ctx = createFakeContext({ pluginId: manifest.id, settings: defaults, user: createFakeUser({ permissions: [] }) });
await activatePlugin(plugin, ctx);
ctx.answerWith((r) => ({
  outcome: 'rejected',
  rejection: { requestId: r.requestId, entityType: r.entityType, operation: r.operation, entityId: r.entityId,
    code: 'PERMISSION_DENIED', message: 'not allowed', at: '2026-01-01T00:00:00.000Z' },
}));
```

| Options | Records | Drives |
|---|---|---|
| `pluginId`, `settings`, `user`, `defaultLabel`, `classifications`, `provides`, `uses`, `dataTypes`, `declaredFields`, `fieldSets`, `relationKinds`, `workspaces`, `workspace`, `theme`, `time`, `display`, `pluginSettings`, `symbolPalettes`, `saveSettings` | `submitted`, `logs`, `notifications`, `statusHistory`, `addedPanels` (with `shown`), `topBarItems`, `overlays`, `objectActions`, `mapActions`, `openedMenus`, `liveSubscriptions`, `storedUserDocuments`, `setupShare`, `settingsSaves` | `live.snapshot/changes/area/clusters/counts`, `answerWith(policy)` (`'unknown'` makes `submit` reject with `OutcomeUnknownError`), `changeSettings`, `setServerObjects`, `setServerLayers`, `failObjectQueries`, `failUserDocuments`, `runObjectAction`, `runMapAction`, `saveSetup`, `restoreSetup`, `changeTheme`, `switchWorkspace`, `setTime`, `setDisplay`, `setPluginSettings`, `changeDataTypeBehaviour`, `settingsPanelProps()`, `provideAs(key, impl)` |

`createFakeUser()` is the no-login user, who has every permission; `createFakeUser({ permissions: [...] })` has only those.

### Fake services

Provide them with `ctx.provideAs(key, fake)`:

- `createFakeMapView(options)`: records `drawCalls`, `editCalls`, `goToCalls`, `centreOnCalls`, `zoomToCalls`, `overlayItems`, `fadeLists`; drives `setViewport`, `firePointer`, `setPickResult`, `completeInteraction`, `completeDrawing`, `rightClick`, `switchWorkspace`, `setObjectPositions`.
- `createFakeSymbolService()`, `createFakeCoordinateService()`, `createFakeObjectListService()`, `createFakeVectorBackground(…)`.
- `wmsGetMapUrl(source, request)`: the GetMap URL the map view would build, for both sides of a WMS background.
- `createTemporalTestPlugin()`: a module that records every time it is told.

### The look check

`checkLookCss(css, { pluginId, allow?, allowClasses? })` returns the findings of [rules.md](rules.md) R76 to R78 in a CSS file; a plugin's test expects none. Name the colours fixed in every look in `allow`, and a library's class prefixes you style (e.g. `ol-`) in `allowClasses`. It does not check inline styles or what you draw on a canvas; keep those to R79 yourself.

```ts
const css = readFileSync(new URL('../src/acme-tracks.css', import.meta.url), 'utf8');
expect(checkLookCss(css, { pluginId: 'acme-tracks' })).toEqual([]);
```

## The manifest guard

`web/test/manifest.test.ts` in the template. Keep it: ECore and the shell do not check the texts or the hints.

```ts
import { settingsHintsProblem, settingsTextProblem } from '@emc2/plugin-sdk';
import { manifestProblem } from '@emc2/plugin-sdk/build';
import manifest from '../../plugin.json' with { type: 'json' };

expect(manifestProblem(manifest)).toBeNull();                 // valid against the manifest schema
expect(settingsTextProblem(manifest.settings)).toBeNull();     // R70: titles and descriptions
expect(settingsHintsProblem(manifest.settings)).toBeNull();    // R71: x-emc2 hints
```

`manifestProblem` reads the schemas from the SDK package's `schemas/` (the SDK kit), else the repository's `model/schemas/`, and throws when they are another SDK version's. Each returns `null` or the problem with its JSON pointer.

## Required tests

**Server part:**
- `ArchitectureTest` (`PluginRules.checkPlugin`), `InstalledLayoutTest` (folder, artifact, entry class and `sdkVersion` match the id and the SDK) and `InstalledPluginIT` (the packaged jar, installed and loaded in a class loader like the host's; it runs after `package`), kept from the template with only their package renamed.
- Behaviour tests with `FakePluginContext`, including the `503`, `504`, `Failed` and `TimedOut` paths you rely on.
- The store's `Rejected` and `Unknown` paths (`rejectNext`, `loseNextAnswer`, `dropNextRequest`), and a restart that finds your objects again.
- Connection tasks through `FakeConnections` (a real socket on loopback) or alone with `FakeTaskContext`.
- Settings changes (`changeSettings`), and an endpoint called by a user without its permission (`403`).

**Web part:**
- The template's package-name test and the manifest guard.
- Component tests with `createFakeContext` and Testing Library, including a second snapshot and a rejected change.
- A user without your permissions (read only), settings changes, a missing `uses` service.
- Your panel through `addedPanels` (and `show`), with an icon and no heading that repeats its title; your actions with `runObjectAction`, also refused for several objects or without the permission; failed object queries (`failObjectQueries`); user documents over the limit; a restored setup share you cannot read; a change of look (`changeTheme`) where you draw on a canvas.
- `checkLookCss` on your CSS file.

**Both:** every acceptance criterion has at least one test that names it, and every coordinate conversion is tested with a point where latitude ≠ longitude.

## Running the tests

| Where | Server part | Web part |
|---|---|---|
| In the plugin's folders | `mvn verify` in `server/` (unit tests in `test`, `InstalledPluginIT` in `integration-test`) | `npm test` in `web/` (ESLint, `tsc --noEmit`, `vitest run`); `npm run build` builds it |
| In the emcc repository | `mvn -f server/pom.xml -pl ../plugins/<id>/server -am verify` | `npm test -w @emc2/plugin-<id>` at the repository root |
| Everything in the repository | `node tools/test.mjs` | |

## See also

- [rules.md](rules.md), [for-agents.md](../for-agents.md), [manifest.md](manifest.md), [build-and-install.md](build-and-install.md)
- The template's tests: `plugins/_template/server/src/test/` and `plugins/_template/web/test/`
