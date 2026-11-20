// SDK 1.3.0 step 1 (CR-0028 parts 2 and 4; ADR-0042): the fake's layer lock, and the fake map
// view's right click.
import { describe, expect, it } from 'vitest';
import { changeRequests, type ChangeOutcome, type Layer, type LayerContent, type MapObject, type MapObjectContent } from '../src/index.ts';
import { createFakeContext, createFakeMapView } from '../src/testing/index.ts';

const label = { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' };
const meta = { created: { at: '2026-01-01T00:00:00Z', by: { plugin: 'layer-panel' } }, modified: { at: '2026-01-01T00:00:00Z', by: { plugin: 'layer-panel' } } };
const OPEN: Layer = { id: '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e01', version: 1, meta, name: 'Open', drawOrder: 1, visible: true, label };
const LOCKED: Layer = { ...OPEN, id: '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e02', name: 'Planned', locked: true };

// lon differs from lat, so a swapped order would show
function object(id: string, layerId: string): MapObject {
  return {
    id, version: 1, meta, type: 'core.symbol', dataType: 'core.general', dataSource: 'manual', layerId,
    geometry: { type: 'Point', coordinates: [18.0723, 59.3311] }, symbol: { standard: 'APP-6D', sidc: '10061000001211000000' }, label,
  };
}
const IN_LOCKED = object('0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e16', LOCKED.id);
const IN_OPEN = object('0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e17', OPEN.id);

function contentOf(o: MapObject, layerId = o.layerId): MapObjectContent {
  const { id: _id, version: _v, meta: _m, ...rest } = o;
  return { ...rest, layerId };
}
function layerContent(l: Layer, change: Partial<LayerContent> = {}): LayerContent {
  const { id: _id, version: _v, meta: _m, ...rest } = l;
  return { ...rest, ...change };
}
function refused(outcome: ChangeOutcome): { code: string; path: string | undefined; problem: string | undefined } {
  if (outcome.outcome !== 'rejected') return { code: 'applied', path: undefined, problem: undefined };
  return { code: outcome.rejection.code, path: outcome.rejection.details?.[0]?.path, problem: outcome.rejection.details?.[0]?.problem };
}

function context() {
  const ctx = createFakeContext({ pluginId: 'draw-symbols' });
  ctx.live.snapshot({ layers: [OPEN, LOCKED], objects: [IN_LOCKED, IN_OPEN] });
  return ctx;
}

describe('the layer lock in the fake (SDK 1.3.0, ADR-0042)', () => {
  it('refuses a change to a locked layer\'s objects, with the layer named and the path of N2', async () => {
    const ctx = context();
    const named = { code: 'LAYER_LOCKED', problem: `layer ${LOCKED.id} is locked` };
    expect(refused(await ctx.changes.submit(changeRequests.createObject(ctx.newId(), contentOf(IN_OPEN, LOCKED.id))))).toEqual({ ...named, path: '/data/layerId' });
    expect(refused(await ctx.changes.submit(changeRequests.updateObject(IN_LOCKED, contentOf(IN_LOCKED))))).toEqual({ ...named, path: '/data/layerId' });
    expect(refused(await ctx.changes.submit(changeRequests.updateObject(IN_OPEN, contentOf(IN_OPEN, LOCKED.id))))).toEqual({ ...named, path: '/data/layerId' });
    expect(refused(await ctx.changes.submit(changeRequests.updateObject(IN_LOCKED, contentOf(IN_LOCKED, OPEN.id))))).toEqual({ ...named, path: '' });
    expect(refused(await ctx.changes.submit(changeRequests.deleteObject(IN_LOCKED)))).toEqual({ ...named, path: '' });
    expect((await ctx.changes.submit(changeRequests.updateObject(IN_OPEN, contentOf(IN_OPEN)))).outcome).toBe('applied');
  });

  it('lets a locked layer change only its lock and draw order, and never refuses a create', async () => {
    const ctx = context();
    const submit = async (data: LayerContent) => refused(await ctx.changes.submit(changeRequests.updateLayer(LOCKED, data))).code;
    expect(await submit(layerContent(LOCKED, { drawOrder: 7.5 }))).toBe('applied');
    const { locked: _l, ...withoutLock } = layerContent(LOCKED, { drawOrder: 2 });
    expect(await submit(withoutLock), 'an absent lock is kept').toBe('applied');
    expect(await submit(layerContent(LOCKED, { locked: false }))).toBe('applied');
    expect(await submit(layerContent(LOCKED, { name: 'Renamed' }))).toBe('LAYER_LOCKED');
    expect(await submit(layerContent(LOCKED, { name: 'Renamed', locked: false })), 'unlock first').toBe('LAYER_LOCKED');
    expect(await submit(layerContent(LOCKED, { visible: false }))).toBe('LAYER_LOCKED');
    expect(await submit(layerContent(LOCKED, { extensions: { 'draw-symbols': { note: 'x' } } }))).toBe('LAYER_LOCKED');
    expect(await submit(layerContent(LOCKED, { extensions: { 'other-plugin': { note: 'x' } } })), 'another namespace is kept (rule 5)').toBe('applied');
    expect(refused(await ctx.changes.submit(changeRequests.deleteLayer(LOCKED))).code).toBe('LAYER_LOCKED');
    expect(refused(await ctx.changes.submit(changeRequests.createLayer(ctx.newId(), layerContent(LOCKED)))).code, 'N3').toBe('applied');
  });

  it('follows the layers the test sends, and comes before the declared fields', async () => {
    const ctx = context();
    const { locked: _locked, ...unlocked } = LOCKED;
    ctx.live.changes([{
      sequenceNo: 2, requestId: ctx.newId(), entityType: 'layer', operation: 'update', entityId: LOCKED.id, version: 2, previousVersion: 1,
      state: { ...unlocked, version: 2 }, label, at: '2026-01-01T00:00:01Z', by: { plugin: 'layer-panel' },
    }]);
    expect((await ctx.changes.submit(changeRequests.deleteObject(IN_LOCKED))).outcome, 'unlocked by an event').toBe('applied');
    ctx.live.snapshot({ layers: [OPEN, LOCKED], objects: [IN_LOCKED] });
    const withField = { ...changeRequests.updateObject(IN_LOCKED, contentOf(IN_LOCKED)), fields: [{ plugin: 'nobody', name: 'x', value: 1 }] };
    expect(refused(await ctx.changes.submit(withField)).code).toBe('LAYER_LOCKED');
  });
});

describe('the fake map view\'s right click (SDK 1.3.0)', () => {
  it('ends pickPoint and draw with null, and leaves edit and dragObject running', async () => {
    const map = createFakeMapView();
    const point = map.pickPoint();
    map.rightClick();
    expect(await point).toBeNull();
    const drawing = map.draw('polygon');
    map.rightClick();
    expect(await drawing).toBeNull();
    void map.edit('0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e16');
    map.rightClick();
    expect(map.runningInteraction).toBe('edit');
    map.completeDrawing(null);
    void map.dragObject('0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e16');
    map.rightClick();
    expect(map.runningInteraction).toBe('dragObject');
  });
});
