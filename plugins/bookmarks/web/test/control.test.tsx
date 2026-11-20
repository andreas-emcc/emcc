import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JsonValue } from '@emc2/plugin-sdk';
import manifest from '../../plugin.json' with { type: 'json' };
import { DOCUMENT_NAME, parseDocument, serialize, type TreeItem } from '../src/tree.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

import { addCurrentView, bookmark, openMenu, seed, setup, showMap, stored, trigger, watchReads } from './support.tsx';

describe('AC 1: Add bookmark saves the view, going to it restores it', () => {
  it('saves projection, background, centre and zoom, and restores all four after another projection in between', async () => {
    const { ctx, map } = await setup();
    showMap(map, 'EPSG:3413', 'naturalearth', [15.25, 62.5], 1234.5);
    await openMenu();
    await addCurrentView();

    const saved = stored(ctx);
    expect(saved).toHaveLength(1);
    const first = saved[0];
    expect(first).toMatchObject({ type: 'bookmark', mapType: { projection: 'EPSG:3413', background: 'naturalearth' }, center: [15.25, 62.5], resolution: 1234.5 });

    // the user goes elsewhere, in another projection
    showMap(map, 'EPSG:3857', 'osm', [100, -20], 50);
    fireEvent.click(await screen.findByRole('button', { name: first?.name ?? '' }));

    expect(map.mapType).toEqual({ projection: 'EPSG:3413', background: 'naturalearth' });
    expect(map.viewport.projection).toBe('EPSG:3413');
    expect(map.goToCalls.at(-1)).toEqual({ center: [15.25, 62.5], resolution: 1234.5 });
    expect(map.viewport.center).toEqual([15.25, 62.5]);
    expect(map.viewport.resolution).toBe(1234.5);
    expect(ctx.notifications).toEqual([]);
  });

  it('proposes the centre in decimal degrees, latitude first, and saves the name the user typed', async () => {
    const { ctx, map } = await setup();
    showMap(map, 'EPSG:3857', 'osm', [15.25, 62.5], 611.5);
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Add bookmark' }));
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('62.5000°N 15.2500°E');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Harbour  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('button', { name: 'Harbour' });
    expect(stored(ctx).map((i) => i.name)).toEqual(['Harbour']);
  });

  it("proposes the centre in the user's coordinate format when the coordinates plugin is there", async () => {
    const { map } = await setup({ withCoordinates: true });
    showMap(map, 'EPSG:3857', 'osm', [15.25, 62.5], 611.5);
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Add bookmark' }));
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('62.5 N 15.25 E');
  });

  it('keeps the centre as longitude, latitude, and brings a longitude beyond 180 back into range', async () => {
    const { ctx, map } = await setup();
    showMap(map, 'EPSG:3857', 'osm', [195.5, -33.25], 100);
    await openMenu();
    await addCurrentView();
    expect(stored(ctx)[0]).toMatchObject({ center: [-164.5, -33.25] });
  });

  it('refuses an empty name and saves nothing', async () => {
    const { ctx } = await setup();
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Add bookmark' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('A name has 1 to 100 characters.')).toBeDefined();
    expect(stored(ctx)).toEqual([]);
  });

  it('sends one change for a double click on Save', async () => {
    const { ctx } = await setup();
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Add bookmark' }));
    const form = screen.getByLabelText('Name').closest('form');
    if (!form) throw new Error('no form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => {
      expect(screen.queryByLabelText('Name')).toBeNull();
    });
    expect(stored(ctx)).toHaveLength(1);
  });

  it('puts the new bookmark in the folder that is open in the menu, at its end', async () => {
    const { ctx, map } = await setup();
    await seed(ctx, [{ type: 'folder', id: 'f', name: 'Ports', children: [bookmark('b1', 'Old')] }]);
    showMap(map, 'EPSG:3857', 'osm', [15.25, 62.5], 611.5);
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Ports' })); // opens the folder
    fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }));
    expect(screen.getByText('In: Ports')).toBeDefined();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('button', { name: 'New' });
    const folder = stored(ctx)[0];
    expect(folder?.type === 'folder' && folder.children.map((c) => c.name)).toEqual(['Old', 'New']);
  });
});

