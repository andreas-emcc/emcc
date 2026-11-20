// Quick run: @plugin-simulator @plugin-gmti @plugin-cot @plugin-map-view-2d
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/flows/m5-sim-sensors.spec.ts
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { setLinks } from '../../lib/cot';
import { direct, distance } from '../../lib/geodesy.mjs';
import { createLayer, createSymbol, LiveClient } from '../../lib/live.mjs';
import { bottomPanel, drag, mapCentre, mapPane, pixelsAround, positionAt, userPause, visibleMap, withM0, type LonLat, type Point } from '../../lib/m0';
import { decodePng } from '../../lib/png.mjs';
import type { OwnServer } from '../../lib/own-server';
import { freeUdpPort, startUdpPeer } from '../../lib/udp-peer.mjs';

// The simulator's M5 criteria that need the combined system (docs/plugins/briefs/simulator.md,
// criteria 35 to 48; T-141, T-143, T-150; owner's scope, 2026-11-08: the model's own criteria 36 to
// 40, 43's FakeStore and R4, and 44 are the plugin's unit tests). The GMTI sensor with the real
// gmti plugin: a gmti `out` link sends the reports over UDP on loopback to a gmti `in` link, which
// makes them objects again (41, 42, 43, 47); the Sensors panel and a restart (35, 45); an output's
// depth, gmti's 511 980 m (48); scenarios exported from one server and imported on another (46).
// From SDK 1.5.0 part 3 (M6; T-168): a ground radar's job area through gmti, its coverage and each
// revisit's dwells (functions 37 and 39). In M6 "New sensor" makes a ground radar without asking for
// a type, and a scenario file's generic sensor is left out and listed (owner PX and Q52 B, 2026-11-11).
// From SDK 1.5.0 part 5 (T-155, ADR-0053 point 8): a gmti platform and a running simulated track
// a user moved into another layer stay there (gmti criterion 32, simulator criterion 60).
// A job area drawn, cleared and refused in the browser (function 39, criterion 59).
// The simulator ticks in real time (1 s), so the sensors use short revisit times. Positions are
// the Java SDK's Geodesy (lib/geodesy.mjs), latitude ≠ longitude; every server is the test's own.

test.describe.configure({ timeout: 300_000 });

const SIMULATION = 'simulator.simulation';
const PAIRING = 'gmti.pairing';
const BEYOND = 'simulator.beyond-reach';
const KM = 1000;
/** gmti's maxAreaDepth (its brief, "Out"; CR-0035). */
const GMTI_DEPTH = 511_980;
/** The platform: latitude ≠ longitude, far from the runner's route. */
const PLATFORM: LonLat = [15.5, 58.5];

type State = Record<string, any>;
type Event = { entityType: string; entityId: string; operation: string; state: State | null };
type Relation = { kind: string; objectId: string };

async function everyWorkspace(server: OwnServer): Promise<LiveClient> {
  const client = await LiveClient.open(server.baseUrl);
  await client.subscribe({ workspaces: ['*'] });
  return client;
}

async function applied(client: LiveClient, request: { entityType: string; operation: string }): Promise<Event> {
  const outcome = await client.change(request);
  expect(outcome, `${request.entityType} ${request.operation}: ${JSON.stringify(outcome.rejection ?? '')}`).toMatchObject({ outcome: 'applied' });
  return outcome.event as Event;
}

/** A call to the simulator's server part; resolves with the status and the answer. */
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

/** Sets gmti's links (its other settings as they are). */
async function setGmti(server: OwnServer, links: unknown[]): Promise<void> {
  const url = `${server.baseUrl}/api/settings/plugins/gmti`;
  const values = (await (await fetch(url)).json()).values;
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, links }) });
  expect(response.status, `gmti settings: ${await response.clone().text()}`).toBe(200);
}

/** A gmti `out` link to a UDP port, and an `in` link listening on it: the reports come back as objects. */
async function gmtiLoop(server: OwnServer): Promise<void> {
  const port = await freeUdpPort();
  await setGmti(server, [
    { name: 'vista', mode: 'udp', direction: 'out', host: '127.0.0.1', port },
    { name: 'vista-in', mode: 'udp', direction: 'in', listen: { port } },
  ]);
}

/** An APP-6B friendly infantry track at a position, with symbol modifiers if given. */
function trackRequest(layerId: string, name: string, at: LonLat, modifiers?: Record<string, unknown>) {
  const track = createSymbol(layerId, 0, { name }) as any;
  track.data.geometry.coordinates = at;
  track.data.symbol = { standard: 'APP-6B', sidc: 'SFGPUCI--------', ...(modifiers === undefined ? {} : { modifiers }) };
  return track;
}

/** A route as "New route" makes it: 30 km/h at every point, "stop". */
function routeRequest(layerId: string, name: string, coordinates: LonLat[], firstEvents: unknown[] = []) {
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
    extensions: { simulator: { points: coordinates.map((_, i) => ({ speedKind: 'instant', speed: 30 / 3.6, events: i === 0 ? firstEvents : [] })), groups: [], end: 'stop' } },
  };
  return request;
}

/**
 * A Simulation layer, and a runner: a track on a 50 km route about 2 000 km from the platform. The
 * sensors look only while some route runs (function 28), and the runner is never in their reach.
 */
async function simulation(server: OwnServer, all: LiveClient): Promise<{ layerId: string; runner: string; route: string }> {
  const layer = createLayer('Ground truth', { workspace: SIMULATION, drawOrder: 1 });
  await applied(all, layer);
  const route = routeRequest(layer.entityId, 'Runner route', [[-5.0, 40.0], [-5.6, 40.1]]);
  await applied(all, route);
  const runner = trackRequest(layer.entityId, 'Runner', [-5.0, 40.0]);
  await applied(all, runner);
  await simulator(server, '/put-on-route', { route: route.entityId, kind: 'single', objects: [runner.entityId] });
  return { layerId: layer.entityId, runner: runner.entityId, route: route.entityId };
}

/** The simulator's Scenario item in the top bar (T-152, function 48; from M7 instead of the Routes panel's two buttons): its menu, its file input, and its popover, which shows the import's results. */
function scenarioItem(page: Page) {
  return {
    choose: async (item: string) => {
      await page.getByRole('banner').getByRole('button', { name: 'Scenario', exact: true }).click();
      await page.getByRole('menu', { name: 'Scenario', exact: true }).getByRole('menuitem', { name: item, exact: true }).click();
    },
    input: page.getByLabel('Scenario file', { exact: true }),
    box: page.getByRole('dialog', { name: 'Scenario', exact: true }),
  };
}

/** Tracks at distances (m) and bearings (°) from the platform; resolves with their ids, in order. */
async function tracksAround(all: LiveClient, layerId: string, at: Array<{ name: string; metres: number; azimuth: number }>, from: LonLat = PLATFORM): Promise<string[]> {
  const positions = direct(at.map(({ metres, azimuth }) => ({ from, azimuth, metres }))) as LonLat[];
  const ids: string[] = [];
  for (const [i, { name }] of at.entries()) {
    const track = trackRequest(layerId, name, positions[i]);
    await applied(all, track);
    ids.push(track.entityId);
  }
  return ids;
}

/** The object's relations of a kind, as sorted ids. */
async function related(all: LiveClient, id: string, kind: string): Promise<string[]> {
  const object = (await all.getObjects([id])).found[0];
  return ((object?.relations ?? []) as Relation[]).filter((r) => r.kind === kind).map((r) => r.objectId).sort();
}

function sorted(ids: string[]): string[] {
  return [...ids].sort();
}

/** The events of one gmti data type and shape so far. */
/** gmti's dwell areas' data type from M7 RC2 (owner TG A, CR-0042); the coverage keeps gmti.platform. */
const DWELL_AREA = 'gmti.dwell-area';

function gmtiEvents(all: LiveClient, type: string, dataType: string): Event[] {
  return (all.events as Event[]).filter((e) => e.state?.type === type && e.state?.dataType === dataType);
}

function views(page: Page) {
  return page.getByRole('tablist', { name: 'Views' });
}

async function switchTo(page: Page, name: 'View' | 'Simulation'): Promise<void> {
  await views(page).getByRole('tab', { name, exact: true }).click();
  await expect(views(page).getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name }).getByRole('tab', { name: 'Layers', exact: true })).toBeVisible();
  await bottomPanel(page, 'Layers');
}

function region(page: Page, name: string) {
  return page.getByRole('region', { name, exact: true }).first();
}

