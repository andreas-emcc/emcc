// T-066 (brief, function 23, criteria 34 and 35): the early drag, armed before the selected object is known, is ended with its
// `signal` once the object proves not to be an editable symbol in the view, so that `draw-shapes`' drag can take over; and it is armed
// once per selection only. The tests wrap the fake map view's `dragObject` to record each call and its signal; another plugin's
// interaction is a call on the same fake map view (the map view runs one interaction at a time: a new one ends the one before).
import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeUser } from '@emc2/plugin-sdk/testing';
import type { MapObject, MapView, Position, Uuid } from '@emc2/plugin-sdk';
import { FakeServer, layer, symbolObject } from './fakeServer.ts';
import { isolateDocumentListeners, openBrowser, settle, showPanels } from './harness.tsx';
import type { Browser } from './harness.tsx';
import { select } from './scene.tsx';
import { coreOf } from '../src/content.ts';

isolateDocumentListeners();

/** A position the fake map view's viewport does not show. */
const FAR: Position = [-130.25, -12.5];
const DROP: Position = [-130.25, -12.5];

type DragOptions = Parameters<MapView['dragObject']>[1];

interface Drag {
  readonly id: Uuid;
  readonly signal: AbortSignal | undefined;
}

/** Records every `dragObject` call of the plugin. `startOther` is another plugin's call on the same map view (as `draw-shapes`' drag). */
function watchDrags(browser: Browser) {
  const drags: Drag[] = [];
  const real = browser.map.dragObject.bind(browser.map);
  Object.assign(browser.map, {
    dragObject: (id: Uuid, options?: DragOptions) => {
      drags.push({ id, signal: options?.signal });
      return real(id, options);
    },
  });
  const other = { ended: false, result: undefined as Position | null | undefined };
  const startOther = (id: Uuid) => {
    void real(id).then((position) => {
      other.ended = true;
      other.result = position;
    });
  };
  return { drags, startOther, other };
}

async function sceneWith(objects: (layerId: Uuid) => MapObject[]) {
  const lay = layer('Default', 0);
  const server = new FakeServer([lay]);
  const seeded = objects(lay.id).map((object) => server.seed(object));
  const one = await openBrowser(server);
  return { server, lay, one, seeded };
}

/** Selects `id` while the server keeps the read: the object is not known yet. */
function selectUnknown(browser: Browser, id: Uuid): void {
  browser.connection.holdReads = true;
  act(() => {
    browser.map.selection.set([id]);
  });
}

async function release(browser: Browser): Promise<void> {
  act(() => {
    browser.connection.releaseReads();
  });
  await settle();
  await settle();
}

