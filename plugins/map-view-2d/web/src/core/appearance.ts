/**
 * How things look, as plain data the engine turns into OpenLayers styles: shape styles from the
 * model (`Style`, colours `#rrggbb`), the direction arrow's rotation on screen, and the background
 * map's attribution as safe HTML.
 */
import type { Position, Style } from '@emc2/plugin-sdk';
import type { Projection } from './projections.ts';
import type { DrawItem } from './drawData.ts';

/** `[r, g, b, a]` with r, g, b in 0–255 and a in 0–1. */
export type Rgba = readonly [number, number, number, number];

/** 0 solid, 1 dash, 2 dot. */
export type Dash = 0 | 1 | 2;

export interface ShapeLook {
  readonly stroke: Rgba;
  /** Screen pixels. */
  readonly strokeWidth: number;
  readonly dash: Dash;
  readonly fill: Rgba;
  /** A hatched fill instead of a solid one (data model 1.1.0 `fillPattern`; areas only). */
  readonly hatch: boolean;
}

/** The default look of a shape without a style: a dark blue line, a light fill for areas and points. */
export const DEFAULT_STROKE = '#1f4e8c';
const DEFAULT_STROKE_WIDTH = 2;
const DEFAULT_FILL_OPACITY = 0.2;

/** A `#rrggbb` colour with an opacity; anything else gives the fallback colour. */
export function rgba(color: string | undefined, opacity: number | undefined, fallback = DEFAULT_STROKE): Rgba {
  const hex = color !== undefined && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
  const n = Number.parseInt(hex.slice(1), 16);
  const a = opacity === undefined || !Number.isFinite(opacity) ? 1 : Math.min(1, Math.max(0, opacity));
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

/**
 * The look of a shape. Without a fill colour, an area or point is filled with its stroke colour at
 * low opacity, so it can be seen and picked; a line has no fill.
 */
export function shapeLook(style: Style | undefined, kind: 'point' | 'line' | 'polygon'): ShapeLook {
  const s = style ?? {};
  const stroke = rgba(s.strokeColor, s.strokeOpacity);
  const width = s.strokeWidth !== undefined && Number.isFinite(s.strokeWidth) ? Math.min(50, Math.max(0, s.strokeWidth)) : DEFAULT_STROKE_WIDTH;
  const dash: Dash = s.strokeDash === 'dash' ? 1 : s.strokeDash === 'dot' ? 2 : 0;
  const fill: Rgba =
    kind === 'line' ? [0, 0, 0, 0]
      : s.fillColor !== undefined ? rgba(s.fillColor, s.fillOpacity ?? 1)
        : rgba(s.strokeColor, s.fillOpacity ?? DEFAULT_FILL_OPACITY);
  return { stroke, strokeWidth: width, dash, fill, hatch: kind === 'polygon' && s.fillPattern === 'hatch' };
}

/** A colour with its opacity multiplied (a faded object, brief function 13). */
export function faded([r, g, b, a]: Rgba, opacity: number): Rgba {
  return [r, g, b, a * opacity];
}

/** CSS colour text of an Rgba, for Canvas styles. */
export function cssColor([r, g, b, a]: Rgba): string {
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(a)})`;
}

/** Line dash pattern in pixels for a dash kind (empty for solid). */
export function dashPattern(dash: Dash, width: number): number[] {
  const w = Math.max(1, width);
  return dash === 1 ? [4 * w, 3 * w] : dash === 2 ? [w, 2 * w] : [];
}

/**
 * Where true north points on screen at a position, in radians clockwise from screen up. In Web
 * Mercator it is always 0; in a polar projection it turns with the longitude.
 */
export function northOnScreen(projection: Projection, position: Position): number {
  const [lon, lat] = position;
  const step = lat > 89.99 ? -0.01 : 0.01; // at the pole, look south and turn round
  const a = projection.forward([lon, lat]);
  const b = projection.forward([lon, lat + step]);
  if (a === null || b === null) return 0;
  const angle = Math.atan2(b[0] - a[0], b[1] - a[1]);
  return step > 0 ? angle : angle + Math.PI;
}

/** The arrow's rotation on screen for a direction of movement (degrees clockwise from true north). */
export function arrowRotation(projection: Projection, position: Position, direction: number): number {
  return northOnScreen(projection, position) + (direction * Math.PI) / 180;
}

/**
 * The attribution of a background map as HTML for the map's attribution area. The provider's text
 * is another plugin's data, so it is escaped; the link is kept only for http and https URLs.
 */
export function attributionHtml(attribution: { readonly text: string; readonly url?: string }): string {
  const text = escapeHtml(attribution.text.slice(0, 300));
  const url = attribution.url;
  if (url === undefined || !/^https?:\/\//i.test(url)) return text;
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);
}

/** Where a line's arrowhead goes: its last projected point, turned along the last segment (radians clockwise from up). */
export function arrowheadAt(item: Extract<DrawItem, { kind: 'line' }>, projection: Projection): { readonly tip: readonly [number, number]; readonly rotation: number } | null {
  return arrowheadOnPath(item.positions.map((p) => projection.forward(p)).filter((xy) => xy !== null));
}

/** The arrowhead at the end of a path in map coordinates (also a line being drawn). */
export function arrowheadOnPath(points: readonly (readonly [number, number])[]): { readonly tip: readonly [number, number]; readonly rotation: number } | null {
  const tip = points[points.length - 1];
  if (tip === undefined) return null;
  // The last segment with a length: a line may end with a repeated point (review remark 2, part B).
  for (let i = points.length - 2; i >= 0; i--) {
    const before = points[i];
    if (before !== undefined && (before[0] !== tip[0] || before[1] !== tip[1])) {
      return { tip, rotation: Math.atan2(tip[0] - before[0], tip[1] - before[1]) };
    }
  }
  return null;
}

/** Where a line's route markers go: its own points (not the ones added for geodesic edges), projected. */
export function markerPoints(item: Extract<DrawItem, { kind: 'line' }>, projection: Projection): number[][] {
  return (item.vertices ?? item.positions).map((p) => projection.forward(p)).filter((xy) => xy !== null).map((xy) => [...xy]);
}