test('criteria 41, 42, 43 and 47 through gmti: the reports of a running simulation come back through a gmti in link as detections at the sensor\'s positions, paired with its platform, which is named and on its mission as the sensor says; the platform\'s pairing is the detected tracks; an empty report is sent and clears the pairing; a paused simulation sends none; cot is offered only for ground truth, gmti only for sensors', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server }) => {
    const all = await everyWorkspace(server);
    const tak = await startUdpPeer();
    try {
      await gmtiLoop(server);
      await setLinks(server, [{ name: 'tak', direction: 'out', transport: 'udp', port: tak.port, sourceLayers: [] }]);
      const { layerId } = await simulation(server, all);
      const platform = trackRequest(layerId, 'Hawk 1', PLATFORM, { direction: 45, speed: 120 });
      await applied(all, platform);
      // "Detect all in range" (no errors, any bearing, moving or not): the measured positions are the true ones.
      const targets = [{ name: 'East', metres: 60 * KM, azimuth: 90 }, { name: 'South-west', metres: 100 * KM, azimuth: 200 }];
      const ids = await tracksAround(all, layerId, targets);
      const truth = direct(targets.map(({ metres, azimuth }) => ({ from: PLATFORM, azimuth, metres }))) as LonLat[];

      // Criterion 41's offers: gmti's channel for sensors only, cot's for ground truth only.
      await expect.poll(async () => (await simulator(server, '/sensors')).channels.map((c: { id: string }) => c.id), { message: 'the channels for sensor reports' }).toEqual(['gmti/vista']);
      const groundTruth = (await simulator(server, '/outputs')).channels.map((c: { id: string }) => c.id);
      expect(groundTruth, 'cot for ground truth').toContain('cot/tak');
      expect(groundTruth, 'gmti not for ground truth').not.toContain('gmti/vista');
      expect((await call(server, '/sensors', { platform: platform.entityId, create: true, outputs: ['cot/tak'] })).status, 'cot is not a sensor output').toBe(404);

      await simulator(server, '/sensors', { platform: platform.entityId, create: true, revisitSeconds: 2, detectAll: true, mission: 'ATO-2611-BRAVO', outputs: ['gmti/vista'] });
      await simulator(server, '/routes/start', {});

      // Criterion 43: the platform's pairing is exactly the detected tracks.
      await expect.poll(() => related(all, platform.entityId, PAIRING), { timeout: 20_000, message: 'the platform paired with the detected tracks' }).toEqual(sorted(ids));
      const sensors = await simulator(server, '/sensors');
      expect(sensors.pairing, 'gmti.pairing is declared').toBe(true);
      expect(sensors.sensors, 'one sensor').toHaveLength(1);
      expect(sensors.sensors[0], 'two detections, nothing out of range').toMatchObject({ platform: platform.entityId, name: 'Hawk 1', missing: false, outOfRange: [], detections: 2 });

      // Criterion 42: gmti's in link makes detections at the measured (here the true) positions, paired with gmti's platform object.
      await expect.poll(() => gmtiEvents(all, 'core.symbol', 'gmti.detection').filter((e) => e.operation === 'create').length, { timeout: 20_000, message: 'detections through gmti' }).toBeGreaterThanOrEqual(2);
      const gmtiPlatform = gmtiEvents(all, 'core.symbol', 'gmti.platform').at(-1)!;
      const detections = gmtiEvents(all, 'core.symbol', 'gmti.detection').filter((e) => e.operation === 'create').slice(0, 2);
      for (const [i, at] of truth.entries()) {
        const near = detections.filter((d) => Math.hypot(d.state!.geometry.coordinates[0] - at[0], d.state!.geometry.coordinates[1] - at[1]) < 1e-4);
        expect(near, `${targets[i].name}: one detection at its position ${JSON.stringify(at)}: ${JSON.stringify(detections.map((d) => d.state!.geometry.coordinates))}`).toHaveLength(1);
        expect(near[0].state!.relations, 'paired with gmti\'s platform object').toEqual([{ kind: PAIRING, objectId: gmtiPlatform.entityId }]);
      }
      // Criterion 47 as gmti receives it: the platform is the sensor's track by name and position, with its
      // direction and speed, and its mission plan is the sensor's Mission cut to 4607's 12 characters (gmti's brief, M1).
      const seen = gmtiPlatform.state!;
      expect(seen.properties?.name, 'P8: the track\'s name').toBe('Hawk 1');
      expect(Math.hypot(seen.geometry.coordinates[0] - PLATFORM[0], seen.geometry.coordinates[1] - PLATFORM[1]), 'at the platform').toBeLessThan(1e-4);
      expect(seen.symbol.modifiers?.direction, 'the track\'s direction').toBeCloseTo(45, 0);
      expect(seen.symbol.modifiers?.speed, 'the track\'s speed').toBeCloseTo(120, 0);
      expect(String(seen.extensions?.gmti?.missionPlan).trim(), 'M1: the Mission, cut to 12').toBe('ATO-2611-BRA');
      testInfo.annotations.push({ type: 'gmti platform', description: JSON.stringify(seen.extensions?.gmti) });

      // Criterion 41: paused, no reports.
      await simulator(server, '/routes/pause', {});
      await pause(1_000);
      const before = gmtiEvents(all, 'core.symbol', 'gmti.detection').length;
      const areaBefore = gmtiEvents(all, 'core.shape', DWELL_AREA).length;
      await pause(5_000); // two and a half revisits: nothing may come, a fixed wait, the absence is the check
      expect(gmtiEvents(all, 'core.symbol', 'gmti.detection').length, 'paused: no detections').toBe(before);
      expect(gmtiEvents(all, 'core.shape', DWELL_AREA).length, 'paused: no dwell').toBe(areaBefore);

      // Criteria 41 and 43: an empty report (probability 0, no "Detect all") is sent, and the pairing is none.
      await simulator(server, '/sensors', { platform: platform.entityId, detectAll: false, detectionProbability: 0 });
      await simulator(server, '/routes/start', {});
      await expect.poll(() => related(all, platform.entityId, PAIRING), { timeout: 20_000, message: 'after an empty revisit: no pairing' }).toEqual([]);
      const detectionsNow = gmtiEvents(all, 'core.symbol', 'gmti.detection').filter((e) => e.operation === 'create').length;
      const areas = gmtiEvents(all, 'core.shape', DWELL_AREA).length;
      await expect.poll(() => gmtiEvents(all, 'core.shape', DWELL_AREA).length, { timeout: 20_000, message: 'empty dwells still reach gmti' }).toBeGreaterThanOrEqual(areas + 2);
      expect(gmtiEvents(all, 'core.symbol', 'gmti.detection').filter((e) => e.operation === 'create').length, 'and no detections').toBe(detectionsNow);
      expect((await simulator(server, '/sensors')).sensors[0].detections, 'none counted').toBe(0);
      await simulator(server, '/routes/pause', {});
    } finally {
      await tak.close();
      await all.close();
    }
  });
});

