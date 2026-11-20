/**
 * What the map draws for an object (brief function 4): only what drawing needs, in lon/lat with
 * edges densified (spike S2 consequence 5, model rule 10).
 *
 * - `core.symbol` with a point and a symbol: an image from the SymbolService, plus the direction of
 *   movement as a separate arrow (below).
 * - `core.shape` with a Point, LineString, Polygon, Circle or Ellipse: the geometry with its style
 *   (circles and ellipses as rings of geodesic points).
 * - `core.multipoint` with a symbol and its control points (a tactical graphic, brief function 29):
 *   drawn from the symbology service's `renderGraphic`; until it has answered, or when it refuses, as
 *   the fallback marker at its first point.
 * - Anything else (plugin types, a shape or symbol that does not fit): a neutral fallback marker at its
 *   first position, so no object is invisible (criterion 10).
 */
import type { Projection } from './projections.ts';
import { canonicalSidc, CORE_TEXT, TEXT_SIZE_DEFAULT } from '@emc2/plugin-sdk';
import type { DataType, Geometry, GraphicRendering, LabelId, MapObject, MilSymbol, Modifiers, OverlayLabelStyle, Position, Style, Uuid } from '@emc2/plugin-sdk';
import { circleRing, densifyPath, ellipseRing } from './geodesic.ts';
import { arcBandRings, corridorRing } from './areas.ts';

interface ItemBase {
  readonly id: Uuid;
  readonly layerId: Uuid;
  /** Drawn at `FADED_OPACITY` (`expiry.ts`): the object has expired and its data type fades it, or it is on a fade list (brief functions 13 and 24). */
  readonly faded?: boolean;
  /** Drawn at this opacity, above 0 and below 1: the step its data type's fade in steps has reached (brief function 46); it wins over `faded`. */
  readonly opacity?: number;
}

/** A drawn tactical graphic: what `renderGraphic` answered, in longitude, latitude. */
export type GraphicParts = Extract<GraphicRendering, { readonly ok: true }>;

export type DrawItem =
  | (ItemBase & {
      readonly kind: 'symbol';
      readonly position: Position;
      readonly symbol: MilSymbol;
      readonly appearance: string;
      /** Direction of movement in degrees clockwise from north, [0, 360); null without one. */
      readonly direction: number | null;
      /** The object's `properties.name`, drawn under the symbol when the user's labels include `name` (brief function 35). */
      readonly name?: string;
      /** The speed in m/s (modifier `speed`), when it is above 0: the speed vector's length (brief function 35). */
      readonly speed?: number;
      /**
       * Its data type declares `sensorReport` (brief function 39): the engine draws the symbology service's sensor report
       * symbol, and nothing else of the symbol (no labels, arrow or speed vector), when the service has one.
       */
      readonly sensorReport?: true;
    })
  | (ItemBase & { readonly kind: 'point'; readonly position: Position; readonly style: Style | undefined })
  | (ItemBase & {
      readonly kind: 'line';
      readonly positions: readonly Position[];
      readonly style: Style | undefined;
      /** The line's own points, before densifying: where route markers go (data model 1.1.0 `pointMarkers`). */
      readonly vertices?: readonly Position[];
      /** The shape's `properties.name`, drawn as its label (brief function 18). */
      readonly name?: string;
      /** A line that is drawn under the symbols and never picked or labelled: a speed vector or a relation line (brief functions 34 and 35). */
      readonly aux?: true;
    })
  | (ItemBase & { readonly kind: 'polygon'; readonly rings: readonly (readonly Position[])[]; readonly style: Style | undefined; readonly name?: string })
  | (ItemBase & {
      readonly kind: 'graphic';
      readonly symbol: MilSymbol;
      /** The control points as the service takes them: a `Polygon`'s ring without its closing position. */
      readonly points: readonly Position[];
      /** The drawn graphic; null until the service has answered, and after a refusal: the fallback marker at the first point is drawn then. */
      readonly parts: GraphicParts | null;
    })
  | (ItemBase & { readonly kind: 'fallback'; readonly position: Position })
  | (ItemBase & {
      /**
       * A `core.text` object (brief function 45; data model 1.6.0): its text centred on its point, `rotation` degrees clockwise
       * from true north at the point, `size` pixels, in `color` (its `style.strokeColor`) or else the look's text colour.
       * Part of a layer: in its order, picked on its box, selected and dragged as any object.
       */
      readonly kind: 'textobject';
      readonly position: Position;
      readonly text: string;
      readonly size: number;
      readonly rotation: number;
      readonly color?: string;
    })
  | (ItemBase & {
      /** An overlay's label (SDK 1.4.0 part 6): text centred on a position, with a halo. Overlays only; never part of a layer. */
      readonly kind: 'text';
      readonly position: Position;
      readonly text: string;
      readonly style: OverlayLabelStyle | undefined;
    });

