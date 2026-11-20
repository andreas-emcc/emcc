// T-085, part 1 (brief, functions 16 to 19 and 22, criteria 23 to 25 and 32): the plugin in every workspace. The tests use the test kit's
// workspaces: the fake map view's `switchWorkspace()` first (its moment: the interaction ends with null and the selection is cleared),
// then the fake context's `switchWorkspace(id)` (the fresh snapshots, then `onChange`), as the shell does.
import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { appearsIn, EVERY_WORKSPACE, PERMISSIONS } from '@emc2/plugin-sdk';
import { createFakeUser } from '@emc2/plugin-sdk/testing';
import type { MapObject, MapView, Position, WorkspaceInfo } from '@emc2/plugin-sdk';
import { FakeServer, layer, symbolObject } from './fakeServer.ts';
import { isolateDocumentListeners, openBrowser, settle, showPanels } from './harness.tsx';
import type { Browser } from './harness.tsx';
import { dataOf, select } from './scene.tsx';

isolateDocumentListeners();

const SIMULATION: WorkspaceInfo = {
  id: 'simulator.simulation',
  name: 'Simulation',
  viewPermission: 'plugin.simulator.view',
  editPermission: 'plugin.simulator.edit',
  order: 1,
};
const STOCKHOLM: Position = [18.0686, 59.3293];

/** One layer in View and one in Simulation, each with a symbol; the browser starts in View with View's layer active. */
async function scene(options: { readonly user?: ReturnType<typeof createFakeUser> } = {}) {
  const view = layer('View layer', 0);
  const sim = layer('Sim layer', 1, undefined, SIMULATION.id);
  const server = new FakeServer([view, sim]);
  const viewSymbol = server.seed(symbolObject(view.id));
  const simSymbol = server.seed(symbolObject(sim.id, { geometry: { type: 'Point', coordinates: [14.5, 63.0] } }));
  const one = await openBrowser(server, { workspaces: [SIMULATION], ...(options.user === undefined ? {} : { user: options.user }) });
  const panels = showPanels(one);
  act(() => {
    one.map.activeLayer.set(view.id);
  });
  await settle();
  return { server, view, sim, viewSymbol, simSymbol, one, panels };
}

/** The shell's switch: the map view's moment, then the snapshots and `onChange`. */
async function switchTo(browser: Browser, id: string, activeLayer?: string): Promise<void> {
  act(() => {
    browser.map.switchWorkspace();
    browser.ctx.switchWorkspace(id);
  });
  await settle();
  await settle();
  if (activeLayer !== undefined) {
    act(() => {
      browser.map.activeLayer.set(activeLayer);
    });
    await settle();
  }
}

/** Records the `signal` of each `pickPoint` and `dragObject` the plugin asks for. */
function watchSignals(browser: Browser) {
  const picks: (AbortSignal | undefined)[] = [];
  const drags: (AbortSignal | undefined)[] = [];
  const realPick = browser.map.pickPoint.bind(browser.map);
  const realDrag = browser.map.dragObject.bind(browser.map);
  Object.assign(browser.map, {
    pickPoint: (options?: Parameters<MapView['pickPoint']>[0]) => {
      picks.push(options?.signal);
      return realPick(options);
    },
    dragObject: (id: MapObject['id'], options?: Parameters<MapView['dragObject']>[1]) => {
      drags.push(options?.signal);
      return realDrag(id, options);
    },
  });
  return { picks, drags };
}

async function startPlacing(panels: ReturnType<typeof showPanels>): Promise<void> {
  fireEvent.click(panels.symbols.getByRole('button', { name: 'Infantry' }));
  fireEvent.click(panels.symbols.getByRole('button', { name: 'Place on map' }));
  await settle();
}

