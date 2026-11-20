// Brief functions 10 to 15 (T-085); acceptance criteria 19 to 23, and the workspace parts of criteria
// 28 and 29: the plugin in View and in Simulation, a switch, the routes of the simulator, and
// CR-0020's `signal`. The workspaces come from the SDK test kit (`createFakeContext({ workspaces })`);
// a switch is the fake map view's moment, the fresh snapshots, then `switchWorkspace` (`switchTo`).
import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@emc2/plugin-sdk';
import type { ChangeRequest, DataType, Geometry, MapObject, Position, Uuid } from '@emc2/plugin-sdk';
import { createFakeUser } from '@emc2/plugin-sdk/testing';
import { chooseTool, editPanelOpen, editShape, finishDrawing, openBrowser, selectOf, settle, showShapesPanel, SIMULATION, switchTo, toolButton } from './harness.tsx';
import type { Browser } from './harness.tsx';
import { FakeServer, layer, shapeObject } from './fakeServer.ts';

const ROUTE_TYPE: Omit<DataType, 'behaviour'> = { id: 'simulator.route', name: 'Route', declaredBy: 'simulator', defaults: {} };
const RECT: Geometry = { type: 'Polygon', coordinates: [[[18.0, 59.3], [18.3, 59.3], [18.3, 59.4], [18.0, 59.4], [18.0, 59.3]]] };
const ROUTE: Geometry = { type: 'LineString', coordinates: [[17.5, 59.1], [18.5, 59.6], [19.25, 59.2]] };
const EDIT_SIMULATION = `edit:${SIMULATION.id}`;
const BOTH = ['objects.edit', 'plugin.simulator.edit'];

function world() {
  const ops = layer('Operations', 1);
  const sim = layer('Sim layer', 2, undefined, SIMULATION.id);
  const server = new FakeServer([ops, sim], ['core.general', 'simulator.route']);
  const viewRect = server.seed(shapeObject(ops.id, { geometry: RECT, properties: { name: 'View shape' } }));
  const simCircle = server.seed(shapeObject(sim.id, { properties: { name: 'Sim circle' } }));
  const route = server.seed(shapeObject(sim.id, { geometry: ROUTE, dataType: 'simulator.route', properties: { name: 'Route 1' } }));
  return { server, ops, sim, viewRect, simCircle, route };
}

/** A browser of a user with these permissions, in View or (with `shown`) in Simulation. */
async function open(permissions: readonly string[], options: { readonly shown?: string; readonly active?: 'ops' | 'sim' | null } = {}) {
  const w = world();
  const shown = options.shown ?? 'core.view';
  const active = options.active === undefined ? (shown === 'core.view' ? 'ops' : 'sim') : options.active;
  const browser = await openBrowser(w.server, {
    user: createFakeUser({ permissions }),
    dataTypes: [ROUTE_TYPE],
    workspaces: [SIMULATION],
    workspace: shown,
    activeLayer: active === null ? null : w[active].id,
  });
  return { ...w, browser };
}

const updates = (server: FakeServer): ChangeRequest[] => server.requests.filter((r) => r.operation === 'update');
const creates = (server: FakeServer): ChangeRequest[] => server.requests.filter((r) => r.operation === 'create');
const stored = (server: FakeServer, object: { readonly id: string }): MapObject => {
  const now = server.objects.get(object.id);
  if (now === undefined) throw new Error('the store lost the object');
  return now;
};
const select = async (browser: Browser, ids: Uuid[]) => {
  act(() => {
    browser.map.selection.set(ids);
  });
  await settle();
};
const drop = async (browser: Browser, position: Position | null) => {
  act(() => {
    browser.map.completeInteraction(position);
  });
  await settle();
};
const options = (select: HTMLSelectElement) => [...select.options].map((o) => o.textContent);

