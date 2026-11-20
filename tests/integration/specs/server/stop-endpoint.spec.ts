// Quick run: @always
import { expect, test } from '@playwright/test';

// The development stop endpoint (server/README.md) refuses what it must refuse, and the server
// keeps running. The accepted POST is used by every run to stop the server (run.mjs).

test('GET on the stop endpoint answers 405 and the server keeps running', async ({ request }) => {
  const response = await request.get('/api/dev/stop');
  expect(response.status()).toBe(405);
  expect((await request.get('/api/health')).status()).toBe(200);
});

test('POST with an Origin header answers 403 and the server keeps running', async ({ request, baseURL }) => {
  const response = await request.post('/api/dev/stop', { headers: { Origin: baseURL! } });
  expect(response.status()).toBe(403);
  expect(await (await request.get('/api/health')).json()).toMatchObject({ status: 'UP', ecore: 'RUNNING' }); // and since M9 RC2 version and manual (the help menu)
});
