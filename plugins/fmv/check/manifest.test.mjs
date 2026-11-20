// fmv's manifest (brief sections 3 and 5; criteria 1, 5, 8, 10 and 19): valid against the SDK's plugin manifest schema,
// the two data types and the field set (`manual: false`, no expiry, brief F2), the relation kind, the link form's
// groups and hints (SDK 1.8.0 part D, checked by the web SDK's settingsHintsProblem), the multicast link's required
// interface, and the icon Video (CR-0044 E4).
// Run by `node tools/test.mjs`, or alone: node --test plugins/fmv/check/manifest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Ajv 8 is a dev dependency of model/ (the root has Ajv 6, for eslint): resolve it from there, as the data model's tests do.
const here = dirname(fileURLToPath(import.meta.url));
const model = join(here, '..', '..', '..', 'model');
const modelRequire = createRequire(join(model, 'package.json'));
const Ajv2020 = modelRequire('ajv/dist/2020.js');
const addFormats = modelRequire('ajv-formats');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

const manifest = read(join(here, '..', 'plugin.json'));
const webSdk = join(here, '..', '..', '..', 'web', 'plugin-sdk');
const sdkVersion = read(join(webSdk, 'package.json')).version;

const validator = () => {
  const ajv = new Ajv2020({ strict: true, strictTuples: false, strictRequired: false, allowUnionTypes: true, allErrors: true });
  addFormats(ajv);
  for (const f of readdirSync(join(model, 'schemas')).filter((f) => f.endsWith('.json'))) ajv.addSchema(read(join(model, 'schemas', f)));
  const validate = ajv.getSchema('urn:emc2:schema:plugin-manifest');
  assert.ok(validate.schema.description.includes(`SDK ${sdkVersion} (PDA)`), `the schema is SDK ${sdkVersion}'s`);
  return { ajv, validate };
};

test('the manifest is valid against the SDK\'s plugin manifest schema and needs SDK 1.9.0 (part P: the declared kind, compute tasks)', () => {
  const { validate } = validator();
  assert.ok(validate(manifest), JSON.stringify(validate.errors, null, 1));
  assert.equal(manifest.sdkVersion, '^1.9.0');
  const [major, minor] = sdkVersion.split('.').map(Number);
  assert.ok(major === 1 && minor >= 9, `^1.9.0 accepts the SDK ${sdkVersion}`);
  assert.equal(manifest.category, 'data-links');
  assert.deepEqual(manifest.permissions, ['plugin.fmv.view']);
});

test('criterion 5: both data types are made by the plugin only, have no expiry, and the camera names the field set fmv.camera', () => {
  const types = Object.fromEntries(manifest.dataTypes.map((t) => [t.id, t]));
  assert.deepEqual(Object.keys(types), ['fmv.camera', 'fmv.field-of-view']);
  assert.deepEqual(types['fmv.camera'].fieldSets, ['camera']);
  assert.equal(types['fmv.field-of-view'].fieldSets, undefined);
  for (const t of Object.values(types)) {
    assert.equal(t.manual, false, t.id);
    assert.deepEqual(t.defaults, {}, `${t.id}: no expiry by default (F2)`);
  }
  const set = manifest.fieldSets.find((s) => s.id === 'camera');
  const declared = new Set(manifest.fields.map((f) => f.name));
  assert.ok(set.fields.every((f) => declared.has(f)), 'every field of the set is declared');
  assert.ok(manifest.fields.every((f) => f.editableByOthers === undefined), 'read only for others (ADR-0050)');
});

test('the relation kind fmv.view is a dotted 1 px line in #FFD400, off until a user turns it on', () => {
  assert.deepEqual(manifest.relationKinds, [
    { id: 'fmv.view', label: 'FMV camera and view', line: { strokeColor: '#FFD400', strokeWidth: 1, strokeDash: 'dot' }, defaultOn: false },
  ]);
});

