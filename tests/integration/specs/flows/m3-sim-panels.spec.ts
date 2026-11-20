// Quick run: @plugin-simulator @plugin-map-view-2d @plugin-coordinates @plugin-layer-panel @plugin-draw-symbols @plugin-draw-shapes @plugin-object-list @settings
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/flows/m3-sim-panels.spec.ts
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createLayer, createSymbol, LiveClient } from '../../lib/live.mjs';
import { inverse } from '../../lib/geodesy.mjs';
import { bottomPanel, closeCoordinates, colourAround, coordinates, drag, expectNear, FRIEND, mapCentre, mapPane, nextEvent, pixelsAround, positionAt, userPause, withM0, type LonLat, type Point } from '../../lib/m0';
import type { OwnServer } from '../../lib/own-server';

// The simulator's panels in Simulation (T-086 part 5b; the simulator brief's criteria 2, 5, 6, 7,
// 23, 25 and 26 in the browser; coordinates' criterion 10; the route editor after T-088), without
// login, where the local user has every permission, each test on a server of its own. The rights
// per user (criterion 22) are in specs/keycloak/simulator-rights.spec.ts, the outputs (13, 14) in
// flows/m3-sim-outputs.spec.ts. Distances and positions are checked against the Java SDK's own
// Geodesy (lib/geodesy.mjs), which the simulator moves along.

test.describe.configure({ timeout: 240_000 });

const SIMULATION = 'simulator.simulation';
const KMH = 1000 / 3600;
const KNOT = 1852 / 3600;
const FOOT = 0.3048;

/** A time as the panels show it, h:mm:ss (the simulator's `formatDuration`). */
function duration(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 3600)}:${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

type Event = { entityType: string; entityId: string; operation: string; state: Record<string, any> | null };

/** What the route's extension may hold: only what users type (brief function 4; the ACA's S1). */
const ROUTE_KEYS = ['points', 'groups', 'end', 'edit'];
const POINT_KEYS = ['speedKind', 'speed', 'time', 'altitudeKind', 'altitude', 'events'];

function views(page: Page) {
  return page.getByRole('tablist', { name: 'Views' });
}

async function switchTo(page: Page, name: 'View' | 'Simulation'): Promise<void> {
  await views(page).getByRole('tab', { name, exact: true }).click();
  await expect(views(page).getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name }).getByRole('tab', { name: 'Layers', exact: true })).toBeVisible();
  await bottomPanel(page, 'Layers'); // Simulation's bottom pane may show Objects first (M4, T-108)
}

function routesPanel(page: Page) {
  return page.getByRole('region', { name: 'Routes', exact: true }).first();
}

function editor(page: Page) {
  return page.getByRole('region', { name: 'Route editor', exact: true }).first();
}

/** The editor's one-point pane (T-088), stepped to point `n` with "Next point", which goes round. */
async function point(page: Page, n: number): Promise<Locator> {
  const pane = editor(page).getByRole('region', { name: /^Point \d+$/ });
  for (let i = 0; i < 50; i++) {
    await expect(pane).toHaveCount(1);
    const shown = await pane.getAttribute('aria-label');
    if (shown === `Point ${n}`) return editor(page).getByRole('region', { name: `Point ${n}`, exact: true });
    await pane.getByRole('button', { name: 'Next point', exact: true }).click();
    await expect(pane).not.toHaveAttribute('aria-label', shown!);
  }
  throw new Error(`no point ${n} in the route editor`);
}

/** A Node client that sees every workspace (the local user may), to seed and read Simulation. */
async function everyWorkspace(server: OwnServer): Promise<LiveClient> {
  const client = await LiveClient.open(server.baseUrl);
  await client.subscribe({ workspaces: ['*'] });
  return client;
}

async function applied(client: LiveClient, request: { entityType: string; operation: string }): Promise<Event> {
  const outcome = await client.change(request);
  expect(outcome, `${request.entityType} ${request.operation}`).toMatchObject({ outcome: 'applied' });
  return outcome.event as Event;
}

