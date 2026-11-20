/**
 * Services between plugins. Every key and interface is defined here, in the SDK, so plugins never
 * import each other (briefs README). No OpenLayers types (owner decision: no escape hatch).
 *
 * @example
 * const map = await ctx.services.get(MAP_VIEW);
 * const where = await map.pickPoint();
 */
import type { LabelId } from './display.ts';
import { DISPLAY_CLASS_IDS } from './model.ts';
import type { Circle, DisplayClass, Ellipse, Geometry, LineString, MilSymbol, ModifierName, Modifiers, Polygon, Position, Style, SymbolStandard, Uuid } from './model.ts';
import type { Unsubscribe } from './events.ts';

/** A typed service key. `one`: exactly one provider; `many`: zero or more. */
export interface ServiceKey<T, C extends 'one' | 'many' = 'one'> {
  readonly id: string;
  readonly cardinality: C;
  /** Type marker only; never set. */
  readonly __type?: T;
}

function key<T, C extends 'one' | 'many'>(id: string, cardinality: C): ServiceKey<T, C> {
  return { id, cardinality };
}

const OWN_KEY = /^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*)+$/;

/**
 * SDK 1.9.0 (CR-0048 point 3, gap G7): a service key of a plugin's own, `<plugin-id>.<name>`, which
 * only the plugin with that id provides (the shell refuses another provider; model rule 24). The SDK's
 * own keys are `emc2.*` and are not made here.
 *
 * **The interface:** the providing plugin documents it in its README, and a using plugin declares the
 * same TypeScript interface in its own code; plugins never import each other. A provider changes it
 * compatibly only, by adding optional members; an incompatible change is a new key, e.g.
 * `acme-tracks.tracks-2`, and the provider may provide both for a while.
 *
 * @example
 * interface TrackService { readonly count: () => number }
 * export const TRACKS = serviceKey<TrackService>('acme-tracks.tracks', 'one');
 *
 * @throws Error if `id` is not `<plugin-id>.<name>`, at most 128 characters, or starts with `emc2.`
 */
export function serviceKey<T, C extends 'one' | 'many' = 'one'>(id: string, cardinality: C): ServiceKey<T, C> {
  if (!OWN_KEY.test(id) || id.length > 128) throw new Error(`a service key is '<plugin-id>.<name>', lowercase words separated by hyphens: ${id}`);
  if (id.startsWith('emc2.')) throw new Error(`emc2.* keys are the SDK's own: ${id}`);
  if (cardinality !== 'one' && cardinality !== 'many') throw new Error(`a service key is 'one' or 'many': ${String(cardinality)}`);
  return Object.freeze(key<T, C>(id, cardinality));
}

/** SDK 1.9.0 (CR-0048 point 3): the plugin id a service key belongs to, `emc2` for the SDK's own keys. */
export function serviceKeyOwner(id: string): string {
  const dot = id.indexOf('.');
  return dot < 0 ? id : id.slice(0, dot);
}

/** The map view of the Map Pane (provided by `map-view-2d`). */
export const MAP_VIEW = key<MapView, 'one'>('emc2.map-view', 'one');
/** Background maps (provided by e.g. `basemap-osm`). */
export const BACKGROUND_MAP = key<BackgroundMapProvider, 'many'>('emc2.background-map', 'many');
/** APP-6 symbols (provided by `symbology`). */
export const SYMBOLS = key<SymbolService, 'one'>('emc2.symbols', 'one');
/** Coordinate formats (provided by `coordinates`). */
export const COORDINATES = key<CoordinateService, 'one'>('emc2.coordinates', 'one');
/** SDK 1.1.0: the objects panel (provided by `object-list`); e.g. `layer-panel` uses it under `uses` (CR-0011). */
export const OBJECT_LIST = key<ObjectListService, 'one'>('emc2.object-list', 'one');

/** The current providers of a `many` key, with change events. */
export interface ServiceList<T> {
  readonly current: readonly T[];
  onChange(listener: (current: readonly T[]) => void): Unsubscribe;
}

/** The plugin's access to services. */
export interface Services {
  /**
   * Provides a service. Allowed only for keys listed in the manifest's `provides`.
   *
   * SDK 1.3.0 (CR-0023): returns what removes this implementation again; `getAll`'s `current`
   * and its `onChange` listeners follow, and a second call does nothing. Meant for `many` keys
   * whose providers come and go at runtime, such as background maps from settings: the map view
   * falls back when the shown background goes. Do not remove a `one` key's implementation: plugins
   * that already got it keep it. A plugin may provide a `many` key more than once: each call adds
   * one implementation, with its own `Unsubscribe` (e.g. one background map per configured server).
   */
  provide<T>(key: ServiceKey<T, 'one' | 'many'>, implementation: T): Unsubscribe;
  /**
   * Resolves when the provider has activated; rejects if it failed or is disabled. The key must be
   * in the manifest's `requires` or `uses` (CR-0011). For a `uses` key, it also rejects at once
   * when no loaded plugin provides it: the plugin then works without the service.
   *
   * @example
   * const symbols = await ctx.services.get(SYMBOLS).catch(() => null);   // "uses": ["emc2.symbols"]
   */
  get<T>(key: ServiceKey<T, 'one'>): Promise<T>;
  /** All providers of a `many` key. */
  getAll<T>(key: ServiceKey<T, 'many'>): ServiceList<T>;
}

/** The most ids the shared selection holds (ADR-0032 point 1). */
export const MAX_SELECTION = 1000;

/** SDK 1.4.0: a value plugins read and are told about, but never write, e.g. `ctx.display`. */
export interface ReadonlyState<T> {
  readonly value: T;
  onChange(listener: (value: T) => void): Unsubscribe;
}

