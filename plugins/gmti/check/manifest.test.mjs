// Criteria 23, 28 and 30 (M6, T-165, T-151 and T-160; CR-0038, CR-0039 points 6 and 8; SDK 1.5.0 parts 1, 3 and 4):
// gmti's plugin.json is valid against the data model's plugin manifest schema (the SDK's version, read from the
// web SDK's package.json), names the set `report` on gmti.detection and none on gmti.platform, leaves both out of the
// editors' data type selects (`manual: false`), marks gmti.detection as a sensor report type (`sensorReport: true`),
// shows a link's fields by its mode and direction (`visibleWhen`) and requires the listen port and the peer where
// they are used (`if`/`then`); from M7 (criteria 34, 35 and part of 37; T-181, T-182, T-185; SDK 1.6.0 parts C and
// F): the three colour settings are colour pickers that refuse what is not #RRGGBB, the pairing line takes
// `pairingColour` (the web SDK's test kit, `ctx.relationLines`), and the pairing and both display classes are on for
// a user with no display setting of their own; from M7 RC2 (criteria 38 to 40; T-192, CR-0042 option A; SDK 1.7.0):
// the fades in steps `detectionFade` and `dwellAreaFade` in the model's form, which gmti.detection's and
// gmti.dwell-area's `fadeSetting` point to, as the web SDK's test kit resolves them (`ctx.dataTypes`).
// From SDK 1.8.0 part D (T-204): the settings form's hints, checked by the web SDK's settingsHintsProblem, and the icon Radar.
// Run by `node tools/test.mjs`, or alone: node --test plugins/gmti/check/manifest.test.mjs
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
// The SDK the plugin is built against, as object-list's test reads it.
const webSdk = join(here, '..', '..', '..', 'web', 'plugin-sdk');
const sdkVersion = read(join(webSdk, 'package.json')).version;

const manifestValidator = () => {
  // The data model's own options (model/test/examples.test.mjs).
  const ajv = new Ajv2020({ strict: true, strictTuples: false, strictRequired: false, allowUnionTypes: true, allErrors: true });
  addFormats(ajv);
  for (const f of readdirSync(join(model, 'schemas')).filter((f) => f.endsWith('.json'))) ajv.addSchema(read(join(model, 'schemas', f)));
  const validate = ajv.getSchema('urn:emc2:schema:plugin-manifest');
  assert.ok(validate.schema.description.includes(`SDK ${sdkVersion} (PDA)`), `the schema is SDK ${sdkVersion}'s`);
  return validate;
};

test('criterion 23: the manifest is valid against the SDK\'s plugin manifest schema, and needs SDK 1.8.0, which it is built against', () => {
  const validate = manifestValidator();
  assert.ok(validate(manifest), JSON.stringify(validate.errors, null, 1));
  assert.equal(manifest.sdkVersion, '^1.8.0', 'SDK 1.8.0 part D, the manifest\'s icon (T-204)');
  const [major, minor] = sdkVersion.split('.').map(Number);
  assert.ok(major === 1 && minor >= 8, `^1.8.0 accepts the SDK ${sdkVersion}`);
  assert.equal(manifest.category, 'data-links', 'T-174');
});

test('criterion 23: gmti.detection names the set report, gmti.platform and gmti.dwell-area none, and none is made by hand', () => {
  const types = Object.fromEntries(manifest.dataTypes.map((t) => [t.id, t]));
  assert.deepEqual(Object.keys(types), ['gmti.detection', 'gmti.platform', 'gmti.dwell-area']);
  assert.deepEqual(types['gmti.detection'].fieldSets, ['report']);
  assert.ok(manifest.fieldSets.some((s) => s.id === 'report'), 'a set the plugin declares (model rule 20)');
  assert.equal(types['gmti.platform'].fieldSets, undefined);
  assert.equal(types['gmti.dwell-area'].fieldSets, undefined);
  for (const id of Object.keys(types)) assert.equal(types[id].manual, false, id);
});

