import { describe, expect, it } from 'vitest';
import { fieldHint, formSections, pluginIcon, settingsHintsProblem, type SettingsSchema } from '@emc2/plugin-sdk';
import { createFakeContext } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };
import plugin from '../src/index.tsx';
import { readMaxItems } from '../src/settings.ts';
import { DEFAULT_MAX_ITEMS } from '../src/tree.ts';

describe('bookmarks web part', () => {
  it('is named after the plugin id', () => {
    // npm refuses two workspaces with the same name, so a copy must rename the package.
    expect(pkg.name).toBe(`@emc2/plugin-${manifest.id}`);
  });

  it('lists the CSS file the build writes (<id>.css)', () => {
    expect(manifest.web.css).toEqual([`${manifest.id}.css`]);
  });

  it('is a web-only utility that uses the map view and the coordinates, and needs neither', () => {
    expect(manifest.kind).toBe('utility');
    expect(manifest.uses).toEqual(['emc2.map-view', 'emc2.coordinates']);
    expect('requires' in manifest).toBe(false);
    expect('server' in manifest).toBe(false);
  });

  it('declares the item limit with the default of the brief', () => {
    expect(manifest.settings.properties.maxItems.default).toBe(1000);
    expect(DEFAULT_MAX_ITEMS).toBe(1000);
  });

  it('adds its control to the top bar', async () => {
    const ctx = createFakeContext({ pluginId: manifest.id, settings: { maxItems: 1000 }, uses: manifest.uses });
    await plugin.activate(ctx);
    expect(ctx.topBarItems.map((i) => i.id)).toEqual(['bookmarks']);
  });
});

// SDK 1.8.0 parts C and D (T-204): the icon, the settings form's hints. Bookmarks has no panel (a top bar item),
// so part C's panel rules (icon, no repeated heading, a foot) have nothing to apply to here.
describe('the manifest for SDK 1.8.0 (T-204)', () => {
  const settings = manifest.settings as unknown as SettingsSchema;

  it('needs SDK 1.8.0, for the icon', () => {
    expect(manifest.sdkVersion).toBe('^1.8.0');
  });

  it('has an icon the SDK knows', () => {
    expect(manifest.icon).toBe('Bookmark');
    expect(pluginIcon(manifest.icon)).not.toBeNull();
  });

  it('has settings hints that pass the SDK check', () => {
    expect(settingsHintsProblem(manifest.settings)).toBeNull();
  });

  it('gives the limit a hint of at most 80 characters and a unit, in one unheaded section', () => {
    const property = settings.properties?.maxItems;
    expect(property).toBeDefined();
    const { hint, more } = fieldHint(property as SettingsSchema);
    expect(hint).toBe('Bookmarks and folders together; a document holds at most 256 KiB');
    expect(hint?.length).toBeLessThanOrEqual(80);
    expect(more).not.toBeNull(); // the description stays behind the info button
    expect((property as { 'x-emc2'?: { unit?: string } })['x-emc2']?.unit).toBe('items');
    const sections = formSections(settings);
    expect(sections.map((s) => [s.label, s.properties])).toEqual([[null, ['maxItems']]]);
  });
});

describe('the limit setting', () => {
  it('is read as set, and defaults when it is missing', () => {
    expect(readMaxItems({ maxItems: 25 })).toEqual({ value: 25, problem: null });
    expect(readMaxItems({})).toEqual({ value: 1000, problem: null });
  });

  it.each([0, -3, 2.5, '10', null, true])('refuses %s', (value) => {
    const read = readMaxItems({ maxItems: value });
    expect(read.value).toBe(1000);
    expect(read.problem).not.toBeNull();
  });
});