/** A fixed wait outside a page (Node's timer). */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('criteria 35, 41 and 45 in the browser: "New sensor" on the one selected track makes a sensor with the defaults; its outputs are gmti\'s channel with its field set\'s label, not cot\'s, which is a Ground truth output only; a value outside its limits is refused at the field; saved, it survives a restart; its track deleted, it shows as missing', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server: first, open, restart }) => {
    let server = first;
    let all = await everyWorkspace(server);
    const tak = await startUdpPeer();
    try {
      await gmtiLoop(server);
      await setLinks(server, [{ name: 'tak', direction: 'out', transport: 'udp', port: tak.port, sourceLayers: [] }]);
      const page = await open();
      await switchTo(page, 'Simulation');
      const layer = createLayer('Ground truth', { workspace: SIMULATION, drawOrder: 1 });
      await applied(all, layer);
      const centre = await mapCentre(page);
      const at: Point = { x: centre.x + 40, y: centre.y + 60 };
      const position = await positionAt(page, at);
      expect(Math.abs(position[0] - position[1]), 'latitude ≠ longitude').toBeGreaterThan(1);
      const track = trackRequest(layer.entityId, 'TRACK 1', position);
      await applied(all, track);

      const sensors = region(page, 'Sensors');
      await expect(sensors, 'the Sensors panel in Simulation').toBeVisible();
      await expect(sensors).toContainText('No sensors. Select one track of the simulation, then choose New sensor.');
      const create = sensors.getByRole('button', { name: 'New sensor', exact: true });
      await expect(create, 'nothing selected').toBeDisabled();
      await expect(create).toHaveAttribute('title', 'Select one track of the simulation');
      await expect(async () => {
        await page.mouse.click(at.x, at.y);
        await userPause(page);
        await expect(create).toBeEnabled({ timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await expect(create).toHaveAttribute('title', 'Make a sensor on TRACK 1');
      await create.click();

      // Its defaults (function 37; function 27 before part 3; from M7 all round, 0° to 360°, T-178), as the panel shows them: km, m, the user's speed unit.
      // Its defaults (function 37; function 27 before part 3), as the panel shows them: km, m, the user's speed unit.
      const form = sensors.getByRole('region', { name: 'Sensor TRACK 1', exact: true });
      await expect(form).toBeVisible();
      await expect(page.getByRole('alertdialog', { name: 'New sensor', exact: true }), 'no type asked').toHaveCount(0);
      await expect(form.getByText('Generic sensor'), 'no generic sensor in M6').toHaveCount(0);
      const field = (label: string | RegExp) => form.getByRole('textbox', { name: label, ...(typeof label === 'string' ? { exact: true } : {}) });
      for (const [label, value] of [['Revisit interval (s)', '10'], ['Min range (km)', '20'], ['Max range (km)', '150'], ['Start bearing (°)', '0'], ['End bearing (°)', '360'], ['Probability of detection', '1'], ['Range error (m)', '20'], ['Cross-range error (m)', '50'], ['Most detections per dwell', '200'], ['Search width (°)', '40'], ['Dwell depth (km)', '50'], ['Dwell interval (s)', '1'], ['Mission', '']] as const) {
        await expect(field(label), label).toHaveValue(value);
      }
      await expect(form.getByRole('combobox', { name: 'Preset', exact: true }).locator('option:checked'), 'the preset').toHaveText('Medium wedge');
      await expect(form.getByRole('combobox', { name: 'Mode', exact: true }).locator('option:checked'), 'the mode (T-197)').toHaveText('Random');
      await expect(form.getByRole('textbox', { name: /^Empty dwells/ }), 'no Empty dwells from M8 (T-196)').toHaveCount(0);
      const speedField = field(/^Minimum detectable speed \(/);
      const speedLabel = (await speedField.getAttribute('aria-label')) ?? (await form.getByText(/^Minimum detectable speed \(/).textContent()) ?? '';
      expect(Number(await speedField.inputValue()), `${speedLabel}: 0`).toBe(0);
      await expect(form.getByRole('checkbox', { name: 'Detect all in range', exact: true })).not.toBeChecked();

      // Criteria 41 and 45: gmti's channel with its set's label; cot's channel is not offered here.
      const outputsSet = form.getByRole('group', { name: 'Sensor outputs' });
      const vista = outputsSet.getByRole('checkbox', { name: 'vista (GMTI)', exact: true });
      await expect(vista).toBeVisible();
      await expect(outputsSet).toContainText('Field set: GMTI report');
      // Criterion 45's other half, cot's channel with cot.unit, is the next test, with the real cot.
      await expect(outputsSet.getByRole('checkbox'), 'only gmti\'s channel').toHaveCount(1);
      const groundTruth = region(page, 'Ground truth outputs');
      await expect(groundTruth.getByRole('checkbox', { name: 'tak', exact: true }), 'cot in the Ground truth outputs').toBeVisible();
      await expect(groundTruth.getByRole('checkbox', { name: 'vista (GMTI)', exact: true }), 'gmti is not a Ground truth output').toHaveCount(0);

      // Refused at the field (criterion 35).
      const save = form.getByRole('button', { name: 'Save', exact: true });
      await field('Revisit interval (s)').fill('0');
      await expect(form).toContainText('From 1 to 600');
      await expect(save, 'not with a refused value').toBeDisabled();
      await field('Revisit interval (s)').fill('5');
      await field('Max range (km)').fill('10');
      await expect(form).toContainText('Above the min range');
      await expect(save).toBeDisabled();
      await field('Max range (km)').fill('120');
      await field('Mission').fill('ATO-2611-BRAVO');
      await vista.check();
      await expect(save).toBeEnabled();
      await save.click();
      const expected = { revisitSeconds: 5, minRange: 20_000, maxRange: 120_000, startBearing: 0, endBearing: 360, detectionProbability: 1, rangeError: 20, crossRangeError: 50, minimumDetectableSpeed: 0, maxDetections: 200, mission: 'ATO-2611-BRAVO', detectAll: false };
      await expect.poll(async () => (await simulator(server, '/sensors')).sensors[0]?.settings, { message: 'saved in SI units' }).toMatchObject(expected);
      expect((await simulator(server, '/sensors')).sensors[0].outputs, 'the chosen output').toEqual([{ id: 'gmti/vista', missing: false }]);

      // Kept over a restart (function 27: saved with the simulator's state).
      await page.context().close(); // a page of the stopped server would keep reconnecting
      await all.close();
      ({ server } = await restart());
      all = await everyWorkspace(server);
      await expect.poll(async () => (await call(server, '/sensors')).status, { timeout: 30_000, message: 'the simulator loaded' }).toBe(200);
      const after = (await simulator(server, '/sensors')).sensors;
      expect(after, 'the sensor after a restart').toHaveLength(1);
      expect(after[0], 'with its settings and output').toMatchObject({ platform: track.entityId, name: 'TRACK 1', settings: expected, outputs: [{ id: 'gmti/vista' }] });
      const again = await open();
      await switchTo(again, 'Simulation');
      await region(again, 'Sensors').getByRole('list', { name: 'Sensors' }).getByRole('button', { name: 'TRACK 1', exact: true }).click();
      await expect(region(again, 'Sensors').getByRole('region', { name: 'Sensor TRACK 1' }).getByRole('textbox', { name: 'Revisit interval (s)' })).toHaveValue('5');

      // Its track deleted: shown as missing, kept.
      await applied(all, { requestId: crypto.randomUUID(), entityType: 'object', operation: 'delete', entityId: track.entityId, source: { plugin: 'ita-test' } } as never);
      // Its name was the track's: without the track it is named "GMTI sensor" (function 29's name for a track with none).
      const item = region(again, 'Sensors').getByRole('list', { name: 'Sensors' }).getByRole('listitem');
      await expect(item, 'still one sensor').toHaveCount(1);
      await expect(item, 'missing').toContainText('Missing', { timeout: 10_000 });
      await expect(item).toContainText('Its track was deleted: the sensor does nothing.');
      expect((await simulator(server, '/sensors')).sensors[0].missing, 'missing on the server').toBe(true);
    } finally {
      await tak.close();
      await all.close();
    }
  });
});

test("a ground radar's job area through gmti (SDK 1.5.0 part 3; simulator functions 37 and 38, T-168; gmti criteria 25, 26 and 29): the job area goes out as the job definition and comes back as the platform's coverage, corner for corner; a track inside it is detected and one outside it is not; each revisit's dwells all come back, one dwell area each; a generic sensor may not have gmti's output", async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server }) => {
    const all = await everyWorkspace(server);
    try {
      await gmtiLoop(server);
      const { layerId } = await simulation(server, all);
      const platform = trackRequest(layerId, 'Hawk 1', PLATFORM, { direction: 45, speed: 120 });
      await applied(all, platform);
      // Three tracks inside the job area, 60 degrees apart in bearing (more than a dwell's 40 degree search
      // width, so each revisit takes at least three dwells, function 37); North in reach but outside it.
      const inside = [{ name: 'East', metres: 60 * KM, azimuth: 90 }, { name: 'South-east', metres: 80 * KM, azimuth: 150 }, { name: 'South-west', metres: 100 * KM, azimuth: 210 }];
      const ids = await tracksAround(all, layerId, inside);
      const [north] = await tracksAround(all, layerId, [{ name: 'North', metres: 80 * KM, azimuth: 10 }]);
      const insideAt = direct(inside.map(({ metres, azimuth }) => ({ from: PLATFORM, azimuth, metres }))) as LonLat[];
      const [northAt] = direct([{ from: PLATFORM, azimuth: 10, metres: 80 * KM }]) as LonLat[];
      // A box from about 22 km north of the platform southwards, clockwise on the map from its north-west corner (J6 is the first).
      const [lon, lat] = PLATFORM;
      const corners: LonLat[] = [[lon - 1.0, lat + 0.2], [lon + 2.0, lat + 0.2], [lon + 2.0, lat - 1.2], [lon - 1.0, lat - 1.2]];

      // A ground radar, the default type: "Detect all in range", a 3 s revisit; its job area set apart (saved at once).
      await simulator(server, '/sensors', { platform: platform.entityId, create: true, type: 'GROUND_RADAR', revisitSeconds: 3, detectAll: true, outputs: ['gmti/vista'] });
      await simulator(server, '/sensors', { platform: platform.entityId, jobArea: { type: 'Polygon', coordinates: [[...corners, corners[0]]] } });
      const sensor = (await simulator(server, '/sensors')).sensors[0];
      expect(sensor.settings.type, 'a ground radar').toBe('GROUND_RADAR');
      expect(sensor.settings.jobArea.coordinates[0], 'the job area stored').toHaveLength(5);
      await simulator(server, '/routes/start', {});

      // Inside: detected through gmti, and the platform paired with them alone.
      await expect.poll(() => related(all, platform.entityId, PAIRING), { timeout: 30_000, message: 'paired with the three inside' }).toEqual(sorted(ids));
      const near = (at: LonLat) => gmtiEvents(all, 'core.symbol', 'gmti.detection').filter((e) => e.state && Math.hypot(e.state.geometry.coordinates[0] - at[0], e.state.geometry.coordinates[1] - at[1]) < 1e-4);
      for (const [i, at] of insideAt.entries()) {
        await expect.poll(() => near(at).length, { timeout: 20_000, message: `${inside[i].name} detected through gmti` }).toBeGreaterThan(0);
      }

      // The coverage: the job area's four corners (J6 to J13), from the first. The store keeps every
      // polygon counter-clockwise (model rule 1), so the clockwise ring comes back the other way round;
      // the order on the wire (clockwise, gmti criterion 29) is gmti's own test.
      await expect.poll(() => gmtiEvents(all, 'core.shape', 'gmti.platform').filter((e) => e.state?.properties?.name === 'Hawk 1 coverage').length, { timeout: 20_000, message: 'the coverage' }).toBeGreaterThan(0);
      const coverage = gmtiEvents(all, 'core.shape', 'gmti.platform').filter((e) => e.state?.properties?.name === 'Hawk 1 coverage').at(-1)!.state!;
      const ring = (coverage.geometry.coordinates[0] as LonLat[]).slice(0, 4);
      const counterClockwise = [corners[0], corners[3], corners[2], corners[1]];
      for (const [i, corner] of counterClockwise.entries()) {
        expect(Math.hypot(ring[i][0] - corner[0], ring[i][1] - corner[1]), `corner ${i}: ${JSON.stringify(ring[i])}, ${JSON.stringify(corner)} sent`).toBeLessThan(1e-5);
      }

      // Each revisit's dwells all reach gmti in (D3 0 to n - 1, D4 on the last): two revisits in a row with the same full set.
      const dwellsOf = () => {
        const byRevisit = new Map<number, Set<number>>();
        for (const e of gmtiEvents(all, 'core.shape', DWELL_AREA)) {
          const g = e.state?.extensions?.gmti;
          if (g?.dwellIndex === undefined || g.revisitIndex === undefined) continue;
          byRevisit.set(g.revisitIndex, (byRevisit.get(g.revisitIndex) ?? new Set()).add(g.dwellIndex));
        }
        return [...byRevisit.entries()].sort((a, b) => a[0] - b[0]).map(([revisit, dwells]) => ({ revisit, dwells: [...dwells].sort((a, b) => a - b) }));
      };
      const whole = (d: number[]) => d.length >= 3 && d.every((n, i) => n === i);
      await expect
        .poll(() => dwellsOf().some((r, i, list) => whole(r.dwells) && list[i + 1] !== undefined && list[i + 1].revisit === r.revisit + 1 && JSON.stringify(list[i + 1].dwells) === JSON.stringify(r.dwells)), {
          timeout: 30_000,
          message: 'two revisits in a row with all their dwells',
        })
        .toBe(true);
      testInfo.annotations.push({ type: 'dwells by revisit', description: JSON.stringify(dwellsOf()) });
      // From M8 every dwell is an area of its own again (T-195, gmti criterion 27; owner YI A, 2026-11-16, in place of
      // one per revisit, VD C), with no name (owner UV A): each revisit's dwells are as many areas, each created once,
      // none updated or deleted by gmti.
      const areaEvents = gmtiEvents(all, 'core.shape', DWELL_AREA);
      const areasOf = new Map<number, Set<string>>();
      const createdOf = new Map<number, number>();
      for (const e of areaEvents) {
        const r = e.state?.extensions?.gmti?.revisitIndex as number | undefined;
        if (r === undefined) continue;
        areasOf.set(r, (areasOf.get(r) ?? new Set()).add(e.entityId));
        if (e.operation === 'create') createdOf.set(r, (createdOf.get(r) ?? 0) + 1);
      }
      testInfo.annotations.push({ type: 'areas by revisit', description: JSON.stringify([...areasOf.entries()].map(([r, ids]) => [r, ids.size, createdOf.get(r) ?? 0])) });
      for (const { revisit, dwells } of dwellsOf().filter((r) => whole(r.dwells))) {
        expect(areasOf.get(revisit)?.size, `revisit ${revisit}: an area per dwell`).toBe(dwells.length);
        expect(createdOf.get(revisit), `revisit ${revisit}: each created once`).toBe(dwells.length);
      }
      expect(areaEvents.filter((e) => e.operation !== 'create' && (e as ByEvent).by?.plugin === 'gmti').map((e) => e.operation), 'never updated or deleted by gmti').toEqual([]);
      expect(areaEvents.filter((e) => (e.state?.properties?.name ?? '') !== '').map((e) => e.state?.properties?.name), 'no names').toEqual([]);

      // Outside the job area: never detected, never paired.
      expect(near(northAt), 'North is outside the job area').toEqual([]);
      expect(await related(all, platform.entityId, PAIRING), 'still the three inside').toEqual(sorted(ids));
      expect(ids, 'North is not among them').not.toContain(north);
      await simulator(server, '/routes/pause', {});

      // A generic sensor: gmti's channel takes ground radars only (sensorTypes).
      const generic = trackRequest(layerId, 'Generic 1', direct([{ from: PLATFORM, azimuth: 200, metres: 300 * KM }])[0] as LonLat);
      await applied(all, generic);
      const channels = (await simulator(server, '/sensors')).channels;
      expect(channels.find((c: { id: string }) => c.id === 'gmti/vista')?.sensorTypes, 'gmti for ground radars').toEqual(['GROUND_RADAR']);
      expect((await call(server, '/sensors', { platform: generic.entityId, create: true, type: 'GENERIC', outputs: ['gmti/vista'] })).status, "gmti is not a generic sensor's output").toBe(404);
      await simulator(server, '/sensors', { platform: generic.entityId, create: true, type: 'GENERIC' });
      const made = (await simulator(server, '/sensors')).sensors.find((x: { platform: string }) => x.platform === generic.entityId);
      expect(made.settings.type, 'a generic sensor').toBe('GENERIC');
    } finally {
      await all.close();
    }
  });
});