async function simulator(server: OwnServer, path: string, body?: unknown) {
  const response = await fetch(`${server.baseUrl}/api/plugins/simulator${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  expect(response.status, `${body === undefined ? 'GET' : 'POST'} ${path}: ${text}`).toBe(200);
  return JSON.parse(text);
}

/** Every event of an object so far, in order. */
function routeEvents(client: LiveClient, id: string): Event[] {
  return (client.events as Event[]).filter((e) => e.entityId === id);
}

/** A route as "New route" makes it: every point a step to 30 km/h, an empty altitude, "stop". */
type RouteOptions = { altitude?: number; firstEvents?: unknown[] };

function routeRequest(layerId: string, name: string, coordinates: LonLat[], { altitude, firstEvents = [] }: RouteOptions = {}) {
  const request = createSymbol(layerId, 0, { name }) as any;
  request.data = {
    type: 'core.shape',
    dataType: 'simulator.route',
    dataSource: 'manual',
    layerId,
    geometry: { type: 'LineString', coordinates },
    style: { strokeColor: '#2C784C', strokeWidth: 2, strokeDash: 'dash', pointMarkers: 'circle' },
    properties: { name },
    label: request.data.label,
    extensions: { simulator: { points: coordinates.map((_, i) => ({ speedKind: 'instant', speed: 30 * KMH, altitudeKind: 'instant', ...(altitude === undefined ? {} : { altitude }), events: i === 0 ? firstEvents : [] })), groups: [], end: 'stop' } },
  };
  return request;
}

type Seeded = { layerId: string; routeId: string; pixels: Point[]; coordinates: LonLat[] };

/**
 * A Simulation layer and a route through three points of the map as the page shows it (latitude ≠
 * longitude), seeded through the API; the route's points are where `pixels` are on the map.
 */
async function seedRoute(page: Page, all: LiveClient, options: RouteOptions = {}): Promise<Seeded> {
  const layer = createLayer('Ground truth', { workspace: SIMULATION, drawOrder: 1 });
  await applied(all, layer);
  const centre = await mapCentre(page);
  const pixels: Point[] = [{ x: centre.x - 160, y: centre.y + 70 }, { x: centre.x - 10, y: centre.y - 50 }, { x: centre.x + 150, y: centre.y + 30 }];
  const coordinates: LonLat[] = [];
  for (const p of pixels) coordinates.push(await positionAt(page, p));
  for (const c of coordinates) expect(Math.abs(c[0] - c[1]), 'latitude ≠ longitude').toBeGreaterThan(1);
  const route = routeRequest(layer.entityId, 'Route A', coordinates, options);
  await applied(all, route);
  return { layerId: layer.entityId, routeId: route.entityId, pixels, coordinates };
}

/** APP-6B friendly infantry tracks in the layer, at pixels of the map; resolves with their ids once drawn. */
async function seedTracks(page: Page, all: LiveClient, layerId: string, at: Point[]): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, pixel] of at.entries()) {
    const track = createSymbol(layerId, 0, { name: `TRACK ${i + 1}` }) as any;
    track.data.geometry.coordinates = await positionAt(page, pixel);
    track.data.symbol = { standard: 'APP-6B', sidc: 'SFGPUCI--------' };
    await applied(all, track);
    ids.push(track.entityId);
  }
  for (const pixel of at) await expect.poll(() => colourAround(page, pixel, FRIEND, 12), { message: 'the track drawn' }).toBeGreaterThan(20);
  return ids;
}

/** Selects the symbols at the pixels (a click, then Ctrl+clicks) and chooses "Put on route" for them, single, on the route. */
async function putOnRoute(page: Page, at: Point[], route: string): Promise<void> {
  for (const [i, pixel] of at.entries()) {
    if (i > 0) await page.keyboard.down('Control');
    await page.mouse.click(pixel.x, pixel.y);
    if (i > 0) await page.keyboard.up('Control');
    await userPause(page);
  }
  const last = at[at.length - 1];
  await page.mouse.click(last.x, last.y, { button: 'right' });
  await page.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: 'Put on route' }).click();
  // A dialog over the map's right edge (from M4, A68), no longer a panel.
  const dialog = page.getByRole('dialog', { name: 'Put on route', exact: true });
  await expect(dialog).toContainText(`${at.length} objects chosen.`);
  await dialog.getByRole('combobox', { name: /^Route/ }).selectOption({ label: route });
  await expect(dialog.getByRole('combobox', { name: /^Kind/ })).toHaveValue('single');
  await dialog.getByRole('button', { name: 'Put on route', exact: true }).last().click(); // the last is the dialog's own button
}

type Track = { position: number[]; speed: number | undefined; version: number };

function track(client: LiveClient, id: string): Track {
  const state = latest(client, id);
  return { position: state.geometry.coordinates, speed: state.symbol?.modifiers?.speed, version: state.version };
}

function distanceTo(a: number[], b: number[]): number {
  return inverse([[a, b]])[0].metres;
}

/** Where a position is on the leg from `a` to `b`: its fraction, and how far it is off the geodesic (m). */
function onLeg(position: number[], a: number[], b: number[]): { fraction: number; off: number } {
  const [ap, pb, ab] = inverse([[a, position], [position, b], [a, b]]).map((l: { metres: number }) => l.metres);
  return { fraction: ap / ab, off: ap + pb - ab };
}

/** Opens a route in the editor from the Routes panel. */
async function openRoute(page: Page, name: string): Promise<void> {
  await routesPanel(page).getByRole('button', { name: `Edit ${name}` }).click();
  await expect(editor(page).getByLabel('Name')).toHaveValue(name);
}

/** Types a value into a point's box and commits it with Enter. */
async function typeInto(page: Page, n: number, label: string, text: string): Promise<void> {
  const box = (await point(page, n)).getByLabel(label, { exact: true });
  await box.fill(text);
  await box.press('Enter');
}

/** The newest state of an object, from the events so far. */
function latest(client: LiveClient, id: string): Record<string, any> {
  const found = routeEvents(client, id).filter((e) => e.state !== null);
  return found[found.length - 1].state!;
}

/** Does what a user does, and returns the route's state from the update it brings. */
async function routeUpdateAfter(client: LiveClient, id: string, act: () => Promise<unknown>): Promise<Record<string, any>> {
  const after = latest(client, id).version as number;
  await act();
  const event = await nextEvent(client, (e) => e.entityId === id && e.operation === 'update' && e.state!.version > after);
  return event.state!;
}

/** Simulation's remembered setup on the server. */
async function simulationSetup(server: OwnServer): Promise<Record<string, any> | null> {
  const response = await fetch(`${server.baseUrl}/api/user-documents/core/setup.w.${SIMULATION}.current`);
  return response.ok ? response.json() : null;
}

function expectOnlyTyped(extension: Record<string, any>, what: string): void {
  expect(Object.keys(extension).filter((k) => !ROUTE_KEYS.includes(k)), `${what}: only typed fields in the route`).toEqual([]);
  for (const [i, p] of (extension.points as Record<string, unknown>[]).entries()) {
    expect(Object.keys(p).filter((k) => !POINT_KEYS.includes(k)), `${what}: only typed fields at point ${i + 1}`).toEqual([]);
  }
}

test('criterion 2: "New route" draws a route into Simulation\'s active layer, a dashed simulator.route line with circle markers; it keeps only what was typed, and the editor shows the server\'s lengths for the version shown', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await everyWorkspace(server);
    try {
      const layer = createLayer('Ground truth', { workspace: SIMULATION, drawOrder: 1 });
      await applied(all, layer);
      const page = await open();
      await switchTo(page, 'Simulation');
      await expect(routesPanel(page)).toContainText('No routes in Simulation yet.');

      // Three points, latitude ≠ longitude, read from the cursor display where they are clicked.
      const centre = await mapCentre(page);
      const clicks: Point[] = [{ x: centre.x - 150, y: centre.y + 60 }, { x: centre.x, y: centre.y - 40 }, { x: centre.x + 160, y: centre.y + 20 }];
      const positions: LonLat[] = [];
      for (const c of clicks) positions.push(await positionAt(page, c));
      for (const p of positions) expect(Math.abs(p[0] - p[1]), 'latitude ≠ longitude').toBeGreaterThan(1);

      await routesPanel(page).getByRole('button', { name: 'New route' }).click();
      await expect(editor(page)).toContainText('Draw the route on the map');
      for (const c of clicks) {
        await page.mouse.click(c.x, c.y);
        await userPause(page);
      }
      await page.keyboard.press('Enter');
      const created = await nextEvent(all, (e) => e.entityType === 'object' && e.operation === 'create' && e.state?.dataType === 'simulator.route');
      const route = created.state!;
      testInfo.annotations.push({ type: 'route', description: JSON.stringify(route) });

      // The object: a core.shape of the route's data type, in the active Simulation layer.
      expect(route).toMatchObject({
        type: 'core.shape',
        dataType: 'simulator.route',
        dataSource: 'manual',
        layerId: layer.entityId,
        properties: { name: 'Route 1' },
        style: { strokeDash: 'dash', pointMarkers: 'circle' },
      });
      expect(route.geometry.type).toBe('LineString');
      expect(route.geometry.coordinates).toHaveLength(3);
      for (const [i, p] of positions.entries()) expectNear(route.geometry.coordinates[i], p, 2e-5);
      // Every point a step to 30 km/h with an empty altitude, "stop" at the end (A36).
      const ext = route.extensions.simulator;
      expect(ext.end).toBe('stop');
      expect(ext.points).toHaveLength(3);
      for (const p of ext.points) {
        expect(p.speedKind ?? 'instant').toBe('instant');
        expect(p.speed).toBeCloseTo(30 * KMH, 6);
        expect(p.altitude).toBeUndefined();
      }
      expectOnlyTyped(ext, 'as created');

      // The editor: the server's lengths and arrivals for this version, the SDK's geodesics.
      const served = await simulator(server, `/routes/${created.entityId}`);
      expect(served.version).toBe(route.version);
      const legs = inverse([[route.geometry.coordinates[0], route.geometry.coordinates[1]], [route.geometry.coordinates[1], route.geometry.coordinates[2]]]).map((l: { metres: number }) => l.metres);
      expect(served.points[1].legMetres).toBeCloseTo(legs[0], 2);
      expect(served.points[2].legMetres).toBeCloseTo(legs[1], 2);
      const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
      await expect(await point(page, 2)).toContainText(`leg ${whole.format(legs[0])} m`);
      await expect(await point(page, 3)).toContainText(`leg ${whole.format(legs[1])} m`);
      await expect(routesPanel(page).getByRole('listitem', { name: 'Route 1' })).toContainText('Paused');

      // A typed value is saved as typed; the server never writes derived values into the route.
      await (await point(page, 2)).getByLabel('Speed (km/h)').fill('45');
      await page.keyboard.press('Enter');
      const typed = await nextEvent(all, (e) => e.entityId === created.entityId && e.operation === 'update');
      expect(typed.state!.extensions.simulator.points[1].speed).toBeCloseTo(45 * KMH, 6);
      expectOnlyTyped(typed.state!.extensions.simulator, 'after a typed speed');
      // The arrivals the editor shows are the server's for the version shown.
      await expect.poll(async () => (await simulator(server, `/routes/${created.entityId}`)).version).toBe(typed.state!.version);
      const timed = await simulator(server, `/routes/${created.entityId}`);
      for (const n of [2, 3]) await expect(await point(page, n)).toContainText(`arrives ${duration(timed.points[n - 1].arrivalSeconds)}`);
      await page.waitForTimeout(3_000);
      const updates = routeEvents(all, created.entityId).filter((e) => e.operation === 'update');
      expect(updates.map((e) => e.state!.version), 'no write after the user\'s').toEqual([typed.state!.version]);
      await expect((await point(page, 2)).getByLabel('Speed (km/h)')).toHaveValue('45');
    } finally {
      await all.close();
    }
  });
});

test('criterion 6: the speed and altitude units are each user\'s, shown in every value box and the Routes panel, stored as m/s and metres, kept in this browser (not in the setup), and chosen in the Routes panel or in "All points"', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await everyWorkspace(server);
    try {
      const page = await open();
      await switchTo(page, 'Simulation');
      const { routeId } = await seedRoute(page, all);
      await openRoute(page, 'Route A');
      // The defaults: km/h and metres (A27).
      await expect((await point(page, 1)).getByLabel('Speed (km/h)')).toHaveValue('30');
      await expect((await point(page, 1)).getByLabel('Altitude (m)')).toBeVisible();

      await routesPanel(page).getByLabel('Speed unit').selectOption({ label: 'knots' });
      await routesPanel(page).getByLabel('Altitude unit').selectOption({ label: 'feet' });
      for (const n of [1, 2, 3]) {
        await expect((await point(page, n)).getByLabel('Speed (kn)')).toHaveValue(String(Math.round(((30 * KMH) / KNOT) * 10) / 10));
        await expect((await point(page, n)).getByLabel('Altitude (ft)')).toBeVisible();
      }
      // Typed in the user's units, stored in m/s and metres.
      let state = await routeUpdateAfter(all, routeId, () => typeInto(page, 1, 'Speed (kn)', '20'));
      expect(state.extensions.simulator.points[0].speed).toBeCloseTo(20 * KNOT, 6);
      state = await routeUpdateAfter(all, routeId, () => typeInto(page, 1, 'Altitude (ft)', '1000'));
      expect(state.extensions.simulator.points[0].altitude).toBeCloseTo(1000 * FOOT, 6);
      await expect((await point(page, 1)).getByLabel('Altitude (ft)')).toHaveValue('1000');

      // The Routes panel: length in feet, mean speed in knots, from the server's values.
      await expect.poll(async () => (await simulator(server, `/routes/${routeId}`)).version).toBe(state.version);
      const served = await simulator(server, `/routes/${routeId}`);
      const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
      const oneDecimal = new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      const row = routesPanel(page).getByRole('listitem', { name: 'Route A' });
      await expect(row).toContainText(`${whole.format(served.lengthMetres / FOOT)} ft`);
      await expect(row).toContainText(`mean ${oneDecimal.format(served.lengthMetres / served.durationSeconds / KNOT)} kn`);

      // Kept in this browser per user, not in the setup (from M4, BV, A67): after a reload, in
      // localStorage; a second browser of the same user has the defaults.
      await page.reload();
      await expect(views(page).getByRole('tab', { name: 'Simulation' })).toHaveAttribute('aria-selected', 'true');
      await expect(routesPanel(page).getByLabel('Speed unit')).toHaveValue('kn');
      await expect(routesPanel(page).getByLabel('Altitude unit')).toHaveValue('ft');
      const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('emc2.simulator.units.')).map((k) => JSON.parse(localStorage.getItem(k)!)));
      expect(stored).toEqual([{ speed: 'kn', altitude: 'ft' }]);
      expect((await simulationSetup(server))?.plugins?.simulator?.speed, 'no units in Simulation\'s setup').toBeUndefined();
      const second = await open();
      await switchTo(second, 'Simulation');
      await expect(routesPanel(second).getByLabel('Speed unit')).toHaveValue('kmh');
      await expect(routesPanel(second).getByLabel('Altitude unit')).toHaveValue('m');

      // The same selectors in the route editor's "All points" (A67).
      await openRoute(page, 'Route A');
      const allPoints = editor(page).getByRole('region', { name: 'All points' });
      await allPoints.getByLabel('Speed unit').selectOption({ label: 'm/s' });
      await expect(routesPanel(page).getByLabel('Speed unit')).toHaveValue('mps');
      await expect((await point(page, 1)).getByLabel('Speed (m/s)')).toHaveValue(String(Math.round(20 * KNOT * 10) / 10));
    } finally {
      await all.close();
    }
  });
});

test('criterion 5: a time typed at a ramp point gives its speed rounded to a whole unit of the user\'s speed unit; moving the point keeps the typed time; a time the ramp cannot reach is reported and the route cannot run', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await everyWorkspace(server);
    try {
      const page = await open();
      await switchTo(page, 'Simulation');
      const { routeId, pixels } = await seedRoute(page, all);
      await openRoute(page, 'Route A');
      const v2 = 30 * KMH; // point 2's speed: the ramp into point 3 starts from it
      const leg2 = (state: Record<string, any>) => inverse([[state.geometry.coordinates[1], state.geometry.coordinates[2]]])[0].metres as number;
      /** The speed at point 3 for a ramp that reaches it after `seconds`, rounded to whole km/h, in m/s. */
      const rampSpeed = (metres: number, seconds: number) => Math.round((2 * metres / seconds - v2) / KMH) * KMH;

      // Point 3 a ramp, then a time typed for about 50 km/h at point 3.
      let state = await routeUpdateAfter(all, routeId, async () => (await point(page, 3)).getByLabel('Speed change').selectOption({ label: 'Ramp over the leg into this point' }));
      expect(state.extensions.simulator.points[2].speedKind).toBe('ramp');
      const seconds = Math.round((2 * leg2(state)) / (v2 + 50 * KMH));
      state = await routeUpdateAfter(all, routeId, () => typeInto(page, 3, 'Time (h:mm:ss)', String(seconds)));
      expect(state.extensions.simulator.points[2].time).toEqual({ seconds, from: 'previous', unit: 'kmh' });
      expect(state.extensions.simulator.points[2].speed, 'a typed time removes a ramp point\'s speed').toBeUndefined();
      expectOnlyTyped(state.extensions.simulator, 'with a typed time');
      let expected = rampSpeed(leg2(state), seconds);
      await expect((await point(page, 3)).getByLabel('Speed (km/h)')).toHaveValue(String(Math.round(expected / KMH)));
      await expect(await point(page, 3)).toContainText('computed');
      expect((await simulator(server, `/routes/${routeId}`)).points[2].speed).toBeCloseTo(expected, 6);

      // Point 3 moved on the map: the typed time stays, the speed follows the new leg.
      const shorter = leg2(state);
      await editor(page).getByRole('button', { name: 'Reshape' }).click();
      await expect(editor(page)).toContainText('Drag the route or its points on the map');
      state = await routeUpdateAfter(all, routeId, async () => {
        await drag(page, pixels[2], { x: pixels[2].x + 70, y: pixels[2].y + 60 });
        await page.keyboard.press('Enter');
      });
      expect(leg2(state), 'the leg is longer').toBeGreaterThan(shorter + 100);
      expect(state.extensions.simulator.points[2].time, 'the typed time stays').toEqual({ seconds, from: 'previous', unit: 'kmh' });
      expected = rampSpeed(leg2(state), seconds);
      await expect((await point(page, 3)).getByLabel('Speed (km/h)')).toHaveValue(String(Math.round(expected / KMH)));
      expect((await simulator(server, `/routes/${routeId}`)).points[2].speed).toBeCloseTo(expected, 6);

      // A time the ramp cannot reach: longer than the leg takes at a ramp from point 2's speed down to 0.
      const tooLong = Math.ceil((2 * leg2(state)) / v2) + 120;
      await routeUpdateAfter(all, routeId, () => typeInto(page, 3, 'Time (h:mm:ss)', String(tooLong)));
      await expect(await point(page, 3)).toContainText('so this time cannot be reached');
      const row = routesPanel(page).getByRole('listitem', { name: 'Route A' });
      await expect(row).toContainText('Cannot run:');
      await expect(row).toContainText('Point 3:');
      await expect(row.getByRole('button', { name: 'Start Route A' })).toBeDisabled();
      expect((await simulator(server, `/routes/${routeId}`)).runnable).toBe(false);

      // In knots: a time typed now carries knots, and the speed is rounded to a whole knot.
      await routesPanel(page).getByLabel('Speed unit').selectOption({ label: 'knots' });
      const inKnots = Math.round((2 * leg2(state)) / (v2 + 25 * KNOT));
      state = await routeUpdateAfter(all, routeId, () => typeInto(page, 3, 'Time (h:mm:ss)', String(inKnots)));
      expect(state.extensions.simulator.points[2].time).toEqual({ seconds: inKnots, from: 'previous', unit: 'kn' });
      const knots = Math.round((2 * leg2(state) / inKnots - v2) / KNOT);
      await expect((await point(page, 3)).getByLabel('Speed (kn)')).toHaveValue(String(knots));
      await expect(row).not.toContainText('Cannot run:');
      expect((await simulator(server, `/routes/${routeId}`)).points[2].speed).toBeCloseTo(knots * KNOT, 6);
    } finally {
      await all.close();
    }
  });
});

test('criterion 7: a point moved with "Move them with it" keeps the route\'s objects on the same leg at the same fraction; "Disconnect them" on a running route leaves them in place with speed 0 and their altitude, off the route', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await everyWorkspace(server);
    try {
      const page = await open();
      await switchTo(page, 'Simulation');
      const { layerId, routeId, pixels } = await seedRoute(page, all, { altitude: 500 });
      const centre = await mapCentre(page);
      const at = [{ x: centre.x - 60, y: centre.y + 140 }, { x: centre.x + 60, y: centre.y + 140 }];
      const tracks = await seedTracks(page, all, layerId, at);

      // Both put on the route through the map's menu: at its first point at once.
      await putOnRoute(page, at, 'Route A');
      let route = await nextEvent(all, (e) => e.entityId === routeId && e.state?.extensions?.simulator?.groups?.length === 2);
      expect(route.state!.extensions.simulator.groups.map((g: { kind: string; objects: { id: string }[] }) => [g.kind, g.objects[0].id])).toEqual([['single', tracks[0]], ['single', tracks[1]]]);
      const first = route.state!.geometry.coordinates[0];
      for (const id of tracks) await expect.poll(() => distanceTo(track(all, id).position, first), { message: 'at the first point' }).toBeLessThan(0.5);
      await openRoute(page, 'Route A');
      await expect(editor(page).getByRole('region', { name: 'Objects on the route' })).toContainText('TRACK 1');
      await expect(editor(page).getByRole('region', { name: 'Objects on the route' })).toContainText('TRACK 2');

      // Started, it runs a few ticks, then paused: the tracks stand on the first leg.
      const row = routesPanel(page).getByRole('listitem', { name: 'Route A' });
      await row.getByRole('button', { name: 'Start Route A' }).click();
      await expect(row).toContainText('Running');
      await expect.poll(() => distanceTo(track(all, tracks[0]).position, first), { timeout: 10_000, message: 'moving' }).toBeGreaterThan(20);
      await row.getByRole('button', { name: 'Pause Route A' }).click();
      await expect(row).toContainText('Paused');
      await expect.poll(() => track(all, tracks[0]).speed, { message: 'paused: speed 0' }).toBe(0);
      const old = latest(all, routeId).geometry.coordinates;
      const before = tracks.map((id) => onLeg(track(all, id).position, old[0], old[1]));
      for (const b of before) expect(b.off, 'on the first leg').toBeLessThan(0.5);
      testInfo.annotations.push({ type: 'before the move', description: JSON.stringify(before) });

      // Point 2 moved: the question, "Move them with it": the same leg, the same fraction.
      await editor(page).getByRole('button', { name: 'Reshape' }).click();
      await drag(page, pixels[1], { x: pixels[1].x - 40, y: pixels[1].y - 70 });
      await page.keyboard.press('Enter');
      await expect(editor(page)).toContainText('The route has objects on it.');
      const versions = tracks.map((id) => track(all, id).version);
      await editor(page).getByRole('button', { name: 'Move them with it' }).click();
      route = await nextEvent(all, (e) => e.entityId === routeId && e.operation === 'update' && e.state!.extensions.simulator.edit?.objects === 'move');
      const moved = route.state!.geometry.coordinates;
      expect(distanceTo(moved[1], old[1]), 'point 2 moved').toBeGreaterThan(1_000);
      for (const [i, id] of tracks.entries()) {
        await expect.poll(() => track(all, id).version, { message: `track ${i + 1} placed again` }).toBeGreaterThan(versions[i]);
        const now = onLeg(track(all, id).position, moved[0], moved[1]);
        expect(now.off, `track ${i + 1} on the new first leg`).toBeLessThan(0.5);
        expect(now.fraction, `track ${i + 1} at the same fraction`).toBeCloseTo(before[i].fraction, 6);
      }

      // Running again, point 3 moved with "Disconnect them": in place, speed 0, the altitude kept.
      await row.getByRole('button', { name: 'Start Route A' }).click();
      await expect(row).toContainText('Running');
      const running = track(all, tracks[0]).version;
      await expect.poll(() => track(all, tracks[0]).version, { timeout: 10_000, message: 'moving again' }).toBeGreaterThan(running + 1);
      expect(track(all, tracks[0]).position[2], 'the route\'s altitude').toBeCloseTo(500, 3);
      await editor(page).getByRole('button', { name: 'Reshape' }).click();
      await drag(page, pixels[2], { x: pixels[2].x + 30, y: pixels[2].y - 80 });
      await page.keyboard.press('Enter');
      await expect(editor(page)).toContainText('The route has objects on it.');
      await editor(page).getByRole('button', { name: 'Disconnect them' }).click();
      route = await nextEvent(all, (e) => e.entityId === routeId && e.operation === 'update' && e.state!.extensions.simulator.edit?.objects === 'disconnect' && (e.state!.extensions.simulator.groups ?? []).length === 0);
      for (const [i, id] of tracks.entries()) await expect.poll(() => track(all, id).speed, { message: `track ${i + 1} stopped` }).toBe(0);
      const stopped = tracks.map((id) => track(all, id));
      await page.waitForTimeout(3_000);
      for (const [i, id] of tracks.entries()) {
        const now = track(all, id);
        expect(now.version, `track ${i + 1} not moved after the disconnect`).toBe(stopped[i].version);
        expect(onLeg(now.position, moved[0], moved[1]).off, `track ${i + 1} where it was, on the first leg`).toBeLessThan(0.5);
        expect(now.position[2], `track ${i + 1} keeps its altitude`).toBeCloseTo(500, 3);
      }
      await expect(editor(page).getByRole('region', { name: 'Objects on the route' })).toContainText('None.');
      await expect(row).toContainText('0 objects');
    } finally {
      await all.close();
    }
  });
});

/** A colour drawn at `opacity` over a background (map-view-2d draws faded objects at 0.4). */
function blend(colour: readonly number[], background: readonly number[], opacity: number): number[] {
  return colour.map((c, i) => Math.round(opacity * c + (1 - opacity) * background[i]));
}

test('criterion 26: with everything paused and a track hidden by an event, a switch to View and back shows the hidden track faded again within 1 s', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await everyWorkspace(server);
    try {
      const page = await open();
      await switchTo(page, 'Simulation');
      // A "hide" event at the first point: it fires as the track leaves it (the README's A13).
      const { layerId, routeId, pixels } = await seedRoute(page, all, { firstEvents: [{ kind: 'hide' }] });
      const centre = await mapCentre(page);
      const [hidden] = await seedTracks(page, all, layerId, [{ x: centre.x + 40, y: centre.y + 150 }]);
      await simulator(server, '/put-on-route', { route: routeId, kind: 'single', objects: [hidden] });
      await simulator(server, '/routes/start', {});
      await nextEvent(all, (e) => e.entityId === hidden && e.state?.extensions?.simulator?.hidden === true);
      await simulator(server, '/routes/pause', {});
      await expect(routesPanel(page)).toContainText('Everything is paused.');

      // Faded where it stopped, just past the first point: the friend fill at 40 % over the map.
      const at = pixels[0];
      const map = (await pixelsAround(page, { x: at.x, y: at.y - 60 }, 2)).pixel(1, 1).slice(0, 3);
      const fadedFill = blend(FRIEND, map, 0.4);
      testInfo.annotations.push({ type: 'colours', description: JSON.stringify({ map, fadedFill }) });
      const look = async () => ({ faded: await colourAround(page, at, fadedFill, 20), plain: await colourAround(page, at, FRIEND, 20) });
      // One poll for both: drawn faded (more than 20 pixels) and not plain. A poll for "not plain" alone also passed while
      // nothing was drawn there yet, and a single read after it could then still find nothing (full run on 2132fca2).
      await expect
        .poll(async () => { const l = await look(); return l.faded > 20 && l.plain === 0 ? 'faded' : JSON.stringify(l); }, { timeout: 10_000, message: 'the hidden track is drawn faded in Simulation' })
        .toBe('faded');

      await switchTo(page, 'View');
      expect((await look()).faded, 'Simulation\'s track is not in View').toBeLessThan(20);
      // Back in Simulation: sampled from the click on, faded again within 1 s, and it stays so.
      const clicked = Date.now();
      await views(page).getByRole('tab', { name: 'Simulation', exact: true }).click();
      const samples: { ms: number; faded: number; plain: number }[] = [];
      while (Date.now() - clicked < 2_000) samples.push({ ms: Date.now() - clicked, ...(await look()) });
      testInfo.annotations.push({ type: 'samples after the switch back', description: JSON.stringify(samples) });
      const first = samples.find((s) => s.faded > 20 && s.plain === 0);
      expect(first, `drawn faded after the switch: ${JSON.stringify(samples)}`).toBeDefined();
      expect(first!.ms, `faded again within 1 s of the switch: ${JSON.stringify(samples)}`).toBeLessThanOrEqual(1_000);
      for (const s of samples.filter((s) => s.ms >= first!.ms)) expect(s, 'stays faded').toMatchObject({ plain: 0 });
    } finally {
      await all.close();
    }
  });
});

/**
 * In the page: what in a panel is wider than the panel, and which text is below a contrast of
 * 4.5:1 (WCAG 2 AA) against what is drawn behind it: an element's own text and a form control's
 * value (`text`), or the placeholders of empty form controls (`placeholders`). Text of a
 * switched-off control is left out, as WCAG leaves out inactive components.
 */
function panelProblems(panel: Element, part: 'text' | 'placeholders'): string[] {
  const problems: string[] = [];
  const box = panel.getBoundingClientRect();
  const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number) as number[];
  const luminance = ([r, g, b]: number[]) => {
    const l = [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  };
  /** The colour behind an element: its own and its ancestors' backgrounds, laid over each other. */
  const behind = (el: Element | null): number[] => {
    const layers: number[][] = [];
    for (let e = el; e !== null; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      const alpha = c.length > 3 ? c[3] : 1;
      if (alpha > 0) layers.push([c[0], c[1], c[2], alpha]);
      if (alpha >= 1) break;
    }
    let colour = [255, 255, 255];
    for (const [r, g, b, a] of layers.reverse()) colour = [r * a + colour[0] * (1 - a), g * a + colour[1] * (1 - a), b * a + colour[2] * (1 - a)];
    return colour;
  };
  const name = (el: Element) => `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ')[0]}` : ''} "${((el as HTMLInputElement).value || (el as HTMLInputElement).placeholder || el.textContent || '').trim().slice(0, 30)}"`;
  for (const el of panel.querySelectorAll('*')) {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0 || el.closest('option, select') !== null && el.tagName !== 'SELECT') continue;
    if (part === 'text' && (rect.left < box.left - 1 || rect.right > box.right + 1)) problems.push(`wider than the panel: ${name(el)} ${Math.round(rect.left)}..${Math.round(rect.right)} in ${Math.round(box.left)}..${Math.round(box.right)}`);
    // Text: an element's own text nodes; a form control's value, or its placeholder while empty.
    const control = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
    const value = control ? (el as HTMLInputElement).value : '';
    const placeholder = control && value === '' ? ((el as HTMLInputElement).placeholder ?? '') : '';
    const text = part === 'placeholders' ? placeholder.trim() !== '' : control ? value.trim() !== '' : [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
    if (!text || el.closest(':disabled, [aria-disabled="true"]') !== null) continue;
    if (control && el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) continue;
    const fg = parse(placeholder !== '' ? getComputedStyle(el, '::placeholder').color : style.color);
    const bg = behind(el);
    const colour = fg.length > 3 && fg[3] < 1 ? [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])) : fg;
    const [hi, lo] = [luminance(colour), luminance(bg)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    if (ratio < 4.5) problems.push(`contrast ${ratio.toFixed(2)}: ${name(el)}`);
  }
  return problems;
}