/** A value shared between plugins, e.g. the selection. */
export interface SharedState<T> extends ReadonlyState<T> {
  set(value: T): void;
}

/** A screen position in CSS pixels, relative to the Map Pane's top left corner. */
export type Pixel = readonly [x: number, y: number];

/**
 * The visible part of the map. `visibleArea` is a closed lon/lat ring: unlike a bounding box it is
 * correct at the poles and across the antimeridian, and is the base for the S3 area of interest.
 * Its inside is the side that contains `center`, which matters for views around a pole, where the
 * ring encloses the pole.
 */
export interface Viewport {
  readonly center: Position;
  /** Metres per CSS pixel at the centre. */
  readonly resolution: number;
  /** The map projection's code, e.g. `EPSG:3857` or `EPSG:3413`. */
  readonly projection: string;
  readonly visibleArea: readonly Position[];
}

export interface MapPointerEvent {
  readonly type: 'click' | 'move';
  /** Null when the pointer is outside the projection's valid area. */
  readonly position: Position | null;
  readonly pixel: Pixel;
}

/** SDK 1.1.0: the shapes the drawing service draws (ADR-0033). An arrow and a route are lines; their style says so. */
export type DrawKind = 'circle' | 'ellipse' | 'square' | 'rectangle' | 'polygon' | 'line';

/** What `draw` returns per kind: squares and rectangles as polygons (ADR-0033 point 4), circles and ellipses in metres. */
export type DrawnGeometry = Circle | Ellipse | Polygon | LineString;

/** SDK 1.1.0: the map type, as a setup and a bookmark keep it (ADR-0031). */
export interface MapType {
  /** A configured projection's code, e.g. `EPSG:3413`. */
  readonly projection: string;
  /** The id of a `BackgroundMapProvider`, or null for none (neutral background and graticule). */
  readonly background: string | null;
}

/** Raised (as a rejected promise) by `MapView.edit` for an object the map does not draw (outside the area, in a cluster), unless its `signal` is already aborted (SDK 1.2.0). Centre on it first. */
export class NotOnMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotOnMapError';
  }
}

/**
 * SDK 1.6.0 (CR-0041 part B; T-176): raised (as a rejected promise) by `MapView.append` for an
 * object whose geometry is not a `LineString`, e.g. a polygon, which keeps Reshape only.
 */
export class NotALineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotALineError';
  }
}

/** How the map is drawn (ADR-0017): with a GPU, in software, or not at all. */
export type RenderingMode = 'hardware' | 'software' | 'none';

/**
 * Temporary graphics a plugin draws over the map (previews, highlights, results). Not part of the
 * live picture: drawn in this browser only, never shared or saved.
 *
 * SDK 1.4.0 (CR-0030 part 6, ADR-0049 point 8): `area` and `label`, e.g. for a viewshed and a
 * range readout. A `line`'s edges are geodesic, as an `area`'s are (model rule 10): the map view
 * densifies them; a plugin that wants a circle sends a closed `line` it densified itself.
 */
export type OverlayItem = (
  | { readonly kind: 'point'; readonly position: Position; readonly style?: Style }
  | { readonly kind: 'line'; readonly positions: readonly Position[]; readonly style?: Style }
  | { readonly kind: 'symbol'; readonly position: Position; readonly symbol: MilSymbol }
  | OverlayArea
  | OverlayLabel
) & OverlayClass;

/**
 * SDK 1.6.0 (CR-0041 part D; T-182): an overlay item's display class, e.g. the simulator's coverage
 * (`sensor-coverage`) and dwells (`dwell-area`). The map view hides the item while the user's
 * switch for that class is off (`ctx.display.classes`), as it hides objects of that class.
 */
export interface OverlayClass {
  readonly displayClass?: DisplayClass;
}

/**
 * SDK 1.4.0: a filled area with holes. `rings[0]` is the exterior, further rings are holes; each
 * ring is closed (first and last positions equal) with at least 4 positions, in either orientation.
 * Edges are geodesic, as an object's polygon's are (model rule 10). Drawn with `style`'s stroke and
 * fill, `fillPattern` included.
 */
export interface OverlayArea {
  readonly kind: 'area';
  readonly rings: readonly (readonly Position[])[];
  readonly style?: Style;
}

/** SDK 1.4.0: text at a position, centred on it. */
export interface OverlayLabel {
  readonly kind: 'label';
  readonly position: Position;
  /** 1 to {@link OVERLAY_LABEL_MAX_LENGTH} characters; a line break starts a new line. */
  readonly text: string;
  readonly style?: OverlayLabelStyle;
}

/** SDK 1.4.0: how a label looks; absent parts are the map view's own. */
export interface OverlayLabelStyle {
  /** CSS colour of the text. */
  readonly color?: string;
  /** Text size in CSS pixels, {@link OVERLAY_LABEL_SIZE_MIN} to {@link OVERLAY_LABEL_SIZE_MAX}. */
  readonly size?: number;
  /** CSS colour of a halo round the text, so it reads on any background. */
  readonly haloColor?: string;
}

/** SDK 1.4.0: the most items in one overlay. */
export const OVERLAY_MAX_ITEMS = 20_000;
/** SDK 1.4.0: the most positions in one overlay, over all its items (a point, a symbol and a label count one). */
export const OVERLAY_MAX_POSITIONS = 200_000;
/** SDK 1.4.0: the longest label text. */
export const OVERLAY_LABEL_MAX_LENGTH = 256;
export const OVERLAY_LABEL_SIZE_MIN = 8;
export const OVERLAY_LABEL_SIZE_MAX = 32;

