// Quick run: @settings @plugin-simulator @plugin-layer-panel @plugin-map-view-2d @plugin-draw-symbols @plugin-draw-shapes @plugin-object-list @plugin-bookmarks @plugin-coordinates
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/flows/m3-workspace-tabs.spec.ts
import { expect, test, type Page } from '@playwright/test';
import { createLayer, LiveClient } from '../../lib/live.mjs';
import {
  bottomPanel, colourAround, colourCentreInMap, drag, FRIEND, frameSymbol, HOSTILE, mapCentre, mapPane, nextEvent, placeSymbols, positionAt, userPause, withM0,
} from '../../lib/m0';
import type { OwnServer } from '../../lib/own-server';

// The workspace tabs in the browser (T-086 part 5a; ADR-0039 points 2, 3, 6 and 8; A15 to A18;
// layer-panel criteria 16, 20 and 21; parts of map-view-2d criteria 44 to 47: the workspace's
// objects only, centre, zoom and active layer, the reference layers), in the no-login mode, where
// the local user has every permission. What a user without Simulation's permissions sees is in
// specs/keycloak/workspace-tabs.spec.ts; the server's filter is in flows/m3-workspaces.spec.ts.
// Positions on the map are read from where a symbol of a known colour is drawn, so the checks do
// not need the cursor display in Simulation.

test.describe.configure({ timeout: 180_000 });

const SIMULATION = 'simulator.simulation';

type Point = { x: number; y: number };
type Layer = { id: string; name: string };

function views(page: Page) {
  return page.getByRole('tablist', { name: 'Views' });
}

/** Switches to a workspace's tab and waits until its Layers panel is shown. */
async function switchTo(page: Page, name: 'View' | 'Simulation'): Promise<void> {
  await views(page).getByRole('tab', { name, exact: true }).click();
  await expect(views(page).getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name }).getByRole('tab', { name: 'Layers', exact: true })).toBeVisible();
  await bottomPanel(page, 'Layers'); // Simulation's bottom pane may show Objects first (M4, T-108)
}

function layers(page: Page) {
  return page.getByRole('tabpanel', { name: 'Layers', exact: true });
}

/** The workspace's own layers as the panel lists them, top of the draw order first. */
async function listed(page: Page): Promise<string[]> {
  return layers(page).getByRole('list', { name: 'Layers' }).getByRole('button', { name: /^Make .* active$/ }).allTextContents();
}

function reference(page: Page) {
  return layers(page).getByRole('group', { name: 'View (reference)' });
}

/** The map's scale line, e.g. "200 km": it tells the zoom. */
function scale(page: Page) {
  return mapPane(page).getByText(/^\d+(\.\d+)? (km|m)$/);
}

/** A Node client that sees every workspace (the local user may), to seed and read Simulation. */
async function everyWorkspace(server: OwnServer): Promise<LiveClient> {
  const client = await LiveClient.open(server.baseUrl);
  await client.subscribe({ workspaces: ['*'] });
  return client;
}

async function seedLayer(client: LiveClient, name: string, workspace?: string, drawOrder = 0): Promise<Layer> {
  const request = createLayer(name, { workspace, drawOrder });
  expect(await client.change(request)).toMatchObject({ outcome: 'applied' });
  return { id: request.entityId, name };
}

async function seedFrame(client: LiveClient, layerId: string, position: number[], identity: 'friend' | 'hostile'): Promise<string> {
  const request = frameSymbol(layerId, position as [number, number], identity);
  expect(await client.change(request)).toMatchObject({ outcome: 'applied' });
  return request.entityId;
}

/** Where the map draws a colour now, after it has settled on one place. */
async function drawnAt(page: Page, colour: readonly number[]): Promise<Point> {
  let at: Point | null = null;
  await expect.poll(async () => (at = await colourCentreInMap(page, colour)) !== null, { timeout: 10_000, message: `a symbol of colour ${colour.join(',')} drawn` }).toBe(true);
  // The same place twice in a row: the map is not still moving.
  await expect.poll(async () => {
    const now = await colourCentreInMap(page, colour);
    const same = now !== null && at !== null && Math.hypot(now.x - at.x, now.y - at.y) < 0.5;
    at = now;
    return same;
  }, { timeout: 10_000 }).toBe(true);
  return at!;
}

