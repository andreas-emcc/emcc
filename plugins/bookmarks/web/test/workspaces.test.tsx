// Criteria 13 and 14 (M3, T-085): one set of bookmarks for every workspace. The control is a top bar item,
// which the shell shows in every workspace; Add bookmark and Go to use the map of the workspace shown.
// The test kit has one fake map view, so each test keeps the maps of the workspaces itself (as the shell and the
// map view do) and swaps them on a switch, in the order of `CurrentWorkspace`: the map view's moment, then
// the context's switch. What shows that the plugin acts on the map of the workspace shown and on no other: the
// map after each click, the exact calls it made and the workspace shown at each (a plugin that kept a map of
// its own per workspace, or reacted to a switch, fails these). The lines on `maps` are the test's own
// bookkeeping, marked as such. That the real shell gives each workspace its own map is the shell's, checked in
// the browser (criterion 14) and by the ITA's M3 flows (T-086); the criterion 13 here shows the control is one
// top bar item that names no workspace, and the shell shows top bar items in every workspace.
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VIEW_WORKSPACE, type Position, type WorkspaceInfo } from '@emc2/plugin-sdk';
import type { FakeContext } from '@emc2/plugin-sdk/testing';
import { addCurrentView, openMenu, setup, showMap, stored, trigger } from './support.tsx';
import type { TreeItem } from '../src/tree.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SIMULATION = 'simulator.simulation';
const SIMULATION_INFO: WorkspaceInfo = { id: SIMULATION, name: 'Simulation', viewPermission: 'plugin.simulator.view', editPermission: 'plugin.simulator.edit', order: 10 };

interface MapState {
  projection: string;
  background: string;
  center: Position;
  resolution: number;
}

/** View's map is near Sweden in Web Mercator, Simulation's near Greenland in the polar projection: latitude ≠ longitude in both. */
const VIEW_MAP: MapState = { projection: 'EPSG:3857', background: 'osm', center: [15.25, 62.5], resolution: 611.5 };
const SIMULATION_MAP: MapState = { projection: 'EPSG:3413', background: 'naturalearth', center: [-45.5, 78.25], resolution: 2000 };

/** The plugin in View, with a record of which workspace was shown at each call on the map. */
async function twoWorkspaces() {
  const { ctx, map } = await setup({ workspaces: [SIMULATION_INFO] });
  const maps = new Map<string, MapState>([
    [VIEW_WORKSPACE, { ...VIEW_MAP }],
    [SIMULATION, { ...SIMULATION_MAP }],
  ]);
  const calls: { call: 'setMapType' | 'goTo'; workspace: string }[] = [];
  /** Which workspace is shown. */
  const shown = () => ctx.workspace.current.id;
  /** The test's own moves of the map are not the plugin's calls. */
  let quiet = false;
  const setMapType = map.setMapType.bind(map);
  const goTo = map.goTo.bind(map);
  vi.spyOn(map, 'setMapType').mockImplementation((mapType) => {
    if (!quiet) calls.push({ call: 'setMapType', workspace: shown() });
    return setMapType(mapType);
  });
  vi.spyOn(map, 'goTo').mockImplementation((center, resolution) => {
    if (!quiet) calls.push({ call: 'goTo', workspace: shown() });
    goTo(center, resolution);
  });
  const show = (state: MapState) => {
    quiet = true;
    showMap(map, state.projection, state.background, state.center, state.resolution);
    quiet = false;
  };
  /** What the map of the workspace shown looks like now, and writes it back when the user leaves it. */
  const current = (): MapState => ({ projection: map.mapType.projection, background: map.mapType.background ?? '', center: map.viewport.center, resolution: map.viewport.resolution });
  const switchTo = (id: string) => {
    maps.set(shown(), current());
    map.switchWorkspace();
    ctx.switchWorkspace(id);
    show(maps.get(id) as MapState);
  };
  show(VIEW_MAP);
  calls.length = 0;
  return { ctx, map, maps, calls, switchTo, current };
}

const names = (items: readonly TreeItem[]) => items.map((i) => i.name);
const saved = (ctx: FakeContext, name: string) => {
  const found = stored(ctx).find((i) => i.name === name);
  if (found?.type !== 'bookmark') throw new Error(`no bookmark ${name}`);
  return found;
};

