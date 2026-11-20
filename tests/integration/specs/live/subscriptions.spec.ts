// Quick run: @live
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { boxArea, createSymbol, seededLayer, LiveClient } from '../../lib/live.mjs';
import { stopOwnServer, withOwnServers, type OwnServer } from '../../lib/own-server';
import { grid, LoadClient, symbolData } from '../../lib/load.mjs';

// Protocol version 2 (T-039 part 1, server/live-picture-protocol.md "Subscriptions"): several
// subscriptions on one connection, each with its own snapshot and sequence; areas of interest
// with entered and left; clusters over the budget; objects: false with counts. Each test runs on
// a server of its own, so counts and clusters are exact. Positions are [lon, lat], lat ≠ lon.

test.describe.configure({ timeout: 120_000 });

type LonLat = [number, number];
type Message = { type: string; subscription?: string; [key: string]: unknown };

const STOCKHOLM: [number, number, number, number] = [17, 58, 20, 60];
const COPENHAGEN: [number, number, number, number] = [11, 55, 14, 56.5];

/** A symbol at a position; identity '3' friend, '6' hostile (the SIDC's standard identity). */
function symbolAt(layer: string, [lon, lat]: LonLat, identity = '3') {
  const request = createSymbol(layer, 0);
  request.data.geometry.coordinates = [lon, lat];
  request.data.symbol = { standard: 'APP-6D', sidc: `100${identity}1000001211000000` };
  return request;
}

async function create(client: LiveClient, requests: ReturnType<typeof symbolAt>[]) {
  const outcomes = await Promise.all(requests.map((r) => client.change(r, 30_000)));
  for (const o of outcomes) expect(o.outcome, JSON.stringify(o.rejection ?? '')).toBe('applied');
  return outcomes.map((o) => o.event);
}

function deleteRequest(id: string) {
  return { requestId: randomUUID(), entityType: 'object', operation: 'delete', entityId: id, source: { plugin: 'ita-test' } };
}

async function withServer(testInfo: Parameters<typeof withOwnServers>[0], body: (server: OwnServer, client: LiveClient, layer: string) => Promise<void>) {
  await withOwnServers(testInfo, async (_folders, start) => {
    const server = await start();
    const client = await LiveClient.open(server.baseUrl);
    const layer = seededLayer(await client.subscribe({ id: 'setup' }));
    client.unsubscribe('setup');
    await body(server, client, layer);
    await client.close();
    await stopOwnServer(server);
  });
}

test('one connection carries several subscriptions, each with its own snapshot, sequence and messages; ids are unique, at most 32, and unsubscribe ends one', async ({}, testInfo) => {
  await withServer(testInfo, async (_server, client, layer) => {
    const [before] = await create(client, [symbolAt(layer, [18.5, 59.1])]);

    const all = await client.subscribe({ id: 'all' });
    const counts = await client.subscribe({ id: 'counts', objects: false });
    const map = await client.subscribe({ id: 'map', area: boxArea(STOCKHOLM), resolution: 500 });
    expect(all.objects.map((o: { id: string }) => o.id)).toEqual([before.entityId]);
    expect(counts.objects, 'objects: false sends no objects').toEqual([]);
    expect(counts.objectCounts).toEqual({ [layer]: 1 });
    expect(map.objects.map((o: { id: string }) => o.id)).toEqual([before.entityId]);
    expect(map.clusters).toMatchObject({ full: true, upsert: [] });
    for (const s of [all, counts, map]) expect(s.endSequenceNo, `${s.id}: consistent`).toBe(s.sequenceNo);

    // One change inside the area, one far outside it.
    const [inside, outside] = await create(client, [symbolAt(layer, [19.2, 58.4]), symbolAt(layer, [10.5, 50.3])]);
    const last = Math.max(inside.sequenceNo, outside.sequenceNo);
    for (const id of ['all', 'counts', 'map']) await client.waitForSequence(last, 10_000, id);
    const ids = (id: string) => client.eventsOf(id).map((e: { entityId: string }) => e.entityId);
    expect(ids('all').sort()).toEqual([inside.entityId, outside.entityId].sort());
    expect(ids('map'), 'the area gets only what reaches into it').toEqual([inside.entityId]);
    expect(ids('counts'), 'objects: false gets no object events').toEqual([]);
    const latestCounts = await client.next((m: Message) => m.type === 'counts' && m.subscription === 'counts' && (m.counts as Record<string, number>)[layer] === 3);
    expect(latestCounts.counts).toEqual({ [layer]: 3 });

    // A second subscription with an open id, and a 33rd, are refused.
    client.send({ type: 'subscribe', subscription: 'map' });
    expect((await client.next((m: Message) => m.type === 'error' && m.subscription === 'map')).message).toBeTruthy();
    for (let i = 4; i <= 32; i++) client.send({ type: 'subscribe', subscription: `extra-${i}`, objects: false });
    for (let i = 4; i <= 32; i++) await client.snapshot(`extra-${i}`);
    client.send({ type: 'subscribe', subscription: 'one-too-many', objects: false });
    expect((await client.next((m: Message) => m.type === 'error' && m.subscription === 'one-too-many')).message, 'at most 32 subscriptions').toBeTruthy();

    // After unsubscribe, the area gets nothing more.
    client.unsubscribe('map');
    const [later] = await create(client, [symbolAt(layer, [18.9, 59.6])]);
    await client.waitForSequence(later.sequenceNo, 10_000, 'all');
    expect(ids('map'), 'nothing after unsubscribe').not.toContain(later.entityId);
  });
});

