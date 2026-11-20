// Quick run: @plugin-simulator @plugin-map-view-2d @settings
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/flows/m7-sensors.spec.ts
import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type Request } from '@playwright/test';
import { direct, inverse } from '../../lib/geodesy.mjs';
import { createLayer, createSymbol, LiveClient } from '../../lib/live.mjs';
import { bottomPanel, mapCentre, pixelsAround, positionAt, userPause, withM0, type LonLat, type Point } from '../../lib/m0';
import type { OwnServer } from '../../lib/own-server';

// The simulator's M7 sensor package in the combined system (docs/plugins/briefs/simulator.md,
// functions 41 to 46, criteria 61 to 70; T-177 to T-180, T-184, T-185): the job area's faint fill
// and 3 px dotted outline, a new ground radar looking all round (0° to 360°), the dwells drawn in
// Simulation with "Show dwells", the bearing and range labels, the live preview of a sensor
// being edited, and the admin's colours. The drawing is read from screenshots of the map (the map
// is WebGL); the dwells' places from the server part's GET /sensors/dwells. The simulator ticks in
// real time (1 s). Positions are [lon, lat], latitude ≠ longitude; every server is the test's own.
//
// From M8 (T-196, the owner's "fill the revisit"; the brief on main 45371971): a revisit holds
// floor(revisit interval / dwell interval) dwells, the empty ones filling what the dwells with targets
// leave, spread over the search area (criteria 56 and 64); the admin's cap and the Empty dwells share
// are gone, stored or imported values ignored (criterion 66). The Default preset's values (M7's Narrow
// wedge) are set as values here, since T-197 renames the presets.

test.describe.configure({ timeout: 300_000 });

const SIMULATION = 'simulator.simulation';
const KM = 1000;
/** A friend platform's identity colour (APP-6's medium frame colour, coverage.ts). */
const BLUE = [0, 168, 220] as const;
const MAGENTA = [255, 0, 255] as const;
const CYAN = [0, 255, 255] as const;
/** From M8 the default colours, fixed (T-189, criterion 77). */
const DWELL_GREEN = [0x7e, 0xf2, 0x6a] as const;
const COVERAGE_RED = [0xfd, 0x09, 0x09] as const;
/** "At once", plus the time a screenshot of the map takes. */
const AT_ONCE_MS = 3_000;

type State = Record<string, any>;
type Event = { entityType: string; entityId: string; operation: string; state: State | null };
type Band = { center: LonLat; innerRadius: number; outerRadius: number; startBearing: number; endBearing: number };
type Dwell = { index: number; revisit: number; time: string; area: Band };

const near = (colour: readonly number[], tolerance = 40) => ([r, g, b]: number[]) => Math.abs(r - colour[0]) <= tolerance && Math.abs(g - colour[1]) <= tolerance && Math.abs(b - colour[2]) <= tolerance;

async function applied(client: LiveClient, request: { entityType: string; operation: string }): Promise<Event> {
  const outcome = await client.change(request);
  expect(outcome, `${request.entityType} ${request.operation}: ${JSON.stringify(outcome.rejection ?? '')}`).toMatchObject({ outcome: 'applied' });
  return outcome.event as Event;
}

async function everyWorkspace(server: OwnServer): Promise<LiveClient> {
  const client = await LiveClient.open(server.baseUrl);
  await client.subscribe({ workspaces: ['*'] });
  return client;
}

async function call(server: OwnServer, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${server.baseUrl}/api/plugins/simulator${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

async function simulator(server: OwnServer, path: string, body?: unknown): Promise<any> {
  const { status, body: answer } = await call(server, path, body);
  expect(status, `${body === undefined ? 'GET' : 'POST'} ${path}: ${JSON.stringify(answer)}`).toBe(200);
  return answer;
}

async function sensorOf(server: OwnServer, platform: string): Promise<any> {
  return (await simulator(server, '/sensors')).sensors.find((s: { platform: string }) => s.platform === platform);
}

/** PUT the simulator's settings with `changes` over its stored values; resolves with the status. */
async function putSettings(server: OwnServer, changes: Record<string, unknown>): Promise<number> {
  const url = `${server.baseUrl}/api/settings/plugins/simulator`;
  const values = (await (await fetch(url)).json()).values;
  return (await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, ...changes }) })).status;
}

async function setSettings(server: OwnServer, changes: Record<string, unknown>): Promise<void> {
  expect(await putSettings(server, changes), `simulator settings ${JSON.stringify(changes)}`).toBe(200);
}

/** An APP-6B friendly infantry track at a position. */
function trackRequest(layerId: string, name: string, at: LonLat) {
  const track = createSymbol(layerId, 0, { name }) as any;
  track.data.geometry.coordinates = at;
  track.data.symbol = { standard: 'APP-6B', sidc: 'SFGPUCI--------' };
  return track;
}

/** A Simulation layer and a runner far away: the sensors look only while some route runs (function 28). */
async function simulation(server: OwnServer, all: LiveClient): Promise<string> {
  const layer = createLayer('Ground truth', { workspace: SIMULATION, drawOrder: 1 });
  await applied(all, layer);
  const route = createSymbol(layer.entityId, 0, { name: 'Runner route' }) as any;
  const coordinates: LonLat[] = [[-5.0, 40.0], [-5.6, 40.1]];
  route.data = {
    type: 'core.shape', dataType: 'simulator.route', dataSource: 'manual', layerId: layer.entityId,
    geometry: { type: 'LineString', coordinates },
    style: { strokeColor: '#2C784C', strokeWidth: 2, strokeDash: 'dash', pointMarkers: 'circle' },
    properties: { name: 'Runner route' }, label: route.data.label,
    extensions: { simulator: { points: coordinates.map(() => ({ speedKind: 'instant', speed: 30 / 3.6, events: [] })), groups: [], end: 'stop' } },
  };
  await applied(all, route);
  const runner = trackRequest(layer.entityId, 'Runner', coordinates[0]);
  await applied(all, runner);
  await simulator(server, '/put-on-route', { route: route.entityId, kind: 'single', objects: [runner.entityId] });
  return layer.entityId;
}

function views(page: Page) {
  return page.getByRole('tablist', { name: 'Views' });
}

