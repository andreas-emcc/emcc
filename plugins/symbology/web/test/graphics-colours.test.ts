// @vitest-environment node
// APP-6 E V2 section 8.1.4, the standard identity colouring of control measures (owner YE B, 2026-11-16).
import { describe, expect, it } from 'vitest';
import type { GraphicRenderRequest, GraphicRendering } from '@emc2/plugin-sdk';
import { RENDERER_VERSIONS, type GraphicStandard } from '../src/graphics/catalogue.ts';
import { CBRN_YELLOW, OBSTACLE_GREEN } from '../src/graphics/colours.ts';
import { createEngine } from '../src/graphics/engine.ts';
import { createSymbolService } from '../src/service.ts';
import { inThreadWorker } from './inThreadWorker.ts';

const engine = createEngine();
const STANDARDS = ['APP-6D', 'APP-6E'] as const;
const BLACK = '#000000';
const RED = '#FF0000';

/** Standard identities (SIDC digit 4): friendly, hostile, and the ones obstacles share their green with. */
const FRIENDLY = ['2', '3'] as const;
const HOSTILE = ['5', '6'] as const;
const EVERY_IDENTITY = ['0', '1', '2', '3', '4', '5', '6'] as const;

/** Sample points round Uppsala, latitude ≠ longitude. */
const POINTS: readonly (readonly [number, number])[] = [
  [17.6, 59.9],
  [17.9, 59.85],
  [17.8, 60.1],
  [17.65, 60.05],
];

const PHASE_LINE = '140300';
const ASSEMBLY_AREA = '150200';
const MINED_AREA = '270800';
const OBSTACLE_LINE = '290100';
const OVERHEAD_WIRE = '282003';
const CHEMICAL_AREA = '271800';

/** The entities of APP-6 E table 8-17, obstacle and obstruction control measures, as the standard lists them. */
const TABLE_8_17 = [
  '270100', '270200', '270300', '270400', '270500', '270501', '270502', '270503', '270504', '270600', '270601', '270602', '270603',
  '270700', '270701', '270707', '270800', '270801', '271000', '271100', '271200', '271201', '271202', '271203', '271204', '271300',
  '271500', '271600', '280100', '280200', '280201', '280300', '280400', '280500', '280600', '280700', '281900', '281901', '281902',
  '281903', '282000', '282001', '282002', '282003', '290100', '290101', '290200', '290201', '290202', '290203', '290300', '290301',
  '290302', '290303', '290304', '290305', '290306', '290307', '290308', '290309', '290400', '290500', '290600', '290700', '290800',
];
/** Its obstacle bypasses: identity colours, as mil-sym-ts draws them (owner, 2026-11-16). */
const BYPASSES = ['270601', '270602', '270603'];
/** The CBRN contaminated areas of table 8-19. */
const CONTAMINATED = ['271700', '271701', '271800', '271801', '271900', '272000', '272001'];
/** The field fortifications of table 8-18 that are graphics: identity colours (owner, 2026-11-16). */
const FORTIFICATIONS = ['290900', '291000'];

function sidc(standard: GraphicStandard, identity: string, entity: string): string {
  return `${String(RENDERER_VERSIONS[standard])}0${identity}250000${entity}0000`;
}

function request(standard: GraphicStandard, identity: string, entity: string): GraphicRenderRequest {
  const entry = engine.catalogue(standard).find((e) => e.symbolSet === '25' && e.entity === entity);
  if (entry === undefined) throw new Error(`${standard} has no graphic ${entity}`);
  return {
    standard,
    sidc: sidc(standard, identity, entity),
    points: POINTS.slice(0, Math.max(entry.minPoints, 2)),
    modifiers: { uniqueDesignation: 'T', distances: [3000, 6000], azimuths: [10, 80] },
    resolution: 13,
    extent: [17, 59, 19, 61],
  };
}

function drawn(r: GraphicRendering) {
  if (!r.ok) throw new Error(r.reason);
  return r;
}

/** Every colour a drawing uses, for its lines, fills and texts. */
function colours(r: GraphicRendering): Set<string> {
  const d = drawn(r);
  return new Set([...d.lines.map((l) => l.color), ...d.fills.map((f) => f.color), ...d.labels.map((l) => l.color)]);
}

const render = (standard: GraphicStandard, identity: string, entity: string) => engine.render(request(standard, identity, entity)).rendering;

/** The entities of a list that the standard's catalogue has. */
const inCatalogue = (standard: GraphicStandard, entities: readonly string[]) =>
  entities.filter((entity) => engine.catalogue(standard).some((e) => e.symbolSet === '25' && e.entity === entity));

