// Criterion 46 (M7, T-156): the manifest validates against the 1.6.0 manifest schema with its palette "CoT" (one palette, one symbol per
// row of the closed APP-6D and APP-6E table, in its order), and the palette is what generate-palette.mjs writes from the table (labels
// with mil-sym-ts's entity names included). The Java PaletteTest checks the codes against the codec.
// Run by `node tools/test.mjs` (plugins/*/check/*.test.mjs), or alone: node --test plugins/cot/check/palette.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOf, label, palette, tableRows, typeOf } from '../generate-palette.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const modelRequire = createRequire(join(here, '..', '..', '..', 'model', 'package.json'));
const Ajv2020 = modelRequire('ajv/dist/2020.js');
const addFormats = modelRequire('ajv-formats');

const manifest = JSON.parse(readFileSync(join(here, '..', 'plugin.json'), 'utf8'));
const schemaFolder = join(here, '..', '..', '..', 'model', 'schemas');
const schemas = readdirSync(schemaFolder).filter((f) => f.endsWith('.schema.json')).map((f) => JSON.parse(readFileSync(join(schemaFolder, f), 'utf8')));

test('the manifest validates against the 1.6.0 manifest schema', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  schemas.forEach((s) => ajv.addSchema(s));
  const validate = ajv.getSchema('urn:emc2:schema:plugin-manifest');
  assert.ok(validate, 'the manifest schema is loaded');
  assert.ok(validate(manifest), JSON.stringify(validate.errors?.slice(0, 3)));
});

test('the palette "CoT" has one symbol per row of the table, in its order, with the identity friend', () => {
  assert.equal(manifest.symbolPalettes.length, 1);
  const cot = manifest.symbolPalettes[0];
  assert.equal(cot.id, 'cot');
  assert.equal(cot.name, 'CoT');
  const rows = tableRows();
  assert.equal(rows.length, 147);
  assert.deepEqual(cot.symbols.map((s) => s.code), rows.map((r) => codeOf(r.key)));
  assert.ok(cot.symbols.every((s) => s.standard === 'APP-6D' && s.code.startsWith('1003')));
  cot.symbols.forEach((s, i) => assert.ok(s.label.startsWith(typeOf(rows[i].cot)), `${s.code}: ${s.label}`));
});

test('the palette is what the generator writes (names from mil-sym-ts), and a label stays within the schema limit', async () => {
  assert.deepEqual(manifest.symbolPalettes[0].symbols, await palette());
  assert.ok(manifest.symbolPalettes[0].symbols.every((s) => s.label.length >= 1 && s.label.length <= 128));
  assert.equal(label('G-U', undefined), 'G-U');
  assert.ok(label('A-M-F-Q', 'a / b / ' + 'x'.repeat(130)).length <= 128);
});

test('removing one row from the manifest only makes the check fail', async () => {
  const symbols = manifest.symbolPalettes[0].symbols.filter((_, i) => i !== 5);
  assert.notDeepEqual(symbols, await palette());
});
