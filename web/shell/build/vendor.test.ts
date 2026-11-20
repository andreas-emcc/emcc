// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SHARED_LIBRARIES } from '@emc2/plugin-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { importMapOf, olModules, vendorInputs, versionProblems } from './vendor.ts';

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("the vendor build's entries", () => {
  it('include every library the SDK shares, so none passes the version check but misses the import map', () => {
    const entries = Object.keys(vendorInputs('/sdk/index.ts', ['ol/Map', 'ol/View']));
    for (const pkg of Object.keys(SHARED_LIBRARIES)) {
      expect(entries.some((e) => e === pkg || e.startsWith(`${pkg}/`)), pkg).toBe(true);
    }
  });
});

describe('the shared library versions', () => {
  it('the shell depends on exactly the versions the SDK shares (overview 4.11)', () => {
    const shell = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> };
    expect(versionProblems(SHARED_LIBRARIES, SHARED_LIBRARIES, shell.dependencies)).toEqual([]);
  });

  it('names every library that differs, installed or declared', () => {
    expect(versionProblems({ ol: '10.10.0', proj4: '2.22.0' }, { ol: '10.9.0', proj4: '2.22.0' }, { ol: '10.10.0' })).toEqual([
      'ol: the SDK shares 10.10.0, but 10.9.0 is installed',
      'proj4: the SDK shares 2.22.0, but web/shell/package.json has no dependency',
    ]);
    expect(versionProblems({ milsymbol: '3.0.4' }, {}, { milsymbol: '^3.0.4' })).toEqual([
      'milsymbol: the SDK shares 3.0.4, but nothing is installed',
      'milsymbol: the SDK shares 3.0.4, but web/shell/package.json has ^3.0.4',
    ]);
  });
});

describe('the import map', () => {
  it('maps each built entry to its file, and OpenLayers modules with and without .js', () => {
    expect(importMapOf([
      { name: 'react', fileName: 'react-a1.js' },
      { name: 'react/jsx-runtime', fileName: 'react/jsx-runtime-b2.js' },
      { name: 'ol/index', fileName: 'ol/index-c3.js' },
      { name: 'ol/layer/Tile', fileName: 'ol/layer/Tile-d4.js' },
      { name: '@emc2/plugin-sdk', fileName: '@emc2/plugin-sdk-e5.js' },
    ])).toEqual({
      imports: {
        '@emc2/plugin-sdk': '/assets/vendor/@emc2/plugin-sdk-e5.js',
        ol: '/assets/vendor/ol/index-c3.js',
        'ol/index': '/assets/vendor/ol/index-c3.js',
        'ol/index.js': '/assets/vendor/ol/index-c3.js',
        'ol/layer/Tile': '/assets/vendor/ol/layer/Tile-d4.js',
        'ol/layer/Tile.js': '/assets/vendor/ol/layer/Tile-d4.js',
        react: '/assets/vendor/react-a1.js',
        'react/jsx-runtime': '/assets/vendor/react/jsx-runtime-b2.js',
      },
    });
  });

  it('finds every OpenLayers module, but not its prebuilt bundle or type declarations', () => {
    const ol = mkdtempSync(join(tmpdir(), 'emc2-ol-'));
    folders.push(ol);
    for (const dir of ['layer', 'dist', 'node_modules/x']) mkdirSync(join(ol, dir), { recursive: true });
    for (const file of ['index.js', 'Map.js', 'Map.d.ts', 'ol.css', 'layer/Tile.js', 'dist/ol.js', 'node_modules/x/y.js']) {
      writeFileSync(join(ol, file), '');
    }
    expect(olModules(ol)).toEqual(['ol/Map', 'ol/index', 'ol/layer/Tile']);
  });
});
