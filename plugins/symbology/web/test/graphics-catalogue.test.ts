// @vitest-environment node
// mil-sym-ts runs in Node; jsdom's canvas without a context would get in its way.
import { describe, expect, it } from 'vitest';
import type { GraphicCatalogEntry } from '@emc2/plugin-sdk';
import { AMPLIFIERS, DRAWS_NOTHING, RENDERER_VERSIONS, type GraphicStandard, type LookupEntry } from '../src/graphics/catalogue.ts';
import { DRAW_RULES } from '../src/graphics/drawRules.ts';
import { callRenderer, createEngine, lookupEntries } from '../src/graphics/engine.ts';
import { prepare, byKey } from '../src/graphics/render.ts';

const STANDARDS = ['APP-6D', 'APP-6E'] as const;
const engine = createEngine();

/** The lookup's graphics drawn from points: geometry Line or Area. */
function lookupGraphics(standard: GraphicStandard): LookupEntry[] {
  return [...lookupEntries(RENDERER_VERSIONS[standard])].filter((e) => /^(line|area)$/i.test(e.geometry));
}

/** Sample points round Uppsala, latitude ≠ longitude; enough for any graphic's least count. */
const SAMPLE: readonly (readonly [number, number])[] = [
  [17.6, 59.9],
  [17.9, 59.85],
  [17.8, 60.1],
  [17.65, 60.05],
  [17.7, 59.95],
  [17.75, 60.0],
];

const SAMPLE_MODIFIERS = { distances: [3000, 6000], azimuths: [10, 80], uniqueDesignation: 'T' };

function sidcOf(entry: GraphicCatalogEntry, version = String(RENDERER_VERSIONS[entry.standard])): string {
  return `${version}03${entry.symbolSet}0000${entry.entity}0000`;
}

function drawn(entry: GraphicCatalogEntry, modifiers: object, points = SAMPLE.slice(0, Math.max(entry.minPoints, 1))) {
  return engine.render({ standard: entry.standard, sidc: sidcOf(entry), points, modifiers, resolution: 13, extent: [17, 59, 19, 61] }).rendering;
}

