/**
 * A drawn tactical graphic as OpenLayers features (brief functions 29 to 32): the lines, fills and
 * labels the symbology service answered with, projected from longitude, latitude. The WebGL layer
 * gets one feature per line and per fill (`graphicFeatures`, with the colours, widths and dashes as
 * the service gives them, in every look); previews and overlays are drawn on the Canvas
 * (`graphicCanvasFeatures`), the labels by `graphicLabelFeatures`. In EPSG:3857 a line that jumps
 * across the antimeridian (+176° to −176°) is unwrapped, as shapes are; the polar projections draw
 * it as it is.
 */
import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import Point from 'ol/geom/Point.js';
import Polygon from 'ol/geom/Polygon.js';
import Fill from 'ol/style/Fill.js';
import Icon from 'ol/style/Icon.js';
import Stroke from 'ol/style/Stroke.js';
import Style from 'ol/style/Style.js';
import Text from 'ol/style/Text.js';
import { cssColor, faded, rgba, type Rgba } from '../core/appearance.ts';
import { itemOpacity as opacityOfItem } from '../core/expiry.ts';
import { unwrapLongitude } from '../core/geodesic.ts';
import { normalizeLongitude } from '../core/projections.ts';
import type { DrawItem } from '../core/drawData.ts';
import type { Projection } from '../core/projections.ts';
import type { GraphicImageCache } from './graphicImages.ts';
import { hatchPattern, HIGHLIGHT, KIND, P } from './styles.ts';

type Graphic = Extract<DrawItem, { readonly kind: 'graphic' }>;

/** The id of the n-th feature of a graphic: the object's id with `#g` and the number. */
export const graphicFeatureId = (id: string, n: number): string => `${id}#g${String(n)}`;

/** The object id of a graphic's feature id, or null for any other id. */
export function graphicOwner(featureId: string): string | null {
  const at = featureId.indexOf('#g');
  return at < 0 ? null : featureId.slice(0, at);
}

/** Flat longitude, latitude pairs as projected points; points the projection cannot show are left out. */
export function projectFlat(flat: Float64Array, projection: Projection): number[][] {
  const result: number[][] = [];
  const [minX, , maxX] = projection.def.extent;
  let previous: number | null = null;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    let lon = flat[i] as number;
    const lat = flat[i + 1] as number;
    if (projection.wrapsX && previous !== null) lon = unwrapLongitude(lon, previous);
    previous = lon;
    // The projection takes a longitude beyond ±180° back into the world; where the world repeats, the
    // unwrapped line goes on into the next copy, as one line.
    const base = projection.wrapsX ? normalizeLongitude(lon) : lon;
    const xy = projection.forward([base, lat]);
    if (xy !== null) result.push([xy[0] + (projection.wrapsX ? Math.round((lon - base) / 360) * (maxX - minX) : 0), xy[1]]);
  }
  return result;
}

/** The most numbers of a dash pattern kept. */
const MAX_DASH_NUMBERS = 16;

/**
 * A dash pattern as the style takes it: the whole pattern as the service gives it (a dash, a gap, a dot, a
 * gap and so on). An odd count is repeated once, as the Canvas does, so that dashes and gaps alternate; a
 * pattern with no length at all is a solid line (empty).
 */
export function dashPattern(dash: readonly number[] | undefined): number[] {
  const numbers = (dash ?? []).filter((n) => Number.isFinite(n) && n >= 0);
  if (numbers.length === 0 || numbers.every((n) => n === 0)) return [];
  const even = numbers.length % 2 === 0 ? numbers : [...numbers, ...numbers];
  return even.slice(0, MAX_DASH_NUMBERS);
}

/** The most different dash patterns the style has a rule for; a line with another is drawn solid. */
export const MAX_DASH_PATTERNS = 24;

/**
 * The dash patterns the graphics have used, numbered from 1 in the order they came: the style has a rule
 * for each (`layerStyle`'s `dashes`). `version` changes with each new pattern, so that the style is made again.
 */
export class DashPatterns {
  private readonly numbers = new Map<string, number>();
  private readonly list: number[][] = [];

