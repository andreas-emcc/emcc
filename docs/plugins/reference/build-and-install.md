# Build and install

How a plugin is laid out, how its server part and its web part are built, what the built plugin looks like, how it is installed, and when ECore and the shell call it. Start from the template, `plugins/_template/`, which follows all of this and is built and tested like a real plugin.

## The plugin's folders

```
<id>/
├── plugin.json        the manifest (source); the web build writes the built one
├── README.md
├── server/            optional: the server part, a Maven module emc2-plugin-<id>
│   ├── pom.xml
│   └── src/main/java/dev/emcc/plugins/<id without hyphens>/…
└── web/               optional: the web part, an npm package
    ├── package.json, tsconfig.json, vite.config.ts, eslint.config.js
    ├── src/index.tsx  the entry module
    └── test/
```

A plugin has a server part, a web part or both; the manifest names each one it has (`server.entryClass`, `web.entry`). The folder's name is the plugin's id. The id is also the plugin's extension namespace and the first part of every name it owns: data types, topics, fields, permissions, service keys, CSS classes. See [manifest.md](manifest.md) for the id and every field.

## Server part (Java)

**The parent POM.** A server part's parent is `dev.emcc:emc2-plugin-parent` ([`server/plugin-sdk/plugin-parent/pom.xml`](../../../server/plugin-sdk/plugin-parent/pom.xml)). It stands alone (it has no parent of its own) and its version is the SDK's. It:

- manages the SDK (`emc2-plugin-sdk`), the test kit (`emc2-plugin-sdk-testkit`), JSpecify, JUnit, AssertJ, ArchUnit and SLF4J at exact versions;
- pins every Maven build plugin and sets `maven.compiler.release` to 25, with `-Xlint:all`;
- enforces JDK 25, Maven 3.9 or later, a pinned version for every build plugin, and converging dependencies.

A plugin's POM names the parent by its coordinates, as [`plugins/_template/server/pom.xml`](../../../plugins/_template/server/pom.xml) does:

```xml
<parent>
  <groupId>dev.emcc</groupId>
  <artifactId>emc2-plugin-parent</artifactId>
  <version>1.9.0</version>
  <relativePath>../../../server/plugin-sdk/plugin-parent/pom.xml</relativePath>
</parent>
<artifactId>emc2-plugin-<id></artifactId>
<version>0.1.0-SNAPSHOT</version>   <!-- the plugin's own version, as in plugin.json -->
```

Inside this repository the `relativePath` finds the parent. Outside it, Maven does not find that path and takes the parent from the local Maven repository, where the SDK kit installs it with the SDK and test kit jars. The same POM builds in both places.

**Dependencies.** The SDK and JSpecify are `provided`: ECore supplies them at run time, and the jar never bundles them. The test kit, JUnit Jupiter and AssertJ are `test`. A library the plugin bundles is pinned in the plugin's own POM; its licence must be allowed ([rules.md](rules.md)).

**Build.** `mvn verify` in `server/` compiles, runs the tests and packages `target/emc2-plugin-<id>-<version>.jar`. The template's POM adds a second Surefire run in the `integration-test` phase for `*IT.java`, with the system property `emc2.plugin.jar` set to the packaged jar: `InstalledPluginIT` loads that jar as the plugin host does. `mvn test` does not run it. Inside this repository, the module is also registered with one line in `server/pom.xml`: `<module>../plugins/<id>/server</module>`.

**The class loader.** ECore loads each plugin in its own class loader, which sees the Java platform, the SDK, JSpecify and the plugin's own jars, nothing else. The release's Java runtime is made with `jlink` and holds only the modules the server needs (among them `java.base` and `java.net.http`); use only the modules it holds. The class loader separation avoids dependency conflicts; it is not a sandbox. A plugin is trusted code.

## Web part (TypeScript)

**The package.** Inside this repository the web part is an npm workspace named `@emc2/plugin-<id>`: the root `package.json` takes every `plugins/*/web` as a workspace, npm refuses two workspaces with the same name, and the template's web test checks the name. The build and the shell never read the package name (the build reads the manifest, the shell loads by plugin id), so a plugin built outside this repository may name its package as it likes; change that test to match.

