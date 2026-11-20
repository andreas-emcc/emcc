// The style a user chooses, and how it maps to the data model's `style` (1.1.0). A shape's fill is
// none (no `fillColor`), transparent (a colour and an opacity) or hatched (the same, with
// `fillPattern` `hatch`). An arrow has an arrowhead at its last point, a route markers at its points.
import type { JsonValue, Style } from '@emc2/plugin-sdk';
import { hasArea } from './kinds.ts';
import type { ShapeKind } from './kinds.ts';

export type Dash = NonNullable<Style['strokeDash']>;
export type Fill = 'none' | 'transparent' | 'hatched';

export interface StyleChoice {
  readonly outlineColor: string;
  readonly outlineWidth: number;
  readonly outlineDash: Dash;
  readonly fill: Fill;
  readonly fillColor: string;
  /** 0 to 1. */
  readonly fillOpacity: number;
  /** Lines only: an arrowhead at the last point. */
  readonly arrowhead: boolean;
  /** Lines only: a marker at every point. */
  readonly markers: boolean;
}

export const DASHES: readonly Dash[] = ['solid', 'dash', 'dot'];
export const DASH_LABELS: Readonly<Record<Dash, string>> = { solid: 'Solid', dash: 'Dashed', dot: 'Dotted' };
export const FILLS: readonly Fill[] = ['none', 'transparent', 'hatched'];
export const FILL_LABELS: Readonly<Record<Fill, string>> = { none: 'None', transparent: 'Transparent', hatched: 'Hatched' };

export const MIN_WIDTH = 1;
export const MAX_WIDTH = 20;
export const COLOUR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** The same defaults as in plugin.json (a test checks it). */
export const DEFAULT_STYLE: StyleChoice = {
  outlineColor: '#1f3a93',
  outlineWidth: 2,
  outlineDash: 'solid',
  fill: 'none',
  fillColor: '#1f3a93',
  fillOpacity: 0.2,
  arrowhead: false,
  markers: false,
};

export function isColour(value: string): boolean {
  return COLOUR_PATTERN.test(value);
}

/** The model's `style` for a new shape of `kind`. */
export function styleFor(choice: StyleChoice, kind: ShapeKind): Style {
  const base: Style = { strokeColor: choice.outlineColor, strokeWidth: choice.outlineWidth, strokeDash: choice.outlineDash };
  if (kind === 'arrow') return { ...base, arrowhead: 'end' };
  if (kind === 'route') return { ...base, pointMarkers: 'circle' };
  if (!hasArea(kind) || choice.fill === 'none') return base;
  const filled: Style = { ...base, fillColor: choice.fillColor, fillOpacity: choice.fillOpacity };
  return choice.fill === 'hatched' ? { ...filled, fillPattern: 'hatch' } : filled;
}

/** What the style form shows for an object's `style`; fields the style lacks take `fallback`. */
export function choiceOf(style: Style | undefined, fallback: StyleChoice = DEFAULT_STYLE): StyleChoice {
  const s = style ?? {};
  const fill: Fill = s.fillColor === undefined ? 'none' : s.fillPattern === 'hatch' ? 'hatched' : 'transparent';
  return {
    outlineColor: s.strokeColor ?? fallback.outlineColor,
    outlineWidth: s.strokeWidth ?? fallback.outlineWidth,
    outlineDash: s.strokeDash ?? fallback.outlineDash,
    fill,
    fillColor: s.fillColor ?? fallback.fillColor,
    fillOpacity: s.fillOpacity ?? (s.fillColor === undefined ? fallback.fillOpacity : 1),
    arrowhead: s.arrowhead === 'end',
    markers: s.pointMarkers === 'circle',
  };
}

/**
 * The style after the user changed the form: the fields the form shows are written from `choice`,
 * every other field of the old style (e.g. `strokeOpacity`) is kept. Fields the form does not show
 * for this geometry (the fill of a line, the arrowhead of an area) are left as they were.
 */
export function applyChoice(old: Style | undefined, choice: StyleChoice, parts: { readonly area: boolean; readonly line: boolean }): Style {
  const replaced = new Set<string>(['strokeColor', 'strokeWidth', 'strokeDash']);
  if (parts.area) for (const key of ['fillColor', 'fillOpacity', 'fillPattern']) replaced.add(key);
  if (parts.line) for (const key of ['arrowhead', 'pointMarkers']) replaced.add(key);
  const kept = Object.fromEntries(Object.entries(old ?? {}).filter(([key]) => !replaced.has(key))) as Style;
  let result: Style = { ...kept, strokeColor: choice.outlineColor, strokeWidth: choice.outlineWidth, strokeDash: choice.outlineDash };
  if (parts.area && choice.fill !== 'none') {
    result = { ...result, fillColor: choice.fillColor, fillOpacity: choice.fillOpacity, ...(choice.fill === 'hatched' ? { fillPattern: 'hatch' as const } : {}) };
  }
  if (parts.line) {
    result = { ...result, ...(choice.arrowhead ? { arrowhead: 'end' as const } : {}), ...(choice.markers ? { pointMarkers: 'circle' as const } : {}) };
  }
  return result;
}

/** The settings that give the style of new shapes. A bad value gives the default and a problem to report. */
export function readStyleSettings(raw: { readonly [name: string]: JsonValue }): { readonly style: StyleChoice; readonly problems: readonly string[] } {
  const problems: string[] = [];
  const d = DEFAULT_STYLE;

  const colour = (name: string, fallback: string): string => {
    const wanted = raw[name];
    if (typeof wanted === 'string' && isColour(wanted)) return wanted;
    if (wanted !== undefined) problems.push(`setting "${name}" must be a colour like #1f3a93, using ${fallback}`);
    return fallback;
  };

  let outlineWidth = d.outlineWidth;
  const wantedWidth = raw['outlineWidth'];
  if (typeof wantedWidth === 'number' && wantedWidth >= MIN_WIDTH && wantedWidth <= MAX_WIDTH) outlineWidth = wantedWidth;
  else if (wantedWidth !== undefined) problems.push(`setting "outlineWidth" must be from ${String(MIN_WIDTH)} to ${String(MAX_WIDTH)}, using ${String(outlineWidth)}`);

  let outlineDash = d.outlineDash;
  const wantedDash = raw['outlineDash'];
  if (typeof wantedDash === 'string' && (DASHES as readonly string[]).includes(wantedDash)) outlineDash = wantedDash as Dash;
  else if (wantedDash !== undefined) problems.push(`setting "outlineDash" must be solid, dash or dot, using ${outlineDash}`);

  let fill = d.fill;
  const wantedFill = raw['fill'];
  if (typeof wantedFill === 'string' && (FILLS as readonly string[]).includes(wantedFill)) fill = wantedFill as Fill;
  else if (wantedFill !== undefined) problems.push(`setting "fill" must be none, transparent or hatched, using ${fill}`);

  let fillOpacity = d.fillOpacity;
  const wantedOpacity = raw['fillOpacity'];
  if (typeof wantedOpacity === 'number' && wantedOpacity >= 0 && wantedOpacity <= 1) fillOpacity = wantedOpacity;
  else if (wantedOpacity !== undefined) problems.push(`setting "fillOpacity" must be from 0 to 1, using ${String(fillOpacity)}`);

  return {
    style: {
      outlineColor: colour('outlineColor', d.outlineColor),
      outlineWidth,
      outlineDash,
      fill,
      fillColor: colour('fillColor', d.fillColor),
      fillOpacity,
      arrowhead: false,
      markers: false,
    },
    problems,
  };
}
