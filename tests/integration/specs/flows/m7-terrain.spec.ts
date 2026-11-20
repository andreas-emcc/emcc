// Quick run: @plugin-terrain @plugin-map-view-2d @settings
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { externalMissing, externalPath } from '../../lib/external.mjs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { drag, mapCentre, pixelsAround, visibleMap, withM0, type LonLat, type Point } from '../../lib/m0';
import type { OwnServer } from '../../lib/own-server';

// The terrain plugin's M7 in the combined system (docs/plugins/briefs/terrain.md, functions 10 and
// 12; criteria 18 and 20; T-166, T-157; SDK 1.6.0 part H, sdk-v1.md "Part H"):
// - the height map in a circle on the ESA's Sundsvall DTED (external/terrain/README.md: its `dted`
//   folder is named in the plugin's setting, nothing else is read): 16 bands and the legend, the
//   highest ground's height in metres ("412 m"), its white cross 16 px at every zoom (owner, RV C),
//   and Clear;
// - the height folder's default `%emcc%/settings/terrain`, resolved below the emcc folder (the
//   server's working directory: lib/server.mjs gives each test server one, with the empty
//   `settings/terrain/` a release ships, owner SB A), shown in the Monitor as typed and resolved,
//   OK with "Height data: 0 cells" (SC A); the ESA's two Sundsvall level 0 cells (18 KB each)
//   copied into it are found after a restart; `%emcc%/../elsewhere` gives "outside the emcc
//   folder"; an absolute path works as before.
// The map is placed with the ITA's probe (MapView.goTo at a known resolution). Positions [lon, lat].

test.describe.configure({ timeout: 240_000 });

/** The ESA's DTED folder, as the sheet names it, below EMC2_EXTERNAL_ROOT. */
const DTED = externalPath('terrain', 'dted');
/** Criterion 18's place, near Sundsvall (the east cell e017). */
const NEAR_SUNDSVALL: LonLat = [17.31, 62.39];
const RADIUS = 10_000;
/** Metres per pixel while drawing: the 10 km radius is 250 px. */
const DRAW_RESOLUTION = 40;
const EMCC_DEFAULT = '%emcc%/settings/terrain';

type ProbeView = { goTo(c: LonLat, r: number): void; viewport: { resolution: number } };

async function goTo(page: Page, center: LonLat, resolution: number): Promise<void> {
  await page.evaluate(([c, r]) => (window as unknown as { __itaProbe: { mapView: ProbeView } }).__itaProbe.mapView.goTo(c, r), [center, resolution] as const);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __itaProbe: { mapView: ProbeView } }).__itaProbe.mapView.viewport.resolution), { message: `the map at ${resolution} m per pixel` })
    .toBeCloseTo(resolution, 1);
}

async function terrain(server: OwnServer, path: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`${server.baseUrl}/api/plugins/terrain${path}`);
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

async function settingsOf(server: OwnServer): Promise<Record<string, unknown>> {
  return (await (await fetch(`${server.baseUrl}/api/settings/plugins/terrain`)).json()).values;
}

async function setTerrain(server: OwnServer, values: Record<string, unknown>): Promise<void> {
  const url = `${server.baseUrl}/api/settings/plugins/terrain`;
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(await settingsOf(server)), ...values }) });
  expect(response.status, `terrain settings: ${await response.clone().text()}`).toBe(200);
}

type MonitorFolder = { id: string; path: string | null; resolved?: string | null; state: string; setting: string };
type MonitorPlugin = { id: string; name: string; state: string; detail: string; folders: MonitorFolder[] };

async function monitorTerrain(server: OwnServer): Promise<MonitorPlugin> {
  const monitor = await (await fetch(`${server.baseUrl}/api/monitor`)).json();
  return (monitor.plugins as MonitorPlugin[]).find((p) => p.id === 'terrain')!;
}

function panel(page: Page) {
  return page.getByRole('region', { name: 'Terrain', exact: true }).last();
}

