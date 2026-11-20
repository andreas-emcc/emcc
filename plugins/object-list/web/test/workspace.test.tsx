// The M3 functions 10 to 12 and criteria 14 to 17 of docs/plugins/briefs/object-list.md: the panel in
// every workspace, the workspace's own layers only, the layer shown again on the way back, and the
// object actions on rows with the workspace's permissions. Tested with the test kit's
// `switchWorkspace`, as the briefs README says (M3, rule 9); the real switch is checked in the browser.
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EVERY_WORKSPACE, OBJECT_LIST, VIEW_WORKSPACE } from '@emc2/plugin-sdk';
import type { Layer, MapObject, Uuid, WorkspaceInfo } from '@emc2/plugin-sdk';
import { createFakeMapView, createFakeUser } from '@emc2/plugin-sdk/testing';
import { ObjectListController } from '../src/controller.ts';
import { activated, fixture, gateQueries, layer, layerCreated, layerDeleted, objectsOf, settle } from './helpers.tsx';

afterEach(cleanup);

const SIMULATION = 'simulator.simulation';
const SIMULATION_INFO: WorkspaceInfo = { id: SIMULATION, name: 'Simulation', viewPermission: 'plugin.simulator.view', editPermission: 'plugin.simulator.edit', order: 1 };

function inSimulation(l: Layer): Layer {
  return { ...l, workspace: SIMULATION };
}

function chooserOptions(): string[] {
  const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Layer' });
  return [...select.options].map((o) => o.textContent);
}

function shownLayer(): string | undefined {
  return screen.getByRole<HTMLSelectElement>('combobox', { name: 'Layer' }).selectedOptions[0]?.textContent ?? undefined;
}

function rows(): HTMLElement[] {
  const list = screen.queryByRole('listbox', { name: 'Objects of the layer' });
  return list === null ? [] : within(list).queryAllByRole('option');
}

/** Two View layers and two Simulation layers, 3 objects each; View is shown at the start. */
async function twoWorkspaces(options: Parameters<typeof fixture>[2] = {}) {
  const viewA = layer('View A', 1);
  const viewB = layer('View B', 2);
  const simS = inSimulation(layer('Sim S', 3));
  const simT = inSimulation(layer('Sim T', 4));
  const layers = [viewA, viewB, simS, simT];
  const objects: MapObject[] = layers.flatMap((l, i) => objectsOf(l.id, 3, l.name, i * 3));
  const f = await fixture(layers, objects, { workspaces: [SIMULATION_INFO], ...options });
  return { ...f, viewA, viewB, simS, simT, objects };
}

/** What the shell does on a switch, in its order: the map view's moment, then the workspace (SDK 1.2.0, `CurrentWorkspace`). */
function switchTo(f: Awaited<ReturnType<typeof twoWorkspaces>>, id: string): void {
  act(() => {
    f.map?.switchWorkspace();
    f.ctx.switchWorkspace(id);
  });
}

describe('AC14: the panel is in every workspace, with that workspace\'s layers', () => {
  it('is registered for every workspace, and the plugin names no workspace id of its own', async () => {
    const { ctx } = await activated({ workspaces: [SIMULATION_INFO] });
    expect(ctx.addedPanels[0]?.panel.workspaces).toEqual([EVERY_WORKSPACE]);
    expect(ctx.liveSubscriptions).toEqual([{ objects: false }]);
  });

  it('lists View\'s layers in View and Simulation\'s layers in Simulation', async () => {
    const f = await twoWorkspaces();
    expect(chooserOptions()).toEqual(['Choose a layer', 'View B', 'View A']);
    switchTo(f, SIMULATION);
    expect(chooserOptions()).toEqual(['Choose a layer', 'Sim T', 'Sim S']);
    switchTo(f, VIEW_WORKSPACE);
    expect(chooserOptions()).toEqual(['Choose a layer', 'View B', 'View A']);
  });

  it('follows a layer created in the workspace shown, and not one created in another workspace', async () => {
    const f = await twoWorkspaces();
    switchTo(f, SIMULATION);
    const created = inSimulation(layer('Sim U', 5));
    act(() => {
      f.ctx.live.changes([layerCreated(created, 100)]);
    });
    expect(chooserOptions()).toEqual(['Choose a layer', 'Sim U', 'Sim T', 'Sim S']);
    const other = layer('View C', 6);
    act(() => {
      f.ctx.live.changes([layerCreated(other, 101)]);
    });
    expect(chooserOptions()).toEqual(['Choose a layer', 'Sim U', 'Sim T', 'Sim S']);
  });

  it('never lists another workspace\'s layer, even when the picture holds it (rule 6)', async () => {
    // A subscription that is given every workspace's layers, as a stale picture would: the controller itself keeps them out.
    const { ctx } = await activated({ workspaces: [SIMULATION_INFO] });
    const wide = new Proxy(ctx, {
      get: (target, property) =>
        property === 'livePicture' ? { subscribe: (listener: Parameters<typeof ctx.livePicture.subscribe>[0]) => ctx.livePicture.subscribe(listener, { objects: false, workspaces: [EVERY_WORKSPACE] }) } : (Reflect.get(target, property, target) as unknown),
    });
    const controller = new ObjectListController(wide);
    const viewA = layer('View A', 1);
    const simS = inSimulation(layer('Sim S', 2));
    ctx.setServerLayers([viewA.id, simS.id]);
    act(() => {
      ctx.live.snapshot({ layers: [viewA, simS], objectCounts: { [viewA.id]: 1, [simS.id]: 1 } });
    });
    expect(controller.getState().layers.map((l) => l.name)).toEqual(['View A']);
    act(() => {
      ctx.switchWorkspace(SIMULATION);
    });
    expect(controller.getState().layers.map((l) => l.name)).toEqual(['Sim S']);
  });
});