/** Chooses in the top bar's Look control (m2-looks.spec.ts): the look, light or dark, the density, each by its value. */
async function chooseLook(page: Page, scheme: 'light' | 'dark', density: 'compact' | 'comfortable'): Promise<void> {
  await page.locator('header.top-bar').getByRole('button', { name: 'Look', exact: true }).click();
  const popover = page.getByRole('dialog', { name: 'Look' });
  await popover.getByRole('combobox').nth(1).selectOption(scheme);
  await popover.getByRole('combobox').nth(2).selectOption(density);
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-density', density);
}

/**
 * Opens the six panels (Routes, Ground truth outputs, Sensors, Route editor, Event, Put on route) and checks them in the
 * built-in look, light and dark, compact and comfortable (owner, 2026-10-29, Q6). Resolves with the
 * problems found, by look and panel.
 */
async function lookProblems(page: Page, all: LiveClient, part: 'text' | 'placeholders'): Promise<Record<string, string[]>> {
  await switchTo(page, 'Simulation');
  const { layerId } = await seedRoute(page, all);
  const centre = await mapCentre(page);
  const at = { x: centre.x + 60, y: centre.y + 160 };
  await seedTracks(page, all, layerId, [at]);
  await openRoute(page, 'Route A');
  await (await point(page, 1)).getByRole('button', { name: 'Add event at point 1' }).click();
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: 'Put on route' }).click();
  const names = ['Routes', 'Ground truth outputs', 'Sensors', 'Route editor', 'Event', 'Put on route'];
  for (const name of names) await expect(page.getByRole('region', { name, exact: true }).first(), `${name} open`).toBeVisible();
  const found: Record<string, string[]> = {};
  for (const scheme of ['light', 'dark'] as const) {
    for (const density of ['compact', 'comfortable'] as const) {
      await chooseLook(page, scheme, density);
      for (const name of names) {
        const panel = page.getByRole('region', { name, exact: true }).first();
        await panel.scrollIntoViewIfNeeded();
        const problems = await panel.evaluate(panelProblems, part);
        if (problems.length > 0) found[`${scheme}, ${density}, ${name}`] = problems;
      }
    }
  }
  return found;
}

