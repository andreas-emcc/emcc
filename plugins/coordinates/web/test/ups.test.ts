import { describe, expect, it } from 'vitest';
import type { CoordinateService, Position } from '@emc2/plugin-sdk';
import { createCoordinateService } from '../src/service.ts';
import { DEFAULTS } from '../src/settings.ts';
import { sharedState } from '../src/state.ts';
import { polarSquare } from '../src/polarMgrs.ts';
import { UPS_ORIGIN, UTM_NORTH_LIMIT, UTM_SOUTH_LIMIT, fromUps, toUps, type UpsLetter } from '../src/utm.ts';
import { POLAR_EDGES, POLAR_REFERENCE_POINTS } from './polar-reference-points.ts';

const coordinates: CoordinateService = createCoordinateService(sharedState(DEFAULTS), { load: () => null, save: () => undefined });

/**
 * Distance in metres; an equirectangular approximation, which holds at the poles too for the short
 * distances compared here. The longitude difference is wrapped, so 180° and -180° are the same.
 */
function metres(a: Position, b: Position): number {
  const radius = 6_371_008.8;
  const rad = Math.PI / 180;
  const dlon = ((((a[0] - b[0]) % 360) + 540) % 360) - 180;
  const dx = dlon * Math.cos(((a[1] + b[1]) / 2) * rad) * radius * rad;
  const dy = (a[1] - b[1]) * radius * rad;
  return Math.hypot(dx, dy);
}

function upsParts(text: string): { readonly letter: string; readonly easting: number; readonly northing: number } {
  const [letter = '', easting = '', northing = ''] = text.split(' ');
  return { letter, easting: Number(easting), northing: Number(northing) };
}

describe('criterion 9: UPS and polar MGRS match an independent source (GeographicLib GeoConvert)', () => {
  it('has at least three reference points in each polar area, the poles included, all with latitude ≠ longitude', () => {
    const north = POLAR_REFERENCE_POINTS.filter((p) => p.position[1] > 84);
    const south = POLAR_REFERENCE_POINTS.filter((p) => p.position[1] < -80);
    expect(north.length).toBeGreaterThanOrEqual(3);
    expect(south.length).toBeGreaterThanOrEqual(3);
    expect(north.length + south.length).toBe(POLAR_REFERENCE_POINTS.length);
    expect(north.some((p) => p.position[1] === 90)).toBe(true);
    expect(south.some((p) => p.position[1] === -90)).toBe(true);
    for (const p of POLAR_REFERENCE_POINTS) expect(p.position[1]).not.toBe(p.position[0]);
  });

  describe.each(POLAR_REFERENCE_POINTS)('$note', (p) => {
    it('formats UPS in the UTM format, rounded to metres', () => {
      expect(coordinates.format(p.position, 'utm')).toBe(p.upsMetres);
    });

    it('formats UPS to the millimetre', () => {
      const ours = upsParts(coordinates.format(p.position, 'utm', { precision: 3 }));
      const reference = upsParts(p.ups);
      expect(ours.letter).toBe(reference.letter);
      expect(Math.abs(ours.easting - reference.easting)).toBeLessThanOrEqual(0.002);
      expect(Math.abs(ours.northing - reference.northing)).toBeLessThanOrEqual(0.002);
    });

    it('formats polar MGRS at every precision, truncated', () => {
      const [square = '', easting = '', northing = ''] = p.mgrs.split(' ');
      expect(coordinates.format(p.position, 'mgrs')).toBe(p.mgrs5);
      for (const digits of [1, 2, 3, 4, 5]) {
        expect(coordinates.format(p.position, 'mgrs', { precision: digits })).toBe(
          `${square} ${easting.slice(0, digits)} ${northing.slice(0, digits)}`,
        );
      }
    });

    it('formats DMS', () => {
      expect(coordinates.format(p.position, 'dms', { precision: 4 })).toBe(p.dms);
    });

    it('converts UPS back to the position of the rounded text', () => {
      const { letter, easting, northing } = upsParts(p.upsMetres);
      if (letter !== 'A' && letter !== 'B' && letter !== 'Y' && letter !== 'Z') throw new Error(letter);
      expect(metres(fromUps(letter, easting, northing), p.upsMetresPosition)).toBeLessThan(0.001);
    });
  });
});