/**
 * Records each answered save of a remembered setup: which document, and when. Through responses:
 * Playwright reports these PUTs as aborted requests (no requestfinished), though the server answers.
 */
function watchSaves(page: Page): { name: string; at: number }[] {
  const saves: { name: string; at: number }[] = [];
  page.on('response', (response) => {
    const request = response.request();
    const match = /\/api\/user-documents\/core\/(setup\.(?:w\.[^/]+\.)?current)$/.exec(request.url());
    if (match !== null && request.method() === 'PUT' && response.ok()) saves.push({ name: match[1], at: Date.now() });
  });
  return saves;
}

/**
 * Waits until a workspace's remembered setup was saved after the mark (an index into the saves)
 * and has not been saved again for 1.5 s: the shell saves at most once a second, and the map view
 * reports at most once a second while it moves, so the last save then holds the final state.
 */
async function setupSettled(saves: { name: string; at: number }[], workspace: 'View' | 'Simulation', mark: number): Promise<void> {
  const name = workspace === 'View' ? 'setup.current' : `setup.w.${SIMULATION}.current`;
  await expect.poll(() => {
    const after = saves.slice(mark).filter((s) => s.name === name);
    return after.length > 0 && Date.now() - after[after.length - 1].at >= 1_500;
  }, { timeout: 15_000, message: `${workspace}'s setup saved and settled` }).toBe(true);
}

function expectSamePlace(actual: Point, expected: Point, what: string): void {
  expect(Math.hypot(actual.x - expected.x, actual.y - expected.y), `${what}: at ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`).toBeLessThanOrEqual(2);
}