async function switchToSimulation(page: Page): Promise<void> {
  await views(page).getByRole('tab', { name: 'Simulation', exact: true }).click();
  await expect(views(page).getByRole('tab', { name: 'Simulation', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Simulation' }).getByRole('tab', { name: 'Layers', exact: true })).toBeVisible();
  await bottomPanel(page, 'Layers');
}

function region(page: Page, name: string) {
  return page.getByRole('region', { name, exact: true }).first();
}

/** Metres per pixel at a point, east-west. */
async function metresPerPixel(page: Page, at: Point): Promise<number> {
  const a = await positionAt(page, at);
  const b = await positionAt(page, { x: at.x + 100, y: at.y });
  return inverse([[a, b]])[0].metres / 100;
}

/** The pixel `px` pixels from `at` at a bearing (north up, the small scale of one view). */
function towards(at: Point, bearing: number, px: number): Point {
  const r = (bearing * Math.PI) / 180;
  return { x: Math.round(at.x + px * Math.sin(r)), y: Math.round(at.y - px * Math.cos(r)) };
}

async function count(page: Page, at: Point, half: number, matches: (pixel: number[]) => boolean): Promise<number> {
  const image = await pixelsAround(page, at, half);
  let n = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (matches(image.pixel(x, y))) n++;
  return n;
}

/** The page's calls that change a sensor (POST /api/plugins/simulator/sensors...). */
function watchSensorPosts(page: Page): Request[] {
  const sent: Request[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/plugins/simulator/sensors')) sent.push(r);
  });
  return sent;
}

/** Selects the track at `at` and makes its sensor with "New sensor"; resolves with the sensor's form. */
async function newSensor(page: Page, at: Point, name: string) {
  const sensors = region(page, 'Sensors');
  const create = sensors.getByRole('button', { name: 'New sensor', exact: true });
  await expect(async () => {
    await page.mouse.click(at.x, at.y);
    await userPause(page);
    await expect(create).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await create.click();
  const form = sensors.getByRole('region', { name: `Sensor ${name}`, exact: true });
  await expect(form).toBeVisible();
  return form;
}

test('a new ground radar, its labels, the live preview and the colours in the browser (simulator functions 41, 42, 45 and 46; criteria 61, 62, 67, 68 and 69; T-177, T-178, T-184, T-185): "New sensor" gives 0° to 360°, drawn as the full ring with its inner circle and only the range labels, and it detects a track behind the platform; 45° to 135° gives the four labels; a max range typed and not saved is drawn at once and nothing is sent, leaving the edit brings back the saved one; the admin\'s fixed colours reach every browser without a reload; the job area has a faint fill and a 3 px outline in its colour', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await everyWorkspace(server);
    try {
      const page = await open();
      const posts = watchSensorPosts(page);
      await switchToSimulation(page);
      const layerId = await simulation(server, all);
      const centre = await mapCentre(page);
      const P: Point = { x: centre.x - 40, y: centre.y + 20 };
      const platformAt = await positionAt(page, P);
      expect(Math.abs(platformAt[0] - platformAt[1]), 'latitude ≠ longitude').toBeGreaterThan(1);
      const mpp = await metresPerPixel(page, P);
      // A band of about 50 to 130 px on this map, in whole tenths of a km as typed.
      const minKm = Math.round((50 * mpp) / 100) / 10;
      const maxKm = Math.round((130 * mpp) / 100) / 10;
      const px = (km: number) => (km * KM) / mpp;
      testInfo.annotations.push({ type: 'band', description: `${minKm} to ${maxKm} km, ${px(minKm).toFixed(1)} to ${px(maxKm).toFixed(1)} px at ${mpp.toFixed(1)} m/px` });
      const track = trackRequest(layerId, 'Hawk', platformAt);
      await applied(all, track);

      // Criterion 62: "New sensor" gives 0° to 360°.
      const form = await newSensor(page, P, 'Hawk');
      const field = (label: string) => form.getByRole('textbox', { name: label, exact: true });
      await expect(field('Start bearing (°)')).toHaveValue('0');
      await expect(field('End bearing (°)')).toHaveValue('360');
      await field('Min range (km)').fill(String(minKm));
      await field('Max range (km)').fill(String(maxKm));
      await form.getByRole('button', { name: 'Save', exact: true }).click();
      await expect.poll(async () => (await sensorOf(server, track.entityId))?.settings.maxRange, { message: 'saved' }).toBe(Math.round(maxKm * KM));
      expect((await sensorOf(server, track.entityId)).settings, 'all round').toMatchObject({ startBearing: 0, endBearing: 360 });

      // Criterion 77 (T-189): the default colours are fixed, and the coverage is drawn in #FD0909.
      const stored = (await (await fetch(`${server.baseUrl}/api/settings/plugins/simulator`)).json()).values;
      testInfo.annotations.push({ type: 'simulator colours', description: JSON.stringify({ dwellColour: stored.dwellColour, coverageColour: stored.coverageColour, jobAreaColour: stored.jobAreaColour }) });
      expect([stored.dwellColour, stored.coverageColour, stored.jobAreaColour], 'the three default colours, fixed').toEqual([{ use: 'fixed', colour: '#7EF26A' }, { use: 'fixed', colour: '#FD0909' }, { use: 'fixed', colour: '#BDCF3D' }]);
      await page.mouse.move(centre.x + 300, centre.y + 260);
      await expect.poll(() => count(page, towards(P, 0, px(maxKm)), 10, near(COVERAGE_RED)), { timeout: 10_000, message: 'the coverage in #FD0909 by default' }).toBeGreaterThan(2);
      // identity can still be chosen (owner SV A); the rest of this test draws in it.
      await setSettings(server, { coverageColour: { use: 'identity', colour: '#FD0909' } });

      // Drawn as the full ring: both circles at the four compass points, in the friend's identity colour.
      const blue = near(BLUE);
      for (const km of [maxKm, minKm]) {
        for (const bearing of [0, 90, 180, 270]) {
          await expect.poll(() => count(page, towards(P, bearing, px(km)), 10, blue), { timeout: 10_000, message: `the ${km} km circle at ${bearing}°` }).toBeGreaterThan(2);
        }
      }
      expect(await count(page, towards(P, 45, px(minKm) / 2), 10, blue), 'nothing inside the inner circle').toBe(0);
      // Criterion 67's all-round case: the range labels, ahead (north), and no bearing labels.
      const north = await count(page, towards(P, 0, px(maxKm)), 16, blue);
      const south = await count(page, towards(P, 180, px(maxKm)), 16, blue);
      testInfo.annotations.push({ type: 'all round, max range: north (label) and south', description: `${north}, ${south}` });
      expect(north, 'the max range label, north').toBeGreaterThan(south + 10);
      expect(await count(page, towards(P, 0, px(minKm)), 16, blue), 'the min range label, north').toBeGreaterThan((await count(page, towards(P, 180, px(minKm)), 16, blue)) + 10);
      await page.screenshot({ path: testInfo.outputPath('all-round.png') });

      // It detects a track behind the platform (bearing 180° from its heading 0).
      const [behind] = direct([{ from: platformAt, azimuth: 180, metres: ((minKm + maxKm) / 2) * KM }]) as LonLat[];
      await applied(all, trackRequest(layerId, 'Behind', behind));
      await simulator(server, '/routes/start', {});
      await expect.poll(async () => (await sensorOf(server, track.entityId)).detections, { timeout: 30_000, message: 'the track behind detected' }).toBeGreaterThan(0);
      await simulator(server, '/routes/pause', {});

      // Criterion 67: 45° to 135° gives the four labels, each at the middle of its edge or arc.
      await field('Start bearing (°)').fill('45');
      await field('End bearing (°)').fill('135');
      await form.getByRole('button', { name: 'Save', exact: true }).click();
      await expect.poll(async () => (await sensorOf(server, track.entityId))?.settings.startBearing, { message: '45° saved' }).toBe(45);
      await page.mouse.move(centre.x + 300, centre.y + 260);
      const middle = px((minKm + maxKm) / 2);
      const labels = [
        { name: '45°', at: towards(P, 45, middle), plain: towards(P, 45, px(minKm) + 8) },
        { name: '135°', at: towards(P, 135, middle), plain: towards(P, 135, px(minKm) + 8) },
        { name: `${maxKm} km`, at: towards(P, 90, px(maxKm)), plain: towards(P, 55, px(maxKm)) },
        { name: `${minKm} km`, at: towards(P, 90, px(minKm)), plain: towards(P, 60, px(minKm)) },
      ];
      const seen: string[] = [];
      for (const label of labels) {
        await expect.poll(async () => (await count(page, label.at, 12, blue)) - (await count(page, label.plain, 12, blue)), { timeout: 10_000, message: `the label ${label.name}` }).toBeGreaterThan(8);
        seen.push(`${label.name}: ${await count(page, label.at, 12, blue)} vs ${await count(page, label.plain, 12, blue)}`);
      }
      testInfo.annotations.push({ type: 'labels (label box vs the same edge without it)', description: seen.join('; ') });
      expect(await count(page, towards(P, 0, px(maxKm)), 16, blue), 'no longer anything north').toBeLessThanOrEqual(2);
      await page.screenshot({ path: testInfo.outputPath('labels.png') });

      // Criterion 68: a max range typed, not saved, is drawn at once; nothing is sent; leaving brings back the saved one.
      const sentBefore = posts.length;
      const shorterKm = Math.round((95 * mpp) / 100) / 10;
      await field('Max range (km)').fill(String(shorterKm));
      await page.mouse.move(centre.x + 300, centre.y + 260);
      await expect.poll(() => count(page, towards(P, 70, px(shorterKm)), 10, blue), { timeout: AT_ONCE_MS, message: 'the preview arc at the typed range' }).toBeGreaterThan(2);
      await expect.poll(() => count(page, towards(P, 70, px(maxKm)), 10, blue), { timeout: AT_ONCE_MS, message: 'the saved arc gone from the preview' }).toBeLessThanOrEqual(1);
      await field('Max range (km)').fill('x');
      await page.waitForTimeout(1_000); // an invalid field keeps the last valid drawing; a fixed wait, the drawing staying is the check
      expect(await count(page, towards(P, 70, px(shorterKm)), 10, blue), 'an invalid field keeps the preview').toBeGreaterThan(2);
      expect(posts.length, 'nothing sent while editing').toBe(sentBefore);
      expect((await sensorOf(server, track.entityId)).settings.maxRange, 'the saved range unchanged').toBe(Math.round(maxKm * KM));
      await region(page, 'Sensors').getByRole('list', { name: 'Sensors' }).getByRole('button', { name: 'Hawk', exact: true }).click();
      await expect(form, 'the edit left').toHaveCount(0);
      await expect.poll(() => count(page, towards(P, 70, px(maxKm)), 10, blue), { timeout: AT_ONCE_MS, message: 'the saved arc back' }).toBeGreaterThan(2);
      expect(await count(page, towards(P, 70, px(shorterKm)), 10, blue), 'the preview gone').toBeLessThanOrEqual(1);
      expect(posts.length, 'still nothing sent').toBe(sentBefore);

      // Criterion 69: the admin's fixed coverage colour in this browser and in another, without a reload.
      const other = await open();
      await switchToSimulation(other);
      await other.mouse.move(centre.x + 300, centre.y + 260);
      await expect.poll(() => count(other, towards(P, 70, px(maxKm)), 10, blue), { timeout: 10_000, message: 'the other browser: the coverage in identity colour' }).toBeGreaterThan(2);
      const loads = { count: 0 };
      page.on('load', () => loads.count++);
      await setSettings(server, { coverageColour: { use: 'fixed', colour: '#00FFFF' } });
      for (const shown of [page, other]) {
        await expect.poll(() => count(shown, towards(P, 70, px(maxKm)), 10, near(CYAN)), { timeout: AT_ONCE_MS + 2_000, message: 'the coverage in #00FFFF' }).toBeGreaterThan(2);
        expect(await count(shown, towards(P, 70, px(maxKm)), 10, blue), 'no identity colour left').toBe(0);
      }
      expect(await count(page, labels[0].at, 12, near(CYAN)), 'the labels in the coverage colour').toBeGreaterThan(8);
      await setSettings(server, { coverageColour: { use: 'identity', colour: '#FFFF00' } });
      await expect.poll(() => count(page, towards(P, 70, px(maxKm)), 10, blue), { timeout: AT_ONCE_MS + 2_000, message: 'identity: #00A8DC again' }).toBeGreaterThan(2);

      // Criterion 61: the job area's faint fill and 3 px outline, in its fixed colour.
      await setSettings(server, { jobAreaColour: { use: 'fixed', colour: '#FF00FF' } });
      const corners: Point[] = [{ x: P.x - 180, y: P.y - 160 }, { x: P.x + 180, y: P.y - 160 }, { x: P.x + 180, y: P.y + 160 }, { x: P.x - 180, y: P.y + 160 }];
      const ring: LonLat[] = [];
      for (const c of corners) ring.push(await positionAt(page, c));
      await simulator(server, '/sensors', { platform: track.entityId, jobArea: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } });
      await page.mouse.move(centre.x + 300, centre.y + 260);
      const west = corners[0].x;
      const magenta = near(MAGENTA, 70);
      // Across the west edge, row by row: the widest run of the outline's colour (a dotted line has gaps in some rows).
      const widest = async () => {
        let best = 0;
        for (let dy = -60; dy <= 60; dy += 4) {
          const image = await pixelsAround(page, { x: west, y: P.y + dy }, 8);
          let run = 0;
          for (let x = 0; x < image.width; x++) {
            run = magenta(image.pixel(x, 8)) ? run + 1 : 0;
            best = Math.max(best, run);
          }
        }
        return best;
      };
      await expect.poll(widest, { timeout: AT_ONCE_MS + 2_000, message: 'the job area\'s outline' }).toBeGreaterThanOrEqual(2);
      const width = await widest();
      testInfo.annotations.push({ type: 'job area outline width', description: `${width} px` });
      expect(width, 'a 3 px outline').toBeLessThanOrEqual(5);
      // The fill: inside the job area and outside the coverage, the ground tinted towards magenta.
      const inside = (await pixelsAround(page, { x: P.x - 150, y: P.y + 100 }, 3)).pixel(3, 3);
      const outside = (await pixelsAround(page, { x: P.x - 230, y: P.y + 100 }, 3)).pixel(3, 3);
      testInfo.annotations.push({ type: 'job area fill', description: `inside ${JSON.stringify(inside)}, outside ${JSON.stringify(outside)}` });
      expect(outside[1] - inside[1], 'faintly filled: less green inside').toBeGreaterThan(12);
      expect(outside[1] - inside[1], 'faintly: not a solid fill').toBeLessThan(80);
      expect(loads.count, 'no reload').toBe(0);
      await page.screenshot({ path: testInfo.outputPath('job-area.png') });
    } finally {
      await all.close();
    }
  });
});

