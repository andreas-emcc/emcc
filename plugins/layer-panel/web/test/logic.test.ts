import { describe, expect, it, vi } from 'vitest';
import { MAP_VIEW, uuidv7 } from '@emc2/plugin-sdk';
import type { ChangeEvent, ChangeRequest, Layer } from '@emc2/plugin-sdk';
import { appliedEvent, createFakeContext, createFakeMapView, createFakeUser } from '@emc2/plugin-sdk/testing';
import { CREATE, LayerPanelController, PENDING_TIMEOUT_MS } from '../src/controller.ts';
import { LayerTracker } from '../src/layerState.ts';
import { contentOf, drawOrderOnTop, nextLayerName, planMove, topFirst } from '../src/order.ts';
import { assertSchemaValid, FakeServer, LABEL, layer } from './fakeServer.ts';

const names = (layers: readonly Layer[]) => layers.map((l) => l.name);

describe('order', () => {
  it('sorts top first, ties broken by the higher id on top', () => {
    const low = { ...layer('low', 1), id: '00000000-0000-7000-8000-000000000001' };
    const high = { ...layer('high', 1), id: '00000000-0000-7000-8000-000000000002' };
    expect(names(topFirst([layer('bottom', -3), low, high, layer('top', 9.5)]))).toEqual(['top', 'high', 'low', 'bottom']);
  });

  it('moves to the midpoint, or one beyond the top or the bottom', () => {
    const layers = topFirst([layer('A', 4), layer('B', 2), layer('C', 1)]);
    const [a, b, c] = layers;
    expect(planMove(layers, c?.id ?? '', 1)).toEqual([{ layer: c, drawOrder: 3 }]);
    expect(planMove(layers, c?.id ?? '', 0)).toEqual([{ layer: c, drawOrder: 5 }]);
    expect(planMove(layers, a?.id ?? '', 2)).toEqual([{ layer: a, drawOrder: 0 }]);
    expect(planMove(layers, b?.id ?? '', 1)).toEqual([]);
    expect(planMove(layers, 'unknown', 1)).toEqual([]);
  });

  it('renumbers all layers when the neighbours are too close or equal', () => {
    const tight = topFirst([layer('A', 1), layer('B', 1 - Number.EPSILON / 2), layer('C', 0)]);
    const c = tight[2];
    expect(planMove(tight, c?.id ?? '', 1).map((x) => [x.layer.name, x.drawOrder])).toEqual([['A', 2], ['C', 1], ['B', 0]]);

    const equal = topFirst([layer('A', 3), layer('B', 1), layer('C', 1), layer('D', 0)]);
    const d = equal[3];
    const moved = planMove(equal, d?.id ?? '', 2);
    const after = topFirst(equal.map((l) => ({ ...l, drawOrder: moved.find((x) => x.layer.id === l.id)?.drawOrder ?? l.drawOrder })));
    expect(names(after)).toEqual([equal[0]?.name, equal[1]?.name, 'D', equal[2]?.name]);
    expect(moved.every((x) => x.drawOrder !== x.layer.drawOrder)).toBe(true);
  });

  it('renumbers when one beyond the top no longer changes the number', () => {
    const huge = topFirst([layer('A', 2 ** 60), layer('B', 0)]);
    const b = huge[1];
    expect(planMove(huge, b?.id ?? '', 0).map((x) => [x.layer.name, x.drawOrder])).toEqual([['B', 1], ['A', 0]]);
  });

  it('names new layers "Layer N" after the highest number in use and puts them on top', () => {
    expect(nextLayerName([])).toBe('Layer 1');
    expect(nextLayerName([layer('Layer 2', 0), layer('Layer 10', 0), layer('Layer x', 0), layer('My Layer 99', 0)])).toBe('Layer 11');
    expect(drawOrderOnTop([])).toBe(0);
    expect(drawOrderOnTop(topFirst([layer('A', 2.5), layer('B', 7)]))).toBe(8);
  });

  it('keeps the complete content, including other plugins\' extensions', () => {
    const withExtensions: Layer = { ...layer('A', 1), extensions: { other: { keep: 1.5 } } };
    expect(contentOf(withExtensions, { drawOrder: 2 })).toEqual({ name: 'A', drawOrder: 2, visible: true, label: LABEL, extensions: { other: { keep: 1.5 } } });
    expect(contentOf(layer('B', 1))).not.toHaveProperty('extensions');
  });
});

