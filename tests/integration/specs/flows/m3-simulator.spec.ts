// Quick run: @plugin-simulator @plugin-cot @tak @persistence
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/flows/m3-simulator.spec.ts
import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setLinks } from '../../lib/cot';
import { createLayer, createSymbol, LiveClient } from '../../lib/live.mjs';
import { stopOwnServer, withOwnServers, type OwnServer } from '../../lib/own-server';
import { installPlugins } from '../../lib/plugins.mjs';
import { startTakDouble } from '../../lib/tak-double.mjs';

// The simulator's output through cot, against the TAK test double (T-086 part 4; the simulator
// brief's criteria 12, 13, 15 to 19; ADR-0040, ADR-0041), on servers of the test's own with only
// the simulator and cot, and no browser at all (criterion 12): everything goes through the API
// as the panels would, with the local user's permissions. A Simulation layer holds two tracks
// and a short route; cot's out link `sim-out` is the simulator's output channel `cot/sim-out`, and
// its in link `sim-in` brings what the double relays back into a View layer. The 1 000-track load
// with browsers (criterion 21) is the performance suite's; the panels are checked in a browser
// once the shell has workspace tabs. Not here: events and their Removal (10), hidden tracks not
// sent (13, with the events), control in detail (11), outputStaleSeconds changed by an admin
// (13), a missing output (14), the round trip through the ESA's TAK Server (15, by hand, with the
// owner's yes).

test.describe.configure({ timeout: 240_000 });

const SIMULATION = 'simulator.simulation';
const OUT_STALE_SECONDS = 5; // the simulator's default outputStaleSeconds
type Event = { entityType: string; entityId: string; operation: string; sequenceNo: number; state: Record<string, any> | null };

/** The route's points: two legs of about 450 m each (latitude ≠ longitude), at 50 m/s. */
const POINTS: Array<[number, number]> = [
  [18.0, 59.0],
  [18.008, 59.0],
  [18.008, 59.004],
];

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

async function applied(client: LiveClient, request: { entityType: string; operation: string }) {
  const outcome = await client.change(request);
  expect(outcome, `${request.entityType} ${request.operation}`).toMatchObject({ outcome: 'applied' });
  return outcome.event as Event;
}

/** A Simulation layer, two APP-6B tracks and a route through POINTS; resolves with their ids. */
async function simulation(client: LiveClient) {
  const layer = createLayer('Ground truth', { workspace: SIMULATION });
  await applied(client, layer);
  const tracks: string[] = [];
  for (const [i, name] of ['ALPHA', 'BRAVO'].entries()) {
    const track = createSymbol(layer.entityId, 0, { name });
    track.data.geometry.coordinates = [17.99 - i / 100, 58.99];
    track.data.symbol = { standard: 'APP-6B', sidc: 'SFGPUCI--------' };
    await applied(client, track);
    tracks.push(track.entityId);
  }
  const route = createSymbol(layer.entityId, 0, { name: 'Route ITA' }) as any;
  route.data = {
    type: 'core.shape',
    dataType: 'simulator.route',
    dataSource: 'manual',
    layerId: layer.entityId,
    geometry: { type: 'LineString', coordinates: POINTS },
    style: { strokeColor: '#2C784C', strokeWidth: 2, strokeDash: 'dash', pointMarkers: 'circle' },
    properties: { name: 'Route ITA' },
    label: route.data.label,
    extensions: { simulator: { points: [{ speedKind: 'instant', speed: 50 }, { speedKind: 'instant', speed: 50 }, {}], groups: [], end: 'stop' } },
  };
  await applied(client, route);
  return { layer: layer.entityId as string, tracks, route: route.entityId as string };
}

