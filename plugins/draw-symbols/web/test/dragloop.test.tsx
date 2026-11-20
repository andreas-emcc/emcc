// T-054 (found by map-view-2d, part D): a selected symbol the map does not draw makes `dragObject` resolve
// null at once. The plugin used to ask again at once, 26 588 times in 10 s. It now asks again only when
// something that could change the answer happens.
import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { changeRequests } from '@emc2/plugin-sdk';
import { createFakeUser } from '@emc2/plugin-sdk/testing';
import type { MapObject, Uuid } from '@emc2/plugin-sdk';
import { coreOf } from '../src/content.ts';
import { FakeServer, layer, symbolObject } from './fakeServer.ts';
import { isolateDocumentListeners, openBrowser, settle } from './harness.tsx';
import type { Browser } from './harness.tsx';
import { select, twoBrowsers } from './scene.tsx';

isolateDocumentListeners();

/** Every give-up is a failure: after this many calls the fake stops answering, so a loop fails a test instead of hanging it. */
const LOOP = 50;

/** A map view that answers every `dragObject` with null at once, as for a symbol it does not draw. Returns the ids asked for. */
function dragsEndingAtOnce(browser: Browser): Uuid[] {
  const calls: Uuid[] = [];
  Object.assign(browser.map, {
    dragObject: (id: Uuid) => {
      calls.push(id);
      return calls.length > LOOP ? new Promise<null>(() => undefined) : Promise.resolve(null);
    },
  });
  return calls;
}

async function scene() {
  const s = await twoBrowsers((layerId) => [symbolObject(layerId), symbolObject(layerId)]);
  const [first, second] = [...s.server.objects.values()] as [MapObject, MapObject];
  const calls = dragsEndingAtOnce(s.one);
  return { ...s, first, second, calls };
}

/**
 * Selects `id` and returns what was asked for while it settled, then forgets it. A selected symbol is asked for at once (before it is
 * read, so that a drag that starts right after the click is not lost) and once more when it arrives, which resets the suspension.
 */
async function picked(browser: Browser, calls: Uuid[], id: Uuid | null): Promise<Uuid[]> {
  calls.length = 0;
  await select(browser, id);
  const asked = [...calls];
  calls.length = 0;
  return asked;
}

