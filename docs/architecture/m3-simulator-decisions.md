# M3: Simulator, the owner's decisions

The owner's idea for M3 (2026-10-22) and the owner's answers to the ACA's questions on it, the same day. **Q** numbers are the questions in the order they were asked; **A** numbers are the ACA's assumptions, which the owner accepted as a whole. This file was the source for ADR-0036 to ADR-0040 (below), which the owner accepted on 2026-10-22. They and `overview.md` section 6 now hold the decisions, and this file is their history. Milestones are planning (`docs/adr/README.md`).

Owned by the ACA.

## Milestones

- **M3 is "Simulator"** (owner, 2026-10-22). Everything planned for M3 before moves to **M4**:
  - PostgreSQL/PostGIS persistence (ADR-0024, ADR-0027, and ADR-0019's PostGIS timing);
  - WMS background maps: `basemap-wms`, the map view's `wms` source and a plugin's own settings panel (ADR-0035, CR-0023);
  - the board's tasks T-059 (spike S5), T-060 (OpenTelemetry), T-061 (Keycloak demo realm), T-065 (military tactical graphics), T-066 (dragging a shape) and T-068 (the ESA takes over the Keycloak).
- **SDK 1.2.0 is one release at the start of M3** (Q21): M2's fixes (the `Button`'s `aria-expanded` and `aria-haspopup`, presses on a popover inside a dialog, the `IconButton` title in CR-0024, the `TextField` height) and M3's additions. CR-0023 moves to M4 with WMS. CR-0020 stays only if the route editor needs it (the ACA checks with the PDA). CR-0022 (an `internet` declaration without default hosts) stays in 1.2.0, as the owner decided on 2026-10-19: it is not tied to WMS.

## 1. Data in and out of plugins

**The idea.**
- Nothing in the SDK or in emc2 may stop a plugin from using any of eight ways:
  - in: a UDP listener; a multicast listener; a TCP server consumer (the provider connects and pushes); a TCP client consumer (the plugin connects and receives);
  - out: a UDP sender; a multicast sender; a TCP server provider (the plugin listens and sends to those that connect, A1); a TCP client provider (the plugin connects and pushes).
- Other parts of emc2 send and receive through such plugins in one standard way that does not hinder any of these. The goal is updates at least once a second.
- **The transport is always the plugin's.** ECore makes no helpers or wrappers for it: wrapping every kind would bring constant redesigns that affect all plugins. ECore provides long-lived connections for the plugins that need them, and monitors them.

**Decisions.**
- **Q1, sockets.** The plugin opens its own sockets with the JDK's classes, without a factory, inside a **connection task** from ECore.
  - ECore runs the task on its own virtual thread, the only place where plugin code may block. It starts and stops the task, restarts it with a back-off, caps the tasks per plugin, closes the sockets the task registered when it stops, gives the task an inbox for data to send, and shows its state in the monitor view.
  - ECore checks no endpoints. A host is still never taken from a message or from object data.
  - TLS certificates come from local server configuration, through the SDK.
  - Today's listener, where ECore opens the socket, stays in SDK 1.x as deprecated; `cot` moves over in M3.
  - This changes rule C6 (overview 4.2).
- **Q2, listening addresses.** A link that listens (UDP, multicast, TCP server) binds to loopback by default. An admin (`settings.admin`) sets an interface address, or all interfaces, in the link's settings.
- **Q3, the standard way: both.** Layers are the main way: an input link writes into its target layer, and an output link sends the objects of its source layers. Direct channels in the SDK serve data that should not go on the map.
- **Q3b, the simulator's outputs.** The simulator lists the output channels it finds in the plugins and sends to those chosen in its own panel. Its layers only show the ground truth (in the Simulation workspace, Q24).
- **Q4, rate.** The simulation engine handles **1 000 tracks at 1 Hz**. An output that is slower by nature may miss that rate; that is accepted. A slow output keeps only the latest update per track, and the monitor view shows its real rate (A8). The ACA counts emc2's own map in the 1 Hz target.
- **A3.** Plugins from third parties are still trusted and built against the SDK (`requirements.md`).
- **A4, monitoring.** ECore knows each connection task's state itself (running, restarting, failed and why, since when, restarts). The plugin reports its own counters through the SDK (in, out, last activity, errors). The monitor view shows both.
- **A5, TLS.** As today for TCP clients, with certificates from local configuration. TLS for TCP servers comes later.

## 2. CoT in and out

**The idea.** Receive CoT, each link (connection) into one target layer chosen from a list of the layers. Send objects as CoT, from one or more source layers. The owner asked how to handle objects that CoT cannot carry.