test('dwells drawn in Simulation (simulator functions 43, 46 and 47; criteria 63, 69 and 70; T-179, T-182): a ground radar\'s dwells appear while the simulation runs, in the platform\'s identity colour and then the admin\'s fixed dwell colour, and stay while it is paused (GET /sensors/dwells answering 304 with nothing new); "Show dwells" off hides them, also after a reload; the display switch "Dwell areas" hides them while the coverage stays, "Sensor coverage" the coverage; a reset takes them away', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await everyWorkspace(server);
    try {
      const page = await open();
      await switchToSimulation(page);
      const layerId = await simulation(server, all);
      const centre = await mapCentre(page);
      const P: Point = { x: centre.x - 40, y: centre.y + 20 };
      const platformAt = await positionAt(page, P);
      const mpp = await metresPerPixel(page, P);
      const track = trackRequest(layerId, 'Eye', platformAt);
      await applied(all, track);
      // A target 90 px east-north-east: one dwell with targets and the empty ones (function 44).
      const targetAt = await positionAt(page, towards(P, 70, 90));
      await applied(all, trackRequest(layerId, 'Target', targetAt));
      await newSensor(page, P, 'Eye');
      await simulator(server, '/sensors', { platform: track.entityId, revisitSeconds: 3, minRange: Math.round(20 * mpp), maxRange: Math.round(160 * mpp), dwellDepth: Math.max(1_000, Math.round(40 * mpp)) });
      const sensors = region(page, 'Sensors');
      const showDwells = sensors.getByRole('checkbox', { name: 'Show dwells', exact: true });
      const showCoverage = sensors.getByRole('checkbox', { name: 'Show coverage', exact: true });
      await expect(showDwells, '"Show dwells" on by default').toBeChecked();
      // The coverage off first, so that the identity colour on the map is the dwells' alone.
      await showCoverage.uncheck();
      await page.mouse.move(centre.x + 300, centre.y + 260);
      const inBand = async (matches: (pixel: number[]) => boolean) => count(page, P, Math.round(170), matches);
      const blue = near(BLUE);
      const magenta = near(MAGENTA);
      await simulator(server, '/routes/start', {});

      // Criterion 77 (T-189): drawn in #7EF26A by default; identity can still be chosen, and the rest of this test draws in it.
      await expect.poll(() => inBand(near(DWELL_GREEN)), { timeout: 20_000, message: 'the dwells in #7EF26A by default' }).toBeGreaterThan(40);
      await setSettings(server, { dwellColour: { use: 'identity', colour: '#7EF26A' }, coverageColour: { use: 'identity', colour: '#FD0909' } });

      // Criterion 63: drawn while it runs, in the identity colour (criterion 69).
      await expect.poll(() => inBand(blue), { timeout: 20_000, message: 'the dwells, in #00A8DC' }).toBeGreaterThan(40);
      const answer = await simulator(server, '/sensors/dwells');
      testInfo.annotations.push({ type: 'GET /sensors/dwells', description: JSON.stringify(answer).slice(0, 600) });
      expect(answer.sensors.find((s: { platform: string }) => s.platform === track.entityId)?.dwells.length ?? 0, 'the drawn dwells on the server').toBeGreaterThan(0);
      // The admin's fixed dwell colour: at once, without a reload.
      await setSettings(server, { dwellColour: { use: 'fixed', colour: '#FF00FF' } });
      await expect.poll(() => inBand(magenta), { timeout: AT_ONCE_MS + 2_000, message: 'the dwells in #FF00FF' }).toBeGreaterThan(40);
      await showCoverage.check();
      await expect.poll(() => inBand(blue), { timeout: AT_ONCE_MS + 2_000, message: 'the coverage back, in its own colour' }).toBeGreaterThan(20);

      // Paused: they stay; with nothing new the endpoint answers 304.
      await simulator(server, '/routes/pause', {});
      await page.waitForTimeout(2_500); // the last tick's dwells in
      const paused = await simulator(server, '/sensors/dwells');
      expect((await call(server, `/sensors/dwells?since=${paused.seq}`)).status, 'nothing new while paused: 304').toBe(304);
      const drawn = await inBand(magenta);
      await page.waitForTimeout(4_000); // more than a revisit; the dwells staying is the check
      expect(await inBand(magenta), 'still drawn while paused').toBeGreaterThan(Math.max(30, drawn / 2));

      // Criterion 70: the display switches (the user's, PUT /api/display): Dwell areas hides the dwells, the coverage stays.
      const putDisplay = async (choices: Record<string, unknown>) => {
        const response = await fetch(`${server.baseUrl}/api/display`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(choices) });
        expect(response.status, `PUT /api/display: ${await response.clone().text()}`).toBe(204);
      };
      await putDisplay({ classes: { 'dwell-area': false } });
      await expect.poll(() => inBand(magenta), { timeout: AT_ONCE_MS, message: 'Dwell areas off: no dwell' }).toBeLessThanOrEqual(3);
      expect(await inBand(blue), 'the coverage stays').toBeGreaterThan(20);
      await putDisplay({ classes: { 'sensor-coverage': false } });
      await expect.poll(() => inBand(blue), { timeout: AT_ONCE_MS, message: 'Sensor coverage off: no coverage' }).toBeLessThanOrEqual(3);
      await expect.poll(() => inBand(magenta), { timeout: AT_ONCE_MS, message: 'the dwells back' }).toBeGreaterThan(30);
      await putDisplay({});
      await expect.poll(() => inBand(blue), { timeout: AT_ONCE_MS, message: 'the defaults: the coverage back' }).toBeGreaterThan(20);

      // "Show dwells" off: they go, also after a reload; on: back.
      await showDwells.uncheck();
      await expect.poll(() => inBand(magenta), { timeout: AT_ONCE_MS, message: '"Show dwells" off' }).toBeLessThanOrEqual(3);
      await page.reload();
      await switchToSimulation(page);
      await expect(region(page, 'Sensors').getByRole('checkbox', { name: 'Show dwells', exact: true }), 'the choice kept after a reload').not.toBeChecked();
      await page.mouse.move(centre.x + 300, centre.y + 260);
      await expect.poll(() => inBand(blue), { timeout: 10_000, message: 'the coverage after the reload' }).toBeGreaterThan(20);
      expect(await inBand(magenta), 'no dwells after the reload').toBeLessThanOrEqual(3);
      await region(page, 'Sensors').getByRole('checkbox', { name: 'Show dwells', exact: true }).check();
      await expect.poll(() => inBand(magenta), { timeout: 10_000, message: '"Show dwells" on: back' }).toBeGreaterThan(30);

      // A reset takes them away, on the map and on the server.
      await simulator(server, '/routes/reset', {});
      await expect.poll(() => inBand(magenta), { timeout: 10_000, message: 'no dwells after a reset' }).toBeLessThanOrEqual(3);
      expect((await simulator(server, '/sensors/dwells')).sensors.find((s: { platform: string }) => s.platform === track.entityId)?.dwells ?? [], 'none on the server').toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('after-reset.png') });
    } finally {
      await all.close();
    }
  });
});