describe('AC 2: each bookmark restores its own projection and background', () => {
  it('EPSG:3413 with Natural Earth, and EPSG:3857 with OpenStreetMap', async () => {
    const { ctx, map } = await setup();
    await seed(ctx, [
      bookmark('polar', 'Polar', { mapType: { projection: 'EPSG:3413', background: 'naturalearth' }, center: [-45.5, 78.25], resolution: 2000 }),
      bookmark('mercator', 'Mercator', { mapType: { projection: 'EPSG:3857', background: 'osm' }, center: [15.25, 62.5], resolution: 611.5 }),
    ]);
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Polar' }));
    expect(map.mapType).toEqual({ projection: 'EPSG:3413', background: 'naturalearth' });
    expect(map.viewport.center).toEqual([-45.5, 78.25]);

    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Mercator' }));
    expect(map.mapType).toEqual({ projection: 'EPSG:3857', background: 'osm' });
    expect(map.viewport.center).toEqual([15.25, 62.5]);
    expect(ctx.notifications).toEqual([]);
  });

  it('closes the menu when a bookmark is chosen', async () => {
    const { ctx } = await setup();
    await seed(ctx, [bookmark('b', 'Home')]);
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Home' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('AC 3: a projection or background that is no longer available', () => {
  // The map view announces the fallback itself (SDK: `setMapType` "with a notice"), so the plugin adds nothing:
  // the test kit's map view says nothing, and any notification here would come from the plugin, doubled in the real shell.
  it('opens with the map view\'s fallback background, says nothing itself; centre and zoom apply', async () => {
    const { ctx, map } = await setup();
    await seed(ctx, [bookmark('b', 'Old chart', { mapType: { projection: 'EPSG:3857', background: 'wms-gone' }, center: [15.25, 62.5], resolution: 611.5 })]);
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Old chart' }));
    expect(map.mapType.background).toBe('osm'); // the fake's fallback
    expect(map.goToCalls.at(-1)).toEqual({ center: [15.25, 62.5], resolution: 611.5 });
    expect(ctx.notifications).toEqual([]);
  });

  it('keeps the map\'s projection for one that is gone, says nothing itself, and still applies centre and zoom', async () => {
    const { ctx, map } = await setup();
    await seed(ctx, [bookmark('b', 'Antarctic', { mapType: { projection: 'EPSG:9999', background: 'osm' }, center: [10.5, -75.25], resolution: 900 })]);
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Antarctic' }));
    expect(map.mapType.projection).toBe('EPSG:3857');
    expect(map.goToCalls.at(-1)).toEqual({ center: [10.5, -75.25], resolution: 900 });
    expect(ctx.notifications).toEqual([]);
  });

  it('says so when the map shows another centre than the one saved, because the projection cannot show it (CR-0016)', async () => {
    const { ctx, map } = await setup();
    await seed(ctx, [bookmark('b', 'Far south', { center: [10.5, -89.5] })]);
    const goTo = map.goTo.bind(map);
    vi.spyOn(map, 'goTo').mockImplementation((center, resolution) => {
      goTo(center, resolution);
      map.setViewport({ ...map.viewport, center: [10.5, -85] }); // the map view's nearest point
    });
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Far south' }));
    expect(ctx.notifications[0]?.message).toContain('cannot be shown');
    expect(ctx.notifications[0]?.message).toContain('89.5000°S');
  });
});

describe('a user without bookmarks makes no request that fails', () => {
  it('when the menu opens, when the first bookmark is added, and when it opens again', async () => {
    const { ctx } = await setup();
    const failing = watchReads(ctx);
    await openMenu();
    expect(await screen.findByText('No bookmarks yet')).toBeDefined();
    await addCurrentView('First');
    fireEvent.click(trigger()); // closes
    await openMenu();
    expect(await screen.findByRole('button', { name: 'First' })).toBeDefined();
    expect(failing).toEqual([]);
  });
});

describe('AC 4: the newest tree is read each time the menu opens', () => {
  it("shows bookmarks another browser saved, after the menu is opened again, and drops one removed there", async () => {
    const { ctx } = await setup();
    await openMenu();
    expect(await screen.findByText('No bookmarks yet')).toBeDefined();
    fireEvent.click(trigger()); // closes

    await seed(ctx, [bookmark('b', 'From another browser')]); // the same user's other browser wrote it
    await openMenu();
    expect(await screen.findByRole('button', { name: 'From another browser' })).toBeDefined();
    fireEvent.click(trigger());

    await ctx.userDocuments.delete(DOCUMENT_NAME);
    await openMenu();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'From another browser' })).toBeNull();
    });
  });
});

