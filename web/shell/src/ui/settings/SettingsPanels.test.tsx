import type { SettingsPanelProps, SettingsSaveResult } from '@emc2/plugin-sdk';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.tsx';
import { pluginEntry, settingsServices } from '../../testing/fakes.ts';
import { ShellStore, type LoginInfo } from '../store.ts';

const ADMIN: LoginInfo = { mode: 'none', user: { id: 'local', name: 'Local user' } };

/** The shell on Settings › WMS, with a second plugin with settings; the generated forms never load. */
function shell(login: LoginInfo = ADMIN) {
  window.history.replaceState(null, '', '/#settings/plugin/basemap-wms');
  const store = new ShellStore();
  store.setPlugins([
    pluginEntry('basemap-wms', { name: 'WMS', hasSettings: true }),
    pluginEntry('coordinates', { name: 'Coordinates', hasSettings: true }),
  ]);
  store.setLogin(login);
  const services = settingsServices();
  services.shared.settingsChanged('basemap-wms', { url: 'http://wms.test/' });
  render(<App store={store} services={services} />);
  return { store, services };
}

/** A panel with an edit of its own, counting its mounts, that reports what it was given. */
function wmsPanel() {
  const seen: { props: SettingsPanelProps | null; mounts: number } = { props: null, mounts: 0 };
  function Panel(props: SettingsPanelProps) {
    const [draft, setDraft] = useState(typeof props.values.url === 'string' ? props.values.url : '');
    seen.props = props;
    useEffect(() => { seen.mounts++; }, []);
    return (
      <label>
        Server
        <input value={draft} onChange={(e) => { setDraft(e.target.value); props.markUnsaved(true); }} />
      </label>
    );
  }
  return { panel: { component: Panel }, seen };
}

const list = () => within(screen.getByRole('tablist', { name: 'Settings' }));
const entryShown = () => document.getElementById('settings-entry') as HTMLElement;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined))); // the server status, the forms
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe("a plugin's own settings panel (SDK 1.3.0, ADR-0035; T-073)", () => {
  it('is shown instead of the generated form, above the declared fields, with the saved values; another admin\'s save arrives', () => {
    const t = shell();
    expect(within(entryShown()).getByText('Loading the settings…')).toBeTruthy(); // the form, until a panel is set
    const { panel, seen } = wmsPanel();
    act(() => { t.store.setSettingsPanel('basemap-wms', panel); });

    expect(within(entryShown()).getByRole('textbox', { name: 'Server' })).toHaveProperty('value', 'http://wms.test/');
    expect(within(entryShown()).queryByText('Loading the settings…')).toBeNull();
    act(() => { t.services.shared.settingsChanged('basemap-wms', { url: 'http://other.test/' }); });
    expect(seen.props?.values).toEqual({ url: 'http://other.test/' });
  });

  it('saves the whole values: the stored ones, the server\'s problems, or a rejection for anything else', async () => {
    const t = shell();
    const { panel, seen } = wmsPanel();
    act(() => { t.store.setSettingsPanel('basemap-wms', panel); });
    const save = vi.spyOn(t.services.api, 'savePlugin');

    save.mockResolvedValueOnce({ ok: true, value: { url: 'http://saved.test/' } });
    await expect(seen.props?.save({ url: 'http://saved.test' })).resolves.toEqual<SettingsSaveResult>({ ok: true, values: { url: 'http://saved.test/' } });
    expect(save).toHaveBeenCalledWith('basemap-wms', { url: 'http://saved.test' });

    save.mockResolvedValueOnce({ ok: false, message: 'refused', problems: [{ path: '/url', problem: 'not a URL' }], invalid: true });
    await expect(seen.props?.save({ url: 'x' })).resolves.toEqual({ ok: false, problems: [{ path: '/url', problem: 'not a URL' }] });

    save.mockResolvedValueOnce({ ok: false, message: 'This needs the settings.admin permission.', problems: [] });
    await expect(seen.props?.save({ url: 'x' })).rejects.toThrow('This needs the settings.admin permission.');
    save.mockResolvedValueOnce({ ok: false, message: 'The server did not answer. Your edits are kept; try again.', problems: [] });
    await expect(seen.props?.save({ url: 'x' })).rejects.toThrow(/did not answer/);
  });

  it('stays mounted across entries and tabs, so its unsaved edit stays; the entry and leaving the page say it is unsaved', () => {
    const t = shell();
    const { panel, seen } = wmsPanel();
    act(() => { t.store.setSettingsPanel('basemap-wms', panel); });
    fireEvent.change(within(entryShown()).getByRole('textbox', { name: 'Server' }), { target: { value: 'http://typed.test/' } });
    expect(list().getByRole('tab', { name: 'WMS, unsaved changes' })).toBeTruthy();

    fireEvent.click(list().getByRole('tab', { name: 'Coordinates' }));
    expect(within(entryShown()).queryByRole('textbox', { name: 'Server' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Monitor' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    fireEvent.click(list().getByRole('tab', { name: 'WMS, unsaved changes' }));

    expect(within(entryShown()).getByRole('textbox', { name: 'Server' })).toHaveProperty('value', 'http://typed.test/');
    expect(seen.mounts).toBe(1);
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    act(() => { seen.props?.markUnsaved(false); });
    expect(list().getByRole('tab', { name: 'WMS' })).toBeTruthy();
  });

  it('a second one replaces the first, and its undo brings the form back; an old undo does nothing', () => {
    const t = shell();
    const first = wmsPanel();
    const second = wmsPanel();
    let undoFirst = () => undefined as unknown;
    act(() => { undoFirst = t.store.setSettingsPanel('basemap-wms', first.panel); });
    let undoSecond = () => undefined as unknown;
    act(() => { undoSecond = t.store.setSettingsPanel('basemap-wms', second.panel); });
    expect(second.seen.mounts).toBe(1);
    act(() => { undoFirst(); });
    expect(within(entryShown()).getByRole('textbox', { name: 'Server' })).toBeTruthy();

    act(() => { undoSecond(); });
    expect(within(entryShown()).queryByRole('textbox', { name: 'Server' })).toBeNull();
    expect(within(entryShown()).getByText('Loading the settings…')).toBeTruthy();
  });

  it('one that fails makes its plugin DEGRADED, and the entry shows the generated form below a note (owner, 2026-10-30)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const t = shell();
    act(() => { t.store.setSettingsPanel('basemap-wms', { component: () => { throw new Error('no layers'); } }); });

    expect(within(entryShown()).getByRole('alert').textContent)
      .toBe("The plugin's own settings panel failed: no layers. The form below changes the same settings.");
    expect(within(entryShown()).getByText('Loading the settings…')).toBeTruthy();
    expect(t.store.getView().plugins.find((p) => p.id === 'basemap-wms')?.observed)
      .toEqual({ state: 'DEGRADED', detail: 'settings panel failed: no layers' });
  });

  it('is not mounted at all for a user without settings.admin, and goes with its plugin\'s UI', () => {
    const t = shell({ mode: 'oidc', user: { id: 'b', name: 'Bob', permissions: ['objects.edit'] } });
    const { panel, seen } = wmsPanel();
    act(() => { t.store.setSettingsPanel('basemap-wms', panel); });
    expect(seen.mounts).toBe(0);
    cleanup();

    const admin = shell();
    act(() => { admin.store.setSettingsPanel('basemap-wms', panel); });
    expect(seen.mounts).toBe(1);
    act(() => { admin.store.removeUiOf('basemap-wms'); });
    expect(admin.store.getView().settingsPanels).toEqual([]);
  });
});
