import { describe, expect, it } from 'vitest';
import type { WmsSource } from '@emc2/plugin-sdk';
import { wmsGetMapUrl } from '@emc2/plugin-sdk/testing';
import ImageLayer from 'ol/layer/Image.js';
import TileLayer from 'ol/layer/Tile.js';
import { get as getOlProjection } from 'ol/proj.js';
import type XYZ from 'ol/source/XYZ.js';
import type ImageSource from 'ol/source/Image.js';
import { registerProjections, type Projection } from '../../src/core/projections.ts';
import { DEFAULT_SETTINGS, type ProjectionDef } from '../../src/core/settings.ts';
import type { Box } from '../../src/core/wms.ts';
import { registerWithOpenLayers } from '../../src/engine/olEngine.ts';
import { wmsImageLoader, wmsLayer, type LoadImage } from '../../src/engine/wms.ts';

const WGS84: ProjectionDef = {
  code: 'EPSG:4326',
  proj4: '+proj=longlat +datum=WGS84 +no_defs',
  extent: [-180, -90, 180, 90],
  worldExtent: [-180, -90, 180, 90],
};
const { projections } = registerProjections([...DEFAULT_SETTINGS.projections, WGS84]);
registerWithOpenLayers(projections);
const projectionOf = (code: string) => projections.find((p) => p.def.code === code) as Projection;
const extentOf = (projection: Projection) => projection.def.extent;

const SOURCE: WmsSource = { type: 'wms', url: '/api/plugins/basemap-wms/map/topo', layers: ['relief'], version: '1.3.0', format: 'image/png' };

/** The same request: every parameter equal, the box to a millimetre (float noise at a tile's edge). */
function sameRequest(a: string, b: string): boolean {
  const [x, y] = [new URL(a, 'http://x').searchParams, new URL(b, 'http://x').searchParams];
  if ([...x.keys()].sort().join() !== [...y.keys()].sort().join()) return false;
  for (const [name, value] of x) {
    if (name === 'BBOX') {
      const [p, q] = [value.split(',').map(Number), (y.get(name) ?? '').split(',').map(Number)];
      if (p.length !== 4 || p.some((v, i) => Math.abs(v - (q[i] ?? Number.NaN)) > 1e-3)) return false;
    } else if (y.get(name) !== value) return false;
  }
  return true;
}

/** What the layer's tile source asks the server for when it loads tile z, x, y (x may repeat the world). */
async function requestFor(source: WmsSource, projection: Projection, [z, x, y]: [number, number, number]): Promise<string | null> {
  const requests: string[] = [];
  const load: LoadImage = (image, src) => {
    requests.push(src);
    return Promise.resolve(image);
  };
  const layer = wmsLayer(source, projection, 'wms', load);
  expect(layer).toBeInstanceOf(TileLayer);
  const tiles = (layer as TileLayer<XYZ>).getSource();
  const olProjection = getOlProjection(projection.def.code);
  if (tiles === null || olProjection === null) throw new Error('no source');
  const tile = tiles.getTile(z, x, y, 1, olProjection);
  (tile as unknown as { load(): void }).load();
  await Promise.resolve();
  expect(requests.length).toBeLessThanOrEqual(1);
  return requests[0] ?? null;
}

function gridOf(source: WmsSource, projection: Projection) {
  const layer = wmsLayer(source, projection, 'wms');
  const grid = (layer as TileLayer<XYZ>).getSource()?.getTileGrid();
  if (grid === undefined || grid === null) throw new Error('no tile grid');
  return grid;
}

