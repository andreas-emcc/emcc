// Quick run: @plugin-map-view-2d @plugin-gmti @plugin-simulator @settings
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/flows/m7-display.spec.ts
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { direct, inverse } from '../../lib/geodesy.mjs';
import { createLayer, createSymbol, LiveClient, seededLayer } from '../../lib/live.mjs';
import { frameSymbol, mapCentre, mapPane, pixelsAround, positionAt, userPause, visibleMap, withM0, type LonLat, type Point } from '../../lib/m0';
import type { OwnServer } from '../../lib/own-server';
import { decodePng } from '../../lib/png.mjs';
import { freeUdpPort } from '../../lib/udp-peer.mjs';

// M7's display work in the combined system (T-182, T-181, T-183, T-186; SDK 1.6.0 parts C and D):
// gmti criteria 33 to 37 and map-view-2d functions 40 to 43. The GMTI data is the simulator's: a
// ground radar's reports go out through a gmti `out` link over UDP on loopback and come back through
// a gmti `in` link as View objects (as specs/flows/m5-sim-sensors.spec.ts makes them); the owner's
// recordings are not used. The Display window's "Areas" (Dwell areas, Sensor coverage, on by
// default), the pairing line's colour from Settings › gmti in a second browser, a pairing line whose
// far end is off screen (fetched by the map view, function 41), and its fade with the object that
// carries it (function 42). In the no-login mode every browser is the one local user, so "each
// user's own" is shown as the user's stored choice that a second browser of the same user follows;
// two users with different choices need a login (not in this file). Positions are [lon, lat],
// latitude ≠ longitude; every server is the test's own.

test.describe.configure({ timeout: 300_000 });

const SIMULATION = 'simulator.simulation';
const PAIRING = 'gmti.pairing';
/** "Within a second" (map-view-2d function 43), plus the time a screenshot of the map takes. */
const AT_ONCE_MS = 2_000;
/**
 * The Display window's switches: the time taken is annotated, the wait is generous. With many dwell areas a map
 * screenshot takes 0.1 to 2.8 s here (software rendering), so a 4 s wait held only a poll or two; PCA-map-view-2d
 * measured the classes back within 0.4 to 0.8 s (MCA, 2026-11-14).
 */
const SWITCH_MS = 10_000;

type State = Record<string, any>;
type Event = { entityType: string; entityId: string; operation: string; state: State | null };
type Rgb = readonly [number, number, number];

const MAGENTA: Rgb = [255, 0, 255];
const GREEN: Rgb = [0, 255, 0];
/** symbology's default sensor report dot (plugins/symbology/web/src/sensorReport.ts). */
const ORANGE: Rgb = [255, 128, 0];

const isYellow = ([r, g, b]: number[]) => r > 200 && g > 200 && b < 90;
const near = (colour: Rgb) => ([r, g, b]: number[]) => Math.abs(r - colour[0]) <= 40 && Math.abs(g - colour[1]) <= 40 && Math.abs(b - colour[2]) <= 40;

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

/** PUT a plugin's settings with `changes` over its stored values; resolves with the status. */
async function putSettings(server: OwnServer, plugin: string, changes: Record<string, unknown>): Promise<number> {
  const url = `${server.baseUrl}/api/settings/plugins/${plugin}`;
  const values = (await (await fetch(url)).json()).values;
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, ...changes }) });
  return response.status;
}

async function setSettings(server: OwnServer, plugin: string, changes: Record<string, unknown>): Promise<void> {
  expect(await putSettings(server, plugin, changes), `${plugin} settings ${JSON.stringify(changes)}`).toBe(200);
}

async function display(server: OwnServer): Promise<State> {
  return (await (await fetch(`${server.baseUrl}/api/display`)).json()).choices ?? {};
}