describe('AC 13: the control is in the top bar in every workspace, with the same tree', () => {
  it('is one top bar item that names no workspace, so the shell shows it in View and in Simulation', async () => {
    const { ctx, switchTo } = await twoWorkspaces();
    expect(ctx.topBarItems).toHaveLength(1);
    expect(Object.keys(ctx.topBarItems[0] ?? {})).not.toContain('workspaces');
    switchTo(SIMULATION);
    expect(ctx.topBarItems).toHaveLength(1); // a switch registers and removes nothing
  });

  it('lists the same bookmarks in View and in Simulation, whichever added them', async () => {
    const { ctx, switchTo } = await twoWorkspaces();
    await openMenu();
    await addCurrentView('From View');
    fireEvent.click(trigger()); // closes

    switchTo(SIMULATION);
    await openMenu();
    expect(await screen.findByRole('button', { name: 'From View' })).toBeDefined();
    await addCurrentView('From Simulation');
    fireEvent.click(trigger());

    switchTo(VIEW_WORKSPACE);
    await openMenu();
    expect(await screen.findByRole('button', { name: 'From Simulation' })).toBeDefined();
    expect(names(stored(ctx))).toEqual(['From View', 'From Simulation']);
  });

  it('keeps nothing of the workspace in the control: a switch does not read, write or go anywhere', async () => {
    const { ctx, calls, switchTo } = await twoWorkspaces();
    const put = vi.spyOn(ctx.userDocuments, 'put');
    const get = vi.spyOn(ctx.userDocuments, 'get');
    switchTo(SIMULATION);
    switchTo(VIEW_WORKSPACE);
    expect(put).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe('AC 14: a bookmark carries the map of the workspace it was added in, and opens on the map of the workspace shown', () => {
  it('saves the map type, centre and zoom of the workspace shown (latitude ≠ longitude)', async () => {
    const { ctx, switchTo } = await twoWorkspaces();
    await openMenu();
    await addCurrentView('In View');
    fireEvent.click(trigger());
    switchTo(SIMULATION);
    await openMenu();
    await addCurrentView('In Simulation');

    expect(saved(ctx, 'In View')).toMatchObject({ mapType: { projection: 'EPSG:3857', background: 'osm' }, center: [15.25, 62.5], resolution: 611.5 });
    expect(saved(ctx, 'In Simulation')).toMatchObject({ mapType: { projection: 'EPSG:3413', background: 'naturalearth' }, center: [-45.5, 78.25], resolution: 2000 });
  });

  it('sets the map type, centre and zoom of the workspace shown, and only there: a bookmark from Simulation opened in View, and the reverse', async () => {
    const { ctx, map, maps, calls, switchTo, current } = await twoWorkspaces();
    await openMenu();
    await addCurrentView('In View');
    fireEvent.click(trigger());
    switchTo(SIMULATION);
    await openMenu();
    await addCurrentView('In Simulation');
    fireEvent.click(trigger());
    calls.length = 0;

    // the user moves Simulation's map elsewhere, then opens the other workspace's bookmark in the workspace shown
    map.setViewport({ ...map.viewport, center: [30, 55], resolution: 5000 });
    switchTo(VIEW_WORKSPACE);
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'In Simulation' }));
    expect(current()).toEqual(SIMULATION_MAP); // View now shows Simulation's bookmark
    expect(calls.map((c) => `${c.call}@${c.workspace}`)).toEqual([`setMapType@${VIEW_WORKSPACE}`, `goTo@${VIEW_WORKSPACE}`]);
    expect(maps.get(SIMULATION)).toMatchObject({ center: [30, 55], resolution: 5000 }); // the test's bookkeeping, not evidence about the plugin

    calls.length = 0;
    switchTo(SIMULATION);
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'In View' }));
    expect(current()).toEqual(VIEW_MAP);
    expect(calls.map((c) => `${c.call}@${c.workspace}`)).toEqual([`setMapType@${SIMULATION}`, `goTo@${SIMULATION}`]);
    expect(maps.get(VIEW_WORKSPACE)).toEqual(SIMULATION_MAP); // the test's bookkeeping: View left showing Simulation's bookmark
    expect(ctx.notifications).toEqual([]);
  });
});
