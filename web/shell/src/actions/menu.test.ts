import type { DataType, FetchResult, MapAction, MapObject, MapView, ObjectAction, SymbolService, User, Uuid } from '@emc2/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { ShellStore } from '../ui/store.ts';
import { ActionMenu, type MenuState } from './menu.ts';
import { ActionRegistry } from './registry.ts';

/** An object with the fields the menu looks at. */
const mapObject = (id: string, fields: Partial<MapObject> = {}): MapObject =>
  ({ id, version: 1, layerId: 'L', type: 'core.symbol', dataType: 'core.general', ...fields }) as MapObject;

const user = (permissions: readonly string[]): User => ({
  id: 'u', name: 'U', permissions: new Set(permissions), noLogin: false, has: (p: string) => permissions.includes(p),
});

const objectAction = (id: string, fields: Partial<ObjectAction> = {}): ObjectAction => ({
  id, label: id, appliesTo: {}, multiple: true, run: vi.fn(), ...fields,
});

/** A server holding these objects. */
function server(objects: readonly MapObject[]) {
  return {
    getObjects: vi.fn((ids: readonly Uuid[]): Promise<FetchResult> => Promise.resolve({
      found: objects.filter((o) => ids.includes(o.id)),
      missing: ids.filter((id) => !objects.some((o) => o.id === id)),
    })),
  };
}

function setUp(objects: readonly MapObject[], permissions: readonly string[] = ['objects.edit'], extra: { symbols?: SymbolService | null } = {}) {
  const store = new ShellStore();
  const registry = new ActionRegistry();
  const selection = { value: [] as readonly Uuid[], set: vi.fn((ids: readonly Uuid[]) => { selection.value = ids; }), onChange: () => () => undefined };
  const mapView = { selection } as unknown as MapView;
  const out = { warn: vi.fn(), error: vi.fn() };
  const dataTypes: DataType[] = [{ id: 'core.general', name: 'General', declaredBy: null } as DataType, { id: 'cot.cot', name: 'TAK', declaredBy: 'cot' } as DataType];
  const objectsServer = server(objects);
  const menu = new ActionMenu({
    store, registry, user: () => user(permissions), objects: objectsServer, dataTypes: () => dataTypes,
    layerName: (id) => (id === 'L' ? 'Layer 1' : null), mapView: () => Promise.resolve(mapView),
    symbols: () => Promise.resolve(extra.symbols ?? null), console: out,
  });
  return { store, registry, menu, selection, out, objectsServer };
}

/** The menu's state once it has settled. */
async function settled(menu: ActionMenu): Promise<MenuState> {
  await vi.waitFor(() => { expect(menu.getState().kind).not.toBe('loading'); });
  return menu.getState();
}

const labels = (state: MenuState) => (state.kind === 'actions' ? state.entries.map((e) => e.label) : null);

