// Tests pluginCheckFiles (tools/lib.mjs): which plugin checks tools/test.mjs runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluginCheckFiles } from './lib.mjs';

test('finds plugins/<id>/check/*.test.mjs, sorted, and nothing else', () => {
  const base = mkdtempSync(join(tmpdir(), 'emc2-checks-'));
  try {
    for (const p of ['plugins/b/check/x.test.mjs', 'plugins/a/check/y.test.mjs', 'plugins/a/check/helper.mjs',
      'plugins/a/web/z.test.mjs', 'plugins/c/check/sub/w.test.mjs']) {
      mkdirSync(join(base, p, '..'), { recursive: true });
      writeFileSync(join(base, p), '');
    }
    writeFileSync(join(base, 'plugins', 'file.txt'), '');
    assert.deepEqual(pluginCheckFiles(base), ['plugins/a/check/y.test.mjs', 'plugins/b/check/x.test.mjs']);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('no plugins folder gives no checks', () => {
  const base = mkdtempSync(join(tmpdir(), 'emc2-checks-'));
  try {
    assert.deepEqual(pluginCheckFiles(base), []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('the repository has cot\'s manifest check', () => {
  assert.ok(pluginCheckFiles().includes('plugins/cot/check/manifest-settings.test.mjs'));
});
