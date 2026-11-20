// Quick run: @login @plugin-simulator
// Quick run of this file alone: node tests/integration/run.mjs --skip-build --keycloak -- specs/keycloak/simulator-rights.spec.ts
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createLayer, createSymbol, type LiveClient } from '../../lib/live.mjs';
import { useTestRealm, withLoginServer, type LoginRun } from '../../lib/login';
import { bottomPanel } from '../../lib/m0';

// The simulator's rights in the browser (T-086 part 5b; the simulator brief's criteria 22 and 1's
// commands, and 13's outputStaleSeconds for admins only), against a real Keycloak. simViewer may see
// Simulation, simEditor also change it, simRunner see it and run the simulation (lib/keycloak.mjs).
// Without plugin.simulator.edit the panels are read-only with the plugin's hint, without
// plugin.simulator.run start, pause and reset are switched off with theirs, and the server refuses
// the same commands made directly. The panels in a browser without login are in
// flows/m3-sim-panels.spec.ts. Runs only with run.mjs --keycloak.

test.describe.configure({ timeout: 240_000 });

const realm = useTestRealm();
const SIMULATION = 'simulator.simulation';
const EDIT_HINT = 'You may not change the simulation';
const RUN_HINT = 'You may not start, pause or reset the simulation';

async function switchTo(page: Page, name: 'View' | 'Simulation'): Promise<void> {
  const tabs = page.getByRole('tablist', { name: 'Views' });
  await tabs.getByRole('tab', { name, exact: true }).click();
  await expect(tabs.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name }).getByRole('tab', { name: 'Layers', exact: true })).toBeVisible();
  await bottomPanel(page, 'Layers'); // Simulation's bottom pane may show Objects first (M4, T-108)
}

function region(page: Page, name: string) {
  return page.getByRole('region', { name, exact: true }).first();
}

/** A Simulation layer, a route and a track on no route, made by simEditor's live connection. */
async function seed(live: LiveClient): Promise<{ routeId: string; trackId: string; route: Record<string, any> }> {
  const layer = createLayer('Ground truth', { workspace: SIMULATION, drawOrder: 1 });
  expect(await live.change(layer)).toMatchObject({ outcome: 'applied' });
  const track = createSymbol(layer.entityId, 0, { name: 'TRACK 1' }) as any;
  track.data.geometry.coordinates = [16.25, 61.5];
  track.data.symbol = { standard: 'APP-6B', sidc: 'SFGPUCI--------' };
  expect(await live.change(track)).toMatchObject({ outcome: 'applied' });
  const route = createSymbol(layer.entityId, 0, { name: 'Route A' }) as any;
  route.data = {
    type: 'core.shape',
    dataType: 'simulator.route',
    dataSource: 'manual',
    layerId: layer.entityId,
    geometry: { type: 'LineString', coordinates: [[16.0, 61.2], [16.3, 61.4], [16.7, 61.3]] },
    style: { strokeColor: '#2C784C', strokeWidth: 2, strokeDash: 'dash', pointMarkers: 'circle' },
    properties: { name: 'Route A' },
    label: route.data.label,
    extensions: { simulator: { points: [{ speedKind: 'instant', speed: 50 }, { speedKind: 'instant', speed: 50 }, {}], groups: [], end: 'stop' } },
  };
  const created = await live.change(route);
  expect(created).toMatchObject({ outcome: 'applied' });
  return { routeId: route.entityId, trackId: track.entityId, route: created.event.state };
}

