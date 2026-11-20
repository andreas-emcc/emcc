import { SDK_VERSION, SHARED_LIBRARIES } from '@emc2/plugin-sdk';
import { describe, expect, it } from 'vitest';
import matching from '../../../../model/examples/sdk-version-matching.json';
import { pluginEntry } from '../testing/fakes.ts';
import { incompatibility, planLoad, webBase, type PluginEntry, type WebPlugin } from './plan.ts';

const ids = (plugins: readonly { readonly id: string }[]) => plugins.map((p) => p.id);
const reasons = (entries: readonly PluginEntry[]) => Object.fromEntries(planLoad(entries).refused.map((r) => [r.plugin.id, r.reason]));

describe('incompatibility', () => {
  const web = (fields: Parameters<typeof pluginEntry>[1]) => pluginEntry('p', fields) as WebPlugin;

  it('accepts the SDK range and the shared versions of this shell', () => {
    expect(incompatibility(web({ sdkVersion: '^1.0.0', web: { shared: { react: SHARED_LIBRARIES.react ?? '', ol: SHARED_LIBRARIES.ol ?? '' } } }))).toBeNull();
    expect(incompatibility(web({ sdkVersion: SDK_VERSION }))).toBeNull();
  });

  it('refuses another SDK range, an unreadable range and other shared versions', () => {
    expect(incompatibility(web({ sdkVersion: '^0.1.0' }))).toBe(`needs SDK ^0.1.0, but the shell has ${SDK_VERSION}`);
    expect(incompatibility(web({ sdkVersion: '^1.1.0' })), 'a 1.1.0 plugin on the 1.1.0 shell').toBeNull();
    expect(incompatibility(web({ sdkVersion: '^1.6.0' })), 'a 1.6.0 plugin on the 1.9.0 shell').toBeNull();
    expect(incompatibility(web({ sdkVersion: '^1.7.0' })), 'a 1.7.0 plugin on the 1.9.0 shell').toBeNull();
    expect(incompatibility(web({ sdkVersion: '^1.8.0' })), 'a 1.8.0 plugin on the 1.9.0 shell').toBeNull();
    expect(incompatibility(web({ sdkVersion: '^1.9.0' })), 'a 1.9.0 plugin on the 1.9.0 shell').toBeNull();
    expect(incompatibility(web({ sdkVersion: '^1.10.0' }))).toBe(`needs SDK ^1.10.0, but the shell has ${SDK_VERSION}`);
    expect(incompatibility(web({ sdkVersion: 'latest' }))).toMatch(/needs SDK latest/);
    expect(incompatibility(web({ sdkVersion: null }))).toMatch(/needs SDK/);
    expect(incompatibility(web({ web: { shared: { ol: '9.2.4' } } }))).toBe(`needs ol ^9.2.4, but the shell shares ${SHARED_LIBRARIES.ol ?? ''}`);
    expect(incompatibility(web({ web: { shared: { leaflet: '1.9.4' } } }))).toBe('was built against leaflet 1.9.4, which the shell does not share');
  });

  it('accepts a shared library built at an older version of the same major (SDK 1.9.0, CR-0048 point 2)', () => {
    expect(incompatibility(web({ web: { shared: { ol: '10.0.0', react: '19.0.0' } } }))).toBeNull();
    expect(incompatibility(web({ web: { shared: { ol: '10.99.0' } } }))).toBe(`needs ol ^10.99.0, but the shell shares ${SHARED_LIBRARIES.ol ?? ''}`);
    expect(incompatibility(web({ web: { shared: { react: '20.0.0' } } }))).toBe(`needs react ^20.0.0, but the shell shares ${SHARED_LIBRARIES.react ?? ''}`);
    expect(incompatibility(web({ web: { shared: { '@emc2/plugin-sdk': '1.0.0' } } })), 'the SDK by sdkVersion only').toBeNull();
  });

  it('follows the shared cases in model/examples/sdk-version-matching.json', () => {
    for (const c of matching.sharedCases) {
      const problem = incompatibility(web({ web: { shared: { [c.library]: c.built } } }), SDK_VERSION, { [c.library]: c.shell });
      expect(problem === null, `${c.library} built ${c.built} on a shell with ${c.shell}`).toBe(c.compatible);
    }
  });
});