describe('T-085: the panels and Edit in every workspace (function 16, criterion 23)', () => {
  it('the two panels appear in every workspace', async () => {
    const { one } = await scene();
    const panels = one.ctx.addedPanels.map((entry) => entry.panel);
    expect(panels.map((p) => p.id)).toEqual(['draw-symbols-symbols', 'draw-symbols-properties']);
    for (const panel of panels) {
      expect(panel.workspaces).toEqual([EVERY_WORKSPACE]);
      expect(appearsIn(panel, 'core.view')).toBe(true);
      expect(appearsIn(panel, SIMULATION.id)).toBe(true);
    }
  });

  it('Edit is registered once per workspace, each with its own id, its workspace and its permission', async () => {
    const { one } = await scene();
    const edits = one.ctx.objectActions.filter((a) => a.id.startsWith('edit'));
    expect(edits.map((a) => ({ id: a.id, workspaces: a.workspaces, permission: a.permission }))).toEqual([
      { id: 'edit', workspaces: ['core.view'], permission: PERMISSIONS.objectsEdit },
      { id: 'edit:simulator.simulation', workspaces: [SIMULATION.id], permission: 'plugin.simulator.edit' },
    ]);
    expect(new Set(edits.map((a) => a.id)).size).toBe(2);
  });

  it('Edit in Simulation selects the symbol and shows the properties panel', async () => {
    const { one, simSymbol } = await scene();
    await switchTo(one, SIMULATION.id);
    const edit = one.ctx.objectActions.find((a) => a.id === 'edit:simulator.simulation');
    expect(edit).toBeDefined();
    act(() => {
      void edit?.run([simSymbol.id]);
    });
    await settle();
    expect(one.map.selection.value).toEqual([simSymbol.id]);
    expect(one.ctx.addedPanels.find((p) => p.panel.id === 'draw-symbols-properties')?.shown).toBeGreaterThan(0);
  });
});