test('criterion 28: gmti.detection is a sensor report type, gmti.platform not', () => {
  const types = Object.fromEntries(manifest.dataTypes.map((t) => [t.id, t]));
  assert.equal(types['gmti.detection'].sensorReport, true);
  assert.equal(types['gmti.platform'].sensorReport, undefined);
  assert.equal(types['gmti.dwell-area'].sensorReport, undefined);
});

// Section 5's list: the fields a link's form shows only for some values of a sibling, and those values.
const PEER = { property: 'mode', in: ['tcp-client', 'udp'] };
const LISTEN = { property: 'mode', in: ['tcp-server', 'udp'] };
const UDP = { property: 'mode', in: ['udp'] };
const IN = { property: 'direction', in: ['in'] };
const OUT = { property: 'direction', in: ['out'] };
const SHOWN_WHEN = {
  name: undefined, mode: undefined, direction: undefined, host: PEER, port: PEER, listen: LISTEN,
  multicastGroup: UDP, multicastInterface: UDP, idleSeconds: undefined, enabled: undefined,
  targetLayer: IN, label: undefined, platformSymbol: IN, platformIdentity: IN, maxReportsPerDwell: IN, time: IN,
  classification: IN, classificationNames: IN, coverage: IN,
  highestClassification: OUT, nationality: OUT, exercise: OUT, maxReportsPerSegment: OUT, oneSegmentPerPacket: OUT,
};

test('criterion 30: the link fields are shown by mode and direction, with the documented shape, none greyed', () => {
  const validate = manifestValidator();
  assert.ok(validate(manifest), JSON.stringify(validate.errors, null, 1));
  // The shape of model/README.md ("Changes in 1.5.0"), as the data model's own example test checks it.
  const condition = {
    type: 'object',
    properties: {
      property: { type: 'string', minLength: 1 },
      in: { type: 'array', minItems: 1, maxItems: 32, items: { type: ['string', 'number', 'boolean'] } },
    },
    required: ['property', 'in'],
    additionalProperties: false,
  };
  const shape = new Ajv2020({ strict: true, allowUnionTypes: true }).compile({
    type: 'object',
    properties: {
      kind: { enum: ['layer', 'colour'] }, allowNew: { type: 'boolean' }, enabledWhen: condition, visibleWhen: condition,
      groups: { type: 'array' }, hint: { type: 'string', minLength: 1, maxLength: 80 }, item: { type: 'object' }, width: { enum: ['short', 'full'] },
      unit: { type: 'string', minLength: 1, maxLength: 8 },
    },
    additionalProperties: false,
  });
  const annotations = [];
  const walk = (schema) => {
    if (schema === null || typeof schema !== 'object') return;
    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      const annotation = property['x-emc2'];
      if (annotation !== undefined) {
        assert.ok(shape(annotation), `${name}: ${JSON.stringify(shape.errors)}`);
        for (const key of ['enabledWhen', 'visibleWhen']) {
          if (annotation[key] !== undefined) {
            assert.ok(annotation[key].property in schema.properties, `${name}: ${key} names a sibling`);
            annotations.push(`${name}.${key}`);
          }
        }
      }
    }
    Object.values(schema).forEach(walk);
  };
  walk(manifest.settings);
  assert.deepEqual(annotations.filter((a) => a.endsWith('.enabledWhen')), [], 'no field is greyed by mode or direction any more');
  const item = manifest.settings.properties.links.items;
  const shown = Object.fromEntries(Object.entries(item.properties).map(([name, p]) => [name, p['x-emc2']?.visibleWhen]));
  assert.deepEqual(shown, SHOWN_WHEN);
  assert.deepEqual(Object.keys(item.properties), Object.keys(SHOWN_WHEN), 'every field of a link is in the list');
});