/** How many clearly red pixels (simulator.beyond-reach's #FF0000 lines) the visible map shows. */
/** A user's move or copy as the shell sends it (ADR-0053): an update with the new layerId, or a create of a hand-made copy. */
function movedTo(state: State, layerId: string) {
  const { id, version, meta: _meta, ...data } = state;
  return { requestId: randomUUID(), entityType: 'object', operation: 'update', entityId: id, baseVersion: version, data: { ...data, layerId }, source: { plugin: 'ita-test' } };
}

function copiedTo(state: State, layerId: string) {
  const { id: _id, version: _version, meta: _meta, time: _time, relations: _relations, ...data } = state;
  return { requestId: randomUUID(), entityType: 'object', operation: 'create', entityId: randomUUID(), data: { ...data, layerId, dataSource: 'manual' }, source: { plugin: 'ita-test' } };
}

type ByEvent = Event & { by?: { plugin?: string } };

test('moved tracks stay (SDK 1.5.0 part 5, T-155, ADR-0053 point 8; gmti criterion 32, simulator criterion 60): a gmti platform moved into another layer is updated there by its next report while its new dwell areas still go to the link\'s layer; a running simulated track moved into another Simulation layer moves on along its route there; neither copy is updated', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server }) => {
    const all = await everyWorkspace(server);
    try {
      await gmtiLoop(server);
      const { layerId, runner } = await simulation(server, all);
      const platform = trackRequest(layerId, 'Hawk 1', PLATFORM, { direction: 45, speed: 120 });
      await applied(all, platform);
      await tracksAround(all, layerId, [{ name: 'East', metres: 60 * KM, azimuth: 90 }]);
      await simulator(server, '/sensors', { platform: platform.entityId, create: true, type: 'GROUND_RADAR', revisitSeconds: 3, detectAll: true, outputs: ['gmti/vista'] });
      await simulator(server, '/routes/start', {});
      const events = () => all.events as ByEvent[];
      const latest = (id: string) => events().filter((e) => e.entityId === id && e.state !== null).at(-1)?.state ?? undefined;

      // gmti's platform object, in its in link's layer.
      const platformEvent = () => gmtiEvents(all, 'core.symbol', 'gmti.platform').find((e) => e.operation === 'create');
      await expect.poll(() => platformEvent() !== undefined, { timeout: 30_000, message: 'gmti\'s platform' }).toBe(true);
      const gmtiPlatform = platformEvent()!.entityId;
      const linkLayer = platformEvent()!.state!.layerId as string;
      const moved = createLayer('ITA Moved');
      const copies = createLayer('ITA Copies');
      await applied(all, moved);
      await applied(all, copies);

      // Moved by a user, and copied. "After the move" is by version: a write applied just before the
      // move can still reach the client after the move was sent.
      const platformMoved = (await applied(all, movedTo(latest(gmtiPlatform)!, moved.entityId))).state!.version as number;
      const reportsAfter = () => events().filter((e) => e.entityId === gmtiPlatform && e.by?.plugin === 'gmti' && (e.state?.version ?? 0) > platformMoved);
      const copy = (await applied(all, copiedTo(latest(gmtiPlatform)!, copies.entityId))).state!;
      await expect.poll(() => reportsAfter().length, { timeout: 30_000, message: 'two of gmti\'s reports after the move' }).toBeGreaterThanOrEqual(2);
      expect([...new Set(reportsAfter().map((e) => e.state?.layerId))], 'each report keeps it where the user put it').toEqual([moved.entityId]);
      // Created after the platform's first report after the move, when gmti knew of it: from M8 each dwell's own area
      // (gmti criterion 27), polled, as a dwell may come a moment after the reports.
      const newAreasNow = () => events().slice(events().indexOf(reportsAfter()[0])).filter((e) => e.operation === 'create' && e.by?.plugin === 'gmti');
      await expect.poll(() => newAreasNow().length, { timeout: 15_000, message: 'new objects from gmti after the move' }).toBeGreaterThan(0);
      const newAreas = newAreasNow();
      expect([...new Set(newAreas.map((e) => e.state?.layerId))], 'new dwell areas and detections in the link\'s layer, as before').toEqual([linkLayer]);
      const [platformCopy] = (await all.getObjects([copy.id])).found;
      expect(platformCopy.version, 'the copy of the platform is not updated').toBe(copy.version);
      expect(platformCopy.meta?.externalRef, 'no external identity').toBeUndefined();

      // The runner, moving on its route, moved into a second Simulation layer, and copied into a third.
      const second = createLayer('Second', { workspace: SIMULATION, drawOrder: 2 });
      const third = createLayer('Third', { workspace: SIMULATION, drawOrder: 3 });
      await applied(all, second);
      await applied(all, third);
      await expect.poll(() => latest(runner)?.symbol?.modifiers?.speed ?? 0, { timeout: 20_000, message: 'the runner runs' }).toBeGreaterThan(0);
      const runnerMoved = (await applied(all, movedTo(latest(runner)!, second.entityId))).state!.version as number;
      const stepsAfter = () => events().filter((e) => e.entityId === runner && e.by?.plugin === 'simulator' && (e.state?.version ?? 0) > runnerMoved);
      const runnerCopy = (await applied(all, copiedTo(latest(runner)!, third.entityId))).state!;
      await expect.poll(() => stepsAfter().length, { timeout: 20_000, message: 'three of the simulator\'s steps after the move' }).toBeGreaterThanOrEqual(3);
      const steps = stepsAfter();
      testInfo.annotations.push({ type: 'runner after the move', description: JSON.stringify(events().filter((e) => e.entityId === runner).slice(-6).map((e) => [e.by?.plugin, e.state?.version, e.state?.layerId === second.entityId ? 'Second' : e.state?.layerId === layerId ? 'Ground truth' : e.state?.layerId])) });
      expect([...new Set(steps.map((e) => e.state?.layerId))], 'each step keeps it in Second').toEqual([second.entityId]);
      const lons = steps.map((e) => e.state!.geometry.coordinates[0] as number);
      expect(lons.at(-1)!, 'it moves on westwards along its route').toBeLessThan(lons[0]);
      const [runnerCopyNow] = (await all.getObjects([runnerCopy.id])).found;
      expect(runnerCopyNow.version, 'the copy of the runner is not moved').toBe(runnerCopy.version);
      expect(runnerCopyNow.geometry.coordinates).toEqual(runnerCopy.geometry.coordinates);
    } finally {
      await all.close();
    }
  });
});