**Decisions.**
- **Q5.** `cot` builds and tests, in and out: a TCP client (TAK Server, with TLS as today), UDP and multicast.
- **Q6, the target layer.** An existing layer from a list, or "New layer" with a name. Several links may share a layer. A deleted target layer is made again at the next event.
- **Q7, objects CoT cannot carry.** M3 sends symbols only. APP-6 is mapped to the CoT type; a function CoT lacks falls back to its parent, then to its dimension's generic symbol. Everything else is skipped and counted per link, with the reason, in the monitor view and the link's status. Shapes as TAK drawings come later.
- **Q30, release limit.** Each output link has a highest classification it may send, by default the classification of the server's default label. Objects above it, by the order of classifications in configuration, are skipped and counted, until access by label comes.
- **A6.** A link is in, out or both; "both" uses one connection, as TAK clients do. An object is never sent back to the link it came from.
- **A8.** Every simulated track is sent at each tick (1 s), with a short CoT stale time, so that a paused simulation's tracks go stale in TAK.

## 3. Plugin fields when creating objects

**The idea.** When a symbol is created, the editor first offers the core fields; a "+" button adds the fields of other plugins' data models. Plugins announce their fields through the SDK.

**Decision (Q8).** Each plugin declares its extension fields in its manifest: name, type (text, number, choice, yes/no), label, unit, limits, and whether users may edit it. Any editor may write a declared, user-editable field on a user's behalf, and ECore checks the value against the declaration. This needs a new ADR that extends ADR-0007; the namespace rule (`CLAUDE.md` section 4) becomes "your own namespace, or another plugin's declared user-editable fields on a user's behalf".

## 4. The Simulation workspace

**The idea** (the owner, during the questions). The simulator gets its own tab, with a map, layer handling, symbol placing and so on, instead of panels in View: it will grow and would clutter the normal view, and it makes separate user rights easier. The same plugins (layers, symbols, maps) are reused in both, without copied code.

**Decisions.**
- **Q22, generic workspaces.** A workspace is a top-bar tab with the View layout (the Map Pane and the left, right and bottom panes), its own map state and panel layout, and a permission. A plugin can declare a workspace; the simulator declares Simulation. Plugins choose in which workspaces their panels appear. Later views (for example Replay or Planning) reuse the mechanism.
- **Q23.** A page shows one workspace at a time. Switching tabs mounts the map again with that workspace's own state. To see both at once, the user opens a second browser window.
- **Q24, layers.** Each workspace shows its own layers. In Simulation, View's layers can be switched on as a read-only reference. View never shows the ground truth: its users see simulated tracks only as they come back through the outputs.
- **Q25.** The server enforces this: simulation layers and their objects reach only users with `simulation.view` (named `plugin.simulator.view`, Q26), and the server refuses their changes from others.
- **Q26, permissions.** `simulation.view` (the tab and the ground truth), `simulation.edit` (objects, routes, assignments and events) and `simulation.run` (start, pause and reset). Named by the plugin permission convention, they are `plugin.simulator.view`, `plugin.simulator.edit` and `plugin.simulator.run` (ADR-0039).
- **Q27.** In Simulation in M3: `map-view-2d`, the background maps, `layer-panel`, `draw-symbols`, `coordinates`, `object-list`, `bookmarks` and `draw-shapes`.
- **Q28, setups per workspace.** Each workspace has its own remembered setup and its own named setups (ADR-0031). The setups control works on the workspace shown (A16).
- **Q29.** Layers get an optional `workspace` field in data model 1.2.0; a layer without it belongs to View, so existing layers stay as they are. A layer made in Simulation is marked with the workspace's id, `simulator.simulation` (ADR-0039). The server filters by it, with the permission the workspace declares. In M3 a layer stays in its workspace; moving or copying layers between workspaces comes later.
- **A15.** Panels, map overlays and right-click actions appear in View only, unless their plugin names other workspaces. The simulator's appear only in Simulation.
- **A16.** The right side of the top bar (bookmarks, setups, clock, logout) is the same in every workspace.
- **A17.** `draw-symbols` and `draw-shapes` create objects only in layers of the workspace they are used in. View's layers are read-only in Simulation.
- **A18.** The tabs are View, Simulation, Settings and Monitor, in that order. Users without `simulation.view` (`plugin.simulator.view`) do not see Simulation.

## 5. The simulator (beta)

**General.**
- **A2.** A new plugin, `simulator`. Its server part runs the simulation clock, so the simulation runs with no browser open.
- **Ground truth only:** everything in the simulation is sent. Sensors, fixed and moving, that give a "detected objects" view come later.
- **Outputs are found at runtime:** the simulator searches the plugins for their output channels and data models (CoT now; ADatP-36, AIS, ADS-B and plugins from third parties later).
- **Q9.** Only objects in simulation layers can be put on a route. The simulator never moves objects that came from CoT or other plugins.
- **Q10.** One shared simulation per server; everyone with `simulation.view` (`plugin.simulator.view`) sees its routes and tracks live. It survives a server restart, paused. Named scenarios to save and load come later.
- **A7.** Simulated tracks are ordinary objects in simulation layers. Objects on no route stand still and are sent too.

