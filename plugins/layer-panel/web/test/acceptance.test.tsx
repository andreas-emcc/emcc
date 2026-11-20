// One or more tests per acceptance criterion of docs/plugins/briefs/layer-panel.md. "Both
// browsers" means two fake contexts connected to the same FakeServer.
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAP_VIEW, OBJECT_LIST } from '@emc2/plugin-sdk';
import type { ChangeRequest, LayerContent } from '@emc2/plugin-sdk';
import { checkLookCss, createFakeContext, createFakeMapView, createFakeObjectListService, createFakeUser } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import plugin from '../src/index.tsx';
import { contentOf } from '../src/order.ts';
import { openBrowser, panelOf, settle, type Browser } from './browser.tsx';
import { FakeServer, LABEL, layer } from './fakeServer.ts';

afterEach(cleanup);

function dataOf(request: ChangeRequest | undefined): LayerContent {
  if (!request || !('data' in request) || request.entityType !== 'layer') throw new Error('not a layer create or update');
  return request.data;
}

async function click(browser: Browser, name: string | RegExp): Promise<void> {
  fireEvent.click(browser.view.getByRole('button', { name }));
  await settle();
}

describe('AC1: the list order is the draw order; a move changes only that layer', () => {
  it('lists layers in draw order, and a move shows in both browsers with one request for that layer only', async () => {
    const server = new FakeServer([layer('B', 1), layer('A', 2), layer('C', 0)]);
    const one = await openBrowser(server);
    const two = await openBrowser(server);
    expect(one.listed()).toEqual(server.drawOrder());
    expect(one.listed()).toEqual(['A', 'B', 'C']);

    const before = server.layerNamed('C');
    await click(one, 'Move C up');

    expect(server.requests).toHaveLength(1);
    const request = server.requests[0];
    expect(request).toMatchObject({ entityType: 'layer', operation: 'update', entityId: before.id, baseVersion: before.version });
    expect(dataOf(request)).toEqual(contentOf(before, { drawOrder: 1.5 }));
    expect(server.drawOrder()).toEqual(['A', 'C', 'B']);
    expect(one.listed()).toEqual(['A', 'C', 'B']);
    expect(two.listed()).toEqual(['A', 'C', 'B']);
  });

  it('moves by drag and drop', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1), layer('C', 0)]);
    const one = await openBrowser(server);
    const two = await openBrowser(server);
    fireEvent.dragStart(one.row('A'));
    fireEvent.dragOver(one.row('C'));
    fireEvent.drop(one.row('C'));
    await settle();

    expect(server.requests).toHaveLength(1);
    expect(dataOf(server.requests[0])).toEqual(contentOf(server.layerNamed('A'), { drawOrder: -1 }));
    expect(two.listed()).toEqual(['B', 'C', 'A']);
  });

  it('moves down, and the top and bottom rows cannot move further', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1), layer('C', 0)]);
    const one = await openBrowser(server);
    expect(one.view.getByRole('button', { name: 'Move A up' })).toHaveProperty('disabled', true);
    expect(one.view.getByRole('button', { name: 'Move C down' })).toHaveProperty('disabled', true);
    await click(one, 'Move A down');
    expect(one.listed()).toEqual(['B', 'A', 'C']);
    expect(dataOf(server.requests[0]).drawOrder).toBe(0.5);
  });
});

describe('AC2: twenty consecutive moves between the same two neighbours', () => {
  it('keeps a correct order, through the midpoint and the renumbering', async () => {
    // Neighbours so close that the midpoint runs out of precision after about 13 halvings.
    const server = new FakeServer([layer('A', 1), layer('B', 1 - 2 ** -40), layer('C', 0)]);
    const one = await openBrowser(server);
    const requestsPerMove: number[] = [];
    for (let move = 0; move < 20; move++) {
      const [top, middle, bottom] = one.listed();
      if (top === undefined || middle === undefined || bottom === undefined) throw new Error('three layers expected');
      const sent = server.requests.length;
      await click(one, `Move ${bottom} up`);
      requestsPerMove.push(server.requests.length - sent);
      expect(one.listed()).toEqual([top, bottom, middle]);
      expect(server.drawOrder()).toEqual(one.listed());
      const orders = [...server.layers.values()].map((l) => l.drawOrder);
      expect(new Set(orders).size).toBe(3);
    }
    expect(requestsPerMove.filter((n) => n === 1).length).toBeGreaterThan(10);
    expect(requestsPerMove.some((n) => n > 1)).toBe(true);
  });
});