describe('AC15: opening another workspace\'s layer', () => {
  it('opens nothing and says so when a View layer is opened while Simulation is shown', async () => {
    const f = await twoWorkspaces();
    switchTo(f, SIMULATION);
    act(() => {
      f.service.open(f.viewA.id);
    });
    await settle();
    expect(f.ctx.notifications.map((n) => [n.severity, n.message])).toEqual([['warning', 'That layer is not in the workspace shown']]);
    expect(f.ctx.addedPanels[0]?.shown).toBe(0);
    expect(shownLayer()).toBe('Choose a layer');
    expect(rows()).toEqual([]);
  });

  it('opens a layer of the workspace shown, and shows the panel', async () => {
    const f = await twoWorkspaces();
    switchTo(f, SIMULATION);
    act(() => {
      f.service.open(f.simS.id);
    });
    await settle();
    expect(f.ctx.notifications).toEqual([]);
    expect(f.ctx.addedPanels[0]?.shown).toBe(1);
    expect(shownLayer()).toBe('Sim S');
    expect(rows().map((r) => r.querySelector('.object-list-cell-name')?.textContent)).toEqual(['Sim S 007', 'Sim S 008', 'Sim S 009']);
  });

  it('opens nothing for a Simulation layer while View is shown', async () => {
    const f = await twoWorkspaces();
    act(() => {
      f.service.open(f.simT.id);
    });
    expect(f.ctx.notifications).toHaveLength(1);
    expect(f.ctx.addedPanels[0]?.shown).toBe(0);
  });
});

