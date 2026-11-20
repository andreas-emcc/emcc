import { describe, expect, it } from 'vitest';
import type { CoordinateFormat, CoordinateService, Position } from '@emc2/plugin-sdk';
import { INVALID_POSITION } from '../src/format.ts';
import { MAX_LENGTH, NOT_A_POSITION } from '../src/parse.ts';
import { createCoordinateService } from '../src/service.ts';
import { DEFAULTS } from '../src/settings.ts';
import { sharedState } from '../src/state.ts';
import { toUtm, zoneOf } from '../src/utm.ts';
import { REFERENCE_POINTS } from './reference-points.ts';

function service(): CoordinateService {
  return createCoordinateService(sharedState(DEFAULTS), { load: () => null, save: () => undefined });
}

const coordinates = service();

/** Distance in metres; an equirectangular approximation, plenty for the short distances compared here. */
function metres(a: Position, b: Position): number {
  const radius = 6_371_008.8;
  const rad = Math.PI / 180;
  const dx = (a[0] - b[0]) * Math.cos(((a[1] + b[1]) / 2) * rad) * radius * rad;
  const dy = (a[1] - b[1]) * radius * rad;
  return Math.hypot(dx, dy);
}

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

/** The DMS of the reference (0.0001") rounded to 0.1", the default; none of the points carries into the minutes. */
function dmsToTenths(reference: string): string {
  return reference.replace(/(\d\d\.\d{4})"/g, (_, seconds: string) => {
    const rounded = Number(seconds).toFixed(1);
    if (rounded === '60.0') throw new Error('carry: pick another point');
    return `${rounded.padStart(4, '0')}"`;
  });
}

function utmParts(text: string): { readonly zone: string; readonly easting: number; readonly northing: number } {
  const [zone = '', easting = '', northing = ''] = text.split(' ');
  return { zone, easting: Number(easting), northing: Number(northing) };
}

describe('criterion 1: format and parse match an independent source (GeographicLib GeoConvert)', () => {
  it('has at least ten reference points in every hemisphere, all with latitude ≠ longitude', () => {
    expect(REFERENCE_POINTS.length).toBeGreaterThanOrEqual(10);
    for (const p of REFERENCE_POINTS) expect(p.position[1]).not.toBe(p.position[0]);
    const quadrants = new Set(REFERENCE_POINTS.map(({ position: [lon, lat] }) => `${lat < 0 ? 'S' : 'N'}${lon < 0 ? 'W' : 'E'}`));
    expect([...quadrants].sort()).toEqual(['NE', 'NW', 'SE', 'SW']);
  });

  describe.each(REFERENCE_POINTS)('$note', (p) => {
    const [lon, lat] = p.position;

    it('formats DD', () => {
      const hemispheres = `${lat < 0 ? 'S' : 'N'} ${Math.abs(lon).toFixed(6)}° ${lon < 0 ? 'W' : 'E'}`;
      expect(coordinates.format(p.position, 'dd')).toBe(`${Math.abs(lat).toFixed(6)}° ${hemispheres}`);
    });

    it('formats DMS', () => {
      expect(coordinates.format(p.position, 'dms', { precision: 4 })).toBe(p.dms);
      expect(coordinates.format(p.position, 'dms')).toBe(dmsToTenths(p.dms));
    });

    it('formats UTM', () => {
      expect(coordinates.format(p.position, 'utm')).toBe(p.utmMetres);
      const ours = utmParts(coordinates.format(p.position, 'utm', { precision: 3 }));
      const reference = utmParts(p.utm);
      expect(ours.zone).toBe(reference.zone);
      expect(Math.abs(ours.easting - reference.easting)).toBeLessThanOrEqual(0.002);
      expect(Math.abs(ours.northing - reference.northing)).toBeLessThanOrEqual(0.002);
    });

    it('formats MGRS at every precision, truncated', () => {
      const [square = '', easting = '', northing = ''] = p.mgrs.split(' ');
      expect(coordinates.format(p.position, 'mgrs')).toBe(p.mgrs5);
      for (const digits of [1, 2, 3, 4, 5]) {
        expect(coordinates.format(p.position, 'mgrs', { precision: digits })).toBe(
          `${square} ${easting.slice(0, digits)} ${northing.slice(0, digits)}`,
        );
      }
    });

    it('parses DMS', () => {
      expect(metres(parsed(p.dms), p.position)).toBeLessThan(0.003);
    });

    it('parses UTM', () => {
      expect(metres(parsed(p.utmMetres), p.utmMetresPosition)).toBeLessThan(0.001);
    });

    it('parses MGRS as the south-west corner of its square', () => {
      expect(metres(parsed(p.mgrs5), p.mgrs5Corner)).toBeLessThan(0.01);
    });
  });
});

