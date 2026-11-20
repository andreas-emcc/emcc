// @vitest-environment node
/**
 * Criterion 12, statically (review remark N5): OpenLayers stays inside `src/engine/`. The MapView is
 * built in `src/core/` against the `Engine` interface, so if no file there (or in the UI) can reach
 * OpenLayers, no OpenLayers type can appear in what the plugin exposes. The runtime half of the
 * check is in `engine/olEngine.test.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** What a file imports, as written: `from '…'`, `import '…'` and `import('…')`. */
function importsOf(text: string): string[] {
  return [...text.matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
}

const files = sources(SRC).map((path) => ({ name: relative(SRC, path).split(sep).join('/'), imports: importsOf(readFileSync(path, 'utf-8')) }));
const isOpenLayers = (specifier: string) => specifier === 'ol' || specifier.startsWith('ol/');

describe('criterion 12: no OpenLayers outside the engine (review remark N5)', () => {
  it('finds the source files and their imports', () => {
    expect(files.map((f) => f.name)).toEqual(expect.arrayContaining(['core/controller.ts', 'engine/olEngine.ts', 'index.tsx']));
    expect(files.find((f) => f.name === 'engine/olEngine.ts')?.imports).toContain('ol/Map.js');
  });

  it('only files in src/engine import OpenLayers', () => {
    const outside = files.filter((f) => !f.name.startsWith('engine/') && f.imports.some(isOpenLayers)).map((f) => f.name);
    expect(outside).toEqual([]);
  });

  it('core and UI do not import the engine; the plugin entry picks the OpenLayers engine, activation only the null engine', () => {
    for (const f of files) {
      const engineImports = f.imports.filter((s) => /(^|\/)engine\//.test(s));
      if (f.name.startsWith('core/') || f.name.startsWith('ui/')) expect(engineImports, f.name).toEqual([]);
      if (f.name === 'activate.tsx') expect(engineImports).toEqual(['./engine/nullEngine.ts']);
      if (f.name === 'index.tsx') expect(engineImports).toEqual(['./engine/olEngine.ts']);
    }
  });
});
