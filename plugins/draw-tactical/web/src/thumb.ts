// The picture on a Graphics tile (T-204, owner: "the graphic itself, drawn small"). The symbology service
// draws a graphic for a view, in longitude and latitude (`renderGraphic`); this file chooses the sample
// points the graphic is drawn through, a small view that fits the tile, and turns the answer into paths
// the tile draws as an SVG. It never calls mil-sym-ts (ADR-0043 point 2) and draws only numbers, never
// markup the renderer gave it.
import type { GraphicCatalogEntry, GraphicRendering, Position } from '@emc2/plugin-sdk';

/** The tile picture's size in SVG units (the CSS scales it). */
export const THUMB_WIDTH = 46;
export const THUMB_HEIGHT = 28;

/** The small view the graphic is drawn in: near the equator, so that a degree of longitude and one of latitude are alike. */
const HALF_LON = 0.01;
const HALF_LAT = HALF_LON * (THUMB_HEIGHT / THUMB_WIDTH);
const METRES_PER_DEGREE = 111_320;

export const THUMB_EXTENT: readonly [number, number, number, number] = [-HALF_LON, -HALF_LAT, HALF_LON, HALF_LAT];
/** Metres per picture unit at the view's centre. */
export const THUMB_RESOLUTION = (2 * HALF_LON * METRES_PER_DEGREE) / THUMB_WIDTH;

/** The unit box the sample points are given in: x from −1 to 1, y from −1 to 1 (up). */
function lonLat(x: number, y: number): Position {
  return [x * HALF_LON * 0.85, y * HALF_LAT * 0.8];
}

const clamp = (n: number, low: number, high: number): number => Math.min(high, Math.max(low, n));

/**
 * Points to draw a graphic through, in the order its catalogue entry asks for, or null when a picture needs
 * more than points (a graphic with a required amplifier, e.g. a range fan's distance and azimuths). The
 * shapes are generic: a wave for a line, an oval or a box for an area, an arrow's tip, axis and head.
 */
export function samplePoints(entry: GraphicCatalogEntry): Position[] | null {
  if (entry.requiredModifiers.length > 0) return null;
  const max = entry.maxPoints ?? 50;
  const min = Math.max(1, entry.minPoints);
  switch (entry.kind) {
    case 'points':
      return [lonLat(0, 0)];
    case 'line': {
      const n = clamp(Math.max(min, 3), min, max);
      return Array.from({ length: n }, (_, i) => {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const y = n === 2 ? 0.3 * (2 * t - 1) : 0.45 * Math.sin(t * Math.PI * 1.4 - 0.4);
        return lonLat(-1 + 2 * t, y);
      });
    }
    case 'area': {
      const n = clamp(Math.max(min, 4), min, max);
      if (n === 4) return [lonLat(-1, -0.8), lonLat(1, -0.8), lonLat(1, 0.8), lonLat(-1, 0.8)];
      return Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + Math.PI / n;
        return lonLat(Math.cos(a), Math.sin(a) * 0.8);
      });
    }
    case 'arrow': {
      const n = clamp(Math.max(min, 3), min, max);
      // 1: the tip; 2 to n−1: the axis from the tip back to the tail; n: the width of the arrowhead.
      const axis = n - 1;
      const points: Position[] = [];
      for (let i = 0; i < axis; i += 1) {
        const t = axis === 1 ? 0 : i / (axis - 1);
        points.push(lonLat(1 - 2 * t, 0));
      }
      points.push(lonLat(0.45, 0.55));
      return points;
    }
  }
}

/** What a tile draws: lines and filled areas in picture units, with the colours the renderer gave. */
export interface ThumbPath {
  readonly d: string;
  /** `#RRGGBB`. */
  readonly color: string;
  readonly opacity: number;
}
export interface ThumbLine extends ThumbPath {
  readonly width: number;
  readonly dash: string | null;
}
export interface ThumbFill extends ThumbPath {
  readonly hatch: boolean;
}
/** A graphic's own abbreviation (PL, LD, FLOT), small: what tells many tiles of one shape apart. */
export interface ThumbLabel {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  /** Degrees clockwise. */
  readonly angle: number;
  readonly size: number;
  readonly color: string;
  readonly anchor: 'start' | 'middle' | 'end';
}
export interface ThumbModel {
  readonly fills: readonly ThumbFill[];
  readonly lines: readonly ThumbLine[];
  readonly labels: readonly ThumbLabel[];
}

const MAX_LABELS = 4;
const MAX_LABEL_CHARS = 12;
const LABEL_SIZE = { min: 4, max: 7 };

const round = (n: number): string => (Math.round(n * 10) / 10).toString();

/** Longitude, latitude to picture units (y grows downward). */
export function toPicture(lon: number, lat: number): [number, number] {
  const [west, south, east, north] = THUMB_EXTENT;
  return [((lon - west) / (east - west)) * THUMB_WIDTH, ((north - lat) / (north - south)) * THUMB_HEIGHT];
}

function pathOf(flat: Float64Array, close: boolean): string {
  const parts: string[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const [x, y] = toPicture(flat[i] ?? 0, flat[i + 1] ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue; // a point the service gave wrongly is left out, never drawn as "NaN"
    parts.push(`${parts.length === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`);
  }
  return parts.length === 0 ? '' : parts.join(' ') + (close ? ' Z' : '');
}

const COLOUR = /^#[0-9A-Fa-f]{6}$/;
const colourOf = (c: string): string => (COLOUR.test(c) ? c : '#000000');
const opacityOf = (o: number | undefined): number => (o === undefined || !Number.isFinite(o) ? 1 : clamp(o, 0, 1));

/** The tile's paths from a rendering, or null if the service did not draw the graphic or drew nothing visible. */
export function thumbModelOf(rendering: GraphicRendering): ThumbModel | null {
  if (!rendering.ok) return null;
  const fills = rendering.fills.flatMap((f): ThumbFill[] => {
    const d = f.rings.map((ring) => pathOf(ring, true)).filter((p) => p !== '').join(' ');
    return d === '' ? [] : [{ d, color: colourOf(f.color), opacity: opacityOf(f.opacity), hatch: f.pattern === 'hatch' }];
  });
  const lines = rendering.lines.flatMap((l): ThumbLine[] => {
    const d = pathOf(l.coordinates, false);
    if (d === '') return [];
    const dash = l.dash !== undefined && l.dash.length > 0 ? l.dash.map((v) => round(clamp(v, 0.5, 12))).join(' ') : null;
    return [{ d, color: colourOf(l.color), opacity: opacityOf(l.opacity), width: clamp((Number.isFinite(l.width) ? l.width : 1) * 0.7, 1, 2), dash }];
  });
  const labels = rendering.labels.slice(0, MAX_LABELS).flatMap((l): ThumbLabel[] => {
    const text = l.text.trim().slice(0, MAX_LABEL_CHARS);
    if (text === '') return [];
    const [x, y] = toPicture(l.position[0], l.position[1]);
    const px = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(l.font)?.[1] ?? '12');
    return [{ x, y, text, angle: Number.isFinite(l.angle) ? l.angle : 0, size: clamp(px * 0.5, LABEL_SIZE.min, LABEL_SIZE.max), color: colourOf(l.color), anchor: l.align === 'left' ? 'start' : l.align === 'right' ? 'end' : 'middle' }];
  });
  return fills.length === 0 && lines.length === 0 && labels.length === 0 ? null : { fills, lines, labels };
}