async function simulator(server: OwnServer, path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${server.baseUrl}/api/plugins/simulator${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  expect(response.status, `${path}: ${text}`).toBe(200);
  return text === '' ? null : JSON.parse(text);
}

/** An APP-6B friendly infantry track at a position. */
function trackRequest(layerId: string, name: string, at: LonLat) {
  const track = createSymbol(layerId, 0, { name }) as any;
  track.data.geometry.coordinates = at;
  track.data.symbol = { standard: 'APP-6B', sidc: 'SFGPUCI--------' };
  return track;
}

/** A Simulation layer and a runner far away, so that the sensors look (they look only while some route runs). */
async function simulation(all: LiveClient, server: OwnServer): Promise<string> {
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

/** How many pixels of the visible map match. */
async function inMap(page: Page, matches: (pixel: number[]) => boolean): Promise<number> {
  const box = await visibleMap(page);
  const image = decodePng(await page.screenshot({ clip: { x: box.x + 2, y: box.y + 2, width: box.width - 4, height: box.height - 4 } }));
  let n = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (matches(image.pixel(x, y))) n++;
  return n;
}

async function around(page: Page, at: Point, half: number, matches: (pixel: number[]) => boolean): Promise<number> {
  const image = await pixelsAround(page, at, half);
  let n = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (matches(image.pixel(x, y))) n++;
  return n;
}

/** How many pixels of a square round a point differ from `before` (the same square earlier) by more than 40 in some channel. */
async function changedFrom(page: Page, at: Point, half: number, before: Awaited<ReturnType<typeof pixelsAround>>): Promise<number> {
  const now = await pixelsAround(page, at, half);
  let n = 0;
  for (let y = 0; y < now.height; y++) {
    for (let x = 0; x < now.width; x++) {
      const a = now.pixel(x, y);
      const b = before.pixel(x, y);
      if (Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) > 40) n++;
    }
  }
  return n;
}

async function openDisplayWindow(page: Page) {
  await mapPane(page).getByRole('button', { name: 'Display settings', exact: true }).click();
  const window = page.getByRole('dialog', { name: 'Display settings', exact: true });
  await expect(window).toBeVisible();
  return window;
}

/**
 * gmti's shapes: the dwell areas by their data type gmti.dwell-area (from M7 RC2, owner TG A, CR-0042; from M8
 * one per dwell and without a name, T-195, owner YI A, UV A; by default full until 5 s and gone at 15 s, so only
 * the newest few show in full colour), the coverage of gmti.platform by its name.
 */
function shapes(all: LiveClient, kind: 'dwell' | 'coverage'): State[] {
  return (all.events as Event[])
    .filter((e) => e.state?.type === 'core.shape' && (kind === 'dwell' ? e.state?.dataType === 'gmti.dwell-area' : e.state?.dataType === 'gmti.platform' && e.state?.properties?.name === 'Hawk 1 coverage'))
    .map((e) => e.state!);
}

/**
 * Sets gmti's `detectionFade` (its other settings as they are) and returns what it was: turned off
 * (`fade` left out) for a test of the expiry fade. From M7 RC2 the detections fade in steps by it,
 * on by default, in place of their data type's expiry fade (CR-0042 point 3, owner TC A).
 */
async function setDetectionFade(server: { baseUrl: string }, fade?: unknown): Promise<unknown> {
  const url = `${server.baseUrl}/api/settings/plugins/gmti`;
  const values = (await (await fetch(url)).json()).values;
  const detectionFade = fade ?? { ...values.detectionFade, on: false };
  const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, detectionFade }) });
  expect(put.status, `gmti's detectionFade: ${await put.clone().text()}`).toBe(200);
  expect((await (await fetch(url)).json()).values.detectionFade, 'detectionFade stored').toEqual(detectionFade);
  return values.detectionFade;
}

