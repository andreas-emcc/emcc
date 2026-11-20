// Runs in the graphics worker (and in Node for tests): APP-6 E V2 section 8.1.4, the standard identity
// colouring of control measures, where mil-sym-ts's own colours differ (owner YE B, 2026-11-16).
// Only type imports from the SDK: a module worker has no import map.
import type { GraphicRendering } from '@emc2/plugin-sdk';

/** Obstacles and obstructions are green whatever their identity (8.1.4.3): mil-sym-ts's own green. */
export const OBSTACLE_GREEN = '#00FF00';
/** The hatching of CBRN contaminated areas is yellow (8.1.4.4): mil-sym-ts's own yellow. */
export const CBRN_YELLOW = '#FFFF00';

/**
 * The entities of APP-6 E table 8-17, obstacle and obstruction control measures (2700–2716, 2800–2807,
 * 2819–2820, 2900–2908), but not its obstacle bypasses (2706), which keep the identity colours, as do
 * the field fortifications of table 8-18 (owner, 2026-11-16). mil-sym-ts draws most of these green
 * already; it draws the crossings (2711, 2713, 2715, 2716, 2906–2908) and the overhead wire (2820) in
 * the identity colours, or purple.
 */
const OBSTACLES = /^(?:27(?:0[0-57-9]|1[0-6])|280[0-7]|28(?:19|20)|290[0-8])/;
/** The CBRN contaminated areas of table 8-19: biological, chemical, nuclear and radiological (2717–2720). */
const CONTAMINATED = /^27(?:1[7-9]|20)/;

/** Which rule of 8.1.4 changes mil-sym-ts's colours for a SIDC: symbol set 25, by its entity. */
export function colourRule(sidc: string): 'obstacle' | 'contaminated' | null {
  if (sidc.slice(4, 6) !== '25') return null;
  const entity = sidc.slice(10, 16);
  return OBSTACLES.test(entity) ? 'obstacle' : CONTAMINATED.test(entity) ? 'contaminated' : null;
}

/**
 * A drawing in APP-6 E's colours: an obstacle's lines, fills and texts green, a contaminated area's
 * hatching yellow (its outline and icon keep the identity colour). Only colours change: the arrays
 * are the same, so they are still transferred. Labels keep their halo; images are the renderer's
 * (a minefield's icons are green already).
 */
export function withApp6Colours(rendering: GraphicRendering, sidc: string): GraphicRendering {
  const rule = colourRule(sidc);
  if (!rendering.ok || rule === null) return rendering;
  if (rule === 'contaminated') return { ...rendering, fills: rendering.fills.map((f) => (f.pattern === 'hatch' ? { ...f, color: CBRN_YELLOW } : f)) };
  return {
    ...rendering,
    lines: rendering.lines.map((l) => ({ ...l, color: OBSTACLE_GREEN })),
    fills: rendering.fills.map((f) => ({ ...f, color: OBSTACLE_GREEN })),
    labels: rendering.labels.map((l) => ({ ...l, color: OBSTACLE_GREEN })),
  };
}