/**
 * True if at least one of the item's positions lies in the projection's valid area (its world
 * extent). An item entirely outside is not drawn, and so not pickable, in that projection (owner,
 * 2026-10-12): projected anyway, a polygon around the North Pole becomes a ring around the whole
 * map in EPSG:3031 and its fill covers everything. It stays in the live picture and the selection,
 * and is drawn again in a projection where it lies. An item partly inside is drawn whole.
 */
export function inProjection(item: DrawItem, projection: Projection): boolean {
  switch (item.kind) {
    case 'symbol':
    case 'point':
    case 'fallback':
    case 'text':
    case 'textobject':
      return projection.isValid(item.position);
    case 'graphic':
      return item.points.some((p) => projection.isValid(p));
    case 'line':
      return item.positions.some((p) => projection.isValid(p));
    case 'polygon':
      return item.rings.some((ring) => ring.some((p) => projection.isValid(p)));
  }
}

/** The ids of the data types that declare `sensorReport` (brief function 39). */
export function sensorReportTypesOf(dataTypes: readonly DataType[]): ReadonlySet<string> {
  return new Set(dataTypes.filter((t) => t.sensorReport === true).map((t) => t.id));
}

/** The draw item of an object; null only if its geometry has no position at all. */
export function toDrawItem(object: MapObject, sensorReportTypes?: ReadonlySet<string>): DrawItem | null {
  const base = { id: object.id, layerId: object.layerId };
  const g = object.geometry;
  if (object.type === 'core.symbol' && g.type === 'Point' && object.symbol !== undefined) {
    const symbol = object.symbol;
    const name = object.properties?.name;
    const speed = symbol.modifiers?.speed;
    return {
      ...base, kind: 'symbol', position: g.coordinates, symbol, appearance: appearanceKey(symbol), direction: directionOf(symbol),
      ...(typeof name === 'string' && name.trim() !== '' ? { name } : {}),
      ...(speed !== undefined && Number.isFinite(speed) && speed > 0 ? { speed } : {}),
      ...(sensorReportTypes?.has(object.dataType) === true ? { sensorReport: true as const } : {}),
    };
  }
  if (object.type === 'core.shape') {
    const style = object.style;
    const name = object.properties?.name;
    const shape = { ...base, style, ...(typeof name === 'string' && name.trim() !== '' ? { name } : {}) };
    switch (g.type) {
      case 'Point':
        return { ...base, style, kind: 'point', position: g.coordinates }; // no label: areas and lines only
      case 'LineString':
        if (g.coordinates.length >= 2) return { ...shape, kind: 'line', positions: densifyPath(g.coordinates), vertices: g.coordinates };
        break;
      case 'Polygon':
        if (g.coordinates.length >= 1) return { ...shape, kind: 'polygon', rings: g.coordinates.map((ring) => densifyPath(ring)) };
        break;
      case 'Circle':
        return { ...shape, kind: 'polygon', rings: [circleRing(g.center, g.radius)] };
      case 'Ellipse':
        return { ...shape, kind: 'polygon', rings: [ellipseRing(g.center, g.semiMajorAxis, g.semiMinorAxis, g.rotation)] };
      case 'ArcBand': {
        const rings = arcBandRings(g);
        if (rings !== null) return { ...shape, kind: 'polygon', rings };
        break;
      }
      case 'Corridor': {
        const ring = corridorRing(g);
        if (ring !== null) return { ...shape, kind: 'polygon', rings: [ring] };
        break;
      }
      default:
        break;
    }
  }
  if (object.type === CORE_TEXT && g.type === 'Point' && object.text !== undefined && object.text.value !== '') {
    const { value, rotation, size } = object.text;
    const color = object.style?.strokeColor;
    return {
      ...base, kind: 'textobject', position: g.coordinates, text: value, size: size ?? TEXT_SIZE_DEFAULT, rotation: rotation ?? 0,
      ...(typeof color === 'string' && color !== '' ? { color } : {}),
    };
  }
  if (object.type === 'core.multipoint' && object.symbol !== undefined) {
    const points = controlPoints(g);
    if (points.length > 0) return { ...base, kind: 'graphic', symbol: object.symbol, points, parts: null };
  }
  const position = firstPosition(g);
  return position === null ? null : { ...base, kind: 'fallback', position };
}

