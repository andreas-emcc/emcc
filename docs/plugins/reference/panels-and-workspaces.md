# Panels and workspaces

A plugin's web part shows its UI in places the shell owns: panels in the left, right and bottom panes, icons over the map, small controls in the top bar, and floating windows. The shell shows them per workspace: View, and the workspaces plugins declare. Everything is built from the SDK's shared components and takes its look from the design tokens, so it follows the user's look, light or dark, and density.

## Web part (TypeScript)

The entry module's `activate(ctx)` registers everything, quickly: the shell times it out after 10 s.

### Panels

`ctx.ui.addPanel(panel)` ([`workspace.ts`](../../../web/plugin-sdk/src/workspace.ts)) adds a panel and returns a `PanelHandle`: `show()` expands it and brings it to the front of its pane (e.g. for your Edit action), `remove()` removes it.

| Field | Meaning |
|---|---|
| `id` | Unique within the plugin. |
| `title` | Shown once, in the shell's head of the panel. |
| `icon` | A Lucide icon, shown in the head. |
| `defaultPane` | `left`, `right` or `bottom`: where the panel starts for a user who has not moved it. |
| `order?` | Lower comes first within its pane; default 100. |
| `component` | A React component without props. |
| `workspaces?` | The workspaces it appears in; `'*'` for every one. Default `['core.view']`. |

The user may move a panel to another pane; the shell keeps where it is. `ctx.ui.addControlPanel(panel)` is the same as `addPanel` with `defaultPane: 'right'` and returns an `Unsubscribe`; prefer `addPanel`.

**Name once, icon always:** the shell's head shows the panel's title and icon, so the panel shows no inner heading that repeats the title (`PanelFrame heading={false}`), and every panel gives an `icon`.

```tsx
import { Radar } from 'lucide-react';

const panel = ctx.ui.addPanel({ id: 'tracks', title: 'Tracks', icon: Radar, defaultPane: 'right', component: TracksPanel });

function TracksPanel() {
  return (
    <PanelFrame title="Tracks" heading={false} foot={<PanelFoot><Button variant="primary" onClick={apply}>Apply</Button></PanelFoot>}>
      <List label="Tracks">{rows}</List>
    </PanelFrame>
  );
}
```

### Icons over the map, top-bar items, floating windows

- **`ctx.ui.addMapPaneOverlay({ id, position, order?, component, workspaces? })`:** a small control over the map at `top-left`, `top-right`, `bottom-left` or `bottom-right`. The shell stacks a corner's overlays in one column by `order` (default 100), top corners downwards and bottom corners upwards; `map-view-2d` uses 10 and 20 at `top-right`. Default workspaces `['core.view']`.
- **`ctx.ui.addTopBarItem({ id, order?, component, workspaces? })`:** a small control on the right of the top bar; lower `order` stands further left (default 100). The shell caps its width. **Without `workspaces` it appears in every workspace**, unlike a panel (`topBarItemAppearsIn`).
- **`FloatingWindow`** (a component, [`window.tsx`](../../../web/plugin-sdk/src/components/window.tsx)): a window that stays open while the user works elsewhere, e.g. a live video beside the map. Props: `open`, `title`, `onClose`, `defaultSize` (default 480 × 320), `minSize` (default 240 × 160). It moves by its title bar and resizes from its lower right corner, with the pointer or the arrow keys (`WINDOW_STEP` 10 px, with Shift `WINDOW_STEP_SHIFT` 50 px), stays inside the browser window (`clampWindow`), and closes on its button or Escape. Several may be open; each opens `WINDOW_OFFSET` (24 px) from the one before, and the last opened or pressed is in front. Its position is not stored.
- **`ctx.ui.setMapView(view)`** is only for the one active plugin of kind `map-view`, which holds the Map Pane.

### Workspaces

A workspace is a tab of the top bar with its own layers, panels and actions. **View** (`core.view`, `VIEW_WORKSPACE`) is everyone's. A plugin may declare its own in the manifest, e.g. `simulator.simulation`, each with a `viewPermission` (who sees it, its layers and their objects) and an `editPermission` (who changes them, instead of `objects.edit` and `layers.edit`, which stay View's).

| Member | What it gives |
|---|---|
| `ctx.workspaces` | The workspaces this user may see, View first (`WorkspaceInfo`: `id`, `name`, `viewPermission?`, `editPermission?`, `order`). Fixed while the page lives. |
| `ctx.workspace.current` | The workspace shown. |
| `ctx.workspace.onChange(listener)` | Called after each switch. |
| `appearsIn(item, workspaceId)` | Whether something with `workspaces` appears there; without a list, in View only. `EVERY_WORKSPACE` is `'*'`. |
| `workspaceOf(layer)` | A layer's workspace: its `workspace`, or View. |