test('an area subscription follows its area: a move answers with entered and left, an object moved out is sent as left, a delete as the delete event', async ({}, testInfo) => {
  await withServer(testInfo, async (_server, client, layer) => {
    const [a, b] = await create(client, [symbolAt(layer, [18.5, 59.0]), symbolAt(layer, [12.5, 55.5])]);
    const map = await client.subscribe({ id: 'map', area: boxArea(STOCKHOLM), resolution: 500 });
    expect(map.objects.map((o: { id: string }) => o.id)).toEqual([a.entityId]);

    const moved = await client.moveArea('map', boxArea(COPENHAGEN), { resolution: 500 });
    expect(moved.entered.map((o: { id: string }) => o.id)).toEqual([b.entityId]);
    expect(moved.left).toEqual([a.entityId]);

    // B moves far out of the area: not deleted, it left.
    const update = { ...symbolAt(layer, [30.5, 40.25]), operation: 'update', entityId: b.entityId };
    const out = await client.change(update);
    expect(out.outcome).toBe('applied');
    const left = await client.next((m: Message) => m.type === 'area-objects' && m.subscription === 'map' && (m.left as string[]).includes(b.entityId));
    expect(left.entered).toEqual([]);

    // C appears in the area and is deleted: the delete event, not "left".
    const [c] = await create(client, [symbolAt(layer, [12.8, 55.9])]);
    await client.waitForSequence(c.sequenceNo, 10_000, 'map');
    expect(client.eventsOf('map').map((e: { entityId: string }) => e.entityId)).toContain(c.entityId);
    await client.change(deleteRequest(c.entityId));
    // A later change far away: once the subscription is up to it, every area-objects of the
    // delete has arrived (they come after the changes up to their sequenceNo).
    const [later] = await create(client, [symbolAt(layer, [-60.5, -30.25])]);
    await client.waitForSequence(later.sequenceNo, 10_000, 'map');
    expect(client.eventsOf('map').filter((e: { entityId: string }) => e.entityId === c.entityId).map((e: { operation: string }) => e.operation)).toEqual(['create', 'delete']);
    const lefts = client.inbox.filter((m: Message) => m.type === 'area-objects' && m.subscription === 'map').flatMap((m: Message) => m.left as string[]);
    expect(lefts, 'C was deleted, not sent as left').not.toContain(c.entityId);
  });
});