/**
 * The control points of a `core.multipoint` (SDK 1.4.0): a `LineString`'s or a `MultiPoint`'s
 * positions, or a `Polygon`'s exterior ring without its closing position. Altitudes are dropped.
 */
export function controlPoints(g: Geometry): Position[] {
  const flat = (positions: readonly Position[]): Position[] => positions.map((p): Position => [p[0], p[1]]);
  switch (g.type) {
    case 'LineString':
    case 'MultiPoint':
      return flat(g.coordinates);
    case 'Polygon': {
      const ring = g.coordinates[0] ?? [];
      const first = ring[0];
      const last = ring[ring.length - 1];
      const closed = first !== undefined && last !== undefined && ring.length > 1 && first[0] === last[0] && first[1] === last[1];
      return flat(closed ? ring.slice(0, -1) : ring);
    }
    default:
      return [];
  }
}

/** The first position of any geometry: the point, the first vertex, or the centre. */
export function firstPosition(g: Geometry): Position | null {
  switch (g.type) {
    case 'Point':
      return g.coordinates;
    case 'MultiPoint':
    case 'LineString':
    case 'Corridor':
      return g.coordinates[0] ?? null;
    case 'Polygon':
      return g.coordinates[0]?.[0] ?? null;
    case 'Circle':
    case 'Ellipse':
    case 'ArcBand':
      return g.center;
  }
}

/**
 * The direction of movement (modifier `direction`), normalized to [0, 360). APP-6 symbols never
 * rotate; only this arrow points somewhere. The map view draws it as its own rotated mark instead
 * of asking the SymbolService for it, so the symbol image does not depend on the heading and one
 * image serves every object with the same appearance (owner, 2026-10-09; spike S2: per-object
 * images do not scale).
 *
 * Known limit: APP-6 starts the arrow at the end of a staff below the frame for land symbols and at
 * the centre for others. That knowledge belongs to the symbology plugin; until the SymbolService
 * tells where the arrow starts (a future SDK addition, not requested yet), the arrow starts at the
 * symbol's anchor.
 */
export function directionOf(symbol: MilSymbol): number | null {
  return symbol.standard === 'vessel' ? null : movementOf(symbol); // a vessel's hull turns in its own image (function 33): the map view adds no arrow
}

/** The direction of movement of any symbol, a vessel included, normalized to [0, 360); the speed vector follows it (function 35). */
export function movementOf(symbol: MilSymbol): number | null {
  const direction = symbol.modifiers?.direction;
  return direction === undefined || !Number.isFinite(direction) ? null : ((direction % 360) + 360) % 360;
}

/** The step of a vessel's hull in degrees (brief function 33, T-200; owner TY B): a hull look has at most 360 / 10 images. */
export const HULL_STEP_DEGREES = 10;

