// Quick run: @plugin-gmti @plugin-map-view-2d @plugin-simulator @settings
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/flows/m8-gmti-fade.spec.ts
import { expect, test, type Page } from '@playwright/test';
import { inverse } from '../../lib/geodesy.mjs';
import { createLayer, createSymbol, LiveClient } from '../../lib/live.mjs';
import { mapCentre, mapPane, pixelsAround, positionAt, visibleMap, withM0, type LonLat, type Point } from '../../lib/m0';
import type { OwnServer } from '../../lib/own-server';
import { decodePng } from '../../lib/png.mjs';
import { freeUdpPort } from '../../lib/udp-peer.mjs';

// gmti's stepped fade end to end (T-192, CR-0042 option A; T-195; the owner's TI A, M8), in the browser: the
// simulator's ground radar sends through a gmti `out` link over UDP on loopback, a gmti `in` link writes the
// platform, its coverage, a dwell area per dwell and the detections into View, and the map view draws each by
// its data type's fade setting (`fadeSetting`: gmti's `detectionFade` and `dwellAreaFade`). The checks read the
// map's pixels against the ground before the objects came: full colour, the colour at about half over the
// ground, or nothing. Each object's age is counted from its `time.observed`, on the same machine's clock.
// A changed setting reaches a map already open within 1 s, without a reload (gmti criterion 40). The dwell
// areas are kept few here, a dwell every 0.5 s and a short run: on this machine's software renderer the map
// draws slowly with many (the ITA's finding of 2026-11-14). Positions are [lon, lat], latitude ≠ longitude; every server is the test's own.

test.describe.configure({ timeout: 300_000 });

const SIMULATION = 'simulator.simulation';
/** "Within 1 s" (gmti criterion 40), plus the time a screenshot of the map takes. */
const AT_ONCE_MS = 2_500;
/**
 * A step reached by age is drawn at the map view's update cadence: it checks the clock "about once a second"
 * (map-view-2d README, the fade in steps, `nextFadeStep`), so a step at 10 s may show at 11 s, later under load,
 * where a map screenshot can take 2 to 3 s. The checks start 1.5 s after a step and poll until 7 s after it,
 * well before the next (MCA's full run, 2026-11-14: polled from 10.5 s for 2.5 s, it failed 3 of 4 runs).
 */
const STEP_LATE_S = 1.5;
const STEP_UNTIL_S = 7;

/** Waits until `STEP_LATE_S` after the step at `step` s of `observed`'s age; gives the poll's timeout, until `STEP_UNTIL_S` after it. */
async function afterStep(page: Page, observed: string, step: number): Promise<number> {
  await untilAge(page, observed, step + STEP_LATE_S);
  return Math.max(1_000, Date.parse(observed) + (step + STEP_UNTIL_S) * 1000 - Date.now());
}
/** A fade quick enough to watch (gmti criterion 40): fully drawn until 10 s, 50 % from 10 s, gone from 20 s. */
const QUICK_FADE = { on: true, fromSeconds: 0, stepPercent: 50, invisibleAtSeconds: 20 };

type State = Record<string, any>;
type Event = { entityType: string; entityId: string; operation: string; state: State | null; by?: { plugin?: string } };
type Rgb = readonly [number, number, number];
type Image = Awaited<ReturnType<typeof pixelsAround>>;

/** symbology's default sensor report dot (plugins/symbology/web/src/sensorReport.ts). */
const ORANGE: Rgb = [255, 128, 0];
/** From M8 the default colours (T-189): the dwell areas and the coverage. */
const DWELL: Rgb = [0x7e, 0xf2, 0x6a];
const COVERAGE: Rgb = [0xbd, 0xcf, 0x3d];

const near = (colour: Rgb, tolerance = 40) => (p: number[]) => Math.abs(p[0] - colour[0]) <= tolerance && Math.abs(p[1] - colour[1]) <= tolerance && Math.abs(p[2] - colour[2]) <= tolerance;

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