The `workspaces` filter is on panels, map pane overlays, top-bar items, object and map actions ([actions.md](actions.md)) and live picture subscriptions. A subscription without `workspaces` follows the workspace shown and gets a fresh snapshot on each switch; one that names its workspaces (e.g. `['core.view']`) does not. Create a layer with `workspace: ctx.workspace.current.id`; a layer stays in its workspace.

**On a switch**, in this order:
1. the shell unmounts the old workspace's panels and overlays and mounts the new one's;
2. the map view ends running map interactions (they resolve with `null`), clears every fade list and clears the selection;
3. each subscription that follows the workspace shown gets a fresh snapshot;
4. each plugin's setup share for that workspace is restored;
5. `onChange` is called.

A plugin's code keeps running while its panels are unmounted.

### The user's setup

Each user's setup (panes, map, panels' state) is saved and restored per workspace, and can be named. A plugin saves and restores only its own share: `ctx.setup.register({ save, restore })` returns an `Unsubscribe` (a second registration replaces the first), and `ctx.setup.changed()` tells the shell that the share changed (it saves at most about once per second). `save()` returns JSON of at most `MAX_SETUP_SHARE_BYTES` (64 KiB; `jsonBytes` measures it); a larger share is not saved. `restore(share)` ignores a share it cannot read, keeps the current state and warns in the status; it never throws.

### The shared components

All are controlled (the plugin keeps the state), built from the tokens, and exported from `@emc2/plugin-sdk` ([`components/`](../../../web/plugin-sdk/src/components/index.tsx)):

| Component | What it is |
|---|---|
| `Icon` | A Lucide icon in the text colour at the density's icon size; decorative without `label`. |
| `PanelFrame` | A panel's frame: `title` (its accessible name), `heading` (`false` draws none), `actions` on the right of its bar, the scrolling body, and `foot`. |
| `PanelFoot` | A bar pinned to the panel's bottom: its actions on the right, an optional `status` on the left. |
| `Button` | A button: `variant` `normal`, `primary` or `danger`, `icon`, `disabled` with a `title` saying why, `expanded` and `hasPopup` for one that opens a menu or popover. |
| `IconButton` | A button with only an icon; `label` is its accessible name and tooltip. |
| `TextField` | A labelled text field with `error`, `readOnly`, `data` (the data font), `onCommit` on Enter and on leaving the field. |
| `ColorField` | A colour picker swatch with the colour as text, `#rrggbb`. |
| `Select` | A labelled choice from a list. |
| `Checkbox` | A labelled check box. |
| `Slider` | A labelled slider with its value shown by `format`. |
| `Tabs` | Tabs; the plugin shows the chosen tab's content. |
| `Menu` | A plugin's own small menu that takes the focus when it appears, e.g. in a `Popover`. Object actions use the shell's menu instead. |
| `Popover` | A small floating panel anchored to a control, in the browser's top layer; asks to close on Escape and a press outside. |
| `ConfirmDialog` | A modal question before something that cannot be undone; Cancel has the focus. |
| `Notice` | A short message in a panel: `info`, `warning` or `error`. |
| `List`, `ListRow` | A list of rows, one Tab stop, arrow keys move the focus, Space selects, Enter activates, `onMenu` on a right click. |
| `Tree` | Folders and items with the tree keys, and drag and drop with `onDrop` and `canDrop`. |
| `Chip` | A state as an icon and a word (`ok`, `warning`, `error`, `info`, `neutral`), never a colour alone. |
| `TileGrid` | A grid of picture tiles, one selected, optionally in folding groups. |
| `FloatingWindow` | A movable, resizable window that stays open (above). |
| `DeclaredFields` | The shared editor of declared fields and field sets, for create and edit dialogs ([objects.md](objects.md)). |

`List`, `Tree`, `Menu` and `TileGrid` bring their own keys; do not add your own.

### Icons

Icons come from Lucide, `lucide-react` at the pinned version `1.49.0` (`SHARED_LIBRARIES`), which the shell shares with every plugin through its import map: import it (`import { Layers } from 'lucide-react'`) and never bundle another copy. Every panel names its icon (`icon`), and so may actions, menu items, tree nodes and buttons. The plugin's own icon in the Settings list is the manifest's `icon`, a name from `PLUGIN_ICONS` (e.g. `Radar`); a name the shell does not know shows as its neutral icon.

### The look

Three looks (Night Watch, Chart Room, Signal), each light or dark, with two densities; each user chooses. A plugin never chooses a look. It takes every colour, font, size, space, corner radius and shadow from the design tokens, the CSS custom properties `var(--emc2-…)` that `TOKENS` names ([`theme.ts`](../../../web/plugin-sdk/src/theme.ts)); `tokenVar(name)` gives `var(…)` for an inline style.

