// Quick run: @live @limits
import { expect, test } from '@playwright/test';
import { createSymbol, seededLayer, LiveClient } from '../../lib/live.mjs';
import { stopOwnServer, withOwnServers } from '../../lib/own-server';
import { openRaw } from '../../lib/raw-socket.mjs';

// The live picture's limits (server/live-picture-protocol.md, "Limits" and "Slow browsers and
// closing"). Only limits that a client can reach deterministically are tested here; see the
// README for the ones that are not (the 2 Mi character inbound budget, the 100 waiting change
// requests).

const MiB = 1_048_576;

test.describe('message limits', () => {
  test('a message of exactly 1 MiB is read (and answered) and the connection stays open', async ({ baseURL }) => {
    const client = await LiveClient.open(baseURL!);
    client.sendRaw('x'.repeat(MiB));
    expect((await client.next((m) => m.type === 'error')).message).toBe('not valid JSON');
    expect((await client.subscribe()).layers.length).toBeGreaterThan(0);
    await client.close();
  });

  test('a message of 1 MiB + 1 character closes the connection with 1009', async ({ baseURL }) => {
    const client = await LiveClient.open(baseURL!);
    client.sendRaw('x'.repeat(MiB + 1));
    expect(await client.closed).toBe(1009);
  });

  test('a binary frame closes the connection with 1003', async ({ baseURL }) => {
    const client = await LiveClient.open(baseURL!);
    client.sendRaw(new Uint8Array([1, 2, 3]));
    expect(await client.closed).toBe(1003);
  });
});

test.describe('change requests', () => {
  test('a flood of change requests gets exactly one outcome each, and every applied one is in the live picture', async ({
    baseURL,
  }) => {
    const client = await LiveClient.open(baseURL!);
    const snapshot = await client.subscribe();
    const layer = seededLayer(snapshot);
    const requests = Array.from({ length: 300 }, (_, i) => createSymbol(layer, i));
    for (const request of requests) client.send({ type: 'change-request', request });

    const outcomes = await Promise.all(
      requests.map((r) => client.next((m) => m.type === 'change-outcome' && m.requestId === r.requestId, 30_000)),
    );
    // More than 100 waiting are rejected at once with INTERNAL_ERROR ("send it again later");
    // whether any are depends on the store's speed, so only the kinds of answer are fixed.
    for (const outcome of outcomes) {
      if (outcome.outcome === 'rejected') expect(outcome.rejection.code).toBe('INTERNAL_ERROR');
      else expect(outcome.outcome).toBe('applied');
    }
    const applied = outcomes.filter((o) => o.outcome === 'applied');
    test.info().annotations.push({ type: 'flood', description: `${applied.length} of 300 applied` });
    expect(applied.length).toBeGreaterThan(0);

    const last = Math.max(...applied.map((o) => o.event.sequenceNo));
    await client.waitForSequence(last, 30_000);
    const live = new Set(client.events.map((e: { entityId: string }) => e.entityId));
    for (const outcome of applied) expect(live.has(outcome.event.entityId)).toBe(true);
    // No second outcome for any request.
    expect(client.inbox.filter((m: { type: string }) => m.type === 'change-outcome')).toEqual([]);
    await client.close();
  });
});

test.describe('sessions', () => {
  test.describe.configure({ timeout: 120_000 });

  test('the default allows 200 sessions at once; one more is closed with 1013', async ({}, testInfo) => {
    await withOwnServers(testInfo, async (_folders, start) => {
      const server = await start();
      const clients = await Promise.all(Array.from({ length: 200 }, () => LiveClient.open(server.baseUrl)));
      const extra = LiveClient.connect(server.baseUrl);
      expect(await extra.closed).toBe(1013);
      await Promise.all(clients.map((c) => c.close()));
      await stopOwnServer(server);
    });
  });

  test('with emc2.live.max-sessions=3 the fourth session is refused, and a closed session frees its place', async ({}, testInfo) => {
    await withOwnServers(testInfo, async (_folders, start) => {
      const server = await start(['--emc2.live.max-sessions=3']);
      const clients = await Promise.all(Array.from({ length: 3 }, () => LiveClient.open(server.baseUrl)));
      expect(await LiveClient.connect(server.baseUrl).closed).toBe(1013);

      await clients[0].close();
      // The place is freed when the server has handled the close: retry until accepted.
      const deadline = Date.now() + 10_000;
      let again: LiveClient | undefined;
      while (!again && Date.now() < deadline) {
        again = await LiveClient.open(server.baseUrl).catch(() => undefined);
      }
      expect(again, 'a new session after one was closed').toBeDefined();
      await Promise.all([again!.close(), clients[1].close(), clients[2].close()]);
      await stopOwnServer(server);
    });
  });
});

test.describe('slow browsers', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a client that stops reading is closed with 1013 once about 1 000 messages wait for it', async ({}, testInfo) => {
    await withOwnServers(testInfo, async (_folders, start) => {
      const server = await start();
      // 500 objects of about 50 kB: a snapshot of about 25 MB, far more than any socket buffer,
      // so the server's sender is blocked while the client does not read.
      const writer = await LiveClient.open(server.baseUrl);
      const layer = seededLayer(await writer.subscribe());
      const pad = 'x'.repeat(50_000);
      // At most 20 at a time (about 1 Mi characters): more could exceed the 2 Mi inbound budget.
      for (let first = 0; first < 500; first += 20) {
        const requests = Array.from({ length: 20 }, (_, i) => {
          const request = createSymbol(layer, first + i);
          request.data.extensions = { 'ita-test': { pad } };
          return request;
        });
        const outcomes = await Promise.all(requests.map((r) => writer.change(r, 30_000)));
        for (const outcome of outcomes) expect(outcome.outcome).toBe('applied');
      }
      await writer.close();

      const reader = await openRaw(server.baseUrl);
      await reader.sendText(JSON.stringify({ type: 'subscribe', subscription: 'all' }));
      // Each unusable message gets an error answer, which has to wait behind the snapshot.
      for (let i = 0; i < 1500; i++) await reader.sendText(`not JSON ${i}`);
      expect(await reader.readUntilClose(60_000)).toBe(1013);
      await stopOwnServer(server);
    });
  });
});