/** A command to the server part with the user's session; resolves with the status. */
async function command(run: LoginRun, context: BrowserContext, path: string, body: unknown): Promise<number> {
  const response = await run.api(context, `/api/plugins/simulator${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.status;
}

async function openSimulation(run: LoginRun, user: 'simViewer' | 'simEditor' | 'simRunner') {
  const { context, page } = await run.logIn(user);
  await switchTo(page, 'Simulation');
  await expect(region(page, 'Routes').getByRole('listitem', { name: 'Route A' })).toBeVisible();
  return { context, page };
}

/** The run controls, for all routes and for Route A: each enabled or switched off with the hint. */
async function expectControls(page: Page, enabled: boolean, who: string): Promise<void> {
  const routes = region(page, 'Routes');
  for (const name of ['Start all routes', 'Pause all routes', 'Reset all routes', 'Start Route A', 'Pause Route A', 'Reset Route A']) {
    const button = routes.getByRole('button', { name, exact: true });
    if (enabled) await expect(button, `${who}: ${name}`).toBeEnabled();
    else {
      await expect(button, `${who}: ${name}`).toBeDisabled();
      await expect(button, `${who}: ${name}'s hint`).toHaveAttribute('title', RUN_HINT);
    }
  }
}

/** The panels read-only, or changeable, for a user. */
async function expectEditing(page: Page, editable: boolean, who: string): Promise<void> {
  const routes = region(page, 'Routes');
  if (editable) await expect(routes, `${who}: no hint`).not.toContainText(EDIT_HINT);
  else await expect(routes, `${who}: the hint`).toContainText(EDIT_HINT);
  await expect(routes.getByRole('button', { name: 'New route' }), `${who}: New route`).toBeEnabled({ enabled: editable });
  await expect(routes.getByRole('combobox', { name: /^At the end/ }), `${who}: the end behaviour`).toBeEnabled({ enabled: editable });
  // The editor: opened ("Open" when read-only, "Edit" otherwise), its boxes and buttons.
  await routes.getByRole('button', { name: editable ? 'Edit Route A' : 'Open Route A' }).click();
  const editor = region(page, 'Route editor');
  await expect(editor.getByLabel('Name')).toHaveValue('Route A');
  if (editable) await expect(editor).not.toContainText(EDIT_HINT);
  else await expect(editor).toContainText(EDIT_HINT);
  const point = editor.getByRole('region', { name: 'Point 1', exact: true }); // the editor opens on point 1 (T-088)
  await expect(point.getByLabel('Speed (km/h)'), `${who}: a speed box`).toHaveJSProperty('readOnly', !editable);
  await expect(editor.getByRole('button', { name: 'Reshape' }), `${who}: Reshape`).toBeEnabled({ enabled: editable });
  // Append (function 49, T-176): off as Reshape, with the hint as its title.
  const append = editor.getByRole('button', { name: 'Append', exact: true });
  await expect(append, `${who}: Append`).toBeEnabled({ enabled: editable });
  if (!editable) await expect(append, `${who}: Append's title`).toHaveAttribute('title', new RegExp(EDIT_HINT));
  await expect(point.getByRole('button', { name: 'Add event at point 1' }), `${who}: Add event`).toBeEnabled({ enabled: editable });
  await editor.getByRole('button', { name: 'Close the route editor' }).click();
  // Ground truth outputs (M5's name for Outputs): no channel here (cot has no links), but the hint shows.
  if (editable) await expect(region(page, 'Ground truth outputs')).not.toContainText(EDIT_HINT);
  else await expect(region(page, 'Ground truth outputs')).toContainText(EDIT_HINT);
}

/** "Put on route" is offered on the track only to a user who may change the simulation. */
async function expectPutOnRoute(page: Page, offered: boolean, who: string): Promise<void> {
  const objects = region(page, 'Objects');
  await (await bottomPanel(page, 'Layers')).getByRole('listitem').filter({ hasText: 'Ground truth' }).getByText(/UNCLASSIFIED ·/).dblclick();
  const row = objects.getByRole('listbox', { name: 'Objects of the layer' }).getByRole('option').filter({ hasText: 'TRACK 1' });
  await row.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Actions' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Put on route' }), `${who}: Put on route`).toHaveCount(offered ? 1 : 0);
  await page.keyboard.press('Escape');
}

