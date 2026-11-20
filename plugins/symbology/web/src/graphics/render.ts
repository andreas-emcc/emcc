// Runs in the graphics worker (and in Node for tests): what goes into mil-sym-ts and what comes out.
// Only type imports from the SDK: a module worker has no import map, so it cannot load shared libraries.
import type { GraphicCatalogEntry, GraphicFill, GraphicImage, GraphicLabel, GraphicLine, GraphicRenderRequest, GraphicRendering, Modifiers } from '@emc2/plugin-sdk';
import { AMPLIFIERS, RENDERER_VERSIONS, type GraphicStandard } from './catalogue.ts';

/** The model's names to mil-sym-ts's amplifier keys. */
const KEYS: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(AMPLIFIERS).map(([key, name]) => [name, key]));

/** Metres per inch, and the screen's dots per inch for the scale (brief, function 9). */
const METRES_PER_INCH = 0.0254;
const DOTS_PER_INCH = 96;

/** A call to mil-sym-ts's `RenderSymbol`, in its own terms. */
export interface RendererCall {
  readonly sidc: string;
  /** "lon,lat" pairs separated by spaces. */
  readonly points: string;
  readonly scale: number;
  /** "west,south,east,north", or empty for no clipping. */
  readonly bbox: string;
  /** mil-sym-ts's amplifier keys to their values. */
  readonly modifiers: ReadonlyMap<string, string>;
}

type Refusal = { readonly ok: false; readonly reason: string };

const refuse = (reason: string): Refusal => ({ ok: false, reason });

/** The catalogue key of a SIDC: symbol set (digits 5–6) and entity (digits 11–16). */
export function graphicKey(sidc: string): string {
  return sidc.slice(4, 6) + sidc.slice(10, 16);
}

/** The catalogue of a standard by `graphicKey`. */
export function byKey(catalogue: readonly GraphicCatalogEntry[]): ReadonlyMap<string, GraphicCatalogEntry> {
  return new Map(catalogue.map((entry) => [entry.symbolSet + entry.entity, entry]));
}

function modifierValue(value: Modifiers[keyof Modifiers]): string | null {
  if (value === undefined) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.length === 0 ? null : value.map(String).join(',');
  return String(value);
}

/**
 * The renderer call for a request, or the reason it is refused. The SIDC's version digits become
 * mil-sym-ts's (10 for APP-6D, 16 for APP-6E); the request's SIDC is not changed.
 */
export function prepare(request: GraphicRenderRequest, catalogues: (standard: GraphicStandard) => ReadonlyMap<string, GraphicCatalogEntry>): RendererCall | Refusal {
  const { standard, sidc, points, modifiers, resolution, extent } = request;
  if (!(standard in RENDERER_VERSIONS)) return refuse(`${standard} has no tactical graphics`);
  if (!/^(\d{20}|\d{30})$/.test(sidc)) return refuse(`not a ${standard} SIDC: ${sidc}`);
  const entry = catalogues(standard).get(graphicKey(sidc));
  if (entry === undefined) return refuse(`not a tactical graphic of the catalogue: symbol set ${sidc.slice(4, 6)}, entity ${sidc.slice(10, 16)}`);
  if (points.length < entry.minPoints || (entry.maxPoints !== null && points.length > entry.maxPoints)) {
    const min = String(entry.minPoints);
    const range = entry.maxPoints === null ? `${min} or more` : entry.maxPoints === entry.minPoints ? min : `${min} to ${String(entry.maxPoints)}`;
    return refuse(`${entry.name} takes ${range} points, not ${String(points.length)}`);
  }
  if (!points.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90)) return refuse('a point is not a longitude, latitude');
  const missing = entry.requiredModifiers.filter((name) => modifierValue(modifiers?.[name]) === null);
  if (missing.length > 0) return refuse(`${entry.name} needs ${missing.join(' and ')}`);
  const [west, south, east, north] = extent;
  if (!(resolution > 0 && Number.isFinite(resolution))) return refuse('the resolution is not a positive number');
  if (![west, south, east, north].every(Number.isFinite) || !(south < north) || west === east) return refuse('the view is empty');
  const call = new Map<string, string>();
  for (const name of entry.allowedModifiers) {
    const value = modifierValue(modifiers?.[name]);
    const key = KEYS[name];
    if (value !== null && key !== undefined) call.set(key, value);
  }
  return {
    sidc: String(RENDERER_VERSIONS[standard]) + sidc.slice(2),
    points: points.map(([lon, lat]) => `${String(lon)},${String(lat)}`).join(' '),
    scale: (resolution * DOTS_PER_INCH) / METRES_PER_INCH,
    // Across the antimeridian (west > east) mil-sym-ts gets no box and clips nothing.
    bbox: west < east ? [west, south, east, north].join(',') : '',
    modifiers: call,
  };
}

