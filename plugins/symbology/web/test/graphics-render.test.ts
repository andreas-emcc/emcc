// @vitest-environment node
// mil-sym-ts runs in Node; jsdom's canvas without a context would get in its way.
import { describe, expect, it } from 'vitest';
import type { GraphicRenderRequest, GraphicRendering } from '@emc2/plugin-sdk';
import { createEngine } from '../src/graphics/engine.ts';
import { parse, type RendererCall } from '../src/graphics/render.ts';
import { createSymbolService } from '../src/service.ts';
import { exampleGraphics } from './examples.ts';

const engine = createEngine();

/** A view round the points: their box widened by `margin` degrees, at about 13 m per pixel (1:50 000). */
function around(points: readonly (readonly [number, number])[], margin = 0.2): Pick<GraphicRenderRequest, 'extent' | 'resolution'> {
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return { extent: [Math.min(...lons) - margin, Math.min(...lats) - margin, Math.max(...lons) + margin, Math.max(...lats) + margin], resolution: 13 };
}

function render(request: GraphicRenderRequest): GraphicRendering {
  return engine.render(request).rendering;
}

const PHASE_LINE = '10032500001403000000';
const AXIS_OF_ADVANCE = '10032500001514010000';
const RANGE_FAN = '10032500002422000000';

describe('criterion 11: drawing and coordinate order', () => {
  const examples = exampleGraphics();

  it('the model has the boundaries, the axis of advance and the range fan as examples', () => {
    expect(examples.map((e) => e.file)).toEqual(
      expect.arrayContaining(['object-multipoint-boundary.json', 'object-multipoint-boundary-two-units.json', 'object-multipoint-axis-of-advance-with-amplifiers.json', 'object-multipoint-range-fan-sector.json']),
    );
  });

  it.each(exampleGraphics().map((e) => [e.file, e] as const))('%s draws with ok: true for a view round it', (_file, example) => {
    if (example.symbol.standard === 'APP-6B' || example.symbol.standard === 'vessel') throw new Error(`no ${example.symbol.standard} graphics`);
    const r = render({ standard: example.symbol.standard, sidc: example.symbol.sidc, points: example.points, ...(example.symbol.modifiers === undefined ? {} : { modifiers: example.symbol.modifiers }), ...around(example.points) });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.lines.length).toBeGreaterThan(0);
  });

  it('a phase line from (17.60, 59.90) to (17.85, 59.86) stays within its points widened by 0.1°: longitude and latitude are not swapped', () => {
    const points = [
      [17.6, 59.9],
      [17.85, 59.86],
    ] as const;
    const r = render({ standard: 'APP-6D', sidc: PHASE_LINE, points, modifiers: { uniqueDesignation: 'A' }, ...around(points) });
    if (!r.ok) throw new Error(r.reason);
    const positions = [...r.lines.flatMap((l) => [...pairs(l.coordinates)]), ...r.labels.map((l) => l.position)];
    expect(positions.length).toBeGreaterThan(2);
    for (const [lon, lat] of positions) {
      expect(lon).toBeGreaterThanOrEqual(17.5);
      expect(lon).toBeLessThanOrEqual(17.95);
      expect(lat).toBeGreaterThanOrEqual(59.76);
      expect(lat).toBeLessThanOrEqual(60.0);
    }
    expect(r.labels.map((l) => l.text)).toContain('PL A');
  });

  it('hands over flat Float64Arrays, each with its own buffer to transfer, and APP-6 colours as #RRGGBB', () => {
    const points = [
      [17.6, 59.9],
      [17.9, 59.85],
      [17.8, 60.1],
    ] as const;
    const parsed = engine.render({ standard: 'APP-6D', sidc: '10032500002403010000', points, modifiers: { uniqueDesignation: 'NFA 1' }, ...around(points) });
    const r = parsed.rendering;
    if (!r.ok) throw new Error(r.reason);
    const arrays = [...r.lines.map((l) => l.coordinates), ...r.fills.flatMap((f) => f.rings)];
    expect(arrays.every((a) => a instanceof Float64Array && a.length % 2 === 0)).toBe(true);
    expect(new Set(parsed.transfer).size).toBe(parsed.transfer.length);
    expect(new Set(arrays.map((a) => a.buffer)).size).toBe(arrays.length);
    expect(r.fills.some((f) => f.pattern === 'hatch')).toBe(true);
    for (const c of [...r.lines.map((l) => l.color), ...r.fills.map((f) => f.color), ...r.labels.map((l) => l.color)]) expect(c).toMatch(/^#[0-9A-F]{6}$/);
    for (const l of r.labels) expect(l.font).toMatch(/^\w+ \d+px /);
  });

  it('a hostile graphic is drawn red, a friendly one black: APP-6 colours, the same in every look', () => {
    const points = [
      [17.6, 59.9],
      [17.85, 59.86],
    ] as const;
    const colours = (sidc: string) => {
      const r = render({ standard: 'APP-6D', sidc, points, ...around(points) });
      return r.ok ? new Set(r.lines.map((l) => l.color)) : null;
    };
    expect(colours(PHASE_LINE)).toEqual(new Set(['#000000']));
    expect(colours('10062500001403000000')).toEqual(new Set(['#FF0000']));
  });
});

