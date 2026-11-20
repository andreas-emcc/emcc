import type { ChangeEvent, Layer, LivePictureListener, MapObject, Snapshot, User } from '@emc2/plugin-sdk';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShellStore, VIEW_INFO } from '../ui/store.ts';
import { createActions } from './actions.ts';
import { DeleteQuestion } from './DeleteQuestion.tsx';
import { FIRST_WAIT_MS, KnownLayers, type LayerSource } from '../layers/known.ts';

const user = { has: (p: string) => p === 'objects.edit' } as unknown as User;
const object = { id: 'a', version: 2, layerId: 'L', type: 'core.symbol', dataType: 'core.general' } as MapObject;

/** A live picture source that hands out its listener, so a test can send the snapshot and changes. */
function layerSource() {
  let listener: LivePictureListener | null = null;
  const subscribe = vi.fn<LayerSource['subscribe']>((l) => {
    listener = l;
    return () => undefined;
  });
  const source: LayerSource = { subscribe };
  const snapshot = (layers: readonly Pick<Layer, 'id' | 'name'>[]) => { listener?.snapshot({ layers } as unknown as Snapshot); };
  const changes = (events: readonly Partial<ChangeEvent>[]) => { listener?.changes(events as readonly ChangeEvent[]); };
  return { source, subscribe, snapshot, changes };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the shell's actions at start", () => {
  it("register the shared Delete, Move and Copy (ADR-0053) as the shell's own object actions, and give the menu and the Delete one store", async () => {
    const store = new ShellStore();
    const connection = { getObjects: vi.fn(() => Promise.resolve({ found: [object], missing: [] })), submit: vi.fn() };
    const actions = createActions({
      store, user: () => user, connection, dataTypes: () => [], mapView: () => Promise.resolve(null), symbols: () => Promise.resolve(null),
      layers: () => null, workspace: () => VIEW_INFO,
    });
    expect(actions.registry.objects.map((r) => [r.pluginId, r.action.id])).toEqual([['core-shell', 'delete'], ['core-shell', 'move-to-layer'], ['core-shell', 'copy-to-layer']]);
    actions.menu.open([1, 1], { objects: ['a'] });
    await vi.waitFor(() => { expect(actions.menu.getState().kind).toBe('actions'); });
    const state = actions.menu.getState();
    if (state.kind !== 'actions') throw new Error(state.kind);
    expect(state.entries.map((e) => e.label)).toEqual(['Move to layer…', 'Copy to layer…', 'Delete']);
    actions.menu.run(state.entries.find((e) => e.label === 'Delete')?.key ?? '');
    expect(actions.deleter.getState().asking).toEqual(['a']);
  });
});

describe("the layers' names for the choose list", () => {
  it('subscribe only when first needed, to the layers alone, and follow the changes', async () => {
    const s = layerSource();
    const names = new KnownLayers(() => s.source);
    expect(s.subscribe).not.toHaveBeenCalled();
    const ready = names.ready();
    expect(s.subscribe).toHaveBeenCalledOnce();
    expect(s.subscribe.mock.calls[0]?.[2]).toEqual({ objects: false, workspaces: ['*'] }); // every workspace the user may see (F4)
    s.snapshot([{ id: 'L1', name: 'Blue' }, { id: 'L2', name: 'Red' }]);
    await ready;
    expect(names.name('L1')).toBe('Blue');

    s.changes([
      { entityType: 'layer', entityId: 'L1', state: { id: 'L1', name: 'Navy' } as Layer },
      { entityType: 'layer', entityId: 'L2', state: null },
      { entityType: 'object', entityId: 'x', state: null },
    ]);
    expect([names.name('L1'), names.name('L2'), names.name('x')]).toEqual(['Navy', null, null]);
    await names.ready(); // at once later on
    expect(s.subscribe).toHaveBeenCalledOnce();
  });

  it('wait at most a while for the first snapshot, and not at all without a live picture', async () => {
    vi.useFakeTimers();
    const s = layerSource();
    let done = false;
    void new KnownLayers(() => s.source).ready().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(FIRST_WAIT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);

    const none = new KnownLayers(() => null);
    await none.ready();
    expect(none.name('L1')).toBeNull();
  });
});

describe("the shared Delete's question", () => {
  it('states the number, has no undo, and answers the Delete', async () => {
    const store = new ShellStore();
    const connection = { getObjects: vi.fn(() => new Promise<never>(() => undefined)), submit: vi.fn() };
    const { deleter } = createActions({
      store, user: () => user, connection, dataTypes: () => [], mapView: () => Promise.resolve(null), symbols: () => Promise.resolve(null),
      layers: () => null, workspace: () => VIEW_INFO,
    });
    render(<DeleteQuestion deleter={deleter} />);
    expect(screen.queryByRole('alertdialog')).toBeNull();

    act(() => { deleter.ask(['a', 'b', 'c']); });
    const question = await screen.findByRole('alertdialog', { name: 'Delete objects' });
    expect(question.textContent).toContain('Delete 3 objects? This cannot be undone.');
    expect(document.activeElement?.textContent).toBe('Cancel');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(deleter.getState().asking).toBeNull();

    act(() => { deleter.ask(['a']); });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 1 object' }));
    expect(connection.getObjects).toHaveBeenCalledWith(['a']);
    expect(deleter.getState().running).toBe(true);
  });
});
