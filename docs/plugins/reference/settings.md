# Settings

A plugin's settings are one JSON object, declared as a JSON Schema in the manifest's `settings`. Users with `settings.admin` change them at run time in the plugin's entry of the Settings workspace; ECore validates the values against the schema, stores them and gives them to both parts of the plugin, which apply them without a restart. The Settings workspace shows a form generated from the schema; a plugin whose settings need more shows its own panel instead.

## Server part (Java)

`PluginContext` ([`PluginContext.java`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/PluginContext.java)):

| Call | What it gives |
|---|---|
| `settings()` | The **current** settings as a `JsonObject`: the configured values, validated, with the schema's defaults for what is not configured. An immutable snapshot; call it again for the values valid now. |
| `subscribeSettings(target, toMessage)` | After each accepted change, the complete new settings to the worker `target`, converted by `toMessage` (pure and non-blocking, run in that worker). Always delivered, whatever the mailbox's overflow policy; when several are undelivered, only the latest is kept. Returns a `Cancellable`. |

The plugin is not restarted. It applies a change itself, e.g. by stopping the connection tasks of removed links and starting those of new ones.

Settings are JSON values ([`dev.emcc.sdk.json`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/json/JsonObject.java)): `JsonValue` is one of `JsonObject`, `JsonArray`, `JsonString`, `JsonNumber`, `JsonBoolean` and `JsonNull`. `JsonObject` has `get(name)` (or `null`), `has`, and `getString`, `getNumber`, `getBoolean`, `getObject`, which fail when the member is missing or of another type. `JsonNumber` keeps the exact text and gives `bigDecimalValue()`, `doubleValue()` and `longValueExact()`. A picked layer reads with `LayerChoice.from(value)` or `LayerChoice.list(value)`.

```java
public void init(PluginContext context) {
  feed = context.workers().spawn(WorkerSpec.of("feed", FeedMsg.class, FeedWorker::new));
  context.subscribeSettings(feed, FeedMsg.SettingsChanged::new);
}

// in FeedWorker, on FeedMsg.SettingsChanged(JsonObject settings):
String greeting = settings.getString("greeting");
long idle = settings.getNumber("idleSeconds").longValueExact();
```

## Web part (TypeScript)

`ctx.settings` ([`context.ts`](../../../web/plugin-sdk/src/context.ts)) is the plugin's current settings, a `Settings` object (`{ [name]: JsonValue }`). It is replaced as a whole after each accepted change, and `ctx.onSettingsChange(listener)` is called with the complete new settings; it returns an `Unsubscribe`.

```ts
const read = (s: Settings) => (typeof s['greeting'] === 'string' ? s['greeting'] : '');
let greeting = read(ctx.settings);
ctx.onSettingsChange((s) => { greeting = read(s); redraw(); });
```

### The generated form

