/**
 * Styles. The emc2 layers are WebGL layers with one flat style whose values come from feature
 * properties (spike S2: one draw call per layer); the few Canvas layers on top (labels, overlays,
 * drag preview) use ordinary OpenLayers styles.
 */
import CircleStyle from 'ol/style/Circle.js';
import Fill from 'ol/style/Fill.js';
import Icon from 'ol/style/Icon.js';
import Stroke from 'ol/style/Stroke.js';
import Style from 'ol/style/Style.js';
import Text from 'ol/style/Text.js';
import type { Rule } from 'ol/style/flat.js';
import type { OverlayLabelStyle, Style as ShapeStyle, SymbolImage } from '@emc2/plugin-sdk';
import type { FeatureLike } from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import { arrowheadAt, arrowheadOnPath, cssColor, dashPattern, faded, markerPoints, shapeLook, type Rgba } from '../core/appearance.ts';
import type { DrawItem } from '../core/drawData.ts';
import type { LabelPlace } from '@emc2/plugin-sdk';
import type { TextLook } from '../core/look.ts';
import type { TextMeter } from './textMeter.ts';
import { itemOpacity } from '../core/expiry.ts';
import { ARROWHEAD, createCanvas, hatchImage } from './atlas.ts';
import type { Projection } from '../core/projections.ts';
import MultiPoint from 'ol/geom/MultiPoint.js';
import Point from 'ol/geom/Point.js';

/** Feature property names (short: they are stored for every object). */
export const P = {
  kind: 'k',
  /** 1 if the symbol is in the atlas. */
  inAtlas: 'atl',
  ox: 'ox',
  oy: 'oy',
  w: 'w',
  h: 'h',
  ax: 'ax',
  ay: 'ay',
  /** 1 if the symbol has a direction arrow. */
  hasArrow: 'dir',
  /** The arrow's rotation on screen, radians clockwise. */
  rotation: 'rot',
  stroke: 'st',
  strokeWidth: 'sw',
  dash: 'da',
  fill: 'fi',
  /** 1 if the fill of a polygon (or a graphic's fill) can be seen: its colour is not wholly transparent. A fill that cannot is not drawn at all (T-195). */
  fillOn: 'fon',
  /** 1 for a hatched fill (data model 1.1.0 `fillPattern: 'hatch'`). */
  hatch: 'ha',
  /** An arrowhead's scale of the arrowhead image, from the line width. */
  scale: 'sc',
  /** A route marker's radius in pixels, from the line width. */
  radius: 'ra',
  /** Drawing order within the layer, for pick. */
  seq: 'seq',
  /** 1, or FADED_OPACITY for an expired object of a fading data type (brief function 13). Shape colours carry it already. */
  opacity: 'op',
} as const;

/**
 * The dash patterns of the tactical graphics' lines the style has a rule for, in the order they came
 * (rule `n` draws the lines whose `P.dash` is `n + 1`; 0 is a solid line). A WebGL line program has few
 * attributes to spare (about seven for what the style reads; one for each number of a pattern was far too
 * many: "GL program linking failed: Too many attributes"), so a pattern is a constant of its rule and the
 * feature carries only its number. The patterns are few; the style is made again when a new one comes.
 */
export type DashRules = readonly (readonly number[])[];

/** Kind codes (numbers: WebGL filters compare numbers). */
export const KIND = { symbol: 0, point: 1, line: 2, polygon: 3, fallback: 4, arrowhead: 5, markers: 6, gline: 7, gfill: 8, aux: 9, text: 10 } as const;

/** The feature property that holds a text object's draw item: the canvas layer that draws its text and the pick read it (brief function 45). */
export const TEXT_ITEM = 'textitem';

export const POINT_RADIUS = 6;
/** The length of a solid line's one dash, in pixels: longer than any line on a screen. */
const SOLID_DASH_PX = 100_000;
export const FALLBACK_RADIUS = 6;
const FALLBACK_FILL: Rgba = [158, 158, 158, 0.9];
const FALLBACK_STROKE: Rgba = [33, 33, 33, 1];

const isKind = (kind: number) => ['==', ['get', P.kind], kind];

/** A fixed colour at the feature's opacity, as a WebGL expression. */
const fadedColor = ([r, g, b, a]: Rgba) => ['color', r, g, b, ['*', a, ['get', P.opacity]]];