describe.each(STANDARDS)('APP-6 E 8.1.4 in %s', (standard) => {
  it.each(FRIENDLY)('rule 1: a friendly (identity %s) line and area are black', (identity) => {
    expect(colours(render(standard, identity, PHASE_LINE))).toEqual(new Set([BLACK]));
    expect(colours(render(standard, identity, ASSEMBLY_AREA))).toEqual(new Set([BLACK]));
  });

  it.each(HOSTILE)('rule 2: a hostile (identity %s) line and area are red', (identity) => {
    expect(colours(render(standard, identity, PHASE_LINE))).toEqual(new Set([RED]));
    expect(colours(render(standard, identity, ASSEMBLY_AREA))).toEqual(new Set([RED]));
  });

  it.each(EVERY_IDENTITY)('rule 3: a minefield, an obstacle line and an overhead wire are green for identity %s', (identity) => {
    for (const entity of [MINED_AREA, OBSTACLE_LINE, OVERHEAD_WIRE]) expect(colours(render(standard, identity, entity)), entity).toEqual(new Set([OBSTACLE_GREEN]));
  });

  it("rule 3: every graphic of table 8-17 is green for a friend and a foe, the bypasses apart; the minefields' icons too", () => {
    const green = inCatalogue(standard, TABLE_8_17).filter((e) => !BYPASSES.includes(e));
    // The others of the table are point symbols, not graphics.
    expect(green.length).toBeGreaterThan(35);
    for (const entity of green) {
      for (const identity of ['3', '6']) {
        const r = drawn(render(standard, identity, entity));
        expect(colours(r), `${entity} identity ${identity}`).toEqual(new Set([OBSTACLE_GREEN]));
        for (const image of r.images ?? []) {
          const svg = Buffer.from(image.svg.split(',')[1] ?? '', 'base64').toString();
          // Only the icon's own strokes and fills: the black on its group is overridden by each shape's.
          const own = [...svg.matchAll(/<(?:path|circle|polygon|line|rect|ellipse)\b[^>]*?(?:fill|stroke)="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1]?.toUpperCase());
          expect(new Set(own), `${entity} icon`).toEqual(new Set([OBSTACLE_GREEN]));
        }
      }
    }
  });

  it('rule 3, owner: the obstacle bypasses and the field fortifications keep the identity colours', () => {
    for (const entity of [...inCatalogue(standard, BYPASSES), ...inCatalogue(standard, FORTIFICATIONS)]) {
      expect(colours(render(standard, '3', entity)), entity).toEqual(new Set([BLACK]));
      expect(colours(render(standard, '6', entity)), entity).toEqual(new Set([RED]));
    }
  });

  it.each(EVERY_IDENTITY)('rule 4: every CBRN contaminated area is hatched in yellow for identity %s', (identity) => {
    for (const entity of inCatalogue(standard, CONTAMINATED)) {
      const hatches = drawn(render(standard, identity, entity)).fills.filter((f) => f.pattern === 'hatch');
      expect(hatches.length, entity).toBeGreaterThan(0);
      for (const hatch of hatches) expect(hatch.color, entity).toBe(CBRN_YELLOW);
    }
  });

  it("rule 4: only the hatching turns yellow: a contaminated area's outline keeps the identity colour", () => {
    expect(new Set(drawn(render(standard, '3', CHEMICAL_AREA)).lines.map((l) => l.color))).toEqual(new Set([BLACK]));
    expect(new Set(drawn(render(standard, '6', CHEMICAL_AREA)).lines.map((l) => l.color))).toEqual(new Set([RED]));
  });

  it('changes nothing but colours: the positions, widths and dashes are the renderer\'s', () => {
    const r = drawn(render(standard, '6', OVERHEAD_WIRE));
    expect(r.lines.length).toBeGreaterThan(0);
    for (const line of r.lines) {
      expect(line.coordinates).toBeInstanceOf(Float64Array);
      expect(line.width).toBeGreaterThan(0);
    }
  });
});

describe('in every look', () => {
  /** The ground colour of each look and scheme (web/shell/src/tokens.css), the one look input the service has. */
  const GROUNDS = {
    'night-watch dark': '#070e0e',
    'night-watch light': '#e4ebe9',
    'chart-room dark': '#091016',
    'chart-room light': '#eeece3',
    'signal dark': '#000000',
    'signal light': '#f1f1ee',
  } as const;

  const CASES = [
    ['hostile line', '6', PHASE_LINE, [RED]],
    ['hostile area', '6', ASSEMBLY_AREA, [RED]],
    ['friendly line', '3', PHASE_LINE, [BLACK]],
    ['friendly minefield', '3', MINED_AREA, [OBSTACLE_GREEN]],
    ['hostile minefield', '6', MINED_AREA, [OBSTACLE_GREEN]],
    ['hostile CBRN area', '6', CHEMICAL_AREA, [RED, CBRN_YELLOW]],
  ] as const;

  it.each(Object.entries(GROUNDS))('%s: the service draws the same colours', async (_look, ground) => {
    const { service } = createSymbolService({ cacheSize: 10, ground: () => ground, createWorker: inThreadWorker, schedule: (run) => { queueMicrotask(run); } });
    for (const standard of STANDARDS) {
      for (const [name, identity, entity, expected] of CASES) {
        expect(colours(await service.renderGraphic(request(standard, identity, entity))), `${standard} ${name}`).toEqual(new Set(expected));
      }
    }
  });
});
