# ADR-0058: A simulated FMV camera, rendered by ECore and sent as STANAG 4609

- Status: Accepted (owner, WL A, 2026-11-15; proposed by the ACA the same day, after spike S10)
- Date: 2026-11-15
- Deciders: Owner (advised by the ACA)
- Extends: ADR-0040 (the simulator), ADR-0048 (sensor outputs), ADR-0057 (FMV in, the stream channel, ECore's conversion service), ADR-0049 (plugin folders)

## Context
The owner wants a **simulated UAV with full motion video** (2026-11-14):
- a camera on a simulated track, flying the track's route at its height;
- the camera has a pointing direction and a field of view;
- its video **leaves the server as STANAG 4609**, as a real UAV's would (owner, 2026-11-15).

**Spike S10** (`spikes/s10-uav-fmv/README.md`, the ACA, 2026-11-15) showed:
- **The method:** the camera's view is rendered from a top-down orthophoto draped over the terrain (DTED), and every frame gets exact ST 0601 metadata.
- **The speed:** plain Java renders 720p in 36 ms on one core, with no GPU and no library.
- **Live:** with H.264 encoding by ffmpeg, its own transport stream muxing and paced UDP, a live 720p camera at 25 frames a second costs about 1.4–1.6 cores. It played without errors in the browser.
- **The imagery:**
  - Lantmäteriet's current orthophotos need a purchased licence;
  - its historical ones are published as open data (CC0, to be confirmed by the owner);
  - other imagery has terms of its own.

**What the system already has:**
- **The simulator** has sensors: a ground radar on a simulated track, whose reports go to the output channels that take sensor reports (ADR-0048 points 6 and 7). `gmti` turns them into STANAG 4607.
- **ADR-0057** brings the `fmv` plugin (STANAG 4609 in), the stream channel, and ECore's conversion service, which runs a shipped ffmpeg as a separate process (CR-0045).

Plugins create no threads (`CLAUDE.md` section 4). Real-time rendering at 25 frames a second needs threads of its own.

## Decision
1. **The simulator gets a camera sensor** (extends ADR-0048 point 7).
   - **Its platform:** a camera is a sensor on a simulated track, as the ground radar is.
     - **One sensor per track stays the rule** (the simulator brief, function 27; owner, 2026-11-15, A): a track carries a radar or a camera, not both. For now, a UAV with both is two tracks flown together.
     - Each sensor is listed in the Sensors panel by its platform's name.
     - ADR-0048's pairing and the missing-platform behaviour apply to a camera as to the radar, as far as they fit a camera. The brief says how.
   - **Its height:** the camera flies the track's route at the route's altitude. Where the route gives none, it uses a height of its own, a camera setting.
   - **Its settings:** the field of view (horizontal; the vertical follows from the frame), the frame size and rate, and the pointing mode.
   - **The pointing modes** (owner, 2026-11-15; all four in the first version):
     - **track a point:** a fixed ground point stays in the centre;
     - **track an object:** a moving object on the map stays in the centre, for example another simulated track;
     - **fixed angles:** an azimuth and a depression relative to the platform;
     - **sweep:** the camera pans back and forth over a sector at a set rate.
   - **The simulator stays free of video formats.** It describes the camera's pose over time: platform position and attitude, pointing, field of view, and the frame's time.
2. **The camera's output is an output link of the `fmv` plugin, over UDP** (owner, 2026-11-15, A), as `gmti` out is for the ground radar.
   - The link takes the camera's poses as a new output kind beside sensor reports. Its shape is the PDA's CR.
   - It sends **STANAG 4609 over UDP** to an address and port an admin sets, unicast or multicast:
     - an MPEG-2 transport stream with H.264 video and **ST 0601** metadata for every frame, or every Nth as the link's setting says;
     - ST 0102 security metadata from the camera track's label.
   - **One way into emcc:** emcc's own FMV panel sees a simulated camera as it sees a real one, by an input link that listens to that stream, for example on loopback (ADR-0057). There is no second path into the panel.
   - **Pacing:** the link sends paced datagrams. S10 lost whole keyframes to an unpaced burst.
   - **Its destination** (ADR-0036 points 3 and 4):
     - it comes only from an admin's settings: an address and a port, and for multicast a network interface the admin names;
     - **a new link has no destination and sends nothing until an admin sets one**, so sending to the network is always an admin's choice;
     - the `fmv` manifest declares the connection, and `internet` when the destination may be an internet host.
   - **Its release limit** (ADR-0037 point 8): the link's highest classification limits what goes out, as for every output link. A camera whose track's label is above it is not sent, and the link counts it.
3. **ECore renders and encodes, in a rendering service next to ADR-0057's conversion service.**
   - **Why ECore:** plugins create no threads, and real-time rendering needs them. ECore owns the rendering threads, the ffmpeg process that encodes the frames to H.264, and the muxing.
   - **What the `fmv` plugin does:** it asks ECore for a rendered stream from a camera's poses, and sends the result from its connection task.
   - **Plugins never render, encode or start a program.**
   - **Limits:**
     - a setting limits how many cameras render at once;
     - the service's threads are bounded;
     - a camera's rendering stops when its link stops, its camera is removed, or the simulation stops.

     S10's measure: about 1.5 cores per 720p stream at 25 frames a second on the CPU, with Windows' own H.264 encoder (`h264_mf`) on a 12-core virtual machine. Another encoder or computer will differ.
   - **No GPU is needed.** A GPU is a possible later speed-up, not a requirement.
4. **The imagery and the terrain** (owner, 2026-11-15, C: both):
   - **Files: the rendering service's own settings.** The service has two folder settings, both read-only, and the rules of ADR-0049 carry over to them:
     - **an imagery folder** for orthophoto tiles with their georeference (for example `%emcc%/settings/imagery`; the name is an example). Every imagery set carries its source and its licence;
     - **a terrain folder,** by default `%emcc%/settings/terrain`, the same height files the `terrain` plugin uses by default. The data is shared, not the plugin: ECore reads DTED with a reader of its own, after S10's. Where there is no height data, the ground is flat at the frame's height;
     - **ADR-0049's rules:** the paths come only from an admin's settings, and a path that leaves its folder is refused;
     - the Monitor shows both folders.
   - **WMS: the `fmv` plugin fetches, ECore caches.** Only a plugin's server part reaches outside hosts (`CLAUDE.md` section 4, ADR-0030), so:
     - the `fmv` plugin fetches the tiles through the SDK's outbound HTTP, from a WMS whose host comes only from an admin's settings, never from a request, a message or the data;
     - its manifest declares `internet`;
     - it hands the tiles to the rendering service, which keeps them in a cache under its data, so that the camera works offline afterwards.
   - **Licences:** imagery that is shown or sent out follows its own licence. **Imagery shipped with emcc needs a CR** (`CLAUDE.md` section 4). A video sent to another system carries the imagery onward, so its terms decide where the video may go.
5. **What the video shows:** a top-down image draped over the terrain, seen from the camera.
   - **The scene is static:** no moving objects are drawn into it in the first version.
   - **No occlusion test:** a hill hiding what lies behind it is not handled. S10 found this rare from a UAV looking down.
   - Both may come later.
6. **Encoding generated frames needs ffmpeg beyond CR-0045**, which covers converting MPEG-2. Raw-video input and H.264 encoding for this purpose need an amendment to CR-0045, or a new CR, before the rendering service is built.
   - **The encoder:** CR-0045 chose Windows' own encoder (`h264_mf`) for Windows x64, and left Linux to M9 (ADR-0057's index note 4). That CR, or its amendment, also chooses the Linux encoder and its patent position, since this feature is M9.

