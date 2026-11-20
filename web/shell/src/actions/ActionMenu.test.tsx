import type { MapObject, ObjectAction, User, Uuid } from '@emc2/plugin-sdk';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShellStore } from '../ui/store.ts';
import { ActionMenuView } from './ActionMenu.tsx';
import { ActionMenu } from './menu.ts';
import { ActionRegistry } from './registry.ts';

const object = (id: string, name: string): MapObject => ({ id, version: 1, layerId: 'L', type: 'core.symbol', dataType: 'core.general', properties: { name } }) as MapObject;
const objects = [object('a', 'Alpha'), object('b', 'Bravo')];
const user = { has: () => true } as unknown as User;

function setUp() {
  const registry = new ActionRegistry();
  const runs: string[] = [];
  const add = (id: string, group: string) => registry.addObjectAction('p', { id, label: id, group, appliesTo: {}, multiple: true, run: () => { runs.push(id); } } satisfies ObjectAction);
  add('Zoom to', 'view');
  add('Edit', 'edit');
  add('Delete', 'delete');
  const selection = { value: [] as readonly Uuid[], set: vi.fn(), onChange: () => () => undefined };
  const menu = new ActionMenu({
    store: new ShellStore(), registry, user: () => user,
    objects: { getObjects: (ids) => Promise.resolve({ found: objects.filter((o) => ids.includes(o.id)), missing: [] }) },
    dataTypes: () => [], layerName: () => 'Layer 1', mapView: () => Promise.resolve({ selection } as never), symbols: () => Promise.resolve(null),
  });
  const opener = document.body.appendChild(document.createElement('button'));
  opener.textContent = 'opener';
  opener.focus();
  render(<ActionMenuView menu={menu} />);
  return { menu, runs, opener, selection };
}

const items = () => screen.getAllByRole('menuitem');

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe("the shell's menu on the page", () => {
  it('shows the actions in groups, with the focus on the first; Up, Down, Home and End move it, Enter runs one', async () => {
    const t = setUp();
    act(() => { t.menu.open([40, 50], { objects: ['a'] }); });
    expect(await screen.findByRole('menu', { name: 'Actions' })).toBeTruthy();
    expect(items().map((i) => i.textContent)).toEqual(['Zoom to', 'Edit', 'Delete']);
    expect(screen.getAllByRole('separator')).toHaveLength(2);
    expect(document.activeElement).toBe(items()[0]);

    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowUp' }); // round to the last
    expect(document.activeElement).toBe(items()[2]);
    fireEvent.keyDown(menu, { key: 'Home' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items()[1]);
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(items()[2]);
    fireEvent.click(items()[1] as HTMLElement);
    expect(t.runs).toEqual(['Edit']);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(t.opener); // the focus goes back
  });

  it('closes on Escape and on a press outside', async () => {
    const t = setUp();
    act(() => { t.menu.open([40, 50], { objects: ['a'] }); });
    await screen.findByRole('menu');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(t.opener);

    act(() => { t.menu.open([40, 50], { objects: ['a'] }); });
    await screen.findByRole('menu');
    fireEvent.pointerDown(t.opener);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(t.runs).toEqual([]);
  });

  it('closes on Tab, with the focus back on the opener first, and when the focus leaves it, where the focus then stays (review F2)', async () => {
    const t = setUp();
    act(() => { t.menu.open([40, 50], { objects: ['a'] }); });
    await screen.findByRole('menu');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(t.opener);

    const elsewhere = document.body.appendChild(document.createElement('button'));
    act(() => { t.menu.open([40, 50], { objects: ['a'] }); });
    await screen.findByRole('menu');
    act(() => { elsewhere.focus(); });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
    expect(t.runs).toEqual([]);
  });

  it('lists overlapping objects with their layer to choose from, then shows the chosen one\'s actions', async () => {
    const t = setUp();
    act(() => { t.menu.open([40, 50], { choose: ['a', 'b'] }); });
    expect(await screen.findByRole('menu', { name: 'Choose an object' })).toBeTruthy();
    expect(items().map((i) => i.textContent)).toEqual(['AlphaLayer 1', 'BravoLayer 1']);
    fireEvent.click(items()[1] as HTMLElement);
    expect(await screen.findByRole('menu', { name: 'Actions' })).toBeTruthy();
    expect(t.selection.set).toHaveBeenCalledExactlyOnceWith(['b']);
  });

  it('shows "No actions" in grey when none apply', async () => {
    const t = setUp();
    act(() => { t.menu.open([40, 50], { position: [0, 0] }); });
    const none = await screen.findByRole('menuitem', { name: 'No actions' });
    expect(none.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('menu').parentElement); // the menu itself, so Escape works
  });

  it('stays inside the window', async () => {
    const t = setUp();
    act(() => { t.menu.open([window.innerWidth - 2, 50], { objects: ['a'] }); });
    const menu = (await screen.findByRole('menu')).parentElement as HTMLElement;
    expect(Number.parseFloat(menu.style.left)).toBeLessThanOrEqual(window.innerWidth - 8);
  });
});