async function redPixels(page: Page): Promise<number> {
  const box = await visibleMap(page);
  const half = Math.floor(Math.min(box.width, box.height) / 2) - 2;
  const image = await pixelsAround(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, half);
  let count = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const [r, g, b] = image.pixel(x, y);
      if (r > 180 && g < 90 && b < 90) count++;
    }
  }
  return count;
}

/** Zooms out until the visible map reaches `metres` from its centre, east and west. */
async function zoomOutTo(page: Page, from: LonLat, metres: number): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const box = await visibleMap(page);
    const edge = await positionAt(page, { x: box.x + box.width / 2 + Math.min(box.width, box.height) / 2 - 8, y: box.y + box.height / 2 });
    if (distance(from, edge) >= metres) return;
    await mapPane(page).getByTitle('Zoom out').click();
    await userPause(page);
  }
  throw new Error(`the map does not reach ${metres} m`);
}

test('criterion 45 with the real cot (cot functions 23 to 25; owner LU and LV): the Ground truth outputs panel shows cot\'s channel with "Field set: CoT unit"; a running track\'s cot.unit fields go out to TAK, and the stored track does not get the set', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await everyWorkspace(server);
    const tak = await startUdpPeer();
    try {
      await setLinks(server, [{ name: 'tak', direction: 'out', transport: 'udp', port: tak.port, sourceLayers: [] }]);
      const layer = createLayer('Ground truth', { workspace: SIMULATION, drawOrder: 1 });
      await applied(all, layer);
      const start: LonLat = [16.2, 58.9]; // latitude ≠ longitude
      const route = routeRequest(layer.entityId, 'Unit route', [start, [16.5, 58.95]]);
      await applied(all, route);
      const track = trackRequest(layer.entityId, 'Unit track', start);
      track.fields = [
        { plugin: 'cot', name: 'callsign', value: 'VIPER 2' },
        { plugin: 'cot', name: 'team', value: 'Cyan' },
        { plugin: 'cot', name: 'how', value: 'm-g' },
      ];
      await applied(all, track);
      const setsBefore = (await all.getObjects([track.entityId])).found[0].fieldSets ?? [];
      expect(setsBefore, 'the track as created carries no cot.unit').not.toContain('cot.unit');

      // The channel names its set (ChannelInfo.fieldSet), and the panel shows its label.
      await expect.poll(async () => ((await simulator(server, '/outputs')).channels as Array<{ id: string; fieldSet: string | null }>).find((c) => c.id === 'cot/tak')?.fieldSet ?? null, { timeout: 10_000, message: 'cot/tak names cot.unit' }).toBe('cot.unit');
      const page = await open();
      await switchTo(page, 'Simulation');
      const item = region(page, 'Ground truth outputs').getByRole('listitem', { name: 'tak', exact: true });
      await expect(item).toBeVisible();
      await expect(item).toContainText('Field set: CoT unit');

      await simulator(server, '/put-on-route', { route: route.entityId, kind: 'single', objects: [track.entityId] });
      await simulator(server, '/outputs', { channels: ['cot/tak'] });
      await simulator(server, '/routes/start', {});
      // The item reaches the real cot with the track's cot.unit fields (that it lists the set is the unit test's).
      await expect.poll(() => tak.events().filter((e) => e.uid === track.entityId && e.callsign === 'VIPER 2' && e.team === 'Cyan' && e.how === 'm-g').length, { timeout: 15_000, message: 'the track goes out with its CoT unit fields' }).toBeGreaterThan(1);
      const sent = tak.events().filter((e) => e.uid === track.entityId).at(-1)!;
      expect(Math.abs(sent.lon - start[0]) < 0.2 && Math.abs(sent.lat - start[1]) < 0.2, `on its route, lon/lat ${sent.lon}, ${sent.lat}`).toBe(true);
      await simulator(server, '/routes/pause', {});
      const stored = (await all.getObjects([track.entityId])).found[0];
      expect(stored.fieldSets ?? [], 'the stored track does not get cot.unit').toEqual(setsBefore);
      expect(stored.extensions?.cot, 'its cot values stay').toMatchObject({ callsign: 'VIPER 2', team: 'Cyan', how: 'm-g' });
    } finally {
      await tak.close();
      await all.close();
    }
  });
});

test('criterion 48 with gmti\'s depth (511 980 m): "Detect all" at 400 km warns of nothing and pairs every track; at 600 km a track beyond the depth gets simulator.beyond-reach, the warning names the sensor and the output with no number, and red lines show; a band from 20 km moves the edge to 531.98 km; deselecting gmti clears the warning and the red lines and pairs every track at once, without a revisit', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await everyWorkspace(server);
    try {
      await gmtiLoop(server);
      // Red is the beyond-reach lines' alone: from M8 the coverage is #FD0909 by default (T-189), so here in its identity colour.
      const coverageColour = await fetch(`${server.baseUrl}/api/settings/plugins/simulator`).then((r) => r.json()).then(({ values }) =>
        fetch(`${server.baseUrl}/api/settings/plugins/simulator`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, coverageColour: { use: 'identity', colour: '#FD0909' } }) }));
      expect(coverageColour.status, 'the coverage in its identity colour').toBe(200);
      const page = await open();
      await switchTo(page, 'Simulation');
      const from = await positionAt(page, await mapCentre(page));
      expect(Math.abs(from[0] - from[1]), 'latitude ≠ longitude').toBeGreaterThan(1);
      const { layerId } = await simulation(server, all);
      const platform = trackRequest(layerId, 'Hawk', from);
      await applied(all, platform);
      // Nearly east and west, so that the map shows them all; well off the edges (gmti cuts on the measured position).
      const at = [
        { name: 'A', metres: 300 * KM, azimuth: 80 },
        { name: 'B', metres: 390 * KM, azimuth: 275 },
        { name: 'C', metres: 500 * KM, azimuth: 85 },
        { name: 'D', metres: 520 * KM, azimuth: 265 },
        { name: 'E', metres: 545 * KM, azimuth: 95 },
        { name: 'F', metres: 550 * KM, azimuth: 272 },
      ];
      const [a, b, c, d, e, f] = await tracksAround(all, layerId, at, from);
      await zoomOutTo(page, from, 600 * KM);
      const none = await redPixels(page);
      testInfo.annotations.push({ type: 'red pixels before', description: String(none) });

      // Each step: paused for two ticks (a tick while paused drops the next revisit), set, started, so that the first
      // running tick is a revisit (function 28; Sensors.tick). The pairing and the warning are set at a revisit's last
      // dwell (function 30), and from M8 a revisit is filled with one dwell a second (T-196), so the steps use 3 s.
      const revisitWith = async (settings: Record<string, unknown>) => {
        await simulator(server, '/routes/pause', {});
        await pause(2_500);
        await simulator(server, '/sensors', { platform: platform.entityId, ...settings });
        await simulator(server, '/routes/start', {});
      };
      const kinds = async () => ({ pairing: await related(all, platform.entityId, PAIRING), beyond: await related(all, platform.entityId, BEYOND) });
      const sensor = async () => (await simulator(server, '/sensors')).sensors[0];
      await simulator(server, '/sensors', { platform: platform.entityId, create: true, revisitSeconds: 3, detectAll: true, maxRange: 400 * KM, outputs: ['gmti/vista'] });

      // "Detect all" at 400 km: no warning, the pairing for every track it sees.
      await simulator(server, '/routes/start', {});
      await expect.poll(kinds, { timeout: 20_000, message: 'at 400 km' }).toEqual({ pairing: sorted([a, b]), beyond: [] });
      expect((await sensor()).outOfRange, 'no warning at 400 km').toEqual([]);

      // At 600 km: the near edge is 0, so beyond 511.98 km is beyond gmti's reach.
      await revisitWith({ maxRange: 600 * KM });
      await expect.poll(kinds, { timeout: 20_000, message: 'at 600 km' }).toEqual({ pairing: sorted([a, b, c]), beyond: sorted([d, e, f]) });
      await expect.poll(async () => (await sensor()).outOfRange, { message: 'the warning at 600 km' }).toEqual(['vista (GMTI)']);
      const warnings = page.getByRole('status', { name: 'Sensor warnings' });
      await expect(warnings, 'one line naming the sensor and the output').toHaveText('Hawk: some units are out of range for vista (GMTI)', { timeout: 10_000 });
      expect(await warnings.textContent(), 'no number in it').not.toMatch(/\d/);
      // The red lines (map-view-2d's function 34; simulator.beyond-reach is on by default, #FF0000, gmti.pairing off).
      await expect.poll(() => redPixels(page), { timeout: 10_000, message: 'red lines to the tracks beyond' }).toBeGreaterThan(none + 100);
      await page.screenshot({ path: testInfo.outputPath('beyond-reach.png') });

      // A band from 20 to 1 000 km (any bearing, every track, exactly): the edge is 20 + 511.98 = 531.98 km.
      await revisitWith({ detectAll: false, minRange: 20 * KM, maxRange: 1_000 * KM, startBearing: 0, endBearing: 360, detectionProbability: 1, rangeError: 0, crossRangeError: 0, minimumDetectableSpeed: 0 });
      await expect.poll(kinds, { timeout: 20_000, message: 'a band from 20 km' }).toEqual({ pairing: sorted([a, b, c, d]), beyond: sorted([e, f]) });
      expect((await sensor()).outOfRange, 'still the warning').toEqual(['vista (GMTI)']);

      // A revisit of 600 s now: its last dwell, and so the next pairing, is 600 s away.
      await revisitWith({ revisitSeconds: 600 });
      await expect.poll(kinds, { timeout: 10_000, message: 'unchanged at the start of a long revisit' }).toEqual({ pairing: sorted([a, b, c, d]), beyond: sorted([e, f]) });
      // Deselected: at once (the next revisit's end is 600 s away), every detected track paired, nothing beyond, no warning, no red.
      const deselected = Date.now();
      await simulator(server, '/sensors', { platform: platform.entityId, outputs: [] });
      await expect.poll(kinds, { timeout: 10_000, message: 'gmti deselected' }).toEqual({ pairing: sorted([a, b, c, d, e, f]), beyond: [] });
      testInfo.annotations.push({ type: 'relations after the deselection', description: `${Date.now() - deselected} ms` });
      expect((await sensor()).outOfRange, 'no warning').toEqual([]);
      await expect(warnings, 'the text goes').toHaveCount(0, { timeout: 10_000 });
      await expect.poll(() => redPixels(page), { timeout: 10_000, message: 'the red lines go' }).toBeLessThanOrEqual(none + 20);
      await simulator(server, '/routes/pause', {});
    } finally {
      await all.close();
    }
  });
});

