// @vitest-environment jsdom
// SDK 1.3.0 step 2 (CR-0028 part 1, which is CR-0023; ADR-0035): the `wms` source, `provide`'s
// Unsubscribe, a plugin's own settings panel, and the test kit's fakes and `wmsGetMapUrl`.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BACKGROUND_MAP, SYMBOLS, type BackgroundMapProvider, type Settings, type SettingsPanel, type SettingsPanelProps, type WmsSource,
} from '../src/index.ts';
import { createFakeContext, createFakeSymbolService, createFakeUser, wmsGetMapUrl } from '../src/testing/index.ts';

afterEach(cleanup);

const TOPO: WmsSource = { type: 'wms', url: '/api/plugins/basemap-wms/map/topo', layers: ['relief', 'roads'], version: '1.3.0', format: 'image/png' };

function wmsBackground(id: string, source: WmsSource = TOPO): BackgroundMapProvider {
  return { id, name: id, projections: ['EPSG:3857', 'EPSG:3413'], source, attribution: { text: 'Test server' } };
}

function query(url: string): [string, string][] {
  return [...new URL(url, 'http://emc2.test').searchParams.entries()];
}

describe('the wms source (CR-0023 item 1)', () => {
  it('is a background source with codes for projections', () => {
    const provider = wmsBackground('basemap-wms.topo', { ...TOPO, transparent: true, mode: 'image', tileSize: 512 });
    expect(provider.source.type).toBe('wms');
    expect(provider.projections).toEqual(['EPSG:3857', 'EPSG:3413']);
  });
});

describe("provide's Unsubscribe (CR-0023 item 2)", () => {
  it('removes the implementation, notifies getAll once, and a second call does nothing', () => {
    const ctx = createFakeContext({ pluginId: 'basemap-wms', provides: [BACKGROUND_MAP.id] });
    const all = ctx.services.getAll(BACKGROUND_MAP);
    const seen: string[][] = [];
    all.onChange((current) => seen.push(current.map((p) => p.id)));
    const removeTopo = ctx.services.provide(BACKGROUND_MAP, wmsBackground('basemap-wms.topo'));
    ctx.services.provide(BACKGROUND_MAP, wmsBackground('basemap-wms.sea'));
    expect(all.current.map((p) => p.id)).toEqual(['basemap-wms.topo', 'basemap-wms.sea']);

    removeTopo();
    removeTopo();
    expect(all.current.map((p) => p.id)).toEqual(['basemap-wms.sea']);
    expect(seen).toEqual([['basemap-wms.topo'], ['basemap-wms.topo', 'basemap-wms.sea'], ['basemap-wms.sea']]);
  });

  it('provideAs returns one too, and a removed one key is waited for again', async () => {
    const ctx = createFakeContext();
    const first = createFakeSymbolService();
    const remove = ctx.provideAs(SYMBOLS, first);
    await expect(ctx.services.get(SYMBOLS)).resolves.toBe(first);
    remove();
    const second = createFakeSymbolService();
    const waiting = ctx.services.get(SYMBOLS);
    ctx.provideAs(SYMBOLS, second);
    await expect(waiting).resolves.toBe(second);
  });
});

function Panel({ values, save, markUnsaved }: SettingsPanelProps) {
  const name = typeof values.name === 'string' ? values.name : '';
  return (
    <div>
      <span>Saved: {name}</span>
      <button type="button" onClick={() => markUnsaved(true)}>Edit</button>
      <button type="button" onClick={() => void save({ ...values, name: 'Topo' }).then(() => markUnsaved(false))}>Save</button>
    </div>
  );
}
const PANEL: SettingsPanel = { component: Panel };