## Alternatives considered
- **Rendering in each viewer's browser with WebGL:** no video would leave the server as STANAG 4609 for outside systems (owner, 2026-11-15).
- **Rendering in a plugin:** plugins create no threads, and one 720p camera needs about a core of its own.
- **A separate generator program started by ECore:** a second shipped program, and a second process protocol next to ffmpeg's. Java in ECore was fast enough (S10).
- **The simulator sends STANAG 4609 itself:** it would then know video formats, unlike the ground radar, whose protocol is `gmti`'s. Keeping the format in `fmv` keeps one owner per protocol.
- **Feeding the video straight into the FMV panel as well:** a second path into the panel to build and test (owner: one UDP path, A).
- **Imagery from a WMS only:** it needs the network the first time, against "everything works offline" (ADR-0030). Files come first, and a WMS is an option.

## Consequences
- **PDA:**
  - a CR for the next SDK and data model version: the camera sensor's type and settings, the output kind for camera poses, and the `fmv` link's call to ECore's rendering service;
  - the briefs: the simulator's camera (its settings, the pointing modes, the Sensors panel) and `fmv`'s output link.
- **CDA:**
  - the rendering service in ECore: threads, the renderer after S10's `RenderBench.java`, the frame pipe to ffmpeg, the muxing with ST 0601, the imagery folder, the WMS cache and the limits;
  - its settings in Settings (the imagery and terrain folders, the limits);
  - its entry in the Monitor (cameras rendering, frames late, the folders and the cache).
- **MCA:** the amendment to CR-0045, or a new CR, for ffmpeg's encoding (raw-video input) and its build.
- **PCA-simulator:** the camera sensor, its pointing modes and its poses.
- **PCA-fmv:** the output link, and the WMS fetch for the rendering service's cache.
- **ESA:** none needed. The simulator becomes the FMV test source next to the ESA's replay.
- **ITA:** end-to-end. A camera's stream reaches an outside receiver and emcc's own FMV panel, with ST 0601 matching the scene.
- **UDA:** a manual section on the camera.
- **SRA:** the WMS cache, and the rendering service's resource limits.
- **Planning:** **M9** (owner, 2026-11-15), after M8's `fmv` plugin, stream channel and conversion service, which it builds on.