describe('service keys of a plugin\'s own (model rule 24)', () => {
  it('refuses a plugin that provides a key of another plugin\'s id, never one of its own or emc2.*', () => {
    expect(reasons([
      pluginEntry('acme-tracks', { provides: ['acme-tracks.tracks', 'emc2.symbols'] }),
      pluginEntry('copycat', { provides: ['acme-tracks.tracks-2'] }),
      pluginEntry('user', { requires: ['acme-tracks.tracks'], uses: ['other.thing'] }),
    ])).toEqual({ copycat: 'provides acme-tracks.tracks-2, a key of the plugin acme-tracks; a plugin provides emc2.* keys or its own' });
  });
});

describe('the web part\'s folder', () => {
  it('is built from the plugin id, whatever the server says its url is', () => {
    expect(webBase('cot')).toBe('/plugins/cot/web/');
  });

  it('refuses a plugin whose id or files would load from elsewhere', () => {
    const reasons = (change: Partial<PluginEntry>, web: Partial<WebPlugin['web']> = {}) =>
      planLoad([pluginEntry('ok-plugin', { ...change, web: { entry: 'index.js', css: [], shared: {}, url: '/plugins/ok-plugin/web/', ...web } })])
        .refused.map((r) => r.reason);
    expect(reasons({})).toEqual([]);
    expect(reasons({}, { entry: 'nested/index.js', css: ['styles/a.css'] })).toEqual([]);
    expect(reasons({}, { url: 'https://evil.example/' }), 'the url is not used').toEqual([]);
    for (const entry of ['../other/web/index.js', '//evil.example/x.js', 'https://evil.example/x.js', '/index.js', 'a\\b.js', './index.js',
      'a//b.js', '', '%2e%2e/%2e%2e/other/web/x.js', '.%2e/x.js', 'a?b.js', 'a#b.js', 'a:b', '.\t./x.js', 'a b.js']) {
      expect(reasons({}, { entry }), entry).toEqual([`names the file "${entry}", which is not inside its web folder`]);
    }
    expect(reasons({}, { css: ['../x.css'] })).toEqual(['names the file "../x.css", which is not inside its web folder']);
    expect(planLoad([pluginEntry('Bad_Id')]).refused.map((r) => r.reason))
      .toEqual(['has an id that is not lowercase words separated by hyphens']);
  });
});

