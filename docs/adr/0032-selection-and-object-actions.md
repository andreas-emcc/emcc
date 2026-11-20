# ADR-0032: Selection, object actions and map actions

- Status: Accepted (owner, 2026-10-14)
- Date: 2026-10-14
- Deciders: Owner (advised by the ACA)
- Supersedes: ADR-0028 (object actions: one list for the right-click menu and the objects panel)

## Context
ADR-0028 made one list of object actions for the right-click menu on the map and in the objects panel, with Edit and Delete from the plugin that edits each kind of object.

Planning M2 in detail (owner, 2026-10-14, after the M2 feasibility study), the owner added:
- **selecting several objects**, with the keyboard and with a box;
- **actions on a whole selection**, and two new ones: centre on and zoom to the objects;
- **a menu on empty map**, with "Centre map".

That changes one part of ADR-0028. A selection can mix symbols, drawn shapes and TAK tracks, which come from different plugins. With Delete from each plugin, such a selection would show several "Delete" entries, each covering only part of it.

Today the selection is a list of object ids that all plugins share (SDK v1). The map view highlights up to 1 000 of them. Clicking a symbol selects it through `draw-symbols`, which listens to the map's clicks; the map's pointer events carry no modifier keys.

The rest of ADR-0028 stands. This ADR repeats its decisions and alternatives, so that it can be read on its own.

## Decision
1. **Selecting objects on the map is the map view's job**, for every kind of object:
   - a click selects one object, and replaces the selection;
   - **Ctrl+click** adds an object to the selection, or removes it if it is selected;
   - **Ctrl+drag** selects the objects in a box;
   - **Shift+drag** zooms to a box, as before.
   - On a Mac the key is Cmd instead of Ctrl, because there Ctrl+click opens the context menu.
   - **A selection holds at most 1 000 objects.**
   - **Only objects the browser holds can be selected.** Objects inside a cluster, or outside the area the map has subscribed to, are not; the user gets a notice to zoom in.
2. **The web SDK has a list of object actions**, kept by the shell. A plugin registers an action with:
   - an id, a label and an optional icon, and a group and order in the menu;
   - which objects it applies to: by `type`, by `dataType` (ADR-0023), or by a test function;
   - whether it takes one object or several;
   - the permission it needs;
   - a handler that receives the ids of the chosen objects.
3. **The right-click menu on the map:**
   - On an object that is **selected**, the actions apply to the whole selection.
   - On an object that is **not selected**, that object alone becomes the selection. When several objects overlap there, the menu first lets the user choose one.
   - An action that takes one object, such as Edit, is not offered for a selection of several.
4. **The objects panel shows the same actions** in a right-click menu on its rows. Other plugins may show them too.
5. **Map actions:** a second, smaller list, for a right-click on empty map. The action receives the position. The map view offers **Centre map**.
6. **The first actions:**
   - **Centre on object(s)** and **Zoom to object(s)**, from the map view. For several objects the middle is a quick approximation: the middle of their extent in the map's own coordinates. Zoom to a single object shows a view about 10 km wide.
   - **Edit**, from the plugin that edits that kind of object: `draw-symbols` for symbols, `draw-shapes` for shapes (ADR-0033). One object only. It selects the object and opens its edit panel.
   - **Delete, one shared action from the shell**, for any kind of object the user may change (`objects.edit`). It asks for confirmation first, stating the number of objects, because there is no undo.
7. **Every action changes objects only through change requests** (ADR-0005, ADR-0018). The menu only starts them.
8. **An action the user may not use is not shown.**
9. **A handler that fails is handled like any other plugin code:** it is logged and shown as an error, and the shell may fence the plugin.

## Alternatives considered
- **Delete from each plugin** (ADR-0028): a mixed selection would show several Delete entries, each for part of it.
- **Edit in the core:** the core does not know how a plugin edits its kind of object, so Edit stays with that plugin.
- **Shift+drag for the box selection:** the owner kept Shift+drag for zooming to a box and chose Ctrl+drag.
- **Selecting the objects inside a cluster through the server:** possible later. It would need a server query by area, and a selection may then hold objects the map does not draw.
- From ADR-0028:
  - **Each plugin opens its own menu:** plugins would compete for the same right click, and the menu would look different for every kind of object.
  - **Actions only on the map:** the objects panel would need its own copy of every action.

## Consequences
- **Web SDK 1.x (PDA, through a change request):**
  - the action list with its one-or-several flag, and the list of map actions;
  - **a way to fetch objects by id**, since an action started from the objects panel may get ids of objects the map does not hold, for example to centre on them.
  The selection itself stays a list of ids.
- **Shell (CDA):**
  - keeps both lists, filters by permission, and calls the handlers;
  - provides the shared Delete, which sends one change request per object (a change request carries one object);
  - sends them in batches within the session's limit on waiting requests (`server/live-picture-protocol.md`: 100), showing the progress and the objects that could not be deleted.
  - The shell's own change requests carry a `source.plugin` of their own. It is not `core`, which browsers may not use, and never the id of the plugin that created the object, because on an update ECore applies that plugin's extension from the request (ADR-0018).
- **Plugins:**
  - `map-view-2d`: selection with click, Ctrl+click and Ctrl+drag, the box selection, the menus, Centre map, and Centre on and Zoom to objects;
  - `draw-symbols`: Edit only. Its click-to-select and its Delete button and key go, because selection is the map view's and Delete is the shell's;
  - `draw-shapes`: Edit for shapes (ADR-0033);
  - `object-list`: the menu on its rows.
- **ITA:** flows for selecting with the keys and the box, a menu on a mixed selection, Delete of many objects, and Centre map.
- The menus use the shared components of ADR-0029.
