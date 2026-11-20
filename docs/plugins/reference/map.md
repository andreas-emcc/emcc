# Map

The map shows the shared live picture: layers and their objects, drawn by the map view plugin for every user. A plugin puts something lasting on the map by creating or changing objects through change requests; it puts something temporary on the map (a preview, a highlight, a result) in its own overlay, in one browser only. The map view, background maps, symbols and coordinate formats are services that plugins provide to each other ([services-and-dependencies.md](services-and-dependencies.md)).

All positions are WGS84 `[longitude, latitude]` (an optional third value is the altitude), in objects, overlays, services and helpers alike.

## Server part (Java)

The server part never draws. It creates, changes and deletes objects and layers through change requests to the object store (`context.store()`), and the map view draws the result in every browser. See [objects.md](objects.md) for the requests, the extensions and the relations.

## Web part (TypeScript)

### Objects and layers

A web part changes the picture the same way, with `ctx.changes.submit` and the `changeRequests` helpers in [`context.ts`](../../../web/plugin-sdk/src/context.ts) ([objects.md](objects.md)). The map view picks the change up from the live picture; the plugin draws nothing itself.

```ts
const map = await ctx.services.get(MAP_VIEW);
const geometry = await map.draw('polygon', { style, signal: tool.signal });   // changes nothing
if (geometry !== null) {
  const outcome = await ctx.changes.submit(changeRequests.createObject(ctx.newId(), {
    type: 'core.shape', dataType: 'core.general', dataSource: 'manual',
    layerId: map.activeLayer.value!, geometry, style, label: ctx.defaultLabel,
  }));
  if (outcome.outcome === 'rejected') ctx.notify({ severity: 'error', message: outcome.rejection.message });
}
```

### The map view service

`MAP_VIEW` (`emc2.map-view`, one provider, `map-view-2d`) gives a `MapView` ([`services.ts`](../../../web/plugin-sdk/src/services.ts)). It exposes no OpenLayers types: other plugins work through this interface only.

