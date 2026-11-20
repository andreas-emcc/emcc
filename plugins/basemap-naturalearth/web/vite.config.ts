// Build and test of the plugin's web part. The build writes dist/: index.js (the entry module),
// <id>.css and plugin.json (with web.shared filled in by the SDK). Shared libraries stay
// external; the shell's import map provides them at runtime.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { emc2Plugin, type ImportMap } from '@emc2/plugin-sdk/build';
import manifest from '../plugin.json' with { type: 'json' };
import { SHIPPED_FILE, convert } from './scripts/convert.ts';

const dataDir = fileURLToPath(new URL('../data', import.meta.url));
const shellImportMap = fileURLToPath(new URL('../../../web/shell/dist/importmap.json', import.meta.url));

/** Converts the original Natural Earth files in ../data into the shipped data file (scripts/convert.ts). Deterministic; dist/ is never committed. */
function naturalEarthData(): Plugin {
  return {
    name: 'emc2-natural-earth-data',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: SHIPPED_FILE, source: convert(dataDir) });
    },
  };
}

/** The SDK's build plugins, checked against the shell's import map: the shell is built first (it is the first workspace). */
function buildPlugins(): Plugin[] {
  if (!existsSync(shellImportMap)) {
    throw new Error(`${shellImportMap} is missing: build the shell first (npm run build -w @emc2/shell, or npm run build --workspaces at the repository root).`);
  }
  return emc2Plugin({ manifest, importMap: JSON.parse(readFileSync(shellImportMap, 'utf8')) as ImportMap });
}

export default defineConfig(({ command }) => ({
  // Only for the build: tests import shared libraries and the SDK's test kit normally.
  plugins: command === 'build' ? [...buildPlugins(), naturalEarthData()] : [],
  build: {
    lib: { entry: 'src/index.tsx', formats: ['es'], fileName: 'index', cssFileName: manifest.id },
    cssCodeSplit: false,
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
  },
}));