test('the Areas through gmti (gmti criteria 33, 34, 36 and 37; map-view-2d function 40; T-181, T-182): a friend platform\'s dwell areas come in with a 2 px solid outline, no fill, in #7EF26A by default (#00A8DC with identity) and marked dwell-area, its coverage marked sensor-coverage, detections and platforms unmarked; fixed colours apply from the next dwell, a colour that is not #RRGGBB is refused; with no display setting of their own the user sees the dwell areas, the coverage and the pairing lines; the Display window\'s Areas switch them off and on, one class at a time, the detections and their lines staying, and the choice is the user\'s, followed by a second browser', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await everyWorkspace(server);
    try {
      const port = await freeUdpPort();
      await setSettings(server, 'gmti', {
        links: [
          { name: 'vista', mode: 'udp', direction: 'out', host: '127.0.0.1', port },
          { name: 'vista-in', mode: 'udp', direction: 'in', listen: { port }, platformIdentity: 'friend' },
        ],
      });
      const page = await open();
      const centre = await mapCentre(page);
      const P: Point = { x: centre.x - 220, y: centre.y + 40 };
      const targets: Point[] = [{ x: P.x + 230, y: P.y - 50 }, { x: P.x + 170, y: P.y + 90 }];
      const platformAt = await positionAt(page, P);
      expect(Math.abs(platformAt[0] - platformAt[1]), 'latitude ≠ longitude').toBeGreaterThan(1);
      const targetsAt: LonLat[] = [];
      for (const t of targets) targetsAt.push(await positionAt(page, t));
      const far = Math.max(...inverse(targetsAt.map((t) => [platformAt, t])).map((r: { metres: number }) => r.metres));
      // The job area: a box round both targets, clockwise from its north-west corner.
      const box = [{ x: P.x + 110, y: P.y - 130 }, { x: P.x + 330, y: P.y - 130 }, { x: P.x + 330, y: P.y + 190 }, { x: P.x + 110, y: P.y + 190 }];
      const corners: LonLat[] = [];
      for (const c of box) corners.push(await positionAt(page, c));

      const layerId = await simulation(all, server);
      const platform = trackRequest(layerId, 'Hawk 1', platformAt);
      await applied(all, platform);
      for (const [i, at] of targetsAt.entries()) await applied(all, trackRequest(layerId, `Target ${i + 1}`, at));
      await simulator(server, '/sensors', { platform: platform.entityId, create: true, revisitSeconds: 3, detectAll: true, maxRange: Math.ceil(far * 1.3), outputs: ['gmti/vista'] });
      await simulator(server, '/sensors', { platform: platform.entityId, jobArea: { type: 'Polygon', coordinates: [[...corners, corners[0]]] } });
      await simulator(server, '/routes/start', {});

      // Criteria 33 and 36: the dwell areas' look and marks, the coverage's mark; detections and platforms have none.
      await expect.poll(() => shapes(all, 'dwell').length, { timeout: 30_000, message: 'dwell areas through gmti' }).toBeGreaterThan(0);
      await expect.poll(() => shapes(all, 'coverage').length, { timeout: 30_000, message: 'the coverage through gmti' }).toBeGreaterThan(0);
      const dwell = shapes(all, 'dwell').at(-1)!;
      testInfo.annotations.push({ type: 'dwell area style', description: JSON.stringify(dwell.style) });
      expect(dwell.style.strokeWidth, 'a 2 px outline').toBe(2);
      expect([undefined, 'solid'], 'solid').toContain(dwell.style.strokeDash);
      expect(dwell.style.fillOpacity ?? 0, 'no fill').toBe(0);
      // From M8 the default colours are fixed (T-189, gmti criterion 41): #7EF26A and #BDCF3D, stored as fixed.
      expect(String(dwell.style.strokeColor).toUpperCase(), 'the dwell area in #7EF26A by default').toBe('#7EF26A');
      expect(String(shapes(all, 'coverage').at(-1)!.style.strokeColor).toUpperCase(), 'the coverage in #BDCF3D by default').toBe('#BDCF3D');
      const stored = (await (await fetch(`${server.baseUrl}/api/settings/plugins/gmti`)).json()).values;
      expect({ dwell: stored.dwellAreaColour?.use, coverage: stored.coverageColour?.use }, 'both fixed by default').toEqual({ dwell: 'fixed', coverage: 'fixed' });
      // identity can still be chosen (owner SV A): a friend platform's #00A8DC from the next dwell.
      await setSettings(server, 'gmti', { dwellAreaColour: { use: 'identity', colour: '#7EF26A' } });
      await expect.poll(() => String(shapes(all, 'dwell').at(-1)!.style.strokeColor).toUpperCase(), { timeout: 20_000, message: 'identity: a friend platform\'s #00A8DC' }).toBe('#00A8DC');
      expect(dwell.displayClass, 'a dwell area is marked').toBe('dwell-area');
      expect(shapes(all, 'coverage').at(-1)!.displayClass, 'the coverage is marked').toBe('sensor-coverage');
      await expect.poll(() => (all.events as Event[]).filter((e) => e.state?.dataType === 'gmti.detection').length, { timeout: 20_000, message: 'detections through gmti' }).toBeGreaterThan(1);
      const symbols = (all.events as Event[]).filter((e) => e.state?.type === 'core.symbol' && ['gmti.detection', 'gmti.platform'].includes(e.state?.dataType));
      expect(symbols.filter((e) => e.state!.displayClass !== undefined).map((e) => e.state!.dataType), 'detections and platforms carry no display class').toEqual([]);

      // Criterion 34: fixed colours from the next dwell and the next coverage write; not #RRGGBB is refused.
      expect(await putSettings(server, 'gmti', { dwellAreaColour: { use: 'fixed', colour: '#FF00F' } }), 'not #RRGGBB').toBe(400);
      await setSettings(server, 'gmti', { dwellAreaColour: { use: 'fixed', colour: '#FF00FF' }, coverageColour: { use: 'fixed', colour: '#00FF00' } });
      await expect.poll(() => String(shapes(all, 'dwell').at(-1)!.style.strokeColor).toUpperCase(), { timeout: 20_000, message: 'the next dwell area in #FF00FF' }).toBe('#FF00FF');
      await expect.poll(() => String(shapes(all, 'coverage').at(-1)!.style.strokeColor).toUpperCase(), { timeout: 45_000, message: 'the coverage in #00FF00 (re-sent at least every 30 s)' }).toBe('#00FF00');

      // Criterion 37: no display setting of the user's own; the dwell areas, the coverage and the pairing lines show.
      expect(await display(server), 'no display setting of the user\'s own').toEqual({});
      const magenta = () => inMap(page, near(MAGENTA));
      const green = () => inMap(page, near(GREEN));
      const lines = () => inMap(page, isYellow);
      const dots = () => around(page, targets[0], 12, near(ORANGE));
      await page.mouse.move(centre.x + 300, centre.y + 250);
      await expect.poll(magenta, { timeout: 20_000, message: 'the dwell areas show' }).toBeGreaterThan(30);
      await expect.poll(green, { timeout: 20_000, message: 'the coverage shows' }).toBeGreaterThan(30);
      await expect.poll(lines, { timeout: 10_000, message: 'the pairing lines show (gmti.pairing on by default)' }).toBeGreaterThan(20);
      // As the areas: under load the next report may come after 10 s (seen once in the ITA's M7 run, 2026-11-12).
      await expect.poll(dots, { timeout: 20_000, message: 'a detection at its target' }).toBeGreaterThan(20);
      await page.screenshot({ path: testInfo.outputPath('areas-on.png') });

      // The Display window: Relations' GMTI Pairing and Areas' two switches, all on.
      const window = await openDisplayWindow(page);
      const areas = window.getByRole('region', { name: 'Areas', exact: true });
      const dwellAreas = areas.getByRole('checkbox', { name: 'Dwell areas', exact: true });
      const coverage = areas.getByRole('checkbox', { name: 'Sensor coverage', exact: true });
      await expect(areas.getByRole('checkbox'), 'Areas: the two classes').toHaveCount(2);
      await expect(dwellAreas, 'Dwell areas on by default').toBeChecked();
      await expect(coverage, 'Sensor coverage on by default').toBeChecked();
      await expect(window.getByRole('region', { name: 'Relations', exact: true }).getByRole('checkbox', { name: 'GMTI Pairing', exact: true }), 'GMTI Pairing on by default').toBeChecked();

      // Dwell areas off: they go at once; the coverage, the detections and their lines stay.
      await dwellAreas.uncheck();
      let since = Date.now();
      await expect.poll(magenta, { timeout: SWITCH_MS, message: 'no dwell area' }).toBeLessThanOrEqual(3);
      testInfo.annotations.push({ type: 'dwell areas off after', description: `${Date.now() - since} ms` });
      expect(await green(), 'the coverage stays').toBeGreaterThan(30);
      expect(await lines(), 'the pairing lines stay').toBeGreaterThan(20);
      await expect.poll(dots, { timeout: 10_000, message: 'the detections stay' }).toBeGreaterThan(20);
      await expect.poll(async () => (await display(server)).classes?.['dwell-area'], { message: 'stored as the user\'s choice' }).toBe(false);
      expect((await display(server)).classes?.['sensor-coverage'] ?? true, 'Sensor coverage still on').toBe(true);
      await page.waitForTimeout(4_000); // more than a revisit: new dwell areas come and stay hidden; the absence is the check
      expect(await magenta(), 'new dwell areas hidden too').toBeLessThanOrEqual(3);
      expect(shapes(all, 'dwell').length, 'not deleted: still coming in').toBeGreaterThan(1);

      // The user's choice in a second browser of the same user.
      const other = await open();
      await other.mouse.move(centre.x + 300, centre.y + 250);
      await expect.poll(() => inMap(other, near(GREEN)), { timeout: 20_000, message: 'the second browser: the coverage' }).toBeGreaterThan(30);
      expect(await inMap(other, near(MAGENTA)), 'the second browser: no dwell area').toBeLessThanOrEqual(3);

      // Sensor coverage off as well, then both back.
      await coverage.uncheck();
      await expect.poll(green, { timeout: SWITCH_MS, message: 'no coverage' }).toBeLessThanOrEqual(3);
      expect(await lines(), 'the pairing lines stay').toBeGreaterThan(20);
      await dwellAreas.check();
      since = Date.now();
      await expect.poll(magenta, { timeout: SWITCH_MS, message: 'the dwell areas back' }).toBeGreaterThan(30);
      testInfo.annotations.push({ type: 'dwell areas on after', description: `${Date.now() - since} ms` });
      expect(await green(), 'the coverage still off').toBeLessThanOrEqual(3);
      await coverage.check();
      since = Date.now();
      await expect.poll(green, { timeout: SWITCH_MS, message: 'the coverage back' }).toBeGreaterThan(30);
      testInfo.annotations.push({ type: 'coverage on after', description: `${Date.now() - since} ms (screenshots included)` });
      await expect.poll(async () => { const c = (await display(server)).classes ?? {}; return [c['dwell-area'] ?? true, c['sensor-coverage'] ?? true]; }, { message: 'stored: both on' }).toEqual([true, true]);
      await simulator(server, '/routes/pause', {});
    } finally {
      await all.close();
    }
  });
});