test('areas are rings, not lon/lat boxes: one around the North Pole and one across the antimeridian hold exactly their objects', async ({}, testInfo) => {
  await withServer(testInfo, async (_server, client, layer) => {
    const [nearPole, south, east, west, far] = await create(client, [
      symbolAt(layer, [60, 89.5]),
      symbolAt(layer, [60, 70.5]),
      symbolAt(layer, [175, 15.5]),
      symbolAt(layer, [-175, 15.5]),
      symbolAt(layer, [5, 15.5]),
    ]);
    // A ring along 80° N all around, the pole inside.
    const ring: LonLat[] = [-180, -135, -90, -45, 0, 45, 90, 135].map((lon) => [lon, 80]);
    const polar = await client.subscribe({ id: 'polar', area: { ring: [...ring, ring[0]], inside: [0, 90] }, resolution: 2000 });
    expect(polar.objects.map((o: { id: string }) => o.id)).toEqual([nearPole.entityId]);
    // From 170° E to 170° W across 180°.
    const across = await client.subscribe({
      id: 'across',
      area: { ring: [[170, 10], [-170, 10], [-170, 20], [170, 20], [170, 10]], inside: [180, 15] },
      resolution: 2000,
    });
    expect(across.objects.map((o: { id: string }) => o.id).sort()).toEqual([east.entityId, west.entityId].sort());
    expect([...polar.objects, ...across.objects].map((o: { id: string }) => o.id)).not.toContain(south.entityId);
    expect(across.objects.map((o: { id: string }) => o.id)).not.toContain(far.entityId);
  });
});

test('over the budget dense cells become clusters with counts by layer and identity; below 90 % of it the subscription returns to single objects', async ({}, testInfo) => {
  await withServer(testInfo, async (_server, client, layer) => {
    // 50 objects within about 1 km (one cell at 500 m/px: cells are about 32 km), 30 friend and
    // 20 hostile, and 10 single objects about 29 km (0.5° of longitude) or 111 km (1° of latitude)
    // apart from each other, the nearest about 35 km from the dense spot.
    const dense = Array.from({ length: 50 }, (_, i) => symbolAt(layer, [18.0 + (i % 10) * 0.001, 59.0 + Math.floor(i / 10) * 0.001], i < 30 ? '3' : '6'));
    const singles = Array.from({ length: 10 }, (_, i) => symbolAt(layer, [17.2 + (i % 5) * 0.5, 58.3 + Math.floor(i / 5) * 1.0]));
    const denseEvents = await create(client, dense);
    const singleEvents = await create(client, singles);

    const map = await client.subscribe({ id: 'map', area: boxArea(STOCKHOLM), resolution: 500, budget: 20 });
    expect(map.objects.map((o: { id: string }) => o.id).sort(), 'the single objects stay objects').toEqual(singleEvents.map((e) => e.entityId).sort());
    expect(map.clusters.full).toBe(true);
    expect(map.clusters.upsert).toHaveLength(1);
    const [cluster] = map.clusters.upsert as Array<{ count: number; position: LonLat; byLayer: Record<string, number>; byIdentity: Record<string, number> }>;
    expect(cluster.count).toBe(50);
    expect(cluster.byLayer).toEqual({ [layer]: 50 });
    expect(cluster.byIdentity).toMatchObject({ friend: 30, hostile: 20 });
    expect(cluster.position[0], 'the mean of its objects').toBeCloseTo(18.0045, 3);
    expect(cluster.position[1]).toBeCloseTo(59.002, 3);
    testInfo.annotations.push({ type: 'cluster', description: JSON.stringify(cluster) });

    // Delete 45 of the dense ones: 15 objects left (5 dense, 10 single), below 90 % of the budget
    // of 20. The switch back comes with the batch that crosses 18, which may end after the 43rd,
    // 44th or 45th delete: the dense objects held are those that entered minus later deletes.
    for (const e of denseEvents.slice(0, 45)) expect((await client.change(deleteRequest(e.entityId))).outcome).toBe('applied');
    const empty = await client.next((m: Message) => m.type === 'clusters' && m.subscription === 'map' && m.full === true, 20_000);
    expect(empty.upsert, 'an empty full set of clusters').toEqual([]);
    const [later] = await create(client, [symbolAt(layer, [-60.5, -30.25])]);
    await client.waitForSequence(later.sequenceNo, 10_000, 'map');
    const entered = client.inbox
      .filter((m: Message) => m.type === 'area-objects' && m.subscription === 'map')
      .flatMap((m: Message) => (m.entered as Array<{ id: string }>).map((o) => o.id));
    const deletedLater = new Set(client.eventsOf('map').filter((e: { operation: string }) => e.operation === 'delete').map((e: { entityId: string }) => e.entityId));
    const held = entered.filter((id: string) => !deletedLater.has(id));
    expect(held.sort(), 'the rest of the cell, as objects').toEqual(denseEvents.slice(45).map((e) => e.entityId).sort());
  });
});

