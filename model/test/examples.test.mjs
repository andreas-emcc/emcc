// Validates every schema (Ajv strict mode, JSON Schema 2020-12) and every
// example document in model/examples/:
// - valid/            must be valid against the schema named by the file prefix;
// - invalid/          must be invalid, for the reason listed in INVALID below;
// - invalid-by-rule/  must be VALID against the schema, because they break a
//                     rule the schema cannot express (README "Rules"). They
//                     are for the contract tests of the object store and SDKs.
// - migration/0.1.0-to-1.0.0/  pairs of stored data before and after the
//                     migration to data model 1.0.0 (README "Migration").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const list = (dir) => readdirSync(join(root, dir)).filter((f) => f.endsWith('.json')).sort();

// All strict checks, except:
// strictTuples: a position is deliberately a 2- or 3-item tuple.
// strictRequired: the if/then rules require properties defined in the parent
//   schema (e.g. "a core.symbol requires symbol"), which is valid JSON Schema.
// allowUnionTypes: e.g. "type": ["object", "null"].
const ajv = new Ajv2020({ strict: true, strictTuples: false, strictRequired: false, allowUnionTypes: true, allErrors: true });
addFormats(ajv);
for (const f of list('schemas')) ajv.addSchema(read(join(root, 'schemas', f)));

// The file name prefix tells which schema applies.
const PREFIXES = [
  ['change-request-', 'urn:emc2:schema:change-request'],
  ['change-event-', 'urn:emc2:schema:change-event'],
  ['change-rejection-', 'urn:emc2:schema:change-rejection'],
  ['manifest-', 'urn:emc2:schema:plugin-manifest'],
  ['object-', 'urn:emc2:schema:map-object'],
  ['layer', 'urn:emc2:schema:layer'],
];

function schemaFor(file) {
  const hit = PREFIXES.find(([p]) => file.startsWith(p));
  assert.ok(hit, `no schema prefix matches ${file}`);
  return ajv.getSchema(hit[1]);
}

