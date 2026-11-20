// Part 1 of docs/plugins/briefs/object-list.md: the manifest, the panel, the service that opens it
// (functions 1 and 2, the part of criterion 1 that is this plugin's) and the map view status
// (function 8, criterion 13). The list itself (paging, selection) comes in later parts.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EVERY_WORKSPACE, MAP_VIEW, OBJECT_LIST, PLUGIN_ICONS, fieldHint, formSections, settingsHintsProblem } from '@emc2/plugin-sdk';
import type { FakeContext } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };
import sdkPkg from '../../../../web/plugin-sdk/package.json' with { type: 'json' };
import { activated as activate, layer, renderPanel, type ActivateOptions } from './helpers.tsx';

afterEach(cleanup);

/** The name of the layer the list shows: the chooser's selected option. */
function shownLayer(): string | undefined {
  const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Layer' });
  return select.selectedOptions[0]?.textContent ?? undefined;
}

async function activated(options: ActivateOptions = {}): Promise<FakeContext> {
  return (await activate(options)).ctx;
}

describe('object-list manifest and package', () => {
  it('is named after the plugin id', () => {
    // npm refuses two workspaces with the same name, so a copy must rename the package.
    expect(pkg.name).toBe(`@emc2/plugin-${manifest.id}`);
  });

  it('lists the CSS file the build writes (<id>.css)', () => {
    expect(manifest.web.css).toEqual([`${manifest.id}.css`]);
  });

  it('provides the objects panel service, uses the map view and the symbols, and requires nothing', () => {
    expect(manifest.provides).toEqual([OBJECT_LIST.id]);
    expect(manifest.uses).toEqual([MAP_VIEW.id, 'emc2.symbols']);
    expect(manifest).not.toHaveProperty('requires');
  });

  it('is a web-only plugin that needs SDK ^1.8.0, builds against the repository SDK and allows no internet', () => {
    expect(manifest).not.toHaveProperty('server');
    expect(manifest).not.toHaveProperty('internet');
    expect(manifest.sdkVersion).toBe('^1.8.0');
    expect(pkg.peerDependencies['@emc2/plugin-sdk']).toBe(sdkPkg.version);
  });

  it('declares the page size, 100 by default and at most the server page limit of 500', () => {
    expect(manifest.settings.properties.pageSize).toMatchObject({ type: 'integer', default: 100, minimum: 1, maximum: 500 });
  });

  // T-204 (SDK 1.8.0 part D): the settings form's hint and the manifest's icon.
  it('T-204: the settings schema passes the SDK hints check, the page size has a hint of at most 80 characters, and the icon is List', () => {
    expect(settingsHintsProblem(manifest.settings)).toBeNull();
    const { hint, more } = fieldHint(manifest.settings.properties.pageSize);
    expect(hint).not.toBeNull();
    expect(hint?.length).toBeLessThanOrEqual(80);
    expect(more).toBe(manifest.settings.properties.pageSize.description);
    expect(formSections(manifest.settings).map((section) => section.label)).toEqual([null]);
    expect(manifest.icon).toBe('List');
    expect(Object.hasOwn(PLUGIN_ICONS, manifest.icon)).toBe(true);
  });
});

