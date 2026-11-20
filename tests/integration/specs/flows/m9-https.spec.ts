// Quick run: @settings @harness
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/flows/m9-https.spec.ts
import { expect, test } from '@playwright/test';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { connect, type PeerCertificate } from 'node:tls';
import { stopOwnServer, withOwnServers, type OwnServer } from '../../lib/own-server';
import { emccFolderOf } from '../../lib/server.mjs';
import { renewPem, serverCertificate, testCaMissing, TEST_CA_PEM, writeHttpsSettings } from '../../lib/test-ca.mjs';

// HTTPS on the server (M9 T1; ADR-0061, the CDA's C2; server/README.md, "HTTPS"): servers of the test's own,
// each with a certificate of the ESA's test CA (external/test-ca/, E1) in its emcc folder's
// settings/credentials/https.properties, as an admin puts it there. The test processes trust only that CA
// (run.mjs: NODE_EXTRA_CA_CERTS); the browser ignores the certificate (it does not know the CA), which leaves
// what is checked here (the scheme, the cookie's and the socket's) unchanged. Login over HTTPS is
// specs/keycloak/https-login.spec.ts.

test.skip(testCaMissing() !== undefined, testCaMissing() ?? '');
test.describe.configure({ timeout: 180_000 });

/** A free TCP port on loopback, for the redirect port. */
async function freeTcpPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** A new TLS connection's certificate and protocol (no session reuse), with the test CA as the only trust. */
async function handshake(port: number, options: { maxVersion?: 'TLSv1.2' | 'TLSv1.3' } = {}): Promise<{ certificate: PeerCertificate; protocol: string | null }> {
  const { readFileSync } = await import('node:fs');
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port, servername: 'localhost', ca: readFileSync(TEST_CA_PEM), ...options }, () => {
      const answer = { certificate: socket.getPeerCertificate(), protocol: socket.getProtocol() };
      socket.end();
      resolve(answer);
    });
    socket.setTimeout(10_000, () => socket.destroy(new Error('no TLS handshake within 10 s')));
    socket.once('error', reject);
  });
}

/** A plain HTTP GET with a Host of the test's choosing (fetch does not let one set it). */
function plainGet(port: number, path: string, host: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, headers: { Host: host } }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, headers: res.headers });
    });
    req.setTimeout(10_000, () => req.destroy(new Error('no answer within 10 s')));
    req.once('error', reject);
    req.end();
  });
}

async function monitorHttps(server: OwnServer) {
  const answer = await (await fetch(`${server.baseUrl}/api/monitor`)).json();
  return answer.https as { subject: string; issuer: string; notAfterMillis: number; state: string } | null;
}

