import { describe, expect, it } from 'vitest';
import type { BackgroundMapProvider, VectorSource, WmsSource, XyzSource } from '@emc2/plugin-sdk';
import { createFakeVectorBackground } from '@emc2/plugin-sdk/testing';
import { CHOICES_KEY, chooseBackground, compatibleProviders, parseChoices, providerProblem, storageChoices, supportsProjection } from '../../src/core/background.ts';

const ORIGIN = 'http://127.0.0.1:8080';

function provider(id: string, overrides: Partial<XyzSource> = {}, projections: readonly string[] | 'any' = ['EPSG:3857']): BackgroundMapProvider {
  return {
    id, name: id, projections, attribution: { text: id },
    source: { type: 'xyz', url: `/api/plugins/${id}/tiles/{z}/{x}/{y}.png`, minZoom: 0, maxZoom: 19, tileSize: 256, ...overrides },
  };
}

describe('background maps', () => {
  it('accepts tiles from the emc2 server only (criterion 11)', () => {
    expect(providerProblem(provider('a'), ORIGIN)).toBeNull();
    expect(providerProblem(provider('a', { url: `${ORIGIN}/api/plugins/a/{z}/{x}/{y}.png` }), ORIGIN)).toBeNull();
    for (const url of [
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png', '//evil.example/{z}/{x}/{y}', '/\\evil.example/{z}/{x}/{y}', `${ORIGIN}.evil.example/{z}/{x}/{y}`,
      // The URL parser drops tabs and line breaks: these would become //evil.example.
      '/\t/evil.example/{z}/{x}/{y}', '/\n/evil.example/{z}/{x}/{y}', '/ /evil.example/{z}/{x}/{y}', `${ORIGIN}@evil.example/{z}/{x}/{y}`,
    ]) {
      expect(providerProblem(provider('a', { url }), ORIGIN)).toBe('the tile URL must point to the emc2 server');
    }
  });

  it('checks the template and the zoom and tile sizes', () => {
    expect(providerProblem(provider('a', { url: '/tiles/{z}/{x}.png' }), ORIGIN)).toContain('{y}');
    expect(providerProblem(provider('a', { minZoom: 5, maxZoom: 2 }), ORIGIN)).toContain('minZoom');
    expect(providerProblem(provider('a', { tileSize: 10 }), ORIGIN)).toContain('tileSize');
    expect(providerProblem(provider('a', {}, []), ORIGIN)).toContain('no projection');
    expect(providerProblem(provider('a', {}, 'any'), ORIGIN)).toContain('a list of projections');
    const unknown = { ...provider('u'), source: { type: 'wmts' } } as unknown as BackgroundMapProvider; // another plugin's data, checked at runtime
    expect(providerProblem(unknown, ORIGIN)).toBe('source type wmts is not supported');
  });

  it('checks a wms source like a tile source: on the emc2 server, with layers and a list of projections (SDK 1.3.0, criterion 58)', () => {
    const wms = (overrides: Partial<WmsSource> = {}, projections: readonly string[] | 'any' = ['EPSG:3857', 'EPSG:3413']): BackgroundMapProvider => ({
      id: 'w', name: 'w', projections, attribution: { text: 'w' },
      source: { type: 'wms', url: '/api/plugins/basemap-wms/map/topo', layers: ['relief'], version: '1.3.0', format: 'image/png', ...overrides },
    });
    expect(providerProblem(wms(), ORIGIN)).toBeNull();
    expect(providerProblem(wms({ url: `${ORIGIN}/api/plugins/basemap-wms/map/topo` }), ORIGIN)).toBeNull();
    for (const url of ['https://wms.example/ows', '//evil.example/ows', `${ORIGIN}.evil.example/ows`, '/\\evil.example/ows']) {
      expect(providerProblem(wms({ url }), ORIGIN)).toBe('the wms URL must point to the emc2 server');
    }
    expect(providerProblem(wms({ layers: [] }), ORIGIN)).toBe('a wms source needs at least one layer name');
    expect(providerProblem(wms({}, 'any'), ORIGIN)).toBe('a wms source needs a list of projections, not any');
    expect(providerProblem(wms({}, []), ORIGIN)).toBe('it supports no projection');
    expect(supportsProjection(wms(), 'EPSG:3413')).toBe(true);
    expect(supportsProjection(wms(), 'EPSG:3031')).toBe(false);
    expect(compatibleProviders([wms()], 'EPSG:3031', ORIGIN)).toEqual([]);
    expect(compatibleProviders([wms()], 'EPSG:3413', ORIGIN)).toHaveLength(1);
  });

  it('knows a provider for any projection (SDK v1, ADR-0025) and checks a vector source', () => {
    const vector = createFakeVectorBackground();
    expect(supportsProjection(vector, 'EPSG:3413')).toBe(true);
    expect(supportsProjection(provider('m'), 'EPSG:3413')).toBe(false);
    expect(providerProblem(vector, ORIGIN)).toBeNull();
    const source = vector.source as VectorSource;
    const broken = (patch: Partial<VectorSource>): BackgroundMapProvider => ({ ...vector, source: { ...source, ...patch } });
    expect(providerProblem(broken({ layers: [] }), ORIGIN)).toContain('layers');
    expect(providerProblem(broken({ layers: [{ id: 'a', style: {} }, { id: 'a', style: {} }] }), ORIGIN)).toContain('own id');
    expect(providerProblem(broken({ background: 'blue' }), ORIGIN)).toContain('colour');
    expect(compatibleProviders([vector, provider('m')], 'EPSG:3031', ORIGIN)).toEqual([vector]);
  });

  it('offers only usable providers for the current projection', () => {
    const mercator = provider('m');
    const polar = provider('p', {}, ['EPSG:3413']);
    const broken = provider('b', { url: 'https://x/{z}/{x}/{y}' });
    expect(compatibleProviders([mercator, polar, broken], 'EPSG:3857', ORIGIN)).toEqual([mercator]);
    expect(compatibleProviders([mercator, polar, broken], 'EPSG:3413', ORIGIN)).toEqual([polar]);
  });

  it('function 3: keeps the current choice where it fits; "None" fits everywhere', () => {
    const a = provider('a');
    const b = provider('b');
    expect(chooseBackground({ current: 'b', inProjection: 'a' }, [], [a, b])).toBe(b);
    expect(chooseBackground({ current: null, inProjection: 'a' }, [], [a, b])).toBeNull();
  });

  it('function 3: otherwise takes the last choice in this projection, then the preferred order, then the first', () => {
    const osm = { ...provider('basemap-osm'), name: 'OpenStreetMap' };
    const ne = createFakeVectorBackground([], { id: 'basemap-naturalearth', name: 'Natural Earth' });
    const other = provider('other');
    const preferred = ['OpenStreetMap', 'Natural Earth'];
    expect(chooseBackground({ current: 'gone', inProjection: 'other' }, preferred, [other, ne, osm])).toBe(other);
    expect(chooseBackground({ current: 'gone', inProjection: null }, preferred, [other, ne, osm])).toBeNull();
    expect(chooseBackground({ current: undefined, inProjection: undefined }, preferred, [other, ne, osm])).toBe(osm);
    // A disconnected installation has no basemap-osm: Natural Earth comes first.
    expect(chooseBackground({ current: undefined, inProjection: undefined }, preferred, [other, ne])).toBe(ne);
    // Never without a background while one is available, even if no preferred one is installed.
    expect(chooseBackground({ current: 'gone', inProjection: 'gone' }, preferred, [other])).toBe(other);
    expect(chooseBackground({ current: undefined, inProjection: undefined }, preferred, [])).toBeNull();
  });

  it('reads kept choices and drops anything malformed (it is the browser data)', () => {
    expect(parseChoices(null)).toEqual({});
    expect(parseChoices('not json')).toEqual({});
    expect(parseChoices('[1]')).toEqual({});
    expect(parseChoices(JSON.stringify({ 'EPSG:3857': 'osm', 'EPSG:3413': null, 'EPSG:3031': 7, x: '' }))).toEqual({ 'EPSG:3857': 'osm', 'EPSG:3413': null });
  });

  it('keeps the choices in browser storage, and for the page only when storage refuses', () => {
    const items = new Map<string, string>();
    const store = storageChoices(() => ({
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => {
        items.set(k, v);
      },
    }));
    store.save({ 'EPSG:3857': 'osm' });
    expect(items.get(CHOICES_KEY)).toBe('{"EPSG:3857":"osm"}');
    expect(store.load()).toEqual({ 'EPSG:3857': 'osm' });
    const refusing = storageChoices(() => {
      throw new Error('SecurityError');
    });
    expect(refusing.load()).toEqual({});
    expect(() => {
      refusing.save({ 'EPSG:3857': 'osm' });
    }).not.toThrow();
  });
});