/**
 * SDK 1.4.0: why the map view would not draw these overlay items, or `null` when it would: a ring
 * that is not closed or has fewer than 4 positions, an area without rings, a label without text or
 * with more than {@link OVERLAY_LABEL_MAX_LENGTH} characters, a label size out of range, or more
 * than {@link OVERLAY_MAX_ITEMS} items or {@link OVERLAY_MAX_POSITIONS} positions. **The map view
 * then draws nothing of that overlay and logs the reason** (CR-0030 part 6); a plugin checks first
 * when it may reach the caps, e.g. by simplifying a viewshed.
 */
export function overlayProblem(items: readonly OverlayItem[]): string | null {
  if (items.length > OVERLAY_MAX_ITEMS) return `more than ${OVERLAY_MAX_ITEMS} items: ${items.length}`;
  let positions = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.displayClass !== undefined && !(DISPLAY_CLASS_IDS as readonly string[]).includes(item.displayClass)) {
      return `item ${i}: unknown display class ${String(item.displayClass)}`;
    }
    switch (item.kind) {
      case 'line':
        positions += item.positions.length;
        break;
      case 'area': {
        if (item.rings.length === 0) return `item ${i}: an area has at least one ring`;
        for (let r = 0; r < item.rings.length; r++) {
          const ring = item.rings[r]!;
          if (ring.length < 4) return `item ${i}, ring ${r}: at least 4 positions`;
          const first = ring[0]!;
          const last = ring[ring.length - 1]!;
          if (first.length !== last.length || first.some((v, k) => v !== last[k])) return `item ${i}, ring ${r}: not closed`;
          positions += ring.length;
        }
        break;
      }
      case 'label': {
        if (item.text.length === 0 || item.text.length > OVERLAY_LABEL_MAX_LENGTH) {
          return `item ${i}: a label has 1 to ${OVERLAY_LABEL_MAX_LENGTH} characters`;
        }
        const size = item.style?.size;
        if (size !== undefined && !(size >= OVERLAY_LABEL_SIZE_MIN && size <= OVERLAY_LABEL_SIZE_MAX)) {
          return `item ${i}: a label's size is ${OVERLAY_LABEL_SIZE_MIN} to ${OVERLAY_LABEL_SIZE_MAX}`;
        }
        positions += 1;
        break;
      }
      default:
        positions += 1;
    }
    if (positions > OVERLAY_MAX_POSITIONS) return `more than ${OVERLAY_MAX_POSITIONS} positions`;
  }
  return null;
}

/** A plugin's own overlay. */
export interface Overlay {
  /**
   * Replaces the overlay's items. SDK 1.4.0: when {@link overlayProblem} finds a problem, the map
   * view draws nothing of this overlay until the next `set`, and logs the reason.
   */
  set(items: readonly OverlayItem[]): void;
  clear(): void;
}

/**
 * SDK 1.2.0 (CR-0020): how the plugin that started an interaction (`pickPoint`, `dragObject`,
 * `draw`, `edit`) ends it, e.g. when its tool is switched off or its panel closes.
 *
 * - When `signal` aborts while the interaction runs, the map view ends it and the promise resolves
 *   with `null`, exactly as for Escape. The result of an ended interaction is never used.
 * - A signal that is already aborted resolves with `null` at once, without starting, and does not
 *   end an interaction that another plugin is running. It wins over every other outcome: `edit`
 *   resolves with `null` even for an object the map does not draw, rather than rejecting.
 * - An abort after the interaction ended, or after another interaction replaced it, changes nothing.
 * - An abort ends only the interaction; it does what Escape does to it, and nothing else (it does not
 *   clear the selection).
 * - SDK 1.2.0 (ADR-0039): an interaction runs in the workspace shown, and a workspace switch ends it
 *   as an abort does: it resolves with `null`, before the fresh snapshots and before `onChange`
 *   (`CurrentWorkspace`), so one started again from `onChange` runs. Unlike an abort, the switch also
 *   clears the selection.
 *
 * @example
 * const tool = new AbortController();
 * const geometry = await map.draw('polygon', { style, signal: tool.signal });
 * // when the tool's button is switched off:
 * tool.abort();
 */
export interface InteractionOptions {
  readonly signal?: AbortSignal;
}

/** SDK 1.2.0: objects one plugin wants faded ({@link MapView.createFadeList}). */
export interface FadeList {
  /** Replaces the list. */
  set(ids: readonly Uuid[]): void;
  clear(): void;
}

/**
 * The map view. It draws the whole live picture itself; other plugins change objects through
 * change requests, never by drawing them.
 *
 * SDK 1.3.0, the right click while an interaction runs (`map-view-2d` function 27): it ends
 * `pickPoint` and `draw` as Escape does (resolving with null) or takes back a point, and does
 * nothing to `edit` and a grabbed `dragObject`; each member says how. While any of these runs, a
 * right click opens no menu. For a plugin, a right click that ends an interaction is the Escape
 * path: the promise resolves with null.
 */
