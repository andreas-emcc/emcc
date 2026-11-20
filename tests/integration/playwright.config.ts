import { defineConfig, devices } from '@playwright/test';

// The server is started by run.mjs, which passes its address. To run the tests against a server
// you started yourself: EMC2_BASE_URL=http://127.0.0.1:8080 npx playwright test
const baseURL = process.env.EMC2_BASE_URL ?? 'http://127.0.0.1:8080';
// The run's own output folder (run.mjs); runs started by hand write into out/manual.
const out = process.env.EMC2_OUT ?? './out/manual';
// The performance suite measures for many minutes and runs only on request (run.mjs --performance).
const performance = process.env.EMC2_PERFORMANCE === '1';

export default defineConfig({
  testDir: performance ? './specs/performance' : './specs',
  testIgnore: performance ? [] : ['**/performance/**'],
  outputDir: `${out}/test-results`,
  // A flaky test is a bug in the test (agents/ita.md): never retry.
  retries: 0,
  forbidOnly: true,
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [['list'], ['html', { outputFolder: `${out}/report`, open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