describe('AC3: hiding a layer is local to this browser', () => {
  it('hides the layer in this browser only and sends nothing', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const one = await openBrowser(server);
    const two = await openBrowser(server);
    const a = server.layerNamed('A');

    await click(one, 'Hide A');
    expect(one.map.isLayerVisible(a.id)).toBe(false);
    expect(two.map.isLayerVisible(a.id)).toBe(true);
    expect(one.view.getByRole('button', { name: 'Show A' })).toBeDefined();
    expect(two.view.getByRole('button', { name: 'Hide A' })).toBeDefined();
    expect(server.requests).toHaveLength(0);
    expect(server.layerNamed('A').visible).toBe(true);

    await click(one, 'Show A');
    expect(one.map.isLayerVisible(a.id)).toBe(true);
  });
});

describe('AC4: a new layer', () => {
  it('appears on top in both browsers, is active in the creating one and carries the default label', async () => {
    const server = new FakeServer([layer('A', 3), layer('Layer 4', 1)]);
    const one = await openBrowser(server);
    const two = await openBrowser(server);
    const activeInTwo = two.map.activeLayer.value;

    await click(one, 'New layer');
    await click(one, 'Create');

    expect(server.requests).toHaveLength(1);
    const request = server.requests[0];
    expect(request).toMatchObject({ entityType: 'layer', operation: 'create' }); // schema-valid: checked by FakeServer
    expect(dataOf(request)).toEqual({ name: 'Layer 5', drawOrder: 4, visible: true, label: one.ctx.defaultLabel });
    expect(one.listed()).toEqual(['Layer 5', 'A', 'Layer 4']);
    expect(two.listed()).toEqual(['Layer 5', 'A', 'Layer 4']);
    expect(one.map.activeLayer.value).toBe(request?.entityId);
    expect(two.map.activeLayer.value).toBe(activeInTwo);
    expect(one.row('Layer 5').getAttribute('aria-current')).toBe('true');
  });
});

