import { describe, expect, it } from 'vitest';
import {
  changeRequests, expiresAt, viewportArea, GENERAL_DATA_TYPE, MANUAL_DATA_SOURCE, OutcomeUnknownError, PERMISSIONS, SYMBOLS, type MapObject, type MapObjectContent,
} from '../src/index.ts';
import {
  createFakeContext, createFakeCoordinateService, createFakeMapView, createFakeSymbolService, createFakeUser, createFakeVectorBackground,
} from '../src/testing/index.ts';

const LAYER = '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e01';

function symbolContent(label = { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' }): MapObjectContent {
  return {
    type: 'core.symbol', dataType: 'core.general', dataSource: 'manual', layerId: LAYER, geometry: { type: 'Point', coordinates: [18.0686, 59.3293] },
    symbol: { standard: 'APP-6D', sidc: '10031000001211000000' }, label,
  };
}

describe('createFakeContext', () => {
  it('fills requestId and source like the shell, and applies by default', async () => {
    const ctx = createFakeContext({ pluginId: 'draw-symbols' });
    const outcome = await ctx.changes.submit(changeRequests.createObject(ctx.newId(), symbolContent(ctx.defaultLabel)));
    expect(ctx.submitted).toHaveLength(1);
    expect(ctx.submitted[0]?.source).toEqual({ plugin: 'draw-symbols' });
    expect(outcome.outcome).toBe('applied');
    if (outcome.outcome === 'applied') {
      expect(outcome.event.version).toBe(1);
      expect(outcome.event.previousVersion).toBeNull();
      expect(outcome.event.requestId).toBe(ctx.submitted[0]?.requestId);
    }
  });

  it('answers with a rejection or "outcome unknown" when told to', async () => {
    const ctx = createFakeContext();
    ctx.answerWith((r) => ({
      outcome: 'rejected',
      rejection: { requestId: r.requestId, entityType: r.entityType, operation: r.operation, entityId: r.entityId, code: 'LAYER_NOT_EMPTY', message: 'not empty', at: '2026-10-05T09:05:00.000Z' },
    }));
    const outcome = await ctx.changes.submit({ entityType: 'layer', operation: 'delete', entityId: LAYER });
    expect(outcome.outcome === 'rejected' && outcome.rejection.code).toBe('LAYER_NOT_EMPTY');
    ctx.answerWith(() => 'unknown');
    await expect(ctx.changes.submit({ entityType: 'layer', operation: 'delete', entityId: LAYER })).rejects.toBeInstanceOf(OutcomeUnknownError);
  });

  it('feeds snapshots and batches to subscribers, a new snapshot at any time', () => {
    const ctx = createFakeContext();
    const seen: string[] = [];
    const off = ctx.livePicture.subscribe({ snapshot: (s) => seen.push(`snapshot ${s.objects.length}`), changes: (b) => seen.push(`batch ${b.length}`) });
    ctx.live.snapshot({});
    ctx.live.changes([]);
    ctx.live.snapshot({});
    off();
    ctx.live.changes([]);
    expect(seen).toEqual(['snapshot 0', 'batch 0', 'snapshot 0']);
  });

  it('resolves services when they are provided, and refuses keys outside "provides"', async () => {
    const ctx = createFakeContext({ pluginId: 'draw-symbols', provides: [] });
    const pending = ctx.services.get(SYMBOLS);
    ctx.provideAs(SYMBOLS, createFakeSymbolService());
    const symbols = await pending;
    expect(symbols.validate('APP-6E', '130310000012110000000000000752').valid).toBe(true);
    expect(symbols.validate('APP-6D', '13031000001211000000').valid).toBe(false);
    expect(() => ctx.services.provide(SYMBOLS, createFakeSymbolService())).toThrow(/provides/);
  });
});

describe('fake services', () => {
  it('map view interactions resolve from the test', async () => {
    const map = createFakeMapView({ renderingMode: 'software' });
    const picked = map.pickPoint();
    map.completeInteraction([15.654321, 60.123456]);
    await expect(picked).resolves.toEqual([15.654321, 60.123456]);
    map.selection.set(['a']);
    expect(map.selection.value).toEqual(['a']);
    expect(map.renderingMode).toBe('software');
  });

  it('coordinate fake keeps longitude first (latitude ≠ longitude)', () => {
    const coords = createFakeCoordinateService();
    expect(coords.parse('60.123456 N 15.654321 E')).toEqual({ position: [15.654321, 60.123456] });
    expect(coords.format([15.654321, 60.123456])).toBe('60.123456 N 15.654321 E');
    expect(coords.parse('95 N 15 E')).toEqual({ error: 'out of range' });
  });
});

describe('SDK v1 in the fake context', () => {
  it('has the no-login user by default, and a user with given permissions', () => {
    expect(createFakeContext().user.has(PERMISSIONS.settingsAdmin)).toBe(true);
    expect(createFakeContext().user.noLogin).toBe(true);
    const reader = createFakeContext({ user: createFakeUser({ permissions: [PERMISSIONS.layersEdit] }) }).user;
    expect(reader.has(PERMISSIONS.layersEdit)).toBe(true);
    expect(reader.has(PERMISSIONS.objectsEdit)).toBe(false);
    expect(reader.noLogin).toBe(false);
  });

  it('lists core.general first among the data types', () => {
    const ctx = createFakeContext({ dataTypes: [{ id: 'cot-in.cot', name: 'CoT', declaredBy: 'cot-in', defaults: { fadeWhenExpired: true } }] });
    expect(ctx.dataTypes.map((t) => t.id)).toEqual([GENERAL_DATA_TYPE, 'cot-in.cot']);
    expect(createFakeContext().dataTypes.map((t) => t.id)).toEqual(['core.general']);
  });

  it('changes settings and tells the listeners', () => {
    const ctx = createFakeContext({ settings: { size: 30 } });
    const seen: unknown[] = [];
    const stop = ctx.onSettingsChange((s) => seen.push(s));
    ctx.changeSettings({ size: 40 });
    stop();
    ctx.changeSettings({ size: 50 });
    expect(ctx.settings).toEqual({ size: 50 });
    expect(seen).toEqual([{ size: 40 }]);
  });

  it('rejects get on a uses key without a provider at once, and resolves it with one', async () => {
    const without = createFakeContext({ uses: ['emc2.symbols'] });
    await expect(without.services.get(SYMBOLS)).rejects.toThrow('no loaded plugin provides');
    const withIt = createFakeContext({ uses: ['emc2.symbols'] });
    const symbols = createFakeSymbolService();
    withIt.provideAs(SYMBOLS, symbols);
    await expect(withIt.services.get(SYMBOLS)).resolves.toBe(symbols);
  });

  it('gives the web base and keeps an external identity on create', async () => {
    const ctx = createFakeContext({ pluginId: 'cot-in' });
    expect(ctx.webBase).toBe('/plugins/cot-in/web/');
    const ref = { system: 'cot', id: 'ANDROID-1' };
    const outcome = await ctx.changes.submit(changeRequests.createObject(ctx.newId(), symbolContent(ctx.defaultLabel), ref));
    expect(outcome.outcome).toBe('applied');
    if (outcome.outcome === 'applied') expect((outcome.event.state as MapObject).meta.externalRef).toEqual(ref);
    expect(symbolContent().dataSource).toBe(MANUAL_DATA_SOURCE);
  });

  it('builds a vector background whose data loads on demand', async () => {
    const background = createFakeVectorBackground([{ layer: 'land', geometry: { type: 'Polygon', coordinates: [[[10, 50], [20, 50], [20, 60], [10, 50]]] } }]);
    expect(background.projections).toBe('any');
    expect(background.loadCalls).toBe(0);
    if (background.source.type !== 'vector') throw new Error('not a vector source');
    const data = await background.source.load();
    expect(data.features).toHaveLength(1);
    expect(background.loadCalls).toBe(1);
  });
});

describe('areas of interest and clusters (spike S3)', () => {
  it('records the options and feeds area changes and clusters to listeners that take them', () => {
    const ctx = createFakeContext();
    const seen: string[] = [];
    ctx.livePicture.subscribe({
      snapshot: () => seen.push('snapshot'),
      changes: () => seen.push('changes'),
      area: (c) => seen.push(`area +${c.entered.length} -${c.left.length}`),
      clusters: (u) => seen.push(`clusters ${u.full ? 'full' : 'diff'} ${u.upsert.length}`),
    }, { area: 'viewport', budget: 10_000 });
    const stop = ctx.livePicture.subscribe({ snapshot: () => seen.push('plain snapshot'), changes: () => {} });
    ctx.livePicture.subscribe({ snapshot: () => {}, changes: () => {}, area: () => seen.push('area without an area option') });
    expect(ctx.liveSubscriptions).toEqual([{ area: 'viewport', budget: 10_000 }, {}, {}]);
    stop();
    ctx.live.snapshot({});
    ctx.live.area({ sequenceNo: 3, entered: [], left: ['0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e11'] });
    ctx.live.clusters({
      level: 6, full: true, remove: [],
      upsert: [{ cell: 'f2-6-31-17', position: [18.1, 59.3], count: 120, byLayer: {}, byIdentity: { friend: 100, hostile: 20, neutral: 0, unknown: 0 } }],
    });
    expect(seen).toEqual(['snapshot', 'area +0 -1', 'clusters full 1']);
  });

  it('makes a viewport area with half the half diagonal as margin', () => {
    const ring = [[10, 50], [20, 50], [20, 60], [10, 50]] as const;
    const area = viewportArea({ center: [17, 53], resolution: 1000, projection: 'EPSG:3857', visibleArea: ring });
    expect(area).toEqual({ ring, inside: [17, 53], margin: { share: 0.5 } });
  });
});

describe('ACA review T-035', () => {
  const object = (time: MapObject['time'], modified = '2026-10-03T08:00:00.000Z'): MapObject => ({
    ...symbolContent(), id: '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e11', version: 1, ...(time ? { time } : {}),
    meta: { created: { at: modified, by: { plugin: 'cot-in' } }, modified: { at: modified, by: { plugin: 'cot-in' } } },
  });

  it('B1: a data type carries its effective behaviour, which can change', () => {
    const ctx = createFakeContext({ dataTypes: [{ id: 'cot-in.cot', name: 'CoT', declaredBy: 'cot-in', defaults: { fadeWhenExpired: true, removeAfterExpirySeconds: 600 } }] });
    expect(ctx.dataTypes[1]?.behaviour).toEqual({ fadeWhenExpired: true, removeAfterExpirySeconds: 600 });
    const seen: unknown[] = [];
    ctx.onDataTypesChange((types) => seen.push(types[1]?.behaviour));
    ctx.changeDataTypeBehaviour('cot-in.cot', { fadeWhenExpired: false });
    expect(ctx.dataTypes[1]?.behaviour).toEqual({ fadeWhenExpired: false });
    expect(ctx.dataTypes[1]?.defaults).toEqual({ fadeWhenExpired: true, removeAfterExpirySeconds: 600 });
    expect(seen).toEqual([{ fadeWhenExpired: false }]);
    expect(() => ctx.changeDataTypeBehaviour('nobody.thing', {})).toThrow();
  });

  it('B1: expiresAt follows model rule 15', () => {
    expect(expiresAt(object({ expires: '2026-10-03T08:25:00.000Z' }), { expiresAfterSeconds: 60 })).toBe('2026-10-03T08:25:00.000Z');
    expect(expiresAt(object({ observed: '2026-10-03T08:20:00.000Z' }), { expiresAfterSeconds: 60 })).toBe('2026-10-03T08:21:00.000Z');
    // SDK 1.5.0 (CR-0038 point 9): without time.observed an object does not expire by its data type.
    expect(expiresAt(object(undefined), { expiresAfterSeconds: 60 })).toBeNull();
    expect(expiresAt(object(undefined), {})).toBeNull();
  });

  it('B2: objects: false gives layers and counts per layer, never objects', () => {
    const ctx = createFakeContext();
    const got: unknown[] = [];
    ctx.livePicture.subscribe({
      snapshot: (s) => got.push(['snapshot', s.objects.length, s.objectCounts]),
      changes: (b) => got.push(['changes', b.map((e) => e.entityType)]),
      counts: (c) => got.push(['counts', c]),
    }, { objects: false });
    const o = object(undefined);
    ctx.live.snapshot({ objects: [o, { ...o, id: '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e12' }] });
    const layerEvent = { entityType: 'layer' } as never;
    const objectEvent = { entityType: 'object' } as never;
    ctx.live.changes([objectEvent]);
    ctx.live.changes([objectEvent, layerEvent]);
    ctx.live.counts({ [LAYER]: 3 });
    expect(got).toEqual([['snapshot', 0, { [LAYER]: 2 }], ['changes', ['layer']], ['counts', { [LAYER]: 3 }]]);
  });
});
