import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setLinks } from '../../lib/cot';
import { createLayer, LiveClient } from '../../lib/live.mjs';
import { mapCentre, positionAt, withM0 } from '../../lib/m0';
import { framesDuring, machine, saveResult } from '../../lib/perf';
import { startTakDouble } from '../../lib/tak-double.mjs';

// The simulator's load (T-086; the simulator brief's criterion 21, measured once in the ITA's
// environment, and cot's criterion 25): 1 000 tracks on routes at 1 Hz with one chosen cot channel
// to the TAK test double, which relays them back through cot's in link into a View layer, where 1
// or 3 browsers in software rendering draw them moving (S6 proposal 5: 1 to 3 browsers; the M3 demo
// has a GPU). Ten routes carry a formation of 100 tracks each. After a warm-up, a minute is
// sampled once a second: the simulator's status (the last tick's duration and moves, and the moves
// submitted, skipped, refused, lost and answered, the new snapshots), the channel `cot/load-out` in
// the monitor, the link's events out, and what reached the double per track. It fails only if a
// track is skipped or lost, a tick is not answered, the channel drops items, a new snapshot
// reaches the simulator's worker, or a track misses the double for more than two ticks; the rest
// is recorded, not gated. When cot's out link stops sending for 3 s (seen with 3 browsers,
// 2026-10-28), the test keeps evidence in its output: the server's thread dump with its virtual
// threads (`jcmd Thread.dump_to_file`), and the double's sockets before and after a nudge.

test.describe.configure({ timeout: 15 * 60_000 });

const SIMULATION = 'simulator.simulation';
const ROUTES = 10;
const PER_ROUTE = 100;
const SPEED = 20; // m/s
const WARM_UP_SECONDS = 10;
const MEASURE_SECONDS = 60;

type Status = { lastTickMs: number; lastTickMoves: number; submitted: number; skipped: number; refused: number; lost: number; answered: number; newSnapshots: number };

function parseStatus(detail: string): Status | null {
  const m = /last tick (\d+) ms, (\d+) moves; moves submitted (\d+), skipped (\d+), refused (\d+), lost (\d+), answered (\d+); new snapshots (\d+)/.exec(detail);
  if (!m) return null;
  const [lastTickMs, lastTickMoves, submitted, skipped, refused, lost, answered, newSnapshots] = m.slice(1).map(Number);
  return { lastTickMs, lastTickMoves, submitted, skipped, refused, lost, answered, newSnapshots };
}

async function monitorOf(baseUrl: string) {
  const monitor = await (await fetch(`${baseUrl}/api/monitor`)).json();
  const plugin = (id: string) => monitor.plugins.find((p: { id: string }) => p.id === id);
  const simulator = plugin('simulator');
  const cot = plugin('cot');
  return {
    status: parseStatus(simulator.detail),
    detail: simulator.detail as string,
    notSaved: simulator.notSavedUpdates as number,
    channel: (cot.channels as Array<{ link: string; sent: number; delivered: number; dropped: number; pending: number; replaced: number }>).find((c) => c.link === 'load-out'),
    eventsOut: (cot.tasks as Array<{ name: string; counters: Record<string, number> }>).find((t) => t.name === 'load-out')?.counters['events out'] ?? 0,
    tasks: cot.tasks as Array<{ name: string; state: string; restarts: number; queued: number; lost: number; coalesced: number; counters: Record<string, number> }>,
    cotDetail: cot.detail as string,
  };
}

async function simulator(baseUrl: string, path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}/api/plugins/simulator${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  expect(response.status, `${path}: ${text}`).toBe(200);
  return JSON.parse(text);
}

/**
 * Evidence of a stalled out link: the server's threads, virtual ones included (its pid is in every
 * log line), and the double's sockets. Then a nudge: the double pauses and resumes its socket; if
 * its reading had stalled, bytes arrive within 3 s; if the sender's write is stuck, none do.
 */