describe('AC5: rename', () => {
  it('is visible in a second browser after Enter', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const one = await openBrowser(server);
    const two = await openBrowser(server);
    const a = server.layerNamed('A');

    fireEvent.keyDown(one.view.getByRole('button', { name: 'Make A active' }), { key: 'F2' });
    const input = one.view.getByRole('textbox', { name: 'New name for A' });
    fireEvent.change(input, { target: { value: '  Recon  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await settle();

    expect(server.requests).toHaveLength(1);
    expect(dataOf(server.requests[0])).toEqual(contentOf(a, { name: 'Recon' }));
    expect(two.listed()).toEqual(['Recon']);
    expect(one.listed()).toEqual(['Recon']);
  });

  it('Escape restores the old name and sends nothing', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const one = await openBrowser(server);
    await click(one, 'Rename A');
    const input = one.view.getByRole('textbox', { name: 'New name for A' });
    fireEvent.change(input, { target: { value: 'Something else' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    await settle();
    expect(one.listed()).toEqual(['A']);
    expect(server.requests).toHaveLength(0);
  });

  it('an empty or unchanged name sends nothing', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const one = await openBrowser(server);
    for (const value of ['   ', 'A']) {
      await click(one, 'Rename A');
      const input = one.view.getByRole('textbox', { name: 'New name for A' });
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await settle();
    }
    expect(server.requests).toHaveLength(0);
  });
});

describe('AC6: delete', () => {
  it('cannot delete a layer with objects, and says why', async () => {
    const server = new FakeServer([layer('A', 1)]);
    server.addObject(server.layerNamed('A').id);
    const one = await openBrowser(server);
    const button = one.view.getByRole('button', { name: 'Delete A' });
    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('title')).toBe('A has 1 object: only empty layers can be deleted');
  });

  it('deletes an empty layer after confirmation, in both browsers', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1)]);
    const one = await openBrowser(server);
    const two = await openBrowser(server);
    const b = server.layerNamed('B');

    await click(one, 'Delete B');
    expect(server.requests).toHaveLength(0);
    // The shared confirmation dialog (owner, 2026-10-21), Cancel focused.
    const confirm = one.view.getByRole('alertdialog', { name: 'Delete layer' });
    expect(confirm.textContent).toContain('Delete the empty layer "B"?');
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await settle();

    expect(server.requests).toEqual([expect.objectContaining({ entityType: 'layer', operation: 'delete', entityId: b.id, baseVersion: b.version })]);
    expect(one.listed()).toEqual(['A']);
    expect(two.listed()).toEqual(['A']);
  });

  it('Cancel and Escape send nothing', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const one = await openBrowser(server);
    await click(one, 'Delete A');
    await click(one, 'Cancel');
    expect(one.view.queryByRole('alertdialog')).toBeNull();
    await click(one, 'Delete A');
    fireEvent.keyDown(one.view.getByRole('alertdialog', { name: 'Delete layer' }), { key: 'Escape' });
    await settle();
    expect(one.view.queryByRole('alertdialog')).toBeNull();
    expect(server.requests).toHaveLength(0);
    expect(one.listed()).toEqual(['A']);
  });

  it('closes the confirmation when the layer is deleted elsewhere meanwhile', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1)]);
    const one = await openBrowser(server);
    const two = await openBrowser(server);
    await click(one, 'Delete B');
    await click(two, 'Delete B');
    await click(two, 'Delete');
    expect(one.listed()).toEqual(['A']);
    expect(one.view.queryByRole('alertdialog')).toBeNull();
    expect(server.requests).toHaveLength(1);
  });

  it('shows a rejected delete (an object was added meanwhile) as a notification', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const one = await openBrowser(server);
    server.addObject(server.layerNamed('A').id, { broadcast: false });
    await click(one, 'Delete A');
    await click(one, 'Delete');
    expect(server.layers.size).toBe(1);
    expect(one.listed()).toEqual(['A']);
    expect(one.ctx.notifications).toEqual([
      { severity: 'error', message: 'Could not delete layer "A": the layer still has objects (LAYER_NOT_EMPTY)' },
    ]);
  });

  it('enables delete again when the last object leaves the layer, and counts follow the live picture', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const one = await openBrowser(server);
    expect(within(one.row('A')).getByText('0 objects')).toBeDefined();
    act(() => {
      server.addObject(server.layerNamed('A').id);
      server.addObject(server.layerNamed('A').id);
    });
    expect(within(one.row('A')).getByText('2 objects')).toBeDefined();
    expect(one.view.getByRole('button', { name: 'Delete A' })).toHaveProperty('disabled', true);
  });
});

describe('AC7: fresh system and no layers', () => {
  it('lists the seeded "Default" layer as active, so symbols can be placed at once', async () => {
    const server = new FakeServer([layer('Default', 0)]);
    const one = await openBrowser(server);
    expect(one.listed()).toEqual(['Default']);
    expect(one.map.activeLayer.value).toBe(server.layerNamed('Default').id);
    expect(one.row('Default').getAttribute('aria-current')).toBe('true');
    expect(within(one.row('Default')).getByText(LABEL.classification)).toBeDefined();
  });

  it('shows "Create first layer" after all layers are deleted, and that creates an active layer', async () => {
    const server = new FakeServer([layer('Default', 0)]);
    const one = await openBrowser(server);
    await click(one, 'Delete Default');
    await click(one, 'Delete');
    expect(one.map.activeLayer.value).toBeNull();
    expect(one.view.getByText('There are no layers.')).toBeDefined();

    await click(one, 'Create first layer');
    await click(one, 'Create');
    expect(one.listed()).toEqual(['Layer 1']);
    expect(dataOf(server.requests.at(-1))).toEqual({ name: 'Layer 1', drawOrder: 0, visible: true, label: LABEL });
    expect(one.map.activeLayer.value).toBe(server.layerNamed('Layer 1').id);
  });
});