  /** The patterns, the number of the first being 1. */
  get patterns(): readonly (readonly number[])[] {
    return this.list;
  }

  get version(): number {
    return this.list.length;
  }

  /** The number of a pattern: 0 for a solid line; the number is new for a pattern not seen before. */
  idOf(pattern: readonly number[]): number {
    if (pattern.length === 0) return 0;
    const key = pattern.join(',');
    const known = this.numbers.get(key);
    if (known !== undefined) return known;
    if (this.list.length >= MAX_DASH_PATTERNS) return 0;
    this.list.push([...pattern]);
    this.numbers.set(key, this.list.length);
    return this.list.length;
  }
}

/** The colour of a part, `#RRGGBB` with an opacity, faded like the rest of the object. */
function colourOf(color: string, opacity: number | undefined, itemOpacity: number): Rgba {
  return faded(rgba(color, opacity ?? 1), itemOpacity);
}

/** The projected lines and fills of a graphic, with what each is drawn as. */
export function graphicShapes(item: Graphic, projection: Projection) {
  const itemOpacity = opacityOfItem(item);
  const parts = item.parts;
  const lines = (parts?.lines ?? []).flatMap((line) => {
    const points = projectFlat(line.coordinates, projection);
    if (points.length < 2) return [];
    return [{ points, colour: colourOf(line.color, line.opacity, itemOpacity), width: line.width, dash: line.dash, pattern: dashPattern(line.dash) }];
  });
  const fills = (parts?.fills ?? []).flatMap((fill) => {
    const rings = fill.rings.map((ring) => projectFlat(ring, projection)).filter((ring) => ring.length >= 3);
    if (rings.length === 0) return [];
    return [{ rings, colour: colourOf(fill.color, fill.opacity, itemOpacity), hatch: fill.pattern === 'hatch' }];
  });
  return { lines, fills };
}

/**
 * The features of the WebGL layer: fills, then lines (the style draws fills under lines). None while
 * the graphic has no drawing: the item is the fallback marker then.
 */
export function graphicFeatures(item: Graphic, projection: Projection, nextSeq: () => number, dashes: DashPatterns): Feature[] {
  const { lines, fills } = graphicShapes(item, projection);
  const seq = nextSeq();
  const features: Feature[] = [];
  let n = 0;
  for (const fill of fills) {
    const feature = new Feature(new Polygon(fill.rings.map((ring) => [...ring, ring[0] as number[]])));
    feature.setId(graphicFeatureId(item.id, n++));
    feature.setProperties({ [P.kind]: KIND.gfill, [P.fill]: [...fill.colour], [P.fillOn]: fill.colour[3] > 0 ? 1 : 0, [P.hatch]: fill.hatch ? 1 : 0, [P.opacity]: 1, [P.seq]: seq }, true);
    features.push(feature);
  }
  for (const line of lines) {
    const feature = new Feature(new LineString(line.points));
    feature.setId(graphicFeatureId(item.id, n++));
    feature.setProperties({ [P.kind]: KIND.gline, [P.stroke]: [...line.colour], [P.strokeWidth]: line.width, [P.dash]: dashes.idOf(line.pattern), [P.opacity]: 1, [P.seq]: seq }, true);
    features.push(feature);
  }
  return features;
}

/** How many features `graphicFeatures` made for an item: so they can be removed again. */
export function graphicFeatureCount(item: Graphic, projection: Projection): number {
  const { lines, fills } = graphicShapes(item, projection);
  return lines.length + fills.length;
}

