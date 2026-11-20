// Brief functions 10 and 11; acceptance criteria 12 and 13 (permissions): the plugin in View and in
// Simulation, a switch, and the edit permission. The workspaces come from the SDK test kit
// (`createFakeContext({ workspaces })`); a switch is the fake map view's moment, the fresh snapshots,
// then `switchWorkspace` (`switchTo`).
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChangeRequest, MapObject } from '@emc2/plugin-sdk';
import { createFakeUser } from '@emc2/plugin-sdk/testing';
import { buttonOf, chooseGraphic, clickTool, editGraphic, editPanelOpen, finishDrawing, inputOf, openBrowser, selectOf, settle, showGraphicsPanel, SIMULATION, switchTo, toolButton, typeAndEnter } from './harness.tsx';
import { FakeServer, graphicObject, layer } from './fakeServer.ts';

const EDIT_SIMULATION = `edit:${SIMULATION.id}`;
const BOTH = ['objects.edit', 'plugin.simulator.edit'];

function world() {
  const ops = layer('Operations', 1);
  const sim = layer('Sim layer', 2, undefined, SIMULATION.id);
  const server = new FakeServer([ops, sim], ['core.general']);
  const viewLine = server.seed(graphicObject(ops.id, { properties: { name: 'View boundary' } }));
  const simLine = server.seed(graphicObject(sim.id, { properties: { name: 'Sim boundary' } }));
  return { server, ops, sim, viewLine, simLine };
}