interface Feature {
  readonly geometry?: { readonly type?: string; readonly coordinates?: unknown };
  readonly properties?: Readonly<Record<string, unknown>>;
}

/** `#RRGGBB` and an opacity from mil-sym-ts's `#RRGGBB` or `#AARRGGBB`. */
function colour(value: unknown): { readonly color: string; readonly alpha: number } | null {
  if (typeof value !== 'string') return null;
  if (/^#[0-9a-f]{6}$/i.test(value)) return { color: value.toUpperCase(), alpha: 1 };
  if (/^#[0-9a-f]{8}$/i.test(value)) return { color: `#${value.slice(3).toUpperCase()}`, alpha: parseInt(value.slice(1, 3), 16) / 255 };
  return null;
}

function numberOf(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Flat longitude, latitude pairs from GeoJSON positions; null if any is not a finite pair. */
function flat(positions: unknown): Float64Array | null {
  if (!Array.isArray(positions)) return null;
  const out = new Float64Array(positions.length * 2);
  for (let i = 0; i < positions.length; i++) {
    const p: unknown = positions[i];
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    out[2 * i] = p[0] as number;
    out[2 * i + 1] = p[1] as number;
  }
  return out;
}

/** The parts of a line or area geometry as position lists. */
function parts(geometry: Feature['geometry']): unknown[] {
  const c = geometry?.coordinates;
  if (!Array.isArray(c)) return [];
  switch (geometry?.type) {
    case 'LineString':
      return [c];
    case 'MultiLineString':
    case 'Polygon':
      return c;
    case 'MultiPolygon':
      return c.flat(1);
    default:
      return [];
  }
}

/**
 * A CSS pixel size from mil-sym-ts's font size. It writes `12pt` but measures and places its labels
 * with a `12px` font (lines of a text block are about 12 px apart), so the number is taken as pixels;
 * 16 px made the lines of an air corridor's block overlap (browser check, 2026-11-06).
 */
function fontPixels(size: unknown): number {
  return numberOf(size) ?? 12;
}

/** Degrees in (-180, 180]. */
function upright(angle: number): number {
  const a = ((angle % 360) + 360) % 360;
  return a > 180 ? a - 360 : a;
}

/** The prefix of the images `GraphicImage` takes (brief function 15). */
const SVG_DATA_URI = 'data:image/svg+xml';

/** The SVG text of an SVG data URI, base64 or percent-encoded; null if it cannot be decoded. */
function svgText(uri: string): string | null {
  const comma = uri.indexOf(',');
  if (comma < 0) return null;
  const head = uri.slice(0, comma);
  const body = uri.slice(comma + 1);
  try {
    return head.endsWith(';base64') ? atob(body) : decodeURIComponent(body);
  } catch {
    return null;
  }
}

/** A positive pixel length of an SVG attribute (`81`, `81px`); null for none, percentages or other units. */
function pixels(value: string | undefined): number | null {
  if (value === undefined) return null;
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/.exec(value);
  const n = m === null ? NaN : Number(m[1]);
  return n > 0 && Number.isFinite(n) ? n : null;
}

/**
 * The size in pixels of an SVG data URI, from its root element's `width` and `height`, else from its
 * `viewBox`; null if neither gives a size above 0. Read as text: a worker has no DOM.
 */
export function svgSize(uri: string): { readonly width: number; readonly height: number } | null {
  const text = svgText(uri);
  const root = text === null ? null : /<svg\b([^>]*)>/i.exec(text);
  if (root === null) return null;
  const attribute = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(root[1] ?? '')?.[1];
  const width = pixels(attribute('width'));
  const height = pixels(attribute('height'));
  if (width !== null && height !== null) return { width, height };
  const box = (attribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const [, , w, h] = box;
  return box.length === 4 && w !== undefined && h !== undefined && w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h) ? { width: w, height: h } : null;
}

/** A drawn graphic and the buffers to transfer with it. */
export interface Parsed {
  readonly rendering: GraphicRendering;
  readonly transfer: ArrayBuffer[];
}

/**
 * mil-sym-ts's GeoJSON as a `GraphicRendering` of flat arrays. Its colours, widths, dashes and fonts
 * are kept (APP-6's, in every look). Points that carry an image (the icons inside some minefields
 * and contaminated areas) become `images` (SDK 1.5.0, brief function 15), centred on the point; one
 * that is not an SVG data URI, or whose size cannot be read, is left out and the graphic still draws.
 */
export function parse(text: string): Parsed {
  let json: { readonly type?: string; readonly error?: string; readonly features?: readonly Feature[] };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    // A view of zero width gives NaN, which is not JSON (spike S1, surprise 3).
    return { rendering: refuse(text.includes('NaN') ? 'the view has no size (the renderer gave NaN)' : 'the renderer gave no valid result'), transfer: [] };
  }
  if (json.type === 'error') return { rendering: refuse(json.error ?? 'the renderer refused the graphic'), transfer: [] };
  const lines: GraphicLine[] = [];
  const fills: GraphicFill[] = [];
  const labels: GraphicLabel[] = [];
  const images: GraphicImage[] = [];
  const transfer: ArrayBuffer[] = [];
  for (const feature of json.features ?? []) {
    const p = feature.properties ?? {};
    if (feature.geometry?.type === 'Point') {
      const position = flat([feature.geometry.coordinates]);
      const image = p['image'];
      if (image !== undefined) {
        // An image point: its anchorPoint and offsets (a leader line) are not used.
        const size = typeof image === 'string' && image.startsWith(SVG_DATA_URI) ? svgSize(image) : null;
        if (position !== null && size !== null && typeof image === 'string') {
          images.push({ position: [position[0] ?? 0, position[1] ?? 0], svg: image, width: size.width, height: size.height, angle: upright(numberOf(p['rotation']) ?? 0) });
        }
        continue;
      }
      const text = typeof p['label'] === 'string' ? p['label'] : '';
      const color = colour(p['fontColor']);
      if (position === null || text === '' || color === null) continue;
      const halo = colour(p['labelOutlineColor']);
      const align = p['labelAlign'] === 'left' || p['labelAlign'] === 'right' ? p['labelAlign'] : 'center';
      const weight = typeof p['fontWeight'] === 'string' ? p['fontWeight'] : 'normal';
      const family = typeof p['fontFamily'] === 'string' ? p['fontFamily'] : 'sans-serif';
      labels.push({
        position: [position[0] ?? 0, position[1] ?? 0],
        text,
        angle: upright(numberOf(p['rotation']) ?? 0),
        font: `${weight} ${String(fontPixels(p['fontSize']))}px ${family}`,
        color: color.color,
        ...(halo === null ? {} : { halo: halo.color }),
        align,
      });
      continue;
    }
    const rings = parts(feature.geometry).map(flat);
    if (rings.some((ring) => ring === null)) return { rendering: refuse('the renderer gave a position that is not a number'), transfer: [] };
    const arrays = rings as Float64Array[];
    if (arrays.length === 0) continue;
    const stroke = colour(p['strokeColor']);
    const fill = colour(p['fillColor']);
    const hatched = typeof p['fillPattern'] === 'string' && p['fillPattern'] !== '';
    if (feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon') {
      if (fill !== null || hatched) {
        const fillColour = fill ?? stroke ?? { color: '#000000', alpha: 1 };
        const opacity = (numberOf(p['fillOpacity']) ?? 1) * fillColour.alpha;
        fills.push({ rings: arrays, color: fillColour.color, opacity, ...(hatched ? { pattern: 'hatch' as const } : {}) });
        transfer.push(...arrays.map((a) => a.buffer as ArrayBuffer));
      }
    }
    if (stroke !== null) {
      const opacity = (numberOf(p['lineOpacity']) ?? 1) * stroke.alpha;
      const width = numberOf(p['strokeWidth']) ?? 1;
      const dash = Array.isArray(p['strokeDasharray']) ? p['strokeDasharray'].map(Number).filter(Number.isFinite) : [];
      for (const coordinates of arrays) {
        // A ring that is also filled shares its buffer with the fill: copy it, so both can be transferred.
        const own = fill !== null || hatched ? coordinates.slice() : coordinates;
        lines.push({ coordinates: own, color: stroke.color, width, ...(opacity < 1 ? { opacity } : {}), ...(dash.length > 0 ? { dash } : {}) });
        transfer.push(own.buffer as ArrayBuffer);
      }
    }
  }
  // Strings are copied, not transferred; a graphic without image points gives no `images`.
  return { rendering: { ok: true, lines, fills, labels, ...(images.length > 0 ? { images } : {}) }, transfer };
}
