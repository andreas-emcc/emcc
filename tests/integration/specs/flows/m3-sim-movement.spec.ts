// Quick run: @plugin-simulator @plugin-cot @tak
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/flows/m3-sim-movement.spec.ts
import { expect, test } from '@playwright/test';
import { setLinks } from '../../lib/cot';
import { along, direct, inverse } from '../../lib/geodesy.mjs';
import { createLayer, createSymbol, LiveClient } from '../../lib/live.mjs';
import { withOwnServers, type OwnServer } from '../../lib/own-server';
import { installPlugins } from '../../lib/plugins.mjs';
import { startTakDouble } from '../../lib/tak-double.mjs';

// The simulator's movement through its endpoints (T-086 part 5d; the simulator brief's criteria 3,
// 4 and 8 to 11), on servers of the test's own with only the simulator and cot, and no browser:
// the endpoints are what the panels use (flows/m3-sim-panels.spec.ts). Each tick's move reaches
// the live picture with its time.observed; positions are checked against the Java SDK's own
// Geodesy (lib/geodesy.mjs, owner 2026-10-29, Q5), latitude ≠ longitude. The outputs (10, 11) go
// to the ITA's TAK test double through cot's out link `sim-out`.

test.describe.configure({ timeout: 240_000 });

const SIMULATION = 'simulator.simulation';
type LonLat = [number, number];
type Event = { entityType: string; entityId: string; operation: string; state: Record<string, any> | null };
type Double = Awaited<ReturnType<typeof startTakDouble>>;

/** Two legs, about 287 m east, then about 333 m north (latitude ≠ longitude). */
const POINTS: LonLat[] = [[18.0, 59.0], [18.005, 59.0], [18.005, 59.003]];

type Sim = { server: OwnServer; client: LiveClient; layerId: string; double: Double | null };

/** A server with the simulator and cot, a client that sees every workspace, a Simulation layer; with `double`, cot's `sim-out` chosen as the output. */
async function withSimulation(testInfo: Parameters<typeof withOwnServers>[0], body: (sim: Sim) => Promise<void>, { double: withDouble = false } = {}): Promise<void> {
  const double = withDouble ? await startTakDouble({}) : null;
  try {
    await withOwnServers(testInfo, async (folders, start) => {
      installPlugins(folders.pluginsDir, { only: ['cot', 'simulator'] });
      const server = await start();
      const client = await LiveClient.open(server.baseUrl);
      try {
        await client.subscribe({ workspaces: ['*'] });
        const layer = createLayer('Ground truth', { workspace: SIMULATION });
        await applied(client, layer);
        if (double !== null) {
          await setLinks(server, [{ name: 'sim-out', direction: 'out', port: double.port }]);
          await double.waitForConnections(1);
          await expect.poll(async () => (await simulator(server, '/outputs')).channels.map((c: { id: string }) => c.id), { timeout: 10_000 }).toContain('cot/sim-out');
          await simulator(server, '/outputs', { channels: ['cot/sim-out'] });
        }
        await body({ server, client, layerId: layer.entityId, double });
      } finally {
        await client.close();
      }
    });
  } finally {
    await double?.close();
  }
}

