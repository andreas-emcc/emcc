import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAP_VIEW,
  PLUGIN_ICONS,
  fieldHint,
  fieldWidth,
  formSections,
  pluginIcon,
  settingsHintsProblem,
  type JsonValue,
  type SettingsSchema,
} from '@emc2/plugin-sdk';
import { createFakeContext, createFakeMapView, type FakeContext } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import plugin from '../src/index.tsx';

// T-204 (SDK 1.8.0 parts C and D; the UXA's "name once, icon always" and the settings form's hints): the manifest's
// icon, the settings schema's groups, hints, units and widths, and the panel without a heading that repeats its title.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const settings = manifest.settings as unknown as SettingsSchema;
const properties = settings.properties ?? {};

/** One setting's schema; a missing one fails the test. */
function setting(name: string): SettingsSchema {
  const schema = properties[name];
  if (schema === undefined) throw new Error(`no setting ${name}`);
  return schema;
}

function settingDefaults(): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(manifest.settings.properties).map(([name, schema]) => [name, schema.default]));
}

async function activated(): Promise<FakeContext> {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ state: 'ready', cells: 6 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))));
  const ctx = createFakeContext({ pluginId: manifest.id, settings: settingDefaults(), uses: manifest.uses });
  ctx.provideAs(MAP_VIEW, createFakeMapView({ pluginId: manifest.id }));
  await plugin.activate(ctx);
  return ctx;
}

describe('T-204: the manifest and the settings form (SDK 1.8.0 part D)', () => {
  it('needs SDK 1.8.0 and names the icon Mountain, which the shell knows', () => {
    expect(manifest.sdkVersion).toBe('^1.8.0');
    expect(manifest.icon).toBe('Mountain');
    expect(Object.hasOwn(PLUGIN_ICONS, manifest.icon)).toBe(true);
    expect(pluginIcon(manifest.icon)).not.toBeNull();
  });

  it("passes the SDK's settingsHintsProblem", () => {
    expect(settingsHintsProblem(manifest.settings)).toBeNull();
  });

  it('every setting has a hint of at most 80 characters, so no long description is a hint, and the description stays behind the info button', () => {
    for (const [name, schema] of Object.entries(properties)) {
      const { hint, more } = fieldHint(schema);
      expect(hint, name).not.toBeNull();
      expect(hint?.length ?? 0, name).toBeLessThanOrEqual(80);
      expect(more, name).toBe(schema.description);
    }
  });

  it('the numbers have their units, the folder is a full-width field and the numbers are short', () => {
    const units = Object.fromEntries(Object.entries(properties).map(([name, schema]) => [name, schema['x-emc2']?.unit ?? null]));
    expect(units).toEqual({ heightDataFolder: null, refractionCoefficient: null, maxRange: 'm', maxCells: 'cells', timeoutSeconds: 's', cacheMegabytes: 'MB' });
    expect(fieldWidth(setting('heightDataFolder'))).toBe('full');
    for (const name of ['refractionCoefficient', 'maxRange', 'maxCells', 'timeoutSeconds', 'cacheMegabytes']) expect(fieldWidth(setting(name)), name).toBe('short');
  });

  it('the form is two groups, the folder and the cache first, then the limits of a request; every setting is in one', () => {
    const sections = formSections(settings);
    expect(sections.map((s) => [s.label, s.properties])).toEqual([
      ['Height data', ['heightDataFolder', 'cacheMegabytes']],
      ['Viewshed and height map', ['refractionCoefficient', 'maxRange', 'maxCells', 'timeoutSeconds']],
    ]);
    expect(sections.flatMap((s) => s.properties).sort()).toEqual(Object.keys(properties).sort());
    expect(sections.some((s) => s.advanced || s.folded)).toBe(false);
  });

  it('the descriptions of the settings both tools use name both tools', () => {
    for (const name of ['maxRange', 'maxCells', 'timeoutSeconds']) expect(properties[name]?.description, name).toMatch(/height map/);
  });
});

describe('T-204: the panel (SDK 1.8.0 part C)', () => {
  it("has an icon, the manifest's, and keeps its title, default pane and workspaces", async () => {
    const ctx = await activated();
    const { panel } = ctx.addedPanels[0] ?? {};
    expect(panel?.title).toBe('Terrain');
    expect(panel?.icon).toBe(PLUGIN_ICONS[manifest.icon]);
    expect(panel?.defaultPane).toBe('right');
  });

  it('shows no heading that repeats its title: the shell\'s head shows it once', async () => {
    const ctx = await activated();
    const Panel = ctx.addedPanels[0]?.panel.component;
    if (!Panel) throw new Error('no panel');
    const { container } = render(<Panel />);
    expect(screen.queryByRole('heading', { name: 'Terrain' })).toBeNull();
    expect(container.querySelector('.emc2-panel-head, .emc2-panel-title')).toBeNull();
    // what is left are the three tools' own headings
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['Range and bearing', 'Viewshed', 'Height map']);
  });

  it('puts Clear, which acts on all three tools\' results, in the panel foot: the last element of the body', async () => {
    const ctx = await activated();
    const Panel = ctx.addedPanels[0]?.panel.component;
    if (!Panel) throw new Error('no panel');
    const { container } = render(<Panel />);
    const foot = screen.getByRole('group', { name: 'Panel actions' });
    expect(within(foot).getByRole('button', { name: 'Clear' })).toBeDefined();
    expect(within(foot).getAllByRole('button')).toHaveLength(1);
    expect(container.querySelector('.terrain-content')?.lastElementChild).toBe(foot);
    // no other button of the panel is in the foot: each tool's own buttons stay with the tool
    expect(foot.contains(screen.getByRole('button', { name: 'Draw a circle' }))).toBe(false);
  });
});