describe('criteria 4 and 9: UTM up to and including 84° N and 80° S, UPS beyond', () => {
  it.each(POLAR_EDGES)('$note: $utm, $mgrs', ({ position, utm, mgrs }) => {
    expect(coordinates.format(position, 'utm')).toBe(utm);
    expect(coordinates.format(position, 'mgrs')).toBe(mgrs);
  });
});

describe('criterion 4: UPS anywhere beyond the limits, without exceptions or wrong values', () => {
  const latitudes = [84.0000001, 84.3, 85.5, 87.25, 89.0001, 89.9999999, 90, -80.0000001, -80.7, -83.3, -86.5, -89.75, -89.9999999, -90];
  const longitudes = [-180, -179.9999999, -135.5, -90, -45.25, -0.0000001, 0, 0.0000001, 33.3, 90, 135.5, 179.9999999, 180];

  it('gives the right letter, coordinates inside the UPS grid, and converts back within a millimetre', () => {
    for (const lat of latitudes) {
      for (const lon of longitudes) {
        const position: Position = [lon, lat];
        const ups = toUps(position);
        const east = ups.easting >= UPS_ORIGIN - 1e-6;
        expect(ups.letter, `${String(lon)} ${String(lat)}`).toBe(lat > 0 ? (east ? 'Z' : 'Y') : east ? 'B' : 'A');
        // From the pole's 2 000 000 m, the UPS area reaches 6° (about 670 km) in the north and 10° (about 1 115 km) in the south.
        const reach = lat > 0 ? 700_000 : 1_150_000;
        expect(Math.hypot(ups.easting - UPS_ORIGIN, ups.northing - UPS_ORIGIN)).toBeLessThan(reach);
        expect(metres(fromUps(ups.letter, ups.easting, ups.northing), position)).toBeLessThan(0.001);
        expect(coordinates.format(position, 'utm')).toMatch(/^[ABYZ] \d{6,7} \d{6,7}$/);
        // The MGRS letters agree with the UPS letter and the square that holds the easting and northing.
        const mgrs = coordinates.format(position, 'mgrs');
        expect(mgrs, `${String(lon)} ${String(lat)}`).toMatch(new RegExp(`^${ups.letter}[A-HJ-NP-Z]{2} [0-9]{5} [0-9]{5}$`));
        const [, easting = '', northing = ''] = mgrs.split(' ');
        expect(Number(easting)).toBe(Math.floor(Math.round(ups.easting * 1e6) / 1e6) % 100_000);
        expect(Number(northing)).toBe(Math.floor(Math.round(ups.northing * 1e6) / 1e6) % 100_000);
      }
    }
  });

  it('puts west of 0° under A or Y and east under B or Z, away from 0° and 180°', () => {
    expect(coordinates.format([-90, 85], 'utm')).toMatch(/^Y /);
    expect(coordinates.format([90, 85], 'utm')).toMatch(/^Z /);
    expect(coordinates.format([-90, -85], 'utm')).toMatch(/^A /);
    expect(coordinates.format([90, -85], 'utm')).toMatch(/^B /);
  });
});

function parsed(text: string): Position {
  const result = coordinates.parse(text);
  if ('error' in result) throw new Error(`${text}: ${result.error}`);
  return result.position;
}

function parseError(text: string): string {
  const result = coordinates.parse(text);
  if ('position' in result) throw new Error(`${text} parsed as ${result.position.join(', ')}`);
  return result.error;
}

