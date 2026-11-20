// The plugin as the shell sees it: manifest, activation, panels, the picker.
import { act, fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COORDINATES, MAP_VIEW, PLUGIN_ICONS, pluginIcon, settingsHintsProblem, SYMBOLS } from '@emc2/plugin-sdk';
import { createFakeContext, createFakeMapView, createFakeSymbolService } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };
import plugin from '../src/index.tsx';
import { FakeServer, layer } from './fakeServer.ts';
import { canvasStub, createTestCoordinates, isolateDocumentListeners, openBrowser, settingDefaults, settle, showPanels } from './harness.tsx';

isolateDocumentListeners();

describe('manifest and package', () => {
  it('is named after the plugin id', () => {
    // npm refuses two workspaces with the same name, so a copy must rename the package.
    expect(pkg.name).toBe(`@emc2/plugin-${manifest.id}`);
    expect(manifest.id).toBe('draw-symbols');
  });

  it('lists the CSS file the build writes (<id>.css)', () => {
    expect(manifest.web.css).toEqual([`${manifest.id}.css`]);
  });

  it('requires the three services it gets, provides none, and declares objects.edit', () => {
    expect(manifest.requires).toEqual([MAP_VIEW.id, SYMBOLS.id, COORDINATES.id]);
    expect('provides' in manifest).toBe(false);
    expect(manifest.permissions).toEqual(['objects.edit']);
  });

  // T-204 (SDK 1.8.0 parts C and D): the manifest's icon and the settings form's hints.
  it('T-204: needs SDK 1.8.0, has the icon Flag and settings hints the SDK accepts', () => {
    expect(manifest.sdkVersion).toBe('^1.8.0');
    expect(manifest.icon).toBe('Flag');
    expect(Object.hasOwn(PLUGIN_ICONS, manifest.icon) && pluginIcon(manifest.icon) !== null).toBe(true);
    expect(settingsHintsProblem(manifest.settings)).toBeNull();
    const properties = manifest.settings.properties as Record<string, { description: string; 'x-emc2'?: { hint?: string; unit?: string } }>;
    for (const [name, property] of Object.entries(properties)) {
      const hint = property['x-emc2']?.hint;
      if (property.description.length > 80) expect(hint, `${name}: a description over 80 characters needs a hint`).toBeDefined();
      if (hint !== undefined) expect(hint.length, name).toBeLessThanOrEqual(80);
    }
    expect(properties['pickerSymbolSize']?.['x-emc2']?.unit).toBe('px');
  });

  it('declares internet use never', () => {
    expect('internet' in manifest).toBe(false);
  });
});