describe('AC8 (M1): permissions', () => {
  const readOnly = () => createFakeUser({ permissions: [] });

  it('without layers.edit offers no create, rename, reorder or delete, and shows the hint', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1)]);
    const one = await openBrowser(server, { user: readOnly() });

    expect(one.view.getByText('You may not change layers.')).toBeDefined();
    const create = one.view.getByRole<HTMLButtonElement>('button', { name: 'New layer' });
    expect([create.disabled, create.title]).toEqual([true, 'You may not change layers']);
    // The row buttons stay visible, switched off, with the hint as tooltip (owner, 2026-10-11).
    const rowButtons = ['A', 'B'].flatMap((layerName) =>
      [`Move ${layerName} up`, `Move ${layerName} down`, `Rename ${layerName}`, `Delete ${layerName}`].map((name) =>
        one.view.getByRole<HTMLButtonElement>('button', { name }),
      ),
    );
    expect(rowButtons.map((b) => [b.disabled, b.title])).toEqual(rowButtons.map(() => [true, 'You may not change layers']));
    expect(one.row('A').getAttribute('draggable')).toBe('false');

    const nameA = one.view.getByRole('button', { name: 'Make A active' });
    fireEvent.doubleClick(nameA);
    fireEvent.keyDown(nameA, { key: 'F2' });
    expect(one.view.queryByRole('textbox')).toBeNull();
    fireEvent.dragStart(one.row('A'));
    fireEvent.drop(one.row('B'));
    await settle();
    expect(server.requests).toEqual([]);
    expect(one.listed()).toEqual(['A', 'B']);
  });

  it('without layers.edit the eye and the active layer still work', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1)]);
    const one = await openBrowser(server, { user: readOnly() });
    await click(one, 'Hide A');
    expect(one.map.isLayerVisible(server.layerNamed('A').id)).toBe(false);
    await click(one, 'Make B active');
    expect(one.map.activeLayer.value).toBe(server.layerNamed('B').id);
    expect(server.requests).toEqual([]);
  });

  it('without layers.edit "Create first layer" is switched off and says why', async () => {
    const one = await openBrowser(new FakeServer([]), { user: readOnly() });
    const create = one.view.getByRole<HTMLButtonElement>('button', { name: 'Create first layer' });
    expect([create.disabled, create.title]).toEqual([true, 'You may not change layers']);
    expect(one.view.getByText('You may not change layers.')).toBeDefined();
  });

  it('shows a PERMISSION_DENIED rejection from the server as a notification', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const one = await openBrowser(server, { user: createFakeUser({ permissions: ['layers.edit'] }) });
    server.rejectWith = 'PERMISSION_DENIED';
    await click(one, 'New layer');
    await click(one, 'Create');
    expect(one.ctx.notifications).toEqual([
      { severity: 'error', message: 'Could not create layer "Layer 1": You may not change layers (the server refused: rejected by the test)' },
    ]);
    expect(one.listed()).toEqual(['A']);
  });

  it('with layers.edit everything works as in criteria 1 to 7', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1)]);
    const one = await openBrowser(server, { user: createFakeUser({ permissions: ['layers.edit'] }) });
    expect(one.view.queryByText('You may not change layers.')).toBeNull();
    await click(one, 'Move B up');
    await click(one, 'New layer');
    await click(one, 'Create');
    expect(one.listed()).toEqual(['Layer 1', 'B', 'A']);
    expect(one.view.getAllByRole('button', { name: /^Delete / })).toHaveLength(3);
  });

  it('lists layers created by other plugins and handles them like any other', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const one = await openBrowser(server);
    act(() => {
      server.addLayerAs('cot', 'tak-north', 5);
    });
    expect(one.listed()).toEqual(['tak-north', 'A']);
    await click(one, 'Move tak-north down');
    await click(one, 'Make tak-north active');
    expect(one.listed()).toEqual(['A', 'tak-north']);
    expect(one.map.activeLayer.value).toBe(server.layerNamed('tak-north').id);
  });
});

