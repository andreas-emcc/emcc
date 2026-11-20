# Rules

Every rule a plugin must keep, in one list. Other pages cite them by id (R1, R2, …). Part of them is checked by the build: *PluginRules* (the Java test kit's ArchUnit rules), *the manifest guard* (`manifestProblem`, `settingsTextProblem`, `settingsHintsProblem`), *checkLookCss* (the web test kit's look check), or ECore and the shell when they load the plugin. The rest is yours to keep; a review checks it. See [testing.md](testing.md) for the checks.

## Plugin id and names

- **R1.** The plugin id matches `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`, at most 64 characters: lowercase letters and digits, words joined by single hyphens (`common.schema.json`'s `pluginId`). *The manifest guard.*
- **R2.** An outside plugin's id starts with a vendor prefix and a hyphen: `acme-tracks`, not `tracks`. All plugins of an installation share one flat namespace of ids. Reserved: the ids `emc2` and `emcc` and every id that starts with `emc2-` or `emcc-` (the product's; the schema refuses them), and `core` and every id that starts with `core-` (ECore's and the shell's own; ECore refuses them at load). `coreline` is allowed. *The manifest guard* (`manifestProblem`) checks all of them; the vendor prefix itself no check can, since the product's own plugins have none.
- **R3.** Every name a plugin owns follows from its id:

  | What | Form | Example for `acme-tracks` |
  |---|---|---|
  | Plugin folder | `<id>/`; ECore loads it only when the folder name equals the id | `acme-tracks/` |
  | Extension namespace | `extensions.<id>` | `extensions.acme-tracks` |
  | Data types, workspaces, relation kinds, channel kinds, topics | `<id>.<name>` | `acme-tracks.track` |
  | Field sets, symbol palettes | `<id>.<set id>` (the manifest gives the part after the dot) | `acme-tracks.unit` |
  | Web service keys it provides | `<id>.<name>`, or one of the SDK's own `emc2.<name>` keys | `acme-tracks.tracks` |
  | Own permissions | `plugin.<id>.<name>` | `plugin.acme-tracks.edit` |
  | Java package | `dev.emcc.plugins.<id without hyphens>` (`PluginRules.packageFor(id)`) | `dev.emcc.plugins.acmetracks` |
  | Maven artifact, npm package | `emc2-plugin-<id>`, `@emc2/plugin-<id>` | `@emc2/plugin-acme-tracks` |
  | CSS file, classes, custom properties | `<id>.css`, `<id>` or `<id>-…`, `--<id>-…` | `.acme-tracks-row` |
  | Panel ids | start with `<id>` | `acme-tracks` |

- **R4.** Never declare or provide a name in another plugin's namespace. ECore refuses a manifest whose relation kinds do not start with its own id; the shell refuses a plugin that provides a service key of another plugin's id (model rules 17 and 24).

## Threads and concurrency

See [workers.md](workers.md) and [ADR-0004](../../adr/0004-concurrency-workers-and-messages.md).

