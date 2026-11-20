/**
 * Draw items (lon/lat) as OpenLayers features in the map projection, with the properties the
 * WebGL style reads (`styles.ts`). Only what drawing needs is stored (spike S2: about 2 KB per
 * feature).
 */
import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import MultiPoint from 'ol/geom/MultiPoint.js';
import MultiPolygon from 'ol/geom/MultiPolygon.js';
import Point from 'ol/geom/Point.js';
import Polygon from 'ol/geom/Polygon.js';
import type { MilSymbol, Position } from '@emc2/plugin-sdk';
import { arrowheadAt, arrowRotation, faded, markerPoints, northOnScreen, shapeLook } from '../core/appearance.ts';
import { fillFacesWithHoles, type XY } from '../core/crossing.ts';
import { inProjection, type DrawItem } from '../core/drawData.ts';
import { itemOpacity } from '../core/expiry.ts';
import { normalizeLongitude, type Projection } from '../core/projections.ts';
import type { AtlasEntry } from './atlas.ts';
import { arrowheadLength, KIND, markerRadius, P, TEXT_ITEM } from './styles.ts';
import { ARROWHEAD } from './atlas.ts';

/**
 * The answer for an image that is in the atlas being built but not in the atlas image the style shows yet (T-200): the entry, whose
 * size is known (the symbol is picked and labelled by it), but not yet where the style finds it.
 */
export interface PendingImage {
  readonly pending: AtlasEntry;
}

/** The value of `P.inAtlas`: no image (a marker is drawn), in the shown atlas, or not in it yet (the WebGL layer draws nothing of it: the engine draws it from its own image on a Canvas layer until the style is swapped). */
export const IN_ATLAS = { no: 0, yes: 1, pending: 2 } as const;

export interface FeatureContext {
  readonly projection: Projection;
  /** The atlas entry of a symbol's appearance, adding it if needed; null if it has no image, a {@link PendingImage} if the shown atlas does not hold it yet. */
  atlasEntry(symbol: MilSymbol): AtlasEntry | null | PendingImage;
  /** The atlas entry of the sensor report symbol (brief function 39); null when the symbol service has none: the APP-6 symbol is drawn then. */
  sensorReportEntry(): AtlasEntry | null | PendingImage;
  /** Whether a symbol with a direction gets the direction arrow (the "Direction arrow" switch, SDK 1.8.0). */
  readonly directionArrow: boolean;
  /** The next drawing order number. */
  nextSeq(): number;
}