/** A plain frame at a pixel, of a data type, with relations if given; resolves with its request. */
async function objectAt(page: Page, live: LiveClient, layerId: string, at: Point | LonLat, identity: 'friend' | 'hostile', extra: Record<string, unknown> = {}) {
  const position = Array.isArray(at) ? at : await positionAt(page, at);
  const request = frameSymbol(layerId, position, identity) as any;
  Object.assign(request.data, extra);
  await applied(live, request);
  return request;
}

/** The yellow pixels on the middle third of the segment between two points. */
async function lineBetween(page: Page, from: Point, to: Point, matches: (pixel: number[]) => boolean = isYellow): Promise<number> {
  const mid = { x: Math.round((from.x + to.x) / 2), y: Math.round((from.y + to.y) / 2) };
  const half = Math.ceil(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) / 6);
  return around(page, mid, half, matches);
}

test('the pairing colour from Settings › gmti (gmti criterion 35, map-view-2d function 43, T-181): gmti.pairing is on by default; a colour set with the colour picker\'s hex in Settings › gmti in one browser redraws the line in a second browser within a second, without a reload; a value that is not #RRGGBB is refused', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, live, snapshot, open }) => {
    const layer = seededLayer(snapshot);
    const viewer = await open();
    const loads = { count: 0 };
    viewer.on('load', () => loads.count++);
    const centre = await mapCentre(viewer);
    const detectionAt = { x: centre.x - 150, y: centre.y + 80 };
    const platformAt = { x: centre.x + 100, y: centre.y - 90 };
    const platform = await objectAt(viewer, live, layer, platformAt, 'friend', { dataType: 'gmti.platform' });
    await objectAt(viewer, live, layer, detectionAt, 'hostile', { relations: [{ kind: PAIRING, objectId: platform.entityId }] });
    await viewer.mouse.move(centre.x + 300, centre.y + 250);

    // On by default (the manifest's defaultOn, gmti criterion 35): no display setting, the line yellow.
    expect(await display(server), 'no display setting of the user\'s own').toEqual({});
    await expect.poll(() => lineBetween(viewer, detectionAt, platformAt), { timeout: 10_000, message: 'the pairing line, yellow, by default' }).toBeGreaterThan(10);

    // Settings › gmti in another browser: the colour picker shows the hex; a new hex saved.
    const admin = await open();
    await admin.goto('/#settings/plugin/gmti');
    const form = admin.getByRole('tabpanel').last();
    const hex = form.getByRole('textbox', { name: 'Pairing line colour', exact: true });
    const picker = form.getByLabel('Pairing line colour: pick a colour', { exact: true });
    await expect(hex).toHaveValue('#FFFF00');
    await expect(picker, 'a colour picker beside the hex').toHaveAttribute('type', 'color');
    await expect(picker).toHaveValue('#ffff00');
    expect(await putSettings(server, 'gmti', { pairingColour: '#FF00F' }), 'not #RRGGBB, refused by the settings schema').toBe(400);
    await hex.fill('#FF00FF');
    await expect(picker, 'the picker follows the hex').toHaveValue('#ff00ff');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    const since = Date.now();
    await expect(form.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    await expect.poll(() => lineBetween(viewer, detectionAt, platformAt, near(MAGENTA)), { timeout: AT_ONCE_MS, message: 'the line in #FF00FF within a second' }).toBeGreaterThan(10);
    testInfo.annotations.push({ type: 'new colour after', description: `${Date.now() - since} ms from Saved.` });
    expect(await lineBetween(viewer, detectionAt, platformAt), 'no yellow left').toBe(0);
    expect(loads.count, 'no reload').toBe(0);
    expect((await (await fetch(`${server.baseUrl}/api/settings/plugins/gmti`)).json()).values.pairingColour, 'stored').toBe('#FF00FF');
  });
});