test('criterion 30: the schema requires the listen port and the peer where the mode and direction use them', () => {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  addFormats(ajv);
  ajv.addKeyword({ keyword: 'x-emc2', schemaType: 'object' });
  const validate = ajv.compile(manifest.settings);
  const cases = read(join(here, 'link-fields.json'));
  for (const { why, link } of cases.accepted) {
    assert.ok(validate({ links: [link] }), `${why}: ${JSON.stringify(validate.errors)}`);
  }
  for (const { why, missing, link } of cases.refused) {
    assert.equal(validate({ links: [link] }), false, why);
    const required = validate.errors.filter((e) => e.keyword === 'required');
    assert.deepEqual(required.map((e) => [e.instancePath, e.params.missingProperty]), [['/links/0', missing]], `${why}: ${JSON.stringify(validate.errors)}`);
  }
  assert.ok(cases.refused.some((c) => c.link.mode === 'udp' && c.link.host !== undefined && c.missing === 'listen'), 'the RC1 case is there');
  assert.equal(validate({ links: [{ name: 'srv', mode: 'tcp-server', listen: { port: 8120 }, host: '' }] }), false, 'a hidden field\'s value is still validated');
});

// Criterion 34 (M7, T-181, T-185; owner QM A, QR A): the dwell areas' and the coverage's colours, beside `links`.
test('criteria 34 and 41: the colour settings are a fixed #RRGGBB, by default #7EF26A and #BDCF3D, or the identity; the colour shown only with fixed', () => {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  addFormats(ajv);
  ajv.addKeyword({ keyword: 'x-emc2', schemaType: 'object' });
  const validate = ajv.compile(manifest.settings);
  const DEFAULTS = { dwellAreaColour: '#7EF26A', coverageColour: '#BDCF3D' }; // M8, T-189 (owner SU A, SV A)
  for (const key of ['dwellAreaColour', 'coverageColour']) {
    const setting = manifest.settings.properties[key];
    assert.deepEqual(setting.default, { use: 'fixed', colour: DEFAULTS[key] }, `${key}: fixed by default from M8 (criterion 41)`);
    assert.deepEqual(setting.properties.use, { title: setting.properties.use.title, description: setting.properties.use.description, enum: ['fixed', 'identity'], default: 'fixed' },
      `${key}: identity still selectable (owner SV A)`);
    assert.equal(setting.properties.colour.default, DEFAULTS[key], `${key}: the form's colour, when fixed has none`);
    assert.deepEqual(setting.properties.colour['x-emc2'], { kind: 'colour', visibleWhen: { property: 'use', in: ['fixed'] } }, `${key}: a colour picker (part F), shown with fixed`);
    for (const value of [{ use: 'identity' }, { use: 'fixed', colour: '#FF00FF' }, { use: 'fixed', colour: '#0a0B0c' }, { use: 'fixed' }, {}]) {
      assert.ok(validate({ links: [], [key]: value }), `${key} ${JSON.stringify(value)}: ${JSON.stringify(validate.errors)}`);
    }
    for (const colour of ['#FF00F', 'FF00FF', '#FF00FFAA', '#GG0000', 'magenta', '', 7]) {
      assert.equal(validate({ links: [], [key]: { use: 'fixed', colour } }), false, `${key}: ${JSON.stringify(colour)} is refused`);
      assert.ok(validate.errors.some((e) => e.instancePath === `/${key}/colour`), `${key}: at the colour, ${JSON.stringify(validate.errors)}`);
    }
    assert.equal(validate({ links: [], [key]: { use: 'red' } }), false, `${key}: use is identity or fixed`);
    assert.equal(validate({ links: [], [key]: { use: 'fixed', colour: '#FF00FF', alpha: 1 } }), false, `${key}: nothing else`);
    assert.equal(validate({ links: [], [key]: '#FF00FF' }), false, `${key}: an object`);
  }
  assert.deepEqual(Object.keys(manifest.settings.properties), ['links', 'dwellAreaColour', 'coverageColour', 'pairingColour', 'detectionFade', 'dwellAreaFade']);
});