/** The degrees from `a` clockwise to `b`, 0 to below 360. */
function clockwise(a: number, b: number): number {
  return (((b - a) % 360) + 360) % 360;
}

/** Whether a bearing lies in a band's bearings (clockwise from start to end). */
function inBearings(band: Band, bearing: number): boolean {
  return clockwise(band.startBearing, bearing) <= clockwise(band.startBearing, band.endBearing);
}

function middleBearing(band: Band): number {
  return (band.startBearing + clockwise(band.startBearing, band.endBearing) / 2) % 360;
}

function overlaps(a: Band, b: Band): boolean {
  const radial = a.innerRadius < b.outerRadius && b.innerRadius < a.outerRadius;
  const angular = inBearings(a, b.startBearing + 1e-6) || inBearings(a, b.endBearing - 1e-6) || inBearings(b, a.startBearing + 1e-6);
  return radial && angular;
}

/**
 * A ground radar's drawn dwells (GET /sensors/dwells), collected by revisit and index while polled. The
 * server keeps each index's latest dwell, and a revisit's last dwell removes the higher indices, so the
 * set is the new revisit's first dwells and the last revisit's rest (function 43). A revisit is taken as
 * whole only when every index from 0 up was seen and one poll showed it beside the next revisit, its
 * tail still drawn: so a revisit caught midway is never taken for a whole one (the MCA's full run,
 * 2026-11-13: "2 empty dwells for 3" once, from the old check of one revisit alone).
 */
