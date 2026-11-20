// @vitest-environment node
// Tests of the data: the committed originals, the conversion (scripts/convert.ts) and what it ships.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DECIMALS, SOURCE_LAYERS, convert, convertToData, round, type ShippedData } from '../scripts/convert.ts';

const pluginDir = fileURLToPath(new URL('../../', import.meta.url));
const dataDir = `${pluginDir}data`;
const readme = readFileSync(`${pluginDir}README.md`, 'utf8');

type Position = readonly [number, number];
type Ring = readonly Position[];

const LAYER_IDS = ['land', 'ice-shelves', 'lakes', 'coastline', 'borders'];

const shipped: ShippedData = convertToData(dataDir);
const shippedText = convert(dataDir);

/** The polygons of a layer, each as its rings (outer ring first). */
function polygons(layer: string): Ring[][] {
  return shipped.features
    .filter((f) => f.layer === layer)
    .flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : []));
}

/** The lines of a layer. */
function lines(layer: string): Ring[] {
  return shipped.features
    .filter((f) => f.layer === layer)
    .flatMap((f) => (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : []));
}

/** Every ring or line of a layer, polygons and lines alike. */
function parts(layer: string): Ring[] {
  return [...polygons(layer).flat(), ...lines(layer)];
}

/** Every ring and line of every layer. */
const everything: Ring[] = LAYER_IDS.flatMap((l) => parts(l));

/**
 * The first few points (with the point before them in the same ring or line, if any) for which `bad` is true.
 * Tests assert `toEqual([])` on this once, instead of calling `expect` for each of the ~140,000
 * coordinates: that was slow enough to hit vitest's 5 s timeout when the whole suite runs under load.
 */
function offenders(rings: readonly Ring[], bad: (previous: Position | undefined, point: Position) => boolean): string[] {
  const found: string[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const point = ring[i] as Position;
      const previous = ring[i - 1];
      if (bad(previous, point)) {
        found.push(`${JSON.stringify(previous)} -> ${JSON.stringify(point)}`);
        if (found.length === 5) return found;
      }
    }
  }
  return found;
}

/** Ray casting with straight edges in lon/lat, as the SDK's vector source defines edges. */
function inRing(ring: Ring, [x, y]: Position): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as Position;
    const [xj, yj] = ring[j] as Position;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inLayer(layer: string, point: Position): boolean {
  return polygons(layer).some(([outer, ...holes]) => outer !== undefined && inRing(outer, point) && !holes.some((h) => inRing(h, point)));
}

/** Distance in degrees (longitude scaled by cos latitude) from a point to the nearest vertex of the layer's lines. */
function nearestVertex(layer: string, [lon, lat]: Position): number {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (const line of lines(layer)) {
    for (const [x, y] of line) best = Math.min(best, Math.hypot((x - lon) * k, y - lat));
  }
  return best;
}

describe('the committed originals', () => {
  /** Rows of the README table: | `file` | size | sha256 |. */
  const recorded = [...readme.matchAll(/^\| `(ne_50m_[a-z_0-9]+\.geojson)` \| ([\d,]+) \| `([0-9a-f]{64})` \|$/gm)].map((m) => ({
    file: m[1] as string,
    size: Number((m[2] as string).replaceAll(',', '')),
    sha256: m[3] as string,
  }));

  // Acceptance criterion 6
  it('are exactly the five files of the brief, each with its checksum in the README', () => {
    expect(recorded.map((r) => r.file).sort()).toEqual(SOURCE_LAYERS.map((l) => l.file).sort());
  });

  // Acceptance criterion 6
  it.each(SOURCE_LAYERS.map((l) => l.file))('%s matches the SHA-256 and size recorded in the README', (file) => {
    const bytes = readFileSync(`${dataDir}/${file}`);
    const row = recorded.find((r) => r.file === file);
    expect(row, `no README row for ${file}`).toBeDefined();
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(row?.sha256);
    expect(bytes.length).toBe(row?.size);
  });

  it('are named in the README with the Natural Earth version and the source', () => {
    expect(readme).toContain('5.1.2');
    expect(readme).toContain('https://github.com/nvkelso/natural-earth-vector');
  });

  it('are kept byte for byte: git does not convert their line endings', () => {
    expect(readFileSync(`${dataDir}/.gitattributes`, 'utf8')).toMatch(/^\* -text$/m);
  });
});