describe('criterion 12: versions', () => {
  function spied(sidc: string, standard: 'APP-6D' | 'APP-6E'): string {
    const calls: RendererCall[] = [];
    const spy = createEngine((call) => {
      calls.push(call);
      return '{"type":"FeatureCollection","features":[]}';
    });
    const request = { standard, sidc, points: [[17.6, 59.9], [17.85, 59.86]] as const, resolution: 13, extent: [17, 59, 19, 61] as const };
    expect(spy.render(request).rendering).toMatchObject({ ok: true });
    expect(request.sidc).toBe(sidc);
    return calls[0]?.sidc ?? '';
  }

  it.each(['10', '11', '12'])('APP-6D with version %s reaches mil-sym-ts as 10; the request keeps its SIDC', (version) => {
    expect(spied(`${version}032500001403000000`, 'APP-6D')).toBe('10032500001403000000');
  });

  it.each(['13', '14'])('APP-6E with version %s reaches mil-sym-ts as 16', (version) => {
    expect(spied(`${version}032500001403000000`, 'APP-6E')).toBe('16032500001403000000');
  });

  it('the scale is the resolution at 96 dots per inch, the bounding box the extent, the amplifiers in mil-sym-ts keys', () => {
    const calls: RendererCall[] = [];
    const spy = createEngine((call) => {
      calls.push(call);
      return '{"type":"FeatureCollection","features":[]}';
    });
    spy.render({ standard: 'APP-6D', sidc: RANGE_FAN, points: [[18.07, 59.33]], modifiers: { distances: [500, 3000], azimuths: [315, 45, 320, 40], altitudeDepth: 'GL', speed: 3 }, resolution: 10, extent: [17, 59, 19, 61] });
    const call = calls[0];
    expect(call?.scale).toBeCloseTo(10 / 0.0254 * 96, 6);
    expect(call?.bbox).toBe('17,59,19,61');
    expect(call?.points).toBe('18.07,59.33');
    expect(Object.fromEntries(call?.modifiers ?? [])).toEqual({ AM_DISTANCE: '500,3000', AN_AZIMUTH: '315,45,320,40', X_ALTITUDE_DEPTH: 'GL' });
  });

  it('across the antimeridian (west > east) mil-sym-ts gets no bounding box', () => {
    const calls: RendererCall[] = [];
    const spy = createEngine((call) => {
      calls.push(call);
      return '{"type":"FeatureCollection","features":[]}';
    });
    spy.render({ standard: 'APP-6D', sidc: PHASE_LINE, points: [[179.5, 60], [-179.5, 60.2]], resolution: 100, extent: [170, 55, -170, 65] });
    expect(calls[0]?.bbox).toBe('');
  });
});

describe('criterion 13: refusals', () => {
  const axisPoints = [
    [17.9, 59.41],
    [17.82, 59.36],
  ] as const;
  const view = { resolution: 13, extent: [17, 59, 19, 61] as const };

  it.each([
    ['a range fan without distances', { standard: 'APP-6D', sidc: RANGE_FAN, points: [[18.07, 59.33]], modifiers: { azimuths: [315, 45] }, ...view }, /distances/],
    ['an axis of advance with two points', { standard: 'APP-6D', sidc: AXIS_OF_ADVANCE, points: axisPoints, ...view }, /3 to 50 points, not 2/],
    ['a code outside the catalogue (a point symbol)', { standard: 'APP-6D', sidc: '10031000001211000000', points: axisPoints, ...view }, /not a tactical graphic/],
    ['an extent of zero width', { standard: 'APP-6D', sidc: PHASE_LINE, points: axisPoints, resolution: 13, extent: [17.5, 59, 17.5, 61] }, /view is empty/],
    ['a SIDC of the wrong length', { standard: 'APP-6D', sidc: '1003250000140200', points: axisPoints, ...view }, /not a APP-6D SIDC/],
  ] as const)('%s resolves with ok: false and a reason', (_what, request, reason) => {
    const r = render(request);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(reason);
  });

  it('an APP-6B graphic resolves with ok: false, without starting the renderer', async () => {
    let started = 0;
    const { service } = createSymbolService({
      cacheSize: 10,
      createWorker: () => {
        started++;
        throw new Error('no worker');
      },
    });
    const r = await service.renderGraphic({ standard: 'APP-6B' as 'APP-6D', sidc: 'GFGPGLB----K---', points: axisPoints, ...view });
    expect(r).toEqual({ ok: false, reason: 'APP-6B has no tactical graphics' });
    expect(await service.graphicCatalog('APP-6B' as 'APP-6D')).toEqual([]);
    expect(started).toBe(0);
  });

  it("mil-sym-ts's error object, NaN and a failing renderer become refusals, never exceptions", () => {
    expect(parse('{"type":"error","error":"Basic ID: 25241200 has no draw rule"}').rendering).toEqual({ ok: false, reason: 'Basic ID: 25241200 has no draw rule' });
    expect(parse('{"type":"FeatureCollection","features":[{"geometry":{"type":"LineString","coordinates":[[NaN,NaN]]}}]}').rendering).toMatchObject({ ok: false, reason: expect.stringMatching(/NaN/) as unknown });
    const failing = createEngine(() => {
      throw new Error('boom');
    });
    expect(failing.render({ standard: 'APP-6D', sidc: PHASE_LINE, points: axisPoints, ...view }).rendering).toEqual({ ok: false, reason: 'the renderer failed: boom' });
  });

  it('a view outside the graphic draws nothing, which is not a refusal', () => {
    const r = render({ standard: 'APP-6D', sidc: PHASE_LINE, points: axisPoints, resolution: 13, extent: [10, 50, 11, 51] });
    expect(r).toMatchObject({ ok: true });
  });
});

function* pairs(flat: Float64Array): Generator<readonly [number, number]> {
  for (let i = 0; i + 1 < flat.length; i += 2) yield [flat[i] ?? NaN, flat[i + 1] ?? NaN];
}