describe('AC9 (M1): layers and counts without objects', () => {
  it('subscribes with objects: false and gets no objects', async () => {
    const server = new FakeServer([layer('A', 1)]);
    server.addObject(server.layerNamed('A').id);
    const one = await openBrowser(server);
    expect(one.ctx.liveSubscriptions).toEqual([{ objects: false }]);
    expect(within(one.row('A')).getByText('1 object')).toBeDefined();
  });

  it('keeps its counts equal to the store\'s when another browser creates and deletes objects', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1)]);
    const [a, b] = [server.layerNamed('A').id, server.layerNamed('B').id];
    const one = await openBrowser(server);
    const shown = () => ['A', 'B'].map((name) => one.row(name).querySelector('.layer-panel-count')?.textContent);

    // The counts are the store's, of the whole picture: they include an object whose event this
    // browser never got (with objects: false no object events arrive anyway).
    const unseen = server.addObject(a, { broadcast: false });
    act(() => {
      server.addObject(a);
      server.addObject(b);
    });
    expect(server.counts()).toEqual({ [a]: 2, [b]: 1 });
    expect(shown()).toEqual(['2 objects', '1 object']);

    act(() => {
      server.removeObject(unseen);
    });
    expect(shown()).toEqual(['1 object', '1 object']);
  });

  it('allows deleting a layer once the counts say it is empty', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1)]);
    const object = server.addObject(server.layerNamed('B').id);
    const one = await openBrowser(server);
    expect(one.view.getByRole<HTMLButtonElement>('button', { name: 'Delete B' }).disabled).toBe(true);

    act(() => {
      server.removeObject(object);
    });
    await click(one, 'Delete B');
    await click(one, 'Delete');
    expect(one.listed()).toEqual(['A']);
  });
});

describe('AC10 (M2): a double-click on a row opens object-list', () => {
  it('opens object-list for that layer, from anywhere on the row', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1)]);
    const one = await openBrowser(server, { objectList: true });
    const [a, b] = [server.layerNamed('A').id, server.layerNamed('B').id];
    fireEvent.doubleClick(one.view.getByRole('button', { name: 'Make B active' }));
    fireEvent.doubleClick(one.row('A'));
    fireEvent.doubleClick(within(one.row('A')).getByText('UNCLASSIFIED'));
    expect(one.opened).toEqual([b, a, a]);
    expect(server.requests).toEqual([]);
  });

  it('also opens it for a hidden layer', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const one = await openBrowser(server, { objectList: true });
    await click(one, 'Hide A');
    fireEvent.doubleClick(one.view.getByRole('button', { name: 'Make A active' }));
    expect(one.opened).toEqual([server.layerNamed('A').id]);
  });

  it('opens it with Enter on the name; Space makes the layer active (owner, 2026-10-17)', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1)]);
    const one = await openBrowser(server, { objectList: true });
    const nameB = one.view.getByRole('button', { name: 'Make B active' });
    fireEvent.keyDown(nameB, { key: 'Enter' });
    expect(one.opened).toEqual([server.layerNamed('B').id]);
    expect(one.map.activeLayer.value).toBe(server.layerNamed('A').id);
    fireEvent.keyUp(nameB, { key: ' ' });
    expect(one.map.activeLayer.value).toBe(server.layerNamed('B').id);
  });

  it('does not open it from the row buttons or the name field', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1)]);
    const one = await openBrowser(server, { objectList: true });
    for (const name of ['Hide B', 'Move B up', 'Rename B', 'Delete B']) fireEvent.doubleClick(one.view.getByRole('button', { name }));
    // fireEvent.doubleClick sends no clicks: open the name field with one.
    fireEvent.click(one.view.getByRole('button', { name: 'Rename B' }));
    fireEvent.doubleClick(one.view.getByRole('textbox', { name: 'New name for B' }));
    expect(one.opened).toEqual([]);
  });

  it('mentions the double-click in the tooltip only when object-list is there', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const withList = await openBrowser(server, { objectList: true });
    expect(withList.view.getByRole('button', { name: 'Make A active' }).title).toBe(
      'Click to make active, double-click to open its objects, F2 to rename, drag to move',
    );
    cleanup();
    const without = await openBrowser(server);
    expect(without.view.getByRole('button', { name: 'Make A active' }).title).toBe('Click to make active, F2 to rename, drag to move');
  });

  it('without object-list the panel works as before and the double-click does nothing', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1)]);
    const one = await openBrowser(server);
    const nameB = one.view.getByRole('button', { name: 'Make B active' });
    fireEvent.doubleClick(nameB);
    fireEvent.keyDown(nameB, { key: 'Enter' });
    expect(one.view.queryByRole('textbox')).toBeNull();
    expect(one.ctx.notifications).toEqual([]);
    await click(one, 'Move B up');
    expect(one.listed()).toEqual(['B', 'A']);
  });

  it('starts to open it once object-list activates after the panel', async () => {
    const server = new FakeServer([layer('A', 1)]);
    // Without "uses", the fake's services.get waits for a provider, as for one that activates later.
    const ctx = createFakeContext({ pluginId: manifest.id });
    ctx.provideAs(MAP_VIEW, createFakeMapView());
    server.connect(ctx);
    await plugin.activate(ctx);
    act(() => {
      server.sendSnapshot(ctx);
    });
    const Panel = panelOf(ctx);
    const view = within(render(<Panel />).container);
    const name = view.getByRole('button', { name: 'Make A active' });
    expect(name.title).not.toMatch(/double-click/);

    const list = createFakeObjectListService();
    ctx.provideAs(OBJECT_LIST, list);
    await settle();
    fireEvent.doubleClick(name);
    expect(list.opened).toEqual([server.layerNamed('A').id]);
    expect(name.title).toMatch(/double-click to open its objects/);
  });

  it('opens it with the first double-click after a page load: object-list is there before any row', async () => {
    // The shell activates object-list first (a "uses" key, CR-0011). The panel then has its service
    // as soon as activate's promises settle, before a snapshot can arrive over the WebSocket, so the
    // first rows it shows already open object-list (object-list's finding of 2026-10-21, measured:
    // the double-click that did nothing came before the panel had rows).
    const server = new FakeServer([layer('A', 1)]);
    const ctx = createFakeContext({ pluginId: manifest.id, uses: manifest.uses });
    ctx.provideAs(MAP_VIEW, createFakeMapView());
    const list = createFakeObjectListService();
    ctx.provideAs(OBJECT_LIST, list);
    server.connect(ctx);
    await plugin.activate(ctx);
    await settle();
    act(() => {
      server.sendSnapshot(ctx);
    });
    const Panel = panelOf(ctx);
    const view = within(render(<Panel />).container);
    const name = view.getByRole('button', { name: 'Make A active' });
    expect(name.title).toMatch(/double-click to open its objects/);
    fireEvent.doubleClick(view.getByText('UNCLASSIFIED'));
    expect(list.opened).toEqual([server.layerNamed('A').id]);
  });
});

