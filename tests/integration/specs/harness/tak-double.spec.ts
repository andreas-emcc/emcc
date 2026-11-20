// Quick run: @harness @tak
import { expect, test } from '@playwright/test';
import { rmSync, writeFileSync } from 'node:fs';
import { connect as tcpConnect, type Socket } from 'node:net';
import { join } from 'node:path';
import { connect as tlsConnect } from 'node:tls';
import { spawnGroup, killTree } from '../../lib/processes.mjs';
import { makeTempFolder, root } from '../../lib/server.mjs';
import { cotEvent, hostile, startTakDouble } from '../../lib/tak-double.mjs';
import { clientTlsOptions, testCertificates } from '../../lib/test-certs.mjs';

// Self-tests of the TAK test double (lib/tak-double.mjs, T-043), with plain Node clients in place
// of emc2's cot plugin: what it sends is what the cot brief's criteria need, TLS requires a client
// certificate made at test time, and it can go away and come back.

test.describe.configure({ timeout: 60_000 });

type Client = { socket: Socket; text: () => string; closed: Promise<void> };

function client(socket: Socket): Client {
  const chunks: Buffer[] = [];
  socket.on('data', (chunk) => chunks.push(chunk));
  socket.on('error', () => undefined);
  const closed = new Promise<void>((resolve) => socket.on('close', () => resolve()));
  return { socket, text: () => Buffer.concat(chunks).toString('utf8'), closed };
}

function tcpClient(port: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = tcpConnect({ host: '127.0.0.1', port }, () => resolve(client(socket)));
    socket.once('error', reject);
  });
}

function events(text: string): string[] {
  return text.match(/<event [\s\S]*?<\/event>/g) ?? [];
}

test('over TCP the double sends CoT events one after another, as scripted, with lon and lat as given', async () => {
  const double = await startTakDouble();
  try {
    const c = await tcpClient(double.port);
    await double.waitForConnections(1);
    const time = Date.parse('2026-10-12T08:00:00Z');
    expect(double.send({ uid: 'ita-1', lon: 18.07, lat: 59.33, callsign: 'ALPHA 1', course: 90, speed: 4.5, time })).toBe(1);
    double.send({ uid: 'ita-1', lon: 18.08, lat: 59.34, time: time + 1000, detail: '<__ita private="yes"/>' });
    await expect.poll(() => events(c.text()).length).toBe(2);
    const [first, second] = events(c.text());
    expect(first).toContain('uid="ita-1"');
    expect(first).toContain('<point lat="59.33" lon="18.07" hae="9999999.0" ce="9999999.0" le="9999999.0"/>');
    expect(first).toContain('<contact callsign="ALPHA 1"/><track course="90" speed="4.5"/>');
    expect(first).toContain('time="2026-10-12T08:00:00.000Z" start="2026-10-12T08:00:00.000Z" stale="2026-10-12T08:05:00.000Z"');
    expect(second).toContain('<__ita private="yes"/>');
    expect(c.text(), 'no separator between events').toBe(first + second);
    c.socket.destroy();
  } finally {
    await double.close();
  }
});