/** Zooms in until the visible map's east edge is 100 to 400 km from `from`. */
async function zoomToEdge(page: Page, from: LonLat): Promise<number> {
  let metres = 0;
  for (let i = 0; i < 12; i++) {
    const box = await visibleMap(page);
    const edge = await positionAt(page, { x: box.x + box.width - 10, y: box.y + box.height / 2 });
    metres = inverse([[from, edge]])[0].metres;
    if (metres >= 100_000 && metres <= 400_000) return metres;
    await mapPane(page).getByTitle(metres > 400_000 ? 'Zoom in' : 'Zoom out').click();
    await userPause(page);
  }
  throw new Error(`the map does not come to 100 to 400 km: ${metres} m`);
}

test('a pairing line with its far end off screen (map-view-2d function 41, T-183): the platform 1 500 km away is not on the map, the line runs from the detection towards it, follows it when it moves (about 2 s late) and goes when it is deleted', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const layer = seededLayer(snapshot);
    const page = await open();
    let centre = await mapCentre(page);
    const centreAt = await positionAt(page, centre);
    const edge = await zoomToEdge(page, centreAt);
    centre = await mapCentre(page);
    const D: Point = { x: centre.x - 150, y: centre.y + 40 };
    const detectionAt = await positionAt(page, D);
    expect(Math.abs(detectionAt[0] - detectionAt[1]), 'latitude ≠ longitude').toBeGreaterThan(1);
    testInfo.annotations.push({ type: 'map', description: `east edge ${Math.round(edge / 1000)} km from the centre` });
    const [east, north] = direct([{ from: detectionAt, azimuth: 90, metres: 1_500_000 }, { from: detectionAt, azimuth: 0, metres: 1_500_000 }]) as LonLat[];
    const platform = await objectAt(page, live, layer, east, 'friend', { dataType: 'gmti.platform', properties: { name: 'Far platform' } });
    const created = (await live.getObjects([platform.entityId])).found[0];
    await objectAt(page, live, layer, D, 'hostile', { relations: [{ kind: PAIRING, objectId: platform.entityId }] });
    await page.mouse.move(centre.x, centre.y + 250);

    // East: along the line's first 250 px, at its start the geodesic leaves eastwards.
    const eastward = () => around(page, { x: D.x + 150, y: D.y }, 25, isYellow);
    const northward = () => around(page, { x: D.x, y: D.y - 150 }, 25, isYellow);
    await expect.poll(eastward, { timeout: 10_000, message: 'the line towards the far platform, east' }).toBeGreaterThan(5);
    expect(await northward(), 'none north').toBe(0);
    await page.screenshot({ path: testInfo.outputPath('far-east.png') });

    // The far platform moves north: the line follows within about 2 s (it is fetched every 2 s).
    const { id, version, meta: _meta, ...data } = created;
    await applied(live, { requestId: randomUUID(), entityType: 'object', operation: 'update', entityId: id, baseVersion: version, data: { ...data, geometry: { type: 'Point', coordinates: north } }, source: { plugin: 'ita-test' } } as any);
    const moved = Date.now();
    await expect.poll(northward, { timeout: 2_000 + 2_000 + AT_ONCE_MS, message: 'the line follows it north' }).toBeGreaterThan(5);
    testInfo.annotations.push({ type: 'followed after', description: `${Date.now() - moved} ms` });
    expect(await eastward(), 'none east any more').toBe(0);

    // Deleted: the line goes.
    await applied(live, { requestId: randomUUID(), entityType: 'object', operation: 'delete', entityId: id, source: { plugin: 'ita-test' } } as any);
    await expect.poll(northward, { timeout: 2_000 + 2_000 + AT_ONCE_MS, message: 'no line to a deleted object' }).toBe(0);
  });
});

