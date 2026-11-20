import type { WorkspaceInfo } from '@emc2/plugin-sdk';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActions } from '../actions/actions.ts';
import { ActionRegistry } from '../actions/registry.ts';
import * as layouts from '../ui/layout.ts';
import { ShellStore, VIEW_INFO, type LoginInfo } from '../ui/store.ts';
import { hashOf, MONITOR, routeFromHash, SETTINGS, shownTab, tabLabel, tabsFor, VIEW, workspaceOfTab, workspaceTab } from '../ui/tabs.ts';
import { SNAPSHOT_WAIT_MS, SWITCH_EVENT, WorkspaceSwitch } from './switch.ts';

const SIM: WorkspaceInfo = { id: 'simulator.simulation', name: 'Simulation', viewPermission: 'plugin.simulator.view', editPermission: 'plugin.simulator.edit', order: 10 };
const REPLAY: WorkspaceInfo = { id: 'replay.replay', name: 'Replay', viewPermission: 'plugin.replay.view', editPermission: 'plugin.replay.edit', order: 20 };
const admin: LoginInfo = { mode: 'oidc', user: { id: 'a', name: 'Alice', permissions: ['settings.admin'] } };
const user: LoginInfo = { mode: 'oidc', user: { id: 'b', name: 'Bob', permissions: [] } };
const Nothing: ComponentType = () => null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the workspace tabs (ADR-0039 point 2)', () => {
  it('are View, the user\'s workspaces in the order given, then Settings and Monitor for an admin', () => {
    const list = [VIEW_INFO, SIM, REPLAY];

    expect(tabsFor(admin, list)).toEqual([VIEW, 'workspace/simulator.simulation', 'workspace/replay.replay', SETTINGS, MONITOR]);
    expect(tabsFor(user, list)).toEqual([VIEW, 'workspace/simulator.simulation', 'workspace/replay.replay']);
    expect(tabsFor(user, list).map((t) => tabLabel(t, list))).toEqual(['View', 'Simulation', 'Replay']);
    expect(workspaceTab('core.view')).toBe(VIEW);
    expect(workspaceOfTab(VIEW)).toBe('core.view');
    expect(workspaceOfTab('workspace/simulator.simulation')).toBe('simulator.simulation');
    expect(workspaceOfTab(SETTINGS)).toBeNull();
  });

  it('are kept in the address, and one the user may not see opens View', () => {
    const route = { tab: 'workspace/simulator.simulation', entry: null };

    expect(hashOf(route)).toBe('#workspace/simulator.simulation');
    expect(routeFromHash('#workspace/simulator.simulation')).toEqual(route);
    expect(routeFromHash('#workspace/')).toEqual({ tab: VIEW, entry: null });
    expect(shownTab(route.tab, user, [VIEW_INFO, SIM])).toBe(route.tab);
    expect(shownTab(route.tab, user, [VIEW_INFO])).toBe(VIEW);
    expect(shownTab(route.tab, user)).toBe(VIEW);
  });
});

