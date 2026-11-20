// Quick run: @plugin-simulator @plugin-cot @tak @settings
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/flows/m3-sim-outputs.spec.ts
import { expect, test, type Page } from '@playwright/test';
import { setLinks } from '../../lib/cot';
import { createLayer, createSymbol, LiveClient } from '../../lib/live.mjs';
import { bottomPanel, mapCentre, nextEvent, positionAt, withM0 } from '../../lib/m0';
import type { OwnServer } from '../../lib/own-server';
import { startTakDouble } from '../../lib/tak-double.mjs';

// The simulator's outputs in the browser (T-086 part 5b; the simulator brief's criteria 13 and 14),
// without login, each test on a server of its own with every plugin and the ITA's TAK test double.
// cot's out links are the output channels; the Outputs panel chooses them. What goes out without a
// browser is in flows/m3-simulator.spec.ts; only an admin may change outputStaleSeconds, which
// keycloak/simulator-rights.spec.ts checks.

test.describe.configure({ timeout: 240_000 });

const SIMULATION = 'simulator.simulation';
const DEFAULT_STALE = 5; // the simulator's default outputStaleSeconds

type Event = { entityType: string; entityId: string; operation: string; state: Record<string, any> | null };
type Double = Awaited<ReturnType<typeof startTakDouble>>;

function views(page: Page) {
  return page.getByRole('tablist', { name: 'Views' });
}

async function switchTo(page: Page, name: 'View' | 'Simulation'): Promise<void> {
  await views(page).getByRole('tab', { name, exact: true }).click();
  await expect(views(page).getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name }).getByRole('tab', { name: 'Layers', exact: true })).toBeVisible();
  await bottomPanel(page, 'Layers'); // Simulation's bottom pane may show Objects first (M4, T-108)
}

function outputs(page: Page) {
  return page.getByRole('region', { name: 'Ground truth outputs', exact: true }).first();
}

function routesPanel(page: Page) {
  return page.getByRole('region', { name: 'Routes', exact: true }).first();
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

/** PUT of the simulator's settings; resolves with the status. */
async function setStaleSeconds(server: OwnServer, value: unknown): Promise<number> {
  const url = `${server.baseUrl}/api/settings/plugins/simulator`;
  const values = (await (await fetch(url)).json()).values;
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, outputStaleSeconds: value }) });
  return response.status;
}

/** Seconds from an event's time to its stale time. */
const expiry = (e: { time?: string; stale?: string }) => (Date.parse(e.stale!) - Date.parse(e.time!)) / 1000;

/**
 * A Simulation layer, a route through three points of the map (latitude ≠ longitude) at 50 m/s
 * with `firstEvents` at its first point, and tracks: `onRoute` put on it, `standing` on no route.
 */
async function simulation(page: Page, server: OwnServer, all: LiveClient, firstEvents: (ids: string[]) => unknown[] = () => []) {
  const layer = createLayer('Ground truth', { workspace: SIMULATION, drawOrder: 1 });
  await applied(all, layer);
  const centre = await mapCentre(page);
  const coordinates: number[][] = [];
  for (const [dx, dy] of [[-160, 70], [-10, -50], [150, 30]]) coordinates.push(await positionAt(page, { x: centre.x + dx, y: centre.y + dy }));
  const ids: string[] = [];
  for (const [i, name] of ['ALPHA', 'BRAVO', 'CHARLIE'].entries()) {
    const track = createSymbol(layer.entityId, 0, { name }) as any;
    track.data.geometry.coordinates = [coordinates[0][0] - 0.3 * i, coordinates[0][1] - 0.4];
    track.data.symbol = { standard: 'APP-6B', sidc: 'SFGPUCI--------' };
    await applied(all, track);
    ids.push(track.entityId);
  }
  const route = createSymbol(layer.entityId, 0, { name: 'Route A' }) as any;
  route.data = {
    type: 'core.shape',
    dataType: 'simulator.route',
    dataSource: 'manual',
    layerId: layer.entityId,
    geometry: { type: 'LineString', coordinates },
    style: { strokeColor: '#2C784C', strokeWidth: 2, strokeDash: 'dash', pointMarkers: 'circle' },
    properties: { name: 'Route A' },
    label: route.data.label,
    extensions: { simulator: { points: coordinates.map((_, i) => ({ speedKind: 'instant', speed: 50, events: i === 0 ? firstEvents(ids) : [] })), groups: [], end: 'stop' } },
  };
  await applied(all, route);
  return { routeId: route.entityId as string, ids };
}