/** More points for the round trips: a spread over the UTM area, latitude ≠ longitude. */
const SPREAD: readonly Position[] = [-179.5, -121.3, -64.7, -3.21, 0.5, 7.77, 44.4, 98.6, 151.9, 179.99].flatMap((lon) =>
  [-79.9, -45.67, -12.3, 0.25, 33.3, 59.95, 71.99, 78.5, 83.99].map((lat): Position => [lon, lat]),
);
const ROUND_TRIP_POINTS: readonly Position[] = [...REFERENCE_POINTS.map((p) => p.position), ...SPREAD];

describe('criterion 2: round trips return the position within the precision of the format', () => {
  it.each<[CoordinateFormat, number]>([
    ['dd', 0.1],
    ['dms', 3],
    ['utm', 0.71],
  ])('%s within %f m', (format, limit) => {
    for (const position of ROUND_TRIP_POINTS) {
      const text = coordinates.format(position, format);
      expect(metres(parsed(text), position), `${format} ${text}`).toBeLessThanOrEqual(limit);
    }
  });

  it('MGRS with 5 digits: the position lies in the 1 m square whose south-west corner parse returns', () => {
    for (const position of ROUND_TRIP_POINTS) {
      const text = coordinates.format(position, 'mgrs');
      const corner = parsed(text);
      const original = toUtm(position);
      const back = toUtm(corner);
      // Truncation: 0 to 1 m east and north of the corner, in the same zone (1 cm slack between the libraries).
      expect(back.zone, text).toBe(original.zone);
      expect(original.easting - back.easting, text).toBeGreaterThanOrEqual(-0.01);
      expect(original.easting - back.easting, text).toBeLessThan(1.01);
      expect(original.northing - back.northing, text).toBeGreaterThanOrEqual(-0.01);
      expect(original.northing - back.northing, text).toBeLessThan(1.01);
    }
  });

  it('DMS rounding carries into minutes and degrees', () => {
    expect(coordinates.format([15.999999, 59.999999], 'dms')).toBe('60°00\'00.0" N 016°00\'00.0" E');
    expect(coordinates.format([-0.00001, -0.00001], 'dms')).toBe('00°00\'00.0" N 000°00\'00.0" E');
    expect(coordinates.format([-179.9999999, -89.9999999], 'dms', { precision: 2 })).toBe('90°00\'00.00" S 180°00\'00.00" W');
  });
});

describe('criterion 3: UTM zone exceptions for Norway (32V) and Svalbard (31X–37X)', () => {
  // Expected values from GeoConvert, as in reference-points.ts.
  it.each([
    [[3.5, 56] as Position, '32V 157175 6219738', '32VJH 57174 19738', 'Norway exception starts at 56° N and 3° E'],
    [[3.5, 64] as Position, '31W 524456 7097110', '31WEL 24455 97110', 'Norway exception ends at 64° N'],
    [[8.5, 72] as Position, '31X 689462 7997589', '31XFV 89461 97588', 'Svalbard exception starts at 72° N'],
    [[8.5, 71.999999] as Position, '32W 482755 7989004', '32WME 82754 89003', 'below 72° N there is no Svalbard exception'],
  ])('%j is %s', (position, utm, mgrs) => {
    expect(coordinates.format(position, 'utm')).toBe(utm);
    expect(coordinates.format(position, 'mgrs')).toBe(mgrs);
  });

  it('the Svalbard exception reaches 84° N (UTM)', () => {
    expect(coordinates.format([8.5, 84], 'utm')).toBe('31X 564089 9331155');
  });

  it('known limit (README): MGRS at exactly 84° N uses the normal zone, because the mgrs library stops the Svalbard rule below 84°', () => {
    expect(coordinates.format([8.5, 84], 'mgrs')).toMatch(/^32X/);
    expect(coordinates.format([8.5, 83.9999], 'mgrs')).toMatch(/^31X/);
  });

  it.each([
    [2.999, 60, 31], [3, 60, 32], [11.999, 60, 32], [12, 60, 33], [5, 55.999, 31], [5, 64, 31],
    [8.999, 78, 31], [9, 78, 33], [20.999, 78, 33], [21, 78, 35], [32.999, 78, 35], [33, 78, 37], [41.999, 78, 37], [42, 78, 38],
    [-0.001, 78, 30], [-179.5, 10.5, 1], [180, 10.5, 60],
  ])('lon %f, lat %f is zone %i', (lon, lat, zone) => {
    expect(zoneOf(lon, lat)).toBe(zone);
  });

  it('the reference points of the exceptions format with their zones', () => {
    const zones = REFERENCE_POINTS.filter((p) => /exception/.test(p.note)).map((p) => coordinates.format(p.position, 'mgrs').slice(0, 3));
    expect(zones).toEqual(['32V', '31V', '31X', '33X', '35X', '37X']);
  });
});

