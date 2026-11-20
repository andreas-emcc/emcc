import { definePlugin, type ChangeOutcome, type PluginContext, type Snapshot } from '@emc2/plugin-sdk';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boot, type BootOptions } from './boot.tsx';
import { changes, layer, mapObject, objectEvent, pluginEntry, sendSnapshot, socketFactory } from './testing/fakes.ts';

const label = { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' };
const config = { defaultLabel: label, loginMode: 'none', user: { id: 'local', name: 'Local user' } };

/** Answers the routes; a user document that is not there is a 404 as the server gives it. */
function server(routes: Record<string, unknown>): typeof fetch {
  return vi.fn((input: RequestInfo | URL) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    if (path in routes) return Promise.resolve(Response.json(routes[path]));
    if (path === '/api/user-documents/core') return Promise.resolve(Response.json({ names: [] }));
    if (path.startsWith('/api/user-documents/')) return Promise.resolve(Response.json({ problem: 'no such document' }, { status: 404 }));
    return Promise.resolve(new Response('', { status: 404 }));
  });
}

function start(options: Partial<BootOptions> & { readonly fetch: typeof fetch }) {
  const rootElement = document.createElement('div');
  document.body.append(rootElement);
  const sockets = socketFactory();
  const shell = boot({
    rootElement, loadPluginWebParts: true, createSocket: sockets.create, location: { protocol: 'http:', host: 'emc2.test:8080' },
    loadStyle: () => Promise.resolve(), ...options,
  });
  return { shell, sockets };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('boot', () => {
  it('loads the plugins from the server and connects them to the live picture', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined))); // ServerStatus
    let context: PluginContext | null = null;
    const counter = definePlugin({
      activate(ctx) {
        context = ctx;
        function Count() {
          const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
          useEffect(() => ctx.livePicture.subscribe({ snapshot: setSnapshot, changes: () => { setSnapshot(null); } }), []);
          return <p>{snapshot === null ? 'waiting' : `${String(snapshot.objects.length)} objects at ${String(snapshot.sequenceNo)}`}</p>;
        }
        ctx.ui.addControlPanel({ id: 'count', title: 'Count', component: Count });
      },
    });
    const { shell, sockets } = start({
      fetch: server({ '/api/plugins': [pluginEntry('counter')], '/api/config': config }),
      importModule: (url) => (url === '/plugins/counter/web/index.js' ? Promise.resolve({ default: counter }) : Promise.reject(new Error(url))),
    });
    await shell.ready;

    expect(sockets.last().url).toBe('ws://emc2.test:8080/api/live');
    await screen.findByText('waiting');
    sockets.last().receive({ type: 'welcome', protocol: 2 });
    // The plugin subscribes in an effect, which may run after its first render, before or after welcome;
    // StrictMode runs it twice in tests (subscribe, unsubscribe, subscribe). One subscription stays open.
    await waitFor(() => {
      const sent = sockets.last().sent;
      expect(sent.at(-1)).toEqual({ type: 'subscribe', subscription: 'all', workspaces: ['core.view'] });
      expect(sent.filter((m) => m.type === 'subscribe').length - sent.filter((m) => m.type === 'unsubscribe').length).toBe(1);
    });
    sendSnapshot(sockets.last(), 5, [layer('L')], [mapObject('a'), mapObject('b')]);
    await screen.findByText('2 objects at 5');
    await screen.findByText('Live picture: connected');

    const ctx = context as unknown as PluginContext;
    expect(ctx.defaultLabel).toEqual(label);
    expect(Object.isFrozen(ctx.defaultLabel)).toBe(true);

    const outcome = ctx.changes.submit({ entityType: 'layer', operation: 'delete', entityId: 'L' });
    const sent = { request: sockets.last().lastRequest() };
    expect(sent.request.source).toEqual({ plugin: 'counter' });
    const event = objectEvent(6, 'c', 'create', sent.request.requestId);
    sockets.last().receive({ type: 'change-outcome', requestId: sent.request.requestId, outcome: 'applied', event });
    sockets.last().receive(changes('all', [event]));
    await expect(outcome).resolves.toEqual({ outcome: 'applied', event } satisfies ChangeOutcome);
    expect(shell.store.getView().login).toEqual({ mode: 'none', user: { id: 'local', name: 'Local user' } });
    expect(screen.getByRole('status', { name: 'Login' }).textContent).toMatch(/^No login: /);
  });

  it("reads the user's remembered setup: the shell's share at once, a plugin's once it has started", async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined))); // ServerStatus
    const restored: unknown[] = [];
    const map = definePlugin({
      activate(ctx) {
        ctx.setup.register({ save: () => ({ zoom: 3 }), restore: (share) => { restored.push(share); } });
        expect(restored).toEqual([]); // not while it starts
      },
    });
    const { shell } = start({
      fetch: server({
        '/api/plugins': [pluginEntry('map')], '/api/config': config,
        '/api/user-documents/core': { names: ['setup.current'] },
        '/api/user-documents/core/setup.current': { version: 1, shell: { clock: 'local' }, plugins: { map: { zoom: 7 } } },
      }),
      importModule: () => Promise.resolve({ default: map }),
    });
    await shell.ready;
    expect(shell.store.getView().clock).toBe('local');
    expect(restored).toEqual([{ zoom: 7 }]);
  });

  it("shows the installation's default look as soon as the configuration has come, before the plugin list (review F8)", async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    const answers = server({ '/api/config': { ...config, defaultLook: 'signal' } });
    const fetch = vi.fn((input: RequestInfo | URL) => (input === '/api/plugins' ? new Promise<Response>(() => undefined) : answers(input)));
    const { shell } = start({ fetch: fetch });
    await waitFor(() => { expect(shell.store.getView().installationLook).toBe('signal'); });
    expect(document.documentElement.dataset['look']).toBe('signal');
    expect([document.documentElement.dataset['density']]).toEqual(['compact']);
    document.documentElement.removeAttribute('data-look');
  });

  it('says so when the plugin list cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    const { shell } = start({ fetch: server({ '/api/config': config }) });
    await shell.ready;
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'The plugins could not be loaded from the server (/api/plugins: HTTP 404). Reload the page when the server is running.');
    });
  });

  it('on the dev server it loads no plugin web parts and says so, but still shows the login', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    const fetch = server({ '/api/config': config });
    const { shell } = start({ fetch, loadPluginWebParts: false });
    await shell.ready;
    expect(vi.mocked(fetch).mock.calls.map(([path]) => path)).toEqual(['/api/user-documents/core', '/api/config']);
    await screen.findByText(/^Development server: plugin web parts are not loaded here/);
    expect(screen.getByRole('status', { name: 'Login' }).textContent).toMatch(/^No login: /);
  });

  it('with login it keeps the session alive every minute, and a 401 ends the live picture for good', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    const oidc = { ...config, loginMode: 'oidc', user: { id: 'u-1', name: 'alice' } };
    let sessionStatus = 200;
    const calls: string[] = [];
    const fetch = vi.fn((input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      calls.push(path);
      if (path === '/api/session') return Promise.resolve(new Response('{}', { status: sessionStatus }));
      return Promise.resolve(path === '/api/config' ? Response.json(oidc) : Response.json([]));
    }) as unknown as typeof globalThis.fetch;
    const { shell } = start({ fetch, keepAliveMs: 50 });
    await shell.ready;
    await waitFor(() => { expect(calls.filter((c) => c === '/api/session').length).toBeGreaterThanOrEqual(1); });
    expect(shell.connection.state).not.toBe('logged-out');

    sessionStatus = 401;
    await waitFor(() => { expect(shell.connection.state).toBe('logged-out'); });
    const count = calls.length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(calls.length, 'no more keep-alives').toBe(count);
  });

  it('a 401 while loading means the login has ended, not that the server is broken', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    const fetch = vi.fn(() => Promise.resolve(new Response('', { status: 401 }))) as unknown as typeof globalThis.fetch;
    const { shell } = start({ fetch });
    await shell.ready;
    expect(shell.connection.state).toBe('logged-out');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('on the dev server without a server behind it shows no login state', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    const { shell } = start({ fetch: server({}), loadPluginWebParts: false });
    await shell.ready;
    expect(shell.store.getView().login).toBeNull();
  });
});

