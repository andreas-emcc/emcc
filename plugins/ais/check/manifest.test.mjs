// The ais manifest's settings hints and icon (T-204, SDK 1.8.0 part D; owner UZ A), checked by the web SDK's own functions.
// Run by `node tools/test.mjs`, or alone: node --test plugins/ais/check/manifest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, '..', 'plugin.json'), 'utf8'));
const webSdk = join(here, '..', '..', '..', 'web', 'plugin-sdk');

test('T-204: the hints pass the SDK\'s check; a link\'s form in Connection, Picture, Classification and Advanced; the icon Ship', async () => {
  const { settingsHintsProblem, formSections, itemWords, itemName, itemColumns, fieldHint, pluginIcon, PLUGIN_ICONS } =
    await import(pathToFileURL(join(webSdk, 'src', 'settings-form.ts')).href);
  assert.equal(manifest.sdkVersion, '^1.8.0');
  assert.equal(settingsHintsProblem(manifest.settings), null);
  assert.equal(manifest.icon, 'Ship', 'sdk-v1.md part D suggests Ship for ais');
  assert.ok(Object.hasOwn(PLUGIN_ICONS, manifest.icon) && pluginIcon(manifest.icon) !== null);

  const links = manifest.settings.properties.links;
  assert.deepEqual(formSections(links.items).map((s) => [s.label, s.folded]),
    [[null, false], ['Connection', false], ['Picture', false], ['Classification', false], ['Advanced', true]]);
  assert.deepEqual(formSections(links.items)[0].properties, ['name', 'mode', 'direction', 'enabled'], 'the free fields, unheaded');
  const grouped = formSections(links.items).flatMap((s) => s.properties);
  assert.deepEqual([...grouped].sort(), Object.keys(links.items.properties).sort(), 'every field of a link in one section');
  assert.deepEqual(itemWords(links), { noun: 'link', add: 'Add link', remove: 'Delete link?', fresh: 'New link' });
  assert.equal(itemName(links, { name: 'harbour-north' }, 0, true), 'harbour-north');
  assert.equal(itemName(links, {}, 2, true), 'Link 3');
  assert.deepEqual(itemColumns(links), ['mode', 'host', 'port', 'symbolType']);
  assert.equal(links['x-emc2'].item.state, 'enabled');

  const walk = (schema, path) => {
    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      const { hint } = fieldHint(property);
      if ((property.description ?? '').length > 80) assert.ok(hint !== null && hint.length <= 80, `${path}${name}: a long description has a short hint`);
      if (property.properties !== undefined) walk(property, `${path}${name}.`);
      if (property.items?.properties !== undefined) walk(property.items, `${path}${name}[].`);
    }
  };
  walk(manifest.settings, '');
  assert.equal(links.items.properties.idleSeconds['x-emc2'].unit, 's');
});