/** The images a layer's WebGL style uses, as URLs. */
export interface LayerImages {
  /** The symbol atlas; null before there is one. */
  readonly atlas: string | null;
  readonly arrow: string;
  readonly arrowAnchor: readonly [number, number];
  readonly hatch: string;
  readonly arrowhead: string;
}

/**
 * The flat style of an emc2 layer: shapes, points, direction arrows, fallback markers, symbols from
 * the atlas (a rule later in the list is drawn over an earlier one, so the arrow lies under the
 * symbol), then a line's arrowhead and route markers (data model 1.1.0).
 */
export function layerStyle(images: LayerImages, dashes: DashRules = []): Rule[] {
  const { atlas: atlasUrl, arrow: arrowUrl, arrowAnchor, hatch: hatchUrl } = images;
  // Dash patterns scale with the line width, as dashPattern does for Canvas. WebGL takes a list of
  // number expressions here (not an ['array', …] expression) and has no 'max', so 'clamp'.
  const width = ['clamp', ['get', P.strokeWidth], 1, 50];
  // One stroke rule for a kind of feature, its dash (solid, dashed, dotted) an expression of the feature's own number: every rule
  // is a pass over all the layer's vertices, which costs about 50 ms a frame without a GPU however few lines there are, so the
  // three rules a kind had cost three times that (T-195; the ITA's slow map with an area per dwell). A solid line has a dash
  // too long to end and no gap.
  const dashNumber = ['get', P.dash];
  const strokeOf = (filter: unknown[]) => ({
    filter,
    style: {
      'stroke-color': ['get', P.stroke],
      'stroke-width': ['get', P.strokeWidth],
      'stroke-line-dash': [
        ['case', ['==', dashNumber, 0], SOLID_DASH_PX, ['==', dashNumber, 1], ['*', width, 4], width],
        ['case', ['==', dashNumber, 0], 0, ['==', dashNumber, 1], ['*', width, 3], ['*', width, 2]],
      ],
    },
  });
  const rules: Rule[] = [
    { filter: ['all', isKind(KIND.polygon), ['==', ['get', P.fillOn], 1], ['==', ['get', P.hatch], 0]], style: { 'fill-color': ['get', P.fill] } },
    // A hatched fill: the white hatch tile tinted with the fill colour and its opacity, in screen pixels.
    { filter: ['all', isKind(KIND.polygon), ['==', ['get', P.fillOn], 1], ['==', ['get', P.hatch], 1]], style: { 'fill-color': ['get', P.fill], 'fill-pattern-src': hatchUrl } },
    strokeOf(['any', isKind(KIND.line), isKind(KIND.polygon)]),
    {
      filter: isKind(KIND.point),
      style: {
        'circle-radius': POINT_RADIUS,
        'circle-fill-color': ['get', P.fill],
        'circle-stroke-color': ['get', P.stroke],
        'circle-stroke-width': ['get', P.strokeWidth],
      },
    },
    // Speed vectors and relation lines (brief functions 34 and 35): under the graphics and the symbols of their layer, never picked.
    strokeOf(isKind(KIND.aux)),
    // Tactical graphics (brief function 29) lie over the shapes and under the symbols: fills, then lines, in the colours,
    // widths and dashes the symbology service gives, in every look.
    { filter: ['all', isKind(KIND.gfill), ['==', ['get', P.fillOn], 1], ['==', ['get', P.hatch], 0]], style: { 'fill-color': ['get', P.fill] } },
    { filter: ['all', isKind(KIND.gfill), ['==', ['get', P.fillOn], 1], ['==', ['get', P.hatch], 1]], style: { 'fill-color': ['get', P.fill], 'fill-pattern-src': hatchUrl } },
    { filter: ['all', isKind(KIND.gline), ['==', ['get', P.dash], 0]], style: { 'stroke-color': ['get', P.stroke], 'stroke-width': ['get', P.strokeWidth] } },
    // A dash pattern, the whole of it as the service gives it (owner, 2026-11-06: the weather graphics have dash, gap, dot and gap).
    ...dashes.map((pattern, n) => ({
      filter: ['all', isKind(KIND.gline), ['==', ['get', P.dash], n + 1]],
      style: { 'stroke-color': ['get', P.stroke], 'stroke-width': ['get', P.strokeWidth], 'stroke-line-dash': [...pattern] },
    })),
    {
      // The direction arrow (the speed vector) goes under the symbol, whether the symbol has an image or is a fallback
      // marker: a rule drawn later is drawn over an earlier one (T-138, owner, 2026-11-05).
      filter: ['all', isKind(KIND.symbol), ['==', ['get', P.hasArrow], 1]],
      style: {
        'icon-src': arrowUrl,
        'icon-anchor': [...arrowAnchor],
        'icon-anchor-x-units': 'pixels',
        'icon-anchor-y-units': 'pixels',
        'icon-rotation': ['get', P.rotation],
        'icon-rotate-with-view': false,
        'icon-opacity': ['get', P.opacity],
      },
    },
    {
      // Fallback markers, and symbols that have no image (no symbology plugin, or a refused SIDC).
      filter: ['any', isKind(KIND.fallback), ['all', isKind(KIND.symbol), ['==', ['get', P.inAtlas], 0]]],
      style: {
        'circle-radius': FALLBACK_RADIUS,
        'circle-fill-color': fadedColor(FALLBACK_FILL),
        'circle-stroke-color': fadedColor(FALLBACK_STROKE),
        'circle-stroke-width': 1.5,
      },
    },
  ];
  if (atlasUrl !== null) {
    rules.push({
      filter: ['all', isKind(KIND.symbol), ['==', ['get', P.inAtlas], 1]],
      style: {
        'icon-src': atlasUrl,
        'icon-offset': ['array', ['get', P.ox], ['get', P.oy]],
        'icon-size': ['array', ['get', P.w], ['get', P.h]],
        'icon-anchor': ['array', ['get', P.ax], ['get', P.ay]],
        'icon-anchor-x-units': 'pixels',
        'icon-anchor-y-units': 'pixels',
        'icon-rotate-with-view': false,
        'icon-opacity': ['get', P.opacity],
      },
    });
  }
  rules.push(
    {
      // The white arrowhead tinted with the line's colour (its opacity included), tip on the last point.
      filter: isKind(KIND.arrowhead),
      style: {
        'icon-src': images.arrowhead,
        'icon-color': ['get', P.stroke],
        'icon-anchor': [ARROWHEAD.width / 2, 0],
        'icon-anchor-x-units': 'pixels',
        'icon-anchor-y-units': 'pixels',
        'icon-rotation': ['get', P.rotation],
        'icon-rotate-with-view': false,
        // Both axes spelled out: OpenLayers 10.10 reads a bare ['get', …] here as an x/y pair and draws
        // a stretched image, or nothing (seen in the browser, T-054 part B).
        'icon-scale': ['array', ['get', P.scale], ['get', P.scale]],
      },
    },
    {
      filter: isKind(KIND.markers),
      style: {
        'circle-radius': ['get', P.radius],
        'circle-fill-color': ['get', P.fill],
        'circle-stroke-color': ['get', P.stroke],
        'circle-stroke-width': ['get', P.strokeWidth],
      },
    },
  );
  return rules;
}

