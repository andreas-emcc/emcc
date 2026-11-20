/**
 * The build side of the SDK, for a plugin's `vite.config.ts` (S4 rec. 11 and 12):
 * keeps the shared libraries external, fails the build on a shared module the shell's import map
 * lacks, and writes the plugin's manifest into the build output with `web.shared` listing the
 * shared libraries the plugin actually imports, at the SDK's versions. The shell compares only
 * those (and refuses the plugin if one differs).
 *
 * The import map comes from the shell's build (`web/shell/dist/importmap.json`); the shell is
 * built first. `@emc2/plugin-sdk/build` and `@emc2/plugin-sdk/testing` are never in the import map.
 *
 * @example
 * // plugins/draw-symbols/web/vite.config.ts
 * import { defineConfig } from 'vite';
 * import { emc2Plugin } from '@emc2/plugin-sdk/build';
 * import manifest from '../plugin.json' with { type: 'json' };
 * import importMap from '../../../web/shell/dist/importmap.json' with { type: 'json' };
 *
 * export default defineConfig({
 *   plugins: [emc2Plugin({ manifest, importMap })],
 *   build: { lib: { entry: 'src/index.tsx', formats: ['es'], fileName: 'index' }, cssCodeSplit: false },
 * });
 */
import type { Plugin } from 'vite';
import { SHARED_LIBRARIES } from '../version.ts';

export { MANIFEST_SCHEMA_ID, manifestProblem } from './manifest.ts';

/** The shared npm packages (S4). Every module of them is external in plugin builds. */
export const SHARED_PACKAGES: readonly string[] = Object.keys(SHARED_LIBRARIES);

/** The shared package `id` (an import specifier) belongs to, or null. CSS is never shared (S4 rec. 13). */
export function sharedPackageOf(id: string): string | null {
  if (id.endsWith('.css')) return null;
  return SHARED_PACKAGES.find((p) => id === p || id.startsWith(`${p}/`)) ?? null;
}

/** True if `id` belongs to a shared package. */
export function isShared(id: string): boolean {
  return sharedPackageOf(id) !== null;
}

/** The shell's import map (from its vendor build), `{ imports: { specifier: url } }`. */
export interface ImportMap {
  readonly imports: Readonly<Record<string, string>>;
}

/**
 * Keeps shared modules external. A shared module that the shell's import map does not provide
 * fails the build, naming the module (S4). `used` collects the shared packages imported.
 */
export function sharedExternals(importMap: ImportMap, used: Set<string> = new Set()): Plugin {
  return {
    name: 'emc2-shared-externals',
    enforce: 'pre',
    resolveId(id) {
      const pkg = sharedPackageOf(id);
      if (pkg === null) return null;
      if (!Object.hasOwn(importMap.imports, id)) {
        this.error(`"${id}" belongs to a shared library but is not in the shell's import map. Import a module the shell provides.`);
      }
      used.add(pkg);
      return { id, external: true };
    },
  };
}

/** A plugin manifest, as far as the build needs it. */
export interface ManifestInput {
  readonly id: string;
  readonly web?: { readonly entry: string; readonly css?: readonly string[]; readonly shared?: Readonly<Record<string, string>> };
  readonly [field: string]: unknown;
}

/** The manifest with `web.shared` set to the SDK's versions of the `used` shared libraries (never written by hand). */
export function withSharedVersions(manifest: ManifestInput, used: Iterable<string>): ManifestInput {
  if (!manifest.web) {
    throw new Error(`manifest of ${manifest.id} has no "web" part`);
  }
  const shared: Record<string, string> = {};
  for (const pkg of [...used].sort()) {
    const version = SHARED_LIBRARIES[pkg];
    if (version === undefined) throw new Error(`${pkg} is not a shared library`);
    shared[pkg] = version;
  }
  return { ...manifest, web: { ...manifest.web, shared } };
}

/** Emits `plugin.json`, with `web.shared` filled in, next to the built web part. */
export function manifestWriter(manifest: ManifestInput, used: ReadonlySet<string>): Plugin {
  return {
    name: 'emc2-manifest',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'plugin.json', source: `${JSON.stringify(withSharedVersions(manifest, used), null, 2)}\n` });
    },
  };
}

/** Both build plugins together. The shell's import map is required. */
export function emc2Plugin(options: { readonly manifest: ManifestInput; readonly importMap: ImportMap }): Plugin[] {
  const used = new Set<string>();
  return [sharedExternals(options.importMap, used), manifestWriter(options.manifest, used)];
}
