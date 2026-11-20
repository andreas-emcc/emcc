/**
 * Starts the web client: shows the layout at once, opens the live picture, reads the user's
 * remembered setup, then loads the plugin list and the configuration from the server and loads the
 * plugins' web parts (overview 4.11).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  EVERY_WORKSPACE, MAP_VIEW, SYMBOLS, type DataType, type DeclaredField, type FieldSet, type SecurityLabel, type ServiceKey, type User, type WorkspaceInfo,
} from '@emc2/plugin-sdk';
import { createActions } from './actions/actions.ts';
import type { ClassificationOrders } from './layers/classification.ts';
import { LayerChanger } from './layers/changer.ts';
import { symbolPalettesOf } from './plugins/palettes.ts';
import { LayerCreator } from './layers/creator.ts';
import { App } from './App.tsx';
import { LiveConnection, type SocketLike } from './live/connection.ts';
import { deepFreeze } from './live/picture.ts';
import { liveUrl } from './live/protocol.ts';
import { LiveSubscriptions } from './live/subscriptions.ts';
import { loadPlugins, type LoaderOptions } from './plugins/loader.ts';
import type { ServiceRegistry } from './plugins/services.ts';
import { userDocumentsOf } from './plugins/userDocuments.ts';
import { Setups } from './setups/setups.ts';
import type { PluginEntry } from './plugins/plan.ts';
import { SharedState, type RelationKindJson } from './plugins/shared.ts';
import { userTimeOf } from './time/choice.ts';
import { TemporalPlugins } from './time/temporal.ts';
import { DisplayControl } from './display/DisplayControl.tsx';
import { DisplayState } from './display/state.ts';
import { MonitorApi } from './ui/monitor/api.ts';
import { SettingsApi } from './ui/settings/api.ts';
import { Drafts } from './ui/settings/drafts.ts';
import { DEFAULT_FORMAT, NO_DEFINITIONS, type LabelDefinitions, type LabelFormat } from './ui/settings/labeling/model.ts';
import { LabelingState } from './ui/settings/labeling/source.ts';
import type { ViewServices } from './ui/services.ts';
import { addStatusPanel } from './ui/status.ts';
import { lookOrBuiltIn, ShellTheme } from './ui/theme.ts';
import { ShellStore, type LoginInfo } from './ui/store.ts';
import { routeFromHash, shownTab, workspaceOfTab } from './ui/tabs.ts';
import { WorkspaceSwitch } from './workspaces/switch.ts';

/** `GET /api/config` (server/app ConfigController). */
interface ClientConfig {
  readonly defaultLabel: SecurityLabel;
  readonly loginMode: LoginInfo['mode'];
  readonly user: (NonNullable<LoginInfo['user']> & { readonly permissions?: readonly string[]; readonly noLogin?: boolean }) | null;
  readonly dataTypes?: readonly DataType[];
  /** Each policy's classifications, lowest first (Settings › Layers). */
  readonly classificationOrders?: ClassificationOrders;
  /** The installation's default look (ADR-0034). */
  readonly defaultLook?: string;
  /** Every loaded plugin's declared fields (SDK 1.2.0, ADR-0038). */
  readonly declaredFields?: readonly DeclaredField[];
  /** The workspaces the user may see, View first (SDK 1.2.0, ADR-0039). */
  readonly workspaces?: readonly WorkspaceInfo[];
  /** Every loaded plugin's field sets (SDK 1.4.0, ADR-0050). */
  readonly fieldSets?: readonly FieldSet[];
  /** Every loaded plugin's relation kinds, each line complete (SDK 1.4.0, ADR-0051). */
  readonly relationKinds?: readonly RelationKindJson[];
  /** How a premade label is written (Settings › Labeling, T-170; `emc2.labeling.*`). */
  readonly labelFormat?: LabelFormat;
  /** Settings › Labeling's classification sets and policies (round 3b; `labeling-definitions.json`). */
  readonly labelDefinitions?: LabelDefinitions;
}

/** The user as web parts see it (`ctx.user`): in the no-login mode, the local user has every permission. */
export function webUser(info: ClientConfig['user']): User {
  const permissions: ReadonlySet<string> = new Set(info?.permissions ?? []);
  const noLogin = info?.noLogin ?? false;
  return Object.freeze({
    id: info?.id ?? '',
    name: info?.name ?? '',
    permissions,
    noLogin,
    has: (permission: string) => noLogin || permissions.has(permission),
  });
}

export interface BootOptions {
  readonly rootElement: HTMLElement;
  /** False on the Vite dev server: it bundles its own React, so plugin web parts cannot share it. */
  readonly loadPluginWebParts: boolean;
  readonly fetch?: typeof fetch;
  readonly createSocket?: (url: string) => SocketLike;
  readonly location?: { readonly protocol: string; readonly host: string };
  readonly importModule?: LoaderOptions['importModule'];
  /** How often the login session is kept alive and renewed (`GET /api/session`); 60 s. */
  readonly keepAliveMs?: number;
  readonly loadStyle?: LoaderOptions['loadStyle'];
}