export interface MapView {
  readonly viewport: Viewport;
  onViewportChange(listener: (viewport: Viewport) => void): Unsubscribe;
  /** Centres the map, optionally at a resolution (metres per pixel). */
  goTo(center: Position, resolution?: number): void;
  onPointer(listener: (event: MapPointerEvent) => void): Unsubscribe;
  /**
   * Object ids at a pixel, topmost first, not necessarily complete (spike S2). Tolerance in pixels, default 5.
   * SDK 1.3.0: a shape with a fill, solid or hatched, counts only where its outline is within the
   * tolerance, so that clicks pass through a fill to what lies under it (`map-view-2d` function 28).
   */
  pick(pixel: Pixel, tolerance?: number): readonly Uuid[];
  /**
   * Lets the user click one point. Resolves with it, or null if the user cancelled (Escape).
   * SDK 1.2.0 (CR-0020): `signal` ends it as Escape does; see {@link InteractionOptions}.
   * SDK 1.3.0: a right click acts as Escape: it resolves with null, and opens no menu.
   */
  pickPoint(options?: InteractionOptions): Promise<Position | null>;
  /**
   * Lets the user drag an object; resolves with the drop position, or null if cancelled. Does not change the object.
   * While it only waits, one Escape ends it (resolves with null) and clears the selection. Once the
   * object is grabbed, Escape cancels only the drag. SDK 1.2.0 (CR-0020): `signal` ends it, waiting or
   * grabbed, and it resolves with null; an abort does not clear the selection.
   * SDK 1.3.0: a right click does nothing to a grabbed drag, and opens no menu then. While the drag
   * only waits, a right click opens the menu as before.
   */
  dragObject(id: Uuid, options?: InteractionOptions): Promise<Position | null>;
  /** The calling plugin's own overlay. */
  createOverlay(): Overlay;
  /**
   * SDK 1.2.0 (ADR-0040): a list of objects to show faded, in this browser and the workspace shown,
   * e.g. the simulator's hidden tracks. Each list belongs to its handle, as an overlay does; the map
   * view fades the union of all lists, as it fades expired objects. A workspace switch clears every
   * list before the fresh snapshots and before `onChange` (`CurrentWorkspace`): set it again
   * from the fresh snapshot or, when your subscription names its workspace (it then gets no fresh
   * snapshot), from `ctx.workspace.onChange`. Required since W1 (2026-10-29; `map-view-2d` provides
   * it since T-085).
   *
   * A list holds at most 10 000 ids: of a longer one the map view fades only the first 10 000 and
   * logs a warning.
   */
  createFadeList(): FadeList;
  /**
   * The ids of the selected objects, shared by all plugins (ADR-0032). From SDK 1.1.0, documented:
   * - at most {@link MAX_SELECTION} ids; `set` with more keeps the first 1 000 and logs a warning;
   * - it **may hold ids of objects the map does not hold** (set by another plugin, e.g. `object-list`,
   *   or outside the subscribed area); the map view highlights only what it draws, and prunes only
   *   ids of deleted objects;
   * - SDK 1.2.0: a workspace switch clears it, at the map view's moment (`CurrentWorkspace`);
   * - a waiting `dragObject` takes only a press and drag that starts on its object, so clicks still select,
   *   and one Escape still clears it (ending the waiting drag); a grabbed drag, `pickPoint`, drawing and
   *   editing take the first Escape;
   * - the map view's Escape (clear) and the shell's Delete key act only when the focus is not in a text field.
   */
  readonly selection: SharedState<readonly Uuid[]>;
  /** The layer new objects go into. SDK 1.2.0: the map view's moment of a switch leaves it as it is; bringing back a workspace's active layer is `map-view-2d`'s own. */
  readonly activeLayer: SharedState<Uuid | null>;
  /** Local visibility, for this browser only. */
  setLayerVisible(layerId: Uuid, visible: boolean): void;
  isLayerVisible(layerId: Uuid): boolean;
  /** SDK 1.1.0: called when a layer's local visibility changes, also when a setup is restored (`layer-panel`'s eyes follow it). */
  onLayerVisibilityChange(listener: (layerId: Uuid, visible: boolean) => void): Unsubscribe;
  /**
   * SDK 1.1.0: centres the map on the middle of the objects' extent in the map's own coordinates,
   * keeping the zoom (ADR-0032 point 6). Fetches objects the map does not hold. Resolves when the
   * map has moved, with the ids it could not show (gone, or no position inside the projection's
   * `worldExtent`); if none could be shown, the map stays where it is.
   */
  centreOn(ids: readonly Uuid[]): Promise<{ readonly missing: readonly Uuid[] }>;
  /** SDK 1.1.0: fits the map to the objects' extent, with a margin; one object (or all at one point) gives a view about 10 km wide. As {@link MapView.centreOn} otherwise. */
  zoomTo(ids: readonly Uuid[]): Promise<{ readonly missing: readonly Uuid[] }>;
  /**
   * SDK 1.1.0: lets the user draw a shape of `kind` (ADR-0033 point 3), by pressing and dragging
   * (circle, ellipse, square, rectangle) or point by point (polygon, line; double-click or Enter
   * finishes, Backspace removes the last point), with a preview in `style`. Resolves with the
   * geometry in lon/lat, or null when cancelled (Escape, or another interaction started).
   * **It changes nothing:** the caller sends the change request.
   *
   * SDK 1.3.0, the right click, which opens no menu while drawing:
   * - point by point (polygon, line): it removes the last point, as Backspace does; with no point
   *   left it acts as Escape and resolves with null;
   * - by press and drag (circle, ellipse, square, rectangle): before the press it acts as Escape;
   *   during the press it does nothing.
   *
   * SDK 1.4.0 (CR-0030 part 2; owner, 2026-11-06): with `graphic` (a `polygon` or `line`), the
   * preview is that tactical graphic, drawn through the symbology service's `renderGraphic` from the
   * points set so far, the pointer's position counting as the next point. While the points are too few
   * for the graphic, or it does not draw, the preview is the plain line in `style`. The result is the
   * same geometry as without it: the caller puts the points in the catalogue's order, and a
   * `polygon`'s ring keeps the clicked order, closing position last, never reoriented. The drawing
   * cannot finish before the graphic's `minPoints`, and finishes by itself at its `maxPoints`
   * (`graphicCatalog`).
   *
   * @example
   * const geometry = await map.draw('rectangle', { style: { strokeColor: '#1F3A93', fillPattern: 'hatch' } });
   * if (geometry !== null) await ctx.changes.submit(changeRequests.createObject(ctx.newId(), { ...content, geometry }));
   * // SDK 1.4.0: an axis of advance, previewed as itself
   * const axis = await map.draw('line', { graphic: { standard: 'APP-6D', sidc: '10032500001514030000' } });
   */
  draw(kind: DrawKind, options?: { readonly style?: Style; readonly graphic?: MilSymbol } & InteractionOptions): Promise<DrawnGeometry | null>;
  /**
   * SDK 1.1.0: lets the user move a drawn object or drag its corners or points (a circle's radius,
   * an ellipse's axes and rotation by handles); Enter finishes, Escape cancels. Resolves with the new
   * geometry, or null. Rejects at once with {@link NotOnMapError} for an object the map does not
   * draw, unless `signal` is already aborted, which resolves with null (SDK 1.2.0,
   * {@link InteractionOptions}). It changes nothing, as `draw`. SDK 1.3.0: a right click does
   * nothing to it, and opens no menu. SDK 1.4.0: a `core.multipoint` graphic is edited by its control
   * points, and its preview is the graphic itself, drawn again as the points move (as `draw`'s
   * `graphic`).
   */
  edit(id: Uuid, options?: { readonly style?: Style } & InteractionOptions): Promise<Geometry | null>;
  /**
   * SDK 1.6.0 (CR-0041 part B; T-176, owner QG A and QH A): lets the user continue a held
   * `LineString` object from its **last point**, click by click, with a preview line from the last
   * point to the pointer in `style`. A double-click or Enter finishes and resolves with the line's
   * points followed by the added ones, the line's own points unchanged; with none added it resolves
   * with null. Backspace, or a right click, takes back the last added point, never one the line had;
   * with none left a right click acts as Escape. Escape, an abort, a workspace switch or another
   * interaction resolves with null ({@link InteractionOptions}). **It changes nothing:** the caller
   * sends the update, as for `edit`.
   *
   * Rejects at once with {@link NotOnMapError} for an object the map does not draw, and with
   * {@link NotALineError} for any other geometry, unless `signal` is already aborted, which resolves
   * with null. Provided by `map-view-2d` from M7 (its function 44); required since the 1.6.0 freeze.
   *
   * @example
   * const line = await map.append(shape.id, { style: shape.style, signal: tool.signal });
   * if (line !== null) await ctx.changes.submit(changeRequests.updateObject(shape, { ...content, geometry: line }));
   */
  append(id: Uuid, options?: { readonly style?: Style } & InteractionOptions): Promise<LineString | null>;
  /** SDK 1.1.0: the current projection and background. */
  readonly mapType: MapType;
  onMapTypeChange(listener: (mapType: MapType) => void): Unsubscribe;
  /**
   * SDK 1.1.0: switches projection and background (for setups and bookmarks). A projection or
   * background that is not available falls back as the map view's own choice does, with a notice;
   * returns the map type that was applied.
   */
  setMapType(mapType: MapType): MapType;
  readonly renderingMode: RenderingMode;
  /** The WebGL renderer name, if known. */
  readonly renderer: string | null;
}