**Shared libraries.** The shell provides these to every web part through its import map, at exact versions (`SHARED_LIBRARIES` in [`version.ts`](../../../web/plugin-sdk/src/version.ts)): `react` and `react-dom` 19.3.0, `ol` 10.10.0, `milsymbol` 3.0.4, `proj4` 2.22.0, `lucide-react` 1.49.0 and `@emc2/plugin-sdk` 1.9.0. A web part lists the ones it uses as `peerDependencies` at those versions, and never bundles another copy.

**The build plugin.** `emc2Plugin({ manifest, importMap })` from `@emc2/plugin-sdk/build` ([`build/index.ts`](../../../web/plugin-sdk/src/build/index.ts)) gives two Vite plugins:

- every import of a shared library stays external; an import of a shared module that the shell's import map lacks fails the build, naming the module. CSS is never shared;
- the manifest is written to `dist/plugin.json` with `web.shared` filled in: the shared libraries the plugin actually imports, at the SDK's versions. Never write `web.shared` by hand.

```ts
// vite.config.ts, as in the template
export default defineConfig(({ command }) => ({
  plugins: command === 'build' ? emc2Plugin({ manifest, importMap }) : [],
  build: {
    lib: { entry: 'src/index.tsx', formats: ['es'], fileName: 'index', cssFileName: manifest.id },
    cssCodeSplit: false,
    outDir: 'dist',
    emptyOutDir: true,
  },
}));
```

`importMap` is the shell's import map: in this repository `web/shell/dist/importmap.json`, so the shell is built first (`npm run build --workspaces` at the root does that); outside it, the copy that comes with the SDK kit. `@emc2/plugin-sdk/build` and `@emc2/plugin-sdk/testing` are not in the import map: import them only from `vite.config.ts` and tests, never from `src/`.

**Build and test.** The template's scripts: `build` is `tsc --noEmit -p . && vite build`; `test` is `eslint . && tsc --noEmit -p . && vitest run`. The build writes `dist/index.js` (the entry module), `dist/<id>.css` (the one style sheet, named after the id and listed in the manifest's `web.css`) and `dist/plugin.json`.

**What the shell checks.** It refuses a web part whose `sdkVersion` its SDK does not satisfy, or a shared library in `web.shared` it does not have or whose version is not compatible: the shell's version must have the same major version and be at least as new as the one the plugin was built against (`compatibleShared`). The SDK itself is checked by `sdkVersion` only.

## The packaged plugin

This is what ECore and the shell read, one folder per plugin:

| Installed | Comes from | Notes |
|---|---|---|
| `<id>/plugin.json` | `web/dist/plugin.json` if there is a web part, otherwise `plugin.json` | The built one carries `web.shared` |
| `<id>/server/*.jar` | `server/target/emc2-plugin-<id>-<version>.jar`, plus the jars of bundled libraries | Not `*-sources.jar`, `*-tests.jar` or `original-*.jar`. Never the SDK or JSpecify |
| `<id>/web/` | everything else in `web/dist/` | The entry module and CSS the manifest names, plus assets |

A library shaded into the plugin's jar needs nothing more: `InstalledPluginIT` loads it from the jar. Library jars beside the plugin's jar are not covered by that test; extend it to copy them too.

## Installing

1. Copy the packaged `<id>/` folder into the server's plugins folder: `plugins/` in a release, or the folder the server setting `emc2.plugins.directory` names (default `plugins`, relative to the working directory).
2. Restart the server. ECore reads the plugins only at start; it never loads or unloads one while it runs.

At start ECore reads every `<id>/plugin.json`, skips folders whose names start with `_` or `.`, and checks each manifest: the schema, the folder name equals the id, `sdkVersion` accepts the SDK it implements, the dependencies are present and have no cycles, the data types, fields, field sets and relation kinds are the plugin's own, and the settings defaults match the settings schema. It orders the plugins by their dependencies ([services-and-dependencies.md](services-and-dependencies.md)) and starts each server part. A plugin that is refused or fails to start is disabled with the reason, and so is every plugin that depends on it; the others run. If a plugin marked as required fails, the server does not start. The Monitor shows each plugin's state ([monitor.md](monitor.md)).