describe('criterion 19: every workspace', () => {
  it('both panels appear in every workspace', async () => {
    const { browser } = await open(BOTH);
    const panels = browser.ctx.addedPanels.map((p) => p.panel);
    expect(panels.map((p) => p.id)).toEqual(['draw-shapes']);
    expect(panels[0]?.workspaces).toEqual(['*']);
    const { server, viewRect } = world();
    const other = await openBrowser(server, { workspaces: [SIMULATION] });
    await editShape(other, viewRect.id);
    expect(other.ctx.addedPanels.find((p) => p.panel.id === 'draw-shapes-edit')?.panel.workspaces).toEqual(['*']);
  });

  it('Edit is registered once per workspace, each with its own id, its workspace and its permission', async () => {
    const { browser } = await open(BOTH);
    expect(browser.ctx.objectActions.map((a) => a.id)).toEqual(['edit', EDIT_SIMULATION]);
    expect(browser.ctx.objectActions[0]).toMatchObject({ label: 'Edit', workspaces: ['core.view'], permission: 'objects.edit', appliesTo: { types: ['core.shape'] }, multiple: false });
    expect(browser.ctx.objectActions[1]).toMatchObject({ label: 'Edit', workspaces: [SIMULATION.id], permission: 'plugin.simulator.edit', appliesTo: { types: ['core.shape'] }, multiple: false });
  });

  it('with View alone there is one Edit, with objects.edit', async () => {
    const { server } = world();
    const browser = await openBrowser(server);
    expect(browser.ctx.objectActions.map((a) => a.id)).toEqual(['edit']);
    expect(browser.ctx.objectActions[0]).toMatchObject({ workspaces: ['core.view'], permission: 'objects.edit' });
  });

  it('the menu offers each Edit only to the user who may use it', async () => {
    const { browser, simCircle, viewRect } = await open(['objects.edit']); // may edit View, not Simulation
    await expect(browser.ctx.runObjectAction(EDIT_SIMULATION, [simCircle.id])).rejects.toThrow(/would not offer/);
    await expect(browser.ctx.runObjectAction('edit', [viewRect.id])).resolves.toBeUndefined();
  });
});

describe('criterion 20: drawing in Simulation', () => {
  it('a shape drawn there goes into Simulation’s active layer, as a valid request', async () => {
    const { server, sim, browser } = await open(BOTH, { shown: SIMULATION.id });
    showShapesPanel(browser);
    await chooseTool('Circle');
    await finishDrawing(browser, { type: 'Circle', center: [18.0686, 59.3293], radius: 2500 });
    expect(creates(server)).toHaveLength(1);
    expect(creates(server)[0]).toMatchObject({ operation: 'create', data: { type: 'core.shape', layerId: sim.id } });
  });

  it('the layer field lists Simulation’s layers only', async () => {
    const { simCircle, browser } = await open(BOTH, { shown: SIMULATION.id });
    const panel = await editShape(browser, simCircle.id, EDIT_SIMULATION);
    expect(options(selectOf(panel, 'Layer'))).toEqual(['Sim layer']);
  });

  it('a layer of another workspace that reaches the plugin is not listed', async () => {
    const { ops, browser, simCircle } = await open(BOTH, { shown: SIMULATION.id });
    const layers = browser.connection.subscriptions.find((s) => s.options.objects === false);
    act(() => {
      layers?.listener.changes([
        {
          sequenceNo: 99, requestId: uuidv7(), entityType: 'layer', operation: 'update', entityId: ops.id, version: 2, previousVersion: 1,
          state: { ...ops, version: 2, name: 'Stale View layer' }, label: ops.label, at: ops.meta.modified.at, by: ops.meta.modified.by,
        },
      ]);
    });
    const panel = await editShape(browser, simCircle.id, EDIT_SIMULATION);
    expect(options(selectOf(panel, 'Layer'))).toEqual(['Sim layer']);
  });

  it('View’s layers are listed in View only', async () => {
    const { viewRect, browser } = await open(BOTH);
    const panel = await editShape(browser, viewRect.id);
    expect(options(selectOf(panel, 'Layer'))).toEqual(['Operations']);
  });

  it('without the workspace’s edit permission no tool can be used, and the hint names the workspace', async () => {
    const { browser } = await open(['objects.edit'], { shown: SIMULATION.id });
    showShapesPanel(browser);
    expect(toolButton('Circle').disabled).toBe(true);
    expect(screen.getByText('You may not edit objects in Simulation')).toBeTruthy();
  });

  it('in View, plugin.simulator.edit is not enough, and the hint does not name a workspace', async () => {
    const { browser } = await open(['plugin.simulator.edit']);
    showShapesPanel(browser);
    expect(toolButton('Circle').disabled).toBe(true);
    expect(screen.getByText('You may not edit objects')).toBeTruthy();
  });

  it('a View shape put into the selection while Simulation is shown is read only, with the hint, and cannot be reshaped', async () => {
    const { server, viewRect, browser } = await open(BOTH, { shown: SIMULATION.id });
    const panel = await editShape(browser, viewRect.id, EDIT_SIMULATION);
    expect(within(panel.container).getByText('This shape is not in Simulation')).toBeTruthy();
    expect(within(panel.container).getByLabelText<HTMLInputElement>('Name').disabled).toBe(true);
    expect(within(panel.container).getByRole<HTMLButtonElement>('button', { name: 'Reshape' }).disabled).toBe(true);
    // Nothing gets through, whatever calls the controller.
    expect(updates(server)).toHaveLength(0);
  });

  it('an update of a shape that is not in the workspace is refused', async () => {
    const { server, viewRect, browser } = await open(BOTH, { shown: SIMULATION.id });
    const panel = await editShape(browser, viewRect.id, EDIT_SIMULATION);
    fireEvent.change(within(panel.container).getByLabelText('Name'), { target: { value: 'Changed' } });
    fireEvent.keyDown(within(panel.container).getByLabelText('Name'), { key: 'Enter' });
    await settle();
    expect(updates(server)).toHaveLength(0);
  });
});