/** Tiles from the emc2 server. */
export interface XyzSource {
  readonly type: 'xyz';
  /** Template with `{z}`, `{x}`, `{y}`; must point to the emc2 server (Content-Security-Policy `'self'`). */
  readonly url: string;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly tileSize: number;
}

/** A vector background's geometry: GeoJSON in lon/lat, longitudes −180…180, **edges straight in lon/lat** (not geodesic). */
export type VectorGeometry =
  | { readonly type: 'Polygon'; readonly coordinates: readonly (readonly Position[])[] }
  | { readonly type: 'MultiPolygon'; readonly coordinates: readonly (readonly (readonly Position[])[])[] }
  | { readonly type: 'LineString'; readonly coordinates: readonly Position[] }
  | { readonly type: 'MultiLineString'; readonly coordinates: readonly (readonly Position[])[] };

/** One feature of a vector background, drawn with its layer's style. */
export interface VectorFeature {
  /** The id of a layer in {@link VectorSource.layers}. */
  readonly layer: string;
  readonly geometry: VectorGeometry;
}

/** A layer of a vector background. A polygon layer without a stroke is filled only. */
export interface VectorLayer {
  readonly id: string;
  readonly style: Style;
}

/**
 * Vector data the map view projects and draws in **any** projection (ADR-0025), e.g. Natural Earth.
 *
 * - Edges are straight in lon/lat, so no edge crosses the antimeridian: data that crosses it is
 *   **cut at ±180°**. A polygon around a pole runs along latitude ±90°.
 * - The map view densifies long edges, clips to the projection's `worldExtent`, and draws cut
 *   polygons without a seam.
 *
 * @example
 * source: {
 *   type: 'vector', background: '#c9dbe8',
 *   layers: [{ id: 'land', style: { fillColor: '#efeadf' } }, { id: 'coastline', style: { strokeColor: '#7c8c99', strokeWidth: 1 } }],
 *   load: () => fetch(`${ctx.webBase}data/natural-earth.json`).then((r) => r.json()),
 * }
 */
export interface VectorSource {
  readonly type: 'vector';
  /** The colour under all layers, e.g. water; `#rrggbb`. */
  readonly background?: string;
  /** Drawn in this order, the first at the bottom. */
  readonly layers: readonly VectorLayer[];
  /** Called by the map view when the background is first shown, at most once per page. A rejection shows "background unavailable". */
  load(): Promise<{ readonly features: readonly VectorFeature[] }>;
}