/**
 * The heading of a vessel's hull, in steps of 10°, or null for its mark (brief function 33): `symbology` turns
 * the hull when there is a `direction` and the `speed` is absent or above 0, and draws the mark otherwise.
 * `direction` goes to the nearest step, a half step up: 34 gives 30, 35 and 36 give 40, 356 gives 0.
 */
export function vesselHeading(symbol: MilSymbol): number | null {
  const { direction, speed } = symbol.modifiers ?? {};
  if (direction === undefined || !Number.isFinite(direction) || (speed !== undefined && !(speed > 0))) return null;
  const degrees = ((direction % 360) + 360) % 360;
  return (Math.round(degrees / HULL_STEP_DEGREES) * HULL_STEP_DEGREES) % 360;
}

/**
 * The symbol as its image is drawn: a vessel that turns has its `direction` at its hull's step, so the image, its key
 * and the request to the service agree (T-200). Any other symbol is returned as it is; the object keeps its exact `direction`.
 */
export function steppedSymbol(symbol: MilSymbol): MilSymbol {
  const heading = symbol.standard === 'vessel' ? vesselHeading(symbol) : null;
  if (heading === null || symbol.modifiers?.direction === heading) return symbol;
  return { ...symbol, modifiers: { ...symbol.modifiers, direction: heading } };
}

/**
 * The cache key of a symbol image: standard and canonical SIDC (text and direction are not in the shared
 * image). A vessel's hull is part of its image, so its key has the heading, or the mark (function 33).
 */
export function appearanceKey(symbol: MilSymbol): string {
  const key = `${symbol.standard}|${canonicalSidc(symbol.standard, symbol.sidc)}`;
  if (symbol.standard !== 'vessel') return key;
  const heading = vesselHeading(symbol);
  return heading === null ? `${key}|mark` : `${key}|hull ${String(heading)}`;
}

/**
 * The request to the SymbolService. An APP-6 symbol never goes with `direction` (the map view draws the
 * arrow): with text, the other modifiers, one image per object; without, no modifiers, one image per
 * appearance. A vessel always goes with its `direction` (at its hull's step, T-200) and `speed`, because `symbology`
 * turns the hull by them and draws a mark when it does not move (function 33); with text, with every modifier.
 */
export function symbolRequest(symbol: MilSymbol, size: number, withText: boolean, labels: readonly LabelId[] | null = null) {
  const stepped = steppedSymbol(symbol); // a vessel's hull in steps of 10°, with text too (T-200)
  const modifiers = stepped.standard === 'vessel' ? (withText ? stepped.modifiers : hullModifiers(stepped.modifiers)) : withText ? withoutDirection(stepped.modifiers) : undefined;
  return {
    standard: symbol.standard,
    sidc: symbol.sidc,
    size,
    withText,
    ...(modifiers === undefined ? {} : { modifiers }),
    ...(labels === null ? {} : { labels }),
  };
}

/** The modifiers that decide a vessel's hull: `direction` and `speed`; undefined when it has neither. */
function hullModifiers(modifiers: Modifiers | undefined): Modifiers | undefined {
  if (modifiers === undefined) return undefined;
  const { direction, speed } = modifiers;
  if (direction === undefined && speed === undefined) return undefined;
  return { ...(direction === undefined ? {} : { direction }), ...(speed === undefined ? {} : { speed }) };
}

function withoutDirection(modifiers: Modifiers | undefined): Modifiers | undefined {
  if (modifiers === undefined) return undefined;
  const rest = Object.fromEntries(Object.entries(modifiers).filter(([name]) => name !== 'direction')) as Modifiers;
  return Object.keys(rest).length === 0 ? undefined : rest;
}

/**
 * Brief function 6: texts are drawn up to the threshold of visible items that can have one:
 * symbols, and from M2 shapes with a name (brief function 18; owner, 2026-10-16: one count for
 * both). Above it, no texts at all.
 */
export function drawWithText(visibleItems: number, threshold: number): boolean {
  return visibleItems <= threshold;
}
