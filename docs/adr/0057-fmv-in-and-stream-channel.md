# ADR-0057: FMV in (STANAG 4609), with a stream channel from a plugin's server part to its web part

- Status: Accepted (owner, VL A, 2026-11-14; T-206)
- Date: 2026-11-14
- Deciders: Owner (advised by the ACA)
- Extends: ADR-0036 (connection tasks), ADR-0037 (links), ADR-0051 (relations), ADR-0016 (licences, through a CR), ADR-0030 (offline)

## Context
The owner wants full motion video in M8 (2026-11-14):
- **The link:** an admin adds an incoming link in Settings;
- **The panel:** when video arrives, an FMV panel in the View pane lists the stream, and an icon at the end of its row opens the video in a popover window;
- **The map:** a camera symbol shows where the camera is, and an open arc shows where it looks.

**STANAG 4609 Ed. 5** adopts the MISB Motion Imagery Standards Profile 2019.1. For Class 1 motion imagery:
- an MPEG-2 transport stream (MISB ST 1402) over UDP, unicast or multicast, or over RTP;
- video in H.265 (preferred), H.264 or MPEG-2;
- KLV metadata: ST 0601 for platform and sensor, and ST 0102 security metadata in every stream.

**Spike S9** (`spikes/s9-fmv/README.md`, the ACA, 2026-11-14) showed:
- ST 0601 and ST 0102 decode in pure Java;
- mpegts.js 1.8.2 (Apache-2.0) plays live H.264 in the browser, with a first frame after about 0.1 s, when the relay starts each viewer at the last keyframe;
- MPEG-2 converts to H.264 with an LGPL ffmpeg at about half a core per 720p stream;
- in the sample, the sensor's "relative" azimuth is a true bearing to the frame centre.

**Two things emcc does not have:**
- **A way for a plugin's server part to stream bytes to its web part.** Endpoints answer once, with at most a few MiB. A WebSocket channel is on the SDK's "when a plugin needs them" list.
- **Any program shipped beside the server**, and any process a plugin could start.

## Decision
1. **A new plugin, `fmv` (PCA-fmv), receives STANAG 4609 Class 1 motion imagery** over UDP, unicast or multicast:
   - an MPEG-2 transport stream to MISB ST 1402;
   - through an input link that an admin adds in Settings (ADR-0037), in a connection task (ADR-0036);
   - **multicast follows ADR-0036:** a multicast link needs a network interface that an admin names, and without one it stays stopped and says so;
   - **one stream per link:** the first program that has video.
   - **Not in M8:** RTP and RTSP, files, recording and playback of the past.
2. **The server part reads the transport stream only as far as it needs**, and passes the video packets on unchanged:
   - the PAT and the PMT;
   - the KLV stream (asynchronous, stream type 0x06 with `KLVA`; or synchronous, 0x15);
   - the random access indicator, and the PCR.

   It decodes **ST 0601 and ST 0102 in its own Java code**, with no KLV library (S9: `jmisb` brings ffmpeg as a dependency).
3. **On the map, each stream is two objects, linked by a relation** of a kind the plugin declares (ADR-0051). Both have data types that the plugin declares in its own namespace (e.g. `fmv.camera` and `fmv.fieldOfView`, ADR-0023) and the link as their data source. Their names come from the stream: the platform designation or mission id (tags 10 and 3), else the link's name:
   - **The camera:** a `core.symbol` at the sensor position (ST 0601 tags 13–15), with an APP-6 symbol that the brief names (owner, 2026-11-14).
   - **The field of view:** a `core.shape` `ArcBand` from the sensor, inner radius 0, with **a line and no fill** (owner: an open arc).
     - **Direction and length:** its centre bearing and its outer radius are the bearing and the ground distance **to the frame centre** (tags 23–24) when the stream sends it. Otherwise they are heading plus relative azimuth (tags 5 and 18) and the slant range (tag 21).
     - **Width:** the horizontal field of view (tag 16), as the stream gives it. A very narrow arc shows as a line in its direction.
   - **Changes:** through change requests (ADR-0005), at most twice a second per stream. They are stored as every incoming object is, through the persistence manager's write-behind. ADR-0041's unsaved moves are the simulator's only. When the metadata stops, the objects keep their last state, and the panel marks the stream as stale.
4. **Security label:**
   - **With ST 0102:** its classification sets the objects' label, through a mapping the brief fixes as `gmti`'s does.
   - **Without it, or with a value the mapping does not know:** the link's default label.

   Release limits (ADR-0037 point 8) and access by label work as for every object.

   **The video follows the same rule as the objects.** Today reading needs only a login, until access by label comes (ADR-0020; overview 4.4), so the stream endpoint checks the view permission only (point 6). When access by label comes, the stream endpoint also checks the viewer's clearance for the stream's label (its ST 0102 classification, else the link's default label), in ECore, as for objects. The SDK's stream endpoint keeps a label per stream for that.
5. **A stream channel from a plugin's server part to its web part** (the next SDK version, 1.8.0, since 1.7.0 is frozen with M7; the PDA's CR; ECore, the CDA):
   - **The endpoint:** a plugin declares a stream endpoint, a `GET` path with a permission. Every viewer gets an endless binary response (`video/mp2t`) over the session's login, and the server checks the permission.
   - **Feeding it:** the plugin hands ECore immutable chunks (one datagram each) from its connection task. ECore owns the viewers' connections. **No plugin thread, socket or lock** serves a browser.
   - **The keyframe buffer:** ECore keeps, per stream, the latest PAT and PMT and the packets since the last random access point. **A new viewer starts there**, so the picture shows at once.
   - **Slow viewers:** a viewer whose queue passes a bound **loses data**, and the monitor counts it. A slow viewer never slows the plugin or the other viewers.
   - **Limits:** at most a set number of viewers per stream and in all, as settings with defaults from the CR.
   - **The general rule:** the channel carries any binary stream a plugin declares, not only video.
