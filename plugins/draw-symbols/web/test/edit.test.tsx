// T-054 (M2, brief functions 13 and 14, criteria 16, 17, 19 and 21): Edit is an object action of the shell's
// menu; the shared Delete is the shell's. A symbol the browser does not hold is read by id and shown "not in view".
import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeUser } from '@emc2/plugin-sdk/testing';
import { changeRequests } from '@emc2/plugin-sdk';
import type { MapObject } from '@emc2/plugin-sdk';
import { coreOf } from '../src/content.ts';
import { NOT_READ_HINT } from '../src/controller.ts';
import { FakeServer, layer, symbolObject } from './fakeServer.ts';
import { isolateDocumentListeners, openBrowser, settle } from './harness.tsx';
import { commit, dataOf, input, select, twoBrowsers } from './scene.tsx';

isolateDocumentListeners();

const shownCount = (browser: Awaited<ReturnType<typeof twoBrowsers>>['one']) =>
  browser.ctx.addedPanels.find((e) => e.panel.id === 'draw-symbols-properties')?.shown ?? -1;

/** Two browsers; a symbol the store holds but the browsers never heard of (outside their area). */
async function withFarSymbol() {
  const scene = await twoBrowsers();
  const far = scene.server.seed(symbolObject(scene.lay.id, { properties: { name: 'Far' }, geometry: { type: 'Point', coordinates: [-130.25, -12.5] } }));
  return { ...scene, far };
}

describe('the object action Edit', () => {
  it('selects the symbol and brings the properties panel into view', async () => {
    const { server, one, p1 } = await twoBrowsers((layerId) => [symbolObject(layerId, { properties: { name: 'Mine' } })]);
    const seeded = [...server.objects.values()][0] as MapObject;
    expect(shownCount(one)).toBe(0);
    await act(async () => {
      await one.ctx.runObjectAction('edit', [seeded.id]);
    });
    expect(one.map.selection.value).toEqual([seeded.id]);
    expect(shownCount(one)).toBe(1);
    expect(input(p1, 'Name').value).toBe('Mine');
    expect(server.requests).toHaveLength(0); // the menu only starts it
  });

  it('is not offered for several objects, nor for another kind of object, nor without objects.edit', async () => {
    const { server, one } = await twoBrowsers((layerId) => [symbolObject(layerId), symbolObject(layerId), symbolObject(layerId, { type: 'core.shape' })]);
    const [a, b, shape] = [...server.objects.values()] as [MapObject, MapObject, MapObject];
    await expect(one.ctx.runObjectAction('edit', [a.id, b.id])).rejects.toThrow('would not offer');
    await expect(one.ctx.runObjectAction('edit', [shape.id])).rejects.toThrow('would not offer');
    const lay = layer('Default', 0);
    const store = new FakeServer([lay]);
    const object = store.seed(symbolObject(lay.id));
    const viewer = await openBrowser(store, { user: createFakeUser({ permissions: [] }) });
    await expect(viewer.ctx.runObjectAction('edit', [object.id])).rejects.toThrow('would not offer');
  });

  it('for a symbol the browser does not hold: reads it by id, shows it marked "not in view", and does not move the map', async () => {
    const { server, one, p1, far } = await withFarSymbol();
    await act(async () => {
      await one.ctx.runObjectAction('edit', [far.id]);
    });
    await settle();
    expect(one.map.selection.value).toEqual([far.id]);
    expect(shownCount(one)).toBe(1);
    expect(input(p1, 'Name').value).toBe('Far');
    expect(p1.properties.getByText(/^Not in view/)).toBeDefined();
    expect(one.map.goToCalls).toEqual([]);
    expect(one.map.centreOnCalls).toEqual([]);
    expect(one.map.zoomToCalls).toEqual([]);
    // A drag was armed when it was selected, before it was known to be out of view; its drop is ignored.
    await act(async () => {
      one.map.completeInteraction([1, 2]);
      await Promise.resolve();
    });
    await settle();
    expect(server.requests).toHaveLength(0);
    expect(one.ctx.notifications).toEqual([]);
  });
});