/**
 * SDK 1.3.0 (CR-0023, ADR-0035): a background map from a WMS server, through the plugin's server
 * part. The map view draws it with its map engine's WMS support, only in the provider's
 * `projections`, which for a `wms` source are codes, never `'any'` (ADR-0035 point 3).
 *
 * **The map view's duties** (`map-view-2d`), the contract between the map view and the plugin's
 * server part:
 * - **Parameters:** each GetMap request carries `SERVICE=WMS`, `REQUEST=GetMap`, `VERSION`,
 *   `LAYERS` (comma-separated, in `layers`' order), `STYLES` (empty), `FORMAT`, `TRANSPARENT`
 *   (`TRUE` or `FALSE`), `CRS` (1.3.0) or `SRS` (1.1.1) with the projection's code, `BBOX`,
 *   `WIDTH` and `HEIGHT`, each once, and nothing else. Their order is not fixed: the plugin's
 *   server part reads them by name, in any order.
 * - **Size:** `WIDTH` and `HEIGHT` are whole numbers from 1 to 4 096. In `'image'` mode, a view
 *   larger than that (e.g. a 4K screen at pixel ratio 2) asks for a smaller image and scales it up.
 * - **Axis order:** in WMS 1.3.0, for EPSG:4326, whose axis order is latitude, longitude, the
 *   `BBOX` is `minLat,minLon,maxLat,maxLon`; otherwise, and in 1.1.1, `minX,minY,maxX,maxY` in
 *   the projection's own coordinates (ADR-0035 consequences).
 * - **Inside the extent:** it never asks for a box beyond the projection's extent. Tiles wrap at
 *   the antimeridian; a single image is cut at the extent, and the rest of the view stays empty.
 *   Servers need not wrap boxes.
 * - **Only listed projections:** in a projection the provider does not list, the background is not
 *   offered, and the map view falls back as for any background. It never redraws a WMS map in
 *   another projection.
 * - **Errors:** an image that fails is left empty, as a failed `xyz` tile is; the map stays usable.
 *
 * The plugin's server part checks every parameter and builds its own request to its server; it
 * never forwards the browser's query (ADR-0035 consequences). `wmsGetMapUrl` in the test kit
 * builds the URL the map view sends, for tests on both sides.
 *
 * @example
 * source: { type: 'wms', url: `${ctx.serverBase}map/topo`, layers: ['relief', 'roads'], version: '1.3.0', format: 'image/png', transparent: false }
 */
export interface WmsSource {
  readonly type: 'wms';
  /**
   * The plugin's endpoint on the emc2 server, e.g. `${ctx.serverBase}map/topo`, never the WMS
   * server itself (ADR-0030). The map view adds the GetMap parameters.
   */
  readonly url: string;
  /** The server's layer names, the first drawn at the bottom; sent as `LAYERS` in this order. At least one. */
  readonly layers: readonly string[];
  readonly version: '1.1.1' | '1.3.0';
  readonly format: 'image/png' | 'image/jpeg';
  /** `TRANSPARENT=TRUE`; PNG only. Default false. */
  readonly transparent?: boolean;
  /**
   * `'tiles'` (default): a grid of `tileSize` images. `'image'`: one image per view, for servers
   * whose labels suffer at tile edges. Where a projection's extent does not tile (its sides not in a
   * whole-number ratio of at most 16:1), the map view draws a `'tiles'` source as one image per view
   * too (owner, 2026-10-31), so a server part accepts any size from 1 to 4 096 in either mode.
   */
  readonly mode?: 'tiles' | 'image';
  /** Pixels, for `'tiles'`; default 256. */
  readonly tileSize?: number;
}

/** A background map, as data. */
export interface BackgroundMapProvider {
  readonly id: string;
  readonly name: string;
  /**
   * Projection codes the source supports, e.g. `['EPSG:3857']`, or `'any'` (a vector source,
   * ADR-0025). A `wms` source lists codes, never `'any'`.
   */
  readonly projections: readonly string[] | 'any';
  /** SDK 1.3.0: also a {@link WmsSource}. */
  readonly source: XyzSource | VectorSource | WmsSource;
  readonly attribution: { readonly text: string; readonly url?: string };
}

export interface SymbolImage {
  readonly image: ImageBitmap | HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  /** The pixel that belongs at the object's position. */
  readonly anchor: Pixel;
}

/** The parts of an APP-6D or APP-6E SIDC. */
export interface SidcParts {
  readonly standard: 'APP-6D' | 'APP-6E';
  readonly standardIdentity: string;
  readonly symbolSet: string;
  readonly status: string;
  readonly hqTaskForceDummy: string;
  readonly echelonMobility: string;
  readonly entity: string;
}

export interface CatalogEntry {
  readonly name: string;
  readonly symbolSet: string;
  readonly entity: string;
}

/**
 * SDK 1.4.0 (CR-0030 part 2, ADR-0043 point 9): how a tactical graphic is placed.
 * - `line`: a line through its points, e.g. a boundary or a phase line;
 * - `area`: an area around its points, e.g. an assembly area;
 * - `arrow`: an arrow along its points, whose last point sets the arrowhead's width, e.g. an axis of advance;
 * - `points`: one or a few points with distances or azimuths, e.g. a circular target or a range fan.
 */
export type GraphicKind = 'line' | 'area' | 'arrow' | 'points';

/**
 * SDK 1.4.0: one tactical graphic of the symbology service's catalogue, which lists every
 * `core.multipoint` graphic it draws (`draw-tactical` builds its palette and its placing from it).
 *
 * **The control points** of a `core.multipoint` object are its geometry's positions, in the order
 * `points` describes: a `LineString`'s positions, a `MultiPoint`'s positions, or a `Polygon`'s
 * exterior ring without its closing position. `geometry` says which type an object of this graphic
 * stores. A `Polygon` is used only for an `area` whose points have no fixed roles, since the object
 * store may reverse a ring (model rule 1).
 *
 * @example
 * { standard: 'APP-6D', symbolSet: '25', entity: '151403', name: 'Main Attack', path: ['Control Measure', 'Maneuver Areas', 'Axis of Advance'],
 *   kind: 'arrow', geometry: 'LineString', minPoints: 3, maxPoints: 50,
 *   points: ['the tip of the arrow', 'the axis, from the tip back to the tail', 'the width of the arrowhead'],
 *   requiredModifiers: [], allowedModifiers: ['uniqueDesignation', 'dtg', 'dtg1'], echelon: false }
 */