function dwellWatch(server: OwnServer, platform: string) {
  const seen = new Map<number, Map<number, Dwell>>();
  const tail = new Set<number>();
  const firstSeen = new Map<number, number>();
  let latest = -1;
  const poll = async () => {
    const sensor = (await simulator(server, '/sensors/dwells')).sensors.find((s: { platform: string }) => s.platform === platform);
    const dwells = (sensor?.dwells ?? []) as Dwell[];
    const present = new Set(dwells.map((d) => d.revisit));
    for (const d of dwells) {
      if (!seen.has(d.revisit)) seen.set(d.revisit, new Map());
      seen.get(d.revisit)!.set(d.index, d);
      if (!firstSeen.has(d.revisit)) firstSeen.set(d.revisit, Date.now());
      latest = Math.max(latest, d.revisit);
    }
    for (const r of present) if (present.has(r + 1)) tail.add(r);
  };
  const whole = (r: number): Dwell[] | undefined => {
    const byIndex = seen.get(r);
    if (!tail.has(r) || byIndex === undefined) return undefined;
    const dwells = [...byIndex.values()].sort((a, b) => a.index - b.index);
    return dwells.every((d, i) => d.index === i) ? dwells : undefined;
  };
  return {
    /**
     * The first whole revisit that began after this call (so after any change made before it), with
     * the next revisit's first dwell and when each was first seen here (wall clock, ms).
     */
    async next(what: string, timeout = 45_000): Promise<{ dwells: Dwell[]; following: Dwell; seenAt: number; followingSeenAt: number }> {
      await poll();
      const after = latest;
      let found: number | undefined;
      await expect
        .poll(async () => {
          await poll();
          found = [...seen.keys()].filter((r) => r > after && r > 0).sort((a, b) => a - b).find((r) => whole(r) !== undefined && seen.get(r + 1)?.has(0));
          return found !== undefined;
        }, { timeout, intervals: [150], message: `a whole revisit: ${what}` })
        .toBe(true);
      return { dwells: whole(found!)!, following: seen.get(found! + 1)!.get(0)!, seenAt: firstSeen.get(found!)!, followingSeenAt: firstSeen.get(found! + 1)! };
    },
  };
}

/** The dwells that hold one of the positions (one geodesy call for all: each call starts a JVM). */
function holding(dwells: Dwell[], positions: LonLat[]): Dwell[] {
  if (dwells.length === 0 || positions.length === 0) return [];
  const results = inverse(dwells.flatMap((d) => positions.map((p) => [d.area.center, p])));
  return dwells.filter((d, i) => positions.some((_, j) => {
    const { metres, initialAzimuth } = results[i * positions.length + j];
    return inBearings(d.area, (initialAzimuth + 360) % 360) && metres >= d.area.innerRadius && metres <= d.area.outerRadius;
  }));
}

function describeDwells(dwells: Dwell[]): string {
  return dwells.map((d) => `${d.index}: ${d.area.startBearing.toFixed(1)}-${d.area.endBearing.toFixed(1)}° ${Math.round(d.area.innerRadius / KM)}-${Math.round(d.area.outerRadius / KM)} km`).join('; ');
}

/** The seconds between consecutive dwells, the next revisit's first dwell last. */
function steps(dwells: Dwell[], following: Dwell): number[] {
  const times = [...dwells, following].map((d) => Date.parse(d.time));
  return times.slice(1).map((t, i) => (t - times[i]) / 1000);
}

/** The Default preset's values from M8 (M7's Narrow wedge), set as values: T-197 renames the presets. */
const DEFAULT_VALUES = { searchWidth: 2, dwellDepth: 20 * KM, dwellInterval: 0.2 };
const RADAR = { detectionProbability: 1, rangeError: 0, crossRangeError: 0 };