/** The out links to the double: `sim-out`, and `sim-other` which is offered but not chosen. */
async function linkCot(server: OwnServer, double: Double, names = ['sim-out', 'sim-other']) {
  await setLinks(server, names.map((name) => ({ name, direction: 'out', port: double.port })));
}

async function withDouble(body: (double: Double) => Promise<void>): Promise<void> {
  const double = await startTakDouble({});
  try {
    await body(double);
  } finally {
    await double.close();
  }
}

test('criterion 13: the Outputs panel lists every offered channel with its type, deletes and fields; the one chosen there gets every track at each tick with an expiry of outputStaleSeconds, a standing one every second, a hidden one no more; outputStaleSeconds outside 1 to 3 600 is refused, and a new value applies from the next tick', async ({ browser }, testInfo) => {
  await withDouble(async (double) => {
    await withM0(testInfo, browser, async ({ server, open }) => {
      const all = await LiveClient.open(server.baseUrl);
      try {
        await all.subscribe({ workspaces: ['*'] });
        const page = await open();
        await switchTo(page, 'Simulation');
        // ALPHA and BRAVO on the route; BRAVO hidden as it leaves the first point; CHARLIE on no route.
        const { routeId, ids } = await simulation(page, server, all, (ids) => [{ kind: 'hide', objects: [ids[1]] }]);
        const [alpha, bravo, charlie] = ids;
        await linkCot(server, double);
        await double.waitForConnections(2);

        // The panel: each channel as GET /outputs gives it, none chosen.
        await expect.poll(async () => (await simulator(server, '/outputs')).channels.map((c: { id: string }) => c.id).sort(), { timeout: 10_000 }).toEqual(['cot/sim-other', 'cot/sim-out']);
        const served = await simulator(server, '/outputs');
        testInfo.annotations.push({ type: 'channels', description: JSON.stringify(served.channels) });
        for (const c of served.channels as { name: string; plugin: string; outputType: string; canDelete: boolean; fields: string[]; chosen: boolean }[]) {
          const row = outputs(page).getByRole('list', { name: 'Output channels' }).getByRole('listitem', { name: c.name, exact: true });
          await expect(row).toContainText(`${c.plugin} · ${c.outputType === '' ? 'output' : c.outputType} · ${c.canDelete ? 'sends deletes' : 'sends no deletes'}`);
          if (c.fields.length > 0) await expect(row).toContainText('Uses ');
          await expect(row.getByRole('checkbox')).not.toBeChecked();
        }
        // Chosen in the panel.
        await outputs(page).getByRole('listitem', { name: 'sim-out', exact: true }).getByRole('checkbox').click(); // checked once the server has the choice
        await expect.poll(async () => (await simulator(server, '/outputs')).chosen).toEqual([{ id: 'cot/sim-out', missing: false }]);

        await simulator(server, '/put-on-route', { route: routeId, kind: 'single', objects: [alpha, bravo] });
        await routesPanel(page).getByRole('button', { name: 'Start all routes' }).click();
        await nextEvent(all, (e) => e.entityId === bravo && e.state?.extensions?.simulator?.hidden === true, 15_000);
        const hiddenAt = Date.now();
        const sent = (uid: string) => double.receivedEvents().filter((e: { uid: string }) => e.uid === uid);
        await expect.poll(() => sent(alpha).length, { timeout: 15_000, message: 'ALPHA at several ticks' }).toBeGreaterThanOrEqual(5);
        await expect.poll(() => sent(charlie).length, { timeout: 15_000, message: 'CHARLIE at several ticks' }).toBeGreaterThanOrEqual(5);
        // Only the chosen channel's link sends: the double gets each tick once per track.
        const ticks = (uid: string) => new Set(sent(uid).map((e: { time?: string }) => e.time)).size;
        expect(sent(alpha).length, 'once per tick').toBe(ticks(alpha));
        for (const e of [...sent(alpha), ...sent(charlie)]) expect(expiry(e), `${e.uid}: stale ${DEFAULT_STALE} s after its time`).toBeCloseTo(DEFAULT_STALE, 0);
        // CHARLIE stands on no route: sent every second, so it never goes stale at the double.
        const times = sent(charlie).map((e: { time?: string }) => Date.parse(e.time!)).sort((a: number, b: number) => a - b);
        for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1], 'CHARLIE every tick').toBeLessThanOrEqual(1_500);
        // BRAVO hidden: no update after the tick that hid it.
        await new Promise((r) => setTimeout(r, 3_000));
        const afterHidden = sent(bravo).filter((e: { time?: string; type?: string }) => e.type !== 't-x-d-d' && Date.parse(e.time!) > hiddenAt + 1_000);
        expect(afterHidden, 'the hidden track not sent').toEqual([]);

        // outputStaleSeconds: the schema refuses 0 and 3 601; 30 applies from the next tick.
        expect(await setStaleSeconds(server, 0), 'outputStaleSeconds 0').toBe(400);
        expect(await setStaleSeconds(server, 3_601), 'outputStaleSeconds 3 601').toBe(400);
        expect(await setStaleSeconds(server, 30)).toBe(200);
        const changed = Date.now();
        await expect.poll(() => sent(charlie).filter((e: { time?: string }) => Date.parse(e.time!) > changed + 1_000).length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
        for (const e of sent(charlie).filter((e: { time?: string }) => Date.parse(e.time!) > changed + 1_000)) expect(expiry(e), 'stale 30 s after its time').toBeCloseTo(30, 0);
      } finally {
        await all.close();
      }
    });
  });
});