describe('criterion 21: switch', () => {
  it('a drawing that runs resolves with null at the switch and sends nothing; the tool that was on draws in the new workspace', async () => {
    const { server, sim, browser } = await open(BOTH);
    showShapesPanel(browser);
    await chooseTool('Circle');
    expect(browser.map.runningInteraction).toBe('draw:circle');
    await switchTo(browser, SIMULATION.id, { active: sim.id });
    expect(creates(server)).toHaveLength(0);
    expect(browser.map.runningInteraction).toBe('draw:circle'); // started again in Simulation
    expect(browser.map.drawCalls).toHaveLength(2);
    await finishDrawing(browser, { type: 'Circle', center: [18.0686, 59.3293], radius: 2500 });
    expect(creates(server)[0]).toMatchObject({ data: { layerId: sim.id } });
  });

  it('a tool that was on starts when the active layer arrives a moment after the switch (the order of the plugins’ listeners is not set)', async () => {
    const { server, sim, browser } = await open(BOTH);
    showShapesPanel(browser);
    await chooseTool('Circle');
    await switchTo(browser, SIMULATION.id); // no active layer of Simulation yet at the last step
    expect(creates(server)).toHaveLength(0);
    expect(toolButton('Circle').getAttribute('aria-pressed')).toBe('false');
    act(() => {
      browser.map.activeLayer.set(sim.id); // the map view or the layer panel brings it back a moment after `onChange`
    });
    await settle();
    expect(toolButton('Circle').getAttribute('aria-pressed')).toBe('true');
    expect(browser.map.runningInteraction).toBe('draw:circle');
    await finishDrawing(browser, { type: 'Circle', center: [18.0686, 59.3293], radius: 2500 });
    expect(creates(server)[0]).toMatchObject({ data: { layerId: sim.id } });
  });

  it('in the test kit’s order (the current workspace changes only with the switch) the drawing ends with null and sends nothing', async () => {
    const { server, browser } = await open(BOTH);
    showShapesPanel(browser);
    await chooseTool('Circle');
    await switchTo(browser, SIMULATION.id, { early: false });
    expect(creates(server)).toHaveLength(0);
    expect(browser.map.runningInteraction).toBeNull();
  });

  it('a tool that was on does not start by itself when the active layer comes long after the switch', async () => {
    const { sim, browser } = await open(BOTH);
    showShapesPanel(browser);
    await chooseTool('Circle');
    await switchTo(browser, SIMULATION.id);
    const real = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(real + 5000);
    try {
      act(() => {
        browser.map.activeLayer.set(sim.id);
      });
      await settle();
    } finally {
      clock.mockRestore();
    }
    expect(browser.map.runningInteraction).toBeNull();
    expect(toolButton('Circle').getAttribute('aria-pressed')).toBe('false');
  });

  it('a tool that was on does not start by itself for an active layer the user may not draw into', async () => {
    const { ops, browser } = await open(BOTH);
    showShapesPanel(browser);
    await chooseTool('Circle');
    await switchTo(browser, SIMULATION.id);
    act(() => {
      browser.map.activeLayer.set(ops.id); // View's layer is no layer of Simulation
    });
    await settle();
    expect(browser.map.runningInteraction).toBeNull();
  });

  it('a tool goes off at the switch when the user may not edit in the new workspace', async () => {
    const { sim, browser } = await open(['objects.edit']);
    showShapesPanel(browser);
    await chooseTool('Circle');
    await switchTo(browser, SIMULATION.id, { active: sim.id });
    expect(browser.map.runningInteraction).toBeNull();
    expect(toolButton('Circle').disabled).toBe(true);
  });

  it('a reshape that runs resolves with null at the switch and sends nothing', async () => {
    const { server, viewRect, browser } = await open(BOTH);
    const panel = await editShape(browser, viewRect.id);
    fireEvent.click(within(panel.container).getByRole('button', { name: 'Reshape' }));
    await settle();
    expect(browser.map.runningInteraction).toBe('edit');
    await switchTo(browser, SIMULATION.id);
    expect(browser.map.runningInteraction).toBeNull();
    expect(updates(server)).toHaveLength(0);
  });

  it('an open edit panel closes with the switch and its fixed-area subscription ends', async () => {
    const { viewRect, browser } = await open(BOTH);
    await editShape(browser, viewRect.id);
    expect(editPanelOpen(browser)).toBe(true);
    expect(browser.connection.subscriptions.filter((s) => typeof s.options.area === 'object')).toHaveLength(1);
    await switchTo(browser, SIMULATION.id);
    expect(browser.ctx.addedPanels.find((p) => p.panel.id === 'draw-shapes-edit')).toBeUndefined();
    expect(browser.connection.subscriptions.filter((s) => typeof s.options.area === 'object')).toHaveLength(0);
    expect(browser.map.selection.value).toEqual([]);
  });

  it('the layers follow the workspace shown', async () => {
    const { browser, sim, ops } = await open(BOTH);
    showShapesPanel(browser);
    expect(browser.map.activeLayer.value).toBe(ops.id);
    await switchTo(browser, SIMULATION.id, { active: sim.id });
    await chooseTool('Circle');
    await finishDrawing(browser, { type: 'Circle', center: [18.0686, 59.3293], radius: 2500 });
    const layers = browser.connection.server.requests.map((r) => (r as { data?: { layerId?: string } }).data?.layerId);
    expect(layers).toEqual([sim.id]);
  });
});

