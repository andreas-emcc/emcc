# Services and dependencies

Plugins never import each other. Their web parts work together through **services**: typed keys, each with an interface, that one plugin provides and others use. Their server parts start in the order the manifests' `dependsOn` gives. And a plugin adds to places other plugins own (a palette, a relation line, a data type, a workspace) by declaring it in its manifest, where the plugin that owns that place finds it.

## Server part (Java)

The server parts of two plugins share no Java types: each depends only on the SDK. They work together through the object store ([objects.md](objects.md)), declared fields that others may edit, and output channels that other plugins send to ([channels.md](channels.md)).

**`dependsOn`** lists plugin ids that must start before this one. ECore orders the start by it (and by the providers of the web keys a plugin `requires` or `uses`), ties broken by id, so the order is the same on every start. ECore does not start a plugin whose dependency is missing, did not start, or is part of a cycle, and records why. A plugin left out for a missing dependency or a cycle brings none of its data types, fields, workspaces, field sets or relation kinds either. In the browser, the shell does not load a web part whose dependency's web part it refused. A plugin with `"required": true` that does not start stops the application's start.

## Web part (TypeScript)

### Service keys

A `ServiceKey<T, C>` ([`services.ts`](../../../web/plugin-sdk/src/services.ts)) has an `id` and a cardinality: `'one'` (exactly one provider) or `'many'` (zero or more). The SDK defines these keys and their interfaces:

| Key | Id | Cardinality | Interface | Provided by |
|---|---|---|---|---|
| `MAP_VIEW` | `emc2.map-view` | one | `MapView` | `map-view-2d` |
| `BACKGROUND_MAP` | `emc2.background-map` | many | `BackgroundMapProvider` | `basemap-naturalearth`, `basemap-osm`, `basemap-wms` |
| `SYMBOLS` | `emc2.symbols` | one | `SymbolService` | `symbology` |
| `COORDINATES` | `emc2.coordinates` | one | `CoordinateService` | `coordinates` |
| `OBJECT_LIST` | `emc2.object-list` | one | `ObjectListService` (`open(layerId)`) | `object-list` |

[map.md](map.md) describes the first four.

### Offering a service

1. List the key's id in the manifest's `provides`.
2. In `activate`, call `ctx.services.provide(key, implementation)`. It returns an `Unsubscribe` that removes this implementation again.

A `one` key has one provider: the shell refuses a second. A `many` key may be provided several times, also by one plugin (e.g. one background per configured server), each call with its own `Unsubscribe`. A provided service becomes visible when its provider's `activate` has finished; a provider that fails takes its services with it. Never remove a `one` key's implementation: plugins that already got it keep it.

### Using a service

1. List the key in the manifest's `requires` or `uses`, never in both:
   - **`requires`:** the plugin cannot work without it. The shell activates the provider first, and does not load the plugin when no loaded plugin provides the key (it says why).
   - **`uses`:** the plugin works without it. The shell activates a loaded provider first, reports a missing one, and always loads the plugin.
2. Get it:
   - `ctx.services.get(key)` for a `one` key resolves when the provider has activated, and rejects when it failed or is disabled. For a `uses` key it rejects at once when no loaded plugin provides it.
   - `ctx.services.getAll(key)` for a `many` key gives a `ServiceList`: `current` (the providers now, in load order) and `onChange(listener)`.

```ts
// plugin.json: "uses": ["emc2.map-view", "emc2.symbols"], "provides": ["acme-tracks.tracks"]
const symbols = await ctx.services.get(SYMBOLS).catch(() => null);    // works without it
const backgrounds = ctx.services.getAll(BACKGROUND_MAP);
backgrounds.onChange((list) => offer(list.map((b) => b.name)));
```

Do not wait for a service in `activate` when the rest of the plugin works without it: register panels and actions first, and use the service when its promise resolves.

### A key of your own

A plugin may define service keys in its own namespace, `<plugin-id>.<name>`, with `serviceKey`:

```ts
interface TrackService { readonly count: () => number }
export const TRACKS = serviceKey<TrackService>('acme-tracks.tracks', 'one');
ctx.services.provide(TRACKS, { count: () => tracks.size });
```

- Only the plugin with that id provides it: the shell refuses a plugin that lists in `provides` a key of another plugin's id. `requires` and `uses` may name any key.
- `serviceKey` throws for an id that is not `<plugin-id>.<name>` (lowercase words with hyphens, at most 128 characters) and for any `emc2.*` id: those keys are the SDK's own. `serviceKeyOwner(id)` gives the plugin id a key belongs to (`emc2` for the SDK's).
- **The interface:** the providing plugin documents it in its README, and a using plugin declares the same TypeScript interface in its own code and makes its own `serviceKey` with the same id and cardinality. Plugins never import each other.
- The provider changes the interface compatibly only, by adding optional members. An incompatible change is a new key, e.g. `acme-tracks.tracks-2`; the provider may provide both for a while.