/** An arrowhead's length on screen: four times the line width, at least 12 px (owner, 2026-10-16). */
export function arrowheadLength(strokeWidth: number): number {
  return Math.max(12, 4 * strokeWidth);
}

/** A route marker's radius on screen: the line width plus 2 px, at least 4 px (owner, 2026-10-16). */
export function markerRadius(strokeWidth: number): number {
  return Math.max(4, strokeWidth + 2);
}

/** Canvas styles of a draw item (labels, overlays, drag preview). `image`: the symbol's image, if any. */
export function canvasStyles(
  item: DrawItem,
  image: SymbolImage | null,
  arrow: { readonly canvas: HTMLCanvasElement; readonly anchor: readonly [number, number] } | null,
  arrowRotation: number,
  zIndex = 0,
): Style[] {
  const opacity = opacityOf(item);
  switch (item.kind) {
    case 'symbol': {
      const styles = image === null ? [fallbackStyle(zIndex, opacity)] : [new Style({ zIndex, image: iconOf(image, opacity) })];
      if (item.direction !== null && arrow !== null) {
        styles.unshift(new Style({
          zIndex,
          image: new Icon({ img: arrow.canvas, anchor: [...arrow.anchor], anchorXUnits: 'pixels', anchorYUnits: 'pixels', rotation: arrowRotation, opacity }),
        }));
      }
      return styles;
    }
    case 'fallback':
    case 'graphic': // a graphic is drawn as features of its own (`graphicCanvasFeatures`); this is its marker
      return [fallbackStyle(zIndex, opacity)];
    case 'text': // drawn by `overlayLabelStyle`, which needs the text look
    case 'textobject': // drawn by `textObjectStyle`, which needs the text look
      return [];
    case 'point': {
      const look = shapeLook(item.style, 'point');
      return [new Style({
        zIndex,
        image: new CircleStyle({
          radius: POINT_RADIUS,
          fill: new Fill({ color: cssColor(faded(look.fill, opacity)) }),
          stroke: new Stroke({ color: cssColor(faded(look.stroke, opacity)), width: look.strokeWidth }),
        }),
      })];
    }
    case 'line':
    case 'polygon': {
      const look = shapeLook(item.style, item.kind);
      const fill = cssColor(faded(look.fill, opacity));
      return [new Style({
        zIndex,
        stroke: new Stroke({ color: cssColor(faded(look.stroke, opacity)), width: look.strokeWidth, lineDash: dashPattern(look.dash, look.strokeWidth) }),
        ...(item.kind === 'polygon' ? { fill: new Fill({ color: look.hatch ? (hatchPattern(fill) ?? fill) : fill }) } : {}),
      })];
    }
  }
}

