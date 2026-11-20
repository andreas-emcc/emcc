// SDK 1.8.0 part D (CR-0043; owner UZ A, 2026-11-14; T-203 parts C to E): the settings schema's hints.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Radar } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import {
  PLUGIN_ICONS, PLUGIN_ICON_PATTERN, fieldHint, fieldWidth, formSections, itemColumns, itemName, itemWords, pluginIcon,
  settingsHintsProblem, type SettingsSchema,
} from '../src/index.ts';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const example = JSON.parse(readFileSync(join(repo, 'model/examples/valid/manifest-settings-form-hints.json'), 'utf8')) as { icon: string; settings: SettingsSchema };
const links = example.settings.properties!.links!;
const link = links.items!;

describe('SDK 1.8.0 part D: hints and widths', () => {
  it('shows the hint under the field and the description behind the button, else a short description as the hint', () => {
    expect(fieldHint(link.properties!.host!)).toEqual({ hint: 'The peer\'s host name or address', more: expect.stringContaining('info button') });
    expect(fieldHint(example.settings.properties!.pairingColour!)).toEqual({ hint: expect.stringContaining('short description'), more: null });
    expect(fieldHint({ type: 'string', description: 'x'.repeat(81) })).toEqual({ hint: null, more: 'x'.repeat(81) });
    expect(fieldHint({ type: 'string' })).toEqual({ hint: null, more: null });
  });

  it('makes numbers, booleans, enums, colours and short strings short, unless the schema says', () => {
    expect(fieldWidth(link.properties!.idleSeconds!)).toBe('short');
    expect(fieldWidth(link.properties!.enabled!)).toBe('short');
    expect(fieldWidth(link.properties!.mode!)).toBe('short');
    expect(fieldWidth(example.settings.properties!.pairingColour!)).toBe('short');
    expect(fieldWidth(link.properties!.host!)).toBe('full');
    expect(fieldWidth(link.properties!.name!)).toBe('full');
    expect(fieldWidth({ type: 'string', maxLength: 24 })).toBe('short');
    expect(fieldWidth({ type: 'number', 'x-emc2': { width: 'full' } })).toBe('full');
  });
});

describe('SDK 1.8.0 part D: lists as a table with a side form', () => {
  it('names an item by its name, else "New link" before it is saved and "Link 3" after', () => {
    expect(itemName(links, { name: 'AFSERS north' }, 0, true)).toBe('AFSERS north');
    expect(itemName(links, { name: '  ' }, 0, false)).toBe('New link');
    expect(itemName(links, { name: '' }, 2, true)).toBe('Link 3');
    expect(itemName({ type: 'array', title: 'Servers', items: { type: 'object', properties: {} } }, {}, 1, true)).toBe('Servers 2');
    expect(itemWords(links)).toEqual({ noun: 'link', add: 'Add link', remove: 'Delete link?', fresh: 'New link' });
  });

  it('takes the named columns, else up to three short ones without the name and the state', () => {
    expect(itemColumns(links)).toEqual(['direction', 'mode']);
    const { columns: _ignored, ...item } = links['x-emc2']!.item!;
    expect(itemColumns({ ...links, 'x-emc2': { item } })).toEqual(['direction', 'mode', 'port']);
  });
});

describe('SDK 1.8.0 part D: groups', () => {
  it('puts the free fields first, then the groups, nested objects, and Advanced last and folded', () => {
    const sections = formSections(link, links); // the id left out (part F)
    expect(sections.map((s) => [s.id, s.properties, s.folded])).toEqual([
      [null, ['name', 'enabled', 'direction'], false],
      ['connection', ['mode', 'host', 'port'], false],
      ['advanced', ['idleSeconds', 'jobId'], true],
    ]);
    const nested = formSections({ type: 'object', properties: { a: { type: 'number' }, colour: { type: 'object', title: 'Colour', properties: { use: { enum: ['fixed'] } } } } });
    expect(nested.map((s) => [s.id, s.label, s.object])).toEqual([[null, null, undefined], ['colour', 'Colour', 'colour']]);
  });
});