// Why each invalid example must fail: an instance path prefix and, optionally,
// the keyword of at least one error there. This stops an example from passing
// the test because it is broken in some other, unintended way.
const INVALID = {
  'change-request-create-with-version.json': { path: '/data', keyword: 'unevaluatedProperties' },
  'change-request-delete-with-data.json': { path: '', keyword: 'not' },
  'object-app6d-sidc-wrong-length.json': { path: '/symbol/sidc', keyword: 'pattern' },
  'object-app6d-with-app6e-version.json': { path: '/symbol/sidc', keyword: 'pattern' },
  'object-bad-extension-namespace.json': { path: '/extensions' },
  'object-missing-label.json': { path: '', keyword: 'required' },
  'object-swapped-coordinates.json': { path: '/geometry' },
  'object-symbol-missing-symbol.json': { path: '', keyword: 'required' },
  'object-symbol-on-line.json': { path: '/geometry/type' },
  'object-unknown-modifier.json': { path: '/symbol/modifiers', keyword: 'additionalProperties' },
  'object-negative-speed.json': { path: '/symbol/modifiers/speed', keyword: 'minimum' },
  'object-modifiers-azimuth-over-360.json': { path: '/symbol/modifiers/azimuths/1', keyword: 'maximum' },
  'object-modifiers-distances-not-numbers.json': { path: '/symbol/modifiers/distances/0', keyword: 'type' },
  'change-rejection-unknown-code.json': { path: '/code', keyword: 'enum' },
  'manifest-internet-without-hosts.json': { path: '/internet', keyword: 'required' },
  'manifest-internet-url-as-host.json': { path: '/internet/hosts/0', keyword: 'pattern' },
  'manifest-no-parts.json': { path: '', keyword: 'anyOf' },
  'object-missing-data-type.json': { path: '', keyword: 'required' },
  'object-bad-data-source.json': { path: '/dataSource', keyword: 'pattern' },
  'object-time-not-utc.json': { path: '/time/expires', keyword: 'pattern' },
  'change-request-update-with-external-ref.json': { path: '', keyword: 'not' },
  'manifest-data-type-without-name.json': { path: '/dataTypes/0', keyword: 'required' },
  'manifest-network-endpoint-not-pointer.json': { path: '/network/endpoints/0', keyword: 'pattern' },
  'manifest-connections-without-kinds.json': { path: '/connections/0/kinds', keyword: 'minItems' },
  'manifest-connections-unknown-kind.json': { path: '/connections/0/kinds/0', keyword: 'enum' },
  'manifest-uses-not-a-service-key.json': { path: '/uses/0', keyword: 'pattern' },
  'layer-bad-workspace.json': { path: '/workspace', keyword: 'pattern' },
  'layer-locked-not-boolean.json': { path: '/locked', keyword: 'type' },
  'manifest-workspace-without-edit-permission.json': { path: '/workspaces/0', keyword: 'required' },
  'manifest-field-choice-without-choices.json': { path: '/fields/0', keyword: 'required' },
  'manifest-field-unit-on-text.json': { path: '/fields/0', keyword: 'not' },
  'manifest-icon-not-a-name.json': { path: '/icon', keyword: 'pattern' },
  'manifest-compute-too-many-threads.json': { path: '/compute/threads', keyword: 'maximum' },
  'manifest-id-emc2.json': { path: '/id', keyword: 'not' },
  'manifest-id-emc2-x.json': { path: '/id', keyword: 'not' },
  'manifest-id-emcc-tracks.json': { path: '/id', keyword: 'not' },
  'manifest-id-emcc.json': { path: '/id', keyword: 'not' },
  'manifest-channel-kind-without-payload.json': { path: '/channelKinds/0', keyword: 'required' },
  'manifest-field-bad-name.json': { path: '/fields/0/name', keyword: 'pattern' },
  'change-request-update-layer-with-fields.json': { path: '', keyword: 'not' },
  'change-request-fields-object-value.json': { path: '/fields/0/value', keyword: 'type' },
  'object-style-unknown-fill-pattern.json': { path: '/style/fillPattern', keyword: 'enum' },
  'object-style-unknown-arrowhead.json': { path: '/style/arrowhead', keyword: 'enum' },
  'object-style-unknown-point-markers.json': { path: '/style/pointMarkers', keyword: 'enum' },
  'object-vessel-bad-code.json': { path: '/symbol/sidc', keyword: 'pattern' },
  // Data model 1.6.0 (CR-0041 part A): core.text
  'object-text-without-text.json': { path: '', keyword: 'required' },
  'object-text-on-line.json': { path: '/geometry/type', keyword: 'const' },
  'object-text-rotation-360.json': { path: '/text/rotation', keyword: 'exclusiveMaximum' },
  'object-shape-with-text.json': { path: '', keyword: 'not' },
  // Data model 1.6.0 (CR-0041 part D; T-182): the fixed list of display classes
  'object-unknown-display-class.json': { path: '/displayClass', keyword: 'enum' },
  'object-relations-over-limit.json': { path: '/relations', keyword: 'maxItems' },
  'object-relation-bad-object-id.json': { path: '/relations/0/objectId', keyword: 'pattern' },
  'manifest-relation-kind-without-line.json': { path: '/relationKinds/0', keyword: 'required' },
  'manifest-unknown-capability.json': { path: '/capabilities/1', keyword: 'enum' },
  // Data model 1.6.0 (CR-0041 part F; T-174): the fixed list of categories
  'manifest-unknown-category.json': { path: '/category', keyword: 'enum' },
  // Data model 1.6.0 (CR-0041 part C; T-181): a relation line's colour from a setting
  'manifest-relation-colour-setting-not-pointer.json': { path: '/relationKinds/0/line/strokeColorSetting', keyword: 'pattern' },
  // Data model 1.7.0 (CR-0042; T-192): a data type's stepped fade from a setting
  'manifest-data-type-fade-setting-not-pointer.json': { path: '/dataTypes/0/fadeSetting', keyword: 'pattern' },
  // Data model 1.6.0 (CR-0041 part G; T-156): symbol palettes
  'manifest-palette-bad-code.json': { path: '/symbolPalettes/0/symbols/0/code', keyword: 'pattern' },
  'manifest-palette-vessel.json': { path: '/symbolPalettes/0/symbols/0/standard', keyword: 'enum' },
  'manifest-folder-relative-setting.json': { path: '/folders/0/setting', keyword: 'pattern' },
  'manifest-data-type-field-set-bad-id.json': { path: '/dataTypes/0/fieldSets/0', keyword: 'pattern' },
  'manifest-data-type-too-many-field-sets.json': { path: '/dataTypes/0/fieldSets', keyword: 'maxItems' },
  'manifest-data-type-sensor-report-not-boolean.json': { path: '/dataTypes/0/sensorReport', keyword: 'type' },
};