test('criterion 22: without plugin.simulator.edit the panels are read-only with the hint and "Put on route" is not offered; without plugin.simulator.run the controls are switched off with theirs; the server refuses the same commands and changes', async ({ browser }, testInfo) => {
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const editorLogin = await run.logIn('simEditor');
    const editorLive = await run.live(editorLogin.context);
    await editorLive.subscribe({ workspaces: ['*'] });
    const { routeId, trackId, route } = await seed(editorLive);

    // simViewer: sees everything, changes and runs nothing.
    const viewer = await openSimulation(run, 'simViewer');
    await expectEditing(viewer.page, false, 'simViewer');
    await expectControls(viewer.page, false, 'simViewer');
    await expectPutOnRoute(viewer.page, false, 'simViewer');
    expect(await command(run, viewer.context, '/routes/start', {}), 'simViewer: start').toBe(403);
    expect(await command(run, viewer.context, `/routes/${routeId}/reset`, {}), 'simViewer: reset').toBe(403);
    expect(await command(run, viewer.context, '/put-on-route', { route: routeId, kind: 'single', objects: [trackId] }), 'simViewer: put on route').toBe(403);
    expect(await command(run, viewer.context, '/outputs', { channels: [] }), 'simViewer: outputs').toBe(403);
    const viewerLive = await run.live(viewer.context);
    await viewerLive.subscribe({ workspaces: ['*'] });
    const refused = await viewerLive.change({
      requestId: crypto.randomUUID(), entityType: 'object', operation: 'update', entityId: routeId, baseVersion: route.version,
      data: { ...Object.fromEntries(['type', 'dataType', 'dataSource', 'layerId', 'geometry', 'style', 'properties', 'label', 'extensions'].map((k) => [k, route[k]])), properties: { name: 'Renamed' } },
      source: { plugin: 'ita-test' },
    });
    expect(refused, 'simViewer: a change of the route').toMatchObject({ outcome: 'rejected', rejection: { code: 'PERMISSION_DENIED' } });
    // simRunner is not offered "Put on route" either, checked while the track is still on no route.
    const runner = await openSimulation(run, 'simRunner');
    await expectPutOnRoute(runner.page, false, 'simRunner');

    // simEditor: changes, but does not run.
    await switchTo(editorLogin.page, 'Simulation');
    await expectEditing(editorLogin.page, true, 'simEditor');
    await expectControls(editorLogin.page, false, 'simEditor');
    await expectPutOnRoute(editorLogin.page, true, 'simEditor');
    expect(await command(run, editorLogin.context, '/routes/start', {}), 'simEditor: start').toBe(403);
    expect(await command(run, editorLogin.context, '/put-on-route', { route: routeId, kind: 'single', objects: [trackId] }), 'simEditor: put on route').toBe(200);

    // simRunner: runs, but does not change.
    await expectEditing(runner.page, false, 'simRunner');
    await expectControls(runner.page, true, 'simRunner');
    expect(await command(run, runner.context, '/take-off-route', { objects: [trackId] }), 'simRunner: take off route').toBe(403);
    await region(runner.page, 'Routes').getByRole('button', { name: 'Start Route A' }).click();
    await expect(region(runner.page, 'Routes').getByRole('listitem', { name: 'Route A' })).toContainText('Running');
    expect(await command(run, runner.context, '/routes/pause', {}), 'simRunner: pause').toBe(200);
  });
});

test('criterion 13: only a user with settings.admin changes outputStaleSeconds', async ({ browser }, testInfo) => {
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const put = async (context: BrowserContext, value: number) => {
      const url = '/api/settings/plugins/simulator';
      const current = await run.api(context, url);
      const values = current.ok ? (await current.json()).values : { outputStaleSeconds: 5 };
      return (await run.api(context, url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, outputStaleSeconds: value }) })).status;
    };
    for (const user of ['simEditor', 'simRunner'] as const) {
      const { context } = await run.logIn(user);
      expect(await put(context, 30), `${user}: outputStaleSeconds`).toBe(403);
    }
    const { context } = await run.logIn('admin');
    expect(await put(context, 30), 'admin: outputStaleSeconds').toBe(200);
    expect((await (await run.api(context, '/api/settings/plugins/simulator')).json()).values.outputStaleSeconds).toBe(30);
  });
});