test('the tabs are View, Simulation, Settings and Monitor; the address names the workspace and a reload reopens it; the simulator\'s panels are in Simulation only, the top bar\'s right side in both (A15, A16, A18)', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ open }) => {
    const page = await open();
    await expect(views(page).getByRole('tab')).toHaveText(['View', 'Simulation', 'Settings', 'Monitor']);
    const topBar = ['Bookmarks', 'Look', 'Setups'];
    const simulatorPanels = ['Routes', 'Ground truth outputs', 'Sensors']; // M5: Outputs renamed, Sensors new (functions 18, 27)
    const expectTopBar = async (where: string) => {
      for (const name of topBar) await expect(page.getByRole('banner').getByRole('button', { name, exact: true }), `${name} in ${where}`).toBeVisible();
      await expect(page.getByRole('banner').getByRole('button', { name: /^Time, / }), `the clock in ${where}`).toBeVisible();
      await expect(page.getByRole('banner').getByRole('status', { name: 'Login' }), `the login mark in ${where}`).toContainText('No login');
    };
    for (const name of simulatorPanels) await expect(page.getByRole('region', { name, exact: true }), `${name} not in View`).toHaveCount(0);
    await expectTopBar('View');

    await switchTo(page, 'Simulation');
    await expect(page).toHaveURL(new RegExp(`#workspace/${SIMULATION.replace('.', '\\.')}$`));
    const shown = page.getByRole('tabpanel', { name: 'Simulation' });
    for (const name of ['Symbols', 'Shapes', ...simulatorPanels]) {
      await expect(shown.getByRole('region', { name, exact: true }).first(), `${name} in Simulation`).toBeVisible();
    }
    // Layers and Objects are tabs of the bottom pane (M4, T-108).
    for (const name of ['Layers', 'Objects']) {
      await expect(shown.getByRole('complementary', { name: 'Bottom pane' }).getByRole('tab', { name, exact: true }), `${name} in Simulation`).toBeVisible();
    }
    await expectTopBar('Simulation');

    await page.reload();
    await expect(views(page).getByRole('tab', { name: 'Simulation' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Simulation' }).getByRole('region', { name: 'Routes', exact: true }).first()).toBeVisible();

    await switchTo(page, 'View');
    await expect(page).not.toHaveURL(/#/);
    for (const name of simulatorPanels) await expect(page.getByRole('region', { name, exact: true })).toHaveCount(0);
  });
});

test('each workspace lists its own layers; in Simulation View\'s layers are a reference group, off at first, read-only, drawn under Simulation\'s, with an eye of their own; a symbol placed there goes into Simulation\'s layer (layer-panel 16, 20, 21; map-view-2d 44, 47; A17)', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, live, snapshot, open }) => {
    const all = await everyWorkspace(server);
    try {
      const page = await open();
      const centre = await mapCentre(page);
      const aside = { x: centre.x + 80, y: centre.y };
      const free = { x: centre.x - 80, y: centre.y + 50 };
      const [p, q] = [await positionAt(page, centre), await positionAt(page, aside)];
      testInfo.annotations.push({ type: 'positions', description: JSON.stringify({ p, q }) });

      // View: Drawing with a hostile frame at P and one at Q. Simulation: "Ground truth" with a
      // friend frame at P, over the hostile one when the reference is shown.
      const viewDrawing = snapshot.layers.find((l: Layer) => l.name === 'Drawing')!.id as string;
      const truth = await seedLayer(all, 'Ground truth', SIMULATION, 1);
      await seedFrame(all, viewDrawing, p, 'hostile');
      await seedFrame(all, viewDrawing, q, 'hostile');
      const friend = await seedFrame(all, truth.id, p, 'friend');

      // View: its layers only, no reference group; Simulation's frame not drawn.
      expect(await listed(page)).toEqual(['Drawing']);
      await expect(reference(page)).toHaveCount(0);
      await expect.poll(() => colourAround(page, aside, HOSTILE)).toBeGreaterThan(50);
      expect(await colourAround(page, centre, FRIEND)).toBe(0);

      // Simulation: its layers, Ground truth on top of the simulator's first layer "Simulation" (M4,
      // T-101) and active; View's in the reference group, eye off.
      await switchTo(page, 'Simulation');
      await expect.poll(() => listed(page)).toEqual(['Ground truth', 'Simulation']);
      await expect(layers(page).getByRole('button', { name: 'Make Ground truth active' })).toHaveAttribute('aria-pressed', 'true');
      await expect(reference(page).getByRole('listitem')).toHaveCount(1);
      await expect(reference(page).getByRole('listitem')).toContainText('Drawing');
      await expect(reference(page).getByRole('listitem')).toContainText('2 objects');
      // The eye is a toggle pressed while the layer is hidden in this browser.
      await expect(reference(page).getByRole('button', { name: 'Show Drawing' }), 'off at first').toHaveAttribute('aria-pressed', 'true');
      // Read-only: the eye is the row's only control, and a click or a double-click on the row
      // (which make a layer active or rename it in the workspace's own list) changes nothing.
      await expect(reference(page).getByRole('button')).toHaveCount(1);
      const referenceName = reference(page).getByText('Drawing', { exact: true });
      await referenceName.click();
      await referenceName.dblclick();
      await expect(layers(page).getByRole('textbox'), 'no rename').toHaveCount(0);
      await expect(layers(page).getByRole('button', { name: 'Make Ground truth active' }), 'still the active layer').toHaveAttribute('aria-pressed', 'true');
      await expect(reference(page).getByRole('button', { name: 'Show Drawing' }), 'still off').toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => colourAround(page, centre, FRIEND, 6)).toBeGreaterThan(50);
      expect(await colourAround(page, aside, HOSTILE), 'the reference is off').toBe(0);

      // Its count follows a change made elsewhere.
      await seedFrame(live, viewDrawing, [q[0] + 0.5, q[1] - 0.25], 'hostile');
      await expect(reference(page).getByRole('listitem')).toContainText('3 objects');

      // Switched on: drawn, under Simulation's layer.
      await reference(page).getByRole('button', { name: 'Show Drawing' }).click();
      await expect(reference(page).getByRole('button', { name: 'Hide Drawing' })).toHaveAttribute('aria-pressed', 'false');
      await expect.poll(() => colourAround(page, aside, HOSTILE)).toBeGreaterThan(50);
      expect(await colourAround(page, centre, FRIEND, 6), 'Simulation\'s frame on top').toBeGreaterThan(50);
      expect(await colourAround(page, centre, HOSTILE, 6), 'the reference under it').toBe(0);

      // A click selects Simulation's frame but not a reference one (a click on it is a click on the map).
      const properties = page.getByRole('region', { name: 'Symbol properties' });
      await page.mouse.click(centre.x, centre.y);
      await expect(properties.getByText('Select a symbol on the map.')).toHaveCount(0);
      await userPause(page);
      await page.mouse.click(aside.x, aside.y);
      await expect(properties.getByText('Select a symbol on the map.')).toBeVisible();
      await userPause(page);

      // A symbol placed in Simulation goes into its active layer, never into View's.
      await placeSymbols(page, 'Infantry', [free]);
      const placed = await nextEvent(all, (e) => e.entityType === 'object' && e.operation === 'create' && e.entityId !== friend && e.state?.layerId !== viewDrawing);
      expect(placed.state.layerId, 'placed into Simulation\'s layer').toBe(truth.id);
      await expect(layers(page).getByRole('listitem').filter({ hasText: 'Ground truth' })).toContainText('2 objects');
      await expect(reference(page).getByRole('listitem'), 'nothing placed into View\'s').toContainText('3 objects');

      // View: its eye for Drawing was not changed by Simulation's; Simulation's frames not drawn.
      await switchTo(page, 'View');
      await expect(layers(page).getByRole('button', { name: 'Hide Drawing' })).toBeVisible();
      await expect.poll(() => colourAround(page, centre, HOSTILE, 6)).toBeGreaterThan(50);
      expect(await colourAround(page, centre, FRIEND, 6)).toBe(0);
      expect(await colourAround(page, free, FRIEND), 'the placed symbol (Symbols places friend by default)').toBe(0);
      await expect(reference(page)).toHaveCount(0);

      // Back in Simulation: the reference's eye is still on there.
      await switchTo(page, 'Simulation');
      await expect(reference(page).getByRole('button', { name: 'Hide Drawing' })).toBeVisible();
      await expect.poll(() => colourAround(page, aside, HOSTILE)).toBeGreaterThan(50);
    } finally {
      await all.close();
    }
  });
});

