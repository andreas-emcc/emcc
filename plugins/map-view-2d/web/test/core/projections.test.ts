import { describe, expect, it } from 'vitest';
import { normalizeLongitude, registerProjections, type Projection } from '../../src/core/projections.ts';
import { DEFAULT_SETTINGS } from '../../src/core/settings.ts';
import { textbook } from '../fixtures.ts';

function projection(code: string): Projection {
  const found = registerProjections(DEFAULT_SETTINGS.projections).projections.find((p) => p.def.code === code);
  if (found === undefined) throw new Error(`${code} not registered`);
  return found;
}

describe('projections', () => {
  it('registers the default projections without problems', () => {
    const { projections, problems } = registerProjections(DEFAULT_SETTINGS.projections);
    expect(problems).toEqual([]);
    expect(projections.map((p) => p.def.code)).toEqual(['EPSG:3857', 'EPSG:3413', 'EPSG:3031']);
  });

  it('criterion 3: 15° E 60° N lands where it belongs in EPSG:3857 and converts back', () => {
    const mercator = projection('EPSG:3857');
    const xy = mercator.forward([15, 60]);
    expect(xy?.[0]).toBeCloseTo((15 * Math.PI * 6378137) / 180, 3);
    expect(xy?.[1]).toBeCloseTo(6378137 * Math.log(Math.tan(Math.PI / 4 + Math.PI / 6)), 3);
    const back = mercator.inverse(xy ?? [0, 0]);
    expect(back?.[0]).toBeCloseTo(15, 9);
    expect(back?.[1]).toBeCloseTo(60, 9);
  });

  it('criterion 3: 15° E 60° N lands where it belongs in EPSG:3413 and converts back', () => {
    const polar = projection('EPSG:3413');
    const xy = polar.forward([15, 60]);
    if (xy === null) throw new Error('not projected');
    // Central meridian −45°: 15° E is 60° east of it, so x/−y = tan 60° (north polar stereographic).
    expect(xy[0]).toBeGreaterThan(0);
    expect(xy[1]).toBeLessThan(0);
    expect(xy[0] / -xy[1]).toBeCloseTo(Math.tan(Math.PI / 3), 9);
    const back = polar.inverse(xy);
    expect(back?.[0]).toBeCloseTo(15, 9);
    expect(back?.[1]).toBeCloseTo(60, 9);
  });

  it('criterion 3 and 17: 15° E 75° S lands where the textbook formula puts it in EPSG:3031 and converts back', () => {
    const south = projection('EPSG:3031');
    const xy = south.forward([15, -75]);
    if (xy === null) throw new Error('not projected');
    const [ex, ey] = textbook.polarStereographic3031(15, -75);
    expect(xy[0]).toBeCloseTo(ex, 3);
    expect(xy[1]).toBeCloseTo(ey, 3);
    expect(xy[1]).toBeGreaterThan(0); // the Greenwich meridian points up in EPSG:3031
    const back = south.inverse(xy);
    expect(back?.[0]).toBeCloseTo(15, 9);
    expect(back?.[1]).toBeCloseTo(-75, 9);
    expect(south.wrapsX).toBe(false);
    expect(south.isValid([15, -75])).toBe(true);
    expect(south.isValid([15, 75])).toBe(false);
  });

  it('puts the central meridian of EPSG:3413 (−45°) on the negative y axis (axis order)', () => {
    const xy = projection('EPSG:3413').forward([-45, 70]);
    expect(xy?.[0]).toBeCloseTo(0, 6);
    expect(xy?.[1]).toBeLessThan(0);
  });

  it('knows where each projection is valid (world extent)', () => {
    const polar = projection('EPSG:3413');
    expect(polar.isValid([15, 60])).toBe(true);
    expect(polar.isValid([60, 15])).toBe(false);
  });

  it('reports a definition proj4 cannot use and keeps the others', () => {
    const [mercator] = DEFAULT_SETTINGS.projections;
    if (mercator === undefined) throw new Error('no default');
    const { projections, problems } = registerProjections([mercator, { ...mercator, code: 'TEST:BROKEN', proj4: '+proj=nonsense' }]);
    expect(projections.map((p) => p.def.code)).toEqual(['EPSG:3857']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('TEST:BROKEN');
  });

  it('normalizes longitudes to [-180, 180]', () => {
    expect(normalizeLongitude(190)).toBe(-170);
    expect(normalizeLongitude(-190)).toBe(170);
    expect(normalizeLongitude(540)).toBe(180);
    expect(normalizeLongitude(15)).toBe(15);
  });
});

describe('sideways repetition', () => {
  it('knows that EPSG:3857 repeats sideways and EPSG:3413 does not', () => {
    expect(projection('EPSG:3857').wrapsX).toBe(true);
    expect(projection('EPSG:3413').wrapsX).toBe(false);
  });
});