// Criterion 35 (SDK 1.6.0 part C; T-181, T-182): the pairing line's colour is the setting pairingColour.
test('criterion 35: gmti.pairing is on by default, 1 px, its colour pairingColour with yellow as the fallback', () => {
  assert.deepEqual(manifest.relationKinds, [
    { id: 'gmti.pairing', label: 'GMTI Pairing', line: { strokeColor: '#FFFF00', strokeWidth: 1, strokeColorSetting: '/pairingColour' }, defaultOn: true },
  ]);
  assert.deepEqual(manifest.settings.properties.pairingColour, {
    title: manifest.settings.properties.pairingColour.title,
    description: manifest.settings.properties.pairingColour.description,
    type: 'string', pattern: '^#[0-9A-Fa-f]{6}$', default: '#FFFF00',
    'x-emc2': { kind: 'colour', hint: manifest.settings.properties.pairingColour['x-emc2'].hint },
  });
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  addFormats(ajv);
  ajv.addKeyword({ keyword: 'x-emc2', schemaType: 'object' });
  const validate = ajv.compile(manifest.settings);
  for (const colour of ['#00FF00', '#0a0b0c']) assert.ok(validate({ links: [], pairingColour: colour }), colour);
  for (const colour of ['#0F0', 'green', '#00FF00FF', 7]) {
    assert.equal(validate({ links: [], pairingColour: colour }), false, `${JSON.stringify(colour)} is refused`);
    assert.ok(validate.errors.some((e) => e.instancePath === '/pairingColour'), JSON.stringify(validate.errors));
  }
});

// The kinds as the shell gets them from the server, the line's defaults filled in (ConfigController, PluginHost.relationKindsJson).
const shellKinds = () => manifest.relationKinds.map((k) => ({ ...k, line: { strokeDash: 'solid', arrowhead: 'none', ...k.line } }));

test('criterion 35: with the test kit\'s context, ctx.relationLines gives #FFFF00, and #00FF00 after the setting changes', async () => {
  const { createFakeContext } = await import(pathToFileURL(join(webSdk, 'src', 'testing', 'index.ts')).href);
  const ctx = createFakeContext({ relationKinds: shellKinds(), pluginSettings: { gmti: { links: [], pairingColour: '#FFFF00' } } });
  assert.equal(ctx.relationLines.value['gmti.pairing'].strokeColor, '#FFFF00');
  const seen = [];
  ctx.relationLines.onChange((lines) => seen.push(lines['gmti.pairing'].strokeColor));
  ctx.setPluginSettings('gmti', { links: [], pairingColour: '#00FF00' });
  assert.deepEqual(seen, ['#00FF00'], 'the map view is told, no reload');
  assert.equal(ctx.relationLines.value['gmti.pairing'].strokeWidth, 1);
  ctx.setPluginSettings('gmti', { links: [] });
  assert.equal(ctx.relationLines.value['gmti.pairing'].strokeColor, '#FFFF00', 'without the setting: the manifest\'s yellow');
});

// Criterion 37, the SDK's part (the map view's part is PCA-map-view-2d's function 40, checked in the browser once there).
test('criterion 37: for a user with no display setting, the pairing, the dwell areas and the coverage show', async () => {
  const { resolveDisplay, classShown } = await import(pathToFileURL(join(webSdk, 'src', 'display.ts')).href);
  const display = resolveDisplay({}, {}, shellKinds());
  assert.equal(display.relations['gmti.pairing'], true);
  assert.equal(classShown(display, 'dwell-area'), true);
  assert.equal(classShown(display, 'sensor-coverage'), true);
  const off = resolveDisplay({ classes: { 'dwell-area': false } }, {}, shellKinds());
  assert.equal(classShown(off, 'dwell-area'), false, '"Dwell areas" off hides them');
  assert.equal(classShown(off, 'sensor-coverage'), true);
  assert.equal(classShown(off, undefined), true, 'detections and platforms have no class: shown');
  assert.equal(off.relations['gmti.pairing'], true, 'and their lines stay');
});

// Criteria 38 to 40 (M7 RC2; T-192; CR-0042 option A, owner FA A, FB A, FC A; SDK 1.7.0): the fades in steps.
const FADES = { 'gmti.detection': '/detectionFade', 'gmti.dwell-area': '/dwellAreaFade' };
const OWNERS_EXAMPLE = { on: true, fromSeconds: 10, stepPercent: 5, invisibleAtSeconds: 100 };
// The dwell areas' default from M8 RC2 (owner, 2026-11-16): one area per dwell again, full until 5 s, gone at 15 s, so a sensor keeps few.
const DWELL_AREA_FADE = { on: true, fromSeconds: 5, stepPercent: 5, invisibleAtSeconds: 15 };
const DEFAULT_FADES = { detectionFade: OWNERS_EXAMPLE, dwellAreaFade: DWELL_AREA_FADE };

