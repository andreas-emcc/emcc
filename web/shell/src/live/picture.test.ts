import type { ChangeEvent, LivePictureListener, Snapshot } from '@emc2/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { layer, layerEvent, mapObject, objectEvent } from '../testing/fakes.ts';
import { Picture } from './picture.ts';

function recorder() {
  const calls: (['snapshot', Snapshot] | ['changes', readonly ChangeEvent[]])[] = [];
  const listener: LivePictureListener = {
    snapshot: (s) => calls.push(['snapshot', s]),
    changes: (b) => calls.push(['changes', b]),
  };
  return { calls, listener };
}

const noErrors = () => {
  throw new Error('no listener should fail');
};

describe('Picture', () => {
  it('gives a subscriber nothing before the first snapshot, then the snapshot and the batches', () => {
    const picture = new Picture();
    const { calls, listener } = recorder();
    picture.subscribe(listener, noErrors);
    expect(calls).toEqual([]);

    picture.replace([layer('L')], [mapObject('a')], 7);
    picture.apply([objectEvent(8, 'b', 'create')]);

    expect(calls.map(([kind]) => kind)).toEqual(['snapshot', 'changes']);
    expect(calls[0]?.[1]).toEqual({ layers: [layer('L')], objects: [mapObject('a')], sequenceNo: 7 });
    expect(picture.sequenceNo).toBe(8);
  });

  it('applies creates, updates and deletes of objects and layers', () => {
    const picture = new Picture();
    picture.replace([layer('L')], [mapObject('a'), mapObject('b')], 1);

    picture.apply([objectEvent(2, 'c', 'create'), objectEvent(3, 'a', 'update'), objectEvent(4, 'b', 'delete'),
      layerEvent(5, 'M', 'create'), layerEvent(6, 'L', 'delete')]);

    const snapshot = picture.snapshot();
    expect(snapshot.objects.map((o) => [o.id, o.version])).toEqual([['a', 3], ['c', 2]]);
    expect(snapshot.layers.map((l) => l.id)).toEqual(['M']);
    expect(snapshot.sequenceNo).toBe(6);
  });

  it('gives a late subscriber the current state as a snapshot', () => {
    const picture = new Picture();
    picture.replace([], [mapObject('a')], 1);
    picture.apply([objectEvent(2, 'b', 'create')]);

    const { calls, listener } = recorder();
    picture.subscribe(listener, noErrors);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('snapshot');
    expect((calls[0]?.[1] as Snapshot).objects.map((o) => o.id)).toEqual(['a', 'b']);
    expect((calls[0]?.[1] as Snapshot).sequenceNo).toBe(2);
  });

  it('replaces everything with a new snapshot at any time', () => {
    const picture = new Picture();
    const { calls, listener } = recorder();
    picture.subscribe(listener, noErrors);
    picture.replace([], [mapObject('a')], 1);
    picture.replace([layer('L')], [mapObject('z')], 40);

    expect(calls.map(([kind]) => kind)).toEqual(['snapshot', 'snapshot']);
    expect(picture.snapshot().objects.map((o) => o.id)).toEqual(['z']);
    expect(picture.sequenceNo).toBe(40);
  });

  it('freezes what it shares, so no plugin can change another plugin\'s picture', () => {
    const picture = new Picture();
    const object = mapObject('a');
    picture.replace([], [object], 1);
    const batch = [objectEvent(2, 'b', 'create')];
    picture.apply(batch);

    const snapshot = picture.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.objects)).toBe(true);
    expect(Object.isFrozen(object)).toBe(true);
    expect(Object.isFrozen(batch[0]?.state)).toBe(true);
    expect(() => {
      (snapshot.objects as unknown as unknown[]).push(1);
    }).toThrow();
  });

  it('shares objects by reference and builds the snapshot once per change', () => {
    const picture = new Picture();
    const object = mapObject('a');
    picture.replace([], [object], 1);
    expect(picture.snapshot().objects[0]).toBe(object);
    expect(picture.snapshot()).toBe(picture.snapshot());
  });

  it('keeps delivering to the others when one listener throws, and reports it', () => {
    const picture = new Picture();
    const onError = vi.fn<(error: unknown, during: string) => void>();
    picture.subscribe({ snapshot: () => { throw new Error('bad'); }, changes: () => { throw new Error('worse'); } }, onError);
    const { calls, listener } = recorder();
    picture.subscribe(listener, noErrors);

    picture.replace([], [], 1);
    picture.apply([objectEvent(2, 'a', 'create')]);

    expect(calls.map(([kind]) => kind)).toEqual(['snapshot', 'changes']);
    expect(onError.mock.calls.map(([error, during]) => [(error as Error).message, during])).toEqual([['bad', 'snapshot'], ['worse', 'changes']]);
  });

  it('stops delivering after unsubscribe', () => {
    const picture = new Picture();
    const { calls, listener } = recorder();
    const unsubscribe = picture.subscribe(listener, noErrors);
    unsubscribe();
    picture.replace([], [], 1);
    expect(calls).toEqual([]);
  });
});