describe('criterion 9: parse UPS and polar MGRS, against GeographicLib GeoConvert', () => {
  describe.each(POLAR_REFERENCE_POINTS)('$note', (p) => {
    it('parses the UPS text', () => {
      expect(metres(parsed(p.upsMetres), p.upsMetresPosition)).toBeLessThan(0.001);
    });

    it('parses polar MGRS as the south-west corner of its square', () => {
      expect(metres(parsed(p.mgrs5), p.mgrs5Corner)).toBeLessThan(0.01);
    });

    it('parses its DMS', () => {
      expect(metres(parsed(p.dms), p.position)).toBeLessThan(0.003);
    });
  });

  it('accepts the usual variations', () => {
    const corner: Position = [12.3455508471, 86.123449826];
    for (const text of ['ZAC 92054 79409', 'zac9205479409', 'Z AC 92054 79409', 'ZAC92054 79409']) {
      expect(metres(parsed(text), corner), text).toBeLessThan(0.01);
    }
    const ups: Position = [12.3457092996, 86.1234566915];
    for (const text of ['Z 2092055 1579410', 'z 2092055m 1579410m', 'Z 2092055.0, 1579410.0']) {
      expect(metres(parsed(text), ups), text).toBeLessThan(0.001);
    }
  });

  it('reads a polar square with fewer digits, down to the 100 km square, as its south-west corner', () => {
    expect(metres(parsed('ZAC 9 7'), parsed('ZAC 90000 70000'))).toBeLessThan(0.001);
    expect(metres(parsed('BAN'), [0, -90])).toBeLessThan(0.001);
    expect(metres(parsed('ZAH'), [0, 90])).toBeLessThan(0.001);
  });
});

describe('criterion 9: round trips in the polar areas return the position within the precision of the format', () => {
  const latitudes = [84.0000001, 84.3, 85.5, 87.25, 89.0001, 89.9999999, 90, -80.0000001, -80.7, -83.3, -86.5, -89.75, -89.9999999, -90];
  const longitudes = [-180, -179.9999999, -135.5, -90, -45.25, -0.0000001, 0, 0.0000001, 33.3, 90, 135.5, 179.9999999, 180];
  const positions: readonly Position[] = [
    ...POLAR_REFERENCE_POINTS.map((p) => p.position),
    ...latitudes.flatMap((lat) => longitudes.map((lon): Position => [lon, lat])),
  ];

  it.each([
    ['utm', 0.71],
    ['dms', 3],
    ['dd', 0.1],
  ] as const)('%s within %f m', (format, limit) => {
    for (const position of positions) {
      const text = coordinates.format(position, format);
      expect(metres(parsed(text), position), `${format} ${text}`).toBeLessThanOrEqual(limit);
    }
  });

  it('MGRS with 5 digits: the position lies in the 1 m square whose south-west corner parse returns', () => {
    for (const position of positions) {
      const text = coordinates.format(position, 'mgrs');
      const original = toUps(position);
      const corner = toUps(parsed(text));
      expect(corner.letter, text).toBe(original.letter);
      // At ±180° and the poles the projection's noise is far below a micrometre; truncation gives 0 to 1 m.
      expect(original.easting - corner.easting, text).toBeGreaterThanOrEqual(-1e-6);
      expect(original.easting - corner.easting, text).toBeLessThan(1);
      expect(original.northing - corner.northing, text).toBeGreaterThanOrEqual(-1e-6);
      expect(original.northing - corner.northing, text).toBeLessThan(1);
    }
  });
});