describe('criterion 4: north of 84° N and south of 80° S', () => {
  const polar: readonly (readonly [number, number])[] = [[15.5, 84.0001], [-30.25, 89.9], [45.5, -80.0001], [-120.3, -90], [0, 90]];

  it.each(polar)('formats %j as UPS in the UTM format, polar MGRS, and normally in DD and DMS', (lon, lat) => {
    const position: Position = [lon, lat];
    expect(coordinates.format(position, 'utm')).toMatch(lat > 0 ? /^[YZ] \d{7} \d{7}$/ : /^[AB] \d{6,7} \d{6,7}$/);
    expect(coordinates.format(position, 'mgrs')).toMatch(lat > 0 ? /^[YZ][A-Z]{2} \d{5} \d{5}$/ : /^[AB][A-Z]{2} \d{5} \d{5}$/);
    expect(coordinates.format(position, 'dd')).toMatch(/^\d+\.\d{6}° [NS] \d+\.\d{6}° [EW]$/);
    expect(metres(parsed(coordinates.format(position, 'dms')), position)).toBeLessThan(3);
  });

  it('the limits themselves are still UTM', () => {
    expect(coordinates.format([-40.5, 84], 'mgrs')).toMatch(/^24X/);
    expect(coordinates.format([160.5, -80], 'utm')).toMatch(/^57C /);
  });

  it.each([
    ['33X 500000 9400000', /UTM ends at 84° N and 80° S. Beyond, write UPS/],
    ['33C 500000 1000000', /UTM ends at 84° N and 80° S. Beyond, write UPS/],
    ['33ZWG 36360 65340', /Z is a UPS letter, which takes no zone number/],
    ['YUB17770380', /UPS starts beyond 84° N and 80° S/],
    ['A AN 12345 12345', /AN is not a 100 km square of polar MGRS zone A/],
  ])('rejects %s with a clear message', (text, message) => {
    expect(parseError(text)).toMatch(message);
  });

  it('never throws', () => {
    const service = coordinates;
    for (const lat of [-90, -85, -80.5, -80, 84, 84.5, 90]) {
      for (const lon of [-180, -0.5, 0, 33.3, 180]) {
        for (const format of ['dd', 'dms', 'utm', 'mgrs'] as const) {
          expect(() => service.format([lon, lat], format)).not.toThrow();
        }
      }
    }
  });
});

describe('criterion 5: swapped input is caught, never swapped silently', () => {
  it('reads text without hemisphere letters latitude first and returns lon/lat', () => {
    expect(parsed('60.5 15.25')).toEqual([15.25, 60.5]);
    expect(parsed('-33.9, 18.4')).toEqual([18.4, -33.9]);
  });

  it('gives an error for a latitude beyond 90 without hemisphere letters', () => {
    expect(parseError('151.2153 -33.8568')).toMatch(/latitude first/i);
    expect(parseError('100 07 24.4 15 39 15.6')).toMatch(/latitude first/i);
  });

  it('gives an error for a latitude beyond 90 with hemisphere letters', () => {
    expect(parseError('95.5 N 15.25 E')).toMatch(/between 90° S and 90° N/);
  });

  it('follows the hemisphere letters, in either order', () => {
    expect(parsed('15.25 E 60.5 N')).toEqual([15.25, 60.5]);
    expect(parsed('E15.25 N60.5')).toEqual([15.25, 60.5]);
  });

  it('refuses two latitude letters or two longitude letters', () => {
    expect(parseError('60.5 N 15.25 S')).toMatch(/N or S for the latitude/);
    expect(parseError('60.5 E 15.25 W')).toMatch(/N or S for the latitude/);
  });

  it('refuses a longitude beyond 180', () => {
    expect(parseError('60.5 N 190.25 E')).toMatch(/longitude/);
  });
});

