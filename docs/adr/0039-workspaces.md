# ADR-0039: Workspaces: top-bar tabs with their own map, panes and layers

- Status: Accepted (owner, 2026-10-22)
- Date: 2026-10-22
- Deciders: Owner (advised by the ACA; the owner's answers Q22 to Q29 and A15 to A18 in `docs/architecture/m3-simulator-decisions.md`)
- Extends: ADR-0031 (the workspace: a top bar, a settings list, docked panes and saved setups) and ADR-0006 (server-authoritative live picture)

## Context
The shell has one View tab: the Map Pane with a left, a right and a bottom pane, with panels from plugins (ADR-0031). The map view plugin mounts once into the Map Pane, and each plugin has one context for the page, so panels, map overlays, selection, right-click actions and the drawing service all assume one map. Every logged-in user receives every layer; labels do not limit access yet (overview 4.9).

The owner wants the M3 simulator in a tab of its own, with a map, layer handling and symbol placing, instead of panels in View (owner, 2026-10-22): it will grow and would clutter the normal view, and its user rights are easier to keep apart. The same plugins (map, layers, symbols) are reused in both, without copied code. The simulation's ground truth must not reach users who may not see it.

## Decision
1. **A workspace is a top-bar tab with the View layout**: the Map Pane and the left, right and bottom panes, with its own map state, panel layout and setups. View is the first workspace and ECore's own. **A plugin may declare more workspaces in its manifest**, each with a name and two permissions of its own: one to see it and one to change its layers and objects. The simulator declares Simulation (ADR-0040). Later views, such as Replay or Planning, use the same mechanism (Q22).
   - Workspace ids follow the naming of data types (ADR-0023): View is `core.view`, the simulator's is `simulator.simulation`. Its permissions are `plugin.simulator.view` and `plugin.simulator.edit`; the simulator adds `plugin.simulator.run` (Q26).
2. **The tabs are View, the declared workspaces, Settings and Monitor** (A18). A user who lacks a workspace's view permission does not see its tab.
3. **A page shows one workspace at a time** (Q23). Switching tabs works like a new connection with another filter: the shell subscribes to the new workspace's layers, plugins get a fresh snapshot, the panels of the new workspace are mounted, and the map view restores that workspace's map state. To see two workspaces at once, the user opens a second browser window.
4. **Plugins choose where they appear** (A15). Panels, map overlays and right-click actions name the workspaces they belong to; without that they belong to View only, so every plugin built before this ADR appears in View as today. The plugin context tells which workspace the page shows, and when it changes. The right side of the top bar (plugin items, setups, clock, logout) is the same in every workspace (A16).
5. **A layer names its workspace** (Q29): an optional `workspace` field in data model 1.2.0; a layer without it belongs to View, so every existing layer stays as it is. A layer made in a workspace is marked with it. In M3 a layer stays in its workspace; moving or copying layers between workspaces comes later.
6. **Each workspace shows its own layers** (Q24). In a declared workspace, View's layers can be switched on as a **read-only reference**: the layer panel shows them apart, off by default, and no tool there changes them or draws into them (A17). That is a rule of the shell and the plugins; the user's rights on View's layers are unchanged and apply in View. Links' target and source layers are View's in M3 (ADR-0037).
7. **The server enforces a workspace's permissions** (Q25), for the layers marked with it:
   - their layers, objects, counts and changes reach only sessions whose user has the workspace's view permission: in snapshots, change batches, object queries and fetches by id;
   - a change to them needs the workspace's edit permission, instead of `objects.edit` and `layers.edit`, which stay View's;
   - plugins' server parts are not filtered (they are trusted, ADR-0003) and keep each workspace's data to the users allowed to see it.
8. **Setups are kept per workspace** (Q28): each workspace has its own remembered setup and its own named setups, and the setups control works on the workspace shown. The existing setups become View's. Bookmarks are shared by all workspaces.
9. **In M3, Simulation reuses** `map-view-2d`, the background maps, `layer-panel`, `draw-symbols`, `coordinates`, `object-list`, `bookmarks` and `draw-shapes` (Q27). `draw-symbols` and `draw-shapes` draw only into layers of the workspace shown (A17).

## Alternatives considered
- **A Simulation tab built into the shell:** the same reuse, but the shell would know the simulator, and each later view would need shell work again (owner, Q22).
- **Simulation as a separate page with a second shell:** the strongest separation, but two shells to maintain, plugins loaded twice, and users switching pages (owner, Q22).
- **Two workspaces side by side on one page:** both maps live at once, at twice the GPU memory and two live subscriptions, and every reused plugin would have to handle two maps at the same time (owner, Q23).
- **Simulation layers as ordinary layers, shown in View too:** no filter needed, but the ground truth would be visible to everyone (owner, Q24).
- **Hiding the ground truth only in the browser:** simpler, but anyone with the browser's developer tools could see it; the server enforces every permission (overview 4.4; owner, Q25).
- **Simulation layers as layers owned by the simulator:** no model change, but every new simulation layer would have to be made through the simulator (owner, Q29).
- **One setup for all workspaces:** restoring a named setup would change every workspace at once (owner, Q28).

## Consequences
- **Data model 1.2.0 and SDK 1.2.0 (PDA, through a change request):** the layer's `workspace` field; workspace declarations in the manifest (name, view and edit permissions); the workspaces of panels, overlays and actions; the current workspace in the plugin context and its change; a subscription that names the workspaces whose layers it wants.
- **ECore and the shell (CDA):** the workspace tabs and switching; setups per workspace, with the existing ones moved to View; **the server's per-session filter** of layers, objects, counts, changes and queries, and the permission check for changes. That filter is the first that depends on the user; access by label (ADR-0020) will use the same path later. The live picture protocol gets a compatible addition (`server/live-picture-protocol.md`).
- **Reused plugins (PCAs):** `map-view-2d` restores a workspace's map state on a switch and keeps the drawing service per workspace; `layer-panel` shows View's layers as a reference group in other workspaces; `draw-symbols`, `draw-shapes`, `object-list`, `bookmarks` and `coordinates` name the workspaces they appear in and keep their state per workspace. Most panel code is unchanged: a switch looks like a reconnect with a fresh snapshot, which they already handle.
- **ITA:** a user without the view permission sees no tab and receives none of the workspace's layers or objects, also through queries; changes without the edit permission are refused; setups stay apart per workspace; switching tabs keeps each workspace's map state.
- `CLAUDE.md` needs no change. Overview 4.4, 4.9 and 4.11 take the filter and the workspaces in.