/**
 * A line's arrowhead and route markers on the Canvas (overlays, drag preview), as the WebGL layer
 * draws them (`extraFeatures`): the same image, sizes and places (data model 1.1.0).
 */
export function canvasLineExtras(item: DrawItem, projection: Projection, arrowhead: HTMLCanvasElement, zIndex = 0): Style[] {
  if (item.kind !== 'line') return [];
  const head = item.style?.arrowhead === 'end' ? arrowheadAt(item, projection) : null;
  const points = item.style?.pointMarkers === 'circle' ? markerPoints(item, projection) : [];
  return lineExtraStyles(item.style, opacityOf(item), head, points, arrowhead, zIndex);
}

/** The arrowhead and the route markers of a line on the Canvas, from their places in map coordinates. */
function lineExtraStyles(
  style: ShapeStyle | undefined,
  opacity: number,
  head: { readonly tip: readonly [number, number]; readonly rotation: number } | null,
  points: number[][],
  arrowhead: HTMLCanvasElement,
  zIndex: number,
): Style[] {
  const look = shapeLook(style, 'line');
  const stroke = cssColor(faded(look.stroke, opacity));
  const styles: Style[] = [];
  if (head !== null) {
    styles.push(new Style({
      zIndex,
      geometry: new Point([...head.tip]),
      image: new Icon({
        img: arrowhead, color: stroke, anchor: [0.5, 0],
        scale: arrowheadLength(look.strokeWidth) / ARROWHEAD.length, rotation: head.rotation, rotateWithView: false,
      }),
    }));
  }
  if (points.length > 0) {
    styles.push(new Style({
      zIndex,
      geometry: new MultiPoint(points),
      // Data model 1.1.0: a small filled circle in strokeColor.
      image: new CircleStyle({ radius: markerRadius(look.strokeWidth), fill: new Fill({ color: stroke }) }),
    }));
  }
  return styles;
}

const hatchPatterns = new Map<string, CanvasPattern | null>();

/** The hatch as a Canvas fill in a colour (CSS text), cached per colour; null without a 2D context. */
export function hatchPattern(colour: string): CanvasPattern | null {
  const cached = hatchPatterns.get(colour);
  if (cached !== undefined) return cached;
  if (hatchPatterns.size >= 256) hatchPatterns.clear(); // colours come from the data: keep the cache bounded
  const tile = hatchImage(createCanvas);
  const ctx = tile.getContext('2d');
  let pattern: CanvasPattern | null = null;
  if (ctx !== null) {
    // The white lines take the colour; the gaps stay transparent.
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, tile.width, tile.height);
    pattern = ctx.createPattern(tile, 'repeat');
  }
  hatchPatterns.set(colour, pattern);
  return pattern;
}

