/**
 * The speed vector of a symbol (brief functions 35 and 38; ADR-0046; owner, Q13, 2026-11-07): with the user's
 * `speedVectorSeconds` above 0, a line from the symbol's position along its `direction`, as long as the
 * geodesic distance `speed` × seconds metres, in black (owner, LB, 2026-11-08). It is drawn
 * as a line of its own, under the symbols, that is never picked (a line item with `aux`).
 */
import type { DisplaySettings, Position } from '@emc2/plugin-sdk';
import { movementOf, type DrawItem } from './drawData.ts';
import { densifyPath, destination, unwrapLongitude } from './geodesic.ts';

/**
 * The speed vector's colour: black for every identity (owner, LB, 2026-11-08), not the frame colour.
 */
export const VECTOR_COLOUR = '#000000';

/** The vector's width in screen pixels. */
export const VECTOR_WIDTH = 2;

/**
 * The speed vector's length in seconds of travel (brief function 38): the shell's `speedVectorSeconds`, which its
 * `resolveDisplay` always fills. The shell has turned a stored length into the nearest step, so nothing is rounded
 * here, and the deprecated `speedVectorMinutes` is not read.
 */
export function speedVectorSecondsOf(display: DisplaySettings): number {
  return display.speedVectorSeconds;
}

/**
 * The speed vector of a symbol item as a line item (id `<id>#vector`); null without one: no seconds, a
 * speed that is not above 0, or no direction. Its longitudes continue past ±180° where the line crosses
 * the antimeridian, and the engine draws it short there, as it draws a shape.
 */
export function speedVectorItem(item: Extract<DrawItem, { kind: 'symbol' }>, seconds: number): DrawItem | null {
  const speed = item.speed;
  const direction = movementOf(item.symbol); // not `item.direction`, which is the arrow's and is null for a vessel
  if (!(seconds > 0) || speed === undefined || !(speed > 0) || direction === null) return null;
  const metres = speed * seconds;
  if (!Number.isFinite(metres)) return null;
  const end = destination(item.position, direction, metres);
  const tip: Position = [unwrapLongitude(end[0], item.position[0]), end[1]];
  return {
    id: `${item.id}#vector`,
    layerId: item.layerId,
    kind: 'line',
    positions: densifyPath([item.position, tip]),
    style: { strokeColor: VECTOR_COLOUR, strokeWidth: VECTOR_WIDTH },
    aux: true,
    ...(item.faded === true ? { faded: true } : {}),
    ...(item.opacity === undefined ? {} : { opacity: item.opacity }),
  };
}