/** The feature of a draw item; null if none of its positions can be projected. */
export function toFeature(item: DrawItem, ctx: FeatureContext): Feature | null {
  if ((item.kind === 'graphic' && item.parts !== null) || item.kind === 'text') return null; // a graphic: features of its own (`graphicFeatures`); a text: overlays only
  const geometry = geometryOf(item, ctx.projection);
  if (geometry === null) return null;
  const feature = new Feature(geometry);
  feature.setId(item.id);
  const opacity = itemOpacity(item);
  const props: Record<string, unknown> = { [P.seq]: ctx.nextSeq(), [P.opacity]: opacity };
  switch (item.kind) {
    case 'symbol': {
      const report = item.sensorReport === true ? ctx.sensorReportEntry() : null;
      const entry = report ?? ctx.atlasEntry(item.symbol);
      props[P.kind] = KIND.symbol;
      const waiting = entry !== null && 'pending' in entry;
      const sized = entry === null ? null : 'pending' in entry ? entry.pending : entry;
      props[P.inAtlas] = entry === null ? IN_ATLAS.no : waiting ? IN_ATLAS.pending : IN_ATLAS.yes;
      if (sized !== null && waiting) Object.assign(props, { [P.w]: sized.w, [P.h]: sized.h, [P.ax]: sized.ax, [P.ay]: sized.ay });
      if (sized !== null && !waiting) Object.assign(props, { [P.ox]: sized.x, [P.oy]: sized.y, [P.w]: sized.w, [P.h]: sized.h, [P.ax]: sized.ax, [P.ay]: sized.ay });
      const heading = report === null && ctx.directionArrow ? item.direction : null; // a sensor report has no direction arrow (function 39); nor has a symbol when the switch is off
      props[P.hasArrow] = heading === null ? 0 : 1;
      props[P.rotation] = heading === null ? 0 : arrowRotation(ctx.projection, item.position, heading);
      break;
    }
    case 'fallback':
    case 'graphic': // a graphic with no drawing yet, or refused: the marker at its first point
      props[P.kind] = KIND.fallback;
      break;
    case 'textobject':
      // The WebGL layer draws nothing of it; the layer's canvas text layer draws the text, turned from true north (brief function 45).
      props[P.kind] = KIND.text;
      props[P.rotation] = northOnScreen(ctx.projection, item.position) + (item.rotation * Math.PI) / 180;
      props[TEXT_ITEM] = item;
      break;
    case 'point':
    case 'line':
    case 'polygon': {
      const look = shapeLook(item.style, item.kind);
      props[P.kind] = item.kind === 'line' && item.aux === true ? KIND.aux : KIND[item.kind];
      props[P.stroke] = [...faded(look.stroke, opacity)];
      props[P.strokeWidth] = look.strokeWidth;
      props[P.dash] = look.dash;
      // The fill of a ring that crosses itself is a feature of its own (`fillFeatures`): the WebGL fill is wrong for it.
      const [r, g, b] = look.fill;
      const fill = item.kind === 'polygon' && crossingFaces(item, ctx.projection) !== null ? [r, g, b, 0] : [...faded(look.fill, opacity)];
      props[P.fill] = fill;
      props[P.fillOn] = (fill[3] ?? 0) > 0 ? 1 : 0; // a fill nobody can see is not drawn: filling a big area costs a lot, most of all without a GPU (T-195)
      props[P.hatch] = look.hatch ? 1 : 0;
      break;
    }
  }
  feature.setProperties(props, true);
  return feature;
}

/** The id suffixes of a line's extra features: they go and come with the line's own feature. */
export const EXTRA_IDS = ['#arrow', '#markers', '#fill', '#vector'] as const;

/**
 * The faces a polygon's outer ring encloses when its outline crosses itself (T-111; with its holes, M8), each as a
 * polygon (the face, then the holes inside it), in the projection's coordinates; null for every other polygon.
 */
function crossingFaces(item: Extract<DrawItem, { kind: 'polygon' }>, projection: Projection): XY[][][] | null {
  const [ring, ...holes] = item.rings;
  if (ring === undefined || !inProjection(item, projection)) return null;
  const xy = (r: readonly Position[]) => projected(r, projection).map((c): XY => [c[0] ?? 0, c[1] ?? 0]);
  const outer = xy(ring);
  return outer.length < 3 ? null : fillFacesWithHoles(outer, holes.map(xy));
}

/**
 * The fill of a polygon whose outline crosses itself, as a feature of its own with id `<id>#fill`,
 * drawn under the polygon's own (T-111; owner, 2026-10-31: every area the outline encloses is
 * filled): the faces the outline encloses, with no outline of their own. The polygon's own
 * feature keeps the outline, the picking and the label, and has no fill. Not picked.
 */
export function fillFeatures(item: DrawItem, ctx: FeatureContext): Feature[] {
  if (item.kind !== 'polygon') return [];
  const faces = crossingFaces(item, ctx.projection);
  if (faces === null || faces.length === 0) return [];
  const look = shapeLook(item.style, 'polygon');
  const opacity = itemOpacity(item);
  const feature = new Feature(new MultiPolygon(faces.map((polygon) => polygon.map((ring) => [...ring, ring[0] as XY].map((c) => [...c])))));
  feature.setId(`${item.id}${EXTRA_IDS[2]}`);
  feature.setProperties({
    [P.kind]: KIND.polygon,
    [P.stroke]: [0, 0, 0, 0],
    [P.strokeWidth]: 0,
    [P.dash]: 0,
    [P.fill]: [...faded(look.fill, opacity)],
    [P.fillOn]: faded(look.fill, opacity)[3] > 0 ? 1 : 0,
    [P.hatch]: look.hatch ? 1 : 0,
    [P.opacity]: opacity,
    [P.seq]: ctx.nextSeq(),
  }, true);
  return [feature];
}