async function setSettings(server: OwnServer, plugin: string, changes: Record<string, unknown>): Promise<void> {
  const url = `${server.baseUrl}/api/settings/plugins/${plugin}`;
  const values = (await (await fetch(url)).json()).values;
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, ...changes }) });
  expect(response.status, `${plugin} settings ${JSON.stringify(changes)}: ${await response.clone().text()}`).toBe(200);
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

/** The visible map as an image (inside its frame). */
async function mapImage(page: Page): Promise<Image> {
  const box = await visibleMap(page);
  return decodePng(await page.screenshot({ clip: { x: box.x + 2, y: box.y + 2, width: box.width - 4, height: box.height - 4 } })) as Image;
}

/**
 * How the image draws `colour` against the ground (the same place before anything came): `full` pixels in the
 * colour (within `fullTolerance`), `half` pixels at about half of it over their own ground (the 50 % step), `changed` pixels off the
 * ground at all.
 */
function drawn(now: Image, ground: Image, colour: Rgb, fullTolerance = 40): { full: number; half: number; changed: number } {
  let full = 0;
  let half = 0;
  let changed = 0;
  const isFull = near(colour, fullTolerance);
  for (let y = 0; y < now.height; y++) {
    for (let x = 0; x < now.width; x++) {
      const p = now.pixel(x, y);
      const g = ground.pixel(x, y);
      const off = Math.max(Math.abs(p[0] - g[0]), Math.abs(p[1] - g[1]), Math.abs(p[2] - g[2]));
      if (off > 20) changed++;
      if (isFull(p)) full++;
      else if (off > 20 && [0, 1, 2].every((c) => Math.abs(p[c] - (g[c] + colour[c]) / 2) <= 25)) half++;
    }
  }
  return { full, half, changed };
}

/** Waits until `ms` after `observed` (an ISO time), at once if that has passed. */
async function untilAge(page: Page, observed: string, seconds: number): Promise<void> {
  const wait = Date.parse(observed) + seconds * 1000 - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
}

/** The gmti loop, a platform with a ground radar and a target in view, and the ground before them; `sensor` adds settings from the distance to the target. */
async function radarInView(server: OwnServer, all: LiveClient, page: Page, sensor: (far: number) => Record<string, unknown> = () => ({})) {
  const port = await freeUdpPort();
  await setSettings(server, 'gmti', {
    links: [
      { name: 'vista', mode: 'udp', direction: 'out', host: '127.0.0.1', port },
      { name: 'vista-in', mode: 'udp', direction: 'in', listen: { port }, platformIdentity: 'friend' },
    ],
  });
  const centre = await mapCentre(page);
  const P: Point = { x: centre.x - 220, y: centre.y + 40 };
  const T: Point = { x: P.x + 230, y: P.y - 50 };
  const platformAt = await positionAt(page, P);
  const targetAt = await positionAt(page, T);
  expect(Math.abs(platformAt[0] - platformAt[1]), 'latitude ≠ longitude').toBeGreaterThan(1);
  const far = inverse([[platformAt, targetAt]])[0].metres;
  await page.mouse.move(centre.x + 300, centre.y + 250);
  const ground = await mapImage(page);
  const targetGround = await pixelsAround(page, T, 12);
  const layerId = await simulation(all, server);
  const platform = trackRequest(layerId, 'Hawk 1', platformAt);
  await applied(all, platform);
  await applied(all, trackRequest(layerId, 'Target 1', targetAt));
  await simulator(server, '/sensors', { platform: platform.entityId, create: true, revisitSeconds: 3, detectAll: true, rangeError: 0, crossRangeError: 0, maxRange: Math.ceil(far * 1.3), outputs: ['gmti/vista'], ...sensor(far) });
  // A job area round the target, as in m7-display: the coverage is drawn as it, its name at its middle, away from the dot.
  const corners: LonLat[] = [];
  for (const c of [{ x: P.x + 110, y: P.y - 130 }, { x: P.x + 330, y: P.y - 130 }, { x: P.x + 330, y: P.y + 190 }, { x: P.x + 110, y: P.y + 190 }]) corners.push(await positionAt(page, c));
  await simulator(server, '/sensors', { platform: platform.entityId, jobArea: { type: 'Polygon', coordinates: [[...corners, corners[0]]] } });
  return { T, ground, targetGround };
}