describe('WMS tiles (brief function 3, criteria 55 and 56)', () => {
  it.each(['EPSG:3857', 'EPSG:3413', 'EPSG:3031', 'EPSG:4326'])('in %s: every tile request is wmsGetMapUrl for the tile\'s box and tileSize, inside the extent', async (code) => {
    const projection = projectionOf(code);
    const extent = extentOf(projection);
    for (const source of [SOURCE, { ...SOURCE, version: '1.1.1' as const, tileSize: 512 }]) {
      const grid = gridOf(source, projection);
      const size = source.tileSize ?? 256;
      for (let z = 0; z <= 3; z++) {
        const range = grid.getFullTileRange(z);
        if (range === null) throw new Error('no tile range');
        for (let x = range.minX; x <= range.maxX; x++) {
          for (let y = range.minY; y <= range.maxY; y++) {
            const url = await requestFor(source, projection, [z, x, y]);
            const box = grid.getTileCoordExtent([z, x, y]) as unknown as Box;
            expect(url).not.toBeNull();
            expect(sameRequest(url ?? '', wmsGetMapUrl(source, { projection: code, bbox: [...box], width: size, height: size }))).toBe(true);
            const requested = new URL(url ?? '', 'http://x').searchParams;
            expect(requested.get('WIDTH')).toBe(String(size));
            expect(requested.get('HEIGHT')).toBe(String(size));
            const [a, b, c, d] = (requested.get('BBOX') ?? '').split(',').map(Number);
            const [minX, minY, maxX, maxY] = code === 'EPSG:4326' && source.version === '1.3.0' ? [b, a, d, c] : [a, b, c, d];
            expect(minX).toBeGreaterThanOrEqual(extent[0]);
            expect(minY).toBeGreaterThanOrEqual(extent[1]);
            expect(maxX).toBeLessThanOrEqual(extent[2]);
            expect(maxY).toBeLessThanOrEqual(extent[3]);
          }
        }
      }
    }
  });

  it('covers the extent exactly: 1 tile at the top level in a square one, 2 by 1 in EPSG:4326', () => {
    const count = (code: string) => {
      const range = gridOf(SOURCE, projectionOf(code)).getFullTileRange(0);
      return range === null ? [0, 0] : [range.maxX - range.minX + 1, range.maxY - range.minY + 1];
    };
    expect(count('EPSG:3857')).toEqual([1, 1]);
    expect(count('EPSG:3413')).toEqual([1, 1]);
    expect(count('EPSG:4326')).toEqual([2, 1]);
  });

  it('a tile at the antimeridian, asked for as the world repeats, is a box inside the extent (criterion 55)', async () => {
    const projection = projectionOf('EPSG:3857');
    const extent = extentOf(projection);
    const wrapped = await requestFor(SOURCE, projection, [2, 1, 1]);
    // Column 1 of 4, one world to the left and two to the right: the same request.
    for (const x of [-3, 5, 9]) expect(await requestFor(SOURCE, projection, [2, x, 1])).toBe(wrapped);
    for (const x of [-1, 3, 7]) {
      const bbox = (new URL((await requestFor(SOURCE, projection, [2, x, 1])) ?? '', 'http://x').searchParams.get('BBOX') ?? '').split(',').map(Number);
      expect(bbox[0]).toBeGreaterThanOrEqual(extent[0]);
      expect(bbox[2]).toBeLessThanOrEqual(extent[2]);
      expect(bbox[2] as number).toBeGreaterThan(bbox[0] as number);
    }
  });

  it('never asks for a box beyond the extent, whatever the float arithmetic of the tile grid does at its edge', async () => {
    // With this extent and tile size, level 5's last tile ends 5.6e-17 beyond the extent in the tile grid.
    const odd: Projection = { ...projectionOf('EPSG:3857'), wrapsX: false, def: { ...projectionOf('EPSG:3857').def, extent: [0, 0, 0.3, 0.3] } };
    const source = { ...SOURCE, tileSize: 100 };
    expect(gridOf(source, odd).getTileCoordExtent([5, 31, 31])[2]).toBeGreaterThan(0.3);
    const bbox = new URL((await requestFor(source, odd, [5, 31, 31])) ?? '', 'http://x').searchParams.get('BBOX') ?? '';
    expect(bbox.split(',').map(Number)[2]).toBe(0.3);
  });

  it('asks for no tile outside the extent where the world does not repeat', async () => {
    const polar = projectionOf('EPSG:3413');
    expect(await requestFor(SOURCE, polar, [2, 4, 1])).toBeNull();
    expect(await requestFor(SOURCE, polar, [2, -1, 1])).toBeNull();
    expect(await requestFor(SOURCE, polar, [2, 1, 4])).toBeNull();
    expect(await requestFor(SOURCE, polar, [2, 3, 3])).not.toBeNull();
  });

  it('puts latitude first only in EPSG:4326 with WMS 1.3.0 (criterion 56)', async () => {
    const query = async (source: WmsSource) => new URL((await requestFor(source, projectionOf('EPSG:4326'), [1, 3, 0])) ?? '', 'http://x').searchParams;
    // The tile at level 1, column 3, row 0 holds longitudes 90 to 180 and latitudes 0 to 90.
    expect((await query(SOURCE)).get('BBOX')).toBe('0,90,90,180');
    expect((await query(SOURCE)).get('CRS')).toBe('EPSG:4326');
    expect((await query({ ...SOURCE, version: '1.1.1' })).get('BBOX')).toBe('90,0,180,90');
    expect((await query({ ...SOURCE, version: '1.1.1' })).get('SRS')).toBe('EPSG:4326');
  });

  it('has no layer in an extent it cannot cut into tiles inside of, and a single image for mode image', () => {
    const odd: Projection = { ...projectionOf('EPSG:3857'), def: { ...projectionOf('EPSG:3857').def, extent: [0, 0, 3, 2] } };
    expect(wmsLayer(SOURCE, odd, 'wms')).toBeNull();
    const layer = wmsLayer({ ...SOURCE, mode: 'image' }, projectionOf('EPSG:3857'), 'wms');
    expect(layer).toBeInstanceOf(ImageLayer);
    expect(layer?.getZIndex()).toBe(0);
    expect(wmsLayer(SOURCE, projectionOf('EPSG:3857'), 'wms')?.getZIndex()).toBe(0);
  });

  it('shows the attribution', () => {
    const attributions = (wmsLayer(SOURCE, projectionOf('EPSG:3857'), 'wms') as TileLayer<XYZ>).getSource()?.getAttributions();
    expect(typeof attributions === 'function' ? attributions({} as never) : attributions).toEqual(['wms']);
  });
});