/** The Simulation workspace as a new subscription sees it: its layers and objects. */
async function simulationPicture(server: OwnServer): Promise<{ layers: State[]; objects: State[] }> {
  const client = await LiveClient.open(server.baseUrl);
  try {
    const snapshot = await client.subscribe({ workspaces: [SIMULATION] });
    const layers = (snapshot.layers as State[]).filter((l) => l.workspace === SIMULATION);
    const ids = new Set(layers.map((l) => l.id));
    return { layers, objects: (snapshot.objects as State[]).filter((o) => ids.has(o.layerId)) };
  } finally {
    await client.close();
  }
}

function nameOf(o: State): string {
  return o.properties?.name ?? '';
}

/** Extensions with a route's groups set aside (they are checked on their own). */
function withoutGroups(extensions: any): unknown {
  return extensions?.simulator?.groups === undefined ? extensions : { ...extensions, simulator: { ...extensions.simulator, groups: '(checked last)' } };
}

/** Replaces every id of `map` in a JSON value. */
function remapped(value: unknown, map: Map<string, string>): unknown {
  let text = JSON.stringify(value ?? null);
  for (const [from, to] of map) text = text.split(from).join(to);
  return JSON.parse(text);
}

test('criterion 46 (with 47\'s Mission): a simulation of two routes, three tracks and a sensor with its output and Mission, exported in the browser and imported as new on a second server, is the same simulation with new ids and every reference remapped; a version 2 file and a simulator part over 1 MiB are refused before any change; "as new" asks first, cancelled it changes nothing, and a locked layer\'s refusal is listed; "merge" keeps what is there', async ({ browser }, testInfo) => {
  let exported: State = {};
  let fileText = '';
  let hawkId = '';
  let trackBId = '';

  // The first server: the simulation, and its export through the Routes panel.
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await everyWorkspace(server);
    try {
      const port = await freeUdpPort();
      await setGmti(server, [{ name: 'vista', mode: 'udp', direction: 'out', host: '127.0.0.1', port }]);
      const { layerId } = await simulation(server, all);
      const trackB = trackRequest(layerId, 'TRACK B', [-4.0, 41.0]);
      await applied(all, trackB);
      trackBId = trackB.entityId;
      // Route B's first point hides TRACK B: an event that names a track (function 13).
      const routeB = routeRequest(layerId, 'Route B', [[-4.0, 41.0], [-4.3, 41.1]], [{ kind: 'hide', objects: [trackB.entityId] }]);
      await applied(all, routeB);
      await simulator(server, '/put-on-route', { route: routeB.entityId, kind: 'single', objects: [trackB.entityId] });
      // The platform, paired with TRACK B and with an object not in the file (dropped on import).
      const hawk = trackRequest(layerId, 'Hawk', PLATFORM);
      hawk.data.relations = [{ kind: PAIRING, objectId: trackB.entityId }, { kind: PAIRING, objectId: crypto.randomUUID() }];
      await applied(all, hawk);
      hawkId = hawk.entityId;
      await simulator(server, '/sensors', { platform: hawk.entityId, create: true, revisitSeconds: 7, mission: 'ATO-2611-BRAVO', outputs: ['gmti/vista'] });

      const page = await open();
      await switchTo(page, 'Simulation');
      await scenarioItem(page).choose('Export scenario…');
      const dialog = page.getByRole('alertdialog', { name: 'Export scenario', exact: true });
      await dialog.getByRole('textbox', { name: 'Scenario name', exact: true }).fill('ITA scenario');
      const download = page.waitForEvent('download');
      await dialog.getByRole('button', { name: 'Export', exact: true }).click();
      const file = await download;
      expect(file.suggestedFilename(), 'the file name').toBe('ITA scenario.emcc-scenario.json');
      fileText = readFileSync((await file.path())!, 'utf8');
      exported = JSON.parse(fileText);
      testInfo.annotations.push({ type: 'exported', description: `${fileText.length} characters` });

      const picture = await simulationPicture(server);
      expect(exported, 'the format').toMatchObject({ format: 'emcc-simulator-scenario', version: 1, name: 'ITA scenario' });
      expect((exported.layers as State[]).map((l) => l.id).sort(), 'every Simulation layer').toEqual(picture.layers.map((l) => l.id).sort());
      expect((exported.objects as State[]).map(nameOf).sort(), 'two routes, three tracks').toEqual(['Hawk', 'Route B', 'Runner', 'Runner route', 'TRACK B']);
      expect(exported.simulator.sensors, 'the sensor with its Mission and output').toMatchObject([{ platform: hawk.entityId, settings: { mission: 'ATO-2611-BRAVO', revisitSeconds: 7, outputs: ['gmti/vista'] } }]);
    } finally {
      await all.close();
    }
  });

  // A second server: an old simulation (a locked layer with a track), then the imports.
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await everyWorkspace(server);
    try {
      const old = await applied(all, createLayer('Old', { workspace: SIMULATION, drawOrder: 5 }));
      const oldTrack = trackRequest(old.entityId, 'Old track', [10.0, 45.0]);
      await applied(all, oldTrack);
      const { id, version, meta: _meta, ...data } = old.state!;
      await applied(all, { requestId: crypto.randomUUID(), entityType: 'layer', operation: 'update', entityId: id, baseVersion: version, data: { ...data, locked: true }, source: { plugin: 'ita-test' } } as never);
      const before = await simulationPicture(server);
      const ids = (p: { layers: State[]; objects: State[] }) => [...p.layers.map((l) => l.id), ...p.objects.map((o) => o.id)].sort();

      const page = await open();
      await switchTo(page, 'Simulation');
      const { input, box: routes } = scenarioItem(page); // the results show in the Scenario item's popover
      const load = (name: string, text: string) => input.setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });

      // Refused before any change: a newer version, and a simulator part over 1 MiB.
      await load('v2.emcc-scenario.json', JSON.stringify({ ...exported, version: 2 }));
      await expect(routes).toContainText('The scenario is of version 2, made by a newer emcc; this one reads version 1');
      await load('big.emcc-scenario.json', JSON.stringify({ ...exported, simulator: { ...exported.simulator, outputs: Array.from({ length: 25_000 }, (_, i) => `cot/link-${i}-${'x'.repeat(40)}`) } }));
      await expect(routes).toContainText('The scenario\'s simulator part is larger than 1 MiB, the most the server takes');
      expect(ids(await simulationPicture(server)), 'nothing changed').toEqual(ids(before));

      // As new, cancelled: nothing changes.
      const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
      const question = `Delete ${count(before.layers.length, 'layer')} and ${count(before.objects.length, 'object')} of Simulation?`;
      await load('ITA scenario.emcc-scenario.json', fileText);
      let ask = page.getByRole('alertdialog', { name: 'Import ITA scenario', exact: true });
      await expect(ask).toContainText(`${count((exported.layers as State[]).length, 'layer')} and 5 objects.`);
      await expect(ask.getByRole('combobox', { name: 'Import', exact: true }).locator('option:checked')).toHaveText('As new');
      await ask.getByRole('button', { name: 'Import', exact: true }).click();
      let confirm = page.getByRole('alertdialog', { name: 'Import as new', exact: true });
      await expect(confirm, 'asked first').toContainText(question);
      await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(confirm).toHaveCount(0);
      expect(ids(await simulationPicture(server)), 'cancelled: nothing changed').toEqual(ids(before));

      // As new, confirmed: the old objects go, but the locked layer's are refused and listed.
      await load('ITA scenario.emcc-scenario.json', fileText);
      ask = page.getByRole('alertdialog', { name: 'Import ITA scenario', exact: true });
      await ask.getByRole('button', { name: 'Import', exact: true }).click();
      confirm = page.getByRole('alertdialog', { name: 'Import as new', exact: true });
      await confirm.getByRole('button', { name: 'Delete and import', exact: true }).click();
      await expect(routes).toContainText(/Imported: \d+ layers and objects created/, { timeout: 30_000 });
      const refused = routes.getByRole('list', { name: 'Refused' });
      await expect(refused, 'the locked layer\'s refusal').toContainText(/lock/i);
      testInfo.annotations.push({ type: 'as new', description: (await routes.textContent()) ?? '' });

      const after = await simulationPicture(server);
      expect(after.objects.filter((o) => o.id === oldTrack.entityId), 'the locked layer\'s track stays').toHaveLength(1);
      const oldIds = new Set<string>([...(exported.layers as State[]).map((l) => l.id), ...(exported.objects as State[]).map((o) => o.id)]);
      const fresh = after.objects.filter((o) => !before.objects.some((b) => b.id === o.id));
      expect(fresh.map(nameOf).sort(), 'the scenario\'s objects').toEqual(['Hawk', 'Route B', 'Runner', 'Runner route', 'TRACK B']);
      for (const o of fresh) expect(oldIds.has(o.id), `${nameOf(o)}: a new id`).toBe(false);
      const newLayers = after.layers.filter((l) => !before.layers.some((b) => b.id === l.id));
      // Every layer of the file, the simulator's own first layer of the first server among them.
      expect(newLayers.map((l) => l.name).sort(), 'the scenario\'s layers').toEqual((exported.layers as State[]).map((l) => l.name).sort());
      for (const l of newLayers) expect(oldIds.has(l.id), 'the layer: a new id').toBe(false);

      // Every reference remapped: the old ids by name to the new ones; a relation to an object not in the file dropped.
      const map = new Map<string, string>();
      for (const o of exported.objects as State[]) map.set(o.id, fresh.find((f) => nameOf(f) === nameOf(o))!.id);
      const fullLayer = (exported.objects as State[])[0].layerId as string;
      map.set(fullLayer, fresh.find((f) => nameOf(f) === nameOf((exported.objects as State[])[0]))!.layerId);
      expect(newLayers.map((l) => l.id), 'the objects in a new layer').toContain(map.get(fullLayer));
      for (const o of exported.objects as State[]) {
        const now = fresh.find((f) => nameOf(f) === nameOf(o))!;
        expect(now.layerId, `${nameOf(o)}: in the new layer`).toBe(map.get(o.layerId));
        expect(now.geometry, `${nameOf(o)}: where it was`).toEqual(o.geometry);
        // A route's groups (its tracks) are checked last, below.
        expect(withoutGroups(now.extensions ?? null), `${nameOf(o)}: its extensions, remapped`).toEqual(withoutGroups(remapped(o.extensions, map)));
        const kept = ((o.relations ?? []) as Relation[]).filter((r) => map.has(r.objectId));
        expect(now.relations ?? [], `${nameOf(o)}: its relations, remapped, the one to an object not in the file dropped`).toEqual(remapped(kept, map));
      }
      const hawk = fresh.find((f) => nameOf(f) === 'Hawk')!;
      expect(hawk.relations, 'Hawk paired with the new TRACK B').toEqual([{ kind: PAIRING, objectId: map.get(trackBId) }]);
      const routeB = fresh.find((f) => nameOf(f) === 'Route B')!;
      expect(JSON.stringify(routeB.extensions), 'the event names the new TRACK B').toContain(map.get(trackBId)!);
      const sensors = (await simulator(server, '/sensors')).sensors;
      expect(sensors, 'the sensor on the new Hawk, its Mission kept, its output missing here').toMatchObject([{ platform: map.get(hawkId), missing: false, settings: { mission: 'ATO-2611-BRAVO', revisitSeconds: 7 }, outputs: [{ id: 'gmti/vista', missing: true }] }]);
      const state = await simulator(server, '/scenario-state');
      expect(JSON.stringify(state), 'no old id in the simulator\'s state').not.toMatch(new RegExp([...oldIds].join('|')));

      // Merge: added beside, what is there kept.
      await load('ITA scenario.emcc-scenario.json', fileText);
      ask = page.getByRole('alertdialog', { name: 'Import ITA scenario', exact: true });
      await ask.getByRole('combobox', { name: 'Import', exact: true }).selectOption({ label: 'Merge' });
      await ask.getByRole('button', { name: 'Import', exact: true }).click();
      await expect(page.getByRole('alertdialog', { name: 'Import as new', exact: true }), 'merge asks nothing more').toHaveCount(0);
      await expect.poll(async () => (await simulationPicture(server)).objects.length, { timeout: 30_000, message: 'merged beside' }).toBe(after.objects.length + 5);
      const merged = await simulationPicture(server);
      for (const o of after.objects) expect(merged.objects.some((m) => m.id === o.id), `${nameOf(o)} kept`).toBe(true);
      // Polled: the browser makes the objects first, then posts the sensors (POST /scenario-state), so the objects can
      // be there a moment before the second sensor (once in the M7 RC1 full run; 3 of 3 alone).
      await expect.poll(async () => (await simulator(server, '/sensors')).sensors.length, { timeout: 10_000, message: 'two sensors' }).toBe(2);

      // Last: each route imported as new keeps its tracks (its groups, remapped). Found on 2345b4c2: the route is
      // created with them, then the simulator's server part updates it to no groups (reported to PCA-simulator).
      for (const o of (exported.objects as State[]).filter((x) => x.dataType === 'simulator.route')) {
        const now = fresh.find((f) => nameOf(f) === nameOf(o))!;
        const stored = (await all.getObjects([now.id])).found[0];
        expect(stored.extensions?.simulator?.groups, `${nameOf(o)} keeps its tracks`).toEqual(remapped(o.extensions.simulator.groups, map));
      }
    } finally {
      await all.close();
    }
  });
});

