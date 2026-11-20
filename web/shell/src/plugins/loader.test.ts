import { DisplayState } from '../display/state.ts';
import {
  definePlugin, ObjectQueryError, OutcomeUnknownError, SYMBOLS, type ChangeOutcome, type PluginContext, type SecurityLabel, type SymbolService, type WebPlugin,
} from '@emc2/plugin-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Picture } from '../live/picture.ts';
import { mapObject, pluginEntry } from '../testing/fakes.ts';
import { WorkspaceSwitch } from '../workspaces/switch.ts';
import { ShellStore, VIEW_INFO } from '../ui/store.ts';
import { ShellTheme } from '../ui/theme.ts';
import { webUser } from '../boot.tsx';
import type { ActionMenu } from '../actions/menu.ts';
import { ActionRegistry } from '../actions/registry.ts';
import { TemporalPlugins } from '../time/temporal.ts';
import { loadPlugins, type LoaderOptions } from './loader.ts';
import { symbolPalettesOf } from './palettes.ts';
import type { PluginEntry } from './plan.ts';
import { SharedState } from './shared.ts';

const label = { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' } as SecurityLabel;
const symbols = { name: 'symbols' } as unknown as SymbolService;
const Panel = () => null;

interface Setup {
  readonly store: ShellStore;
  readonly picture: Picture;
  readonly shared: SharedState;
  readonly imported: string[];
  readonly styles: string[];
  readonly submit: ReturnType<typeof vi.fn<(content: unknown, pluginId: string) => Promise<ChangeOutcome>>>;
  readonly queries: ReturnType<typeof fakeQueries>;
  readonly console: { debug: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  readonly options: LoaderOptions;
}

/** The server's object queries: every id missing, every layer empty. */
function fakeQueries() {
  return {
    getObjects: vi.fn((ids: readonly string[]) => Promise.resolve({ found: [], missing: ids })),
    queryLayer: vi.fn((layerId: string, page: number, pageSize: number) => Promise.resolve({ layerId, page, pageSize, objects: [], total: 0 })),
  };
}

/** Plugins by id: the default export of each entry module. `undefined` means the import fails. */
function setUp(modules: Record<string, WebPlugin | { readonly default?: unknown } | undefined>, extra: Partial<LoaderOptions> = {}): Setup {
  const store = new ShellStore();
  const picture = new Picture();
  const shared = new SharedState();
  const imported: string[] = [];
  const styles: string[] = [];
  const submit = vi.fn<(content: unknown, pluginId: string) => Promise<ChangeOutcome>>(() => Promise.reject(new OutcomeUnknownError('test')));
  const out = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const queries = fakeQueries();
  const options: LoaderOptions = {
    store,
    live: () => ({ subscribe: (listener, onError) => picture.subscribe(listener, onError) }),
    environment: {
      changes: { submit }, objects: queries, defaultLabel: label, console: out, shared,
      user: webUser({ id: 'local', name: 'Local user', permissions: [], noLogin: true }),
      workspace: { current: VIEW_INFO, onChange: () => () => undefined }, // View, never switched
    },
    importModule: (url) => {
      imported.push(url);
      const id = /^\/plugins\/([^/]+)\/web\//.exec(url)?.[1] ?? '';
      const module = modules[id];
      if (module === undefined) return Promise.reject(new Error(`cannot load ${url}`));
      return Promise.resolve('activate' in module ? { default: module } : module);
    },
    loadStyle: (url) => {
      styles.push(url);
      return url.endsWith('missing.css') ? Promise.reject(new Error('404')) : Promise.resolve();
    },
    ...extra,
  };
  return { store, picture, shared, imported, styles, submit, queries, console: out, options };
}

const pathOf = (input: RequestInfo | URL): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

const row = (store: ShellStore, id: string) => store.getView().plugins.find((p) => p.id === id);

afterEach(() => {
  vi.useRealTimers();
});

describe('loadPlugins', () => {
  it('loads a web part from the folder its id names, not from the url the server gives (T-014 review (3))', async () => {
    let base = '';
    const s = setUp({ draw: definePlugin({ activate(ctx) { base = ctx.webBase; } }) });

    await loadPlugins([pluginEntry('draw', { web: { url: 'https://evil.example/', css: ['draw.css'] } })], s.options);

    expect(s.imported).toEqual(['/plugins/draw/web/index.js']);
    expect(s.styles).toEqual(['/plugins/draw/web/draw.css']);
    expect(base).toBe('/plugins/draw/web/');
  });

  it('loads each web part with its CSS first, in order, and activates it with a context', async () => {
    let seen: PluginContext | null = null;
    const s = setUp({
      symbology: definePlugin({ activate(ctx) { ctx.services.provide(SYMBOLS, symbols); } }),
      draw: definePlugin({
        async activate(ctx) {
          seen = ctx;
          ctx.ui.addControlPanel({ id: 'draw', title: 'Draw', component: Panel });
          expect(await ctx.services.get(SYMBOLS)).toBe(symbols);
        },
      }),
    });
    const entries: PluginEntry[] = [
      pluginEntry('draw', { requires: ['emc2.symbols'], web: { css: ['draw.css'] }, settings: { size: 32 } }),
      pluginEntry('symbology', { provides: ['emc2.symbols'] }),
    ];

    const result = await loadPlugins(entries, s.options);

    expect(result.active).toEqual(['symbology', 'draw']);
    expect(s.imported).toEqual(['/plugins/symbology/web/index.js', '/plugins/draw/web/index.js']);
    expect(s.styles).toEqual(['/plugins/draw/web/draw.css']);
    expect(row(s.store, 'draw')?.load).toBe('active');
    expect(s.store.getView().panels.map((p) => p.panel.title)).toEqual(['Draw']);
    const ctx = seen as PluginContext | null;
    expect(ctx?.pluginId).toBe('draw');
    expect(ctx?.serverBase).toBe('/api/plugins/draw/');
    expect(ctx?.settings).toEqual({ size: 32 });
    expect(Object.isFrozen(ctx?.settings)).toBe(true);
    expect(ctx?.defaultLabel).toBe(label);
    expect(ctx?.newId()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('gives ctx.classifications from the configuration, and the NATO order without one (SDK 1.5.0 part 4, A3; required since the freeze)', async () => {
    const seen: (PluginContext | null)[] = [];
    const orders = Object.freeze({ NATO: Object.freeze(['UNCLASSIFIED', 'SECRET']) });
    const plugin = { cot: definePlugin({ activate(ctx) { seen.push(ctx); } }) };
    const s = setUp(plugin);
    await loadPlugins([pluginEntry('cot')], { ...s.options, environment: { ...s.options.environment, classifications: orders } });
    expect(seen[0]?.classifications).toBe(orders);
    const plain = setUp(plugin);
    await loadPlugins([pluginEntry('cot')], plain.options);
    expect(seen[1]?.classifications).toEqual({ NATO: ['UNCLASSIFIED', 'RESTRICTED', 'CONFIDENTIAL', 'SECRET', 'COSMIC TOP SECRET'] });
  });

  it('gives the SDK v1 context: the user, the data types and the settings kept current, and the web base', async () => {
    let seen: PluginContext | null = null;
    const s = setUp({ cot: definePlugin({ activate(ctx) { seen = ctx; } }) });
    s.shared.initialDataTypes([{ id: 'core.general', name: 'General', declaredBy: null, defaults: {}, behaviour: {} }]);
    await loadPlugins([pluginEntry('cot', { settings: { mode: 'a' } })], s.options);
    const ctx = seen as PluginContext | null;
    if (ctx === null) throw new Error('not activated');
    const settings: unknown[] = [];
    const types: unknown[] = [];
    ctx.onSettingsChange((v) => settings.push(v));
    ctx.onDataTypesChange((t) => types.push(t.map((d) => d.behaviour)));

    s.shared.settingsChanged('cot', { mode: 'b' });
    s.shared.dataTypesChanged([{ id: 'core.general', name: 'General', declaredBy: null, defaults: {}, behaviour: { expiresAfterSeconds: 9 } }]);

    expect(ctx.user.noLogin).toBe(true);
    expect(ctx.user.has('settings.admin')).toBe(true);
    expect(ctx.webBase).toBe('/plugins/cot/web/');
    expect(ctx.settings).toEqual({ mode: 'b' });
    expect(settings).toEqual([{ mode: 'b' }]);
    expect(ctx.dataTypes[0]?.behaviour).toEqual({ expiresAfterSeconds: 9 });
    s.shared.initialDeclaredFields([{ plugin: 'cot', name: 'callsign', type: 'text', label: 'Callsign', editableByOthers: true }]);
    expect(ctx.declaredFields.map((f) => `${f.plugin}.${f.name}`), 'SDK 1.2.0').toEqual(['cot.callsign']);
    expect(ctx.fieldSets, 'SDK 1.4.0: none until /api/config').toEqual([]);
    s.shared.initialSetsAndKinds([{ id: 'cot.unit', plugin: 'cot', name: 'unit', label: 'CoT unit', fields: ['callsign'] }],
      [{ id: 'gmti.pairing', label: 'GMTI Pairing', line: { strokeColor: '#FFFF00' } }]);
    expect(ctx.fieldSets.map((f) => f.id)).toEqual(['cot.unit']);
    expect(ctx.relationKinds[0]?.line.strokeDash).toBe('solid');
    expect(ctx.relationLines.value['gmti.pairing']?.strokeColor, 'SDK 1.6.0 part C').toBe('#FFFF00');
    expect('set' in ctx.relationLines, 'read only').toBe(false);
    expect(ctx.symbolPalettes, 'SDK 1.6.0 part G: none without palettes').toEqual([]);
    expect(types).toEqual([[{ expiresAfterSeconds: 9 }]]);
  });

  it("gives ctx.symbolPalettes, every enabled plugin's, server-only ones too, with the plugin and the full id (SDK 1.6.0 part G)", async () => {
    let seen: PluginContext | null = null;
    const s = setUp({ cot: definePlugin({ activate(ctx) { seen = ctx; } }) });
    const symbols = [{ standard: 'APP-6D' as const, code: '10031000001211000000', label: 'Infantry' }];
    const palettes = symbolPalettesOf([
      pluginEntry('cot', { symbolPalettes: [{ id: 'cot', name: 'CoT', symbols }] }),
      pluginEntry('server-only', { web: null, symbolPalettes: [{ id: 'a', name: 'A', symbols }, { id: 'b', name: 'B', symbols }] }),
      pluginEntry('off', { active: false, symbolPalettes: [{ id: 'x', name: 'X', symbols }] }),
      pluginEntry('none', { symbolPalettes: null }),
    ]);
    await loadPlugins([pluginEntry('cot')], { ...s.options, environment: { ...s.options.environment, symbolPalettes: palettes } });
    const ctx = seen as PluginContext | null;
    if (ctx === null) throw new Error('not activated');

    expect(ctx.symbolPalettes.map((p) => [p.plugin, p.id, p.name])).toEqual([['cot', 'cot.cot', 'CoT'], ['server-only', 'server-only.a', 'A'],
      ['server-only', 'server-only.b', 'B']]);
    expect(ctx.symbolPalettes[0]?.symbols).toEqual(symbols);
    expect(Object.isFrozen(ctx.symbolPalettes[0]?.symbols[0])).toBe(true);
  });

  it('gives ctx.display, read only, its listeners told at each change (SDK 1.4.0 part 5)', async () => {
    let seen: PluginContext | null = null;
    const s = setUp({ cot: definePlugin({ activate(ctx) { seen = ctx; } }) });
    const display = new DisplayState({ relationKinds: [], fetch: () => Promise.resolve(Response.json({ choices: {}, defaults: {} })) });
    await loadPlugins([pluginEntry('cot')], { ...s.options, environment: { ...s.options.environment, display } });
    const ctx = seen as PluginContext | null;
    if (ctx === null) throw new Error('not activated');
    const sizes: number[] = [];
    ctx.display.onChange((d) => sizes.push(d.symbolSize));

    display.preview({ symbolSize: 50 });

    expect(ctx.display.value.symbolSize).toBe(50);
    expect(sizes).toEqual([50]);
    expect('set' in ctx.display, 'no plugin writes them (ADR-0046 point 5)').toBe(false);
  });

  it("checks each web part's capabilities after activate, reports them, and gives a temporal one the time (SDK 1.4.0)", async () => {
    const times: unknown[] = [];
    const reports: unknown[] = [];
    const temporal = new TemporalPlugins(() => undefined);
    const s = setUp({
      history: definePlugin({ activate() {}, capabilities: { temporal: { timeChanged: (t) => { times.push(t); } } } }),
      sneaky: definePlugin({ activate() {}, capabilities: { temporal: { timeChanged: (t) => { times.push(['sneaky', t]); } } } }),
      'web-only': definePlugin({ activate() {} }),
      plain: definePlugin({ activate() {} }),
    }, { capabilities: { temporal, report: (id, implemented, problem) => { reports.push([id, implemented, problem]); } } });
    s.store.setPlugins([pluginEntry('history', { capabilities: ['temporal'] }), pluginEntry('sneaky'),
      pluginEntry('web-only', { capabilities: ['temporal'], serverPart: false }), pluginEntry('plain')]);

    await loadPlugins([pluginEntry('history', { capabilities: ['temporal'] }), pluginEntry('sneaky'),
      pluginEntry('web-only', { capabilities: ['temporal'], serverPart: false }), pluginEntry('plain')], s.options);
    temporal.changed({ time: '2026-11-06T08:00:00.000Z' });

    expect(reports).toEqual([
      ['history', ['temporal'], null],
      ['sneaky', ['temporal'], 'capability temporal implemented but not declared'],
      ['web-only', [], 'capability temporal declared but not implemented'],
    ]);
    expect(times, 'only the one that passed, once after activate and at the change').toEqual([{}, { time: '2026-11-06T08:00:00.000Z' }]);
    expect(row(s.store, 'sneaky')?.observed).toEqual({ state: 'DEGRADED', detail: 'capability temporal implemented but not declared: its capabilities are not used' });
    expect(row(s.store, 'plain')?.observed).toBeNull();
  });

  it('gives the 1.2.0 workspaces: ctx.workspaces, ctx.workspace and its switch, and checks the workspaces of panels and overlays', async () => {
    let seen: PluginContext | null = null;
    const s = setUp({ sim: definePlugin({ activate(ctx) { seen = ctx; } }) });
    const sim = { id: 'simulator.simulation', name: 'Simulation', viewPermission: 'v', editPermission: 'e', order: 10 };
    s.store.setWorkspaces([sim]);
    const switcher = new WorkspaceSwitch(s.store);
    await loadPlugins([pluginEntry('sim')], { ...s.options, environment: { ...s.options.environment, workspace: switcher } });
    const ctx = seen as PluginContext | null;
    if (ctx === null) throw new Error('not activated');
    const shown: string[] = [];
    ctx.workspace.onChange((w) => shown.push(w.id));
    ctx.workspace.onChange(() => { throw new Error('broken'); });

    expect(ctx.workspaces.map((w) => w.id)).toEqual(['core.view', 'simulator.simulation']);
    expect(ctx.workspace.current.id).toBe('core.view');
    await switcher.show('simulator.simulation');
    expect(ctx.workspace.current).toEqual(sim);
    expect(shown).toEqual(['simulator.simulation']);
    expect(row(s.store, 'sim')?.observed).toEqual({ state: 'DEGRADED', detail: 'its workspace listener failed: Error: broken' });
    ctx.ui.addPanel({ id: 'routes', title: 'Routes', component: Panel, defaultPane: 'right', workspaces: ['simulator.simulation'] });
    expect(s.store.getView().panels.map((p) => p.id)).toEqual(['sim/routes']);
    expect(() => ctx.ui.addPanel({ id: 'bad', title: 'Bad', component: Panel, defaultPane: 'right', workspaces: 'simulator.simulation' as unknown as string[] }))
      .toThrow('a panel bad has workspaces that are not a list of strings');
    expect(() => ctx.ui.addMapPaneOverlay({ id: 'x', position: 'top-left', component: Panel, workspaces: [1] as unknown as string[] }))
      .toThrow('a map pane overlay x has workspaces that are not a list of strings');
    const listener = { snapshot: () => undefined, changes: () => undefined };
    for (const bad of [[], 'simulator.simulation', [''], Array.from({ length: 65 }, (_, i) => `a.w${String(i)}`)]) {
      expect(() => ctx.livePicture.subscribe(listener, { workspaces: bad as unknown as string[] }), JSON.stringify(bad).slice(0, 40))
        .toThrow("a live picture subscription's workspaces are a list of 1 to 64 workspace ids or '*'");
    }
  });

  it('gives the 1.1.0 context: panels, top bar items, user documents, tokens, object queries and setup shares work, the rest warns once and waits for its part', async () => {
    let seen: PluginContext | null = null;
    const calls: string[] = [];
    const doFetch: typeof fetch = (input, init) => {
      calls.push(`${init?.method ?? 'GET'} ${pathOf(input)}`);
      return Promise.resolve(Response.json({ names: ['tree'] }));
    };
    const s = setUp({ bookmarks: definePlugin({ activate(ctx) { seen = ctx; } }) }, {});
    const options = { ...s.options, environment: { ...s.options.environment, fetch: doFetch } };
    await loadPlugins([pluginEntry('bookmarks')], options);
    const ctx = seen as PluginContext | null;
    if (ctx === null) throw new Error('not activated');

    // A panel in its default pane; show() expands it there (the workspace scrolls it into view).
    const handle = ctx.ui.addPanel({ id: 'tree', title: 'Bookmarks', defaultPane: 'left', component: Panel });
    expect(s.store.getView().panels.map((p) => [p.id, p.defaultPane, p.panel.title])).toEqual([['bookmarks/tree', 'left', 'Bookmarks']]);
    expect(s.store.getView().layout.expanded, 'panels start collapsed (T-153)').toEqual([]);
    handle.show();
    expect(s.store.getView().layout.expanded).toEqual(['bookmarks/tree']);
    expect(s.store.getView().reveal).toEqual({ id: 'bookmarks/tree', n: 1 });
    handle.remove();
    expect(s.store.getView().panels).toEqual([]);

    // A small control on the right of the top bar.
    const removeItem = ctx.ui.addTopBarItem({ id: 'menu', component: Panel });
    expect(s.store.getView().topBarItems.map((t) => [t.pluginId, t.item.id])).toEqual([['bookmarks', 'menu']]);
    expect(() => ctx.ui.addTopBarItem({ id: 'menu', component: Panel })).toThrow(new TypeError('bookmarks has a top bar item menu already; ids are unique within a plugin'));
    removeItem();
    expect(s.store.getView().topBarItems).toEqual([]);
    ctx.ui.addTopBarItem({ id: 'menu', component: Panel })(); // free again once removed

    // Panel ids are unique within the plugin, from addPanel and addControlPanel alike: the layout knows a panel by it.
    const tree = ctx.ui.addPanel({ id: 'tree', title: 'Tree', defaultPane: 'left', component: Panel });
    expect(() => ctx.ui.addPanel({ id: 'tree', title: 'Again', defaultPane: 'right', component: Panel })).toThrow(/has a panel tree already/);
    expect(() => ctx.ui.addControlPanel({ id: 'tree', title: 'Again', component: Panel })).toThrow(/has a panel tree already/);
    expect(s.store.getView().panels.map((p) => p.panel.title)).toEqual(['Tree']);
    tree.remove();
    tree.remove(); // twice: harmless
    ctx.ui.addControlPanel({ id: 'tree', title: 'Tree again', component: Panel })();
    // A registration that fails does not hold its id.
    vi.spyOn(s.store, 'addPanel').mockImplementationOnce(() => { throw new Error('the store failed'); });
    expect(() => ctx.ui.addPanel({ id: 'tree', title: 'Tree', defaultPane: 'left', component: Panel })).toThrow('the store failed');
    ctx.ui.addPanel({ id: 'tree', title: 'Tree', defaultPane: 'left', component: Panel }).remove();
    expect(() => ctx.ui.addPanel({ id: 'x', title: 'X', defaultPane: 'top' as 'left', component: Panel })).toThrow(/unknown pane/);

    // User documents in the plugin's own namespace, over the server's API.
    expect(await ctx.userDocuments.list()).toEqual(['tree']);
    expect(calls).toEqual(['GET /api/user-documents/bookmarks']);

    // Tokens: every name, with the value the page sets (the nine aliases before the looks).
    expect(Object.keys(ctx.theme.tokens())).toContain('colorAccent');
    expect(ctx.theme.current).toEqual({ look: 'night-watch', scheme: 'light', density: 'compact' });

    // Object queries ask the server through the live connection, after the SDK's checks.
    expect(await ctx.objects.get(['0199e8a0-0000-7000-8000-000000000001'])).toEqual({ found: [], missing: ['0199e8a0-0000-7000-8000-000000000001'] });
    expect(await ctx.objects.get([])).toEqual({ found: [], missing: [] }); // without asking
    await expect(ctx.objects.get(Array.from({ length: 1001 }, () => 'x'))).rejects.toThrow(new ObjectQueryError('at most 1000 ids: 1001'));
    expect(s.queries.getObjects).toHaveBeenCalledOnce();
    expect(await ctx.objects.queryLayer('L', { page: 2 })).toEqual({ layerId: 'L', page: 2, pageSize: 100, objects: [], total: 0 });
    await expect(ctx.objects.queryLayer('L', { pageSize: 501 })).rejects.toBeInstanceOf(ObjectQueryError);
    await expect(ctx.objects.queryLayer('L', { page: -1 })).rejects.toThrow(/page must be a whole number/);
    expect(s.queries.queryLayer).toHaveBeenCalledExactlyOnceWith('L', 2, 100);

    // A setup share is checked; without the shell's setups (as here) it is accepted and never saved.
    ctx.setup.register({ save: () => null, restore: () => undefined })();
    ctx.setup.changed();
    expect(() => ctx.setup.register({ save: () => null } as never)).toThrow(new TypeError('a setup share needs save() and restore(share)'));

    // Without the shell's actions (as here), actions are accepted and never offered; nothing warns any more.
    ctx.actions.addObjectAction({ id: 'a', label: 'A', appliesTo: {}, multiple: false, run: () => undefined })();
    ctx.actions.openMenu([1, 1], { position: [0, 0] });
    expect(s.console.warn).not.toHaveBeenCalled();
  });

  it("adds a plugin's actions to the shell's lists in its own name, opens the shell's menu, and a fenced plugin's actions go", async () => {
    vi.useFakeTimers();
    const registry = new ActionRegistry();
    const open = vi.fn();
    const menu = { open } as unknown as ActionMenu;
    let fast: PluginContext | null = null;
    let slow: PluginContext | null = null;
    const s = setUp({
      fast: definePlugin({ activate(ctx) { fast = ctx; } }),
      slow: definePlugin({ activate(ctx) {
        slow = ctx;
        ctx.actions.addObjectAction({ id: 'edit', label: 'Edit', appliesTo: {}, multiple: false, run: () => undefined });
        return new Promise(() => undefined);
      } }),
    });
    const loading = loadPlugins([pluginEntry('fast'), pluginEntry('slow')], { ...s.options, environment: { ...s.options.environment, actions: { registry, menu } } });
    await vi.advanceTimersByTimeAsync(10_000);
    await loading;
    const ctx = fast as PluginContext | null;
    if (ctx === null) throw new Error('not activated');

    const remove = ctx.actions.addObjectAction({ id: 'zoom', label: 'Zoom to', appliesTo: {}, multiple: true, run: () => undefined });
    ctx.actions.addMapAction({ id: 'centre', label: 'Centre map', run: () => undefined });
    expect(registry.objects.map((r) => [r.pluginId, r.action.id])).toEqual([['fast', 'zoom']]); // slow's went with it
    expect(registry.maps.map((r) => [r.pluginId, r.action.id])).toEqual([['fast', 'centre']]);
    expect(() => ctx.actions.addObjectAction({ id: 'zoom', label: 'Again', appliesTo: {}, multiple: true, run: () => undefined })).toThrow(/already/);
    remove();
    expect(registry.objects).toEqual([]);
    ctx.actions.openMenu([3, 4], { objects: ['x'] });
    expect(open).toHaveBeenCalledExactlyOnceWith([3, 4], { objects: ['x'] });

    (slow as PluginContext | null)?.actions.addMapAction({ id: 'later', label: 'Later', run: () => undefined }); // ignored and logged
    (slow as PluginContext | null)?.actions.openMenu([0, 0], { position: [0, 0] });
    expect(registry.maps).toHaveLength(1);
    expect(open).toHaveBeenCalledOnce();
  });

  it("gives ctx.theme the shell's look: its state, every change, and a failing listener is the plugin's (T-052)", async () => {
    let seen: PluginContext | null = null;
    const s = setUp({ map: definePlugin({ activate(ctx) { seen = ctx; } }) });
    const theme = new ShellTheme({ store: s.store, root: document.createElement('div'), dark: null });
    await loadPlugins([pluginEntry('map')], { ...s.options, environment: { ...s.options.environment, theme } });
    const ctx = seen as PluginContext | null;
    if (ctx === null) throw new Error('not activated');
    expect(ctx.theme.current).toEqual({ look: 'night-watch', scheme: 'light', density: 'compact' });
    const states: string[] = [];
    const off = ctx.theme.onChange((state) => states.push(`${state.look} ${state.scheme} ${state.density}`));
    ctx.theme.onChange(() => { throw new Error('no canvas'); });
    s.store.setLook({ look: 'chart-room', scheme: 'dark', density: 'look' });
    expect(states).toEqual(['chart-room dark comfortable']);
    expect(ctx.theme.current.look).toBe('chart-room');
    expect(s.store.getView().plugins.find((p) => p.id === 'map')?.observed).toEqual({ state: 'DEGRADED', detail: 'its theme listener failed: Error: no canvas' });
    off();
    s.store.setLook({ look: 'signal', scheme: 'dark', density: 'look' });
    expect(states).toHaveLength(1);
  });

  it('a fenced plugin loses its top bar items and panels, and no longer reaches its user documents or the object queries', async () => {
    vi.useFakeTimers();
    let seen: PluginContext | null = null;
    const s = setUp({ slow: definePlugin({ activate(ctx) {
      seen = ctx;
      ctx.ui.addTopBarItem({ id: 'menu', component: Panel });
      ctx.ui.addPanel({ id: 'tree', title: 'Tree', defaultPane: 'left', component: Panel });
      return new Promise(() => undefined);
    } }) });
    const loading = loadPlugins([pluginEntry('slow')], { ...s.options, environment: { ...s.options.environment, fetch: () => Promise.resolve(Response.json({ names: [] })) } });
    await vi.advanceTimersByTimeAsync(10_000);
    await loading;
    const ctx = seen as PluginContext | null;
    expect(s.store.getView().topBarItems).toEqual([]);
    expect(s.store.getView().panels).toEqual([]);
    ctx?.ui.addTopBarItem({ id: 'later', component: Panel }); // ignored and logged
    expect(s.store.getView().topBarItems).toEqual([]);
    const undo = ctx?.services.provide(SYMBOLS, symbols); // ignored and logged: its undo does nothing
    expect(undo).toBeTypeOf('function');
    expect(() => { undo?.(); }).not.toThrow();
    const panelUndo = ctx?.ui.setSettingsPanel({ component: Panel }); // SDK 1.3.0: ignored too
    expect(s.store.getView().settingsPanels).toEqual([]);
    expect(() => { panelUndo?.(); }).not.toThrow();
    await expect(ctx?.userDocuments.list()).rejects.toThrow(/slow is disabled/);
    await expect(ctx?.objects.get(['x'])).rejects.toThrow(/^not sent: slow is disabled \(/);
    await expect(ctx?.objects.queryLayer('L')).rejects.toBeInstanceOf(ObjectQueryError);
    expect(s.queries.getObjects).not.toHaveBeenCalled();
    expect(s.queries.queryLayer).not.toHaveBeenCalled();
  });

  it('a settings listener that throws makes the plugin DEGRADED, not the shell fail', async () => {
    const s = setUp({ cot: definePlugin({ activate(ctx) { ctx.onSettingsChange(() => { throw new Error('bad'); }); } }) });
    await loadPlugins([pluginEntry('cot')], s.options);

    s.shared.settingsChanged('cot', { mode: 'b' });

    expect(row(s.store, 'cot')?.observed).toEqual({ state: 'DEGRADED', detail: 'its settings listener failed: Error: bad' });
  });

  it('notes a used key no loaded plugin provides, and get on it rejects at once (CR-0011)', async () => {
    let failure: unknown = null;
    const s = setUp({
      map: definePlugin({ async activate(ctx) { failure = await ctx.services.get(SYMBOLS).then(() => null, (e: unknown) => String(e)); } }),
    });

    const result = await loadPlugins([pluginEntry('map', { uses: ['emc2.symbols'] })], s.options);

    expect(result.active).toEqual(['map']);
    expect(row(s.store, 'map')?.notes).toEqual(['uses emc2.symbols, which no loaded plugin provides']);
    expect(failure).toBe('Error: no loaded plugin provides emc2.symbols');
  });

  it('notes once a key a plugin gets without requires or uses, and the get still works (the PDA\'s D4 review)', async () => {
    const got: Promise<unknown>[] = [];
    const s = setUp({
      symbology: definePlugin({ activate(ctx) { ctx.services.provide(SYMBOLS, symbols); } }),
      // not awaited in activate: undeclared, it is not ordered after its provider
      map: definePlugin({ activate(ctx) { got.push(ctx.services.get(SYMBOLS), ctx.services.get(SYMBOLS)); } }),
      declared: definePlugin({ activate(ctx) { got.push(ctx.services.get(SYMBOLS)); } }),
    });

    const result = await loadPlugins([pluginEntry('symbology', { provides: ['emc2.symbols'] }), pluginEntry('map'),
      pluginEntry('declared', { uses: ['emc2.symbols'] })], s.options);

    expect([...result.active].sort()).toEqual(['declared', 'map', 'symbology']);
    expect(await Promise.all(got)).toEqual([symbols, symbols, symbols]);
    expect(row(s.store, 'map')?.notes).toEqual(['gets emc2.symbols, which is in neither requires nor uses in its manifest']);
    expect(row(s.store, 'declared')?.notes).toEqual([]);
  });

  it('disables a plugin that throws in activate, and the others continue', async () => {
    const s = setUp({
      broken: definePlugin({
        activate(ctx) {
          ctx.ui.addControlPanel({ id: 'early', title: 'Early', component: Panel });
          throw new Error('boom');
        },
      }),
      fine: definePlugin({ activate(ctx) { ctx.ui.addControlPanel({ id: 'fine', title: 'Fine', component: Panel }); } }),
    });

    const result = await loadPlugins([pluginEntry('broken'), pluginEntry('fine')], s.options);

    expect(result.active).toEqual(['fine']);
    expect(row(s.store, 'broken')).toMatchObject({ load: 'failed', loadDetail: 'failed: boom' });
    expect(s.store.getView().panels.map((p) => p.panel.title)).toEqual(['Fine']);
    expect(s.store.getView().notifications.map((n) => n.message)).toEqual(['Plugin broken: failed: boom']);
  });

  it('times out activate after 10 s, fences the plugin and ignores what it does later', async () => {
    vi.useFakeTimers();
    let late: PluginContext | null = null;
    const s = setUp({
      slow: definePlugin({
        activate(ctx) {
          late = ctx;
          return new Promise(() => undefined);
        },
      }),
      next: definePlugin({ activate() { /* nothing */ } }),
    });

    const loading = loadPlugins([pluginEntry('slow', { kind: 'map-view' }), pluginEntry('next')], s.options);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(row(s.store, 'slow')?.load).toBe('loading');
    await vi.advanceTimersByTimeAsync(1);
    const result = await loading;

    expect(result.active).toEqual(['next']);
    expect(row(s.store, 'slow')).toMatchObject({ load: 'failed', loadDetail: 'activate() did not finish within 10 s' });
    const ctx = late as unknown as PluginContext;
    ctx.ui.addControlPanel({ id: 'late', title: 'Late', component: Panel });
    ctx.ui.setMapView({ mount: () => () => undefined });
    ctx.notify({ severity: 'info', message: 'late' });
    expect(s.store.getView().panels).toEqual([]);
    expect(s.store.getView().mapView).toBeNull();
    expect(s.store.getView().notifications.map((n) => n.message)).toEqual(['Plugin slow: activate() did not finish within 10 s']);
    await expect(ctx.changes.submit({ entityType: 'layer', operation: 'delete', entityId: 'x' })).rejects.toBeInstanceOf(OutcomeUnknownError);
    expect(s.submit).not.toHaveBeenCalled();
    expect(s.console.warn).toHaveBeenCalledWith('[slow]', expect.stringMatching(/^ignored the panel late/));
  });

  it('a disabled plugin gets no more live picture updates', async () => {
    const snapshots = vi.fn();
    const s = setUp({
      broken: definePlugin({
        activate(ctx) {
          ctx.livePicture.subscribe({ snapshot: snapshots, changes: snapshots });
          throw new Error('boom');
        },
      }),
    });
    await loadPlugins([pluginEntry('broken')], s.options);
    s.picture.replace([], [mapObject('a')], 1);
    expect(snapshots).not.toHaveBeenCalled();
  });

  it('times out the import after 30 s', async () => {
    vi.useFakeTimers();
    const s = setUp({}, { importModule: () => new Promise(() => undefined) });
    const loading = loadPlugins([pluginEntry('hangs')], s.options);
    await vi.advanceTimersByTimeAsync(30_000);
    await loading;
    expect(row(s.store, 'hangs')).toMatchObject({ load: 'failed', loadDetail: 'its entry module did not load within 30 s' });
  });

  it('disables a plugin whose entry module cannot be imported or has no activate', async () => {
    const s = setUp({ missing: undefined, odd: { default: { start() { /* not activate */ } } } });
    await loadPlugins([pluginEntry('missing'), pluginEntry('odd')], s.options);
    expect(row(s.store, 'missing')).toMatchObject({ load: 'failed', loadDetail: 'failed: cannot load /plugins/missing/web/index.js' });
    expect(row(s.store, 'odd')).toMatchObject({ load: 'failed', loadDetail: 'failed: its entry module has no default export with activate(ctx)' });
  });

  it('loads a plugin whose style sheet is missing, and says so', async () => {
    const s = setUp({ ugly: definePlugin({ activate() { /* nothing */ } }) });
    await loadPlugins([pluginEntry('ugly', { web: { css: ['missing.css'] } })], s.options);
    expect(row(s.store, 'ugly')).toMatchObject({ load: 'active', observed: { state: 'DEGRADED', detail: 'style sheet missing.css not loaded' } });
  });

  it('disables the users of a failed dependency or a failed service provider', async () => {
    const s = setUp({
      symbology: definePlugin({ activate() { throw new Error('no symbols today'); } }),
      draw: definePlugin({ activate() { /* never called */ } }),
      after: definePlugin({ activate() { /* never called */ } }),
    });
    await loadPlugins([
      pluginEntry('symbology', { provides: ['emc2.symbols'] }),
      pluginEntry('draw', { requires: ['emc2.symbols'] }),
      pluginEntry('after', { dependsOn: ['symbology'] }),
    ], s.options);
    expect(s.imported).toEqual(['/plugins/symbology/web/index.js']);
    expect(row(s.store, 'draw')).toMatchObject({ load: 'refused', loadDetail: 'requires emc2.symbols, but its provider is not available' });
    expect(row(s.store, 'after')).toMatchObject({ load: 'refused', loadDetail: 'depends on symbology, whose web part is not available' });
  });

  it('a plugin that waits for a service whose provider fails gets a rejection, not a hang', async () => {
    let error: unknown = null;
    const s = setUp({
      user: definePlugin({
        async activate(ctx) {
          await ctx.services.get(SYMBOLS).catch((e: unknown) => { error = e; });
        },
      }),
    });
    await loadPlugins([pluginEntry('user')], s.options);
    expect(String(error)).toBe('Error: no loaded plugin provides emc2.symbols');
  });

  it('refuses incompatible plugins without loading them', async () => {
    const s = setUp({});
    await loadPlugins([pluginEntry('old', { sdkVersion: '^0.2.0' })], s.options);
    expect(s.imported).toEqual([]);
    expect(row(s.store, 'old')?.load).toBe('refused');
  });

  it('stops when a required plugin fails, and says why', async () => {
    const s = setUp({
      alpha: definePlugin({ activate() { /* fine */ } }),
      core: definePlugin({ activate() { throw new Error('broken'); } }),
      later: definePlugin({ activate() { /* never */ } }),
    });
    await loadPlugins([pluginEntry('later'), pluginEntry('core', { required: true, name: 'Core thing' }), pluginEntry('alpha')], s.options);
    expect(s.imported).toEqual(['/plugins/alpha/web/index.js', '/plugins/core/web/index.js']);
    expect(row(s.store, 'alpha')?.load).toBe('active');
    expect(s.store.getView().fatal).toBe('The required plugin Core thing is not available (failed: broken). The application cannot run without it.');
    expect(row(s.store, 'later')).toMatchObject({ load: 'refused', loadDetail: 'not loaded: the required plugin core is not available' });
  });

  it('a refused required plugin stops the application too', async () => {
    const s = setUp({ a: definePlugin({ activate() { /* never */ } }) });
    await loadPlugins([pluginEntry('needed', { required: true, web: { shared: { ol: '1.0.0' } } }), pluginEntry('a')], s.options);
    expect(s.imported).toEqual([]);
    expect(s.store.getView().fatal).toMatch(/^The required plugin needed is not available/);
  });

  it('only the map view plugin may set the map view, once', async () => {
    const mount = { mount: () => () => undefined };
    let second: unknown = null;
    const s = setUp({
      map: definePlugin({
        activate(ctx) {
          ctx.ui.setMapView(mount);
          try { ctx.ui.setMapView(mount); } catch (e) { second = e; }
        },
      }),
      intruder: definePlugin({ activate(ctx) { ctx.ui.setMapView(mount); } }),
    });
    await loadPlugins([pluginEntry('map', { kind: 'map-view' }), pluginEntry('intruder')], s.options);
    expect(s.store.getView().mapView?.pluginId).toBe('map');
    expect(String(second)).toBe('Error: map has set the map view already');
    expect(row(s.store, 'intruder')?.loadDetail).toBe('failed: intruder is not the map view plugin (kind "map-view"), so it cannot set the map view');
  });

  it('gives each plugin the live picture, the change requests and the status in its own name', async () => {
    const s = setUp({
      p: definePlugin({
        activate(ctx) {
          ctx.livePicture.subscribe({ snapshot: () => { throw new Error('bad listener'); }, changes: () => undefined });
          ctx.status.set('DEGRADED', 'no GPU');
          void ctx.changes.submit({ entityType: 'layer', operation: 'delete', entityId: 'x' }).catch(() => undefined);
        },
      }),
    });
    await loadPlugins([pluginEntry('p')], s.options);
    expect(s.submit).toHaveBeenCalledWith({ entityType: 'layer', operation: 'delete', entityId: 'x' }, 'p');
    expect(row(s.store, 'p')?.reported).toEqual({ state: 'DEGRADED', detail: 'no GPU' });

    s.picture.replace([], [mapObject('a')], 1);
    expect(row(s.store, 'p')?.observed).toEqual({ state: 'DEGRADED', detail: 'its live picture listener failed: Error: bad listener' });
  });

  it('checks what plugins register', async () => {
    const s = setUp({
      a: definePlugin({ activate(ctx) { ctx.ui.addControlPanel({ id: '', title: 'x', component: Panel }); } }),
      b: definePlugin({ activate(ctx) { ctx.ui.addMapPaneOverlay({ id: 'o', position: 'middle' as 'top-left', component: Panel }); } }),
      c: definePlugin({ activate(ctx) { ctx.status.set('FINE' as 'OK', ''); } }),
    });
    await loadPlugins([pluginEntry('a'), pluginEntry('b'), pluginEntry('c')], s.options);
    expect(s.store.getView().plugins.map((p) => p.loadDetail)).toEqual([
      'failed: a control panel needs a non-empty id',
      'failed: the overlay o has an unknown position: middle',
      'failed: unknown plugin state: FINE',
    ]);
  });
});