describe('parse accepts common variations', () => {
  const brief: Position = [15.654321, 60.123456];

  it.each([
    ['60°07\'24.4416" N 015°39\'15.5556" E'],
    ['60°07\'24.4416"N, 015°39\'15.5556"E'],
    ['N 60°07\'24.4416" E 15°39\'15.5556"'],
    ['60 07 24.4416 N 15 39 15.5556 E'],
    ['600724.4416N 0153915.5556E'],
    ['60°07′24.4416″N 15°39′15.5556″E'],
    ['60º07\'24.4416\'\' n 15º39\'15.5556\'\' e'],
    ['60°07\'24.4416" 15°39\'15.5556"'],
    ['60 07 24.4416 15 39 15.5556'],
    ['60 7.407360 15 39.259260'],
    ['60.123456 N 15.654321 E'],
    ['60.123456° N 15.654321° E'],
    ['60.123456, 15.654321'],
    ['+60.123456 +15.654321'],
    ['  60.123456   15.654321  '],
  ])('%s', (text) => {
    expect(metres(parsed(text), brief)).toBeLessThan(0.003);
  });

  it.each([['33VWG3636065340'], ['33vwg 36360 65340'], ['33 V WG 36360 65340'], ['33V 536360 6665340'], ['33v 536360m 6665340m'], ['33V 536360.0, 6665340.0']])(
    '%s',
    (text) => {
      expect(metres(parsed(text), [15.6543201029, 60.1234527632])).toBeLessThan(0.01);
    },
  );

  it('accepts lower MGRS precision, down to the 100 km square', () => {
    expect(metres(parsed('33VWG 3 6'), parsed('33VWG 30000 60000'))).toBeLessThan(0.01);
    expect(metres(parsed('33VWG'), parsed('33VWG 00000 00000'))).toBeLessThan(0.01);
  });

  it('formats and parses in the southern and western hemispheres with signs', () => {
    expect(parsed('-22.951916 -43.210487')).toEqual([-43.210487, -22.951916]);
    expect(coordinates.format([-43.210487, -22.951916], 'dd')).toBe('22.951916° S 43.210487° W');
  });
});

describe('parse gives a clear error for invalid text', () => {
  it.each([
    ['', /Enter a position/],
    ['   ', /Enter a position/],
    ['hello', /Not a position/],
    ['60.5', /same way/],
    ['60.5 N 15.25', /hemisphere letter for both/],
    ['60 61 00 N 15 00 00 E', /below 60/],
    ['60.5 07 24 N 15 39 15 E', /last number/],
    ['-60.5 N 15.25 E', /sign or a hemisphere/],
    ['60\'07° N 15°39\' E', /degrees, minutes and seconds/],
    ['33VWG 3636 65340', /same number of digits/],
    ['33VWG 363606534', /same number of digits/],
    ['33VWG 363600 653400', /at most 5 digits/],
    ['61VWG 36360 65340', /zone 61/],
    ['33IWG 36360 65340', /not a latitude band/],
    ['33VWZ 36360 65340', /100 km square/],
    ['33VVA 50000 50000', /VA does not lie in latitude band V/],
    ['33N 536360 6665340', /latitude band N/],
    ['33V 1536360 6665340', /easting/],
    ['33V 536360 16665340', /northing/],
  ])('"%s"', (text, message) => {
    const error = parseError(text);
    expect(error).toMatch(message);
  });

  it('the generic message shows examples', () => {
    expect(NOT_A_POSITION).toMatch(/33VWG 36360 65340/);
  });
});

describe('format of edge values', () => {
  it.each([[[Number.NaN, 10]], [[10, Number.POSITIVE_INFINITY]], [[10.5, 90.0001]], [[180.0001, 10.5]], [[-180.5, -10.5]]])(
    '%j is an invalid position in every format',
    (position) => {
      for (const format of ['dd', 'dms', 'utm', 'mgrs'] as const) {
        expect(coordinates.format(position as unknown as Position, format)).toBe(INVALID_POSITION);
      }
    },
  );

  it('writes no negative zero in DD: a value that rounds to zero is north or east', () => {
    expect(coordinates.format([-0.0000001, -0.0000004], 'dd')).toBe('0.000000° N 0.000000° E');
    expect(coordinates.format([-0, -0], 'dd')).toBe('0.000000° N 0.000000° E');
    expect(coordinates.format([-0.0000006, -0.0000007], 'dd')).toBe('0.000001° S 0.000001° W');
  });
});

describe('parse of unusual input', () => {
  it('accepts the Unicode minus sign', () => {
    expect(parsed('−33.9 −18.4')).toEqual([-18.4, -33.9]);
  });

  it(`refuses text longer than ${String(MAX_LENGTH)} characters, without parsing it`, () => {
    expect(parseError(`60.5 15.25${' '.repeat(MAX_LENGTH)}`)).toMatch(/Too long/);
    expect(parsed(`60.5 15.25${' '.repeat(MAX_LENGTH - 10)}`)).toEqual([15.25, 60.5]);
  });
});