type TwoMaps = { inView: Point; viewScale: string; inSimulation: Point; simulationScale: string };

/**
 * Gives View and Simulation maps of their own: View panned, "View two" made active, both
 * remembered; then the first visit to Simulation, which must show View's map; there a zoom, a pan
 * and "Sim B" made active, remembered too. A hostile frame in View and a friend frame in Simulation
 * at the same position (latitude ≠ longitude) show where each map is.
 */
async function twoMaps(page: Page, all: LiveClient, viewDrawing: string): Promise<TwoMaps> {
  const centre = await mapCentre(page);
  const p = await positionAt(page, centre);
  expect(Math.abs(p[0] - p[1]), 'latitude ≠ longitude').toBeGreaterThan(1);
  await seedLayer(all, 'View two', undefined, -1);
  await seedLayer(all, 'Sim A', SIMULATION, 1);
  const simB = await seedLayer(all, 'Sim B', SIMULATION, 0);
  await seedFrame(all, viewDrawing, p, 'hostile');
  await seedFrame(all, simB.id, p, 'friend');
  const saves = watchSaves(page);

  // View: pan, and make "View two" active.
  await expect.poll(() => listed(page)).toEqual(['Drawing', 'View two']);
  let mark = saves.length;
  await drag(page, { x: centre.x + 120, y: centre.y + 90 }, { x: centre.x - 20, y: centre.y + 160 });
  await layers(page).getByRole('button', { name: 'Make View two active' }).click();
  const inView = await drawnAt(page, HOSTILE);
  const viewScale = (await scale(page).textContent())!;
  // OpenLayers starts the pan at the drag's first move, so the frame moves by most of the drag.
  expect(Math.hypot(inView.x - centre.x, inView.y - centre.y), 'View panned').toBeGreaterThan(100);
  await setupSettled(saves, 'View', mark);

  // The first visit to Simulation: View's map, so Simulation's frame at P is where View's was.
  await switchTo(page, 'Simulation');
  expectSamePlace(await drawnAt(page, FRIEND), inView, 'the first visit keeps View\'s map');
  await expect(scale(page)).toHaveText(viewScale);
  await expect(layers(page).getByRole('button', { name: 'Make Sim A active' }), 'the top layer active on the first visit').toHaveAttribute('aria-pressed', 'true');

  // Simulation: zoom in, pan elsewhere, make "Sim B" active.
  mark = saves.length;
  await mapPane(page).getByRole('button', { name: '+', exact: true }).click();
  await expect(scale(page)).not.toHaveText(viewScale);
  const zoomed = await drawnAt(page, FRIEND);
  await drag(page, { x: centre.x - 200, y: centre.y - 120 }, { x: centre.x, y: centre.y - 80 });
  await layers(page).getByRole('button', { name: 'Make Sim B active' }).click();
  const inSimulation = await drawnAt(page, FRIEND);
  const simulationScale = (await scale(page).textContent())!;
  expect(Math.hypot(inSimulation.x - zoomed.x, inSimulation.y - zoomed.y), 'Simulation panned').toBeGreaterThan(100);
  expect(Math.hypot(inSimulation.x - inView.x, inSimulation.y - inView.y), 'elsewhere than View').toBeGreaterThan(50);
  await setupSettled(saves, 'Simulation', mark);
  return { inView, viewScale, inSimulation, simulationScale };
}