The Settings workspace builds the plugin's form from its schema: each property's `title`, `description`, type, `enum` and `default`, and the `x-emc2` annotations (the hints): groups, a hint line, field width and unit, tables of items with a side form, conditions that hide a field, and the layer, colour and TLS credential pickers. The hints are annotations only: they never change validation, and a schema without them still gets a form. The schema and every hint are in [manifest.md](manifest.md#settings) and its [hints section](manifest.md#settings-hints). [`settings-form.ts`](../../../web/plugin-sdk/src/settings-form.ts) holds the rules the shell uses to read them, as functions (`fieldHint`, `fieldWidth`, `formSections`, `itemColumns`, `itemName`, `itemId`), and `settingsHintsProblem(schema)`, which finds the first wrong `x-emc2` annotation.

### The texts rule

Every setting explains itself. `settingsTextProblem(schema)` returns the first one that does not, as `"<JSON pointer>: <problem>"`, or `null`:
- every property the form shows has a `title` of 1 to 64 characters (`TITLE_MAX`) and a `description` of 1 to 512 (`DESCRIPTION_MAX`), at every depth, inside an array's `items` too;
- every group in `x-emc2.groups` has a `description`;
- exempt are the property an `item.id` names (the form never shows it) and the properties inside a field with an `x-emc2` `kind` (a picked layer's `id` and `name`), which the form draws as one field.

It is a build rule: the template's manifest test calls it, so each plugin's build checks it. ECore and the shell do not; a plugin without the texts still loads, and the form shows the property's key.

### The plugin's own settings panel

When the generated form cannot do the job, e.g. lists of layers fetched from a server, the plugin shows its own panel in its Settings entry instead:

```ts
const off = ctx.ui.setSettingsPanel({ component: MySettingsPanel });   // off() brings the form back
```

- A second call replaces the first. The shell shows the panel only to users with `settings.admin`, in its own frame, and keeps it mounted while the page lives, so unsaved values survive switching entries.
- The panel gets `SettingsPanelProps`: `values` (the saved settings), `save(values)` and `markUnsaved(unsaved)`.
- `save` saves the **whole** settings. ECore validates them and checks `settings.admin`; the answer is `{ ok: true, values }` or `{ ok: false, problems }`, each problem a `path` (a JSON Pointer) and a `problem` text, to show at its field. `save` rejects only on a transport failure or a refused permission.
- Another admin's save arrives as new `values`, also while the panel has unsaved changes. Then do as the form does: keep the edits, say that someone else changed the settings, and offer "Take their values".
- Data from the plugin's own server part comes from its own endpoints under `ctx.serverBase`, which require `settings.admin` ([connections.md](connections.md)).

The schema still defines, validates and defaults the settings.

### No secrets in settings

A plugin's settings reach **every logged-in user's browser** (`ctx.settings`). A settings schema never holds a password, token, key or certificate. Secrets live in the server's local configuration, outside the settings, and a setting names them only.

### The TLS credential field

A string setting with `"x-emc2": { "kind": "tls-credential" }` (without `enum` or `pattern`) names one of the TLS credentials in the server's local configuration. The form lists the names ECore has; an empty value means the credential named like the link. The server part passes the name to `TaskContext.tls(name)` or `sslContext(name)` in a connection task and never sees the key material ([connections.md](connections.md), [ADR-0062](../../adr/0062-tls-credentials-for-connection-tasks.md)).

## In the manifest

- [`settings`](manifest.md#settings): the JSON Schema (draft 2020-12) of an object, with a default for every setting.
- Other fields point into the settings with a JSON Pointer: `connections[].settings` (the links), `folders[].setting` (a folder's path), `dataTypes[].fadeSetting` (a stepped fade, [map.md](map.md)) and `relationKinds[].line.strokeColorSetting` (a line's colour).

## Rules

- Every setting has a `default`, so the plugin works with its defaults alone. Two kinds may have none, since a manifest cannot know them: a picked layer (absent means none picked) and a link's highest classification (absent means the server's default label).
- Every setting has a `title` and a `description`, and every group a `description` (the texts rule; [ADR-0060](../../adr/0060-settings-and-credentials-files.md)).
- Never put a secret in the settings: they reach every browser. Name a TLS credential instead.
- A host, port, path or URL a plugin connects to or reads comes from its settings, which only an admin sets, never from a browser request, a message or an object's data ([ADR-0030](../../adr/0030-offline-first-configurable-hosts.md)).
- Apply a change without a restart: `subscribeSettings` on the server, `onSettingsChange` in the browser.
- Validate a value where you read it and report a bad one in the plugin's status ([monitor.md](monitor.md)). Ignore the value of a field its condition hides: the form keeps it, and validation does not change.
- Use an own settings panel only when the form cannot do the job; it saves the whole settings.

## Testing

Java ([`FakePluginContext`](../../../server/plugin-sdk/testkit/src/main/java/dev/emcc/sdk/testkit/FakePluginContext.java)):

```java
var settings = (JsonObject) TestJson.parse("{\"greeting\":\"Hi\",\"idleSeconds\":120}");
var ctx = FakePluginContext.builder("my-plugin").settings(settings).build();
plugin.init(ctx);
plugin.start();
ctx.changeSettings(settings.with("greeting", JsonString.of("Hello")));   // settings() and every subscriber
ctx.runUntilIdle();
```

Web ([`testing`](../../../web/plugin-sdk/src/testing/index.ts)):

```ts
const ctx = createFakeContext({ pluginId: 'my-plugin', settings: { greeting: 'Hi' } });
await plugin.activate(ctx);
ctx.changeSettings({ greeting: 'Hello' });            // ctx.settings and every onSettingsChange listener
render(<ctx.settingsPanel!.component {...ctx.settingsPanelProps()} />);   // the own panel, if any
```

- `settingsPanel`, `settingsPanelProps()`, `settingsSaves` and `settingsPanelUnsaved` drive and check an own panel; the `saveSettings` option sets ECore's answer, and `save` rejects for a user without `settings.admin`.
- The manifest guard, kept from the template: `manifestProblem(manifest)` from `@emc2/plugin-sdk/build`, `settingsTextProblem(manifest.settings)` and `settingsHintsProblem(manifest.settings)` each expect `null` ([testing.md](testing.md)).

## See also

- [manifest.md](manifest.md#settings): the schema and every hint
- [connections.md](connections.md): links from settings, TLS credentials
- [monitor.md](monitor.md): reporting a bad value
- [panels-and-workspaces.md](panels-and-workspaces.md): the shell's panels