function gmtiEvents(all: LiveClient, dataType: string): Event[] {
  return (all.events as Event[]).filter((e) => e.state?.dataType === dataType);
}

/** The creates of a data type once none has come for `quietMs`: a revisit under way still sends after a pause. */
async function settled(all: LiveClient, dataType: string, quietMs = 3_000): Promise<Event[]> {
  const creates = () => gmtiEvents(all, dataType).filter((e) => e.operation === 'create');
  let count = -1;
  let since = Date.now();
  await expect
    .poll(() => {
      const n = creates().length;
      if (n !== count) {
        count = n;
        since = Date.now();
      }
      return Date.now() - since >= quietMs;
    }, { timeout: 30_000, intervals: [250], message: `no new ${dataType} for ${quietMs} ms` })
    .toBe(true);
  return creates();
}

test('a detection fades in steps and follows a changed fade at once (gmti criteria 38 and 40; T-192): drawn fully at first; with detectionFade changed to 0 s, 50 % and 20 s it is drawn at about half within 1 s from 10 s after its time and not at all from 20 s, still stored; with "on" false drawn fully again', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await everyWorkspace(server);
    try {
      const stored = (await (await fetch(`${server.baseUrl}/api/settings/plugins/gmti`)).json()).values;
      expect(stored.detectionFade, 'the default detection fade').toEqual({ on: true, fromSeconds: 10, stepPercent: 5, invisibleAtSeconds: 100 });
      const page = await open();
      // The dwell areas hidden by the user's display switch (map-view-2d function 40): a dwell holding the target
      // has its outline near the dot, and the areas fade by their own setting.
      await mapPane(page).getByRole('button', { name: 'Display settings', exact: true }).click();
      const window = page.getByRole('dialog', { name: 'Display settings', exact: true });
      await window.getByRole('region', { name: 'Areas', exact: true }).getByRole('checkbox', { name: 'Dwell areas', exact: true }).uncheck();
      await page.keyboard.press('Escape');
      await expect(window, 'the Display window closed').toHaveCount(0);
      const { T, targetGround } = await radarInView(server, all, page);
      const dot = async () => {
        const now = await pixelsAround(page, T, 12);
        return drawn(now as Image, targetGround as Image, ORANGE);
      };
      await simulator(server, '/routes/start', {});
      await expect.poll(async () => (await dot()).full, { timeout: 20_000, message: 'the detection, in full colour' }).toBeGreaterThan(20);
      // No new detection after these: the newest one's age is the dot's.
      await simulator(server, '/routes/pause', {});
      const detections = await settled(all, 'gmti.detection');
      const newest = detections.map((e) => e.state!.time.observed as string).sort().at(-1)!;
      testInfo.annotations.push({ type: 'detections', description: `${detections.length}, the newest observed ${newest}` });

      // Criterion 38's first step with the defaults: fully drawn until 10 s.
      expect((await dot()).full, 'the defaults: fully drawn before 10 s').toBeGreaterThan(20);

      // Criterion 40: changed at 12 s (the defaults still draw it fully then, 95 % only from 14.5 s): about half within 1 s.
      await untilAge(page, newest, 12);
      expect((await dot()).full, 'the defaults at 12 s: still fully drawn').toBeGreaterThan(20);
      await setSettings(server, 'gmti', { detectionFade: QUICK_FADE });
      const changed = Date.now();
      await expect.poll(async () => { const d = await dot(); return d.full <= 3 && d.half > 10; }, { timeout: AT_ONCE_MS, message: 'about half within 1 s of the change' }).toBe(true);
      testInfo.annotations.push({ type: 'half after the change', description: `${Date.now() - changed} ms, ${JSON.stringify(await dot())}` });

      // Gone from 20 s, still stored.
      await expect.poll(async () => (await dot()).changed, { timeout: await afterStep(page, newest, 20), message: 'not drawn from 20 s' }).toBeLessThanOrEqual(3);
      await page.screenshot({ path: testInfo.outputPath('at-20s.png') });
      testInfo.annotations.push({ type: 'from 20 s', description: JSON.stringify(await dot()) });
      const ids = detections.map((e) => e.entityId);
      expect((await all.getObjects(ids)).found.length, 'still stored: its data type removes it, not the fade').toBe(ids.length);

      // "on" false: drawn fully, with the data type's expiry fade (not expired yet).
      await setSettings(server, 'gmti', { detectionFade: { ...QUICK_FADE, on: false } });
      await expect.poll(async () => (await dot()).full, { timeout: AT_ONCE_MS, message: 'drawn fully with the fade off' }).toBeGreaterThan(20);
      await page.screenshot({ path: testInfo.outputPath('fade-off.png') });
    } finally {
      await all.close();
    }
  });
});

