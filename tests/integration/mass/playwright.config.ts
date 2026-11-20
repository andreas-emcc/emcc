import { defineConfig } from '@playwright/test';

// The mass test's own config (mass/PLAN.md): only mass/run.mjs uses it, so the quick and the full run, whose config
// reads ./specs, never run the mass test. The output folder is the run's (run.mjs sets EMC2_OUT).
const out = process.env.EMC2_OUT ?? './out/mass-manual';

export default defineConfig({
  testDir: '.',
  testMatch: 'mass.spec.ts',
  outputDir: `${out}/test-results`,
  retries: 0,
  forbidOnly: true,
  fullyParallel: false,
  workers: 1,
  // The test sets its own timeout from its parameters.
  timeout: 0,
  reporter: [['list']],
  use: { trace: 'off' },
});
