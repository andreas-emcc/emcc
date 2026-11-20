import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JsonValue } from '@emc2/plugin-sdk';
import { fieldHint, fieldWidth, formSections, HINT_MAX, itemName, itemWords, MAP_VIEW, PLUGIN_ICONS, pluginIcon, settingsHintsProblem, SYMBOLS } from '@emc2/plugin-sdk';
import type { SettingsSchema } from '@emc2/plugin-sdk';
import { createFakeContext } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };
import plugin from '../src/index.tsx';

/** The settings as the shell passes them in SDK v0: the default of every setting. */
function settingDefaults(): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(manifest.settings.properties).map(([name, schema]) => [name, schema.default as JsonValue]));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('map-view-2d web part', () => {
  it('is named after the plugin id', () => {
    // npm refuses two workspaces with the same name, so a copy must rename the package.
    expect(pkg.name).toBe(`@emc2/plugin-${manifest.id}`);
  });

  it('lists the CSS file the build writes (<id>.css)', () => {
    expect(manifest.web.css).toEqual([`${manifest.id}.css`]);
  });

  it('is the map view and provides only MapView', () => {
    expect(manifest.kind).toBe('map-view');
    expect(manifest.provides).toEqual([MAP_VIEW.id]);
  });

  it('lists the symbols under uses, not requires (CR-0011): the map works without them', () => {
    // The shell refuses a plugin whose required key nobody provides; a `uses` key only orders and
    // reports. Background maps are read with getAll (zero or more) and need neither list.
    expect(manifest.uses).toEqual([SYMBOLS.id]);
    expect(manifest).not.toHaveProperty('requires');
  });

  it('T-204 (SDK 1.8.0 part D; owner UZ A): the settings hints pass the SDK check; the form has the groups, hints and units; the projections list is named by its code; the icon is MapPin; it needs SDK 1.8.0', () => {
    expect(manifest.sdkVersion).toBe('^1.8.0');
    expect(manifest.icon).toBe('MapPin');
    expect(Object.hasOwn(PLUGIN_ICONS, manifest.icon)).toBe(true);
    expect(pluginIcon(manifest.icon)).not.toBeNull();
    const settings = manifest.settings as unknown as SettingsSchema;
    expect(settingsHintsProblem(settings)).toBeNull();
    // The page: the projections and the preferred backgrounds free, then the groups; the performance group folded and last.
    const sections = formSections(settings);
    expect(sections.map((s) => [s.label, s.folded])).toEqual([[null, false], ['Start view', false], ['Controls', false], ['Performance', true]]);
    expect(sections[0]?.properties).toEqual(['projections', 'preferredBackgrounds']);
    expect(sections.flatMap((s) => s.properties).sort()).toEqual(Object.keys(manifest.settings.properties).sort()); // every setting in one section
    // The projections: "Add projection", "New projection", a row named by its code, "Projection 2" for a saved one without.
    const list = manifest.settings.properties.projections as unknown as SettingsSchema;
    expect(itemWords(list)).toEqual({ noun: 'projection', add: 'Add projection', remove: 'Delete projection?', fresh: 'New projection' });
    expect(itemName(list, { code: 'EPSG:3413' }, 0, true)).toBe('EPSG:3413');
    expect(itemName(list, {}, 1, true)).toBe('Projection 2');
    expect(itemName(list, {}, 1, false)).toBe('New projection');
    expect(Object.keys(list.items?.properties ?? {})).toContain('code');
    expect(fieldWidth(list.items?.properties?.proj4 as SettingsSchema)).toBe('full');
    // Every description over 80 characters has a hint of its own, and every unit is on the setting it counts.
    const walk = (schema: SettingsSchema, path: string): void => {
      const hint = fieldHint(schema);
      if (typeof schema.description === 'string' && schema.description.length > HINT_MAX) expect(hint.hint, path).not.toBeNull(); // the hint is its own: a description over the limit is no hint
      if (hint.hint !== null) expect(hint.hint.length, path).toBeLessThanOrEqual(HINT_MAX);
      for (const [name, child] of Object.entries(schema.properties ?? {})) walk(child, `${path}/${name}`);
      if (schema.items !== undefined) walk(schema.items, `${path}/items`);
    };
    walk(settings, '');
    const units = Object.fromEntries(Object.entries(manifest.settings.properties).flatMap(([name, schema]) => {
      const unit = (schema as { 'x-emc2'?: { unit?: string } })['x-emc2']?.unit;
      return unit === undefined ? [] : [[name, unit]];
    }));
    expect(units).toEqual({ textThreshold: 'symbols', updateCadenceMs: 'ms', softwareBudget: 'objects', hardwareBudget: 'objects', highestDim: '%', zoomToWidthMetres: 'm' });
  });

  it('declares a default for every setting', () => {
    for (const [name, schema] of Object.entries(manifest.settings.properties)) {
      expect(schema, name).toHaveProperty('default');
      expect(schema, name).toHaveProperty('description');
    }
  });

  it('activates with the default settings; in jsdom (no WebGL) the Map Pane says the map cannot be drawn', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const ctx = createFakeContext({ pluginId: manifest.id, settings: settingDefaults(), provides: manifest.provides });
    await plugin.activate(ctx);
    expect((await ctx.services.get(MAP_VIEW)).renderingMode).toBe('none');
    expect(ctx.statusHistory.at(-1)?.state).toBe('FAILED');
    const element = document.createElement('div');
    ctx.mapViewMount?.mount(element);
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('cannot draw the map');
    expect(ctx.logs.filter((l) => l.level === 'warn')).toEqual([]);
  });
});