describe('AC11 (M2): rename starts with F2 or the rename button, not with a double-click', () => {
  it('a double-click on the name opens no name field; F2 and the rename button do', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const one = await openBrowser(server, { objectList: true });
    const nameA = one.view.getByRole('button', { name: 'Make A active' });
    fireEvent.doubleClick(nameA);
    expect(one.view.queryByRole('textbox')).toBeNull();

    fireEvent.keyDown(nameA, { key: 'F2' });
    fireEvent.keyDown(one.view.getByRole('textbox', { name: 'New name for A' }), { key: 'Escape' });
    await click(one, 'Rename A');
    expect(one.view.getByRole('textbox', { name: 'New name for A' })).toBeDefined();
    // Enter commits and Escape cancels as before: AC5.
  });
});

describe("AC12 (M2): the eyes follow the map view's visibility, also of a restored setup", () => {
  it('follows a visibility change made by the map view at once, without a click', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1)]);
    const one = await openBrowser(server);
    const a = server.layerNamed('A').id;
    const eyeA = () => within(one.row('A')).getByRole('button', { name: /^(Hide|Show) A$/ });

    // As the map view does when it restores a setup (map-view-2d function 20).
    act(() => {
      one.map.setLayerVisible(a, false);
    });
    expect([eyeA().getAttribute('aria-label'), eyeA().getAttribute('aria-pressed')]).toEqual(['Show A', 'true']);
    act(() => {
      one.map.setLayerVisible(a, true);
    });
    expect([eyeA().getAttribute('aria-label'), eyeA().getAttribute('aria-pressed')]).toEqual(['Hide A', 'false']);
    expect(server.requests).toEqual([]);
  });

  it('keeps no setup share of its own: the map view saves and restores the visibility', async () => {
    const one = await openBrowser(new FakeServer([layer('A', 1)]));
    await click(one, 'Hide A');
    expect(one.ctx.setupShare).toBeNull();
  });
});