test('a filled revisit (simulator functions 37 and 44; criteria 64 and 66; T-196, T-180): a radar at [15.20, 58.41] looking 0° to 90° over 20 to 150 km with 2°, 20 km and 0.2 s and a revisit of 10 s sends 50 dwells, one holding the two tracks at 10° and 11° and 49 empty, none overlapping it, spread over the area; the removed cap and Empty dwells share, set or imported in a scenario, change nothing; without tracks 50 empty; 0° to 12° over 20 to 40 km gives 6 places that the 49 take in turn; a job area over 45° to 90° keeps every centre inside it', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server }) => {
    const all = await everyWorkspace(server);
    try {
      const layerId = await simulation(server, all);
      const PLATFORM: LonLat = [15.2, 58.41];
      const platform = trackRequest(layerId, 'Radar', PLATFORM);
      await applied(all, platform);
      const tracksAt = async (km: number): Promise<{ ids: string[]; at: LonLat[] }> => {
        const at = direct([{ from: PLATFORM, azimuth: 10, metres: km * KM }, { from: PLATFORM, azimuth: 11, metres: km * KM }]) as LonLat[];
        const ids: string[] = [];
        for (const [i, p] of at.entries()) {
          const t = trackRequest(layerId, `Target ${i + 1}`, p);
          await applied(all, t);
          ids.push(t.entityId);
        }
        return { ids, at };
      };
      const remove = async (ids: string[]) => {
        for (const id of ids) await applied(all, { requestId: randomUUID(), entityType: 'object', operation: 'delete', entityId: id, source: { plugin: 'ita-test' } } as any);
      };
      let tracks = await tracksAt(60);
      await simulator(server, '/sensors', { platform: platform.entityId, create: true, revisitSeconds: 10, startBearing: 0, endBearing: 90, minRange: 20 * KM, maxRange: 150 * KM, ...RADAR, ...DEFAULT_VALUES });
      expect((await sensorOf(server, platform.entityId)).settings, 'the values set').toMatchObject({ revisitSeconds: 10, ...DEFAULT_VALUES });
      const watch = dwellWatch(server, platform.entityId);
      await simulator(server, '/routes/start', {});

      /** Criterion 64's revisit: 50 dwells, one with the targets, 49 empty, none overlapping it. */
      const filled = async (what: string, at: LonLat[]): Promise<{ dwells: Dwell[]; target: Dwell }> => {
        const { dwells } = await watch.next(what);
        testInfo.annotations.push({ type: what, description: describeDwells(dwells) });
        expect(dwells, `${what}: floor(10 s / 0.2 s) = 50 dwells`).toHaveLength(50);
        const withTargets = holding(dwells, at);
        expect(withTargets, `${what}: one dwell with the targets`).toHaveLength(1);
        // The others hold no target (holding found only the one) and do not overlap it.
        for (const d of dwells.filter((x) => x !== withTargets[0])) {
          expect(overlaps(d.area, withTargets[0].area), `${what}: empty dwell ${d.index} does not overlap the targets' dwell`).toBe(false);
        }
        return { dwells, target: withTargets[0] };
      };

      // Criterion 64: the revisit, spread over the search area.
      const { dwells } = await filled('two tracks', tracks.at);
      const centres = dwells.map((d) => middleBearing(d.area)).sort((a, b) => a - b);
      const gaps = centres.slice(1).map((c, i) => c - centres[i]);
      const even = 90 / dwells.length;
      testInfo.annotations.push({ type: 'centre bearings and gaps', description: `${JSON.stringify(centres.map((c) => +c.toFixed(1)))}, largest gap ${Math.max(...gaps).toFixed(1)}°, even ${even}°` });
      expect(Math.max(...gaps), 'spread: the largest gap at most twice the even spacing').toBeLessThanOrEqual(2 * even);
      expect(Math.max(...dwells.map((d) => clockwise(d.area.startBearing, d.area.endBearing))), 'each dwell 2° wide').toBeLessThanOrEqual(2 + 1e-6);

      // Criterion 66: the removed settings change nothing. The admin's cap, set where it is still accepted
      // (a refusal is the setting gone); the sensor's Empty dwells share at 0.
      const cap = await putSettings(server, { maxEmptyDwellsPerTargetDwell: 1 });
      testInfo.annotations.push({ type: 'PUT maxEmptyDwellsPerTargetDwell: 1', description: String(cap) });
      expect([200, 400], 'the cap: stored or refused').toContain(cap);
      const share = await call(server, '/sensors', { platform: platform.entityId, emptyShare: 0 });
      testInfo.annotations.push({ type: 'POST emptyShare: 0', description: `${share.status} ${JSON.stringify(share.body?.settings ?? share.body)}` });
      expect([200, 400], 'the share: stored or refused').toContain(share.status);
      await filled('cap 1 and share 0 stored', tracks.at);

      // ... nor a scenario file's share: the sensor imported again (merge) with a share of 0.
      await simulator(server, '/routes/pause', {});
      const state = await simulator(server, '/scenario-state');
      const sensors = (state.sensors as { platform: string; settings: Record<string, unknown> }[]).map((s) => (s.platform === platform.entityId ? { ...s, settings: { ...s.settings, emptyShare: 0, maxEmptyDwellsPerTargetDwell: 1 } } : s));
      await simulator(server, '/scenario-state', { mode: 'merge', outputs: state.outputs, sensors });
      await simulator(server, '/routes/start', {});
      await filled('a scenario with share 0 imported', tracks.at);

      // No targets: every dwell empty, the tracks' places free again.
      await remove(tracks.ids);
      const { dwells: none } = await watch.next('no tracks');
      testInfo.annotations.push({ type: 'no tracks', description: describeDwells(none) });
      expect(none, 'no targets: 50 empty dwells').toHaveLength(50);

      // Few places: 0° to 12° over 20 to 40 km, 6 places of 2° by 20 km; the tracks inside at 30 km.
      tracks = await tracksAt(30);
      await simulator(server, '/sensors', { platform: platform.entityId, startBearing: 0, endBearing: 12, minRange: 20 * KM, maxRange: 40 * KM });
      const few = await filled('few places', tracks.at);
      const places = new Map<string, number>();
      for (const d of few.dwells.filter((x) => x !== few.target)) {
        const key = `${d.area.startBearing.toFixed(1)}° ${Math.round(d.area.innerRadius / KM)} km`;
        places.set(key, (places.get(key) ?? 0) + 1);
      }
      testInfo.annotations.push({ type: 'few places: empty dwells per place', description: JSON.stringify(Object.fromEntries(places)) });
      expect(Math.max(...places.values()) - Math.min(...places.values()), 'the free places taken in turn: counts differ by at most one').toBeLessThanOrEqual(1);
      await remove(tracks.ids);

      // A job area over 45° to 90°: every dwell's centre inside it.
      tracks = await tracksAt(60);
      const corners = [PLATFORM, ...(direct([{ from: PLATFORM, azimuth: 45, metres: 300 * KM }, { from: PLATFORM, azimuth: 67.5, metres: 400 * KM }, { from: PLATFORM, azimuth: 90, metres: 300 * KM }]) as LonLat[])];
      await simulator(server, '/sensors', { platform: platform.entityId, startBearing: 0, endBearing: 90, minRange: 20 * KM, maxRange: 150 * KM, jobArea: { type: 'Polygon', coordinates: [[...corners, corners[0]]] } });
      const { dwells: inJob } = await watch.next('job area');
      testInfo.annotations.push({ type: 'job area 45° to 90°', description: describeDwells(inJob) });
      expect(inJob, 'job area: still 50 dwells').toHaveLength(50);
      for (const d of inJob) {
        const m = middleBearing(d.area);
        expect(m >= 45 && m <= 90, `dwell ${d.index}'s centre at ${m.toFixed(1)}° is inside the job area`).toBe(true);
      }
      await simulator(server, '/routes/pause', {});
    } finally {
      await all.close();
    }
  });
});

