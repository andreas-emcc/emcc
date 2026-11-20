import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.tsx';
import { pluginEntry, settingsServices } from '../../testing/fakes.ts';
import { ShellStore } from '../store.ts';

/** The shell with three plugins, two of them with settings; the settings never arrive (forms stay loading). */
function shell(address = '/#settings') {
  window.history.replaceState(null, '', address);
  const store = new ShellStore();
  store.setPlugins([
    pluginEntry('symbology', { name: 'Symbology', hasSettings: true }),
    pluginEntry('layer-panel', { name: 'Layers' }),
    pluginEntry('coordinates', { name: 'Coordinates', hasSettings: true }),
  ]);
  store.setLogin({ mode: 'none', user: { id: 'local', name: 'Local user' } });
  const services = settingsServices();
  render(<App store={store} services={services} />);
  return { store, services };
}

const list = () => within(screen.getByRole('tablist', { name: 'Settings' }));
/** The entry shown, on the right of the list. */
const entry = () => {
  const shown = document.getElementById('settings-entry');
  if (shown === null) throw new Error('no entry shown');
  return shown;
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined))); // the server status
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('the Settings list by category (SDK 1.6.0, T-174)', () => {
  const headings = () => [...document.querySelectorAll('.settings-list-heading')].map((h) => h.textContent);

  it("groups the entries under the categories in their order, the shell's own first in General, each plugin by name", () => {
    window.history.replaceState(null, '', '/#settings');
    const store = new ShellStore();
    store.setPlugins([
      pluginEntry('gmti', { name: 'GMTI', hasSettings: true, category: 'data-links' }),
      pluginEntry('ais', { name: 'AIS', hasSettings: true, category: 'data-links' }),
      pluginEntry('symbology', { name: 'Symbology', hasSettings: true, category: 'map-and-symbols' }),
      pluginEntry('bookmarks', { name: 'Bookmarks', hasSettings: true }), // none named: General
      pluginEntry('odd', { name: 'Odd', hasSettings: true, category: 'weather' }), // not in the list: General
    ]);
    store.setLogin({ mode: 'none', user: { id: 'local', name: 'Local user' } });
    render(<App store={store} services={settingsServices()} />);

    expect(headings()).toEqual(['Data Links', 'Map and Symbols', 'General']); // the empty ones left out
    expect(list().getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'AIS', 'GMTI', 'Symbology', 'General', 'Display', 'Data types', 'Layers', 'Labeling', 'Bookmarks', 'Odd',
    ]);
    expect(list().getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe('true'); // still the default
    expect(list().getByRole('tab', { name: 'GMTI' }).getAttribute('aria-describedby')).toBe('settings-category-data-links');
    expect(document.getElementById('settings-category-data-links')?.getAttribute('role')).toBe('presentation');

    // The keys move over the entries only, across the headings.
    fireEvent.keyDown(list().getByRole('tab', { name: 'General' }), { key: 'ArrowUp' });
    expect(list().getByRole('tab', { name: 'Symbology' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(list().getByRole('tab', { name: 'Symbology' }), { key: 'Home' });
    expect(list().getByRole('tab', { name: 'AIS' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('the Settings list (ADR-0031 point 2)', () => {
  it('lists General, Data types, Layers, then each plugin with settings by name, and shows the first', () => {
    shell();
    expect(list().getAllByRole('tab').map((t) => t.textContent)).toEqual(['General', 'Display', 'Data types', 'Layers', 'Labeling', 'Coordinates', 'Symbology']);
    expect(screen.getByRole('tablist', { name: 'Settings' }).getAttribute('aria-orientation')).toBe('vertical');
    expect(list().getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe('true');
    expect(within(entry()).getByRole('heading', { level: 2, name: 'General' })).toBeTruthy();
  });

  it("shows a plugin's form in its entry, and keeps the entry in the address", () => {
    shell();
    fireEvent.click(list().getByRole('tab', { name: 'Symbology' }));
    expect(window.location.hash).toBe('#settings/plugin/symbology');
    const shown = entry();
    expect(shown.getAttribute('aria-labelledby')).toBe(list().getByRole('tab', { name: 'Symbology' }).id);
    expect(within(shown).getByRole('heading', { level: 2, name: 'Symbology' })).toBeTruthy();
    expect(within(shown).getByText('Loading the settings…')).toBeTruthy();
  });

  it('is one tab stop: Up, Down, Home and End choose the entries and move the focus', () => {
    shell();
    const tab = (name: string) => list().getByRole('tab', { name });
    expect(list().getAllByRole('tab').map((t) => t.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1]);
    fireEvent.keyDown(tab('General'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(tab('Display'));
    expect(within(entry()).getByText('The display settings are not available here.')).toBeTruthy(); // nor the display settings
    fireEvent.keyDown(tab('Display'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(tab('Data types'));
    fireEvent.keyDown(tab('Data types'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(tab('Layers'));
    expect(window.location.hash).toBe('#settings/layers');
    expect(within(entry()).getByText('The layers are not available here.')).toBeTruthy(); // this test's services have none
    fireEvent.keyDown(tab('Layers'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(tab('Labeling'));
    expect(window.location.hash).toBe('#settings/labeling');
    expect(within(entry()).getByText('The labeling settings are not available here.')).toBeTruthy();
    fireEvent.keyDown(tab('Labeling'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(tab('Coordinates'));
    expect(window.location.hash).toBe('#settings/plugin/coordinates');
    fireEvent.keyDown(tab('Coordinates'), { key: 'End' });
    expect(document.activeElement).toBe(tab('Symbology'));
    fireEvent.keyDown(tab('Symbology'), { key: 'ArrowDown' }); // round to the first
    expect(document.activeElement).toBe(tab('General'));
    fireEvent.keyDown(tab('General'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(tab('Symbology'));
    fireEvent.keyDown(tab('Symbology'), { key: 'Home' });
    expect(tab('General').getAttribute('aria-selected')).toBe('true');
  });

  it('keeps an edit typed in an entry while another entry is shown, and shows it again', async () => {
    window.history.replaceState(null, '', '/#settings/plugin/coordinates');
    const store = new ShellStore();
    store.setPlugins([pluginEntry('coordinates', { name: 'Coordinates', hasSettings: true }), pluginEntry('symbology', { name: 'Symbology', hasSettings: true })]);
    store.setLogin({ mode: 'none', user: { id: 'local', name: 'Local user' } });
    const schema = { type: 'object', properties: { mgrsPrecision: { type: 'integer', minimum: 1, maximum: 5 } } };
    const services = settingsServices(() => Promise.resolve(Response.json({ schema, values: { mgrsPrecision: 5 } })));
    const subscribed = vi.spyOn(services.drafts, 'subscribe');
    render(<App store={store} services={services} />);
    // The form takes input once it is subscribed to the drafts (see PluginSettingsView.test.tsx, showForm).
    await waitFor(() => { expect(subscribed).toHaveBeenCalled(); });
    fireEvent.change(await screen.findByLabelText('Mgrs precision'), { target: { value: '3' } });

    fireEvent.click(list().getByRole('tab', { name: 'Symbology' }));
    expect(screen.queryByLabelText('Mgrs precision')).toBeNull();
    fireEvent.click(list().getByRole('tab', { name: /^Coordinates, \d+ unsaved changes?$/ }));

    expect((await screen.findByLabelText<HTMLInputElement>('Mgrs precision')).value).toBe('3');
  });

  it('marks each entry with the count of its unsaved changes, also for screen readers (T-203 part C)', () => {
    const { services } = shell();
    act(() => { services.drafts.edit('plugin/coordinates', { x: 1, y: 1 }, { x: 2, y: 3 }); });
    const coordinates = list().getByRole('tab', { name: 'Coordinates, 2 unsaved changes' });
    expect(coordinates.querySelector('.unsaved-count')?.textContent, 'a count, not a bare dot').toBe('2');
    expect(list().getByRole('tab', { name: 'Data types' })).toBeTruthy();
    act(() => { services.drafts.edit('data-type/core.general', { fadeWhenExpired: false }, { fadeWhenExpired: true }); });
    act(() => { services.drafts.edit('data-type/cot.track', { fadeWhenExpired: false }, { fadeWhenExpired: true }); });
    expect(list().getByRole('tab', { name: 'Data types, 2 unsaved changes' }), 'all its drafts together').toBeTruthy();
    act(() => { services.drafts.drop('plugin/coordinates'); });
    expect(list().getByRole('tab', { name: 'Coordinates' })).toBeTruthy();
  });

  it('gives every entry an icon and filters the list by name, the keys moving over what is shown (T-203 part C)', () => {
    shell();
    const tabs = () => list().getAllByRole('tab');
    expect(tabs().every((t) => t.querySelector('svg.settings-list-icon') !== null), 'an icon per entry').toBe(true);
    expect(list().getByRole('tab', { name: 'Coordinates' }).querySelector('svg')?.classList.contains('lucide-panel-top'), 'no manifest icon: the neutral one').toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter' }), { target: { value: 'LAYER' } });
    expect(tabs().map((t) => t.textContent)).toEqual(['Layers']);
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter' }), { target: { value: 'nothing' } });
    expect(list().queryAllByRole('tab')).toEqual([]);
    expect(screen.getByText('No setting matches.')).toBeTruthy();
  });

  it("opens the plugin's entry for an address of M1's plugin tabs, and puts the new address in its place", () => {
    shell('/#plugin/coordinates');
    expect(list().getByRole('tab', { name: 'Coordinates' }).getAttribute('aria-selected')).toBe('true');
    expect(window.location.hash).toBe('#settings/plugin/coordinates');
  });

  it('shows the first entry for a plugin that is gone or disabled, and follows a changed address', () => {
    const { store } = shell('/#settings/plugin/cot');
    expect(list().getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe('true');
    act(() => {
      window.history.replaceState(null, '', '/#settings/plugin/symbology');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(list().getByRole('tab', { name: 'Symbology' }).getAttribute('aria-selected')).toBe('true');
    act(() => { store.setPlugins([pluginEntry('symbology', { name: 'Symbology', hasSettings: true, active: false })]); });
    expect(list().getAllByRole('tab').map((t) => t.textContent)).toEqual(['General', 'Display', 'Data types', 'Layers', 'Labeling']);
    expect(list().getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe('true');
  });
});
