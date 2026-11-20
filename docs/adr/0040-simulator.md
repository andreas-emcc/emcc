# ADR-0040: The simulator: routes, groups, events and outputs in the Simulation workspace

- Status: Accepted (owner, 2026-10-22)
- Date: 2026-10-22
- Deciders: Owner (advised by the ACA; the owner's idea and answers in `docs/architecture/m3-simulator-decisions.md`, section 5 and Q20)

## Context
M3 is "Simulator" (owner, 2026-10-22). A user places symbols, draws routes with a speed and an altitude at each point, puts single objects, convoys or formations on them, attaches events to the points, and runs the simulation; the tracks go out through the outputs the plugins offer, CoT first. The simulation sends its ground truth, everything in it; sensors that give a "detected objects" view come later. The owner's answers settle the behaviour; this ADR places it in emc2's architecture, on top of ADR-0036 (connection tasks), ADR-0037 (links and output channels), ADR-0038 (declared plugin fields) and ADR-0039 (workspaces).

## Decision
1. **A new plugin, `simulator`**, with a server part and a web part (A2).
   - **The server part runs the simulation:** one worker owns its state and a timer ticks it **once per second**; geodesic computation that grows heavy goes to a compute worker (rule C7). The simulation runs with no browser open. The engine handles **1 000 tracks at 1 Hz** (Q4).
   - **The web part works only in the Simulation workspace**, which the plugin declares (ADR-0039, A15): the panels for routes, groups, events, outputs and control, and the object actions.
   - Permissions (Q26, ADR-0039): `plugin.simulator.view` to see, `plugin.simulator.edit` to place objects and change routes, groups, events and the chosen outputs, `plugin.simulator.run` to start, pause and reset.
2. **One shared simulation per server** (Q10), kept over a restart and then paused. Its objects and routes are ordinary objects in simulation layers; its own state (groups, events, outputs, each object's progress, the values to restore) is in the plugin's documents, saved at each pause and at least every 10 seconds while running. Named scenarios and a speed factor come later; M3 runs in real time (Q19).
3. **Tracks are ordinary objects** (A7) in simulation layers, placed with `draw-symbols` in the Simulation workspace (Q27). Only they can go on a route (Q9). At each tick the simulator moves them with change requests: position (with the altitude as the third coordinate, metres above the ellipsoid, A10), and the symbol's `direction` and `speed` modifiers. Objects on no route stand still and are sent too.
4. **A route is an object** in a simulation layer, of the data type `simulator.route`: a line through its points, drawn by the map view with markers at the points, and moved with the map view's drawing and editing service (ADR-0033). The route editor (a panel) holds each point's values; they are kept in the simulator's extension of the route object.
5. **Movement** follows geodesics between the points, with sharp turns at the points (A9).
   - Each point has a speed and an altitude, each **instant** (it applies when the point is reached) or **ramp** (it changes from the previous point on and reaches the value at the point); a ramp on the first point acts as instant (Q11a).
   - A speed ramp has a constant acceleration; an altitude ramp changes in proportion to the distance (Q11b).
   - **The time helper:** a time typed instead of a speed, from the previous point or from the route's start, gives the speed, rounded to a whole unit of the user's choice (Q13). Both are kept and shown. When a point moves, the value typed last stays fixed and the other is recalculated (Q12). With a ramp, the leg's mean speed is the mean of its two ends, so the editor says when a typed time cannot be reached (A11).
   - Units are each user's choice, kept in the user's own documents (ADR-0027); values are stored in SI units (Q13).
6. **Editing a route**, also while it runs (A11): when objects are on it, the user chooses whether they move with it, continuing on the same leg at the same fraction of its length (Q14), or are disconnected: speed 0, altitude kept, in place.
7. **Groups.** Objects are put on a route through an object action ("Put on route"), on the selected objects on the map or in the objects panel (ADR-0032), as a single object, a convoy or a formation.
   - **Convoy:** the objects wait at the first point and leave one by one, each when the one ahead is the spacing away along the route, in the order of the route's object list (Q15). Each follows the route's speeds at the place it is. With "stop" at the end, all stop at the last point (Q15b).
   - **Formation:** each object's offset from the group's centre, forward, sideways and in altitude, is recorded relative to the direction of the first leg when assigned. The centre follows the route, and the shape turns with the direction of travel (Q16).
8. **Events** at route points, for routes with objects (Q17, Q18, A12 to A14):
   - each fires for each chosen object as that object passes the point; in a formation, an object passes when its own place along the route reaches the point;
   - **change a field:** any field an editor can edit, core fields through an ordinary update and other plugins' declared fields through ADR-0038;
   - **hide:** the object stops where it is and is marked hidden in the simulator's extension; the Simulation map shows it faded. The outputs stop sending it, or send a delete where the channel can (ADR-0037). It stays in its route's list. When it is put on a route again, it is shown and sent again.
9. **Control:** start, pause and reset, per route and for all routes. **Reset** puts each object of the route back where it started, restores the values events changed and the hidden objects, and leaves the route paused (Q19). **At the end** a route stops (the objects stay at the last point with speed 0 and are still sent, A9) or restarts: a reset followed by a start, so events fire again.
10. **Outputs** (Q3b, ADR-0037). The simulator lists the output channels it finds; users with `plugin.simulator.edit` choose the simulation's outputs. At each tick it sends every track of the simulation to each chosen channel, hidden ones excepted; a hide sends a removal. The "+" of declared fields (ADR-0038) lets the user set what a channel's protocol uses.
11. **The M3 demo** (Q20): the simulator sends its tracks over CoT to the ESA's TAK Server, and they come back into a View layer through a `cot` input link; the ground truth shows in Simulation, what came back in View. The automatic tests use the ITA's TAK test double.

## Alternatives considered
- **The simulation in the browser:** no server work, but it would stop when the browser closes, and each user would run their own (owner, Q10).
- **The simulator inside ECore:** it would be the one feature that is not a plugin, against ADR-0003; as a plugin it uses the same SDK as any other.
- **Routes only in the simulator's documents, drawn as an overlay:** no new data type, but the map view's drawing and editing service, selection and the layer panel would not apply to them.
- **Browsers that interpolate between ticks:** smoother movement at less load, but every view of the objects would need it; one move per second is the owner's target. It can come later without changing the decisions above.

## Consequences
- **New: `PCA-simulator`** and a brief from the PDA, from this ADR and the decisions record.
- **Spike S6 (CDA, before the simulator's brief is frozen):** 1 000 tracks moving once per second through the object store, persistence and the live picture to several browsers: what it costs, and whether positions need a lighter path than an ordinary persisted change (for example persisting the moving objects less often). Its answer may add a decision.
- **SDK 1.2.0** carries what this needs: connection tasks, output channels, declared fields and workspaces (ADR-0036 to ADR-0039), and a way for the map view to show an object faded for another reason than expiry (the PDA's design).
- **A geodesic library** for the server part may be needed (ADR-0016's licences; for example GeographicLib, MIT), unless the SDK offers the computations.
- **ITA:** flows for routes, ramps and the time helper, convoys, formations, events, hiding, reset and restart, the permissions, and the round trip through TAK Server.