describe('AC16: the switch', () => {
  async function opened(f: Awaited<ReturnType<typeof twoWorkspaces>>, l: Layer): Promise<void> {
    act(() => {
      f.service.open(l.id);
    });
    await settle();
  }

  it('shows the layer each workspace showed last when it is back, and the chooser on the first visit', async () => {
    const f = await twoWorkspaces();
    await opened(f, f.viewA);
    expect(shownLayer()).toBe('View A');

    switchTo(f, SIMULATION);
    await settle();
    // First visit: as at start, no layer, and no "deleted" notice for View A leaving the picture.
    expect(shownLayer()).toBe('Choose a layer');
    expect(screen.getByText('Choose a layer to list its objects')).toBeDefined();
    expect(screen.queryByText(/was deleted|no longer exists/)).toBeNull();
    await opened(f, f.simS);
    expect(shownLayer()).toBe('Sim S');

    switchTo(f, VIEW_WORKSPACE);
    await settle();
    expect(shownLayer()).toBe('View A');
    expect(rows()).toHaveLength(3);
    expect(screen.getByText('1–3 of 3')).toBeDefined();

    switchTo(f, SIMULATION);
    await settle();
    expect(shownLayer()).toBe('Sim S');
    expect(rows().map((r) => r.querySelector('.object-list-cell-name')?.textContent)).toEqual(['Sim S 007', 'Sim S 008', 'Sim S 009']);
  });

  it('shows no layer for a workspace that last had none chosen', async () => {
    const f = await twoWorkspaces();
    await opened(f, f.viewA);
    act(() => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Layer' }), { target: { value: '' } });
    });
    switchTo(f, SIMULATION);
    switchTo(f, VIEW_WORKSPACE);
    await settle();
    expect(shownLayer()).toBe('Choose a layer');
  });

  it('shows the chooser, without a notice, when the layer a workspace showed is gone on the way back', async () => {
    const f = await twoWorkspaces();
    await opened(f, f.viewA);
    switchTo(f, SIMULATION);
    // View A is deleted while Simulation is shown: this plugin does not get the event (it follows Simulation), so the fresh snapshot is what lacks it.
    act(() => {
      f.ctx.live.snapshot({ layers: [f.viewB, f.simS, f.simT], objectCounts: {} });
    });
    switchTo(f, VIEW_WORKSPACE);
    await settle();
    expect(shownLayer()).toBe('Choose a layer');
    expect(screen.queryByText(/was deleted|no longer exists/)).toBeNull();
  });

  it('still closes the list with the notice when the shown layer itself is deleted (no switch)', async () => {
    const f = await twoWorkspaces();
    await opened(f, f.viewA);
    act(() => {
      f.ctx.live.changes([layerDeleted(f.viewA, 100)]);
    });
    expect(screen.getByText('The layer "View A" was deleted')).toBeDefined();
  });

  it('a notice about a deleted layer belongs to the workspace it came in, and is gone after a switch', async () => {
    const f = await twoWorkspaces();
    await opened(f, f.viewA);
    act(() => {
      f.ctx.live.changes([layerDeleted(f.viewA, 100)]);
    });
    expect(screen.getByText('The layer "View A" was deleted')).toBeDefined();
    switchTo(f, SIMULATION);
    await settle();
    expect(screen.queryByText(/was deleted/)).toBeNull();
    expect(screen.getByText('Choose a layer to list its objects')).toBeDefined();
    switchTo(f, VIEW_WORKSPACE);
    await settle();
    expect(screen.queryByText(/was deleted/)).toBeNull();
  });

  it('leaves nothing of the workspace left in the state: a late answer for its page is dropped', async () => {
    const { ctx } = await activated({ workspaces: [SIMULATION_INFO] });
    const controller = new ObjectListController(ctx);
    const viewA = layer('View A', 1);
    ctx.setServerLayers([viewA.id]);
    ctx.setServerObjects(objectsOf(viewA.id, 3));
    act(() => {
      ctx.live.snapshot({ layers: [viewA], objectCounts: { [viewA.id]: 3 } });
    });
    const gate = gateQueries(ctx);
    controller.open(viewA.id);
    expect(gate.pending).toHaveLength(1);
    act(() => {
      ctx.switchWorkspace(SIMULATION);
    });
    await act(async () => {
      gate.pending[0]?.release();
      await Promise.resolve();
    });
    await settle();
    const { page, layerId } = controller.getState();
    expect(layerId).toBeNull();
    expect(page.read).toBe(false);
    expect(page.objects).toEqual([]);
  });

  it('has no row selected after a switch, because the map view clears the selection', async () => {
    const f = await twoWorkspaces();
    await opened(f, f.viewA);
    fireEvent.click(rows()[1] as HTMLElement);
    expect(rows().map((r) => r.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    switchTo(f, SIMULATION);
    switchTo(f, VIEW_WORKSPACE);
    await settle();
    expect(shownLayer()).toBe('View A');
    expect(rows().map((r) => r.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false']);
    expect(f.map?.selection.value).toEqual([]);
  });

  it('drops the answer to a page that was asked in the workspace left', async () => {
    const f = await twoWorkspaces();
    const gate = gateQueries(f.ctx);
    act(() => {
      f.service.open(f.viewA.id);
    });
    expect(gate.pending).toHaveLength(1);
    switchTo(f, SIMULATION);
    await act(async () => {
      gate.pending[0]?.release();
      await Promise.resolve();
    });
    await settle();
    expect(shownLayer()).toBe('Choose a layer');
    expect(rows()).toEqual([]);
  });

  it('reads the restored layer\'s first page again, and a count change in the workspace shown reads it again', async () => {
    const f = await twoWorkspaces();
    await opened(f, f.viewA);
    switchTo(f, SIMULATION);
    switchTo(f, VIEW_WORKSPACE);
    await settle();
    expect(screen.getByText('1–3 of 3')).toBeDefined();
    const more = [...f.objects, ...objectsOf(f.viewA.id, 2, 'View A', 50)];
    f.ctx.setServerObjects(more);
    act(() => {
      f.ctx.live.counts({ [f.viewA.id]: 5, [f.viewB.id]: 3, [f.simS.id]: 3, [f.simT.id]: 3 });
    });
    await settle();
    expect(screen.getByText('1–5 of 5')).toBeDefined();
  });
});

describe('a switch whose picture comes after onChange (not the order the SDK sets, kept safe)', () => {
  /** A controller whose live picture the test feeds by hand, so `ctx.switchWorkspace` only calls `onChange`. */
  async function byHand() {
    const { ctx } = await activated({ workspaces: [SIMULATION_INFO] });
    let listener: Parameters<typeof ctx.livePicture.subscribe>[0] | undefined;
    const proxy = new Proxy(ctx, {
      get: (target, property) =>
        property === 'livePicture'
          ? {
              subscribe: (l: Parameters<typeof ctx.livePicture.subscribe>[0]) => {
                listener = l;
                return () => undefined;
              },
            }
          : (Reflect.get(target, property, target) as unknown),
    });
    const controller = new ObjectListController(proxy);
    const viewA = layer('View A', 1);
    const simS = inSimulation(layer('Sim S', 2));
    ctx.setServerLayers([viewA.id, simS.id]);
    ctx.setServerObjects([...objectsOf(viewA.id, 2), ...objectsOf(simS.id, 2, 'Sim', 10)]);
    const picture = (layers: Layer[]): void => {
      act(() => {
        listener?.snapshot({ layers, objects: [], sequenceNo: 1, objectCounts: {} });
      });
    };
    return { ctx, controller, viewA, simS, picture };
  }

  it('keeps the layer a workspace is remembered for when the shell leaves it again before its picture arrives', async () => {
    const h = await byHand();
    h.picture([h.viewA]);
    h.controller.open(h.viewA.id);
    act(() => {
      h.ctx.switchWorkspace(SIMULATION);
    });
    h.picture([h.simS]);
    h.controller.open(h.simS.id);
    act(() => {
      h.ctx.switchWorkspace(VIEW_WORKSPACE);
    });
    h.picture([h.viewA]);
    expect(h.controller.getState().layerId).toBe(h.viewA.id);

    // Simulation and back again, before any picture: Simulation's layer is still remembered.
    act(() => {
      h.ctx.switchWorkspace(SIMULATION);
      h.ctx.switchWorkspace(VIEW_WORKSPACE);
    });
    h.picture([h.viewA]);
    expect(h.controller.getState().layerId).toBe(h.viewA.id);
    act(() => {
      h.ctx.switchWorkspace(SIMULATION);
    });
    h.picture([h.simS]);
    expect(h.controller.getState().layerId).toBe(h.simS.id);
  });

  it('takes a layer opened between the switch and its picture as it is, and keeps it when the picture holds it', async () => {
    const h = await byHand();
    h.picture([h.viewA]);
    act(() => {
      h.ctx.switchWorkspace(SIMULATION);
    });
    h.controller.open(h.simS.id);
    expect(h.ctx.notifications).toEqual([]);
    expect(h.controller.getState().layerId).toBe(h.simS.id);
    h.picture([h.simS]);
    expect(h.controller.getState().layerId).toBe(h.simS.id);
    expect(h.controller.getState().closedNotice).toBeNull();
  });
});

describe('AC17: the object actions on rows are the shell\'s, with the workspace\'s permissions', () => {
  it('registers no object or map action of its own, in any workspace', async () => {
    const f = await twoWorkspaces();
    expect(f.ctx.objectActions).toEqual([]);
    expect(f.ctx.mapActions).toEqual([]);
    switchTo(f, SIMULATION);
    expect(f.ctx.objectActions).toEqual([]);
    expect(f.ctx.mapActions).toEqual([]);
  });

  it('opens the shell\'s menu for the row\'s objects in Simulation with plugin.simulator.edit and without objects.edit, as in View', async () => {
    const user = createFakeUser({ permissions: ['plugin.simulator.view', 'plugin.simulator.edit'] });
    const f = await twoWorkspaces({ user, map: createFakeMapView() });
    expect(user.has('objects.edit')).toBe(false);
    const open = async (l: Layer): Promise<void> => {
      act(() => {
        f.service.open(l.id);
      });
      await settle();
    };
    await open(f.viewA);
    fireEvent.contextMenu(rows()[0] as HTMLElement);
    const viewIds = f.objects.filter((o) => o.layerId === f.viewA.id).map((o) => o.id);
    expect(f.ctx.openedMenus.at(-1)?.target).toEqual({ objects: [viewIds[0] as Uuid] });
    switchTo(f, SIMULATION);
    await open(f.simS);
    expect(rows()).toHaveLength(3);
    const ids = f.objects.filter((o) => o.layerId === f.simS.id).map((o) => o.id);
    fireEvent.contextMenu(rows()[1] as HTMLElement);
    const menu = f.ctx.openedMenus.at(-1);
    expect(menu?.target).toEqual({ objects: [ids[1] as Uuid] });
    expect(f.map?.selection.value).toEqual([ids[1]]);
    // The list sends no change request of its own, whatever the permissions.
    expect(f.ctx.submitted).toEqual([]);
  });
});

describe('the service in the workspace shown', () => {
  it('is provided once and works after a switch', async () => {
    const f = await twoWorkspaces();
    switchTo(f, SIMULATION);
    const service = await f.ctx.services.get(OBJECT_LIST);
    act(() => {
      service.open(f.simT.id);
    });
    await settle();
    expect(shownLayer()).toBe('Sim T');
  });
});