test('criterion 23: the six panels (Routes, Ground truth outputs, Sensors, Route editor, Event, Put on route), light and dark, compact and comfortable: nothing wider than its panel, and no text or value below a contrast of 4.5:1', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await everyWorkspace(server);
    try {
      expect(await lookProblems(await open(), all, 'text'), 'the panels in the built-in look').toEqual({});
    } finally {
      await all.close();
    }
  });
});

test('criterion 23, placeholders: the placeholders of the empty boxes in the six panels, light and dark, compact and comfortable, have a contrast of 4.5:1 at least', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await everyWorkspace(server);
    try {
      expect(await lookProblems(await open(), all, 'placeholders'), 'the placeholders in the built-in look').toEqual({});
    } finally {
      await all.close();
    }
  });
});

test('coordinates 10: in Simulation the cursor display shows positions, and "Go to" centres Simulation\'s map (latitude ≠ longitude), not View\'s', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ open }) => {
    const page = await open();
    const centre = await mapCentre(page);
    const viewCentre = await positionAt(page, centre);
    await switchTo(page, 'Simulation');
    // The cursor display: a point 100 px east is east of the centre, at the same latitude.
    const here = await positionAt(page, centre);
    const east = await positionAt(page, { x: centre.x + 100, y: centre.y });
    expect(east[0]).toBeGreaterThan(here[0]);
    expect(east[1]).toBeCloseTo(here[1], 5);

    const panel = await coordinates(page);
    await panel.getByRole('textbox').fill('57.708900° N 11.974600° E'); // Gothenburg: latitude ≠ longitude
    await panel.getByRole('button', { name: 'Go' }).click();
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await closeCoordinates(page);
    await expect.poll(async () => {
      const [lon, lat] = await positionAt(page, centre);
      return Math.abs(lon - 11.9746) < 0.05 && Math.abs(lat - 57.7089) < 0.025;
    }, { timeout: 10_000, message: 'Simulation\'s map centred on Gothenburg' }).toBe(true);

    // View's map is where it was (its share is restored once the switch has its fresh snapshots).
    await switchTo(page, 'View');
    await expect.poll(async () => {
      const [lon, lat] = await positionAt(page, centre);
      return Math.abs(lon - viewCentre[0]) < 2e-5 && Math.abs(lat - viewCentre[1]) < 2e-5;
    }, { timeout: 10_000, message: `View's map still at ${JSON.stringify(viewCentre)}` }).toBe(true);
  });
});