test('every schema compiles in strict mode', () => {
  for (const f of list('schemas')) {
    const s = read(join(root, 'schemas', f));
    assert.ok(ajv.getSchema(s.$id), `${f} did not compile`);
  }
});

for (const f of list('examples/valid')) {
  test(`valid: ${f}`, () => {
    const validate = schemaFor(f);
    const ok = validate(read(join(root, 'examples/valid', f)));
    assert.ok(ok, JSON.stringify(validate.errors, null, 2));
  });
}

test('every invalid example has an expected reason', () => {
  assert.deepEqual(list('examples/invalid'), Object.keys(INVALID).sort());
});

for (const f of list('examples/invalid')) {
  test(`invalid: ${f}`, () => {
    const validate = schemaFor(f);
    assert.equal(validate(read(join(root, 'examples/invalid', f))), false, 'expected the document to be invalid');
    const want = INVALID[f];
    const match = validate.errors.some((e) => e.instancePath.startsWith(want.path) && (!want.keyword || e.keyword === want.keyword));
    assert.ok(match, `no error at "${want.path}"${want.keyword ? ` with keyword ${want.keyword}` : ''}:\n${JSON.stringify(validate.errors, null, 2)}`);
  });
}

test('every sdkVersion range in the shared version cases is a valid manifest sdkVersion', () => {
  const { cases } = read(join(root, 'examples/sdk-version-matching.json'));
  const manifest = read(join(root, 'examples/valid/manifest-draw-symbols.json'));
  const validate = ajv.getSchema('urn:emc2:schema:plugin-manifest');
  for (const c of cases) {
    assert.ok(validate({ ...manifest, sdkVersion: c.range }), `range "${c.range}" is not accepted by the manifest schema`);
  }
  assert.equal(validate({ ...manifest, sdkVersion: '0.1' }), false, 'an incomplete version must be rejected');
});

for (const f of list('examples/invalid-by-rule')) {
  test(`invalid-by-rule (schema-valid): ${f}`, () => {
    assert.match(f, /^rule-\d+-/, 'file name must start with rule-<number>- (README "Rules")');
    const validate = schemaFor(f.replace(/^rule-\d+-/, ''));
    const ok = validate(read(join(root, 'examples/invalid-by-rule', f)));
    assert.ok(ok, `must pass the schema, so that it tests the rule:\n${JSON.stringify(validate.errors, null, 2)}`);
  });
}

// The migration of stored 0.1.0 data (README "Migration"): every object gets
// dataType core.general and dataSource manual, and nothing else changes
// (not even version or meta); layers stay as they are.
const MIGRATION = 'examples/migration/0.1.0-to-1.0.0';

test('every migration example has a before and an after', () => {
  assert.deepEqual(list(`${MIGRATION}/before`), list(`${MIGRATION}/after`));
  assert.ok(list(`${MIGRATION}/before`).length > 0);
});

for (const f of list(`${MIGRATION}/after`)) {
  test(`migration 0.1.0 -> 1.0.0: ${f}`, () => {
    const validate = schemaFor(f);
    const before = read(join(root, MIGRATION, 'before', f));
    const after = read(join(root, MIGRATION, 'after', f));
    assert.ok(validate(after), JSON.stringify(validate.errors, null, 2));
    if (f.startsWith('object-')) {
      assert.equal(validate(before), false, 'an unmigrated object must not pass the 1.0.0 schema');
      assert.equal('dataType' in before || 'dataSource' in before, false);
      assert.deepEqual(after, { ...before, dataType: 'core.general', dataSource: 'manual' });
    } else {
      assert.deepEqual(after, before);
    }
  });
}

