// Quick run: @always
import { expect, test } from '@playwright/test';

// Smoke: the server started and ECore runs (server/README.md, GET /api/health).

test('health reports the server UP and ECore RUNNING', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'UP', ecore: 'RUNNING' }); // and since M9 RC2 version and manual (the help menu)
});

test('an unknown path answers 404, not a server error', async ({ request }) => {
  const response = await request.get('/no-such-path-ita');
  expect(response.status()).toBe(404);
});
