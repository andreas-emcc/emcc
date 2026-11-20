/**
 * The shell's vendor build (spike S4, overview 4.11): the shared libraries as ES modules, one entry
 * per importable module, with content-hashed names, and the import map that names them.
 *
 * - The list of shared libraries and their versions is the SDK's (`SHARED_LIBRARIES`); the shell
 *   never defines a second one. The build fails if an installed library or the shell's own
 *   dependency has another version.
 * - React is CommonJS: each React module gets a generated ES module wrapper (S4 rec. 2).
 * - OpenLayers: every module is its own import map entry (`ol/Map` and `ol/Map.js`), all built into
 *   one chunk (S4 rec. 3).
 * - `@emc2/plugin-sdk` is built from its TypeScript sources, main entry only; `./build` and
 *   `./testing` are never in the import map.
 * - Packages are found through Node's module resolution, never by a path to a `node_modules`
 *   folder (CR-0006: `node_modules` is at the repository root).
 *
 * Output: `<outDir>/assets/vendor/` (cached for a year by the server, like all of `assets/`) and
 * `<outDir>/importmap.json`, which plugin builds read (`emc2Plugin` in `@emc2/plugin-sdk/build`).
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { build, type Plugin } from 'vite';
import { SHARED_LIBRARIES } from '@emc2/plugin-sdk';
import type { ImportMap } from '@emc2/plugin-sdk/build';

/** The URL folder of the vendor files. */
export const VENDOR_URL = '/assets/vendor/';

/** The React modules plugins may import. Other React modules (server rendering, tests) are not shared. */
export const REACT_MODULES: readonly string[] = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'];

const SDK = '@emc2/plugin-sdk';
const CJS_PREFIX = 'emc2-cjs:';

interface PackageJson {
  readonly name?: string;
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
}

/** Reads a package's `package.json`, also for packages whose export map hides it. */
function packageJsonOf(require: NodeJS.Require, pkg: string): { readonly dir: string; readonly json: PackageJson } {
  let dir: string;
  try {
    dir = dirname(require.resolve(`${pkg}/package.json`));
  } catch {
    dir = dirname(require.resolve(pkg));
    while (!isPackageRoot(dir, pkg)) {
      const parent = dirname(dir);
      if (parent === dir) throw new Error(`no package.json found for ${pkg}`);
      dir = parent;
    }
  }
  return { dir, json: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageJson };
}

function isPackageRoot(dir: string, pkg: string): boolean {
  try {
    return (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageJson).name === pkg;
  } catch {
    return false;
  }
}

/**
 * Differences between the SDK's list and what is installed or declared by the shell, one line each.
 * Empty when everything matches.
 */
export function versionProblems(
  shared: Readonly<Record<string, string>>,
  installed: Readonly<Record<string, string | undefined>>,
  declared: Readonly<Record<string, string>>,
): string[] {
  const problems: string[] = [];
  for (const [pkg, version] of Object.entries(shared)) {
    if (installed[pkg] !== version) {
      problems.push(`${pkg}: the SDK shares ${version}, but ${installed[pkg] ?? 'nothing'} is installed`);
    }
    if (declared[pkg] !== version) {
      problems.push(`${pkg}: the SDK shares ${version}, but web/shell/package.json has ${declared[pkg] ?? 'no dependency'}`);
    }
  }
  return problems;
}

/** Every module of OpenLayers, as specifiers without the `.js` suffix: `ol/Map`, `ol/layer/Tile`, … */
export function olModules(olDir: string): string[] {
  const modules: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== 'dist' && name !== 'node_modules') walk(full);
      } else if (name.endsWith('.js')) {
        modules.push(`ol/${relative(olDir, full).replaceAll('\\', '/').slice(0, -'.js'.length)}`);
      }
    }
  };
  walk(olDir);
  return modules.sort();
}

/** One built entry: its name (the specifier) and its file below the vendor folder. */
export interface VendorEntry {
  readonly name: string;
  readonly fileName: string;
}

/**
 * The import map for the built entries. OpenLayers modules are reachable with and without `.js`,
 * and `ol` itself is `ol/index`, as in the package.
 */
export function importMapOf(entries: readonly VendorEntry[]): ImportMap {
  const imports: Record<string, string> = {};
  for (const { name, fileName } of entries) {
    const url = VENDOR_URL + fileName;
    imports[name] = url;
    if (name.startsWith('ol/')) {
      imports[`${name}.js`] = url;
      if (name === 'ol/index') imports.ol = url;
    }
  }
  return { imports: Object.fromEntries(Object.entries(imports).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) };
}