test('criterion 1: the link form has Connection, Video, Picture, Classification and Advanced (folded), and a multicast link needs its group and interface', async () => {
  const { settingsHintsProblem, settingsTextProblem, formSections, itemName, itemColumns, itemWords, pluginIcon, PLUGIN_ICONS } = await import(
    pathToFileURL(join(webSdk, 'src', 'settings-form.ts')).href
  );
  assert.equal(settingsHintsProblem(manifest.settings), null);
  assert.equal(settingsTextProblem(manifest.settings), null, 'every setting has a title and a description (SDK 1.9.0 point 1, X1; B4)');
  assert.equal(manifest.icon, 'Video');
  assert.ok(Object.hasOwn(PLUGIN_ICONS, manifest.icon) && pluginIcon(manifest.icon) !== null, 'the icon is in the SDK\'s list (CR-0044 E4)');
  const links = manifest.settings.properties.links;
  assert.equal(itemName(links, { name: 'FMV link 1' }, 0, true), 'FMV link 1', 'a row is named by its link');
  assert.equal(itemName(links, {}, 0, false), 'New link');
  assert.deepEqual(itemColumns(links), ['direction', 'mode', 'port']);
  assert.equal(itemWords(links).noun, 'link');
  assert.deepEqual(formSections(links.items).map((s) => [s.label, s.folded === true]),
    [[null, false], ['Connection', false], ['Video', false], ['Picture', false], ['Classification', false], ['Advanced', true]]);
  assert.deepEqual(links.items.properties.cameraSymbol['x-emc2'], { hint: 'A 20-digit APP-6D code', visibleWhen: { property: 'direction', in: ['in'] } });

  const { ajv } = validator();
  ajv.addKeyword('x-emc2'); // an annotation, as the data model's examples declare it
  const validate = ajv.compile({ ...links.items, $schema: undefined });
  assert.ok(validate({ name: 'FMV link 1', port: 5000 }), 'a unicast link: a name and a port');
  assert.ok(!validate({ name: 'FMV link 1' }), 'a port is required');
  assert.ok(!validate({ name: 'cam', port: 5000, mode: 'multicast', group: '239.1.2.3' }), 'a multicast link without its interface');
  assert.ok(validate({ name: 'cam', port: 5000, mode: 'multicast', group: '239.1.2.3', interface: 'eth0' }));
  assert.ok(!validate({ name: 'cam', port: 5000, staleSeconds: 1 }) && !validate({ name: 'cam', port: 5000, staleSeconds: 301 }), 'staleSeconds is 2 to 300');
  assert.ok(!validate({ name: 'cam', port: 5000, cameraSymbol: '1003' }) && !validate({ name: 'cam', port: 5000, fovColour: 'yellow' }));
  const defaults = Object.fromEntries(Object.entries(links.items.properties).filter(([, p]) => 'default' in p).map(([k, p]) => [k, p.default]));
  assert.deepEqual(defaults, {
    enabled: true, direction: 'in', mode: 'udp', ttl: 1, cameraSymbol: '10030100001103002000', cameraIdentity: 'friend', fovColour: '#FFD400',
    classification: 'map', classificationNames: ['UNCLASSIFIED', 'RESTRICTED', 'CONFIDENTIAL', 'SECRET', 'COSMIC TOP SECRET'], time: 'received',
    staleSeconds: 10, bitrate: 4, keyframeSeconds: 1, metadataEvery: 1, maxRate: 20, sampling: 'bilinear', haze: true, classifyingCountry: '//NATO',
  }, 'the brief\'s defaults (section 5, F1, F4, F5; section 10.2, O1, O8, O9)');
});

test('criterion 24 and O1: an output link needs only a name, so a new one has no destination; a multicast one with a group needs its interface', () => {
  const { ajv } = validator();
  ajv.addKeyword('x-emc2');
  const validate = ajv.compile({ ...manifest.settings.properties.links.items, $schema: undefined });
  assert.ok(validate({ name: 'UAV North', direction: 'out' }), 'no address, no port: no destination');
  assert.ok(validate({ name: 'UAV North', direction: 'out', mode: 'udp', address: '127.0.0.1', port: 15200, bitrate: 6, metadataEvery: 5 }));
  assert.ok(!validate({ name: 'UAV North', direction: 'out', mode: 'multicast', group: '239.1.2.3', port: 15200 }), 'a group without its interface');
  assert.ok(validate({ name: 'UAV North', direction: 'out', mode: 'multicast', group: '239.1.2.3', interface: 'eth0', port: 15200, ttl: 4 }));
  assert.ok(!validate({ name: 'UAV North', direction: 'out', ttl: 33 }) && !validate({ name: 'UAV North', direction: 'out', bitrate: 21 }));
  assert.ok(!validate({ name: 'UAV North', direction: 'out', classifyingCountry: 'NATO' }), '// and 1 to 4 letters');
  const settings = manifest.settings.properties;
  assert.equal(settings.imageryFolder.default, '%emcc%/settings/imagery');
  assert.equal(settings.terrainFolder.default, '%emcc%/settings/terrain');
  assert.deepEqual(manifest.folders.map((f) => [f.id, f.setting]), [['imagery', '/imageryFolder'], ['terrain', '/terrainFolder']]);
  assert.deepEqual(manifest.compute.threads, 8, 'O3');
});