/** The simulator's red (a hostile platform's identity colour, coverage.ts), as `redPixels` counts it. */
const isRedPixel = ([r, g, b]: number[]) => r > 180 && g < 90 && b < 90;
/** The job area's default colour from M8, #BDCF3D (T-189). */
const isJobArea = ([r, g, b]: number[]) => Math.abs(r - 189) <= 40 && Math.abs(g - 207) <= 40 && Math.abs(b - 61) <= 40;

/**
 * Down a column of the map from `y0` to `y1`: the runs of rows with red in the 5 columns round `x`.
 * A column, since a job area's west and east edges are meridians, straight in Web Mercator, while its
 * north and south edges are geodesics, which bow at this zoom.
 */
async function redRuns(page: Page, x: number, y0: number, y1: number, isRed = isRedPixel): Promise<number[]> {
  const image = decodePng(await page.screenshot({ clip: { x: x - 2, y: y0, width: 5, height: y1 - y0 } }));
  const runs: number[] = [];
  let run = 0;
  for (let y = 0; y < image.height; y++) {
    let red = false;
    for (let c = 0; c < image.width; c++) if (isRed(image.pixel(c, y))) red = true;
    if (red) run++;
    else if (run > 0) {
      runs.push(run);
      run = 0;
    }
  }
  if (run > 0) runs.push(run);
  return runs;
}

/** The sensor's stored settings (GET /sensors). */
async function sensorOf(server: OwnServer, platform: string): Promise<any> {
  return (await simulator(server, '/sensors')).sensors.find((s: { platform: string }) => s.platform === platform);
}

