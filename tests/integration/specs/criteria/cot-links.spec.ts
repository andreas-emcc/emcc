// Quick run: @plugin-cot @tak
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/criteria/cot-links.spec.ts
import { expect, test } from '@playwright/test';
import { cotStatus, linkStatus, setLinks, type CotObject, type Link } from '../../lib/cot';
import { createLayer, createSymbol, LiveClient } from '../../lib/live.mjs';
import { multicastInterface } from '../../lib/multicast.mjs';
import { stopOwnServer, withOwnServers, type OwnServer } from '../../lib/own-server';
import { installPlugins } from '../../lib/plugins.mjs';
import { parseEvents, startTakDouble } from '../../lib/tak-double.mjs';
import { listenerCredentialArgs, testCertificates } from '../../lib/test-certs.mjs';
import { freeUdpPort, startUdpPeer } from '../../lib/udp-peer.mjs';

// The cot plugin's M3 links against test peers (T-086; the cot brief's criteria 14, 15, 16, 22, 23
// and 24; ADR-0036, ADR-0037), each on a server of its own with only cot: TCP and TLS against the
// TAK test double, UDP against a Node peer on loopback, and multicast on the run's multicast
// interface (lib/multicast.mjs: loopback unless run.mjs names another; skipped without one). The
// TAK double relays events between its clients as a TAK Server does, for the round trip, and
// echoes them back to the sender for the echo check. The criteria about what is skipped, stale
// times, the channel's coalescing, declared fields and a link that is down (17 to 21, 27, 28) are
// the plugin's own tests with the test kit; the load (25) is the performance suite's.
// Not here: criterion 15 through a channel item (with the simulator as the sender, T-086 part 4),
// 22's deleted target layer made again, 23's "no host, port or group from anything but the
// settings", and a `both` link over UDP or multicast (only over TLS here).

test.describe.configure({ timeout: 180_000 });

type Event = { entityType: string; entityId: string; operation: string; sequenceNo: number; state: (CotObject & { name?: string }) | null };

/** A server with only cot, and a whole-picture client that writes and watches. */
async function withCot(testInfo: Parameters<typeof withOwnServers>[0], body: (server: OwnServer, client: LiveClient) => Promise<void>, extraArgs: string[] = []) {
  await withOwnServers(testInfo, async (folders, start) => {
    installPlugins(folders.pluginsDir, { only: ['cot'] });
    const server = await start(extraArgs);
    const client = await LiveClient.open(server.baseUrl);
    try {
      await client.subscribe();
      await body(server, client);
    } finally {
      await client.close();
    }
    await stopOwnServer(server);
  });
}

/** A View layer to send from; resolves with its id and name for an out link's sourceLayers. */
async function sourceLayer(client: LiveClient, name: string) {
  const request = createLayer(name, { drawOrder: 1 });
  expect(await client.change(request), `layer ${name}`).toMatchObject({ outcome: 'applied' });
  return { id: request.entityId as string, name };
}

/**
 * An APP-6B friendly infantry symbol (CoT type a-f-G-U-C-I) with a callsign, course and speed, at a
 * point where latitude ≠ longitude; resolves with its id and what cot should send for it.
 */
async function placeSymbol(client: LiveClient, layerId: string, { name, lon, lat, course = 45, speed = 12.5 }: { name: string; lon: number; lat: number; course?: number; speed?: number }) {
  const request = createSymbol(layerId, 0, { name });
  request.data.geometry.coordinates = [lon, lat];
  request.data.symbol = { standard: 'APP-6B', sidc: 'SFGPUCI--------', modifiers: { direction: course, speed } };
  expect(await client.change(request), name).toMatchObject({ outcome: 'applied' });
  return { id: request.entityId as string, expected: { uid: request.entityId, type: 'a-f-G-U-C-I', lon, lat, callsign: name, course, speed } };
}

/** What a peer got for an object, as the brief's criterion 14 compares it. */
function asSent(e: ReturnType<typeof parseEvents>[number]) {
  return { uid: e.uid, type: e.type, lon: e.lon, lat: e.lat, callsign: e.callsign, course: e.course, speed: e.speed };
}

/** The object cot made for a received uid, from the live picture. */
async function received(client: LiveClient, uid: string): Promise<Event> {
  const find = () => (client.events as Event[]).filter((e) => e.state?.meta?.externalRef?.system === 'cot' && e.state.meta.externalRef.id === uid);
  await expect.poll(() => find().length, { timeout: 15_000, message: `an object for ${uid}` }).toBeGreaterThan(0);
  return find().at(-1)!;
}

/** The layer a received object went into, by name, from a fresh snapshot. */
async function layerNameOf(server: OwnServer, layerId: string) {
  const reader = await LiveClient.open(server.baseUrl);
  try {
    const snapshot = await reader.subscribe();
    return snapshot.layers.find((l: { id: string }) => l.id === layerId)?.name;
  } finally {
    await reader.close();
  }
}