describe('the conversion', () => {
  // Acceptance criterion 6
  it('gives the same bytes every time', () => {
    const again = convert(dataDir);
    expect(again).toBe(shippedText);
    expect(createHash('sha256').update(again).digest('hex')).toBe(createHash('sha256').update(shippedText).digest('hex'));
  });

  // Acceptance criterion 5
  it('ships at most 5 MB', () => {
    expect(Buffer.byteLength(shippedText)).toBeLessThanOrEqual(5 * 1000 * 1000);
  });

  // Acceptance criterion 5
  it('holds only the five layers, and nothing but geometry and the layer', () => {
    expect(new Set(shipped.features.map((f) => f.layer))).toEqual(new Set(LAYER_IDS));
    expect(shipped.features.filter((f) => Object.keys(f).sort().join() !== 'geometry,layer')).toEqual([]);
    expect(Object.keys(JSON.parse(shippedText) as object)).toEqual(['features']);
    expect(shippedText).not.toMatch(/scalerank|featurecla|properties|bbox|crs/);
  });

  it('keeps every feature of every original, in order, without simplification', () => {
    for (const { id, file } of SOURCE_LAYERS) {
      const original = JSON.parse(readFileSync(`${dataDir}/${file}`, 'utf8')) as { features: { geometry: { type: string; coordinates: unknown } }[] };
      const converted = shipped.features.filter((f) => f.layer === id);
      expect(converted.length, id).toBe(original.features.length);
      const count = (c: unknown): number => (Array.isArray(c) && typeof c[0] === 'number' ? 1 : (c as unknown[]).reduce<number>((n, x) => n + count(x), 0));
      const different = original.features.flatMap((o, i) => {
        const c = converted[i];
        return c !== undefined && c.geometry.type === o.geometry.type && count(c.geometry.coordinates) === count(o.geometry.coordinates) ? [] : [`${id} ${String(i)}`];
      });
      expect(different).toEqual([]);
    }
  });

  it('rounds to 4 decimals, longitude first, and only rounds', () => {
    expect(DECIMALS).toBe(4);
    // lat ≠ lon, and a swap would show: 18.123456 E, -34.654321 N.
    expect(round(18.123456)).toBe(18.1235);
    expect(round(-34.654321)).toBe(-34.6543);
    expect(Object.is(round(-0.00001), 0)).toBe(true);
    const original = JSON.parse(readFileSync(`${dataDir}/ne_50m_coastline.geojson`, 'utf8')) as { features: { geometry: { coordinates: unknown } }[] };
    const first = original.features[0]?.geometry.coordinates as number[][] | number[][][];
    const [lon, lat] = (Array.isArray(first[0]?.[0]) ? (first[0] as number[][])[0] : (first as number[][])[0]) as number[];
    const out = shipped.features.find((f) => f.layer === 'coastline')?.geometry;
    const [outLon, outLat] = (out?.type === 'LineString' ? out.coordinates[0] : (out?.coordinates as Position[][])[0]?.[0]) as Position;
    expect(outLon).toBe(round(lon as number));
    expect(outLat).toBe(round(lat as number));
    // One assertion for all ~140,000 coordinates: an `expect` per coordinate made this test slow enough
    // to hit vitest's 5 s timeout when the whole suite runs under load.
    expect(offenders(everything, (_, [x, y]) => round(x) !== x || round(y) !== y)).toEqual([]);
  });
});

describe('the shipped geometry (SDK vector source rules)', () => {
  it('has longitudes in -180…180 and latitudes in -90…90', () => {
    expect(offenders(everything, (_, [lon, lat]) => !(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90))).toEqual([]);
  });

  // Acceptance criterion 2 (the data part: the map view draws what it gets, so no edge may cross the antimeridian)
  it('has no edge that crosses the antimeridian: data is cut at ±180°', () => {
    expect(offenders(everything, (previous, [lon]) => previous !== undefined && !(Math.abs(lon - previous[0]) < 180))).toEqual([]);
  });

  it('has closed polygon rings', () => {
    const rings = ['land', 'ice-shelves', 'lakes'].flatMap((layer) => polygons(layer).flat());
    const open = rings.filter((ring) => ring.length < 4 || ring[0]?.[0] !== ring.at(-1)?.[0] || ring[0]?.[1] !== ring.at(-1)?.[1]);
    expect(open.map((ring) => ring.slice(0, 2))).toEqual([]);
  });

  // Acceptance criterion 2 (the data part): Antarctica runs along the pole, around the whole map
  it('draws Antarctica as a polygon along the south pole across all longitudes', () => {
    const antarctica = polygons('land').find((rings) => (rings[0] ?? []).some(([, lat]) => lat < -89.9));
    expect(antarctica).toBeDefined();
    const outer = antarctica?.[0] ?? [];
    expect(Math.min(...outer.map(([lon]) => lon))).toBe(-180);
    expect(Math.max(...outer.map(([lon]) => lon))).toBe(180);
  });

  // Acceptance criterion 2 (the data part): the Russian coast is cut at 180°, with both halves present
  it('has the Chukotka coast on both sides of the antimeridian', () => {
    const near = (lonSign: number) =>
      parts('coastline').some((part) => part.some(([lon, lat]) => lonSign * lon > 179.9 && lat > 64 && lat < 71));
    expect(near(1)).toBe(true);
    expect(near(-1)).toBe(true);
  });

  it('has ice shelves in the Antarctic only', () => {
    expect(offenders(polygons('ice-shelves').flat(), (_, [, lat]) => !(lat < -60))).toEqual([]);
  });

  it('has country borders on land, none in the far south', () => {
    expect(lines('borders').length).toBeGreaterThan(100);
    expect(offenders(lines('borders'), (_, [, lat]) => !(lat > -60))).toEqual([]);
  });

  // Acceptance criterion 3 (the data part). Latitude ≠ longitude in every point; the swapped point must NOT match.
  it('has the Cape of Good Hope coast at 18.47 E, 34.36 S, and not at 34.36 E, 18.47 S', () => {
    expect(nearestVertex('coastline', [18.4719, -34.3568])).toBeLessThan(0.3);
    expect(nearestVertex('coastline', [-34.3568, 18.4719])).toBeGreaterThan(3);
  });

  it('has Uppsala (17.64 E, 59.86 N) on land and the Gulf of Bothnia (19.5 E, 62.5 N) in the water', () => {
    expect(inLayer('land', [17.64, 59.86])).toBe(true);
    expect(inLayer('land', [59.86, 17.64])).toBe(false);
    expect(inLayer('land', [19.5, 62.5])).toBe(false);
  });

  it('has Lake Vänern (13.1 E, 58.8 N) as a lake, and not on the swapped position', () => {
    expect(inLayer('lakes', [13.1, 58.8])).toBe(true);
    expect(inLayer('lakes', [58.8, 13.1])).toBe(false);
  });

  it('has Svalbard (16 E, 78 N) and Greenland (-42 E, 72 N) on land', () => {
    expect(inLayer('land', [16, 78])).toBe(true);
    expect(inLayer('land', [-42, 72])).toBe(true);
  });
});
