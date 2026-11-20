import { describe, expect, it } from 'vitest';
import { hasUnsaved, settingsEntries, shownEntry } from './settings/entries.ts';
import type { LoginInfo, PluginRow } from './store.ts';
import { hashOf, isAdmin, isOldPluginAddress, MONITOR, routeFromHash, SETTINGS, shownTab, tabLabel, tabsFor, VIEW, withoutLoginReturn } from './tabs.ts';

const row = (id: string, name: string, hasSettings: boolean, active = true): PluginRow => ({
  id, name, server: { active, state: 'OK', detail: '' }, load: 'active', loadDetail: '', reported: null, observed: null,
  notes: [], hasSettings, capabilities: [],
});
const plugins = [row('symbology', 'Symbology', true), row('layer-panel', 'Layers', false), row('cot', 'Cursor on Target', true, false),
  row('coordinates', 'Coordinates', true)];
const noLogin: LoginInfo = { mode: 'none', user: { id: 'local', name: 'Local user' } };
const admin: LoginInfo = { mode: 'oidc', user: { id: 'a', name: 'Alice', permissions: ['settings.admin', 'objects.edit'] } };
const user: LoginInfo = { mode: 'oidc', user: { id: 'b', name: 'Bob', permissions: ['objects.edit'] } };

describe('view tabs', () => {
  it('give View, Settings and Monitor to a user with settings.admin, no tab per plugin', () => {
    expect(tabsFor(admin)).toEqual([VIEW, SETTINGS, MONITOR]);
    expect(tabsFor(noLogin)).toEqual(tabsFor(admin)); // the local user has every permission
    expect([VIEW, SETTINGS, MONITOR].map((tab) => tabLabel(tab))).toEqual(['View', 'Settings', 'Monitor']);
  });

  it('give only View to anyone else, and before the login is known', () => {
    expect(tabsFor(user)).toEqual([VIEW]);
    expect(tabsFor(null)).toEqual([VIEW]);
    expect(tabsFor({ mode: 'oidc', user: null })).toEqual([VIEW]);
    expect(isAdmin(user)).toBe(false);
  });

  it('show the chosen tab only if the user sees it', () => {
    expect(shownTab(MONITOR, admin)).toBe(MONITOR);
    expect(shownTab(MONITOR, user)).toBe(VIEW);
    expect(shownTab('plugin/coordinates', admin)).toBe(VIEW);
  });

  it('are kept in the address with the Settings entry', () => {
    const routes = [{ tab: VIEW, entry: null }, { tab: SETTINGS, entry: null }, { tab: SETTINGS, entry: 'data-types' },
      { tab: SETTINGS, entry: 'plugin/coordinates' }, { tab: MONITOR, entry: null }];
    for (const route of routes) expect(routeFromHash(hashOf(route))).toEqual(route);
    expect(routes.map(hashOf)).toEqual(['', '#settings', '#settings/data-types', '#settings/plugin/coordinates', '#monitor']);
    expect(hashOf({ tab: MONITOR, entry: 'data-types' })).toBe('#monitor'); // an entry only in Settings
    expect(routeFromHash('#nonsense')).toEqual({ tab: VIEW, entry: null });
    expect(routeFromHash('#settings/')).toEqual({ tab: VIEW, entry: null });
    expect(routeFromHash('#%')).toEqual({ tab: VIEW, entry: null }); // malformed: decoding would throw
    expect(routeFromHash('#%E0%A4%A')).toEqual({ tab: VIEW, entry: null });
    expect(routeFromHash('#settings%2Fplugin%2Fcot')).toEqual({ tab: SETTINGS, entry: 'plugin/cot' });
  });

  it("open a plugin's Settings entry for an address of M1's plugin tabs", () => {
    expect(routeFromHash('#plugin/basemap-osm')).toEqual({ tab: SETTINGS, entry: 'plugin/basemap-osm' });
    expect(isOldPluginAddress('#plugin/basemap-osm')).toBe(true);
    expect(isOldPluginAddress('#plugin/')).toBe(false);
    expect(isOldPluginAddress('#settings/plugin/basemap-osm')).toBe(false);
    expect(isOldPluginAddress('#%')).toBe(false);
    expect(routeFromHash('#plugin/')).toEqual({ tab: VIEW, entry: null });
  });
});

