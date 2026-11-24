# uav-simulation

A simulated camera on a simulated track, as a UAV's sensor (ADR-0059; brief `docs/plugins/briefs/uav-simulation.md`). Owner: PCA-uav-simulation.

**State: V1 phase 3, built against SDK 1.9.0** (`^1.9.0`). Cameras can be made, stored, pointed, started and stopped. Each running camera computes one pose per frame and sends it to the output it chose: an `fmv` output link, as an item of the channel kind `fmv.camera-pose` that `fmv` declares (brief section 4; CR-0048 point 4). `GET /cameras` also shows each camera's latest pose (owner Q4 A). From M9.2 a camera can sway, and can ask `fmv` to burn its data into the video (below).

## What it does

- **Cameras** are the plugin's own records, never map objects. Each is kept as one plugin document, `camera.<uuid>`, plus an index document `cameras` listing the ids (owner Q2 A; document keys allow no `/`, and documents cannot be listed).
  - **At most 50** (U1). **One per track** (U2): "New camera" on a track that has one opens it.
  - **After a restart** every camera comes back stopped, with its settings and its platform's last known name.
- **Platforms and targets:** one store subscription to the Simulation workspace (`simulator.simulation`). The worker keeps a small record of every `core.symbol` there (owner Q3 A): its position, `direction`, `speed`, name, label and the time its update arrived. It drops everything else at once.
  - The store has no query by id. Without these records, "New camera" on a track that never moves would have no position to start from.
- **The pose geometry** (`pose/`):
  - the platform is extrapolated along its direction at its speed for at most 1.5 s after an update, then held (U4);
  - the line of sight runs through WGS84 ECEF to the camera's local north, east and down;
  - the four pointing modes: Track a point, Track an object, Fixed angles and Sweep (a triangle wave clockwise from the start, crossing north when the end is below the start);
  - the vertical field of view comes from the frame.
- **The micro sway** (M9.2's V3; brief function 14, ADR-0066 point 3; owner AEY A), per camera, **off by default** (the checkbox Micro sway, `sway`, which keeps the values while it is off; owner AFQ, refining AFM, instead of the brief's amplitude and jolt strength 0 as the off state): small irregular offsets to the camera's azimuth (yaw), depression (pitch) and roll, added to every pose before it is sent.
  - **The waves:** on each axis three sine waves with frequencies drawn from the lowest to the highest frequency and random phases; their amplitudes add up to the Sway amplitude, so the waves never go further than it.
  - **The jolts:** at random times, on average the Jolts a minute (a Poisson process), a step of the Jolt strength in a direction drawn evenly over the sphere of yaw, pitch and roll, which dies away exponentially: down to 1/e after the Jolt decay. A jolt is dropped after ten decays (below 1/20 000 of its step), and at most 64 ring at once.
  - **The seed:** every draw follows from the Sway seed alone, so the same settings and seed give the same sway at the same time since the start, on any camera (criterion 23). A new camera gets a seed of its own, drawn from its random id, unless its request gives one.
  - **Where it goes:** the azimuth wraps to 0 to below 360, the depression is held at −90 and 90, the camera's roll wraps to −180 to 180; the platform's heading, pitch and roll stay. `fmv` writes ST 0601's sensor angles from the pose, so the KLV carries the sway (owner AEY A). Track an object's kept aim (U7) is the aim without the sway, so it does not wander.
  - **Changes** apply from the next pose while the camera runs; the sway's time counts from the camera's start, and it runs on while the simulation is paused (criterion 25).