export interface Shell {
  readonly store: ShellStore;
  readonly connection: LiveConnection;
  /** The data types and the plugins' settings, kept current for the web parts. */
  readonly shared: SharedState;
  readonly setups: Setups;
  /** The workspace shown and its switch (`ctx.workspace`). */
  readonly workspaces: WorkspaceSwitch;
  /** Settles when every plugin web part has been loaded or refused, and the remembered setup has been read. */
  readonly ready: Promise<void>;
}

const FETCH_TIMEOUT_MS = 10_000;
const KEEP_ALIVE_MS = 60_000;

/** An answer other than 2xx. */
class HttpError extends Error {
  constructor(readonly path: string, readonly status: number) {
    super(`${path}: HTTP ${String(status)}`);
  }
}

export function boot(options: BootOptions): Shell {
  const store = new ShellStore();
  // The look applies at once: the installation default once the configuration arrives, the user's once the setup is read.
  const theme = new ShellTheme({ store });
  addStatusPanel(store);
  const shared = new SharedState();
  const setups = new Setups({
    store,
    documents: userDocumentsOf('core', options.fetch),
    closingDocuments: userDocumentsOf('core', options.fetch, { keepalive: true }),
  });
  // The workspace shown follows the tab chosen (ADR-0039 point 3): another workspace's tab switches.
  // The address's tab now, not only in the app's first effect: a workspace it names is shown before the plugins start.
  store.setTab(routeFromHash(window.location.hash).tab);
  const workspaces = new WorkspaceSwitch(store);
  workspaces.connect({ leave: (id) => { setups.leave(id); }, enter: (id) => { setups.enter(id); } });
  store.subscribe(() => {
    const view = store.getView();
    const chosen = workspaceOfTab(shownTab(view.tab, view.login, view.workspaces));
    if (chosen !== null && chosen !== view.workspace) void workspaces.show(chosen);
  });
  // SDK 1.4.0 (ADR-0045): the page's time goes to the server and to the temporal web parts at each change.
  const temporal = new TemporalPlugins((pluginId, error) => {
    store.observe(pluginId, { state: 'DEGRADED', detail: `timeChanged failed: ${error instanceof Error ? error.message : String(error)}` });
  });
  const connection = new LiveConnection({
    url: liveUrl(options.location ?? window.location),
    createSocket: options.createSocket ?? ((url) => new WebSocket(url)),
    onState: (state) => { store.setLive(state); },
    onDataTypes: (dataTypes) => { shared.dataTypesChanged(dataTypes); },
    onSettings: (pluginId, values) => { shared.settingsChanged(pluginId, values); },
    onDisplay: () => { void display?.load(); },
    onLabeling: () => { labeling.saved(); },
  });
  store.subscribe(() => {
    const time = userTimeOf(store.getView().time);
    connection.setTime(time);
    temporal.changed(time);
  });
  // SDK 1.4.0 part 5 (ADR-0046): the user's display settings, once the relation kinds have arrived.
  let display: DisplayState | null = null;
  // The plugins' services and live channels, once the plugins load; the user, once the configuration has arrived.
  let pluginServices: ServiceRegistry | null = null;
  let channels: LiveSubscriptions | null = null;
  let user = webUser(null);
  let classificationOrders: ClassificationOrders = {};
  const labeling = new LabelingState();
  let defaultLabel: SecurityLabel | null = null;
  const service = <T,>(key: ServiceKey<T>): Promise<T | null> => (pluginServices === null ? Promise.resolve(null) : pluginServices.get(key).catch(() => null));
  const actions = createActions({
    store, user: () => user, connection, dataTypes: () => shared.dataTypes,
    mapView: () => service(MAP_VIEW), symbols: () => service(SYMBOLS), layers: () => channels, workspace: () => workspaces.current,
  });
  const changer = new LayerChanger({
    store, user: () => user, orders: () => classificationOrders, current: (id) => actions.layers.layer(id), connection,
    workspaces: () => store.getView().workspaces,
  });
  const services: ViewServices = {
    api: new SettingsApi(options.fetch), shared, drafts: new Drafts(), monitor: new MonitorApi(options.fetch), setups, display: () => display,
    actions: { ...actions, mapView: () => service(MAP_VIEW) },
    layers: { known: actions.layers, changer, creator: new LayerCreator({
      user: () => user, layers: actions.layers, label: () => defaultLabel, orders: () => classificationOrders, connection,
    }) },
    labeling,
  };
  createRoot(options.rootElement).render(
    <StrictMode>
      <App store={store} services={services} />
    </StrictMode>,
  );

  connection.start();
  const setupRead = setups.start();
  // The last change of the setup, when the page closes (also when it is put away on a phone).
  window.addEventListener('pagehide', () => { setups.flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') setups.flush(); });

  const ready = (async () => {
    const doFetch = options.fetch ?? fetch;
    const getJson = async <T,>(path: string): Promise<T> => {
      const response = await doFetch(path, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) throw new HttpError(path, response.status);
      return (await response.json()) as T;
    };
    const showLogin = (config: ClientConfig): void => {
      store.setInstallationLook(lookOrBuiltIn(config.defaultLook));
      store.setLogin({ mode: config.loginMode, user: config.user });
      if (config.loginMode === 'oidc') keepAlive();
    };
    /**
     * With login: every minute, keeps the HTTP session alive (the live picture's traffic does not
     * count for it) and lets the server renew the login; a 401 means the login session has ended
     * (ADR-0022). Network errors are ignored: the live picture reports a lost server itself.
     */
    const keepAlive = (): void => {
      const timer = setInterval(() => {
        doFetch('/api/session', { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).then((response) => {
          if (response.status === 401) {
            clearInterval(timer);
            connection.loggedOut();
          }
        }, () => undefined);
      }, options.keepAliveMs ?? KEEP_ALIVE_MS);
    };
    if (!options.loadPluginWebParts) {
      store.notify(null, {
        severity: 'warning',
        message: 'Development server: plugin web parts are not loaded here. Build with node tools/build.mjs and start the server with node tools/start.mjs to run them.',
      });
      // Still show whether anyone is logged in; without the server there is nothing to show.
      await getJson<ClientConfig>('/api/config').then(showLogin, () => undefined);
      return;
    }
    let plugins: PluginEntry[];
    let config: ClientConfig;
    try {
      const configRead = getJson<ClientConfig>('/api/config');
      // The installation's default look as soon as it is known, not only once the plugin list has come too (review F8).
      configRead.then((c) => { store.setInstallationLook(lookOrBuiltIn(c.defaultLook)); }, () => undefined);
      [plugins, config] = await Promise.all([getJson<PluginEntry[]>('/api/plugins'), configRead]);
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) {
        connection.loggedOut(); // the login session ended between the page load and now
        return;
      }
      store.setFatal(`The plugins could not be loaded from the server (${error instanceof Error ? error.message : String(error)}). Reload the page when the server is running.`);
      return;
    }
    showLogin(config);
    // The workspaces before the plugins: a page opened on a workspace's address starts in it.
    store.setWorkspaces(config.workspaces ?? []);
    actions.deleteIn(store.getView().workspaces);
    shared.initialDataTypes(config.dataTypes ?? []);
    shared.initialDeclaredFields(config.declaredFields ?? []);
    shared.initialSetsAndKinds(config.fieldSets ?? [], config.relationKinds ?? []);
    const shownDisplay = new DisplayState({
      relationKinds: shared.relationKinds,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      onProblem: (message) => { store.notify(null, { severity: 'error', message }); },
    });
    display = shownDisplay;
    void shownDisplay.load();
    // The window's icon, after Coordinates in the Map Pane's top-right corner (ADR-0052 point 1).
    store.addOverlay('core', {
      id: 'display-settings', position: 'top-right', order: 20, workspaces: [EVERY_WORKSPACE],
      component: () => <DisplayControl display={shownDisplay} />,
    });
    user = webUser(config.user);
    classificationOrders = config.classificationOrders ?? {};
    labeling.configured(config.labelDefinitions ?? NO_DEFINITIONS, config.labelFormat ?? DEFAULT_FORMAT);
    defaultLabel = deepFreeze(config.defaultLabel);
    await loadPlugins(plugins, {
      store,
      environment: {
        changes: connection, objects: connection, defaultLabel: deepFreeze(config.defaultLabel), user, shared, setups, display: shownDisplay,
        classifications: deepFreeze(classificationOrders), // SDK 1.5.0 part 4 (A3)
        symbolPalettes: symbolPalettesOf(plugins), // SDK 1.6.0 part G
        actions: { registry: actions.registry, menu: actions.menu }, theme, workspace: workspaces,
      },
      live: (registry) => {
        pluginServices = registry;
        const live = new LiveSubscriptions(connection, () => registry.get(MAP_VIEW));
        void live.follow(store.getView().workspace); // no channel yet: only the workspace they will follow
        workspaces.connect({ follow: (id) => live.follow(id) });
        channels = live;
        return live;
      },
      capabilities: {
        temporal,
        report: (pluginId, implemented, problem) => {
          void (options.fetch ?? fetch)(`/api/web-parts/${encodeURIComponent(pluginId)}/capabilities`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ implemented, problem }),
          }).catch(() => undefined); // the Monitor's note only: a lost report changes nothing here
        },
      },
      ...(options.importModule === undefined ? {} : { importModule: options.importModule }),
      ...(options.loadStyle === undefined ? {} : { loadStyle: options.loadStyle }),
    });
  })().then(() => setupRead); // the setup's read never fails: it says so itself

  return { store, connection, shared, setups, workspaces, ready };
}
