/** The selection highlight (owner, 2026-10-09): what the controller hands the engine, and when. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY } from '@emc2/plugin-sdk';
import { createFakeContext } from '@emc2/plugin-sdk/testing';
import { initialView, MapController, MAX_HIGHLIGHTED } from '../../src/core/controller.ts';
import { registerProjections } from '../../src/core/projections.ts';
import { DEFAULT_SETTINGS } from '../../src/core/settings.ts';
import { FakeEngine } from '../fakeEngine.ts';
import { event, FakeClock, layer, object, symbolObject, uuid } from '../fixtures.ts';

const A = layer(1, 10);
const B = layer(2, 20);

function setup() {
  const { projections } = registerProjections(DEFAULT_SETTINGS.projections);
  const start = initialView(DEFAULT_SETTINGS, projections);
  if (start === null) throw new Error('no initial view');
  const engine = new FakeEngine(start.projection);
  engine.show(start.center, start.resolution);
  const clock = new FakeClock();
  const ctx = createFakeContext({ pluginId: 'map-view-2d' });
  const controller = new MapController({
    display: DEFAULT_DISPLAY,
    engine, settings: DEFAULT_SETTINGS, projections, clock, origin: 'http://127.0.0.1:8080', log: ctx.log, rendering: { mode: 'hardware', renderer: null },
  });
  controller.listener.snapshot({
    layers: [A, B],
    objects: [
      symbolObject(10, A.id, 15, 60),
      symbolObject(11, A.id, 16, 61),
      object(12, B.id, 'core.shape', { type: 'LineString', coordinates: [[10, 60], [12, 61]] }, { style: { strokeColor: '#ff0000' } }),
    ],
    sequenceNo: 1,
  });
  return { engine, clock, controller, map: controller.service };
}

function positionOf(engine: FakeEngine, id: string) {
  const item = engine.highlight.find((i) => i.id === id);
  return item !== undefined && 'position' in item ? item.position : null;
}

describe('selection highlight', () => {
  it('criterion 15: selecting an id highlights that item; clearing the selection removes it', () => {
    const { engine, map } = setup();
    expect(engine.highlighted).toEqual([]);
    map.selection.set([uuid(10)]);
    expect(engine.highlighted).toEqual([uuid(10)]);
    expect(engine.highlight[0]?.kind).toBe('symbol');
    map.selection.set([]);
    expect(engine.highlighted).toEqual([]);
  });

  it('criterion 15: highlights every selected id, symbols and shapes', () => {
    const { engine, map } = setup();
    map.selection.set([uuid(10), uuid(11), uuid(12)]);
    expect(engine.highlighted).toEqual([uuid(10), uuid(11), uuid(12)]);
    expect(engine.highlight.map((i) => i.kind)).toEqual(['symbol', 'symbol', 'line']);
  });

  it('a live update keeps the highlight, at the new position once it is drawn', () => {
    const { engine, clock, controller, map } = setup();
    map.selection.set([uuid(10)]);
    controller.listener.changes([event(2, { ...symbolObject(10, A.id, 18, 62), version: 2 })]);
    clock.advance(0);
    expect(engine.highlighted).toEqual([uuid(10)]);
    expect(positionOf(engine, uuid(10))).toEqual([18, 62]);
  });

  it('criterion 40 (was 15): a new snapshot without the id keeps it selected, but no longer highlighted', () => {
    const { engine, controller, map } = setup();
    map.selection.set([uuid(10), uuid(11), uuid(99)]);
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(11, A.id, 16, 61)], sequenceNo: 50 });
    expect(map.selection.value).toEqual([uuid(10), uuid(11), uuid(99)]);
    expect(engine.highlighted).toEqual([uuid(11)]);
  });

  it('criterion 15: a deleted selected object leaves no highlight', () => {
    const { engine, clock, controller, map } = setup();
    map.selection.set([uuid(10)]);
    controller.listener.changes([event(2, null, { id: uuid(10), type: 'object' })]);
    clock.advance(0);
    expect(map.selection.value).toEqual([]);
    expect(engine.highlighted).toEqual([]);
  });

  it('no highlight in a locally hidden layer; it comes back when the layer is shown', () => {
    const { engine, map } = setup();
    map.selection.set([uuid(10), uuid(12)]);
    map.setLayerVisible(A.id, false);
    expect(engine.highlighted).toEqual([uuid(12)]);
    map.setLayerVisible(A.id, true);
    expect(engine.highlighted).toEqual([uuid(10), uuid(12)]);
  });

  it('criterion 15: follows the drag preview while the object is dragged, and goes back after the drop', async () => {
    const { engine, map } = setup();
    map.selection.set([uuid(10)]);
    const result = map.dragObject(uuid(10));
    const from = engine.pixelOf([15, 60]);
    const to = engine.pixelOf([17, 61]);
    engine.pointer('down', from);
    engine.pointer('move', to);
    expect(positionOf(engine, uuid(10))?.[0]).toBeCloseTo(17, 6);
    expect(positionOf(engine, uuid(10))?.[1]).toBeCloseTo(61, 6);
    engine.pointer('up', to);
    await result;
    // The map view never changes the object itself: after the drop the highlight is back on it.
    expect(positionOf(engine, uuid(10))).toEqual([15, 60]);
  });

  it('stays cheap: only the selected items, and a change of another object does not touch it', () => {
    const { engine, clock, controller, map } = setup();
    map.selection.set([uuid(10)]);
    const calls = engine.highlightCalls;
    controller.listener.changes([event(2, { ...symbolObject(11, A.id, 18, 62), version: 2 })]);
    clock.advance(0);
    expect(engine.highlightCalls).toBe(calls);
    expect(engine.highlight).toHaveLength(1);
  });

  it('refreshes the highlight once per snapshot', () => {
    const { engine, controller, map } = setup();
    map.selection.set([uuid(10), uuid(11)]);
    const calls = engine.highlightCalls;
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(11, A.id, 16, 61)], sequenceNo: 50 });
    expect(engine.highlightCalls).toBe(calls + 1);
  });

  it('dragging an object that is not selected does not redraw the highlight of the selected one', () => {
    const { engine, map } = setup();
    map.selection.set([uuid(12)]);
    const calls = engine.highlightCalls;
    void map.dragObject(uuid(10));
    engine.pointer('down', engine.pixelOf([15, 60]));
    engine.pointer('move', engine.pixelOf([16, 60]));
    engine.pointer('move', engine.pixelOf([17, 60]));
    expect(engine.dragPreview).not.toBeNull();
    expect(engine.highlightCalls).toBe(calls);
  });

  it('highlights at most MAX_HIGHLIGHTED objects of a huge selection', () => {
    const { engine, controller, map } = setup();
    const objects = Array.from({ length: MAX_HIGHLIGHTED + 50 }, (_, i) => symbolObject(1000 + i, A.id, 15, 60));
    controller.listener.snapshot({ layers: [A], objects, sequenceNo: 2 });
    map.selection.set(objects.map((o) => o.id));
    expect(engine.highlight).toHaveLength(MAX_HIGHLIGHTED);
  });
});

describe('move cursor over the object that can be dragged', () => {
  it('is on over the object, off elsewhere and when the drag ends', () => {
    const { engine, map } = setup();
    void map.dragObject(uuid(10));
    engine.pointer('move', engine.pixelOf([15, 60]));
    expect(engine.dragHover).toBe(true);
    engine.pointer('move', engine.pixelOf([25, 65]));
    expect(engine.dragHover).toBe(false);
    engine.pointer('move', engine.pixelOf([15, 60]));
    engine.escape();
    expect(engine.dragHover).toBe(false);
  });
});

describe('local visibility of deleted layers (review remark N2)', () => {
  it('a deleted layer forgets that it was hidden here; a layer created later with its id starts from its own field', () => {
    const { controller, map } = setup();
    map.setLayerVisible(B.id, false);
    controller.listener.changes([event(2, null, { id: uuid(12), type: 'object' }), event(3, null, { id: B.id, type: 'layer' })]);
    controller.listener.changes([event(4, { ...B, version: 1 })]);
    expect(map.isLayerVisible(B.id)).toBe(true);
  });

  it('a new snapshot without the layer forgets it too', () => {
    const { controller, map } = setup();
    map.setLayerVisible(B.id, false);
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 60)], sequenceNo: 50 });
    controller.listener.changes([event(51, { ...B, version: 1 })]);
    expect(map.isLayerVisible(B.id)).toBe(true);
  });

  it('keeps it for layers that are still there', () => {
    const { controller, map } = setup();
    map.setLayerVisible(A.id, false);
    controller.listener.snapshot({ layers: [A, B], objects: [], sequenceNo: 50 });
    expect(map.isLayerVisible(A.id)).toBe(false);
  });
});