**Routes.**
- Each route point has a speed and an altitude, each set as **instant** (it applies when the point is reached) or **ramp** (it changes from the previous point on and reaches the value at the point).
  - **Q11a.** A ramp on the first point acts as instant.
  - **Q11b.** A speed ramp has a constant acceleration; an altitude ramp changes in proportion to the distance (a straight climb or descent).
- **Time helper.** Instead of a speed, the user may type a time, counted from the previous point or from the route's start (at least the time at which the previous point is reached). The speed is calculated from it and rounded. Both the speed and the time are kept and shown in the route editor.
  - **Q12.** When a point is moved later, the value typed last for that point (speed or time) stays fixed, and the other is recalculated.
  - **A11.** With a ramp, the editor says so when a typed time cannot be reached.
- **Q13, units.** Each user chooses km/h, knots or m/s, and metres or feet. Values are stored in SI units. A speed calculated from a time is rounded to a whole unit of the user's choice.
  - **Later (owner, 2026-10-26; open question 18 of the simulator's brief):** mph is added to the speed units. Each user's choice is remembered in the user's setup (`ctx.setup`), and the route still stores m/s and metres. So the units follow the setup, per workspace and named setup (the ACA's reading, `docs/architecture/reviews/m3-briefs.md`).
- **A9.** Objects move along geodesics between the points (ADR-0019), with sharp turns at the points.
- **A10.** Altitude is metres above the ellipsoid, as in the data model. MSL comes later.
- **Editing a route.** Points can be moved and their values changed, also while the route runs (A11). When objects are attached, the user is asked whether they move with the route or are disconnected. Disconnected objects get speed 0 and keep their altitude.
  - **Q14.** Objects that move with the route continue on the same leg, at the same fraction of its length.

**Groups on a route.**
- **Convoy:** the objects follow each other at a spacing in metres, in the order of the route's object list.
  - **Q15.** They leave one by one: the lead leaves the first point first, and each next object leaves when the one ahead is the spacing away.
  - **Q15b.** When the route ends with "stop", they all stop at the last point.
- **Formation:** the objects' relative positions are recorded when they are assigned, and kept while the formation's centre follows the route.
  - **Q16.** The shape turns with the direction of travel, and the altitude offsets are kept. In sharp turns, objects far from the centre move unnaturally; that is accepted.

**Control.** Start, pause and reset, for each route and for all routes.
- **Q19.** Reset puts back every object of the route where it started, undoes the values changed by events, shows hidden objects again, and leaves the route paused. M3 runs in real time only.

**Events** at route points, only for routes with objects attached. Two kinds in M3, more later:
- **Change a field** of chosen objects of the route, for example a status. **A12:** any field the editor can edit, including the symbol code and declared plugin fields.
- **Hide object:** the outputs stop sending it, or send a delete where the output type supports one.
  - **Q18.** On emc2's map, the object stays, marked as hidden, and stops where it was hidden. When it is part of a selection that is attached to a route again, it is shown and sent again.
  - **A14.** It stays in its route's list, so the route's reset brings it back.
- **Q17.** An event fires for each object as that object passes the point. **A13:** in a formation, an object passes a point when its own place along the route (the centre's place plus its offset forward or back) reaches it, so objects at the front go first.

**End of a route**, per route: stop all tracks, or restart from the beginning.
- **A9.** "Stop" leaves the objects at the last point with speed 0; they are still sent.
- **Q19.** "Restart" is a reset followed by a start, so events fire again.

## 6. The M3 demo

**Q20.** The simulator sends its tracks over CoT to the ESA's TAK Server, and they come back into emc2 through a CoT input link into a View layer: the ground truth shows in Simulation, what came back shows in View. A TAK client (WinTAK or ATAK) is added if the owner has one. The automatic tests use the ITA's TAK test double.

## The ADRs

All accepted by the owner on 2026-10-22.

| ADR | Subject | Extends or changes |
|---|---|---|
| 0036 | Connection tasks: plugins open their own sockets (Q1, Q2, A4, A5) | ADR-0004, ADR-0030; rule C6 |
| 0037 | Data in and out: links with target and source layers, direct output channels, `cot` in M3 (Q3 to Q7, Q30, A6, A8) | ADR-0023 |
| 0038 | Declared plugin fields and the "+" in editors (Q8) | ADR-0007, ADR-0018 |
| 0039 | Workspaces (Q22 to Q29, A15 to A18) | ADR-0006, ADR-0031 |
| 0040 | The simulator (section 5, Q20) | |

ADR-0036 also applies the host rule of outbound HTTP (ADR-0030, owner 2026-10-18 and 2026-10-19) to sockets: any host, never one taken from a browser request, a message or an object's data.