/** 1, FADED_OPACITY for a faded item (brief function 13), or the opacity of its step (brief function 46). */
export function opacityOf(item: DrawItem): number {
  return itemOpacity(item);
}

export function iconOf(image: SymbolImage, opacity = 1): Icon {
  return new Icon({ img: image.image, width: image.width, height: image.height, anchor: [...image.anchor], anchorXUnits: 'pixels', anchorYUnits: 'pixels', opacity });
}

function fallbackStyle(zIndex: number, opacity: number): Style {
  return new Style({
    zIndex,
    image: new CircleStyle({
      radius: FALLBACK_RADIUS,
      fill: new Fill({ color: cssColor(faded(FALLBACK_FILL, opacity)) }),
      stroke: new Stroke({ color: cssColor(faded(FALLBACK_STROKE, opacity)), width: 1.5 }),
    }),
  });
}

// ---- Selection highlight (owner, 2026-10-09) ----

/** A bright stroke on a dark casing, so it shows on any background map and over any symbol. */
export const HIGHLIGHT = { color: '#ffd400', casing: 'rgba(0, 0, 0, 0.85)', width: 3, gap: 3 } as const;
const HIGHLIGHT_RGBA: Rgba = [255, 212, 0, 1];
const CASING_RGBA: Rgba = [0, 0, 0, 0.85];

/** A symbol image's box: size and anchor in CSS pixels (an atlas entry). */
export interface ImageBox {
  readonly w: number;
  readonly h: number;
  readonly ax: number;
  readonly ay: number;
}

/**
 * The highlight frame of a symbol drawn with its anchor at (x, y): the image box plus a gap on
 * every side, in canvas pixels (`ratio`: device pixels per CSS pixel). `[left, top, width, height]`.
 */
export function frameRect(x: number, y: number, box: ImageBox, ratio: number, gap: number = HIGHLIGHT.gap): [number, number, number, number] {
  return [x - (box.ax + gap) * ratio, y - (box.ay + gap) * ratio, (box.w + 2 * gap) * ratio, (box.h + 2 * gap) * ratio];
}

/**
 * The highlight of a selected item: a frame around a symbol's image (`box`; without one, a halo
 * as for a marker), a halo around a point or marker, a wide casing under a line or an area's
 * outline with the item's own stroke drawn again on top. Never a fill, so nothing below is hidden.
 */
export function highlightStyles(item: DrawItem, box: ImageBox | null, zIndex = 0, rotation = 0): Style[] {
  // A faded object's highlight is faded alike (brief function 13).
  const opacity = opacityOf(item);
  const colour = cssColor(faded(HIGHLIGHT_RGBA, opacity));
  const casing = cssColor(faded(CASING_RGBA, opacity));
  const halo = (radius: number) => [
    new Style({ zIndex, image: new CircleStyle({ radius: radius + HIGHLIGHT.gap, stroke: new Stroke({ color: casing, width: HIGHLIGHT.width + 2 }) }) }),
    new Style({ zIndex, image: new CircleStyle({ radius: radius + HIGHLIGHT.gap, stroke: new Stroke({ color: colour, width: HIGHLIGHT.width }) }) }),
  ];
  switch (item.kind) {
    case 'symbol':
    case 'textobject': // a frame round the text's box, turned with the text (brief function 45)
      if (box === null) return halo(FALLBACK_RADIUS);
      return [new Style({
        zIndex,
        renderer: (coordinates, state) => {
          const [x, y] = coordinates as number[];
          const ctx = state.context;
          const turned = item.kind === 'textobject' && rotation !== 0;
          const rect = frameRect(turned ? 0 : x ?? 0, turned ? 0 : y ?? 0, box, state.pixelRatio);
          ctx.save();
          if (turned) {
            ctx.translate(x ?? 0, y ?? 0);
            ctx.rotate(rotation);
          }
          ctx.strokeStyle = casing;
          ctx.lineWidth = (HIGHLIGHT.width + 2) * state.pixelRatio;
          ctx.strokeRect(...rect);
          ctx.strokeStyle = colour;
          ctx.lineWidth = HIGHLIGHT.width * state.pixelRatio;
          ctx.strokeRect(...rect);
          ctx.restore();
        },
      })];
    case 'fallback':
    case 'graphic': // a graphic with a drawing is highlighted by its lines (`graphicHighlightFeatures`); this is its marker
      return halo(FALLBACK_RADIUS);
    case 'text': // an overlay's label is never selected
      return [];
    case 'point':
      return halo(POINT_RADIUS);
    case 'line':
    case 'polygon': {
      const look = shapeLook(item.style, item.kind);
      const wide = look.strokeWidth + 2 * HIGHLIGHT.gap;
      return [
        new Style({ zIndex, stroke: new Stroke({ color: casing, width: wide + 2 }) }),
        new Style({ zIndex, stroke: new Stroke({ color: colour, width: wide }) }),
        new Style({ zIndex, stroke: new Stroke({ color: cssColor(faded(look.stroke, opacity)), width: look.strokeWidth, lineDash: dashPattern(look.dash, look.strokeWidth) }) }),
      ];
    }
  }
}

