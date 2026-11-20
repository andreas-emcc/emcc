import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import shared from '../../../model/examples/sdk-version-matching.json';
import {
  DEFAULT_DISPLAY, FRIENDLY_GRAPHIC_COLOURS, displayChoicesProblem, displaySettingsProblem, friendlyGraphicColourOf, resolveDisplay,
} from '../src/display.ts';
import { MAP_VIEW, serviceKey, serviceKeyOwner } from '../src/services.ts';
import { DESCRIPTION_MAX, TITLE_MAX, formSections, settingsHintsProblem, settingsTextProblem } from '../src/settings-form.ts';
import type { SettingsSchema } from '../src/settings-form.ts';
import { SDK_PACKAGE, compatibleShared } from '../src/version.ts';

/** SDK 1.9.0 part P (CR-0048, approved by the owner 2026-11-16, ZB A; PQ1 to PQ5 A). */
describe('SDK 1.9.0 part P', () => {
  describe('point 1: the settings texts and the TLS credential field', () => {
    const shown = (extra: Record<string, unknown> = {}) => ({ type: 'string', title: 'Name', description: 'What it is called.', ...extra });

    it('every shown setting has a title and a description, at every depth', () => {
      expect(settingsTextProblem({ type: 'object', properties: { name: shown() } })).toBeNull();
      expect(settingsTextProblem({ type: 'object', properties: { port: { type: 'integer', title: 'Port' } } })).toBe('/properties/port: has no description of 1 to 512 characters');
      expect(settingsTextProblem({ type: 'object', properties: { port: { type: 'integer', description: 'The port.' } } })).toBe('/properties/port: has no title of 1 to 64 characters');
      expect(settingsTextProblem({ type: 'object', properties: { name: shown({ title: 'x'.repeat(TITLE_MAX + 1) }) } })).toMatch(/no title/);
      expect(settingsTextProblem({ type: 'object', properties: { name: shown({ description: 'x'.repeat(DESCRIPTION_MAX + 1) }) } })).toMatch(/no description/);
      expect(settingsTextProblem({ type: 'object', properties: { name: shown({ title: '  ' }) } })).toMatch(/no title/);
      // a nested object and a list's items
      const nested = { type: 'object', properties: { server: { ...shown({ type: 'object' }), properties: { host: { type: 'string', title: 'Host' } } } } };
      expect(settingsTextProblem(nested)).toBe('/properties/server/properties/host: has no description of 1 to 512 characters');
      const list = {
        type: 'object',
        properties: {
          links: {
            ...shown({ type: 'array' }),
            'x-emc2': { item: { name: 'name', noun: 'link', id: 'id' } },
            items: { type: 'object', properties: { id: { type: 'string' }, name: shown(), port: { type: 'integer', title: 'Port' } } },
          },
        },
      };
      expect(settingsTextProblem(list)).toBe('/properties/links/items/properties/port: has no description of 1 to 512 characters');
    });

    it('exempts the item id and the inside of a kind field, and asks a description of every group', () => {
      const layer = { ...shown({ type: 'object' }), 'x-emc2': { kind: 'layer' }, properties: { id: { type: 'string' }, name: { type: 'string' } } };
      const items = { type: 'object', properties: { id: { type: 'string' }, name: shown() } };
      const ok = { type: 'object', properties: { layer, links: { ...shown({ type: 'array' }), 'x-emc2': { item: { name: 'name', noun: 'link', id: 'id' } }, items } } };
      expect(settingsTextProblem(ok)).toBeNull();
      const grouped = { type: 'object', 'x-emc2': { groups: [{ id: 'a', label: 'Advanced', properties: ['name'] }] }, properties: { name: shown() } };
      expect(settingsTextProblem(grouped)).toBe('/x-emc2/groups/0: has no description of 1 to 512 characters');
      const described = { ...grouped, 'x-emc2': { groups: [{ id: 'a', label: 'Advanced', description: 'Rarely changed.', properties: ['name'] }] } };
      expect(settingsTextProblem(described)).toBeNull();
      expect(settingsTextProblem(null)).toBeNull();
    });

    it('exempts the inside of a list of layer pickers, whose items carry the kind', () => {
      const pickers = {
        type: 'object',
        properties: {
          sourceLayers: {
            ...shown({ type: 'array' }),
            'x-emc2': { item: { name: 'name', noun: 'layer' } },
            items: { type: 'object', 'x-emc2': { kind: 'layer', allowNew: false }, properties: { id: { type: 'string' }, name: { type: 'string' } } },
          },
        },
      };
      expect(settingsTextProblem(pickers)).toBeNull();
      // cot's own links, with sourceLayers inside each link
      const cot = JSON.parse(readFileSync(fileURLToPath(new URL('../../../plugins/cot/plugin.json', import.meta.url)), 'utf8')) as { settings: unknown };
      expect(settingsTextProblem(cot.settings) ?? '').not.toContain('sourceLayers/items');
      // a list of plain objects is still checked inside
      const plain = { type: 'object', properties: { rows: { ...shown({ type: 'array' }), items: { type: 'object', properties: { id: { type: 'string' } } } } } };
      expect(settingsTextProblem(plain)).toBe('/properties/rows/items/properties/id: has no title of 1 to 64 characters');
    });

    it('a group may have a description, which the form passes on', () => {
      const schema: SettingsSchema = {
        type: 'object',
        'x-emc2': { groups: [{ id: 'a', label: 'Advanced', description: 'Rarely changed.', properties: ['name'] }, { id: 'b', label: 'Other', properties: ['port'] }] },
        properties: { name: { type: 'string' }, port: { type: 'integer' } },
      };
      expect(settingsHintsProblem(schema)).toBeNull();
      const sections = formSections(schema);
      expect(sections.find((s) => s.id === 'a')?.description).toBe('Rarely changed.');
      expect(sections.find((s) => s.id === 'b')).not.toHaveProperty('description');
      const long = { ...schema, 'x-emc2': { groups: [{ id: 'a', label: 'A', description: 'x'.repeat(513), properties: ['name'] }] } };
      expect(settingsHintsProblem(long)).toBe('/x-emc2: groups 0\'s description is not 1 to 512 characters');
    });

    it('takes the TLS credential field on a plain string only', () => {
      const field = (p: Record<string, unknown>) => ({ type: 'object', properties: { credential: { ...p, 'x-emc2': { kind: 'tls-credential' } } } });
      expect(settingsHintsProblem(field({ type: 'string', default: '' }))).toBeNull();
      expect(settingsHintsProblem(field({ type: ['string', 'null'] }))).toBeNull();
      expect(settingsHintsProblem(field({ type: 'integer' }))).toMatch(/not a string/);
      expect(settingsHintsProblem(field({ type: 'string', enum: ['a'] }))).toMatch(/enum or a pattern/);
      expect(settingsHintsProblem(field({ type: 'string', pattern: '^a$' }))).toMatch(/enum or a pattern/);
      expect(settingsHintsProblem({ type: 'object', properties: { c: { type: 'string', 'x-emc2': { kind: 'certificate' } } } })).toMatch(/kind is not layer, colour or tls-credential/);
    });
  });

  describe('point 2: shared libraries by the caret of the built version (PQ3 A)', () => {
    it.each(shared.sharedCases)('$library built against $built on a shell with $shell is $compatible (shared case)', ({ library, built, shell, compatible }) => {
      expect(compatibleShared(library, built, shell)).toBe(compatible);
    });

    it('checks the SDK by its range only, and refuses what is not SemVer', () => {
      expect(compatibleShared(SDK_PACKAGE, '9.9.9', 'nonsense')).toBe(true);
      expect(compatibleShared('react', 'latest', '19.3.0')).toBe(false);
    });
  });

  describe('point 3: service keys of a plugin\'s own', () => {
    it('makes <plugin-id>.<name> keys and refuses the SDK\'s own', () => {
      const key = serviceKey<{ readonly count: () => number }>('acme-tracks.tracks', 'one');
      expect(key).toEqual({ id: 'acme-tracks.tracks', cardinality: 'one' });
      expect(Object.isFrozen(key)).toBe(true);
      expect(serviceKey('map-view-2d.layers', 'many').cardinality).toBe('many');
      for (const bad of ['tracks', 'Acme.tracks', 'acme_x.tracks', 'acme.', '.tracks', `a.${'x'.repeat(127)}`]) {
        expect(() => serviceKey(bad, 'one'), bad).toThrow();
      }
      expect(() => serviceKey('emc2.map-view', 'one')).toThrow(/SDK's own/);
      expect(serviceKeyOwner('acme-tracks.tracks')).toBe('acme-tracks');
      expect(serviceKeyOwner(MAP_VIEW.id)).toBe('emc2');
    });
  });

  describe('section 6: friendly control measures black or blue (owner YE B, PQ5 A)', () => {
    it('is a display choice, absent meaning black, so a 1.8.0 display is unchanged', () => {
      expect(DEFAULT_DISPLAY).not.toHaveProperty('friendlyGraphicColour');
      expect(friendlyGraphicColourOf(DEFAULT_DISPLAY)).toBe('black');
      expect(resolveDisplay({}, {}, [])).not.toHaveProperty('friendlyGraphicColour');
      expect(resolveDisplay({}, { friendlyGraphicColour: 'blue' }, []).friendlyGraphicColour).toBe('blue');
      expect(resolveDisplay({ friendlyGraphicColour: 'black' }, { friendlyGraphicColour: 'blue' }, []).friendlyGraphicColour).toBe('black');
      expect(displayChoicesProblem({ friendlyGraphicColour: 'blue' })).toBeNull();
      expect(displayChoicesProblem({ friendlyGraphicColour: 'green' })).toBe('friendlyGraphicColour is black or blue');
      expect(displaySettingsProblem(resolveDisplay({ friendlyGraphicColour: 'blue' }, {}, []), [])).toBeNull();
      expect(displaySettingsProblem(resolveDisplay({}, {}, []), [])).toBeNull();
      expect(FRIENDLY_GRAPHIC_COLOURS.map((c) => c.id)).toEqual(['black', 'blue']);
    });
  });
});