describe('the panel "Objects" (function 1)', () => {
  it('is registered with the bottom pane as its default and reports OK with a map view', async () => {
    const ctx = await activated();
    expect(ctx.addedPanels.map((p) => [p.panel.id, p.panel.title, p.panel.defaultPane, p.panel.workspaces])).toEqual([['object-list', 'Objects', 'bottom', [EVERY_WORKSPACE]]]);
    expect(ctx.panels).toHaveLength(0);
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
  });

  it('subscribes to layers and counts only, never to objects', async () => {
    const ctx = await activated();
    expect(ctx.liveSubscriptions).toEqual([{ objects: false }]);
  });

  it('asks the user to choose a layer, and lists the layers top first', async () => {
    const ctx = await activated();
    const low = layer('Low', 1);
    const high = layer('High', 2);
    renderPanel(ctx);
    expect(screen.getByText('Choose a layer to list its objects')).toBeDefined();
    act(() => {
      ctx.live.snapshot({ layers: [low, high], objectCounts: { [high.id]: 3 } });
    });
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Choose a layer', 'High', 'Low']);
  });

  it('says so when there are no layers', async () => {
    const ctx = await activated();
    renderPanel(ctx);
    act(() => {
      ctx.live.snapshot({ layers: [] });
    });
    expect(screen.getByText('There are no layers')).toBeDefined();
  });

  it('shows the chosen layer with its name and object count, and follows count changes', async () => {
    const ctx = await activated();
    const a = layer('Alpha', 2);
    const b = layer('Bravo', 1);
    renderPanel(ctx);
    act(() => {
      ctx.live.snapshot({ layers: [a, b], objectCounts: { [a.id]: 12345, [b.id]: 1 } });
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Layer' }), { target: { value: a.id } });
    expect(shownLayer()).toBe('Alpha');
    expect(screen.getByText('12 345 objects')).toBeDefined();
    act(() => {
      ctx.live.counts({ [a.id]: 12346, [b.id]: 1 });
    });
    expect(screen.getByText('12 346 objects')).toBeDefined();
    fireEvent.change(screen.getByRole('combobox', { name: 'Layer' }), { target: { value: b.id } });
    expect(screen.getByText('1 object')).toBeDefined();
  });
});

describe('the service that opens the panel (function 2; acceptance criterion 1, this plugin\'s part)', () => {
  it('open(layerId) shows the panel, brings it to the front and lists that layer, also when it is hidden on the map', async () => {
    const ctx = await activated();
    const hidden = layer('Hidden', 1);
    renderPanel(ctx);
    act(() => {
      ctx.live.snapshot({ layers: [hidden, layer('Other', 2)], objectCounts: { [hidden.id]: 4 } });
    });
    // The layer is hidden in this browser: the list does not care (the map view's local visibility is not consulted).
    const map = await ctx.services.get(MAP_VIEW);
    map.setLayerVisible(hidden.id, false);

    const service = await ctx.services.get(OBJECT_LIST);
    expect(ctx.addedPanels[0]?.shown).toBe(0);
    act(() => {
      service.open(hidden.id);
    });

    expect(ctx.addedPanels[0]?.shown).toBe(1);
    expect(shownLayer()).toBe('Hidden');
    expect(screen.getByText('4 objects')).toBeDefined();
  });

  it('keeps the layer when it is opened before the live picture has arrived', async () => {
    const ctx = await activated();
    const late = layer('Late', 1);
    const service = await ctx.services.get(OBJECT_LIST);
    service.open(late.id);
    renderPanel(ctx);
    act(() => {
      ctx.live.snapshot({ layers: [late], objectCounts: { [late.id]: 2 } });
    });
    expect(screen.getByText('2 objects')).toBeDefined();
  });

  it('opening another layer replaces the shown one', async () => {
    const ctx = await activated();
    const a = layer('Alpha', 2);
    const b = layer('Bravo', 1);
    renderPanel(ctx);
    act(() => {
      ctx.live.snapshot({ layers: [a, b], objectCounts: { [a.id]: 5, [b.id]: 7 } });
    });
    const service = await ctx.services.get(OBJECT_LIST);
    act(() => {
      service.open(a.id);
    });
    act(() => {
      service.open(b.id);
    });
    expect(screen.getByText('7 objects')).toBeDefined();
    expect(ctx.addedPanels[0]?.shown).toBe(2);
  });
});

describe('without a map view (function 8; acceptance criterion 13, the status)', () => {
  it('reports DEGRADED, still lists the layers and shows a notice', async () => {
    const ctx = await activated({ withMapView: false });
    expect(ctx.statusHistory.at(-1)?.state).toBe('DEGRADED');
    const only = layer('Only', 1);
    renderPanel(ctx);
    act(() => {
      ctx.live.snapshot({ layers: [only], objectCounts: { [only.id]: 9 } });
    });
    const service = await ctx.services.get(OBJECT_LIST);
    act(() => {
      service.open(only.id);
    });
    expect(screen.getByText('9 objects')).toBeDefined();
    expect(screen.getByText('No map view is loaded: objects cannot be selected')).toBeDefined();
  });
});