/** An object's stored state as the content of an update by a user's client (another plugin's namespaces forwarded as they are). */
function updateOf(state: Record<string, any>, data: Record<string, unknown>) {
  const content = ['type', 'dataType', 'dataSource', 'layerId', 'geometry', 'symbol', 'style', 'properties', 'label', 'time', 'details', 'extensions'];
  return {
    requestId: crypto.randomUUID(),
    entityType: 'object',
    operation: 'update',
    entityId: state.id,
    baseVersion: state.version,
    data: { ...Object.fromEntries(content.filter((k) => state[k] !== undefined).map((k) => [k, state[k]])), ...data },
    source: { plugin: 'ita-test' },
  };
}

function deleteOf(state: Record<string, any>) {
  return { requestId: crypto.randomUUID(), entityType: 'object', operation: 'delete', entityId: state.id, baseVersion: state.version, source: { plugin: 'ita-test' } };
}

/** The map view's selection, through the test probe. */
function selection(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window as unknown as { __itaProbe: { mapView: { selection: { value: readonly string[] } } } }).__itaProbe.mapView.selection.value].sort());
}

/** Clicks the point at a user's pace until the map view selects the object there. */
async function selectAt(page: Page, id: string, at: Point): Promise<void> {
  await expect.poll(async () => {
    await page.mouse.click(at.x, at.y);
    await userPause(page);
    return selection(page);
  }, { timeout: 15_000, intervals: [0], message: `${id} selected by a click` }).toEqual([id]);
}