test('criterion 14: the chosen cot link renamed or removed shows as missing in the Outputs panel, not dropped; with the link back, sending resumes', async ({ browser }, testInfo) => {
  await withDouble(async (double) => {
    await withM0(testInfo, browser, async ({ server, open }) => {
      const all = await LiveClient.open(server.baseUrl);
      try {
        await all.subscribe({ workspaces: ['*'] });
        const page = await open();
        await switchTo(page, 'Simulation');
        const { ids } = await simulation(page, server, all);
        const charlie = ids[2];
        await linkCot(server, double, ['sim-out']);
        await double.waitForConnections(1);
        await expect(outputs(page).getByRole('listitem', { name: 'sim-out', exact: true })).toBeVisible();
        await outputs(page).getByRole('listitem', { name: 'sim-out', exact: true }).getByRole('checkbox').click(); // checked once the server has the choice
        await routesPanel(page).getByRole('button', { name: 'Start all routes' }).click();
        const sent = () => double.receivedEvents().filter((e: { uid: string }) => e.uid === charlie);
        await expect.poll(() => sent().length, { timeout: 15_000, message: 'sending' }).toBeGreaterThanOrEqual(2);

        const missing = outputs(page).getByRole('listitem', { name: 'cot/sim-out', exact: true });
        const expectMissingThenBack = async (what: string, change: () => Promise<unknown>) => {
          await change();
          await expect(missing, `${what}: shown as missing`).toContainText('Missing');
          await expect(missing).toContainText('Chosen, but not offered now.');
          expect((await simulator(server, '/outputs')).chosen, `${what}: still chosen`).toEqual([{ id: 'cot/sim-out', missing: true }]);
          const quiet = sent().length;
          await page.waitForTimeout(2_500);
          expect(sent().length, `${what}: nothing sent while missing`).toBeLessThanOrEqual(quiet + 1);
          // The link back: offered and used again.
          await linkCot(server, double, ['sim-out']);
          await expect(missing).toHaveCount(0);
          await expect(outputs(page).getByRole('listitem', { name: 'sim-out', exact: true }).getByRole('checkbox')).toBeChecked();
          const back = sent().length;
          await expect.poll(() => sent().length, { timeout: 15_000, message: `${what}: sending resumes` }).toBeGreaterThanOrEqual(back + 2);
        };
        await expectMissingThenBack('renamed', () => linkCot(server, double, ['sim-renamed']));
        await expectMissingThenBack('removed', () => setLinks(server, []));
      } finally {
        await all.close();
      }
    });
  });
});
