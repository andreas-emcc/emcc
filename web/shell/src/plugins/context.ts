/**
 * The context a plugin's web part gets in `activate(ctx)` (SDK v1, `PluginContext`; 1.1.0 since
 * CR-0015).
 *
 * The 1.1.0 members (CDA plan for SDK 1.1.0, owner 2026-10-15: real where cheap): `userDocuments`
 * works over the server's API; `ui.addPanel` puts the panel in its default pane, and `show()`
 * expands it and scrolls it into view (part 5); `ui.addTopBarItem` adds a control on the right of
 * the top bar (part 5); `theme` is the shell's look (`ui/theme.ts`, T-052): its state, the token
 * values, and every change of look, light or dark, or density; `objects` asks the server over the live connection
 * (part 3); `setup` hands the plugin's share to the shell's setups (part 7, `setups/setups.ts`);
 * `actions` adds to the shell's lists and opens its menu (part 8, `actions/`).
 *
 * Everything a plugin registers is tracked, so a plugin that fails or times out can be fenced:
 * its panels, overlays, map view and subscriptions are removed, and anything it registers later is
 * ignored and logged (CDA review B2).
 */
import {
  DEFAULT_DISPLAY, layerQueryOptions, MAX_FETCH_IDS, NATO_CLASSIFICATIONS, ObjectQueryError, OutcomeUnknownError, TOKENS, uuidv7, type ChangeOutcome, type ChangeRequestContent, type ClassificationOrders,
  type ControlPanel, type SymbolPalette, type DataType, type DeclaredField, type DisplaySettings, type ReadonlyState, type FetchResult, type FieldSet, type RelationKind, type RelationLine, type LayerPage, type LivePictureListener, type LivePictureOptions, type MapPaneOverlay, type MapViewMount, type Panel, type PluginContext, type PluginLog,
  type PluginState, type SecurityLabel, type SettingsPanel, type SetupShare, UserDocumentError, type ServiceKey, type Settings, type TokenName, type Unsubscribe, type User,
  type Uuid, type WorkspaceInfo,
} from '@emc2/plugin-sdk';
import type { ListenerErrorHandler } from '../live/picture.ts';
import type { ShellStore } from '../ui/store.ts';
import type { ThemeSource } from '../ui/theme.ts';
import type { ActionMenu } from '../actions/menu.ts';
import type { ActionRegistry } from '../actions/registry.ts';
import type { SetupRegistry } from '../setups/setups.ts';
import { webBase, type WebPlugin } from './plan.ts';
import type { ServiceRegistry } from './services.ts';
import type { SharedState } from './shared.ts';
import { userDocumentsOf } from './userDocuments.ts';

const NO_PALETTES: readonly SymbolPalette[] = Object.freeze([]);

/** The order a plugin gets when the configuration has none: the server's default, NATO's. */
const NATO_ORDER = Object.freeze({ NATO: NATO_CLASSIFICATIONS });

/** Subscribes a plugin's listener to the live picture (the shell's {@link LiveSubscriptions}). */
export interface LiveSubscriber {
  subscribe(listener: LivePictureListener, onError: ListenerErrorHandler, options?: LivePictureOptions): Unsubscribe;
}