/**
 * A line's arrowhead and route markers (data model 1.1.0 `arrowhead`, `pointMarkers`; brief
 * function 18) as features of their own beside the line's, with ids `<id>#arrow` and
 * `<id>#markers`. They are not picked: the line under them is.
 */
export function extraFeatures(item: DrawItem, ctx: FeatureContext): Feature[] {
  if (item.kind !== 'line' || !inProjection(item, ctx.projection)) return [];
  const style = item.style;
  if (style?.arrowhead !== 'end' && style?.pointMarkers !== 'circle') return [];
  const look = shapeLook(style, 'line');
  const opacity = itemOpacity(item);
  const stroke = [...faded(look.stroke, opacity)];
  const extras: Feature[] = [];
  const head = style.arrowhead === 'end' ? arrowheadAt(item, ctx.projection) : null;
  if (head !== null) {
    const feature = new Feature(new Point([...head.tip]));
    feature.setId(`${item.id}${EXTRA_IDS[0]}`);
    feature.setProperties({
      [P.kind]: KIND.arrowhead,
      [P.stroke]: stroke,
      [P.rotation]: head.rotation,
      [P.scale]: arrowheadLength(look.strokeWidth) / ARROWHEAD.length,
      [P.opacity]: opacity,
      [P.seq]: ctx.nextSeq(),
    }, true);
    extras.push(feature);
  }
  if (style.pointMarkers === 'circle') {
    const points = markerPoints(item, ctx.projection);
    if (points.length > 0) {
      const feature = new Feature(new MultiPoint(points));
      feature.setId(`${item.id}${EXTRA_IDS[1]}`);
      feature.setProperties({
        // Data model 1.1.0: a small filled circle in strokeColor (owner, 2026-10-16: as the model says).
        [P.kind]: KIND.markers,
        [P.stroke]: stroke,
        [P.fill]: stroke,
        [P.strokeWidth]: 0,
        [P.radius]: markerRadius(look.strokeWidth),
        [P.opacity]: opacity,
        [P.seq]: ctx.nextSeq(),
      }, true);
      extras.push(feature);
    }
  }
  return extras;
}

export function geometryOf(item: DrawItem, projection: Projection): Point | LineString | Polygon | null {
  if (!inProjection(item, projection)) return null; // not on this map (owner, 2026-10-12)
  const project = (p: Position) => projection.forward(p);
  switch (item.kind) {
    case 'symbol':
    case 'point':
    case 'fallback':
    case 'textobject':
    case 'text': {
      const xy = project(item.position);
      return xy === null ? null : new Point([...xy]);
    }
    case 'graphic': {
      const first = item.points[0];
      const xy = first === undefined ? null : project(first);
      return xy === null ? null : new Point([...xy]); // the fallback marker
    }
    case 'line': {
      const coordinates = projected(item.positions, projection);
      return coordinates.length >= 2 ? new LineString(coordinates) : null;
    }
    case 'polygon': {
      const rings = item.rings.map((ring) => projected(ring, projection)).filter((ring) => ring.length >= 3);
      return rings.length === 0 ? null : new Polygon(rings);
    }
  }
}

/**
 * Positions as points of the map. The longitudes of a draw item's positions are continuous (they may
 * leave -180 to 180: `geodesic.ts`), but the projection takes each back into the world. Where the world
 * repeats (EPSG:3857) a path that crosses the antimeridian therefore goes on into the next copy of the
 * world as one path: the points after the first keep the world copy they are in relative to it (brief
 * functions 18 and 36: an area across 180° is short, never a stripe round the world). The first point
 * stays where the projection puts it. The polar projections draw the path as it is.
 */
function projected(positions: readonly Position[], projection: Projection): number[][] {
  const result: number[][] = [];
  const [minX, , maxX] = projection.def.extent;
  const worldWidth = maxX - minX;
  let anchor: number | null = null;
  for (const p of positions) {
    const lon = p[0];
    const base = projection.wrapsX ? normalizeLongitude(lon) : lon;
    const xy = projection.forward([base, p[1]]);
    if (xy === null) continue;
    const copy = projection.wrapsX ? Math.round((lon - base) / 360) : 0;
    anchor ??= copy;
    result.push([xy[0] + (copy - anchor) * worldWidth, xy[1]]);
  }
  return result;
}