describe('the store\'s workspace', () => {
  it('shows the panels and overlays of the workspace shown, each in its pane layout', () => {
    const store = new ShellStore();
    store.setWorkspaces([VIEW_INFO, SIM]);
    store.addPanel('layer-panel', { id: 'layers', title: 'Layers', component: Nothing, workspaces: ['*'] }, 'left');
    store.addPanel('object-list', { id: 'objects', title: 'Objects', component: Nothing }, 'bottom');
    store.addPanel('simulator', { id: 'routes', title: 'Routes', component: Nothing, workspaces: ['simulator.simulation'] }, 'right');
    store.addOverlay('coordinates', { id: 'cursor', position: 'bottom-left', component: Nothing, workspaces: ['*'] });
    store.addOverlay('simulator', { id: 'clock', position: 'top-right', component: Nothing, workspaces: ['simulator.simulation'] });
    store.movePanel('layer-panel/layers', 'right');
    const viewLayout = store.getView().layout;

    expect(store.getView().panels.map((p) => p.id)).toEqual(['layer-panel/layers', 'object-list/objects']);
    expect(store.getView().overlays.map((o) => o.overlay.id)).toEqual(['cursor']);
    store.setWorkspace('simulator.simulation');
    expect(store.getView().workspace).toBe('simulator.simulation');
    expect(store.getView().panels.map((p) => p.id)).toEqual(['layer-panel/layers', 'simulator/routes']);
    expect(store.getView().overlays.map((o) => o.overlay.id)).toEqual(['cursor', 'clock']);
    expect(store.getView().layout).toBe(layouts.DEFAULT_LAYOUT); // a first visit: the default layout
    expect(store.layoutOf('core.view')).toBe(viewLayout);
    store.setWorkspace('core.view');
    expect(store.getView().layout).toBe(viewLayout);
  });

  it('keeps a layout restored for a workspace not shown until it is shown, and refuses a workspace the user may not see', () => {
    const store = new ShellStore();
    store.setWorkspaces([VIEW_INFO, SIM]);
    const moved = layouts.movePanel(layouts.DEFAULT_LAYOUT, [], 'x/y', 'left');

    store.restoreLayout(moved, 'simulator.simulation');
    expect(store.getView().layout).toBe(layouts.DEFAULT_LAYOUT);
    store.setWorkspace('replay.replay');
    expect(store.getView().workspace).toBe('core.view');
    store.setWorkspace('simulator.simulation');
    expect(store.getView().layout).toBe(moved);
  });

  it('falls back to View when the workspace shown is no longer among the user\'s', () => {
    const store = new ShellStore();
    store.setWorkspaces([SIM]); // View is always there
    store.setWorkspace('simulator.simulation');

    store.setWorkspaces([VIEW_INFO]);

    expect(store.getView().workspaces.map((w) => w.id)).toEqual(['core.view']);
    expect(store.getView().workspace).toBe('core.view');
  });
});

describe('the switch (SDK 1.2.0 CurrentWorkspace)', () => {
  function setUp() {
    const store = new ShellStore();
    store.setWorkspaces([VIEW_INFO, SIM, REPLAY]);
    const steps: string[] = [];
    const element = document.createElement('div');
    element.addEventListener(SWITCH_EVENT, (event) => { steps.push(`moment ${(event as CustomEvent<{ workspace: string }>).detail.workspace}`); });
    store.setMapPane(element);
    const snapshots = new Map<string, () => void>();
    const out = { warn: vi.fn(), error: vi.fn() };
    const switcher = new WorkspaceSwitch(store, { console: out });
    store.addPanel('simulator', { id: 'routes', title: 'Routes', component: Nothing, workspaces: ['simulator.simulation'] }, 'right');
    store.subscribe(() => { steps.push(`panels ${store.getView().panels.map((p) => p.id).join(',')}`); });
    switcher.connect({
      leave: (id) => { steps.push(`leave ${id}`); },
      follow: (id) => { steps.push(`follow ${id}`); return new Promise((resolve) => { snapshots.set(id, resolve); }); },
      enter: (id) => { steps.push(`enter ${id}`); },
    });
    switcher.onChange((w) => { steps.push(`onChange ${w.id}`); });
    return { store, switcher, steps, snapshots, out };
  }

  it('leaves, shows the new panels, gives the map view its moment, waits for the fresh snapshots, restores, then calls onChange', async () => {
    const t = setUp();

    const done = t.switcher.show('simulator.simulation');
    expect(t.steps.filter((s) => !s.startsWith('panels ') || s.includes('routes'))).toEqual([
      'leave core.view', 'panels simulator/routes', 'moment simulator.simulation', 'follow simulator.simulation',
    ]);
    expect(t.switcher.current).toEqual(SIM);
    t.snapshots.get('simulator.simulation')?.();
    await done;

    expect(t.steps.slice(-2)).toEqual(['enter simulator.simulation', 'onChange simulator.simulation']);
    expect(t.out.warn).not.toHaveBeenCalled();
  });

  it('goes on after at most 5 s without the fresh snapshots, and says so', async () => {
    const t = setUp();

    const done = t.switcher.show('simulator.simulation');
    await vi.advanceTimersByTimeAsync(SNAPSHOT_WAIT_MS - 1);
    expect(t.steps).not.toContain('onChange simulator.simulation');
    await vi.advanceTimersByTimeAsync(1);
    await done;

    expect(t.steps.slice(-2)).toEqual(['enter simulator.simulation', 'onChange simulator.simulation']);
    expect(t.out.warn).toHaveBeenCalledWith(expect.stringContaining('took over 5000 ms'));
  });

  it('a newer switch ends the older one\'s waiting: only the newer restores and calls onChange', async () => {
    const t = setUp();

    const first = t.switcher.show('simulator.simulation');
    const second = t.switcher.show('replay.replay');
    t.snapshots.get('simulator.simulation')?.();
    t.snapshots.get('replay.replay')?.();
    await Promise.all([first, second]);

    expect(t.steps.filter((s) => s.startsWith('enter') || s.startsWith('onChange'))).toEqual(['enter replay.replay', 'onChange replay.replay']);
    expect(t.steps).toContain('leave simulator.simulation');
  });

  it('does nothing for the workspace shown or one the user may not see', async () => {
    const t = setUp();

    await t.switcher.show('core.view');
    await t.switcher.show('other.workspace');

    expect(t.steps).toEqual([]);
  });

  it('a failing listener does not stop the others', async () => {
    const t = setUp();
    t.switcher.onChange(() => { throw new Error('broken'); });
    const later: string[] = [];
    t.switcher.onChange((w) => { later.push(w.id); });

    const done = t.switcher.show('simulator.simulation');
    t.snapshots.get('simulator.simulation')?.();
    await done;

    expect(later).toEqual(['simulator.simulation']);
    expect(t.out.error).toHaveBeenCalledWith('[core-shell] a workspace listener failed', expect.any(Error));
  });
});

