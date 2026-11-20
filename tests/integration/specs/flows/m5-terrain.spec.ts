// Quick run: @plugin-terrain @plugin-map-view-2d @plugin-coordinates @settings
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/flows/m5-terrain.spec.ts
import { existsSync } from 'node:fs';
import { externalMissing, externalPath } from '../../lib/external.mjs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { inverse } from '../../lib/geodesy.mjs';
import { closeCoordinates, coordinates, mapCentre, mapPane, pixelsAround, positionAt, userPause, visibleMap, withM0, type LonLat, type Point } from '../../lib/m0';
import type { OwnServer } from '../../lib/own-server';

// The terrain plugin in the combined system (docs/plugins/briefs/terrain.md, T-142, ADR-0049; owner
// LZ, 2026-11-09): range and bearing, which needs no height data; the 503 while the height folder
// is not set; a viewshed with the ESA's DTED (external/terrain/README.md on main: Stockholm and
// Sundsvall in one `dted` folder, levels 0 to 2, twelve cells). The plugin reads that folder only
// through ECore's LocalFolder; the tests only name it in the plugin's settings. The reader, the
// line of sight and the tracing are the plugin's unit tests (criteria 3 to 9). Positions are
// [lon, lat], latitude ≠ longitude; each test has a server of its own.

test.describe.configure({ timeout: 240_000 });

/** The ESA's DTED folder, as the sheet names it, below EMC2_EXTERNAL_ROOT. */
const DTED = externalPath('terrain', 'dted');
const STOCKHOLM: LonLat = [18.0686, 59.3293];
const UPPSALA: LonLat = [17.6389, 59.8586];
/** Sundsvall's check point in the sheet: 136 m, in the west cell's neighbour e017. */
const SUNDSVALL: LonLat = [17.3, 62.4];

type Answer = { status: number; body: any };