// CR-0025 part 3: the layer picker's annotation "x-emc2" is a keyword that
// validators ignore. A manifest's settings schema with it compiles as JSON
// Schema 2020-12 (strict, with x-emc2 declared as an annotation only), and a
// picked layer, existing or new, is valid against it.
test('the layer picker example compiles with x-emc2 as an annotation and accepts picked layers', () => {
  const settingsAjv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(settingsAjv);
  settingsAjv.addKeyword({ keyword: 'x-emc2', schemaType: 'object' });
  const { settings } = read(join(root, 'examples/valid/manifest-layer-picker.json'));
  const validate = settingsAjv.compile(settings);
  const picked = {
    links: [
      { name: 'tak-north', direction: 'in', targetLayer: { id: '7d3f1a52-2b4e-4c1f-9e0a-5b6c7d8e9f10', name: 'TAK North' } },
      { name: 'tak-out', direction: 'out', targetLayer: { name: 'New CoT layer' }, sourceLayers: [{ id: '0b5c2f4e-8f43-4d7a-9a51-2c1f1c3c9e01', name: 'Own forces' }],
        highestClassification: { policy: 'NATO', classification: 'RESTRICTED' } },
    ],
  };
  assert.ok(validate(picked), JSON.stringify(validate.errors, null, 2));
  assert.equal(validate({ links: [{ name: 'tak-north', direction: 'in', targetLayer: { id: '7d3f1a52-2b4e-4c1f-9e0a-5b6c7d8e9f10' } }] }), false, 'a picked layer needs its name');
});

// CR-0028 part 5 (1.3.0): "x-emc2" may carry "enabledWhen", with or without
// "kind". Every x-emc2 in the example has the documented shape, its property
// names a sibling, and validation does not change: a disabled field's value is
// still valid.
test('enabledWhen in the layer picker example names a sibling and leaves validation unchanged', () => {
  const annotationAjv = new Ajv2020({ strict: true, allowUnionTypes: true });
  const shape = annotationAjv.compile({
    type: 'object',
    properties: {
      kind: { const: 'layer' },
      allowNew: { type: 'boolean' },
      enabledWhen: {
        type: 'object',
        properties: {
          property: { type: 'string', minLength: 1 },
          in: { type: 'array', minItems: 1, maxItems: 32, items: { type: ['string', 'number', 'boolean'] } },
        },
        required: ['property', 'in'],
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  });
  const { settings } = read(join(root, 'examples/valid/manifest-layer-picker.json'));
  const found = [];
  const walk = (schema) => {
    if (schema === null || typeof schema !== 'object') return;
    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      const annotation = property['x-emc2'];
      if (annotation !== undefined) {
        assert.ok(shape(annotation), `${name}: ${JSON.stringify(shape.errors)}`);
        if (annotation.enabledWhen !== undefined) {
          assert.ok(annotation.enabledWhen.property in schema.properties, `${name}: enabledWhen names a sibling`);
          found.push(name);
        }
      }
    }
    Object.values(schema).forEach(walk);
  };
  walk(settings);
  assert.deepEqual(found.sort(), ['sourceLayers', 'targetLayer']);

  const settingsAjv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(settingsAjv);
  settingsAjv.addKeyword({ keyword: 'x-emc2', schemaType: 'object' });
  const validate = settingsAjv.compile(settings);
  const layer = { id: '7d3f1a52-2b4e-4c1f-9e0a-5b6c7d8e9f10', name: 'TAK North' };
  assert.ok(validate({ links: [{ name: 'tak-north', direction: 'in', targetLayer: layer, sourceLayers: [layer] }] }), 'a disabled field keeps a valid value');
});

// CR-0039 point 8 (1.5.0 part 4; T-160): "x-emc2" may carry "visibleWhen", of
// enabledWhen's shape, alone or with it. Every x-emc2 in the example has the
// documented shape and names a sibling; validation does not change (a hidden
// field's value is still validated), and the schema's own if/then requires
// what each mode and direction needs (the owner's Q45 A: by mode).
test('visibleWhen in the settings example names a sibling and leaves validation unchanged', () => {
  const condition = {
    type: 'object',
    properties: {
      property: { type: 'string', minLength: 1 },
      in: { type: 'array', minItems: 1, maxItems: 32, items: { type: ['string', 'number', 'boolean'] } },
    },
    required: ['property', 'in'],
    additionalProperties: false,
  };
  const annotationAjv = new Ajv2020({ strict: true, allowUnionTypes: true });
  const shape = annotationAjv.compile({
    type: 'object',
    properties: { kind: { const: 'layer' }, allowNew: { type: 'boolean' }, enabledWhen: condition, visibleWhen: condition },
    additionalProperties: false,
  });
  const { settings } = read(join(root, 'examples/valid/manifest-settings-visible-when.json'));
  const found = [];
  const walk = (schema) => {
    if (schema === null || typeof schema !== 'object') return;
    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      const annotation = property['x-emc2'];
      if (annotation !== undefined) {
        assert.ok(shape(annotation), `${name}: ${JSON.stringify(shape.errors)}`);
        for (const key of ['enabledWhen', 'visibleWhen']) {
          if (annotation[key] !== undefined) {
            assert.ok(annotation[key].property in schema.properties, `${name}: ${key} names a sibling`);
            found.push(`${name}.${key}`);
          }
        }
      }
    }
    Object.values(schema).forEach(walk);
  };
  walk(settings);
  assert.deepEqual(found.sort(), ['host.visibleWhen', 'listen.visibleWhen', 'multicastInterface.enabledWhen', 'multicastInterface.visibleWhen', 'port.visibleWhen', 'targetLayer.visibleWhen']);

  const settingsAjv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  addFormats(settingsAjv);
  settingsAjv.addKeyword({ keyword: 'x-emc2', schemaType: 'object' });
  const validate = settingsAjv.compile(settings);
  const ok = (links, why) => assert.ok(validate({ links }), `${why}: ${JSON.stringify(validate.errors)}`);
  const refused = (links, path, why) => {
    assert.equal(validate({ links }), false, why);
    assert.ok(validate.errors.some((e) => e.keyword === 'required' && e.params.missingProperty === path), `${why}: ${JSON.stringify(validate.errors)}`);
  };
  ok([{ name: 'vista', mode: 'tcp-client', direction: 'in', host: '127.0.0.1', port: 8113 }], 'a tcp-client in link needs only the peer');
  ok([{ name: 'rc1', mode: 'udp', direction: 'in', listen: { port: 4142 } }], 'a udp in link needs only the listen port');
  ok([{ name: 'out', mode: 'udp', direction: 'out', host: '127.0.0.1', port: 4181 }], 'a udp out link needs only the peer');
  ok([{ name: 'srv', mode: 'tcp-server', direction: 'out', listen: { port: 8120 }, host: 'kept', port: 1 }], 'a hidden field keeps a valid value');
  refused([{ name: 'rc1', mode: 'udp', direction: 'in', host: '127.0.0.1', port: 4142 }], 'listen', 'the owner\'s RC1 case: a udp in link without a listen port');
  refused([{ name: 'srv', mode: 'tcp-server' }], 'listen', 'a tcp-server link without a listen port');
  refused([{ name: 'cli' }], 'host', 'a link of the default mode without its peer');
  assert.equal(validate({ links: [{ name: 'srv', mode: 'tcp-server', listen: { port: 8120 }, host: '' }] }), false, 'a hidden field\'s value is still validated');
});

