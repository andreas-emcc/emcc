# Brief: uav-simulation

- Status: **Approved by the owner (2026-11-16, YR A), with assumptions U1 to U10.** Functional part complete. **Section 4, the pose's shape and its channel kind, written with D8 on 2026-11-16** (CR-0048 point 4: a kind `fmv` declares, `fmv.camera-pose`; for the owner's approval with the CR; owner GQ2 A). Milestone: M9, the UAV track (may be cut to M10, owner XQ A) · Task: D6u (brief), V1 (plugin) · Agent: PCA-uav-simulation (new; browser-check port **18107**)
- **The owner's decisions:**
  - XQ A (2026-11-16): the camera is **a plugin of its own**, `uav-simulation`. It reads the simulator's track objects and sends camera poses to `fmv`'s output link. Nothing depends on it, and it touches no other plugin;
  - Q6 A: **a track that carries the simulator's radar may also carry a camera**;
  - Q7 A: **a camera's platform is an object in the Simulation workspace** in M9;
  - Q8: **an export and import of cameras is M10** (the M9 plan's L6);
  - GQ2 A: the pose is **a channel kind that `fmv` declares**, if the PDA's CR finds that one fits (ADR-0059 point 3);
  - ADR-0058 point 1 (owner, 2026-11-15): **the four pointing modes** in the first version (track a point, track an object, fixed angles, sweep), the field of view, the frame size and rate, and a height of the camera's own where the route gives none.
  - ABP A (2026-11-17): **an output link that is not sending or degraded keeps the plugin's status OK**; the status text only counts it, and the camera keeps sending (functions 9 and 10).
- **Assumptions U1 to U10** (end of this brief) are the PDA's, for the owner's approval.
- **Updated 2026-11-23 for M9.2 (CR-0055, approved by the owner ADC A, 2026-11-19; pulled ahead from M10, owner AFH A and AFI, 2026-11-23): the camera's Overlay setting and the pose's `overlay`** (functions 4, 11 and 13, sections 4 and 5, criteria 20 to 22). A checkbox per camera, off by default, asks `fmv` to burn the camera's data into the video (`fmv`'s brief, 10.5 function 27). **As built** (V2: `pca-uav-simulation/m9.2-overlay` `c1909617`, in `main` with `integration/m9.2-overlay` `8975c672`; owner AGC A): the checkbox "Burn the camera's data into the video", `overlay`; a camera stored before M9.2 reads as without it; a change reaches the next pose without a restart.
- **Updated 2026-11-23 for M9.2 (V3; ADR-0066 point 3, accepted by the owner, AFL A; M10's plan point 8; owner Q7 A, AEY: per camera; pulled ahead, AFH A and AFI): micro sway** (function 14, sections 4 and 5, criteria 23 to 26), **off by default for every camera**: the checkbox Micro sway, `sway` (owner AFQ, in PCA-uav-simulation's session, refining AFM). Small irregular offsets to the camera's angles in every pose, so the KLV, the picture and the overlay move with them. The settings, defaults and limits below are as PCA-uav-simulation built them (`pca-uav-simulation/m9.2-camera` `c058452a`); the formula is in its README.
- **Read first:** ADR-0059 (the plugin; accepted, YK A), ADR-0058 (the simulated camera; points 1, 2, 5 and 6 as ADR-0059 leaves them), ADR-0064 (compute tasks: `fmv`'s, not this plugin's), spike S10 (`spikes/s10-uav-fmv/README.md`: the camera, its gimbal and its ST 0601 angles), the `simulator` brief (functions 1 to 3, 14, 16, 18, 27 to 29: the workspace, the tracks, their moves, the outputs and the radar this plugin sits beside), the `fmv` brief (the input link that brings the camera back into View).
- **Read also:** ADR-0024 (persistence), ADR-0037 (output channels), ADR-0039 (workspaces), ADR-0041 (pause and saving), ADR-0019 (geodesy).
- **Built against SDK 1.9.0 part P** (`sdkVersion` `^1.9.0`): a declared channel kind (D8, CR-0048 point 4: `DeclaredItem`, `Channels.send` with it, `ChannelInfo.takesDeclared`). Everything else is SDK 1.8.0: workers, timers, the store's subscriptions and queries with `inWorkspaces`, plugin documents, `channels().watch` and `send`, endpoints, `Geodesy`, status.
  - **Until D8 is frozen:** the pose geometry (functions 4 to 7) is plain Java with tests (the M9 plan's V1 phase 1), with no manifest channel.

## 1. Purpose

Simulates **a camera on a simulated track**, as a UAV's sensor, so that emcc can make full motion video of its own.
- A user with the right puts a camera on a track in Simulation, points it in one of four ways, and starts it.
- While it runs, `uav-simulation` sends **one pose per frame**: where the camera is, where it looks, and how wide.
- **`fmv`'s output link** turns the poses into STANAG 4609 over UDP (ADR-0058 point 2, ADR-0059 point 7). The video comes back into View through an ordinary `fmv` input link, as a real UAV's would.
- **`uav-simulation` knows no video format**, renders nothing and opens no socket.

## 2. Kind and parts

- Kind: **general.** It reads objects and sends to another plugin's channel. It has no connection of its own: no `connections`, no `internet`, no `compute` in its manifest.
- **Server part:** the cameras, the pointing, the poses, the timers, the endpoints, the storage.
- **Web part:** the Cameras panel in the Simulation workspace, and the object action "New camera".
- **It depends on the SDKs only** (ADR-0059 point 6). It finds the simulator's workspace by its id and `fmv`'s link as a channel at run time, with no compile-time tie. Without the simulator, there is no Simulation workspace, so no panel and no platform; without `fmv`, there is no output (function 9).

## 3. Functions

### Cameras

1. **A camera** is `uav-simulation`'s own record, never a map object (ADR-0059 point 4): its platform, its settings (section 5), its output and whether it runs.
   - **Kept in the plugin's documents** through the persistence manager (ADR-0024), one document per camera, keyed **`camera.<id>`** (the id a UUID made by the server part), so a camera's change writes one small document, and **an index document `cameras`** that lists the ids, since documents cannot be listed (owner Q2 A in PCA-uav-simulation's phase 2; a key holds only lowercase words, digits, `-` and `.`, so the brief's earlier `camera/<id>` could not be one). A create writes the camera, then the index; a remove writes the index, then deletes the camera; at start the plugin reads the index, then each camera.
   - **At most 50 cameras** (U1). A 51st is refused with a message.
   - **After a server restart** every camera comes back **stopped** (as the simulator comes back paused, ADR-0041), with its settings and its output.
2. **Its platform** (ADR-0059 point 2; Q6 A, Q7 A): a `core.symbol` object in a layer of the Simulation workspace (`simulator.simulation`), normally a track the simulator moves.
   - **Chosen from the selection:** the object action **"New camera"** on exactly one such object (in Simulation only) opens the Cameras panel with a new camera on it.
   - **A track with the simulator's radar may also carry a camera** (Q6 A). The radar is the simulator's and the camera this plugin's; neither sees the other.
   - **A track carries at most one camera** (U2). "New camera" on a track that has one opens that camera instead.
   - The server part refuses a platform that is not a `core.symbol` in the Simulation workspace, or that does not exist.
3. **What it reads** (ADR-0059 point 2): one store subscription with `inWorkspaces("simulator.simulation")`, **keeping a small record of every `core.symbol` there** (its position, `direction`, `speed`, name and label) and dropping all else at once (owner Q3 A in phase 2): the store has no query by object id (SDK 1.9.0), so a platform or target chosen later is found in that record. Neither a layer nor an object ever changes its workspace (the data model, ADR-0039 R1 and R2; ECore and the test kit refuse it), so a platform or target leaves Simulation only by a delete, of itself or of its layer, which the subscription delivers. It **never writes** an object, and never the simulator's namespace or documents.
   - From each: the position (`Point`, longitude and latitude, and the altitude when the geometry has one, metres HAE), the modifiers `direction` and `speed` (model rules: degrees from true north, metres per second), the name (`properties.name`) and the security label.
   - **A new snapshot replaces what it holds** (the store's `MAX_PENDING_UPDATES`, as the simulator brief's function 17 says): at 1 000 moving tracks the subscription carries about 1 000 updates a second, and the worker drops the ones it does not need at once.
   - **Its height** (ADR-0058 point 1): the platform's altitude where it has one; otherwise the camera's **Height** setting (section 5). A route point with an empty altitude leaves the object's own altitude (the simulator brief, function 5), so "where the route gives none" is "where the object has none".

### The pose

4. **What a pose describes** (ADR-0058 point 1, ADR-0059 point 3), for one frame time:
   - **the camera's position:** the platform's position, extrapolated to the frame time (function 5), and its height (function 3); the camera sits at the platform's point, with no offset (U3);
   - **the platform's attitude:** its heading, the track's `direction` (0 when it has none, as the simulator's radar takes it), and pitch and roll 0, since the simulator flies level;
   - **the pointing:** the camera's azimuth relative to the platform's heading (0° to 360°, clockwise) and its depression below the horizontal (−90° to 90°, positive down), from its pointing mode (function 6), and a camera roll of 0;
   - **the field of view:** horizontal, as set; the **vertical follows from the frame** (ADR-0058 point 1): `2 · atan(tan(h / 2) · height / width)`;
   - **the frame:** its size and rate, and the frame's time (UTC, ECore's clock);
   - **the names and the label:** the platform's name (ST 0601's platform designation, `fmv`'s), the camera's Mission (section 5) and the platform's security label (ST 0102 and the release limit, `fmv`'s; ADR-0058 point 2);
   - **the camera's id**, so that `fmv` keeps the newest pose per camera (`COALESCE_BY_KEY`, ADR-0059 point 7);
   - **the overlay switch** (CR-0055): the camera's Overlay setting (section 5), so that `fmv` burns the camera's data into the frames when it is on.
   - The pose's field names, types and JSON are section 4's.