- **R5.** Never create threads, executors, thread pools, futures, `java.util.Timer`s or parallel streams. Ask ECore for workers, connection tasks, compute tasks and timers through the SDK. *PluginRules.*
- **R6.** Never use locks, monitors or blocking synchronizers: no `synchronized` (methods are checked, blocks are not and are still forbidden), nothing from `java.util.concurrent.locks`, no `Semaphore`, `CountDownLatch`, `CyclicBarrier`, `Phaser`, `Exchanger` or `BlockingQueue`. *PluginRules,* except `synchronized` blocks.
- **R7.** Never sleep or wait: no `Thread.sleep`, `Object.wait`, `Future.get` or `LockSupport.park`. A connection task or compute task waits only through its own `take()` or `poll(timeout)`.
- **R8.** A worker owns its state and handles one message at a time. State is never shared between workers: no non-final static fields, and static final fields hold immutable values only. *PluginRules.*
- **R9.** Messages are records or enums with immutable fields only (`List.copyOf`, `Bytes`). Never put SDK services (the context, the store, a `WorkerContext`) in a message. *PluginRules.*
- **R10.** Every request that waits for an answer has a timeout. Ask with `ctx.ask(…)` and handle `Ok`, `Failed` and `TimedOut`. Prefer events (send and forget). After a restart, tolerate answers to asks you no longer know.
- **R11.** A send never blocks. Choose each mailbox's capacity and overflow (`dropNewest`, `dropOldest`, `coalesceByKey`), and check `DROPPED` and `CLOSED` where it matters.
- **R12.** A handler never blocks and returns within its watchdog budget (5 s by default). `init` and `start` return within 5 s and do no I/O; a web part's `activate` returns within 10 s.
- **R13.** Long blocking I/O runs only in a connection task, never in a worker. Sockets, socket factories, NIO network channels and name lookups appear only in classes that implement `ConnectionTask` and their nested classes ([ADR-0036](../../adr/0036-connection-tasks.md)). *PluginRules.*
- **R14.** A connection task registers every socket with `closeOnStop`, returns when `take()` gives `null` or `stopping()` is true, and never sleeps: to retry, it ends the run and lets its `Restart` back off. A TCP server catches the cap's `IllegalStateException` on `startChild`, closes the new client and counts it.
- **R15.** CPU-heavy work that ends runs in a compute worker (`WorkerSpec…compute(true)`); a CPU-heavy loop runs in a compute task, declared in the manifest's `compute` ([ADR-0064](../../adr/0064-compute-tasks.md)). A compute task never uses the context, the store, documents, channels, streams, conversions, topics, timers, workers, connections, endpoints or outbound HTTP, and no class is both a `ComputeTask` and a `ConnectionTask`. *PluginRules.*
- **R16.** Never start processes, exit the JVM or add shutdown hooks. *PluginRules.*
- **R17.** Never use Java preview features.
- **R18.** Every package is `@NullMarked` (JSpecify). *PluginRules.*
- **R19.** A bundled library must not start threads, block or do its own networking or file I/O outside a connection task. You check this; `PluginRules` checks only your own classes.

## Objects and change requests

See [objects.md](objects.md) and [ADR-0005](../../adr/0005-change-events-single-writer.md).

- **R20.** Objects and layers change only through change requests: `context.store().submit(…)` (Java), `ctx.changes.submit(…)` (web). Never keep a copy and treat it as the truth.
- **R21.** Handle every outcome: `Applied`, `Rejected` and `Unknown` (Java); `applied`, `rejected` and `OutcomeUnknownError` (web). Show rejections to the user; never retry blindly.
- **R22.** An update replaces the core fields as a whole: send the complete core content of the latest state you have. An editor spreads the object's content (keeping `relations`), never rebuilds it from its own fields.
- **R23.** Every object you create carries a security label, a `dataType` from the available data types, and a `dataSource`: `manual` only for objects a user draws, otherwise the stream's configured name ([ADR-0023](../../adr/0023-data-types-and-data-sources.md)). `dataSource` never changes.
- **R24.** An object made from incoming data carries its external identity (`withExternalRef`), so the plugin finds it again after a restart.
- **R25.** Never mark a change `notSaved()`: it is reserved for the simulator plugin ([ADR-0041](../../adr/0041-unsaved-simulation-moves.md)).
- **R26.** A store query without a workspace filter returns every workspace. A server part that passes objects on (to an output, or to browsers through its endpoints) filters by workspace itself and keeps each workspace's data to the users allowed to see it ([ADR-0039](../../adr/0039-workspaces.md)).
- **R27.** Leave `locked` out of a layer update unless you mean to lock or unlock. An editor treats a locked layer's objects as read only and shows a `LAYER_LOCKED` rejection like any other ([ADR-0042](../../adr/0042-layer-lock.md)).
- **R28.** Never delete objects with a button of your own: the shell's shared Delete covers every selection. Provide Edit as an object action ([ADR-0032](../../adr/0032-selection-and-object-actions.md)).

## Permissions

See [permissions-and-labels.md](permissions-and-labels.md).