/** The status part of every link must say it is connected or listening before a test sends. */
async function waitRunning(server: OwnServer, names: string[]) {
  for (const name of names) {
    await expect.poll(() => linkStatus(server, name), { timeout: 15_000, message: `${name} running` }).toMatch(new RegExp(`^${name}: (connected|listening|receiving|sending|running|up)`));
  }
}

test('criterion 14, tcp: an in link\'s event lands in its target layer; an out link sends a source-layer symbol that parses back with its type, uid, position, callsign, course and speed', async ({}, testInfo) => {
  const double = await startTakDouble();
  try {
    await withCot(testInfo, async (server, client) => {
      const outbound = await sourceLayer(client, 'Outbound');
      await setLinks(server, [
        { name: 'tcp-in', port: double.port, targetLayer: { name: 'From TCP' } },
        { name: 'tcp-out', direction: 'out', port: double.port, sourceLayers: [outbound] },
      ]);
      await double.waitForConnections(2);
      double.send({ uid: 'ita-tcp-1', lon: 18.25, lat: 59.5, callsign: 'TCP 1' });
      const got = await received(client, 'ita-tcp-1');
      expect(await layerNameOf(server, got.state!.layerId), 'the target layer').toBe('From TCP');
      expect(got.state).toMatchObject({ dataSource: 'tcp-in' });

      const symbol = await placeSymbol(client, outbound.id, { name: 'OUT TCP', lon: 17.5, lat: 58.75 });
      await expect.poll(() => double.receivedEvents().filter((e) => e.uid === symbol.id).map(asSent), { timeout: 10_000 }).toEqual([symbol.expected]);
    });
  } finally {
    await double.close();
  }
});

test('criterion 14, tls and both: one TLS connection with the test certificates receives into its target layer and sends its source layer, and does not send back what it received (criterion 16)', async ({}, testInfo) => {
  const certs = testCertificates();
  const double = await startTakDouble({ certs });
  try {
    await withCot(
      testInfo,
      async (server, client) => {
        const outbound = await sourceLayer(client, 'Outbound');
        await setLinks(server, [{ name: 'tls-both', direction: 'both', transport: 'tls', port: double.port, targetLayer: outbound, sourceLayers: [outbound], refreshSeconds: 0 }]);
        const connection = await double.waitForConnections(1);
        expect(connection).toMatchObject({ authorized: true, peer: certs.clientName });
        double.send({ uid: 'ita-tls-1', lon: 16.25, lat: 57.5, callsign: 'TLS 1' });
        const got = await received(client, 'ita-tls-1');
        expect(got.state!.layerId, 'into its target layer, which is also its source').toBe(outbound.id);

        const symbol = await placeSymbol(client, outbound.id, { name: 'OUT TLS', lon: 15.5, lat: 56.75 });
        await expect.poll(() => double.receivedEvents().filter((e) => e.uid === symbol.id).map(asSent), { timeout: 10_000 }).toEqual([symbol.expected]);
        // The received object is in the source layer too, but not sent back on the link it came from.
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        expect(double.receivedEvents().filter((e) => e.uid === 'ita-tls-1'), 'no echo of what came in').toEqual([]);
      },
      listenerCredentialArgs(certs, 'tls-both'),
    );
  } finally {
    await double.close();
  }
});

test('criterion 14, udp: an in link receives one event per datagram on 127.0.0.1 (criterion 23: its address when none is set); an out link sends to its host and port', async ({}, testInfo) => {
  const peer = await startUdpPeer();
  try {
    await withCot(testInfo, async (server, client) => {
      const outbound = await sourceLayer(client, 'Outbound');
      const inPort = await freeUdpPort();
      await setLinks(server, [
        { name: 'udp-in', transport: 'udp', port: inPort, targetLayer: { name: 'From UDP' } },
        { name: 'udp-out', direction: 'out', transport: 'udp', port: peer.port, sourceLayers: [outbound] },
      ]);
      await expect
        .poll(async () => {
          const monitor = await (await fetch(`${server.baseUrl}/api/monitor`)).json();
          const tasks = monitor.plugins.find((p: { id: string }) => p.id === 'cot').tasks as Array<{ name: string; listening: string | null }>;
          return tasks.find((t) => t.name === 'udp-in')?.listening;
        }, { timeout: 15_000, message: 'udp-in listening' })
        .toBe(`127.0.0.1:${inPort}`);
      await peer.send({ uid: 'ita-udp-1', lon: 14.25, lat: 55.5, callsign: 'UDP 1' }, { port: inPort });
      const got = await received(client, 'ita-udp-1');
      expect(await layerNameOf(server, got.state!.layerId)).toBe('From UDP');
      expect(got.state).toMatchObject({ dataSource: 'udp-in' });

      const symbol = await placeSymbol(client, outbound.id, { name: 'OUT UDP', lon: 13.5, lat: 54.75 });
      await expect.poll(() => peer.events().filter((e) => e.uid === symbol.id).map(asSent), { timeout: 10_000 }).toEqual([symbol.expected]);
      expect(peer.received.filter((r) => parseEvents(r.text).some((e) => e.uid === symbol.id)).length, 'one event per datagram').toBe(1);
    });
  } finally {
    await peer.close();
  }
});

