import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MANIFEST_SCHEMA_ID, manifestProblem } from '../src/build/index.ts';

// SDK 1.9.0 (M9, D3; G24; owner ZU A): the manifest guard's schema check, with the data model's schemas.
const minimal = { id: 'acme-tracks', name: 'Acme tracks', version: '0.1.0', sdkVersion: '^1.9.0', kind: 'general', server: { entryClass: 'com.acme.tracks.TracksPlugin' } };
const modelSchemas = fileURLToPath(new URL('../../../model/schemas/', import.meta.url));

describe('manifestProblem', () => {
  it('accepts a valid manifest, and the template\'s and the data model\'s valid examples', () => {
    expect(manifestProblem(minimal)).toBeNull();
    const template = JSON.parse(readFileSync(fileURLToPath(new URL('../../../plugins/_template/plugin.json', import.meta.url)), 'utf8')) as unknown;
    expect(manifestProblem(template)).toBeNull();
    const valid = fileURLToPath(new URL('../../../model/examples/valid/', import.meta.url));
    for (const f of readdirSync(valid).filter((f) => f.startsWith('manifest'))) {
      expect(manifestProblem(JSON.parse(readFileSync(join(valid, f), 'utf8')) as unknown), f).toBeNull();
    }
  });

  it('names each problem with its JSON pointer', () => {
    const problem = manifestProblem({ ...minimal, id: 'Acme', sdkVersion: undefined, extra: 1 });
    expect(problem).toContain('/id: must match pattern');
    expect(problem).toContain("must have required property 'sdkVersion'");
    expect(problem).toContain('must NOT have additional properties');
  });

  it('refuses the reserved ids: the product\'s by the schema, ECore\'s core and core-… by the SDK', () => {
    for (const id of ['emc2', 'emcc', 'emc2-tracks', 'emcc-tracks']) expect(manifestProblem({ ...minimal, id }), id).toContain('/id: must NOT be valid');
    for (const id of ['core', 'core-tracks']) expect(manifestProblem({ ...minimal, id }), id).toBe('/id: the ids core and core-… are reserved for ECore');
    for (const id of ['coreline', 'acme-tracks', 'emc2x']) expect(manifestProblem({ ...minimal, id }), id).toBeNull();
  });

  it('refuses the data model\'s invalid manifest examples', () => {
    const invalid = fileURLToPath(new URL('../../../model/examples/invalid/', import.meta.url));
    const files = readdirSync(invalid).filter((f) => f.startsWith('manifest'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(manifestProblem(JSON.parse(readFileSync(join(invalid, f), 'utf8')) as unknown), f).not.toBeNull();
    }
  });

  it('refuses schemas of another SDK version, and says when they are missing', () => {
    const other = mkdtempSync(join(tmpdir(), 'emcc-schemas-'));
    for (const f of readdirSync(modelSchemas).filter((f) => f.endsWith('.schema.json'))) {
      writeFileSync(join(other, f), readFileSync(join(modelSchemas, f), 'utf8').replaceAll('(PDA)', '(old)'));
    }
    expect(() => manifestProblem(minimal, { schemasDir: other })).toThrow(/not SDK 1\.9\.0's/);
    const empty = mkdtempSync(join(tmpdir(), 'emcc-schemas-'));
    expect(() => manifestProblem(minimal, { schemasDir: empty })).toThrow(MANIFEST_SCHEMA_ID);
  });
});