// CR-0041 part F (1.6.0; owner Q60 A): "x-emc2" may carry kind "colour" on a
// string with the colour pattern, alone or with visibleWhen and enabledWhen. An
// annotation: validation does not change, and the pattern still refuses a value
// that is not #RRGGBB.
test('a colour setting is a #RRGGBB string marked kind colour, and validation does not change', () => {
  const { settings } = read(join(root, 'examples/valid/manifest-category-and-colour.json'));
  const found = [];
  const walk = (schema, name) => {
    if (schema === null || typeof schema !== 'object') return;
    const annotation = schema['x-emc2'];
    if (annotation !== undefined && annotation.kind === 'colour') {
      assert.equal(schema.type, 'string', name + ': a colour is a string');
      assert.equal(schema.pattern, '^#[0-9A-Fa-f]{6}$', name + ': with the colour pattern');
      found.push(name);
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) walk(sub, key);
  };
  walk(settings, '');
  assert.deepEqual(found.sort(), ['colour', 'pairingColour']);
  const settingsAjv = new Ajv2020({ strict: true, allErrors: true });
  settingsAjv.addKeyword({ keyword: 'x-emc2', schemaType: 'object' });
  const validate = settingsAjv.compile(settings);
  assert.ok(validate({ pairingColour: '#00ff00', dwellAreaColour: { use: 'identity', colour: '#FFFF00' } }), JSON.stringify(validate.errors));
  assert.equal(validate({ pairingColour: 'yellow' }), false, 'a colour is #RRGGBB');
  assert.equal(validate({ pairingColour: '#FFF' }), false, 'six hex digits');
});

