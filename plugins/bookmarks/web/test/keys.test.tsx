// Criteria 6 and 11 with the shared Tree's keys and drag and drop (CR-0019) and the Popover in the top layer (CR-0021).
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TreeItem } from '../src/tree.ts';
import { bookmark, openMenu, seed, setup, stored } from './support.tsx';

beforeAll(() => {
  // jsdom has no DragEvent, so drag events would lose clientY.
  const win = globalThis as unknown as Record<string, unknown>;
  if (win['DragEvent'] === undefined) win['DragEvent'] = class extends MouseEvent {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const folder = (id: string, name: string, children: TreeItem[] = []): TreeItem => ({ type: 'folder', id, name, children });
const names = (items: readonly TreeItem[]): string[] => items.map((i) => i.name);
const children = (items: readonly TreeItem[], name: string): readonly TreeItem[] => {
  const found = items.find((i) => i.name === name);
  return found?.type === 'folder' ? found.children : [];
};
const row = (name: string) => screen.findByRole('button', { name });
const active = () => globalThis.document.activeElement;

describe('AC 11: arrow keys in the tree', () => {
  it('moves between the visible rows, opens and closes folders, and is one Tab stop', async () => {
    const { ctx } = await setup();
    await seed(ctx, [bookmark('a', 'Home'), folder('f', 'Ports', [bookmark('b', 'Quay')]), bookmark('c', 'Away')]);
    await openMenu();
    const home = await row('Home');
    const ports = screen.getByRole('button', { name: 'Ports' });
    const away = screen.getByRole('button', { name: 'Away' });
    // one Tab stop: the first row, the others are reached by arrows
    expect([home.tabIndex, ports.tabIndex, away.tabIndex]).toEqual([0, -1, -1]);

    home.focus();
    fireEvent.keyDown(home, { key: 'ArrowDown' });
    expect(active()).toBe(ports);
    fireEvent.keyDown(ports, { key: 'ArrowRight' }); // opens the closed folder
    await screen.findByRole('button', { name: 'Quay' });
    fireEvent.keyDown(ports, { key: 'ArrowDown' }); // the first child is next
    expect(active()).toBe(screen.getByRole('button', { name: 'Quay' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Quay' }), { key: 'ArrowDown' });
    expect(active()).toBe(away);
    fireEvent.keyDown(away, { key: 'Home' });
    expect(active()).toBe(home);
    fireEvent.keyDown(home, { key: 'End' });
    expect(active()).toBe(away);

    // Left on a child goes to the folder above it, and on an open folder closes it
    screen.getByRole('button', { name: 'Quay' }).focus(); // the tree acts on the row that has the focus
    fireEvent.keyDown(screen.getByRole('button', { name: 'Quay' }), { key: 'ArrowLeft' });
    expect(active()).toBe(ports);
    fireEvent.keyDown(ports, { key: 'ArrowLeft' });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Quay' })).toBeNull();
    });
  });

  it('goes to a bookmark when its row is activated (Enter on a button is a click; jsdom has no such conversion)', async () => {
    const { ctx, map } = await setup();
    await seed(ctx, [bookmark('a', 'Home')]);
    await openMenu();
    const home = await row('Home');
    home.focus();
    fireEvent.click(home); // Enter on a button is its click
    expect(map.goToCalls).toHaveLength(1);
  });

  it('puts the focus on the first place in "Move to…" and moves with the arrows', async () => {
    const { ctx } = await setup();
    await seed(ctx, [bookmark('a', 'A'), folder('f', 'Ports'), folder('g', 'Airfields')]);
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Edit bookmarks' }));
    fireEvent.click(await row('A'));
    fireEvent.click(screen.getByRole('button', { name: 'Move to…' }));
    const items = await screen.findAllByRole('menuitem');
    await waitFor(() => {
      expect(active()).toBe(items[0]);
    });
    fireEvent.keyDown(items[0] as HTMLElement, { key: 'ArrowDown' });
    expect(active()).toBe(items[1]);
    fireEvent.keyDown(items[1] as HTMLElement, { key: 'ArrowDown' });
    expect(active()).toBe(items[0]); // wraps
  });
});

describe('AC 6: drag and drop', () => {
  const data = () => ({ effectAllowed: 'none', dropEffect: 'none', setData: vi.fn(), getData: () => '' });
  /** Every row is 20 px high at the top of the page, so that clientY says where in a row the pointer is. */
  const rows = () =>
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 100, right: 200, bottom: 120, width: 200, height: 20, x: 0, y: 100, toJSON: () => ({}) });
  const base = (): TreeItem[] => [bookmark('a', 'A'), bookmark('b', 'B'), bookmark('c', 'C'), folder('f', 'Ports', [bookmark('x', 'X')])];

  it('puts an item before another row, the others keeping their order', async () => {
    const { ctx } = await setup();
    await seed(ctx, base());
    await openMenu();
    rows();
    const dt = data();
    fireEvent.dragStart(await row('C'), { dataTransfer: dt });
    fireEvent.dragOver(screen.getByRole('button', { name: 'A' }), { dataTransfer: dt, clientY: 104 });
    fireEvent.drop(screen.getByRole('button', { name: 'A' }), { dataTransfer: dt, clientY: 104 });
    await waitFor(() => {
      expect(names(stored(ctx))).toEqual(['C', 'A', 'B', 'Ports']);
    });
  });

  it('puts an item after another row, and reorders inside one folder', async () => {
    const { ctx } = await setup();
    await seed(ctx, [bookmark('a', 'A'), folder('f', 'Ports', [bookmark('x', 'X'), bookmark('y', 'Y'), bookmark('z', 'Z')])]);
    await openMenu();
    fireEvent.click(await row('Ports'));
    rows();
    const dt = data();
    // X after Z, in the same folder: the order inside a folder, which "Move to…" cannot change
    fireEvent.dragStart(await row('X'), { dataTransfer: dt });
    fireEvent.dragOver(screen.getByRole('button', { name: 'Z' }), { dataTransfer: dt, clientY: 116 });
    fireEvent.drop(screen.getByRole('button', { name: 'Z' }), { dataTransfer: dt, clientY: 116 });
    await waitFor(() => {
      expect(names(children(stored(ctx), 'Ports'))).toEqual(['Y', 'Z', 'X']);
    });
    expect(names(stored(ctx))).toEqual(['A', 'Ports']);
  });

  it('puts an item into a folder by the middle of its row, at the end', async () => {
    const { ctx } = await setup();
    await seed(ctx, base());
    await openMenu();
    rows();
    const dt = data();
    fireEvent.dragStart(await row('A'), { dataTransfer: dt });
    fireEvent.dragOver(screen.getByRole('button', { name: 'Ports' }), { dataTransfer: dt, clientY: 110 });
    fireEvent.drop(screen.getByRole('button', { name: 'Ports' }), { dataTransfer: dt, clientY: 110 });
    await waitFor(() => {
      expect(names(children(stored(ctx), 'Ports'))).toEqual(['X', 'A']);
    });
    expect(names(stored(ctx))).toEqual(['B', 'C', 'Ports']);
  });

  it('puts a folder before another row by its edge (folders can be reordered too)', async () => {
    const { ctx } = await setup();
    await seed(ctx, base());
    await openMenu();
    rows();
    const dt = data();
    fireEvent.dragStart(await row('Ports'), { dataTransfer: dt });
    fireEvent.dragOver(screen.getByRole('button', { name: 'A' }), { dataTransfer: dt, clientY: 104 });
    fireEvent.drop(screen.getByRole('button', { name: 'A' }), { dataTransfer: dt, clientY: 104 });
    await waitFor(() => {
      expect(names(stored(ctx))).toEqual(['Ports', 'A', 'B', 'C']);
    });
  });

  it('shows a place that would put a folder deeper than level 5 as not allowed, and drops nothing there', async () => {
    const { ctx } = await setup();
    await seed(ctx, [folder('f1', 'L1', [folder('f2', 'L2', [folder('f3', 'L3', [folder('f4', 'L4')])])]), folder('g', 'G', [folder('h', 'H')])]);
    await openMenu();
    for (const level of ['L1', 'L2', 'L3', 'L4']) fireEvent.click(await row(level));
    rows();
    const dt = data();
    fireEvent.dragStart(await row('G'), { dataTransfer: dt });
    // G (with H inside) into L4 would put H on level 6; into L3 it fits
    const notAllowed = fireEvent.dragOver(screen.getByRole('button', { name: 'L4' }), { dataTransfer: dt, clientY: 110 });
    const allowed = !fireEvent.dragOver(screen.getByRole('button', { name: 'L3' }), { dataTransfer: dt, clientY: 110 });
    expect([notAllowed, allowed]).toEqual([true, true]); // true means "not prevented" for the first: refused
    fireEvent.drop(screen.getByRole('button', { name: 'L4' }), { dataTransfer: dt, clientY: 110 });
    // a drop is saved asynchronously: give a wrong write time to happen before looking
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(names(stored(ctx))).toEqual(['L1', 'G']); // nothing was written
  });
});

describe('the Popover in the top layer (CR-0021)', () => {
  it('stays open for a press in the delete question (it is inside the anchor) and for its own Escape, and closes on a press outside afterwards', async () => {
    const { ctx } = await setup();
    await seed(ctx, [folder('f', 'Ports', [bookmark('x', 'X')])]);
    const dialog = await openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Edit bookmarks' }));
    fireEvent.click(await row('Ports'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const question = await screen.findByRole('alertdialog');
    fireEvent.pointerDown(within(question).getByRole('button', { name: 'Cancel' }));
    expect(dialog.isConnected).toBe(true);
    fireEvent.keyDown(question, { key: 'Escape' }); // the question's own Escape: it closes, not the menu
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(dialog.isConnected).toBe(true);
    fireEvent.pointerDown(globalThis.document.body);
    expect(dialog.isConnected).toBe(false);
  });

  it('has no menu wrapper or press-outside listener of its own any more', async () => {
    const add = vi.spyOn(globalThis.document, 'addEventListener');
    await setup();
    await openMenu();
    expect(add.mock.calls.filter(([type]) => type === 'pointerdown').length).toBe(1); // the Popover's own, not ours
    expect(globalThis.document.querySelector('.bookmarks-menu')).toBeNull();
  });
});