describe("the shell's menu", () => {
  const symbol = mapObject('a', { type: 'core.symbol' });
  const shape = mapObject('b', { type: 'core.shape' });

  it('offers the object actions that apply to every object, may be used, and take several when there are several, in menu order', async () => {
    const t = setUp([symbol, shape], ['objects.edit']);
    t.registry.addObjectAction('draw-symbols', objectAction('Edit', { group: 'edit', multiple: false, appliesTo: { types: ['core.symbol'] } }));
    t.registry.addObjectAction('map-view-2d', objectAction('Zoom to', { group: 'view' }));
    t.registry.addObjectAction('x', objectAction('Admin only', { permission: 'settings.admin' }));
    t.registry.addObjectAction('core-shell', objectAction('Delete', { group: 'delete', permission: 'objects.edit' }));
    t.registry.addMapAction('map-view-2d', { id: 'centre', label: 'Centre map', run: vi.fn() });

    t.menu.open([10, 20], { objects: [symbol.id] });
    expect(t.menu.getState().kind).toBe('loading');
    expect(labels(await settled(t.menu))).toEqual(['Zoom to', 'Edit', 'Delete']);

    t.menu.open([10, 20], { objects: [symbol.id, shape.id] });
    expect(labels(await settled(t.menu))).toEqual(['Zoom to', 'Delete']); // Edit takes one, and not shapes

    t.menu.open([5, 5], { position: [16.5, 59.3] });
    expect(labels(t.menu.getState())).toEqual(['Centre map']);
  });

  it('runs the chosen entry with the objects that still exist, or the position, after closing', async () => {
    const t = setUp([symbol]);
    const zoomRun = vi.fn();
    const centreRun = vi.fn();
    const zoom = objectAction('Zoom to', { run: zoomRun });
    const centre: MapAction = { id: 'centre', label: 'Centre map', run: centreRun };
    t.registry.addObjectAction('map-view-2d', zoom);
    t.registry.addMapAction('map-view-2d', centre);

    t.menu.open([1, 1], { objects: [symbol.id, 'gone'] });
    const state = await settled(t.menu);
    if (state.kind !== 'actions') throw new Error(state.kind);
    t.menu.run(state.entries[0]?.key ?? '');
    expect(t.menu.getState().kind).toBe('closed');
    expect(zoomRun).toHaveBeenCalledExactlyOnceWith([symbol.id]);

    t.menu.open([1, 1], { position: [16.5, 59.3] });
    const map = t.menu.getState();
    if (map.kind !== 'actions') throw new Error(map.kind);
    t.menu.run(map.entries[0]?.key ?? '');
    expect(centreRun).toHaveBeenCalledExactlyOnceWith([16.5, 59.3]);
  });

  it('shows "No actions" when none apply (an empty list), and a problem when the objects cannot be read', async () => {
    const t = setUp([symbol], []);
    t.registry.addObjectAction('core-shell', objectAction('Delete', { permission: 'objects.edit' }));
    t.menu.open([1, 1], { objects: [symbol.id] });
    expect(await settled(t.menu)).toMatchObject({ kind: 'actions', entries: [], problem: null });

    t.objectsServer.getObjects.mockRejectedValueOnce(new Error('no answer from the server within 10 s'));
    t.menu.open([1, 1], { objects: [symbol.id] });
    expect(await settled(t.menu)).toMatchObject({ kind: 'actions', entries: [], problem: 'The objects could not be read: no answer from the server within 10 s' });
  });

  it('lets the user choose one of overlapping objects, then sets the selection to it and shows its actions', async () => {
    const named = mapObject('a', { properties: { name: ' Alpha ' }, layerId: 'L' });
    const tak = mapObject('c', { dataType: 'cot.cot', layerId: 'other' });
    const t = setUp([named, tak]);
    t.registry.addObjectAction('draw-symbols', objectAction('Edit', { multiple: false }));

    t.menu.open([3, 4], { choose: [named.id, tak.id, 'gone'] });
    const state = await settled(t.menu);
    expect(state).toMatchObject({ kind: 'choose', at: [3, 4] });
    if (state.kind !== 'choose') throw new Error(state.kind);
    expect(state.candidates.map((c) => [c.id, c.label, c.layer, c.symbol])).toEqual([[named.id, 'Alpha', 'Layer 1', null], [tak.id, 'TAK', null, null]]);

    await t.menu.choose(tak.id);
    expect(t.selection.set).toHaveBeenCalledExactlyOnceWith([tak.id]);
    expect(labels(t.menu.getState())).toEqual(['Edit']);
  });

  it('goes straight to the actions when only one of the objects to choose from exists', async () => {
    const t = setUp([symbol]);
    t.registry.addObjectAction('draw-symbols', objectAction('Edit', { multiple: false }));
    t.menu.open([3, 4], { choose: [symbol.id, 'gone'] });
    await vi.waitFor(() => { expect(labels(t.menu.getState())).toEqual(['Edit']); });
    expect(t.selection.set).toHaveBeenCalledExactlyOnceWith([symbol.id]);
  });

  it('draws the symbols of the objects to choose from, and goes on without one that fails', async () => {
    const image = { width: 20, height: 20 } as unknown as HTMLCanvasElement;
    const symbols = {
      render: vi.fn((request: { sidc: string }) => {
        if (request.sidc === 'bad') throw new Error('unknown SIDC');
        return { image, width: 20, height: 20, anchor: [10, 10] };
      }),
    } as unknown as SymbolService;
    const a = mapObject('a', { symbol: { standard: 'APP-6D', sidc: '10031000001211000000' } });
    const b = mapObject('b', { symbol: { standard: 'APP-6D', sidc: 'bad' } });
    const t = setUp([a, b], [], { symbols });
    t.menu.open([0, 0], { choose: [a.id, b.id] });
    const state = await settled(t.menu);
    if (state.kind !== 'choose') throw new Error(state.kind);
    expect(state.candidates.map((c) => c.symbol)).toEqual([image, null]);
  });

  it("a handler that throws or rejects is the plugin's failure: logged, shown as an error and DEGRADED, never the shell's", async () => {
    const t = setUp([symbol]);
    t.store.setPlugins([]);
    const observe = vi.spyOn(t.store, 'observe');
    t.registry.addObjectAction('p', objectAction('Throws', { run: () => { throw new Error('broken'); } }));
    t.registry.addObjectAction('q', objectAction('Rejects', { run: () => Promise.reject(new Error('later')) }));

    for (const label of ['Throws', 'Rejects']) {
      t.menu.open([1, 1], { objects: [symbol.id] });
      const state = await settled(t.menu);
      if (state.kind !== 'actions') throw new Error(state.kind);
      t.menu.run(state.entries.find((e) => e.label === label)?.key ?? '');
    }
    await vi.waitFor(() => { expect(observe).toHaveBeenCalledTimes(2); });
    expect(observe.mock.calls).toEqual([
      ['p', { state: 'DEGRADED', detail: 'its action Throws failed: broken' }],
      ['q', { state: 'DEGRADED', detail: 'its action Rejects failed: later' }],
    ]);
    expect(t.store.getView().notifications.map((n) => [n.pluginId, n.severity, n.message])).toEqual([
      ['p', 'error', 'Throws failed: broken'], ['q', 'error', 'Rejects failed: later'],
    ]);
    expect(t.out.error).toHaveBeenCalledTimes(2);
  });

  it("a test of a plugin's that throws is its failure too, once per menu, and leaves only its action out (review F1)", async () => {
    const t = setUp([symbol, mapObject('c')]);
    t.store.setPlugins([]);
    const observe = vi.spyOn(t.store, 'observe');
    t.registry.addObjectAction('p', objectAction('Broken', { appliesTo: { test: () => { throw new Error('no such field'); } } }));
    t.registry.addObjectAction('q', objectAction('Fine', { appliesTo: { test: () => true } }));

    t.menu.open([1, 1], { objects: [symbol.id, 'c'] });
    expect(labels(await settled(t.menu))).toEqual(['Fine']);
    expect(observe.mock.calls).toEqual([['p', { state: 'DEGRADED', detail: 'its action Broken could not be checked: no such field' }]]);
    expect(t.store.getView().notifications.map((n) => [n.pluginId, n.severity, n.message])).toEqual([
      ['p', 'error', 'Broken could not be checked: no such field'],
    ]);
    expect(t.out.error).toHaveBeenCalledOnce();
  });

  it("names the plugin whose registration it was, also when two plugins add the same action object (review F11)", async () => {
    const t = setUp([symbol]);
    t.store.setPlugins([]);
    const observe = vi.spyOn(t.store, 'observe');
    const shared = objectAction('Shared', { run: () => { throw new Error('broken'); } });
    t.registry.addObjectAction('p', shared);
    t.registry.addObjectAction('q', shared);
    t.menu.open([1, 1], { objects: [symbol.id] });
    const state = await settled(t.menu);
    if (state.kind !== 'actions') throw new Error(state.kind);
    expect(state.entries.map((e) => e.key)).toEqual(['p/Shared/0', 'q/Shared/1']);
    t.menu.run('p/Shared/0');
    expect(observe).toHaveBeenCalledExactlyOnceWith('p', { state: 'DEGRADED', detail: 'its action Shared failed: broken' });
  });

  it('says so when none of the objects exists any more, for actions and for a choice (review F2)', async () => {
    const t = setUp([]);
    t.menu.open([1, 1], { objects: ['gone'] });
    expect(await settled(t.menu)).toMatchObject({ kind: 'actions', entries: [], problem: 'This object no longer exists.' });
    t.menu.open([1, 1], { choose: ['gone', 'gone too'] });
    expect(await settled(t.menu)).toMatchObject({ kind: 'actions', entries: [], problem: 'These objects no longer exist.' });
    t.menu.open([1, 1], { objects: [] });
    expect(await settled(t.menu)).toMatchObject({ kind: 'actions', entries: [], problem: null }); // "No actions"
  });

  it('drops a late answer for a menu that was closed or replaced', async () => {
    const t = setUp([symbol]);
    let answer: (result: FetchResult) => void = () => undefined;
    t.objectsServer.getObjects.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    t.menu.open([1, 1], { objects: [symbol.id] });
    t.menu.close();
    answer({ found: [symbol], missing: [] });
    await Promise.resolve();
    expect(t.menu.getState().kind).toBe('closed');
  });

  it('checks what a plugin passes, and uses at most 1 000 objects', async () => {
    const t = setUp([]);
    expect(() => { t.menu.open([1] as unknown as [number, number], { position: [0, 0] }); }).toThrow(/point/);
    expect(() => { t.menu.open([1, 1], { position: ['x', 1] } as never); }).toThrow(/position/);
    expect(() => { t.menu.open([1, 1], { what: 1 } as never); }).toThrow(/target/);
    t.menu.open([1, 1], { objects: Array.from({ length: 1001 }, (_, i) => `id-${String(i)}`) });
    await settled(t.menu);
    expect(t.objectsServer.getObjects.mock.calls[0]?.[0]).toHaveLength(1000);
    expect(t.out.warn).toHaveBeenCalledWith('[core-shell] a menu for 1001 objects: only the first 1000 are used');
  });
});