describe('T-066: the early drag ends once the object is known not to be an editable symbol (criterion 34)', () => {
  it('a shape: the drag armed before the read is ended with its signal, and no drag of the plugin keeps running', async () => {
    const { one, seeded } = await sceneWith((l) => [symbolObject(l, { type: 'core.shape', geometry: { type: 'LineString', coordinates: [[10, 20], [11, 21]] } })]);
    const [shape] = seeded as [MapObject];
    const { drags } = watchDrags(one);
    selectUnknown(one, shape.id);
    expect(one.map.runningInteraction).toBe('dragObject'); // armed early
    expect(drags).toHaveLength(1);
    expect(drags[0]?.signal?.aborted).toBe(false);
    await release(one);
    expect(drags[0]?.signal?.aborted).toBe(true);
    expect(one.map.runningInteraction).toBeNull();
    expect(drags).toHaveLength(1); // and not asked for again
  });

  it('a symbol out of the map view: the drag is ended too, and asked for again when it comes into view', async () => {
    const { one, seeded } = await sceneWith((l) => [symbolObject(l, { geometry: { type: 'Point', coordinates: FAR } })]);
    const [far] = seeded as [MapObject];
    const { drags } = watchDrags(one);
    selectUnknown(one, far.id);
    await release(one);
    expect(drags[0]?.signal?.aborted).toBe(true);
    expect(one.map.runningInteraction).toBeNull();
    act(() => {
      one.map.goTo(FAR); // the fake's visible area moves with the centre
    });
    await settle();
    expect(drags).toHaveLength(2); // known now, so it resumes as before
    expect(drags[1]?.signal?.aborted).toBe(false);
    expect(one.map.runningInteraction).toBe('dragObject');
  });

  it('a symbol it may edit: the drag stays armed, and a drop moves it', async () => {
    const { server, one, seeded } = await sceneWith((l) => [symbolObject(l)]);
    const [symbol] = seeded as [MapObject];
    const { drags } = watchDrags(one);
    selectUnknown(one, symbol.id);
    await release(one);
    expect(one.map.runningInteraction).toBe('dragObject');
    expect(drags.at(-1)?.signal?.aborted).toBe(false);
    await act(async () => {
      one.map.completeInteraction(DROP);
      await Promise.resolve();
    });
    await settle();
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({ operation: 'update', entityId: symbol.id });
    expect((server.requests[0] as { data: unknown }).data).toEqual({ ...coreOf(symbol), geometry: { type: 'Point', coordinates: DROP } });
  });

  it('a symbol dragged at once, before it is known, still moves', async () => {
    const { server, one, seeded } = await sceneWith((l) => [symbolObject(l)]);
    const [symbol] = seeded as [MapObject];
    selectUnknown(one, symbol.id);
    await act(async () => {
      one.map.completeInteraction(DROP); // dropped before the read answered
      await Promise.resolve();
    });
    await release(one);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({ operation: 'update', entityId: symbol.id });
  });

  it('a drop for a shape sends nothing and says nothing (the drag had been ended)', async () => {
    const { server, one, seeded } = await sceneWith((l) => [symbolObject(l, { type: 'core.shape' })]);
    const [shape] = seeded as [MapObject];
    selectUnknown(one, shape.id);
    await release(one);
    await act(async () => {
      one.map.completeInteraction(DROP);
      await Promise.resolve();
    });
    await settle();
    expect(server.requests).toHaveLength(0);
    expect(one.ctx.notifications).toEqual([]);
  });

  it('another selection ends the drag armed for the one before, and arms a new one', async () => {
    const { one, seeded } = await sceneWith((l) => [symbolObject(l), symbolObject(l)]);
    const [first, second] = seeded as [MapObject, MapObject];
    const { drags } = watchDrags(one);
    selectUnknown(one, first.id);
    act(() => {
      one.map.selection.set([second.id]);
    });
    expect(drags.map((d) => d.id)).toEqual([first.id, second.id]);
    expect(drags[0]?.signal?.aborted).toBe(true);
    expect(drags[1]?.signal?.aborted).toBe(false);
    expect(one.map.selection.value).toEqual([second.id]); // an abort does not clear the selection
  });

  it('the end of the selection ends the drag, and the selection stays as the map view left it', async () => {
    const { one, seeded } = await sceneWith((l) => [symbolObject(l)]);
    const [symbol] = seeded as [MapObject];
    const { drags } = watchDrags(one);
    await select(one, symbol.id);
    expect(one.map.runningInteraction).toBe('dragObject');
    act(() => {
      one.map.selection.set([]);
    });
    expect(drags.at(-1)?.signal?.aborted).toBe(true);
    expect(one.map.runningInteraction).toBeNull();
  });

  it('a user who may not edit gets no drag at all', async () => {
    const lay = layer('Default', 0);
    const server = new FakeServer([lay]);
    const symbol = server.seed(symbolObject(lay.id));
    const viewer = await openBrowser(server, { user: createFakeUser({ permissions: [] }) });
    const { drags } = watchDrags(viewer);
    selectUnknown(viewer, symbol.id);
    await release(viewer);
    expect(drags).toEqual([]);
    expect(viewer.map.runningInteraction).toBeNull();
  });
});