/** A server with the simulator and cot, a client that sees every workspace, and the TAK double relaying. */
async function withSimulation(
  testInfo: Parameters<typeof withOwnServers>[0],
  body: (ctx: { start: () => Promise<OwnServer>; dataDir: string; double: Awaited<ReturnType<typeof startTakDouble>> }) => Promise<void>,
) {
  const double = await startTakDouble({ relay: 'others' });
  try {
    await withOwnServers(testInfo, async (folders, start) => {
      installPlugins(folders.pluginsDir, { only: ['cot', 'simulator'] });
      await body({ start: () => start(), dataDir: folders.dataDir, double });
    });
  } finally {
    await double.close();
  }
}

/** cot's links: the simulator's output to the double, and the way back into a View layer. */
async function linkCot(server: OwnServer, double: Awaited<ReturnType<typeof startTakDouble>>) {
  await setLinks(server, [
    { name: 'sim-out', direction: 'out', port: double.port },
    { name: 'sim-in', port: double.port, targetLayer: { name: 'Returned' } },
  ]);
  await double.waitForConnections(2);
  await expect.poll(async () => (await simulator(server, '/outputs')).channels.map((c: { id: string }) => c.id), { timeout: 10_000 }).toContain('cot/sim-out');
  const outputs = await simulator(server, '/outputs', { channels: ['cot/sim-out'] });
  expect(outputs.chosen).toEqual([{ id: 'cot/sim-out', missing: false }]);
}

/** The journal's event lines (persistence.spec.ts's format), its declarations of moves not saved apart. */
function journal(dataDir: string) {
  const file = join(dataDir, 'journal.jsonl');
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l.endsWith('}')).map((l) => JSON.parse(l)) : [];
  return { events: lines.filter((l) => l.sequenceNo !== undefined), declarations: lines.filter((l) => l.notSaved !== undefined || l.notSavedVersion !== undefined) };
}

