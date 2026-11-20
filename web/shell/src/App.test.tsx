import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import { pluginEntry, settingsServices } from './testing/fakes.ts';
import { addStatusPanel } from './ui/status.ts';
import { INFO_LIFETIME_MS, ShellStore } from './ui/store.ts';

function stubFetch(response: Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(() => response));
}

/** The app as boot makes it: with the shell's Status panel, which the user has expanded (panels start collapsed, T-153). */
function show(store = new ShellStore()) {
  addStatusPanel(store);
  store.setPanelCollapsed('core-shell/status', false);
  render(<App store={store} services={settingsServices()} />);
  return store;
}

beforeEach(() => {
  stubFetch(new Promise<Response>(() => undefined));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('App', () => {
  it('shows the Map Pane and the Control Pane, the right pane, with the Status panel', () => {
    show();
    expect(screen.getByRole('main', { name: 'Map Pane' })).toBeDefined();
    expect(within(screen.getByRole('complementary', { name: 'Control Pane' })).getByRole('region', { name: 'Status' })).toBeDefined();
    expect(screen.getByText('No map view plugin is active.')).toBeDefined();
  });

  it('shows the server status from /api/health', async () => {
    stubFetch(Promise.resolve(Response.json({ status: 'UP', ecore: 'RUNNING' })));
    show();
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Server' }).textContent).toBe('Server: UP (ECore RUNNING)');
    });
  });

  it('says so when the server cannot be reached, or answers with an error', async () => {
    stubFetch(Promise.reject(new TypeError('Failed to fetch')));
    show();
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Server' }).textContent).toBe('Server: not reachable');
    });
    cleanup();
    stubFetch(Promise.resolve(new Response('', { status: 503 })));
    show();
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Server' }).textContent).toBe('Server: not reachable');
    });
  });

  it('marks the no-login mode so that nobody takes it for a protected system', () => {
    const store = show();
    expect(screen.queryByRole('status', { name: 'Login' })).toBeNull();
    act(() => { store.setLogin({ mode: 'none', user: { id: 'local', name: 'Local user' } }); });
    const mark = screen.getByRole('status', { name: 'Login' });
    expect(mark.textContent).toBe('No login: everyone who reaches this server works as Local user, with all permissions.');
    expect(mark.className).toBe('no-login');
  });

  it('shows who is logged in', async () => {
    const store = show();
    act(() => { store.setLogin({ mode: 'oidc', user: { id: 'a1', name: 'alice' } }); });
    expect(screen.getByRole('status', { name: 'Login' }).textContent).toBe('Logged in as alice');
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    // After the setup's last save (Setups.finish), which needs no server here.
    await vi.waitFor(() => { expect(vi.mocked(fetch)).toHaveBeenCalledWith('/logout', { method: 'POST', headers: { Accept: 'application/json' } }); });
    act(() => { store.setLogin({ mode: 'oidc', user: null }); });
    expect(screen.getByRole('status', { name: 'Login' }).textContent).toBe('Not logged in');
  });

  it('shows the state of the live picture connection', () => {
    const store = show();
    const live = () => screen.getByRole('status', { name: 'Live picture' }).textContent;
    expect(live()).toBe('Live picture: not connected, retrying');
    act(() => { store.setLive('open'); });
    expect(live()).toBe('Live picture: connected');
    act(() => { store.setLive('incompatible'); });
    expect(live()).toBe('Live picture: the server has another version: reload the page');
    expect(screen.queryByRole('button', { name: 'Log in again' })).toBeNull();
    act(() => { store.setLive('logged-out'); });
    expect(live()).toBe('Live picture: your login has ended');
    expect(screen.getByRole('button', { name: 'Log in again' })).toBeDefined();
  });

  it('says over the map while the live picture is not connected, also with the Status panel collapsed, and offers what helps', () => {
    const store = show();
    const region = screen.getByRole('main', { name: 'Map Pane' }).parentElement?.querySelector('[aria-live="polite"]');
    const notice = () => region?.querySelector('.live-notice span')?.textContent ?? null;
    act(() => { store.setPanelCollapsed('core-shell/status', true); store.setPaneCollapsed('right', true); });
    expect(notice()).toBe('Live picture: not connected, retrying');
    act(() => { store.setLive('open'); });
    expect(notice()).toBeNull();
    expect(screen.getByRole('main', { name: 'Map Pane' }).parentElement?.querySelector('[aria-live="polite"]')).toBe(region); // stays, for screen readers
    act(() => { store.setLive('incompatible'); });
    expect(within(region as HTMLElement).getByRole('button', { name: 'Reload' })).toBeDefined();
    act(() => { store.setLive('logged-out'); });
    expect(notice()).toBe('Live picture: your login has ended');
    expect(within(region as HTMLElement).getByRole('button', { name: 'Log in again' })).toBeDefined();
  });

  it('shows the plugins\' panels by order, then in the order they were added', () => {
    const store = show();
    act(() => {
      store.addPanel('a', { id: 'late', title: 'Late', order: 200, component: () => <p>late</p> });
      store.addPanel('b', { id: 'first', title: 'First', order: 10, component: () => <p>first</p> });
      store.addPanel('a', { id: 'default-1', title: 'Default one', component: () => <p>one</p> });
      store.addPanel('c', { id: 'default-2', title: 'Default two', component: () => <p>two</p> });
    });
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual(['First', 'Default one', 'Default two', 'Late', 'Status']);
    expect(within(screen.getByRole('region', { name: 'First' })).getByText('first')).toBeDefined();
  });

  it('a panel that fails to render is replaced by a message and reported; the others stay', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = show();
    act(() => {
      store.setPlugins([pluginEntry('bad'), pluginEntry('good')]);
      store.setLoad('bad', 'active');
      store.addPanel('bad', { id: 'bad', title: 'Bad', component: () => { throw new Error('render failed'); } });
      store.addPanel('good', { id: 'good', title: 'Good', component: () => <p>still here</p> });
      store.setPanelCollapsed('bad/bad', false);
      store.setPanelCollapsed('good/good', false);
    });
    expect(screen.getByRole('alert').textContent).toBe('Bad failed: render failed');
    expect(screen.getByText('still here')).toBeDefined();
    expect(store.getView().plugins[0]?.observed).toEqual({ state: 'DEGRADED', detail: 'panel bad failed: render failed' });
  });

  it('removing a panel removes it from the Control Pane', () => {
    const store = show();
    let remove = () => undefined as unknown;
    act(() => { remove = store.addPanel('a', { id: 'p', title: 'Panel', component: () => <p>x</p> }); });
    expect(screen.getByRole('heading', { level: 2, name: 'Panel' })).toBeDefined();
    act(() => { remove(); });
    expect(screen.queryByRole('heading', { level: 2, name: 'Panel' })).toBeNull();
  });

  it('puts overlays into their corners of the Map Pane', () => {
    const store = show();
    act(() => {
      store.addOverlay('coords', { id: 'cursor', position: 'bottom-left', component: () => <span>59°N</span> });
      store.addOverlay('map', { id: 'notice', position: 'top-right', order: 1, component: () => <span>software rendering</span> });
    });
    const pane = screen.getByRole('main', { name: 'Map Pane' });
    expect(pane.querySelector('.overlays-bottom-left')?.textContent).toBe('59°N');
    expect(pane.querySelector('.overlays-top-right')?.textContent).toBe('software rendering');
  });

  it('mounts the map view into the Map Pane once, and unmounts it when it goes', () => {
    const store = show();
    const unmount = vi.fn();
    const mount = vi.fn<(element: HTMLElement) => () => void>(() => unmount);
    act(() => { store.setMapView('map', { mount }); });

    expect(mount).toHaveBeenCalledTimes(1);
    expect(mount.mock.calls[0]?.[0]).toBe(screen.getByTestId('map-host'));
    expect(screen.queryByText('No map view plugin is active.')).toBeNull();

    act(() => { store.removeUiOf('map'); });
    expect(unmount).toHaveBeenCalledTimes(1);
  });

  it('reports a map view that cannot be mounted', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = show();
    act(() => {
      store.setPlugins([pluginEntry('map', { kind: 'map-view' })]);
      store.setMapView('map', { mount: () => { throw new Error('no WebGL'); } });
    });
    expect(store.getView().plugins[0]?.observed).toEqual({ state: 'FAILED', detail: 'the map view could not be mounted: Error: no WebGL' });
    expect(screen.getByText('The map (map) could not be shown.')).toBeDefined();
  });

  it('shows notifications with their source; info ones go away by themselves, others when dismissed', () => {
    vi.useFakeTimers();
    const store = show();
    act(() => {
      store.setPlugins([pluginEntry('draw', { name: 'Draw symbols' })]);
      store.notify('draw', { severity: 'info', message: 'Symbol placed' });
      store.notify(null, { severity: 'error', message: 'Something broke' });
    });
    const list = screen.getByRole('list', { name: 'Notifications' });
    expect(list.textContent).toContain('Draw symbols: Symbol placed');
    expect(list.textContent).toContain('Something broke');

    act(() => { vi.advanceTimersByTime(INFO_LIFETIME_MS); });
    expect(screen.queryByText('Symbol placed')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('list', { name: 'Notifications' })).toBeNull();
  });

  it('lists the plugins with their server and web status', () => {
    const store = show();
    act(() => {
      store.setPlugins([
        pluginEntry('ok'),
        pluginEntry('server-only', { web: null }),
        pluginEntry('off', { active: false, status: { state: 'FAILED', detail: 'needs SDK ^9.0.0' } }),
        pluginEntry('slow'),
        pluginEntry('degraded'),
        pluginEntry('noted'),
      ]);
      store.setLoad('ok', 'active');
      store.setLoad('slow', 'failed', 'activate() did not finish within 10 s');
      store.setLoad('degraded', 'active');
      store.report('degraded', { state: 'DEGRADED', detail: 'no GPU' });
      store.setLoad('noted', 'active');
      store.report('noted', { state: 'OK', detail: 'object-list not available' });
    });
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual([
      'okserver OK · web OK',
      'server-onlyserver OK',
      'offserver disabled (needs SDK ^9.0.0)',
      'slowserver OK · web not loaded: activate() did not finish within 10 s',
      'degradedserver OK · web DEGRADED: no GPU',
      'notedserver OK · web OK: object-list not available',
    ]);
  });

  it('shows why the application cannot run', () => {
    const store = show();
    act(() => { store.setFatal('The required plugin X is not available.'); });
    expect(screen.getByRole('alert').textContent).toBe('The required plugin X is not available.');
  });
});