describe('AC 7: at the limit', () => {
  it('switches Add off and says why, and follows the setting when it changes', async () => {
    const { ctx } = await setup({ maxItems: 2 });
    await seed(ctx, [bookmark('a', 'A'), { type: 'folder', id: 'f', name: 'F', children: [] }]);
    await openMenu();
    const add = await screen.findByRole('button', { name: 'Add bookmark' });
    await waitFor(() => {
      expect((add as HTMLButtonElement).disabled).toBe(true);
    });
    expect(screen.getByText('The limit of 2 bookmarks and folders is reached')).toBeDefined();

    act(() => {
      ctx.changeSettings({ maxItems: 3 });
    });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add bookmark' }).disabled).toBe(false);
    expect(screen.queryByText(/limit of/)).toBeNull();
  });

  it('tells the user when the stored document is full before the count is, and writes nothing', async () => {
    const { ctx } = await setup();
    // long ids make a few bookmarks fill ECore's 256 KiB; the menu then stays small to draw
    const fitting: TreeItem[] = [];
    const size = () => new TextEncoder().encode(JSON.stringify(serialize({ items: fitting }))).length;
    while (size() < 256 * 1024 - 5200) fitting.push(bookmark(`id-${String(fitting.length)}-${'x'.repeat(4000)}`, 'n'.repeat(100)));
    // one more, as long as it takes to leave 100 bytes: less than the new bookmark needs
    fitting.push(bookmark('last', 'n'));
    fitting.splice(-1, 1, bookmark('l'.repeat(256 * 1024 - 100 - size() + 1), 'n'));
    await seed(ctx, fitting);
    const before = ctx.storedUserDocuments[DOCUMENT_NAME];
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Add bookmark' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'n'.repeat(100) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/take up all the room that is allowed/)).toBeDefined();
    expect(ctx.storedUserDocuments[DOCUMENT_NAME]).toEqual(before);
  });

  it.each(['get', 'list'] as const)('says that something went wrong for an unexpected error in %s, and logs it', async (method) => {
    const { ctx } = await setup();
    await seed(ctx, [bookmark('a', 'Home')]); // a stored document, so that it is read
    vi.spyOn(ctx.userDocuments, method).mockRejectedValue(new Error('a bug'));
    await openMenu();
    expect(await screen.findByText(/Something went wrong/)).toBeDefined();
    expect(ctx.logs.some((l) => l.level === 'error')).toBe(true);
  });
});