describe('T-085: placing and editing in Simulation (functions 17 and 18, criterion 24)', () => {
  it('a symbol placed in Simulation goes into its active layer', async () => {
    const { server, sim, one, panels } = await scene();
    await switchTo(one, SIMULATION.id, sim.id);
    await startPlacing(panels);
    await act(async () => {
      one.map.completeInteraction(STOCKHOLM);
      await Promise.resolve();
    });
    await settle();
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({ operation: 'create', entityType: 'object' });
    expect(dataOf(server.requests[0]).layerId).toBe(sim.id);
  });

  it('the layer field of a symbol in Simulation lists Simulation\'s layers only', async () => {
    const { sim, simSymbol, one, panels } = await scene();
    await switchTo(one, SIMULATION.id, sim.id);
    await select(one, simSymbol.id);
    const field = panels.properties.getByLabelText('Layer') as HTMLSelectElement;
    expect([...field.options].map((o) => o.textContent)).toEqual(['Sim layer']);
  });

  it('without the workspace\'s edit permission nothing can be placed, edited or dragged, and the hint names the workspace', async () => {
    const user = createFakeUser({ permissions: [PERMISSIONS.objectsEdit] }); // View's permission, not Simulation's
    const { server, sim, viewSymbol, simSymbol, one, panels } = await scene({ user });
    // In View it works as before: a drag is armed for the selected symbol.
    await select(one, viewSymbol.id);
    expect(one.map.runningInteraction).toBe('dragObject');
    await switchTo(one, SIMULATION.id, sim.id);
    const { drags } = watchSignals(one);
    expect(panels.symbols.getByText('You may not edit objects in Simulation')).toBeTruthy();
    expect(panels.symbols.getByRole('button', { name: 'Place on map' }).hasAttribute('disabled')).toBe(true);
    await select(one, simSymbol.id);
    expect(panels.properties.getByText('You may not edit objects in Simulation')).toBeTruthy();
    expect((panels.properties.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true);
    expect(drags).toEqual([]);
    expect(one.map.runningInteraction).toBeNull();
    expect(server.requests).toHaveLength(0);
  });

  it('a View symbol in the selection while Simulation is shown is read only with its own hint, and is neither edited nor dragged', async () => {
    const { server, sim, viewSymbol, one, panels } = await scene();
    await switchTo(one, SIMULATION.id, sim.id);
    const { drags } = watchSignals(one);
    await select(one, viewSymbol.id); // another plugin could put it there; the map view does not select View's layers in Simulation
    expect(panels.properties.getByText('This symbol is not in Simulation')).toBeTruthy();
    expect((panels.properties.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true);
    expect(drags.length).toBeLessThanOrEqual(1); // the early drag, armed before the object is known, is ended once it is
    expect(drags.every((signal) => signal?.aborted === true)).toBe(true);
    expect(one.map.runningInteraction).toBeNull();
    expect(server.requests).toHaveLength(0);
  });

  it('View keeps the hint "You may not edit objects" (no workspace name)', async () => {
    const user = createFakeUser({ permissions: [] });
    const { panels } = await scene({ user });
    expect(panels.symbols.getByText('You may not edit objects')).toBeTruthy();
  });
});

describe('T-085: a switch (function 19, criterion 25)', () => {
  it('closes the properties panel and ends the symbol\'s area subscription at once', async () => {
    const { viewSymbol, sim, one, panels } = await scene();
    await select(one, viewSymbol.id);
    expect(one.ctx.liveSubscriptions.some((o) => typeof o.area === 'object')).toBe(true);
    expect(panels.properties.queryByLabelText('Name')).not.toBeNull();
    await switchTo(one, SIMULATION.id, sim.id);
    expect(panels.properties.queryByLabelText('Name')).toBeNull();
    expect(panels.properties.getByText('Select a symbol on the map.')).toBeTruthy();
    expect(one.ctx.liveSubscriptions.some((o) => typeof o.area === 'object')).toBe(false); // not after the grace period: now
  });

  it('while placing: the pick ends with null, placing goes on, and the next click is placed in the new workspace\'s active layer', async () => {
    const { server, sim, one, panels } = await scene();
    await startPlacing(panels);
    expect(one.map.runningInteraction).toBe('pickPoint');
    await switchTo(one, SIMULATION.id, sim.id);
    expect(panels.symbols.queryByRole('button', { name: 'Stop placing' })).not.toBeNull(); // the null of the switch is no Escape
    expect(one.map.runningInteraction).toBe('pickPoint');
    await act(async () => {
      one.map.completeInteraction(STOCKHOLM);
      await Promise.resolve();
    });
    await settle();
    expect(server.requests).toHaveLength(1);
    expect(dataOf(server.requests[0]).layerId).toBe(sim.id);
  });

  it('while placing, in a workspace without an active layer: placing waits with the hint, and starts when a layer is active', async () => {
    const { sim, one, panels } = await scene();
    await startPlacing(panels);
    await switchTo(one, SIMULATION.id); // View's active layer is none of Simulation's layers: there is no active layer in Simulation yet
    expect(panels.symbols.queryByRole('button', { name: 'Stop placing' })).not.toBeNull();
    expect(panels.symbols.getByText('Select or create a layer in the layer panel')).toBeTruthy();
    expect(one.map.runningInteraction).toBeNull(); // nothing to place into: no pick runs
    act(() => {
      one.map.activeLayer.set(sim.id);
    });
    await settle();
    expect(one.map.runningInteraction).toBe('pickPoint');
    expect(panels.symbols.getByText('Click the map to place the symbol. Esc stops placing.')).toBeTruthy();
  });

  it('the null the map view ends the pick with at a switch is no Escape, also when it comes before the last step of the switch (the shell order)', async () => {
    const { server, sim, one, panels } = await scene();
    await startPlacing(panels);
    // The shell shows the new workspace first (`ctx.workspace.current`), then the map view's moment ends the pick; the snapshots and onChange come later.
    Object.defineProperty(one.ctx.workspace, 'current', { get: () => SIMULATION, configurable: true });
    Object.assign(one.map.selection, { set: () => undefined }); // nothing was selected: the map view's clear tells nobody, so no refresh comes between
    act(() => {
      one.map.switchWorkspace();
    });
    await settle();
    expect(panels.symbols.queryByRole('button', { name: 'Stop placing' })).not.toBeNull(); // placing is still on
    expect(one.map.runningInteraction).toBeNull(); // nothing is asked for before the switch's last step
    act(() => {
      one.ctx.switchWorkspace(SIMULATION.id);
      one.map.activeLayer.set(sim.id);
    });
    await settle();
    expect(one.map.runningInteraction).toBe('pickPoint');
    await act(async () => {
      one.map.completeInteraction(STOCKHOLM);
      await Promise.resolve();
    });
    await settle();
    expect(dataOf(server.requests[0]).layerId).toBe(sim.id);
  });

  it('a map view that does not end its interaction at a switch: the plugin ends its pick and asks again in the new workspace', async () => {
    const { sim, one, panels } = await scene();
    const { picks } = watchSignals(one);
    await startPlacing(panels);
    Object.defineProperty(one.ctx.workspace, 'current', { get: () => SIMULATION, configurable: true }); // the shell shows Simulation
    act(() => {
      one.map.activeLayer.set(sim.id);
    });
    act(() => {
      one.ctx.switchWorkspace(SIMULATION.id); // no map view's moment came: its pick is still running; the snapshots, then onChange
    });
    await settle();
    expect(picks).toHaveLength(2);
    expect(picks[0]?.aborted).toBe(true);
    expect(picks[1]?.aborted).toBe(false);
    expect(one.map.runningInteraction).toBe('pickPoint');
    expect(panels.symbols.queryByRole('button', { name: 'Stop placing' })).not.toBeNull();
  });

  it('Escape in the map view still stops placing (a null that is no switch)', async () => {
    const { one, panels } = await scene();
    await startPlacing(panels);
    await act(async () => {
      one.map.completeInteraction(null);
      await Promise.resolve();
    });
    await settle();
    expect(panels.symbols.queryByRole('button', { name: 'Place on map' })).not.toBeNull();
  });

  it('placing does not go on into a workspace the user may not edit in', async () => {
    const user = createFakeUser({ permissions: [PERMISSIONS.objectsEdit] });
    const { sim, one, panels } = await scene({ user });
    await startPlacing(panels);
    await switchTo(one, SIMULATION.id, sim.id);
    expect(panels.symbols.queryByRole('button', { name: 'Place on map' })).not.toBeNull(); // placing is off
    expect(one.map.runningInteraction).toBeNull();
  });
});

describe('T-085: the signal ends the map view\'s interaction (function 22, criterion 32)', () => {
  it('switching placing off aborts the pick, and its result is not used', async () => {
    const { server, one, panels } = await scene();
    const { picks } = watchSignals(one);
    await startPlacing(panels);
    expect(picks).toHaveLength(1);
    expect(picks[0]?.aborted).toBe(false);
    fireEvent.click(panels.symbols.getByRole('button', { name: 'Stop placing' }));
    await settle();
    expect(picks[0]?.aborted).toBe(true);
    expect(one.map.runningInteraction).toBeNull();
    await act(async () => {
      one.map.completeInteraction(STOCKHOLM); // nothing is waiting for it
      await Promise.resolve();
    });
    await settle();
    expect(server.requests).toHaveLength(0);
  });

  it('losing the active layer ends the pick', async () => {
    const { one, panels } = await scene();
    const { picks } = watchSignals(one);
    await startPlacing(panels);
    act(() => {
      one.map.activeLayer.set(null);
    });
    await settle();
    expect(picks[0]?.aborted).toBe(true);
    expect(one.map.runningInteraction).toBeNull();
  });

  it('deselecting the symbol ends its drag', async () => {
    const { viewSymbol, one } = await scene();
    const { drags } = watchSignals(one);
    await select(one, viewSymbol.id);
    expect(one.map.runningInteraction).toBe('dragObject');
    expect(drags.at(-1)?.aborted).toBe(false);
    await select(one, null);
    expect(drags.at(-1)?.aborted).toBe(true);
    expect(one.map.runningInteraction).toBeNull();
  });
});