describe('a WMS image (brief function 3, criterion 57)', () => {
  const MERCATOR: Box = [-20037508.342789244, -20037508.342789244, 20037508.342789244, 20037508.342789244];
  const IMAGE: WmsSource = { ...SOURCE, mode: 'image' };

  function loaderWith(source: WmsSource = IMAGE, code = 'EPSG:3857', extent: Box = MERCATOR) {
    const requests: string[] = [];
    const load: LoadImage = (image, src) => {
      requests.push(src);
      return Promise.resolve(image);
    };
    return { requests, run: (view: Box, resolution: number) => wmsImageLoader(source, code, extent, load)([...view], resolution, 1, () => undefined) };
  }

  it('is one request per view, around the view and inside the extent', async () => {
    const { requests, run } = loaderWith();
    const result = await run([-1000, -500, 1000, 500], 2);
    expect(requests).toHaveLength(1);
    const query = new URL(requests[0] ?? '', 'http://x').searchParams;
    // The view and half of it more around, at the view's resolution.
    expect(query.get('BBOX')).toBe('-1500,-750,1500,750');
    expect(query.get('WIDTH')).toBe('1500');
    expect(query.get('HEIGHT')).toBe('750');
    expect(requests[0]).toBe(wmsGetMapUrl(IMAGE, { projection: 'EPSG:3857', bbox: [-1500, -750, 1500, 750], width: 1500, height: 750 }));
    expect((result as { extent: number[] }).extent).toEqual([-1500, -750, 1500, 750]);
    expect((result as { resolution: number[] }).resolution).toEqual([2, 2]);
  });

  it('is cut at the extent, the rest of the view staying empty', async () => {
    const { requests, run } = loaderWith();
    const edge = MERCATOR[2];
    const result = await run([edge - 1000, -500, edge + 1000, 500], 1);
    const query = new URL(requests[0] ?? '', 'http://x').searchParams;
    const [minX, , maxX] = (query.get('BBOX') ?? '').split(',').map(Number);
    expect(maxX).toBe(edge);
    expect(minX).toBe(edge - 1500);
    expect((result as { extent: number[] }).extent[2]).toBe(edge);
  });

  it('asks for a smaller image when the view is larger than 4 096 pixels, which is then drawn scaled up', async () => {
    const { requests, run } = loaderWith();
    await run([-10_000, -10_000, 10_000, 5_000], 1);
    const query = new URL(requests[0] ?? '', 'http://x').searchParams;
    expect(query.get('WIDTH')).toBe('4096');
    expect(query.get('HEIGHT')).toBe('4096');
    // Whole numbers, at least 1.
    const tiny = loaderWith();
    await tiny.run([0, 0, 0.0001, 0.0001], 1);
    const small = new URL(tiny.requests[0] ?? '', 'http://x').searchParams;
    expect([small.get('WIDTH'), small.get('HEIGHT')]).toEqual(['1', '1']);
    // A capped image is drawn scaled up: its resolution is the box over its pixels, not the view's.
    const capped = (await loaderWith().run([-10_000, -10_000, 10_000, 5_000], 1)) as { resolution: number[] };
    expect(capped.resolution[0]).toBeCloseTo(30_000 / 4096, 9);
    expect(capped.resolution[1]).toBeCloseTo(22_500 / 4096, 9);
  });

  it('asks for nothing when the view is wholly outside the extent', async () => {
    const { requests, run } = loaderWith();
    await expect(run([MERCATOR[2] + 2000, 0, MERCATOR[2] + 3000, 100], 1)).rejects.toThrow('outside');
    expect(requests).toHaveLength(0);
  });

  it('puts EPSG:4326 latitude first in WMS 1.3.0', async () => {
    const { requests, run } = loaderWith(IMAGE, 'EPSG:4326', [-180, -90, 180, 90]);
    await run([10, 55, 20, 65], 0.1);
    const query = new URL(requests[0] ?? '', 'http://x').searchParams;
    expect(query.get('CRS')).toBe('EPSG:4326');
    expect(query.get('BBOX')).toBe('52.5,7.5,67.5,22.5');
  });

  it('a failed image rejects, which leaves its area empty', async () => {
    const failing: LoadImage = () => Promise.reject(new Error('503'));
    await expect(wmsImageLoader(IMAGE, 'EPSG:3857', MERCATOR, failing)([-10, -10, 10, 10], 1, 1, () => undefined)).rejects.toThrow('503');
  });
});

describe('the engine\'s source of a WMS image', () => {
  it('is an image source in the projection', () => {
    const layer = wmsLayer({ ...SOURCE, mode: 'image' }, projectionOf('EPSG:3413'), 'wms');
    const source = (layer as ImageLayer<ImageSource>).getSource();
    expect(source?.getProjection()?.getCode()).toBe('EPSG:3413');
  });
});
