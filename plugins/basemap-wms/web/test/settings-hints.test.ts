// T-204 (SDK 1.8.0 part D; owner UZ A): the settings schema's hints, lists of servers and backgrounds, and the icon Server.
// The CDA's generated forms and Settings' lists read them; this plugin's own panel replaces the form, but the Settings
// list still takes the icon and the schema still describes the settings.
import { describe, expect, it } from 'vitest';
import { PLUGIN_ICONS, fieldHint, fieldWidth, formSections, itemColumns, itemName, itemWords, pluginIcon, settingsHintsProblem } from '@emc2/plugin-sdk';
import type { SettingsSchema } from '@emc2/plugin-sdk';
import manifest from '../../plugin.json' with { type: 'json' };

const schema = manifest.settings as unknown as SettingsSchema;
const properties = (s: SettingsSchema | undefined) => s?.properties ?? {};
const servers = properties(schema)['servers'] as SettingsSchema;
const backgrounds = properties(schema)['backgrounds'] as SettingsSchema;

describe('T-204: the settings form’s hints and the manifest’s icon', () => {
  it('passes the SDK’s settingsHintsProblem and declares SDK 1.8.0 and the icon Server', () => {
    expect(settingsHintsProblem(manifest.settings)).toBeNull();
    expect(manifest.sdkVersion).toBe('^1.8.0');
    expect(manifest.icon).toBe('Server');
    expect(Object.hasOwn(PLUGIN_ICONS, manifest.icon)).toBe(true);
    expect(pluginIcon(manifest.icon)).not.toBeNull();
  });

  it('names the servers and the backgrounds as lists with their words and columns', () => {
    expect(itemWords(servers)).toEqual({ noun: 'server', add: 'Add server', remove: 'Delete server?', fresh: 'New server' });
    expect(itemWords(backgrounds)).toEqual({ noun: 'background', add: 'Add background', remove: 'Delete background?', fresh: 'New background' });
    expect(itemName(servers, { name: 'GeoServer' }, 0, true)).toBe('GeoServer');
    expect(itemName(backgrounds, {}, 2, true)).toBe('Background 3');
    expect(itemName(backgrounds, {}, 0, false)).toBe('New background');
    expect(itemColumns(servers)).toEqual(['url', 'version', 'timeoutSeconds']);
    expect(itemColumns(backgrounds)).toEqual(['server', 'mode', 'format']);
  });

  it('shows a background’s image fields in a group of their own, and every field in one section', () => {
    const sections = formSections(backgrounds.items as SettingsSchema, backgrounds);
    expect(sections.map((s) => s.label)).toEqual([null, 'Image', 'Attribution']);
    expect(sections[0]?.properties).toEqual(['id', 'name', 'server', 'layers']);
    expect(sections[1]?.properties).toEqual(['mode', 'format', 'transparent']);
    expect(sections.flatMap((s) => s.properties).sort()).toEqual(Object.keys(properties(backgrounds.items)).sort());
  });

  it('gives every long description a hint of at most 80 characters, and the timeout its unit', () => {
    const problemsFound: string[] = [];
    const walk = (s: SettingsSchema, path: string) => {
      for (const [name, property] of Object.entries(properties(s))) {
        const { hint } = fieldHint(property);
        if ((property.description ?? '').length > 80 && hint === null) problemsFound.push(`${path}${name}`);
        if (hint !== null && hint.length > 80) problemsFound.push(`${path}${name} (hint too long)`);
        if (Object.keys(properties(property)).length > 0) walk(property, `${path}${name}.`);
        const items = property.items;
        if (items && Object.keys(properties(items)).length > 0) walk(items, `${path}${name}[].`);
      }
    };
    walk(schema, '');
    expect(problemsFound).toEqual([]);
    expect(properties(servers.items as SettingsSchema)['timeoutSeconds']?.['x-emc2']?.unit).toBe('s');
    expect(fieldWidth(properties(servers.items as SettingsSchema)['timeoutSeconds'] as SettingsSchema)).toBe('short');
  });
});