describe('criterion 10: the catalogue', () => {
  it.each(STANDARDS)('%s lists exactly the graphics of the lookup with a Line or Area geometry, but those that draw nothing', (standard) => {
    const lookup = lookupGraphics(standard).filter((e) => !DRAWS_NOTHING[standard].includes(e.basicId));
    const catalogue = engine.catalogue(standard);
    expect(catalogue.length).toBe(lookup.length);
    expect(catalogue.length).toBeGreaterThan(300);
    for (const [i, entry] of catalogue.entries()) {
      const source = lookup[i];
      if (source === undefined) throw new Error('lookup shorter than the catalogue');
      expect(entry.standard).toBe(standard);
      expect(entry.symbolSet + entry.entity).toBe(source.basicId);
      expect(entry.name).toBe(source.name);
      expect(entry.minPoints).toBe(source.minPoints);
      expect(entry.maxPoints).toBe(source.maxPoints === Number.MAX_VALUE ? null : source.maxPoints);
      expect(entry.echelon).toBe(source.modifiers.includes('B_ECHELON'));
      for (const key of source.modifiers.filter((k) => k !== 'B_ECHELON')) {
        const name = AMPLIFIERS[key];
        expect(name, `${source.basicId}: no model name for ${key}`).toBeDefined();
        expect(entry.allowedModifiers).toContain(name);
      }
    }
  });

  it.each(STANDARDS)('%s: every Line or Area graphic of the lookup has a draw rule in DRAW_RULES (none is left out silently)', (standard) => {
    const missing = lookupGraphics(standard).filter((e) => DRAW_RULES[e.drawRule] === undefined).map((e) => `${e.basicId} ${e.drawRule}`);
    expect(missing).toEqual([]);
  });

  it('every draw rule of DRAW_RULES is used by a graphic', () => {
    const used = new Set(STANDARDS.flatMap((s) => lookupGraphics(s).map((e) => e.drawRule)));
    expect(Object.keys(DRAW_RULES).filter((rule) => !used.has(rule))).toEqual([]);
  });

  it.each(STANDARDS)('%s: every entry has points, a kind and a geometry by function 8, and its required amplifiers among the allowed ones', (standard) => {
    for (const entry of engine.catalogue(standard)) {
      const where = `${entry.symbolSet} ${entry.entity} ${entry.name}`;
      expect(entry.points.length, where).toBeGreaterThan(0);
      expect(entry.points.every((p) => p.trim() !== ''), where).toBe(true);
      if (entry.maxPoints !== null) expect(entry.points.length, where).toBeLessThanOrEqual(Math.max(entry.maxPoints, 1));
      expect(entry.path.length, where).toBeGreaterThan(0);
      expect(entry.path.every((p) => p !== '' && p === p.trim()), where).toBe(true);
      expect(entry.requiredModifiers.every((m) => entry.allowedModifiers.includes(m)), where).toBe(true);
      if (entry.kind === 'points') {
        expect(entry.maxPoints, where).toBe(1);
        expect(entry.geometry, where).toBe('MultiPoint');
      } else {
        expect(entry.geometry, where).not.toBe('MultiPoint');
      }
      if (entry.geometry === 'Polygon') expect(entry.kind, where).toBe('area');
      if (entry.kind === 'arrow') expect(entry.points[entry.points.length - 1], where).toMatch(/width/);
    }
  });

  it('builds the example of the SDK: Main Attack is an arrow with a width point', () => {
    const main = engine.catalogue('APP-6D').find((e) => e.entity === '151401');
    expect(main).toMatchObject({ kind: 'arrow', geometry: 'LineString', minPoints: 3, maxPoints: 50, points: ['the tip of the arrow', 'the axis, from the tip back to the tail', 'the width of the arrowhead'] });
    const boundary = engine.catalogue('APP-6D').find((e) => e.entity === '110100');
    expect(boundary).toMatchObject({ name: 'Boundary', kind: 'line', geometry: 'LineString', maxPoints: null, echelon: true });
    expect(boundary?.allowedModifiers).toEqual(['uniqueDesignation', 'uniqueDesignation1', 'country']);
  });

  it.each(STANDARDS)('%s: every entry draws with ok: true from its least points and the sample amplifiers', (standard) => {
    const failed = engine.catalogue(standard).flatMap((entry) => {
      const r = drawn(entry, SAMPLE_MODIFIERS);
      return r.ok && r.lines.length > 0 ? [] : [`${entry.entity} ${entry.name}: ${r.ok ? 'no lines' : r.reason}`];
    });
    expect(failed).toEqual([]);
  });

  it.each(STANDARDS)('%s: a graphic with required amplifiers draws no line in mil-sym-ts without them (so the catalogue refuses it first)', (standard) => {
    const keyed = byKey(engine.catalogue(standard));
    for (const entry of engine.catalogue(standard).filter((e) => e.requiredModifiers.length > 0)) {
      const points = SAMPLE.slice(0, Math.max(entry.minPoints, 1));
      const request = { standard, sidc: sidcOf(entry), points, resolution: 13, extent: [17, 59, 19, 61] as const };
      const call = prepare({ ...request, modifiers: SAMPLE_MODIFIERS }, () => keyed);
      if ('ok' in call) throw new Error(call.reason);
      const without = new Map([...call.modifiers].filter(([key]) => !['AM_DISTANCE', 'AN_AZIMUTH'].includes(key)));
      const text = callRenderer({ ...call, modifiers: without });
      const json = JSON.parse(text) as { type: string; features?: { geometry: { type: string }; properties: Record<string, unknown> }[] };
      const lines = json.features?.filter((f) => f.geometry.type !== 'Point' && f.properties['strokeColor'] !== undefined) ?? [];
      expect(lines.length, `${entry.entity} ${entry.name}`).toBe(0);
    }
  });

  it.each(STANDARDS)('%s: DRAWS_NOTHING still draws nothing, with any amplifiers (a newer mil-sym-ts would show here)', (standard) => {
    for (const basicId of DRAWS_NOTHING[standard]) {
      const sidc = `${String(RENDERER_VERSIONS[standard])}03${basicId.slice(0, 2)}0000${basicId.slice(2)}0000`;
      for (const am of ['3000', '3000,6000']) {
        const text = callRenderer({ sidc, points: '17.6,59.9', scale: 50000, bbox: '', modifiers: new Map([['AM_DISTANCE', am]]) });
        const json = JSON.parse(text) as { features?: { properties: Record<string, unknown> }[] };
        expect(json.features?.some((f) => f.properties['strokeColor'] !== undefined) ?? false).toBe(false);
      }
    }
  });
});
