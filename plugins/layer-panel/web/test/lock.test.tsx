// Acceptance criteria 24 to 26 of the brief (M4): the layer lock (function 22; ADR-0042, SDK
// 1.3.0). "Both browsers" means two fake contexts connected to the same FakeServer, which refuses a
// change to a locked layer as the store does.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChangeRequest, LayerContent, WorkspaceInfo } from '@emc2/plugin-sdk';
import { createFakeUser } from '@emc2/plugin-sdk/testing';
import { contentOf } from '../src/order.ts';
import { openBrowser, settle, type Browser } from './browser.tsx';
import { assertSchemaValid, FakeServer, layer, layerIn } from './fakeServer.ts';

afterEach(cleanup);

const SIM: WorkspaceInfo = { id: 'simulator.simulation', name: 'Simulation', viewPermission: 'plugin.simulator.view', editPermission: 'plugin.simulator.edit', order: 10 };

function dataOf(request: ChangeRequest | undefined): LayerContent {
  if (!request || !('data' in request) || request.entityType !== 'layer') throw new Error('not a layer create or update');
  return request.data;
}

function button(browser: Browser, name: string): HTMLButtonElement {
  return browser.view.getByRole<HTMLButtonElement>('button', { name });
}

async function click(browser: Browser, name: string): Promise<void> {
  fireEvent.click(button(browser, name));
  await settle();
}

describe('AC24 (M4): lock and unlock', () => {
  it('a click sends one schema-valid update with the complete content, baseVersion and locked: true; a second click locked: false', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1)]);
    const one = await openBrowser(server);
    const before = server.layerNamed('A');
    const lock = button(one, 'Lock A');
    expect([lock.title, lock.getAttribute('aria-pressed'), lock.disabled]).toEqual(['Lock layer', 'false', false]);

    await click(one, 'Lock A');
    expect(server.requests).toHaveLength(1);
    const request = server.requests[0];
    if (request === undefined) throw new Error('no request');
    assertSchemaValid(request);
    expect(request).toMatchObject({ entityType: 'layer', operation: 'update', entityId: before.id, baseVersion: before.version });
    expect(dataOf(request)).toEqual({ ...contentOf(before), locked: true });
    expect(server.layerNamed('A').locked).toBe(true);
    const unlock = button(one, 'Unlock A');
    expect([unlock.title, unlock.getAttribute('aria-pressed')]).toEqual(['Unlock layer', 'true']);

    const locked = server.layerNamed('A');
    await click(one, 'Unlock A');
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]).toMatchObject({ baseVersion: locked.version });
    expect(dataOf(server.requests[1])).toEqual({ ...contentOf(locked), locked: false });
    expect(server.layerNamed('A').locked).toBeUndefined();
    expect(button(one, 'Lock A').getAttribute('aria-pressed')).toBe('false');
  });

  it('follows a lock set and cleared in a second browser', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const one = await openBrowser(server);
    const two = await openBrowser(server);
    await click(two, 'Lock A');
    expect(button(one, 'Unlock A').getAttribute('aria-pressed')).toBe('true');
    expect(button(one, 'Rename A').disabled).toBe(true);
    await click(two, 'Unlock A');
    expect(button(one, 'Lock A').getAttribute('aria-pressed')).toBe('false');
    expect(button(one, 'Rename A').disabled).toBe(false);
  });

  it('a rename or a reorder sends no locked, and the stored lock stays', async () => {
    const server = new FakeServer([{ ...layer('A', 2), locked: true }, layer('B', 1)]);
    const one = await openBrowser(server);
    fireEvent.click(button(one, 'Rename B'));
    const field = one.view.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'C' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await settle();
    await click(one, 'Move A down');
    expect(server.requests.map((r) => 'locked' in dataOf(r))).toEqual([false, false]);
    expect(one.listed()).toEqual(['C', 'A']);
    expect(server.layerNamed('A').locked).toBe(true);
  });

  it('puts the lock beside the eye, as the shared IconButton with a Lucide icon', async () => {
    const one = await openBrowser(new FakeServer([layer('A', 1)]));
    const labels = within(one.row('A')).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(labels.slice(0, 2)).toEqual(['Hide A', 'Lock A']);
    const lock = button(one, 'Lock A');
    expect([lock.className, lock.querySelector('svg.emc2-icon') !== null]).toEqual(['emc2-icon-button', true]);
  });
});

