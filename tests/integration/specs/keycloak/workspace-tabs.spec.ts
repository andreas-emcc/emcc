// Quick run: @login @plugin-simulator @plugin-layer-panel @plugin-object-list @plugin-draw-shapes @plugin-draw-symbols
// Quick run of this file alone: node tests/integration/run.mjs --skip-build --keycloak -- specs/keycloak/workspace-tabs.spec.ts
import { expect, test, type Page } from '@playwright/test';
import { newLayer } from '../../lib/layer-panel';
import { createLayer, createSymbol, type LiveClient } from '../../lib/live.mjs';
import { useTestRealm, viewTabs, withLoginServer, type LoginRun } from '../../lib/login';
import { bottomPanel } from '../../lib/m0';

// The workspace tabs per user in the browser (T-086 part 5a; ADR-0039 point 2, A18; simulator
// criterion 1; layer-panel's, draw-symbols' and draw-shapes' permission per workspace, with their
// hints; object-list criterion 17), against a real Keycloak. The sim-* users hold Simulation's view, edit
// and run permissions in different combinations and none of View's edit permissions
// (lib/keycloak.mjs). The server's side is in keycloak/workspaces.spec.ts, the no-login flows in
// flows/m3-workspace-tabs.spec.ts. Every page fails the test on a console error, so a panel that
// reads what its user may not see (a 403) fails it too. Runs only with run.mjs --keycloak.

test.describe.configure({ timeout: 180_000 });

const realm = useTestRealm();
const SIMULATION = 'simulator.simulation';

function views(page: Page) {
  return page.getByRole('tablist', { name: 'Views' });
}

async function switchTo(page: Page, name: 'View' | 'Simulation'): Promise<void> {
  await views(page).getByRole('tab', { name, exact: true }).click();
  await expect(views(page).getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name }).getByRole('tab', { name: 'Layers', exact: true })).toBeVisible();
  await bottomPanel(page, 'Layers'); // Simulation's bottom pane may show Objects first (M4, T-108)
}

function layers(page: Page) {
  return page.getByRole('tabpanel', { name: 'Layers', exact: true });
}

/** Seeds a Simulation layer with one symbol through a user's live connection, which must be allowed to. */
async function seedSimulation(live: LiveClient, layerName: string, symbolName: string): Promise<{ layerId: string; symbolId: string }> {
  const layer = createLayer(layerName, { workspace: SIMULATION, drawOrder: 1 });
  expect(await live.change(layer)).toMatchObject({ outcome: 'applied' });
  const symbol = createSymbol(layer.entityId, 0, { name: symbolName });
  symbol.data.geometry.coordinates = [16.25, 61.5];
  expect(await live.change(symbol)).toMatchObject({ outcome: 'applied' });
  return { layerId: layer.entityId, symbolId: symbol.entityId };
}

async function withSimulationEditor(run: LoginRun) {
  const { context, page } = await run.logIn('simEditor');
  const live = await run.live(context);
  await live.subscribe({ workspaces: ['*'] });
  return { page, live };
}

