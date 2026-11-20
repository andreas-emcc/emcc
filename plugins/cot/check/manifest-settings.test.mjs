// Criterion 31 (M4, T-107): the manifest's settings schema compiles in strict mode with `x-emc2` as an annotation, the greyed link
// fields (x-emc2.enabledWhen) are well formed, and a greyed field's value still validates (validation does not change).
// Run by `node tools/test.mjs` (plugins/*/check/*.test.mjs), or alone: node --test plugins/cot/check/manifest-settings.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Ajv 8 is a dev dependency of model/ (the root has Ajv 6, for eslint): resolve it from there, as the data model's tests do.
const here = dirname(fileURLToPath(import.meta.url));
const modelRequire = createRequire(join(here, '..', '..', '..', 'model', 'package.json'));
const Ajv2020 = modelRequire('ajv/dist/2020.js');
const addFormats = modelRequire('ajv-formats');

const manifest = JSON.parse(readFileSync(join(here, '..', 'plugin.json'), 'utf8'));
const links = manifest.settings.properties.links.items.properties;

function compile() {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  ajv.addKeyword({ keyword: 'x-emc2', schemaType: 'object' });
  return ajv.compile(manifest.settings);
}

test('the manifest needs SDK 1.9.0 and the settings schema compiles in strict mode', () => {
  assert.equal(manifest.sdkVersion, '^1.9.0');
  assert.equal(typeof compile(), 'function');
});

test('every enabledWhen has the documented shape and names direction or transport and values of its enum', () => {
  const found = {};
  for (const [name, schema] of Object.entries(links)) {
    const when = schema['x-emc2']?.enabledWhen;
    if (when === undefined) continue;
    assert.deepEqual(Object.keys(when).sort(), ['in', 'property'], name);
    assert.ok(['direction', 'transport'].includes(when.property), `${name}: ${when.property}`);
    assert.ok(Array.isArray(when.in) && when.in.length >= 1 && when.in.length <= 32, `${name}: one to 32 values`);
    assert.ok(when.in.every((v) => links[when.property].enum.includes(v)), `${name}: only values of ${when.property}`);
    found[name] = `${when.property}=${when.in.join(',')}`;
  }
  assert.deepEqual(found, {
    host: 'transport=tcp,tls,udp', tlsCredential: 'transport=tls', address: 'transport=udp,multicast', interface: 'transport=multicast',
    targetLayer: 'direction=in,both', sourceLayers: 'direction=out,both', highestClassification: 'direction=out,both',
    staleSeconds: 'direction=out,both', refreshSeconds: 'direction=out,both', label: 'direction=in,both',
  });
});

test('a greyed field keeps a value that validates: an in link that kept its source layers, an out link that kept a target layer', () => {
  const validate = compile();
  const layer = { id: '7d3f1a52-2b4e-4c1f-9e0a-5b6c7d8e9f10', name: 'TAK North' };
  const base = { name: 'tak-north', host: 'tak.example.local', port: 8087 };
  assert.ok(validate({ links: [{ ...base, direction: 'in', sourceLayers: [layer], staleSeconds: 30, label: { policy: 'NATO', classification: 'UNCLASSIFIED' } }] }), JSON.stringify(validate.errors));
  assert.ok(validate({ links: [{ ...base, direction: 'out', targetLayer: layer, sourceLayers: [layer] }] }), JSON.stringify(validate.errors));
  assert.ok(validate({ links: [{ name: 'mesh', direction: 'both', transport: 'multicast', host: 'kept', address: '239.2.3.1', interface: 'eth0', port: 6969 }] }), JSON.stringify(validate.errors));
  assert.ok(!validate({ links: [{ ...base, direction: 'in', staleSeconds: 0 }] }), 'a greyed field is still validated: staleSeconds 0 is out of range');
});