describe('activate', () => {
  it('adds the panels "Symbols" and "Symbol properties" and reports OK', async () => {
    const browser = await openBrowser(new FakeServer());
    // "Symbols" starts in the left pane, "Symbol properties" in the right (M4, criterion 38); the old control panel call is not used.
    expect(browser.ctx.addedPanels.map((e) => [e.panel.id, e.panel.title, e.panel.defaultPane])).toEqual([
      ['draw-symbols-symbols', 'Symbols', 'left'],
      ['draw-symbols-properties', 'Symbol properties', 'right'],
    ]);
    expect(browser.ctx.panels).toHaveLength(0);
    expect(browser.ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
  });

  it('registers the object action Edit: one core.symbol, objects.edit, group edit; and no other action', async () => {
    const browser = await openBrowser(new FakeServer());
    expect(browser.ctx.objectActions).toHaveLength(1);
    expect(browser.ctx.objectActions[0]).toMatchObject({
      id: 'edit', label: 'Edit', group: 'edit', multiple: false, permission: 'objects.edit', appliesTo: { types: ['core.symbol'] },
    });
    expect(browser.ctx.mapActions).toHaveLength(0);
  });

  it('gives its panels and the Edit action an icon of the shared set (ADR-0034)', async () => {
    const browser = await openBrowser(new FakeServer());
    for (const entry of browser.ctx.addedPanels) expect(entry.panel.icon, entry.panel.id).toBeDefined();
    expect(browser.ctx.objectActions[0]?.icon).toBeDefined();
  });

  it('uses the defaults and reports DEGRADED for a bad setting', async () => {
    const browser = await openBrowser(new FakeServer(), { settings: { ...settingDefaults(), pickerSymbolSize: 3 } });
    expect(browser.ctx.statusHistory.at(-1)?.state).toBe('DEGRADED');
    expect(browser.ctx.logs.some((l) => l.level === 'warn' && l.message.includes('pickerSymbolSize'))).toBe(true);
  });

  it('reports FAILED, and fails, when a service it needs is not available', async () => {
    const ctx = createFakeContext({ pluginId: manifest.id, settings: settingDefaults() });
    ctx.services.get = () => Promise.reject(new Error('provider failed'));
    await expect(plugin.activate(ctx)).rejects.toThrow('provider failed');
    expect(ctx.statusHistory.at(-1)?.state).toBe('FAILED');
    expect(ctx.addedPanels).toHaveLength(0);
    expect(ctx.objectActions).toHaveLength(0);
  });

  it('does not miss the layers that arrive while the services are still being awaited', async () => {
    const lay = layer('Default', 0);
    const ctx = createFakeContext({ pluginId: manifest.id, settings: settingDefaults() });
    const activating = plugin.activate(ctx); // the services are not provided yet
    act(() => {
      ctx.live.snapshot({ layers: [lay] });
    });
    const map = createFakeMapView();
    ctx.provideAs(MAP_VIEW, map);
    ctx.provideAs(SYMBOLS, createFakeSymbolService());
    ctx.provideAs(COORDINATES, createTestCoordinates());
    await activating;
    act(() => {
      map.activeLayer.set(lay.id);
    });
    const Panel = ctx.addedPanels.find((e) => e.panel.id === 'draw-symbols-symbols')?.panel.component;
    if (!Panel) throw new Error('no symbols panel');
    const view = render(<Panel />);
    expect(view.getByRole('status').textContent).toBe('Choose a symbol, or type a SIDC.'); // the layer is known: no "create a layer" hint
  });
});

describe('the Symbols panel', () => {
  it('shows the catalog as images drawn on canvases, at the size of the setting', async () => {
    const browser = await openBrowser(new FakeServer(), { settings: { ...settingDefaults(), pickerSymbolSize: 64 } });
    const { symbols } = showPanels(browser);
    await settle();
    const grid = within(symbols.getByRole('group', { name: 'Symbols' }));
    const canvases = [...grid.getAllByRole('button')].map((b) => b.querySelector('canvas'));
    expect(canvases).toHaveLength(2); // Infantry, Armour in the fake catalog
    expect(canvases.map((c) => c?.width)).toEqual([64, 64]);
    expect(canvasStub.drawImage.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(canvasStub.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0);
  });

  it('offers identity and echelon from the catalog and previews the composed SIDC', async () => {
    const browser = await openBrowser(new FakeServer([layer('A', 0)]));
    const { symbols } = showPanels(browser);
    expect(symbols.getByText('No symbol chosen')).toBeDefined();
    fireEvent.click(symbols.getByRole('button', { name: 'Infantry' }));
    expect(symbols.getByText('10031000001211000000')).toBeDefined(); // friend, no echelon, infantry
    fireEvent.change(symbols.getByLabelText('Identity'), { target: { value: '6' } });
    fireEvent.change(symbols.getByLabelText('Echelon'), { target: { value: '16' } });
    expect(symbols.getByText('10061000161211000000')).toBeDefined(); // hostile, battalion
    expect(symbols.getByRole('button', { name: 'Infantry' }).getAttribute('aria-pressed')).toBe('true');
    expect(symbols.getByRole('button', { name: 'Armour' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('limits a typed SIDC to 30 characters', async () => {
    const browser = await openBrowser(new FakeServer([layer('A', 0)]));
    const { symbols } = showPanels(browser);
    const field = symbols.getByLabelText('SIDC (APP-6D)') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '1'.repeat(45) } });
    expect(field.value).toHaveLength(30);
  });

  it('shows no hint about a symbol while one is chosen, and asks to choose one otherwise', async () => {
    const server = new FakeServer([layer('A', 0)]);
    const browser = await openBrowser(server);
    const { symbols } = showPanels(browser);
    expect(symbols.getByRole('status').textContent).toBe('Select or create a layer in the layer panel');
    act(() => {
      browser.map.activeLayer.set([...server.layers.keys()][0] ?? null);
    });
    expect(symbols.getByRole('status').textContent).toBe('Choose a symbol, or type a SIDC.');
    fireEvent.click(symbols.getByRole('button', { name: 'Armour' }));
    expect(symbols.queryByRole('status')).toBeNull();
  });
});
