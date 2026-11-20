// SDK 1.8.0 part F (CR-0047; owner WF A and WE A, 2026-11-15): a stable id for each item of a settings list.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formSections, itemColumns, itemId, settingsHintsProblem, uuidv7, type SettingsSchema } from '../src/index.ts';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const example = JSON.parse(readFileSync(join(repo, 'model/examples/valid/manifest-settings-form-hints.json'), 'utf8')) as { settings: SettingsSchema };
const links = example.settings.properties!.links!;
const link = links.items!;
const ID = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

describe('SDK 1.8.0 part F: itemId', () => {
  it('gives the id the list names, else null', () => {
    expect(links['x-emc2']!.item!.id).toBe('id');
    expect(itemId(links, { id: ID, name: 'North' })).toBe(ID);
    const fresh = uuidv7();
    expect(itemId(links, { id: fresh })).toBe(fresh);
    for (const value of [{ name: 'North' }, { id: '' }, { id: 7 }, null, 'x', [ID]]) expect(itemId(links, value), JSON.stringify(value)).toBeNull();
    const withoutId: SettingsSchema = { ...links, 'x-emc2': { item: { name: 'name', noun: 'link' } } };
    expect(itemId(withoutId, { id: ID })).toBeNull();
    const { 'x-emc2': _ignored, ...bare } = links;
    expect(itemId(bare, { id: ID })).toBeNull();
  });
});

describe('SDK 1.8.0 part F: the form leaves the id out', () => {
  it('leaves it out of the item\'s sections when given the list, and keeps it otherwise', () => {
    const shown = (sections: ReturnType<typeof formSections>) => sections.flatMap((s) => s.properties);
    expect(shown(formSections(link, links))).not.toContain('id');
    expect(shown(formSections(link))).toContain('id');
    expect(shown(formSections(link, links)).sort()).toEqual(shown(formSections(link)).filter((p) => p !== 'id').sort());
    // a list whose items are not this schema leaves nothing out
    expect(shown(formSections(link, { ...links, items: { ...link } }))).toContain('id');
  });

  it('leaves it out of a group too, and drops a group left empty', () => {
    const grouped: SettingsSchema = { ...link, 'x-emc2': { groups: [{ id: 'keys', label: 'Keys', properties: ['id'] }, { id: 'more', label: 'More', properties: ['id', 'host'] }] } };
    const list: SettingsSchema = { ...links, items: grouped };
    const sections = formSections(grouped, list);
    expect(sections.map((s) => s.id)).not.toContain('keys');
    expect(sections.find((s) => s.id === 'more')!.properties).toEqual(['host']);
  });

  it('never takes the id as a default column', () => {
    // an id short by type (a UUID is 36 characters, so no real one is) would else be the first column
    const short: SettingsSchema = { ...link, properties: { ...link.properties, id: { type: 'string', maxLength: 24, readOnly: true } } };
    expect(itemColumns({ ...links, items: short, 'x-emc2': { item: { name: 'name', noun: 'link', id: 'id' } } })).not.toContain('id');
    expect(itemColumns({ ...links, items: short, 'x-emc2': { item: { name: 'name', noun: 'link' } } })).toContain('id');
  });
});

describe('SDK 1.8.0 part F: settingsHintsProblem checks item.id', () => {
  it('passes the example and refuses an id that is not a separate string property', () => {
    expect(settingsHintsProblem(example.settings)).toBeNull();
    const bad = (item: object, groups?: object) => {
      const copy = structuredClone(example.settings) as { properties: { links: { 'x-emc2': object; items: { 'x-emc2': { groups: object } } } } };
      copy.properties.links['x-emc2'] = { item };
      if (groups !== undefined) copy.properties.links.items['x-emc2'].groups = groups;
      return settingsHintsProblem(copy);
    };
    expect(bad({ name: 'name', noun: 'link', id: 'nope' })).toBe('/properties/links/x-emc2: item id is not a string property of the items');
    expect(bad({ name: 'name', noun: 'link', id: 'jobId' })).toContain('id is not a string property');
    expect(bad({ name: 'name', noun: 'link', id: 'name' })).toContain('id is also the name or the state');
    expect(bad({ name: 'name', noun: 'link', id: 'id', columns: ['id'] })).toContain('id is also a column');
    expect(bad({ name: 'name', noun: 'link', id: 'id' }, [{ id: 'a', label: 'A', properties: ['id', 'host'] }])).toContain('id is in a group of the items');
    expect(bad({ name: 'name', noun: 'link', id: 'id' }, [{ id: 'a', label: 'A', properties: ['host'] }])).toBeNull();
    expect(bad({ name: 'name', noun: 'link' })).toBeNull();
  });
});