test('objects: false gives the layers and the number of objects per layer, kept up to date, and layer events only', async ({}, testInfo) => {
  await withServer(testInfo, async (_server, client, layer) => {
    const counts = await client.subscribe({ id: 'counts', objects: false });
    expect(counts.objectCounts, 'every layer, 0 for an empty one').toEqual({ [layer]: 0 });
    const top = randomUUID();
    const layerCreate = await client.change({
      requestId: randomUUID(),
      entityType: 'layer',
      operation: 'create',
      entityId: top,
      data: { name: 'Top', drawOrder: 5, visible: true, label: { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' } },
      source: { plugin: 'ita-test' },
    });
    expect(layerCreate.outcome).toBe('applied');
    const created = await create(client, [symbolAt(layer, [18.3, 59.7]), symbolAt(top, [18.4, 59.8])]);
    // Counts come once per batch of the store's changes: the new layer's event may come alone (both
    // layers at 0, a message that stays in the inbox) or with the creates, depending on load. So the
    // counts that cover a change are the first message at or after its sequence number.
    const countsAt = (sequenceNo: number) =>
      client.next((m: Message) => m.type === 'counts' && m.subscription === 'counts' && (m.sequenceNo as number) >= sequenceNo);
    const both = await countsAt(Math.max(...created.map((e) => e.sequenceNo)));
    expect(both.counts, 'one object in each layer').toEqual({ [layer]: 1, [top]: 1 });
    const deleted = await client.change(deleteRequest(created[0].entityId));
    expect(deleted.outcome).toBe('applied');
    const after = await countsAt(deleted.event.sequenceNo);
    expect(after.counts, 'every layer, 0 for an empty one').toEqual({ [layer]: 0, [top]: 1 });
    expect(client.eventsOf('counts').map((e: { entityType: string }) => e.entityType), 'only the layer event').toEqual(['layer']);
  });
});

// The limits of protocol version 2 (server/live-picture-protocol.md, "Limits").

test('an area ring may have 256 positions; a longer one is refused with an error for that subscription', async ({}, testInfo) => {
  await withServer(testInfo, async (_server, client) => {
    // A circle around Stockholm, n - 1 positions plus the closing one.
    const circle = (n: number): LonLat[] => {
      const ring: LonLat[] = Array.from({ length: n - 1 }, (_, i) => [18.5 + Math.cos((2 * Math.PI * i) / (n - 1)), 59.2 + 0.5 * Math.sin((2 * Math.PI * i) / (n - 1))]);
      return [...ring, ring[0]];
    };
    const ok = await client.subscribe({ id: 'ring-256', area: { ring: circle(256), inside: [18.5, 59.2] }, resolution: 500 });
    expect(ok.id).toBe('ring-256');
    client.send({ type: 'subscribe', subscription: 'ring-257', area: { ring: circle(257), inside: [18.5, 59.2] }, resolution: 500 });
    const error = await client.next((m: Message) => m.type === 'error' && m.subscription === 'ring-257');
    testInfo.annotations.push({ type: 'error', description: String(error.message) });
    expect(String(error.message)).toMatch(/256/);
  });
});

test('area queries are served at most 4 per connection and second; the rest wait, and of several moves of one subscription only the latest counts', async ({}, testInfo) => {
  await withServer(testInfo, async (_server, client, layer) => {
    const [stockholm, copenhagen] = await create(client, [symbolAt(layer, [18.5, 59.0]), symbolAt(layer, [12.5, 55.5])]);
    // 8 subscriptions, each moved once at the same moment.
    for (let i = 0; i < 8; i++) await client.subscribe({ id: `area-${i}`, area: boxArea(STOCKHOLM), resolution: 500 });
    const sent = Date.now();
    for (let i = 0; i < 8; i++) client.send({ type: 'area', subscription: `area-${i}`, area: boxArea(COPENHAGEN), resolution: 500 });
    const times: number[] = [];
    for (let i = 0; i < 8; i++) {
      await client.next((m: Message) => m.type === 'area-objects' && m.subscription === `area-${i}`, 10_000);
      times.push(Date.now() - sent);
    }
    times.sort((a, b) => a - b);
    testInfo.annotations.push({ type: 'answers after', description: `${times.join(', ')} ms` });
    expect(times[4] - times[0], 'the fifth answer waits for the next second').toBeGreaterThanOrEqual(700);
    expect(times[3] - times[0], 'the first four are served in the same second').toBeLessThan(700);
    expect(times[7], 'all eight within about two seconds (generous bound)').toBeLessThan(5_000);

    // Three moves of one subscription at once: it ends in the last area, without three answers.
    client.send({ type: 'area', subscription: 'area-0', area: boxArea(STOCKHOLM), resolution: 500 });
    client.send({ type: 'area', subscription: 'area-0', area: boxArea([0.5, 40.25, 2.5, 41.5]), resolution: 500 });
    client.send({ type: 'area', subscription: 'area-0', area: boxArea(STOCKHOLM), resolution: 500 });
    // Collect the answers for 3 s: a negative check (fewer answers than moves) needs a window
    // (README, Rules).
    const answers: Array<{ entered: Array<{ id: string }>; left: string[] }> = [];
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const answer = await client.next((m: Message) => m.type === 'area-objects' && m.subscription === 'area-0', deadline - Date.now()).catch(() => undefined);
      if (answer) answers.push(answer as never);
    }
    expect(answers.length, 'fewer answers than moves').toBeLessThan(3);
    const held = new Set([copenhagen.entityId]);
    for (const a of answers) {
      for (const o of a.entered) held.add(o.id);
      for (const id of a.left) held.delete(id);
    }
    expect([...held], 'in the last area (Stockholm)').toEqual([stockholm.entityId]);
  });
});

// Over 200 000 objects take over a minute to create: only in the full run (T-063).
test("a connection's area subscriptions hold at most 600 000 objects together: a subscribe or a move beyond that gets an error, and the area stays", { tag: '@full' }, async ({}, testInfo) => {
  testInfo.setTimeout(600_000);
  await withServer(testInfo, async (server, client, layer) => {
    // 200 001 objects all over the world: two subscriptions of the world hold 400 002, a third
    // would make 600 003 (owner, 2026-10-12: the cap is 600 000).
    const load = await LoadClient.open(server.baseUrl);
    await load.create(grid([-170.5, -60.25, 170.5, 70.25], 200_001).map((p, i) => symbolData(layer, i, p)));
    expect(load.summary()).toMatchObject({ applied: 200_001, rejected: 0, unknown: 0, errors: 0 });
    await load.close();
    const world = boxArea([-179, -80, 179, 80]);

    const first = await client.subscribe({ id: 'world-1', area: world, resolution: 50_000, budget: 1_000, timeoutMs: 60_000 });
    expect(first.clusters.upsert.length, 'over the budget: clusters').toBeGreaterThan(0);
    const second = await client.subscribe({ id: 'world-2', area: world, resolution: 50_000, budget: 1_000, timeoutMs: 60_000 });
    expect(second.clusters.upsert.length, '400 002 together: still allowed').toBeGreaterThan(0);
    client.send({ type: 'subscribe', subscription: 'world-3', area: world, resolution: 50_000, budget: 1_000 });
    const refused = await client.next((m: Message) => m.type === 'error' && m.subscription === 'world-3', 60_000);
    testInfo.annotations.push({ type: 'subscribe refused', description: String(refused.message) });
    expect(String(refused.message)).toMatch(/600000|600 000/);

    // A small area is fine; moving it to the world is refused, and it keeps its area.
    const small = await client.subscribe({ id: 'small', area: boxArea(STOCKHOLM), resolution: 500, budget: 1_000 });
    client.send({ type: 'area', subscription: 'small', area: world, resolution: 50_000 });
    const moveRefused = await client.next((m: Message) => m.type === 'error' && m.subscription === 'small', 60_000);
    testInfo.annotations.push({ type: 'move refused', description: String(moveRefused.message) });
    expect(String(moveRefused.message)).toMatch(/600000|600 000/);
    // It keeps its old area: an object in Stockholm arrives, one in Copenhagen (in the world, not
    // in Stockholm) does not.
    const [inside, outside] = await create(client, [symbolAt(layer, [18.25, 59.75]), symbolAt(layer, [12.5, 55.75])]);
    await client.waitForSequence(Math.max(inside.sequenceNo, outside.sequenceNo), 30_000, 'small');
    const ids = client.eventsOf('small').map((e: { entityId: string }) => e.entityId);
    expect(ids).toContain(inside.entityId);
    expect(ids, 'the refused move did not take effect').not.toContain(outside.entityId);
    expect(small.id).toBe('small');
  });
});