test('a pairing line fades with the object that carries it (map-view-2d function 42, T-186): with gmti.detection expiring 4 s after its observation the detection and its line fade together, still drawn; a platform that fades does not fade the line of a detection that does not; a deleted detection takes its line', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, live, snapshot, open }) => {
    for (const dataType of ['gmti.detection', 'gmti.platform']) {
      const behaviour = await fetch(`${server.baseUrl}/api/settings/data-types/${dataType}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fadeWhenExpired: true, expiresAfterSeconds: 4, removeAfterExpirySeconds: 120 }),
      });
      expect(behaviour.status, `${dataType}'s behaviour: ${await behaviour.clone().text()}`).toBe(200);
    }
    // The expiry fade is tested here: gmti's stepped detection fade off, restored at the end.
    const detectionFade = await setDetectionFade(server);
    const layer = seededLayer(snapshot);
    const page = await open();
    const centre = await mapCentre(page);
    const rest = { x: centre.x + 300, y: centre.y + 250 };
    // Two pairs side by side: A, the detection fades; B, the platform fades.
    const a = { detection: { x: centre.x - 260, y: centre.y + 80 }, platform: { x: centre.x - 120, y: centre.y - 80 } };
    const b = { detection: { x: centre.x + 20, y: centre.y + 80 }, platform: { x: centre.x + 160, y: centre.y - 80 } };
    const middle = (p: typeof a) => ({ x: Math.round((p.detection.x + p.platform.x) / 2), y: Math.round((p.detection.y + p.platform.y) / 2) });
    await page.mouse.move(rest.x, rest.y);
    const groundA = await pixelsAround(page, middle(a), 20);

    const observed = { observed: new Date().toISOString() };
    const platformA = await objectAt(page, live, layer, a.platform, 'friend');
    const detectionA = await objectAt(page, live, layer, a.detection, 'hostile', { dataType: 'gmti.detection', time: observed, relations: [{ kind: PAIRING, objectId: platformA.entityId }] });
    const platformB = await objectAt(page, live, layer, b.platform, 'friend', { dataType: 'gmti.platform', time: observed });
    const detectionB = await objectAt(page, live, layer, b.detection, 'hostile', { relations: [{ kind: PAIRING, objectId: platformB.entityId }] });
    await page.mouse.move(rest.x, rest.y);
    const yellowA = () => around(page, middle(a), 20, isYellow);
    const yellowB = () => around(page, middle(b), 20, isYellow);
    await expect.poll(yellowA, { timeout: AT_ONCE_MS + 2_000, message: 'A\'s line, full yellow' }).toBeGreaterThan(10);
    await expect.poll(yellowB, { timeout: AT_ONCE_MS + 2_000, message: 'B\'s line, full yellow' }).toBeGreaterThan(10);
    const drawnA = await changedFrom(page, middle(a), 20, groundA);

    // After 4 s: A's detection and line are faded (no full yellow left), still drawn; B's line stays full.
    await expect.poll(() => around(page, a.detection, 12, near(ORANGE)), { timeout: 15_000, message: 'A\'s detection faded' }).toBe(0);
    await expect.poll(yellowA, { timeout: AT_ONCE_MS, message: 'A\'s line faded with it' }).toBe(0);
    expect(await changedFrom(page, middle(a), 20, groundA), 'A\'s line still drawn, faded').toBeGreaterThan(Math.min(5, drawnA / 4));
    expect((await live.getObjects([platformB.entityId])).found, 'B\'s platform not removed').toHaveLength(1);
    expect(await yellowB(), 'B\'s line: its platform\'s fade does not fade it').toBeGreaterThan(10);
    testInfo.annotations.push({ type: 'A line pixels', description: `${drawnA} drawn, ${await changedFrom(page, middle(a), 20, groundA)} after the fade` });

    // B's detection deleted: its line goes with it.
    await applied(live, { requestId: randomUUID(), entityType: 'object', operation: 'delete', entityId: detectionB.entityId, source: { plugin: 'ita-test' } } as any);
    await expect.poll(yellowB, { timeout: AT_ONCE_MS, message: 'the line goes with its detection' }).toBe(0);
    expect((await live.getObjects([detectionA.entityId])).found, 'A still stored').toHaveLength(1);
    await setDetectionFade(server, detectionFade);
  });
});