test('a user without Simulation\'s view permission has no Simulation tab, and its address opens View; users with it have View and Simulation (A18; simulator criterion 1)', async ({ browser }, testInfo) => {
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const { page: blind } = await run.logIn('simBlind');
    expect(await viewTabs(blind)).toEqual(['View']);
    await blind.goto(`/#workspace/${SIMULATION}`);
    await expect(blind.getByRole('status', { name: 'Live picture' })).toHaveText('Live picture: connected');
    await expect(views(blind).getByRole('tab', { name: 'View', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(blind.getByRole('tabpanel', { name: 'View' }).getByRole('tab', { name: 'Layers', exact: true })).toBeVisible();
    for (const name of ['Routes', 'Ground truth outputs', 'Sensors']) await expect(blind.getByRole('region', { name, exact: true })).toHaveCount(0);

    for (const user of ['simViewer', 'simEditor', 'simRunner'] as const) {
      const { page } = await run.logIn(user);
      expect(await viewTabs(page), user).toEqual(['View', 'Simulation']);
    }
  });
});

test('Simulation is read-only for a user without its edit permission, and the panels say so; a user with it changes Simulation\'s layers, while View\'s layer panel tells it that it may not change View\'s (layer-panel, draw-symbols and draw-shapes per workspace)', async ({ browser }, testInfo) => {
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const editor = await withSimulationEditor(run);
    await seedSimulation(editor.live, 'Truth', 'SIM 1');

    // simViewer: may see Simulation, may change nothing in it nor in View.
    const { page: viewer } = await run.logIn('simViewer');
    await expect(layers(viewer)).toContainText('You may not change layers');
    await expect(layers(viewer)).not.toContainText('You may not change layers in Simulation');
    await switchTo(viewer, 'Simulation');
    await expect(layers(viewer)).toContainText('You may not change layers in Simulation');
    await expect(layers(viewer).getByRole('button', { name: 'Make Truth active' })).toBeVisible();
    // No change button can be used, whether the panel shows it switched off or not at all.
    for (const name of ['New layer', 'Delete Truth', 'Move Truth up', 'Move Truth down', 'Rename Truth']) {
      await expect(layers(viewer).getByRole('button', { name, exact: true, disabled: false }), `no usable ${name}`).toHaveCount(0);
    }
    const shapes = viewer.getByRole('region', { name: 'Shapes' }).last();
    await expect(shapes).toContainText('You may not edit objects in Simulation');
    for (const tool of ['Circle', 'Area', 'Route']) await expect(shapes.getByRole('group', { name: 'Shape tools' }).getByRole('button', { name: tool })).toBeDisabled();
    await expect(viewer.getByRole('region', { name: 'Symbols' }).getByRole('button', { name: 'Place on map' })).toBeDisabled();

    // simEditor: View's layers read-only, Simulation's changeable.
    await expect(layers(editor.page)).toContainText('You may not change layers');
    await switchTo(editor.page, 'Simulation');
    await expect(layers(editor.page)).not.toContainText('You may not change layers');
    await newLayer(editor.page); // T-171: the dialog, with its name and classification
    await expect.poll(() => editor.live.events.some((e: { entityType: string; operation: string; state?: { workspace?: string } }) =>
      e.entityType === 'layer' && e.operation === 'create' && e.state?.workspace === SIMULATION && e.state && !['Truth', 'Simulation'].includes((e.state as { name?: string }).name ?? '')),
    { message: 'a layer made in Simulation, in Simulation' }).toBe(true);
    await expect(layers(editor.page).getByRole('list', { name: 'Layers' }).getByRole('listitem')).toHaveCount(3); // Truth, the simulator's first layer "Simulation" (M4, T-101) and the new one
  });
});

test('object-list 17: in Simulation a user with its edit permission and without objects.edit gets the shell\'s menu on a row, and its Delete removes the object', async ({ browser }, testInfo) => {
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const editor = await withSimulationEditor(run);
    const { symbolId } = await seedSimulation(editor.live, 'Truth', 'SIM 1');
    const page = editor.page;
    await switchTo(page, 'Simulation');

    await layers(page).getByRole('listitem').filter({ hasText: 'Truth' }).getByText(/UNCLASSIFIED ·/).dblclick();
    const row = page.getByRole('region', { name: 'Objects' }).getByRole('listbox', { name: 'Objects of the layer' }).getByRole('option').filter({ hasText: 'SIM 1' });
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Actions' });
    await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeEnabled();
    await menu.getByRole('menuitem', { name: 'Delete' }).click();
    const question = page.getByRole('alertdialog', { name: 'Delete objects' });
    await expect(question).toContainText('Delete 1 object?');
    await question.getByRole('button', { name: 'Delete 1 object' }).click();
    await expect.poll(() => editor.live.events.some((e: { entityId: string; operation: string }) => e.entityId === symbolId && e.operation === 'delete'), { message: 'the object deleted' }).toBe(true);
    await expect(row).toHaveCount(0);
  });
});
