// SDK 1.9.0 (M9, D3; gap G24; owner, 2026-11-17, ZU A): the manifest guard's schema check. A
// plugin's test calls manifestProblem(manifest) beside settingsTextProblem and settingsHintsProblem,
// so a wrong plugin.json is found by its own build, not first when ECore loads it.
//
// Build time only: this module runs in Node (a plugin's tests and vite.config.ts), never in the
// browser, so Ajv stays out of the shell's bundle.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { isReservedPluginId } from '../actions.ts';
import { SDK_VERSION } from '../version.ts';

/** The manifest schema's id, as the data model names it. */
export const MANIFEST_SCHEMA_ID = 'urn:emc2:schema:plugin-manifest';

/**
 * Where the data model's schemas are: the SDK package's own `schemas/` folder (the SDK kit puts them
 * there), else this repository's `model/schemas/`.
 */
function defaultSchemasDir(): string {
  for (const relative of ['../../schemas/', '../../../../model/schemas/']) {
    const dir = fileURLToPath(new URL(relative, import.meta.url));
    if (existsSync(join(dir, 'plugin-manifest.schema.json'))) {
      return dir;
    }
  }
  throw new Error('the data model schemas are missing: neither the SDK package\'s schemas/ nor the repository\'s model/schemas/ holds plugin-manifest.schema.json');
}

type Validate = ((data: unknown) => boolean) & { errors?: readonly { instancePath: string; message?: string; params?: unknown }[] | null };

const validators = new Map<string, Validate>();

/** The compiled manifest validator for `dir`, with the data model's own Ajv options; kept per folder. */
function validator(dir: string): Validate {
  const cached = validators.get(dir);
  if (cached) {
    return cached;
  }
  const ajv = new Ajv2020({ strict: true, strictTuples: false, strictRequired: false, allowUnionTypes: true, allErrors: true });
  addFormats(ajv);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.schema.json'))) {
    ajv.addSchema(JSON.parse(readFileSync(join(dir, file), 'utf8')) as object);
  }
  const validate = ajv.getSchema(MANIFEST_SCHEMA_ID) as Validate | undefined;
  if (!validate) {
    throw new Error(`${MANIFEST_SCHEMA_ID} is not among the schemas in ${dir}`);
  }
  const description = (validate as unknown as { schema?: { description?: string } }).schema?.description ?? '';
  if (!description.includes(`SDK ${SDK_VERSION} (PDA)`)) {
    throw new Error(`the schemas in ${dir} are not SDK ${SDK_VERSION}'s: use the schemas of the SDK you build against`);
  }
  validators.set(dir, validate);
  return validate;
}

/**
 * Why `manifest` (a parsed `plugin.json`) is not valid against the plugin manifest schema of this
 * SDK's data model, or `null` when it is. The text names each problem with its JSON pointer, e.g.
 * `/settings/properties/port: must have required property 'type'`, at most ten.
 *
 * It checks the schema, and the ids ECore keeps for itself (`core`, `core-…`; the schema refuses
 * the product's, `emc2`, `emcc` and the ids that start with them and a hyphen). The texts rule
 * (`settingsTextProblem`), the settings hints (`settingsHintsProblem`) and the rules the schema
 * cannot express (the data model's README) are checked apart; the template's guard, `web/test/manifest.test.ts`, calls all three.
 *
 * @param options.schemasDir the folder of the data model's `*.schema.json`; by default the SDK
 *     package's `schemas/`, else the repository's `model/schemas/`
 * @throws Error if the schemas are missing or are not this SDK version's
 */
export function manifestProblem(manifest: unknown, options: { readonly schemasDir?: string } = {}): string | null {
  const validate = validator(options.schemasDir ?? defaultSchemasDir());
  const id = typeof manifest === 'object' && manifest !== null ? (manifest as { id?: unknown }).id : undefined;
  const reserved = typeof id === 'string' && isReservedPluginId(id) ? '/id: the ids core and core-… are reserved for ECore' : null;
  if (validate(manifest)) {
    return reserved;
  }
  const errors = validate.errors ?? [];
  const lines = errors.slice(0, 10).map((e) => `${e.instancePath === '' ? '/' : e.instancePath}: ${e.message ?? 'is not valid'}${e.params && Object.keys(e.params).length > 0 ? ` ${JSON.stringify(e.params)}` : ''}`);
  if (errors.length > 10) {
    lines.push(`… and ${String(errors.length - 10)} more`);
  }
  return (reserved === null ? lines : [reserved, ...lines]).join('\n');
}
