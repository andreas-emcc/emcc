// T-204 (SDK 1.8.0 parts D and F; owner UZ A and WF A): adsb's plugin.json is valid against the data model's plugin
// manifest schema and needs SDK ^1.8.0; its icon is Plane; its settings' hints pass the web SDK's settingsHintsProblem;
// every long description has a hint of at most 80 characters; the links are a table with a side form in three
// groups, named by `name`, state `enabled`. Run by `node tools/test.mjs`, or alone:
//   node --test plugins/adsb/check/manifest-settings.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Ajv 8 is a dev dependency of model/: resolve it from there, as the other plugins' manifest checks do.
const here = dirname(fileURLToPath(import.meta.url));
const model = join(here, '..', '..', '..', 'model');
const modelRequire = createRequire(join(model, 'package.json'));
const Ajv2020 = modelRequire('ajv/dist/2020.js');
const addFormats = modelRequire('ajv-formats');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

const manifest = read(join(here, '..', 'plugin.json'));
const webSdk = join(here, '..', '..', '..', 'web', 'plugin-sdk');
const sdkVersion = read(join(webSdk, 'package.json')).version;

function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, strictTuples: false, strictRequired: false, allowUnionTypes: true, allErrors: true });
  addFormats(ajv);
  for (const f of readdirSync(join(model, 'schemas')).filter((f) => f.endsWith('.json'))) ajv.addSchema(read(join(model, 'schemas', f)));
  const validate = ajv.getSchema('urn:emc2:schema:plugin-manifest');
  assert.ok(validate.schema.description.includes(`SDK ${sdkVersion} (PDA)`), `the schema is SDK ${sdkVersion}'s`);
  return validate;
}

test('T-204: the manifest is valid against the SDK\'s schema, needs SDK ^1.8.0 and has the icon Plane', async () => {
  const validate = manifestValidator();
  assert.ok(validate(manifest), JSON.stringify(validate.errors, null, 1));
  assert.equal(manifest.sdkVersion, '^1.8.0');
  assert.equal(manifest.icon, 'Plane', 'sdk-v1.md part D suggests Plane for adsb');
  const { pluginIcon, PLUGIN_ICONS } = await import(pathToFileURL(join(webSdk, 'src', 'settings-form.ts')).href);
  assert.ok(Object.hasOwn(PLUGIN_ICONS, manifest.icon) && pluginIcon(manifest.icon) !== null);
});

test('T-204: every long description has a hint of 1 to 80 characters; the settings hints pass the SDK\'s check', async () => {
  const { settingsHintsProblem } = await import(pathToFileURL(join(webSdk, 'src', 'settings-form.ts')).href);
  assert.equal(settingsHintsProblem(manifest.settings), null);
  const links = manifest.settings.properties.links;
  const checked = [['links', links], ...Object.entries(links.items.properties).map(([n, p]) => [`links.${n}`, p])];
  for (const [name, schema] of checked) {
    if (schema.description && schema.description.length > 80) {
      const hint = schema['x-emc2']?.hint;
      assert.ok(hint && hint.length >= 1 && hint.length <= 80, `${name}: a hint of at most 80 characters`);
    }
  }
});

test('T-204: the links are a table of name and state enabled, a side form in Connection, Picture and Security label', async () => {
  const { formSections, itemName, itemWords, itemColumns, isItemList } = await import(pathToFileURL(join(webSdk, 'src', 'settings-form.ts')).href);
  const links = manifest.settings.properties.links;
  assert.ok(isItemList(links));
  assert.equal(itemName(links, { name: 'dump1090-north' }, 0, true), 'dump1090-north');
  assert.deepEqual([...itemColumns(links)], ['host', 'port', 'standardIdentity']);
  assert.equal(itemWords(links).noun, 'link');
  assert.deepEqual(formSections(links.items).map((s) => s.label), [null, 'Connection', 'Picture', 'Security label']);
});