After installing, an admin maps the plugin's own permissions to roles ([permissions-and-labels.md](permissions-and-labels.md)) and sets its settings ([settings.md](settings.md)).

## The life cycle

**Server part.** The entry class (`server.entryClass`) implements [`Plugin`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/Plugin.java) and has a public no-argument constructor. ECore calls each method once, in this order, from one thread, under a budget of 5 s each:

| Call | Does |
|---|---|
| `init(PluginContext context)` | Creates workers, registers endpoints and subscriptions. No I/O yet. May keep `context` |
| `start()` | Begins the work: starts timers, sends first requests |
| `stop()` | Cancels timers and subscriptions. ECore then stops the plugin's workers, in reverse order, and its tasks |

A call that throws or exceeds its budget fails the start, and the plugin is disabled. No I/O and no waiting in any of them: all work happens in workers ([workers.md](workers.md)). At shutdown ECore stops the plugins in reverse start order. An entry class may also implement a capability interface from `dev.emcc.sdk.capability` (`Temporal`) when its manifest declares it.

```java
public final class TemplatePlugin implements Plugin {
  private @Nullable PluginContext context;

  @Override
  public void init(PluginContext context) {
    this.context = context;
    WorkerRef<GreeterMsg> greeter = context.workers().spawn(
        WorkerSpec.of("greeter", GreeterMsg.class, () -> new Greeter(context.settings().getString("greeting"))));
    context.endpoints().register(Endpoint.get("/greeting"), greeter, GreeterMsg.Greet::new);
  }

  @Override public void start() {}
  @Override public void stop() {}
}
```

**Web part.** The entry module's default export is `definePlugin({ activate(ctx) { … } })` ([`context.ts`](../../../web/plugin-sdk/src/context.ts)). The shell loads the style sheets the manifest names, imports the entry module from `ctx.webBase`, and calls `activate(ctx)` once per page, with a 10 s timeout. `activate` may be async; it registers panels, services and actions and returns quickly. There is no deactivate: the web part lives as long as the page. A web part that implements a declared capability passes it as `capabilities` beside `activate`.

```tsx
export default definePlugin({
  activate(ctx) {
    ctx.ui.addPanel({ id: '<id>', title: 'Greeting', icon: Puzzle, defaultPane: 'right', component: GreetingPanel });
    ctx.status.set('OK', 'ready');
  },
});
```

## Rules

- The folder name, the manifest's `id` and the Maven artifact `emc2-plugin-<id>` must match; the entry class lives in `dev.emcc.plugins.<id without hyphens>`.
- The server part's parent must be `dev.emcc:emc2-plugin-parent`; pin every other version exactly in the plugin's own POM or `package.json`.
- Never bundle the SDK, JSpecify or a shared web library; never write `web.shared` by hand.
- `sdkVersion` must accept the SDK the plugin is built against (`^1.9.0` for a plugin that uses anything of 1.9.0).
- `init`, `start`, `stop` and `activate` must return quickly and never do I/O or wait.
- Install only by copying the packaged folder and restarting the server.

## Testing

The template's tests that every plugin keeps (details in [testing.md](testing.md)):

- `InstalledLayoutTest`: the folder is named like the id, the artifact is `emc2-plugin-<id>`, the entry class is a public `Plugin` with a public no-argument constructor in the right package, `sdkVersion` accepts `Sdk.VERSION`, every setting has a default.
- `InstalledPluginIT` (`mvn verify`): copies the packaged jar into `<id>/server/`, loads it in a class loader like the host's, checks that it holds the entry class and no SDK or JSpecify classes, and calls an endpoint.
- The web part's `test/manifest.test.ts` (`manifestProblem`, `settingsTextProblem`, `settingsHintsProblem`) and `test/plugin.test.tsx` (`createFakeContext`, then `plugin.activate(ctx)`).

## See also

- [manifest.md](manifest.md), [testing.md](testing.md), [rules.md](rules.md), [for-agents.md](../for-agents.md)
- [services-and-dependencies.md](services-and-dependencies.md) for the start order
- [ADR-0003](../../adr/0003-plugin-model.md) (the plugin model), [ADR-0016](../../adr/0016-project-and-dependency-licenses.md) (licences)
