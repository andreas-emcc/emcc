# Actions

Actions are the entries of the shell's right-click menu. An **object action** acts on chosen objects: on the map and on the rows of the objects panel. A **map action** acts on a position on empty map. A plugin registers its actions once, in `activate`; the shell keeps the lists, filters them for the objects, the user and the workspace, shows its menu and calls the handler. Use an action for your plugin's Edit and for anything else a user starts from an object or a place on the map.

## Web part (TypeScript)

`ctx.actions` ([`actions.ts`](../../../web/plugin-sdk/src/actions.ts)) has three calls:

| Call | What it does |
|---|---|
| `addObjectAction(action)` | Adds an `ObjectAction`; the returned `Unsubscribe` removes it. |
| `addMapAction(action)` | Adds a `MapAction`; the same. |
| `openMenu(at, target)` | Opens the shell's menu at a page point (`clientX`, `clientY`). The map view and the objects panel call it on a right click; a plugin that lists objects calls it too. |

### An object action

| Field | Meaning |
|---|---|
| `id` | Unique within the plugin. |
| `label`, `icon?` | The menu entry's text and its Lucide icon. |
| `group?` | Actions of one group stand together, groups apart by a separator. The order is `view`, `edit`, every other group by name, and `delete` last (`ACTION_GROUPS`). Default `other`. |
| `order?` | Lower comes first within the group; default 100. |
| `appliesTo` | An `ActionScope`: `types` (object types, e.g. `core.symbol`), `dataTypes` (e.g. `cot.cot`) and `test(object)`. Every given criterion must hold for every chosen object; with none, the action applies to every object. |
| `multiple` | `false`: offered only for exactly one object, never for a selection of several. |
| `permission?` | Offered only to users with this permission. |
| `workspaces?` | The workspaces it appears in; `'*'` for every one. Default `['core.view']`. |
| `run(ids)` | Receives the ids of the chosen objects; may return a promise. |

The scope is free: an action may apply to **objects of other plugins**, by their object type or their data type. For example, a camera plugin adds "New camera" to every `core.symbol`, whoever made it. What the action may then change in such an object is limited as for any change request ([objects.md](objects.md)).

### A map action

A `MapAction` has `id`, `label`, `icon?`, `group?`, `order?`, `permission?`, `workspaces?` and `run(position)`. The position is the right-clicked point, `[longitude, latitude]`. The shell offers map actions on empty map and on a cluster.

```ts
import { Pencil, Crosshair } from 'lucide-react';

ctx.actions.addObjectAction({
  id: 'edit', label: 'Edit', icon: Pencil, group: 'edit',
  appliesTo: { types: ['core.symbol'], dataTypes: ['my-plugin.track'] },
  multiple: false, permission: PERMISSIONS.objectsEdit,
  run: ([id]) => { if (id !== undefined) editor.open(id); },
});
ctx.actions.addMapAction({
  id: 'mark-here', label: 'Mark here', icon: Crosshair,
  permission: 'plugin.my-plugin.mark',
  run: (position) => marker.place(position),   // [lon, lat]
});
```

### How an action runs

1. The user right-clicks an object, a selection, an overlap of objects or empty map. The map view (or the objects panel) calls `ctx.actions.openMenu(at, target)` with one of these targets (`MenuTarget`):
   - `{ objects }`: the object actions for these objects, e.g. the whole selection;
   - `{ position }`: the map actions for a position;
   - `{ choose }`: several objects overlap. The menu first lets the user pick one; the shell then sets the selection to it and shows its object actions.
2. The shell picks the actions to offer. For objects it uses `applicableObjectActions(actions, objects, may)`: the action's scope holds for every object, the user has its `permission`, and for several objects only actions with `multiple: true`. For a position, `applicableMapActions(actions, may)` checks the permission. Both sort the result by group and `order`. The shell also keeps only actions whose `workspaces` include the workspace shown (`appearsIn`).
3. The user chooses an entry, and the shell calls `run` with the objects' ids or the position. The handler fetches what it needs, e.g. `ctx.objects.get(ids)`, and opens its panel (`PanelHandle.show()`) or sends change requests.
4. A handler that throws or rejects is logged, and the shell shows it as an error.

While the map view runs an interaction (placing, drawing, editing, a grabbed drag), a right click opens no menu ([map.md](map.md)).

**Delete is the shell's.** The shell's shared Delete (in the menu and on the Delete key, with one confirmation) deletes any selection. A plugin adds no Delete action of its own for objects. The shell's own change requests carry `source.plugin` `core-shell` (`SHELL_SOURCE_PLUGIN`).

## In the manifest

Actions are registered in code, not declared. The manifest holds what they refer to:
- [`permissions`](manifest.md#permissions): the plugin's own permissions (`plugin.<id>.<name>`) that its actions name;
- [`workspaces`](manifest.md#workspaces): the plugin's own workspaces that its actions may appear in;
- [`dataTypes`](manifest.md#datatypes): the data types an action's scope may name.

## Rules

- An action changes objects only through change requests. The menu only starts it ([ADR-0005](../../adr/0005-change-events-single-writer.md)).
- `permission` only hides the entry. The server checks every change request anyway; show a `PERMISSION_DENIED` rejection as any other ([permissions-and-labels.md](permissions-and-labels.md)).
- Never add a Delete of your own for objects; the shell's shared Delete deletes them.
- Keep `appliesTo.test` cheap: the shell calls it for every chosen object each time it builds the menu.
- In another plugin's object, write only your own extension namespace and the fields that plugin declares as editable by others ([objects.md](objects.md)).
- Do not select on map clicks yourself: the map view selects. Follow `MapView.selection` ([ADR-0032](../../adr/0032-selection-and-object-actions.md)).

## Testing

The fake context records the actions and runs them as the shell's menu would ([testing.md](testing.md)):

```ts
const ctx = createFakeContext({ pluginId: 'my-plugin', user: createFakeUser({ permissions: ['objects.edit'] }) });
await plugin.activate(ctx);
ctx.setServerObjects([track]);
await ctx.runObjectAction('edit', [track.id]);    // throws if the menu would not offer it
expect(ctx.objectActions.map((a) => a.id)).toContain('edit');
await expect(ctx.runMapAction('mark-here', [18.07, 59.33])).rejects.toThrow();   // lacks plugin.my-plugin.mark
```

- `objectActions`, `mapActions`: what the plugin registered.
- `runObjectAction(id, ids)`: runs an object action for objects of the fake server (`setServerObjects`); it throws when the scope, the number of objects or the user's permission rules it out. `runMapAction(id, position)` throws when the user may not use it.
- `openedMenus`: every menu the plugin opened, with its point and target.
- `applicableObjectActions` and `applicableMapActions` are plain functions; call them directly to test an action's scope.

## See also

- [map.md](map.md): the map view, the selection and interactions
- [panels-and-workspaces.md](panels-and-workspaces.md): panels an action opens, workspaces
- [objects.md](objects.md): change requests and other plugins' fields
- [ADR-0032](../../adr/0032-selection-and-object-actions.md): selection and object actions