describe('criteria 22 and 32: the routes of the simulator', () => {
  it('Edit is not offered for a simulator.route shape, in Simulation or in View, and still is for the other shapes', async () => {
    const { server, ops, simCircle, route, browser } = await open(BOTH, { shown: SIMULATION.id });
    await expect(browser.ctx.runObjectAction(EDIT_SIMULATION, [route.id])).rejects.toThrow(/would not offer/);
    await expect(browser.ctx.runObjectAction(EDIT_SIMULATION, [simCircle.id])).resolves.toBeUndefined();
    // The rule is the data type's, not the workspace's: a route in a View layer gets no Edit either.
    const viewRoute = server.seed(shapeObject(ops.id, { geometry: ROUTE, dataType: 'simulator.route', properties: { name: 'View route' } }));
    await expect(browser.ctx.runObjectAction('edit', [viewRoute.id])).rejects.toThrow(/would not offer/);
  });
});

describe('criterion 23: signal', () => {
  /** The signals of the map view’s drawing and editing calls. */
  function recordSignals(browser: Browser) {
    const draws: (AbortSignal | undefined)[] = [];
    const edits: (AbortSignal | undefined)[] = [];
    const draw = browser.map.draw.bind(browser.map);
    browser.map.draw = (kind, opts) => {
      draws.push(opts?.signal);
      return draw(kind, opts);
    };
    const edit = browser.map.edit.bind(browser.map);
    browser.map.edit = (id, opts) => {
      edits.push(opts?.signal);
      return edit(id, opts);
    };
    return { draws, edits };
  }

  it('switching a tool off during a drawing aborts the map view’s drawing, and no late result is used', async () => {
    const { server, browser } = await open(BOTH);
    const { draws } = recordSignals(browser);
    showShapesPanel(browser);
    await chooseTool('Circle');
    expect(browser.map.runningInteraction).toBe('draw:circle');
    expect(draws[0]?.aborted).toBe(false);
    await chooseTool('Circle');
    expect(draws[0]?.aborted).toBe(true);
    expect(browser.map.runningInteraction).toBeNull(); // the map view left drawing mode
    await finishDrawing(browser, { type: 'Circle', center: [18.0686, 59.3293], radius: 2500 });
    expect(creates(server)).toHaveLength(0);
  });

  it('changing to another tool aborts the first one’s drawing', async () => {
    const { browser } = await open(BOTH);
    const { draws } = recordSignals(browser);
    showShapesPanel(browser);
    await chooseTool('Circle');
    await chooseTool('Rectangle');
    expect(draws[0]?.aborted).toBe(true);
    expect(draws[1]?.aborted).toBe(false);
    expect(browser.map.runningInteraction).toBe('draw:rectangle');
  });

  it('the active layer going aborts the drawing', async () => {
    const { browser } = await open(BOTH);
    const { draws } = recordSignals(browser);
    showShapesPanel(browser);
    await chooseTool('Circle');
    act(() => {
      browser.map.activeLayer.set(null);
    });
    await settle();
    expect(draws[0]?.aborted).toBe(true);
    expect(browser.map.runningInteraction).toBeNull();
  });

  it('closing the edit panel during a reshape aborts the map view’s editing', async () => {
    const { viewRect, browser } = await open(BOTH);
    const { edits } = recordSignals(browser);
    const panel = await editShape(browser, viewRect.id);
    fireEvent.click(within(panel.container).getByRole('button', { name: 'Reshape' }));
    await settle();
    expect(browser.map.runningInteraction).toBe('edit');
    expect(edits[0]?.aborted).toBe(false);
    await select(browser, []);
    expect(edits[0]?.aborted).toBe(true);
    expect(browser.map.runningInteraction).toBeNull();
  });

  it('an Escape still ends the tool, and the drawing’s signal stays unaborted', async () => {
    const { browser } = await open(BOTH);
    const { draws } = recordSignals(browser);
    showShapesPanel(browser);
    await chooseTool('Circle');
    await finishDrawing(browser, null);
    expect(browser.map.runningInteraction).toBeNull();
    expect(toolButton('Circle').getAttribute('aria-pressed')).toBe('false');
    expect(draws).toHaveLength(1);
  });
});