test('HTTPS from a PKCS#12 bundle (ADR-0061 points 1 to 6; T1): the server port speaks TLS 1.3 and 1.2 only, with the test CA\'s certificate, and plain HTTP there gets no answer of the app; HSTS is max-age=31536000 without includeSubDomains; the redirect port answers 307 to https:// on the same host and the HTTPS port, with path and query, and never to a host the request names but the Host check refuses; the Monitor shows the certificate as valid; a browser\'s page loads over https:// and its live picture runs over wss:// on the same port; the dev stop works over HTTPS', async ({ browser }, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    writeHttpsSettings(emccFolderOf(folders.dataDir), 'emcc-server', 'pkcs12');
    const redirectPort = await freeTcpPort();
    // A fixed port: with port 0 the redirect names "HTTPS on port 0" (the server logs so; reported to the CDA).
    const server = await start([`--emc2.https.redirect-port=${redirectPort}`], { https: true, port: await freeTcpPort() });
    const cert = serverCertificate('emcc-server');

    // TLS: 1.3 by default, 1.2 when the client offers no more; the test CA's emcc-server.
    const tls13 = await handshake(server.port);
    expect(tls13.protocol, 'TLS 1.3').toBe('TLSv1.3');
    expect(tls13.certificate.serialNumber.toUpperCase(), 'the test CA\'s emcc-server').toBe(cert.serial.toUpperCase());
    expect((await handshake(server.port, { maxVersion: 'TLSv1.2' })).protocol, 'TLS 1.2').toBe('TLSv1.2');
    const health = await fetch(`${server.baseUrl}/api/health`);
    expect(health.status, 'health over HTTPS').toBe(200);

    // Point 4: one port; plain HTTP there is not served by the app.
    const plain = await plainGet(server.port, '/api/health', `127.0.0.1:${server.port}`).catch((error: Error) => ({ status: -1, headers: {}, error: error.message }));
    testInfo.annotations.push({ type: 'plain HTTP on the HTTPS port', description: JSON.stringify(plain) });
    expect(plain.status, 'plain HTTP on the HTTPS port: no app answer').not.toBe(200);

    // Point 5: HSTS over HTTPS, this host only, a year by default.
    expect(health.headers.get('strict-transport-security'), 'HSTS').toBe('max-age=31536000');

    // Point 4: the redirect port, 307 to the HTTPS port on the same host, path and query kept.
    const redirected = await plainGet(redirectPort, '/api/health?a=1&b=two', `localhost:${redirectPort}`);
    expect(redirected.status, 'the redirect port: 307').toBe(307);
    expect(redirected.headers.location, 'to https:// on the same host and the HTTPS port').toBe(`https://localhost:${server.port}/api/health?a=1&b=two`);
    expect(redirected.headers['strict-transport-security'], 'no HSTS over plain HTTP').toBeUndefined();
    const byIp = await plainGet(redirectPort, '/', `127.0.0.1:${redirectPort}`);
    expect([byIp.status, byIp.headers.location], 'by its address').toEqual([307, `https://127.0.0.1:${server.port}/`]);
    const foreign = await plainGet(redirectPort, '/x', 'evil.example');
    testInfo.annotations.push({ type: 'the redirect port with a foreign Host', description: JSON.stringify({ status: foreign.status, location: foreign.headers.location }) });
    expect(foreign.status, 'a foreign Host: refused by the Host check').toBe(403);
    expect(String(foreign.headers.location ?? ''), 'never to the request\'s host').not.toContain('evil.example');

    // Point 6: the Monitor's certificate.
    const https = await monitorHttps(server);
    testInfo.annotations.push({ type: 'the Monitor\'s https', description: JSON.stringify(https) });
    expect(https, 'the Monitor\'s https').toMatchObject({ state: 'valid', notAfterMillis: Date.parse(cert.notAfter) });
    expect(https!.subject, 'the subject').toContain('CN=localhost');
    expect(https!.issuer, 'the issuer').toContain('CN=emc2 Test CA');

    // A browser: the page and its requests over https://, the live picture over wss:// on the same port.
    const context = await browser.newContext({ baseURL: server.baseUrl, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      const sockets: string[] = [];
      const requests: string[] = [];
      page.on('websocket', (socket) => sockets.push(socket.url()));
      page.on('request', (r) => requests.push(r.url()));
      await page.goto('/');
      await expect(page.getByRole('status', { name: 'Live picture', includeHidden: true })).toHaveText('Live picture: connected', { timeout: 60_000 });
      testInfo.annotations.push({ type: 'web sockets', description: sockets.join(', ') });
      expect(sockets.length, 'the live picture\'s socket').toBeGreaterThan(0);
      expect(sockets.filter((u) => !u.startsWith(`wss://127.0.0.1:${server.port}/`)), 'every socket over wss:// on the HTTPS port').toEqual([]);
      expect(requests.filter((u) => !u.startsWith(`${server.baseUrl}/`) && !u.startsWith('data:') && !u.startsWith('blob:')), 'every request over https:// to the server').toEqual([]);
    } finally {
      await context.close();
    }
    await stopOwnServer(server);
  });
});