describe('AC13 (M2): the active layer is where every drawing plugin places new objects', () => {
  it("keeps the active layer in the map view's shared state, which draw-symbols and draw-shapes read", async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1)]);
    const one = await openBrowser(server);
    await click(one, 'Make B active');
    expect(one.map.activeLayer.value).toBe(server.layerNamed('B').id);
    // Set elsewhere (another plugin), the panel marks it too.
    act(() => {
      one.map.activeLayer.set(server.layerNamed('A').id);
    });
    expect(one.row('A').getAttribute('aria-current')).toBe('true');
    // That draw-shapes places a shape there is checked in the browser.
  });
});

describe('AC14 (M2): the shared look, in every pane, density and look', () => {
  // The pane, density and look are the shell's: the panel follows them only if its CSS uses the
  // design tokens alone (ADR-0034). That it looks right in each is checked in the browser.
  const css = readFileSync(join(import.meta.dirname, '../src/layer-panel.css'), 'utf8');

  it('uses design tokens only: the test kit\'s checkLookCss finds nothing (owner, 2026-10-23)', () => {
    expect(checkLookCss(css, { pluginId: 'layer-panel' })).toEqual([]);
    // It does look: a fixed colour, a length, a 1.0 alias and a class of another plugin are found.
    const broken = `${css}\n.layer-panel-x { color: #fff; margin: 4px; background: var(--shell-bg); }\n.object-list-row { color: inherit; }`;
    expect(checkLookCss(broken, { pluginId: 'layer-panel' }).map((f) => f.rule).sort()).toEqual(['alias', 'class', 'colour', 'length']);
  });

  it('builds the panel from the shared components and Lucide icons', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const one = await openBrowser(server, { user: createFakeUser({ permissions: [] }) });
    const create = one.view.getByRole('button', { name: 'New layer' });
    expect(create.classList.contains('emc2-button')).toBe(true);
    expect(create.querySelector('svg.emc2-icon')).not.toBeNull();
    expect(one.view.getByRole('status').classList.contains('emc2-notice')).toBe(true);
    // The row buttons, the eye included: the shared IconButton, with a tooltip apart from the name
    // (CR-0024, SDK 1.2.0).
    const eye = one.view.getByRole('button', { name: 'Hide A' });
    expect([eye.className, eye.title, eye.getAttribute('aria-pressed'), eye.querySelector('svg.emc2-icon') !== null]).toEqual(['emc2-icon-button', 'Hide in this browser', 'false', true]);
    for (const name of ['Move A up', 'Move A down', 'Rename A', 'Delete A']) {
      const button = one.view.getByRole('button', { name });
      expect([button.className, button.querySelector('svg.emc2-icon') !== null, button.title]).toEqual(['emc2-icon-button', true, 'You may not change layers']);
    }
  });

  it('keeps "New layer" at the top of the panel while the list scrolls', async () => {
    const one = await openBrowser(new FakeServer([layer('A', 1)]));
    expect(one.view.getByRole('button', { name: 'New layer' }).closest('.layer-panel-toolbar-fixed')).not.toBeNull();
    expect(css).toMatch(/\.layer-panel-toolbar-fixed\s*\{[^}]*position:\s*sticky/);
  });
});

describe('AC15 (M2): without layers.edit, a double-click still opens object-list', () => {
  it('opens object-list, and rename stays off as in criterion 8', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const one = await openBrowser(server, { objectList: true, user: createFakeUser({ permissions: [] }) });
    const a = server.layerNamed('A').id;
    const nameA = one.view.getByRole('button', { name: 'Make A active' });
    fireEvent.doubleClick(nameA);
    fireEvent.keyDown(nameA, { key: 'Enter' });
    expect(one.opened).toEqual([a, a]);
    fireEvent.keyDown(nameA, { key: 'F2' });
    expect(one.view.queryByRole('textbox')).toBeNull();
    expect(nameA.title).toBe('Click to make active, double-click to open its objects');
    expect(server.requests).toEqual([]);
  });
});
