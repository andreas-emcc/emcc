# object-list

Brief: `docs/plugins/briefs/object-list.md` (T-053, M2; T-085, M3). Web part only. M2 is done; the M3 workspace functions are built against SDK 1.2.0 and wait for the shell's workspaces (T-080); see "Known limits".

## What it does

Shows the objects of one layer as a list, page by page, also for a layer hidden on the map and for objects the map does not hold. The pages come from the server's query for a layer's objects (`ctx.objects.queryLayer`), not from the live picture, so the map's area of interest and the layers' local visibility do not matter. Its rows share the map's selection and the shell's object actions.

What it does, in detail:
- The panel "Objects" (default pane: bottom) with a layer chooser (which shows the layer's name) and its object count. The shell draws the panel's head and padding, so the panel has no frame or heading of its own.
- The service `emc2.object-list`, so other plugins can open the panel for a layer.
- Pages of `pageSize` objects in the order of creation, with "1–100 of 12 345" and the buttons first, previous, next and last.
- Columns: name (or "(no name)"), kind (Symbol, a shape's kind from the extension key `draw-shapes.kind`, otherwise the geometry type), data type by its display name, data source, classification, last modified (UTC). A narrow pane shows the name and the kind; the rest is in the row's tooltip.
- The page is read again when the layer's object count changes, on Refresh and when the page size changes. A change to an object's fields shows at the latest with the next of these.
- An empty layer shows "No objects in this layer". A layer that is deleted while shown closes the list with a notice. A failed query shows its reason and a Retry button, and keeps the last page.
- The symbol image of a row that is a symbol (`SymbolService`, at the size of the density's row).
- **Shared selection:** a click selects the object and replaces the map's selection; Ctrl (Cmd on a Mac) + click adds or removes it. Past 1 000 objects nothing is added, with a notice. Rows of selected objects are highlighted, also when the selection was made on the map. The selection may hold objects the list does not show; the list keeps them.
- **Object actions:** a right click on a row opens the shell's object action menu. On a selected row the actions apply to the whole selection; an unselected row becomes the selection first. Edit, the shared Delete, Centre on and Zoom to come from the plugins and the shell, not from this one.
- **Double-click:** the map zooms to the object (`MapView.zoomTo`), also when the map does not hold it.

- **Keyboard:** the shared `List` is one Tab stop and moves the focus with the arrow keys, Home and End (it does not select). `ListRow` adds Space (selects the row; Ctrl or Cmd+Space adds or removes it; the page does not scroll) and Enter (zooms the map to the object). The panel adds the menu key or Shift+F10, which opens the object action menu at the row, with the same rules as a right click. A row that gets the focus is scrolled clear of the controls, which stay in view above the list: the panel measures them and gives the rows that scroll margin.
- **Workspaces (M3, functions 10 to 12):**
  - The panel is registered for every workspace (`workspaces: ['*']`). Its live picture subscription names no workspace, so it follows the workspace shown and gets a fresh snapshot on a switch.
  - The layer chooser lists the shown workspace's own layers only, also if the picture holds others (View's layers shown as a reference in another workspace are never listed).
  - `open(layerId)` for a layer the workspace shown does not hold (another workspace's, or one that does not exist) opens nothing and raises the shell notification "That layer is not in the workspace shown". The panel is not brought to the front and the list stays as it was. Before the first picture arrives, and between a switch and its picture, nothing is known about the layers, so the layer is taken as it is.
  - On a switch the list remembers the layer it showed in the workspace it leaves and shows it again on the way back (kept for the life of the page). A workspace visited for the first time, or whose last layer is gone, shows the layer chooser as at start, without a "deleted" notice: the old workspace's layers leaving the picture are not deletions. A page read that was on its way for the old workspace is dropped.
  - The selection is the map view's, which clears it on a switch, so no row is selected afterwards.
  - Object actions: the plugin registers none (it changes nothing), so there is nothing to register per workspace (rule 4). A right click opens the shell's menu, which offers each action only where the user has the workspace's edit permission.
- **Look:** the stylesheet takes every colour, font, size and space from the design tokens (a test checks it with the SDK test kit's `checkLookCss`). The controls wrap into as few lines as the pane's width allows, so a low pane keeps room for rows. The table switches between wide and narrow with the width of its pane.

## Settings

| Name | Default | Meaning |
|---|---|---|
| `pageSize` | `100` | Objects per page. At most 500, the largest page the server answers. Changes apply at once, and the first object of the page stays in view |

## Messages and services

- **Provides** `emc2.object-list` (`OBJECT_LIST`): `open(layerId)` shows the panel, brings it to the front of its pane and lists that layer.
- **Uses** `emc2.map-view` (selection, zoom; without it the plugin reports `DEGRADED`, rows cannot be selected or zoomed to, and the menu opens for the row alone) and `emc2.symbols` (the symbol image of a row; without it rows have no image).
- Reads and sets `MapView.selection`; calls `MapView.zoomTo` and `ctx.actions.openMenu(at, { objects })`. Registers no object or map action of its own.
- Live picture: one subscription with `{ objects: false }`, for the layers and their object counts. It names no workspace: it follows the workspace shown (SDK 1.2.0).
- Server: `ctx.objects.queryLayer(layerId, { page, pageSize })`, one read at a time that counts; an answer to a page the user has left is dropped.
- No topics, no endpoints, no server part.

## Permissions and internet

No permission to read: every logged-in user may list a layer's objects. Actions started from the list carry their own permissions, and the shell does not show those the user may not use. The plugin sends no change request of its own. No internet access.

## Known limits

- Order is the order of creation; no sorting or filtering (brief, out of scope for M2).
- After an action from the list the page is read again only if the layer's count changed (Delete, Create) or on Refresh: `ctx.actions.openMenu` returns nothing, so the list cannot tell when an action such as Edit has finished (CR-0017, which proposed a promise, was rejected by the owner on 2026-10-16; the brief's function 7 says the same). Field changes made from the list show at the next count change or Refresh.
- A burst of count changes costs one extra read, not one per change; changes to an object's fields without a count change show only on Refresh.
- The table switches between its wide and narrow layout with a container query in the font's own unit (`40em`), so it follows the density. jsdom cannot run container queries, nor the scrolling: the layout was checked in the real shell (bottom and left pane) in all three looks, light and dark, and in both densities, with the shell's Look control (2026-10-21). The colours of the selected row, the controls' background and the text were read from the live page and equal the values in `docs/architecture/looks.md`; rows are 26 px high in Compact and 34 px in Comfortable. The "Modified" column is the widest column so the full date-time group fits in a bottom pane of about 900 px.
- Checked in the real shell with `integration/sdk-v1.1` `c9be39af` (2026-10-21): the right click, the menu key, the shared Delete, a double-click and Enter (the map zooms to the object) and `layer-panel`'s double-click (opens the list for that layer) work. The menu has Centre on, Zoom to, Edit and Delete. `draw-symbols`' properties panel said "The selected object has not arrived yet" for an object selected in the list that the map does not hold (2026-10-16; not re-checked). That is not this plugin's; its own side is tested against the SDK test kit.