async function applied(client: LiveClient, request: { entityType: string; operation: string }): Promise<Record<string, any>> {
  const outcome = await client.change(request);
  expect(outcome, `${request.entityType} ${request.operation}`).toMatchObject({ outcome: 'applied' });
  return outcome.event.state;
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

/** An APP-6B friendly infantry track at a position (with an altitude if given). */
async function track(client: LiveClient, layerId: string, name: string, position: number[]): Promise<string> {
  const request = createSymbol(layerId, 0, { name }) as any;
  request.data.geometry.coordinates = position;
  request.data.symbol = { standard: 'APP-6B', sidc: 'SFGPUCI--------' };
  await applied(client, request);
  await seen(client, request.entityId);
  return request.entityId;
}

/** Waits until the client's live picture has the object (its change can come after the outcome). */
async function seen(client: LiveClient, id: string): Promise<void> {
  await expect.poll(() => latest(client, id).version ?? 0, { message: `${id} in the live picture` }).toBeGreaterThan(0);
}

/** A route through `points` with the simulator's entries (brief function 4). */
async function route(client: LiveClient, layerId: string, name: string, points: LonLat[], entries: Record<string, unknown>[], end: 'stop' | 'restart' = 'stop'): Promise<string> {
  const request = createSymbol(layerId, 0, { name }) as any;
  request.data = {
    type: 'core.shape',
    dataType: 'simulator.route',
    dataSource: 'manual',
    layerId,
    geometry: { type: 'LineString', coordinates: points },
    style: { strokeColor: '#2C784C', strokeWidth: 2, strokeDash: 'dash', pointMarkers: 'circle' },
    properties: { name },
    label: request.data.label,
    extensions: { simulator: { points: entries, groups: [], end } },
  };
  await applied(client, request);
  await seen(client, request.entityId);
  return request.entityId;
}

type Move = { t: number; position: number[]; speed: number | undefined; direction: number | undefined; state: Record<string, any> };

/** Every state of an object after `since` (ms), in order, with its observed time. */
function states(client: LiveClient, id: string, since = 0): Move[] {
  return (client.events as Event[])
    .filter((e) => e.entityId === id && e.state !== null)
    .map((e) => ({ t: Date.parse(e.state!.time?.observed ?? '1970-01-01T00:00:00Z'), position: e.state!.geometry.coordinates, speed: e.state!.symbol?.modifiers?.speed, direction: e.state!.symbol?.modifiers?.direction, state: e.state! }))
    .filter((m) => m.t >= since);
}

/** An object's newest state from the events so far (an empty object until its first event has arrived). */
function latest(client: LiveClient, id: string): Record<string, any> {
  return (client.events as Event[]).filter((e) => e.entityId === id && e.state !== null).at(-1)?.state ?? {};
}

/** The legs' lengths and where each starts along the route, from the SDK. */
function legsOf(points: LonLat[]): { lengths: number[]; starts: number[]; total: number } {
  const lengths = inverse(points.slice(1).map((p, i) => [points[i], p])).map((l: { metres: number }) => l.metres);
  const starts = lengths.map((_: number, i: number) => lengths.slice(0, i).reduce((a: number, b: number) => a + b, 0));
  return { lengths, starts, total: lengths.reduce((a: number, b: number) => a + b, 0) };
}

/** For each position: its distance along the route and how far it is off it (m), on the leg it is closest to. */
function placesOn(points: LonLat[], positions: number[][]): { s: number; off: number; leg: number }[] {
  const { lengths, starts } = legsOf(points);
  const pairs: [number[], number[]][] = [];
  for (const p of positions) for (let k = 0; k < lengths.length; k++) pairs.push([points[k], p], [p, points[k + 1]]);
  const d = inverse(pairs).map((l: { metres: number }) => l.metres);
  return positions.map((_, i) => {
    let best = { s: 0, off: Infinity, leg: 0 };
    for (let k = 0; k < lengths.length; k++) {
      const [a, b] = [d[(i * lengths.length + k) * 2], d[(i * lengths.length + k) * 2 + 1]];
      const off = a + b - lengths[k];
      if (off < best.off) best = { s: starts[k] + a, off, leg: k };
    }
    return best;
  });
}

/** The distances between pairs of positions, from the SDK. */
function distances(pairs: [number[], number[]][]): number[] {
  return pairs.length === 0 ? [] : inverse(pairs).map((l: { metres: number }) => l.metres);
}

/** Waits until a track stands at the route's last point (speed 0 there). */
async function arrived(client: LiveClient, id: string, points: LonLat[], timeout = 60_000): Promise<void> {
  await expect.poll(() => {
    const now = latest(client, id);
    return now.geometry !== undefined && now.symbol?.modifiers?.speed === 0 && distances([[now.geometry.coordinates, points[points.length - 1]]])[0] < 1;
  }, { timeout, intervals: [1_000], message: `${id} at the last point` }).toBe(true);
}

test('criterion 3: a single object on a two-leg route moves along the geodesics at the points\' speeds, once a second: each tick within 1 m of the SDK\'s Geodesy, turning sharply at the point, its direction and speed modifiers matching', async ({}, testInfo) => {
  await withSimulation(testInfo, async ({ server, client, layerId }) => {
    const id = await track(client, layerId, 'ALPHA', [17.99, 58.99]);
    const r = await route(client, layerId, 'Route A', POINTS, [{ speedKind: 'instant', speed: 20 }, { speedKind: 'instant', speed: 30 }, {}]);
    await simulator(server, '/put-on-route', { route: r, kind: 'single', objects: [id] });
    const sent = Date.now();
    await simulator(server, '/routes/start', {});
    await arrived(client, id, POINTS);

    const { lengths, total } = legsOf(POINTS);
    const moves = states(client, id, sent - 1_000).filter((m) => m.speed !== undefined && m.speed > 0);
    testInfo.annotations.push({ type: 'moves', description: JSON.stringify(moves.map((m) => [m.t, m.position, m.speed, m.direction])) });
    expect(moves.length, 'moves on both legs').toBeGreaterThanOrEqual(20);
    // The route's start, from the first leg's moves: s = 20 m/s · (t − t0).
    const places = placesOn(POINTS, moves.map((m) => m.position));
    const first = moves.map((m, i) => ({ m, p: places[i] })).filter(({ p }) => p.leg === 0 && p.s < lengths[0]);
    const t0 = first.reduce((sum, { m, p }) => sum + (m.t - (p.s / 20) * 1_000), 0) / first.length;
    expect(Math.abs(t0 - sent), 'the start about when it was asked for').toBeLessThan(2_000);
    // Where the SDK puts the object at each tick's time: 20 m/s on the first leg, 30 m/s on the second.
    const legOneTime = (lengths[0] / 20) * 1_000;
    const expectedS = (t: number) => Math.min(total, t - t0 <= legOneTime ? ((t - t0) / 1_000) * 20 : lengths[0] + ((t - t0 - legOneTime) / 1_000) * 30);
    const expected = along(POINTS, moves.map((m) => expectedS(m.t)));
    const off = distances(moves.map((m, i) => [m.position, expected[i].position]));
    for (const [i, m] of moves.entries()) {
      const leg = expected[i].leg;
      expect(off[i], `tick ${i} (${new Date(m.t).toISOString()}): within 1 m of Geodesy`).toBeLessThanOrEqual(1);
      expect(m.speed, `tick ${i}: the speed modifier`).toBeCloseTo(leg === 0 ? 20 : 30, 6);
      const turn = Math.abs(((m.direction! - expected[i].azimuth + 540) % 360) - 180);
      expect(turn, `tick ${i}: the direction modifier ${m.direction} vs ${expected[i].azimuth}`).toBeLessThan(0.5);
    }
    // Sharply at the point: every move heads along the first leg (east) or the second (north), none between.
    const headings = moves.map((m) => m.direction!);
    expect(headings.filter((h) => h > 5 && h < 85), 'no heading between the legs').toEqual([]);
    expect(headings.some((h) => Math.abs(h - 90) < 1) && headings.some((h) => h < 1 || h > 359), 'both legs travelled').toBe(true);
    // Once a second.
    const steps = moves.slice(1).map((m, i) => m.t - moves[i].t);
    expect(Math.max(...steps), 'a move every tick').toBeLessThanOrEqual(1_100);
    expect(Math.min(...steps), 'not more often than once a second').toBeGreaterThanOrEqual(900);
  });
});

test('criterion 4: a speed ramp has a constant acceleration and an altitude ramp climbs in proportion to the distance; a ramp on the first point acts as instant; an empty altitude keeps the object\'s own', async ({}, testInfo) => {
  await withSimulation(testInfo, async ({ server, client, layerId }) => {
    // Route A: 10 m/s at 100 m, ramping to 30 m/s at 400 m over the first leg.
    const a = await track(client, layerId, 'ALPHA', [17.99, 58.99]);
    const ra = await route(client, layerId, 'Route A', POINTS, [
      { speedKind: 'instant', speed: 10, altitudeKind: 'instant', altitude: 100 },
      { speedKind: 'ramp', speed: 30, altitudeKind: 'ramp', altitude: 400 },
      {},
    ]);
    // Route B: a ramp on its first point, and no altitudes; its track flies at 50 m of its own.
    const pointsB: LonLat[] = POINTS.map(([lon, lat]) => [lon, lat - 0.01]);
    const b = await track(client, layerId, 'BRAVO', [17.99, 58.98, 50]);
    const rb = await route(client, layerId, 'Route B', pointsB, [{ speedKind: 'ramp', speed: 20 }, { speedKind: 'instant', speed: 20 }, {}]);
    await simulator(server, '/put-on-route', { route: ra, kind: 'single', objects: [a] });
    await simulator(server, '/put-on-route', { route: rb, kind: 'single', objects: [b] });
    const sent = Date.now();
    await simulator(server, '/routes/start', {});
    const { lengths } = legsOf(POINTS);
    await expect.poll(() => {
      const [place] = placesOn(POINTS, [latest(client, a).geometry.coordinates]);
      return place.off < 1 ? place.s : 0; // on the route, not where it stood before
    }, { timeout: 60_000, intervals: [1_000], message: 'ALPHA past the first leg' }).toBeGreaterThan(lengths[0] + 5);

    // ALPHA on the first leg: v² = 10² + 2·acc·s, z = 100 + 300·s/L, and v linear in time.
    const acc = (30 ** 2 - 10 ** 2) / (2 * lengths[0]);
    const moves = states(client, a, sent - 1_000).filter((m) => m.speed !== undefined && m.speed > 0);
    const places = placesOn(POINTS, moves.map((m) => m.position));
    const onRamp = moves.map((m, i) => ({ m, p: places[i] })).filter(({ p }) => p.leg === 0 && p.s > 1 && p.s < lengths[0] - 1);
    testInfo.annotations.push({ type: 'ramp', description: JSON.stringify(onRamp.map(({ m, p }) => [m.t, p.s, m.speed, m.position[2]])) });
    expect(onRamp.length, 'ticks on the ramp').toBeGreaterThanOrEqual(5);
    for (const { m, p } of onRamp) {
      expect(m.speed!, `speed at ${p.s.toFixed(1)} m`).toBeCloseTo(Math.sqrt(10 ** 2 + 2 * acc * p.s), 1);
      expect(m.position[2], `altitude at ${p.s.toFixed(1)} m`).toBeCloseTo(100 + (300 * p.s) / lengths[0], 0);
    }
    // Constant acceleration: the speed grows by acc each second.
    for (let i = 1; i < onRamp.length; i++) {
      const dt = (onRamp[i].m.t - onRamp[i - 1].m.t) / 1_000;
      expect((onRamp[i].m.speed! - onRamp[i - 1].m.speed!) / dt, 'the acceleration').toBeCloseTo(acc, 1);
    }

    // BRAVO: 20 m/s from its first move (the first point's ramp acts as instant), at its own 50 m.
    const bravo = states(client, b, sent - 1_000).filter((m) => m.speed !== undefined && m.speed > 0);
    expect(bravo.length).toBeGreaterThanOrEqual(3);
    for (const m of bravo) {
      expect(m.speed, 'BRAVO at 20 m/s from the start').toBeCloseTo(20, 6);
      expect(m.position[2], 'BRAVO keeps its own altitude').toBeCloseTo(50, 6);
    }
  });
});

/** Where an object was at tick time `t`: its newest state observed at or before it. */
function at(moves: Move[], t: number): Move | undefined {
  return moves.filter((m) => m.t <= t).at(-1);
}

test('criterion 8: a convoy leaves one by one at the spacing, in list order; with "stop" all stop at the last point', async ({}, testInfo) => {
  await withSimulation(testInfo, async ({ server, client, layerId }) => {
    const ids = [];
    for (const [i, name] of ['ALPHA', 'BRAVO', 'CHARLIE'].entries()) ids.push(await track(client, layerId, name, [17.99 - i * 0.002, 58.99]));
    const r = await route(client, layerId, 'Route A', POINTS, POINTS.map(() => ({ speedKind: 'instant', speed: 30 })), 'stop');
    await simulator(server, '/put-on-route', { route: r, kind: 'convoy', spacing: 100, objects: ids });
    await expect.poll(() => latest(client, r).extensions?.simulator?.groups).toMatchObject([{ kind: 'convoy', spacing: 100, objects: ids.map((id) => ({ id })) }]);
    const sent = Date.now();
    await simulator(server, '/routes/start', {});
    for (const id of ids) await arrived(client, id, POINTS);

    const { total } = legsOf(POINTS);
    const moves = ids.map((id) => states(client, id, sent - 1_000));
    const ticks = [...new Set(moves[0].map((m) => m.t))].sort((x, y) => x - y);
    const rows = ticks.map((t) => ids.map((_, k) => at(moves[k], t)?.position)).filter((row) => row.every((p) => p !== undefined)) as number[][][];
    const places = placesOn(POINTS, rows.flat()).map((p) => p.s);
    const s = rows.map((_, i) => places.slice(i * 3, i * 3 + 3));
    testInfo.annotations.push({ type: 'distances along the route per tick', description: JSON.stringify(s.map((r) => r.map((v) => Math.round(v)))) });
    expect(s.length, 'ticks while the convoy runs').toBeGreaterThanOrEqual(15);
    // Each one 100 m behind the one ahead once it has left, at the first point before (list order).
    for (const [i, [a, b, c]] of s.entries()) {
      if (a < total - 1) expect(b, `tick ${i}: BRAVO ${b.toFixed(1)} m with ALPHA at ${a.toFixed(1)} m`).toBeCloseTo(Math.max(0, a - 100), 0);
      if (b < total - 1) expect(c, `tick ${i}: CHARLIE ${c.toFixed(1)} m with BRAVO at ${b.toFixed(1)} m`).toBeCloseTo(Math.max(0, b - 100), 0);
    }
    expect(s.some(([a, b]) => b === 0 || (a > 50 && b < 1)), 'BRAVO waited while ALPHA went ahead').toBe(true);
    // "stop": all at the last point, speed 0.
    for (const id of ids) {
      const end = latest(client, id);
      expect(end.symbol.modifiers.speed).toBe(0);
      expect(distances([[end.geometry.coordinates, POINTS[2]]])[0], `${end.properties.name} at the last point`).toBeLessThan(1);
    }
  });
});

test('criterion 9: a formation keeps its shape and turns with the direction of travel; its objects pass a point in the order of their places along the route', async ({}, testInfo) => {
  await withSimulation(testInfo, async ({ server, client, layerId }) => {
    // Around a spot: ALPHA 60 m ahead (east, the first leg's direction), BRAVO 60 m to the right (south), CHARLIE 60 m behind.
    const spot: LonLat = [17.99, 58.995];
    const [ahead, right, behind] = direct([{ from: spot, azimuth: 90, metres: 60 }, { from: spot, azimuth: 180, metres: 60 }, { from: spot, azimuth: 270, metres: 60 }]);
    const ids = [await track(client, layerId, 'ALPHA', ahead), await track(client, layerId, 'BRAVO', right), await track(client, layerId, 'CHARLIE', behind)];
    // Each passes point 2: a "change a field" event for all, so the moment each passes shows.
    const r = await route(client, layerId, 'Route A', POINTS, [{ speedKind: 'instant', speed: 20 }, { speedKind: 'instant', speed: 20, events: [{ kind: 'set', core: { name: 'PAST 2' } }] }, {}], 'stop');
    await simulator(server, '/put-on-route', { route: r, kind: 'formation', objects: ids });
    await expect.poll(() => latest(client, r).extensions?.simulator?.groups?.length).toBe(1);
    const members = latest(client, r).extensions.simulator.groups[0].objects as { id: string; forward: number; right: number }[];
    testInfo.annotations.push({ type: 'members', description: JSON.stringify(members) });
    // The offsets as recorded: relative to the centre (the mean, here the spot shifted a third of the way to BRAVO) and the first leg.
    const byId = new Map(members.map((m) => [m.id, m]));
    expect(byId.get(ids[0])!.forward - byId.get(ids[2])!.forward, 'ALPHA 120 m ahead of CHARLIE').toBeCloseTo(120, 0);
    expect(byId.get(ids[1])!.right - byId.get(ids[0])!.right, 'BRAVO 60 m right of ALPHA').toBeCloseTo(60, 0);
    expect(byId.get(ids[0])!.forward - byId.get(ids[1])!.forward, 'ALPHA 60 m ahead of BRAVO').toBeCloseTo(60, 0);
    const sent = Date.now();
    await simulator(server, '/routes/start', {});
    for (const id of ids) await expect.poll(() => latest(client, id).properties?.name, { timeout: 60_000, message: 'past point 2' }).toBe('PAST 2');
    await expect.poll(() => latest(client, ids[0]).symbol?.modifiers?.speed, { timeout: 60_000, message: 'stopped at the end' }).toBe(0);

    // The shape: at every tick the pairwise distances are the recorded offsets' distances.
    const moves = ids.map((id) => states(client, id, sent - 1_000).filter((m) => m.speed !== undefined && m.speed > 0));
    const ticks = moves[0].map((m) => m.t).filter((t) => moves.every((ms) => ms.some((m) => m.t === t)));
    expect(ticks.length, 'ticks with all three moving').toBeGreaterThanOrEqual(10);
    const rows = ticks.map((t) => moves.map((ms) => ms.find((m) => m.t === t)!.position));
    const want = (a: number, b: number) => Math.hypot(members[a].forward - members[b].forward, members[a].right - members[b].right);
    const order = ids.map((id) => members.findIndex((m) => m.id === id));
    const pairs = rows.flatMap((p) => [[p[0], p[1]], [p[1], p[2]], [p[2], p[0]]] as [number[], number[]][]);
    const legs = inverse(pairs);
    for (const [i] of rows.entries()) {
      const [ab, bc, ca] = legs.slice(i * 3, i * 3 + 3);
      expect(ab.metres, `tick ${i}: ALPHA–BRAVO`).toBeCloseTo(want(order[0], order[1]), 0);
      expect(bc.metres, `tick ${i}: BRAVO–CHARLIE`).toBeCloseTo(want(order[1], order[2]), 0);
      expect(ca.metres, `tick ${i}: CHARLIE–ALPHA`).toBeCloseTo(want(order[2], order[0]), 0);
      // It turns with the direction of travel: ALPHA, seen from CHARLIE, lies along the leg travelled (east, then north).
      const fromC = ca.initialAzimuth;
      expect(Math.min(Math.abs(fromC - 90), fromC, 360 - fromC), `tick ${i}: ALPHA from CHARLIE at ${fromC.toFixed(2)}°`).toBeLessThan(1);
    }
    const headings = rows.map((_, i) => legs[i * 3 + 2].initialAzimuth);
    expect(headings.some((h) => Math.abs(h - 90) < 1) && headings.some((h) => h < 1 || h > 359), 'the shape turned at point 2').toBe(true);
    // The order of passing point 2: ALPHA (ahead) first, CHARLIE (behind) last.
    const passed = ids.map((id) => states(client, id, sent - 1_000).find((m) => m.state.properties?.name === 'PAST 2')!.t);
    testInfo.annotations.push({ type: 'passed point 2', description: JSON.stringify(passed) });
    // 60 m apart at 20 m/s: three ticks between each, so the order is strict.
    expect(passed[0], 'ALPHA before BRAVO').toBeLessThan(passed[1]);
    expect(passed[1], 'BRAVO before CHARLIE').toBeLessThan(passed[2]);
  });
});

/** What the double got for a uid: updates (stale after their time) and removals (stale at once). */
function received(double: Double, uid: string) {
  const events = double.receivedEvents().filter((e: { uid: string }) => e.uid === uid) as { time?: string; stale?: string; lat?: number; lon?: number; speed?: number; callsign?: string; team?: string }[];
  const removal = (e: { time?: string; stale?: string }) => Date.parse(e.stale!) <= Date.parse(e.time!);
  return { updates: events.filter((e) => !removal(e)), removals: events.filter(removal) };
}

test('criterion 10: "change a field" fires for each chosen object as it passes the point, with core fields and cot\'s declared field; "hide" stops the object and sends a removal to the output; put on the route again, it is shown and sent again', async ({}, testInfo) => {
  await withSimulation(testInfo, async ({ server, client, layerId, double }) => {
    const [a, b] = [await track(client, layerId, 'ALPHA', [17.99, 58.99]), await track(client, layerId, 'BRAVO', [17.99, 58.985])];
    const r = await route(client, layerId, 'Route A', POINTS, [
      { speedKind: 'instant', speed: 30 },
      { speedKind: 'instant', speed: 30, events: [
        { kind: 'set', objects: [a], core: { name: 'ALPHA PAST' }, fields: [{ plugin: 'cot', name: 'team', value: 'Cyan' }] },
        { kind: 'hide', objects: [b] },
      ] },
      {},
    ]);
    await simulator(server, '/put-on-route', { route: r, kind: 'single', objects: [a, b] });
    const sent = Date.now();
    await simulator(server, '/routes/start', {});
    await expect.poll(() => latest(client, a).properties?.name, { timeout: 30_000, message: 'ALPHA renamed' }).toBe('ALPHA PAST');
    await expect.poll(() => latest(client, b).extensions?.simulator?.hidden, { timeout: 30_000, message: 'BRAVO hidden' }).toBe(true);
    const { lengths } = legsOf(POINTS);

    // ALPHA: changed in the tick that took it past point 2, core name and cot's team (withFields).
    const alpha = states(client, a, sent - 1_000);
    const firstChanged = alpha.findIndex((m) => m.state.properties?.name === 'ALPHA PAST');
    const [before, changed] = placesOn(POINTS, [alpha[firstChanged - 1].position, alpha[firstChanged].position]).map((p) => p.s);
    expect(before, 'not yet at point 2 the tick before').toBeLessThan(lengths[0]);
    expect(changed, 'past point 2 when it fired').toBeGreaterThanOrEqual(lengths[0] - 0.5);
    expect(alpha[firstChanged].state.extensions?.cot?.team, 'cot\'s declared field').toBe('Cyan');
    expect(latest(client, b).properties?.name, 'BRAVO not chosen for the change').toBe('BRAVO');
    await expect.poll(() => received(double!, a).updates.at(-1)?.callsign, { message: 'the new name reaches the output' }).toBe('ALPHA PAST');
    // The team goes out as __group once the field's write is back in the simulator's picture (a tick or so).
    const renamedAt = Date.parse(received(double!, a).updates.find((e) => e.callsign === 'ALPHA PAST')!.time!);
    await expect.poll(() => received(double!, a).updates.at(-1)?.team, { timeout: 5_000, message: 'the team reaches the output' }).toBe('Cyan');
    const teamAt = Date.parse(received(double!, a).updates.find((e) => e.team === 'Cyan')!.time!);
    testInfo.annotations.push({ type: 'team after the rename', description: `${teamAt - renamedAt} ms` });
    expect(teamAt - renamedAt, 'the team at most a tick or two after the name').toBeLessThanOrEqual(2_500);

    // BRAVO: stopped just past point 2, speed 0, no more moves; the output got a removal and no update after it.
    const hidden = latest(client, b);
    expect(hidden.symbol.modifiers.speed).toBe(0);
    const [where] = placesOn(POINTS, [hidden.geometry.coordinates]);
    expect(where.s - lengths[0], 'hidden at point 2, within a tick').toBeGreaterThanOrEqual(-0.5);
    expect(where.s - lengths[0]).toBeLessThanOrEqual(30.5);
    await expect.poll(() => received(double!, b).removals.length, { message: 'a removal sent' }).toBeGreaterThanOrEqual(1);
    const removedAt = Date.parse(received(double!, b).removals[0].time!);
    await new Promise((r2) => setTimeout(r2, 3_000));
    expect(latest(client, b).version, 'BRAVO not moved while hidden').toBe(hidden.version);
    expect(received(double!, b).updates.filter((e) => Date.parse(e.time!) > removedAt), 'nothing of BRAVO sent while hidden').toEqual([]);
    expect(received(double!, a).updates.filter((e) => Date.parse(e.time!) > removedAt).length, 'ALPHA still sent').toBeGreaterThanOrEqual(2);

    // Put on the route again: shown, and sent again.
    await simulator(server, '/put-on-route', { route: r, kind: 'single', objects: [b] });
    await expect.poll(() => latest(client, b).extensions?.simulator?.hidden ?? false, { message: 'BRAVO shown' }).toBe(false);
    await expect.poll(() => received(double!, b).updates.filter((e) => Date.parse(e.time!) > removedAt).length, { timeout: 10_000, message: 'BRAVO sent again' }).toBeGreaterThanOrEqual(2);
  }, { double: true });
});

/** A route's state from the server part. */
async function stateOf(server: OwnServer, id: string): Promise<string> {
  return (await simulator(server, `/routes/${id}`)).state;
}

test('criterion 11: start, pause and reset work per route and for all; a reset puts the objects back, restores what events changed, shows hidden objects and leaves the route paused', async ({}, testInfo) => {
  await withSimulation(testInfo, async ({ server, client, layerId }) => {
    const pointsB: LonLat[] = POINTS.map(([lon, lat]) => [lon, lat - 0.01]);
    const pointsC: LonLat[] = POINTS.map(([lon, lat]) => [lon, lat - 0.02]);
    const [t1, t2, t3] = [await track(client, layerId, 'T1', [17.99, 58.99]), await track(client, layerId, 'T2', [17.99, 58.98]), await track(client, layerId, 'T3', [17.99, 58.97])];
    // Route 1's event changes a core field and cot's declared team; Route 2's hides its track; Route 3 has none.
    const r1 = await route(client, layerId, 'Route 1', POINTS, [{ speedKind: 'instant', speed: 30, events: [{ kind: 'set', core: { name: 'T1 MOVED' }, fields: [{ plugin: 'cot', name: 'team', value: 'Cyan' }] }] }, { speedKind: 'instant', speed: 30 }, {}]);
    const r2 = await route(client, layerId, 'Route 2', pointsB, [{ speedKind: 'instant', speed: 30, events: [{ kind: 'hide' }] }, { speedKind: 'instant', speed: 30 }, {}]);
    const r3 = await route(client, layerId, 'Route 3', pointsC, [{ speedKind: 'instant', speed: 30 }, { speedKind: 'instant', speed: 30 }, {}]);
    await simulator(server, '/put-on-route', { route: r1, kind: 'single', objects: [t1] });
    await simulator(server, '/put-on-route', { route: r2, kind: 'single', objects: [t2] });
    await simulator(server, '/put-on-route', { route: r3, kind: 'single', objects: [t3] });
    // Standing still: the position does not change (a pause's save may still write the same place).
    const quiet = async (id: string, what: string) => {
      const before = latest(client, id).geometry.coordinates;
      await new Promise((r) => setTimeout(r, 2_500));
      expect(latest(client, id).geometry.coordinates, what).toEqual(before);
    };

    // Per route: Route 1 starts alone.
    await simulator(server, `/routes/${r1}/start`, {});
    await expect.poll(() => distances([[latest(client, t1).geometry.coordinates, POINTS[0]]])[0], { timeout: 10_000, message: 'T1 moving' }).toBeGreaterThan(30);
    expect(await stateOf(server, r1)).toBe('running');
    expect(await stateOf(server, r2), 'Route 2 not started').toBe('paused');
    await quiet(t2, 'T2 stands');
    expect(latest(client, t1).properties.name, 'the event at point 1 fired').toBe('T1 MOVED');
    await expect.poll(() => latest(client, t1).extensions?.cot?.team, { message: 'with the team' }).toBe('Cyan');
    // Pause per route: Route 1 pauses while Route 3 runs on.
    await simulator(server, `/routes/${r3}/start`, {});
    await expect.poll(() => distances([[latest(client, t3).geometry.coordinates, pointsC[0]]])[0], { timeout: 10_000, message: 'T3 moving' }).toBeGreaterThan(30);
    await simulator(server, `/routes/${r1}/pause`, {});
    expect(await stateOf(server, r1)).toBe('paused');
    expect(await stateOf(server, r3), 'Route 3 runs on').toBe('running');
    await expect.poll(() => latest(client, t1).symbol?.modifiers?.speed).toBe(0);
    const t3Before = latest(client, t3).geometry.coordinates;
    await quiet(t1, 'T1 paused');
    expect(latest(client, t3).geometry.coordinates, 'T3 still moving').not.toEqual(t3Before);
    await simulator(server, `/routes/${r3}/pause`, {});

    // For all: both run; T2 is hidden as it leaves its first point; then all pause.
    await simulator(server, '/routes/start', {});
    expect(await stateOf(server, r1)).toBe('running');
    // Route 2's only track hides as it leaves its first point and then counts as arrived (README, Q9): running, or already at its end.
    expect(['running', 'ended']).toContain(await stateOf(server, r2));
    await expect.poll(() => latest(client, t2).extensions?.simulator?.hidden, { timeout: 10_000, message: 'T2 hidden' }).toBe(true);
    const all = await simulator(server, '/routes/pause', {});
    expect(all.running, 'all paused').toBe(false);
    expect([await stateOf(server, r1), await stateOf(server, r2), await stateOf(server, r3)]).toEqual(['paused', 'paused', 'paused']);

    // Reset per route: T1 back at its first point, its name restored; Route 1 paused; T2 untouched.
    await simulator(server, `/routes/${r1}/reset`, {});
    await expect.poll(() => latest(client, t1).properties?.name, { message: 'T1\'s name restored' }).toBe('T1');
    expect(latest(client, t1).extensions?.cot?.team, 'the team, absent before, absent again').toBeUndefined();
    expect(distances([[latest(client, t1).geometry.coordinates, POINTS[0]]])[0], 'T1 at the first point').toBeLessThan(1);
    expect(await stateOf(server, r1)).toBe('paused');
    expect(latest(client, t2).extensions?.simulator?.hidden, 'Route 2 not reset').toBe(true);
    // Reset for all: T2 shown again, at its first point, Route 2 paused.
    await simulator(server, '/routes/reset', {});
    await expect.poll(() => latest(client, t2).extensions?.simulator?.hidden ?? false, { message: 'T2 shown' }).toBe(false);
    expect(distances([[latest(client, t2).geometry.coordinates, pointsB[0]]])[0], 'T2 at the first point').toBeLessThan(1);
    expect(await stateOf(server, r2)).toBe('paused');
    await quiet(t1, 'nothing moves after the reset');
  });
});

test('criterion 11: "Restart" at the end fires the events again; "Stop" keeps sending the objects at the last point with speed 0', async ({}, testInfo) => {
  await withSimulation(testInfo, async ({ server, client, layerId, double }) => {
    // Two short routes, about 100 m east, 30 m/s.
    const short = (lat: number): LonLat[] => [[18.0, lat], [18.00175, lat]];
    const [t3, t4] = [await track(client, layerId, 'T3', [17.99, 58.99]), await track(client, layerId, 'T4', [17.99, 58.98])];
    const r3 = await route(client, layerId, 'Route 3', short(59.0), [{ speedKind: 'instant', speed: 30, events: [{ kind: 'set', core: { name: 'LOOPED' } }] }, {}], 'restart');
    const r4 = await route(client, layerId, 'Route 4', short(58.99), [{ speedKind: 'instant', speed: 30 }, {}], 'stop');
    await simulator(server, '/put-on-route', { route: r3, kind: 'single', objects: [t3] });
    await simulator(server, '/put-on-route', { route: r4, kind: 'single', objects: [t4] });
    const sent = Date.now();
    await simulator(server, '/routes/start', {});

    // Restart: the name goes T3 → LOOPED → T3 (the reset) → LOOPED, again and again.
    await expect.poll(() => {
      const names = states(client, t3, sent - 1_000).map((m) => m.state.properties?.name);
      return names.filter((n, i) => n === 'LOOPED' && names[i - 1] !== 'LOOPED').length;
    }, { timeout: 30_000, message: 'the event fired on two laps' }).toBeGreaterThanOrEqual(2);
    expect(await stateOf(server, r3), 'restarted, still running').toBe('running');

    // Stop: T4 stands at the last point and is still sent every second, with speed 0.
    await arrived(client, t4, short(58.99));
    const stood = Date.now();
    await new Promise((r) => setTimeout(r, 4_000));
    const standing = received(double!, t4).updates.filter((e) => Date.parse(e.time!) > stood);
    expect(standing.length, 'sent every second while standing').toBeGreaterThanOrEqual(3);
    for (const e of standing) {
      expect(e.speed, 'speed 0').toBe(0);
      expect(distances([[[e.lon!, e.lat!], short(58.99)[1]]])[0], 'at the last point').toBeLessThan(1);
    }
    expect(await stateOf(server, r4), 'stopped at its end').toBe('ended');
  }, { double: true });
});