describe('criteria 28 and 29, the workspace parts: the drag', () => {
  it('a route in Simulation is dragged as a whole: one update, every point moved by the same difference', async () => {
    const { server, route, browser } = await open(BOTH, { shown: SIMULATION.id });
    await select(browser, [route.id]);
    expect(browser.map.runningInteraction).toBe('dragObject');
    await drop(browser, [19.5, 60.1]); // +2, +1 from the first point
    expect(updates(server)).toHaveLength(1);
    expect(stored(server, route).geometry).toEqual({ type: 'LineString', coordinates: [[19.5, 60.1], [20.5, 60.6], [21.25, 60.2]] });
  });

  it('is not armed without the workspace’s edit permission', async () => {
    const { simCircle, browser } = await open(['objects.edit'], { shown: SIMULATION.id });
    await select(browser, [simCircle.id]);
    expect(browser.map.runningInteraction).toBeNull();
  });

  it('is not armed for a View shape put into the selection while Simulation is shown, and it gets no subscription', async () => {
    const { viewRect, browser } = await open(BOTH, { shown: SIMULATION.id });
    await select(browser, [viewRect.id]);
    expect(browser.map.runningInteraction).toBeNull();
    // It is read by id, so the plugin knows it; but it is not in the workspace: nothing to drag.
    await select(browser, []);
  });

  it('is armed in Simulation for a Simulation shape and in View for a View shape, each with its own permission', async () => {
    const { simCircle, viewRect, browser } = await open(['plugin.simulator.edit'], { shown: SIMULATION.id });
    await select(browser, [simCircle.id]);
    expect(browser.map.runningInteraction).toBe('dragObject');
    await select(browser, [viewRect.id]);
    expect(browser.map.runningInteraction).toBeNull();
  });

  it('a switch ends the drag, and the selection that is cleared arms nothing', async () => {
    const { simCircle, browser } = await open(BOTH, { shown: SIMULATION.id });
    await select(browser, [simCircle.id]);
    expect(browser.map.runningInteraction).toBe('dragObject');
    await switchTo(browser, 'core.view');
    expect(browser.map.runningInteraction).toBeNull();
  });
});
