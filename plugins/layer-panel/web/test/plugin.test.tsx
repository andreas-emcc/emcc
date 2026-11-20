import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAP_VIEW, OBJECT_LIST, pluginIcon } from '@emc2/plugin-sdk';
import { Layers } from 'lucide-react';
import type { Layer } from '@emc2/plugin-sdk';
import { createFakeContext, createFakeMapView } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };
import { NO_OBJECT_LIST } from '../src/controller.ts';
import plugin from '../src/index.tsx';
import { openBrowser, panelOf, settle } from './browser.tsx';
import { FakeServer, layer } from './fakeServer.ts';

afterEach(cleanup);

describe('layer-panel web part', () => {
  it('is named after the plugin id', () => {
    // npm refuses two workspaces with the same name, so a copy must rename the package.
    expect(pkg.name).toBe(`@emc2/plugin-${manifest.id}`);
  });

  it('lists the CSS file the build writes (<id>.css)', () => {
    expect(manifest.web.css).toEqual([`${manifest.id}.css`]);
  });

  // T-204 (SDK 1.8.0 parts C and D): name once, icon always; no settings, so no hints to give.
  it('gives the Settings list and the panel the icon Layers, and shows no heading repeating the title (T-204)', async () => {
    expect([manifest.sdkVersion, manifest.icon, pluginIcon(manifest.icon)]).toEqual(['^1.8.0', 'Layers', Layers]);
    expect('settings' in manifest).toBe(false);
    const server = new FakeServer([layer('A', 1)]);
    const one = await openBrowser(server, { workspaces: [{ id: 'simulator.simulation', name: 'Simulation', order: 10 }], workspace: 'simulator.simulation' });
    expect(one.ctx.addedPanels.map(({ panel }) => panel.icon)).toEqual([Layers]);
    // Only the reference group's own heading, which is not the panel's title.
    expect(one.view.queryAllByRole('heading').map((h) => h.textContent)).toEqual(['View (reference)']);
  });

  it('declares the map view it requires and object-list, which it uses when it is there', () => {
    expect(manifest.requires).toEqual([MAP_VIEW.id]);
    expect(manifest.uses).toEqual([OBJECT_LIST.id]);
  });

  // AC23 (M4): a fresh browser opens "Layers" in the bottom pane, next to "Objects".
  it('adds the "Layers" panel to the bottom pane (AC23), in every workspace, and reports OK once the map view is there', async () => {
    const ctx = createFakeContext({ pluginId: manifest.id });
    ctx.provideAs(MAP_VIEW, createFakeMapView());
    await plugin.activate(ctx);
    await settle();
    expect(ctx.panels).toEqual([]);
    expect(ctx.addedPanels.map(({ panel }) => [panel.id, panel.title, panel.defaultPane, panel.icon === undefined, panel.workspaces])).toEqual([
      ['layer-panel', 'Layers', 'bottom', false, ['*']],
    ]);
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
  });

  it('reports OK without object-list, and says that a double-click opens nothing', async () => {
    const ctx = createFakeContext({ pluginId: manifest.id, uses: manifest.uses });
    ctx.provideAs(MAP_VIEW, createFakeMapView());
    await plugin.activate(ctx);
    await settle();
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: `ready; ${NO_OBJECT_LIST}` });
  });

  it('waits for the live picture before listing', async () => {
    const ctx = createFakeContext({ pluginId: manifest.id });
    await plugin.activate(ctx);
    const Panel = panelOf(ctx);
    render(<Panel />);
    expect(screen.getByText('Waiting for the live picture…')).toBeDefined();
    act(() => {
      ctx.live.snapshot({ layers: [layer('A', 0)] });
    });
    expect(screen.getByRole('button', { name: 'Make A active' })).toBeDefined();
  });

  it('works without the map view, degraded: the list and editing work, the eye does not', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const ctx = createFakeContext({ pluginId: manifest.id });
    server.connect(ctx);
    const failing = { ...ctx, services: { ...ctx.services, get: () => Promise.reject(new Error('map-view-2d failed')) } };
    await plugin.activate(failing);
    await settle();
    act(() => {
      server.sendSnapshot(ctx);
    });
    const Panel = panelOf(ctx);
    render(<Panel />);

    // Both services fail here: the map view and object-list.
    expect(ctx.statusHistory.at(-1)).toEqual({
      state: 'DEGRADED',
      detail: `map view not available: visibility and the active layer cannot be changed; ${NO_OBJECT_LIST}`,
    });
    expect(screen.getByText(/The map view is not available/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Hide A' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'New layer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await settle();
    expect(server.drawOrder()).toEqual(['Layer 1', 'A']);
  });

  it('accepts a second snapshot, which replaces everything', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1)]);
    const one = await openBrowser(server);
    act(() => {
      one.ctx.live.snapshot({ layers: [layer('C', 5), layer('D', 7)] });
    });
    expect(one.listed()).toEqual(['D', 'C']);
  });
});