describe('a drag that ends with null is not asked for again at once', () => {
  it('asks for a symbol the map does not draw once when it is selected and once when it arrives, then never again however long it stays selected', async () => {
    const { one, first, calls } = await scene();
    const asked = await picked(one, calls, first.id);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.length).toBeLessThanOrEqual(2);
    expect(asked.every((id) => id === first.id)).toBe(true);
    await settle();
    await settle();
    expect(calls).toEqual([]);
  });

  it('asks again when the view moves', async () => {
    const { one, first, calls } = await scene();
    await picked(one, calls, first.id);
    act(() => {
      one.map.setViewport({ ...one.map.viewport, center: [16, 62] });
    });
    await settle();
    expect(calls).toEqual([first.id]);
  });

  it('asks again when a layer is shown or hidden', async () => {
    const { one, lay, first, calls } = await scene();
    await picked(one, calls, first.id);
    act(() => {
      one.map.setLayerVisible(lay.id, false);
    });
    await settle();
    expect(calls).toEqual([first.id]);
  });

  it('asks again when the objects it holds change (the symbol may have entered the area)', async () => {
    const { server, one, first, calls } = await scene();
    await picked(one, calls, first.id);
    act(() => {
      server.changeElsewhere(changeRequests.updateObject(first, { ...coreOf(first), label: { ...first.label, classification: 'RESTRICTED' } }));
    });
    await settle();
    expect(calls).toEqual([first.id]);
  });

  it('does not ask again because another object changed', async () => {
    const { server, one, first, second, calls } = await scene();
    await picked(one, calls, first.id);
    act(() => {
      server.changeElsewhere(changeRequests.updateObject(second, { ...coreOf(second), label: { ...second.label, classification: 'RESTRICTED' } }));
    });
    await settle();
    expect(calls).toEqual([]);
  });

  it('asks again after placing: stopping it re-arms the drag of the selected symbol, once', async () => {
    const { one, p1, first, calls } = await scene();
    act(() => {
      one.map.activeLayer.set(first.layerId);
    });
    await picked(one, calls, first.id);
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Infantry' }));
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Place on map' }));
    await settle();
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Stop placing' }));
    await settle();
    await settle();
    expect(calls).toEqual([first.id]);
  });

  it('without objects.edit nothing is asked for', async () => {
    const lay = layer('Default', 0);
    const server = new FakeServer([lay]);
    server.seed(symbolObject(lay.id));
    const viewer = await openBrowser(server, { user: createFakeUser({ permissions: [] }) });
    const calls = dragsEndingAtOnce(viewer);
    await select(viewer, ([...server.objects.values()][0] as MapObject).id);
    await settle();
    expect(calls).toEqual([]);
  });

  it('asks for another symbol when that one is selected, and again for the first when it is selected again', async () => {
    const { one, first, second, calls } = await scene();
    const a = await picked(one, calls, first.id);
    const b = await picked(one, calls, second.id);
    const c = await picked(one, calls, first.id);
    expect(a.length > 0 && a.every((id) => id === first.id)).toBe(true);
    expect(b.length > 0 && b.every((id) => id === second.id)).toBe(true);
    expect(c.length > 0 && c.every((id) => id === first.id)).toBe(true);
  });

  it('asks again for the same symbol after the selection was cleared and made again', async () => {
    const { one, first, calls } = await scene();
    await picked(one, calls, first.id);
    await picked(one, calls, null);
    const again = await picked(one, calls, first.id);
    expect(again.length > 0 && again.every((id) => id === first.id)).toBe(true);
  });

  it('does not ask again because of something unrelated (the active layer)', async () => {
    const { one, lay, first, calls } = await scene();
    await picked(one, calls, first.id);
    act(() => {
      one.map.activeLayer.set(lay.id);
    });
    await settle();
    expect(calls).toEqual([]);
  });
});

