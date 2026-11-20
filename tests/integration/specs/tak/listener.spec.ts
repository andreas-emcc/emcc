// Quick run: @tak
import { expect, test } from '@playwright/test';
import { stopOwnServer, withOwnServers, type OwnServer } from '../../lib/own-server';
import { cotEvent, startTakDouble } from '../../lib/tak-double.mjs';
import { listenerCredentialArgs, testCertificates } from '../../lib/test-certs.mjs';
import { installTestPlugin } from '../../lib/test-plugins.mjs';

// The TAK test double with ECore's own listeners (SDK v1), through the ITA's test plugin
// ita-listener, before the cot plugin exists (T-040): plain TCP, TLS with the certificates made at
// test time (the cot brief's criterion 9), and a TAK system that goes away and comes back.

test.describe.configure({ timeout: 120_000 });

type Received = { connects: number; disconnects: number; lastReason: string; events: number; bytes: number };

async function received(server: OwnServer): Promise<Received> {
  return (await fetch(`${server.baseUrl}/api/plugins/ita-listener/received`)).json();
}

function events(n: number, prefix: string): string {
  return Array.from({ length: n }, (_, i) => cotEvent({ uid: `${prefix}-${i}`, lon: 18 + i / 1000, lat: 59.5 })).join('');
}

test('over TCP, an ECore listener connects to the double, writes its presence event and reads every event', async ({}, testInfo) => {
  const double = await startTakDouble();
  try {
    await withOwnServers(testInfo, async (folders, start) => {
      installTestPlugin(folders.pluginsDir, 'ita-listener', { settings: { stream: { host: '127.0.0.1', port: double.port } } });
      const server = await start();
      await double.waitForConnections(1);
      await expect.poll(() => double.receivedText(), { message: 'the presence event arrived' }).toContain('uid="ita-listener" type="t-x-c-t"');
      await expect.poll(async () => (await received(server)).connects).toBe(1);
      double.sendRaw(events(50, 'tcp'));
      await expect.poll(async () => (await received(server)).events).toBe(50);
      await stopOwnServer(server);
    });
  } finally {
    await double.close();
  }
});

test('over TLS, the listener presents the client certificate made at test time and trusts the double through the CA (cot criterion 9)', async ({}, testInfo) => {
  const certs = testCertificates();
  const double = await startTakDouble({ certs });
  try {
    await withOwnServers(testInfo, async (folders, start) => {
      installTestPlugin(folders.pluginsDir, 'ita-listener', { settings: { stream: { host: '127.0.0.1', port: double.port }, transport: 'tls' } });
      const server = await start(listenerCredentialArgs(certs, 'ita-tak'));
      const connection = await double.waitForConnections(1);
      expect(connection, 'the double saw the client certificate').toMatchObject({ authorized: true, peer: certs.clientName });
      double.sendRaw(events(20, 'tls'));
      await expect.poll(async () => (await received(server)).events).toBe(20);
      expect(double.rejected, 'no failed handshake').toEqual([]);
      await stopOwnServer(server);
    });
  } finally {
    await double.close();
  }
});

test('when the double goes away the listener is disconnected and reconnects once it is back, and events flow again', async ({}, testInfo) => {
  const double = await startTakDouble();
  try {
    await withOwnServers(testInfo, async (folders, start) => {
      installTestPlugin(folders.pluginsDir, 'ita-listener', { settings: { stream: { host: '127.0.0.1', port: double.port } } });
      const server = await start();
      await double.waitForConnections(1);
      double.sendRaw(events(5, 'before'));
      await expect.poll(async () => (await received(server)).events).toBe(5);

      await double.goAway();
      // The back-off (100 ms, at most 1 s here) keeps trying while the port is closed.
      await expect.poll(async () => (await received(server)).disconnects, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
      testInfo.annotations.push({ type: 'disconnect reason', description: (await received(server)).lastReason });

      await double.comeBack();
      await double.waitForConnections(2);
      double.sendRaw(events(5, 'after'));
      await expect.poll(async () => (await received(server)).events).toBe(10);
      expect((await received(server)).connects).toBe(2);
      await stopOwnServer(server);
    });
  } finally {
    await double.close();
  }
});