async function expectViewMap(page: Page, maps: TwoMaps, what: string): Promise<void> {
  expectSamePlace(await drawnAt(page, HOSTILE), maps.inView, `${what}: View's centre`);
  await expect(scale(page), `${what}: View's zoom`).toHaveText(maps.viewScale);
}

async function expectSimulationMap(page: Page, maps: TwoMaps, what: string): Promise<void> {
  expectSamePlace(await drawnAt(page, FRIEND), maps.inSimulation, `${what}: Simulation's centre`);
  await expect(scale(page), `${what}: Simulation's zoom`).toHaveText(maps.simulationScale);
}

test('each workspace keeps its own centre, zoom and active layer across switches; the first visit to Simulation shows View\'s map (map-view-2d 45, 46)', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, snapshot, open }) => {
    const all = await everyWorkspace(server);
    try {
      const page = await open();
      const maps = await twoMaps(page, all, snapshot.layers.find((l: Layer) => l.name === 'Drawing')!.id as string);
      for (let round = 1; round <= 2; round++) {
        await switchTo(page, 'View');
        await expectViewMap(page, maps, `round ${round}`);
        await expect(layers(page).getByRole('button', { name: 'Make View two active' })).toHaveAttribute('aria-pressed', 'true');
        await switchTo(page, 'Simulation');
        await expectSimulationMap(page, maps, `round ${round}`);
        await expect(layers(page).getByRole('button', { name: 'Make Sim B active' })).toHaveAttribute('aria-pressed', 'true');
      }
    } finally {
      await all.close();
    }
  });
});

test('each workspace\'s map state comes back after a reload into Simulation, also View\'s after a switch (map-view-2d 45)', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, snapshot, open }) => {
    const all = await everyWorkspace(server);
    try {
      const page = await open();
      const maps = await twoMaps(page, all, snapshot.layers.find((l: Layer) => l.name === 'Drawing')!.id as string);
      await page.reload();
      await expect(views(page).getByRole('tab', { name: 'Simulation' })).toHaveAttribute('aria-selected', 'true');
      await expectSimulationMap(page, maps, 'after the reload');
      await switchTo(page, 'View');
      await expectViewMap(page, maps, 'View after the reload and a switch');
    } finally {
      await all.close();
    }
  });
});