test('criteria 27, 38 and 39: gmti.detection and gmti.dwell-area point to their fades, gmti.platform has none; gmti.dwell-area goes at 15 s', () => {
  const types = Object.fromEntries(manifest.dataTypes.map((t) => [t.id, t]));
  for (const [id, pointer] of Object.entries(FADES)) assert.equal(types[id].fadeSetting, pointer, id);
  assert.equal(types['gmti.platform'].fadeSetting, undefined, 'the platform and the coverage keep the expiry fade');
  assert.equal(types['gmti.dwell-area'].name, 'GMTI dwell area');
  assert.deepEqual(types['gmti.dwell-area'].defaults, { expiresAfterSeconds: 15, fadeWhenExpired: false, removeAfterExpirySeconds: 0 },
    'owner, 2026-11-16: an area goes at 15 s, when the default fade makes it invisible; no expiry fade');
  assert.deepEqual(types['gmti.platform'].defaults, { expiresAfterSeconds: 300, fadeWhenExpired: true, removeAfterExpirySeconds: 600 });
});

test('criteria 38 to 40: both fades are the model\'s form, their defaults, with the form\'s four fields', async () => {
  const { STEP_PERCENTS } = await import(pathToFileURL(join(webSdk, 'src', 'fade.ts')).href);
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  addFormats(ajv);
  ajv.addKeyword({ keyword: 'x-emc2', schemaType: 'object' });
  const validate = ajv.compile(manifest.settings);
  const modelForm = new Ajv2020({ strict: true, strictRequired: false, allErrors: true }).compile(read(join(model, 'schemas', 'plugin-manifest.schema.json')).$defs.steppedFade);
  const ON = { visibleWhen: { property: 'on', in: [true] } };
  const UNITS = { fromSeconds: 's', stepPercent: '%', invisibleAtSeconds: 's' }; // T-204, SDK 1.8.0 part D
  const values = [
    [OWNERS_EXAMPLE, true], [{ on: true, fromSeconds: 0, stepPercent: 50, invisibleAtSeconds: 20 }, true], [{ ...OWNERS_EXAMPLE, on: false }, true],
    [{ ...OWNERS_EXAMPLE, stepPercent: 3 }, false], [{ ...OWNERS_EXAMPLE, fromSeconds: -1 }, false], [{ ...OWNERS_EXAMPLE, invisibleAtSeconds: 0 }, false],
    [{ ...OWNERS_EXAMPLE, invisibleAtSeconds: 86_401 }, false], [{ ...OWNERS_EXAMPLE, fromSeconds: 2.5 }, false], [{ ...OWNERS_EXAMPLE, opacity: 1 }, false],
    [{ on: true, fromSeconds: 10, stepPercent: 5 }, false],
  ];
  for (const key of ['detectionFade', 'dwellAreaFade']) {
    const setting = manifest.settings.properties[key];
    assert.deepEqual(setting.default, DEFAULT_FADES[key], `${key}: the detections from 10 s, 5 % steps, 0 at 100 s (TA A); the dwell areas from 5 s, 0 at 15 s`);
    assert.equal(setting.properties.fromSeconds.default, DEFAULT_FADES[key].fromSeconds, `${key}.fromSeconds`);
    assert.equal(setting.properties.invisibleAtSeconds.default, DEFAULT_FADES[key].invisibleAtSeconds, `${key}.invisibleAtSeconds`);
    assert.deepEqual(Object.fromEntries(Object.entries(setting.properties).map(([n, p]) => [n, p.title])),
      { on: 'Fade in steps', fromSeconds: 'From (s)', stepPercent: 'Step (%)', invisibleAtSeconds: 'Invisible at (s)' }, `${key}: the brief's form`);
    assert.deepEqual(setting.properties.stepPercent.enum, [...STEP_PERCENTS], `${key}: a select of the SDK's steps`);
    for (const field of ['fromSeconds', 'stepPercent', 'invisibleAtSeconds']) {
      assert.deepEqual(setting.properties[field]['x-emc2'], { unit: UNITS[field], ...ON }, `${key}.${field}`);
    }
    assert.equal(setting.properties.on['x-emc2'], undefined);
    for (const [value, valid] of values) {
      assert.equal(validate({ links: [], [key]: value }), valid, `${key} ${JSON.stringify(value)}: ${JSON.stringify(validate.errors)}`);
      assert.equal(modelForm(value), valid, `the model's $defs/steppedFade agrees on ${JSON.stringify(value)}`);
    }
  }
});