describe('schema check of the test server', () => {
  it('rejects an invalid change request, so the acceptance tests really check validity', () => {
    const valid = { requestId: uuidv7(), entityType: 'layer', operation: 'create', entityId: uuidv7(), source: { plugin: 'layer-panel' },
      data: { name: 'A', drawOrder: 0, visible: true, label: LABEL } } as const;
    expect(() => {
      assertSchemaValid(valid);
    }).not.toThrow();
    expect(() => {
      assertSchemaValid({ ...valid, data: { ...valid.data, name: '' } });
    }).toThrow(/invalid change request/);
  });
});

describe('LayerTracker (objects: false)', () => {
  const objectEvent = (layerId: string): ChangeEvent => {
    const o = new FakeServer().addObject(layerId, { broadcast: false });
    return {
      sequenceNo: 7, requestId: uuidv7(), entityType: 'object', operation: 'create', entityId: o.id, version: 1, previousVersion: null, state: o,
      label: LABEL, at: '2026-10-08T12:00:00.000Z', by: { plugin: 'draw-symbols' },
    };
  };

  it('takes the counts from the snapshot, then replaces them with every counts update', () => {
    const a = layer('A', 1);
    const b = layer('B', 0);
    const tracker = new LayerTracker();
    tracker.snapshot({ layers: [a, b], objects: [], sequenceNo: 3, objectCounts: { [a.id]: 2 } });
    expect([tracker.state.counts.get(a.id), tracker.state.counts.has(b.id)]).toEqual([2, false]);

    tracker.objectCounts({ [b.id]: 1, [a.id]: 0 });
    expect([tracker.state.counts.has(a.id), tracker.state.counts.get(b.id)]).toEqual([false, 1]);

    tracker.snapshot({ layers: [a], objects: [], sequenceNo: 9 });
    expect(tracker.state.counts.size).toBe(0);
    expect(names(tracker.state.layers)).toEqual(['A']);
  });

  it('ignores object events, but follows their sequence number', () => {
    const a = layer('A', 1);
    const tracker = new LayerTracker();
    tracker.snapshot({ layers: [a], objects: [], sequenceNo: 3, objectCounts: { [a.id]: 1 } });
    tracker.changes([objectEvent(a.id)]);
    expect(tracker.state.counts.get(a.id)).toBe(1);
    expect(tracker.state.sequenceNo).toBe(7);
  });
});

describe('active layer', () => {
  async function setUp(server: FakeServer) {
    const ctx = createFakeContext({ pluginId: 'layer-panel', defaultLabel: LABEL });
    const map = createFakeMapView();
    server.connect(ctx);
    const controller = new LayerPanelController(ctx);
    ctx.provideAs(MAP_VIEW, map);
    controller.attachMapView(await ctx.services.get(MAP_VIEW));
    server.sendSnapshot(ctx);
    return { ctx, map, controller };
  }

  it('is the top layer at start, also when the map view arrives after the snapshot', async () => {
    const server = new FakeServer([layer('B', 1), layer('A', 2)]);
    const { map } = await setUp(server);
    expect(map.activeLayer.value).toBe(server.layerNamed('A').id);

    const ctx = createFakeContext({ pluginId: 'layer-panel' });
    const late = createFakeMapView();
    const controller = new LayerPanelController(ctx);
    server.sendSnapshot(ctx);
    controller.attachMapView(late);
    expect(late.activeLayer.value).toBe(server.layerNamed('A').id);
  });

  it('is left alone when another plugin has already chosen one', () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1)]);
    const ctx = createFakeContext({ pluginId: 'layer-panel' });
    const map = createFakeMapView();
    map.activeLayer.set(server.layerNamed('B').id);
    const controller = new LayerPanelController(ctx);
    controller.attachMapView(map);
    server.sendSnapshot(ctx);
    expect(map.activeLayer.value).toBe(server.layerNamed('B').id);
  });

  it('moves to the next layer down when the active one is deleted, or to the top one from the bottom (function 21)', async () => {
    const server = new FakeServer([layer('A', 4), layer('B', 3), layer('C', 2), layer('D', 1)]);
    const { map, controller } = await setUp(server);
    controller.activate(server.layerNamed('B').id);
    await controller.remove(server.layerNamed('B').id);
    expect(map.activeLayer.value).toBe(server.layerNamed('C').id);
    controller.activate(server.layerNamed('D').id);
    await controller.remove(server.layerNamed('D').id);
    // The top layer, not C above it.
    expect(map.activeLayer.value).toBe(server.layerNamed('A').id);
    await controller.remove(server.layerNamed('A').id);
    await controller.remove(server.layerNamed('C').id);
    expect(map.activeLayer.value).toBeNull();
  });

  it('follows a delete by another browser and a new snapshot without the active layer', async () => {
    const server = new FakeServer([layer('A', 3), layer('B', 2), layer('C', 1)]);
    const { ctx, map, controller } = await setUp(server);
    const other = await setUp(server);
    controller.activate(server.layerNamed('A').id);
    await other.controller.remove(server.layerNamed('A').id);
    expect(map.activeLayer.value).toBe(server.layerNamed('B').id);

    const c = server.layerNamed('C');
    ctx.live.snapshot({ layers: [c], objects: [] });
    expect(map.activeLayer.value).toBe(c.id);
  });
});