/** What the shell gives every plugin context. */
export interface ContextEnvironment {
  readonly store: ShellStore;
  readonly services: ServiceRegistry;
  readonly live: LiveSubscriber;
  readonly changes: { submit(content: ChangeRequestContent, pluginId: string): Promise<ChangeOutcome> };
  /** The server's object queries (`ctx.objects`), over the live connection. */
  readonly objects: {
    getObjects(ids: readonly Uuid[]): Promise<FetchResult>;
    queryLayer(layerId: Uuid, page: number, pageSize: number): Promise<LayerPage>;
  };
  readonly defaultLabel: SecurityLabel;
  /** SDK 1.5.0 part 4 (CR-0039 point 9): each policy's classifications, lowest first (`GET /api/config`'s `classificationOrders`). */
  readonly classifications?: ClassificationOrders;
  /** SDK 1.6.0 (CR-0041 part G): every enabled plugin's symbol palettes (`palettes.ts`), frozen. */
  readonly symbolPalettes?: readonly SymbolPalette[];
  /** The logged-in user (`ctx.user`). */
  readonly user: User;
  /** The data types and the plugins' settings, kept current. */
  readonly shared: SharedState;
  readonly console?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
  /** The server calls of `ctx.userDocuments` (tests pass a fake). */
  readonly fetch?: typeof fetch;
  /** The shell's setups (`ctx.setup`); without them a share is accepted and never saved. */
  readonly setups?: SetupRegistry;
  /** The shell's action lists and menu (`ctx.actions`); without them actions are accepted and never offered. */
  readonly actions?: { readonly registry: ActionRegistry; readonly menu: ActionMenu };
  /** The shell's looks (`ctx.theme`, T-052); without them Night Watch, compact, light. */
  readonly theme?: ThemeSource;
  /** The workspace shown and its switch (`ctx.workspace`, SDK 1.2.0; `workspaces/switch.ts`). */
  readonly workspace: WorkspaceSource;
  /** SDK 1.4.0 part 5: the user's display settings, `ctx.display` (none in some tests). */
  readonly display?: ReadonlyState<DisplaySettings>;
}

/** What `ctx.workspace` needs of the shell's switch. */
export interface WorkspaceSource {
  readonly current: WorkspaceInfo;
  onChange(listener: (workspace: WorkspaceInfo) => void): Unsubscribe;
}

export interface PluginHandle {
  readonly context: PluginContext;
  /** Removes everything the plugin registered and ignores what it does from now on. */
  fence(reason: string): void;
  readonly fenced: boolean;
}

const STATES: readonly PluginState[] = ['OK', 'DEGRADED', 'FAILED'];

/** Without the shell's theme (tests of other parts): Night Watch, compact, light, and the page's values. */
const NO_THEME: ThemeSource = {
  current: { look: 'night-watch', scheme: 'light', density: 'compact' },
  tokens: () => {
    const style = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
    return Object.fromEntries((Object.keys(TOKENS) as TokenName[]).map((name) => [name, style?.getPropertyValue(TOKENS[name]).trim() ?? ''])) as Record<TokenName, string>;
  },
  onChange: () => () => undefined,
};

/** The most workspaces a subscription names (the server's limit, `server/live-picture-protocol.md`). */
const MAX_WORKSPACES = 64;

/** Plugins are plain JavaScript at runtime: values are checked and shown as they come. */
const text = (value: unknown): string => String(value);