describe('criteria 4 and 9: the text around the limits and at ±180° parses back', () => {
  it.each(POLAR_EDGES)('$note: $utm and $mgrs return the position within the precision of the format', ({ position, utm, mgrs }) => {
    expect(metres(parsed(utm), position)).toBeLessThanOrEqual(0.71);
    expect(metres(parsed(mgrs), position)).toBeLessThanOrEqual(1.42);
  });

  // Within a metre of 84° N or 80° S, the rounded or truncated text may fall on the other side of the
  // limit and format the other way: correct within the precision, but not the same text. Away from
  // the limits, at ±180° and the poles, the text comes back unchanged.
  it.each(POLAR_EDGES.filter((e) => Math.abs(e.position[1]) > 84.5))('$note: $utm and $mgrs format back to the same text', ({ utm, mgrs }) => {
    expect(coordinates.format(parsed(utm), 'utm')).toBe(utm);
    expect(coordinates.format(parsed(mgrs), 'mgrs')).toBe(mgrs);
  });

  it('accepts UTM text exactly on the limits and UPS text just beyond them', () => {
    expect(metres(parsed('24X 482497 9328322'), [-40.5, 84])).toBeLessThan(0.71);
    expect(metres(parsed('57C 529075 1118039'), [160.5, -80])).toBeLessThan(0.71);
    expect(metres(parsed('Y 1566995 1493016'), [-40.5, 84.000001])).toBeLessThan(0.71);
    expect(metres(parsed('B 2371511 950886'), [160.5, -80.000001])).toBeLessThan(0.71);
  });
});

describe('criterion 4: polar text that is not a position gives a clear error', () => {
  it.each([
    ['YUB17770380', /UPS starts beyond 84° N and 80° S/],
    ['Z 2000000 2700000', /UPS starts beyond 84° N and 80° S/],
    ['B 2000000 3200000', /UPS starts beyond 84° N and 80° S/],
    ['Z 1500000 2000000', /UPS Z is east of 0° and 180°: an easting of 1500000 m belongs to Y/],
    ['A 2500000 2000000', /UPS A is west of 0° and 180°: an easting of 2500000 m belongs to B/],
    ['Z 5000000 2000000', /between 0 and 4 000 000 m/],
    ['ZAX 00000 00000', /AX is not a 100 km square of polar MGRS zone Z/],
    ['YAB 00000 00000', /AB is not a 100 km square of polar MGRS zone Y/],
    ['BAN 1234 123', /same number of digits/],
    ['BAN 123456 123456', /at most 5 digits/],
  ])('"%s"', (text, message) => {
    expect(parseError(text)).toMatch(message);
  });
});

describe('criteria 4 and 9: every polar square of the letter tables formats and parses back to itself', () => {
  // A self-consistency check of the tables in polarMgrs.ts, not an independent source: the reference
  // points and edge cases above check the letters against GeoConvert.
  const tables: Readonly<Record<UpsLetter, { readonly columns: string; readonly rows: string }>> = {
    A: { columns: 'JKLPQRSTUXYZ', rows: 'ABCDEFGHJKLMNPQRSTUVWXYZ' },
    B: { columns: 'ABCFGHJKLPQR', rows: 'ABCDEFGHJKLMNPQRSTUVWXYZ' },
    Y: { columns: 'RSTUXYZ', rows: 'ABCDEFGHJKLMNP' },
    Z: { columns: 'ABCFGHJ', rows: 'ABCDEFGHJKLMNP' },
  };

  it.each(Object.keys(tables) as UpsLetter[])('zone %s', (letter) => {
    const { columns, rows } = tables[letter];
    let inArea = 0;
    for (const column of columns) {
      for (const row of rows) {
        const square = polarSquare(letter, `${column}${row}`, '50000', '50000');
        if (!square) throw new Error(`${letter}${column}${row}: no square`);
        const centre = fromUps(letter, square.easting, square.northing);
        const beyond = letter === 'Y' || letter === 'Z' ? centre[1] > UTM_NORTH_LIMIT : centre[1] < UTM_SOUTH_LIMIT;
        if (!beyond) continue;
        inArea++;
        const text = `${letter}${column}${row} 50000 50000`;
        expect(coordinates.format(centre, 'mgrs'), text).toBe(text);
        expect(metres(parsed(text), centre), text).toBeLessThan(0.001);
      }
    }
    expect(inArea).toBeGreaterThan(20);
  });
});