test('PEM with an encrypted key, a certificate that expires soon and a shorter HSTS (ADR-0061 points 2, 5 and 6; T1): the server starts from the chain and the encrypted key with its password; the Monitor marks the certificate soon, with its end; emc2.https.hsts-max-age=60 sends max-age=60', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    writeHttpsSettings(emccFolderOf(folders.dataDir), 'emcc-server-expiring', 'pem-encrypted');
    const server = await start(['--emc2.https.hsts-max-age=60'], { https: true });
    const cert = serverCertificate('emcc-server-expiring');
    expect((await handshake(server.port)).certificate.serialNumber.toUpperCase(), 'the expiring certificate').toBe(cert.serial.toUpperCase());
    expect((await fetch(`${server.baseUrl}/api/health`)).headers.get('strict-transport-security'), 'HSTS 60 s').toBe('max-age=60');
    const https = await monitorHttps(server);
    testInfo.annotations.push({ type: 'the Monitor\'s https', description: JSON.stringify(https) });
    expect(https, 'within 30 days of its end: soon').toMatchObject({ state: 'soon', notAfterMillis: Date.parse(cert.notAfter) });
    await stopOwnServer(server);
  });
});

test('a renewed certificate applies without a restart (ADR-0061 point 6, the owner\'s C2; T1): with the PEM chain and key replaced by another certificate\'s, a new connection gets the new one within about 10 s, the Monitor shows its end, and the server is the same process; emc2.https.hsts-max-age=0 sends no HSTS', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    const emcc = emccFolderOf(folders.dataDir);
    writeHttpsSettings(emcc, 'emcc-server', 'pem');
    const server = await start(['--emc2.https.hsts-max-age=0'], { https: true });
    const before = serverCertificate('emcc-server');
    const after = serverCertificate('emcc-server-expiring');
    expect((await fetch(`${server.baseUrl}/api/health`)).headers.get('strict-transport-security'), 'no HSTS with 0').toBeNull();
    expect((await handshake(server.port)).certificate.serialNumber.toUpperCase(), 'the first certificate').toBe(before.serial.toUpperCase());
    const uptime = async () => (await (await fetch(`${server.baseUrl}/api/monitor`)).json()).core.uptimeSeconds as number;
    const upBefore = await uptime();

    renewPem(emcc, 'emcc-server-expiring');
    const renewed = Date.now();
    await expect
      .poll(async () => (await handshake(server.port)).certificate.serialNumber.toUpperCase(), { timeout: 30_000, intervals: [250], message: 'the renewed certificate on a new connection' })
      .toBe(after.serial.toUpperCase());
    const tookMs = Date.now() - renewed;
    testInfo.annotations.push({ type: 'the renewed certificate taken after', description: `${tookMs} ms` });
    expect(tookMs, 'in about 10 s').toBeLessThanOrEqual(15_000);
    expect(await monitorHttps(server), 'the Monitor: the new end').toMatchObject({ state: 'soon', notAfterMillis: Date.parse(after.notAfter) });
    expect(server.exitCode, 'no restart: the same process').toBeNull();
    expect(await uptime(), 'no restart: ECore\'s uptime goes on').toBeGreaterThanOrEqual(upBefore);
    await stopOwnServer(server, { expectedLog: [] });
  });
});

test('what stops the start (ADR-0061 points 1 and 4; server/README.md, "HTTPS"): a bundle whose password is wrong (no fallback to plain HTTP), and a redirect port without HTTPS', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    const settings = writeHttpsSettings(emccFolderOf(folders.dataDir), 'emcc-server', 'pkcs12');
    const { readFileSync, writeFileSync, rmSync } = await import('node:fs');
    writeFileSync(settings, readFileSync(settings, 'utf8').replace(/keystore\.password=.*/, 'keystore.password=not-the-password'));
    // A start that fails is not counted, so each writes server-1.log: read after each.
    const log = () => readFileSync(testInfo.outputPath('server-1.log'), 'utf8');
    await expect(start([], { https: true }), 'a wrong password stops the start').rejects.toThrow(/exited during start-up/);
    const logs = [log()];
    rmSync(settings);
    await expect(start([`--emc2.https.redirect-port=${await freeTcpPort()}`]), 'a redirect port without HTTPS stops the start').rejects.toThrow(/exited during start-up/);
    logs.push(log());
    testInfo.annotations.push({ type: 'why', description: logs.map((l) => (l.match(/^.*(?:APPLICATION FAILED TO START|Caused by|IllegalStateException|redirect-port).*$/m) ?? [''])[0].slice(0, 300)).join(' | ') });
    expect(logs[1], 'the second log names the setting').toContain('emc2.https.redirect-port');
  });
});