export interface GraphicCatalogEntry {
  readonly standard: 'APP-6D' | 'APP-6E';
  /** Two digits, `25` for control measures. */
  readonly symbolSet: string;
  /** Six digits, the entity, type and subtype. */
  readonly entity: string;
  readonly name: string;
  /** The graphic's place in the standard's tree, outermost first, for a palette. */
  readonly path: readonly string[];
  readonly kind: GraphicKind;
  readonly geometry: 'LineString' | 'Polygon' | 'MultiPoint';
  readonly minPoints: number;
  /** `null`: no limit. */
  readonly maxPoints: number | null;
  /**
   * What each control point is, in order, as APP-6 defines it. When the graphic takes more points than
   * are listed, the second-to-last entry describes the points in between, and the last one the last point.
   * One entry describes them all.
   */
  readonly points: readonly string[];
  /** Amplifiers without which the graphic does not draw, e.g. `distances` for a circle. */
  readonly requiredModifiers: readonly ModifierName[];
  /** Every amplifier the graphic shows, the required ones included. Others are kept but not drawn. */
  readonly allowedModifiers: readonly ModifierName[];
  /** The graphic shows the SIDC's echelon (amplifier B, e.g. a boundary's), which is no modifier. */
  readonly echelon: boolean;
}

/** SDK 1.4.0: what {@link SymbolService.renderGraphic} draws. */
export interface GraphicRenderRequest {
  readonly standard: 'APP-6D' | 'APP-6E';
  readonly sidc: string;
  /** The control points as longitude, latitude, in the catalogue's order (a `Polygon`'s ring without its closing position). */
  readonly points: readonly Position[];
  readonly modifiers?: Modifiers;
  /** Metres per screen pixel at the extent's centre; the service turns it into its renderer's scale. */
  readonly resolution: number;
  /** The view as longitude, latitude: west, south, east, north. West is greater than east across the antimeridian. */
  readonly extent: readonly [west: number, south: number, east: number, north: number];
  /**
   * SDK 1.9.0 (CR-0048 section 6; owner YE B, PQ5 A): the colour of friendly and assumed-friend
   * control measures, from `ctx.display.friendlyGraphicColour`; absent means black. The caller chooses
   * it, and keys its cache on it. APP-6's own colours still win (obstacles green, CBRN hatching yellow).
   */
  readonly friendlyColour?: 'black' | 'blue';
}

/** SDK 1.4.0: a line of a drawn graphic. */
export interface GraphicLine {
  /** Flat longitude, latitude pairs: `[lon0, lat0, lon1, lat1, …]`. Long edges are already bent along great circles. */
  readonly coordinates: Float64Array;
  /** `#RRGGBB`. */
  readonly color: string;
  /** 0 to 1; absent means 1. */
  readonly opacity?: number;
  /** Screen pixels. */
  readonly width: number;
  /** Screen pixels, dash and gap alternating; absent means solid. */
  readonly dash?: readonly number[];
}

/** SDK 1.4.0: a filled area of a drawn graphic. */
export interface GraphicFill {
  /** Rings of flat longitude, latitude pairs; the first is the outside, the others holes. */
  readonly rings: readonly Float64Array[];
  /** `#RRGGBB`. */
  readonly color: string;
  /** 0 to 1. */
  readonly opacity: number;
  /** Absent means `solid`. */
  readonly pattern?: 'solid' | 'hatch';
}

/** SDK 1.4.0: a text label of a drawn graphic. */
export interface GraphicLabel {
  readonly position: Position;
  readonly text: string;
  /** Degrees clockwise on the screen, 0 for upright text. */
  readonly angle: number;
  /** A CSS font, e.g. `bold 12px sans-serif`. */
  readonly font: string;
  /** `#RRGGBB`. */
  readonly color: string;
  /** `#RRGGBB` of mil-sym-ts's own outline around the text, if any, passed through as it gives it. */
  readonly halo?: string;
  readonly align: 'left' | 'center' | 'right';
}

/**
 * SDK 1.5.0 (CR-0039 part 2; owner, HW): an icon inside a drawn graphic, such as a minefield's mines
 * or a contaminated area's sign. mil-sym-ts gives it as an SVG at a point: its centre goes at
 * `position`, turned by `angle`, as mil-sym-ts places it in its own SVG output.
 *
 * **Draw it only as an image** (an `HTMLImageElement`, or the map engine's icon made from one), never
 * as markup in the page, so that nothing in it runs. It comes from the renderer the symbology plugin
 * ships, never from the network (ADR-0030). A worker cannot decode an SVG, so the map view decodes it
 * on the main thread; the same `svg` text is the same image, so it can be cached by it.
 *
 * @example
 * { position: [18.07, 59.33], svg: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=', width: 24, height: 12, angle: 30 }
 */
export interface GraphicImage {
  /** Where the image's centre goes, as longitude, latitude. */
  readonly position: Position;
  /** The image as an SVG data URI (`data:image/svg+xml`, as mil-sym-ts gives it). */
  readonly svg: string;
  /** Screen pixels, greater than 0. */
  readonly width: number;
  /** Screen pixels, greater than 0. */
  readonly height: number;
  /** Degrees clockwise on the screen, 0 for upright. */
  readonly angle: number;
}

/**
 * SDK 1.4.0: a drawn graphic, or the reason it does not draw. On a refusal the map view keeps the
 * fallback marker at the first point (ADR-0043 point 8).
 *
 * SDK 1.5.0 (CR-0039 part 2): `images`, the icons inside the graphic ({@link GraphicImage}). The map
 * view draws them after the fills and lines and under the labels. **Optional, also after the freeze**
 * (owner, A2): absent or empty means none, so a renderer without images is still a renderer.
 */