const metres = (a: number[], b: number[]) => Math.hypot((a[0] - b[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 110_540);

test('criteria 12, 13, 15 and 16: with no browser, a running route\'s tracks go to the TAK double every tick with a short expiry, also standing at the end and off a route; they come back into a View layer; after a pause nothing goes out', async ({}, testInfo) => {
  await withSimulation(testInfo, async ({ start, double }) => {
    const server = await start();
    const client = await LiveClient.open(server.baseUrl);
    await client.subscribe({ workspaces: ['*'] });
    const { tracks, route } = await simulation(client);
    const [alpha, bravo] = tracks;
    await linkCot(server, double);
    await simulator(server, '/put-on-route', { route, kind: 'single', objects: [alpha] });
    await simulator(server, '/routes/start', {});

    const sent = (uid: string) => double.receivedEvents().filter((e) => e.uid === uid);
    // ALPHA moves east along the first leg (latitude 59.0, longitude growing); BRAVO, on no route, stands.
    await expect.poll(() => sent(alpha).length, { timeout: 15_000, message: 'ALPHA sent at several ticks' }).toBeGreaterThanOrEqual(4);
    const moving = sent(alpha).slice(0, 4);
    for (let i = 1; i < moving.length; i++) expect(moving[i].lon!, 'ALPHA moves east').toBeGreaterThanOrEqual(moving[i - 1].lon!);
    expect(moving.at(-1)!.lon!).toBeGreaterThan(POINTS[0][0]);
    expect(sent(bravo).length, 'BRAVO, on no route, is sent too').toBeGreaterThanOrEqual(3);
    for (const e of [...moving, ...sent(bravo)]) {
      const expiry = (Date.parse(e.stale!) - Date.parse(e.time!)) / 1000;
      expect(expiry, `${e.uid}: stale ${OUT_STALE_SECONDS} s after its time`).toBeCloseTo(OUT_STALE_SECONDS, 0);
    }
    expect(moving[0]).toMatchObject({ type: 'a-f-G-U-C-I', callsign: 'ALPHA' });

    // The round trip (criterion 15): back through sim-in into the View layer "Returned".
    const viewOnly = await LiveClient.open(server.baseUrl);
    try {
      await expect
        .poll(async () => {
          const snapshot = await viewOnly.subscribe({ id: `v-${Date.now()}` });
          const returned = snapshot.layers.find((l: { name: string }) => l.name === 'Returned');
          return {
            returned: returned === undefined ? [] : snapshot.objects.filter((o: any) => o.layerId === returned.id).map((o: any) => o.meta.externalRef?.id).sort(),
            groundTruth: snapshot.objects.filter((o: any) => tracks.includes(o.id)).length,
          };
        }, { timeout: 15_000, message: 'both tracks back in View, the ground truth not' })
        .toEqual({ returned: [...tracks].sort(), groundTruth: 0 });
    } finally {
      await viewOnly.close();
    }

    // The route ends (about 18 s at 50 m/s): ALPHA stands at the last point and is still sent every tick.
    await expect.poll(async () => (await simulator(server, `/routes/${route}`)).state, { timeout: 60_000, intervals: [1000] }).toBe('ended');
    const atEnd = sent(alpha).length;
    await expect.poll(() => sent(alpha).length, { timeout: 5_000, message: 'still sent at the end' }).toBeGreaterThanOrEqual(atEnd + 2);
    const standing = sent(alpha).at(-1)!;
    expect(metres([standing.lon!, standing.lat!], POINTS[2]), 'at the last point').toBeLessThan(2);

    // Paused: nothing more goes out, so the tracks go stale at the receiver within their expiry.
    await simulator(server, '/routes/pause', {});
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const afterPause = double.receivedEvents().length;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(double.receivedEvents().length, 'nothing sent after the pause').toBe(afterPause);
    testInfo.annotations.push({ type: 'events sent', description: `ALPHA ${sent(alpha).length}, BRAVO ${sent(bravo).length}` });
    await client.close();
    await stopOwnServer(server);
  });
});

test('criteria 17 and 18: a running route\'s moves reach the live picture and the outputs, but the journal holds only the saves: before the run and at the pause, none periodic', async ({}, testInfo) => {
  await withSimulation(testInfo, async ({ start, dataDir, double }) => {
    const server = await start();
    const client = await LiveClient.open(server.baseUrl);
    await client.subscribe({ workspaces: ['*'] });
    const { tracks, route } = await simulation(client);
    const [alpha] = tracks;
    await linkCot(server, double);
    await simulator(server, '/put-on-route', { route, kind: 'single', objects: [alpha] });
    await simulator(server, '/routes/start', {});
    const updates = () => (client.eventsOf('all') as Event[]).filter((e) => e.entityId === alpha && e.operation === 'update');
    await expect.poll(() => updates().length, { timeout: 15_000 }).toBeGreaterThanOrEqual(8);
    await simulator(server, '/routes/pause', {});
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const live = updates();
    const last = live.at(-1)!.sequenceNo;
    await expect.poll(() => journal(dataDir).events.at(-1)?.sequenceNo ?? 0, { timeout: 10_000, message: 'journal written up to the pause' }).toBeGreaterThanOrEqual(last);

    const { events, declarations } = journal(dataDir);
    const saved = events.filter((e) => e.entityId === alpha && e.operation === 'update').map((e) => e.sequenceNo as number);
    testInfo.annotations.push({ type: 'ALPHA updates', description: `live ${live.map((e) => e.sequenceNo).join(',')}; journal ${saved.join(',')}; declarations ${declarations.length}` });
    expect(declarations.length, 'the journal declares the moves it skipped').toBeGreaterThan(0);
    // Saved: put on route, the save before the run (its first tick) and the pause (its update and its
    // tick's save); the moves between are not.
    expect(saved.length, 'only the saving moments').toBeLessThanOrEqual(6);
    expect(live.length - saved.length, 'moves that reached the live picture but not the journal').toBeGreaterThanOrEqual(5);
    // The moves not saved lie between a save before the run and the save at the pause.
    const unsaved = live.map((e) => e.sequenceNo).filter((n) => !saved.includes(n));
    expect(unsaved.length, 'moves not saved').toBeGreaterThanOrEqual(5);
    expect(saved.filter((n) => n < unsaved[0]).length, 'saved before the run').toBeGreaterThanOrEqual(1);
    expect(saved.filter((n) => n > unsaved.at(-1)!).length, 'saved at the pause').toBeGreaterThanOrEqual(1);

    const monitor = await (await fetch(`${server.baseUrl}/api/monitor`)).json();
    expect(monitor.plugins.find((p: { id: string }) => p.id === 'simulator').notSavedUpdates, 'the monitor counts them').toBeGreaterThanOrEqual(5);
    await client.close();
    await stopOwnServer(server);
  });
});

test('criterion 19: after a hard kill during a run the simulation comes back paused at the last saved moment; after a clean stop during a run, paused where it stopped', async ({}, testInfo) => {
  await withSimulation(testInfo, async ({ start, dataDir, double }) => {
    let server = await start();
    let client = await LiveClient.open(server.baseUrl);
    await client.subscribe({ workspaces: ['*'] });
    const { tracks, route } = await simulation(client);
    const [alpha] = tracks;
    await linkCot(server, double);
    await simulator(server, '/put-on-route', { route, kind: 'single', objects: [alpha] });
    await simulator(server, '/routes/start', {});
    const moves = () => (client.eventsOf('all') as Event[]).filter((e) => e.entityId === alpha && e.operation === 'update');
    await expect.poll(() => moves().length, { timeout: 15_000 }).toBeGreaterThanOrEqual(5);
    const movedTo = moves().at(-1)!.state!.geometry.coordinates as number[];
    // The last saved place: ALPHA's last update in the journal (the save before the run).
    const lastSaved = () => journal(dataDir).events.filter((e) => e.entityId === alpha && e.operation === 'update').at(-1)?.state.geometry.coordinates as number[];
    const savedBeforeKill = lastSaved();
    await client.close();
    await server.kill();

    server = await start();
    const after = async () => {
      const reader = await LiveClient.open(server.baseUrl);
      try {
        return (await reader.subscribe({ workspaces: ['*'] })).objects.find((o: { id: string }) => o.id === alpha).geometry.coordinates as number[];
      } finally {
        await reader.close();
      }
    };
    await expect.poll(async () => (await simulator(server, '/routes')).running, { timeout: 15_000 }).toBe(false);
    expect((await simulator(server, `/routes/${route}`)).state, 'paused').toBe('paused');
    const killedAt = await after();
    testInfo.annotations.push({ type: 'hard kill', description: `moved to ${movedTo}; last saved ${savedBeforeKill}; after the restart ${killedAt}` });
    expect(metres(killedAt, savedBeforeKill), 'at the last saved place').toBeLessThan(1);
    expect(metres(killedAt, movedTo), 'not where the unsaved moves had taken it').toBeGreaterThan(50);

    // A clean stop during a run saves at once: after the restart, paused where it was.
    client = await LiveClient.open(server.baseUrl);
    await client.subscribe({ workspaces: ['*'] });
    await simulator(server, '/routes/start', {});
    await expect.poll(() => moves().length, { timeout: 15_000 }).toBeGreaterThanOrEqual(4);
    const stoppedNear = moves().at(-1)!.state!.geometry.coordinates as number[];
    await client.close();
    await stopOwnServer(server);
    server = await start();
    await expect.poll(async () => (await simulator(server, '/routes')).running, { timeout: 15_000 }).toBe(false);
    const cleanAt = await after();
    testInfo.annotations.push({ type: 'clean stop', description: `last move ${stoppedNear}; after the restart ${cleanAt}` });
    // The route runs on until the stop, a few ticks after the last move seen (50 m each).
    expect(metres(cleanAt, stoppedNear), 'within a few ticks of the last move').toBeLessThan(250);
    expect(metres(cleanAt, killedAt), 'progress kept').toBeGreaterThan(50);
    await stopOwnServer(server);
  });
});