export function createPluginContext(plugin: WebPlugin, env: ContextEnvironment): PluginHandle {
  const id = plugin.id;
  const display = env.display;
  const out = env.console ?? console;
  const prefix = `[${id}]`;
  const log: PluginLog = {
    debug: (message, ...args) => { out.debug(prefix, message, ...args); },
    info: (message, ...args) => { out.info(prefix, message, ...args); },
    warn: (message, ...args) => { out.warn(prefix, message, ...args); },
    error: (message, ...args) => { out.error(prefix, message, ...args); },
  };
  let fencedReason: string | null = null;
  const registrations = new Set<Unsubscribe>();
  /**
   * The PDA's D4 review (owner: note it, keep working): a key the plugin gets with `services.get` must be in its
   * `requires` or `uses` (CR-0011, the design pattern). The web part's code is only known when it calls, so the shell
   * checks then: once per key, a note on the plugin (the Control Pane) and a warning; the call works as before.
   */
  const declaredKeys = new Set([...plugin.requires, ...(plugin.uses ?? []), ...plugin.provides]);
  const undeclaredNoted = new Set<string>();
  const checkDeclared = (keyId: string) => {
    if (declaredKeys.has(keyId) || undeclaredNoted.has(keyId)) return;
    undeclaredNoted.add(keyId);
    const note = `gets ${keyId}, which is in neither requires nor uses in its manifest`;
    env.store.note(id, note);
    log.warn(note);
  };
  let mapViewSet = false;

  /** True (and logged) if the plugin is fenced. */
  const ignored = (what: string): boolean => {
    if (fencedReason === null) return false;
    out.warn(prefix, `ignored ${what}: the plugin's web part is disabled (${fencedReason})`);
    return true;
  };
  const track = (unregister: Unsubscribe): Unsubscribe => {
    let done = false;
    const once = () => {
      if (done) return;
      done = true;
      registrations.delete(once);
      unregister();
    };
    registrations.add(once);
    return once;
  };
  const checkId = (what: string, value: { readonly id: unknown; readonly component: unknown; readonly workspaces?: unknown }) => {
    if (typeof value.id !== 'string' || value.id === '') throw new TypeError(`${what} needs a non-empty id`);
    if (typeof value.component !== 'function') throw new TypeError(`${what} ${value.id} needs a React component`);
    if (value.workspaces !== undefined && !(Array.isArray(value.workspaces) && value.workspaces.every((w) => typeof w === 'string'))) {
      throw new TypeError(`${what} ${value.id} has workspaces that are not a list of strings`);
    }
  };

  /**
   * Ids that must be unique within the plugin while registered (SDK: panels, from `addPanel` and
   * `addControlPanel` alike, and top bar items): the layout and `show()` know a panel by it.
   * Returns the registration's undo, which frees the id again.
   */
  const panelIds = new Set<string>();
  const itemIds = new Set<string>();
  const unique = (ids: Set<string>, what: string, itemId: string, add: () => Unsubscribe): Unsubscribe => {
    if (ids.has(itemId)) throw new TypeError(`${id} has ${what} ${itemId} already; ids are unique within a plugin`);
    const remove = add(); // first, so that an id is never held by a registration that failed
    ids.add(itemId);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      ids.delete(itemId);
      remove();
    };
  };

  /** A plugin's listener: what it throws is reported, never passed on to the shell. */
  const guarded = <T,>(what: string, listener: (value: T) => void) => (value: T) => {
    if (fencedReason !== null) return;
    try {
      listener(value);
    } catch (error) {
      out.error(prefix, `its ${what} listener failed`, error);
      env.store.observe(id, { state: 'DEGRADED', detail: `its ${what} listener failed: ${String(error)}` });
    }
  };

  const documents = userDocumentsOf(id, env.fetch);
  const theme = env.theme ?? NO_THEME;
  const disabledDocuments = () => Promise.reject(new UserDocumentError('unavailable', `${id} is disabled: ${String(fencedReason)}`));

  const context: PluginContext = {
    pluginId: id,
    log,
    status: {
      set(state, detail) {
        if (ignored('a status')) return;
        if (!STATES.includes(state)) throw new TypeError(`unknown plugin state: ${text(state)}`);
        env.store.report(id, { state, detail: text(detail) });
      },
    },
    get settings(): Settings {
      return env.shared.settingsOf(id);
    },
    onSettingsChange(listener: (settings: Settings) => void) {
      if (ignored('a settings listener')) return () => undefined;
      return track(env.shared.onSettings(id, guarded('settings', listener)));
    },
    user: env.user,
    workspace: {
      get current(): WorkspaceInfo {
        return env.workspace.current;
      },
      onChange(listener: (workspace: WorkspaceInfo) => void) {
        if (ignored('a workspace listener')) return () => undefined;
        return track(env.workspace.onChange(guarded('workspace', listener)));
      },
    },
    get workspaces(): readonly WorkspaceInfo[] {
      return env.store.getView().workspaces;
    },
    get dataTypes(): readonly DataType[] {
      return env.shared.dataTypes;
    },
    get declaredFields(): readonly DeclaredField[] {
      return env.shared.declaredFields;
    },
    get fieldSets(): readonly FieldSet[] {
      return env.shared.fieldSets;
    },
    get relationKinds(): readonly RelationKind[] {
      return env.shared.relationKinds;
    },
    // SDK 1.6.0 (CR-0041 part C; T-181): read and told, never written; each listener is the plugin's own.
    relationLines: {
      get value(): Readonly<Record<string, RelationLine>> {
        return env.shared.relationLines.value;
      },
      onChange(listener: (value: Readonly<Record<string, RelationLine>>) => void) {
        if (ignored('a relation lines listener')) return () => undefined;
        return track(env.shared.relationLines.onChange(guarded('relation lines', listener)));
      },
    },
    // SDK 1.4.0 part 5 (ADR-0046 point 5): read and told, never written; each listener is the plugin's own.
    // Required since the 1.4.0 freeze: the shell always has the settings; a test without them gets the defaults.
    display: {
      get value(): DisplaySettings {
        return display === undefined ? DEFAULT_DISPLAY : display.value;
      },
      onChange(listener: (value: DisplaySettings) => void) {
        if (display === undefined || ignored('a display settings listener')) return () => undefined;
        return track(display.onChange(guarded('display settings', listener)));
      },
    },
    onDataTypesChange(listener: (dataTypes: readonly DataType[]) => void) {
      if (ignored('a data types listener')) return () => undefined;
      return track(env.shared.onDataTypes(guarded('data types', listener)));
    },
    services: {
      provide<T>(key: ServiceKey<T, 'one' | 'many'>, implementation: T) {
        if (ignored(`providing ${key.id}`)) return () => undefined;
        return env.services.provide(id, key, implementation);
      },
      get<T>(key: ServiceKey<T>) {
        if (fencedReason !== null) return Promise.reject(new Error(`${id} is disabled: ${fencedReason}`));
        checkDeclared(key.id);
        return env.services.get(key);
      },
      getAll: (key) => env.services.getAll(key),
    },
    ui: {
      addControlPanel(panel: ControlPanel) {
        if (ignored(`the panel ${text(panel.id)}`)) return () => undefined;
        checkId('a control panel', panel);
        if (typeof panel.title !== 'string') throw new TypeError(`the control panel ${panel.id} needs a title`);
        return track(unique(panelIds, 'a panel', panel.id, () => env.store.addPanel(id, panel)));
      },
      addPanel(panel: Panel) {
        if (ignored(`the panel ${text(panel.id)}`)) return { show: () => undefined, remove: () => undefined };
        checkId('a panel', panel);
        if (typeof panel.title !== 'string') throw new TypeError(`the panel ${panel.id} needs a title`);
        if (!['left', 'right', 'bottom'].includes(panel.defaultPane)) throw new TypeError(`the panel ${panel.id} has an unknown pane: ${text(panel.defaultPane)}`);
        const remove = track(unique(panelIds, 'a panel', panel.id, () => env.store.addPanel(id, {
          id: panel.id, title: panel.title, icon: panel.icon, order: panel.order, component: panel.component, workspaces: panel.workspaces,
        }, panel.defaultPane)));
        return {
          show() {
            if (fencedReason === null) env.store.showPanel(`${id}/${panel.id}`);
          },
          remove,
        };
      },
      addTopBarItem(item) {
        if (ignored(`the top bar item ${text(item.id)}`)) return () => undefined;
        checkId('a top bar item', item);
        return track(unique(itemIds, 'a top bar item', item.id, () => env.store.addTopBarItem(id, item)));
      },
      setSettingsPanel(panel: SettingsPanel) {
        if (ignored('its settings panel')) return () => undefined;
        if (typeof (panel.component as unknown) !== 'function') throw new TypeError('a settings panel needs a React component');
        return track(env.store.setSettingsPanel(id, panel));
      },
      addMapPaneOverlay(overlay: MapPaneOverlay) {
        if (ignored(`the overlay ${text(overlay.id)}`)) return () => undefined;
        checkId('a map pane overlay', overlay);
        if (!['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(overlay.position)) {
          throw new TypeError(`the overlay ${overlay.id} has an unknown position: ${text(overlay.position)}`);
        }
        return track(env.store.addOverlay(id, overlay));
      },
      setMapView(view: MapViewMount) {
        if (ignored('the map view')) return;
        if (plugin.kind !== 'map-view') throw new Error(`${id} is not the map view plugin (kind "map-view"), so it cannot set the map view`);
        if (mapViewSet) throw new Error(`${id} has set the map view already`);
        if (typeof view.mount !== 'function') throw new TypeError('the map view needs a mount(element) function');
        mapViewSet = true;
        env.store.setMapView(id, view);
        track(() => { env.store.setMapView(id, null); });
      },
    },
    notify(notification) {
      if (ignored('a notification')) return;
      env.store.notify(id, notification);
    },
    livePicture: {
      subscribe(listener: LivePictureListener, options?: LivePictureOptions) {
        if (ignored('a live picture subscription')) return () => undefined;
        const named: unknown = options?.workspaces;
        if (named !== undefined && !(Array.isArray(named) && named.length >= 1 && named.length <= MAX_WORKSPACES
          && named.every((w) => typeof w === 'string' && w !== ''))) {
          // An empty list would follow the workspace shown, a string be split into letters (conformance review, 3).
          throw new TypeError(`a live picture subscription's workspaces are a list of 1 to ${String(MAX_WORKSPACES)} workspace ids or '*'`);
        }
        return track(env.live.subscribe(listener, (error, during) => {
          out.error(prefix, `the live picture listener failed on ${during === 'snapshot' ? 'a snapshot' : 'a change batch'}`, error);
          env.store.observe(id, { state: 'DEGRADED', detail: `its live picture listener failed: ${String(error)}` });
        }, options));
      },
    },
    changes: {
      submit(request) {
        if (fencedReason !== null) return Promise.reject(new OutcomeUnknownError(`not sent: ${id} is disabled (${fencedReason})`));
        return env.changes.submit(request, id);
      },
    },
    defaultLabel: env.defaultLabel,
    classifications: env.classifications ?? NATO_ORDER, // required since the 1.5.0 freeze (owner Q49 A, Q50 A)
    symbolPalettes: env.symbolPalettes ?? NO_PALETTES, // SDK 1.6.0 part G
    newId: () => uuidv7(),
    serverBase: `/api/plugins/${id}/`,
    webBase: webBase(id),
    setup: {
      register(share) {
        if (ignored('a setup share')) return () => undefined;
        const given = share as Partial<SetupShare> | null | undefined; // plugins are plain JavaScript at runtime
        if (typeof given?.save !== 'function' || typeof given.restore !== 'function') {
          throw new TypeError('a setup share needs save() and restore(share)');
        }
        return track(env.setups?.register(id, share) ?? (() => undefined));
      },
      changed() {
        if (fencedReason === null) env.setups?.changed();
      },
    },
    actions: {
      addObjectAction(action) {
        if (ignored(`the object action ${text(action.id)}`)) return () => undefined;
        return track(env.actions?.registry.addObjectAction(id, action) ?? (() => undefined));
      },
      addMapAction(action) {
        if (ignored(`the map action ${text(action.id)}`)) return () => undefined;
        return track(env.actions?.registry.addMapAction(id, action) ?? (() => undefined));
      },
      openMenu(at, target) {
        if (ignored('a menu')) return;
        env.actions?.menu.open(at, target);
      },
    },
    objects: {
      get(ids) {
        if (fencedReason !== null) return Promise.reject(new ObjectQueryError(`not sent: ${id} is disabled (${fencedReason})`));
        if (ids.length > MAX_FETCH_IDS) return Promise.reject(new ObjectQueryError(`at most ${String(MAX_FETCH_IDS)} ids: ${String(ids.length)}`));
        if (ids.length === 0) return Promise.resolve({ found: [], missing: [] });
        return env.objects.getObjects(ids);
      },
      queryLayer(layerId, queryOptions) {
        let checked: { readonly page: number; readonly pageSize: number };
        try {
          checked = layerQueryOptions(queryOptions);
        } catch (error) {
          return Promise.reject(error instanceof Error ? error : new ObjectQueryError(String(error)));
        }
        if (fencedReason !== null) return Promise.reject(new ObjectQueryError(`not sent: ${id} is disabled (${fencedReason})`));
        return env.objects.queryLayer(layerId, checked.page, checked.pageSize);
      },
    },
    userDocuments: {
      get: (name) => (fencedReason === null ? documents.get(name) : disabledDocuments()),
      put: (name, value) => (fencedReason === null ? documents.put(name, value) : disabledDocuments()),
      delete: (name) => (fencedReason === null ? documents.delete(name) : disabledDocuments()),
      list: () => (fencedReason === null ? documents.list() : disabledDocuments()),
    },
    theme: {
      get current() {
        return theme.current;
      },
      tokens: () => theme.tokens(),
      onChange(listener) {
        if (ignored('a theme listener')) return () => undefined;
        return track(theme.onChange(guarded('theme', listener)));
      },
    },
  };

  return {
    context,
    fence(reason) {
      if (fencedReason !== null) return;
      fencedReason = reason;
      for (const unregister of [...registrations]) unregister();
      env.store.removeUiOf(id);
    },
    get fenced() {
      return fencedReason !== null;
    },
  };
}