type Band = { type?: string; center: LonLat; innerRadius: number; outerRadius: number; startBearing: number; endBearing: number };

/** A band's width in degrees, clockwise from its start bearing to its end. */
function width(band: Band): number {
  return (((band.endBearing - band.startBearing) % 360) + 360) % 360;
}

/**
 * The areas' fade for this test (gmti criterion 39): fully drawn until 5 s, 50 % from 5 s, not drawn from 10 s, so that
 * each step can be seen before the data type removes the areas from 15 s.
 */
const AREA_FADE = { on: true, fromSeconds: 0, stepPercent: 50, invisibleAtSeconds: 10 };

test('every dwell its own area, fading in steps from its dwell (gmti criteria 27, 39 and 41; T-195, T-192; owner YI A): with 1.7° dwells each dwell writes its own area, a 1.7° wedge (D27 0.85°) with its own range band as the simulator\'s dwell, created once, never updated or deleted by gmti, without a name; by default dwellAreaFade is full until 5 s, 5 % steps, gone at 15 s, and gmti.dwell-area expires 15 s after the dwell, not faded; with dwellAreaFade at 0 s, 50 % and 10 s they are drawn fully, then at about half from 5 s, then not at all from 10 s, still stored, while the coverage stays in full colour; they are removed from 15 s', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await everyWorkspace(server);
    try {
      // The defaults (owner, 2026-11-16): the areas full until 5 s and gone at 15 s, removed at 15 s; the detections' fade as before.
      const type = await (await fetch(`${server.baseUrl}/api/settings/data-types/gmti.dwell-area`)).json();
      testInfo.annotations.push({ type: 'gmti.dwell-area', description: JSON.stringify(type) });
      expect(type.defaults, 'the data type\'s defaults (owner YI A)').toMatchObject({ expiresAfterSeconds: 15, fadeWhenExpired: false, removeAfterExpirySeconds: 0 });
      const stored = (await (await fetch(`${server.baseUrl}/api/settings/plugins/gmti`)).json()).values;
      expect(stored.dwellAreaFade, 'the default dwell area fade').toEqual({ on: true, fromSeconds: 5, stepPercent: 5, invisibleAtSeconds: 15 });
      expect(stored.detectionFade, 'the detections\' fade unchanged').toEqual({ on: true, fromSeconds: 10, stepPercent: 5, invisibleAtSeconds: 100 });
      await setSettings(server, 'gmti', { dwellAreaFade: AREA_FADE });
      const page = await open();
      // 1.7° wide as the Narrow wedge, a third of the way to the target deep, one dwell every 0.5 s: six a revisit.
      const { ground } = await radarInView(server, all, page, (far) => ({ searchWidth: 1.7, dwellDepth: Math.max(1_000, Math.round(far / 3)), dwellInterval: 0.5 }));
      await simulator(server, '/routes/start', {});
      // A short run, so that the areas' ages lie close together.
      await expect.poll(() => new Set(gmtiEvents(all, 'gmti.dwell-area').filter((e) => e.operation === 'create').map((e) => e.entityId)).size, { timeout: 30_000, intervals: [100], message: 'three dwell areas' }).toBeGreaterThanOrEqual(3);
      await simulator(server, '/routes/pause', {});
      await settled(all, 'gmti.dwell-area', 1_500);
      const plan = ((await simulator(server, '/sensors/dwells')).sensors as Array<{ dwells: Array<{ index: number; revisit: number; time: string; area: Band }> }>).flatMap((x) => x.dwells);

      // Criterion 27: every dwell its own area, written once by gmti and never updated or deleted by it; no name.
      const areas = gmtiEvents(all, 'gmti.dwell-area');
      const created = areas.filter((e) => e.operation === 'create');
      const ids = new Set(created.map((e) => e.entityId));
      const g = (e: Event) => e.state!.extensions?.gmti ?? {};
      const bandOf = (e: Event) => e.state!.geometry as Band;
      const keys = created.map((e) => `${g(e).revisitIndex}/${g(e).dwellIndex}/${e.state!.time.observed}`);
      testInfo.annotations.push({
        type: 'dwell areas (revisit/dwell: start, width, inner to outer m)',
        description: created.map((e) => `${g(e).revisitIndex}/${g(e).dwellIndex}: ${bandOf(e).startBearing.toFixed(3)}°, ${width(bandOf(e)).toFixed(3)}°, ${Math.round(bandOf(e).innerRadius)} to ${Math.round(bandOf(e).outerRadius)}`).join('; '),
      });
      testInfo.annotations.push({ type: 'the simulator\'s drawn dwells (revisit/index: start, width, inner to outer m)', description: plan.map((d) => `${d.revisit}/${d.index}: ${d.area.startBearing.toFixed(3)}°, ${width(d.area).toFixed(3)}°, ${Math.round(d.area.innerRadius)} to ${Math.round(d.area.outerRadius)}`).join('; ') });
      expect(created.length, 'each area created once').toBe(ids.size);
      expect(new Set(keys).size, 'one area per dwell').toBe(created.length);
      expect(areas.filter((e) => e.operation !== 'create' && e.by?.plugin === 'gmti').map((e) => e.operation), 'never updated or deleted by gmti').toEqual([]);
      expect((all.events as Event[]).filter((e) => e.operation === 'delete' && ids.has(e.entityId)), 'none deleted yet').toEqual([]);
      expect(created.filter((e) => (e.state!.properties?.name ?? '') !== '').map((e) => e.state!.properties.name), 'no names').toEqual([]);
      expect([...new Set(created.map((e) => String(e.state!.style?.strokeColor).toUpperCase()))], 'criterion 41: #7EF26A by default').toEqual(['#7EF26A']);
      // Each a 1.7° wedge, D27 0.85° (BA16: 0.851°), and each the simulator's own dwell: its centre, start, width and range band.
      expect([...new Set(created.map((e) => bandOf(e).type))], 'arc bands').toEqual(['ArcBand']);
      for (const [i, e] of created.entries()) expect(width(bandOf(e)) / 2, `${keys[i]}: D27 at most 0.85°`).toBeLessThanOrEqual(0.851 + 0.006);
      expect(created.filter((e) => Math.abs(width(bandOf(e)) / 2 - 0.85) <= 0.006).length, 'D27 0.85°: 1.7° wedges').toBeGreaterThanOrEqual(created.length - 1);
      expect(plan.length, 'the simulator\'s drawn dwells').toBeGreaterThan(0);
      for (const d of plan) {
        const same = created.filter((e) => {
          const b = bandOf(e);
          return g(e).dwellIndex === d.index && Math.abs(b.startBearing - d.area.startBearing) <= 0.003 && Math.abs(width(b) - width(d.area)) <= 0.005
            // The radii within 5 m: 4607's fields round them by about 1 m at the 200 to 600 km of this map (seen 2026-11-16).
            && Math.abs(b.innerRadius - d.area.innerRadius) <= 5 && Math.abs(b.outerRadius - d.area.outerRadius) <= 5
            && Math.hypot(b.center[0] - d.area.center[0], b.center[1] - d.area.center[1]) <= 1e-6;
        });
        expect(same.length, `the simulator's dwell ${d.revisit}/${d.index}: one area of its own, with its wedge and band`).toBe(1);
      }
      const times = created.map((e) => e.state!.time.observed as string).sort();
      const [oldest, newest] = [times[0], times.at(-1)!];
      testInfo.annotations.push({ type: 'areas\' ages spread', description: `${(Date.parse(newest) - Date.parse(oldest)) / 1000} s` });

      // Criterion 39: counted from each area's dwell, fully drawn while young, then about half, then not at all; the
      // coverage stays in full colour. Full colour within 12: two areas crossing at 50 % each make 75 %, not full.
      const look = async () => drawn(await mapImage(page), ground, DWELL, 12);
      const young = await look();
      testInfo.annotations.push({ type: 'areas while young', description: `${JSON.stringify(young)} at ${((Date.now() - Date.parse(newest)) / 1000).toFixed(1)} s` });
      expect(young.full, 'the areas drawn fully').toBeGreaterThan(30);
      // Each look is annotated with the newest area's age it was taken at and how long it took.
      const looks: string[] = [];
      const logged = async () => { const t = Date.now(); const d = await look(); looks.push(`${JSON.stringify(d)} at ${((Date.now() - Date.parse(newest)) / 1000).toFixed(1)} s in ${Date.now() - t} ms`); return d; };
      /** Until `seconds` after the oldest area's dwell: its next step, or its removal. */
      const before = (seconds: number) => Math.max(1_000, Date.parse(oldest) + seconds * 1000 - Date.now());
      try {
        await afterStep(page, newest, 5);
        await expect.poll(async () => { const d = await logged(); return d.full <= Math.max(3, young.full / 20) && d.half > 30; }, { timeout: before(9.5), message: 'every area at about half from 5 s (where lines cross, a few pixels stay near full)' }).toBe(true);
      } finally {
        testInfo.annotations.push({ type: 'looks after the 5 s step', description: looks.join('; ') });
      }
      await page.screenshot({ path: testInfo.outputPath('areas-at-half.png') });
      looks.length = 0;
      try {
        await afterStep(page, newest, 10);
        await expect.poll(async () => { const d = await logged(); return d.full + d.half; }, { timeout: before(14.5), message: 'no area drawn from 10 s' }).toBeLessThanOrEqual(10);
      } finally {
        testInfo.annotations.push({ type: 'looks after the 10 s step', description: looks.join('; ') });
      }
      expect((await all.getObjects([...ids])).found.length, 'invisible, still stored').toBe(ids.size);
      expect(drawn(await mapImage(page), ground, COVERAGE).full, 'the coverage (gmti.platform) still in full colour').toBeGreaterThan(30);
      await page.screenshot({ path: testInfo.outputPath('areas-gone.png') });

      // Removed from 15 s after each area's dwell, by ECore's expiry sweep (PCA-gmti saw 15 to 20 s): none before 14 s, all by 25 s.
      const left = async () => (await all.getObjects([...ids])).found.length;
      await untilAge(page, oldest, 14);
      expect(await left(), 'none removed before 15 s').toBe(ids.size);
      await expect.poll(left, { timeout: Math.max(1_000, Date.parse(newest) + 25_000 - Date.now()), intervals: [500], message: 'each removed by 25 s after its dwell' }).toBe(0);
      testInfo.annotations.push({ type: 'all removed', description: `${((Date.now() - Date.parse(newest)) / 1000).toFixed(1)} s after the newest dwell` });
    } finally {
      await all.close();
    }
  });
});
