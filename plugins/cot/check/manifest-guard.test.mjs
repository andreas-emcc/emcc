// The manifest guard (SDK 1.9.0, CR-0048 point 1; ADR-0060 point 2; X1, CR-0054): the template's three checks,
// as a Node test, since cot has no web part. The manifest is valid against the data model's schema, every setting
// the form shows has a title and a description, every group a description, and the x-emc2 hints have the shape the
// SDK documents. ECore and the shell do not check the texts, so this test is where a missing one is found.
// Run by `node tools/test.mjs`, or alone: node --test plugins/cot/check/manifest-guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, '..', 'plugin.json'), 'utf8'));
const webSdk = join(here, '..', '..', '..', 'web', 'plugin-sdk', 'src');

test('the manifest is valid against the plugin manifest schema', async () => {
  const { manifestProblem } = await import(pathToFileURL(join(webSdk, 'build', 'manifest.ts')).href);
  assert.equal(manifestProblem(manifest), null);
});

test('the manifest explains every setting and group (the texts rule)', async () => {
  const { settingsTextProblem } = await import(pathToFileURL(join(webSdk, 'settings-form.ts')).href);
  assert.equal(settingsTextProblem(manifest.settings), null);
});

test('the manifest has well-formed settings hints', async () => {
  const { settingsHintsProblem } = await import(pathToFileURL(join(webSdk, 'settings-form.ts')).href);
  assert.equal(settingsHintsProblem(manifest.settings), null);
});