async function keepStallEvidence(logFile: string, double: Awaited<ReturnType<typeof startTakDouble>>, testInfo: Parameters<typeof saveResult>[0]) {
  const pid = / (?:INFO|WARN) (\d+) --- /.exec(readFileSync(logFile, 'utf8'))?.[1];
  try {
    if (pid) execFileSync('jcmd', [pid, 'Thread.dump_to_file', '-format=text', testInfo.outputPath('threads.txt')], { encoding: 'utf8' });
    else writeFileSync(testInfo.outputPath('threads.txt'), 'no pid in the server log');
  } catch (error) {
    writeFileSync(testInfo.outputPath('threads.txt'), `no thread dump: ${String(error)}`); // e.g. a JRE without jcmd
  }
  const sockets = double.connections.map((c: { id: number; closedAt: number | null; socket: import('node:net').Socket }) => ({
    id: c.id,
    closed: c.closedAt !== null,
    bytesRead: c.socket.bytesRead,
    paused: c.socket.isPaused(),
    writableLength: c.socket.writableLength,
  }));
  // The out link's connection: the one that has read the most (the in link only sent its presence).
  const socket = [...double.connections].sort((a: { socket: import('node:net').Socket }, b: { socket: import('node:net').Socket }) => b.socket.bytesRead - a.socket.bytesRead)[0].socket;
  const before = socket.bytesRead;
  socket.pause();
  socket.resume();
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const evidence = { sockets, nudge: { before, after: socket.bytesRead } };
  writeFileSync(testInfo.outputPath('double.json'), JSON.stringify(evidence, null, 1));
  testInfo.annotations.push({ type: 'out link stalled', description: `${JSON.stringify(evidence)}; thread dump ${testInfo.outputPath('threads.txt')}` });
}

/** Creates the requests with at most 50 waiting at a time (the server allows 100 per session). */
async function applyAll(client: LiveClient, requests: Array<{ requestId: string }>) {
  for (let start = 0; start < requests.length; start += 50) {
    const chunk = requests.slice(start, start + 50);
    for (const r of chunk) client.send({ type: 'change-request', request: r });
    for (const r of chunk) {
      const outcome = await client.next((m: { type: string; requestId?: string }) => m.type === 'change-outcome' && m.requestId === r.requestId, 30_000);
      if (outcome.outcome !== 'applied') throw new Error(`${JSON.stringify(outcome)}`);
    }
  }
}

