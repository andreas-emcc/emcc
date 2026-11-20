// Vessel symbols (data model 1.4.0, ADR-0047; brief functions 12 and 13): emc2's own drawing, a
// pointed hull or a round mark, filled by ship-type group and outlined in the identity's colour.
import type { VesselCode, VesselGroup, VesselGroupId } from '@emc2/plugin-sdk';

/** The AIS ship and cargo types' names (ITU-R M.1371, table "Identifiers to be used by ships to report their type"). */
function shipTypeName(code: number): string {
  const tenth = Math.floor(code / 10);
  const digit = code % 10;
  /** The four categories 20, 40, 60, 70, 80 and 90 share: all ships, hazardous A to D, reserved, no further information. */
  const family = (name: string): string =>
    digit === 0 ? name : digit <= 4 ? `${name}, hazardous category ${'ABCD'.charAt(digit - 1)}` : digit <= 8 ? `${name}, reserved` : `${name}, no additional information`;
  if (code === 0) return 'Not available';
  if (code < 20) return 'Reserved';
  if (tenth === 2) return family('Wing in ground');
  if (tenth === 4) return family('High-speed craft');
  if (tenth === 6) return family('Passenger');
  if (tenth === 7) return family('Cargo');
  if (tenth === 8) return family('Tanker');
  if (tenth === 9) return family('Other type');
  const named: Readonly<Record<number, string>> = {
    30: 'Fishing', 31: 'Towing', 32: 'Towing, over 200 m long or 25 m wide', 33: 'Dredging or underwater operations',
    34: 'Diving operations', 35: 'Military operations', 36: 'Sailing', 37: 'Pleasure craft', 38: 'Reserved', 39: 'Reserved',
    50: 'Pilot vessel', 51: 'Search and rescue vessel', 52: 'Tug', 53: 'Port tender', 54: 'Anti-pollution equipment',
    55: 'Law enforcement', 56: 'Local vessel', 57: 'Local vessel', 58: 'Medical transport', 59: 'Noncombatant ship (RR Resolution No. 18)',
  };
  return named[code] ?? 'Reserved';
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** The groups of brief function 13, in its order and colours (a proposal the owner checks in the browser). */
const GROUPS: readonly (readonly [VesselGroupId, string, string, readonly number[]])[] = [
  ['cargo', 'Cargo', '#5A9E3A', range(70, 79)],
  ['tanker', 'Tanker', '#C23B30', range(80, 89)],
  ['passenger', 'Passenger', '#2F6FD0', range(60, 69)],
  ['fishing', 'Fishing', '#E08A2E', [30]],
  ['pleasure', 'Pleasure craft', '#B248B8', [36, 37]],
  ['highSpeed', 'High-speed craft', '#D8B820', range(40, 49)],
  ['tugSpecial', 'Tug and special craft', '#2AA6A6', [...range(31, 35), ...range(50, 59)]],
  ['other', 'Other', '#808080', [...range(1, 29), 38, 39, ...range(90, 99)]],
  ['unknown', 'Unknown', '#D0D0D0', [0]],
];

/** The ship-type groups, frozen: `vesselGroups()` returns this one list every time. */
export const VESSEL_GROUPS: readonly VesselGroup[] = Object.freeze(
  GROUPS.map(([id, label, color, codes]) => Object.freeze({ id, label, color, shipTypes: Object.freeze(codes.map((code) => Object.freeze({ code, name: shipTypeName(code) }))) })),
);

/** The group of each ship type 0 to 99. */
const GROUP_OF: readonly VesselGroup[] = (() => {
  const of: VesselGroup[] = [];
  for (const group of VESSEL_GROUPS) for (const { code } of group.shipTypes) of[code] = group;
  return of;
})();

/** The group of an AIS ship type; outside 0 to 99, `unknown`. */
export function groupOf(shipType: number): VesselGroup {
  return GROUP_OF[shipType] ?? (VESSEL_GROUPS[VESSEL_GROUPS.length - 1] as VesselGroup);
}

/**
 * The outline of each standard identity (digit 2, 0 pending to 6 hostile): the affiliation colours
 * the plugin draws APP-6 frames in (`looks.md`), so that the identity shows (ADR-0047 point 3).
 */
export const IDENTITY_OUTLINES: readonly string[] = ['#ffff80', '#ffff80', '#80e0ff', '#80e0ff', '#aaffaa', '#ff8080', '#ff8080'];

/** The outline's width, in pixels (brief function 12). */
const OUTLINE = 2;

/**
 * The gap between fill and outline, in pixels, in the look's ground colour, so that the identity's
 * pale colours stand out from the fill and the map (owner, LS, 2026-11-08; the brief's fallback).
 */
const GAP = 1;

/** What a vessel image shows, decided before drawing, so that the cache key and the drawing agree. */
export interface VesselLook {
  readonly code: VesselCode;
  /** Whole degrees clockwise from north for a pointed hull; null for the mark. */
  readonly heading: number | null;
  /** The text amplifiers beside the symbol, one per line. */
  readonly texts: readonly string[];
  /** The look's ground colour (`colorGround`), for the gap between fill and outline. */
  readonly ground: string;
}

/** A drawn vessel: the canvas and the hull's centre in it. */
export interface DrawnVessel {
  readonly canvas: HTMLCanvasElement;
  readonly anchor: readonly [number, number];
}

/** The text's size for a symbol size, close to milsymbol's text beside an APP-6 frame. */
function fontOf(size: number): { readonly font: string; readonly px: number } {
  const px = Math.max(8, Math.round(size * 0.4));
  return { font: `${String(px)}px Arial, sans-serif`, px };
}

/**
 * Draws a vessel at `size` pixels.
 * - **Moving** (`heading` set): a hull `size` long and a third of it wide, pointed along the heading;
 *   the image is turned, north up. The square around it fits every heading, so the anchor is fixed.
 * - **Not moving** (`heading` null): a filled circle half the size across.
 * Outside the shape, a 1 px gap in the look's ground colour, then the 2 px outline.
 * Texts stand upright to the right of that square, as APP-6's right-hand fields, centred on it.
 */
export function drawVessel(look: VesselLook, size: number): DrawnVessel {
  const fill = groupOf(look.code.shipType).color;
  const outline = IDENTITY_OUTLINES[look.code.identity] ?? '#ffff80';
  const length = size;
  const beam = size / 3;
  // A hull's corners are at most half its diagonal from the centre; the mark is half the size across.
  const reach = look.heading === null ? size / 4 : Math.hypot(length / 2, beam / 2);
  const box = Math.ceil(2 * reach + 2 * (GAP + OUTLINE));
  const canvas = document.createElement('canvas');
  const text = fontOf(size);
  const lineHeight = Math.round(text.px * 1.2);
  const gap = Math.round(text.px / 3);
  let textWidth = 0;
  if (look.texts.length > 0) {
    const measure = canvas.getContext('2d');
    if (measure !== null) measure.font = text.font;
    for (const line of look.texts) {
      // Without a context, about 0.6 em per character.
      const width = measure === null ? line.length * text.px * 0.6 : measure.measureText(line).width;
      textWidth = Math.max(textWidth, Math.ceil(width));
    }
  }
  canvas.width = box + (textWidth > 0 ? gap + textWidth : 0);
  canvas.height = Math.max(box, look.texts.length * lineHeight);
  const centre: readonly [number, number] = [box / 2, canvas.height / 2];
  const ctx = canvas.getContext('2d');
  if (ctx === null) return { canvas, anchor: centre };
  ctx.save();
  ctx.translate(centre[0], centre[1]);
  ctx.beginPath();
  if (look.heading === null) {
    ctx.arc(0, 0, size / 4, 0, 2 * Math.PI);
  } else {
    // Clockwise from north is clockwise on the canvas, whose y axis points down.
    ctx.rotate((look.heading * Math.PI) / 180);
    ctx.moveTo(0, -length / 2);
    ctx.lineTo(beam / 2, -length / 6);
    ctx.lineTo(beam / 2, length / 2);
    ctx.lineTo(-beam / 2, length / 2);
    ctx.lineTo(-beam / 2, -length / 6);
    ctx.closePath();
  }
  // Outside the shape: the gap, then the outline. A stroke is centred on the path, so the outline is
  // stroked wide, the gap over it, and the fill covers both strokes' inner halves.
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2 * (GAP + OUTLINE);
  ctx.strokeStyle = outline;
  ctx.stroke();
  ctx.lineWidth = 2 * GAP;
  ctx.strokeStyle = look.ground;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
  if (look.texts.length > 0) {
    ctx.font = text.font;
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const top = centre[1] - ((look.texts.length - 1) * lineHeight) / 2;
    look.texts.forEach((line, i) => {
      ctx.fillText(line, box + gap, top + i * lineHeight);
    });
  }
  return { canvas, anchor: centre };
}