describe('the actions of the workspace shown (ADR-0039 point 4)', () => {
  it('the lists give only the actions that appear in the workspace shown; without workspaces, View only', () => {
    let shown = 'core.view';
    const registry = new ActionRegistry(() => shown);
    const run = vi.fn();
    registry.addObjectAction('object-list', { id: 'zoom', label: 'Zoom to', appliesTo: {}, multiple: false, run });
    registry.addObjectAction('simulator', { id: 'route', label: 'Put on route', appliesTo: {}, multiple: true, run, workspaces: ['simulator.simulation'] });
    registry.addMapAction('map-view-2d', { id: 'centre', label: 'Centre map', run, workspaces: ['*'] });

    expect(registry.objects.map((r) => r.action.id)).toEqual(['zoom']);
    expect(registry.maps.map((r) => r.action.id)).toEqual(['centre']);
    shown = 'simulator.simulation';
    expect(registry.objects.map((r) => r.action.id)).toEqual(['route']);
    expect(registry.maps.map((r) => r.action.id)).toEqual(['centre']);
    expect(() => registry.addMapAction('x', { id: 'bad', label: 'Bad', run, workspaces: 'core.view' as unknown as string[] }))
      .toThrow('a map action bad has workspaces that are not a list of strings');
  });

  it('the shell\'s Delete, Move and Copy are in View at once and in each other workspace once the configuration names them', () => {
    let shown: WorkspaceInfo = VIEW_INFO;
    const actions = createActions({
      store: new ShellStore(), user: () => ({ id: 'u', name: 'U', permissions: new Set(), noLogin: true, has: () => true }),
      connection: { submit: vi.fn(), getObjects: vi.fn() }, dataTypes: () => [], mapView: () => Promise.resolve(null),
      symbols: () => Promise.resolve(null), layers: () => null, workspace: () => shown,
    });
    const deletes = () => actions.registry.objects.filter((r) => r.pluginId === 'core-shell').map((r) => `${r.action.id} ${String(r.action.permission)}`);

    expect(deletes()).toEqual(['delete objects.edit', 'move-to-layer objects.edit', 'copy-to-layer objects.edit']);
    actions.deleteIn([VIEW_INFO, SIM, REPLAY]);
    actions.deleteIn([VIEW_INFO, SIM, REPLAY]); // again: no second one
    shown = SIM;
    expect(deletes()).toEqual(['delete-simulator.simulation plugin.simulator.edit', 'move-to-layer-simulator.simulation plugin.simulator.edit',
      'copy-to-layer-simulator.simulation plugin.simulator.edit']);
    shown = REPLAY;
    expect(deletes()).toEqual(['delete-replay.replay plugin.replay.edit', 'move-to-layer-replay.replay plugin.replay.edit',
      'copy-to-layer-replay.replay plugin.replay.edit']);
  });
});