- **R29.** The server enforces permissions; the browser only hides what a user may not do. Never rely on the web part for protection.
- **R30.** An endpoint that changes something, or shows what not everyone may see, names its permission: `Endpoint.get(path).requires(permission)`; ECore answers `403` to others. Check `request.user().has(…)` when it needs more than one.
- **R31.** A command is a `POST` with a permission (or `checksUserItself()` with a check in the handler); `register` refuses a `POST` without one. Never change state on a `GET`.
- **R32.** An endpoint that changes objects or layers for a user requires `objects.edit` or `layers.edit` (or the workspace's edit permission). Prefer a change request from the browser, which the server checks.
- **R33.** A server part's changes act as the plugin, not as a user, and the store checks no permission for them. Check ids in a request body against your own objects, and take no host from it.
- **R34.** A service endpoint (`Endpoint.service`) has no authentication: decide by your settings what it serves.
- **R35.** Declare every permission you check in the manifest's `permissions`. Without a permission, a panel shows read only with a short hint; never hide it.

## Coordinates

- **R36.** Coordinates are WGS84 in longitude, latitude order, everywhere: code, JSON and storage ([ADR-0007](../../adr/0007-common-data-model.md)). Altitude is metres above the ellipsoid; distances are geodesic metres; bearings are degrees clockwise from true north.
- **R37.** Edges are the shorter geodesic between two positions ([ADR-0019](../../adr/0019-geodesic-edges.md)). Densify them when you draw; never split a geometry at the antimeridian. Compute with the SDK's `Geodesy`, never with GeographicLib directly. *PluginRules* (GeographicLib).
- **R38.** Every conversion is tested with a point where latitude ≠ longitude.

## Security labels

See [permissions-and-labels.md](permissions-and-labels.md) and [ADR-0020](../../adr/0020-object-and-layer-labels.md).

- **R39.** Every object, layer and stream has a security label: `defaultLabel()` unless your plugin has a reason for another.
- **R40.** An output link has the setting `highestClassification` and sends only what `context.classifications().within(label, limit)` allows. If `classifications().knows(limit)` is false, nothing passes; say so in your status. Count every skip ([ADR-0037](../../adr/0037-links-and-output-channels.md)).

## Extensions and other plugins' fields

See [objects.md](objects.md) and [ADR-0038](../../adr/0038-declared-plugin-fields.md).

- **R41.** Write only your own extension namespace. Forward every other namespace untouched.
- **R42.** Set another plugin's fields only when it declares them editable by others, by naming them in the change request (`withFields(…)` in Java, `changeRequests.withFields(…)` on the web), never by writing its namespace into the content. Check each value first (`DeclaredField.problem`).
- **R43.** Others may set your editable fields. Build your namespace from the current object on your own updates, keeping the values others set unless you mean to change them.

## Dependencies on the SDKs only

See [build-and-install.md](build-and-install.md) and [services-and-dependencies.md](services-and-dependencies.md).

- **R44.** The server part uses only the Java plugin SDK and permitted libraries: never Spring, ECore internals, another plugin's code, or the test kit in main code ([ADR-0002](../../adr/0002-spring-boot-at-edge-only.md), [ADR-0003](../../adr/0003-plugin-model.md)). *PluginRules.* The SDK and JSpecify are `provided`; never bundle them.
- **R45.** The web part imports the shared libraries (`react`, `react-dom`, `ol`, `milsymbol`, `proj4`, `@emc2/plugin-sdk`, `lucide-react`) as peer dependencies at the SDK's exact versions, and never bundles another copy.
- **R46.** Work with the map only through the `MapView` service, never through OpenLayers directly. Never change proj4's or milsymbol's global state. Ask the symbology service for tactical graphics, never mil-sym-ts.
- **R47.** Every service key you get with `ctx.services.get` is in `requires` or in `uses`, never both; every key you provide is in `provides`. Handle a missing `uses` service: `get` rejects at once.
- **R48.** `sdkVersion` is a caret range of the lowest SDK version whose additions you use (`^1.9.0` for a 1.9.0 addition), and accepts the SDK you build against.
- **R49.** When the SDK lacks something, do not work around it: report it and continue with what you can do.

## Offline and outside hosts

See [connections.md](connections.md) and [ADR-0030](../../adr/0030-offline-first-configurable-hosts.md).

- **R50.** Every function works without internet; for maps, that is Natural Earth.
- **R51.** The browser talks only to the emcc server. The web part loads nothing from the internet: no CDNs, remote fonts, scripts or styles, and no outside URL in `src`, `href`, CSS `url()`, `fetch`, `XMLHttpRequest`, WebSocket or imports. It fetches only `${ctx.serverBase}…` (your server part) and `${ctx.webBase}…` (your built files). A link the user follows is fine.
- **R52.** Only the server part reaches outside hosts: over the SDK's outbound HTTP, or over its own sockets in connection tasks. Never with its own HTTP client. *PluginRules.*
- **R53.** A host, port or multicast group comes from your settings (or a default in the manifest), never from a browser request, a message or an object's data.
- **R54.** Declare outbound HTTP in the manifest's `internet` (default hosts and reason; `"hosts": []` when an admin names them all) and own sockets in `connections`, which also cover their destinations, wherever an admin points them. Both are declarations, shown to admins; ECore does not check the hosts.
- **R55.** A link that listens binds to loopback unless an admin sets another address: read it with `ListenAddress.from(link)`. A multicast link names its `interface` (`ListenAddress.multicast(link)`).
- **R56.** Outbound HTTP follows no redirects. An unreachable host is normal: fail gracefully and report it in your status.
- **R57.** A WMS background's URL is your own endpoint. Your server part checks every parameter and builds its own request; it never forwards the browser's query ([ADR-0035](../../adr/0035-wms-background-maps.md)).

## Storage and local files

See [objects.md](objects.md) and [connections.md](connections.md).

- **R58.** Store your own state only through the SDK: plugin documents (`context.documents()`) on the server, `ctx.userDocuments` and `ctx.setup` for a user's data on the web ([ADR-0024](../../adr/0024-persistence-manager-postgresql-from-m2.md)). Browser storage holds only a small convenience for one browser.
- **R59.** Never do file I/O of your own (`Files`, `File`, file streams, `FileChannel`, `ZipFile`), in connection tasks neither. *PluginRules.*
- **R60.** Read local files only through a folder the manifest declares in `folders`: `context.folders().folder(id)` ([ADR-0049](../../adr/0049-terrain-analysis.md)). Paths are relative to the folder, with `/` between names. A library you use parses bytes you hand it, never a path.

## Licences of dependencies and exact versions

See [ADR-0016](../../adr/0016-project-and-dependency-licenses.md).

- **R61.** Pin every dependency to an exact version: no `^`, `~`, ranges, `LATEST` or `RELEASE`. (The manifest's `sdkVersion` is a range by design, R48.)
- **R62.** A library that ships in your plugin is MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, EPL-2.0, ISC, Zlib or CC0-1.0, or a combination of these. EPL-1.0 only as an unmodified binary. Where a library offers EPL or LGPL, use the EPL option, never LGPL. No GPL or other LGPL.
- **R63.** Build, lint and test tools that never ship may also be MPL-2.0, CC-BY-4.0, BlueOak-1.0.0, MIT-0 or PSF-2.0.
- **R64.** The copyright and licence texts of every library you ship go with your plugin.

## No secrets

- **R65.** No passwords, tokens or keys in source, tests, the manifest, settings defaults or logs.
- **R66.** A settings schema holds no secrets: settings reach every logged-in user's browser. Name credentials instead: `task.tls(name)` for TLS in a connection task ([ADR-0062](../../adr/0062-tls-credentials-for-connection-tasks.md)), `HttpCall.credential(name)` for a bearer token. The admin keeps them in the server's local configuration ([ADR-0060](../../adr/0060-settings-and-credentials-files.md)); never set an `Authorization` header yourself.

## Windows and Linux

- **R67.** The server part runs on Windows and Linux: no platform-specific code, paths or commands. Your build and test scripts work on both.

## The product name

- **R68.** Text a user sees says **emcc**, never emc2: labels, messages, status details, setting titles and descriptions. Internal names keep emc2: `@emc2/` packages, `dev.emcc.sdk`, `emc2.*` keys, `emc2-` classes and `--emc2-` tokens.

## Texts and settings

See [settings.md](settings.md) and [manifest.md](manifest.md).

- **R69.** Every setting has a `default`, except a picked layer and a link's `highestClassification`, which may be absent. The plugin works with only its defaults. No guard checks that every setting has one; ECore refuses defaults that do not validate against the schema.
- **R70.** Every setting the form shows has a `title` (1 to 64 characters) and a `description` (1 to 512), at every depth, inside a list's items too; every group in `x-emc2.groups` has a `description`. Exempt are the property an item's `id` names and the parts of a field with an `x-emc2` `kind`. *The manifest guard* (`settingsTextProblem`).
- **R71.** Every `x-emc2` hint has the documented shape: a condition names a sibling, a hint is at most 80 characters, a unit sits on a number. *The manifest guard* (`settingsHintsProblem`).
- **R72.** Validate a setting where you read it and report a bad value in your status. Apply changes without a restart (`context.subscribeSettings`, `ctx.onSettingsChange`).
- **R73.** Key what a list item makes (streams, tasks, external ids) by its stable `id` (`x-emc2.item.id`), never by its name.
- **R74.** Texts a user sees are short, plain English and name no internal tracking ids (task, change or decision numbers) and no version history.
- **R74a.** Code, comments, documentation and commit messages are in English.
- **R75.** A panel's `title` is shown once, by the shell: the panel has no inner heading that repeats it.

## The look: tokens and icons

See [panels-and-workspaces.md](panels-and-workspaces.md) and [ADR-0034](../../adr/0034-three-selectable-looks.md).

- **R76.** One CSS file, `<id>.css`, listed in the manifest's `web.css` and imported by the entry module. Every class is `<id>` or starts with `<id>-`; never style the shared components' `emc2-` classes. No element selectors at top level, no `:root`, no global CSS, no CSS-in-JS libraries, no `[data-look` selectors. *checkLookCss* (classes).
- **R77.** Colours, fonts, sizes, spacing, corner radii and shadows come only from the design tokens, `var(--emc2-…)` (`TOKENS` in the web SDK). These fail: a literal colour (hex, a colour function with literal values, a named or CSS system colour, also as a `var()` fallback); a length with a unit in `font`, `font-size`, `line-height`, `padding`, `margin`, `gap`, `height`, `min-height`, `max-height`, `border-radius` or `box-shadow` (longhands and logical variants too); a `font-family` that is not a token; a `var(--…)` that is neither a token nor your own `--<id>-…`; defining an `--emc2-` property; the alias tokens in `TOKEN_ALIASES` (`--shell-fg`, `--muted` and the others). *checkLookCss.*
- **R78.** These pass: `0`, percentages, `auto`, `inherit`, `transparent`, `currentColor`, unitless numbers, `calc()` and `color-mix()` of tokens, 1 px hairlines in `border`, `outline`, a `box-shadow` ring and a divider's `height`; your own custom property defined from tokens or measured at run time; the colours fixed in every look (the APP-6 affiliation colours, the selection highlight, objects' own style colours), named in `checkLookCss`'s `allow`. Not checked: `width`, border and outline widths, `font-weight`, keyword font sizes.
- **R79.** Inline styles follow R77 and R78. What you draw on a canvas takes its colours and fonts from `ctx.theme.tokens()` and redraws on `ctx.theme.onChange`. A plugin never chooses a look.
- **R80.** Every panel has an `icon` from Lucide (`lucide-react`). The manifest's `icon`, the plugin's icon in the Settings list, is a name from `PLUGIN_ICONS`; without one the shell shows its neutral icon. States are chips, an icon and a word, never a colour alone.
- **R81.** Build the UI from the SDK's shared components. A panel works in every pane, narrow and tall as well as wide and low. Check it in both densities and in a light and a dark look.

## Logging and status

See [monitor.md](monitor.md).

- **R82.** Log through the SDK: `context.log()` or `WorkerContext.log()` with `{}` placeholders (Java), `ctx.log` (web). `info` for life cycle and rare events, `debug` for per-message detail, `warn` for degraded operation, `error` for failures with the exception.
- **R83.** Never log secrets, tokens or whole objects with user data; log ids. Log a repeated skip at most once a minute per link, and count it.
- **R84.** Set your status: `OK` when ready, `DEGRADED` when you work in part, `FAILED` when you cannot work, always with a short English detail.
- **R85.** Handle expected errors where they happen (an HTTP status, a `Failed` reply, a notification). Let unexpected errors throw; never catch `Throwable` to keep going. `notify` is for what the user must know, not for logging.

## Tests

See [testing.md](testing.md).

- **R86.** Keep the template's guards as they are, with only their package renamed: `ArchitectureTest` (`PluginRules.checkPlugin`), `InstalledLayoutTest`, `InstalledPluginIT`, the web part's package-name test and the manifest guard (`web/test/manifest.test.ts`).
- **R87.** Every acceptance criterion has at least one test that names it.
- **R88.** Test the paths you rely on: rejected and unknown change outcomes, `Failed` and `TimedOut` replies, `503` and `504`, an endpoint called without its permission (`403`), settings changes, a restart that finds your objects again, a user without your permissions, a missing `uses` service.
- **R89.** A web part with CSS tests it with `checkLookCss(css, { pluginId })` and expects no findings.
- **R90.** Behaviour tests are deterministic: drive time and delivery with the fakes (`runUntilIdle`, `advance`), never with real waits.

## See also

- [for-agents.md](../for-agents.md): building a plugin with these rules, step by step
- [testing.md](testing.md): the test kits and the guards
- [manifest.md](manifest.md): every manifest field
- [docs/plugins/in-out/playbook.md](../in-out/playbook.md): an in/out plugin's work packages
- [The data model's rules](../../../model/README.md#rules-the-schema-cannot-express): what the object store checks
