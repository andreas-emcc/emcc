# Known limits and troubleshooting

## What emcc does not do in this release

- **Tactical graphics** can be placed, moved and reshaped, but you cannot add or remove their points afterwards. A graphic that the symbol set does not have is shown as a marker. APP-6B graphics are shown, not placed.
- **No undo.** A deleted object is gone.
- **One shape or symbol at a time is edited.** There is no way to change several objects together in a panel.
- **No copy and paste** of objects. **Copy to layer** and **Move to layer** work inside the current workspace only: you cannot copy from Simulation to View. There is no export or import of bookmarks.
- **No sorting, filtering or searching** in the Objects list.
- **A classification is a mark.** It does not limit who sees an object. The premade labels in Settings are not offered anywhere else yet.
- **The simulation runs in real time.** There is no speed factor. A scenario is a file that you export and import with the Scenario button in the top bar.
- **The Cursor on Target link sends the callsign of a symbol** from its field set CoT unit, or else its Name.
- **WinTAK on Windows** needs a dot as the decimal symbol in the regional settings, or it does not read positions that emcc sends.
- **A bookmark** keeps the map view only, not the panels or the layers.
- **Viewsheds and height maps** are not saved or shared. Each user can run one at a time. They need height data in DTED format.
- **GMTI** keeps what STANAG 4607 can hold: radar names of at most 10 characters, a dwell area at most 255.99 km on each side of its centre, and speeds along the line of sight. A sending link cuts a deeper area at 511.98 km beyond its near edge and leaves out the detections beyond it.
- **FMV** receives UDP transport streams of STANAG 4609 only: no RTP or RTSP, no files, no recording, no sound, and no footprint or moving-target marks. H.264 and H.265 pass through unchanged and H.265 plays only in a browser that can decode it. MPEG-2 is converted to H.264 by the converter that is shipped with the release, on Windows only; without it an MPEG-2 stream cannot be played. See [FMV: full motion video](03-19-fmv.md).
- **NVG** reads NVG 2.0.0 to 2.0.2 and writes 2.0.2. It does not read NVG 1.x and has no streaming service. A symbol of another standard than APP-6B, APP-6D and APP-6E comes in as the unknown symbol, and goes out again with its own code. An NVG web service that emcc offers has **no login**: see [NVG](05-23-nvg.md). A text on the map cannot be drawn or edited by hand in this release; it can be moved, copied and deleted like other objects.
- **The time control** is not shown in this release.
- **The simulated camera** is a camera on a track of Simulation: one camera for each track and each output link, at most 50 cameras, no gimbal and no zoom, and heights that you give for a point or a target, not heights looked up. The picture is drawn from photographs and heights, as a still scene. The first picture comes a couple of seconds after the first pose, and a 1280 × 720 camera at 25 frames a second keeps up with a little less than 25 on the project’s test computer. Cameras are not exported with a scenario. See [A simulated camera](04-06-camera.md).
- **The simulator makes ground radars only.** A generic sensor comes later.
- **A Systematic scan with a job area** chooses the cells of a pass with the platform's heading at the start of the pass. After a turn in the middle of a pass, some of the cells that are left may lie outside the job area until the next pass. See [Sensors](04-04-sensors.md).

## The map

| What you see | What to do |
|---|---|
| "This computer draws the map without a GPU" | Not an error. The map works; up to about 10 000 objects are drawn one by one, and beyond that clusters. Use a computer with a graphics card for more |
| The map says the browser cannot draw it | The browser has no WebGL. Use another browser, or another computer |
| No map under the symbols, only a grid | The background is None (grid), or the one chosen cannot be loaded. Open Map controls and choose **Natural Earth** |
| OpenStreetMap does not load | The computer that runs the server cannot reach the tile server. Choose Natural Earth, which always works |
| A symbol you placed is not visible | The layer may be switched off with the eye, the map may be dimmed, or it may be outside the view. Use **Zoom to object(s)** from the Objects list |
| You cannot select an object | It may be inside a cluster, in a hidden layer, or in a layer of View seen from Simulation. Zoom in and switch the layer on |

## Editing

| What you see | What to do |
|---|---|
| "You may not edit objects" or "You may not change layers" | You do not have the permission. Ask an administrator. See [Users and permissions](01-03-permissions.md) |
| "Select or create a layer in the layer panel" | There is no active layer. Click a layer in Layers, or create one |
| A tool or button is disabled and says the layer is locked | Someone locked the active layer. Unlock it, or choose another layer. See [Layers](03-14-layers.md) |
| A change is refused with a message | The message gives the reason. The field keeps what you typed, so you can change it and save again |
| You cannot delete a layer | Only an empty layer can be deleted |

## The Simulation workspace

| What you see | What to do |
|---|---|
| The Simulation tab is missing | You do not have the permission to see it |
| The start button is disabled | You do not have the permission to run it |
| A track does not move | It is not on a route, the route is paused, or the route cannot run. The Routes panel says why |
| Nothing arrives at the other system | No output is chosen, or the link is not connected. Check [Ground truth outputs](04-05-outputs.md) and the [Monitor](06-00-monitor.md) |
| A GMTI link shows nothing on the map | The link is not up, or its mission has not arrived yet (it can take up to two minutes), or its detections have expired. A replay needs the link's Time set to `as-received`. See [GMTI on the map](03-17-gmti.md) |
| A sensor sends nothing | The simulation is paused, the sensor has no output chosen, or its platform is not on a route |
| "There is no height data at the observer's point." | The height folder has no data there. See [Terrain](03-13-terrain.md) |
| The Terrain panel is missing | You do not have the permission to use the terrain tools |

## Settings and links

| What you see | What to do |
|---|---|
| A value is refused when you save | A message at the field says why. Correct it and save again |
| "no links" or "no link configured" in the Monitor | No link has been set up yet. That is expected until an administrator adds one |
| A link does not connect | Check the host, the port and the transport. For a TLS link the client certificate must be in the server's configuration. The server's log, `logs/emcc.log`, says more |

## The server

| What you see | What to do |
|---|---|
| The server does not start | See [Running emcc](01-02-running.md) |
| "Live picture" in Status is not connected | Your browser lost the server. Reload the page. If it stays, check that the server runs |
| A plugin shows an error in the Status panel or the Monitor | The text says why. Restart the server. If it persists, ask the person who runs the server to look in `logs/emcc.log` |
