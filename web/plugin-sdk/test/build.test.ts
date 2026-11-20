import { describe, expect, it } from 'vitest';
import sdkPackage from '../package.json';
import { isShared, sharedExternals, sharedPackageOf, withSharedVersions } from '../src/build/index.ts';
import { SDK_VERSION, SHARED_LIBRARIES } from '../src/version.ts';

type ResolveId = (this: { error(message: string): never }, id: string) => unknown;

function resolveWith(plugin: ReturnType<typeof sharedExternals>, id: string): unknown {
  const hook = plugin.resolveId as unknown as ResolveId;
  return hook.call({ error: (message: string) => { throw new Error(message); } }, id);
}

describe('shared library list', () => {
  it('equals the SDK package\'s peer dependencies (the SDK owns the list)', () => {
    const others = Object.fromEntries(Object.entries(SHARED_LIBRARIES).filter(([name]) => name !== '@emc2/plugin-sdk'));
    expect(sdkPackage.peerDependencies).toEqual(others);
  });

  it('carries the SDK\'s own version, which equals package.json', () => {
    expect(SDK_VERSION).toBe(sdkPackage.version);
    expect(SHARED_LIBRARIES['@emc2/plugin-sdk']).toBe(SDK_VERSION);
  });
});

describe('build plugin', () => {
  it('treats every module of a shared package as shared, but never CSS', () => {
    expect(isShared('react')).toBe(true);
    expect(sharedPackageOf('ol/Feature.js')).toBe('ol');
    expect(sharedPackageOf('react-dom/client')).toBe('react-dom');
    expect(isShared('@emc2/plugin-sdk')).toBe(true);
    expect(isShared('ol/ol.css')).toBe(false);
    expect(isShared('mgrs')).toBe(false);
    expect(isShared('react-domx')).toBe(false);
  });

  it('keeps shared modules external, records which packages were used, and fails on one the import map lacks', () => {
    const used = new Set<string>();
    const plugin = sharedExternals({ imports: { react: '/vendor/react-abc.js', 'ol/Feature.js': '/vendor/ol.js' } }, used);
    expect(resolveWith(plugin, 'react')).toEqual({ id: 'react', external: true });
    expect(resolveWith(plugin, 'ol/Feature.js')).toEqual({ id: 'ol/Feature.js', external: true });
    expect(resolveWith(plugin, 'mgrs')).toBeNull();
    expect(() => resolveWith(plugin, 'react-dom/server')).toThrow(/not in the shell's import map/);
    expect([...used].sort()).toEqual(['ol', 'react']);
  });

  it('writes only the used shared libraries into the manifest, at the SDK\'s versions, never by hand', () => {
    const out = withSharedVersions({ id: 'draw-symbols', web: { entry: 'index.js', shared: { react: '18.0.0' } } }, ['react', '@emc2/plugin-sdk']);
    expect(out.web?.shared).toEqual({ '@emc2/plugin-sdk': SDK_VERSION, react: '19.3.0' });
    expect(() => withSharedVersions({ id: 'server-only' }, [])).toThrow(/no "web" part/);
    expect(() => withSharedVersions({ id: 'x', web: { entry: 'index.js' } }, ['lodash'])).toThrow(/not a shared library/);
  });
});