describe('planLoad', () => {
  it('loads only active plugins with a web part', () => {
    const plan = planLoad([pluginEntry('a'), pluginEntry('server-only', { web: null }), pluginEntry('off', { active: false })]);
    expect(ids(plan.load)).toEqual(['a']);
    expect(plan.refused).toEqual([]);
  });

  it('puts dependencies and service providers first, ties by id', () => {
    const plan = planLoad([
      pluginEntry('draw', { dependsOn: ['layers'], requires: ['emc2.symbols', 'emc2.map-view'] }),
      pluginEntry('map', { kind: 'map-view', provides: ['emc2.map-view'], requires: ['emc2.background-map'] }),
      pluginEntry('osm', { kind: 'background-map', provides: ['emc2.background-map'] }),
      pluginEntry('layers', { requires: ['emc2.map-view'] }),
      pluginEntry('symbols', { kind: 'utility', provides: ['emc2.symbols'] }),
      pluginEntry('coords', { kind: 'utility', provides: ['emc2.coordinates'] }),
    ]);
    expect(ids(plan.load)).toEqual(['coords', 'osm', 'map', 'layers', 'symbols', 'draw']);
  });

  it('orders the providers of used keys first, notes a used key nobody provides, never refuses for it (CR-0011)', () => {
    const plan = planLoad([
      pluginEntry('map', { kind: 'map-view', provides: ['emc2.map-view'], uses: ['emc2.symbols', 'emc2.coordinates'] }),
      pluginEntry('symbols', { kind: 'utility', provides: ['emc2.symbols'] }),
    ]);

    expect(ids(plan.load)).toEqual(['symbols', 'map']);
    expect(plan.refused).toEqual([]);
    expect(plan.notes.map((n) => [n.plugin.id, n.note])).toEqual([['map', 'uses emc2.coordinates, which no loaded plugin provides']]);
  });

  it('refuses a key in both requires and uses, and cycles through uses', () => {
    const plan = planLoad([
      pluginEntry('both', { requires: ['emc2.symbols'], uses: ['emc2.symbols'] }),
      pluginEntry('a', { provides: ['emc2.a'], uses: ['emc2.b'] }),
      pluginEntry('b', { provides: ['emc2.b'], requires: ['emc2.a'] }),
      pluginEntry('symbols', { provides: ['emc2.symbols'] }),
    ]);

    expect(ids(plan.load)).toEqual(['symbols']);
    expect(plan.refused.map((r) => [r.plugin.id, r.reason])).toEqual([
      ['both', 'lists emc2.symbols in both requires and uses; a key is in one of them'],
      ['a', 'is part of a cycle of dependencies and service keys (a, b)'],
      ['b', 'is part of a cycle of dependencies and service keys (a, b)'],
    ]);
  });

  it('a dependency on a server-only plugin needs no web part', () => {
    expect(ids(planLoad([pluginEntry('a', { dependsOn: ['srv'] }), pluginEntry('srv', { web: null })]).load)).toEqual(['a']);
  });

  it('refuses incompatible plugins and everything that needs them', () => {
    const entries = [
      pluginEntry('old', { web: { shared: { ol: '9.2.4' } }, provides: ['emc2.symbols'] }),
      pluginEntry('user', { requires: ['emc2.symbols'] }),
      pluginEntry('dependent', { dependsOn: ['user'] }),
      pluginEntry('fine'),
    ];
    expect(ids(planLoad(entries).load)).toEqual(['fine']);
    expect(reasons(entries)).toEqual({
      old: `needs ol ^9.2.4, but the shell shares ${SHARED_LIBRARIES.ol ?? ''}`,
      user: 'requires emc2.symbols, which no loaded plugin provides',
      dependent: 'depends on user, whose web part is not loaded',
    });
  });

  it('keeps a key available while another provider is loaded', () => {
    const plan = planLoad([
      pluginEntry('old', { web: { shared: { ol: '1.0.0' } }, provides: ['emc2.background-map'] }),
      pluginEntry('new', { provides: ['emc2.background-map'] }),
      pluginEntry('map', { requires: ['emc2.background-map'] }),
    ]);
    expect(ids(plan.load)).toEqual(['new', 'map']);
  });

  it('allows one map view: the first in the server\'s order', () => {
    const entries = [pluginEntry('second', { kind: 'map-view' }), pluginEntry('first', { kind: 'map-view' })];
    expect(ids(planLoad(entries).load)).toEqual(['second']);
    expect(reasons(entries)).toEqual({ first: 'another map view (second) is active; only one can be' });
  });

  it('refuses the plugins on a cycle, then those behind it', () => {
    const entries = [
      pluginEntry('a', { dependsOn: ['b'] }),
      pluginEntry('b', { requires: ['emc2.symbols'] }),
      pluginEntry('c', { provides: ['emc2.symbols'], dependsOn: ['a'] }),
      pluginEntry('behind', { dependsOn: ['c'] }),
      pluginEntry('free'),
    ];
    const plan = planLoad(entries);
    expect(ids(plan.load)).toEqual(['free']);
    expect(reasons(entries)).toEqual({
      a: 'is part of a cycle of dependencies and service keys (a, b, c)',
      b: 'is part of a cycle of dependencies and service keys (a, b, c)',
      c: 'is part of a cycle of dependencies and service keys (a, b, c)',
      behind: 'depends on c, whose web part is not loaded',
    });
  });

  it('a plugin that provides a key it requires does not wait for itself', () => {
    expect(ids(planLoad([pluginEntry('self', { provides: ['emc2.symbols'], requires: ['emc2.symbols'] })]).load)).toEqual(['self']);
  });
});