describe('AC25 (M4): a locked row', () => {
  it('disables Rename and Delete with "The layer is locked", and F2 opens no name field', async () => {
    const server = new FakeServer([{ ...layer('A', 2), locked: true }, layer('B', 1)]);
    const one = await openBrowser(server);
    for (const name of ['Rename A', 'Delete A']) expect([button(one, name).disabled, button(one, name).title]).toEqual([true, 'The layer is locked']);
    const nameA = button(one, 'Make A active');
    fireEvent.keyDown(nameA, { key: 'F2' });
    expect(one.view.queryByRole('textbox')).toBeNull();
    expect(nameA.title).toBe('Click to make active, drag to move');
    // The unlocked row is as before.
    expect([button(one, 'Rename B').disabled, button(one, 'Delete B').disabled]).toEqual([false, false]);
    expect(server.requests).toEqual([]);
  });

  it('reorders with the keys and by drag: one drawOrder update each, which the server applies', async () => {
    const server = new FakeServer([{ ...layer('A', 2), locked: true }, layer('B', 1), layer('C', 0)]);
    const one = await openBrowser(server);
    await click(one, 'Move A down');
    expect(server.requests).toHaveLength(1);
    expect(dataOf(server.requests[0])).toEqual(contentOf(server.layerNamed('A'), { drawOrder: 0.5 }));
    expect(one.listed()).toEqual(['B', 'A', 'C']);

    expect(one.row('A').getAttribute('draggable')).toBe('true');
    fireEvent.dragStart(one.row('A'));
    fireEvent.dragOver(one.row('C'));
    fireEvent.drop(one.row('C'));
    await settle();
    expect(server.requests).toHaveLength(2);
    expect(one.listed()).toEqual(['B', 'C', 'A']);
    expect(server.layerNamed('A').locked).toBe(true);
    expect(one.ctx.notifications).toEqual([]);
  });

  it('keeps the eye and the active layer working', async () => {
    const server = new FakeServer([layer('B', 2), { ...layer('A', 1), locked: true }]);
    const one = await openBrowser(server);
    await click(one, 'Hide A');
    expect(one.map.isLayerVisible(server.layerNamed('A').id)).toBe(false);
    await click(one, 'Make A active');
    expect(one.map.activeLayer.value).toBe(server.layerNamed('A').id);
    expect(server.requests).toEqual([]);
  });
});

describe('AC26 (M4): without the permission, and a LAYER_LOCKED rejection', () => {
  it('without layers.edit the lock shows its state, switched off, with its title', async () => {
    const server = new FakeServer([{ ...layer('A', 2), locked: true }, layer('B', 1)]);
    const one = await openBrowser(server, { user: createFakeUser({ permissions: [] }) });
    const locked = button(one, 'Unlock A');
    const open = button(one, 'Lock B');
    expect([locked.disabled, locked.title, locked.getAttribute('aria-pressed')]).toEqual([true, 'You may not change this layer', 'true']);
    expect([open.disabled, open.title, open.getAttribute('aria-pressed')]).toEqual([true, 'You may not change this layer', 'false']);
    // Without the permission, its hint comes before the lock's.
    expect(button(one, 'Rename A').title).toBe('You may not change layers');
    fireEvent.click(open);
    await settle();
    expect(server.requests).toEqual([]);
  });

  it("follows the workspace's edit permission in Simulation, and layers.edit in View", async () => {
    const server = new FakeServer([layer('V1', 1), layerIn(SIM.id, 'S1', 2)]);
    const one = await openBrowser(server, { workspaces: [SIM], workspace: SIM.id, user: createFakeUser({ permissions: ['plugin.simulator.view', 'plugin.simulator.edit'] }) });
    expect(button(one, 'Lock S1').disabled).toBe(false);
    await click(one, 'Lock S1');
    expect(dataOf(server.requests[0])).toEqual({ ...contentOf(server.layerNamed('S1')), locked: true });
    expect(dataOf(server.requests[0]).workspace).toBe(SIM.id);
    // View's layers are a reference here: no lock (brief, function 20).
    expect(one.view.queryByRole('button', { name: 'Lock V1' })).toBeNull();
  });

  it("shows a LAYER_LOCKED rejection with the layer's name (another user locked it in between)", async () => {
    const server = new FakeServer([layer('A', 1)]);
    const one = await openBrowser(server);
    server.holdEvents();
    const two = await openBrowser(server);
    await click(two, 'Lock A');
    // The first browser has not heard of the lock yet, so it still offers Rename.
    fireEvent.click(button(one, 'Rename A'));
    const field = one.view.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'B' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await settle();
    expect(one.ctx.notifications).toEqual([{ severity: 'error', message: 'Could not rename layer "A": the layer A is locked (LAYER_LOCKED)' }]);
    act(() => {
      server.deliver();
    });
    await settle();
    expect(button(one, 'Rename A').disabled).toBe(true);
    expect(one.listed()).toEqual(['A']);
  });
});
