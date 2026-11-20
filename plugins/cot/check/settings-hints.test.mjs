// T-204 (M8; SDK 1.8.0 parts C, D and F; owner UZ A, WF A): the settings form's hints and the manifest's icon, as the CDA's test case names them
// for cot's links: the SDK's own check (settingsHintsProblem) finds nothing; a link's side form is in the groups Connection, Layers,
// Classification and Sending; the list names a link by its name, with the state `enabled`, four columns and a stable id (`item.id`); every long
// description has a hint of at most 80 characters; the page's other settings are in Connections and a folded Advanced; the icon is Radio.
// Run by `node tools/test.mjs` (plugins/*/check/*.test.mjs), or alone: node --test plugins/cot/check/settings-hints.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, '..', 'plugin.json'), 'utf8'));
const webSdk = join(here, '..', '..', '..', 'web', 'plugin-sdk');
const settingsForm = () => import(pathToFileURL(join(webSdk, 'src', 'settings-form.ts')).href);
const links = manifest.settings.properties.links;

test('T-204: the manifest needs SDK 1.9.0, has the icon Radio, and the SDK\'s check finds nothing in the settings', async () => {
  const { settingsHintsProblem, pluginIcon, PLUGIN_ICONS } = await settingsForm();
  assert.equal(manifest.sdkVersion, '^1.9.0');
  assert.equal(manifest.icon, 'Radio', 'sdk-v1.md part D suggests Radio for cot');
  assert.ok(Object.hasOwn(PLUGIN_ICONS, manifest.icon) && pluginIcon(manifest.icon) !== null);
  assert.equal(settingsHintsProblem(manifest.settings), null);
});

test('T-204: a link\'s side form is in Connection, Layers, Classification and Sending, without its id', async () => {
  const { formSections } = await settingsForm();
  const sections = formSections(links.items, links);
  assert.deepEqual(sections.map((s) => [s.label, s.folded]), [[null, false], ['Connection', false], ['Layers', false], ['Classification', false], ['Sending', false]]);
  assert.deepEqual(sections[0].properties, ['name', 'transport', 'direction', 'enabled'], 'the free fields, unheaded, and not the id');
  const shown = sections.flatMap((s) => s.properties);
  assert.deepEqual([...shown].sort(), Object.keys(links.items.properties).filter((k) => k !== 'id').sort(), 'every other field of a link in one section');
  assert.deepEqual(formSections(links.items).flatMap((s) => s.properties).includes('id'), true, 'without the list, nothing is left out');
});

test('T-204: the page has the links first, then Connections and a folded Advanced', async () => {
  const { formSections } = await settingsForm();
  const sections = formSections(manifest.settings);
  assert.deepEqual(sections.map((s) => [s.label, s.folded]), [[null, false], ['Connections', false], ['Advanced', true]]);
  assert.deepEqual(sections[0].properties, ['links']);
  assert.deepEqual(sections[1].properties, ['idleTimeoutSeconds', 'writeStallSeconds', 'sendPresence', 'presenceCallsign']);
  assert.deepEqual(sections[2].properties, ['maxEventBytes']);
});

test('T-204 and part F: the list\'s words, name, state, columns and the stable id of a link', async () => {
  const { itemWords, itemName, itemColumns, itemId, isItemList } = await settingsForm();
  assert.ok(isItemList(links));
  assert.deepEqual(itemWords(links), { noun: 'link', add: 'Add link', remove: 'Delete link?', fresh: 'New link' });
  assert.equal(itemName(links, { name: 'tak-north' }, 0, true), 'tak-north');
  assert.equal(itemName(links, {}, 2, true), 'Link 3');
  assert.deepEqual(itemColumns(links), ['direction', 'transport', 'host', 'port']);
  assert.equal(links['x-emc2'].item.state, 'enabled');
  const id = '0195c0a0-7b3e-7c1d-8f2a-5b6c7d8e9f10';
  assert.equal(itemId(links, { id, name: 'tak-north' }), id);
  assert.equal(itemId(links, { name: 'tak-north' }), null, 'ECore fills a missing one in');
  const property = links.items.properties.id;
  assert.equal(property.type, 'string');
  assert.equal(property.readOnly, true);
  assert.ok(!(links.items.required ?? []).includes('id'), 'a link of an earlier version has none until ECore gives it one');
});