- The plugin's CSS is one file, `<id>.css`, listed in the manifest's `web.css` and imported by the entry module. Every class starts with `<id>-`, never `emc2-`. No element selectors at top level, no `:root`, no global CSS.
- The components' CSS is `components.css`, which the shell loads once for every plugin. A plugin does not import it or list it in `web.css`.
- The colours fixed in every look (the APP-6 affiliation colours, the selection highlight, objects' own style colours) are the only literal colours allowed.

### The theme

`ctx.theme` is for what a plugin draws itself on a canvas, where CSS cannot reach: `current` (`look`, `scheme`, `density`), `tokens()` (every token's current value, e.g. `colorText`) and `onChange(listener)`, called after a change, when the tokens already have their new values. CSS needs neither: `var(--emc2-…)` follows by itself.

### The user's time

Each browser session's user picks a time in the top bar's time control: a **set time** (absent means now) and an **interval** (absent means none), independent of each other, as UTC timestamps (`UserTime`, [`time.ts`](../../../web/plugin-sdk/src/time.ts)). A part that is not set is left out, never `null`. Only a plugin with the capability `temporal` is told: there is no `ctx.time`. Its web module implements `capabilities.temporal.timeChanged`, which the shell calls once after `activate` and at each change of either part:

```ts
export default definePlugin({
  activate(ctx) { … },
  capabilities: { temporal: { timeChanged: (t) => history.show(t.time ?? new Date().toISOString(), t.interval) } },
});
```

The server part learns it through the `Temporal` interface, and each endpoint request carries its session's time (`EndpointRequest.userTime()`) when called with `fetch` under `ctx.serverBase`; for a plugin that is not temporal it is always now.

## In the manifest

- [`workspaces`](manifest.md#workspaces): `id` (`<plugin-id>.<name>`), `name`, `viewPermission`, `editPermission`, `order`; at most 16. Both permissions are the plugin's own.
- [`permissions`](manifest.md#permissions): the plugin's own permissions, `plugin.<id>.<name>`.
- [`icon`](manifest.md#icon): a name from `PLUGIN_ICONS`.
- [`web`](manifest.md#web): `entry` and `css`.
- [`capabilities`](manifest.md#capabilities): `["temporal"]` for the user's time. Every declared capability is implemented by a part, and a part implements only declared ones.

## Rules

- A panel works in every pane: narrow and tall as well as wide and low.
- Every panel has an `icon` and shows its title only once, in the shell's head.
- Build from the shared components; use Lucide icons from the shared `lucide-react`, never a bundled copy or another icon set ([ADR-0029](../../adr/0029-shared-design-system.md)).
- Colours, fonts, sizes, spacing, corner radii and shadows come from the tokens only. Classes start with `<id>-`, never `emc2-` ([ADR-0034](../../adr/0034-three-selectable-looks.md)).
- A plugin never chooses a look.
- The browser loads nothing from the internet: no CDNs, remote fonts, scripts or styles ([ADR-0030](../../adr/0030-offline-first-configurable-hosts.md)).
- A setup share's `restore` never throws.
- Without a permission, show a panel read only with a short hint; do not hide it ([permissions-and-labels.md](permissions-and-labels.md)).

## Testing

```ts
const ctx = createFakeContext({ pluginId: 'my-plugin', workspaces: [simulation], workspace: 'core.view' });
const map = createFakeMapView();
ctx.provideAs(MAP_VIEW, map);
await activatePlugin(plugin, ctx);                    // also starts a temporal module
expect(ctx.addedPanels.map((p) => p.panel.icon)).not.toContain(undefined);
map.switchWorkspace();                                // the map view's step first
ctx.switchWorkspace('simulator.simulation');          // steps 3 to 5
expect(checkLookCss(css, { pluginId: 'my-plugin' })).toEqual([]);
```

- `addedPanels` (with how often each was `shown`), `panels`, `overlays`, `topBarItems`, `mapViewMount`.
- `switchWorkspace(id)`, with a fake map view's `switchWorkspace()` called first.
- `setupShare`, `setupChanges`, `saveSetup()` (throws over 64 KiB) and `restoreSetup(share)`.
- `changeTheme(state, tokens)` and `FAKE_TOKEN_VALUES`; `setTime(time)` with `activatePlugin`.
- `checkLookCss(css, { pluginId, allow, allowClasses })` checks the plugin's CSS against the token rule; render components with `@testing-library/react` ([testing.md](testing.md)).

## See also

- [actions.md](actions.md): the right-click menus
- [settings.md](settings.md): the Settings entry and the own settings panel
- [map.md](map.md): the map view and its overlays
- [ADR-0031](../../adr/0031-workspace-settings-list-and-setups.md), [ADR-0039](../../adr/0039-workspaces.md), [ADR-0045](../../adr/0045-temporal-awareness.md), [ADR-0056](../../adr/0056-what-a-look-may-set.md)