describe('the settings panel (CR-0023 items 3 and 4)', () => {
  it('is recorded; a second call replaces it; the Unsubscribe brings the form back', () => {
    const ctx = createFakeContext();
    expect(ctx.settingsPanel).toBeNull();
    const removeFirst = ctx.ui.setSettingsPanel(PANEL);
    const other: SettingsPanel = { component: () => null };
    const removeOther = ctx.ui.setSettingsPanel(other);
    expect(ctx.settingsPanel).toBe(other);
    removeFirst();
    expect(ctx.settingsPanel, 'the replaced panel cannot remove its successor').toBe(other);
    removeOther();
    expect(ctx.settingsPanel).toBeNull();
  });

  it('renders with the props; save is recorded, replaces the settings and calls the listeners; markUnsaved is recorded', async () => {
    const ctx = createFakeContext({ settings: { name: 'Old' } });
    const changed = vi.fn();
    ctx.onSettingsChange(changed);
    ctx.ui.setSettingsPanel(PANEL);
    const Component = ctx.settingsPanel!.component;
    const view = render(<Component {...ctx.settingsPanelProps()} />);
    expect(screen.getByText('Saved: Old')).toBeTruthy();

    fireEvent.click(screen.getByText('Edit'));
    expect(ctx.settingsPanelUnsaved).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
      await Promise.resolve();
    });
    expect(ctx.settingsSaves).toEqual([{ name: 'Topo' }]);
    expect(ctx.settings).toEqual({ name: 'Topo' });
    expect(changed).toHaveBeenCalledWith({ name: 'Topo' });
    expect(ctx.settingsPanelUnsaved).toBe(false);

    view.rerender(<Component {...ctx.settingsPanelProps()} />);
    expect(screen.getByText('Saved: Topo')).toBeTruthy();
  });

  it("answers with saveSettings: problems keep the settings; a throw rejects, as a transport failure does", async () => {
    const problems = [{ path: '/servers/0/url', problem: 'must be a URL' }];
    let fail = false;
    const ctx = createFakeContext({
      settings: { servers: [] },
      saveSettings: () => {
        if (fail) throw new Error('connection lost');
        return { ok: false, problems };
      },
    });
    const { save } = ctx.settingsPanelProps();
    const values: Settings = { servers: [{ url: 'nope' }] };
    await expect(save(values)).resolves.toEqual({ ok: false, problems });
    expect(ctx.settings).toEqual({ servers: [] });
    fail = true;
    await expect(save(values)).rejects.toThrow('connection lost');
    expect(ctx.settingsSaves).toHaveLength(2);
  });

  it('rejects a save by a user without settings.admin, as for a refused permission', async () => {
    const ctx = createFakeContext({ settings: { a: 1 }, user: createFakeUser({ permissions: ['objects.edit'] }) });
    await expect(ctx.settingsPanelProps().save({ a: 2 })).rejects.toThrow('settings.admin');
    expect(ctx.settings).toEqual({ a: 1 });
  });
});

describe('wmsGetMapUrl (CR-0023 item 4)', () => {
  const box = { bbox: [10, 55, 20, 65] as const, width: 256, height: 128 };

  it('sends the parameters in order, each once, and nothing else', () => {
    const url = wmsGetMapUrl({ ...TOPO, transparent: true }, { projection: 'EPSG:3857', ...box });
    expect(url.startsWith('/api/plugins/basemap-wms/map/topo?')).toBe(true);
    expect(query(url)).toEqual([
      ['SERVICE', 'WMS'], ['REQUEST', 'GetMap'], ['VERSION', '1.3.0'], ['LAYERS', 'relief,roads'], ['STYLES', ''], ['FORMAT', 'image/png'],
      ['TRANSPARENT', 'TRUE'], ['CRS', 'EPSG:3857'], ['BBOX', '10,55,20,65'], ['WIDTH', '256'], ['HEIGHT', '128'],
    ]);
  });

  it('puts latitude first in EPSG:4326 with WMS 1.3.0 only (latitude ≠ longitude)', () => {
    const v13 = new URL(wmsGetMapUrl(TOPO, { projection: 'EPSG:4326', ...box }), 'http://emc2.test').searchParams;
    expect(v13.get('CRS')).toBe('EPSG:4326');
    expect(v13.get('BBOX'), '55° N to 65° N first, then 10° E to 20° E').toBe('55,10,65,20');

    const v11 = new URL(wmsGetMapUrl({ ...TOPO, version: '1.1.1', format: 'image/jpeg' }, { projection: 'EPSG:4326', ...box }), 'http://emc2.test').searchParams;
    expect(v11.get('SRS')).toBe('EPSG:4326');
    expect(v11.has('CRS')).toBe(false);
    expect(v11.get('BBOX')).toBe('10,55,20,65');
    expect(v11.get('TRANSPARENT')).toBe('FALSE');
    expect(v11.get('FORMAT')).toBe('image/jpeg');
  });

  it("adds to a URL that has a query already", () => {
    expect(wmsGetMapUrl({ ...TOPO, url: '/api/plugins/basemap-wms/map?bg=topo' }, { projection: 'EPSG:3413', ...box })).toMatch(/^\/api\/plugins\/basemap-wms\/map\?bg=topo&SERVICE=WMS&/);
  });

  it('refuses no layers, a size outside 1 to 4096 and an empty box', () => {
    expect(() => wmsGetMapUrl({ ...TOPO, layers: [] }, { projection: 'EPSG:3857', ...box })).toThrow(RangeError);
    expect(() => wmsGetMapUrl(TOPO, { projection: 'EPSG:3857', ...box, width: 4097 })).toThrow(RangeError);
    expect(() => wmsGetMapUrl(TOPO, { projection: 'EPSG:3857', ...box, height: 0 })).toThrow(RangeError);
    expect(() => wmsGetMapUrl(TOPO, { projection: 'EPSG:3857', ...box, width: 10.5 })).toThrow(RangeError);
    expect(() => wmsGetMapUrl(TOPO, { projection: 'EPSG:3857', bbox: [20, 55, 10, 65], width: 1, height: 1 })).toThrow(RangeError);
    expect(wmsGetMapUrl(TOPO, { projection: 'EPSG:3857', ...box, width: 4096, height: 1 })).toContain('WIDTH=4096&HEIGHT=1');
  });
});