test('T-204: the source layers are a list of named layers', () => {
  assert.deepEqual(links.items.properties.sourceLayers['x-emc2'].item, { name: 'name', noun: 'layer' });
});

test('T-204: every long description has a hint of at most 80 characters, the numbers have their units, and the long lists no empty group', async () => {
  const { fieldHint, fieldWidth } = await settingsForm();
  const hints = [];
  const walk = (schema, path) => {
    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      const { hint } = fieldHint(property);
      if ((property.description ?? '').length > 80) assert.ok(hint !== null, `${path}${name}: a long description has a hint`);
      if (hint !== null) hints.push(`${path}${name}`);
      if (hint !== null) assert.ok(hint.length <= 80, `${path}${name}: ${hint.length} characters`);
      if (property.properties !== undefined) walk(property, `${path}${name}.`);
      if (property.items?.properties !== undefined) walk(property.items, `${path}${name}[].`);
    }
  };
  walk(manifest.settings, '');
  assert.ok(hints.length >= 20, `${hints.length} hints`);
  const link = links.items.properties;
  const page = manifest.settings.properties;
  assert.equal(link.staleSeconds['x-emc2'].unit, 's');
  assert.equal(link.refreshSeconds['x-emc2'].unit, 's');
  assert.equal(page.idleTimeoutSeconds['x-emc2'].unit, 's');
  assert.equal(page.writeStallSeconds['x-emc2'].unit, 's');
  assert.equal(page.maxEventBytes['x-emc2'].unit, 'bytes');
  assert.equal(fieldWidth(link.port), 'short');
  assert.equal(fieldWidth(page.presenceCallsign), 'short');
  assert.equal(fieldWidth(link.host), 'full');
  for (const group of [...links.items['x-emc2'].groups, ...manifest.settings['x-emc2'].groups]) {
    const owner = links.items['x-emc2'].groups.includes(group) ? links.items : manifest.settings;
    for (const name of group.properties) assert.ok(name in owner.properties, `${group.id}: ${name}`);
  }
});

test('K1 (M9, brief function 33, criterion 47): links[].tlsCredential is a tls-credential string, greyed unless tls, in Connection after port', async () => {
  const { settingsHintsProblem, settingsTextProblem, formSections } = await settingsForm();
  const field = links.items.properties.tlsCredential;
  assert.equal(field.type, 'string');
  assert.equal(field.default, '');
  assert.equal(field.title, 'TLS credential');
  assert.equal(field['x-emc2'].kind, 'tls-credential');
  assert.deepEqual(field['x-emc2'].enabledWhen, { property: 'transport', in: ['tls'] });
  for (const rule of ['enum', 'pattern']) assert.ok(!(rule in field), `the kind's rule: no ${rule}`);
  assert.ok(field['x-emc2'].hint.length <= 80);
  const connection = links.items['x-emc2'].groups.find((g) => g.id === 'connection');
  assert.deepEqual(connection.properties.slice(0, 3), ['host', 'port', 'tlsCredential']);
  assert.ok(!(links.items.required ?? []).includes('tlsCredential'), 'a link of an earlier version has none');
  assert.equal(settingsHintsProblem(manifest.settings), null);
  assert.ok(formSections(links.items, links).flatMap((s) => s.properties).includes('tlsCredential'));
  // the texts rule over the new field alone (the older texts are the X1 prompt's)
  assert.equal(settingsTextProblem({ type: 'object', properties: { tlsCredential: field } }), null);
});
