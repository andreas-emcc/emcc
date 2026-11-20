// The user's own overlay (ADR-0049 point 8): range and bearing, and the viewshed. Shown in this
// browser only, never shared or saved. The map view densifies a line's geodesic edges, but the
// overlay has no circle, so the range circle is a closed line that is densified here.
import type { OverlayItem, OverlayLabelStyle, Position, Style, Viewport } from '@emc2/plugin-sdk';
import type { HeightMapResult, RangeResult, ViewshedResult } from './api.ts';
import { heightLabel, rangeLabel } from './format.ts';

/** Positions of the range circle: one every 2 degrees of azimuth, closed, so 181 in all. */
export const CIRCLE_POSITIONS = 181;

const RANGE_STYLE: Style = { strokeColor: '#ffb000', strokeWidth: 2 };
const RANGE_POINT_STYLE: Style = { strokeColor: '#ffb000', fillColor: '#ffb000', strokeWidth: 2 };
const VIEWSHED_COLOR = '#1e9e48';
const VIEWSHED_STYLE: Style = { strokeColor: VIEWSHED_COLOR, strokeWidth: 1, fillColor: VIEWSHED_COLOR, fillOpacity: 0.3 };
const CIRCLE_STYLE: Style = { strokeColor: VIEWSHED_COLOR, strokeWidth: 1, strokeDash: 'dash' };
const OBSERVER_STYLE: Style = { strokeColor: VIEWSHED_COLOR, fillColor: VIEWSHED_COLOR, strokeWidth: 2 };

const WGS84_A = 6_378_137;
const WGS84_E2 = 0.006_694_379_990_141_32;

/**
 * The position `metres` from `center` at `bearing` degrees from north. On a sphere whose radius is
 * the Gaussian radius of the ellipsoid at the centre's latitude, which is within about 0.01 % of the
 * geodesic over the ranges of a viewshed (at most 200 km): the circle is drawn, never measured.
 */
export function destination(center: Position, bearing: number, metres: number): Position {
  const [lon, lat] = center;
  const phi = (lat * Math.PI) / 180;
  const s = Math.sin(phi);
  const w = 1 - WGS84_E2 * s * s;
  const meridional = (WGS84_A * (1 - WGS84_E2)) / Math.pow(w, 1.5);
  const prime = WGS84_A / Math.sqrt(w);
  const radius = Math.sqrt(meridional * prime);
  const delta = metres / radius;
  const theta = (bearing * Math.PI) / 180;
  const phi2 = Math.asin(Math.sin(phi) * Math.cos(delta) + Math.cos(phi) * Math.sin(delta) * Math.cos(theta));
  const dLambda = Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi), Math.cos(delta) - Math.sin(phi) * Math.sin(phi2));
  let lon2 = lon + (dLambda * 180) / Math.PI;
  while (lon2 > 180) lon2 -= 360;
  while (lon2 < -180) lon2 += 360;
  return [lon2, (phi2 * 180) / Math.PI];
}

/** A closed line round `center`, {@link CIRCLE_POSITIONS} positions, the last equal to the first. */
export function circle(center: Position, metres: number): Position[] {
  const positions: Position[] = [];
  for (let k = 0; k < CIRCLE_POSITIONS - 1; k++) positions.push(destination(center, (360 * k) / (CIRCLE_POSITIONS - 1), metres));
  const first = positions[0];
  if (first !== undefined) positions.push([first[0], first[1]]);
  return positions;
}

/** The range line, its end marks and the label at the middle. */
export function rangeItems(from: Position, to: Position, result: RangeResult): OverlayItem[] {
  return [
    { kind: 'line', positions: [from, to], style: RANGE_STYLE },
    { kind: 'point', position: from, style: RANGE_POINT_STYLE },
    { kind: 'point', position: to, style: RANGE_POINT_STYLE },
    { kind: 'label', position: result.midpoint, text: rangeLabel(result.distance, result.initialBearing), style: { size: 13 } },
  ];
}

/** The lone first point of a pair that is not finished. */
export function pendingItems(from: Position): OverlayItem[] {
  return [{ kind: 'point', position: from, style: RANGE_POINT_STYLE }];
}

/** The visible areas, the observer's point and the range circle. */
export function viewshedItems(observer: Position, maxRange: number, result: ViewshedResult): OverlayItem[] {
  const items: OverlayItem[] = result.areas.map((rings) => ({ kind: 'area', rings, style: VIEWSHED_STYLE }));
  items.push({ kind: 'line', positions: circle(observer, maxRange), style: CIRCLE_STYLE });
  items.push({ kind: 'point', position: observer, style: OBSERVER_STYLE });
  return items;
}

