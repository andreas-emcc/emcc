// Quick run: @always
import { expect, test } from '@playwright/test';
import { installOfflineGuard } from '../../fixtures';

// Proves that the offline guard used by every browser test catches requests to anything but the
// emc2 server. The hosts use the reserved .invalid domain and the local port 1 has no server, so
// nothing leaves the machine even if the guard were broken; the test still fails then, because
// nothing would be recorded.
//
// bypassCSP: once the edge sends its Content-Security-Policy (T-013), the browser itself refuses
// these requests before the guard sees them. The guard must still work without that help.
test.use({ bypassCSP: true });

test('the offline guard blocks and records every kind of request to other hosts and ports', async ({
  context,
  page,
  baseURL,
}) => {
  const blocked = await installOfflineGuard(context, baseURL!);
  await page.goto('/');

  await page.evaluate(async () => {
    await fetch('https://fetch.example.invalid/data.json').catch(() => undefined);
    await fetch('http://127.0.0.1:1/other-port').catch(() => undefined);
    const image = new Image();
    image.src = 'https://image.example.invalid/tile.png';
    await new FontFace('ita-font', 'url(https://font.example.invalid/font.woff2)').load().catch(() => undefined);
    new EventSource('https://events.example.invalid/stream');
    new WebSocket('wss://socket.example.invalid/live');
    const worker = new Blob(["fetch('https://worker.example.invalid/data.json').catch(() => undefined);"], {
      type: 'text/javascript',
    });
    new Worker(URL.createObjectURL(worker));
  });

  await expect
    .poll(() => [...blocked].sort())
    .toEqual([
      'http://127.0.0.1:1/other-port',
      'https://events.example.invalid/stream',
      'https://fetch.example.invalid/data.json',
      'https://font.example.invalid/font.woff2',
      'https://image.example.invalid/tile.png',
      'https://worker.example.invalid/data.json',
      'wss://socket.example.invalid/live',
    ]);
});

test('the offline guard lets requests to the emc2 server through', async ({ context, page, baseURL }) => {
  const blocked = await installOfflineGuard(context, baseURL!);
  await page.goto('/');
  const status = await page.evaluate(async () => (await fetch('/api/health')).status);
  expect(status).toBe(200);
  expect(blocked).toEqual([]);
});