test('criterion 14, multicast: on the run\'s multicast interface an in link receives the group\'s events and an out link sends to the group', async ({}, testInfo) => {
  const network = multicastInterface();
  test.skip('skip' in network, 'skip' in network ? network.skip : '');
  if (!('name' in network)) return;
  testInfo.annotations.push({ type: 'multicast interface', description: `${network.name} (${network.address})` });
  const inGroup = '239.255.77.1';
  const outGroup = '239.255.77.2';
  const inPort = await freeUdpPort();
  const sender = await startUdpPeer({ multicast: { group: inGroup, address: network.address } });
  const listener = await startUdpPeer({ multicast: { group: outGroup, address: network.address } });
  try {
    await withCot(testInfo, async (server, client) => {
      const outbound = await sourceLayer(client, 'Outbound');
      await setLinks(server, [
        { name: 'mc-in', transport: 'multicast', address: inGroup, port: inPort, interface: network.name, targetLayer: { name: 'From multicast' } },
        { name: 'mc-out', direction: 'out', transport: 'multicast', address: outGroup, port: listener.port, interface: network.name, sourceLayers: [outbound] },
      ]);
      // The in link has joined when its task listens; datagrams sent before are lost, so send until one arrives.
      const event = { uid: 'ita-mc-1', lon: 12.25, lat: 53.5, callsign: 'MC 1' };
      await expect
        .poll(async () => {
          await sender.send(event, { port: inPort });
          return (client.events as Event[]).some((e) => e.state?.meta?.externalRef?.id === 'ita-mc-1');
        }, { timeout: 20_000, intervals: [500], message: 'a group event received' })
        .toBe(true);
      const got = await received(client, 'ita-mc-1');
      expect(await layerNameOf(server, got.state!.layerId)).toBe('From multicast');
      expect(got.state).toMatchObject({ dataSource: 'mc-in' });

      const symbol = await placeSymbol(client, outbound.id, { name: 'OUT MC', lon: 11.5, lat: 52.75 });
      await expect.poll(() => listener.events().filter((e) => e.uid === symbol.id).map(asSent), { timeout: 10_000 }).toEqual([symbol.expected]);
    });
  } finally {
    await Promise.all([sender.close(), listener.close()]);
  }
});

test('criterion 23: a multicast link with no interface stays stopped and its status says so; the other links run', async ({}, testInfo) => {
  const double = await startTakDouble();
  try {
    await withCot(testInfo, async (server) => {
      await setLinks(server, [
        { name: 'tak-in', port: double.port },
        { name: 'mc-no-interface', transport: 'multicast', address: '239.255.77.3', port: await freeUdpPort() } as Link,
      ]);
      await double.waitForConnections(1);
      await expect.poll(() => linkStatus(server, 'mc-no-interface'), { timeout: 10_000 }).toMatch(/interface/);
      const status = await cotStatus(server);
      testInfo.annotations.push({ type: 'status', description: status.detail });
      expect(await linkStatus(server, 'mc-no-interface')).not.toMatch(/connected|listening/);
      expect(await linkStatus(server, 'tak-in')).toMatch(/^tak-in: connected since/);
      const monitor = await (await fetch(`${server.baseUrl}/api/monitor`)).json();
      const names = (monitor.plugins.find((p: { id: string }) => p.id === 'cot').tasks as Array<{ name: string }>).map((t) => t.name);
      expect(names, 'no task for the stopped link').not.toContain('mc-no-interface');
    });
  } finally {
    await double.close();
  }
});

test('criterion 15: tracks handed to link A come back through link B into a View layer, through a double that relays as a TAK Server does', async ({}, testInfo) => {
  const double = await startTakDouble({ relay: 'others' });
  try {
    await withCot(testInfo, async (server, client) => {
      const outbound = await sourceLayer(client, 'Outbound');
      await setLinks(server, [
        { name: 'link-a', direction: 'out', port: double.port, sourceLayers: [outbound] },
        { name: 'link-b', port: double.port, targetLayer: { name: 'Returned' } },
      ]);
      await double.waitForConnections(2);
      const symbol = await placeSymbol(client, outbound.id, { name: 'ROUND TRIP', lon: 10.5, lat: 51.75, course: 270, speed: 3 });
      const back = await received(client, symbol.id);
      expect(await layerNameOf(server, back.state!.layerId), 'a View layer of its own').toBe('Returned');
      expect(back.state).toMatchObject({ dataSource: 'link-b', dataType: 'cot.cot', meta: { externalRef: { system: 'cot', id: symbol.id } } });
      expect(back.state!.geometry.coordinates[0]).toBeCloseTo(10.5, 6);
      expect(back.state!.geometry.coordinates[1]).toBeCloseTo(51.75, 6);
      expect(back.state!.symbol.modifiers).toMatchObject({ uniqueDesignation: 'ROUND TRIP', direction: 270, speed: 3 });
    });
  } finally {
    await double.close();
  }
});

