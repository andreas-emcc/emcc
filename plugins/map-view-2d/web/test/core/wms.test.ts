import { describe, expect, it } from 'vitest';
import type { WmsSource } from '@emc2/plugin-sdk';
import { wmsGetMapUrl } from '@emc2/plugin-sdk/testing';
import { clipBox, imageSize, MAX_WMS_SIDE, wmsGrid, wmsRequestUrl, wmsSourceProblem, type Box } from '../../src/core/wms.ts';

const SOURCE: WmsSource = { type: 'wms', url: '/api/plugins/basemap-wms/map/topo', layers: ['relief', 'roads'], version: '1.3.0', format: 'image/png', transparent: true };

describe('WMS requests (brief function 3, criteria 55 and 56)', () => {
  it('are the test kit\'s wmsGetMapUrl, for both versions, both formats and every projection', () => {
    const boxes: Box[] = [[-20037508.342789244, -20037508.342789244, 0, 0], [10, 55, 20, 65], [-4194304, 0, 0, 4194304]];
    const sources: WmsSource[] = [
      SOURCE,
      { ...SOURCE, version: '1.1.1' },
      { ...SOURCE, format: 'image/jpeg', transparent: false },
      { type: 'wms', url: SOURCE.url, layers: ['a'], version: '1.3.0', format: 'image/png' },
      { ...SOURCE, url: '/map?x=1' },
    ];
    for (const source of sources) {
      for (const code of ['EPSG:3857', 'EPSG:4326', 'EPSG:3413']) {
        for (const box of boxes) {
          expect(wmsRequestUrl(source, code, box, 256, 128)).toBe(wmsGetMapUrl(source, { projection: code, bbox: [...box], width: 256, height: 128 }));
        }
      }
    }
  });

  it('send EPSG:4326 latitude first in WMS 1.3.0 with CRS, and longitude first in 1.1.1 with SRS (criterion 56)', () => {
    const query = (source: WmsSource) => new URL(wmsRequestUrl(source, 'EPSG:4326', [10, 55, 20, 65], 256, 256), 'http://x').searchParams;
    expect(query(SOURCE).get('BBOX')).toBe('55,10,65,20');
    expect(query(SOURCE).get('CRS')).toBe('EPSG:4326');
    expect(query(SOURCE).has('SRS')).toBe(false);
    const old = query({ ...SOURCE, version: '1.1.1' });
    expect(old.get('BBOX')).toBe('10,55,20,65');
    expect(old.get('SRS')).toBe('EPSG:4326');
    expect(old.has('CRS')).toBe(false);
    // Only EPSG:4326 is latitude first: the same box in another code stays x, y.
    expect(new URL(wmsRequestUrl(SOURCE, 'EPSG:3857', [10, 55, 20, 65], 256, 256), 'http://x').searchParams.get('BBOX')).toBe('10,55,20,65');
  });

  it('carry each parameter once and nothing else', () => {
    const names = [...new URL(wmsRequestUrl(SOURCE, 'EPSG:3857', [0, 0, 1, 1], 256, 256), 'http://x').searchParams.keys()];
    expect([...names].sort()).toEqual(['BBOX', 'CRS', 'FORMAT', 'HEIGHT', 'LAYERS', 'REQUEST', 'SERVICE', 'STYLES', 'TRANSPARENT', 'VERSION', 'WIDTH']);
  });
});

describe('WMS tiles and images', () => {
  it('cut a square extent into one tile and a 2:1 extent into two; an extent not in a whole-number ratio has none', () => {
    expect(wmsGrid([-20037508.342789244, -20037508.342789244, 20037508.342789244, 20037508.342789244])).toEqual({ columns: 1, rows: 1, ground: 40075016.685578488 });
    expect(wmsGrid([-180, -90, 180, 90])).toEqual({ columns: 2, rows: 1, ground: 180 });
    expect(wmsGrid([0, 0, 90, 360])).toEqual({ columns: 1, rows: 4, ground: 90 });
    expect(wmsGrid([0, 0, 3, 2])).toBeNull();
    expect(wmsGrid([0, 0, 100, 1])).toBeNull(); // more than 16 to 1
    expect(wmsGrid([0, 0, 0, 1])).toBeNull();
  });

  it('are cut at the extent', () => {
    const extent: Box = [-10, -10, 10, 10];
    expect(clipBox([-20, 0, 5, 30], extent)).toEqual([-10, 0, 5, 10]);
    expect(clipBox([-5, -5, 5, 5], extent)).toEqual([-5, -5, 5, 5]);
    expect(clipBox([11, 0, 20, 5], extent)).toBeNull();
    expect(clipBox([10, 0, 20, 5], extent)).toBeNull(); // only the edge
  });

  it('have whole-number sizes from 1 to 4 096 (criterion 57)', () => {
    expect(imageSize([0, 0, 1000, 500], 1)).toEqual([1000, 500]);
    expect(imageSize([0, 0, 1000.4, 500.6], 1)).toEqual([1000, 501]);
    expect(imageSize([0, 0, 0.001, 1], 1)).toEqual([1, 1]);
    expect(imageSize([0, 0, 100_000, 3000], 1)).toEqual([MAX_WMS_SIDE, 3000]);
    expect(imageSize([0, 0, 100_000, 90_000], 1)).toEqual([MAX_WMS_SIDE, MAX_WMS_SIDE]);
  });
});

describe('a wms source is checked before it is offered (criterion 58)', () => {
  it('accepts the SDK\'s example and its options', () => {
    expect(wmsSourceProblem(SOURCE)).toBeNull();
    expect(wmsSourceProblem({ ...SOURCE, mode: 'image', tileSize: 1024 })).toBeNull();
    expect(wmsSourceProblem({ ...SOURCE, version: '1.1.1', format: 'image/jpeg', transparent: false })).toBeNull();
  });

  it('names what is wrong', () => {
    const wrong = (overrides: Record<string, unknown>) => wmsSourceProblem({ ...SOURCE, ...overrides });
    expect(wrong({ layers: [] })).toBe('a wms source needs at least one layer name');
    expect(wrong({ layers: [''] })).toBe('a wms source needs at least one layer name');
    expect(wrong({ layers: 'relief' })).toBe('a wms source needs at least one layer name');
    expect(wrong({ version: '1.0.0' })).toBe('the wms version must be 1.1.1 or 1.3.0');
    expect(wrong({ format: 'image/gif' })).toBe('the wms format must be image/png or image/jpeg');
    expect(wrong({ transparent: 'yes' })).toBe('transparent must be true or false');
    expect(wrong({ format: 'image/jpeg' })).toBe('transparent needs the format image/png');
    expect(wrong({ mode: 'mosaic' })).toBe("mode must be 'tiles' or 'image'");
    expect(wrong({ tileSize: 63 })).toBe('tileSize must be a whole number from 64 to 1024');
    expect(wrong({ tileSize: 1025 })).toBe('tileSize must be a whole number from 64 to 1024');
    expect(wrong({ tileSize: 256.5 })).toBe('tileSize must be a whole number from 64 to 1024');
  });
});