/** A value of the height map's result list, by its term. */
function result(page: Page, term: string) {
  return panel(page).getByLabel('Height map result').locator('dt', { hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::dd[1]');
}

const isWhite = (p: number[]) => p[0]! >= 225 && p[1]! >= 225 && p[2]! >= 225;
/**
 * The cross's pixels whether white or seen through a band: a band (50 % of a hue with one channel 0)
 * over the map keeps one channel below about 110, white under or over it keeps every channel above 125.
 */
const isLight = (p: number[]) => Math.min(p[0]!, p[1]!, p[2]!) >= 118;

function longestRun(cells: boolean[]): number {
  let best = 0;
  let now = 0;
  for (const white of cells) {
    now = white ? now + 1 : 0;
    best = Math.max(best, now);
  }
  return best;
}

/**
 * The white cross's arms through a point: the longest run of white pixels along the two rows and
 * the two columns nearest it (each arm 16 px long and 2 px thick, so the stroke straddles the point;
 * antialiased ends may add or lose a pixel). The label sits above the cross with a gap.
 */
async function crossArms(page: Page, at: Point): Promise<{ across: number; down: number; white: number }> {
  const half = 20;
  const image = await pixelsAround(page, at, half);
  const rows = [half - 1, half].map((y) => longestRun(Array.from({ length: image.width }, (_, x) => isLight(image.pixel(x, y)))));
  const cols = [half - 1, half].map((x) => longestRun(Array.from({ length: image.height }, (_, y) => isLight(image.pixel(x, y)))));
  let white = 0;
  for (let y = half - 9; y <= half + 9; y++) for (let x = half - 9; x <= half + 9; x++) if (isWhite(image.pixel(x, y))) white++;
  return { across: Math.max(...rows), down: Math.max(...cols), white };
}

/** White pixels in the band above the cross, where the label is. */
async function labelPixels(page: Page, at: Point): Promise<number> {
  const image = await pixelsAround(page, { x: at.x, y: at.y - 22 }, 14);
  let count = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (isWhite(image.pixel(x, y))) count++;
  return count;
}

test('the height map near Sundsvall (criterion 18; T-166, owner RV C): a 10 km circle drawn on the map gives 16 bands and the legend, the highest ground\'s height in metres as label and in the panel, a white 16 px cross there before and after a zoom in and out; Clear removes it', async ({ browser }, testInfo) => {
  test.skip(!existsSync(DTED), `${externalMissing("the ESA's terrain data", DTED)} (external/terrain/README.md)`);
  await withM0(testInfo, browser, async ({ server, open }) => {
    await setTerrain(server, { heightDataFolder: DTED });
    await expect.poll(async () => (await terrain(server, '/status')).body?.state, { timeout: 30_000, message: 'the index is built' }).toBe('ready');

    const page = await open();
    await goTo(page, NEAR_SUNDSVALL, DRAW_RESOLUTION);
    const terrainPanel = panel(page);
    await expect(terrainPanel).toBeVisible();
    const box = await visibleMap(page);
    const centre = await mapCentre(page);
    expect(centre.x - 250, 'the radius fits in the visible map').toBeGreaterThan(box.x + 10);
    const draw = terrainPanel.getByRole('button', { name: 'Draw a circle', exact: true });
    await expect(draw, 'data: the tool is on').toBeEnabled({ timeout: 15_000 });
    await expect(terrainPanel).toContainText('A circle of 100 m to 50 km. The height is above mean sea level.');
    await draw.click();
    await expect(terrainPanel).toContainText('Press on the centre and drag to the radius. Escape cancels.');
    const answer = page.waitForResponse((r) => r.url().endsWith('/api/plugins/terrain/heightmap') && r.request().method() === 'POST', { timeout: 60_000 });
    await drag(page, centre, { x: centre.x - 250, y: centre.y });
    const response = await answer;
    expect(response.status(), 'the height map').toBe(200);
    const sent = response.request().postDataJSON() as { center: LonLat; radius: number };
    const map = await response.json();
    testInfo.annotations.push({
      type: 'height map',
      description: JSON.stringify({ sent, bands: map.bands.length, highest: map.highest, lowest: map.lowest, level: map.level, cells: map.cells, millis: map.millis, partlyWithoutData: map.partlyWithoutData }),
    });
    expect(Math.abs(sent.center[0] - NEAR_SUNDSVALL[0]), 'the centre\'s longitude').toBeLessThan(0.002);
    expect(Math.abs(sent.center[1] - NEAR_SUNDSVALL[1]), 'the centre\'s latitude').toBeLessThan(0.001);
    expect(Math.abs(sent.radius - RADIUS) / RADIUS, `a radius of about 10 km: ${sent.radius} m`).toBeLessThan(0.03);
    expect(map.bands.map((b: { index: number }) => b.index), '16 equal bands, lowest first').toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(map.partlyWithoutData, 'inside the data').toBe(false);
    const highestHeight = map.highest.height as number;
    const highestPosition = map.highest.position as LonLat;
    const step = (highestHeight - map.lowest) / 16;
    for (const [i, band] of (map.bands as Array<{ lowest: number; highest: number }>).entries()) {
      expect(band.lowest, `band ${i}'s lowest`).toBeCloseTo(map.lowest + i * step, 0);
      expect(band.highest, `band ${i}'s highest`).toBeCloseTo(map.lowest + (i + 1) * step, 0);
    }
    const [lon, lat] = highestPosition;
    expect(Math.hypot((lon - sent.center[0]) * Math.cos((lat * Math.PI) / 180), lat - sent.center[1]) * 111_320, 'the highest point inside the circle').toBeLessThanOrEqual(sent.radius * 1.01);

    // The panel: highest and lowest as "412 m", the 16-step legend.
    const metres = (h: number) => `${Math.round(h)} m`;
    await expect(result(page, 'Highest')).toHaveText(metres(highestHeight));
    await expect(result(page, 'Lowest')).toHaveText(metres(map.lowest));
    await expect(result(page, 'Data')).toHaveText(`DTED level ${map.level}, ${map.cells} ${map.cells === 1 ? 'cell' : 'cells'} read`);
    await expect(terrainPanel.locator('.terrain-legend-step'), 'a 16-step legend').toHaveCount(16);
    await expect(terrainPanel.getByRole('img', { name: `Height bands from ${metres(map.lowest)} to ${metres(map.bands[15].highest)}`, exact: true })).toBeVisible();
    await expect(terrainPanel).not.toContainText('Partly without data');

    // The cross on the highest ground, 16 px at every zoom; the label above it.
    for (const resolution of [DRAW_RESOLUTION, DRAW_RESOLUTION / 4, DRAW_RESOLUTION * 2]) {
      await goTo(page, highestPosition, resolution);
      await expect.poll(async () => {
        const arms = await crossArms(page, centre);
        return arms.across >= 14 && arms.across <= 19 && arms.down >= 14 && arms.down <= 19;
      }, { timeout: 10_000, message: `a 16 px cross at ${resolution} m per pixel: ${JSON.stringify(await crossArms(page, centre))}` }).toBe(true);
      const arms = await crossArms(page, centre);
      const label = await labelPixels(page, centre);
      testInfo.annotations.push({ type: `cross at ${resolution} m/px`, description: `${arms.across} px across, ${arms.down} px down, ${arms.white} white; label ${label} white px; centre pixel ${JSON.stringify((await pixelsAround(page, centre, 1)).pixel(1, 1))}` });
      // White (function 10), over the bands: not seen through them.
      expect.soft(arms.white, `the cross white at ${resolution} m per pixel`).toBeGreaterThan(20);
      expect.soft(label, `the label white at ${resolution} m per pixel`).toBeGreaterThan(15);
    }
    await page.screenshot({ path: testInfo.outputPath('height-map.png') });

    // The bands are saturated hues at half opacity; the map under them is not (the fake tiles, Natural Earth).
    const banded = async () => {
      const image = await pixelsAround(page, centre, 40);
      let count = 0;
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        const [r, g, b] = image.pixel(x, y);
        if (Math.max(r!, g!, b!) - Math.min(r!, g!, b!) >= 120) count++;
      }
      return count;
    };
    expect(await banded(), 'the bands before Clear').toBeGreaterThan(1_000);
    await terrainPanel.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(terrainPanel.getByLabel('Height map result'), 'the result goes').toHaveCount(0);
    await expect.poll(banded, { timeout: 10_000, message: 'Clear removes the bands and the cross' }).toBe(0);
  }, { probe: true });
});

test('the height folder\'s default (criterion 20, T-157; SDK 1.6.0 part H; owner SB A and SC A): a fresh install has %emcc%/settings/terrain, shown in the Monitor as typed and resolved below the emcc folder, empty and readable: OK with "Height data: 0 cells"; cells put there are found; %emcc%/../elsewhere is "outside the emcc folder" in the plugin\'s status and the Monitor; an absolute path works as before', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server: first, open, restart }) => {
    let server = first;
    expect((await settingsOf(server)).heightDataFolder, 'the default').toBe(EMCC_DEFAULT);
    const resolved = join(server.emccFolder, 'settings', 'terrain');
    expect(existsSync(resolved), `the empty folder at ${resolved}, as a release ships it`).toBe(true);
    await expect.poll(async () => (await monitorTerrain(server)).folders.find((f) => f.id === 'heights')?.state, { timeout: 15_000, message: 'checked' }).toBe('READABLE');
    const heights = (await monitorTerrain(server)).folders.find((f) => f.id === 'heights')!;
    expect(heights, 'as typed, and the folder it resolves to').toMatchObject({ setting: '/heightDataFolder', path: EMCC_DEFAULT, resolved });
    await expect.poll(async () => (await terrain(server, '/status')).body?.state, { timeout: 15_000, message: 'indexed' }).toBe('ready');
    expect((await terrain(server, '/status')).body, 'no cells').toMatchObject({ cells: 0 });
    await expect.poll(async () => (await monitorTerrain(server)).detail, { message: 'the plugin\'s status' }).toContain('Height data: 0 cells');
    expect((await monitorTerrain(server)).state, 'an empty, readable folder is OK (SC A)').toBe('OK');
    testInfo.annotations.push({ type: 'default, empty', description: JSON.stringify(await monitorTerrain(server)) });

    // Cells in it are found (criterion 20): the ESA's Sundsvall level 0 cells, copied into this test server's own folder.
    if (existsSync(DTED)) {
      for (const cell of [['e016', 'n62.dt0'], ['e017', 'n62.dt0']]) {
        mkdirSync(join(resolved, cell[0]), { recursive: true });
        copyFileSync(join(DTED, ...cell), join(resolved, ...cell));
      }
      ({ server } = await restart());
      await expect.poll(async () => (await terrain(server, '/status')).body?.cells, { timeout: 30_000, message: 'the two cells under %emcc%' }).toBe(2);
      expect((await settingsOf(server)).heightDataFolder, 'the setting unchanged').toBe(EMCC_DEFAULT);
      await expect.poll(async () => (await monitorTerrain(server)).detail).toContain('Height data: 2 cells (level 2: 0, level 1: 0, level 0: 2)');
    } else {
      testInfo.annotations.push({ type: 'skipped part', description: `cells under %emcc%: ${externalMissing("the ESA's terrain data", DTED)}` });
    }

    // In the Monitor workspace: the folder row shows the setting as typed and → the folder.
    const page = await open();
    await page.goto('/#monitor');
    const plugins = page.getByRole('table', { name: 'Plugins' });
    await plugins.getByRole('button', { name: 'Terrain', exact: true }).click();
    const folders = page.getByRole('table', { name: 'Terrain: local folders', exact: true });
    const heightsRow = folders.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /^heights/ }) });
    await expect(heightsRow).toContainText(`${EMCC_DEFAULT} (setting /heightDataFolder) → ${resolved}`);
    await expect(heightsRow).toContainText('readable');

    // Outside the emcc folder.
    await setTerrain(server, { heightDataFolder: '%emcc%/../elsewhere' });
    await expect.poll(async () => (await monitorTerrain(server)).detail, { timeout: 15_000, message: 'the plugin\'s status gives ECore\'s reason' }).toContain('outside the emcc folder');
    const outside = await monitorTerrain(server);
    testInfo.annotations.push({ type: 'outside', description: JSON.stringify(outside) });
    expect(outside.folders.find((f) => f.id === 'heights'), 'typed, not resolved, not readable').toMatchObject({ path: '%emcc%/../elsewhere', state: 'MISSING' });
    expect(outside.folders.find((f) => f.id === 'heights')?.resolved ?? null, 'no folder named for a path outside').toBeNull();
    const status = await terrain(server, '/status');
    expect(JSON.stringify(status.body), 'the plugin\'s /status').toContain('outside the emcc folder');
    const terrainRow = plugins.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Terrain' }) }).first();
    await expect(terrainRow, 'the Monitor\'s plugin row').toContainText('outside the emcc folder', { timeout: 15_000 });
    await expect(heightsRow).toContainText('%emcc%/../elsewhere (setting /heightDataFolder)');
    await expect(heightsRow).not.toContainText('→');

    // An absolute path, as before.
    if (existsSync(DTED)) {
      await setTerrain(server, { heightDataFolder: DTED });
      await expect.poll(async () => (await terrain(server, '/status')).body?.state, { timeout: 30_000, message: 'indexed' }).toBe('ready');
      await expect.poll(async () => (await monitorTerrain(server)).folders.find((f) => f.id === 'heights')?.state, { timeout: 15_000, message: 'checked again' }).toBe('READABLE');
      const absolute = (await monitorTerrain(server)).folders.find((f) => f.id === 'heights')!;
      expect(absolute, 'readable, nothing to resolve').toMatchObject({ path: DTED, state: 'READABLE' });
      expect(absolute.resolved ?? null).toBeNull();
      await expect(heightsRow).toContainText('readable', { timeout: 15_000 });
    } else {
      testInfo.annotations.push({ type: 'skipped part', description: `the absolute path: the ESA's terrain data is not at ${DTED}` });
    }
  });
});