describe('a drag that starts right after the click is not lost (e2e criterion 3 flaked on it)', () => {
  const FAR: [number, number] = [-130.25, -12.5];

  it('is waited for the moment one object is selected, before it has been read', async () => {
    const lay = layer('Default', 0);
    const server = new FakeServer([lay]);
    const seeded = server.seed(symbolObject(lay.id));
    const one = await openBrowser(server);
    one.connection.holdReads = true; // a slow server: the read by id has not answered
    act(() => {
      one.map.selection.set([seeded.id]);
    });
    expect(one.map.runningInteraction).toBe('dragObject');
  });

  it('the drop moves the symbol even when the read, and the area, answer only after the drop', async () => {
    const lay = layer('Default', 0);
    const server = new FakeServer([lay]);
    const seeded = server.seed(symbolObject(lay.id));
    const one = await openBrowser(server);
    one.connection.holdReads = true;
    one.connection.holdSnapshots = true;
    act(() => {
      one.map.selection.set([seeded.id]);
    });
    await act(async () => {
      one.map.completeInteraction(FAR); // click, then at once press, move and release
      await Promise.resolve();
    });
    act(() => {
      one.connection.releaseReads();
    });
    await settle();
    await settle();
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({ operation: 'update', entityId: seeded.id, baseVersion: 1 });
    expect((server.requests[0] as { data: { geometry: unknown } }).data.geometry).toEqual({ type: 'Point', coordinates: FAR });
    expect(one.ctx.notifications).toEqual([]);
  });

  it('the drag stays armed when the read then says it is an editable symbol in view: it is not armed again', async () => {
    const lay = layer('Default', 0);
    const server = new FakeServer([lay]);
    const seeded = server.seed(symbolObject(lay.id));
    const one = await openBrowser(server);
    const calls = dragsEndingAtOnce(one);
    one.connection.holdReads = true;
    act(() => {
      one.map.selection.set([seeded.id]);
    });
    expect(calls).toEqual([seeded.id]);
    act(() => {
      one.connection.releaseReads();
    });
    await settle();
    await settle();
    expect(calls.length).toBeLessThanOrEqual(2); // asked when selected, and once more when the symbol arrived
  });

  it('a drag armed for an object that proves to be a shape: its drop is ignored, with no request and no warning', async () => {
    const lay = layer('Default', 0);
    const server = new FakeServer([lay]);
    const shape = server.seed(symbolObject(lay.id, { type: 'core.shape' }));
    const one = await openBrowser(server);
    one.connection.holdReads = true;
    act(() => {
      one.map.selection.set([shape.id]);
    });
    expect(one.map.runningInteraction).toBe('dragObject'); // armed before it is known what it is
    act(() => {
      one.connection.releaseReads();
    });
    await settle();
    await settle();
    await act(async () => {
      one.map.completeInteraction([1, 2]);
      await Promise.resolve();
    });
    await settle();
    expect(server.requests).toHaveLength(0);
    expect(one.ctx.notifications).toEqual([]);
  });

  it('a drop that comes before it is known to be a shape: nothing is sent and nothing is said', async () => {
    const lay = layer('Default', 0);
    const server = new FakeServer([lay]);
    const shape = server.seed(symbolObject(lay.id, { type: 'core.shape' }));
    const one = await openBrowser(server);
    one.connection.holdReads = true;
    act(() => {
      one.map.selection.set([shape.id]);
    });
    await act(async () => {
      one.map.completeInteraction([1, 2]); // dropped before the read answered
      await Promise.resolve();
    });
    act(() => {
      one.connection.releaseReads();
    });
    await settle();
    await settle();
    expect(server.requests).toHaveLength(0);
    expect(one.ctx.notifications).toEqual([]);
  });

  it('a symbol known to be out of the map view is not asked for again when the view moves (it is not on the map)', async () => {
    const lay = layer('Default', 0);
    const server = new FakeServer([lay]);
    const far = server.seed(symbolObject(lay.id, { geometry: { type: 'Point', coordinates: FAR } }));
    const one = await openBrowser(server);
    const calls = dragsEndingAtOnce(one);
    await select(one, far.id);
    calls.length = 0;
    act(() => {
      one.map.setViewport({ ...one.map.viewport, center: [16, 62] }); // still not showing the far symbol
    });
    await settle();
    expect(calls).toEqual([]);
  });

  it('nothing is asked for again once the read says the object is missing, whatever happens to the view', async () => {
    const lay = layer('Default', 0);
    const server = new FakeServer([lay]);
    const gone = symbolObject(lay.id);
    const one = await openBrowser(server);
    const calls = dragsEndingAtOnce(one);
    await select(one, gone.id); // not in the store: the read says missing
    calls.length = 0;
    act(() => {
      one.map.setViewport({ ...one.map.viewport, center: [16, 62] });
    });
    await settle();
    expect(calls).toEqual([]);
  });

  it('nothing is armed when the object cannot be read (missing) or the user may not edit', async () => {
    const lay = layer('Default', 0);
    const server = new FakeServer([lay]);
    const gone = symbolObject(lay.id);
    const one = await openBrowser(server);
    await select(one, gone.id); // not in the store: read says missing
    const calls = dragsEndingAtOnce(one);
    act(() => {
      one.map.selection.set([]);
    });
    await select(one, gone.id);
    await settle();
    expect(calls.length).toBeLessThanOrEqual(1); // asked when selected (not yet known), never after "missing"
    const viewer = await openBrowser(server, { user: createFakeUser({ permissions: [] }) });
    act(() => {
      viewer.map.selection.set([gone.id]);
    });
    expect(viewer.map.runningInteraction).toBeNull();
  });
});