describe('AC 8: a document that cannot be read', () => {
  const unreadable: JsonValue = { version: 1, items: 'garbage' };

  it('shows an error, offers nothing that writes, and leaves the document alone', async () => {
    const { ctx } = await setup();
    await ctx.userDocuments.put(DOCUMENT_NAME, unreadable);
    await openMenu();
    expect(await screen.findByText(/damaged and cannot be read/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Add bookmark' })).toBeNull();
    expect(ctx.storedUserDocuments[DOCUMENT_NAME]).toEqual(unreadable);
  });

  it('says it was written by a newer version', async () => {
    const { ctx } = await setup();
    await ctx.userDocuments.put(DOCUMENT_NAME, { version: 2, items: [] });
    await openMenu();
    expect(await screen.findByText(/newer version/)).toBeDefined();
  });

  it('starts an empty tree only after the user has confirmed, and not when they cancel', async () => {
    const { ctx } = await setup();
    await ctx.userDocuments.put(DOCUMENT_NAME, unreadable);
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Start an empty tree…' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(ctx.storedUserDocuments[DOCUMENT_NAME]).toEqual(unreadable);

    fireEvent.click(screen.getByRole('button', { name: 'Start an empty tree…' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Start empty' }));
    await screen.findByRole('button', { name: 'Add bookmark' });
    expect(stored(ctx)).toEqual([]);
    expect(parseDocument(ctx.storedUserDocuments[DOCUMENT_NAME] ?? null).kind).toBe('tree');
  });
});

describe('a lost connection', () => {
  it('says so, writes nothing, and loads when asked again', async () => {
    const { ctx } = await setup();
    await seed(ctx, [bookmark('b', 'Home')]);
    ctx.failUserDocuments(true);
    await openMenu();
    expect(await screen.findByText(/did not answer/)).toBeDefined();
    ctx.failUserDocuments(false);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Home' })).toBeDefined();
  });

  it('keeps the form open and says so when saving fails', async () => {
    const { ctx } = await setup();
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Add bookmark' }));
    ctx.failUserDocuments(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/nothing was saved/)).toBeDefined();
    expect(screen.getByLabelText('Name')).toBeDefined();
  });
});

describe('AC 10: without a map view', () => {
  it('shows the control switched off with its hint, and reports DEGRADED', async () => {
    const { ctx } = await setup({ withMap: false });
    const button = trigger() as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('No map view');
    expect(screen.getByText('No map view')).toBeDefined();
    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'DEGRADED', detail: 'No map view' });
  });

  it('declares the map view under uses, not requires', () => {
    expect(manifest.uses).toContain('emc2.map-view');
    expect('requires' in manifest).toBe(false);
  });

  it('reports OK with a map view, and follows a bad setting that is corrected', async () => {
    const { ctx } = await setup();
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
    act(() => {
      ctx.changeSettings({ maxItems: 0 });
    });
    expect(ctx.statusHistory.at(-1)?.state).toBe('DEGRADED');
    act(() => {
      ctx.changeSettings({ maxItems: 50 });
    });
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
  });
});

describe('AC 11: the keyboard and the menu', () => {
  it('is the first plugin item in the top bar', async () => {
    const { ctx } = await setup();
    expect(ctx.topBarItems.map((i) => [i.id, i.order])).toEqual([['bookmarks', 0]]);
  });

  it('moves the focus into the menu when it opens, and Escape closes it and gives the focus back', async () => {
    await setup();
    const dialog = await openMenu();
    await waitFor(() => {
      expect(dialog.contains(globalThis.document.activeElement)).toBe(true);
    });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(globalThis.document.activeElement).toBe(trigger());
  });

  it('closes on a click outside, not on one inside', async () => {
    await setup();
    const dialog = await openMenu();
    fireEvent.pointerDown(dialog);
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.pointerDown(globalThis.document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancels the form on Escape and keeps the menu open', async () => {
    await setup();
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Add bookmark' }));
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' });
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('keeps the focus in the menu when the form opens and closes, so that Escape works without Tab', async () => {
    await setup();
    const dialog = await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Add bookmark' }));
    await waitFor(() => {
      expect(globalThis.document.activeElement).toBe(screen.getByLabelText('Name'));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(globalThis.document.activeElement).toBe(screen.getByRole('button', { name: 'Add bookmark' }));
    });
    // the focused element is the one that gets the key, as in a browser
    const focused = globalThis.document.activeElement;
    if (!focused) throw new Error('nothing has the focus');
    fireEvent.keyDown(focused, { key: 'Escape' });
    expect(dialog.isConnected).toBe(false);
  });
});