/**
 * Criterion 16's echo set-up: an out link whose source layer is the target of an in link, both to
 * a double that echoes every event to every client. Resolves with how many events went out for
 * one created symbol: once it has settled, and again 5 s later.
 */
async function echoCounts(server: OwnServer, client: LiveClient, double: Awaited<ReturnType<typeof startTakDouble>>) {
  const shared = await sourceLayer(client, 'Shared');
  await setLinks(server, [
    { name: 'echo-out', direction: 'out', port: double.port, sourceLayers: [shared], refreshSeconds: 0 },
    { name: 'echo-in', port: double.port, targetLayer: shared },
  ]);
  await double.waitForConnections(2);
  const symbol = await placeSymbol(client, shared.id, { name: 'ECHO', lon: 9.5, lat: 50.75 });
  const sent = () => double.receivedEvents().filter((e) => e.uid === symbol.id).length;
  await expect.poll(sent, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const settled = sent();
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const reader = await LiveClient.open(server.baseUrl);
  const objects = (await reader.subscribe()).objects.filter((o: CotObject) => o.layerId === shared.id).length;
  await reader.close();
  return { settled, later: sent(), objects };
}

test('criterion 16: with an output whose source layer is the target of an input on a double that echoes, the create goes out once and the echo stops', async ({}, testInfo) => {
  // The echo of a symbol made in emc2 carries the symbol's id as its uid; cot recognises it as the
  // echo and stores no second object, so nothing goes out again (dc1edf7, owner's N1 and S1).
  const double = await startTakDouble({ relay: 'all' });
  try {
    await withCot(testInfo, async (server, client) => {
      const counts = await echoCounts(server, client, double);
      testInfo.annotations.push({ type: 'echo', description: JSON.stringify(counts) });
      expect(await linkStatus(server, 'echo-in'), 'the echo was read').toMatch(/[1-9]\d* read/);
      expect(counts.settled, 'the create went out once').toBe(1);
      expect(counts.later, 'nothing more went out once it settled').toBe(counts.settled);
      expect(counts.objects, 'one object in the layer').toBe(1);
    });
  } finally {
    await double.close();
  }
});

test('criterion 22: two links that name the same new layer share one, and the status shows each link\'s layer', async ({}, testInfo) => {
  const north = await startTakDouble();
  const south = await startTakDouble();
  try {
    await withCot(testInfo, async (server, client) => {
      await setLinks(server, [
        { name: 'tak-north', port: north.port, targetLayer: { name: 'Shared picture' } },
        { name: 'tak-south', port: south.port, targetLayer: { name: 'Shared picture' } },
      ]);
      await north.waitForConnections(1);
      await south.waitForConnections(1);
      north.send({ uid: 'ita-n', lon: 18.5, lat: 59.5 });
      south.send({ uid: 'ita-s', lon: 12.5, lat: 55.5 });
      const n = await received(client, 'ita-n');
      const s = await received(client, 'ita-s');
      expect(n.state!.layerId, 'one layer').toBe(s.state!.layerId);
      expect(await layerNameOf(server, n.state!.layerId)).toBe('Shared picture');
      for (const name of ['tak-north', 'tak-south']) await expect.poll(() => linkStatus(server, name)).toContain("layer 'Shared picture'");
    });
  } finally {
    await Promise.all([north.close(), south.close()]);
  }
});

test('criterion 24: stored streams from M1 and M2 are not read; the plugin starts and says so in its status', async ({}, testInfo) => {
  await withCot(testInfo, async (server) => {
    const url = `${server.baseUrl}/api/settings/plugins/cot`;
    const values = (await (await fetch(url)).json()).values;
    const put = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...values, streams: [{ name: 'old-stream', host: '127.0.0.1', port: 8087 }] }),
    });
    testInfo.annotations.push({ type: 'PUT with streams', description: `${put.status} ${await put.clone().text()}` });
    expect(put.status, 'the settings take the old entries as they are').toBe(200);
    await expect.poll(async () => (await cotStatus(server)).detail, { timeout: 10_000 }).toContain('stored streams (old-stream) are no longer read: enter them as links');
  });
});