test('criterion 22: the manifest declares camera-pose; uav-simulation\'s example pose passes it, a wrong one does not', () => {
  assert.deepEqual(manifest.channelKinds.map((k) => [k.name, k.title]), [['camera-pose', 'Camera pose']]);
  const { ajv } = validator();
  const validate = ajv.compile(manifest.channelKinds[0].payload);
  const pose = {
    camera: '0193a1f2-7c4e-7d10-9a3b-2f6e8c1d4b57',
    time: '2026-11-16T10:15:30.040Z',
    platform: { position: [17.3, 62.4, 1000], heading: 45, pitch: 0, roll: 0, name: 'Hawk 1' },
    pointing: { azimuth: 90, depression: 30, roll: 0 },
    fieldOfView: { horizontal: 20, vertical: 11.33 },
    frame: { width: 1280, height: 720, rate: 25 },
    mission: 'RECCE NORTH',
  };
  assert.ok(validate(pose), JSON.stringify(validate.errors));
  const { platform: { name, ...unnamed }, mission, ...rest } = pose;
  assert.ok(validate({ ...rest, platform: unnamed }), 'platform.name and mission are optional');
  const wrong = (patch) => !validate(structuredClone({ ...pose, ...patch }));
  assert.ok(wrong({ pointing: { azimuth: 90, depression: 91, roll: 0 } }), 'depression 91');
  assert.ok(wrong({ frame: { width: 1000, height: 720, rate: 25 } }), 'width 1000');
  assert.ok(wrong({ frame: { width: 1280, height: 1080, rate: 25 } }), '1280 × 1080 is no frame size');
  assert.ok(wrong({ zoom: 2 }), 'an unknown member');
  assert.ok(wrong({ platform: { ...pose.platform, colour: 'red' } }), 'an unknown member inside');
  assert.ok(wrong({ platform: { ...pose.platform, position: [17.3, 62.4] } }) && wrong({ platform: { ...pose.platform, position: [200, 62.4, 0] } }));
  assert.ok(wrong({ pointing: { azimuth: 360, depression: 0, roll: 0 } }), 'azimuth below 360');
  assert.ok(wrong({ camera: 'not-a-uuid' }));
});

test('criterion 19 and 10.2 point 8: internet with no default host (the WMS, owner AAA A), and connections both ways', () => {
  assert.deepEqual(manifest.internet.hosts, [], 'no host is contacted by default (CR-0022)');
  assert.match(manifest.internet.reason, /WMS/);
  assert.deepEqual(manifest.connections.map((c) => [c.kinds, c.direction]), [[['udp', 'multicast'], 'both']]);
});

test('10.5 point 17: the plugin-wide wms settings, off by default, with the brief\'s fields and ranges', () => {
  const wms = manifest.settings.properties.wms;
  assert.deepEqual(Object.keys(wms.properties),
    ['enabled', 'url', 'layer', 'crs', 'format', 'tilePixels', 'metresPerPixel', 'source', 'licence', 'token']);
  assert.deepEqual(wms.default, { enabled: false, crs: 'EPSG:3006', format: 'image/jpeg', tilePixels: 256, metresPerPixel: 1 });
  const { ajv } = validator();
  ajv.addKeyword('x-emc2');
  const validate = ajv.compile({ ...wms, $schema: undefined });
  const ok = { enabled: true, url: 'https://example.org/wms', layer: 'ortofoto', crs: 'EPSG:3006', format: 'image/jpeg',
    tilePixels: 256, metresPerPixel: 1, source: 'Example', licence: 'CC0-1.0', token: 'lm' };
  assert.ok(validate(ok), JSON.stringify(validate.errors));
  assert.ok(validate(wms.default), 'the default is valid');
  const wrong = (patch) => !validate({ ...ok, ...patch });
  assert.ok(wrong({ url: 'ftp://example.org/wms' }) && wrong({ url: 'https://example.org/wms?SERVICE=WMS' }), 'http or https, no parameters');
  assert.ok(wrong({ url: 'https://user:secret@example.org/wms' }), 'no user name or password in the url');
  assert.ok(wrong({ url: 'https://example.org/a|b' }) && wrong({ url: 'https://example.org/a"b' }), 'no character a URI refuses');
  assert.ok(validate({ ...ok, url: 'http://localhost:8080/geoserver/wms' }));
  assert.ok(wrong({ crs: 'EPSG:3857' }) && wrong({ format: 'image/gif' }) && wrong({ tilePixels: 300 }));
  assert.ok(wrong({ metresPerPixel: 0.2 }) && wrong({ metresPerPixel: 11 }), '0.25 to 10');
  assert.ok(wrong({ token: 'Bearer abc def' }), 'a credential\'s name, never a token');
  assert.ok(wrong({ zoom: 2 }), 'no other member');
});