describe('a symbol that is not in view', () => {
  it('shows "has not arrived yet" while it is read, and the state read from the server after', async () => {
    const { one, p1, far } = await withFarSymbol();
    act(() => {
      one.map.selection.set([far.id]);
    });
    expect(p1.properties.getByText('The selected object has not arrived yet.')).toBeDefined();
    await settle();
    expect(input(p1, 'Name').value).toBe('Far');
    expect(p1.properties.getByText(/^Not in view/)).toBeDefined(); // it is outside the map view's visible area
  });

  it('is followed live all the same: a small area round it brings it, so a change by another user is shown', async () => {
    const { server, one, p1, far } = await withFarSymbol();
    await select(one, far.id);
    expect(one.ctx.liveSubscriptions.some((o) => typeof o.area === 'object')).toBe(true);
    act(() => {
      server.changeElsewhere(changeRequests.updateObject(far, { ...coreOf(far), properties: { name: 'Elsewhere' } }));
    });
    await settle();
    expect(input(p1, 'Name').value).toBe('Elsewhere');
    expect(p1.properties.getByText(/^Not in view/)).toBeDefined();
  });

  it('loses the mark when the map view shows it', async () => {
    const { one, p1, far } = await withFarSymbol();
    await select(one, far.id);
    expect(p1.properties.getByText(/^Not in view/)).toBeDefined();
    act(() => {
      one.map.setViewport({ ...one.map.viewport, center: [-130, -12], visibleArea: [[-140, -20], [-120, -20], [-120, 0], [-140, 0], [-140, -20]] });
    });
    expect(p1.properties.queryByText(/^Not in view/)).toBeNull();
    expect(input(p1, 'Name').value).toBe('Far');
  });

  it('is read again before each commit when it is not held: the update is based on the newest version', async () => {
    const { server, one, p1, far } = await withFarSymbol();
    one.connection.holdSnapshots = true; // the area round it has not answered yet: it is only read, not held
    await select(one, far.id);
    await settle();
    // Someone changed it meanwhile; this browser is not told, because it is outside its area.
    server.seed({ ...far, version: 4, properties: { name: 'Newer' }, symbol: { standard: 'APP-6D', sidc: '10031000001211000000', modifiers: { uniqueDesignation: 'N-1' } } });
    one.connection.reads.length = 0;
    one.connection.lagLive = true; // the real live picture sends nothing about objects outside the area: only the answer carries the new state
    await commit(input(p1, 'Name'), 'Alpha');
    expect(one.connection.reads).toEqual([[far.id]]);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({ operation: 'update', entityId: far.id, baseVersion: 4 });
    expect(dataOf(server.requests[0]).symbol?.modifiers).toEqual({ uniqueDesignation: 'N-1' }); // the newer state's other fields
    expect(dataOf(server.requests[0]).properties).toEqual({ name: 'Alpha' });
    // The panel shows the state the server answered with, still marked, and the plugin did not take the symbol into its picture.
    expect(input(p1, 'Name').value).toBe('Alpha');
    expect(p1.properties.getByText(/^Not in view/)).toBeDefined();
    expect(one.ctx.notifications).toEqual([]);
  });

  it('gives a warning, and sends nothing, when the symbol was deleted meanwhile', async () => {
    const { server, one, p1, far } = await withFarSymbol();
    one.connection.holdSnapshots = true;
    await select(one, far.id);
    await settle();
    server.deleteSilently(far.id);
    await commit(input(p1, 'Name'), 'Alpha');
    expect(server.requests).toHaveLength(0);
    expect(one.ctx.notifications).toEqual([{ severity: 'warning', message: 'The symbol was deleted by someone else, so the change was not made.' }]);
  });

  it('says "no longer exists" when the symbol is gone when it is read', async () => {
    const { server, one, p1, far } = await withFarSymbol();
    server.deleteSilently(far.id);
    await select(one, far.id);
    await settle();
    expect(p1.properties.getByText('The selected object no longer exists.')).toBeDefined();
    expect(one.ctx.notifications).toEqual([]);
  });

  it('when the read fails: a hint and "Try again", nothing is guessed, and a commit sends nothing', async () => {
    const { server, one, p1, far } = await withFarSymbol();
    one.connection.holdSnapshots = true;
    one.connection.failReads = true;
    await select(one, far.id);
    await settle();
    expect(p1.properties.getByText(NOT_READ_HINT)).toBeDefined();
    expect(p1.properties.queryByLabelText('Name')).toBeNull();
    one.connection.failReads = false;
    fireEvent.click(p1.properties.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(input(p1, 'Name').value).toBe('Far');
    // The server stops answering after the panel has the symbol: a commit must read again, fails, and sends nothing.
    one.connection.failReads = true;
    await commit(input(p1, 'Name'), 'Alpha');
    expect(server.requests).toHaveLength(0);
    expect(one.ctx.notifications).toEqual([{ severity: 'warning', message: NOT_READ_HINT }]);
  });

  it('follows the live picture as soon as the area round it delivers it', async () => {
    const { server, one, p1, far } = await withFarSymbol();
    one.connection.holdSnapshots = true;
    await select(one, far.id);
    server.seed({ ...far, version: 2, properties: { name: 'Arrived' } }); // changed while the snapshot was on its way
    act(() => {
      one.connection.releaseSnapshots();
    });
    await settle();
    expect(input(p1, 'Name').value).toBe('Arrived');
  });
});
