# ADR-0028: Object actions: one list for the right-click menu and the objects panel

- Status: Superseded by ADR-0032 (owner, 2026-10-14)
- Date: 2026-10-10
- Deciders: Owner (advised by the ACA)

## Context
The owner wants a **right-click menu on map objects** (M2, owner 2026-10-10). It starts with Edit and Delete, and plugins can add their own entries.

The new **objects panel** lists the objects of a layer, and should offer the same actions on its rows. Today each plugin handles its own clicks, and nothing lets one plugin offer an action on an object that another plugin shows.

## Decision
1. **The web SDK has a list of object actions**, kept by the shell. A plugin registers an action with:
   - an id, a label and an optional icon, and a group and order in the menu;
   - which objects it applies to: by `type`, by `dataType` (ADR-0023), or by a test function;
   - the permission it needs;
   - a handler that receives the chosen object ids.
2. **The map view shows the actions in a right-click menu** for the object under the pointer. When several objects overlap there, the menu first lets the user choose one.
3. **The objects panel shows the same actions** in a right-click menu on its rows. Other plugins may show them too.
4. **Edit and Delete come from the plugin that edits that kind of object**, which is `draw-symbols` for symbols.
   - **Edit** selects the object and opens its edit panel.
   - **Delete** asks for confirmation first, because there is no undo.
   - Both still change objects only through change requests (ADR-0005, ADR-0018). The menu only starts them.
5. **An action the user may not use is not shown.**
6. **A handler that fails is handled like any other plugin code:** it is logged and shown as an error, and the shell may fence the plugin.

## Alternatives considered
- **Each plugin opens its own menu:** plugins would compete for the same right click, and the menu would look different for every kind of object.
- **Actions only on the map:** the objects panel would need its own copy of every action.
- **Edit and Delete in the core:** the core does not know how a plugin edits its kinds of objects.

## Consequences
- **Web SDK (PDA):** the action list and its registration, as a compatible addition.
- **Shell (CDA):** keeps the list, filters by permission, and calls the handlers.
- **Plugins:**
  - `map-view-2d` shows the menu on the map;
  - `draw-symbols` registers Edit and Delete;
  - `object-list` shows the menu on its rows.
- The menu uses the shared components of ADR-0029.
