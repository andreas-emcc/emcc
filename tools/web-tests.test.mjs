// Tests for tools/web-tests.mjs: how a workspace's test script is split, the job count, the workspace order.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { jobCount, splitScript, workspaceDirs } from './web-tests.mjs';

test('splitScript puts the commands before the first vitest into the checks', () => {
  assert.deepEqual(splitScript('eslint . && tsc --noEmit -p . && vitest run'),
    { checks: ['eslint .', 'tsc --noEmit -p .'], tests: ['vitest run'] });
  assert.deepEqual(splitScript('eslint . && tsc -p tsconfig.app.json && tsc -p tsconfig.node.json && vitest run --configLoader runner'),
    { checks: ['eslint .', 'tsc -p tsconfig.app.json', 'tsc -p tsconfig.node.json'], tests: ['vitest run --configLoader runner'] });
  assert.deepEqual(splitScript('vitest run'), { checks: [], tests: ['vitest run'] });
});

test('splitScript keeps a script without vitest as a test run, so it never runs in parallel', () => {
  assert.deepEqual(splitScript('node --test'), { checks: [], tests: ['node --test'] });
});

test('splitScript refuses anything but a plain && chain, which then runs whole', () => {
  for (const script of ['eslint . || true', 'tsc; vitest run', 'eslint . | tee log', 'eslint . & vitest run',
    'vitest run > out.txt', 'tsc $(echo -p .)', 'tsc && vitest run && eslint .', 'tsc && && vitest run']) {
    assert.equal(splitScript(script), undefined, script);
  }
});

test('jobCount: one per processor, at most 8, unless EMC2_TEST_JOBS says otherwise', () => {
  assert.equal(jobCount({}, 8), 8);
  assert.equal(jobCount({}, 16), 8);
  assert.equal(jobCount({}, 2), 2);
  assert.equal(jobCount({}, 1), 1);
  assert.equal(jobCount({ EMC2_TEST_JOBS: '1' }, 8), 1);
  assert.equal(jobCount({ EMC2_TEST_JOBS: '6' }, 8), 6);
  assert.equal(jobCount({ EMC2_TEST_JOBS: 'many' }, 8), 8);
  assert.equal(jobCount({ EMC2_TEST_JOBS: '0' }, 8), 8);
});

test('workspaceDirs follows the workspaces in order, expanding a * sorted, and skips folders without package.json', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'emc2-ws-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['web/shell', 'plugins/*/web'] }));
  for (const p of ['web/shell', 'plugins/b/web', 'plugins/a/web', 'plugins/c']) mkdirSync(join(dir, p), { recursive: true });
  for (const p of ['web/shell', 'plugins/b/web', 'plugins/a/web']) writeFileSync(join(dir, p, 'package.json'), '{}');
  assert.deepEqual(workspaceDirs(dir), ['web/shell', 'plugins/a/web', 'plugins/b/web']);
});

test('the repository\'s own workspaces are found, the shell first', () => {
  const dirs = workspaceDirs();
  assert.equal(dirs[0], 'web/shell');
  assert.ok(dirs.includes('web/plugin-sdk'));
  assert.ok(dirs.includes('plugins/map-view-2d/web'));
});