- **The overlay** (M9.2's V2; CR-0055, owner ADC A), per camera, **off by default**: the checkbox "Burn the camera's data into the video", `overlay`. Every pose carries it, `true` or `false` (CR-0055 point 2), and `fmv` draws the camera's data into the frames while it is `true` (its function 27). A change reaches the next pose, also while the camera runs, without a restart. A camera stored before M9.2 reads as without it.
- **Running:** one ECore timer per running camera at `1 / rate`, in whole milliseconds (rounded). Each tick computes one pose at the tick's time and sends it (below). The timer is fixed-delay, so a late tick is never caught up.
  - A new frame rate restarts the timer. Other changes apply from the next pose. The sweep's phase keeps counting from the start (B2).
  - **Stops by itself** when its platform is deleted or leaves Simulation ("Platform gone").
  - **Track an object** without its target keeps its last angles and says "Target gone" (U7). A target never seen gives 0° and 30° (A1).
- **The output** (function 9): the plugin watches the output channels and offers those that take `fmv.camera-pose` (`ChannelInfo.takesDeclared`).
  - **Kept by its id** (`plugin/link`), also while it is missing (C1). **One camera per output** (U10): an output another camera has chosen, running or not, is refused (C2).
  - **Each pose** goes as a `DeclaredItem`: the kind `fmv.camera-pose`, the camera's id (so `fmv` keeps the newest per camera), the platform's security label as stored, and the payload of brief section 4, with `overlay` always. ECore checks the payload against `fmv`'s schema and its size (64 KiB) at the send.
  - **Without an output** a camera runs and computes its poses, and sends nothing (C3).
  - **Output missing** (C4): a running camera whose output is not on offer, or whose send answered `CLOSED`, sends nothing, and the status is DEGRADED. It sends again when the same output comes back.
  - **The height guard** (C5): `fmv`'s schema takes platform heights from −1 000 to 20 000 m HAE. A pose outside that is not sent, not clamped; it is counted, and the panel says why. The Height setting (10 to 20 000 m) never trips it; only a platform's own altitude can.
  - **A pose ECore refuses** (C6) is a bug here: it is counted, logged once per start and shown, the status is DEGRADED until a later send is accepted, and the camera keeps running.
  - **What the link says back** (part U, `ChannelInfo.state` and `stateDetail`): Ready, Degraded or Not sending, with `fmv`'s detail, e.g. "No destination". The camera sends in every state: the link takes items in each, and `fmv` needs poses to try again. The panel shows it; the status counts it in its text only and stays OK, since `fmv`'s own status reports the fault (owner, 2026-11-17).
- **The panel** (web part), in Simulation only:
  - the list of cameras by their platform's name, with state, mode, output (marked "(not sending)" or "(degraded)" by what its link says back), and Start or Stop for `run`;
  - the open camera's form, showing only the chosen mode's fields, the checkbox "Burn the camera's data into the video", the Micro sway checkbox with its fields while it is on, and the Output: None, the outputs on offer, each marked by its link's state (one another camera chose is shown as used by it), and the camera's own missing one; a warning with the link's detail while the chosen output is not sending or degraded; read only without `edit`;
  - why the latest pose was not sent, if it was not;
  - Save; Remove, which asks first and names the camera;
  - the server's message shown at the field it names;
  - it reads `GET /cameras` every 2 s while it is mounted (B5).
- **"New camera":** an object action on one `core.symbol` in Simulation, for `edit`. "Use selection" sets Track an object's target from the map's selection.

## Endpoints

Under `/api/plugins/uav-simulation/`. Every one names its permission, which ECore checks. **Every one also needs the Simulation workspace's `plugin.simulator.view`**, which the worker checks and refuses with 403: the cameras show and name Simulation's objects (brief section 6).

| Endpoint | Permission | What |
|---|---|---|
| `GET /cameras` | `view` | The cameras: id, platform, its name and its last reported position (`platformPosition`, `[lon, lat]`, null while it is gone; the form fills Track a point's empty point with it when the mode is chosen), Track an object's target's name, state (`running`, `stopped`, `platformGone`, `targetGone`, `outputMissing`), settings, the output, its name, whether it is missing, and what its link says back (`outputState`: `ready`, `degraded`, `notSending`, or null without an output or while it is missing; `outputDetail`), poses made and sent, why the latest was not sent, the latest pose and its classification. And `outputs`: the outputs on offer, each with the camera that chose it and its link's `state` and `detail` |
| `POST /cameras` | `edit` | `{platform, …settings}`: a new camera. 404 for a platform that is not a symbol in Simulation, 409 (naming the existing `camera`) for a track that has one, 409 above 50. 404 at `output` for an output not on offer, 409 at `output` (naming the `camera`) for one another camera chose |
| `POST /cameras/{id}` | `edit` | Any settings, and `platform` (B7) |
| `POST /cameras/{id}/remove` | `edit` | Removes the camera |
| `POST /cameras/{id}/start`, `/stop` | `run` | Starts or stops it. Start needs the platform, and Track an object needs its target (B4) |

A refusal answers `{error, field}`; the panel shows it at the field.

**A camera's settings** (brief section 5; the server refuses a value outside its limits):

| Setting | JSON name |
|---|---|
| Pointing mode | `mode`: `trackPoint`, `trackObject`, `fixed` or `sweep` |
| Point and its height | `point` `[lon, lat]` (default: the platform's position when Track a point is chosen, filled in by the form, and by the server when a save gives none), `pointHeight` |
| Target | `target`, an object's id |
| Azimuth, depression | `azimuth`, `depression` |
| Sweep | `sectorStart`, `sectorEnd`, `sweepRate` |
| Field of view, frame, height, Mission | `horizontalFov`, `frameSize` (`1280x720` etc.), `frameRate`, `height`, `mission` |
| Output | `output`: `plugin/link`, e.g. `fmv/out-<link id>`, or `null` for none |
| Overlay (M9.2, CR-0055) | `overlay` (`false`): `true` asks `fmv` to burn the camera's data into the video |
| Micro sway (M9.2) | `sway` (`false`), `swayAmplitude` (0 to 5°, 0.3), `swayMinFrequency` and `swayMaxFrequency` (0.1 to 10 Hz, 0.5 and 3; the highest not below the lowest, equal for one frequency), `swayJoltsPerMinute` (0 to 60, 2), `swayJoltStrength` (0 to 10°, 0.5), `swayJoltDecay` (0.05 to 5 s, 0.5), `swaySeed` (a whole number, 0 to 2 147 483 647; a new camera's own). The values are kept while the sway is off. A camera stored before M9.2 reads as without the sway |

## Settings, permissions and internet

- **Admin settings:** none in M9.
- **Permissions:** `plugin.uav-simulation.view`, `.edit` and `.run`. The panel and every endpoint also need the workspace's `plugin.simulator.view`, checked on the server.
- **No internet, no connections and no compute threads.** It writes no objects. It declares no channel kind: `fmv.camera-pose` is `fmv`'s, and the manifest names nothing of `fmv`'s.

## Messages and services

- **Server worker `cameras`** (`CameraMsg`):
  - the store's updates, the list of output channels, the frame ticks, a status tick once a minute, document answers and the endpoints' requests;
  - mailbox 10 000, `dropNewest`.
- **Sends:** `fmv.camera-pose` items to the output each running camera chose (above).
- **Web:**
  - the panel `cameras`, default pane right;
  - the object action `new-camera`;
  - it uses the map view (`emc2.map-view`) for the selection only.

## Status

The monitor shows:
- the cameras, how many are running, and those whose platform or target is gone or whose output is missing;
- the running cameras whose output link says it is not sending or degraded (text only; the status stays OK);
- in the last minute: the poses made and sent; those dropped, closed, not sent (C5) and refused (C6), when there are any; and the extrapolations held;
- the new snapshots received.

The status turns DEGRADED when a document cannot be read (until a restart) or written (until a later write succeeds), while a running camera's output is missing, and while a running camera's poses are refused by ECore.

## Known limits

- **No video yet:** `fmv`'s output link renders and encodes with part U and the CDA's C10. Criterion 18, end to end, waits for that and for `fmv`'s output link on integration.
- **The test kit's payload check** covers part of JSON Schema (no `prefixItems`, `anyOf` or `format`); the tests check the height bound, the frame sizes, the camera's id and the time themselves, and ECore checks the whole schema. The tests' copy of `fmv`'s schema is compared with `fmv`'s manifest (criterion 21), and it has `overlay`.
- **A layer moved out of Simulation is not seen:** the store sends a subscriber no event for a layer that stops matching, so a platform in such a layer stays "present" until it changes. Objects themselves cannot leave their workspace.
- **A platform that is gone** cannot be swapped for another in the panel: the server takes `platform` in a change (B7), but the form offers no control for it. Use "New camera" on the new track.
- The point's and the target's heights are values, not looked up in terrain (U5).