6. **The web part:**
   - **The FMV panel**, in a pane of the View workspace (ADR-0031, ADR-0039), lists the streams: name, link, video format, size and bit rate, the age of the last metadata, and state.
   - **The video:** an icon at the end of a row opens the video in a popover window.
   - **The player:** **mpegts.js** (Apache-2.0), the plugin's own dependency, as mil-sym-ts is `symbology`'s (ADR-0043). It is listed in the third-party notices.
   - **The permission:** watching needs the plugin's view permission (e.g. `plugin.fmv.view`). The map objects need none beyond the layer's.
7. **Video formats** (owner, 2026-11-14):
   - **H.264** passes unchanged and plays in every browser.
   - **H.265 passes unchanged and is never converted.** It plays where the browser can decode it. Elsewhere the window says the format cannot be played in this browser.
   - **MPEG-2 is converted to H.264** by ECore's conversion service (point 8).
   - **Other formats** (e.g. JPEG 2000) are listed and mapped, not played.
8. **ECore's conversion service** (owner, 2026-11-14):
   - **The program:** ECore runs a shipped ffmpeg **as a separate process** per converted stream, and owns the process, its pipes and its stop.
   - **The call:** plugins get one narrow call: convert this MPEG-2 transport stream to H.264, keeping the KLV and the timing. **The PDA's CR fixes the call's shape:**
     - how a connection task feeds it, and how the converted stream reaches the stream channel without passing back through the plugin, if possible;
     - its timeouts: start, a stalled conversion, and stop (`CLAUDE.md` section 4);
     - its bounds, and what the plugin sees when no conversion slot is free.
   - **Plugins never start a program.**
   - **The binary is a minimal LGPL build made for emcc**: only the transport stream reader and writer, the MPEG-2 decoder, one H.264 encoder (OpenH264, BSD, or the operating system's own) and pipes. It is pinned to an exact version and built reproducibly, so it stays a few MB instead of the general builds' 132 MB (S9). The owner asked for a compact binary.
     - It ships in the release's own tools folder, with its licence and its source.
     - It has no GPL parts.
     - Windows x64 first, Linux with the Linux release.
   - **The limits:** a setting limits how many conversions run at once. Each costs about half a core per 720p stream (S9).
   - **Shipping ffmpeg needs a CR** (`CLAUDE.md` section 4), which also names the encoder's patent position and the build. One open point: an OpenH264 built from source carries no patent licence, and only Cisco's own binary does. The CR chooses between Cisco's binary, the operating system's encoder, and accepting that position.
9. **Offline** (ADR-0030):
   - everything is local: the link, the channel, the player and the conversion;
   - mpegts.js is bundled;
   - nothing is fetched from the internet.

## Alternatives considered
- **A WebSocket channel:** two-way, but a new protocol in ECore and the shell. An endless `GET` works with mpegts.js' fetch loader and reuses endpoints, login and permissions (owner, A).
- **HLS segments written by the server:** 3–10 s of delay, and a segmenter on the server.
- **KLV only in the browser** (mpegts.js hands it over): there would be no camera on the map without an open video window, and nothing in the object store for other plugins and outputs.
- **Converting every format to H.264:** a CPU cost on every stream. H.265 is the profile's preferred format and plays in browsers with hardware decoding (owner: never convert H.265).
- **The plugin starts ffmpeg itself:** a general power to start programs for every plugin, next to ADR-0036's sockets. ECore owning one narrow service keeps plugins without processes (owner, A).
- **An administrator installs ffmpeg:** no shipped LGPL code, but one more step on every installation. The owner chose a shipped, compact build.
- **A KLV library (`jmisb`, MIT):** its KLV module declares ffmpeg as a dependency. The few tags emcc needs are a few hundred lines (S9).

## Consequences
- **PDA:**
  - **A CR for SDK and data model 1.8.0:** the stream endpoint (Java and web SDK, the test kit's fake stream), ECore's conversion call, and anything the camera or field-of-view objects need;
  - **the `fmv` brief:** the link's settings, the ST 0601 tags and how each is used, the APP-6 code, the relation kind, the label mapping, the panel and the window, and the tests.
- **CDA:** the stream channel in ECore and the edge (the keyframe buffer, the bounds, the monitor's counters), and the conversion service with its process handling.
- **MCA:**
  - the CR for ffmpeg in shipped code;
  - the reproducible minimal build in `tools/`;
  - the release's tools folder and the third-party notices (ffmpeg's licence and source, OpenH264's, mpegts.js').
- **PCA-fmv:** the plugin.
- **ESA:** an FMV replay that sends a transport stream file over UDP, paced by its PCR, like the GMTI replay. Its test data stays outside the repository: the public sample has no licence.
- **ITA:** end-to-end specs. Video specs run in a browser that plays H.264 (installed Edge or Chrome; Playwright's own Chromium may lack it).
- **UDA:** a manual chapter.
- **SRA:** the new endpoint kind, the process ECore starts, and ffmpeg as a parser of untrusted input are in the next security review.
- **Planning:** M8 (owner, 2026-11-14), in the order: this ADR, the PDA's CR and brief and the ffmpeg CR, then the CDA's channel and the PCA's plugin side by side, with the conversion service last.