/**
 * Label text of shapes (brief function 18): the size is the map view's own in every density; the
 * colours and the font come from the look (brief function 21), the halo slightly see-through.
 */
export const LABEL_TEXT = { size: 12, weight: 600, haloWidth: 3, haloOpacity: 0.9 } as const;

/** The label of a named shape, centred on its point (an area's interior point, a line's middle), faded with the shape. */
export function shapeLabelStyle(name: string, opacity: number, zIndex: number, look: TextLook): Style {
  return new Style({
    zIndex,
    text: new Text({
      text: name,
      font: `${String(LABEL_TEXT.weight)} ${String(LABEL_TEXT.size)}px ${look.font}`,
      fill: new Fill({ color: cssColor(faded(look.text, opacity)) }),
      stroke: new Stroke({ color: cssColor(faded(look.halo, LABEL_TEXT.haloOpacity * opacity)), width: LABEL_TEXT.haloWidth }),
      overflow: true,
    }),
  });
}

/** How far a symbol's image reaches from its anchor, in pixels, on each side: where the labels at its places start. */
export interface ImageReach {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * How far the selection frame of a symbol reaches beyond its image, in pixels: the gap, and half the width of its
 * black casing (the casing is the wider stroke, centred on the frame's line; see {@link highlightStyles}).
 */
export const HIGHLIGHT_REACH = HIGHLIGHT.gap + (HIGHLIGHT.width + 2) / 2;

/**
 * The gap between a symbol's image and a label next to it, in pixels: the selection frame's reach and half the label's
 * halo, so that the frame of a selected symbol never covers a label's text (RC1, owner YC A: it hid "5 " of "5 INF").
 * The labels do not move when the symbol is selected.
 */
export const LABEL_GAP = HIGHLIGHT_REACH + LABEL_TEXT.haloWidth / 2;

/**
 * A symbol's label at one of its five places (SDK 1.8.0, CR-0043 part A): in the shape label's look. Top and bottom
 * left and right: beside the image, its top or bottom edge on the text's, the text growing away from the image; below: centred
 * under it. `reach` is how far the image goes from the anchor, the anchor being the style's point.
 */
export function placedLabelStyle(text: string, place: LabelPlace, reach: ImageReach, opacity: number, zIndex: number, look: TextLook): Style {
  const style = shapeLabelStyle(text, opacity, zIndex, look);
  const label = style.getText();
  if (label === null) return style;
  const left = place === 'topLeft' || place === 'bottomLeft';
  const top = place === 'topLeft' || place === 'topRight';
  switch (place) {
    case 'below':
      label.setTextAlign('center');
      label.setTextBaseline('top');
      label.setOffsetY(reach.bottom + LABEL_GAP);
      break;
    default:
      label.setTextAlign(left ? 'right' : 'left');
      label.setTextBaseline(top ? 'top' : 'bottom');
      label.setOffsetX(left ? -(reach.left + LABEL_GAP) : reach.right + LABEL_GAP);
      label.setOffsetY(top ? -reach.top : reach.bottom);
  }
  return style;
}

/** The font a text object is drawn in; the box is measured in the same one (SN A). */
export function textObjectFont(size: number, look: TextLook): string {
  return `${String(LABEL_TEXT.weight)} ${String(size)}px ${look.font}`;
}

/**
 * The size of a text object's box in pixels: the width of its widest line as the browser draws it in `look`'s font
 * (`meter`; SN A), at least a little, and the lines one `size` pixels tall and a little more.
 */
export function textBox(text: string, size: number, look: TextLook, meter: TextMeter): { readonly width: number; readonly height: number } {
  const lines = text.split('\n');
  return { width: Math.max(size * 0.6, meter.width(text, textObjectFont(size, look), size)), height: lines.length * size * 1.2 };
}

/**
 * A text object (brief function 45): its text centred on its point, turned `rotation` radians clockwise on the screen,
 * `size` pixels, in its own colour or else the look's text colour, with the label halo, faded with the object.
 */
export function textObjectStyle(item: Extract<DrawItem, { kind: 'textobject' }>, rotation: number, zIndex: number, look: TextLook): Style {
  const opacity = opacityOf(item);
  const colour: Rgba = item.color === undefined ? look.text : shapeLook({ strokeColor: item.color }, 'line').stroke;
  return new Style({
    zIndex,
    text: new Text({
      text: item.text,
      font: textObjectFont(item.size, look),
      fill: new Fill({ color: cssColor(faded(colour, opacity)) }),
      stroke: new Stroke({ color: cssColor(faded(look.halo, LABEL_TEXT.haloOpacity * opacity)), width: LABEL_TEXT.haloWidth }),
      overflow: true,
      textAlign: 'center',
      textBaseline: 'middle',
      rotation,
      rotateWithView: false,
    }),
  });
}

/**
 * An overlay's label (SDK 1.4.0 part 6; brief function 8): the text centred on its position, with a
 * halo. What the plugin leaves out is the map view's own: the look's text colour and halo colour, its
 * font, the size of a shape's label. The colours are CSS colours as the plugin gives them.
 */
export function overlayLabelStyle(text: string, style: OverlayLabelStyle | undefined, zIndex: number, look: TextLook): Style {
  return new Style({
    zIndex,
    text: new Text({
      text,
      font: `${String(LABEL_TEXT.weight)} ${String(style?.size ?? LABEL_TEXT.size)}px ${look.font}`,
      fill: new Fill({ color: style?.color ?? cssColor(look.text) }),
      stroke: new Stroke({ color: style?.haloColor ?? cssColor(faded(look.halo, LABEL_TEXT.haloOpacity)), width: LABEL_TEXT.haloWidth }),
      overflow: true,
      textAlign: 'center',
    }),
  });
}

/**
 * The preview of a shape being drawn (brief function 17): the shape in the caller's style
 * (outline, dash, fill or hatch, a line's arrowhead and markers), and a small dot at the pointer.
 */
export function drawPreviewStyle(kind: 'area' | 'line', style: ShapeStyle | undefined, arrowhead: HTMLCanvasElement): (feature: FeatureLike) => Style[] {
  const look = shapeLook(style, kind === 'area' ? 'polygon' : 'line');
  const pointer = new Style({ image: new CircleStyle({ radius: 4, fill: new Fill({ color: cssColor(look.stroke) }), stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.9)', width: 1.5 }) }) });
  const fill = cssColor(look.fill);
  const outline = new Style({
    stroke: new Stroke({ color: cssColor(look.stroke), width: look.strokeWidth, lineDash: dashPattern(look.dash, look.strokeWidth) }),
    ...(kind === 'area' ? { fill: new Fill({ color: look.hatch ? (hatchPattern(fill) ?? fill) : fill }) } : {}),
  });
  return (feature) => {
    const geometry = feature.getGeometry();
    if (geometry instanceof Point) return [pointer];
    if (kind === 'line' && geometry instanceof LineString) {
      const coordinates = geometry.getCoordinates().map((c) => [c[0] ?? 0, c[1] ?? 0] as const);
      const head = style?.arrowhead === 'end' ? arrowheadOnPath(coordinates) : null;
      const points = style?.pointMarkers === 'circle' ? coordinates.slice(0, -1).map((c) => [...c]) : [];
      return [outline, ...lineExtraStyles(style, 1, head, points, arrowhead, 0)];
    }
    return [outline];
  };
}