export type GraphicRendering =
  | {
    readonly ok: true;
    readonly lines: readonly GraphicLine[];
    readonly fills: readonly GraphicFill[];
    readonly labels: readonly GraphicLabel[];
    readonly images?: readonly GraphicImage[];
  }
  | { readonly ok: false; readonly reason: string };

/** APP-6 symbols (ADR-0010). Images are cached by appearance. */
export interface SymbolService {
  render(request: {
    readonly standard: SymbolStandard;
    readonly sidc: string;
    readonly modifiers?: Modifiers;
    /** Pixels. */
    readonly size: number;
    /** Draw text amplifiers too (default false, so images can be shared, spike S2). */
    readonly withText?: boolean;
    /**
     * SDK 1.4.0 (CR-0030 part 5; owner, Q13, 2026-11-07): with `withText`, the user's labels, which
     * the map view passes (up to 1.7.0 `ctx.display.labels`; from 1.8.0 it draws the placed labels
     * itself and passes `[]`, CR-0043 part A). Of the amplifiers on the closed list
     * (`LABEL_IDS`), only these are drawn, at their APP-6 places; amplifiers not on the list are drawn
     * as before, and `name` is the map view's to draw. Absent: every amplifier, as before. Part of
     * the image's appearance, so the cache keys on it. A service that does not know it yet ignores it.
     */
    readonly labels?: readonly LabelId[];
  }): SymbolImage;
  validate(standard: SymbolStandard, sidc: string): { readonly valid: boolean; readonly problem?: string };
  compose(parts: SidcParts): string;
  describe(standard: 'APP-6D' | 'APP-6E', sidc: string): SidcParts;
  catalog(): {
    readonly entities: readonly CatalogEntry[];
    readonly standardIdentities: readonly { readonly code: string; readonly name: string }[];
    readonly echelons: readonly { readonly code: string; readonly name: string }[];
  };
  readonly modifierNames: readonly string[];
  /**
   * SDK 1.4.0 (CR-0030 part 3b, ADR-0047 point 4): the ship-type groups of vessel symbols, in the
   * order a palette or legend shows them, each with its fixed colour and its AIS ship types. Every
   * type 0 to 99 is in exactly one group. `render` and `validate` take `vessel` symbols; `catalog`
   * stays APP-6's. Optional in 1.4.0 (owner, Q24, 2026-11-08), while `symbology` did not provide it;
   * **required since the 1.5.0 freeze** (the owner's Q49 A), as `symbology` does since M5 (T-139).
   */
  vesselGroups(): readonly VesselGroup[];
  /**
   * SDK 1.5.0 (CR-0039 point 6; T-151, the owner's A3): the admin's sensor report symbol, its shape
   * and colour from the symbology plugin's settings, one image for every sensor report. The map view
   * draws it for an object whose data type declares `sensorReport` (`ctx.dataTypes`), instead of the
   * APP-6 symbol; the user's symbol size and labels do not apply to it (owner, 2026-11-08). The same
   * image until the settings change. **Required since the 1.5.0 freeze** (the owner's Q49 A), as
   * `symbology` provides it (T-151).
   */
  sensorReportSymbol(): SymbolImage;
  /**
   * SDK 1.4.0 (CR-0030 part 2): the tactical graphics this service draws, for one standard; APP-6B has
   * none. The first call may load the renderer, so it is a promise. Required since the 1.4.0 freeze.
   */
  graphicCatalog(standard: 'APP-6D' | 'APP-6E'): Promise<readonly GraphicCatalogEntry[]>;
  /**
   * SDK 1.4.0 (CR-0030 part 2, ADR-0043 points 3 and 7): draws one `core.multipoint` graphic for a
   * view, off the main thread. The result is in longitude, latitude; the map view projects it and draws
   * it again after each zoom. It never rejects: a graphic that does not draw, or a request that takes
   * longer than the service's timeout, resolves to `{ ok: false, reason }`. Required since the 1.4.0
   * freeze.
   */
  renderGraphic(request: GraphicRenderRequest): Promise<GraphicRendering>;
}

/** SDK 1.4.0: the id of a ship-type group of vessel symbols (ADR-0047 point 4). */
export type VesselGroupId = 'cargo' | 'tanker' | 'passenger' | 'fishing' | 'pleasure' | 'highSpeed' | 'tugSpecial' | 'other' | 'unknown';

/** SDK 1.4.0: a ship-type group of vessel symbols, with its fixed colour (the same in every look) and its types. */
export interface VesselGroup {
  readonly id: VesselGroupId;
  /** E.g. `Tug and special craft`. */
  readonly label: string;
  /** The fill, `#RRGGBB`. */
  readonly color: string;
  /** Its AIS ship and cargo types, with their names (ITU-R M.1371), e.g. `{ code: 70, name: 'Cargo' }`. */
  readonly shipTypes: readonly { readonly code: number; readonly name: string }[];
}

/** SDK 1.1.0: the objects panel of `object-list`. */
export interface ObjectListService {
  /** Shows the objects of `layerId`, also for a layer hidden locally, and brings the panel to the front. */
  open(layerId: Uuid): void;
}

export type CoordinateFormat = 'dd' | 'dms' | 'utm' | 'mgrs';

/** Coordinate formats for display and input. Internally everything stays WGS84 lon/lat. */
export interface CoordinateService {
  format(position: Position, format?: CoordinateFormat, options?: { readonly precision?: number }): string;
  parse(text: string): { readonly position: Position } | { readonly error: string };
  /** The user's chosen format, shared by the whole UI. */
  readonly chosenFormat: SharedState<CoordinateFormat>;
}