// ---------------------------------------------------------------- the height map (function 10, T-166)

const CROSS_COLOR = '#ffffff';
const CROSS_STYLE: Style = { strokeColor: CROSS_COLOR, strokeWidth: 2 };
const HEIGHT_LABEL_STYLE: OverlayLabelStyle = { color: CROSS_COLOR, haloColor: '#1a1a1a', size: 14 };
const HEIGHT_CIRCLE_STYLE: Style = { strokeColor: '#ffb000', strokeWidth: 1, strokeDash: 'dash' };

/** The bands are filled at half opacity and have no outline (assumption H1). */
const BAND_OPACITY = 0.5;

/**
 * A band's colour: its place in the span, 0 at the lowest band and 1 at the highest, gives a hue from
 * 0 degrees (red) through yellow to 120 degrees (green) at full saturation (H2). A flat circle has
 * one band, whose place is the middle (yellow).
 */
export function bandColor(index: number, count: number): string {
  const place = count <= 1 ? 0.5 : index / (count - 1);
  return hsl(120 * place);
}

/** A hue in degrees at full saturation and half lightness as `#rrggbb`. */
function hsl(hue: number): string {
  const h = hue / 60;
  const x = 1 - Math.abs((h % 2) - 1);
  const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : [0, 1, x];
  const hex = (v: number): string => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function bandStyle(color: string): Style {
  return { fillColor: color, fillOpacity: BAND_OPACITY, strokeColor: color, strokeOpacity: 0, strokeWidth: 0 };
}

/** The cross is this many CSS pixels across (each line), at every zoom (owner, 2026-11-12, RV C). */
export const CROSS_PIXELS = 16;
/** The gap between the cross's top and the label's centre, CSS pixels: room for half the text's height and a little air. */
const LABEL_GAP_PIXELS = 12;

/**
 * Metres on the ground per CSS pixel at a position. The viewport's resolution is at the map's centre; in
 * Web Mercator (EPSG:3857) the scale follows the cosine of the latitude, so a position north or south of
 * the centre is corrected. In another projection the centre's value is used as it is.
 */
export function metresPerPixelAt(viewport: Viewport, position: Position): number {
  if (viewport.projection !== 'EPSG:3857') return viewport.resolution;
  const cosine = (degrees: number): number => Math.max(Math.cos((degrees * Math.PI) / 180), 1e-3);
  return (viewport.resolution * cosine(position[1])) / cosine(viewport.center[1]);
}

/** The cross at the highest point: two lines, one north to south and one west to east, each {@link CROSS_PIXELS} pixels long (H3, RV C). */
export function crossItems(center: Position, metresPerPixel: number): OverlayItem[] {
  const half = (CROSS_PIXELS / 2) * metresPerPixel;
  return [
    { kind: 'line', positions: [destination(center, 0, half), destination(center, 180, half)], style: CROSS_STYLE },
    { kind: 'line', positions: [destination(center, 90, half), destination(center, 270, half)], style: CROSS_STYLE },
  ];
}

/** The bands' areas and the circle's outline. The cross and its label are {@link heightMarkerItems}: their size is in pixels, so they follow the zoom. */
export function heightMapItems(center: Position, radius: number, result: HeightMapResult): OverlayItem[] {
  const items: OverlayItem[] = [];
  for (const band of result.bands) {
    const style = bandStyle(bandColor(band.index, result.bands.length));
    for (const rings of band.areas) items.push({ kind: 'area', rings, style });
  }
  items.push({ kind: 'line', positions: circle(center, radius), style: HEIGHT_CIRCLE_STYLE });
  return items;
}

/** The white cross on the highest ground and, just above it, its label ("412 m"), for the metres per pixel there. */
export function heightMarkerItems(result: HeightMapResult, metresPerPixel: number): OverlayItem[] {
  return [
    ...crossItems(result.highestPosition, metresPerPixel),
    {
      kind: 'label',
      position: destination(result.highestPosition, 0, (CROSS_PIXELS / 2 + LABEL_GAP_PIXELS) * metresPerPixel),
      text: heightLabel(result.highestHeight),
      style: HEIGHT_LABEL_STYLE,
    },
  ];
}
