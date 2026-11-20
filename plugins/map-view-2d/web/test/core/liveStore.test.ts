import { describe, expect, it } from 'vitest';
import { LiveStore } from '../../src/core/liveStore.ts';
import { event, layer, symbolObject, uuid } from '../fixtures.ts';

const A = layer(1);
const B = layer(2);

function store() {
  const s = new LiveStore();
  s.snapshot({ layers: [A, B], objects: [symbolObject(10, A.id, 15, 60), symbolObject(11, A.id, 16, 61)], sequenceNo: 5 });
  return s;
}

describe('live picture store', () => {
  it('holds a snapshot', () => {
    const s = store();
    expect([...s.layers.keys()]).toEqual([A.id, B.id]);
    expect(s.objects.size).toBe(2);
    expect(s.sequenceNo).toBe(5);
  });

  it('merges changes per object: the latest state wins, one entry per object', () => {
    const s = store();
    const result = s.apply([
      event(6, { ...symbolObject(10, A.id, 17, 62), version: 2 }),
      event(7, { ...symbolObject(10, A.id, 18, 63), version: 3 }),
      event(8, { ...symbolObject(10, A.id, 19, 64), version: 4 }),
    ]);
    expect([...result.dirtyLayers]).toEqual([A.id]);
    expect(s.pendingCount(A.id)).toBe(1);
    const pending = s.takePending(A.id);
    expect(pending.size).toBe(1);
    expect(pending.get(uuid(10))?.geometry).toEqual({ type: 'Point', coordinates: [19, 64] });
    expect(s.pendingCount(A.id)).toBe(0);
  });

  it('redraws both layers when an object moves to another layer', () => {
    const s = store();
    const result = s.apply([event(6, symbolObject(10, B.id, 15, 60))]);
    expect(new Set(result.dirtyLayers)).toEqual(new Set([A.id, B.id]));
    expect(s.takePending(A.id).get(uuid(10))).toBeNull();
    expect(s.takePending(B.id).get(uuid(10))?.layerId).toBe(B.id);
  });

  it('removes a deleted object', () => {
    const s = store();
    s.apply([event(6, null, { id: uuid(11), type: 'object' })]);
    expect(s.objects.has(uuid(11))).toBe(false);
    expect(s.takePending(A.id).get(uuid(11))).toBeNull();
  });

  it('skips events the snapshot already contains', () => {
    const s = store();
    const result = s.apply([event(5, symbolObject(10, A.id, 0, 0))]);
    expect(result.dirtyLayers.size).toBe(0);
    expect(s.objects.get(uuid(10))?.geometry).toEqual({ type: 'Point', coordinates: [15, 60] });
  });

  it('reports layer changes (created, reordered, deleted)', () => {
    const s = store();
    expect(s.apply([event(6, { ...B, drawOrder: 9, version: 2 })]).layersChanged).toBe(true);
    expect(s.layers.get(B.id)?.drawOrder).toBe(9);
    s.apply([event(7, null, { id: B.id, type: 'layer' })]);
    expect(s.layers.has(B.id)).toBe(false);
  });

  it('a second snapshot replaces everything, including what was waiting', () => {
    const s = store();
    s.apply([event(6, symbolObject(12, A.id, 1, 2))]);
    s.snapshot({ layers: [B], objects: [symbolObject(20, B.id, 15, 60)], sequenceNo: 100 });
    expect([...s.layers.keys()]).toEqual([B.id]);
    expect([...s.objects.keys()]).toEqual([uuid(20)]);
    expect(s.pendingCount(A.id)).toBe(0);
    expect(s.apply([event(50, symbolObject(21, B.id, 0, 0))]).dirtyLayers.size).toBe(0);
  });

  it('groups the objects by layer', () => {
    const groups = store().objectsByLayer();
    expect(groups.get(A.id)?.map((o) => o.id)).toEqual([uuid(10), uuid(11)]);
    expect(groups.has(B.id)).toBe(false);
  });

  it('knows the layers that only objects name, until their last object leaves', () => {
    const s = new LiveStore();
    const lost = uuid(99);
    s.snapshot({ layers: [A], objects: [symbolObject(10, lost, 15, 60), symbolObject(10, lost, 15, 60), symbolObject(11, lost, 15, 60)], sequenceNo: 1 });
    expect(s.unknownLayers()).toEqual([lost]);
    s.apply([event(2, symbolObject(10, A.id, 15, 60))]);
    expect(s.unknownLayers()).toEqual([lost]);
    s.apply([event(3, symbolObject(11, A.id, 15, 60))]);
    expect(s.unknownLayers()).toEqual([]);
  });
});