for (const browsers of [1, 3]) {
  test(`simulator criterion 21: ${ROUTES * PER_ROUTE} tracks on routes at 1 Hz through one cot channel, round trip into View with ${browsers} browser(s)`, async ({ browser }, testInfo) => {
    const double = await startTakDouble({ relay: 'others' });
    try {
      await withM0(
        testInfo,
        browser,
        async ({ server, open }) => {
        const pages = [await open()];
        const [lon0, lat0] = await positionAt(pages[0], await mapCentre(pages[0]));
        const client = await LiveClient.open(server.baseUrl);
        await client.subscribe({ id: 'counts', objects: false, workspaces: ['*'] });

        // Ten routes running east across the view, each with a formation of 100 tracks at its start.
        const layer = createLayer('Load', { workspace: SIMULATION });
        await applyAll(client, [layer]);
        const tracks: string[][] = [];
        const requests: Array<{ requestId: string }> = [];
        const routes: string[] = [];
        for (let r = 0; r < ROUTES; r++) {
          const lat = lat0 - 1 + r * 0.2 + 0.0123; // latitude ≠ longitude
          const routeId = crypto.randomUUID();
          routes.push(routeId);
          requests.push({
            requestId: crypto.randomUUID(),
            entityType: 'object',
            operation: 'create',
            entityId: routeId,
            data: {
              type: 'core.shape',
              dataType: 'simulator.route',
              dataSource: 'manual',
              layerId: layer.entityId,
              geometry: { type: 'LineString', coordinates: [[lon0 - 1.5, lat], [lon0 + 1.5, lat]] },
              style: { strokeColor: '#2C784C', strokeWidth: 2 },
              properties: { name: `Load route ${r + 1}` },
              label: layer.data.label,
              extensions: { simulator: { points: [{ speedKind: 'instant', speed: SPEED }, {}], groups: [], end: 'stop' } },
            },
            source: { plugin: 'ita-test' },
          } as never);
          const ids: string[] = [];
          for (let i = 0; i < PER_ROUTE; i++) {
            const id = crypto.randomUUID();
            ids.push(id);
            requests.push({
              requestId: crypto.randomUUID(),
              entityType: 'object',
              operation: 'create',
              entityId: id,
              data: {
                type: 'core.symbol',
                dataType: 'core.general',
                dataSource: 'manual',
                layerId: layer.entityId,
                geometry: { type: 'Point', coordinates: [lon0 - 1.5 + (i % 10) * 0.002, lat - 0.01 + Math.floor(i / 10) * 0.002] },
                symbol: { standard: 'APP-6B', sidc: 'SFGPUCI--------' },
                properties: { name: `T${r}-${i}` },
                label: layer.data.label,
              },
              source: { plugin: 'ita-test' },
            } as never);
          }
          tracks.push(ids);
        }
        await applyAll(client, requests);

        await setLinks(server, [
          { name: 'load-out', direction: 'out', port: double.port },
          { name: 'load-in', port: double.port, targetLayer: { name: 'Returned' } },
        ]);
        await double.waitForConnections(2);
        await expect.poll(async () => (await simulator(server.baseUrl, '/outputs')).channels.map((c: { id: string }) => c.id), { timeout: 15_000 }).toContain('cot/load-out');
        await simulator(server.baseUrl, '/outputs', { channels: ['cot/load-out'] });
        for (let r = 0; r < ROUTES; r++) await simulator(server.baseUrl, '/put-on-route', { route: routes[r], kind: 'formation', objects: tracks[r] });
        for (let b = 1; b < browsers; b++) pages.push(await open());
        await simulator(server.baseUrl, '/routes/start', {});

        await new Promise((resolve) => setTimeout(resolve, WARM_UP_SECONDS * 1000));
        const all = tracks.flat();
        const perTrack = () => {
          const counts = new Map<string, number>();
          for (const e of double.receivedEvents()) if (e.uid) counts.set(e.uid, (counts.get(e.uid) ?? 0) + 1);
          return counts;
        };
        const startCounts = perTrack();
        const first = await monitorOf(server.baseUrl);
        const samples: Array<Record<string, number>> = [];
        const started = Date.now();
        let frames: Awaited<ReturnType<typeof framesDuring>> | undefined;
        let stalledFor = 0;
        let dumped = false;
        let lastOut = -1;
        const sampler = (async () => {
          while (Date.now() - started < MEASURE_SECONDS * 1000) {
            const m = await monitorOf(server.baseUrl);
            stalledFor = m.eventsOut === lastOut ? stalledFor + 1 : 0;
            lastOut = m.eventsOut;
            if (stalledFor >= 3 && !dumped) {
              dumped = true;
              await keepStallEvidence(server.logFile, double, testInfo);
            }
            samples.push({
              s: Math.round((Date.now() - started) / 100) / 10,
              lastTickMs: m.status?.lastTickMs ?? -1,
              lastTickMoves: m.status?.lastTickMoves ?? -1,
              skipped: m.status?.skipped ?? -1,
              inFlight: (m.status?.submitted ?? 0) - (m.status?.answered ?? 0),
              channelSent: m.channel?.sent ?? 0,
              channelDelivered: m.channel?.delivered ?? 0,
              channelPending: m.channel?.pending ?? 0,
              eventsOut: m.eventsOut,
              outQueued: m.tasks.find((t) => t.name === 'load-out')?.queued ?? -1,
              outCoalesced: m.tasks.find((t) => t.name === 'load-out')?.coalesced ?? -1,
              outRestarts: m.tasks.find((t) => t.name === 'load-out')?.restarts ?? -1,
              eventsIn: m.tasks.find((t) => t.name === 'load-in')?.counters['events in'] ?? -1,
              doubleBytes: double.connections.reduce((n, c) => n + c.received.reduce((k: number, b: Buffer) => k + b.length, 0), 0),
            });
            await new Promise((resolve) => setTimeout(resolve, 1_000));
          }
        })();
        // The first browser's frames over ten seconds of the minute, as drawn in software.
        await new Promise((resolve) => setTimeout(resolve, 20_000));
        frames = await framesDuring(pages[0], () => new Promise((resolve) => setTimeout(resolve, 10_000)));
        await sampler;
        const last = await monitorOf(server.baseUrl);
        const endCounts = perTrack();
        await simulator(server.baseUrl, '/routes/pause', {});

        const received = all.map((id) => (endCounts.get(id) ?? 0) - (startCounts.get(id) ?? 0));
        const returned = await (async () => {
          const reader = await LiveClient.open(server.baseUrl);
          try {
            const snapshot = await reader.subscribe({ id: 'returned', objects: false });
            const layerId = snapshot.layers.find((l: { name: string }) => l.name === 'Returned')?.id;
            return layerId === undefined ? 0 : (snapshot.objectCounts?.[layerId] ?? -1);
          } finally {
            await reader.close();
          }
        })();
        await client.close();
        const ticks = samples.map((x) => x.lastTickMs).filter((x) => x >= 0).sort((a, b) => a - b);
        const result = {
          tracks: all.length,
          routes: ROUTES,
          browsers,
          seconds: MEASURE_SECONDS,
          machine: await machine(browser, pages[0], testInfo),
          tickMs: { median: ticks[Math.floor(ticks.length / 2)], max: ticks.at(-1) },
          movesPerTick: { min: Math.min(...samples.map((x) => x.lastTickMoves)), max: Math.max(...samples.map((x) => x.lastTickMoves)) },
          status: { first: first.status, last: last.status },
          notSaved: last.notSaved - first.notSaved,
          channel: { first: first.channel, last: last.channel, sentPerSecond: ((last.channel?.sent ?? 0) - (first.channel?.sent ?? 0)) / MEASURE_SECONDS },
          eventsOutPerSecond: (last.eventsOut - first.eventsOut) / MEASURE_SECONDS,
          perTrackAtTheDouble: { min: Math.min(...received), max: Math.max(...received) },
          returnedInView: returned,
          frames,
          lastDetail: last.detail,
          cot: { tasks: last.tasks.map(({ counters, ...t }) => ({ ...t, counters })), detail: last.cotDetail },
          samples,
        };
        testInfo.annotations.push({ type: 'simulator load', description: JSON.stringify({ ...result, samples: undefined, machine: undefined }) });
        await saveResult(testInfo, `simulator-load-${browsers}-browsers`, result);

        expect(last.status, 'the simulator status').not.toBeNull();
        expect(last.status!.skipped - first.status!.skipped, 'no track skipped').toBe(0);
        expect(last.status!.lost - first.status!.lost, 'no move lost').toBe(0);
        expect(last.status!.newSnapshots, 'no new snapshot reached the worker').toBe(first.status!.newSnapshots);
        // Sampled once a second, not at each tick: at most one tick's moves were ever waiting for an
        // answer (the closest the monitor comes to "answered before the next").
        expect(Math.max(...samples.map((x) => x.inFlight)), 'at most one tick waiting for answers').toBeLessThanOrEqual(all.length);
        expect((last.channel?.dropped ?? 0) - (first.channel?.dropped ?? 0), 'the channel dropped nothing').toBe(0);
        expect(Math.min(...received), 'every track reached the double nearly every second').toBeGreaterThanOrEqual(MEASURE_SECONDS - 2);
        },
        { probe: true },
      );
    } finally {
      await double.close();
    }
  });
}