5. **Poses between the platform's updates** (ADR-0059 point 1): the simulator moves a track once a second; the camera needs a pose per frame. **`uav-simulation` extrapolates the platform** from its last update: along its `direction` at its `speed`, by the SDK's geodesy (`Geodesy`, the direct problem on WGS84, ADR-0019), for the time since that update.
   - **The update's time** is when it reached the worker, on ECore's clock. The object's own `time.observed`, which the simulator sets on every move, **the plugin does not use**: an object drawn by hand has none, and the two differ by a few milliseconds of delivery (PCA-uav-simulation's finding 3 and A2, 2026-11-16).
   - **It follows the updates, not the wall clock:** it extrapolates **at most 1.5 s** (about one update interval and a late tick, U4), then holds that position. So a **paused simulation gives a still platform** (ADR-0041), a stopped route too, and a faster simulation gives larger steps between updates.
   - **A new update replaces the extrapolation at once** (no smoothing, U4): a route's turn shows as a small step at the next update.
   - **The height is held** between updates (no climb rate is extrapolated), and the heading too.
   - A platform without `speed`, or with speed 0, is not extrapolated.
6. **The four pointing modes** (ADR-0058 point 1; owner, 2026-11-15). Each gives the pose's azimuth and depression at the frame time:
   - **Track a point:** a fixed ground point stays in the centre. The camera's settings give its longitude and latitude, and its height (metres HAE, default 0, U5). The azimuth and depression are those of the straight line from the camera to the point in the camera's local level frame (WGS84 ECEF to local north, east, down: no flat Earth), the azimuth taken relative to the heading. A point straight below gives a depression of 90° (its azimuth then 0).
   - **Track an object:** a moving object stays in the centre (ADR-0058 point 1). The target is an object in the Simulation workspace (U6), chosen in the panel from the selection ("Use selection"), read and extrapolated as the platform is (function 5); its height is its altitude, else the point's height setting (U5). **When the target is gone** (deleted, or no longer in Simulation), the camera keeps its last angles relative to the platform and the panel says "Target gone" (U7); it does not stop.
   - **Fixed angles:** an azimuth relative to the platform's heading and a depression, as set. The camera turns with the platform.
   - **Sweep:** the camera pans back and forth over a sector at a set rate.
     - The sector: a start and an end azimuth relative to the heading, clockwise, **an end below the start wraps across north** (e.g. 315° to 45°, as the simulator's radar bearings do); equal ones are refused (U8). The depression is fixed, as set.
     - **The motion:** from the start towards the end at the rate (degrees a second), then back, and so on: a triangle wave, its phase counted from the camera's start, so that a test sees the same angles.
7. **The frame times** (ADR-0059 point 3): **one ECore timer per running camera** (`timers().every`), at the frame period (`1 / rate`, whole milliseconds; `Timers.MIN_PERIOD` is 10 ms). Each tick computes one pose at the tick's time and sends it (function 9).
   - **A late tick is never caught up:** its pose takes the tick's own time, so a slow server sends fewer poses, never old ones. `fmv` counts the frames it misses (ADR-0059 point 7).
   - The cost is small: at 25 frames a second, 25 extrapolations and sends per camera.

**From M9.2** (numbered after function 13, placed here):

14. **Micro sway** (M9.2, V3; ADR-0066 point 3): small irregular offsets to the camera's angles, added in the step that makes each pose (function 7), before it is sent:
    - **yaw** to `pointing.azimuth`, modulo 360°; **pitch** to `pointing.depression`, kept within −90° to 90°; **roll** to `pointing.roll`, kept within −180° to 180°. So `fmv`'s ST 0601 tags 18 to 20, the frame centre, the picture and the overlay (CR-0055) include the sway, with no change in `fmv` and none to the pose's shape (owner: the KLV with the sway).
    - **The motion,** per axis: three sine waves with random frequencies within the camera's range (a single frequency when the lowest equals the highest) and random phases, together at most the amplitude; and **jolts** at random times (a Poisson process), on average the set number a minute, each a step of the set strength in a direction drawn evenly over yaw, pitch and roll, that dies away with the set decay (to 1/e after it). Track an object's kept aim (U7) is the aim without the sway.
    - **Repeatable:** from the camera's seed and the time since the camera started (as the sweep's phase, function 6), so the same seed after the same start gives the same sway. Computed in the worker's per-frame step, with no thread of its own (ADR-0004).
    - **It runs on while the simulation is paused:** the camera does not know the simulator's state (U9), and a hovering camera sways too.
    - **Off by default for every camera:** the checkbox Micro sway (`sway`, default off; owner AFQ, refining AFM), which keeps the sway's values while it is off; **a camera stored before M9.2 has no sway** either (ADR-0066 point 3). A user turns it on per camera in its form.
    - **The exact formula** (the waves, the jolts' times and directions, how many ring at once) is PCA-uav-simulation's, in its README.

### Running

8. **Start and stop** (ADR-0059 point 5): each camera starts and stops by its own control in the panel, with `plugin.uav-simulation.run`, checked by the server on the command's endpoint.
   - **A camera runs whatever the simulation does** (U9): `uav-simulation` reads objects only and does not know the simulator's state. A camera on a paused simulation sends still poses (function 5), so its video shows a still picture.
   - **It stops by itself**, and the panel says why, when:
     - **its platform is gone:** deleted, or no longer in the Simulation workspace ("Platform gone"). It keeps its settings and stays stopped; a user picks another platform;
     - **it is removed.**
   - **When its output goes** (function 9), it stays running but sends nothing ("Output missing"), and sends again when the output comes back.
   - Changing a running camera's settings applies from its next pose; a new frame rate restarts its timer.
9. **The output** (ADR-0059 point 3, ADR-0037): **each camera names one output link**, chosen in the panel from the output channels that take the pose kind (section 4), found with `context.channels().watch`, as the simulator's outputs are found.
   - **Kept by `ChannelId`** (plugin and link). **A chosen channel that disappears,** because its link was renamed, removed or disabled, is **shown as missing, not dropped**, and used again if the same id comes back (the simulator brief, function 18).
   - **One camera per link** (U10): `fmv` renders one camera per output link (ADR-0059 point 7, one compute task per link). The panel shows a link another camera uses as taken, and the server part refuses it.
   - **Sending:** `send` never blocks; `DROPPED` and `CLOSED` are counted, and `CLOSED` marks the output missing. Each pose goes as it is; the release limit is the link's (ADR-0058 point 2), and `uav-simulation` adds none.
   - **What the link says back** (its state for its senders, ADR-0059 point 5, e.g. above its release limit or no render slot; SDK 1.9.0 part U, `ChannelInfo.state()` and `stateDetail()`): the panel marks a camera's output, and each output in the Output list, "(not sending)" or "(degraded)", and the camera's form warns with the link's detail, e.g. "The output sends nothing: No destination". **The camera keeps sending in every state:** the link takes items in each, and `fmv` needs the poses to start sending again.
10. **Status** (monitor view): the cameras, running and stopped, each with its state (Running, Stopped, Platform gone, Target gone, Output missing); the poses sent, `DROPPED` and `CLOSED`, per minute; extrapolations held at the 1.5 s limit, per minute; new snapshots received. **DEGRADED** while a running camera's output is missing. **An output link that is not sending or degraded keeps the status OK** (owner ABP A, 2026-11-17): the status text only counts it, e.g. "1 output not sending", while the camera keeps sending (function 9).

### The web part

11. **The Cameras panel** (ADR-0059 point 4), in the Simulation workspace only (`workspaces: ["simulator.simulation"]`), default pane right, the SDK's `Video` icon. It needs `plugin.uav-simulation.view`, beside the workspace's own view permission (`plugin.simulator.view`).
    - **The list:** one row per camera, named by its platform's name ("(no name)" without one), with its state, its pointing mode and its output, and a Start or Stop button for users with `run`.
    - **The form** (users with `plugin.uav-simulation.edit`; read only for the others): the platform (from "New camera"), the pointing mode with its fields (only those of the chosen mode, as `visibleWhen` does in a settings form), the field of view, the frame size and rate, the Height, the Mission, the output, the checkbox **"Burn the camera's data into the video"** (the Overlay setting, CR-0055) and **the sway's settings** (function 14). **Save** and **Remove** (with a confirmation that names the camera).
    - **Units:** heights in metres, angles in degrees, the rate in degrees a second. The simulator's units are its own user setting (its function 8), which other plugins do not read.
    - **Live:** the panel reads the cameras from the GET endpoint and refreshes on its plugin topic, or every 2 s (the PCA chooses, and says so in its README).
12. **"New camera"**, an object action on one `core.symbol` in Simulation, for users with `edit` (function 2).
13. **Endpoints**, each checked on the server (overview 4.4):
    - `GET` the cameras and the outputs on offer: `plugin.uav-simulation.view`;
    - `POST` create, change, remove: `plugin.uav-simulation.edit`; every value checked against section 5's limits, and the platform and the output against functions 2 and 9;
    - `POST` start, stop: `plugin.uav-simulation.run`.
    - **The Overlay setting** (CR-0055): `GET /cameras` gives it in `settings.overlay`, and `POST /cameras/{id}` takes it.
    - A refused request answers with a message the panel shows at the field or at the top.

## 4. The pose and its channel kind (with D8)

**A declared channel kind fits the pose** (CR-0048 point 4, approved by the owner 2026-11-16, ZB A; the PDA's SDK 1.9.0 CR, part P, D8; owner GQ2 A; ADR-0059 point 3), so **the pose is not an SDK type**. Written 2026-11-16 with the CR, approved with it; `fmv`'s brief (section 10.1) declares it. Until the CR is built, the pose geometry is plain Java with tests (the header's "Until D8 is frozen"), and the content is function 4's either way.
- **The kind is `fmv`'s:** `fmv`'s manifest declares it in `channelKinds` as **`camera-pose`**, so its id is **`fmv.camera-pose`**, with the payload's JSON Schema. **`fmv`'s brief owns the shape** (its output link, D6u); the fields below are the PDA's proposal for that declaration, from function 4, and `fmv`'s brief and this section change together. `uav-simulation`'s manifest names nothing of `fmv`'s.
- **Each pose is a `DeclaredItem`** sent with `channels().send(channel, item)`:
  - `kind`: `fmv.camera-pose`;
  - `id`: the camera's id, so that ECore's channel inbox and `fmv`'s compute task keep the newest pose per camera;
  - `label`: the platform's security label as stored (criterion 13), not in the payload;
  - `payload`: the JSON below, about 300 bytes. ECore checks it against `fmv`'s schema at `send` (CR-0048 point 4.4); a wrong pose is a bug in this plugin, never sent.
- **The outputs on offer** (function 9) are the channels whose `ChannelInfo.takesDeclared("fmv.camera-pose")` is true.

**The payload** (all numbers JSON numbers; angles in degrees, lengths in metres, times UTC):

| Field | Type, unit and limits | From |
|---|---|---|
| `camera` | string, the camera's id (a UUID), the same as the item's `id` | function 1 |
| `time` | string, ISO 8601 UTC with milliseconds (e.g. `2026-11-16T10:15:30.040Z`): the frame time | function 7 |
| `platform.position` | `[longitude, latitude, height]`: −180 to 180, −90 to 90, metres HAE (WGS84, ADR-0007) | functions 3 and 5 |
| `platform.heading` | at least 0 and below 360, from true north | function 4 |
| `platform.pitch`, `platform.roll` | −90 to 90 and −180 to 180; 0 from this plugin | function 4 |
| `platform.name` | string, 1 to 256 characters (`properties.name`'s limit); absent without one | function 3 |
| `pointing.azimuth` | at least 0 and below 360, relative to the heading, clockwise | functions 6 and 14 (the sway) |
| `pointing.depression` | −90 to 90, **positive down** (ST 0601's tag 19 is positive up: `fmv` writes −`depression`, its brief's 10.1; PCA-uav-simulation's finding 7) | functions 6 and 14 (the sway) |
| `pointing.roll` | −180 to 180; 0 from this plugin, plus the sway | functions 4 and 14 |
| `fieldOfView.horizontal`, `fieldOfView.vertical` | 0.1 to 120 and above 0 to 120; the vertical from the frame (function 4) | functions 4 and 5 (settings) |
| `frame.width`, `frame.height`, `frame.rate` | integers: 640 × 360, 1280 × 720 or 1920 × 1080; 1 to 30 frames a second | section 5 |
| `mission` | string, 1 to 64 characters; absent when empty | section 5 |
| `overlay` | boolean; **this plugin sends it in every pose**, `true` or `false`. Optional in `fmv`'s schema, absent meaning `false` (CR-0055 point 2) | section 5 (Overlay) |

```json
{
  "camera": "0193a1f2-7c4e-7d10-9a3b-2f6e8c1d4b57",
  "time": "2026-11-16T10:15:30.040Z",
  "platform": { "position": [17.3, 62.4, 1000], "heading": 45, "pitch": 0, "roll": 0, "name": "Hawk 1" },
  "pointing": { "azimuth": 90, "depression": 30, "roll": 0 },
  "fieldOfView": { "horizontal": 20, "vertical": 11.33 },
  "frame": { "width": 1280, "height": 720, "rate": 25 },
  "mission": "RECCE NORTH",
  "overlay": false
}
```

**`overlay` came with CR-0055** (M9.2), a compatible change (an optional member): **`fmv`'s manifest gains it first**, since ECore refuses a pose with an unknown member at `send` (CR-0048 point 4.4); this plugin sends it after `fmv`, or in the same set.

**What the link says back** to its senders (function 9) is the link's channel state (SDK 1.9.0 part U, `ChannelRef.state`), not this kind.

## 5. Settings

**A camera's settings** (in the panel, stored with the camera; the server refuses a value out of its limits):

| Setting | Default | Limits |
|---|---|---|
| Pointing mode | Fixed angles | Track a point, Track an object, Fixed angles, Sweep |
| Point (Track a point) | the platform's position when the mode is chosen | longitude −180 to 180, latitude −90 to 90 |
| Point's height (Track a point; Track an object when the target has no altitude) | 0 m (U5) | −1 000 to 10 000 m HAE |
| Target (Track an object) | none (the mode needs one before it starts) | an object in Simulation, not the platform |
| Azimuth (Fixed angles) | 0° (ahead) | 0° to 360°, relative to the heading, clockwise |
| Depression (Fixed angles, Sweep) | 30° | −90° to 90°, positive down |
| Sector (Sweep) | 315° to 45° | 0° to 360° each, relative to the heading; an end below the start wraps across north; not equal (U8) |
| Sweep rate | 10°/s | 0.5 to 90°/s |
| Horizontal field of view | 20° | 0.1° to 120° |
| Frame size | 1280 × 720 | 640 × 360, 1280 × 720, 1920 × 1080 |
| Frame rate | 25 frames a second | 1 to 30 |
| Height (where the platform has no altitude) | 1 000 m | 10 to 20 000 m HAE |
| Mission | empty (none) | 0 to 64 characters, any letters, as the simulator's radar (CR-0034); `fmv` fits it to ST 0601 |
| Output | none (a camera sends nothing until one is chosen) | an output channel that takes the pose kind (function 9) |
| Overlay: "Burn the camera's data into the video", `overlay` (CR-0055) | off; also for a camera stored before M9.2 | on or off; a change reaches the next pose, also while the camera runs, without a restart |
| Micro sway, `sway` (function 14) | off (owner AFQ); also for a camera stored before M9.2 | on or off; the values below are kept while it is off |
| Sway amplitude, `swayAmplitude` | 0.3° | 0° to 5° |
| Sway frequencies, `swayMinFrequency` and `swayMaxFrequency` | 0.5 to 3 Hz | 0.1 to 10 Hz each; the highest not below the lowest, equal for one frequency |
| Jolts a minute, `swayJoltsPerMinute` | 2 | 0 to 60 |
| Jolt strength, `swayJoltStrength` | 0.5° | 0° to 10° |
| Jolt decay, `swayJoltDecay` | 0.5 s | 0.05 to 5 s |
| Sway seed, `swaySeed` | a camera's own, drawn from its id, unless the request gives one | 0 to 2 147 483 647 |

**The sway's settings are as built** (`pca-uav-simulation/m9.2-camera` `c058452a`). They change from the next pose, like the others; the cameras' export (M10's plan point 13) carries them.

**Admin settings:** none in M9. How many cameras render at once is `fmv`'s compute threads (ADR-0059 point 7, ADR-0064), and the conversion slots ECore's (`emc2.conversions.max`).

## 6. Permissions

| Permission | For |
|---|---|
| `plugin.uav-simulation.view` | The Cameras panel and the GET endpoint |
| `plugin.uav-simulation.edit` | Creating, changing and removing cameras, and "New camera" |
| `plugin.uav-simulation.run` | Starting and stopping a camera |

The panel shows only in Simulation, so it also needs the workspace's `plugin.simulator.view`. **The demo realms' roles** get them as they have the simulator's three (the ESA's Keycloak sheet; the MCA asks the ESA): the role with `plugin.simulator.view` also `view`, the one with `edit` also `edit`, the one with `run` also `run`.

## 7. Interfaces

| Direction | What |
|---|---|
| Provides | Camera poses to the output channel each camera chooses (section 4). The Cameras panel and the object action "New camera" in Simulation. Nothing for other plugins to call |
| Requires (server) | SDK 1.9.0 part P: the declared channel kind (D8, CR-0048 point 4; section 4). SDK 1.8.0: a worker, timers, the store (a subscription with `inWorkspaces`), plugin documents, `channels().watch` and `send`, GET and POST endpoints, `Geodesy`, status. `sdkVersion` `^1.9.0` |
| Requires (web) | Web SDK 1.8.0: a panel and an object action with `workspaces`, the shared components and look, the plugin's endpoints |
| Uses (other plugins) | The `simulator`'s workspace and tracks (read only), and `fmv`'s output link. Both found at run time; missing ones are shown as such |
| Objects | Reads `core.symbol` objects in the Simulation workspace. **Writes none** |

**Dependencies:** none beyond the SDKs. **Internet access:** none. **Connections:** none. **Compute threads:** none.

## 8. Acceptance criteria

Criteria 1 to 13 and 19 run with the Java and web test kits (`FakePluginContext`, `FakeStore`, the fake channels and timers); 14 to 17 in the browser on port 18107; 18 end to end with `fmv`'s output link (F1). CR-0055's 20 and 21 run with the test kits, 22 in the browser. M9.2's 23 to 25 with the test kits, 26 in the browser.

1. **The manifest:** id `uav-simulation`, the three permissions, the panel with `workspaces: ["simulator.simulation"]`, the object action, `sdkVersion` `^1.9.0`; no `connections`, `internet`, `compute`, data types or channels of its own.
2. **New camera:** on one `core.symbol` in a Simulation layer it makes a camera on it; on an object in View, on a layer that is not Simulation's, or on two objects it is refused. A second "New camera" on the same track opens the first camera (U2). A track with a simulator radar takes a camera (Q6 A).
3. **Limits:** each setting just outside section 5's limits is refused by the server with a message, and just inside it is kept; equal sweep bearings are refused; a 51st camera is refused (U1).
4. **Permissions:** without `view` the GET answers 403; without `edit` create, change and remove answer 403; without `run` start and stop answer 403; each checked on the server, not only hidden. Every endpoint declares the permission it needs (overview 4.4); none is without one.
5. **Stored:** after a restart of the test kit's context (`FakeDocuments` kept), every camera is back with its settings, stopped.
6. **Height:** a platform at `[17.3, 62.4, 500]` gives poses at 500 m; one at `[17.3, 62.4]` gives the Height setting (1 000 m by default).
7. **Fixed angles:** azimuth 90°, depression 30° on a platform with `direction` 45° give poses with azimuth 90° and depression 30° (relative); `direction` absent gives heading 0; pitch and roll 0; the vertical field of view of 20° at 1280 × 720 is 11.33° (±0.01°).
8. **Track a point:** a camera at `[17.30, 62.40]`, 1 000 m, heading 0, and a point at `[17.30, 62.41]`, height 0 (latitude ≠ longitude): azimuth 0° and depression within 0.05° of the ECEF line's (about 41.9°); a point straight below: depression 90°; a point due east: azimuth 90°; with heading 90°, the same point: azimuth 0°.
9. **Track an object:** a target moving east at 20 m/s under a still platform: each pose's azimuth and depression are those of the target's extrapolated position at the frame time (±0.05°). After the target is deleted the angles stay the last ones, the state is "Target gone", and the poses go on.
10. **Sweep:** sector 315° to 45°, 10°/s: the azimuth is 315° at the start, 0° at 4.5 s, 45° at 9 s, 0° at 13.5 s and 315° at 18 s (±0.01°), across north and not the long way round.
11. **Between updates:** a platform at speed 50 m/s, `direction` 90°: 0.5 s after an update the pose lies 25 m east of it (±0.1 m, `Geodesy`), at 1.5 s 75 m, and at 3 s still 75 m (held); a new update moves the pose to it at once. Speed 0 or absent: no movement.
12. **Frames:** at 25 frames a second, the fake timers give one pose every 40 ms, each with its tick's time; at 30, every 33 ms. A late tick sends one pose with its own time, not the missed ones.
13. **Running and output:** a stopped camera sends nothing; started, it sends to its chosen channel; the channel's link removed (`watch`) gives "Output missing", no sends and DEGRADED; the same `ChannelId` back resumes sending. A link chosen by one camera is refused for a second. A deleted platform stops the camera with "Platform gone". `CLOSED` marks the output missing; `DROPPED` is counted. The plugin submits no change request at any time (the fake store records none from it). **The label:** each pose carries its platform's security label as stored; a platform whose label changes sends the new one from the next pose.
14. **In the browser, the panel:** in Simulation only, not in View; a user without `edit` sees the cameras read only, one without `run` no Start; the form shows only the chosen mode's fields; values outside the limits show the server's message at the field.
15. **In the browser, "New camera":** on a track in Simulation, the panel opens with the new camera; not offered in View.
16. **In the browser, the state:** stopping the simulator's route, the camera keeps "Running" and its poses stay at one position after 1.5 s (the status's held count grows); deleting the platform shows "Platform gone".
17. **The status:** the monitor view lists the cameras and their states, and the poses sent per minute.
18. **End to end (with F1; the ITA's T2):** a camera on a track flying a route over the Sundsvall data, fixed angles, through `fmv`'s output link to an `fmv` input link on loopback: View shows the camera symbol moving with the track and its field of view arc in the pose's direction, and the FMV window plays. Stopping the camera stops the video; stopping the link shows "Output missing".
19. **The pose on the channel** (section 4; CR-0048 point 4): with `fmv`'s `camera-pose` schema declared to the fake channels, every sent item is a `DeclaredItem` of kind `fmv.camera-pose` with the camera's id as its `id` and the platform's label, and its payload passes the schema; criterion 7's camera gives `platform.heading` 45, `pointing.azimuth` 90, `pointing.depression` 30 and `fieldOfView.vertical` 11.33 (±0.01); an empty Mission leaves `mission` out. Only channels whose `takesDeclared("fmv.camera-pose")` is true are offered as outputs.
20. **The Overlay setting** (CR-0055): a new camera has `overlay` `false`; a `POST` with `true` keeps it and the `GET` gives it in `settings.overlay`; a value that is not a boolean is refused; without `edit` the `POST` answers 403.
21. **The overlay in the pose:** every pose carries `overlay`, `true` or `false`, as the camera's setting; a change while the camera runs reaches the next pose, and the camera does not restart; the tests' copy of `fmv`'s `camera-pose` schema (criterion 19) equals `fmv`'s manifest's.
22. **In the browser:** the checkbox "Burn the camera's data into the video" is off for a new camera, saves the setting, and is read only without `edit`; switched while the camera runs, `fmv`'s window shows the overlay come and go (with `fmv`'s criterion 42; the ITA's check, as the MCA relayed it: about 1.8 s after Save).
23. **The sway, repeatable** (V3): two cameras with the same seed and settings, started at the same time on the same platform, give the same pointing frame by frame; another seed gives another; a new camera, a camera stored before M9.2, and any camera with `sway` off send every pose as without sway; turning it off and on keeps the values.
24. **The sway's size and limits:** with no jolts, over 60 s every offset is at most the amplitude; with jolts, their number over 10 minutes is near the rate (±50 %), and each falls to 1/e of its step after the decay; a depression of 89° stays within 90° and an azimuth near 0° wraps; every pose passes `fmv`'s schema; each setting just outside its limits is refused.
25. **Paused:** with the platform held still (function 5), the pointing still sways.
26. **In the browser and the video:** the sway's fields in the camera's form, read only without `edit`; through `fmv`, the picture and ST 0601's tags 18 and 19 move with the sway.

## 9. Out of scope (M9)

- **An export and import of cameras** (Q8; M10, L6). A scenario imported as new gives its tracks new ids, so the cameras on the old ones show "Platform gone".
- A platform in View, such as a real ship (Q7 A: Simulation only in M9).
- Drawing the camera's view in Simulation: View shows it through the `fmv` input link (ADR-0059 point 4).
- Gimbal limits and slew rates, zoom while running, a camera's offset from its platform's point, a climb rate between updates, platform pitch and roll.
- Aiming with the terrain: the point's and the target's height are values, not looked up (U5).
- What the video shows, the rendering, the encoding and the imagery: `fmv`'s and ECore's (ADR-0058 point 5, ADR-0059 points 7 and 8).

## Assumptions U1 to U10 (the PDA's, for the owner's approval)

- **U1, at most 50 cameras:** a bound on the stored documents and the panel; far above what `fmv`'s compute threads render at once (about 1.5 cores per 720p camera, ADR-0059 point 7).
- **U2, one camera per track:** a track may have a radar and a camera (Q6 A), but not two cameras. Two cameras on one UAV are two tracks flown together, as ADR-0058 had it for the radar.
- **U3, the camera at the platform's point:** no lever arm; at a UAV's size it is invisible in the video.
- **U4, 1.5 s, and no smoothing:** the simulator ticks once a second and a late tick comes up to about 0.1 s late; 1.5 s covers that and still stops a paused platform within 1.5 s. A route's turn then shows as one small step a second; smoothing would put the camera where the track never was.
- **U5, heights given, not looked up:** `uav-simulation` has no terrain data (the terrain is `fmv`'s, ADR-0059 point 8), so a point's or a target's height is a value (default 0 m HAE). The centre then misses a point on a hill by about its height over the tangent of the depression. **With D8** the pose could carry the point instead of the angles for the two tracking modes, so that `fmv` aims with its terrain; the PDA weighs it there.
- **U6, the target in Simulation:** Q7 A puts the platform in Simulation; the target too, since the plugin reads that workspace only.
- **U7, a lost target holds the angles:** the video stays useful, and the panel says why; stopping would end a stream another system may be recording.
- **U8, equal sweep bearings refused:** a sweep all round would need a direction of its own (always clockwise); not asked for.
- **U9, cameras run apart from the simulation:** `uav-simulation` reads objects only (ADR-0059 point 2) and has no view of the simulator's state; a still picture shows a paused simulation.
- **U10, one camera per link:** `fmv` renders one camera per output link (ADR-0059 point 7); two cameras need two links.