/** ES module wrappers for CommonJS modules: re-export every name the module has at runtime (S4 rec. 2). */
function cjsWrappers(require: NodeJS.Require): Plugin {
  return {
    name: 'emc2-cjs-wrappers',
    resolveId(id) {
      return id.startsWith(CJS_PREFIX) ? `\0${id}` : null;
    },
    load(id) {
      if (!id.startsWith(`\0${CJS_PREFIX}`)) return null;
      const specifier = id.slice(CJS_PREFIX.length + 1);
      const names = Object.keys(require(specifier) as object).filter((n) => n !== 'default' && /^[A-Za-z_$][\w$]*$/.test(n));
      return [
        `import m from ${JSON.stringify(specifier)};`,
        ...names.map((n) => `export const ${n} = m.${n};`),
        'export default m;',
      ].join('\n');
    },
  };
}

/**
 * Builds the shared libraries into `<outDir>/assets/vendor/` and writes `<outDir>/importmap.json`.
 * Empties `outDir` first: the shell's own build adds its files afterwards.
 */
/** The vendor build's entries: import specifier → what to build for it. */
export function vendorInputs(sdkEntry: string, olModuleNames: readonly string[]): Record<string, string> {
  const input: Record<string, string> = {};
  for (const m of REACT_MODULES) input[m] = CJS_PREFIX + m;
  input.milsymbol = 'milsymbol';
  input.proj4 = 'proj4';
  // All of Lucide as one module: plugins import any icon by name (CR-0015; owner, 2026-10-15: the whole set).
  input['lucide-react'] = 'lucide-react';
  input[SDK] = sdkEntry;
  for (const m of olModuleNames) input[m] = `${m}.js`;
  return input;
}

export async function buildVendor(options: { readonly shellDir: string; readonly outDir: string }): Promise<ImportMap> {
  const require = createRequire(join(options.shellDir, 'package.json'));
  const shell = JSON.parse(readFileSync(join(options.shellDir, 'package.json'), 'utf8')) as PackageJson;

  const installed: Record<string, string | undefined> = {};
  for (const pkg of Object.keys(SHARED_LIBRARIES)) installed[pkg] = packageJsonOf(require, pkg).json.version;
  const problems = versionProblems(SHARED_LIBRARIES, installed, shell.dependencies ?? {});
  if (problems.length > 0) {
    throw new Error(`The shared libraries do not match the SDK's list (SHARED_LIBRARIES):\n  ${problems.join('\n  ')}`);
  }

  const input = vendorInputs(require.resolve(SDK), olModules(packageJsonOf(require, 'ol').dir));

  rmSync(options.outDir, { recursive: true, force: true });
  mkdirSync(options.outDir, { recursive: true });
  const result = await build({
    configFile: false,
    root: options.shellDir,
    logLevel: 'warn',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [cjsWrappers(require)],
    build: {
      outDir: join(options.outDir, VENDOR_URL.slice(1)),
      emptyOutDir: false,
      copyPublicDir: false,
      minify: true,
      modulePreload: false,
      reportCompressedSize: false,
      // OpenLayers is one chunk on purpose (S4 rec. 3), and milsymbol has every standard in it.
      chunkSizeWarningLimit: 2_000,
      // Not library mode: it takes entries as file paths, and these are package specifiers.
      rolldownOptions: {
        input,
        preserveEntrySignatures: 'strict',
        output: {
          entryFileNames: '[name]-[hash].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          codeSplitting: { groups: [{ name: 'ol', test: /[\\/]node_modules[\\/]ol[\\/]/ }] },
        },
      },
    },
  });

  const entries: VendorEntry[] = [];
  for (const output of [result].flat()) {
    if (!('output' in output)) throw new Error('the vendor build returned no output');
    for (const chunk of output.output) {
      if (chunk.type === 'chunk' && chunk.isEntry) entries.push({ name: chunk.name, fileName: chunk.fileName });
    }
  }
  const missing = Object.keys(input).filter((name) => !entries.some((e) => e.name === name));
  if (missing.length > 0) throw new Error(`the vendor build lacks entries: ${missing.join(', ')}`);

  const importMap = importMapOf(entries);
  writeFileSync(join(options.outDir, 'importmap.json'), `${JSON.stringify(importMap, null, 2)}\n`);
  return importMap;
}