| Member | What it does |
|---|---|
| `viewport`, `onViewportChange` | Centre, metres per CSS pixel, projection code, and `visibleArea`, a closed lon/lat ring (correct at the poles and across the antimeridian). `viewportArea(viewport)` makes an area of interest from it. |
| `goTo(center, resolution?)` | Centres the map. |
| `onPointer`, `pick(pixel, tolerance?)` | Pointer clicks and moves; object ids at a pixel, topmost first (tolerance 5 px by default; a fill counts only near its outline). |
| `pickPoint`, `dragObject(id)` | Let the user click a point or drag an object; resolve with a position, or `null` when cancelled. `dragObject` does not change the object. |
| `draw(kind, { style, graphic, signal })` | Lets the user draw a `circle`, `ellipse`, `square`, `rectangle`, `polygon` or `line`; resolves with the geometry or `null`. With `graphic` (a tactical graphic's `MilSymbol`), the preview is that graphic. |
| `edit(id, …)`, `append(id, …)` | Let the user reshape an object, or continue a `LineString` from its last point; resolve with the new geometry or `null`. They reject with `NotOnMapError` for an object the map does not draw, and `append` with `NotALineError` for any other geometry. |
| `selection` | The shared selection of object ids, at most `MAX_SELECTION` (1 000). It may hold ids the map does not draw. |
| `activeLayer` | The layer new objects go into, or `null`. |
| `setLayerVisible`, `isLayerVisible`, `onLayerVisibilityChange` | Local visibility, in this browser only. |
| `centreOn(ids)`, `zoomTo(ids)` | Move the map to objects, also ones the browser does not hold; resolve with the ids that could not be shown. |
| `createOverlay()` | The calling plugin's own overlay (below). |
| `createFadeList()` | The calling plugin's own list of objects to show faded (below). |
| `mapType`, `onMapTypeChange`, `setMapType` | The projection and the background id. |
| `renderingMode`, `renderer` | `hardware`, `software` or `none`, and the WebGL renderer's name. |

**Interactions** (`pickPoint`, `dragObject`, `draw`, `edit`, `append`) run one at a time. Escape, a right click while picking or drawing, another interaction, a workspace switch, or an abort of the `signal` you pass ends one, and it resolves with `null`. Treat `null` as a cancel. `draw`, `edit` and `append` change nothing: the caller sends the change request.

### Temporary overlays

`map.createOverlay()` returns an `Overlay` with `set(items)` and `clear()`. An overlay is drawn in this browser only; it is never shared or saved. Its items (`OverlayItem`):

| `kind` | Fields |
|---|---|
| `point` | `position`, `style?` |
| `line` | `positions`, `style?`; edges are geodesic |
| `area` | `rings` (first the exterior, then holes; each closed, at least 4 positions), `style?` with stroke, fill and `fillPattern` |
| `label` | `position`, `text` (1 to 256 characters; a line break starts a new line), `style?` (`color`, `size` 8 to 32 px, `haloColor`) |
| `symbol` | `position`, `symbol` (a `MilSymbol`) |

Each item may carry a `displayClass` (`dwell-area` or `sensor-coverage`); the map view hides it while the user's switch for that class is off. One overlay holds at most `OVERLAY_MAX_ITEMS` (20 000) items and `OVERLAY_MAX_POSITIONS` (200 000) positions. When `overlayProblem(items)` finds a problem, the map view draws **nothing** of that overlay until the next `set`, and logs the reason; check first when you may reach the caps.

```ts
const overlay = map.createOverlay();
const items: OverlayItem[] = [
  // an overlay's colours are the plugin's data; its UI's colours come from the theme's tokens
  { kind: 'area', rings: [viewshedRing], style: { fillColor: '#2E8B57', fillOpacity: 0.3 } },
  { kind: 'label', position: [18.07, 59.33], text: '12.4 km' },
];
if (overlayProblem(items) === null) overlay.set(items);
```

### Fading

The map view fades objects in three ways:
- **Expiry:** a data type's `defaults.fadeWhenExpired` draws expired objects faded. Expiry has no change event; `expiresAt(object, behaviour)` gives the time to compare with the clock.
- **A stepped fade from the settings:** a data type's `fadeSetting` points into the declaring plugin's settings to a value of the form `{ on, fromSeconds, stepPercent, invisibleAtSeconds }`. The shell resolves it into `DataType.fade` and calls `ctx.onDataTypesChange` when it changes. The map view draws such objects at `fadeOpacity(object, fade, now)`, counted from `time.observed`, in place of the expiry fade. `steppedFadeOf(value)` reads a setting; `stepPercent` is one of `STEP_PERCENTS`, the times at most `MAX_FADE_SECONDS` (a day). See [`fade.ts`](../../../web/plugin-sdk/src/fade.ts).
- **A plugin's fade list:** `map.createFadeList()` gives a `FadeList` (`set(ids)`, `clear()`). The map view fades the union of all lists, in this browser and the workspace shown. A list holds at most 10 000 ids. A workspace switch clears every list: set yours again from the fresh snapshot or from `ctx.workspace.onChange`.

### Relation lines

A plugin declares relation kinds in its manifest's `relationKinds`. An object carries relations to other objects in its `relations` (`{ kind, objectId }`, at most `MAX_RELATIONS`, 1 024). The map view draws a line from the object to each related one, in the kind's `line` style, while the user's switch for the kind (`ctx.display.value.relations[kind]`) is on. `ctx.relationKinds` lists the kinds as declared; `ctx.relationLines.value[kind]` gives each line as drawn now, its colour taken from the declaring plugin's settings when `line.strokeColorSetting` points to a `#RRGGBB` value. An update replaces the whole `relations` list, so a writer keeps other kinds' entries with `replaceRelations(stored, kind, ids)` ([`sets.ts`](../../../web/plugin-sdk/src/sets.ts)).

### Background maps

`BACKGROUND_MAP` (`emc2.background-map`) has many providers. Each provides a `BackgroundMapProvider`: `id`, `name`, `projections` (codes, or `'any'`), `attribution` and a `source`:
- **`xyz`:** tiles from a URL template with `{z}`, `{x}`, `{y}`, which must point to the emcc server (usually your server part, `${ctx.serverBase}…`).
- **`vector`:** `layers` with styles, an optional `background` colour, and `load()`, called once when the background is first shown. The map view projects it into any projection (`projections: 'any'`). Edges are straight in lon/lat, so data that crosses the antimeridian is cut at ±180°.
- **`wms`:** `url` is your own endpoint on the emcc server (`${ctx.serverBase}map/<id>`), never the WMS server; `layers`, `version` (`1.1.1` or `1.3.0`), `format`, `transparent`, `mode` (`tiles` or `image`) and `tileSize`. `projections` lists codes, never `'any'`. The map view adds the GetMap parameters by the contract in `WmsSource`'s TSDoc; your server part reads them by name, checks each one, and builds its own request to the server its settings name.

`services.provide` returns an `Unsubscribe`. A plugin may provide several backgrounds, and remove one when its settings change; the map view falls back when the shown background goes.

### Symbols

`SYMBOLS` (`emc2.symbols`, one provider, `symbology`) gives a `SymbolService`: `render` (an APP-6 or vessel symbol as an image with its anchor), `validate`, `compose` and `describe` (the parts of an APP-6D or APP-6E SIDC), `catalog`, `modifierNames`, `vesselGroups`, `sensorReportSymbol`, `graphicCatalog(standard)` (the tactical graphics it draws, with their control points) and `renderGraphic(request)` (one tactical graphic for a view, in lon/lat; it never rejects, and resolves `{ ok: false, reason }` when it cannot draw).

SIDC helpers: `canonicalSidc(standard, sidc)` writes a 30-digit APP-6E SIDC whose digits 21 to 30 are zero in its 20-digit form; use it when writing and comparing SIDCs ([`sidc.ts`](../../../web/plugin-sdk/src/sidc.ts)). `vesselSidc` and `parseVesselSidc` build and read a vessel symbol's 4-digit code. A plugin offers sets of symbols to the Symbols panel through its manifest's `symbolPalettes` ([services-and-dependencies.md](services-and-dependencies.md)).

### Display settings

`ctx.display` (a `ReadonlyState<DisplaySettings>`, [`display.ts`](../../../web/plugin-sdk/src/display.ts)) holds each user's display settings, the same in every workspace and browser, defaults already applied: `symbolSize` (16 to 96 px), `speedVectorSeconds` (0 or one of `SPEED_VECTOR_STEPS_SECONDS`), `labelPlaces` (the text label at each place round a symbol), `directionArrow`, `relations` (one switch per loaded relation kind), `classes` (one switch per display class) and `friendlyGraphicColour` (absent means black; read it with `friendlyGraphicColourOf`). `labels` and `speedVectorMinutes` give the same choices as a list and in minutes; read `labelPlaces`, `directionArrow` and `speedVectorSeconds` instead. Read the value, and redraw on `ctx.display.onChange`. `classShown(display, displayClass)` says whether a class is shown.

### Coordinates

`COORDINATES` (`emc2.coordinates`, one provider, `coordinates`) gives a `CoordinateService`: `format(position, format?, { precision })` in `dd`, `dms`, `utm` or `mgrs`; `parse(text)` to `{ position }` or `{ error }`; and `chosenFormat`, the user's format, shared by the whole UI. Internally everything stays WGS84 lon/lat.

## In the manifest

- [`relationKinds`](manifest.md#relationkinds): `id`, `label`, `line` (`strokeColor`, `strokeWidth` 0.5 to 10, `strokeDash`, `arrowhead`, `strokeColorSetting`) and `defaultOn`.
- [`dataTypes`](manifest.md#datatypes): `defaults.fadeWhenExpired` and `fadeSetting`.
- [`provides`, `requires`, `uses`](manifest.md#dependencies-and-services): `emc2.map-view`, `emc2.background-map`, `emc2.symbols`, `emc2.coordinates`.
- [`kind`](manifest.md#kind): `map-view` for the one plugin that holds the Map Pane (`ctx.ui.setMapView`), `background-map` for a background provider.

## Rules

- Never draw objects yourself. Change them through change requests; the map view draws the live picture ([ADR-0005](../../adr/0005-change-events-single-writer.md)).
- Positions are WGS84 `[longitude, latitude]` everywhere ([ADR-0007](../../adr/0007-common-data-model.md)).
- An overlay is local to one browser. Never use it for what other users must see.
- A background's URL points to the emcc server, never to an outside host. A WMS server part never forwards the browser's query; it checks every parameter and builds its own request ([ADR-0030](../../adr/0030-offline-first-configurable-hosts.md), [ADR-0035](../../adr/0035-wms-background-maps.md)).
- A plugin reads `ctx.display` and never writes it.
- Never remove the implementation of a `one` key such as `emc2.map-view`: plugins that already got it keep it.
- Every function works offline: a background from the internet has an offline fallback, such as the Natural Earth vector background.

## Testing

`@emc2/plugin-sdk/testing` has a fake map view and fake services ([testing.md](testing.md)):

```ts
const ctx = createFakeContext({ pluginId: 'my-plugin' });
const map = createFakeMapView();
ctx.provideAs(MAP_VIEW, map);
ctx.provideAs(SYMBOLS, createFakeSymbolService());
await plugin.activate(ctx);
// … start the plugin's draw tool, then the user finishes the polygon:
expect(map.runningInteraction).toBe('draw:polygon');
map.completeDrawing({ type: 'Polygon', coordinates: [[[18, 59], [19, 59], [19, 60], [18, 59]]] });
expect(ctx.submitted).toHaveLength(1);
expect(map.overlayProblems.at(-1)).toBeNull();
```

- `FakeMapView`: `completeInteraction`, `completeDrawing`, `rightClick`, `runningInteraction`, `setNotDrawn`, `setNotLines`, `setPickResult`, `overlayItems`, `overlayProblems`, `fadeLists`, `faded`, `asPlugin`, `switchWorkspace`.
- `createFakeCoordinateService`, `createFakeSymbolService` (with `refuse` and `withImages`), `createFakeVectorBackground`.
- `wmsGetMapUrl(source, request)` builds the URL the map view sends, for tests of both a WMS web part and its server part.
- `ctx.setDisplay(choices)` and `ctx.setPluginSettings(pluginId, settings)` change the display settings, the relation lines' colours and the stepped fades.

## See also

- [objects.md](objects.md): change requests, relations, data types
- [services-and-dependencies.md](services-and-dependencies.md): service keys and palettes
- [actions.md](actions.md): the right-click menus on the map
- [ADR-0025](../../adr/0025-vector-background-maps.md), [ADR-0033](../../adr/0033-drawn-shapes.md), [ADR-0040](../../adr/0040-simulator.md) (fade lists), [ADR-0051](../../adr/0051-relations-between-objects.md)