test('a job area in the browser (simulator function 39, criterion 59; no generic sensor in M6, owner PX): "New sensor" makes a ground radar without a type; "Draw job area" drags a rectangle, saved as four corners closed and drawn dotted; "Clear job area" removes it from the sensor and the map; four points are saved in the order drawn, five are refused', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await everyWorkspace(server);
    try {
      await gmtiLoop(server);
      const page = await open();
      await switchTo(page, 'Simulation');
      const layer = createLayer('Ground truth', { workspace: SIMULATION, drawOrder: 1 });
      await applied(all, layer);
      const centre = await mapCentre(page);
      const at: Point = { x: centre.x - 40, y: centre.y + 20 };
      const track = trackRequest(layer.entityId, 'TRACK J', await positionAt(page, at));
      track.data.symbol = { standard: 'APP-6B', sidc: 'SHGPUCI--------' }; // hostile: the job area is drawn red
      await applied(all, track);

      // "New sensor" on the selected track: a ground radar, no type asked.
      const sensors = region(page, 'Sensors');
      const create = sensors.getByRole('button', { name: 'New sensor', exact: true });
      await expect(async () => {
        await page.mouse.click(at.x, at.y);
        await userPause(page);
        await expect(create).toBeEnabled({ timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await create.click();
      const form = sensors.getByRole('region', { name: 'Sensor TRACK J', exact: true });
      await expect(form).toBeVisible();
      await expect(page.getByRole('alertdialog', { name: 'New sensor', exact: true }), 'no type asked').toHaveCount(0);
      expect((await sensorOf(server, track.entityId))?.settings.type, 'a ground radar').toBe('GROUND_RADAR');
      const field = (label: string) => form.getByRole('textbox', { name: label, exact: true });
      // A small band, so that the coverage wedge stays clear of the job area's edges.
      await field('Min range (km)').fill('1');
      await field('Max range (km)').fill('2');
      await form.getByRole('button', { name: 'Save', exact: true }).click();
      await expect.poll(async () => (await sensorOf(server, track.entityId))?.settings.maxRange, { message: 'saved' }).toBe(2000);

      // "Draw job area": a rectangle dragged corner to corner.
      const jobArea = form.getByRole('group', { name: 'Job area', exact: true });
      await expect(jobArea).toContainText('None: the sensor covers its whole area.');
      const nw = { x: at.x - 160, y: at.y - 110 };
      const se = { x: at.x + 160, y: at.y + 110 };
      const [west, north] = await positionAt(page, nw);
      const [east, south] = await positionAt(page, se);
      const tolerance = 3 * Math.abs(east - west) / (se.x - nw.x);
      await jobArea.getByRole('button', { name: 'Draw job area', exact: true }).click();
      await drag(page, nw, se);
      await expect.poll(async () => (await sensorOf(server, track.entityId))?.settings.jobArea?.coordinates?.[0]?.length ?? 0, { timeout: 10_000, message: 'the rectangle saved' }).toBe(5);
      const ring = (await sensorOf(server, track.entityId)).settings.jobArea.coordinates[0] as LonLat[];
      expect(ring[4], 'closed').toEqual(ring[0]);
      const lons = ring.map((p) => p[0]);
      const lats = ring.map((p) => p[1]);
      expect(Math.abs(Math.min(...lons) - west), 'west edge').toBeLessThan(tolerance);
      expect(Math.abs(Math.max(...lons) - east), 'east edge').toBeLessThan(tolerance);
      expect(Math.abs(Math.max(...lats) - north), 'north edge').toBeLessThan(tolerance);
      expect(Math.abs(Math.min(...lats) - south), 'south edge').toBeLessThan(tolerance);
      expect(new Set(ring.slice(0, 4).map((p) => p.join())).size, 'four corners').toBe(4);
      await expect(jobArea).toContainText('Four corners: only tracks inside it are detected.');

      // Drawn dotted: down the west edge many short runs of its colour (#BDCF3D by default from M8, T-189). From M7 the
      // outline is 3 px wide and stays dotted (simulator function 41, M7-S1; m7-sensors checks the look), and the dots
      // grow with the width.
      await page.mouse.move(at.x, at.y + 200);
      const edge = () => redRuns(page, nw.x, nw.y + 30, se.y - 30, isJobArea);
      await expect.poll(async () => (await edge()).length, { timeout: 10_000, message: 'the dotted outline' }).toBeGreaterThan(10);
      const runs = await edge();
      testInfo.annotations.push({ type: 'west edge runs', description: `${JSON.stringify(runs)} over ${se.y - nw.y - 60} px` });
      expect(Math.max(...runs), 'dots, not dashes or a line').toBeLessThanOrEqual(6);

      // "Clear job area": gone from the sensor and from the map.
      await jobArea.getByRole('button', { name: 'Clear job area', exact: true }).click();
      await expect.poll(async () => (await sensorOf(server, track.entityId))?.settings.jobArea ?? null, { message: 'cleared' }).toBeNull();
      await expect.poll(async () => (await edge()).length, { timeout: 10_000, message: 'gone from the map' }).toBe(0);
      await expect(jobArea).toContainText('None: the sensor covers its whole area.');

      // Four points, in the order clicked (not a rectangle), then Enter.
      const clicked = [{ x: at.x - 150, y: at.y - 90 }, { x: at.x + 140, y: at.y - 120 }, { x: at.x + 170, y: at.y + 100 }, { x: at.x - 120, y: at.y + 110 }];
      const corners: LonLat[] = [];
      for (const p of clicked) corners.push(await positionAt(page, p));
      const drawPoints = async (points: Point[]) => {
        await jobArea.getByRole('button', { name: 'Draw job area as four points', exact: true }).click();
        for (const p of points) {
          await page.mouse.click(p.x, p.y);
          await userPause(page);
        }
        await page.keyboard.press('Enter');
      };
      await drawPoints(clicked);
      await expect.poll(async () => (await sensorOf(server, track.entityId))?.settings.jobArea?.coordinates?.[0]?.length ?? 0, { timeout: 10_000, message: 'four points saved' }).toBe(5);
      const four = (await sensorOf(server, track.entityId)).settings.jobArea.coordinates[0] as LonLat[];
      for (const [i, c] of corners.entries()) {
        expect(Math.hypot(four[i][0] - c[0], four[i][1] - c[1]), `corner ${i + 1} in the order drawn`).toBeLessThan(tolerance);
      }
      expect(four[4]).toEqual(four[0]);

      // Five points: refused, and the four corners stay.
      await drawPoints([...clicked.slice(0, 2), { x: at.x + 200, y: at.y }, ...clicked.slice(2)]);
      await expect(sensors, 'refused with the message').toContainText('A job area has four corners');
      expect((await sensorOf(server, track.entityId)).settings.jobArea.coordinates[0], 'unchanged').toEqual(four);
      await jobArea.getByRole('button', { name: 'Clear job area', exact: true }).click();
      await expect.poll(async () => (await sensorOf(server, track.entityId))?.settings.jobArea ?? null).toBeNull();
    } finally {
      await all.close();
    }
  });
});

test('a scenario file with a generic sensor (criterion 52; owner PX and Q52 B): imported, its ground radar and both platforms load, the generic sensor is left out and listed as "<name>: generic sensors come later; not loaded"', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await everyWorkspace(server);
    try {
      const layer = createLayer('Ground truth', { workspace: SIMULATION, drawOrder: 1 });
      await applied(all, layer);
      const hawk = trackRequest(layer.entityId, 'Hawk', PLATFORM);
      const eye = trackRequest(layer.entityId, 'Eye', [16.2, 58.9]);
      await applied(all, hawk);
      await applied(all, eye);
      await simulator(server, '/sensors', { platform: hawk.entityId, create: true, revisitSeconds: 7, mission: 'ATO-HAWK' });

      // Exported in the browser, then a generic sensor on Eye added, as a later version or a hand would write it.
      const page = await open();
      await switchTo(page, 'Simulation');
      const scenario = scenarioItem(page);
      const routes = scenario.box; // the results show in the Scenario item's popover (T-152)
      await scenario.choose('Export scenario…');
      const dialog = page.getByRole('alertdialog', { name: 'Export scenario', exact: true });
      await dialog.getByRole('textbox', { name: 'Scenario name', exact: true }).fill('ITA generic');
      const download = page.waitForEvent('download');
      await dialog.getByRole('button', { name: 'Export', exact: true }).click();
      const exported = JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
      expect(exported.simulator.sensors, 'the ground radar exported').toHaveLength(1);
      const radar = exported.simulator.sensors[0];
      const generic = { ...radar, platform: eye.entityId, settings: { ...radar.settings, type: 'GENERIC', range: 50_000, positionError: 50, mission: 'ATO-EYE' } };
      const file = { ...exported, simulator: { ...exported.simulator, sensors: [radar, generic] } };
      testInfo.annotations.push({ type: 'generic sensor in the file', description: JSON.stringify(generic) });

      // Imported beside what is there (Merge): the rest loads, the generic sensor is listed and not loaded.
      const before = await simulationPicture(server);
      await scenario.input.setInputFiles({ name: 'ITA generic.emcc-scenario.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
      const ask = page.getByRole('alertdialog', { name: 'Import ITA generic', exact: true });
      await ask.getByRole('combobox', { name: 'Import', exact: true }).selectOption({ label: 'Merge' });
      await ask.getByRole('button', { name: 'Import', exact: true }).click();
      await expect(routes).toContainText('Eye: generic sensors come later; not loaded', { timeout: 30_000 });
      testInfo.annotations.push({ type: 'after the import', description: (await routes.textContent()) ?? '' });

      await expect.poll(async () => (await simulationPicture(server)).objects.length, { timeout: 30_000, message: 'both platforms loaded' }).toBe(before.objects.length + 2);
      const fresh = (await simulationPicture(server)).objects.filter((o) => !before.objects.some((b) => b.id === o.id));
      expect(fresh.map(nameOf).sort(), 'Hawk and Eye, new').toEqual(['Eye', 'Hawk']);
      const sensors = (await simulator(server, '/sensors')).sensors as Array<{ platform: string; settings: State }>;
      expect(sensors.map((s) => s.settings.type), 'two ground radars, the old Hawk\'s and the new one\'s; no generic sensor').toEqual(['GROUND_RADAR', 'GROUND_RADAR']);
      const newHawk = fresh.find((o) => nameOf(o) === 'Hawk')!;
      const newEye = fresh.find((o) => nameOf(o) === 'Eye')!;
      expect(sensors.find((s) => s.platform === newHawk.id)?.settings.mission, 'the new Hawk\'s radar, its Mission kept').toBe('ATO-HAWK');
      expect(sensors.some((s) => s.platform === newEye.id), 'nothing on the new Eye').toBe(false);
    } finally {
      await all.close();
    }
  });
});