/** The graphic as Canvas features (a drag preview, a drawing's preview, an overlay): fills, lines, images, then labels. */
export function graphicCanvasFeatures(item: Graphic, projection: Projection, zIndex: number, images?: GraphicImageCache): Feature[] {
  const { lines, fills } = graphicShapes(item, projection);
  const features: Feature[] = [];
  for (const fill of fills) {
    const colour = cssColor(fill.colour);
    const feature = new Feature(new Polygon(fill.rings.map((ring) => [...ring, ring[0] as number[]])));
    feature.setStyle(new Style({ zIndex, fill: new Fill({ color: fill.hatch ? (hatchPattern(colour) ?? colour) : colour }) }));
    features.push(feature);
  }
  for (const line of lines) {
    const feature = new Feature(new LineString(line.points));
    feature.setStyle(new Style({ zIndex, stroke: new Stroke({ color: cssColor(line.colour), width: line.width, ...(line.dash === undefined || line.dash.length === 0 ? {} : { lineDash: [...line.dash] }) }) }));
    features.push(feature);
  }
  return [...features, ...(images === undefined ? [] : graphicImageFeatures(item, projection, zIndex, images)), ...graphicLabelFeatures(item, projection, zIndex)];
}

/**
 * A graphic's images as Canvas features (brief function 37): each decoded image centred on its position, `width` by
 * `height` screen pixels, turned `angle` degrees clockwise on the screen (not with the view), at the graphic's
 * opacity. An image still decoding is left out; the cache asks for a redraw when it is ready. Never picked.
 */
export function graphicImageFeatures(item: Graphic, projection: Projection, zIndex: number, cache: GraphicImageCache): Feature[] {
  const itemOpacity = opacityOfItem(item);
  return (item.parts?.images ?? []).flatMap((image) => {
    const decoded = cache.get(image.svg);
    const xy = decoded === null ? null : projection.forward(image.position);
    if (decoded === null || xy === null) return [];
    const feature = new Feature(new Point([xy[0], xy[1]]));
    feature.setStyle(new Style({
      zIndex,
      image: new Icon({
        img: decoded,
        // The scale from the image's own size to the size wanted on the screen; an SVG with no size of its own reports 0, and is then taken as it is.
        scale: [image.width / (decoded.naturalWidth > 0 ? decoded.naturalWidth : image.width), image.height / (decoded.naturalHeight > 0 ? decoded.naturalHeight : image.height)],
        rotation: (image.angle * Math.PI) / 180,
        rotateWithView: false,
        opacity: itemOpacity,
      }),
    }));
    return [feature];
  });
}

/** A graphic's labels as Canvas features: the font, colour, angle and alignment the service gives, no halo (owner, 2026-11-06). */
export function graphicLabelFeatures(item: Graphic, projection: Projection, zIndex: number): Feature[] {
  const itemOpacity = opacityOfItem(item);
  return (item.parts?.labels ?? []).flatMap((label) => {
    const xy = projection.forward(label.position);
    if (xy === null) return [];
    const feature = new Feature(new Point([xy[0], xy[1]]));
    feature.setStyle(new Style({
      zIndex,
      text: new Text({
        text: label.text,
        font: label.font,
        fill: new Fill({ color: cssColor(colourOf(label.color, 1, itemOpacity)) }),
        rotation: (label.angle * Math.PI) / 180,
        textAlign: label.align,
        rotateWithView: false,
        overflow: true,
      }),
    }));
    return [feature];
  });
}

/**
 * The highlight of a selected graphic (brief function 30): its lines drawn again with the selection's
 * wider stroke on a dark casing, as for a shape; a fill's outline too. Never a fill.
 */
export function graphicHighlightFeatures(item: Graphic, projection: Projection): Feature[] {
  const { lines, fills } = graphicShapes(item, projection);
  const opacity = opacityOfItem(item);
  const colour = cssColor(faded([255, 212, 0, 1], opacity));
  const casing = cssColor(faded([0, 0, 0, 0.85], opacity));
  const paths = [...lines.map((l) => ({ points: l.points, width: l.width })), ...fills.flatMap((f) => f.rings.map((ring) => ({ points: [...ring, ring[0] as number[]], width: 1 })))];
  return paths.map(({ points, width }) => {
    const feature = new Feature(new LineString(points));
    const wide = width + 2 * HIGHLIGHT.gap;
    feature.setStyle([
      new Style({ stroke: new Stroke({ color: casing, width: wide + 2 }) }),
      new Style({ stroke: new Stroke({ color: colour, width: wide }) }),
    ]);
    return feature;
  });
}
