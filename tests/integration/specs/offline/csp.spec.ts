// Quick run: @always
import { expect, test as base } from '@playwright/test';
import { test } from '../../fixtures';

// Overview 4.5 and ADR-0014: the edge serves the web client with a Content-Security-Policy that
// allows only the emc2 server (T-013; server/README.md "Edge: headers, caching, compression").

base('the web client is served with a Content-Security-Policy that allows only the emc2 server', async ({
  request,
}) => {
  const policy = (await request.get('/')).headers()['content-security-policy'] ?? '';
  for (const directive of [
    "default-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ]) {
    expect(policy).toContain(directive);
  }
  expect(policy).not.toMatch(/https?:\/\/|\*/);
});

test("under the policy, a page can open the live picture WebSocket (connect-src 'self' covers ws:)", async ({
  page,
}) => {
  await page.goto('/');
  const welcome = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const socket = new WebSocket(`ws://${location.host}/api/live`);
        socket.onmessage = (event) => {
          resolve(String(event.data));
          socket.close();
        };
        socket.onerror = () => reject(new Error('WebSocket failed'));
      }),
  );
  // SDK 1.4.0 part 4 adds the browser's session for the user's time (ADR-0045): a non-empty string, nothing else new.
  expect(JSON.parse(welcome)).toEqual({ type: 'welcome', protocol: 2, session: expect.stringMatching(/\S/) });
});

// The browser itself refuses requests to other hosts, before they reach the network. This uses
// the plain test (no offline guard), because the refusal is logged as a console error.
base('the policy makes the browser refuse a request to another host', async ({ page }) => {
  await page.goto('/');
  const violation = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        document.addEventListener('securitypolicyviolation', (event) => resolve(event.effectiveDirective), {
          once: true,
        });
        fetch('https://refused.example.invalid/data.json').catch(() => undefined);
      }),
  );
  expect(violation).toBe('connect-src');
});