describe('the Settings list', () => {
  it('has General, Display, Data types, Layers, Labeling, then one entry per running plugin with settings, by name', () => {
    expect(settingsEntries(plugins).map((e) => [e.id, e.label])).toEqual([
      ['general', 'General'], ['display', 'Display'], ['data-types', 'Data types'], ['layers', 'Layers'], ['labeling', 'Labeling'], ['plugin/coordinates', 'Coordinates'], ['plugin/symbology', 'Symbology'],
    ]);
    expect(settingsEntries([]).map((e) => e.id)).toEqual(['general', 'display', 'data-types', 'layers', 'labeling']);
  });

  it('has an entry for a running plugin without settings that declares fields (SDK 1.2.0)', () => {
    const ids = (withFields: ReadonlySet<string>) => settingsEntries([...plugins, row('tracks', 'Tracks', false)], withFields).map((e) => e.id);

    expect(ids(new Set(['tracks', 'cot']))).toEqual(['general', 'display', 'data-types', 'layers', 'labeling', 'plugin/coordinates', 'plugin/symbology', 'plugin/tracks']);
    expect(ids(new Set())).not.toContain('plugin/tracks');
  });

  it('has an entry for a running plugin without settings that declares compute threads (SDK 1.9.0)', () => {
    const fmv = { ...row('fmv', 'Full motion video', false), computeThreads: 4 };
    expect(settingsEntries([...plugins, fmv]).map((e) => e.id)).toContain('plugin/fmv');
    expect(settingsEntries([...plugins, { ...fmv, server: { ...fmv.server, active: false } }]).map((e) => e.id)).not.toContain('plugin/fmv');
  });

  it('shows the chosen entry, or the first one if it is not in the list', () => {
    const entries = settingsEntries(plugins);
    expect(shownEntry('plugin/symbology', entries).label).toBe('Symbology');
    expect(shownEntry(null, entries).id).toBe('general');
    expect(shownEntry('plugin/cot', entries).id).toBe('general'); // disabled
    expect(shownEntry('plugin/coordinates', settingsEntries([])).id).toBe('general'); // the list has not arrived yet
  });

  it('knows which entries have unsaved edits', () => {
    const [, display, dataTypes, layers, labeling, coordinates] = settingsEntries(plugins);
    if (display === undefined || dataTypes === undefined || layers === undefined || labeling === undefined || coordinates === undefined) {
      throw new Error('entries missing');
    }
    expect(hasUnsaved(labeling, ['labeling'])).toBe(true); // T-170: the one draft of the entry
    expect(hasUnsaved(labeling, ['plugin/coordinates'])).toBe(false);
    expect(hasUnsaved(display, ['data-type/core.general', 'plugin/coordinates'])).toBe(false); // its edits are the entry's own
    expect(hasUnsaved(layers, ['data-type/core.general', 'plugin/coordinates'])).toBe(false); // a change there applies at once
    expect(hasUnsaved(dataTypes, ['data-type/core.general'])).toBe(true);
    expect(hasUnsaved(dataTypes, ['plugin/coordinates'])).toBe(false);
    expect(hasUnsaved(coordinates, ['plugin/coordinates'])).toBe(true);
    expect(hasUnsaved(coordinates, ['plugin/coordinates-extra'])).toBe(false);
  });
});

describe("the login's return address", () => {
  it('drops only the continue that the login adds, and leaves an address without it alone', () => {
    expect(withoutLoginReturn('?continue')).toBe('');
    expect(withoutLoginReturn('?continue&x=1')).toBe('?x=1');
    expect(withoutLoginReturn('?continue&q=a%20b~c')).toBe('?q=a%20b~c'); // the rest exactly as written
    expect(withoutLoginReturn('?x=1&continue=')).toBe('?x=1');
    expect(withoutLoginReturn('?continued=1')).toBeNull();
    expect(withoutLoginReturn('?x=1')).toBeNull();
    expect(withoutLoginReturn('')).toBeNull();
  });
});