describe('SDK 1.8.0 part D: the plugin\'s icon', () => {
  it('is a name from the fixed list, else none', () => {
    expect(pluginIcon(example.icon)).toBe(Radar);
    expect(pluginIcon('Banana')).toBeNull();
    expect(pluginIcon('toString')).toBeNull();
    expect(pluginIcon(undefined)).toBeNull();
    for (const name of Object.keys(PLUGIN_ICONS)) expect(name).toMatch(new RegExp(PLUGIN_ICON_PATTERN));
  });
});

describe('SDK 1.8.0 part D: settingsHintsProblem', () => {
  it('passes the example and names the first wrong annotation', () => {
    expect(settingsHintsProblem(example.settings)).toBeNull();
    const bad = (annotation: object, at: 'link' | 'host' | 'links' = 'host') => {
      const copy = structuredClone(example.settings) as { properties: { links: { 'x-emc2': object; items: { 'x-emc2': object; properties: { host: { 'x-emc2': object } } } } } };
      if (at === 'host') copy.properties.links.items.properties.host['x-emc2'] = annotation;
      else if (at === 'link') copy.properties.links.items['x-emc2'] = annotation;
      else copy.properties.links['x-emc2'] = annotation;
      return settingsHintsProblem(copy);
    };
    expect(bad({ hint: 'x'.repeat(81) })).toBe('/properties/links/items/properties/host/x-emc2: hint is not 1 to 80 characters');
    expect(bad({ visibleWhen: { property: 'nope', in: ['udp'] } })).toContain('names nope, not a sibling');
    expect(bad({ unit: 's' })).toContain('unit is on a field that is not a number');
    expect(bad({ colour: true })).toContain('unknown key colour');
    expect(bad({ groups: [{ id: 'a', label: 'A', properties: ['nope'] }] }, 'link')).toContain('names nope, not a property of the object');
    expect(bad({ groups: [{ id: 'a', label: 'A', properties: ['host'] }, { id: 'b', label: 'B', properties: ['host'] }] }, 'link')).toContain('already in a group');
    expect(bad({ item: { name: 'enabled', noun: 'link' } }, 'links')).toContain('name is not a string property');
    expect(bad({ item: { name: 'name', noun: 'Link' } }, 'links')).toContain('noun is not');
    expect(bad({ item: { name: 'name', noun: 'link', state: 'name' } }, 'links')).toContain('state is not a boolean');
    expect(bad({ item: { name: 'name', noun: 'link', columns: ['host', 'nope'] } }, 'links')).toContain('columns names nope');
    const nested = (levels: number): unknown => {
      let inner: Record<string, unknown> = { type: 'object', properties: { a: { type: 'number' } }, 'x-emc2': { groups: [{ id: 'g', label: 'G', properties: ['a'] }] } };
      for (let i = 0; i < levels; i++) inner = { type: 'object', properties: { o: inner } };
      return inner;
    };
    expect(settingsHintsProblem(nested(0))).toBeNull();
    expect(settingsHintsProblem(nested(1))).toBeNull();
    expect(settingsHintsProblem(nested(2))).toContain('nested deeper than one level');
  });

  it('passes every plugin\'s settings schema in plugins/', () => {
    const plugins = readdirSync(join(repo, 'plugins')).filter((id) => existsSync(join(repo, 'plugins', id, 'plugin.json')));
    expect(plugins.length).toBeGreaterThan(15);
    for (const id of plugins) {
      const manifest = JSON.parse(readFileSync(join(repo, 'plugins', id, 'plugin.json'), 'utf8')) as { settings?: unknown; icon?: unknown };
      expect(settingsHintsProblem(manifest.settings), id).toBeNull();
      if (manifest.icon !== undefined) expect(pluginIcon(manifest.icon), `${id}'s icon`).not.toBeNull();
    }
  });
});