describe('permissions in the controller (brief, function 10)', () => {
  it('sends nothing without layers.edit, even when its actions are called directly', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1)]);
    const ctx = createFakeContext({ pluginId: 'layer-panel', user: createFakeUser({ permissions: [] }) });
    server.connect(ctx);
    const controller = new LayerPanelController(ctx);
    server.sendSnapshot(ctx);
    expect(controller.getState().canEdit).toBe(false);
    const b = server.layerNamed('B').id;
    await Promise.all([controller.create(), controller.rename(b, 'C'), controller.move(b, 0), controller.remove(b)]);
    expect(ctx.submitted).toEqual([]);
  });
});

describe('rejections and lost answers', () => {
  it('shows a rejected rename and keeps the list', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const ctx = createFakeContext({ pluginId: 'layer-panel' });
    server.connect(ctx);
    const controller = new LayerPanelController(ctx);
    server.sendSnapshot(ctx);
    server.rejectWith = 'INTERNAL_ERROR';
    await controller.rename(server.layerNamed('A').id, 'B');
    expect(names(controller.getState().layers)).toEqual(['A']);
    expect(ctx.notifications).toEqual([{ severity: 'error', message: 'Could not rename layer "A": rejected by the test (INTERNAL_ERROR)' }]);
  });

  it('warns when the outcome is unknown and does not retry', async () => {
    const ctx = createFakeContext({ pluginId: 'layer-panel' });
    const controller = new LayerPanelController(ctx);
    ctx.live.snapshot({ layers: [] });
    ctx.answerWith(() => 'unknown');
    await controller.create();
    expect(ctx.submitted).toHaveLength(1);
    expect(ctx.notifications).toEqual([
      { severity: 'warning', message: 'No answer from the server to the request to create layer "Layer 1". Check the layer list before trying again.' },
    ]);
  });

  it('releases its guard even if reporting the unexpected error fails too', async () => {
    const fake = createFakeContext({ pluginId: 'layer-panel' });
    const failing = {
      ...fake,
      notify: () => {
        throw new Error('notify broken');
      },
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const controller = new LayerPanelController(failing);
      fake.live.snapshot({ layers: [] });
      fake.answerWith(() => {
        throw new Error('bug');
      });
      await controller.create(); // resolves: neither error escapes
      expect(fake.logs).toEqual([expect.objectContaining({ level: 'error', message: 'layer panel: could not create a layer' })]);
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(controller.getState().pending.size).toBe(0);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('reports an unexpected error as a notification and in the log, and stays usable', async () => {
    const ctx = createFakeContext({ pluginId: 'layer-panel' });
    const controller = new LayerPanelController(ctx);
    ctx.live.snapshot({ layers: [] });
    ctx.answerWith(() => {
      throw new Error('bug');
    });
    await controller.create(); // resolves: no unhandled rejection
    expect(ctx.notifications).toEqual([{ severity: 'error', message: 'Could not create a layer: unexpected error (bug)' }]);
    expect(ctx.logs).toEqual([expect.objectContaining({ level: 'error', message: 'layer panel: could not create a layer' })]);
    expect(controller.getState().pending.size).toBe(0);
    await controller.create();
    expect(ctx.submitted).toHaveLength(2);
  });
});

describe('one action of a kind at a time (review remark: double clicks)', () => {
  /** A browser whose server applies requests, but whose live picture delivers events only when the test says so. */
  function quietServer() {
    const ctx = createFakeContext({ pluginId: 'layer-panel', defaultLabel: LABEL });
    const controller = new LayerPanelController(ctx);
    const events: ChangeEvent[] = [];
    const a = layer('A', 2);
    const b = layer('B', 1);
    ctx.live.snapshot({ layers: [a, b] });
    let sequenceNo = 0;
    ctx.answerWith((request) => {
      const event = appliedEvent(request, ++sequenceNo, LABEL);
      events.push(event);
      return { outcome: 'applied', event };
    });
    const deliver = () => {
      ctx.live.changes(events.splice(0));
    };
    return { ctx, controller, a, b, deliver };
  }

  it('sends one create for a double click, and allows the next once the live picture shows it', async () => {
    const { ctx, controller, deliver } = quietServer();
    await Promise.all([controller.create(), controller.create()]);
    expect(ctx.submitted).toHaveLength(1);
    await controller.create(); // applied, but not yet in the live picture
    expect(ctx.submitted).toHaveLength(1);
    expect(controller.getState().pending.has(CREATE)).toBe(true);
    deliver();
    expect(controller.getState().pending.has(CREATE)).toBe(false);
    await controller.create();
    expect(ctx.submitted).toHaveLength(2);
    expect(dataName(ctx.submitted[1])).toBe('Layer 2');
  });

  it('sends one delete for a double click on the confirmation', async () => {
    const { ctx, controller, b } = quietServer();
    await Promise.all([controller.remove(b.id), controller.remove(b.id)]);
    expect(ctx.submitted).toEqual([expect.objectContaining({ operation: 'delete', entityId: b.id })]);
  });

  it('computes no move or rename from a state the server has already changed', async () => {
    const { ctx, controller, a, b, deliver } = quietServer();
    await controller.move(b.id, 0);
    await controller.move(a.id, 0);
    await controller.rename(a.id, 'Renamed');
    expect(ctx.submitted).toHaveLength(1);
    expect(ctx.notifications).toEqual([
      { severity: 'info', message: 'Layer "A" was not renamed: another change to the layers is still on its way. Try again.' },
    ]);
    deliver();
    await controller.move(a.id, 0);
    expect(ctx.submitted.at(-1)).toMatchObject({ entityId: a.id, data: { drawOrder: 4 } });
  });

  it('releases the guard after a rejection or a lost answer at once', async () => {
    const { ctx, controller } = quietServer();
    ctx.answerWith(() => 'unknown');
    await controller.create();
    ctx.answerWith((request) => ({
      outcome: 'rejected',
      rejection: { requestId: request.requestId, entityType: 'layer', operation: 'create', entityId: request.entityId, code: 'PERMISSION_DENIED', message: 'no', at: '2026-10-09T08:00:00.000Z' },
    }));
    await controller.create();
    await controller.create();
    expect(ctx.submitted).toHaveLength(3);
  });

  it('never locks for good: the guard ends after a timeout if the live event does not come', async () => {
    vi.useFakeTimers();
    try {
      const { ctx, controller } = quietServer();
      await controller.create();
      vi.advanceTimersByTime(PENDING_TIMEOUT_MS - 1);
      expect(controller.getState().pending.has(CREATE)).toBe(true);
      vi.advanceTimersByTime(1);
      expect(controller.getState().pending.has(CREATE)).toBe(false);
      await controller.create();
      expect(ctx.submitted).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

function dataName(request: ChangeRequest | undefined): string | undefined {
  return request?.entityType === 'layer' && 'data' in request ? request.data.name : undefined;
}

describe('opening a layer in object-list', () => {
  it('ignores unknown layers and reports an error thrown by object-list without throwing', () => {
    const server = new FakeServer([layer('A', 1)]);
    const ctx = createFakeContext({ pluginId: 'layer-panel' });
    server.connect(ctx);
    const controller = new LayerPanelController(ctx);
    server.sendSnapshot(ctx);
    const opened: string[] = [];
    controller.attachObjectList({
      open(layerId) {
        opened.push(layerId);
        throw new Error('broken');
      },
    });
    controller.openObjects(uuidv7());
    expect(opened).toEqual([]);
    expect(() => {
      controller.openObjects(server.layerNamed('A').id);
    }).not.toThrow();
    expect(opened).toEqual([server.layerNamed('A').id]);
    expect(ctx.notifications).toEqual([{ severity: 'error', message: 'Could not open the objects of the layer: unexpected error (broken)' }]);
  });
});
