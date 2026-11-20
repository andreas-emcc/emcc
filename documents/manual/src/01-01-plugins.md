# The plugins

emcc is built from plugins. The core of emcc keeps the shared picture, checks who may do what, and runs the plugins. Everything you see and use on top of that is a plugin: the map, the panels, the background maps, the symbols and the connections to other systems.

This chapter tells what plugins mean for you. It does not explain how they are made.

## What a plugin can give you

A plugin may have two parts: one in your browser (panels, buttons, the map) and one on the server (connections, work that runs without a browser). Some have only one part. A plugin can give you:

- **panels and buttons** in the workspace;
- **a category in Settings**, if it has settings an administrator may change; each plugin says which heading of the list it stands under (Data Links, GeoMetoc and so on);
- **a connection** to another system, which an administrator sets up as a link in Settings;
- **a data type** for the objects it makes;
- **field sets**: groups of fields that other panels show, for example in Symbol properties;
- **symbol palettes**: sets of symbols that the Symbols panel offers, for example the palette CoT.

Plugins work together through the core and share the map and the objects. If a plugin fails, the rest of emcc goes on, and the [Monitor](06-00-monitor.md) and the [Status](03-16-status.md) panel show what is wrong with it.

## The plugins in this release

| Plugin | What it gives you | Where it is described |
|---|---|---|
| 2D map view | The map: moving, zooming, selecting, the right-click menu, Map controls | [The map](03-02-map.md), [Map controls](03-03-map-controls.md), [2D map view](05-05-map-view.md) |
| Natural Earth background | A world map that is part of emcc and works offline | [Map controls](03-03-map-controls.md), [Natural Earth background](05-15-natural-earth.md) |
| OpenStreetMap background | A street map, fetched by the server from the internet | [OpenStreetMap background](05-17-openstreetmap.md) |
| WMS background maps | Background maps from WMS servers that an administrator adds | [WMS background maps](05-21-wms.md) |
| Coordinates | The position under the pointer, position formats, Go to | [Coordinates](03-04-coordinates.md), [Coordinates](05-09-coordinates.md) |
| Bookmarks | Saved map views, in folders | [Bookmarks](03-06-bookmarks.md), [Bookmarks](05-08-bookmarks.md) |
| Symbology | Draws the military symbols | [Symbology](05-19-symbology.md) |
| Draw symbols | The Symbols and Symbol properties panels | [Symbols](03-09-symbols.md), [Symbol properties](03-10-symbol-properties.md), [Draw symbols](05-12-draw-symbols.md) |
| Draw shapes | The Shapes and Edit shape panels | [Shapes](03-11-shapes.md), [Draw shapes](05-11-draw-shapes.md) |
| Draw tactical graphics | The Graphics and Edit graphic panels | [Graphics](03-12-graphics.md), [Draw tactical graphics](05-13-draw-tactical.md) |
| Terrain | The Terrain panel: range and bearing, viewshed, height map | [Terrain](03-13-terrain.md), [Terrain](05-20-terrain.md) |
| Layers | The Layers panel | [Layers](03-14-layers.md) |
| Objects | The Objects panel | [Objects](03-15-objects.md), [Objects](05-16-objects.md) |
| Cursor on Target | Links that receive objects from TAK systems and send objects to them | [Cursor on Target](05-10-cot.md) |
| ADS-B aircraft | A link that receives aircraft from an ADS-B decoder | [ADS-B aircraft](05-06-adsb.md) |
| AIS | A link that receives ships | [AIS](05-07-ais.md) |
| GMTI | Links that receive ground moving target indicator data from radars and send the simulator's sensor reports | [GMTI on the map](03-17-gmti.md), [GMTI](05-14-gmti.md) |
| FMV | The FMV panel: the camera and its field of view on the map, and its video in a window; links that receive STANAG 4609 over UDP, and output links that send the video of a simulated camera | [FMV: full motion video](03-19-fmv.md), [FMV output links, imagery and terrain](05-24-fmv-output.md) |
| UAV simulation | The Cameras panel in Simulation: a simulated camera on a track, which makes live video | [A simulated camera](04-06-camera.md) |
| NVG | The NVG panel: import an NVG file, export layers as an NVG file; links to NVG web services, in and out | [NVG: import and export](03-18-nvg.md), [NVG](05-23-nvg.md) |
| Simulator | The Simulation workspace: routes, tracks, sensors, outputs | [The Simulation workspace](04-00-simulation.md), [Simulator](05-18-simulator.md) |

The Look, Setups and Status controls, Display settings, Settings and the Monitor are part of the core, not plugins.

## Plugin states

The Status panel and the Monitor show each plugin's state:

| State | Meaning |
|---|---|
| OK | The plugin works. The text may add detail, for example "ready" or "no links" |
| DEGRADED | The plugin works with limits, and says which |
| An error | The plugin does not work, and says why |

## Adding and removing plugins

The installed plugins are in the `plugins` folder next to the start script. The list in this chapter is the plugins in this release. How an administrator adds or removes a plugin, and why a plugin is trusted code, is in [Plugins from others](08-07-plugins.md).
