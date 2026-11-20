# Glossary

| Word | Meaning |
|---|---|
| Active layer | The layer that new symbols, shapes and routes go into. It is highlighted in the Layers panel. Each workspace has its own |
| Admin | A user who may administer settings: who sees Settings and the Monitor |
| APP-6 | The NATO standard for military symbols. emcc uses APP-6D, and APP-6E for new symbols if set |
| Append | Adding points after the last point of a line, by clicking on the map. See [Shapes](03-11-shapes.md) |
| Background map | The map drawn under all layers: Natural Earth, OpenStreetMap, a WMS map or a grid |
| Bookmark | A saved map view: projection, background, centre and zoom |
| Callsign | The name of a unit in TAK. It is a field of the field set CoT unit. emcc sends it as the callsign, and without one the Name of the symbol |
| Classification | The level of secrecy in a security label: UNCLASSIFIED, RESTRICTED, CONFIDENTIAL, SECRET or COSMIC TOP SECRET |
| Cluster | A circle with a number that stands for many objects close together on the map |
| CoT | Cursor on Target. The message format that TAK systems use |
| Compute thread | A thread that a plugin declares for work that runs all the time, such as drawing a simulated camera. emcc creates it, limits it and shows it in the Monitor. See [Compute threads](08-06-compute-threads.md) |
| Convoy | Tracks that follow a route one after another, at a set distance |
| Coverage | What a sensor looks at, drawn as a dashed outline: in the Simulation workspace the sensor's range band and arc, and in View the box that an incoming GMTI radar says it works in |
| Credentials file | A file in `settings/credentials/` that holds one secret, such as the login's client secret or a TLS credential, so that it can have its own permissions. See [The settings files](08-01-settings-files.md) |
| Data source | Where an object comes from: "manual" for what users make, or the name of a link |
| Data type | The kind of an object, for example General or AIS vessel. It decides when the object expires |
| Declared field | A field that a plugin adds to objects. Declared fields come in field sets |
| Density | How much room the controls take: Compact or Comfortable |
| Detection | One target report of a GMTI radar, shown as a small mark that does not move and fades away. It is a detection, not a track. See [GMTI on the map](03-17-gmti.md) |
| Dim | Darkens the background map so that symbols stand out |
| Dwell | One look of a radar at a patch of the ground. A revisit is a round of dwells. See [Sensors](04-04-sensors.md) |
| Dwell area | The patch of ground that a GMTI radar looked at in one revisit, drawn as a circle or a band round the platform |
| DTG | Date-time group. The way the clock writes the date and time, for example `032218Z NOV 26` |
| Echelon | The size of a military unit, from team to command |
| Height map | The heights of the ground in a circle, drawn as 16 coloured bands, with the highest point marked. See [Terrain](03-13-terrain.md) |
| HTTPS | HTTP over TLS. emcc serves it itself when it has a certificate. See [HTTPS](08-02-https.md) |
| Field set | A group of fields that belongs to one part of emcc, for example CoT unit or AIS ship. An object shows its sets one at a time, in a list. See [Symbol properties](03-10-symbol-properties.md) |
| Event | Something that happens to a track when it passes a point of a route: its fields change, or it is hidden |
| FMV | Full motion video: live video from a camera, usually on a UAV, with metadata that says where the camera is and looks. See [FMV: full motion video](03-19-fmv.md) |
| Imagery set | A folder of aerial photographs (orthophotos) with a file that says where each tile lies. A simulated camera draws its picture from one. See [FMV output links, imagery and terrain](05-24-fmv-output.md) |
| Output link (FMV) | A link of the direction out that sends the video of a simulated camera as STANAG 4609 over UDP. See [FMV output links, imagery and terrain](05-24-fmv-output.md) |
| Pose | Where a simulated camera is and where it looks for one frame. The camera makes one for each frame and sends it to its output link. See [A simulated camera](04-06-camera.md) |
| Simulated camera | A camera on a track of the Simulation workspace that makes live video, as if the track were a UAV. See [A simulated camera](04-06-camera.md) |
| GMTI | Ground moving target indicator: a radar that sees moving vehicles on the ground. emcc receives and sends it as STANAG 4607 |
| Graphic, tactical graphic | A boundary, a phase line, an area, an axis of advance or another APP-6 graphic that is drawn from its points. See [Graphics](03-12-graphics.md) |
| Formation | Tracks that keep their places relative to each other along a route |
| Ground radar | The kind of sensor that the simulator makes from a track: it looks at its area one dwell at a time and reports what moves. See [Sensors](04-04-sensors.md) |
| Identity | The standard identity of a symbol: friend, hostile, neutral, unknown and so on. It sets the colour |
| Job area | A four-cornered area that a sensor is tasked to scan. See [Sensors](04-04-sensors.md) |
| Label, security label | A mark on every object and layer that holds its classification |
| Layer | A named group of objects. Layers are drawn in order and can be shown, hidden and locked |
| Link | A connection that a plugin makes to another system, set up in Settings |
| Live picture | All the layers and objects the server holds, shared with all browsers as they change |
| Lock | A mark on a layer that stops everyone from changing what is in it |
| MGRS | Military Grid Reference System. A way to write positions |
| NVG | NATO Vector Graphics: a format for exchanging a picture of symbols, lines, areas and texts. See [NVG: import and export](03-18-nvg.md) |
| Monitor | The page where an administrator sees how the server and the plugins are doing |
| No-login mode | Running emcc without login: everyone works as one local user with every permission |
| Object | One thing on the map: a symbol, shape, aircraft, ship, track or route |
| Palette | A set of symbols that a plugin brings to the Symbols panel, for example CoT. See [Symbols](03-09-symbols.md) |
| OpenID Connect | The way users log in. Keycloak and other identity systems offer it. See [What you may bring yourself](08-03-infrastructure.md) |
| Output | A connection that sends the simulation's tracks to another system |
| Pane | An area beside the map that holds panels: left, right or bottom |
| Panel | A part of a workspace with a function: Symbols, Layers and so on |
| Permission | What a user is allowed to do. The server checks it |
| PKCS#12 | A file format for a certificate with its key, ending in `.p12` or `.pfx`. The format to choose for HTTPS and TLS credentials |
| Platform | The vehicle or aircraft that carries a radar. A GMTI platform is shown with its dwell area |
| Plugin | A part of emcc that adds a function |
| Relation line | A line between two related objects, for example a GMTI detection and its platform. You switch each kind on or off in [Display settings](03-05-display.md) |
| Premade label | A security label that an administrator has prepared in Settings: a classification and the values it may be released to. See [Labeling](05-22-labeling.md) |
| Projection | The way the round earth is drawn on the flat map |
| Revisit | One round of a radar through its search area, one dwell after another. The revisit interval is how long it takes at least |
| Reference layer | A layer of View shown in Simulation for looking only |
| Route | A line through points that tracks follow in the Simulation workspace |
| Scenario | The whole Simulation workspace, with its layers, routes, tracks, sensors and events, saved to or loaded from a file. See [Routes](04-02-routes.md) |
| Sensor | A radar that a track carries in the simulation. See [Sensors](04-04-sensors.md) |
| Service | emcc started by Windows with the computer, with no user logged in. See [The Windows service](08-05-service.md) |
| Setup | A saved arrangement of the workspace: panels, layer visibility, map view and clock |
| SIDC | Symbol identification code. The 20 digits that say what an APP-6D symbol is |
| Speed vector | A line from a moving symbol that shows where it will be after a time that you choose, from 5 seconds to 30 minutes. See [Display settings](03-05-display.md) |
| TAK | Team Awareness Kit. A family of systems that exchange positions with CoT |
| TLS credential | The certificates that a link uses to connect to another system over TLS, with a name and a file of their own. See [TLS credentials](08-04-tls-credentials.md) |
| Text object | A text on the map, from NVG, drawn at its point and turned by its rotation. See [NVG: import and export](03-18-nvg.md) |
| Track | A symbol that moves along a route in the simulation. Also an object received from another system |
| Viewshed | The ground that an observer at a point can see, for a target of a given height and up to a range. See [Terrain](03-13-terrain.md) |
| UTM, UPS | Ways to write positions: Universal Transverse Mercator, and the polar version |
| WMS | Web Map Service. A server that serves maps as pictures |
| Workspace | A tab with its own map, panes and layers: View and Simulation |
| WGS84 | The reference system for all positions in emcc |