describe('the action lists', () => {
  it('check what a plugin adds, keep ids unique within a plugin, and let an action go again', () => {
    const registry = new ActionRegistry();
    const remove = registry.addObjectAction('p', objectAction('a'));
    registry.addObjectAction('q', objectAction('a')); // another plugin's
    expect(() => registry.addObjectAction('p', objectAction('a'))).toThrow('p has an object action a already; ids are unique within a plugin');
    remove();
    registry.addObjectAction('p', objectAction('a'));
    expect(registry.objects.map((r) => [r.pluginId, r.action.id])).toEqual([['q', 'a'], ['p', 'a']]);

    expect(() => registry.addObjectAction('p', objectAction(''))).toThrow(/non-empty id/);
    expect(() => registry.addObjectAction('p', { ...objectAction('b'), label: '' })).toThrow(/needs a label/);
    expect(() => registry.addObjectAction('p', { ...objectAction('b'), run: undefined } as never)).toThrow(/run function/);
    expect(() => registry.addObjectAction('p', { ...objectAction('b'), appliesTo: undefined } as never)).toThrow(/appliesTo/);
    expect(() => registry.addObjectAction('p', objectAction('b', { appliesTo: { types: 'core.symbol' } as never }))).toThrow(/appliesTo.types/);
    expect(() => registry.addObjectAction('p', { ...objectAction('b'), multiple: undefined } as never)).toThrow(/multiple/);
    expect(() => registry.addObjectAction('p', objectAction('b', { order: Number.NaN }))).toThrow(/order/);
    expect(() => registry.addObjectAction('p', objectAction('b', { group: 3 as never }))).toThrow(/group that is not a string: 3/);
    expect(() => registry.addObjectAction('p', objectAction('b', { permission: true as never }))).toThrow(/permission that is not a string/);
    expect(() => registry.addObjectAction('p', objectAction('b', { appliesTo: { dataTypes: [1] } as never }))).toThrow(/appliesTo.dataTypes/);
    expect(() => registry.addObjectAction('p', objectAction('b', { appliesTo: { test: 'yes' } as never }))).toThrow(/appliesTo.test that is not a function/);
    expect(() => registry.addMapAction('p', { id: 'm', label: '', run: vi.fn() })).toThrow(/needs a label/);
    expect(() => registry.addMapAction('p', { id: 'm', label: 'M' } as never)).toThrow(/run function/);
    const removeMap = registry.addMapAction('p', { id: 'm', label: 'M', run: vi.fn() });
    expect(() => registry.addMapAction('p', { id: 'm', label: 'M', run: vi.fn() })).toThrow(/already/);
    removeMap();
    expect(registry.maps).toEqual([]);
  });
});
