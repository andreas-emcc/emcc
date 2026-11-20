# Brief: simulator

- Status: **Approved by the owner (2026-10-26).** Reviewed and rechecked by the ACA (T-078, `docs/architecture/reviews/m3-briefs.md`), with its findings S1 to S5 taken, and with the owner's answers to open questions 2 to 17 and the units of open question 18 (2026-10-26); the ACA's recheck nits taken (criteria 6, 20 and 25). **Function 22 (the fade list set again on a switch) and criterion 26 added with the owner's approval of 2026-10-27** (the ACA's U2 in the reused plugins' review). **Amended with the owner's decision of 2026-10-27** (PCA-simulator's question 8, built in part B2): what a reset restores lives on the track, in the simulator's extension next to the hidden mark, not in the documents (functions 13 and 20, criterion 20) · Milestone: M3 · Task: T-077 (brief), T-083 (build) · Agent: PCA-simulator (new; worktree and port when the brief is approved)
- **Updated 2026-10-30 for M4 (T-090): functions 2, 8, 9b, 10 and 22, Interfaces, criteria 6 and 25, criteria 27 to 31.** From the owner's M4 notes (2026-10-30: the five UI items, the units BV, the "Simulation" layer BT with BX, default panes BS) and the owner's answers to the PDA (2026-10-30: m/s kept, the units in the browser; a route's menu; the event panel's pane). No ADR, SDK member or model change. **For the owner's approval.**
- **Updated 2026-10-30 for M4 (CR-0028 step 1): function 25, criterion 32, the layer lock** (ADR-0042, SDK 1.3.0), with the owner's answers to the PDA, 2026-10-30. **For the owner's approval.**
- **Updated 2026-10-30 for SDK 1.3.0 (CR-0028 part 3; the owner's BO and CA; T-106): function 26 and criterion 34, the fields list instead of the "+".** For the owner's approval; merged in one run with the SDK's step 3 (CR-0028, Compatibility).
- **Updated 2026-11-06 for SDK 1.4.0 part 3 (ADR-0050; the owner's ID, 2026-11-06): function 26 and criterion 34, every field set in the Event panel instead of "Other fields".** Decided by the owner, so approved. Built by PCA-simulator on `pca-simulator/sdk-1.4-part3` `7e6c2182`.
- **Updated 2026-11-07 (PCA-gmti's T-141 note): function 28, 4607's reach.** JI's cut at 255.99 km is **replaced by the owner's Q15, confirmed as JS (2026-11-07)**: the sensor keeps its full reach, and `gmti` cuts what 4607 cannot hold. The owner's warning for tracks beyond an output's reach waits for CR-0035 (proposed). Approved by the owner (2026-11-07, JX); Q15 confirmed as JT.
- **Updated 2026-11-06 for M5 (T-141, T-143, T-150; ADR-0048 points 6 and 7, ADR-0051 point 8, ADR-0050 point 7): functions 27 to 32, function 18's outputs, Interfaces, Permissions, the out-of-scope line, criteria 35 to 46.** The GMTI sensor and its Sensors panel, Sensor outputs, the pairing on the sensor's platform, the channels' field sets, and scenarios. With the owner's answers of 2026-11-06: Q5 (a Sensors panel), Q6 (a sector from the platform), Q7 (import as new replaces, after a confirmation; merge adds), Q9 ("Detect all in range"), and the assumptions A9 to A13. Built against SDK 1.4.0 (`^1.4.0`). **Approved by the owner (2026-11-06, IQ).**
- **Updated 2026-11-07 for CR-0033 (approved by the owner, JO): function 29's "The sensor", a line in function 28, and criterion 47.** Each sensor report says which sensor made it and how it was set (`ChannelItem.Sensor`), so that `gmti` out sends them. No new setting. The sensor's settings are generic (owner, JQ, 2026-11-07). **Approved by the owner (2026-11-07, JW).**
- **Updated 2026-11-07 for CR-0034 (approved by the owner, KF): functions 27, 29 and 32, criteria 46 and 47.** A sensor's optional **Mission**, a generic text (JQ), carried in each sensor report, so that `gmti` out sends it as `M1` and `P9`. **Approved by the owner (2026-11-07, KI).**
- **Updated 2026-11-07 for CR-0035 (approved by the owner, KL and KM, with the ACA's R2 to R5): functions 28 to 30, criterion 48. Approved by the owner (KQ, 2026-11-08).** The owner's Q15 warning: the sensor knows from each output's `maxAreaDepth` which detected tracks it leaves out. It shows a text in the map pane for them, and writes its own relation kind `simulator.beyond-reach` (Q17) in place of `gmti.pairing` for those tracks.
- **Updated 2026-11-08 for the owner's KW and KX (from PCA-simulator's build, `pca-simulator/m5-sensor` `137cc64a`): functions 27, 28 and 30, criteria 37 and 48.** Every track type is detected and each output decides what it sends (A99); an error of 0 is none (A100); the Sensors panel's units; the kind's id `simulator.beyond-reach` (the SDK's id rule). **Approved by the owner (2026-11-08, LA).**
- **Updated 2026-11-08 for the owner's LJ: function 32, the out-of-scope line.** Export and Import scenario stay two buttons in the Routes panel in M5; a top-bar Scenario button is T-152 (M6). **Approved by the owner (2026-11-08, LJ).**
- **Updated 2026-11-09 for M5 RC2 (T-158; owner, 2026-11-09): function 33, Interfaces, criterion 49, open questions Q25 to Q29.** Each sensor's coverage, its range band and arc, drawn round its platform's current position by the web part as a map overlay. No ADR, model change or SDK member: SDK 1.4.0's overlay `area` (part 6). **Approved by the owner (MW A, 2026-11-09), with Q25 to Q29 as recommended**; in `integration/sdk-v1.4` as `583caf43`.
- **Updated 2026-11-09 for the owner's MX: functions 27, 28 and 33, criterion 36.** Equal start and end bearings look all round, in detection and in the drawing. Decided by the owner, so approved.
- **Updated 2026-10-30 for M4 (T-121): function 10, criterion 33, the tracks' names** (owner, A73 to A78, confirmed DD; built on `pca-simulator/t121-names`, in `main` as `e61219f`).
- **Updated 2026-11-10 for M6 (T-165; CR-0038 points 5, 6 and 8, SDK 1.5.0 part 1): functions 34 and 35, criteria 50 and 51; function 35 replaces function 26's groups and criterion 51 criterion 34's.** `simulator.route` is left out of the editors' data type selects, and the Event panel shows one field set at a time. **Approved by the owner (NQ A, 2026-11-10)**; with Q31 A (NO A: a data type's sets go on symbols only) and Q32 A (NP A: SDK 1.5.0 from part 1).
- **Updated 2026-11-10 for M6 (T-168, T-169; CR-0039 point 7, approved by the owner, OB A; CR-0040, approved by the owner, OT A): functions 36 to 39, criteria 52 to 59.** Two sensor types, the ground radar's dwells computed from its targets, the generic sensor, and a sensor's job area, with the owner's answers of 2026-11-10 in the PDA's session (Q35 to Q40, A4 to A9). A dated note on ADR-0048 follows (ACA). **Approved by the owner (2026-11-10, OU A; CR-0040 approved, OT A).**
- **Updated 2026-11-11 for M6 (T-155; CR-0039 points 10 and 11, approved by the owner, OB A; SDK 1.5.0 part 5): function 40, criterion 60.** A moved track stays where the user put it (ADR-0053 point 8). **Approved by the owner (2026-11-11, PR A).**
- **Updated 2026-11-11 for the owner's PX (no generic sensor in M6): functions 36 and 38, criteria 52 and 58, the import's generic sensor.** "New sensor" makes a ground radar without asking for a type; the generic sensor (function 38, criterion 58 and criterion 52's generic parts) is kept for a later milestone. A scenario file's generic sensor is left out and listed (the owner's Q52, 2026-11-11, in the PDA's session: B). Decided by the owner, so approved.
- **Updated 2026-11-11 for M7 (T-177 to T-180, T-184, T-185, T-182, T-152, T-176; CR-0041): functions 27, 32, 37 and 39 amended, functions 41 to 49, criteria 61 to 72, open questions Q55 to Q58, Q60 and Q61, assumptions M7-S1 to M7-S7.** **Criteria 55 to 57, 71 and 72 corrected on 2026-11-12** (the MCA's note from the PCAs' reports: the empty dwells spread over the area, Import alone greyed, "runs on" by construction). **Approved by the owner (2026-11-11, RJ A)**, with Q55 B, Q56 A, Q57 A, Q58 A, Q60 A, Q61 A and the assumptions (M7-S7 with today's identity colours as the defaults). The sensor package, the Scenario button and Append on a route. Functions 41 to 46 need no contract change and can start first; 47 to 49 wait for SDK 1.6.0 (CR-0041 parts D, F and B).
- **Updated 2026-11-13 for M8 (T-189, owner SU A, SV A; T-191; T-197, owner TQ A, TR B, TS B, TT A and the answers on its three open points): function 37's presets, function 46's default colours, the settings table, new function 50, criteria 73 to 77.** Fixed default colours (`#7EF26A`, `#FD0909`, `#BDCF3D`). M7's Narrow wedge becomes "Default" and the Narrow wedge takes the AFSERS values. A ground radar's **Mode**, Random or Systematic: a scan in rows, bearing first, side by side, passes back to back, found targets revisited every Target revisit (default 2 s) until 3 misses, the Empty dwells share gone (T-196).
- **Updated 2026-11-13 for M8 (T-196; the owner's "fill the revisit", in PCA-simulator's session, and A on the old settings): functions 37 and 44, the presets, function 50, the settings table, criteria 56, 64, 66 and 73.** A revisit holds floor(revisit interval / dwell interval) dwells, so one dwell goes per dwell interval; empty dwells fill what the targets leave. The Empty dwells share and `maxEmptyDwellsPerTargetDwell` are removed (stored values ignored). As built on `pca-simulator/m8` `e1b872b3`.
- **Updated 2026-11-16 (owner YV A; YW, YW2 A, YW3 A): function 50's scan and found targets, criteria 74 and 75.** **The Systematic scan turns with the platform** (YW): each cell's bearings are relative to the heading at its dwell, and the pass goes on from the same cell, in place of T-193's bearings planned at the pass's start, with which a band ran on outside the arc after a turn; an own dwell whose target is outside the arc is not sent and counts as a miss (YW2 A); Random is unchanged (YW3 A). A found target's own dwell is **centred on the target's true position at the dwell's time**, no longer on its last measured position; the detection it reports keeps its errors. Near the sensor the 1.7° dwell is narrow (about 150 m at 5 km), so a moving target, or one measured off by its errors, fell outside the dwell aimed at its last measurement, was missed 3 times and dropped.
- Read also:
  - **The decisions:** ADR-0040 (the simulator), ADR-0041 (moves not saved), ADR-0036 to ADR-0039 (connection tasks, links and output channels, declared fields, workspaces), and `docs/architecture/m3-simulator-decisions.md` (Q1 to Q30, A1 to A18; the Q and A numbers below are its).
  - **The SDK:** `docs/plugins/sdk-v1.md`, "SDK 1.2.0", and the design pattern's sections on workers, links and workspaces.
  - **The measurements:** `spikes/s6/README.md` (T-082).
  - **The receiving side:** `cot`'s M3 brief, functions 15 to 21.
- Built against **SDK 1.2.0 and data model 1.2.0** (frozen by the owner on 2026-10-26), **with POST endpoints**, which SDK 1.2.0 as frozen on 2026-10-26 did not have: CR-0026, approved by the owner and folded into SDK 1.2.0 (2026-10-26; open question 1). Where an SDK name here differs, the SDK wins.

## Purpose

A **simulator for training and demos**, in its own **Simulation** workspace (ADR-0039). A user:
- places symbols;
- draws routes with a speed and an altitude at each point;
- puts single objects, convoys or formations on the routes;
- attaches events to the route points;
- runs the simulation.

The simulated tracks are the **ground truth**. They show in Simulation, and leave emc2 through the **output channels** other plugins offer, CoT first (`cot`, ADR-0037). In the M3 demo they come back from the ESA's TAK Server into a View layer (Q20). Sensors that give a "detected objects" view come later.

## Kind and parts

- Kind: **general.** It moves objects in its own workspace and sends them through other plugins' channels. It has no connection of its own, so its manifest lists neither `ingoing` nor `outgoing`.
- **Server part:** the simulation engine. It runs once per second with no browser open (A2). It owns the simulation's state, moves the tracks, fires events, sends to the chosen outputs, saves, and serves the web part.
- **Web part:** the panels and actions of the Simulation workspace only (A15): routes, the route editor, outputs and control, the object action "Put on route", and the fading of hidden objects.

## Functions

### The Simulation workspace and its layers

1. **The workspace** (ADR-0039 point 1, A18). The manifest declares `simulator.simulation`, named "Simulation", with view permission `plugin.simulator.view` and edit permission `plugin.simulator.edit` (Q26). It comes after View in the tabs; users without the view permission do not see it.
2. **Layers.** The simulation lives in the layers of that workspace (Q29).
   - Users make them with `layer-panel` in Simulation, which marks them `simulator.simulation`.
   - **The first layer (from M4; BT, BX):** at its start, when Simulation has no layers, the server part creates one named "Simulation" there, with `context.defaultLabel()`, as ECore creates "Drawing" in View (`layer-panel` function 8). Otherwise the simulator makes no layers, and it never writes View's layers (A17).
   - **The server enforces the workspace** (ADR-0039 point 7, Q25): only users with `plugin.simulator.view` receive these layers and objects, and their changes need `plugin.simulator.edit`.
   - **The server part is not filtered**, so it keeps to the workspace itself. Every store query and subscription names the workspace (`inWorkspaces("simulator.simulation")`, ACA note N9), and nothing from it reaches a browser except through the store's filter or its own endpoints, which require `plugin.simulator.view`.
3. **Tracks are ordinary objects** (A7, ADR-0040 point 3), placed with `draw-symbols` in Simulation (Q27).
   - **The tracks of the simulation are the `core.symbol` objects in its layers.** Only they go on a route; the simulator never moves objects that came from CoT or other plugins (Q9).
   - **Objects on no route stand still and are sent too.**

### Routes

4. **A route is an object** (ADR-0040 point 4): a `core.shape` with a `LineString` through its points, of the data type `simulator.route`, in a simulation layer.
   - **The data type is declared in the manifest:** "Route", never faded or removed by expiry.
   - **Drawing:** the route editor draws a new route, and moves its points, with the map view's drawing and editing service (ADR-0033). A new route goes into the layer that is active in Simulation (open question 2). Each interaction gets an `AbortSignal` (CR-0020). It is aborted when the editor closes, another route is chosen, the route is deleted meanwhile, or the workspace changes, so no drawing is left open (CR-0025 part 1; the ACA's review of CR-0025, point 5).
   - **A new route** gets the name "Route N" (one more than the highest number), `dataSource` `manual`, and the server's default label (the SDK's default label), as `draw-shapes` does. Its style is a dashed line with circle markers at the points (`strokeDash`, `pointMarkers: circle`, data model 1.1.0).
   - **The route's definition is in the simulator's extension of the route object,** and that is where it is authoritative (open question 16: the groups and the points' events move there from the plugin's documents of ADR-0040 point 2). **It keeps only what users type** (the ACA's S1; function 6):
     - one entry per point: the speed's kind; the altitude in metres, or empty, with its kind; the value typed last, a speed in m/s or a time in seconds, counted from the previous point or from the route's start; with a time, the speed unit the user had chosen, for rounding (function 6); and the point's events;
     - the route's object list, with each object's group kind, and a convoy's spacing or a formation's offsets;
     - its end behaviour;
     - the move-or-disconnect choice of the last edit, with its number (function 9).

     A user changes it through change requests, so the server checks `plugin.simulator.edit` on it. When a point is inserted or deleted, its entry is inserted or deleted with it.
   - **The server part checks every route it reads,** since users write it:
     - one entry per point;
     - speeds from 0 to 2 000 m/s, altitudes from −1 000 to 30 000 m, and times up to 7 days, all finite, whatever unit is shown;
     - at most 1 000 points;
     - events that name objects of the route.

     The limits are the owner's (open question 17).

     A route that fails cannot run, and one that fails while it runs pauses (function 9b). The routes panel and the status say why.
   - **Routes are not sent** to outputs: they are not tracks.
5. **Speed and altitude per point** (ADR-0040 point 5, Q11):
   - each is **instant** (it applies when the point is reached) or **ramp** (it changes from the previous point on and reaches the value at the point);
   - a ramp on the first point acts as instant (Q11a);
   - a speed ramp has a constant acceleration; an altitude ramp changes in proportion to the distance (Q11b);
   - **an altitude may be left empty:** the object then keeps its own altitude (open question 7);
   - **speed 0, and ramps next to an empty altitude** (open question 13): a speed ramp may start or end at 0; an instant 0 only at the last point; every leg needs a mean speed above 0; an altitude ramp needs altitudes at both ends.
6. **The time helper** (Q12, Q13, A11). Instead of a speed, the user may type a time, counted from the previous point or from the route's start. The time must be at least the time at which the previous point is reached.
   - **The speed** is calculated from it, rounded to a whole unit of the speed unit the user had chosen when typing the time (Q13). Both are shown: the one not typed last is computed from the one typed (Q12, the ACA's reading in S1).
   - **When a point moves,** the value typed last for it stays fixed, and the other is recalculated.
   - **With a ramp,** a leg's mean speed is the mean of its two ends, so the editor says when a typed time cannot be reached (A11).
   - **The server part computes the derived values,** since only it has geodesics (SDK `Geodesy`, CR-0025 part 7; the web SDK has none).
     - The editor saves what the user typed at once, with a change request (function 4). The server part cannot read a user's units, so the unit for rounding travels with a typed time.
     - **The route keeps only what users type** (the ACA's S1). The server part computes the legs' lengths, the times, and the speeds from typed times, and uses them in the engine. **It never writes them into the route,** so they race with no user's edit, and moving a point costs no second update.
     - **It serves them through a GET endpoint** (function 24), with the route version it computed them from. The editor shows them when that version is the one it shows, and otherwise waits for the next.
     - When a point moves, the server part computes again from the new version, and the value typed last stays.
7. **Movement** (A9, A10): along geodesics between the points (`Geodesy.direct`, `path`), with sharp turns at the points.
   - **Altitude** is metres above the ellipsoid, as the third coordinate.
   - **At each tick**, a moved track gets its position, the symbol's `direction` (degrees from true north) and `speed` (m/s) modifiers, and `time.observed`, the tick's time.
8. **Units** (Q13; open question 18, the owner, 2026-10-26; from M4 BV, with m/s kept and the units in the browser, owner, 2026-10-30). Two unit selectors in the route editor's "All points" part: speed in km/h, knots, mph or m/s, and altitude in metres or feet.
   - **Display only:** the route always stores m/s and metres.
   - **Each user's choice is remembered in the browser** (local storage, kept per user), not in the setup. A user who has not chosen gets km/h and metres. Every value box, the route editor and the routes panel show them. Units saved in setups before M4 are ignored.
   - The limits of function 4 hold whatever unit is shown.
9. **Editing a route, also while it runs** (ADR-0040 point 6, Q14). When objects are on it, the user chooses one of two:
   - **they move with it:** they continue on the same leg, at the same fraction of its length;
   - **they are disconnected:** speed 0, altitude kept, in place, and taken off the route.

   **The choice travels in the same change request as the edit** (a field of the route's extension that the server part reads with the change), so it cannot arrive before or after the edit. It carries a number the editor raises with each edit, so the server part can tell an edit that brings a choice from one that leaves the field as it was (function 9b).
9a. **What users do to the simulation's objects** (CR-0025 part 8; open question 11 for a dragged track):
   - **A track deleted** during a run, or since the state was saved, is taken off its route, and its state is dropped. The status counts it.
   - **A route deleted** disconnects its objects: speed 0, in place.
   - **A track's fields edited by a user** stay as edited. Moves are built from the latest state (function 17), and a restart restores only the position, `direction`, `speed` and the simulator's own values (function 21).
   - **A layer** can be deleted only when it is empty, so it holds no tracks.
   - **The server part's own writes** are each built from the latest version it holds: "Put on route" and "Take off route" (function 10), taking a deleted route's objects off it (above), the events' updates (function 13) and the saves (function 20). A user's change in the moments before one can still be undone by it; that small window is accepted (the ACA's S1; owner, 2026-10-26).
9b. **Edits to a route by other plugins** (the ACA's S3). `draw-shapes` works in Simulation (Q27). Its Edit can reshape any `core.shape`, a route included, and change its data type and its layer. The server does not trust a browser, so the server part copes:
   - **An edit without the move-or-disconnect choice** (function 9), such as a reshape in `draw-shapes`: the objects move with the route, as with "move with it". An update by another plugin leaves the simulator's extension as it was (ADR-0018), so its choice number is not new, and the server part reads it as no choice.
   - **A route that becomes invalid while it runs** (function 4), for example through a point added without its entry: the route pauses, its objects stay in place, and the routes panel and the status say why.
   - **A route whose data type is changed** is no longer a route: as for a deleted route (function 9a), its objects are disconnected.
   - **A route moved to a layer outside Simulation** leaves the server part's queries, which name the workspace (function 2), so it is treated as deleted too. Moved to another simulation layer, it stays a route.
   - From M4 `draw-shapes` does not offer its Edit on `simulator.route` objects (its function 3; owner, 2026-10-30), since the route editor is where routes are edited. Its drag (T-066) still moves a route, and a client may send any change, so the simulator copes anyway.

### Groups on a route

10. **"Put on route"** (ADR-0040 point 7) is an object action in Simulation, for selected `core.symbol` objects in simulation layers, on the map or in the objects panel (ADR-0032). It needs `plugin.simulator.edit`.
    - **The user picks a route and a kind** (from M4 in a dialog over the map, function 22):
      - a single object, or each selected object on its own;
      - a **convoy**, with a spacing in metres;
      - a **formation**.
    - **An object is on one route at a time.** Putting it on another takes it off the first (open question 8).
    - **Where the objects start** (open question 9): at once, with a saved update. A single object and a formation's centre go to the route's first point, and a convoy waits there (function 11).
    - **Names** (T-121; owner, A73 to A78, confirmed DD), so that `cot` sends a callsign and the map and the lists show a name:
      - **who:** only an object whose name is absent or blank gets one; a named object keeps its own;
      - **the name:** `<route name>-<n>`, with n one more than the highest number that a symbol in Simulation has after that route's name, given in the order the objects are put; `Track-<n>` for a route without a name;
      - **written** by the server part with the saved update that places the object, so a caller of the endpoint gets it too; cut to the model's name length (256 characters);
      - **an ordinary name:** a reset does not undo it, "Take off route" keeps it, and an event may change or clear it (function 13); a cleared name is given again only at the next "Put on route".
    - **"Take off route"** is the counterpart, for selected objects on a route. It disconnects them as in function 9: speed 0, in place.
    - **The commands** go to the server part's endpoint, which requires `plugin.simulator.edit`. The server part writes the objects and their group into the route's extension (function 4). Its change carries no user, as for every server part (design pattern), so the endpoint's `requires` is what guards it.
11. **Convoy** (Q15, Q15b): the objects wait at the first point, and leave one by one in the order of the route's object list. Each leaves when the one ahead is the spacing away along the route, and follows the route's speeds where it is. With "stop" at the end, all stop at the last point.
12. **Formation** (Q16, A13): each object's offset from the group's centre is recorded relative to the direction of the first leg when it is assigned: forward, sideways and in altitude. **The centre** is the mean of the objects' positions and altitudes when they are assigned (open question 14).
    - **The centre follows the route,** and the shape turns with the direction of travel.
    - **Sharp turns:** objects far from the centre move unnaturally; that is accepted.
    - **Passing a point:** an object passes a point when its own place along the route (the centre's place plus its offset forward or back) reaches it.

### Events

13. **Events at route points** (ADR-0040 point 8, Q17, Q18, A12 to A14), only on routes with objects. Each event names the objects of the route it applies to (by default all), and fires for each as that object passes the point.
    - **Change a field:** any field the editor can edit (A12).
      - Core fields (the name, the description, the SIDC, the symbol's text modifiers) change through an ordinary update.
      - Other plugins' declared fields change through `Change.withFields` (ADR-0038), set in the editor with the web SDK's `DeclaredFields`. For example `cot`'s `team` and `role`.
    - **Hide:**
      - **On the object:** it stops where it is, and is marked hidden in the simulator's extension, through an ordinary saved update. That mark is authoritative, and so is what a reset restores, kept next to it (below).
      - **On emc2's map:** the Simulation map shows it faded (`MapView.createFadeList`).
      - **In the outputs:** they stop sending it, and each chosen channel gets a `Removal`, which a channel that can (`DELETE`) sends as a delete.
      - **Afterwards:** it stays in its route's list (A14). Put on a route again, it is shown and sent again (Q18).
    - **What changes reset puts back** (amended with the owner's decision of 2026-10-27): the first value each event replaced (also that a field was absent) is kept on the track, in the simulator's extension next to the hidden mark, and written in the same saved update as the event's change, so it survives any crash. A reset writes those values back, shows the track again, and clears both.

### Control

14. **Start, pause and reset** (ADR-0040 point 9, Q19), per route and for all routes. They need `plugin.simulator.run`, checked by the server on the command's endpoint.
    - **Reset** puts back every object of the route where it started, restores the values events changed, shows the hidden objects again, and leaves the route paused.
    - **At the end** a route either **stops** (A9: the objects stay at the last point with speed 0, and are still sent) or **restarts** (a reset followed by a start, so events fire again). Which one is set per route; the default is "stop" (open question 12).
    - **A route stopped at its end still counts as running** for sending (function 18): its tracks are still sent (A9, ADR-0040 point 9).
    - **M3 runs in real time only.**
15. **One shared simulation per server** (Q10): everyone with `plugin.simulator.view` sees its routes and tracks live. It survives a server restart, paused (function 21). Named scenarios and a speed factor come later.

### The engine

16. **Once per second, without a browser** (ADR-0040 point 1, A2). One worker owns the simulation's state, and a timer (`timers().every`, 1 s) ticks it. The plugin creates no thread of its own (rule C1).
    - **A tick moves its tracks to where they are at the tick's wall-clock time,** so a late tick does not slow the simulation.
    - **Heavy work goes to a compute worker** (rule C7), if the geodesics of a tick need it. The PCA measures it.
17. **Moves as ordinary updates, in one burst per tick** (spike S6, proposals 3 and 4).
    - **Each tick submits all its moves at once,** each with `Change.updateObject(…).notSaved()` (function 19). There is no batched submit and no spreading over the second.
    - **At most one change per track is in flight.** A track still waiting at the next tick is skipped and counted.
    - **Each move is built from the latest state the worker holds** (its store subscription). A move refused because the object changed meanwhile (an unsaved update may change only a move, ADR-0041 point 1) is counted, and the next tick uses the new state.
    - **The target is 1 000 tracks at 1 Hz** (Q4). S6 measured about 5 % of a core: submit to answer p95 15 ms, and every tick answered within 44 ms; on a saturated machine, at most 82 ms.
    - **The SDK's limits apply:**
      - **Store subscriptions:** at most `Store.MAX_PENDING_UPDATES` (1 000) undelivered updates per subscription. Beyond that, ECore drops them and delivers a new snapshot. The simulator's subscription also receives its own moves, so at 1 000 tracks it may reach that limit (how ECore counts batched updates against it is the CDA's). S6's stand-in subscription never fell behind, but did almost no work; criterion 21 expects no new snapshot at 1 000 tracks (the ACA's S4). **The worker must treat a new snapshot as replacing what it holds,** and the PCA tests it with the test kit.
      - **Channels:** `Channels.MAX_PENDING` (10 000) items waiting for a channel; beyond that the oldest is dropped, and `send` answers `DROPPED`.
      - **Asks:** 10 000 outstanding (CR-0005).
      - **Plugin documents:** 1 MiB each. The state of 1 000 tracks is split over several documents if it does not fit.
17a. **Status** (monitor view):
    - the simulation's state, and each route's;
    - the last tick's duration, and the moves submitted, skipped, refused and answered;
    - new snapshots received;
    - the chosen outputs, with the missing ones;
    - the items sent and refused (`CLOSED`, `DROPPED`);
    - routes that cannot run, and why;
    - tracks dropped because they were deleted (function 9a).

    It warns when a tick takes longer than half a second.

### Outputs

18. **Outputs** (ADR-0040 point 10, Q3b, ADR-0037 point 4).
    - **Finding them:** the simulator watches the output channels (`context.channels().watch`).
    - **Choosing them:** users with `plugin.simulator.edit` choose the simulation's outputs in the Outputs panel. It lists each channel's display name, plugin, output type, whether it can send a delete, and the fields it uses.
    - **Keeping the choice:** it is saved by `ChannelId` (plugin and link). **A chosen channel that disappears,** because its link was renamed, removed or disabled, **is shown as missing, not dropped** (ACA note N8). It is used again if the same id comes back; the user may remove it.
    - **What it sends:** at each tick, an `Update` with every track's content to each chosen channel, hidden ones excepted (function 13). `send` never blocks, and `CLOSED` marks the channel missing.
    - **Stale time:** each item's content has `time.expires` set to the tick's time plus the admin setting `outputStaleSeconds` (open question 3), which applies to everything the simulator sends to outputs, so that a paused simulation's tracks go stale in TAK (A8; `cot` takes the expiry as its stale time). Only the item carries that expiry, never the stored object, so the Simulation map does not fade the tracks and ECore does not remove them.
    - **When it sends** (open question 4): while the simulation runs, from a start until every route is paused or reset, every track at each tick, hidden ones excepted, also those of paused routes. A route stopped at its end counts as running (function 14), and so do objects on no route while the simulation runs (function 3).
    - **Every item goes out at the channel,** also when its content is unchanged: `cot` sends channel items as they come (its function 19, as narrowed by the owner on 2026-10-26). So a standing track stays fresh at the receiver.
    - **Classification:** each output link applies its own highest classification (ADR-0037 point 8; `cot` function 20). The simulator adds no limit of its own (open question 5).
    - **Declared fields of a channel's protocol,** such as `cot`'s Callsign, `team`, `role` and `staleSeconds`, are set on the tracks in `draw-symbols`' field-set editor or by events (function 26). **From M5** the Outputs panel names each channel's field set (`ChannelInfo.fieldSet`, ADR-0050 point 7), and function 31 says what the simulator does with it.
    - **From M5 these are the Ground truth outputs** (ADR-0048 point 6; A12): the panel is named "Ground truth outputs" and lists the channels that take ground truth (`ChannelInfo.takes(GROUND_TRUTH)`). Sensor outputs are chosen per sensor (function 29).

### Saving and restarting (ADR-0041)

19. **A running simulation's moves are not saved.** They use `Change.notSaved()`: only position, `time`, `direction` and `speed` (ADR-0041 point 1). **Only the simulator uses it in M3** (ADR-0041 point 7). Everything else is saved as usual: hiding, field changes, assignments and route edits.
20. **The simulator saves its tracks and its own state together** (ADR-0041 point 4):
    - **The saving moments:**
      - before a route runs;
      - when a route pauses, stops at its end, or is reset;
      - when a user changes the simulation while it runs: its routes, groups, events or outputs;
      - **when it changes while everything is paused** (open question 15): put on route, take off route, the choice of outputs, a reset. The ACA adds this to ADR-0041's index row.
    - **What a save covers:** all its tracks, as ordinary updates of their current state, and its whole own state in its plugin documents, whichever route caused it. The own state is what "Where the state lives" (below) puts in the documents.
    - **There are no periodic saves.**
    - **Where the state lives:** the route objects hold the routes, their groups and their points' events (function 4, open question 16), and the tracks hold their hidden mark and what a reset restores (function 13; amended with the owner's decision of 2026-10-27). The documents hold the rest: each track's progress, the run states, the events fired, and the chosen outputs.
21. **After a restart, its own state is the source** (ADR-0041 point 5).
    - **When the plugin starts, and when its worker restarts,** it places every track where its saved state says, with ordinary saved updates, and the whole simulation is paused.
    - **Objects changed since the save** (CR-0025 part 8; function 9a):
      - a track deleted meanwhile is dropped from the state and counted;
      - a track a user edited keeps its fields, and only its position, `direction`, `speed` and the simulator's own values are set;
      - a track the state does not know, and on no route's list, stays where it is, on no route.
    - **The routes' lists decide which objects are on which route** (the ACA's S2), since a route's list is saved with each change and the documents only at the saving moments:
      - an object on a list without saved progress is placed as "Put on route" places it (open question 9);
      - saved progress for an object on no list is dropped;
      - saved progress for another route than the one whose list now names the object counts as none, so the object is placed as "Put on route" places it.
    - **A clean server stop is best effort** (ADR-0041 point 6): `stop()` pauses and saves, but ECore does not guarantee that those saves are applied. After a clean stop or a crash during a run, the simulation comes back at its last saved moment.

### The web part

22. **Panels**, in Simulation only (`workspaces: ['simulator.simulation']`, A15). Each works in every pane (ADR-0031 point 4). **Default panes** (from M4, BS; the event panel: owner, 2026-10-30): "Routes" the left pane; the route editor, "Outputs" and the event panel the right.
    - **Routes:** the routes with their state (running, paused, stopped at the end, and why one cannot run), the controls per route and for all, and each route's end behaviour, in the user's units (function 8). "New route" opens the editor.
    - **Route editor:**
      - **per point:** speed and altitude with instant or ramp, the time helper, the computed length, time and speed from the server part (function 6), and the point's events, in the user's units (function 8);
      - **the route's object list**, in convoy order;
      - **the move-or-disconnect question** of function 9;
      - **from M4** (the owner's M4 notes, 2026-10-30): "Reshape" sits right-aligned on the row of "At the end"; the point stepper's up arrow goes to the next point and its down arrow to the previous one (the other way round since T-088); the two unit selectors of function 8 are in "All points".
    - **Outputs:** the channel list of function 18, with missing channels marked, and the declared fields each channel uses.
    - **Events:** an event's kind, its objects, and for "change a field" the core fields and the `DeclaredFields` editor (ADR-0038 point 5). The ACA's W3 check of `DeclaredFields` in a browser, in the three looks light and dark, is done here if `draw-symbols` has not done it first.
    - **The object actions "Put on route" and "Take off route"** (function 10), with `workspaces: ['simulator.simulation']`.
      - **"Put on route" opens as a dialog over the map** (from M4, the owner's M4 notes), no longer as a panel: a Map Pane overlay at the top right (`ctx.ui.addMapPaneOverlay`, in Simulation, shown only while open, after the corner's icons in `order`), so that it sits at the map's right edge with a small gap to the right pane. It has a close button, and Escape in it closes it.
      - **A route's menu** (from M4; owner, 2026-10-30): "Edit route" is the only edit item on a route, since `draw-shapes` no longer offers its Edit there (its function 3). The map view's Centre on and Zoom to, and the shell's Delete, stay.
    - **Hidden objects** are faded on the Simulation map through a fade list, which the web part sets from the simulator's extension in the live picture (CR-0025 part 6).
    - **On a switch** the map view clears every fade list, and this subscription gets no fresh snapshot (it names its workspace), so the web part sets its fade list again from `ctx.workspace.onChange`, from what it holds (added with the owner's approval of 2026-10-27; the ACA's U2, `map-view-2d` function 24).
    - **The web part's live picture names its workspace** (`LivePictureOptions.workspaces: ['simulator.simulation']`, CR-0025 part 5), so it holds only the simulation's objects, whichever workspace is shown.
23. **Read-only for those without the rights.** Users without `plugin.simulator.edit` see the panels read-only, and those without `plugin.simulator.run` see the controls disabled. The server checks every command and change anyway (overview 4.4).
24. **Talking to the server part.** Data the user edits on objects (routes, their points, values and events) goes through change requests. The commands go to the server part's endpoints:
    - start, pause and reset;
    - put on route, and take off route (disconnect, function 10);
    - choose outputs.

    The state the web part shows comes from GET endpoints that require `plugin.simulator.view`: the routes' states, the computed lengths, times and speeds with the route version they come from (function 6), the channel list and the chosen outputs.
    - **The commands are POST endpoints** with a JSON body and `requires(permission)` (open question 1, decided: CR-0026, a compatible addition folded into SDK 1.2.0). Until CR-0026 is built (the SDK side, then the CDA's edge), the commands cannot be built; nothing in the brief falls back to state-changing GET requests.
    - **Endpoints take nothing from the browser that names a host,** and check every id they receive against the simulation's own objects.
25. **Locked layers** (ADR-0042 point 8; the owner's answers to the PDA, 2026-10-30). A layer is locked while its `locked` is `true` (SDK 1.3.0). The route editor's changes are a user's change requests (function 24), so the store refuses them for a locked layer with `LAYER_LOCKED`:
    - **"New route"** is disabled while Simulation's active layer is locked, with the title `The active layer "<name>" is locked`; a drawing that runs when it becomes locked is ended with its `signal`, and nothing is sent.
    - **"Edit route"** on a route in a locked layer opens the route editor **read only**: the values and the points read only, no Reshape, no Save, and a notice `Layer "<name>" is locked`. It follows the lock live, as `draw-symbols`' properties do.
    - **The commands pass the lock** (BW; ADR-0042 point 5): they act through the server part, so put on route, start, pause and the moves still change tracks and routes in a locked layer. They change only what their purpose needs, and check every id against the simulation's own objects (function 24).
    - **A `LAYER_LOCKED` rejection** is shown like any other.
26. **Every field set** (SDK 1.4.0 part 3, ADR-0050; the owner's ID, 2026-11-06; before: SDK 1.3.0's "Other fields", T-106). Where the plugin shows the shared `DeclaredFields` editor (an event's "change a field", function 22), it passes **every declared field set as settable**: `fieldSets={ctx.fieldSets}` and `objectSets` with all their ids, and **no `onAddSet`, so there is no drop-down and no "+"**. So an event can still set any other plugin's fields that belong to a set (for example `cot`'s Callsign, `team`, `role` and `staleSeconds` in "CoT unit"). The fields that name the track's data type come first; **a field in no set and not of the data type stays hidden.**
    - **The plugin's part:** a `key` per edited event or track on the editor, so that it starts afresh for each.
    - **What is sent is unchanged:** only the changed fields (`changedFields`); an emptied field is `null` if it had a value and nothing otherwise; a yes/no set and cleared again is `false`. **An event that sets a field does not add the field's set to the track; the output channel's set does** (owner, IE, 2026-11-06; function 31).
    - **Read only** (function 23, function 25): every field read only.

## Functions (M5)

Built against SDK 1.4.0 (`sdk-v1.md`, "SDK 1.4.0": the output kinds and `ChannelItem.SensorReport` of part 1, field sets and relations of part 3). Read with ADR-0048 points 6 and 7, ADR-0051 point 8, the `gmti` brief, and the ACA's GMTI reference `docs/architecture/gmti-4607.md` (section 4.3: what `gmti` makes of a sensor report).

27. **GMTI sensors and the Sensors panel** (ADR-0048 point 7; owner, Q5). A new panel **"Sensors"** in Simulation (default pane: right) lists the simulation's sensors by their platform's name. Users with `plugin.simulator.edit` add, change and remove them; the others see it read only (function 23).
    - **A sensor's platform is a track** in a simulation layer, chosen from the selection ("New sensor" with one track selected). It moves on a route as any track. A track is the platform of at most one sensor. When the track is deleted, its sensor stays, shown as missing, and does nothing.
    - **Its settings** (A10; each with its unit and limits). **The Sensors panel shows** the minimum detectable speed in the user's speed unit (function 8), the ranges in km and the errors in m (owner, KW, 2026-11-08); the values are kept in SI units (function 28's "Generic settings"):

      | Setting | Default | Limits |
      |---|---|---|
      | Revisit time | 10 s | 1 to 600 s |
      | Range band (min, max) | 20 km to 150 km | 0 to 1 000 km, min < max |
      | Bearings from the platform's heading (start, end), clockwise | **0° to 360°, all round** (from M7, T-178, function 42; 45° to 135°, right-looking, before) | 0° to 360°; an end below the start wraps across north, e.g. 300° to 60° (the ACA's R4); **equal bearings look all round** (owner, MX, 2026-11-09; function 28) |
      | Probability of detection | 0.9 | 0 to 1 |
      | Range error, cross-range error (one sigma) | 20 m, 50 m | 0 to 10 000 m; **0 is no error** (A100) |
      | Minimum detectable speed | 2 m/s | 0 to 100 m/s |
      | Most detections per dwell | 200 | 1 to 1 024 (CR-0031: the most relations one object carries) |
      | **Mission** (CR-0034) | empty (none) | 0 to 64 characters, any letters; no output's limit or hint here (JQ): each output fits it to its format |
      | **Detect all in range** (owner, Q9) | off | a check box |

    - **Saved** with the simulator's own state (function 20), as routes' groups and events are, and restored after a restart.
28. **What a revisit detects** (ADR-0048 point 7; A9). While the simulation runs, at each revisit time of its own (counted from the start), a sensor whose platform exists looks at its **dwell area**: an `ArcBand` centred on the platform's position, from the min to the max range, between the two bearings added to the platform's heading (owner, Q6; the heading is the track's `direction`, 0 when it has none). It turns and moves with the platform.
    - **Equal bearings look all round** (owner, MX, 2026-11-09): when the start bearing equals the end, the dwell area is the whole ring from the min to the max range, an `ArcBand` with equal bearings (`map-view-2d` draws it as the full ring, its function 36), in detection as in the drawing (function 33). Only the range and the minimum speed then decide what is inside.
    - **Detected:** each track of the simulation (not hidden, function 13), **of any type** (owner, KW, 2026-11-08, changing A99), inside the area, whose radial speed towards or away from the platform is at least the minimum detectable speed, with the probability of detection (one draw per track and revisit).
    - **Each output decides what it sends** (A99): the sensor sends every detected track, and an output that cannot carry a type says so in its own brief (`gmti` maps the symbol to a 4607 class, G13; STANAG 4607 has classes for aircraft too). A warning for unit types an output does not carry (A105) waits for a later way for an output to declare the types it takes.
    - **Measured position:** the true position moved by a Gaussian error along the line from the platform (range) and across it (cross-range), with the settings' sigmas. **A sigma of 0 is no error** (A100): that part of the position is not moved.
    - **Detect all in range** (owner, Q9): every track of the simulation within the max range, at any bearing, moving or not, is detected at every revisit at its **true** position: no probability, no minimum speed, no errors. Hidden tracks still are not. The dwell area is then a `Circle` of the max range round the platform.
    - **The reach is not cut for an output** (owner, Q15 and JS, 2026-11-07, replacing JI): the max range and "Detect all in range" apply as set, also when `gmti` is a chosen output. `gmti` keeps the area's near edge and cuts it 511.98 km beyond it, its `maxAreaDepth`, and drops the detections beyond, counted (its brief, "Out"; G12; CR-0035). Functions 29 and 30 warn and draw a line for the tracks an output leaves out.
    - **The cap:** at most "most detections per dwell", the nearest first; the rest are counted (`sensor detections over cap`), as `gmti` does above its cap.
    - **Random numbers** come from one seeded generator per sensor, so a test with a fixed seed sees the same detections.
    - **Generic settings** (owner, JQ, 2026-11-07): the sensor's settings (function 27) are physical values in SI units (errors in m, minimum detectable speed in m/s, the revisit time, the reach, the sector, the detection probability), with limits for sensors in general, not narrowed to STANAG 4607 or any other output format. Each output maps them to its own format; one whose field cannot hold a value says so in its own brief (`gmti`: "no statement", counted).
    - **The area's near edge** (CR-0035): its distance from the platform at its nearest point, the min range for the band and 0 with "Detect all in range" (a `Circle` round the platform). Function 29 compares an output's depth with it.
29. **Sensor outputs** (ADR-0048 point 6; A12). Each sensor chooses its outputs in the Sensors panel from the channels that take sensor reports (`ChannelInfo.takes(SENSOR_REPORTS)`: `gmti`, and `cot`, `ais` and `adsb` when they do), shown as missing when they go, as function 18 does.
    - **At each revisit,** one `ChannelItem.SensorReport` to each chosen channel: `sensorId` the platform's object id, `platform` its position (with altitude), `time` the revisit's time, `area` the dwell area, and one `Detection(trackId, content)` per detected track, the content the track's with the measured position as its `Point` (the CR-0030 decision Q7). **An empty report is sent too** (A12): it says the area was looked at.
    - **The sensor** (CR-0033): each report carries `ChannelItem.Sensor`, from the sensor's settings (function 27) and its platform track at the revisit's time: `name` the track's name (cut to 64 characters), or "GMTI sensor" when it has none; `mission` the sensor's Mission, absent when it is empty (CR-0034); `revisit` the revisit time; `rangeError`, `crossRangeError`, `minimumDetectableSpeed` and `detectionProbability` the settings; `platformDirection` and `platformSpeed` the track's `direction` and `speed`, absent when the track has none. **With "Detect all in range"** (Q9) it detects exactly, so it sends no errors and no minimum speed (absent) and a probability of 1. The values are the generic settings as they are (function 28's "Generic settings"); each receiver sends what its format holds (`gmti`'s brief, section 3, "Out").
    - **When it sends:** while the simulation runs, as function 18 says for ground truth; a paused simulation sends no reports. The content's `time.expires` is set as function 18 says.
    - **Beyond an output's depth** (CR-0035; owner, Q15, Q16, KL and KM). The goal: the operator sees when units in a sensor's coverage are not sent because an output's protocol cannot carry them.
      - **The output says how deep an area it carries:** `ChannelInfo.maxAreaDepth()`, in metres, `null` for no limit (`gmti`: 511 980 m). The simulator knows no format's limit (JQ).
      - **A detected track is beyond a chosen output's depth** when its **true** position lies farther from the platform than the area's near edge (function 28) plus that output's depth. That output leaves it out (`gmti`: its brief, section 3, "Out"). The distance is the SDK's geodesy (ADR-0019) from the report's `platform`.
      - **`gmti` measures the reported position** (the ACA's R2), so a track within the position error of the edge may fall on the other side; tests stay well off the edge.
      - **The report is sent as before**, to every chosen output, beyond tracks included: each output cuts by its own rule.
      - **The server part decides** (the ACA's R3), at each revisit and **at once when the sensor's outputs change**, or a chosen channel comes, goes or changes, with the last revisit's detected tracks. No distances in the browser.
      - **The warning** (owner, Q15 and KL). While a chosen output leaves out a detected track of the last revisit, a text at the bottom of the Simulation map pane names the sensor and the output and says that some units are out of its range, **without numbers**, e.g. "Hawk 1: some units are out of range for VISTA (out)". There is one line per sensor and output.
        - It is a Map Pane overlay (SDK 1.3.0, as ADR-0052 uses it), shown only while there is a line, so no SDK member is needed.
        - The web part reads the lines from the GET endpoint that serves the Sensors panel's sensors: per sensor, `outOfRange`, the names of the chosen outputs that leave some of its tracks out.
        - The text goes when no chosen output leaves a track out: `gmti` deselected, the tracks nearer, or the simulation stopped.
30. **The pairing on the platform** (ADR-0051 point 8; A11). At each revisit the sensor sets its platform's `relations` of kind `gmti.pairing` to the tracks it detected (`Relation.replace`, keeping other kinds' entries), and to none when it saw nothing. It writes them **only when `gmti.pairing` is declared** (`context.relationKinds()`), that is when `gmti` is loaded; otherwise it writes none and says so once in its status.
    - **Beyond an output's depth** (CR-0035; owner, Q17; ADR-0051 points 3 and 10). The manifest declares the simulator's own kind `{ "id": "simulator.beyond-reach", "label": "Beyond output reach", "line": { "strokeColor": "#FF0000", "strokeWidth": 1 }, "defaultOn": true }`.
      - **Which kind a track gets:** a detected track beyond a chosen output's depth (function 29) gets a relation of kind `simulator.beyond-reach` **in place of** `gmti.pairing`, so each track keeps one line. The other detected tracks get `gmti.pairing` as above.
      - **How it writes them:** both kinds are written with `Relation.replace` at each revisit, and at once when function 29's result changes without a revisit.
      - **When nothing is beyond:** when no chosen output's depth is exceeded, for example when `gmti` is deselected, every detected track gets `gmti.pairing` again and `simulator.beyond-reach` holds none.
      - **Without `gmti.pairing`:** the kind is the simulator's own, so it is written also when `gmti.pairing` is not declared.
    - **The defaults** (the ACA's R5): `simulator.beyond-reach` is on by default and `gmti.pairing` off. A user who has not switched the pairing on sees the red lines alone: the owner's intent, a warning that shows itself. The Display settings window shows both switches (ADR-0052).
    - **The revisit's update of the platform is an ordinary, saved update** (the ACA's R2): it changes `relations`, and ADR-0041 point 1 keeps the not-saved mark for moves only (the store refuses a not-saved update that changes more). The ticks between revisits stay unsaved moves (function 19). R4's measurement below covers the cost; if it is too much, extending ADR-0041 is the owner's, through a CR.
    - **Measured** (the ACA's R4 on CR-0031): one sensor with 200 tracks in its area at a 10 s revisit, the extra bytes per revisit (about 70 per relation) and the tick's time, recorded in the handover; the default of 200 detections per dwell may be lowered if it costs too much.
    - Every update the simulator sends of any object **forwards the stored `relations` and `fieldSets`** (ADR-0051 point 9): it builds from the current content and changes only what it means to.
31. **The channels' field sets** (ADR-0050 point 7; the ACA's R7 on part 3). The server part's list of channels for the web part carries each channel's `fieldSet`, and the Ground truth outputs and the Sensors panel show its label. **Each item sent to a channel lists the channel's set** in its content's `fieldSets` (only the item, never the stored track), so the receiver sees which of its fields the track carries. The event panel offers every set (function 26).
32. **Scenarios** (T-143; owner, GJ, Q7; A13). The Simulation workspace's routes, tracks, sensors, events, groups, chosen outputs and other objects as one file of emc2's own versioned JSON:
    - **The file:** `{ "format": "emcc-simulator-scenario", "version": 1, "name", "exportedAt", "layers": [...], "objects": [...], "simulator": {...} }`: the Simulation workspace's layers (with their labels, order and lock), every object in them (the full content, `relations` and `fieldSets` included), and the simulator's own state (groups, events, outputs by `ChannelId`, sensors with every setting, the Mission included (CR-0034); a file without a Mission imports with none). The README documents the format; a newer `version` is refused with a message.
    - **Where** (owner, LJ, 2026-11-08): **two buttons in the Routes panel**, "Export scenario" and "Import scenario", in M5. A Scenario button in the top bar, and an SDK way for a plugin to add a top-bar button for all or chosen workspaces, is T-152: **from M7 (SDK 1.6.0) the top-bar item of function 48 replaces the two buttons.**
    - **Export** (the "Export scenario" button; `plugin.simulator.view`): built in the browser from the live picture and the simulator's state (a GET endpoint), saved as `<name>.emcc-scenario.json`.
    - **Import** (the "Import scenario" button; `plugin.simulator.edit` and `plugin.simulator.run`), in the browser, with two choices:
      - **As new** (owner, Q7): the simulation is reset, then, after a confirmation that names what goes ("Delete N layers and M objects of Simulation?"), the browser deletes the Simulation workspace's objects and layers with ordinary change requests, and creates the scenario's;
      - **Merge:** the scenario's layers and objects are added beside the current ones.
      - Either way every id is new: objects and layers get new UUIDs, and every reference to them (a track's route, an event's tracks, a sensor's platform, `relations`) is remapped; a relation to an object not in the file is dropped.
      - **Objects and layers go as ordinary change requests** (A13), one in flight per object, so the file has no size limit of its own; locked layers and labels are the store's to refuse, each refusal listed. The simulator's state goes through a POST endpoint (at most 1 MiB, the SDK's limit; a larger one is refused before anything is changed).
      - Outputs and sensors' outputs whose channels do not exist on this server are kept, shown as missing (function 18).
      - Import works only while the simulation is reset or paused.

33. **A sensor's coverage on the map** (T-158; owner, 2026-11-09). In Simulation, each sensor's coverage is drawn round its platform's current position: the area function 28 looks at, from the min to the max range, between the two bearings added to the platform's heading, or with "Detect all in range" the disc of the max range. It moves and turns with the platform.
    - **A map overlay drawn by the web part** (Q25 A): one overlay of the simulator's (`MapView.createOverlay`), with one `area` item per sensor (SDK 1.4.0 part 6), in Simulation only; it is cleared while another workspace is shown. It is not an object: not stored, not sent to any output, not in a scenario's file, and not picked (a click goes to what lies below).
    - **From what the browser has:** the sensors' settings from the GET endpoint that serves the Sensors panel, and each platform's position and `direction` (0 when it has none) from the live picture. Redrawn when a platform moves or turns, and when a sensor is added, changed or removed. A sensor whose platform is missing (function 27) has none.
    - **The geometry:** one exterior ring per area: the outer arc clockwise from the start to the end bearing, then the inner arc back; with a min range of 0, the platform's position in place of the inner arc. With equal bearings, the full ring between the two circles (owner, MX; function 28), the inner circle a hole; the disc is the outer circle alone. A band across north (e.g. 300° to 60°) is drawn across north. The arcs' positions are at most 1° apart, from an ellipsoidal (WGS84) direct geodesic in the web part's own code, each within 1 m of what the server's `Geodesy` (ADR-0019) gives; the edges between them are geodesic (model rule 10). The drawing is for the eye only: no detection or warning is decided in the browser (the ACA's R3 on CR-0035 stands).
    - **The look** (Q26 A, Q27 A): a dashed outline (`strokeDash: 'dash'`), 1.5 px, no fill, in the platform's standard identity colour (M5 to M7; from M7 function 46's colour, from M8 by default its fixed `#FD0909`): APP-6's medium frame colours, as `gmti` draws its dwell area (yellow for unknown and pending, `#00A8DC` for friend and assumed friend, `#00E200` for neutral, `#FF3031` for suspect and hostile).
    - **On by default, with a switch** (Q28 A): a check box "Show coverage" at the top of the Sensors panel, on by default, for each user, kept in the user's own documents (`ctx.userDocuments`), so it follows the user to another browser. Read-only users have it too: it changes nothing shared. The overlay is drawn also while the panel is closed.
    - **Always** (Q29 A): while the simulation runs, is paused and is reset, so that a scenario can be planned before it runs.
    - **The server part is unchanged.**
**Out of scope (M5):** other sensor types (radar for air, AIS receivers); terrain masking and the Earth's curvature in the detection model (the `terrain` plugin is separate); the sensor's own platform errors; exporting View's layers; a scenario library on the server; a Scenario button in the top bar (T-152, M6; owner, LJ).

## Functions (M6)

Built against SDK 1.5.0 part 1 (`sdk-v1.md`, "SDK 1.5.0"; CR-0038), `sdkVersion` `^1.5.0` (SDK 1.5.0 since part 1, owner NP A).

34. **Routes are not chosen by hand** (CR-0038 point 6; T-165): the manifest's `simulator.route` gains `"manual": false`, so the editors leave it out of their data type select ("New route" makes routes, function 4). A route keeps the type in an editor that shows it (`draw-shapes`' Edit, function 9b). The store does not check it.
35. **The Event panel's fields, one set at a time** (CR-0038 points 5 and 8; replaces function 26's groups). The editor still gets every declared set as `objectSets` and no `onAddSet`, so there is no "+". It now shows a drop-down "Field set" of all the sets and the chosen set's fields, opening on the first set of the data type the event's objects share (`dataTypes={ctx.dataTypes}`, `dataType` theirs; with none shared, `core.general`, which opens on the first set in the list). The fields that name a data type no longer come first (point 8). What is sent, and read only, are as function 26 has them.

**Sensor types and the job area** (T-168, T-169; CR-0039 point 7, CR-0040; the owner's answers of 2026-11-10 in the PDA's session: Q35 to Q40 and A4 to A9). Built against SDK 1.5.0 part 3 (`ChannelItem.Sensor.jobArea` and `type`, `ChannelInfo.sensorTypes`, `SensorReport.Sequence`). **Priority rule** (owner, 2026-11-09): first, every target in range is sent; second, it looks like a real sensor.

36. **Sensor types** (T-169). **In M6, "New sensor" makes a ground radar** and asks for no type (owner, PX, 2026-11-11: no generic sensor in M6); the type choice comes with the generic sensor:
    - **Ground radar** (owner, Q36; `SensorType.GROUND_RADAR`, CR-0040 point 3): the M5 sensor, whose dwells are now computed from its targets (function 37). Its reports may go to `gmti` and to other outputs, `cot` among them.
    - **Generic sensor, later** (`SensorType.GENERIC`; not in M6, owner PX): a circular range that detects anything inside (function 38), for filtered sensor output to `cot` and later outputs. With it "New sensor" will ask for the type.
    - **Each report says which:** `Sensor.type` (function 29). The fallback name of a sensor whose track has none is "Ground radar" or "Generic sensor" (was "GMTI sensor").
    - **Outputs by type:** the Sensors panel offers a sensor only the channels whose `sensorTypes` take its type (empty takes every type; CR-0039 point 7). `gmti` takes ground radars only, so a generic sensor is never offered a `gmti` output. A chosen channel that no longer takes the type is shown as missing (function 18's rule).
    - **Saved sensors and old scenarios** (A7): a saved M5 sensor and a scenario file's sensor without a type become ground radars with their own values and the preset "Custom". The scenario format stays version 1: `type`, `preset`, function 37's settings and `jobArea` are new optional fields (function 32).
    - **A generic sensor in a scenario file** (from a later version, or written by hand; the owner's Q52 B): in M6 it is **left out**: not loaded, and named in the import's list as "<name>: generic sensors come later; not loaded". Its platform track and everything else in the file load as usual.
37. **The ground radar's dwells** (T-169; replaces function 28's one dwell per revisit over the whole area, for this type).
    - **Where it searches** (Q37 A): function 28's band and bearings from the heading (equal bearings look all round), and with a job area only the part inside it (Q38 A; function 39). Function 33 draws it as before.
    - **Its settings**, beside function 27's (Revisit time is now "Revisit interval", greyed in Systematic from M8, function 50); a new ground radar has a probability of detection of 1 and a minimum detectable speed of 0, so nothing is dropped (A5):

      | Setting | Default | Limits |
      |---|---|---|
      | Preset | Medium wedge | Default (from M8), Narrow wedge, Medium wedge, Wide wedge, Custom; choosing one sets the values below (from M8 three: the width, depth and interval; also the Mode and, for the Narrow wedge, the Target revisit, function 50), and changing any of them makes it "Custom" (A4) |
      | Search width | 40° | 1° to 360°: a dwell's width |
      | Dwell depth | 50 km | 1 to 1 000 km: a dwell's depth; at most the band's |
      | Dwell interval | 1 s | 0.1 to 60 s: the time one dwell takes |
      | ~~Empty dwells~~ | – | **Removed in M8** (T-196; owner, 2026-11-13, A): the revisit's count sets the empty dwells (function 44). A stored value and a scenario file's are read and ignored |
      | Mode (from M8, T-197) | Random | Random or Systematic (function 50) |
      | Target revisit (from M8, T-197) | 2 s | 0.5 to 60 s; shown in Systematic only (function 50) |

      | Preset (A4) | Search width | Dwell depth | Dwell interval |
      |---|---|---|---|
      | Default (from M8, T-191: M7's Narrow wedge) | 2° | 20 km | 0.2 s |
      | Narrow wedge (**from M8 like the AFSERS radar**, T-191; function 50) | **1.7°** | **95 km** | **0.1 s** |
      | Medium wedge | 40° | 50 km | 1 s |
      | Wide wedge (a fusion node's composite dwell) | 180° | the whole band | 4 s |

      Until M7 each preset also set the Empty dwells share (Narrow 80 %, Medium 20 %, Wide 0 %); from M8 the share is gone (T-196), and the presets set the three values, the Mode and, for the Narrow wedge, the Target revisit (function 50).

    - **Its targets:** at each revisit, the tracks function 28 detects in the search area (the minimum speed, the probability, the errors; or "Detect all in range" with its M5 meaning, A8). Each is in exactly one dwell of the revisit.
    - **Dwells with targets:** the targets are grouped by their bearing from the platform; each group's dwell is an `ArcBand` round the platform, the search width wide and the dwell depth deep, placed over its targets. **A dwell grows** wider or deeper when its targets need more, and **splits** into more dwells when it would hold more than "most detections per dwell" (A5). So no setting makes the radar miss a target (the priority rule). How the targets are grouped is PCA-simulator's choice within these rules; the tests check the rules.
    - **Empty dwells:** function 44 (from M7). **From M8 they fill the revisit's remaining dwells** (T-196), and the share and the admin's cap are removed. Each is of the nominal size, inside the search area, where it holds no target; none when the targets leave none (the owner's T-169). (M6: about the share of the revisit's dwells, next to a dwell with targets.)
    - **Time** (Q40 A): a revisit's dwells follow each other at the dwell interval, clockwise from the search area's start bearing. **From M8 a revisit in Random holds floor(revisit interval / dwell interval) dwells, at least one** (a Systematic pass holds its grid cells and its target dwells instead, back to back, function 50) (M8, T-196; owner, "fill the revisit", 2026-11-13, in PCA-simulator's session), so a sensor sends one dwell per dwell interval (10 a second at 0.1 s): the dwells with targets, then empty dwells filling the rest (function 44). A revisit lasts its dwells times the dwell interval, so the revisit interval, **longer only when its targets need more dwells** than that; the next starts when it ends. So no target is left out. (Until M7 the count was the dwells with targets and the share's empty ones, and a revisit lasted at least the revisit interval, with a pause.)
    - **Each dwell is one report** (CR-0040), sent at the tick its time has come (a tick may send several): `time` the dwell's time, `area` its `ArcBand`, its targets measured at their positions at that tick (the dwell grows to cover them), and `SensorReport.Sequence(revisit, dwell, lastOfRevisit)`. `Sensor.revisit` is the revisit interval.
    - **The pairing and the warning** (functions 29 and 30) are set at each revisit's last dwell, from all its targets.
38. **The generic sensor** (T-169; A6). **Not in M6** (owner, PX, 2026-11-11): kept here for a later milestone, and not built in M6:

    | Setting | Default | Limits |
    |---|---|---|
    | Revisit time | 10 s | 1 to 600 s |
    | Range | 50 km | 0.1 to 1 000 km |
    | Probability of detection | 1 | 0 to 1 |
    | Position error (one sigma) | 50 m | 0 to 10 000 m; 0 is no error |
    | Most detections per report | 200 | 1 to 1 024, as function 27's cap |
    | Mission | empty | as function 27 |

    - **What it detects:** at each revisit, each track of the simulation (not hidden), of any type, at any speed, within the range of the platform (and inside the job area when there is one, function 39), with the probability of detection.
    - **Measured position:** the true position moved by a Gaussian error of the sigma east and north; 0 is no error.
    - **One report per revisit,** without a sequence: `area` a `Circle` of the range round the platform; `Sensor.rangeError` and `crossRangeError` the position error, `detectionProbability` the setting, `revisit` the revisit time, no minimum speed. The cap, the pairing and the warning as functions 28 to 30.
    - **Its coverage** (function 33) is the disc of its range.
39. **A sensor's job area** (T-168; Q38 A, Q39 A). Any sensor may have one: the area it is tasked to cover.
    - **Four corners** (Q39 A): in the Sensors panel, "Draw job area" draws a rectangle (`MapView.draw('rectangle')`) and "Draw job area as four points" a polygon (`'polygon'`), refused with "A job area has four corners" unless it has exactly four; "Clear job area" removes it. Users with `plugin.simulator.edit` only.
    - **Saved** with the sensor (function 20) and in a scenario's file (function 32).
    - **It limits detection** (Q38 A): only tracks inside both the search area and the job area are detected; a ground radar's empty dwells have their centre inside it.
    - **Sent** on every report as `Sensor.jobArea`, a `Polygon` of the four corners in the order drawn, closed (CR-0039 point 7). `gmti` sends it as the job's bounding area (its brief, "Out"); other outputs may ignore it.
    - **Drawn** with the coverage (function 33), in Simulation (**from M7 function 41**: a faint fill and a 3 px dotted outline, in function 46's colour): a dotted outline (`strokeDash: 'dot'`), 1.5 px, no fill, in the platform's identity colour (M6; from M8 by default function 46's fixed colour), so that it differs from the dashed coverage.

40. **A moved simulated track stays where the user put it** (T-155; SDK 1.5.0 part 5, CR-0039 points 10 and 11; ADR-0053 point 8; owner, Q1 A). A user may move a track of the simulation into another layer of Simulation ("Move to layer…", ADR-0053; a move into another workspace's layer the store refuses). The simulator goes on moving it along its route **in that layer**: each step's update keeps the stored object's `layerId`. It is still one of the simulation's tracks, since those are the `core.symbol` objects in its layers (function 3). A copy is a new object, not on a route, and the simulator does not move it.


## Functions (M7)

The sensor package (T-177 to T-185; the owner's QI to QR, 2026-11-11), the Scenario button (T-152) and Append on a route (T-176).
- **Built against:** SDK 1.5.0 for functions 41 to 46, with no contract change: the overlay's `area`, `line` and `label` (SDK 1.4.0 part 6) and the plugin's own settings and endpoints. SDK 1.6.0 (CR-0041) for functions 47 to 49.
- **Category** (T-174): `simulation`, in the manifest from SDK 1.6.0 (CR-0041 part F).
- **Can start first, before SDK 1.6.0:** functions 41 to 46 (T-177, T-178, T-179, T-180, T-184, T-185). Functions 47 (T-182, part D), 48 (T-152, part F) and 49 (T-176, part B) wait for their parts.

41. **The job area easier to see** (T-177; owner, QI A). Replaces function 39's "Drawn" look. The job area is an overlay `area`, in Simulation, with:
    - **a faint fill** in its colour: `fillColor` the outline's colour, `fillOpacity` 0.15 (M7-S1);
    - **a thicker outline that stays dotted:** `strokeDash: 'dot'`, `strokeWidth` 3 (M7-S1);
    - its colour from function 46, by default its fixed `#BDCF3D` (from M8, T-189; the identity colour in M7).

    It is drawn before the coverage in the overlay's items, so the coverage's dashed line lies on top. A click still passes through it (function 33).
42. **A new ground radar looks all round** (T-178). Function 27's default bearings become **0° to 360°**.
    - **What counts as all round:** 0° to 360° does, in detection (function 28) and in the drawing (function 33), as equal bearings do (owner, MX). In general, any start and end whose difference is a whole multiple of 360°.
    - **What keeps its bearings:** saved sensors and scenario files keep their own.
    - **The presets** (function 37) do not set bearings.
43. **The simulator draws its dwells** (T-179; owner, QJ A). In Simulation, the web part also draws each ground radar's dwells (function 37) on its overlay, beside the coverage.
    - **What they are:** one overlay `area` per dwell, its `ArcBand` densified as function 33 densifies the coverage. Not objects: not stored, not sent to any output, not in a scenario's file, not picked.
    - **Which are drawn** (owner, Q57 A), as `gmti` drew a revisit's dwell areas in View in M6 and M7 (its brief, section 3, A9). The simulator keeps this rule for its overlay: from M8 `gmti` writes one area per dwell (T-195; again from M8 RC2, owner YI A, after M8 RC1's one per revisit, VD C), but the overlay draws at most one dwell per index per sensor, few enough:
      - per sensor, one per dwell index;
      - a dwell replaces the drawn dwell of the same index;
      - at a revisit's last dwell, the drawn dwells of higher indices go.

      So the latest revisit stays whole while the next sweeps across it. While paused they stay. On a reset, and for a removed sensor or a missing platform, they go.
    - **The look:** a 2 px solid outline, no fill, in function 46's dwell colour (from M8 by default `#7EF26A`, T-189; the identity colour in M7), as `gmti`'s dwell area from M7 (its T-181). So the dwells look the same in Simulation and, through `gmti` out → `gmti` in, in View. Dwells with targets and empty ones look alike (M7-S2).
    - **The switch:** a check box **"Show dwells"** in the Sensors panel, under "Show coverage", **on by default**, per user in `ctx.userDocuments` as "Show coverage" is (function 33). Read-only users have it too. From SDK 1.6.0 the display filter "Dwell areas" also hides them (function 47).
    - **From the server part:**
      - **What it keeps:** per sensor, the drawn set: each dwell index's latest dwell, with its `ArcBand`, time, revisit and dwell index. A revisit's last dwell removes the higher indices, as above. So its size is bounded by one revisit's dwells.
      - **The endpoint:** `GET /sensors/dwells`, with the same permission as the GET that serves the Sensors panel (function 33). It answers the drawn sets with a sequence number. `?since=<n>` answers only what changed after `n`, or 304 when nothing did.
      - **When the web part calls it:** about once a second while Simulation is shown and the simulation runs, and once after a pause, a reset or a switch back to Simulation.
      - **For the eye only:** the dwells reach the browser up to about a second late (function 33's R3 stands).
44. **Empty dwells over the whole search area** (T-180; owner, QK). Replaces function 37's "Empty dwells" bullet.
    - **The places** (M7-S3):
      - **The grid:** the search area (inside the job area when there is one) is divided into nominal dwells, each the search width wide and the dwell depth deep, in the revisit's order: clockwise from the search area's start bearing, and at one bearing from near to far.
      - **Which places count:** one that holds no target and does not overlap a dwell with targets. With a job area, one whose centre is inside it (function 39).
    - **Spread over the free places** (M7-S4):
      - with *k* free places and *e* empty dwells, every (*k*/*e*)-th place in the revisit's order;
      - the first at an offset from the revisit's random draw (the sensor's seed), so that successive revisits do not repeat each other.

      So a revisit sweeps like a scanning radar instead of clustering round its targets.
    - **How many** (M8, T-196; owner, "fill the revisit", 2026-11-13, in PCA-simulator's session): **the revisit's dwells (function 37's count) less its dwells with targets**; a revisit without targets is all empty dwells.
      - **Fewer free places than empty dwells:** the empty dwells take the free places again, in the same order and spread, until all are placed.
      - **No free place** (every place holds or overlaps a target): no empty dwell.
      - Until M7 the count was the "Empty dwells" share, at most "Most empty dwells per dwell with targets" times the dwells with targets, a revisit without targets counting as one (Q55 B, Q56 A).
    - **The admin setting `maxEmptyDwellsPerTargetDwell` is removed in M8** (T-196; owner, 2026-11-13, A), from Settings › Simulator, with the sensor's share (function 37): neither sets the count any more. A stored value is read and ignored.
    - **Time:** as function 37: one dwell per dwell interval, a revisit as long as the revisit interval unless its targets need more dwells.
    - **M7's Narrow wedge preset:** search width **2°** instead of 5° (function 37's preset table; **from M8 this is the Default preset**, and the Narrow wedge takes the AFSERS values, function 50).
      - A saved sensor keeps its values.
      - Its preset shows "Custom" when they no longer match a preset (M7-S5).
45. **Bearings and range on the map, and a live preview** (T-184; owner, QP A).
    - **Labels** on the coverage, shown with "Show coverage", as overlay `label` items (SDK 1.4.0 part 6):
      - **The bearings:** the start and end bearing, as set in the Sensors panel (from the platform's heading, M7-S6), in whole degrees, e.g. "45°" and "135°". Each at the middle of its straight edge. None when the sensor looks all round (function 42).
      - **The ranges:** the min and the max range at the middle of their arcs, in km with at most one decimal, e.g. "50 km" or "12.5 km". No min label when the min range is 0.
      - **The look:** in the coverage's colour (function 46), size 12, the map view's halo.
      - **When the platform moves:** they move and turn with the coverage.
      - **The caps:** they count against the overlay's caps (`overlayProblem`), with the areas.
    - **A live preview:** while a sensor is edited in the Sensors panel, its coverage, its labels and its job area are drawn again at once from the values in the fields, before saving.
      - **An invalid field** keeps the last valid drawing.
      - **Leaving the edit** without saving brings back the saved sensor's.
      - **Only in this browser.** Nothing is sent until the user saves (function 27).
46. **Colours** (T-185; owner, QQ A, QR A, and "also the simulator's dwells"). Three admin settings in Settings › Simulator, the same for every user:
    - **`jobAreaColour`:** the job area's outline and its faint fill (function 41);
    - **`coverageColour`:** the sensors' coverage (function 33) and its labels (function 45);
    - **`dwellColour`:** the dwells (function 43).

    Each is `{ "use": "identity" | "fixed", "colour": "#RRGGBB" }`:
    - **`use`** is **`fixed` by default from M8** (T-189; owner SV A): `dwellColour` **`#7EF26A`**, `coverageColour` **`#FD0909`** (the range sector) and `jobAreaColour` **`#BDCF3D`**, as `gmti`'s in View. `identity`, the identity colours of M7 (function 33's APP-6 medium frame colours; owner, QR and Q63), stays selectable.
    - **`colour`** is shown only with `fixed` (`visibleWhen`, SDK 1.5.0). Its schema default is, **from M8**, the setting's fixed colour: `#7EF26A` for `dwellColour`, `#FD0909` for `coverageColour`, `#BDCF3D` for `jobAreaColour` (T-189). In M7 it was `#FFFF00`, the identity colour of an unknown platform, so that every default was one of the identity colours (M7-S7, owner Q63, superseded by T-189).
    - **In the form,** from CR-0041 part F a colour picker (`"x-emc2": { "kind": "colour" }`; owner, Q60 A). Before it, or without it, a text field with the pattern `^#[0-9A-Fa-f]{6}$`.
    - **A change** applies at once in every browser (`ctx.onSettingsChange`), without a reload.
47. **Display filters** (T-182; owner, QN B; SDK 1.6.0, CR-0041 part D; the mark: owner, Q58 A). The simulator marks its overlay items with `displayClass`:
    - the coverage, its labels and the job area: `sensor-coverage`;
    - the dwells: `dwell-area`.

    The map view hides each class while the user's display switch for it, "Sensor coverage" or "Dwell areas", is off (`map-view-2d` function 40). The switches are on by default. The Sensors panel's "Show coverage" and "Show dwells" stay: an item is drawn only when both its check box and its class's switch are on.
48. **The Scenario button** (T-152; SDK 1.6.0, CR-0041 part F). Replaces function 32's two buttons in the Routes panel.
    - **The item:** **"Scenario"** in the top bar, `ctx.ui.addTopBarItem({ id: 'scenario', order: 20, workspaces: ['simulator.simulation'], … })`, so it shows in Simulation only, beside the bookmarks (order 0) and the setups.
    - **Its menu:** "Export scenario…" and "Import scenario…", which do exactly what function 32's buttons do, with the same permissions. Each is greyed with its reason for a user who may not.
    - **Until SDK 1.6.0** the buttons stay in the Routes panel. With the top-bar item they go from the panel.
49. **Append on a route** (T-176; SDK 1.6.0, CR-0041 part B, `MapView.append`; owner, Q61 A).
    - **Where:** `draw-shapes` does not offer its Edit on routes (function 9b; its function 3). So the route editor gets **"Append"** beside its "Reshape" (criterion 28's row).
    - **What it does:** it continues the route from its last point, click by click (`map-view-2d` function 44), and on finish sends one update of the route as the route editor's edits do (function 9, with its move-or-disconnect choice when objects are on it).
    - **The new points** take the last point's entry (its speed and the other values function 4 keeps per point), so the route stays valid (function 4).
    - **When it is off:** on a locked layer and without `plugin.simulator.edit`, with its title, as Reshape.
    - **Edits by others:** a route continued by another plugin is a reshape by another plugin (function 9b). A point without its entry pauses the route, and the routes panel says why.

## Functions (M8)

50. **A ground radar's Mode, and the Narrow wedge like AFSERS** (T-197, owner TQ A, TR B, TS B, TT A and the three answers of 2026-11-13; T-191; with T-196's dwell rate, PCA-simulator's).
    - **Mode** (T-197): a drop-down on a ground radar in the Sensors panel, **Random** (functions 37 and 44 as in M7) or **Systematic**. **New and saved sensors start in Random** (TT A); a scenario's sensor without a mode is Random; the mode is saved with the sensor and in a scenario's file.
    - **The presets set it** (TT A, T-191): the Narrow wedge sets Systematic and a Target revisit of 2 s; Default, Medium wedge and Wide wedge set Random. Changing the mode by hand makes the preset "Custom". **New sensors start on the Medium wedge**, as before. A sensor saved with M7's Narrow wedge values (2°, 20 km, 0.2 s) keeps them and now shows "Default".
    - **The Narrow wedge's values** (T-191; the MCA's count over the owner's AFSERS recordings): a dwell 1.7° wide and 95 km deep, one every 0.1 s, Systematic. The bearing step equals the width (TR B), not AFSERS's overlapping 0.4°; a pass over a search area of 8° to 17° then takes about 5 to 10 dwells per row, and passes follow back to back as AFSERS's do.
    - **Systematic, the scan** (TQ A, TR B):
      - **The grid:** the search area (function 37; with a job area, the cells whose centre is inside it) in **rows of the dwell depth from the min range outwards**; in each row, cells of the search width **from the start bearing clockwise, side by side** (no overlap, no gaps); a row's last cell and the last row are cut to the area. With a depth of at least the band, one row. Equal bearings look all round.
      - **The order:** bearing first, row by row: every cell of the nearest row, then the next row out (TQ A). One **pass** over all cells is one revisit (`Sequence`'s revisit number), its last dwell flagged `lastOfRevisit`.
      - **The bearings turn with the platform** (owner, 2026-11-16, YW; in place of T-193's bearings planned at the pass's start, with which a pass after a turn ran on outside the arc): a cell's bearings are **relative to the platform's heading at its dwell**, and each dwell lies round the platform's position at that time (as T-193 placed it). **After a turn the pass goes on from the same cell**, the next in its order, now turned with the platform: it neither restarts nor skips cells. So every scan dwell lies inside the sensor's arc as function 33 draws it at the dwell's time.
      - **Back to back:** the next pass starts one dwell interval after the last dwell; the **Revisit interval is not used** in Systematic (greyed, with a note), so T-196's filled revisit (function 37) is Random's: a pass holds its grid cells and its target dwells, and still sends one dwell per dwell interval.
      - **Every cell is a dwell**, with or without targets; each holds the tracks function 28 detects in it (the minimum speed, the probability, the errors; at most "most detections per dwell"). **Empty dwells are not chosen:** every cell is scanned, so the empty ones follow from where the targets are (the owner's answer A). From M8 the Empty dwells share and `maxEmptyDwellsPerTargetDwell` are gone anyway (T-196, functions 37 and 44); Random fills its revisit by function 44.
    - **Systematic, found targets** (TS B, track-while-scan):
      - **Found:** a track detected in a scan dwell.
      - **Revisited:** each found target gets a dwell of its own, the search width and the dwell depth **centred on its true position at the dwell's time** (owner, 2026-11-16, YV A; until then on its last measured position, which near the sensor let a moving or mis-measured target fall outside the dwell), every **Target revisit** (the owner: a per-sensor setting in the Sensors panel, shown in Systematic, **default 2 s**, 0.5 to 60 s; the Narrow wedge sets 2 s). Its dwells are **interleaved** in the scan: when one is due, it takes the next dwell slot and the scan goes on after it. Found targets due together whose dwells would overlap share one dwell. A target dwell is a dwell of the current pass and detects as a scan dwell does: **its detections keep their errors** (function 28), so the reported position is a measurement, never the true one; only the aim uses the truth, as a real tracker's prediction would.
      - **Outside the arc** (owner, 2026-11-16, YW2 A): an own dwell whose target, at the dwell's time, lies outside the sensor's arc (its band and its bearings from the heading, function 28) is **not sent and counts as a miss**; the slot goes to the next dwell due. **A shared dwell** (targets due together, below "Revisited"): a target outside the arc leaves it and counts a miss; the dwell is sent for the targets still inside, centred on them, and not at all when none is.
      - **Lost:** a found target is revisited **until 3 of its target dwells in a row find nothing** (the owner's answer A), a dwell not sent for YW2 A counting as one, then dropped until the scan finds it again.
      - **A pass's dwells are numbered in the order sent**, scan and target dwells together; **its last dwell is its last grid cell**, which carries `lastOfRevisit`, and a target dwell due after it opens the next pass. So a pass's dwell count varies with its found targets; function 43 handles that as it handles Random's varying count (a dwell replaces the drawn one of its index, the higher indices go at the last dwell).
    - **The pairing and the warning** (functions 29 and 30) are set at each pass's last dwell, from all the tracks its dwells found. Function 37's "each target in exactly one dwell of the revisit" is Random's rule; in Systematic a target may be in a scan dwell and in its target dwells.
    - **Unchanged:** the coverage (function 33), the dwells drawn (function 43), the colours (function 46), the outputs and their limits (functions 29 and 30), and **Random** (YW3 A): its dwells keep the bearings planned at the revisit's start (T-193).

## Out of scope (M3)

- Sensors and a "detected objects" view; named scenarios; a speed factor or faster than real time (Q19).
- Shapes as tracks: only `core.symbol` objects move.
- Moving or copying layers between workspaces (Q29).
- MSL altitudes (A10).
- Interpolation between ticks in browsers (ADR-0040, alternatives).
- Sending routes, or anything outside the simulation's layers.

## Interfaces

| Direction | What |
|---|---|
| Provides | The workspace `simulator.simulation`; the data type `simulator.route`; the object actions "Put on route" and "Take off route". **(M5)** Sensor reports (`ChannelItem.SensorReport`) to the channels each sensor chooses; `gmti.pairing` relations on sensor platforms. Nothing for other plugins to call |
| Requires (server) | Java SDK 1.2.0: workers (one engine worker, a compute worker if needed), timers, the store (subscriptions and queries with `inWorkspaces`, `Change.updateObject`, `notSaved()`, `withFields`), plugin documents, `channels().watch` and `send`, `declaredFields()`, `workspaces()`, `Geodesy`, the default label, status; GET endpoints, and POST endpoints (CR-0026, approved and folded into SDK 1.2.0; open question 1). `sdkVersion` `^1.2.0`. **(M6)** SDK 1.5.0 part 3: `ChannelItem.Sensor.jobArea` and `type`, `ChannelInfo.sensorTypes` (CR-0039 point 7) and `SensorReport.Sequence` (CR-0040), `sdkVersion` `^1.5.0` |
| Requires (web) | Web SDK 1.2.0: panels and object actions with `workspaces`, `ctx.workspace`, the live picture, change requests, `MapView` drawing and editing with `signal` (CR-0020), `MapView.createFadeList`, `DeclaredFields`, `ctx.ui.addMapPaneOverlay` ("Put on route", from M4), the shared components and look; **(M5, T-158)** `MapView.createOverlay` with `area` items (SDK 1.4.0 part 6) and `ctx.userDocuments` |
| Uses (other plugins) | `map-view-2d` (drawing, editing, fade lists), `draw-symbols` (placing tracks), `layer-panel` (simulation layers), and the output channels of `cot` and later plugins. All are found at run time, and missing ones are shown as such. A channel must send every item as it comes, also when its content is unchanged (`cot` function 19). `cot`'s M3 brief was approved by the owner on 2026-10-26 |
| Objects | Creates and edits `simulator.route` objects. Moves, hides and changes the `core.symbol` objects in simulation layers. Never deletes objects, except a scenario imported as new (function 32), which the user's browser deletes after a confirmation; never writes View's layers |

## Dependencies

None beyond the SDKs. Geodesics come from the Java SDK (`dev.emcc.sdk.geo`, GeographicLib inside the SDK, which plugins may not use directly).

## Settings

| Setting | Default | Meaning |
|---|---|---|
| ~~`maxEmptyDwellsPerTargetDwell`~~ (M7, function 44; owner Q55 B) | – | **Removed in M8** (T-196; owner, 2026-11-13, A); a stored value is read and ignored |
| `jobAreaColour`, `coverageColour`, `dwellColour` (from M7, function 46) | from M8 `{ use: fixed }` with `#BDCF3D`, `#FD0909` and `#7EF26A` (T-189; M7: `{ use: identity }`) | the job area's, the coverage's and the dwells' colour: the platform's identity colour, or a fixed `#RRGGBB` |
| `outputStaleSeconds` | 5 | The expiry, in seconds after the tick's time, put on everything the simulator sends to outputs (function 18; open question 3), 1 to 3 600, enforced by the settings schema (`minimum`, `maximum`) |

Units are each user's own (function 8), not settings. An admin with `settings.admin` changes the setting.

## Permissions

| Permission | For |
|---|---|
| `plugin.simulator.view` | The Simulation tab, its layers and objects (the workspace's view permission, enforced by the server), and the simulator's GET endpoints |
| `plugin.simulator.edit` | Placing and changing objects and routes in simulation layers (the workspace's edit permission, enforced by the store), and the commands put on route, take off route, and choose outputs; **(M5)** sensors (function 27) and importing a scenario, with `run` (function 32) |
| `plugin.simulator.run` | Start, pause and reset |

## Internet access

**None.** The manifest declares no `internet` and no `connections`. The simulator sends only through other plugins' output channels.

## Acceptance criteria

For the ITA's M3 flows (T-086): automated on the ITA's machine with 1 to 3 browsers in software rendering, which check what arrives rather than how smoothly it is drawn (S6 proposal 5), and with the ITA's TAK test double. Criteria marked **(plugin)** are the plugin's own tests, with the test kit (fake store, channels, timers, documents, `FakeStore.restart()`), since the ITA has no hook for them.

**The commands** (start, pause and reset, put on route, take off route, choose outputs) need the POST endpoints of open question 1. So criteria 1, 8 to 11, 13, 14, 22 and the parts of others that use a command wait for CR-0026's build.

1. **The workspace:**
   - A user with `plugin.simulator.view` sees the Simulation tab after View.
   - A user without it sees no tab, and receives none of its layers or objects, through queries neither.
   - Without `plugin.simulator.edit`, changes are refused. Without `plugin.simulator.run`, start, pause and reset answer 403.
2. **A route:** drawn in Simulation, it is a `simulator.route` object with markers at its points. Its extension keeps only what users typed (function 4), and the editor shows the lengths, times and speeds the server part serves for the route version shown. A user's edit is never undone by a write of derived values.
3. **Movement:** a single object on a two-leg route moves along the geodesics at the points' speeds, once a second.
   - Its position after each tick is within 1 m of the SDK's `Geodesy` result, latitude ≠ longitude.
   - It turns sharply at the point, and its `direction` and `speed` modifiers match.
4. **Ramps:**
   - A speed ramp has a constant acceleration.
   - An altitude ramp climbs in proportion to the distance.
   - A ramp on the first point acts as instant.
   - An empty altitude keeps the object's own.
5. **The time helper:**
   - A typed time gives the rounded speed in the user's unit.
   - Moving the point keeps the value typed last.
   - A time a ramp cannot reach is reported.
6. **Units** (from M4): km/h, knots, mph or m/s, and metres or feet, are chosen in the route editor's "All points" part, per user, and remembered in the browser: the same after a reload, km/h and metres for a user who has not chosen. Every value box, the route editor and the routes panel show them, and the route stores m/s and metres.
   - **(plugin)** They are not in the setup: picking a named setup leaves them as they are.
7. **Editing while running:**
   - Moving a point with "move with it" keeps the objects on the same leg, at the same fraction.
   - "Disconnect" leaves them in place with speed 0 and their altitude.
8. **A convoy** leaves one by one at the spacing, in list order. With "stop", all stop at the last point.
9. **A formation** keeps its shape and turns with the direction of travel. Its objects pass a point in the order of their places along the route.
10. **Events:**
    - "Change a field" fires for each chosen object as it passes the point. It changes core fields, and another plugin's declared field through `withFields`.
    - "Hide" fades the object on the Simulation map, stops it, and sends a `Removal` to each chosen output.
    - Putting the object on a route again shows it and sends it again.
11. **Control:**
    - Start, pause and reset work per route and for all routes.
    - Reset puts the objects back, restores changed fields, shows hidden objects, and leaves the route paused.
    - "Restart" at the end fires the events again. "Stop" keeps sending the objects at the last point with speed 0.
12. **Without a browser:** with every browser closed, a running route still moves its objects and still sends them to the chosen outputs.
13. **Outputs:**
    - Each channel appears in the Outputs panel, with its type, delete capability and fields.
    - A chosen channel gets every track at each tick, as an `Update` with an expiry `outputStaleSeconds` after the tick.
    - Hidden tracks are not sent.
    - A standing track, whether on no route or stopped at the end, reaches the TAK test double every second, and does not go stale there.
    - **`outputStaleSeconds`:** only a user with `settings.admin` changes it, the settings schema refuses values outside 1 to 3 600, and a changed value applies from the next tick.
14. **A missing output** (N8): renaming or removing the chosen `cot` link shows the chosen output as missing, not dropped. Restoring the link resumes sending.
15. **The round trip of Q20:** tracks sent through `cot`'s output channel to the TAK test double come back through a `cot` input link into a View layer.
    - The ground truth shows only in Simulation; what came back shows in View.
    - Once by hand: through the ESA's TAK Server, for the demo.
16. **When nothing runs** (open question 4): after a pause, nothing is sent, and the items' expiry lets the tracks go stale at the receiver.
17. **Moves are not saved** (ADR-0041):
    - The moves of a running route reach the live picture and the outputs, but the journal holds no move.
    - **(plugin)** The simulator marks only moves as not saved, and counts a move the store refuses, with `FakeStore`.
18. **The saving moments:**
    - A save happens before a run, at a pause, at the end, at a reset, and at a change during a run, and covers all tracks and the whole state.
    - There is no periodic save.
19. **A kill and a clean stop during a run:**
    - After a hard kill, the server comes back with the simulation paused at the last saved moment, with tracks and state agreeing.
    - The same holds after a clean stop, best effort.
20. **(plugin) A worker restart** places every track from the saved state, paused, with `FakeStore.restart()`. Tracks deleted or edited since the save are handled as in function 21, and the routes' lists decide which objects are on which route: an object on a list without saved progress is placed as "Put on route" places it, and progress for an object on no list is dropped. Progress saved for another route than the one whose list names the object counts as none: the object is placed as "Put on route" places it. A reset after the restart restores the values events changed and shows hidden tracks, from the tracks themselves (function 13): an event's change and its restore record are in one saved update, and with `FakeStore.restart()` between the event and a reset, the reset brings back the first value, and a field that was absent is absent again.
21. **Load:** 1 000 tracks on routes at 1 Hz, with one chosen `cot` channel.
    - Every tick is submitted in one burst and answered before the next.
    - No track is skipped.
    - The status shows the tick's duration and counts (function 17a).
    - **No new snapshot** reaches the worker (the ACA's S4). If any does, the PCA raises it with the CDA and the PDA through the MCA before T-083 ends.
    - **(plugin)** A new snapshot from the store subscription replaces what the worker holds, and no track is lost or doubled.
    - Measured once in the ITA's environment, with 1 to 3 browsers.
22. **The permissions in the browser:** without `plugin.simulator.edit`, the panels are read-only, and without `plugin.simulator.run` the controls are disabled. The server refuses the same commands made directly (criterion 1).
23. **The look:** the panels use the shell's tokens and shared components, and are checked in both densities and in a light and a dark look. `DeclaredFields` is checked in all three looks (W3).
24. **The rules:**
    - The ArchUnit rule set passes: no threads, sockets, locks or files.
    - Every request has a timeout.
    - **(plugin, and the reviews)** `notSaved()` is used only for moves, and no store query or subscription goes without a workspace. `PluginRules` does not check these.
25. **Users' changes** (function 9a):
    - Deleting a track during a run takes it off its route.
    - Deleting a route disconnects its objects.
    - Dragging a track on a running route: the route wins, and the next tick puts it back (open question 11).
    - An invalid route (function 4) cannot run, and says why. A speed above 2 000 m/s or an altitude outside −1 000 to 30 000 m is invalid in any unit shown.
    - **(plugin, and once in the browser)** Edits by other plugins (function 9b): a reshape in `draw-shapes` moves the route's objects with it (from M4, in the browser through its drag, T-066, since its Edit is not offered on routes); a route made invalid while it runs pauses and says why; a route whose data type is changed disconnects its objects; a route moved to a layer outside Simulation is treated as deleted, and its objects are disconnected.
26. **(plugin, and once in the browser) Faded again after a switch** (function 22; added with the owner's approval of 2026-10-27): with everything paused and a track hidden, switch to View and back to Simulation; the hidden tracks are faded again within 1 s.

From M4:

27. **The first layer:** on a fresh system Simulation has the layer "Simulation" and View the layer "Drawing". **(plugin)** With every Simulation layer deleted, the next start creates "Simulation" again; with one left, it creates none.
28. **The route editor:** "Reshape" is right-aligned on the row of "At the end"; the up arrow goes to the next point and the down arrow to the previous; the unit selectors are in "All points".
29. **"Put on route"** opens over the map at its right edge, not as a panel; its close button and Escape close it; it puts the chosen objects on the route as before.
30. **A route's menu:** a right click on a route offers "Edit route", Centre on, Zoom to and Delete, and not `draw-shapes`' Edit.
31. **Default panes:** in a fresh browser "Routes" opens in the left pane, and the route editor, "Outputs" and the event panel in the right.
32. **Locked layers** (SDK 1.3.0, with the test kit's default answer policy, and once in the browser): with the active layer locked, "New route" is disabled with its title; "Edit route" on a route in a locked layer opens read only and sends nothing; a command to a track in a locked layer still runs.
33. **(plugin) Names** (function 10; T-121): two unnamed symbols put on the route "Alpha" become "Alpha-1" and "Alpha-2", written with the update that places them; with "Alpha-5" in Simulation the next is "Alpha-6"; a named symbol keeps its name, a blank one is named; a route without a name gives "Track-<n>"; the names reach the outputs, and a reset and "Take off route" keep them.
34. **Every field set** (SDK 1.4.0, function 26; the owner's ID): with declared fields and two field sets from two fake plugins, and one field in no set, the editor shows the data type's fields first, then one group per set, all settable; there is no drop-down and no "+", and the field in no set is not shown; an event that sets `cot`'s `team` names only `cot.team`, and a field emptied that had no value names nothing.

From M5 (SDK 1.4.0; functions 27 to 32; with the test kit, a fixed seed, and a point where latitude ≠ longitude):

35. **A sensor:** with one track selected, "New sensor" makes a sensor on it with the defaults of function 27; its settings outside their limits are refused at the field; it survives a restart; deleting its track shows it as missing.
36. **The area:** a platform at a known point heading 0°, with the band 20 to 150 km and the bearings 45° to 135°, gives an `ArcBand` of 20 000 to 150 000 m between 45° and 135°; heading 90° turns it to 135° to 225°; bearings 300° to 60° give a sector across north, as does heading 300° with 45° to 135° (it wraps to 345° to 75°). **Equal bearings** (owner, MX), e.g. 90° to 90°, give the full ring from 20 000 to 150 000 m, and moving tracks inside it at bearings 0°, 90°, 180° and 270° are detected (Pd 1).
37. **Detection:** with Pd 1 and no errors, of four tracks (one inside and moving, one inside below the minimum speed, one outside the bearings, one hidden) only the first is detected; with Pd 0 none; an air track and a moving dismounted individual (symbol set 27) inside are both detected (A99); with both sigmas 0 the measured position is the true one (A100).
38. **Errors:** over 1 000 revisits with fixed seed, the measured positions' spread along and across the line of sight matches the sigmas within 10 %.
39. **Detect all in range** (Q9): with it on, every track within the max range is detected at its true position at every revisit, also one standing still and one outside the bearings; a hidden one is not; the area is a `Circle` of the max range.
40. **The cap:** 300 tracks inside with "most detections per dwell" 200 give 200 detections, the nearest, and count 100.
41. **Sensor reports out:** each revisit sends one `SensorReport` per chosen sensor output, with the platform's id and position, the revisit's time, the area and the detections' measured positions; an empty report is sent; a paused simulation sends none; a channel that takes ground truth only is not offered for sensors, nor a sensor-reports-only channel (`gmti`) as a Ground truth output.
42. **Through `gmti`** (with PCA-gmti's plugin, once in the browser): the reports come back through a `gmti` `in` link as detections at the measured positions, paired with the platform.
43. **The pairing:** with `gmti.pairing` declared, after a revisit the platform's `relations` are exactly the detected tracks, other kinds' entries kept; after an empty revisit there are none of that kind; each revisit's update is saved (`FakeStore.unsaved()` holds only the moves between revisits); without the kind declared there are none, and the status says so once. **Measured** (R4): the bytes and tick time of one sensor with 200 tracks, in the handover.
44. **Forwarding:** a track with `relations` and `fieldSets` moved by the simulation, and edited by an event, keeps both.
45. **Channels' sets** (R7): the Outputs panel and the Sensors panel show a channel's field set by its label; an item sent to a `cot` channel lists `cot.unit` in its content, and the stored track does not.
46. **Scenarios:** an export of a simulation with two routes, three tracks, one sensor and its outputs, imported as new on a second server, gives the same simulation with new ids and every reference remapped (routes, events, the sensor's platform, `relations`); "as new" asks first and deletes the old layers and objects only after the confirmation; "merge" keeps them; a `version` 2 file is refused unchanged; a locked layer's refusal is listed; a simulator state over 1 MiB is refused before any change.
47. **The sensor in a sensor report** (CR-0033): a sensor on a track named "Hawk 1" with direction 45° and speed 120 m/s, revisit 10 s and the defaults sends reports whose `sensor()` is "Hawk 1", 10 s, 20 m, 50 m, 2 m/s, 0.9, 45° and 120 m/s; on a track with no name, no direction and no speed, "GMTI sensor" and no direction or speed; with "Detect all in range", no errors, no minimum speed and a probability of 1. **(CR-0034)** With the Mission "ATO-2611-BRAVO" every report's `sensor().mission()` is "ATO-2611-BRAVO"; with it empty, none. A scenario exported with a sensor's Mission and imported as new keeps it (criterion 46); a scenario file without one imports with none.
48. **Beyond an output's depth** (CR-0035; KL, KM). With a fake `gmti` channel of `maxAreaDepth` 511 980 m (latitude ≠ longitude):
    - **"Detect all in range" at 400 km:** no warning, and `gmti.pairing` for every track.
    - **At 600 km:** a track at 500 km gets `gmti.pairing` and one at 550 km `simulator.beyond-reach`. The map pane's bottom shows one line naming the sensor and the output, with no number in it.
    - **A band from 20 to 1 000 km:** a track at 520 km gets `gmti.pairing` and one at 545 km `simulator.beyond-reach` (the near edge plus 511.98 km is 531.98 km).
    - **Deselecting `gmti`:** the text goes, and `gmti.pairing` for every detected track is written at once, without waiting for a revisit.
    - **An output with no depth** never warns.
    - **Without `gmti` loaded,** with another fake output of a depth: `simulator.beyond-reach` is still declared and written, and `gmti.pairing` is not.
    - **A browser check:** the red lines and the text, and both gone after the deselection.
49. **The coverage** (T-158). A sensor on a platform at [15.20, 58.41] with direction 30°, a band from 20 to 150 km and bearings 45° to 135° gives one overlay `area`:
    - its outer arc's positions lie 150 000 m and its inner arc's 20 000 m from the platform (within 1 m, against values from the server's `Geodesy`), from 75° to 165°, at most 1° apart; with the platform turned to 90°, from 135° to 225°;
    - "Detect all in range" gives the disc of 150 km; bearings 300° to 60° are drawn across north; equal bearings give the ring with the inner circle as a hole; a min range of 0 starts at the platform;
    - the outline is dashed in the platform's identity colour, without fill; it is drawn while the simulation is reset, runs and is paused;
    - "Show coverage" off clears it and stays off after a reload; another workspace clears it; a deleted platform's sensor has none; the outputs and a scenario's file are the same as without it;
    - **a browser check:** the coverage follows a platform on a route, and a click inside it selects a track below.

From M6 (functions 34 and 35):

50. **(plugin) Routes not chosen by hand:** the manifest's `simulator.route` has `manual` `false` and validates against the 1.5.0 schema; "New route" still makes a `simulator.route` object.
51. **One set at a time** (function 35; replaces criterion 34): with declared fields and two field sets from two fake plugins, and one field in no set, the Event panel shows the drop-down with both sets and no "+"; it opens on the first set of the objects' shared data type; choosing the other shows its fields; the field in no set is not shown; an event that sets `cot`'s `team` names only `cot.team`, and a field emptied that had no value names nothing.

From M6, sensor types and the job area (T-168, T-169; functions 36 to 39; points with latitude ≠ longitude):

52. **Types and outputs:** "New sensor" makes a ground radar without asking for a type, and each report's `Sensor.type` is `GROUND_RADAR`. With a fake `gmti` channel taking `GROUND_RADAR` and a fake `cot` channel taking every type, a ground radar is offered both. Importing a scenario file with one ground radar and one `GENERIC` sensor loads the ground radar and its platform, leaves the generic sensor out and lists it (Q52 B). **Later** (owner, PX): with the generic sensor, a choice of type, and a generic sensor offered only `cot`.
53. **(plugin) Old sensors:** a saved M5 sensor and a version 1 scenario file's sensor without a type load as ground radars with their own values and the preset "Custom".
54. **Presets:** choosing each preset sets function 37's values as its table says (from M8 three, with the Mode and the Narrow wedge's Target revisit, criterion 73); changing one makes it "Custom".
55. **Every target, in dwells:** a ground radar on a platform at [15.20, 58.41] heading 0°, with 30 tracks spread over its band, the Default preset (M7's Narrow wedge; Random), a cap of 5 and a probability of 1: over one revisit every track is in exactly one report; no report holds more than 5 detections; each target lies inside its report's `ArcBand`; some reports are empty, none holding a track or overlapping a dwell with targets, spread over the search area (function 44, T-180); the sequences run 0, 1, 2, … with `lastOfRevisit` only on the last.
56. **Time** (from M8, T-196): with the Medium wedge (1 s) and a revisit interval of 10 s, a revisit holds 10 dwells: with 4 dwells with targets, 6 empty ones, and it lasts 10 s; with 14 dwells with targets, no empty one, and it lasts 14 s; the next revisit's first report follows the last one's time by 1 s. With the Default preset (0.2 s), 50 dwells, 5 a second, and with 0.1 s, 10 a second.
57. **Surrounded:** with tracks all round the platform and equal bearings, so that every bearing holds a track, no free place is left and the Default preset (M7's Narrow wedge; Random) sends no empty dwell (function 44).
58. **Generic sensor** (later; not in M6, owner PX): with a range of 50 km, of three tracks (one at 30 km standing still, one at 49 km, one at 51 km) the first two are detected, in one report with a `Circle` of 50 km and no sequence; over 1 000 revisits with a fixed seed the position error's spread east and north matches the sigma within 10 %.
59. **Job area:** a rectangle drawn as the job area is saved, sent on every report as a closed four-corner `Polygon` in the order drawn, and drawn dotted; a four-point polygon is accepted and a five-point one refused with the message; a track inside the search area but outside the job area is not detected; "Clear job area" removes it from the reports and the map.

60. **A moved track stays** (M6, T-155): a running track moved by a user into a second Simulation layer (the test kit's `applyAs`) is moved on along its route with its `layerId` unchanged; its copy in a third layer is not moved.

**From M7** (functions 41 to 49):

61. **The job area's look** (T-177): the job area's overlay item is an `area` with `strokeDash` `dot`, `strokeWidth` 3, `fillOpacity` 0.15 and `fillColor` equal to its `strokeColor`, and comes before the coverage's items.
62. **All round by default** (T-178): "New sensor" gives bearings 0° to 360°. Such a sensor detects a track behind the platform (bearing 180° from the heading), and its coverage is the full ring, with the inner circle as a hole. A saved sensor with 45° to 135° keeps them after a restart and an import.
63. **Dwells drawn** (T-179):
    - **The endpoint:** through the test kit, three dwells of one revisit give `GET /sensors/dwells` three dwells for the sensor. The next revisit's two dwells, the second its last, leave two. With `since` and no change it answers 304.
    - **In the browser** (with "Show dwells" on): the dwells appear as 2 px solid outlines while the simulation runs, and stay while it is paused. They go on a reset, and when "Show dwells" is ticked off. The choice survives a reload.
64. **Empty dwells spread** (T-180): a ground radar at [15.20, 58.41], heading 0°, bearings 0° to 90°, band 20 to 150 km, the Default preset (2°, 20 km, 0.2 s; M7's Narrow wedge; Random), a revisit interval of 10 s, and two tracks at 10° and 11° that make one dwell with targets (from M8, T-196).
    - **The revisit:** exactly 49 empty dwells (50 less the one with targets). None holds a target or overlaps the dwell with targets. Their bearings are spread over the search area: the largest gap between consecutive dwells, the targets' dwell included, is at most twice the even spacing.
    - **No targets:** with the tracks removed, exactly 50 empty dwells.
    - **Few places:** with the bearings 0° to 12° and the band 20 to 40 km (6 places of 2° by 20 km), the 49 empty dwells take the free places again in turn, so the free places' counts differ by at most one, and none overlaps the dwell with targets.
    - **A job area** over the half from 45° to 90° keeps every empty dwell's centre inside it.
65. **M7's Narrow wedge** set a search width of 2° (from M8 the Default preset, criterion 73). A sensor saved with M7's Narrow wedge and 5° keeps 5° and shows "Custom".
66. **The removed settings** (from M8, T-196; replaces M7's criterion on `maxEmptyDwellsPerTargetDwell`): Settings › Simulator has no "Most empty dwells per dwell with targets" and the Sensors panel no "Empty dwells"; a stored value of either, and a scenario file's share, are read and ignored, and the count is still function 37's.
67. **Labels** (T-184): a sensor with bearings 45° to 135° and a band of 20 to 150 km gives four labels, "45°", "135°", "20 km" and "150 km", each within 1 % of the range from the middle of its edge or arc. With 0° to 360° there are only the range labels, and with a min range of 0 no "0 km".
68. **Live preview** (T-184): changing the max range in the Sensors panel from 150 to 100 km redraws the coverage and its label at once, before saving. Leaving without saving gives back the 150 km coverage. Nothing is sent to the server meanwhile (the test kit's endpoint calls).
69. **Colours** (T-185): with `coverageColour` `{ use: fixed, colour: #00FFFF }` the coverage's items take `#00FFFF`; with `identity` a friend platform's take `#00A8DC`. The same for the job area and the dwells. A settings change redraws them without a reload.
70. **Display classes** (T-182, SDK 1.6.0): the coverage's items, labels and job area carry `displayClass` `sensor-coverage`, and the dwells `dwell-area`. With the user's "Dwell areas" switch off, the map view draws no dwell while the coverage stays (with `map-view-2d`, once in the browser).
71. **The Scenario button** (T-152, SDK 1.6.0): the top-bar item "Scenario" shows in Simulation and not in View. Its Export and Import give the same file and result as criterion 46. The Routes panel has no scenario buttons. Without `plugin.simulator.edit` or `plugin.simulator.run`, Import is greyed with its reason; Export needs `plugin.simulator.view` only and stays available (function 32).
72. **Append on a route** (T-176, SDK 1.6.0): with the fake map view's `append` scripted to add two points, "Append" in the route editor sends one update with the route's points followed by the two. Their entries equal the last point's, so the route stays valid (function 4); that it then runs on follows from that and is not run in this test. On a locked layer Append is disabled with its title.
73. **The presets** (T-191, T-197): Default sets 2°, 20 km, 0.2 s and Random; the Narrow wedge 1.7°, 95 km, 0.1 s, Systematic and a Target revisit of 2 s; Medium and Wide set Random; a new sensor is on the Medium wedge in Random; a sensor saved with 2°, 20 km and 0.2 s shows "Default"; switching the Narrow wedge's mode to Random shows "Custom".
74. **The scan** (T-197, TQ A, TR B): a ground radar at [15.20, 58.41] heading 0°, bearings 0° to 17°, band 20 to 210 km, Systematic, 1.7° by 95 km, 0.1 s, no tracks: a pass of 20 dwells, the first 0° to 1.7° and 20 to 115 km, then side by side clockwise to 15.3° to 17°, then the row 115 to 210 km the same way; no two overlap and together they cover the area; the last has `lastOfRevisit`; the next pass's first dwell follows it by 0.1 s; changing the Revisit interval changes nothing. **A turn** (YW): the platform's heading set to 90° after the pass's 5th dwell: the 6th dwell is the 6th cell, 8.5° to 10.2° from the heading, so 98.5° to 100.2° true, and the pass goes on to its 20th dwell, dwells 6 to 20 all inside 90° to 107° true (dwells 1 to 5 stay where they were sent, at 0° to 8.5°). **The same turn with Random** (the Default preset, YW3 A): the revisit's dwells after the turn keep the bearings planned at its start, inside 0° to 17° true, until the next revisit plans from heading 90°.
75. **Found targets** (T-197, TS B and the answers): with one moving track at 8° and 60 km, the pass that finds it is followed by a dwell centred on it every 2 s, between scan dwells, and with a Target revisit of 1 s every 1 s; after the track is hidden, its target dwells go on until 3 in a row find nothing, and then stop; the scan finds it again when it shows. **The aim** (YV A): a track at 5 km moving 30 m/s across the beam, with a cross-range error of 50 m and a detection probability of 1, found by a pass with the Narrow wedge, is in every one of its target dwells for 60 s and never dropped; each target dwell's centre is the track's true position at the dwell's time (±1 m), and each detection's position differs from it as the errors draw it, not by 0. **Outside the arc** (YW2 A): with bearings 0° to 17°, a found track at 8° whose platform then turns to heading 90°: its own dwells are not sent while it is outside the arc, each counts as a miss, and after 3 it is dropped; turned back, the scan finds it again.
76. **Random unchanged** (T-197): in Random, criteria 55, 56, 57 and 64 still pass, with the Default preset where M7 had the Narrow wedge; the Mode is saved with the sensor and in an exported scenario, and a scenario file without a mode imports in Random.
77. **The default colours** (T-189): with no setting changed, the dwells are drawn in `#7EF26A`, the coverage in `#FD0909` and the job area in `#BDCF3D`; the form shows all three as `fixed`, and `identity` can still be chosen.


## Open questions for the owner

**M7 (2026-11-11), answered by the owner (RJ A, 2026-11-11):** Q55 **B**, Q56 A, Q57 A, Q58 A, Q60 A, Q61 A, and the assumptions M7-S1 to M7-S7 accepted, M7-S7 with today's identity colours as the defaults (QR). The questions as asked:
- **(superseded by T-196, M8) Q55, where the empty dwells' cap is set** (function 44): A, per sensor in the Sensors panel (default 3, 0 to 50), saved with the sensor and in scenario files, as every other dwell setting; B, one admin setting in Settings › Simulator for every sensor. **Recommended: A.**
- **(superseded by T-196, M8) Q56, a revisit without targets** (function 44): A, it counts as one dwell with targets, so it shows up to the cap (3) of empty dwells, spread; B, no empty dwells at all; C, the share alone, without the cap. **Recommended: A.**
- **Q57, how long the simulator's dwells stay drawn** (function 43): A, as `gmti` draws them in View: per dwell index, replaced by the next revisit's dwell of that index, the higher ones removed at a revisit's last dwell; B, only the current revisit's dwells so far, cleared when a revisit starts; C, each dwell for a fixed time, the revisit interval. **Recommended: A.**
- **Q61, Append on a route** (function 49): A, an "Append" button in the route editor beside its Reshape, since routes are edited there and `draw-shapes` does not offer its Edit on them (function 9b); B, plain lines only in M7 (`draw-shapes`), routes later. **Recommended: A.**
- **Q58 and Q60** are in CR-0041 (the display mark; a colour picker).
- **The assumptions M7-S1 to M7-S7** (with Q63):
  - **M7-S1:** the job area's fill is 15 % and its dotted outline 3 px.
  - **M7-S2:** dwells with targets and empty dwells look alike.
  - **M7-S3:** the empty dwells' places are a grid of nominal dwells in the revisit's order (clockwise, near to far).
  - **M7-S4:** they are spread evenly over the free places, from an offset drawn per revisit.
  - **M7-S5:** a saved sensor keeps its values; its preset shows "Custom" when they no longer match.
  - **M7-S6:** the bearing labels show the bearings as set (from the heading), not true bearings.
  - **M7-S7** (accepted as changed by the owner): the defaults are today's identity colours; the admin may set a fixed colour (function 46).

**M5 RC2, T-158 (2026-11-09), answered by the owner (MW A, 2026-11-09): A to each, as recommended and as function 33 is written** (the recommended option first; Q26 to Q28 are the same in `gmti`'s brief, so both draw coverage alike):
- **Q25, how it is drawn:** A, a map overlay drawn by the web part in each browser (function 33): nothing stored or sent, no SDK change; B, a `core.shape` that the server part writes into the platform's layer, shared through the store: it needs its own data type, must be kept out of the outputs and the scenario file, and adds a write per sensor at every tick.
- **Q26, the colour:** A, the platform's standard identity colour, as `gmti`'s dwell area; B, one fixed colour for every coverage, e.g. cyan; C, a colour per sensor, set in the Sensors panel.
- **Q27, fill or outline:** A, a dashed outline without fill: it hides nothing, and differs from the solid outline of `gmti`'s dwell area in View; B, an outline with a light fill (10 %); C, a solid outline, as the dwell area.
- **Q28, on by default or a setting:** A, on by default, with a "Show coverage" switch per user in the Sensors panel (no SDK change); B, always on, without a switch; C, a switch per user in the Display settings window: that needs an SDK member, a CR on the frozen SDK 1.4.0, so after RC2.
- **Q29, when:** A, always (reset, running and paused), so a scenario can be planned; B, only while the simulation runs.

**M5, answered by the owner (2026-11-06):** Q5 a Sensors panel (the alternatives: fields on the track, or the Outputs panel); Q6 a sector from the platform (the alternatives: a fixed area on the ground, or both); Q7 import as new replaces after a confirmation, and merge adds beside (the alternatives: new layers beside, or replace only); Q9 "Detect all in range": every track within the max range, exact (the owner's addition to the assumptions); A9 to A13 accepted (the detection model, the sensor's defaults with 200 detections per dwell, the pairing only when `gmti` is loaded, the Ground truth outputs and per-sensor outputs, scenarios in the browser).

Each had a recommendation. **The owner answered open questions 2 to 17 on 2026-10-26, and added open question 18.**

1. **Commands from the web part to the server part.** **Decided by the owner, 2026-10-26: a change request for POST endpoints.** The PDA's proposal for that CR, which the CR itself settles: `Endpoint.post(path)` with a JSON body and `requires(permission)`, ECore's edge refusing cross-site requests, as a compatible SDK addition.
   - **The other options were:**
     - GET endpoints guarded by a custom header: state-changing GETs, which the session cookie's `SameSite=Lax` does not protect;
     - commands as data in the simulator's objects: `plugin.simulator.run` could then not be enforced by the server.
   - **The CR is CR-0026,** the PDA's, approved by the owner on 2026-10-26. The CDA builds the edge side. It is folded into SDK 1.2.0 before 1.2.0 reaches `main` (owner, 2026-10-26), so the simulator declares `sdkVersion` `^1.2.0`.
2. **Where a new route goes.** **Decided by the owner, 2026-10-26: as recommended.**
   - **Recommended:** into the layer that is active in Simulation, as `draw-symbols` and `draw-shapes` draw (A17); the routes panel lists routes from every simulation layer.
   - **Alternative:** a "Routes" layer the simulator makes in Simulation, which keeps routes apart from tracks, but is a layer users did not ask for.
3. **The expiry on items sent to outputs** (`outputStaleSeconds`, function 18). **Decided by the owner, 2026-10-26, changed:** an admin setting `outputStaleSeconds`, default 5 s, from 1 to 3 600 s, for everything the simulator sends to outputs.
   - **The recommendation was 5 s,** five ticks, so that a paused simulation's tracks go stale in TAK within seconds (A8), while a late tick or a slow output does not make them flicker.
   - **Alternatives:** 2 s (stale sooner, flickers on a slow link), or 30 s (calmer, but stale tracks linger).
4. **What is sent when.** **Decided by the owner, 2026-10-26: as recommended.**
   - **Recommended:** the simulation **runs** from a start until every route is paused or reset. A route stopped at its end counts as running (A9, ADR-0040 point 9).
     - While it runs, every track is sent at each tick, hidden ones excepted. That includes objects on no route, tracks stopped at a route's end, and tracks of paused routes.
     - When every route is paused or reset, nothing is sent, so all tracks go stale at the receiver (A8).
   - **Alternative:** tracks of paused routes are never sent, even while other routes run. They would then go stale in TAK while the rest of the simulation goes on.
5. **A highest classification in the simulator.** **Decided by the owner, 2026-10-26: as recommended.**
   - **Recommended: none of its own.** Each output link already has one (ADR-0037 point 8) and applies it to channel items (`cot` function 20). A second limit in the simulator would be a second place to get wrong.
   - **Alternative:** a limit per chosen output in the simulator as well.
6. **More than 1 000 tracks.** **Decided by the owner, 2026-10-26: as recommended.**
   - **Recommended: no cap.** The engine runs what is there, skips and counts a track still waiting at the next tick (function 17), and its status warns when a tick takes longer than half a second.
     - Beyond 1 000 tracks, the store subscription's limit (`MAX_PENDING_UPDATES`, 1 000) gives more new snapshots, which the worker handles (function 17).
     - S6 measured exactly 1 000 tracks, so more is not measured.
   - **Alternative:** a setting that caps the tracks, refusing to start beyond it.
7. **An empty altitude at a point.** **Decided by the owner, 2026-10-26: as recommended.**
   - **Recommended: allowed, meaning "keep the object's own altitude".** Ground units can then share a route with aircraft, and a formation keeps its altitude offsets (function 5).
   - **Alternative:** every point needs an altitude, 0 by default.
8. **An object on two routes.** **Decided by the owner, 2026-10-26: as recommended.**
   - **Recommended: one route at a time.** Putting it on another route takes it off the first.
   - **Alternative:** refuse, until the user takes it off the first route.
9. **Where objects start when put on a route.** **Decided by the owner, 2026-10-26: as recommended.**
   - **Recommended:** at once, with a saved update. A single object and a formation's centre go to the route's first point, and a convoy waits there (function 11). So the user sees where they begin before the run.
   - **Alternative:** they stay where they are until Start, and then jump to the first point.
10. **New route points' values.** **Decided by the owner, 2026-10-26: as recommended.**
    - **Recommended:** a new point copies the previous point's speed and altitude, with their kinds. A new route's first point is 30 km/h, with an empty altitude.
    - **Alternative:** every point starts empty, and the route cannot run until each has a speed.
11. **A user drags a track on a running route.** **Decided by the owner, 2026-10-26: as recommended.**
    - **Recommended: the route wins.** The drag is a saved update, and the next tick puts the track back on its route. A user who wants it elsewhere disconnects it first.
    - **Alternative:** a drag disconnects the track: speed 0, in place, off its route.
12. **A route's default end behaviour.** **Decided by the owner, 2026-10-26: as recommended.**
    - **Recommended: "stop"** (A9): the objects stay at the last point, still sent, which is the less surprising choice.
    - **Alternative:** "restart" by default.
13. **Speed 0, and ramps next to an empty altitude.** **Decided by the owner, 2026-10-26: as recommended.**
    - **Recommended:**
      - a speed ramp may start from 0 or end at 0, to accelerate from or slow to a standstill;
      - an instant 0 is allowed only at the last point;
      - every leg needs a mean speed above 0, otherwise the route cannot run and the editor says why;
      - an altitude ramp needs altitudes at both ends, and the editor refuses a ramp next to an empty altitude.
    - **Alternative:** no speed of 0 anywhere. A route then always ends at speed.
14. **A formation's centre.** **Decided by the owner, 2026-10-26: as recommended.**
    - **Recommended:** the mean of the objects' positions and altitudes when assigned (function 12).
    - **Alternatives:** the first object in the list, or a point the user picks.
15. **Changes while everything is paused.** **Decided by the owner, 2026-10-26: as recommended.** The ACA supports it.
    - **Recommended:** saved at once, as a saving moment like those of ADR-0041 point 4. Examples are put on route, disconnect, the choice of outputs, and a reset. Nothing moves then, so it costs one save, and nothing is lost in a crash.
    - **Alternative:** ADR-0041's moments only. Such a change then lives in memory until the next run or pause.
    - **The ACA confirmed** that ADR-0041 point 4 does not forbid a save at another moment, and adds a line to ADR-0041's index row.
16. **Where the groups and the points' events live.** **Decided by the owner, 2026-10-26: as recommended.** The ACA supports it.
    - **Recommended:** in the route object's extension (function 4), with the object list, the group kinds, a convoy's spacing and a formation's offsets, and the points' events (the ACA's S5). Users change them through change requests, so the store checks `plugin.simulator.edit`. The server part's own writes, such as "Put on route", carry no user, and the endpoint's `requires` guards them (function 10). They are saved with the route like any edit.
    - **ADR-0040 point 2** lists the groups and the events with the plugin's documents, and so with what ADR-0041 point 4's saves cover. The ACA reads the move as a change of a detail of point 2, not a reversal, and adds a line to ADR-0040's index row. After a restart, the routes' lists decide which objects are on which route (function 21, the ACA's S2).
    - **Alternative:** as ADR-0040 point 2 says, in the documents. The route object then holds only its points, and assignments are visible to other plugins only through the simulator's endpoints.
17. **Limits on a route** (function 4). **Decided by the owner, 2026-10-26, changed:** speeds from 0 to 2 000 m/s and altitudes from −1 000 to 30 000 m, whatever unit is shown; times up to 7 days and at most 1 000 points per route, as recommended.
    - **The recommendation was** speeds from 0 to 1 000 m/s and altitudes from −500 to 30 000 m.
    - **The alternative was** other values, or none but finite numbers.
18. **Units in the value boxes** (new). **Decided by the owner, 2026-10-26:** the speed boxes switch between m/s, km/h, knots and mph, and the altitude boxes between metres and feet. Display only: the route always stores m/s and metres. Each user picks one speed unit and one altitude unit, remembered in the user's setup, and every value box and the routes panel show them (function 8). This adds mph to Q13's units. **Changed from M4** (BV and the owner's answer of 2026-10-30): selectors in "All points", the units kept in the browser, not in the setup (function 8).