### What a plugin cannot do

- Import another plugin's code, or depend on anything but the SDKs and the shared libraries.
- Provide a key that is not in its manifest's `provides`, a key of another plugin's id, or a second provider of a `one` key.
- Make an `emc2.*` key: the SDK defines those, and a new one comes only with a new SDK version.

### Places other plugins can add to

A plugin adds to these by declaring them in its manifest; the plugin that owns the place reads them from the context. Each declaration is in the declaring plugin's namespace (`<plugin-id>.<name>`), and no plugin writes another's.

| Manifest field | Where it appears | Read through |
|---|---|---|
| `symbolPalettes` | The Symbols panel's drop-down of `draw-symbols` (at most 8 palettes per plugin, 2 000 symbols each; declared only, no runtime API) | `ctx.symbolPalettes` |
| `relationKinds` | Lines the map view draws between related objects, and a switch per kind in the display settings ([map.md](map.md)) | `ctx.relationKinds`, `ctx.relationLines` |
| `dataTypes` | Every editor's data type choice, the Settings' data type behaviour, action scopes; with its `fieldSets`, `manual` and `sensorReport` | `ctx.dataTypes`; Java `context.dataTypes()` |
| `fields` (with `editableByOthers`) | The shared `DeclaredFields` editor in every plugin's dialogs; other plugins set them by naming them in a change request | `ctx.declaredFields` |
| `fieldSets` | The field-set editor's choice of sets | `ctx.fieldSets` |
| `workspaces` | A tab next to View; other plugins' panels and actions may name it in their `workspaces` | `ctx.workspaces` |
| `channelKinds` | Item kinds that other plugins send to this plugin's output channels ([channels.md](channels.md)) | Java `Channels` |

At run time a plugin also adds to:
- the map's backgrounds, by providing `BACKGROUND_MAP`;
- the right-click menus, with actions on any plugin's objects ([actions.md](actions.md));
- the panes, the map's corners and the top bar ([panels-and-workspaces.md](panels-and-workspaces.md)).

## In the manifest

- [`provides`, `requires`, `uses`](manifest.md#dependencies-and-services): service key ids; `emc2.<name>` or `<plugin-id>.<name>`, at most 128 characters.
- [`dependsOn`](manifest.md#dependson): plugin ids that start first.
- [`required`](manifest.md#required): the application does not start without this plugin.
- The fields in the table above.

## Rules

- Plugins never import each other; they depend only on the plugin SDKs ([ADR-0003](../../adr/0003-plugin-model.md)).
- Provide only keys listed in `provides`, and only `emc2.*` keys or keys of your own id.
- Get only keys listed in `requires` or `uses`; a key is never in both. The shell notes in the browser's console a key got without either.
- Handle a rejected `get`: for a `uses` key the plugin works on without the service.
- Never remove a `one` key's implementation.
- Change a key's interface compatibly only; an incompatible change is a new key.
- No cycles: ECore and the shell refuse the plugins on a cycle across `dependsOn`, `requires` and `uses`.
- A declaration in the manifest carries the plugin's own id as its prefix (`<plugin-id>.<name>`).

## Testing

```ts
const ctx = createFakeContext({ pluginId: 'acme-tracks', provides: ['acme-tracks.tracks'], uses: ['emc2.symbols'] });
ctx.provideAs(MAP_VIEW, createFakeMapView());          // as another plugin would
await plugin.activate(ctx);
// SYMBOLS is in `uses` and nothing provides it: get rejects at once, and the plugin must cope
```

- `provides`: with it, `services.provide` refuses every other key.
- `uses`: `services.get` on such a key rejects at once while nothing provides it. Leave the key out to test a provider that activates later.
- `provideAs(key, implementation)` provides a service as another plugin would, and returns an `Unsubscribe`.
- Fake services: `createFakeMapView`, `createFakeSymbolService`, `createFakeCoordinateService`, `createFakeObjectListService`, `createFakeVectorBackground` ([testing.md](testing.md)).

## See also

- [map.md](map.md): the map view, background, symbol and coordinate services
- [manifest.md](manifest.md): every manifest field
- [build-and-install.md](build-and-install.md): the shared libraries
- [ADR-0003](../../adr/0003-plugin-model.md), [ADR-0008](../../adr/0008-web-client-typescript-react.md)
