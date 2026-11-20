import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.tsx';
import { Setups } from '../setups/setups.ts';
import { memoryDocuments, pluginEntry, settingsServices } from '../testing/fakes.ts';
import { ShellStore, type LoginInfo } from './store.ts';

function shell(login: LoginInfo | null) {
  const store = new ShellStore();
  store.setPlugins([pluginEntry('coordinates', { name: 'Coordinates', hasSettings: true }), pluginEntry('layer-panel', { name: 'Layers' })]);
  if (login !== null) store.setLogin(login);
  const { container } = render(<App store={store} services={settingsServices()} />);
  return { store, container };
}

const views = () => within(screen.getByRole('tablist', { name: 'Views' }));
const tabNames = () => views().getAllByRole('tab').map((t) => t.textContent);

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined))); // the server status
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('the top bar', () => {
  it('switches views with its tabs, keeps the tab in the address, and keeps the map in place under the others', () => {
    const { container } = shell({ mode: 'none', user: { id: 'local', name: 'Local user' } });
    expect(tabNames()).toEqual(['View', 'Settings', 'Monitor']); // a plugin's settings are in the Settings list
    const map = container.querySelector('.view-map');
    expect(map?.getAttribute('aria-hidden')).toBe('false');

    fireEvent.click(screen.getByRole('tab', { name: 'Monitor' }));

    expect(screen.getByRole('tab', { name: 'Monitor' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Monitor' })).toBeTruthy();
    expect(window.location.hash).toBe('#monitor');
    expect(container.querySelector('.view-map')).toBe(map); // the same element: the map was not unmounted
    expect(map?.getAttribute('aria-hidden')).toBe('true');
    expect(map?.hasAttribute('inert')).toBe(true);

    fireEvent.click(views().getByRole('tab', { name: 'Settings' }));
    expect(window.location.hash).toBe('#settings');
    fireEvent.click(screen.getByRole('tab', { name: 'Coordinates' })); // its Settings entry
    expect(window.location.hash).toBe('#settings/plugin/coordinates');
    fireEvent.click(views().getByRole('tab', { name: 'Monitor' }));
    fireEvent.click(views().getByRole('tab', { name: 'Settings' })); // back to the entry chosen
    expect(window.location.hash).toBe('#settings/plugin/coordinates');

    fireEvent.click(screen.getByRole('tab', { name: 'View' }));
    expect(window.location.hash).toBe('');
    expect(map?.getAttribute('aria-hidden')).toBe('false');
  });

  it('is one tab stop: arrow keys, Home and End move between the tabs and choose them', () => {
    shell({ mode: 'none', user: { id: 'local', name: 'Local user' } });
    const tab = (name: string) => views().getByRole('tab', { name });
    expect(views().getAllByRole('tab').map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    expect(tab('View').getAttribute('aria-controls')).toBe(screen.getByRole('tabpanel', { name: 'View' }).id);

    fireEvent.keyDown(tab('View'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('Settings'));
    expect(tab('Settings').getAttribute('aria-selected')).toBe('true');
    expect(tab('Settings').getAttribute('aria-controls')).toBe(screen.getByRole('tabpanel', { name: 'Settings' }).id);
    fireEvent.keyDown(tab('Settings'), { key: 'End' });
    expect(document.activeElement).toBe(tab('Monitor'));
    fireEvent.keyDown(tab('Monitor'), { key: 'ArrowRight' }); // round to the first
    expect(document.activeElement).toBe(tab('View'));
    fireEvent.keyDown(tab('View'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tab('Monitor'));
    fireEvent.keyDown(tab('Monitor'), { key: 'Home' });
    expect(tab('View').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { level: 1, name: 'View' })).toBeTruthy();
  });

  it('opens the tab the address names, and follows a changed address', () => {
    window.history.replaceState(null, '', '/#settings');
    shell({ mode: 'oidc', user: { id: 'a', name: 'Alice', permissions: ['settings.admin'] } });
    expect(screen.getByRole('tabpanel', { name: 'Settings' })).toBeTruthy();

    act(() => {
      window.history.replaceState(null, '', '/#monitor');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByRole('tabpanel', { name: 'Monitor' })).toBeTruthy();
  });

  it('shows only View, and the map, to a user without settings.admin, whatever the address says', () => {
    window.history.replaceState(null, '', '/#monitor');
    const { container } = shell({ mode: 'oidc', user: { id: 'b', name: 'Bob', permissions: ['objects.edit'] } });

    expect(tabNames()).toEqual(['View']);
    expect(screen.queryByRole('tabpanel', { name: 'Monitor' })).toBeNull();
    expect(container.querySelector('.view-map')?.getAttribute('aria-hidden')).toBe('false');
  });

  it('shows who is logged in with a logout button, or the "No login" mark', () => {
    const { store } = shell({ mode: 'oidc', user: { id: 'a', name: 'Alice', permissions: [] } });
    expect(screen.getByRole('status', { name: 'Login' }).textContent).toBe('Logged in as Alice');
    // One line, cut when room is short (shell.css): the whole text is the tooltip (owner, 2026-11-12).
    expect(screen.getByRole('status', { name: 'Login' }).getAttribute('title')).toBe('Logged in as Alice');
    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
    act(() => { store.setLive('logged-out'); }); // the login session has ended
    expect(screen.getByRole('status', { name: 'Login' }).textContent).toBe('Login ended');
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull();
    cleanup();

    shell({ mode: 'none', user: { id: 'local', name: 'Local user' } });
    expect(screen.getByRole('status', { name: 'Login' }).textContent).toMatch(/^No login: /);
    expect(screen.getByRole('status', { name: 'Login' }).getAttribute('title'))
      .toBe(screen.getByRole('status', { name: 'Login' }).textContent);
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull();
  });

  it('"Log out" saves the setup first, then logs out once, however often it is clicked (review F3, F4)', async () => {
    const store = new ShellStore();
    store.setLogin({ mode: 'oidc', user: { id: 'a', name: 'Alice', permissions: [] } });
    const setups = new Setups({ store, documents: memoryDocuments().documents });
    const order: string[] = [];
    vi.spyOn(setups, 'finish').mockImplementation(() => { order.push('finish'); return Promise.resolve(); });
    vi.mocked(fetch).mockImplementation((path) => {
      if (path === '/logout') order.push('POST /logout');
      return new Promise<Response>(() => undefined);
    });
    render(<App store={store} services={{ ...settingsServices(), setups }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await vi.waitFor(() => { expect(order).toEqual(['finish', 'POST /logout']); });
    expect(screen.getByRole('button', { name: 'Log out' }).getAttribute('aria-disabled')).toBe('true');
  });

  it("shows the plugins' items by order, then the clock, the login and the help menu, and drops a failing item's plugin to DEGRADED", () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { store, container } = shell({ mode: 'none', user: { id: 'local', name: 'Local user' } });
    let remove = () => undefined as unknown;
    act(() => {
      store.addTopBarItem('bookmarks', { id: 'menu', order: 50, component: () => <button type="button">Bookmarks</button> });
      remove = store.addTopBarItem('search', { id: 'box', component: () => <button type="button">Search</button> });
      store.addTopBarItem('coordinates', { id: 'bad', order: 10, component: () => { throw new Error('no'); } });
    });
    const end = container.querySelector('.top-bar-end');
    expect([...(end?.children ?? [])].map((c) => c.className)).toEqual(['top-bar-items', 'look-control', 'clock', 'no-login', 'help-control']);
    expect([...(end?.querySelectorAll('.top-bar-item') ?? [])].map((i) => i.textContent)).toEqual(['coordinates failed: no', 'Bookmarks', 'Search']);
    expect(store.getView().plugins.find((p) => p.id === 'coordinates')?.observed).toEqual({ state: 'DEGRADED', detail: 'top bar item bad failed: no' });

    act(() => { remove(); store.removeUiOf('bookmarks'); store.removeUiOf('coordinates'); });
    expect(container.querySelector('.top-bar-items')).toBeNull();
  });

  it('has a clock in UTC that switches to local time and back', () => {
    const { store } = shell(null);
    const clock = screen.getByRole('button', { name: /^Time, UTC: \d{6}Z [A-Z]{3} \d{2}\. Switch to local time$/ });
    fireEvent.click(clock);
    expect(store.getView().clock).toBe('local');
    expect(clock.getAttribute('aria-label')).toMatch(/^Time, local: \d{6}[A-Z] [A-Z]{3} \d{2}\. Switch to UTC$/);
    fireEvent.click(clock);
    expect(store.getView().clock).toBe('utc');
  });
});

describe("the plugins' items by workspace (SDK 1.6.0, T-152)", () => {
  it('shows an item only in its workspaces, one without a list everywhere, and on Settings only those of every workspace', () => {
    const { store, container } = shell({ mode: 'none', user: { id: 'local', name: 'Local user' } });
    act(() => {
      store.setWorkspaces([{ id: 'simulator.simulation', name: 'Simulation', viewPermission: 'v', editPermission: 'e', order: 10 }]);
      store.addTopBarItem('simulator', { id: 'scenario', order: 20, workspaces: ['simulator.simulation'], component: () => <span>Scenario</span> });
      store.addTopBarItem('bookmarks', { id: 'menu', order: 50, component: () => <span>Bookmarks</span> });
      store.addTopBarItem('search', { id: 'box', order: 60, workspaces: ['*'], component: () => <span>Search</span> });
    });
    const items = () => [...container.querySelectorAll('.top-bar-item')].map((i) => i.textContent);

    expect(items()).toEqual(['Bookmarks', 'Search']); // View
    act(() => { store.setWorkspace('simulator.simulation'); store.setTab('workspace/simulator.simulation'); });
    expect(items()).toEqual(['Scenario', 'Bookmarks', 'Search']);
    act(() => { store.setTab('settings'); });
    expect(items()).toEqual(['Bookmarks', 'Search']);
  });
});

describe('the workspace tabs (ADR-0039 point 2)', () => {
  it('come between View and Settings; only the workspace shown controls the map\'s panel, named by its tab', () => {
    const { store } = shell({ mode: 'none', user: { id: 'local', name: 'Local user' } });
    act(() => { store.setWorkspaces([{ id: 'simulator.simulation', name: 'Simulation', viewPermission: 'v', editPermission: 'e', order: 10 }]); });

    expect(tabNames()).toEqual(['View', 'Simulation', 'Settings', 'Monitor']);
    act(() => { store.setWorkspace('simulator.simulation'); store.setTab('workspace/simulator.simulation'); });

    const sim = views().getByRole('tab', { name: 'Simulation' });
    const view = views().getByRole('tab', { name: 'View' });
    expect(sim.getAttribute('aria-selected')).toBe('true');
    expect(sim.getAttribute('aria-controls')).toBe('view-view');
    expect(view.getAttribute('aria-controls')).toBeNull();
    expect(screen.getByRole('tabpanel', { name: 'Simulation' })).toBeTruthy();
  });
});