test('setups per workspace: Simulation\'s remembered and named setups and View\'s stay apart, after a reload and in a second browser (ADR-0039 point 8)', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const page = await open();
    const saves = watchSaves(page);
    const pane = (name: string) => page.getByRole('complementary', { name });
    const routes = (where = page) => where.getByRole('region', { name: 'Routes', exact: true }).first();
    const openSetups = async () => {
      await page.getByRole('button', { name: 'Setups', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Save current setup as' })).toBeVisible();
    };
    const saveAs = async (name: string) => {
      await page.getByRole('textbox', { name: 'Save current setup as' }).fill(name);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('list', { name: 'Named setups' }).getByRole('button', { name: `Restore ${name}` })).toBeVisible();
    };
    const named = () => page.getByRole('list', { name: 'Named setups' }).getByRole('button', { name: /^Restore / }).allTextContents();

    // Simulation: Routes (left by default from M4, T-108) to the right pane, remembered; saved as "Sim one".
    await switchTo(page, 'Simulation');
    await expect(pane('Left pane').getByRole('region', { name: 'Routes', exact: true }).first()).toBeVisible();
    const mark = saves.length;
    await page.getByRole('button', { name: 'Move Routes to the right pane' }).click();
    await expect(pane('Control Pane').getByRole('region', { name: 'Routes', exact: true }).first()).toBeVisible();
    await setupSettled(saves, 'Simulation', mark);
    await openSetups();
    await expect(page.getByText('No named setups yet.')).toBeVisible();
    await saveAs('Sim one');
    await page.keyboard.press('Escape');

    // View: its own layout and no named setups; "View one" saved there.
    await switchTo(page, 'View');
    await expect(pane('Control Pane').getByRole('region', { name: 'Symbol properties', exact: true })).toBeVisible();
    await expect(pane('Left pane').getByRole('region', { name: 'Symbol properties', exact: true })).toHaveCount(0);
    await openSetups();
    await expect(page.getByText('No named setups yet.')).toBeVisible();
    await saveAs('View one');
    await expect.poll(named).toEqual(['View one']);
    await page.keyboard.press('Escape');

    // Simulation again: Routes still right, only its own named setup; restoring it works there.
    await switchTo(page, 'Simulation');
    await expect(pane('Control Pane').getByRole('region', { name: 'Routes', exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Move Routes to the left pane' }).click();
    await expect(pane('Left pane').getByRole('region', { name: 'Routes', exact: true }).first()).toBeVisible();
    await openSetups();
    await expect.poll(named, { message: 'only Simulation\'s named setups' }).toEqual(['Sim one']);
    const restoredAt = Date.now();
    await page.getByRole('button', { name: 'Restore Sim one' }).click();
    await expect(pane('Control Pane').getByRole('region', { name: 'Routes', exact: true }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    // The restored setup becomes Simulation's remembered one. Read on the server, not waited for as
    // a save: the move to the right and the restore fall in one save interval, so the setup may
    // equal the stored one when the save comes due, and the shell writes no unchanged setup again.
    // The stored setup held "right" before the move, so it counts only once no save of Simulation's
    // has come for 1.5 s after the restore: a save of the move still due would have come by then.
    const simulationSaves = () => saves.filter((s) => s.name === `setup.w.${SIMULATION}.current`);
    await expect.poll(async () => {
      const last = Math.max(restoredAt, ...simulationSaves().map((s) => s.at));
      if (Date.now() - last < 1_500) return 'saves not yet quiet';
      const response = await fetch(`${server.baseUrl}/api/user-documents/core/setup.w.${SIMULATION}.current`);
      if (!response.ok) return `HTTP ${response.status}`;
      const setup = (await response.json()) as { shell?: { layout?: { placed?: Record<string, string> } } };
      const placed = setup.shell?.layout?.placed;
      return placed?.['simulator/routes'] ?? `no place for Routes: ${JSON.stringify(placed)}`;
    }, { timeout: 15_000, message: 'Simulation\'s remembered setup has Routes on the right, its saves quiet' }).toBe('right');

    // A second browser of the user: View as left, Simulation as restored.
    const second = await open();
    await expect(second.getByRole('complementary', { name: 'Control Pane' }).getByRole('region', { name: 'Symbol properties', exact: true })).toBeVisible();
    await expect(routes(second)).toHaveCount(0);
    await switchTo(second, 'Simulation');
    await expect(second.getByRole('complementary', { name: 'Control Pane' }).getByRole('region', { name: 'Routes', exact: true }).first()).toBeVisible();
  });
});