describe('T-066: next to draw-shapes (criterion 35)', () => {
  it('a drag another plugin starts after the early drag is not ended by the plugin\'s abort', async () => {
    const { one, seeded } = await sceneWith((l) => [symbolObject(l, { type: 'core.shape' })]);
    const [shape] = seeded as [MapObject];
    const { drags, startOther, other } = watchDrags(one);
    selectUnknown(one, shape.id);
    act(() => {
      startOther(shape.id); // draw-shapes arms its drag: it replaces the early one
    });
    await settle();
    expect(drags).toHaveLength(1);
    expect(drags[0]?.signal?.aborted).toBe(false); // ours was ended by the map view, not by us
    await release(one); // now the read proves a shape: nothing of ours is running, so there is nothing to end
    expect(drags).toHaveLength(1);
    expect(one.map.runningInteraction).toBe('dragObject'); // the other plugin's
    expect(other.ended).toBe(false);
    await act(async () => {
      one.map.completeInteraction(DROP); // the user drags the shape
      await Promise.resolve();
    });
    await settle();
    expect(other.ended).toBe(true);
    expect(other.result).toEqual(DROP);
  });

  it('while the object is not known, a change of the view or of a layer does not arm the early drag again', async () => {
    const { server, lay, one, seeded } = await sceneWith((l) => [symbolObject(l, { type: 'core.shape' })]);
    const [shape] = seeded as [MapObject];
    const { drags, startOther, other } = watchDrags(one);
    selectUnknown(one, shape.id);
    act(() => {
      startOther(shape.id);
    });
    await settle();
    act(() => {
      one.map.setViewport({ ...one.map.viewport, center: [16, 62] });
    });
    await settle();
    act(() => {
      one.map.setLayerVisible(lay.id, false);
    });
    await settle();
    act(() => {
      one.map.setLayerVisible(lay.id, true);
    });
    await settle();
    server.seed(symbolObject(lay.id)); // objects held change (not delivered to a plugin that follows only the selection)
    await settle();
    expect(drags).toHaveLength(1);
    expect(one.map.runningInteraction).toBe('dragObject');
    expect(other.ended).toBe(false); // the other plugin's drag keeps running
  });

  it('while the object is not known, a read that fails and is tried again does not arm the early drag a second time', async () => {
    const { one, seeded } = await sceneWith((l) => [symbolObject(l)]);
    const [symbol] = seeded as [MapObject];
    const panels = showPanels(one);
    const { drags } = watchDrags(one);
    one.connection.failReads = true;
    act(() => {
      one.map.selection.set([symbol.id]);
    });
    expect(drags).toHaveLength(1);
    await settle();
    await settle(); // the read failed: nothing to wait for
    expect(drags[0]?.signal?.aborted).toBe(true);
    one.connection.failReads = false;
    one.connection.holdReads = true;
    fireEvent.click(panels.properties.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(drags).toHaveLength(1); // the same selection: not armed again before the object is known
    await release(one);
    expect(drags).toHaveLength(2); // known as a symbol it may edit: its drag is armed
    expect(one.map.runningInteraction).toBe('dragObject');
  });

  it('a new selection arms the early drag again', async () => {
    const { one, seeded } = await sceneWith((l) => [symbolObject(l, { type: 'core.shape' })]);
    const [shape] = seeded as [MapObject];
    const { drags, startOther } = watchDrags(one);
    selectUnknown(one, shape.id);
    act(() => {
      startOther(shape.id);
    });
    await settle();
    act(() => {
      one.map.selection.set([]);
    });
    await release(one);
    act(() => {
      one.connection.holdReads = true;
      one.map.selection.set([shape.id]);
    });
    expect(drags).toHaveLength(2);
    expect(one.map.runningInteraction).toBe('dragObject');
  });

  it('(owner\'s b) a shape selected elsewhere while placing ends the placing, and the plugin does not take the map back', async () => {
    const { lay, one, seeded } = await sceneWith((l) => [symbolObject(l, { type: 'core.shape' })]);
    const [shape] = seeded as [MapObject];
    const panels = showPanels(one);
    const { drags, startOther, other } = watchDrags(one);
    one.map.activeLayer.set(lay.id);
    fireEvent.click(panels.symbols.getByRole('button', { name: 'Infantry' }));
    fireEvent.click(panels.symbols.getByRole('button', { name: 'Place on map' }));
    await settle();
    expect(one.map.runningInteraction).toBe('pickPoint');
    selectUnknown(one, shape.id); // object-list selects a shape; the read has not answered
    act(() => {
      startOther(shape.id); // draw-shapes arms its drag once it knows the shape: it ends the placing
    });
    await settle();
    expect(panels.symbols.queryByRole('button', { name: 'Place on map' })).not.toBeNull(); // placing is off
    expect(drags).toEqual([]); // no early drag of ours: it would take the map from the shape's drag
    await release(one);
    expect(drags).toEqual([]);
    expect(one.map.runningInteraction).toBe('dragObject');
    expect(other.ended).toBe(false);
  });
});