test('presets and time (simulator function 37; criteria 54 and 56; T-196): the Medium and the Wide wedge set their three values and a change makes it Custom; with the Medium wedge (1 s) and a revisit of 10 s, 4 dwells with targets and 6 empty ones, 1 s apart, the next revisit 1 s after the last; with 14 targets 14 dwells and no empty one, lasting 14 s; with 0.2 s, 50 dwells, 5 a second', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server }) => {
    const all = await everyWorkspace(server);
    try {
      const layerId = await simulation(server, all);
      const PLATFORM: LonLat = [16.1, 59.3];
      const platform = trackRequest(layerId, 'Radar', PLATFORM);
      await applied(all, platform);
      await simulator(server, '/sensors', { platform: platform.entityId, create: true, revisitSeconds: 10, startBearing: 0, endBearing: 360, minRange: 20 * KM, maxRange: 170 * KM, ...RADAR });

      // Criterion 54 for the presets T-197 does not change (Default and the Narrow wedge: criterion 73).
      const preset = async (name: string) => {
        await simulator(server, '/sensors', { platform: platform.entityId, preset: name });
        return (await sensorOf(server, platform.entityId)).settings;
      };
      expect(await preset('wide'), 'the Wide wedge').toMatchObject({ preset: 'wide', searchWidth: 180, dwellInterval: 4 });
      expect(await preset('medium'), 'the Medium wedge').toMatchObject({ preset: 'medium', searchWidth: 40, dwellDepth: 50 * KM, dwellInterval: 1 });
      await simulator(server, '/sensors', { platform: platform.entityId, dwellInterval: 2 });
      expect((await sensorOf(server, platform.entityId)).settings, 'a changed value: Custom').toMatchObject({ preset: 'custom', dwellInterval: 2 });
      expect(await preset('medium'), 'the Medium wedge again').toMatchObject({ preset: 'medium', dwellInterval: 1 });

      const place = async (points: { azimuth: number; km: number }[]) => {
        const at = direct(points.map((p) => ({ from: PLATFORM, azimuth: p.azimuth, metres: p.km * KM }))) as LonLat[];
        const ids: string[] = [];
        for (const [i, p] of at.entries()) {
          const t = trackRequest(layerId, `Target ${i + 1}`, p);
          await applied(all, t);
          ids.push(t.entityId);
        }
        return { ids, at };
      };
      const watch = dwellWatch(server, platform.entityId);
      const timed = async (what: string, interval: number) => {
        const { dwells, following } = await watch.next(what);
        const gaps = steps(dwells, following);
        testInfo.annotations.push({ type: what, description: `${dwells.length} dwells, steps ${JSON.stringify([...new Set(gaps.map((g) => +g.toFixed(3)))])} s; times ${JSON.stringify([...dwells, following].map((d) => `${d.revisit}/${d.index} ${d.time.slice(11, 23)}`))}; ${describeDwells(dwells)}` });
        for (const [i, g] of gaps.entries()) expect(Math.abs(g - interval), `${what}: step ${i} is ${interval} s, not ${g} s`).toBeLessThanOrEqual(0.011);
        return dwells;
      };

      // 4 targets 90° apart: 4 dwells with targets, 6 empty; 1 s apart, the next revisit 1 s after the last.
      const four = await place([0, 90, 180, 270].map((azimuth) => ({ azimuth, km: 60 })));
      await simulator(server, '/routes/start', {});
      let dwells = await timed('4 targets', 1);
      expect(dwells, '4 targets: 10 dwells').toHaveLength(10);
      expect(holding(dwells, four.at), '4 dwells with targets').toHaveLength(4);
      for (const id of four.ids) await applied(all, { requestId: randomUUID(), entityType: 'object', operation: 'delete', entityId: id, source: { plugin: 'ita-test' } } as any);

      // 14 targets, each in a dwell of its own: a dwell with targets grows to hold them and splits only
      // above "most detections per dwell" (function 37, A5), so that is 1 here (two rings 100 km apart
      // went into 7 grown dwells, with no free place left for an empty one). 14 dwells, no empty one, 14 s.
      await simulator(server, '/sensors', { platform: platform.entityId, maxDetections: 1 });
      const fourteen = await place(Array.from({ length: 14 }, (_, i) => ({ azimuth: (i * 360) / 14, km: 60 })));
      dwells = await timed('14 targets', 1);
      expect(dwells, '14 targets: 14 dwells').toHaveLength(14);
      expect(holding(dwells, fourteen.at), 'every dwell holds a target').toHaveLength(14);

      // The Default preset's 0.2 s: 50 dwells, 5 a second (the 14 targets still in their own dwells).
      await simulator(server, '/sensors', { platform: platform.entityId, ...DEFAULT_VALUES });
      dwells = await timed('0.2 s', 0.2);
      expect(dwells, '0.2 s: 50 dwells').toHaveLength(50);
      await simulator(server, '/routes/pause', {});
    } finally {
      await all.close();
    }
  });
});