// CR-0043 part D (1.8.0; owner UZ A): "x-emc2" may carry groups (on an object),
// hint, width and unit (on a property) and item (on an array of objects), and
// the manifest an icon. Every x-emc2 in the example has the documented shape,
// each name it gives is a property where it must be, and validation does not
// change: they are annotations.
test('the settings form hints have their documented shape and leave validation unchanged', () => {
  const condition = {
    type: 'object',
    properties: {
      property: { type: 'string', minLength: 1 },
      in: { type: 'array', minItems: 1, maxItems: 32, items: { type: ['string', 'number', 'boolean'] } },
    },
    required: ['property', 'in'],
    additionalProperties: false,
  };
  const annotationAjv = new Ajv2020({ strict: true, allowUnionTypes: true });
  const shape = annotationAjv.compile({
    type: 'object',
    properties: {
      kind: { enum: ['layer', 'colour'] },
      allowNew: { type: 'boolean' },
      enabledWhen: condition,
      visibleWhen: condition,
      groups: {
        type: 'array', maxItems: 32,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', minLength: 1 }, label: { type: 'string', minLength: 1 },
            properties: { type: 'array', minItems: 1, items: { type: 'string' } },
            folded: { type: 'boolean' }, advanced: { type: 'boolean' },
          },
          required: ['id', 'label', 'properties'],
          additionalProperties: false,
        },
      },
      hint: { type: 'string', minLength: 1, maxLength: 80 },
      item: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 }, noun: { type: 'string', pattern: '^[a-z][a-z -]{0,31}$' },
          state: { type: 'string', minLength: 1 }, columns: { type: 'array', maxItems: 6, uniqueItems: true, items: { type: 'string' } },
          id: { type: 'string', minLength: 1 },
        },
        required: ['name', 'noun'],
        additionalProperties: false,
      },
      width: { enum: ['short', 'full'] },
      unit: { type: 'string', minLength: 1, maxLength: 8 },
    },
    additionalProperties: false,
  });
  const manifest = read(join(root, 'examples/valid/manifest-settings-form-hints.json'));
  assert.equal(manifest.icon, 'Radar');
  const found = [];
  const walk = (schema, name) => {
    if (schema === null || typeof schema !== 'object') return;
    const annotation = schema['x-emc2'];
    if (annotation !== undefined) {
      assert.ok(shape(annotation), `${name}: ${JSON.stringify(shape.errors)}`);
      for (const g of annotation.groups ?? []) for (const p of g.properties) assert.ok(p in schema.properties, `${name}: group ${g.id} names a property`);
      if (annotation.item !== undefined) {
        const items = schema.items.properties;
        assert.equal(items[annotation.item.name].type, 'string', `${name}: the item's name is a string`);
        assert.equal(items[annotation.item.state].type, 'boolean', `${name}: the item's state is a boolean`);
        for (const c of annotation.item.columns ?? []) assert.ok(c in items, `${name}: column ${c}`);
        if (annotation.item.id !== undefined) {
          assert.equal(items[annotation.item.id].type, 'string', `${name}: the item's id is a string`);
          const apart = [annotation.item.name, annotation.item.state, ...(annotation.item.columns ?? [])];
          assert.ok(!apart.includes(annotation.item.id), `${name}: the item's id is not its name, state or a column`);
        }
      }
      if (annotation.unit !== undefined) assert.ok(['number', 'integer'].includes(schema.type), `${name}: a unit is on a number`);
      found.push(...Object.keys(annotation).filter((k) => ['groups', 'hint', 'item', 'width', 'unit'].includes(k)).map((k) => `${name}.${k}`));
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) walk(sub, key);
    if (schema.items !== undefined) walk(schema.items, `${name}[]`);
  };
  walk(manifest.settings, 'settings');
  assert.deepEqual(found.sort(), ['host.hint', 'idleSeconds.unit', 'links.item', 'links[].groups', 'port.width']);

  const settingsAjv = new Ajv2020({ strict: true, allErrors: true });
  settingsAjv.addKeyword({ keyword: 'x-emc2', schemaType: 'object' });
  const validate = settingsAjv.compile(manifest.settings);
  const id = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
  assert.ok(validate({ pairingColour: '#00FF00', links: [{ id, name: 'north', enabled: false, mode: 'udp', host: 'h', port: 4607, idleSeconds: 5 }] }), JSON.stringify(validate.errors));
  assert.ok(validate({ links: [{ id, name: '', mode: 'tcp-server', port: 1 }] }), 'a hidden or disabled field keeps a valid value; an empty name is valid');
  assert.equal(validate({ links: [{ id, name: 'n', port: 0 }] }), false, 'a hinted field is still validated');
  assert.equal(validate({ links: [{ name: 'north' }] }), false, 'the id is required: ECore fills it in before it validates (part F)');
});
