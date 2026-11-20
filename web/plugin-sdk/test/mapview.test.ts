import { describe, expect, it } from 'vitest';
import type { ObjectListService } from '../src/index.ts';
import { MAX_SELECTION, NotOnMapError, OBJECT_LIST, USER_DOCUMENT_LIMITS, USER_DOCUMENT_NAME, UserDocumentError } from '../src/index.ts';
import { createFakeContext, createFakeMapView } from '../src/testing/index.ts';

const id = (n: number) => `0192a5c4-3b1e-7c2d-9f00-${n.toString(16).padStart(12, '0')}`;

describe('MapView 1.1.0 in the fake (CR-0015 items 11 to 15)', () => {
  it('goTo moves the viewport and tells the listeners (latitude ≠ longitude)', () => {
    const map = createFakeMapView();
    const seen: unknown[] = [];
    map.onViewportChange((v) => seen.push(v.center));
    map.goTo([18.07, 59.33], 120);
    expect(map.viewport.center).toEqual([18.07, 59.33]);
    expect(map.viewport.resolution).toBe(120);
    expect(seen).toEqual([[18.07, 59.33]]);
    expect(map.goToCalls).toEqual([{ center: [18.07, 59.33], resolution: 120 }]);
  });

  it('keeps at most 1 000 ids in the selection, and counts the cut', () => {
    const map = createFakeMapView();
    map.selection.set(Array.from({ length: MAX_SELECTION + 5 }, (_, i) => id(i)));
    expect(map.selection.value).toHaveLength(MAX_SELECTION);
    expect(map.selection.value[0]).toBe(id(0));
    expect(map.selectionWarnings).toBe(1);
  });

  it('draws and edits one interaction at a time; a new one ends the running one with null', async () => {
    const map = createFakeMapView();
    const first = map.draw('rectangle');
    expect(map.runningInteraction).toBe('draw:rectangle');
    const second = map.draw('circle', { style: { strokeColor: '#1F3A93' } });
    await expect(first).resolves.toBeNull();
    map.completeDrawing({ type: 'Circle', center: [18.07, 59.33], radius: 5000 });
    await expect(second).resolves.toEqual({ type: 'Circle', center: [18.07, 59.33], radius: 5000 });
    expect(map.runningInteraction).toBeNull();
    const point = map.pickPoint();
    map.completeDrawing({ type: 'Point', coordinates: [0, 0] });
    expect(map.runningInteraction).toBe('pickPoint');
    map.completeInteraction([18.07, 59.33]);
    await expect(point).resolves.toEqual([18.07, 59.33]);
  });

  it('refuses to edit an object it does not draw', async () => {
    const map = createFakeMapView();
    map.setNotDrawn([id(1)]);
    await expect(map.edit(id(1))).rejects.toBeInstanceOf(NotOnMapError);
    const editing = map.edit(id(2));
    map.completeDrawing(null);
    await expect(editing).resolves.toBeNull();
  });

  it('records centre on and zoom to', async () => {
    const map = createFakeMapView();
    await expect(map.centreOn([id(1), id(2)])).resolves.toEqual({ missing: [] });
    await map.zoomTo([id(3)]);
    expect([map.centreOnCalls, map.zoomToCalls]).toEqual([[[id(1), id(2)]], [[id(3)]]]);
  });

  it('switches the map type, and falls back for what is not available', () => {
    const map = createFakeMapView({ backgrounds: ['osm', 'natural-earth'] });
    const seen: unknown[] = [];
    map.onMapTypeChange((m) => seen.push(m));
    expect(map.mapType).toEqual({ projection: 'EPSG:3857', background: 'osm' });
    expect(map.setMapType({ projection: 'EPSG:3413', background: 'natural-earth' })).toEqual({ projection: 'EPSG:3413', background: 'natural-earth' });
    expect(map.viewport.projection).toBe('EPSG:3413');
    expect(map.setMapType({ projection: 'EPSG:9999', background: 'gone' })).toEqual({ projection: 'EPSG:3413', background: 'osm' });
    expect(seen).toHaveLength(2);
  });

  it('tells visibility listeners only about real changes', () => {
    const map = createFakeMapView();
    const seen: unknown[] = [];
    map.onLayerVisibilityChange((layer, visible) => seen.push([layer, visible]));
    map.setLayerVisible(id(7), true);
    map.setLayerVisible(id(7), false);
    map.setLayerVisible(id(7), false);
    expect(seen).toEqual([[id(7), false]]);
  });
});

describe('the object-list service key (CR-0015 item 16)', () => {
  it('is emc2.object-list, and a uses key rejects at once without object-list', async () => {
    expect(OBJECT_LIST.id).toBe('emc2.object-list');
    const ctx = createFakeContext({ pluginId: 'layer-panel', uses: [OBJECT_LIST.id] });
    await expect(ctx.services.get(OBJECT_LIST)).rejects.toThrow(/no loaded plugin provides/);
    const opened: string[] = [];
    const service: ObjectListService = { open: (layerId) => void opened.push(layerId) };
    ctx.provideAs(OBJECT_LIST, service);
    (await ctx.services.get(OBJECT_LIST)).open(id(1));
    expect(opened).toEqual([id(1)]);
  });
});

describe('user documents (ADR-0027, CR-0015 item 17)', () => {
  it('reads, writes, lists and deletes the user\'s documents', async () => {
    const ctx = createFakeContext({ pluginId: 'bookmarks' });
    expect(await ctx.userDocuments.get('tree')).toBeNull();
    await ctx.userDocuments.put('tree', { folders: [{ name: 'Arctic', bookmarks: [] }] });
    await ctx.userDocuments.put('settings.v1', 3);
    expect(await ctx.userDocuments.list()).toEqual(['settings.v1', 'tree']);
    expect(await ctx.userDocuments.get('tree')).toEqual({ folders: [{ name: 'Arctic', bookmarks: [] }] });
    await ctx.userDocuments.delete('tree');
    await ctx.userDocuments.delete('tree');
    expect(ctx.storedUserDocuments).toEqual({ 'settings.v1': 3 });
  });

  it('refuses bad names, documents over 256 KiB and a 201st document', async () => {
    const ctx = createFakeContext();
    expect(USER_DOCUMENT_NAME.test('Tree')).toBe(false);
    await expect(ctx.userDocuments.put('Tree', 1)).rejects.toMatchObject({ problem: 'bad-name' });
    await expect(ctx.userDocuments.put('big', 'x'.repeat(USER_DOCUMENT_LIMITS.maxBytes))).rejects.toMatchObject({ problem: 'too-large' });
    for (let i = 0; i < USER_DOCUMENT_LIMITS.maxDocuments; i++) await ctx.userDocuments.put(`d${i}`, i);
    await expect(ctx.userDocuments.put('one-more', 0)).rejects.toMatchObject({ problem: 'too-many' });
    await ctx.userDocuments.put('d0', 'replacing is fine');
  });

  it('refuses a write that takes the user over 4 MiB, and fails like a lost connection', async () => {
    const ctx = createFakeContext();
    const quarter = 'x'.repeat(USER_DOCUMENT_LIMITS.maxBytes - 10);
    for (let i = 0; i < 16; i++) await ctx.userDocuments.put(`part${i}`, quarter);
    await expect(ctx.userDocuments.put('part16', quarter)).rejects.toMatchObject({ problem: 'user-full' });
    ctx.failUserDocuments(true);
    await expect(ctx.userDocuments.get('part0')).rejects.toBeInstanceOf(UserDocumentError);
  });
});