test('the presets from M8 (simulator criterion 73; T-191, T-197): Default sets 2°, 20 km, 0.2 s and Random; the Narrow wedge 1.7°, 95 km, 0.1 s, Systematic and a Target revisit of 2 s; Medium and Wide set Random; a new sensor is on the Medium wedge in Random; a sensor saved with 2°, 20 km and 0.2 s (M7\'s Narrow wedge) loads as Default, with 5° as Custom; a value changed by hand and the Narrow wedge switched to Random show Custom', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server }) => {
    const all = await everyWorkspace(server);
    try {
      const layerId = await simulation(server, all);
      const platform = trackRequest(layerId, 'Radar', [15.2, 58.41]);
      await applied(all, platform);
      await simulator(server, '/sensors', { platform: platform.entityId, create: true });
      const settings = async () => (await sensorOf(server, platform.entityId)).settings;
      const choose = async (body: Record<string, unknown>) => {
        await simulator(server, '/sensors', { platform: platform.entityId, ...body });
        return settings();
      };
      expect(await settings(), 'a new sensor: the Medium wedge in Random').toMatchObject({ preset: 'medium', searchWidth: 40, dwellDepth: 50 * KM, dwellInterval: 1, mode: 'random' });
      expect(await choose({ preset: 'default' }), 'Default').toMatchObject({ preset: 'default', searchWidth: 2, dwellDepth: 20 * KM, dwellInterval: 0.2, mode: 'random' });
      expect(await choose({ preset: 'narrow' }), 'the Narrow wedge').toMatchObject({ preset: 'narrow', searchWidth: 1.7, dwellDepth: 95 * KM, dwellInterval: 0.1, mode: 'systematic', targetRevisitSeconds: 2 });
      expect(await choose({ preset: 'medium' }), 'the Medium wedge').toMatchObject({ preset: 'medium', searchWidth: 40, dwellInterval: 1, mode: 'random' });
      expect(await choose({ preset: 'wide' }), 'the Wide wedge').toMatchObject({ preset: 'wide', searchWidth: 180, dwellInterval: 4, mode: 'random' });
      // A sensor saved with 2°, 20 km and 0.2 s, M7's Narrow wedge (criterion 65), shows Default when loaded; one saved
      // with M7's Narrow wedge and 5° keeps 5° and shows Custom. Loaded from a scenario file's sensor as M7 wrote it (no
      // mode), the path a saved sensor takes too. A value changed by hand makes the preset Custom (A4).
      const { mode: _mode, targetRevisitSeconds: _revisit, ...saved } = await settings();
      const m7Narrow = (extra: Record<string, unknown>) => ({ ...saved, preset: 'narrow', searchWidth: 2, dwellDepth: 20 * KM, dwellInterval: 0.2, ...extra });
      await simulator(server, '/scenario-state', { mode: 'merge', outputs: [], sensors: [{ platform: platform.entityId, settings: m7Narrow({}) }] });
      expect(await settings(), "M7's Narrow wedge loaded: Default").toMatchObject({ preset: 'default', searchWidth: 2, dwellDepth: 20 * KM, dwellInterval: 0.2, mode: 'random' });
      await simulator(server, '/scenario-state', { mode: 'merge', outputs: [], sensors: [{ platform: platform.entityId, settings: m7Narrow({ searchWidth: 5 }) }] });
      expect(await settings(), "M7's Narrow wedge with 5° loaded: Custom, 5° kept").toMatchObject({ preset: 'custom', searchWidth: 5 });
      await choose({ preset: 'default' });
      expect(await choose({ searchWidth: 3 }), 'a value changed by hand: Custom').toMatchObject({ preset: 'custom', searchWidth: 3 });
      await choose({ preset: 'narrow' });
      expect(await choose({ mode: 'random' }), 'the Narrow wedge switched to Random: Custom').toMatchObject({ preset: 'custom', mode: 'random', searchWidth: 1.7 });
    } finally {
      await all.close();
    }
  });
});

test('10 dwells a second at a dwell interval of 0.1 s (T-196; simulator criterion 56): a revisit of 10 s holds 100 dwells, 0.1 s apart, and the next revisit begins about 10 s later on the clock', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server }) => {
    const all = await everyWorkspace(server);
    try {
      const layerId = await simulation(server, all);
      const PLATFORM: LonLat = [17.3, 62.4];
      const platform = trackRequest(layerId, 'Radar', PLATFORM);
      await applied(all, platform);
      const [target] = direct([{ from: PLATFORM, azimuth: 30, metres: 80 * KM }]) as LonLat[];
      await applied(all, trackRequest(layerId, 'Target', target));
      await simulator(server, '/sensors', { platform: platform.entityId, create: true, revisitSeconds: 10, startBearing: 0, endBearing: 360, minRange: 20 * KM, maxRange: 150 * KM, ...RADAR, ...DEFAULT_VALUES, dwellInterval: 0.1 });
      expect((await sensorOf(server, platform.entityId)).settings.dwellInterval, '0.1 s').toBe(0.1);
      const watch = dwellWatch(server, platform.entityId);
      await simulator(server, '/routes/start', {});
      const { dwells, following, seenAt, followingSeenAt } = await watch.next('0.1 s', 60_000);
      const gaps = steps(dwells, following);
      const wall = (followingSeenAt - seenAt) / 1000;
      testInfo.annotations.push({ type: '0.1 s', description: `${dwells.length} dwells, steps ${JSON.stringify([...new Set(gaps.map((g) => +g.toFixed(3)))])} s, the next revisit first seen ${wall.toFixed(1)} s after this one` });
      expect(dwells, 'floor(10 s / 0.1 s) = 100 dwells').toHaveLength(100);
      expect(holding(dwells, [target]), 'one holds the target').toHaveLength(1);
      for (const [i, g] of gaps.entries()) expect(Math.abs(g - 0.1), `step ${i} is 0.1 s, not ${g} s`).toBeLessThanOrEqual(0.011);
      expect(Math.abs(wall - 10), 'on the clock: the next revisit about 10 s later (10 dwells a second)').toBeLessThanOrEqual(1.5);
      await simulator(server, '/routes/pause', {});
    } finally {
      await all.close();
    }
  });
});

test('the removed settings are not offered (criterion 66; T-196): Settings › Simulator has no "Most empty dwells per dwell with targets" and the Sensors panel no "Empty dwells"', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await everyWorkspace(server);
    try {
      const page = await open();
      await page.goto('/#settings/plugin/simulator');
      await expect(page.getByText('Dwell colour', { exact: true }).first(), 'the simulator settings shown').toBeVisible();
      await expect(page.getByText('Most empty dwells per dwell with targets'), 'no cap setting').toHaveCount(0);

      await page.goto('/');
      await switchToSimulation(page);
      const layerId = await simulation(server, all);
      const centre = await mapCentre(page);
      const at: Point = { x: centre.x - 40, y: centre.y + 20 };
      await applied(all, trackRequest(layerId, 'Hawk', await positionAt(page, at)));
      const form = await newSensor(page, at, 'Hawk');
      await expect(form.getByRole('textbox', { name: /^Dwell interval/ }), 'the dwell fields shown').toBeVisible();
      await expect(form.getByRole('textbox', { name: /^Empty dwells/ }), 'no Empty dwells field').toHaveCount(0);
      await expect(form.getByText(/^Empty dwells/), 'nor its label').toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath('sensor-form.png') });
    } finally {
      await all.close();
    }
  });
});