// The data types as the shell gets them from /api/config (PluginHost.dataTypesJson): declared by gmti, the sets by full id.
const shellDataTypes = () => manifest.dataTypes.map((t) => ({ ...t, declaredBy: 'gmti', fieldSets: (t.fieldSets ?? []).map((s) => `gmti.${s}`) }));
const fadeOf = (ctx, id) => ctx.dataTypes.find((t) => t.id === id).fade;
const seenAt = (seconds) => ({ time: { observed: new Date(Date.parse('2026-11-12T12:00:00Z') - seconds * 1000).toISOString() } });

test('criterion 38: with the test kit\'s context and the defaults, gmti.detection\'s fade is 10, 5 and 100, gmti.dwell-area\'s 5, 5 and 15; the steps', async () => {
  const { createFakeContext } = await import(pathToFileURL(join(webSdk, 'src', 'testing', 'index.ts')).href);
  const { fadeOpacity } = await import(pathToFileURL(join(webSdk, 'src', 'fade.ts')).href);
  const defaults = Object.fromEntries(Object.entries(manifest.settings.properties).map(([k, v]) => [k, v.default ?? []]));
  const ctx = createFakeContext({ dataTypes: shellDataTypes(), pluginSettings: { gmti: defaults } });
  assert.deepEqual({ ...fadeOf(ctx, 'gmti.detection') }, { fromSeconds: 10, stepPercent: 5, invisibleAtSeconds: 100 });
  assert.deepEqual({ ...fadeOf(ctx, 'gmti.dwell-area') }, { fromSeconds: 5, stepPercent: 5, invisibleAtSeconds: 15 });
  assert.equal(fadeOf(ctx, 'gmti.platform'), undefined);
  const fade = fadeOf(ctx, 'gmti.detection');
  const now = Date.parse('2026-11-12T12:00:00Z');
  for (const [seconds, opacity] of [[9.999, 1], [14.499, 1], [14.5, 0.95], [55, 0.5], [99.999, 0.05], [100, 0], [180, 0]]) {
    assert.equal(fadeOpacity(seenAt(seconds), fade, now), opacity, `${seconds} s after the report (owner, FC A)`);
  }
  const area = fadeOf(ctx, 'gmti.dwell-area');
  for (const [seconds, opacity] of [[4.999, 1], [5.499, 1], [5.5, 0.95], [10, 0.5], [14.999, 0.05], [15, 0], [60, 0]]) {
    assert.equal(fadeOpacity(seenAt(seconds), area, now), opacity, `${seconds} s after the dwell (owner, 2026-11-16)`);
  }
});

