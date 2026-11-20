import { test as base, expect, type BrowserContext } from '@playwright/test';
import { expandWhenCollapsed } from './lib/collapsed';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

const NETWORK_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:']);

/**
 * True for a network request to anything but the emc2 server under test: another host, or
 * another port on this machine (ADR-0014; the CSP of overview 4.5 allows only 'self').
 * The server is identified by its loopback port, so HTTP and WebSocket requests to it both pass.
 */
export function isExternal(url: URL, server: URL): boolean {
  if (!NETWORK_SCHEMES.has(url.protocol)) return false;
  return !(LOOPBACK_HOSTS.has(url.hostname) && portOf(url) === portOf(server));
}

function portOf(url: URL): string {
  if (url.port !== '') return url.port;
  return url.protocol === 'https:' || url.protocol === 'wss:' ? '443' : '80';
}

/**
 * Blocks every request to anything but the emc2 server that pages and dedicated workers of the
 * context make (HTTP of every kind, including fonts and EventSource, and WebSocket), and records
 * it. Returns the live list of blocked URLs. Requests the browser makes on its own (updates,
 * telemetry) are not the application's and are not seen; service workers are blocked by the
 * configuration.
 */
export async function installOfflineGuard(context: BrowserContext, serverUrl: string): Promise<string[]> {
  const server = new URL(serverUrl);
  const external = (url: URL) => isExternal(url, server);
  const blocked: string[] = [];
  await context.route(external, async (route) => {
    blocked.push(route.request().url());
    await route.abort('blockedbyclient');
  });
  await context.routeWebSocket(external, async (ws) => {
    blocked.push(ws.url());
    await ws.close();
  });
  return blocked;
}

/**
 * The test fixture for every browser test. It fails the test when
 * - a page made a request to anything but the emc2 server (offline suite, ADR-0014), or
 * - a page logged a console error or threw an uncaught exception (smoke suite).
 */
export const test = base.extend<{ offlineGuard: string[]; browserErrors: string[] }>({
  offlineGuard: [
    async ({ context, baseURL }, use) => {
      const blocked = await installOfflineGuard(context, baseURL!);
      await use(blocked);
      expect(blocked, 'requests to anything but the emc2 server (ADR-0014)').toEqual([]);
    },
    { auto: true },
  ],
  browserErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') {
          const { url, lineNumber } = message.location();
          errors.push(`console.error: ${message.text()} (${url}:${lineNumber})`);
        }
      });
      page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
      await expandWhenCollapsed(page); // side panels and settings entries start collapsed (T-153, T-161)
      await use(errors);
      expect(errors, 'browser console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