test('over TLS the double accepts a client with the certificate made at test time and refuses one without', async () => {
  const certs = testCertificates();
  const double = await startTakDouble({ certs });
  try {
    const good = await new Promise<Client>((resolve, reject) => {
      const socket = tlsConnect({ host: '127.0.0.1', port: double.port, ...clientTlsOptions(certs) }, () => resolve(client(socket)));
      socket.once('error', reject);
    });
    const connection = await double.waitForConnections(1);
    expect(connection).toMatchObject({ authorized: true, peer: certs.clientName });
    double.send({ uid: 'ita-tls', lon: 18.1, lat: 59.2 });
    await expect.poll(() => events(good.text()).length).toBe(1);

    const refused = await new Promise<string>((resolve) => {
      const socket = tlsConnect({ host: '127.0.0.1', port: double.port, ...clientTlsOptions(certs, { withCertificate: false }) });
      socket.on('data', () => resolve('got data'));
      socket.on('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message));
      socket.on('close', () => resolve('closed'));
    });
    expect(refused).not.toBe('got data');
    await expect.poll(() => double.rejected.length, { message: 'the double saw a client without a certificate' }).toBe(1);
    expect(double.connections, 'only the client with the certificate got through').toHaveLength(1);
    good.socket.destroy();
  } finally {
    await double.close();
  }
});

test('the hostile inputs are what criterion 6 needs, and a request for the external entity is counted', async () => {
  const double = await startTakDouble();
  try {
    expect(hostile.malformed(), 'complete, so a reader can drop just this one').toMatch(/<\/event>$/);
    expect(hostile.truncated()).not.toContain('</event>');
    expect(hostile.huge().length).toBeGreaterThan(1_000_000);
    const xxe = hostile.externalEntity(double.entityUrl);
    expect(xxe).toContain(`<!ENTITY xxe SYSTEM "${double.entityUrl}">`);
    expect(xxe).toContain('<remarks>&xxe;</remarks>');
    expect(hostile.entityExpansion()).toContain('<remarks>&l9;</remarks>');
    // A reader that resolves the entity would fetch this URL; the double counts it.
    expect(double.entityRequests).toEqual([]);
    expect(await (await fetch(double.entityUrl)).text()).toBe('resolved');
    expect(double.entityRequests).toEqual(['/entity']);
  } finally {
    await double.close();
  }
});

test('the double goes away (connections reset, the port closed or new connections reset) and comes back on the same port, and records what clients write', async () => {
  const double = await startTakDouble();
  try {
    const first = await tcpClient(double.port);
    await double.waitForConnections(1);
    first.socket.write(cotEvent({ uid: 'emc2-presence', type: 't-x-c-t', lon: 0.5, lat: 0.25 }));
    await expect.poll(() => double.receivedText()).toContain('type="t-x-c-t"');

    await double.goAway();
    await first.closed;
    const refused = await tcpClient(double.port).then(
      () => 'connected',
      (error: NodeJS.ErrnoException) => error.code,
    );
    expect(refused, 'the port is closed').toBe('ECONNREFUSED');

    await double.comeBack();
    await double.goAway('reset');
    const during = await tcpClient(double.port);
    await during.closed;
    expect(double.refused.count, 'accepted and reset at once').toBe(1);
    expect(double.refused.times, 'with the time of the attempt').toHaveLength(1);

    await double.comeBack();
    const again = await tcpClient(double.port);
    await double.waitForConnections(2);
    expect(double.send({ uid: 'ita-back', lon: 18.2, lat: 59.1 })).toBe(1);
    await expect.poll(() => events(again.text()).length).toBe(1);
    again.socket.destroy();
  } finally {
    await double.close();
  }
});

test('the double streams at a steady rate over many uids', async ({}, testInfo) => {
  const double = await startTakDouble();
  try {
    const c = await tcpClient(double.port);
    await double.waitForConnections(1);
    const result = await double.stream({ rate: 1_000, uids: 500, seconds: 3 });
    // The number is exact; how close to 3 s it took depends on the machine and is only recorded.
    expect(result.sent).toBe(3_000);
    testInfo.annotations.push({ type: 'rate', description: `${Math.round(result.ratePerSecond)} events per second` });
    await expect.poll(() => events(c.text()).length).toBe(result.sent);
    const uids = new Set(events(c.text()).map((e) => /uid="([^"]+)"/.exec(e)![1]));
    expect(uids.size).toBe(500);
    c.socket.destroy();
  } finally {
    await double.close();
  }
});

test('from the command line the double prints its port and plays a script after the first connection', async () => {
  const folder = makeTempFolder('emc2-ita-tak-cli-');
  const script = join(folder, 'script.jsonl');
  writeFileSync(script, [JSON.stringify({ event: { uid: 'ita-cli', lon: 18.3, lat: 59.4, callsign: 'CLI' } }), JSON.stringify({ after: 100, hostile: 'malformed' })].join('\n'));
  const child = spawnGroup(process.execPath, [join(root, 'tests', 'integration', 'tak-double.mjs'), '--script', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout!.on('data', (chunk: Buffer) => (out += chunk.toString()));
  try {
    await expect.poll(() => /on 127\.0\.0\.1:(\d+)/.exec(out)?.[1], { timeout: 15_000 }).toBeTruthy();
    const port = Number(/on 127\.0\.0\.1:(\d+)/.exec(out)![1]);
    const c = await tcpClient(port);
    await expect.poll(() => c.text()).toContain('uid="ita-cli"');
    await expect.poll(() => out).toContain('"hostile":"malformed"');
    // The event, then the malformed one, which also ends with </event>.
    expect(events(c.text()).map((e) => /uid="([^"]+)"/.exec(e)![1])).toEqual(['ita-cli', 'ita-malformed']);
    c.socket.destroy();
  } finally {
    killTree(child.pid!);
    rmSync(folder, { recursive: true, force: true });
  }
});
