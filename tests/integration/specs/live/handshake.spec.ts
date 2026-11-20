// Quick run: @always @live
import { expect, test } from '@playwright/test';
import { handshakeStatus, statusWithHost } from '../../lib/live.mjs';

// Who may connect to /api/live, and the Host check on every request (server/live-picture-protocol.md,
// server/README.md "Host check"; against DNS rebinding and other sites' pages).

test.describe('the live picture handshake', () => {
  test('a client without Origin (a script, not a browser) may connect', async ({ baseURL }) => {
    expect(await handshakeStatus(baseURL!)).toBe(101);
  });

  test("a browser on the server's own origin may connect", async ({ baseURL }) => {
    expect(await handshakeStatus(baseURL!, { Origin: baseURL! })).toBe(101);
  });

  test('localhost on the right port is accepted as Host', async ({ baseURL }) => {
    const { port } = new URL(baseURL!);
    expect(await handshakeStatus(baseURL!, { Host: `localhost:${port}` })).toBe(101);
  });

  for (const [what, origin] of [
    ['Origin null (sandboxed frame, local file)', () => 'null'],
    ['another site', () => 'http://evil.example'],
    ['another port on this machine', (port: string) => `http://127.0.0.1:${Number(port) + 1}`],
    ['another scheme', (port: string) => `https://127.0.0.1:${port}`],
  ] as const) {
    test(`a browser from ${what} is refused with 403`, async ({ baseURL }) => {
      const { port } = new URL(baseURL!);
      expect(await handshakeStatus(baseURL!, { Origin: origin(port) })).toBe(403);
    });
  }

  for (const [what, host] of [
    ['another name (DNS rebinding)', (port: string) => `evil.example:${port}`],
    ['another port', (port: string) => `127.0.0.1:${Number(port) + 1}`],
  ] as const) {
    test(`a Host header naming ${what} is refused with 403`, async ({ baseURL }) => {
      const { port } = new URL(baseURL!);
      expect(await handshakeStatus(baseURL!, { Host: host(port) })).toBe(403);
    });
  }
});

test.describe('the Host check on every request', () => {
  test('API requests under another name are refused with 403, under 127.0.0.1 and localhost they pass', async ({
    baseURL,
  }) => {
    const { port } = new URL(baseURL!);
    for (const path of ['/api/health', '/api/plugins']) {
      expect(await statusWithHost(baseURL!, path, `evil.example:${port}`), path).toBe(403);
      expect(await statusWithHost(baseURL!, path, `127.0.0.1:${port}`), path).toBe(200);
      expect(await statusWithHost(baseURL!, path, `localhost:${port}`), path).toBe(200);
    }
  });

  test('the stop endpoint under another name is refused and the server keeps running', async ({ baseURL }) => {
    const { port } = new URL(baseURL!);
    expect(await statusWithHost(baseURL!, '/api/dev/stop', `evil.example:${port}`, 'POST')).toBe(403);
    expect(await statusWithHost(baseURL!, '/api/health', `127.0.0.1:${port}`)).toBe(200);
  });

  test("the web client's files under another name are refused with 403, under 127.0.0.1 and localhost they are served", async ({
    baseURL,
  }) => {
    const { port } = new URL(baseURL!);
    // The page itself, and a path a router might treat differently from /api (a path parameter).
    for (const path of ['/', '/index.html', '/api;x/health']) {
      expect(await statusWithHost(baseURL!, path, `evil.example:${port}`), path).toBe(403);
      expect(await statusWithHost(baseURL!, path, 'evil.example'), `${path} without a port`).toBe(403);
    }
    for (const path of ['/', '/index.html']) {
      expect(await statusWithHost(baseURL!, path, `127.0.0.1:${port}`), path).toBe(200);
      expect(await statusWithHost(baseURL!, path, `localhost:${port}`), path).toBe(200);
    }
  });
});