/** Waits until the drag of the object under the point is armed: the map view's move cursor (m3-drag.spec.ts). */
async function armedAt(page: Page, at: Point): Promise<void> {
  const map = mapPane(page).locator('.ol-viewport');
  let side = 1;
  await expect.poll(async () => {
    side = -side;
    await page.mouse.move(at.x + side, at.y);
    await page.mouse.move(at.x, at.y);
    return map.evaluate((e) => (e as HTMLElement).style.cursor);
  }, { timeout: 15_000, message: 'the drag armed (the move cursor)' }).toBe('move');
}

const middle = (a: Point, b: Point): Point => ({ x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) });

test('criterion 25: a track deleted during a run leaves its route; a track moved on a running route goes back onto it; a deleted route disconnects its objects; a route over 2 000 m/s cannot run and says why, in any unit; edits by other plugins: a drag in draw-shapes moves the objects with the route, a point added without its entry pauses it, a data type changed in draw-shapes disconnects them, a move out of Simulation is refused', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, snapshot, open }) => {
    const all = await everyWorkspace(server);
    try {
      const page = await open();
      await switchTo(page, 'Simulation');
      const { layerId, routeId: a, coordinates } = await seedRoute(page, all);
      const centre = await mapCentre(page);
      const [t1, t2, t3] = await seedTracks(page, all, layerId, [{ x: centre.x - 120, y: centre.y + 160 }, { x: centre.x, y: centre.y + 160 }, { x: centre.x + 120, y: centre.y + 160 }]);
      const rowOf = (name: string) => routesPanel(page).getByRole('listitem', { name });

      // Route A running with T1 and T2. T1 deleted: taken off the route's list.
      await simulator(server, '/put-on-route', { route: a, kind: 'single', objects: [t1, t2] });
      await rowOf('Route A').getByRole('button', { name: 'Start Route A' }).click();
      await expect(rowOf('Route A')).toContainText('Running');
      await expect.poll(() => distanceTo(track(all, t2).position, coordinates[0]), { timeout: 10_000, message: 'moving' }).toBeGreaterThan(10);
      await applied(all, deleteOf(latest(all, t1)));
      await nextEvent(all, (e) => e.entityId === a && e.operation === 'update' && JSON.stringify(e.state!.extensions.simulator.groups).includes(t2) && !JSON.stringify(e.state!.extensions.simulator.groups).includes(t1));
      await expect(rowOf('Route A')).toContainText('1 object');

      // T2 moved by a user while the route runs: the route wins at the next tick (open question 11).
      const draggedTo = [coordinates[0][0] + 0.3, coordinates[0][1] - 0.2];
      const dragged = await applied(all, updateOf(latest(all, t2), { geometry: { type: 'Point', coordinates: draggedTo } }));
      await expect.poll(() => track(all, t2).version, { timeout: 5_000, message: 'moved again by the route' }).toBeGreaterThan(dragged.state!.version);
      expect(onLeg(track(all, t2).position, coordinates[0], coordinates[1]).off, 'back on the first leg').toBeLessThan(0.5);

      // Route A deleted: T2 disconnected, in place with speed 0.
      await applied(all, deleteOf(latest(all, a)));
      await expect.poll(() => track(all, t2).speed, { message: 'T2 stopped' }).toBe(0);
      const stopped = track(all, t2).version;
      await page.waitForTimeout(2_500);
      expect(track(all, t2).version, 'T2 not moved after its route went').toBe(stopped);
      await expect(rowOf('Route A')).toHaveCount(0);

      // Route C with 2 001 m/s at point 2: cannot run, says why, and the server refuses a start.
      const c = routeRequest(layerId, 'Route C', coordinates.map((p) => [p[0], p[1] - 0.5] as LonLat));
      c.data.extensions.simulator.points[1].speed = 2_001;
      await applied(all, c);
      await expect(rowOf('Route C')).toContainText('Cannot run:');
      await expect(rowOf('Route C')).toContainText('Point 2:');
      await expect(rowOf('Route C').getByRole('button', { name: 'Start Route C' })).toBeDisabled();
      const startOf = (id: string) => fetch(`${server.baseUrl}/api/plugins/simulator/routes/${id}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect((await startOf(c.entityId)).status, 'a start of a route that cannot run').toBe(409);
      // Route D with an altitude of 30 001 m at point 1: the same.
      const d = routeRequest(layerId, 'Route D', coordinates.map((p) => [p[0], p[1] - 0.8] as LonLat));
      d.data.extensions.simulator.points[0].altitude = 30_001;
      await applied(all, d);
      await expect(rowOf('Route D')).toContainText('Cannot run:');
      await expect(rowOf('Route D')).toContainText('Point 1:');
      await expect(rowOf('Route D').getByRole('button', { name: 'Start Route D' })).toBeDisabled();
      expect((await startOf(d.entityId)).status, 'a start of a route too high').toBe(409);
      // The editor refuses a speed over 2 000 m/s and an altitude outside −1 000 to 30 000 m in each unit shown, and sends nothing.
      await openRoute(page, 'Route C');
      const cVersion = latest(all, c.entityId).version;
      const limit = (value: number) => String(Math.round(value * 10) / 10);
      for (const [unit, label, factor] of [['m/s', 'm/s', 1], ['km/h', 'km/h', KMH], ['knots', 'kn', KNOT], ['mph', 'mph', 1609.344 / 3600]] as const) {
        await routesPanel(page).getByLabel('Speed unit').selectOption({ label: unit });
        await typeInto(page, 1, `Speed (${label})`, String(Math.ceil(2_000 / factor) + 10));
        await expect(await point(page, 1)).toContainText(`A speed must be from 0 to ${limit(2_000 / factor)} ${label}`);
      }
      for (const [unit, label, factor, typed] of [['metres', 'm', 1, '30001'], ['feet', 'ft', FOOT, '-3290']] as const) {
        await routesPanel(page).getByLabel('Altitude unit').selectOption({ label: unit });
        await typeInto(page, 1, `Altitude (${label})`, typed);
        await expect(await point(page, 1)).toContainText(`An altitude must be from ${limit(-1_000 / factor)} to ${limit(30_000 / factor)} ${label}`);
      }
      await page.waitForTimeout(1_500);
      expect(latest(all, c.entityId).version, 'nothing sent').toBe(cVersion);
      await editor(page).getByRole('button', { name: 'Close the route editor' }).click();

      // Route B with T3, drawn wide enough to grab: runs a little, paused, then dragged in draw-shapes.
      const bPixels = [{ x: centre.x - 200, y: centre.y - 120 }, { x: centre.x - 40, y: centre.y - 160 }, { x: centre.x + 140, y: centre.y - 110 }];
      const bPoints: LonLat[] = [];
      for (const p of bPixels) bPoints.push(await positionAt(page, p));
      const b = routeRequest(layerId, 'Route B', bPoints);
      b.data.style.strokeWidth = 6;
      await applied(all, b);
      await simulator(server, '/put-on-route', { route: b.entityId, kind: 'single', objects: [t3] });
      await rowOf('Route B').getByRole('button', { name: 'Start Route B' }).click();
      await expect.poll(() => distanceTo(track(all, t3).position, bPoints[0]), { timeout: 10_000, message: 'T3 moving' }).toBeGreaterThan(10);
      await rowOf('Route B').getByRole('button', { name: 'Pause Route B' }).click();
      await expect.poll(() => track(all, t3).speed, { message: 'T3 paused' }).toBe(0);
      // Settled: under load a write from just before the pause can still arrive after it (the MCA's full run,
      // 2026-11-14: the fraction 1.7e-5 off), so T3's place is read once it has not changed for 1 s.
      let still = '';
      await expect.poll(() => { const now = JSON.stringify([track(all, t3).version, track(all, t3).position]); const same = now === still; still = now; return same; }, { timeout: 10_000, intervals: [1_000], message: 'T3 still' }).toBe(true);
      const before = onLeg(track(all, t3).position, bPoints[0], bPoints[1]);
      const press = middle(bPixels[1], bPixels[2]);
      await selectAt(page, b.entityId, press);
      await armedAt(page, press);
      const t3Version = track(all, t3).version;
      await drag(page, press, { x: press.x + 50, y: press.y + 40 });
      const draggedRoute = await nextEvent(all, (e) => e.entityId === b.entityId && e.operation === 'update' && e.state!.geometry.coordinates[0][0] !== bPoints[0][0]);
      const bMoved = draggedRoute.state!.geometry.coordinates;
      expect(draggedRoute.state!.extensions.simulator.edit, 'no move-or-disconnect choice from draw-shapes').toBeUndefined();
      await expect.poll(() => track(all, t3).version, { message: 'T3 placed again with the route' }).toBeGreaterThan(t3Version);
      const after = onLeg(track(all, t3).position, bMoved[0], bMoved[1]);
      expect(after.off, 'T3 on the moved first leg').toBeLessThan(0.5);
      expect(after.fraction, 'T3 at the same fraction').toBeCloseTo(before.fraction, 6);
      await page.keyboard.press('Escape');

      // A point added by another client without its entry, while B runs: B pauses and says why.
      await rowOf('Route B').getByRole('button', { name: 'Start Route B' }).click();
      await expect(rowOf('Route B')).toContainText('Running');
      const bState = latest(all, b.entityId);
      const longer = [...bState.geometry.coordinates, [bState.geometry.coordinates[2][0] + 0.2, bState.geometry.coordinates[2][1] + 0.1]];
      await applied(all, updateOf(bState, { geometry: { type: 'LineString', coordinates: longer } }));
      await expect(rowOf('Route B')).toContainText('Paused');
      await expect(rowOf('Route B')).toContainText('the route has 4 points but values for 3');
      await expect.poll(() => track(all, t3).speed, { message: 'T3 stands' }).toBe(0);
      await applied(all, updateOf(latest(all, b.entityId), { geometry: bState.geometry }));
      await expect(rowOf('Route B')).not.toContainText('Cannot run:');

      // A move into View's layer is refused: an object stays in its workspace (ADR-0039).
      const view = snapshot.layers.find((l: { name: string }) => l.name === 'Drawing')!.id as string;
      const refused = await all.change(updateOf(latest(all, b.entityId), { layerId: view }));
      expect(refused, 'a route moved out of Simulation').toMatchObject({ outcome: 'rejected', rejection: { code: 'VALIDATION_FAILED' } });
      expect(JSON.stringify(refused)).toContain('an object stays in its workspace');

      // A route's menu has no draw-shapes "Edit" (M4, T-114: draw-shapes' criterion 32), only the
      // simulator's "Edit route".
      await page.mouse.click(press.x + 50, press.y + 40, { button: 'right' });
      const menu = page.getByRole('menu', { name: 'Actions' });
      await expect(menu.getByRole('menuitem', { name: 'Edit route', exact: true })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Edit', exact: true })).toHaveCount(0);
      await page.keyboard.press('Escape');

      // The data type changed by another client: no longer a route, its objects disconnected.
      await applied(all, updateOf(latest(all, b.entityId), { dataType: 'core.general' }));
      await expect(rowOf('Route B')).toHaveCount(0);
      expect((await simulator(server, '/routes')).routes.map((r: { name: string }) => r.name).sort()).toEqual(['Route C', 'Route D']);
      const t3Groups = JSON.stringify(latest(all, b.entityId).extensions?.simulator?.groups ?? []);
      testInfo.annotations.push({ type: 'route B\'s groups after the data type change', description: t3Groups });
      const t3After = track(all, t3).version;
      await page.waitForTimeout(2_500);
      expect(track(all, t3).version, 'T3 disconnected: not moved again').toBe(t3After);
      expect(track(all, t3).speed).toBe(0);
    } finally {
      await all.close();
    }
  }, { probe: true });
});

test('T-088: the editor shows one point, "Point n of m", and its arrows go round; "Copy from previous point" is disabled on point 1 and copies on point 2; "All points" sends nothing on Cancel and sets every point in one update after the confirmation; the route colour recolours every route, seen in a second browser', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await everyWorkspace(server);
    try {
      const page = await open();
      const other = await open();
      await switchTo(page, 'Simulation');
      await switchTo(other, 'Simulation');
      const { layerId, routeId, pixels } = await seedRoute(page, all);
      const lower = pixels.map((p) => ({ x: p.x, y: p.y + 120 }));
      const bCoordinates: LonLat[] = [];
      for (const p of lower) bCoordinates.push(await positionAt(page, p));
      const b = routeRequest(layerId, 'Route B', bCoordinates);
      await applied(all, b);
      await openRoute(page, 'Route A');

      // One point at a time; the arrows go round.
      const pane = editor(page).getByRole('region', { name: /^Point \d+$/ });
      await expect(pane).toHaveCount(1);
      await expect(pane).toContainText('Point 1 of 3');
      await pane.getByRole('button', { name: 'Previous point', exact: true }).click();
      await expect(pane).toContainText('Point 3 of 3');
      await pane.getByRole('button', { name: 'Next point', exact: true }).click();
      await expect(pane).toContainText('Point 1 of 3');

      // Copy: disabled on point 1; on point 2 it copies point 1's speed.
      await expect(pane.getByRole('button', { name: 'Copy from previous point' })).toBeDisabled();
      await routeUpdateAfter(all, routeId, () => typeInto(page, 1, 'Speed (km/h)', '60'));
      let state = await routeUpdateAfter(all, routeId, async () => (await point(page, 2)).getByRole('button', { name: 'Copy from previous point' }).click());
      expect(state.extensions.simulator.points[1].speed).toBeCloseTo(60 * KMH, 6);

      // All points: Cancel sends nothing; confirmed, one update sets every point.
      const allPoints = editor(page).getByRole('region', { name: 'All points', exact: true });
      await allPoints.getByLabel('Speed (km/h)', { exact: true }).fill('45');
      await allPoints.getByLabel('Altitude (m)', { exact: true }).fill('120');
      await allPoints.getByRole('button', { name: 'Set on all points' }).click();
      const dialog = page.getByRole('alertdialog', { name: 'Change all points' });
      await expect(dialog).toContainText('All 3 points of Route A will be changed.');
      const before = latest(all, routeId).version as number;
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden();
      await page.waitForTimeout(1_000);
      expect(latest(all, routeId).version, 'nothing sent on Cancel').toBe(before);
      state = await routeUpdateAfter(all, routeId, async () => {
        await allPoints.getByRole('button', { name: 'Set on all points' }).click();
        await dialog.getByRole('button', { name: 'Change all 3 points' }).click();
      });
      for (const p of state.extensions.simulator.points) {
        expect(p.speed).toBeCloseTo(45 * KMH, 6);
        expect(p.altitude).toBeCloseTo(120, 6);
      }
      await page.waitForTimeout(1_500);
      expect(routeEvents(all, routeId).filter((e) => e.operation === 'update' && e.state!.version > before), 'one update').toHaveLength(1);

      // The route colour: every route gets it, and the second browser shows it in its panel and on its map.
      const magenta = [0xd0, 0x1a, 0x8a];
      const colourBox = routesPanel(page).getByLabel('Route colour', { exact: true });
      await expect(colourBox).toHaveValue('#2c784c');
      await colourBox.fill('#d01a8a');
      await colourBox.press('Enter');
      for (const id of [routeId, b.entityId]) {
        await nextEvent(all, (e) => e.entityId === id && e.operation === 'update' && e.state!.style?.strokeColor?.toLowerCase() === '#d01a8a');
      }
      await expect(routesPanel(other).getByLabel('Route colour', { exact: true })).toHaveValue('#d01a8a');
      for (const [p, q] of [[pixels[0], pixels[1]], [lower[0], lower[1]]]) {
        await expect.poll(() => colourAround(other, middle(p, q), magenta), { timeout: 10_000, message: 'the route drawn in the new colour' }).toBeGreaterThan(5);
      }
    } finally {
      await all.close();
    }
  });
});