describe('boot with workspaces (ADR-0039; T-080)', () => {
  const SIM = { id: 'simulator.simulation', name: 'Simulation', viewPermission: 'plugin.simulator.view', editPermission: 'plugin.simulator.edit', order: 10 };

  it('opens the workspace its address names, before the plugins start, and a tab switches with a fresh snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined))); // ServerStatus
    window.history.replaceState(null, '', '#workspace/simulator.simulation');
    let context: PluginContext | null = null;
    const watcher = definePlugin({
      activate(ctx) {
        context = ctx;
        ctx.livePicture.subscribe({ snapshot: () => undefined, changes: () => undefined });
      },
    });
    const { shell, sockets } = start({
      fetch: server({ '/api/plugins': [pluginEntry('watcher')], '/api/config': { ...config, workspaces: [{ id: 'core.view', name: 'View', order: -2147483648 }, SIM] } }),
      importModule: () => Promise.resolve({ default: watcher }),
    });
    await shell.ready;
    const ctx = context as unknown as PluginContext;
    expect(ctx.workspace.current.id).toBe(SIM.id);
    expect((await screen.findByRole('tab', { name: 'Simulation' })).getAttribute('aria-selected')).toBe('true');
    const socket = sockets.last();
    socket.receive({ type: 'welcome', protocol: 2 });
    await waitFor(() => { expect(socket.sent).toContainEqual({ type: 'subscribe', subscription: 'all', workspaces: [SIM.id] }); });
    sendSnapshot(socket, 3, [], []);
    const seen: string[] = [];
    ctx.workspace.onChange((w) => seen.push(w.id));

    screen.getByRole('tab', { name: 'View' }).click();
    await waitFor(() => { expect(socket.sent.at(-1)).toEqual({ type: 'subscribe', subscription: 'all', workspaces: ['core.view'] }); });
    expect(seen).toEqual([]); // waiting for the fresh snapshot
    sendSnapshot(socket, 4, [], []);

    await waitFor(() => { expect(seen).toEqual(['core.view']); });
    expect(window.location.hash).toBe('');
    window.history.replaceState(null, '', '/');
  });
});
