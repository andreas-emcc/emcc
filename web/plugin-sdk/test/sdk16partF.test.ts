// SDK and data model 1.6.0 part F (CR-0041; T-152, T-174, owner Q60 A): a top-bar item's workspaces,
// the plugin categories and colour settings.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  categoryLabel,
  COLOUR_PATTERN,
  DEFAULT_PLUGIN_CATEGORY,
  isColour,
  PLUGIN_CATEGORIES,
  pluginCategory,
  topBarItemAppearsIn,
  VIEW_WORKSPACE,
  type TopBarItem,
} from '../src/index.ts';
import { createFakeContext } from '../src/testing/index.ts';

const Nothing = () => null;

describe('SDK 1.6.0 part F: categories (T-174)', () => {
  it('has the owner\'s six categories in their order, with their labels', () => {
    expect(PLUGIN_CATEGORIES.map((c) => c.label)).toEqual(['Data Links', 'GeoMetoc', 'Map and Symbols', 'Drawing', 'Simulation', 'General']);
    expect(PLUGIN_CATEGORIES.map((c) => c.id)).toEqual(['data-links', 'geometoc', 'map-and-symbols', 'drawing', 'simulation', 'general']);
    expect(Object.isFrozen(PLUGIN_CATEGORIES)).toBe(true);
    expect(Object.isFrozen(PLUGIN_CATEGORIES[0])).toBe(true);
  });

  it('matches the manifest schema\'s list', () => {
    const schema = JSON.parse(readFileSync(new URL('../../../model/schemas/plugin-manifest.schema.json', import.meta.url), 'utf8')) as {
      properties: { category: { enum: string[] } };
    };
    expect(schema.properties.category.enum).toEqual(PLUGIN_CATEGORIES.map((c) => c.id));
  });

  it('gives General for a manifest without a category or with an unknown one', () => {
    expect(DEFAULT_PLUGIN_CATEGORY).toBe('general');
    expect(pluginCategory(undefined)).toBe('general');
    expect(pluginCategory('weather')).toBe('general');
    expect(pluginCategory('data-links')).toBe('data-links');
    expect(categoryLabel('geometoc')).toBe('GeoMetoc');
    expect(categoryLabel(undefined)).toBe('General');
  });
});

describe('SDK 1.6.0 part F: colour settings (Q60 A)', () => {
  it('knows a #RRGGBB colour, as the schema\'s pattern', () => {
    expect(COLOUR_PATTERN).toBe('^#[0-9A-Fa-f]{6}$');
    expect(['#FFFF00', '#00a8dc'].every(isColour)).toBe(true);
    expect(['yellow', '#FFF', '#FFFF000', 'FFFF00', 7, null].some(isColour)).toBe(false);
  });
});

describe('SDK 1.6.0 part F: a top-bar item\'s workspaces (T-152)', () => {
  it('appears in every workspace without a list, and only in its own with one', () => {
    const bookmarks: TopBarItem = { id: 'bookmarks', order: 0, component: Nothing };
    const scenario: TopBarItem = { id: 'scenario', order: 20, workspaces: ['simulator.simulation'], component: Nothing };
    expect(topBarItemAppearsIn(bookmarks, VIEW_WORKSPACE)).toBe(true);
    expect(topBarItemAppearsIn(bookmarks, 'simulator.simulation')).toBe(true);
    expect(topBarItemAppearsIn(scenario, 'simulator.simulation')).toBe(true);
    expect(topBarItemAppearsIn(scenario, VIEW_WORKSPACE)).toBe(false);
    expect(topBarItemAppearsIn({ ...scenario, workspaces: ['*'] }, VIEW_WORKSPACE)).toBe(true);
  });

  it('the fake context keeps the item with its workspaces', () => {
    const ctx = createFakeContext();
    ctx.ui.addTopBarItem({ id: 'scenario', workspaces: ['simulator.simulation'], component: Nothing });
    expect(ctx.topBarItems[0]?.workspaces).toEqual(['simulator.simulation']);
  });
});