describe('review fixes', () => {
  it('forgets a cancelled drag, so a later drop moves nothing', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1), layer('C', 0)]);
    const one = await openBrowser(server);
    fireEvent.dragStart(one.row('A'));
    fireEvent.dragEnd(one.row('A'));
    fireEvent.drop(one.row('C'));
    await settle();
    expect(server.requests).toHaveLength(0);
    expect(one.listed()).toEqual(['A', 'B', 'C']);
  });

  it('sends one create for a double click on "New layer" and on Create', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const one = await openBrowser(server);
    const button = one.view.getByRole('button', { name: 'New layer' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(one.view.getAllByRole('alertdialog')).toHaveLength(1);
    const create = one.view.getByRole('button', { name: 'Create' });
    fireEvent.click(create);
    fireEvent.click(create);
    await settle();
    expect(server.requests).toHaveLength(1);
    expect(one.listed()).toEqual(['Layer 1', 'A']);
  });

  it('shows a rendering error inside the panel and logs it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const server = new FakeServer([]);
      const one = await openBrowser(server);
      const broken = { ...layer('Broken', 1), label: undefined } as unknown as Layer;
      act(() => {
        one.ctx.live.snapshot({ layers: [broken] });
      });
      expect(one.view.getByRole('alert').textContent).toContain('The layer panel failed');
      expect(one.ctx.logs.some((l) => l.level === 'error' && l.message === 'layer panel: rendering failed')).toBe(true);

      act(() => {
        one.ctx.live.snapshot({ layers: [layer('A', 1)] });
      });
      fireEvent.click(one.view.getByRole('button', { name: 'Try again' }));
      expect(one.listed()).toEqual(['A']);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('disables New layer, the move buttons and Delete while that kind of change is on its way', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1), layer('C', 0)]);
    const one = await openBrowser(server);
    const button = (name: string) => one.view.getByRole('button', { name });
    const disabled = (name: string) => (button(name) as HTMLButtonElement).disabled;
    server.holdEvents();

    fireEvent.click(button('Move B up'));
    fireEvent.click(button('New layer'));
    fireEvent.click(button('Create'));
    fireEvent.click(button('Delete C'));
    fireEvent.click(within(one.view.getByRole('alertdialog', { name: 'Delete layer' })).getByRole('button', { name: 'Delete' }));
    await settle();
    expect(server.requests.map((r) => r.operation)).toEqual(['update', 'create', 'delete']);
    expect(['New layer', 'Move A down', 'Move B up', 'Move B down', 'Move C up', 'Delete C'].map(disabled)).toEqual([true, true, true, true, true, true]);
    expect(disabled('Delete A')).toBe(false);

    act(() => {
      server.deliver();
    });
    expect(one.listed()).toEqual(['Layer 1', 'B', 'A']);
    expect(['New layer', 'Move Layer 1 down', 'Move B up', 'Move B down', 'Move A up'].map(disabled)).toEqual([false, false, false, false, false]);
  });
});

describe('browser check fixes (2026-10-10)', () => {
  it('shows the classification and the object count on a line under the name', async () => {
    const server = new FakeServer([layer('A', 1)]);
    server.addObject(server.layerNamed('A').id);
    const one = await openBrowser(server);
    expect(one.row('A').querySelector('.layer-panel-meta')?.textContent).toBe('UNCLASSIFIED · 1 object');
  });

  it('makes the name a focusable button that is no <button>, so the row can be dragged by it', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1)]);
    const one = await openBrowser(server);
    const name = one.view.getByRole('button', { name: 'Make B active' });
    // Chrome starts no drag of a draggable row when the press lands on a <button> (browser check).
    expect(name.tagName).not.toBe('BUTTON');
    expect(name.tabIndex).toBe(0);
    expect(one.row('B').getAttribute('draggable')).toBe('true');

    fireEvent.keyUp(name, { key: ' ' });
    expect(one.map.activeLayer.value).toBe(server.layerNamed('B').id);
  });

  it('acts on keys like a native button: Space on key up, no repeats, no Ctrl/Alt/Meta combinations', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1)]);
    const one = await openBrowser(server, { objectList: true });
    const [a, b] = [server.layerNamed('A').id, server.layerNamed('B').id];
    const nameB = one.view.getByRole('button', { name: 'Make B active' });
    expect(one.map.activeLayer.value).toBe(a);

    for (const key of ['Enter', ' ']) {
      for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) {
        fireEvent.keyDown(nameB, { key, [modifier]: true });
        fireEvent.keyUp(nameB, { key, [modifier]: true });
      }
    }
    fireEvent.keyDown(nameB, { key: 'Enter', repeat: true });
    expect(one.map.activeLayer.value).toBe(a);
    expect(one.opened).toEqual([]);

    expect(fireEvent.keyDown(nameB, { key: ' ' })).toBe(false); // default (scrolling) prevented
    expect(one.map.activeLayer.value).toBe(a);
    fireEvent.keyUp(nameB, { key: ' ' });
    expect(one.map.activeLayer.value).toBe(b);
  });

  it('starts renaming with F2 on the name', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1)]);
    const one = await openBrowser(server);
    fireEvent.keyDown(one.view.getByRole('button', { name: 'Make B active' }), { key: 'F2' });
    expect(one.view.getByRole('textbox', { name: 'New name for B' })).toBeDefined();
  });

  it('selects the old name when renaming starts, so typing replaces it', async () => {
    const server = new FakeServer([layer('Alpha', 1)]);
    const one = await openBrowser(server);
    fireEvent.click(one.view.getByRole('button', { name: 'Rename Alpha' }));
    const input = one.view.getByRole<HTMLInputElement>('textbox', { name: 'New name for Alpha' });
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'Alpha'.length]);
  });
});