/** A browser of a user with these permissions, in View or (with `shown`) in Simulation. */
async function open(permissions: readonly string[], options: { readonly shown?: string; readonly active?: 'ops' | 'sim' | null } = {}) {
  const w = world();
  const shown = options.shown ?? 'core.view';
  const active = options.active === undefined ? (shown === 'core.view' ? 'ops' : 'sim') : options.active;
  const browser = await openBrowser(w.server, {
    user: createFakeUser({ permissions }),
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
const options = (list: HTMLSelectElement) => [...list.options].map((o) => o.textContent);
const LINE = { type: 'LineString', coordinates: [[16.5, 58.6], [17.1, 58.9], [18.07, 59.33]] } as const;

describe('criterion 12: every workspace', () => {
  it('the panels are in every workspace', async () => {
    const { browser, viewLine } = await open(BOTH);
    const panels = browser.ctx.addedPanels.map((p) => p.panel);
    expect(panels.map((p) => p.id)).toEqual(['draw-tactical']);
    expect(panels[0]?.workspaces).toEqual(['*']);
    await editGraphic(browser, viewLine.id);
    expect(browser.ctx.addedPanels.find((p) => p.panel.id === 'draw-tactical-edit')?.panel.workspaces).toEqual(['*']);
  });

  it('Edit is registered once per workspace, each with its own id, its workspace and its permission', async () => {
    const { browser } = await open(BOTH);
    expect(browser.ctx.objectActions.map((a) => a.id)).toEqual(['edit', EDIT_SIMULATION]);
    expect(browser.ctx.objectActions[0]).toMatchObject({ label: 'Edit', workspaces: ['core.view'], permission: 'objects.edit', appliesTo: { types: ['core.multipoint'] }, multiple: false });
    expect(browser.ctx.objectActions[1]).toMatchObject({ label: 'Edit', workspaces: [SIMULATION.id], permission: 'plugin.simulator.edit', appliesTo: { types: ['core.multipoint'] }, multiple: false });
  });

  it('with View alone there is one Edit, with objects.edit; the menu offers each only to the user who may use it', async () => {
    const { server } = world();
    const alone = await openBrowser(server);
    expect(alone.ctx.objectActions.map((a) => a.id)).toEqual(['edit']);
    const { browser, simLine, viewLine } = await open(['objects.edit']); // may edit View, not Simulation
    await expect(browser.ctx.runObjectAction(EDIT_SIMULATION, [simLine.id])).rejects.toThrow(/would not offer/);
    await expect(browser.ctx.runObjectAction('edit', [viewLine.id])).resolves.toBeUndefined();
  });

  it('a graphic placed in Simulation goes into Simulation’s active layer, as a valid request', async () => {
    const { server, sim, browser } = await open(BOTH, { shown: SIMULATION.id });
    await showGraphicsPanel(browser);
    await chooseGraphic('Phase Line');
    await clickTool();
    await finishDrawing(browser, LINE);
    expect(creates(server)).toHaveLength(1);
    expect(creates(server)[0]).toMatchObject({ operation: 'create', data: { type: 'core.multipoint', layerId: sim.id } });
  });

  it('the layer field lists Simulation’s layers only in Simulation, and View’s only in View', async () => {
    const { browser, simLine } = await open(BOTH, { shown: SIMULATION.id });
    const panel = await editGraphic(browser, simLine.id, EDIT_SIMULATION);
    expect(options(selectOf(panel, 'Layer'))).toEqual(['Sim layer']);
    const view = await open(BOTH);
    const viewPanel = await editGraphic(view.browser, view.viewLine.id);
    expect(options(selectOf(viewPanel, 'Layer'))).toEqual(['Operations']);
  });

  it('a View graphic put into the selection while Simulation is shown is read only, with the hint, and cannot be reshaped or dragged', async () => {
    const { server, viewLine, browser } = await open(BOTH, { shown: SIMULATION.id });
    const panel = await editGraphic(browser, viewLine.id, EDIT_SIMULATION);
    expect(within(panel.container).getByText('This graphic is not in Simulation')).toBeTruthy();
    expect(inputOf(panel, 'Name').disabled).toBe(true);
    expect(selectOf(panel, 'Layer').disabled).toBe(true);
    expect(buttonOf(panel, 'Reshape').disabled).toBe(true);
    expect(browser.map.runningInteraction).not.toBe('dragObject'); // no drag for a graphic outside the workspace's layers
    expect(updates(server)).toHaveLength(0);
  });

  it('a switch during a placing resolves it with null and sends nothing; the tool that was on places in the new workspace', async () => {
    const { server, sim, browser } = await open(BOTH);
    await showGraphicsPanel(browser);
    await chooseGraphic('Phase Line');
    await clickTool();
    expect(browser.map.runningInteraction).toBe('draw:line');
    await switchTo(browser, SIMULATION.id, { active: sim.id });
    expect(creates(server)).toHaveLength(0);
    expect(toolButton().textContent).toBe('Stop placing');
    expect(browser.map.runningInteraction).toBe('draw:line');
    await finishDrawing(browser, LINE);
    expect(creates(server)).toHaveLength(1);
    expect(creates(server)[0]).toMatchObject({ data: { layerId: sim.id } });
  });

  it('a switch during a reshape sends nothing, and closes the edit panel with its subscription', async () => {
    const { server, browser, viewLine } = await open(BOTH);
    const panel = await editGraphic(browser, viewLine.id);
    fireEvent.click(buttonOf(panel, 'Reshape'));
    await settle();
    expect(browser.map.runningInteraction).toBe('edit');
    await switchTo(browser, SIMULATION.id);
    expect(editPanelOpen(browser)).toBe(false);
    expect(updates(server)).toHaveLength(0);
    expect(browser.ctx.liveSubscriptions).toEqual([{ objects: false }]);
  });

  it('a tool that was on goes off when the new workspace gives the user no right to place into it', async () => {
    const { browser, sim } = await open(['objects.edit']);
    await showGraphicsPanel(browser);
    await chooseGraphic('Phase Line');
    await clickTool();
    await switchTo(browser, SIMULATION.id, { active: sim.id });
    expect(browser.map.runningInteraction).toBeNull();
    expect(toolButton().textContent).toBe('Place graphic');
  });
});

describe('criterion 13: permissions', () => {
  it('without the edit permission the tool is off with the hint, and the fields are off', async () => {
    const { server } = world();
    const browser = await openBrowser(server, { user: createFakeUser({ permissions: [] }) });
    const panel = await showGraphicsPanel(browser);
    await chooseGraphic('Phase Line').catch(() => undefined);
    expect(toolButton().disabled).toBe(true);
    expect(screen.getByText('You may not edit objects')).toBeTruthy();
    expect(inputOf(panel, 'Name').disabled).toBe(true);
    fireEvent.click(toolButton());
    await settle();
    expect(browser.map.runningInteraction).toBeNull();
    expect(creates(server)).toHaveLength(0);
  });

  it('Edit is not offered without the permission, and the plugin refuses a stale call and sends nothing', async () => {
    const { server, viewLine } = world();
    const browser = await openBrowser(server, { user: createFakeUser({ permissions: [] }) });
    await expect(browser.ctx.runObjectAction('edit', [viewLine.id])).rejects.toThrow(/would not offer/);
    expect(editPanelOpen(browser)).toBe(false);
  });

  it('without the workspace’s edit permission the tool is off and the hint names the workspace', async () => {
    const { browser } = await open(['objects.edit'], { shown: SIMULATION.id });
    await showGraphicsPanel(browser);
    expect(toolButton().disabled).toBe(true);
    expect(screen.getByText('You may not edit objects in Simulation')).toBeTruthy();
  });

  it('without an active layer the tool is off with the hint', async () => {
    const { browser } = await open(BOTH, { active: null });
    await showGraphicsPanel(browser);
    await chooseGraphic('Phase Line');
    expect(toolButton().disabled).toBe(true);
    expect(screen.getByText('Select or create a layer in the layer panel')).toBeTruthy();
  });

  it('a PERMISSION_DENIED rejection on an edit is shown, and the panel keeps the input', async () => {
    const { browser, viewLine } = await open(BOTH);
    const panel = await editGraphic(browser, viewLine.id);
    browser.connection.rejectNext.push('PERMISSION_DENIED');
    await typeAndEnter(inputOf(panel, 'Name'), 'Denied');
    expect(browser.ctx.notifications.some((n) => /PERMISSION_DENIED/.test(n.message))).toBe(true);
    expect(inputOf(panel, 'Name').value).toBe('Denied');
    expect(within(panel.container).getByLabelText('Name')).toBeTruthy();
  });

  it('the edit panel and a drag follow the permission: a user who lost it gets a read only panel and no drag', async () => {
    const { server, viewLine } = world();
    const browser = await openBrowser(server, { user: createFakeUser({ permissions: ['objects.edit'] }) });
    const panel = await editGraphic(browser, viewLine.id);
    expect(inputOf(panel, 'Name').disabled).toBe(false);
    expect(browser.map.runningInteraction).toBe('dragObject');
    expect(stored(server, viewLine).version).toBe(1);
  });
});
