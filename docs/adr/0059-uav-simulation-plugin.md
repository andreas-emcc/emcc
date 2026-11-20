# ADR-0059: The simulated camera: its logic in its own plugin, `uav-simulation`, its rendering in `fmv`

- Status: Accepted (owner, YK A, 2026-11-16, through the MCA; proposed by the ACA the same day, with the owner's XQ A, GQ2 A and YG A). **Amended by CR-0049 part A** (owner, ZH A, 2026-11-16): the Context's last paragraph, points 3 and 6 and the consequences say that the pose is the declared kind `fmv.camera-pose` (CR-0048 point 4, approved, owner ZB A), and the SDK fallback is gone. **Amended by CR-0051 part A** (owner, AAE A, 2026-11-17), after the owner's O5 in the `fmv` brief: point 8 says that where there is no height data, the ground is flat at 0 m HAE
- Date: 2026-11-16
- Deciders: Owner (advised by the ACA)
- Supersedes: ADR-0058 points 1 and 3, point 4's parts that were ECore's, and their consequences for PCA-simulator and the CDA; amends ADR-0058 point 2's source of the poses
- Extends: ADR-0058 (the simulated camera), ADR-0057 (the conversion service), ADR-0064 (compute tasks), ADR-0037 (output channels)

## Context
ADR-0058 put the simulated camera in the `simulator` plugin. The camera is a sensor on a simulated track, and the simulator describes its poses over time. ECore renders and encodes each frame, and an `fmv` output link sends the video as STANAG 4609 over UDP.

The owner wants the camera as **a track of its own, which can be cut from M9 to M10** (XQ A, 2026-11-16). It must not touch the simulator, and nothing else may depend on it. Inside the simulator it would share the simulator's brief, its worker and its freeze, and cutting it would mean taking code out of the simulator again.

**The rendering moves too** (owner, YG A, 2026-11-16). ECore's rendering service would have put `fmv`'s protocol in ECore: ST 0601, the transport stream's muxing, the imagery and the terrain. Instead, `fmv` renders and muxes on compute threads it declares (ADR-0064), and ECore only encodes, in the conversion service it already has (ADR-0057 point 8).

**The pose is a channel kind that `fmv` declares** (owner, GQ2 A, 2026-11-16; the plugin gap analysis, G3). SDK 1.9.0 lets a plugin declare a channel kind of its own (CR-0048 point 4, approved, owner ZB A), so the pose's shape is `fmv`'s, not the SDK's.

## Decision
1. **A new plugin, `uav-simulation` (PCA-uav-simulation), owns the camera's logic:**
   - the gimbal and the four pointing modes of ADR-0058 point 1: track a point, track an object, fixed angles, sweep;
   - the field of view, the frame size and the frame rate;
   - **the poses between the platform's position updates.** The simulator moves a track once a second; the camera needs a pose per frame, so `uav-simulation` extrapolates the platform from its last position, speed and direction.
     - **It follows the platform's updates, not the wall clock:** it extrapolates no further than about one update interval, and holds the last position when updates stop. So a paused simulation gives a still platform (ADR-0041), and a faster one gives larger steps between updates;
     - the brief fixes the details.

   ADR-0058 points 5 and 6 stand: what the video shows, and the ffmpeg CR. Point 4 stands as point 8 below changes it.
2. **The simulator is unchanged.** `uav-simulation` only reads objects:
   - **its platform:** a track object in the Simulation workspace, normally one the simulator moves (owner, 2026-11-16, M9 plan Q7 A: the Simulation workspace only in M9). **A track that carries the simulator's radar may also carry a camera** (Q6 A): the radar is the simulator's and the camera `uav-simulation`'s, so ADR-0058's "one sensor per track" no longer applies to cameras. Its position, altitude, direction and speed come from the object (its geometry and modifiers). Where the object has no altitude, the camera's own height setting applies (ADR-0058 point 1);
   - **for "track an object":** the target object, read the same way;
   - it reads them through the SDK's object access and change events, as any server part does. It never writes the simulator's objects or namespace.
3. **The camera's poses go on a channel to `fmv`'s new output link** (ADR-0058 point 2, ADR-0037):
   - **the pose is the channel kind `fmv.camera-pose`, which `fmv` declares** (owner, GQ2 A; CR-0048 point 4): `fmv`'s manifest declares it in its `channelKinds`, with the JSON Schema of its payload, and `fmv`'s brief fixes the pose's shape. The SDK carries it as JSON (a `DeclaredItem`) and knows nothing of cameras. **No pose type goes into the SDK;**
   - **ECore checks each pose at `send`:** its size, at most 64 KiB, and the kind's schema (owner, PQ2 A). It keeps only the newest pose per camera in the channel's inbox;
   - each pose carries the security label of the camera's platform, for the link's release limit (ADR-0037 point 8) and ST 0102;
   - a camera names the output link it uses, chosen from the output channels that take that kind (`ChannelInfo.takesDeclared`), as the simulator's outputs are chosen;
   - it sends one pose per frame time, from an ECore timer at the frame rate: the platform's position and direction, the pointing, the field of view and the frame's time;
4. **Where cameras are kept:** in `uav-simulation`'s own stored documents, through the persistence manager (ADR-0024), not as map objects and not in the simulator's scenarios. **An export and import of cameras comes in M10** (owner, 2026-11-16, M9 plan Q8). Its panel, in the Simulation workspace (ADR-0039), lists the cameras and edits them. The video and the camera symbol come back into View through an ordinary `fmv` input link (ADR-0058 point 2).
5. **Its own permissions:** to see, edit and run its cameras, beside the Simulation workspace's view permission for its panel. A camera starts and stops by its own control, with the run permission. Its rendering stops when its link stops, when the camera is stopped or removed, or when its platform object is gone. The panel then says why.
6. **The track stays separable:**
   - no plugin depends on `uav-simulation`;
   - `uav-simulation` depends on the SDK only. It finds `fmv`'s link as a channel, with no compile-time tie;
   - the UAV track's other pieces are `fmv`'s output link with its rendering (point 7), the conversion service's raw input, a channel's state for its senders (for point 5's "the panel then says why") and the ffmpeg CR. All of them are listed as the UAV track in the M9 plan;
   - **cutting it to M10 leaves the rest of M9 whole.** The conversion service's raw input and a channel's state for its senders are therefore SDK 1.9.0's part U, frozen only with the track. Compute tasks (ADR-0064) and declared channel kinds are part P (CR-0048): they are general, and stay when the track is cut. The pose itself is `fmv`'s declaration, not the SDK's.
7. **`fmv` renders and muxes, on compute tasks; ECore encodes** (owner, YG A; supersedes ADR-0058 point 3):
   - **`fmv` declares compute threads** (ADR-0064 point 1): one for each camera that renders at once. An admin lowers that number, or switches the threads off (ADR-0064 point 4). This replaces ADR-0058's setting for how many cameras render at once.
   - **One compute task per output link that renders.** It takes the newest pose from its inbox (`COALESCE_BY_KEY`), renders a picture after S10's renderer (`spikes/s10-uav-fmv/`), and hands the raw picture to ECore's conversion service. It takes the encoded H.264 back in its inbox (ADR-0064 point 3) and muxes it into the transport stream, with **ST 0601** from the same pose and **ST 0102** from the camera track's label. It posts the packets to the link's connection task.
   - **The link's connection task only sends paced UDP** (ADR-0058 point 2): to the admin's destination, with the release limit.
   - **ECore's conversion service takes raw pictures in** (extends ADR-0057 point 8) and gives the H.264 back to the plugin, not into a stream channel as M8's MPEG-2 conversion does. The shapes of the input and the output are the PDA's CR, part U.
     - A rendering camera holds one conversion slot (`emc2.conversions.max`), shared with the MPEG-2 conversions, so an admin sizes both.
     - **Only ECore starts ffmpeg** (CR-0045). ADR-0058 point 6 stands: raw-video input needs the CR-0045 amendment, or a new CR, before the conversion service takes raw pictures.
   - **Late frames:** a late pose is never waited for, and the renderer draws the newest one it has. A picture that misses its frame time is dropped and counted. The Monitor shows the task's busy share and CPU time and `fmv`'s late and dropped frames (ADR-0064 point 5).
   - **No GPU is needed**, as ADR-0058 point 3 said. S10's measure stands: about 1.5 cores per 720p camera at 25 frames a second. About one core is the rendering on `fmv`'s compute thread, and the rest is the encoding in ECore's ffmpeg.
8. **The imagery and the terrain are `fmv`'s** (supersedes ADR-0058 point 4's parts that were ECore's; its rules on WMS hosts and licences stand):
   - **its folders:** an imagery folder and a terrain folder, both declared in `fmv`'s manifest and read through the SDK, read-only and confined (ADR-0049). The terrain folder is by default `%emcc%/settings/terrain`, the same height files the `terrain` plugin uses by default. The data is shared, not the plugin;
   - **the terrain:** `fmv` reads DTED with a reader of its own, after S10's, since plugins share no code. Where there is no height data, the ground is flat at **0 m HAE** (owner, O5 in the `fmv` brief, 2026-11-17; CR-0051 part A): a pose carries the camera's height, not the ground's, so "the frame's height" is not known;
   - **the WMS:** `fmv` fetches the tiles through the SDK's outbound HTTP (ADR-0058 point 4) and keeps them itself, in its own stored data through the persistence manager (ADR-0024), so that the camera works offline afterwards. The PDA's CR says whether stored documents fit tiles, or what else does. **The tiles reach the renderer as immutable messages** from `fmv`'s worker, which fetches and stores them: a compute task makes no HTTP calls and does not use the store (ADR-0064 point 3);
   - the Monitor shows both folders and the cache, in `fmv`'s entry.

## Alternatives considered
- **The camera in the simulator** (ADR-0058 point 1 as accepted): it cannot be cut without reopening the simulator's brief and code, and it ties the camera to the simulator's freeze (owner: a track of its own).
- **The camera's logic in `fmv`:** `fmv` is the protocol's owner (ADR-0058, "one owner per protocol"). A gimbal and pointing modes in it would mix simulation into a format plugin, and `fmv` would depend on the simulator's objects. Rendering a pose into STANAG 4609 is the format's side, so that is `fmv`'s (point 7).
- **Cameras as map objects:** each camera would move once a second with its platform, and add change events and stored versions that nobody needs. The `fmv` input link already shows the camera on the map.
- **Poses at the platform's 1 Hz, interpolated by the renderer:** this would move simulation logic into the format plugin. The owner put the poses between updates in `uav-simulation`.
- **ECore renders, in a rendering service** (ADR-0058 point 3 as accepted): see ADR-0064. The owner chose compute tasks (YG A).
- **The rendering in `uav-simulation`:** it would then know video formats and ST 0601, which are `fmv`'s.
- **ffmpeg muxes the KLV too:** ST 0601 must match each frame exactly, and S10 muxed in Java without trouble. The conversion service stays one narrow call that knows no metadata standard.

## Consequences
- **PDA:**
  - the briefs: `uav-simulation`, and `fmv`'s output link with the `camera-pose` kind's payload schema, the rendering, the muxing, the folders and the WMS cache;
  - in SDK 1.9.0's part P (CR-0048): the compute task (ADR-0064) and the declared channel kind;
  - in part U: the conversion service's raw input with H.264 back to the plugin, and a channel's state for its senders. No pose type;
  - ADR-0058's consequence for the simulator's brief is dropped.
- **PCA-uav-simulation (new):** the plugin, from the template; it sends the poses as declared items of `fmv.camera-pose`.
- **PCA-fmv:** the `camera-pose` kind in its manifest, the output link (ADR-0058 point 2), its compute tasks, the renderer after S10's, the DTED reader, the muxing with ST 0601 and ST 0102, the folders, and the WMS fetch and cache.
- **CDA:** compute tasks in ECore (ADR-0064), and raw pictures into the conversion service. **No rendering service:** ADR-0058's consequence for the CDA is dropped.
- **MCA:** the ffmpeg CR for raw-video input (ADR-0058 point 6), unchanged.
- **PCA-simulator:** nothing.
- **ITA, UDA:** as ADR-0058, for the new plugin and `fmv`'s rendering.
- **SRA:** `fmv`'s WMS cache, the compute limits (ADR-0064), the conversion service's raw input, and a pose from another plugin, checked against the kind's schema and size.
- **Planning:** the UAV track of M9, which may be cut to M10 (owner, XQ A). Compute tasks are track P (owner, YG A).