async function terrain(server: OwnServer, path: string, body?: unknown): Promise<Answer> {
  const response = await fetch(`${server.baseUrl}/api/plugins/terrain${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

async function ok(server: OwnServer, path: string, body?: unknown): Promise<any> {
  const answer = await terrain(server, path, body);
  expect(answer.status, `${path}: ${JSON.stringify(answer.body)}`).toBe(200);
  return answer.body;
}

/** Sets terrain's settings (the others as they are). */
async function setTerrain(server: OwnServer, values: Record<string, unknown>): Promise<void> {
  const url = `${server.baseUrl}/api/settings/plugins/terrain`;
  const current = (await (await fetch(url)).json()).values;
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...current, ...values }) });
  expect(response.status, `terrain settings: ${await response.clone().text()}`).toBe(200);
}

/** terrain's entry in the Monitor, as text. */
async function monitorText(server: OwnServer): Promise<string> {
  const monitor = await (await fetch(`${server.baseUrl}/api/monitor`)).json();
  return JSON.stringify((monitor.plugins as Array<{ id: string }>).find((p) => p.id === 'terrain') ?? null);
}

function viewshed(observer: LonLat, maxRange = 10_000, heights: { observerHeight?: number; targetHeight?: number } = {}) {
  return { observer, observerHeight: heights.observerHeight ?? 2, targetHeight: heights.targetHeight ?? 2, maxRange };
}

/** Every ring closed, every position [lon, lat] inside the box. */
function checkAreas(areas: number[][][][], box: { west: number; south: number; east: number; north: number }): void {
  expect(areas.length, 'some visible ground').toBeGreaterThan(0);
  for (const polygon of areas) {
    for (const ring of polygon) {
      expect(ring.length, 'a ring has at least four positions').toBeGreaterThanOrEqual(4);
      expect(ring.at(-1), 'closed').toEqual(ring[0]);
      for (const [lon, lat] of ring) {
        expect(lon >= box.west && lon <= box.east && lat >= box.south && lat <= box.north, `[${lon}, ${lat}] in lon, lat order inside the box`).toBe(true);
      }
    }
  }
}

/** "045.2°": three digits before the point, one after. */
function bearing(degrees: number): string {
  const tenths = Math.round((((degrees % 360) + 360) % 360) * 10) / 10;
  return `${tenths.toFixed(1).padStart(5, '0')}°`;
}

/** Below 1 000 m in m, else in km with two decimals. */
function distanceText(metres: number): RegExp {
  return metres < 1000 ? new RegExp(`^${Math.round(metres)} m$`) : new RegExp(`^${(metres / 1000).toFixed(2).replace('.', '\\.')} km$`);
}

function panel(page: Page) {
  return page.getByRole('region', { name: 'Terrain', exact: true }).last();
}

/** A value of a result list, by its term. */
function row(list: Locator, term: string) {
  return list.locator('dt', { hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::dd[1]');
}

/** Centres the map on a position with the coordinates dialog's "Go to" (DD). */
async function goTo(page: Page, at: LonLat): Promise<void> {
  const dialog = await coordinates(page);
  const field = dialog.getByLabel('Go to', { exact: true });
  await field.fill(`${at[1].toFixed(6)}° N ${at[0].toFixed(6)}° E`);
  await field.press('Enter');
  await closeCoordinates(page);
  await expect.poll(async () => {
    const [lon, lat] = await positionAt(page, await mapCentre(page));
    return Math.abs(lon - at[0]) < 0.01 && Math.abs(lat - at[1]) < 0.01;
  }, { timeout: 10_000, message: `the map centred on ${at}` }).toBe(true);
}

/** Zooms until the visible map's half width is between `metres` and four times that. */
async function zoomToSee(page: Page, metres: number): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const box = await visibleMap(page);
    const centre = await positionAt(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    const edge = await positionAt(page, { x: box.x + box.width / 2 + Math.min(box.width, box.height) / 2 - 8, y: box.y + box.height / 2 });
    const half = inverse([[centre, edge]])[0].metres;
    if (half >= metres && half <= 4 * metres) return;
    await mapPane(page).getByTitle(half < metres ? 'Zoom out' : 'Zoom in').click();
    await userPause(page);
  }
  throw new Error(`the map does not come to ${metres} m`);
}

/** How many pixels of the visible map's middle square differ from `before` by more than 40 in some channel. */
async function changedPixels(page: Page, before: Awaited<ReturnType<typeof pixelsAround>>, centre: Point, half: number): Promise<number> {
  const now = await pixelsAround(page, centre, half);
  let count = 0;
  for (let y = 0; y < now.height; y++) {
    for (let x = 0; x < now.width; x++) {
      const a = now.pixel(x, y);
      const b = before.pixel(x, y);
      if (Math.abs(a[0] - b[0]) > 40 || Math.abs(a[1] - b[1]) > 40 || Math.abs(a[2] - b[2]) > 40) count++;
    }
  }
  return count;
}

test('range and bearing without height data (criteria 1, 2 and 12): Stockholm to Uppsala as the geodesy gives it; refused values are 400; while the folder is not set the status and the Monitor say so and a viewshed is refused with 503; in the browser two picked points give the four values and a line, and Clear removes it', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    // From M7 the default is %emcc%/settings/terrain (T-157, function 12), which a release ships empty and
    // lib/server.mjs makes in each test server's emcc folder (owner SB A): ready, no cells. Emptied, it is not set.
    await expect.poll(async () => (await ok(server, '/status')).state, { message: 'the default folder, empty' }).toBe('ready');
    expect(await ok(server, '/status'), 'no cells').toMatchObject({ cells: 0 });
    expect(await monitorText(server)).toContain('Height data: 0 cells');
    await setTerrain(server, { heightDataFolder: '' });
    // Not set: the status, the Monitor, the 503 (brief function 9; README "Refusals").
    await expect.poll(async () => (await ok(server, '/status')).state, { message: 'no folder once emptied' }).toBe('notSet');
    const status = await ok(server, '/status');
    expect(status).toMatchObject({ state: 'notSet', cells: 0 });
    expect(await monitorText(server)).toContain('Height folder not set');
    const refused = await terrain(server, '/viewshed', viewshed(SUNDSVALL));
    expect(refused.status, JSON.stringify(refused.body)).toBe(503);
    expect(refused.body.error).toContain('the height folder is not set');

    // Range (criterion 1), with the folder not set.
    const range = await ok(server, '/range', { from: STOCKHOLM, to: UPPSALA });
    const [geodesic] = inverse([[STOCKHOLM, UPPSALA]]);
    expect(Math.abs(range.distance - geodesic.metres), `distance ${range.distance} m against ${geodesic.metres} m`).toBeLessThan(0.001);
    expect(Math.abs(range.initialBearing - geodesic.initialAzimuth), 'initial bearing').toBeLessThan(1e-6);
    expect(Math.abs(range.finalBearing - (((geodesic.finalAzimuth % 360) + 360) % 360)), 'final bearing').toBeLessThan(1e-6);
    expect(Math.abs(range.backBearing - (((range.finalBearing + 180) % 360) + 360) % 360), 'back bearing').toBeLessThan(1e-9);
    expect(range.initialBearing > 300 && range.initialBearing < 360, 'Uppsala lies north-north-west: the positions are read lon, lat').toBe(true);
    const back = await ok(server, '/range', { from: UPPSALA, to: STOCKHOLM });
    expect(Math.abs(back.distance - range.distance), 'the same distance back').toBeLessThan(0.001);

    // Values refused with their reason (criterion 12).
    for (const [what, body] of [
      ['a latitude out of range', { from: [18.0, 91.0], to: UPPSALA }],
      ['a longitude out of range', { from: [181.0, 59.0], to: UPPSALA }],
      ['a position that is not two numbers', { from: [18.0], to: UPPSALA }],
    ] as const) {
      const answer = await terrain(server, '/range', body);
      expect(answer.status, `${what}: ${JSON.stringify(answer.body)}`).toBe(400);
      expect(typeof answer.body?.error, `${what}: a reason`).toBe('string');
    }

    // In the browser (criterion 2): the viewshed tool says there is no data; two points picked give the four values and a line.
    const page = await open();
    const terrainPanel = panel(page);
    await expect(terrainPanel, 'the Terrain panel').toBeVisible();
    const pickObserver = terrainPanel.getByRole('button', { name: 'Pick the observer', exact: true });
    await expect(pickObserver, 'no viewshed without data').toBeDisabled();
    await expect(pickObserver).toHaveAttribute('title', 'There is no height data.');
    const box = await visibleMap(page);
    const from: Point = { x: Math.round(box.x + box.width * 0.3), y: Math.round(box.y + box.height * 0.65) };
    const to: Point = { x: Math.round(box.x + box.width * 0.7), y: Math.round(box.y + box.height * 0.35) };
    const fromAt = await positionAt(page, from);
    const toAt = await positionAt(page, to);
    expect(Math.abs(fromAt[0] - fromAt[1]), 'latitude ≠ longitude').toBeGreaterThan(1);
    const centre = { x: Math.round((from.x + to.x) / 2), y: Math.round((from.y + to.y) / 2) };
    const half = Math.round(Math.min(box.width, box.height) * 0.3);
    const before = await pixelsAround(page, centre, half);
    await terrainPanel.getByRole('button', { name: 'Pick two points', exact: true }).click();
    await expect(terrainPanel).toContainText('Click the first point on the map.');
    await page.mouse.click(from.x, from.y);
    await expect(terrainPanel).toContainText('Click the second point.');
    await page.mouse.click(to.x, to.y);
    const result = terrainPanel.getByLabel('Range and bearing result');
    await expect(result).toBeVisible({ timeout: 10_000 });
    const [picked] = inverse([[fromAt, toAt]]);
    const list = result;
    await expect(row(list, 'Distance')).toHaveText(distanceText(picked.metres));
    // The picked point is where the click was; the cursor display rounds to 6 decimals, so compare to 0.1°.
    const initialShown = Number((await row(list, 'Initial bearing').textContent())!.replace('°', ''));
    expect(Math.abs(initialShown - picked.initialAzimuth), `initial bearing ${initialShown} against ${bearing(picked.initialAzimuth)}`).toBeLessThan(0.15);
    await expect(row(list, 'Initial bearing')).toHaveText(/^\d{3}\.\d°$/);
    await expect(row(list, 'Final bearing')).toHaveText(/^\d{3}\.\d°$/);
    const finalShown = Number((await row(list, 'Final bearing').textContent())!.replace('°', ''));
    await expect(row(list, 'Back bearing')).toHaveText(bearing(finalShown + 180));
    await expect.poll(() => changedPixels(page, before, centre, half), { timeout: 10_000, message: 'the line, the end marks and the label are drawn' }).toBeGreaterThan(100);
    await page.keyboard.press('Escape');
    await terrainPanel.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(result, 'the result goes').toHaveCount(0);
    await expect.poll(() => changedPixels(page, before, centre, half), { timeout: 10_000, message: 'Clear removes the line' }).toBeLessThan(20);
  });
});

test('a viewshed with the ESA\'s DTED (Sundsvall and Stockholm; criteria 5, 9, 12, 13 and 14\'s combined-system part): the index holds the twelve cells; a viewshed at Sundsvall uses level 2 and gives closed lon, lat rings; across 17.0 E and 18.0 E it reads both cells; at the area\'s edge it is partly without data; a small maxCells gives level 1 and says so; in the browser the green areas show and Clear removes them; the folder emptied gives the 503 again, and set again works', async ({ browser }, testInfo) => {
  test.skip(!existsSync(DTED), `${externalMissing("the ESA's terrain data", DTED)} (external/terrain/README.md)`);
  await withM0(testInfo, browser, async ({ server, open }) => {
    await setTerrain(server, { heightDataFolder: DTED });
    await expect.poll(async () => (await ok(server, '/status')).state, { timeout: 30_000, message: 'the index is built' }).toBe('ready');
    const status = await ok(server, '/status');
    expect(status, 'Stockholm and Sundsvall, levels 0 to 2').toMatchObject({ cells: 12, levels: { '2': 4, '1': 4, '0': 4 }, skipped: 0 });
    expect(status.area, 'the area: 16 to 19 E, 59 to 63 N').toMatchObject({ west: 16, south: 59, east: 19, north: 63 });
    expect(await monitorText(server)).toContain('Height data: 12 cells (level 2: 4, level 1: 4, level 0: 4)');

    // Sundsvall, inside the east cell e017: level 2, one cell, closed rings in lon, lat order.
    const sundsvall = await ok(server, '/viewshed', viewshed(SUNDSVALL));
    testInfo.annotations.push({ type: 'Sundsvall viewshed', description: JSON.stringify({ ...sundsvall, areas: sundsvall.areas.length }) });
    expect(sundsvall).toMatchObject({ level: 2, cells: 1, partlyWithoutData: false });
    checkAreas(sundsvall.areas, { west: 17.0, south: 62.3, east: 17.5, north: 62.5 });
    // Higher eyes see more: 100 m above the ground against 2 m.
    const higher = await ok(server, '/viewshed', viewshed(SUNDSVALL, 10_000, { observerHeight: 100 }));
    const positions = (r: { areas: number[][][][] }) => r.areas.flat(2).length;
    testInfo.annotations.push({ type: 'positions at 2 m and 100 m', description: `${positions(sundsvall)} and ${positions(higher)}` });
    expect(higher.level).toBe(2);

    // Across the cells' joins (criterion 14: the join of two cells).
    const acrossSundsvall = await ok(server, '/viewshed', viewshed([17.02, 62.41], 5_000));
    expect(acrossSundsvall, 'e016 and e017').toMatchObject({ level: 2, cells: 2, partlyWithoutData: false });
    checkAreas(acrossSundsvall.areas, { west: 16.9, south: 62.36, east: 17.12, north: 62.46 });
    const acrossStockholm = await ok(server, '/viewshed', viewshed([18.02, 59.33], 5_000));
    expect(acrossStockholm, 'e017 and e018 at Stockholm').toMatchObject({ level: 2, cells: 2, partlyWithoutData: false });
    checkAreas(acrossStockholm.areas, { west: 17.9, south: 59.28, east: 18.12, north: 59.38 });

    // At the edge of the data: 63.0 N has no cell beyond (criterion 13).
    const edge = await ok(server, '/viewshed', viewshed([17.3, 62.97], 10_000));
    expect(edge.partlyWithoutData, 'partly without data at 63 N').toBe(true);
    for (const [, lat] of edge.areas.flat(2) as LonLat[]) expect(lat, 'nothing shown visible beyond the data').toBeLessThanOrEqual(63.0 + 1e-9);

    // Refused values (criterion 12).
    for (const [what, body] of [
      ['a negative observer height', viewshed(SUNDSVALL, 10_000, { observerHeight: -1 })],
      ['a range over maxRange', viewshed(SUNDSVALL, 60_000)],
      ['a latitude out of range', viewshed([17.3, 95], 10_000)],
    ] as const) {
      const answer = await terrain(server, '/viewshed', body);
      expect(answer.status, `${what}: ${JSON.stringify(answer.body)}`).toBe(400);
      expect(typeof answer.body?.error, `${what}: a reason`).toBe('string');
    }
    const outside = await terrain(server, '/viewshed', viewshed([10.5, 50.5], 10_000));
    expect(outside.status, `no data at the observer: ${JSON.stringify(outside.body)}`).toBe(404);

    // A small cap: level 2 needs too many height cells, level 1 fits, and the answer says so (criterion 5).
    await setTerrain(server, { maxCells: 100_000 });
    const capped = await ok(server, '/viewshed', viewshed(SUNDSVALL));
    testInfo.annotations.push({ type: 'capped notes', description: JSON.stringify(capped.notes) });
    expect(capped.level, 'the next coarser level that fits').toBe(1);
    expect(capped.notes.join(' '), 'the answer says so').toMatch(/level/i);
    await setTerrain(server, { maxCells: 10_000_000 });

    // In the browser: the viewshed from the map centre at Sundsvall, its areas drawn, Clear removes them.
    const page = await open();
    await goTo(page, SUNDSVALL);
    await zoomToSee(page, 10_000);
    const terrainPanel = panel(page);
    await expect(terrainPanel.getByLabel('Observer height above ground (m)')).toHaveValue('2');
    await expect(terrainPanel.getByLabel('Target height above ground (m)')).toHaveValue('2');
    await expect(terrainPanel.getByLabel('Maximum range (m)')).toHaveValue('10000');
    const box = await visibleMap(page);
    const centre = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    // A square round the observer that keeps clear of the pointer position and the scale bar, which change on their own.
    const half = Math.floor(Math.min(box.width, box.height) / 2) - 80;
    const before = await pixelsAround(page, centre, half);
    const observer = await positionAt(page, centre);
    const pick = terrainPanel.getByRole('button', { name: 'Pick the observer', exact: true });
    await expect(pick, 'data: the tool is on').toBeEnabled();
    await pick.click();
    await expect(terrainPanel).toContainText('Click the observer\'s point on the map.');
    await page.mouse.click(centre.x, centre.y);
    const result = terrainPanel.getByLabel('Viewshed result');
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(row(result, 'Data')).toHaveText(/^DTED level 2, [12] cells? read$/);
    const expected = await ok(server, '/viewshed', viewshed(observer));
    await expect(row(result, 'Areas')).toHaveText(String(expected.areas.length));
    await expect(terrainPanel, 'not at the edge').not.toContainText('Partly without data');
    const drawn = await changedPixels(page, before, centre, half);
    testInfo.annotations.push({ type: 'viewshed pixels changed', description: String(drawn) });
    expect(drawn, 'the green areas, the observer and the range circle').toBeGreaterThan(2_000);
    await page.screenshot({ path: testInfo.outputPath('viewshed.png') });
    await terrainPanel.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(result, 'the result goes').toHaveCount(0);
    await expect.poll(() => changedPixels(page, before, centre, half), { timeout: 10_000, message: 'Clear removes the areas' }).toBeLessThan(50);

    // The folder emptied: not set, the 503, the tool off; set again: the index is back.
    await setTerrain(server, { heightDataFolder: '' });
    await expect.poll(async () => (await ok(server, '/status')).state, { timeout: 15_000 }).toBe('notSet');
    expect((await terrain(server, '/viewshed', viewshed(SUNDSVALL))).status, 'the 503 again').toBe(503);
    await expect(pick, 'the tool follows the status').toBeDisabled({ timeout: 15_000 });
    await setTerrain(server, { heightDataFolder: DTED });
    await expect.poll(async () => (await ok(server, '/status')).cells, { timeout: 30_000, message: 'indexed again' }).toBe(12);
    expect((await ok(server, '/viewshed', viewshed(SUNDSVALL))).level).toBe(2);
  });
});