test('criterion 40: a changed fade reaches ctx.dataTypes without a reload; off, there is none', async () => {
  const { createFakeContext } = await import(pathToFileURL(join(webSdk, 'src', 'testing', 'index.ts')).href);
  const { fadeOpacity } = await import(pathToFileURL(join(webSdk, 'src', 'fade.ts')).href);
  const ctx = createFakeContext({ dataTypes: shellDataTypes(), pluginSettings: { gmti: { links: [], detectionFade: OWNERS_EXAMPLE, dwellAreaFade: OWNERS_EXAMPLE } } });
  const seen = [];
  ctx.onDataTypesChange((types) => seen.push(types.find((t) => t.id === 'gmti.detection').fade));
  const quick = { on: true, fromSeconds: 0, stepPercent: 50, invisibleAtSeconds: 20 };
  ctx.setPluginSettings('gmti', { links: [], detectionFade: quick, dwellAreaFade: OWNERS_EXAMPLE });
  assert.equal(seen.length, 1, 'the map view is told');
  assert.deepEqual({ ...fadeOf(ctx, 'gmti.detection') }, { fromSeconds: 0, stepPercent: 50, invisibleAtSeconds: 20 });
  assert.equal(fadeOf(ctx, 'gmti.dwell-area').invisibleAtSeconds, 100, 'the areas keep theirs');
  const now = Date.parse('2026-11-12T12:00:00Z');
  for (const [seconds, opacity] of [[9.999, 1], [10, 0.5], [19.999, 0.5], [20, 0]]) {
    assert.equal(fadeOpacity(seenAt(seconds), fadeOf(ctx, 'gmti.detection'), now), opacity, `${seconds} s: 50 % from 10 s, gone from 20 s`);
  }
  ctx.setPluginSettings('gmti', { links: [], detectionFade: { ...quick, on: false }, dwellAreaFade: OWNERS_EXAMPLE });
  assert.equal(fadeOf(ctx, 'gmti.detection'), undefined, 'off: drawn fully, with the data type\'s expiry fade');
  ctx.setPluginSettings('gmti', { links: [], detectionFade: { ...quick, invisibleAtSeconds: 0 }, dwellAreaFade: OWNERS_EXAMPLE });
  assert.equal(fadeOf(ctx, 'gmti.detection'), undefined, 'an end not above the start: none either (model rule 22; gmti names it in its status)');
});

// T-204 (SDK 1.8.0 part D; owner UZ A): the settings form's hints and the manifest's icon, as the CDA's test case names them for gmti.
test('T-204: the hints pass the SDK\'s check; a link\'s form in Connection, Picture, Classification and Advanced; the icon Radar', async () => {
  const { settingsHintsProblem, formSections, itemWords, itemName, itemColumns, fieldHint, fieldWidth, pluginIcon, PLUGIN_ICONS } =
    await import(pathToFileURL(join(webSdk, 'src', 'settings-form.ts')).href);
  assert.equal(settingsHintsProblem(manifest.settings), null);
  assert.equal(manifest.icon, 'Radar', 'sdk-v1.md part D suggests Radar for gmti');
  assert.ok(Object.hasOwn(PLUGIN_ICONS, manifest.icon) && pluginIcon(manifest.icon) !== null);

  assert.deepEqual(formSections(manifest.settings).map((s) => s.label), [null, 'Colours', 'Fading'], 'the links\' list, then the colours and the fades');
  const links = manifest.settings.properties.links;
  assert.deepEqual(formSections(links.items).map((s) => [s.label, s.folded]),
    [[null, false], ['Connection', false], ['Picture', false], ['Classification', false], ['Advanced', true]]);
  assert.deepEqual(formSections(links.items)[0].properties, ['name', 'mode', 'direction', 'enabled'], 'the free fields, unheaded');
  const grouped = formSections(links.items).flatMap((s) => s.properties);
  assert.deepEqual([...grouped].sort(), Object.keys(links.items.properties).sort(), 'every field of a link in one section');
  assert.deepEqual(itemWords(links), { noun: 'link', add: 'Add link', remove: 'Delete link?', fresh: 'New link' });
  assert.equal(itemName(links, { name: 'vista' }, 0, true), 'vista');
  assert.equal(itemName(links, {}, 2, true), 'Link 3');
  assert.deepEqual(itemColumns(links), ['direction', 'mode', 'host', 'port']);
  assert.equal(links['x-emc2'].item.state, 'enabled');

  const hints = [];
  const walk = (schema, path) => {
    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      const { hint } = fieldHint(property);
      if ((property.description ?? '').length > 80) assert.ok(hint !== null, `${path}${name}: a long description has a hint`);
      if (hint !== null) hints.push(hint);
      if (property.properties !== undefined) walk(property, `${path}${name}.`);
      if (property.items?.properties !== undefined) walk(property.items, `${path}${name}[].`);
    }
  };
  walk(manifest.settings, '');
  assert.ok(hints.every((h) => h.length <= 80));
  assert.equal(links.items.properties.idleSeconds['x-emc2'].unit, 's');
  assert.equal(fieldWidth(links.items.properties.nationality), 'short');
});
