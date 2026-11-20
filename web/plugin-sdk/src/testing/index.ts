/**
 * Test kit for plugin web parts (`@emc2/plugin-sdk/testing`), so plugins can be tested before the
 * shell exists. Everything is in memory and synchronous where possible.
 *
 * @example
 * const ctx = createFakeContext({ pluginId: 'draw-symbols' });
 * ctx.provideAs(SYMBOLS, createFakeSymbolService());
 * await plugin.activate(ctx);
 * ctx.live.snapshot({ layers: [layer] });
 * const outcome = await ctx.changes.submit(changeRequests.createObject(ctx.newId(), content));
 * expect(ctx.submitted).toHaveLength(1);
 */
import type {
  AreaChange, ChangeOutcome, ClusterUpdate, ControlPanel, DataType, DataTypeDefaults, ObjectCounts, LivePictureListener, LivePictureOptions, MapPaneOverlay, MapViewMount, Notification, PluginContext, PluginState,
  PluginStatus, Settings, SettingsPanel, SettingsPanelProps, SettingsSaveResult, Snapshot, Ui, User,
} from '../context.ts';
import { NATO_CLASSIFICATIONS, OutcomeUnknownError, type ClassificationOrders } from '../context.ts';
import { uuidv7 } from '../ids.ts';
import type { ChangeEvent, ChangeRejection, ChangeRequest, Extensions, MapObjectContent, FieldValue, Geometry, JsonValue, Layer, LayerContent, MapObject, MilSymbol, Position, SecurityLabel, Style, Uuid } from '../model.ts';
import type { DeclaredField } from '../fields.ts';
import type { SymbolPalette } from '../palettes.ts';
import { resolveRelationLines, withDataTypeSets, type FieldSet, type RelationKind, type RelationLine } from '../sets.ts';
import { NOW, userTimeProblem, type UserTime } from '../time.ts';
import { withSteppedFades } from '../fade.ts';
import { displayChoicesProblem, resolveDisplay, type DisplayChoices, type DisplaySettings } from '../display.ts';
import type { WebPlugin } from '../context.ts';
import { declaredFieldProblem, sameField } from '../fields.ts';
import type { VesselGroup,
  BackgroundMapProvider, CoordinateFormat, CoordinateService, DrawKind, DrawnGeometry, FadeList, MapPointerEvent, MapType, MapView, Overlay, OverlayItem, Pixel, RenderingMode,
  ObjectListService, ServiceKey, ServiceList, SharedState, SidcParts, SymbolImage, SymbolService, VectorFeature, Viewport, WmsSource,
  GraphicCatalogEntry, GraphicImage, GraphicRendering,
} from '../services.ts';
import type { Unsubscribe } from '../events.ts';
import type { Panel, SetupShare, TopBarItem, WorkspaceInfo } from '../workspace.ts';
import { EVERY_WORKSPACE, jsonBytes, MAX_SETUP_SHARE_BYTES, VIEW_WORKSPACE, workspaceOf } from '../workspace.ts';
import type { MapAction, MenuTarget, ObjectAction, ScreenPoint } from '../actions.ts';
import { applicableMapActions, applicableObjectActions } from '../actions.ts';
import type { LayerPage } from '../objects.ts';
import { layerQueryOptions, MAX_FETCH_IDS, ObjectQueryError } from '../objects.ts';
import { USER_DOCUMENT_LIMITS, USER_DOCUMENT_NAME, UserDocumentError } from '../userDocuments.ts';
import { MAX_SELECTION, NotALineError, NotOnMapError, overlayProblem } from '../services.ts';
import type { ThemeState, TokenName } from '../theme.ts';

export interface LogRecord {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly args: readonly unknown[];
}

/** How the fake object store answers a change request. */
export type AnswerPolicy = (request: ChangeRequest) => ChangeOutcome | 'unknown';

/** A {@link PluginContext} with hooks for tests. */
export interface FakeContext extends PluginContext {
  readonly logs: readonly LogRecord[];
  readonly notifications: readonly Notification[];
  /** Every status the plugin set, in order. */
  readonly statusHistory: readonly PluginStatus[];
  readonly panels: readonly ControlPanel[];
  /** SDK 1.1.0: panels added with `addPanel`, with how often each was shown (`show()`). */
  readonly addedPanels: readonly { readonly panel: Panel; readonly shown: number }[];
  /** SDK 1.1.0: top bar items. */
  readonly topBarItems: readonly TopBarItem[];
  readonly overlays: readonly MapPaneOverlay[];
  readonly mapViewMount: MapViewMount | null;
  /** Feeds the live picture to subscribers. `area` and `clusters` reach only subscriptions with an `area` whose listener has those methods. */
  readonly live: {
    snapshot(snapshot: Partial<Snapshot>): void;
    changes(batch: readonly ChangeEvent[]): void;
    area(change: AreaChange): void;
    clusters(update: ClusterUpdate): void;
    /** Reaches only subscriptions with `objects: false`. */
    counts(counts: ObjectCounts): void;
  };
  /** The options of every live picture subscription still active, in order (e.g. to check `area` and `budget`). */
  readonly liveSubscriptions: readonly LivePictureOptions[];
  /** Every change request the plugin submitted, with `requestId` and `source` filled in as the shell would. */
  readonly submitted: readonly ChangeRequest[];
  /** Replaces the default policy, which applies every request. `'unknown'` makes `submit` reject with OutcomeUnknownError. */
  answerWith(policy: AnswerPolicy): void;
  /** Provides a service as another plugin would. SDK 1.3.0: returns what removes it again, as `services.provide` does. */
  provideAs<T>(key: ServiceKey<T, 'one' | 'many'>, implementation: T): Unsubscribe;
  readonly ui: Ui;
  /** SDK 1.3.0: the plugin's own settings panel (`ui.setSettingsPanel`, the last one set), or null for the generated form. */
  readonly settingsPanel: SettingsPanel | null;
  /**
   * SDK 1.3.0: the props the shell gives the settings panel now: the current settings as `values`,
   * `save` and `markUnsaved`. Render the panel with them, and again after a change of settings.
   * `save` rejects, as the shell's does for a refused permission, when the user lacks
   * `settings.admin`; otherwise it answers with `FakeContextOptions.saveSettings`.
   */
  settingsPanelProps(): SettingsPanelProps;
  /** SDK 1.3.0: every `save` of the settings panel, in order. */
  readonly settingsSaves: readonly Settings[];
  /** SDK 1.3.0: the last value the settings panel gave `markUnsaved`; false before the first. */
  readonly settingsPanelUnsaved: boolean;
  /** Changes the settings as a user with `settings.admin` would: `settings` returns them, and every `onSettingsChange` listener is called. */
  changeSettings(values: Settings): void;
  /** Changes a data type's effective behaviour, as a user with `settings.admin` would; every `onDataTypesChange` listener is called. */
  changeDataTypeBehaviour(id: string, behaviour: DataTypeDefaults): void;
  /** SDK 1.1.0: the registered setup share, or null. */
  readonly setupShare: SetupShare | null;
  /** How often the plugin called `setup.changed()`. */
  readonly setupChanges: number;
  /** Saves the share as the shell would; throws if it is not JSON or larger than {@link MAX_SETUP_SHARE_BYTES}. */
  saveSetup(): JsonValue;
  /** Restores a saved share as the shell would, at start or when the user picks a named setup. */
  restoreSetup(share: JsonValue): void;
  /** SDK 1.1.0: the object actions the plugin registered. */
  readonly objectActions: readonly ObjectAction[];
  /** SDK 1.1.0: the map actions the plugin registered. */
  readonly mapActions: readonly MapAction[];
  /** Every menu the plugin opened, in order. */
  readonly openedMenus: readonly { readonly at: ScreenPoint; readonly target: MenuTarget }[];
  /**
   * Runs one of the plugin's object actions as the shell's menu would, for objects of the fake
   * server ({@link FakeContext.setServerObjects}): throws if the menu would not offer it for them
   * (scope, one or several, the user's permission). Resolves when the handler has finished.
   */
  runObjectAction(actionId: string, ids: readonly Uuid[]): Promise<void>;
  /** Runs one of the plugin's map actions, as the menu would; throws if the user may not use it. */
  runMapAction(actionId: string, position: Position): Promise<void>;
  /** The objects the fake server holds for `objects.get` and `objects.queryLayer` (not the live picture). */
  setServerObjects(objects: readonly MapObject[]): void;
  /** The layers the fake server knows; once set, `queryLayer` rejects for any other layer, as the server does. Without it, every layer exists. */
  setServerLayers(layerIds: readonly Uuid[]): void;
  /** From now on, `objects.get` and `objects.queryLayer` reject with ObjectQueryError (a lost connection or a timeout), or answer again. */
  failObjectQueries(fail: boolean): void;
  /** SDK 1.1.0: the user's documents in this plugin's namespace, as stored (a copy). The per-user limit counts only this namespace in the fake. */
  readonly storedUserDocuments: { readonly [name: string]: JsonValue };
  /** From now on, user document calls reject with `unavailable` (a lost connection), or answer again. */
  failUserDocuments(fail: boolean): void;
  /**
   * SDK 1.4.0: picks a time in the time control, as the user would (ADR-0045): every temporal module
   * started with {@link activatePlugin} on this context gets `timeChanged(time)`. Throws for a time
   * the shell would refuse (`userTimeProblem`).
   */
  setTime(time: UserTime): void;
  /** SDK 1.4.0: the time the fake's time control shows now (for the test; plugins have no `ctx.time`). */
  readonly currentTime: UserTime;
  /** SDK 1.4.0: listeners of {@link activatePlugin}; called by `setTime`. */
  onTimeChange(listener: (time: UserTime) => void): Unsubscribe;
  /**
   * SDK 1.4.0 part 5: changes the user's display settings as the user would in the shell's window
   * (ADR-0052): the parts given replace the current ones, a relation switch at a time included, and
   * every `ctx.display.onChange` listener is called with the new value. Switches for kinds that are
   * not loaded are ignored, as the shell does. Throws for values the shell would refuse
   * (`displayChoicesProblem`).
   *
   * @example
   * ctx.setDisplay({ symbolSize: 48, relations: { 'gmti.pairing': false } });
   */
  setDisplay(choices: DisplayChoices): void;
  /**
   * SDK 1.6.0 (CR-0041 part C): changes a plugin's settings as an admin would; `ctx.relationLines`
   * is resolved again and its listeners are called. SDK 1.7.0 (CR-0042): so are the data types'
   * stepped fades (`DataType.fade`), with `onDataTypesChange` when one changed.
   */
  setPluginSettings(pluginId: string, settings: unknown): void;
  /** SDK 1.1.0: switches the look, light or dark, or the density, as the user would; `tokens` replaces some values. Every `theme.onChange` listener is called. */
  changeTheme(state: Partial<ThemeState>, tokens?: Partial<Record<TokenName, string>>): void;
  /**
   * SDK 1.2.0: switches the workspace shown as the shell does (ADR-0039 point 3), steps 3 to 5 of
   * `CurrentWorkspace` in order: each subscription that follows the workspace shown gets a fresh
   * snapshot of the picture fed so far (the last snapshot with the change batches after it),
   * filtered for `id`; the plugin's setup share for that workspace is restored, if one was saved
   * there ({@link FakeContext.saveSetup} saves for the workspace shown); then every
   * `ctx.workspace.onChange` listener is called. Step 1 (unmounting panels) is the shell's. Step 2,
   * the map view's moment, is a fake map view's own `switchWorkspace()`: call it first.
   */
  switchWorkspace(id: string): void;
}

export interface FakeContextOptions {
  readonly pluginId?: string;
  readonly settings?: { readonly [name: string]: JsonValue };
  readonly defaultLabel?: SecurityLabel;
  /** SDK 1.5.0 part 4: `ctx.classifications`; the NATO order (`{ NATO: NATO_CLASSIFICATIONS }`) when absent. */
  readonly classifications?: ClassificationOrders;
  /** The manifest's `provides`; if given, `services.provide` refuses other keys. */
  readonly provides?: readonly string[];
  /**
   * The manifest's `uses` (CR-0011): `services.get` on such a key rejects at once when nothing
   * provides it at the time of the call, as the shell does when no loaded plugin provides it. To
   * test a provider that activates later, leave the key out here.
   */
  readonly uses?: readonly string[];
  /** The session's user; default: the no-login user, who has every permission. See {@link createFakeUser}. */
  readonly user?: User;
  /** SDK 1.1.0: the starting look; default Night Watch, dark, compact, with {@link FAKE_TOKEN_VALUES}. */
  readonly theme?: Partial<ThemeState>;
  /** Data types the loaded plugins declare; `core.general` always comes first. Without `behaviour`, it is the defaults. */
  readonly dataTypes?: readonly (Omit<DataType, 'behaviour'> & { readonly behaviour?: DataTypeDefaults })[];
  /**
   * SDK 1.2.0: the fields the loaded plugins declare (ADR-0038), the plugin's own included; default
   * none. The default answer policy checks a request's `fields` against them as the object store
   * does ({@link fieldsRejection}), and applies them to the event's state.
   */
  readonly declaredFields?: readonly DeclaredField[];
  /**
   * SDK 1.2.0: the workspaces this user may see besides View, which always comes first; default
   * View only. The fake live picture filters by them (`LivePictureOptions.workspaces`, else the
   * workspace shown).
   */
  readonly workspaces?: readonly WorkspaceInfo[];
  /**
   * SDK 1.4.0: the field sets the loaded plugins declare (ADR-0050); default none. The default
   * answer policy rejects a set a request adds that is not among them (model rule 18,
   * {@link setsAndRelationsRejection}).
   */
  readonly fieldSets?: readonly FieldSet[];
  /**
   * SDK 1.4.0: the relation kinds the loaded plugins declare (ADR-0051 point 2); default none. The
   * default answer policy rejects a new relation of another kind (model rule 17).
   */
  readonly relationKinds?: readonly RelationKind[];
  /**
   * SDK 1.6.0 (CR-0041 part C): other plugins' settings by plugin id, for the relation lines'
   * colours (`ctx.relationLines`); change them with {@link FakeContext.setPluginSettings}.
   */
  readonly pluginSettings?: Readonly<Record<string, unknown>>;
  /** SDK 1.6.0 (CR-0041 part G): the palettes `ctx.symbolPalettes` gives; default none. */
  readonly symbolPalettes?: readonly SymbolPalette[];
  /**
   * SDK 1.4.0 (ADR-0045): the session's time at the start; default now. A temporal module started
   * with {@link activatePlugin} is told it, and each {@link FakeContext.setTime}. There is no
   * `ctx.time` (the ACA's R4): the module learns the time only through `timeChanged`.
   */
  readonly time?: UserTime;
  /**
   * SDK 1.4.0 part 5: the user's display choices at the start, each part optional; the rest are
   * {@link DEFAULT_DISPLAY}'s and, per relation kind of `relationKinds`, its `defaultOn`
   * (`resolveDisplay`). `ctx.display` always exists on the fake; {@link FakeContext.setDisplay}
   * changes it.
   */
  readonly display?: DisplayChoices;
  /** SDK 1.2.0: the id of the workspace shown at the start; default View. */
  readonly workspace?: string;
  /**
   * SDK 1.3.0: how ECore answers a settings panel's `save` (`settingsPanelProps`). Default: `ok`
   * with the values. An `ok` answer replaces `ctx.settings` and calls the `onSettingsChange`
   * listeners, as the shell does after an accepted change. A throw makes `save` reject, as a
   * transport failure does.
   */
  readonly saveSettings?: (values: Settings) => SettingsSaveResult;
}

/** View, as the shell lists it first. */
export const VIEW_WORKSPACE_INFO: WorkspaceInfo = { id: VIEW_WORKSPACE, name: 'View', order: Number.MIN_SAFE_INTEGER };

/** The fake's token values: Night Watch, dark, compact (`docs/architecture/looks.md`). The shell's real values are the CDA's (T-052). */
export const FAKE_TOKEN_VALUES: Readonly<Record<TokenName, string>> = {
  colorGround: '#0f1217', colorPane: '#161b22', colorPanel: '#1d232c', colorBorder: '#2a323d', colorFieldBorder: '#68727f',
  colorText: '#e3e8ef', colorMuted: '#8c97a6', colorAccent: '#a898ff', colorOnAccent: '#15112e', colorAccentSoft: '#2a2547',
  colorOk: '#4cc38a', colorWarning: '#e5a84b', colorError: '#f2776b', colorBackdrop: 'rgba(0, 0, 0, 0.45)',
  colorEdge: '#68727f', colorEdgeCard: '#68727f', colorRaised: '#1d232c',
  fontText: "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', sans-serif",
  fontData: "'Cascadia Mono', Consolas, ui-monospace, 'SF Mono', monospace",
  fontHeading: "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', sans-serif",
  headingCase: 'uppercase', headingLetterSpacing: '0.06em', headingWeight: '600',
  fontLabel: "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', sans-serif",
  labelCase: 'none', labelLetterSpacing: 'normal', labelWeight: '400',
  radius: '2px', radiusControl: '2px', edgeWidth: '1px', shadowCard: 'none', shadowMenu: 'none',
  focusColor: '#a898ff', focusWidth: '2px', focusOffset: '2px',
  sizeText: '12.5px', sizeTextSmall: '11px', sizeRow: '26px', sizeField: '26px', sizeIcon: '16px', spacePadding: '8px', spaceGap: '6px',
};

/** The built-in data type, as the shell lists it. */
export const GENERAL_DATA_TYPE_INFO: DataType = {
  id: 'core.general', name: 'General', description: 'The built-in data type, for everything without a more specific one.', declaredBy: null, defaults: {},
  behaviour: {},
};

/**
 * A user for tests (ADR-0022). Without `permissions`, the no-login user, who has every permission.
 *
 * @example
 * const ctx = createFakeContext({ user: createFakeUser({ permissions: [] }) });   // read only
 */
export function createFakeUser(options: { readonly id?: string; readonly name?: string; readonly permissions?: readonly string[] } = {}): User {
  if (options.permissions === undefined) {
    return { id: 'local', name: 'Local user', permissions: new Set(), noLogin: true, has: () => true };
  }
  const permissions: ReadonlySet<string> = new Set(options.permissions);
  return { id: options.id ?? 'test-user', name: options.name ?? 'Test user', permissions, noLogin: false, has: (p) => permissions.has(p) };
}

/** A fake plugin context. The default answer policy applies every request and returns a matching change event. */
export function createFakeContext(options: FakeContextOptions = {}): FakeContext {
  const pluginId = options.pluginId ?? 'test-plugin';
  const defaultLabel = options.defaultLabel ?? { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' };
  const classifications: ClassificationOrders = options.classifications ?? Object.freeze({ NATO: NATO_CLASSIFICATIONS });
  const logs: LogRecord[] = [];
  const notifications: Notification[] = [];
  const statusHistory: PluginStatus[] = [];
  const panels: ControlPanel[] = [];
  const addedPanels: { readonly panel: Panel; shown: number }[] = [];
  const topBarItems: TopBarItem[] = [];
  let setupShare: SetupShare | null = null;
  let setupChanges = 0;
  const objectActions: ObjectAction[] = [];
  const mapActions: MapAction[] = [];
  const openedMenus: { readonly at: ScreenPoint; readonly target: MenuTarget }[] = [];
  let serverObjects: readonly MapObject[] = [];
  let serverLayers: ReadonlySet<Uuid> | null = null;
  let queriesFail = false;
  const userDocs = new Map<string, string>();
  let userDocsFail = false;
  let themeState: ThemeState = { look: 'night-watch', scheme: 'dark', density: 'compact', ...options.theme };
  let tokenValues: Readonly<Record<TokenName, string>> = FAKE_TOKEN_VALUES;
  const themeListeners = new Set<(state: ThemeState) => void>();
  const docsUnavailable = () => Promise.reject(new UserDocumentError('unavailable', 'no answer from the server (fake)'));
  const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;
  const user = options.user ?? createFakeUser();
  const overlays: MapPaneOverlay[] = [];
  const submitted: ChangeRequest[] = [];
  const listeners: { readonly listener: LivePictureListener; readonly options: LivePictureOptions }[] = [];
  const services = new Map<string, unknown[]>();
  const waiting = new Map<string, ((value: unknown) => void)[]>();
  const listWatchers = new Map<string, Set<(current: readonly unknown[]) => void>>();
  let mapViewMount: MapViewMount | null = null;
  let settingsPanel: SettingsPanel | null = null;
  const settingsSaves: Settings[] = [];
  let settingsPanelUnsaved = false;
  let sequenceNo = 0;
  const declaredFields: readonly DeclaredField[] = [...(options.declaredFields ?? [])];
  const workspaceList: readonly WorkspaceInfo[] = [
    VIEW_WORKSPACE_INFO,
    ...[...(options.workspaces ?? [])].filter((w) => w.id !== VIEW_WORKSPACE).sort((a, b) => a.order - b.order),
  ];
  const findWorkspace = (id: string): WorkspaceInfo => {
    const w = workspaceList.find((x) => x.id === id);
    if (w === undefined) throw new Error(`no workspace ${id} (createFakeContext({ workspaces }))`);
    return w;
  };
  let currentWorkspace = findWorkspace(options.workspace ?? VIEW_WORKSPACE);
  const workspaceListeners = new Set<(w: WorkspaceInfo) => void>();
  const sharesByWorkspace = new Map<string, JsonValue>();
  // What the fake live picture knows, to filter by workspace: the last full snapshot, and where layers and objects are.
  let lastFull: Snapshot | null = null;
  let lastCounts: ObjectCounts | undefined;
  const layerWorkspace = new Map<Uuid, string>();
  const objectLayer = new Map<Uuid, Uuid>();
  // SDK 1.4.0: the objects as the test's snapshots and batches last gave them, for rules 17 and 18 on update.
  const objectState = new Map<Uuid, MapObject>();
  const fieldSets: readonly FieldSet[] = [...(options.fieldSets ?? [])];
  let currentTime: UserTime = options.time ?? NOW;
  const timeListeners = new Set<(time: UserTime) => void>();
  const relationKinds: readonly RelationKind[] = [...(options.relationKinds ?? [])];
  {
    const problem = options.display === undefined ? null : displayChoicesProblem(options.display);
    if (problem !== null) throw new Error(problem);
  }
  const pluginSettings: Record<string, unknown> = { ...options.pluginSettings };
  let relationLines = resolveRelationLines(relationKinds, (p) => pluginSettings[p]);
  const relationLineListeners = new Set<(value: Readonly<Record<string, RelationLine>>) => void>();
  let displayChoices: DisplayChoices = { ...options.display };
  let display: DisplaySettings = resolveDisplay(displayChoices, {}, relationKinds);
  const displayListeners = new Set<(value: DisplaySettings) => void>();
  // SDK 1.3.0: the layers as last sent, for the lock (ADR-0042).
  const knownLayers = new Map<Uuid, Layer>();
  const followed = (o: LivePictureOptions): readonly string[] => o.workspaces ?? [currentWorkspace.id];
  const allows = (list: readonly string[], ws: string) => list.includes(EVERY_WORKSPACE) || list.includes(ws);
  const layerAllowed = (list: readonly string[], layerId: Uuid) => allows(list, layerWorkspace.get(layerId) ?? VIEW_WORKSPACE);
  const filterSnapshot = (full: Snapshot, o: LivePictureOptions, counts: ObjectCounts | undefined): Snapshot => {
    const list = followed(o);
    const layers = full.layers.filter((l) => allows(list, workspaceOf(l)));
    // A layer the fake does not know is in View.
    const objects = full.objects.filter((x) => layerAllowed(list, x.layerId));
    if (o.objects === false) {
      const all = counts ?? countsOf(full.objects);
      return { ...full, layers, objects: [], objectCounts: Object.fromEntries(Object.entries(all).filter(([id]) => layerAllowed(list, id))) };
    }
    return counts === undefined
      ? { ...full, layers, objects }
      : { ...full, layers, objects, objectCounts: Object.fromEntries(Object.entries(counts).filter(([id]) => layerAllowed(list, id))) };
  };
  const eventAllowed = (list: readonly string[], e: ChangeEvent): boolean => {
    if (e.entityType === 'layer') return allows(list, e.state == null ? (layerWorkspace.get(e.entityId) ?? VIEW_WORKSPACE) : workspaceOf(e.state as Layer));
    const layerId = e.state == null ? objectLayer.get(e.entityId) : (e.state as MapObject).layerId;
    return layerId === undefined || layerAllowed(list, layerId);
  };
  let policy: AnswerPolicy = (request) => {
    const stored = objectState.get(request.entityId);
    const rejection = lockRejection(request, knownLayers, objectLayer) ?? setsAndRelationsRejection(request, fieldSets, relationKinds, stored) ?? fieldsRejection(request, declaredFields);
    return rejection !== null ? { outcome: 'rejected', rejection } : { outcome: 'applied', event: appliedEvent(request, ++sequenceNo, defaultLabel, stored, dataTypes) };
  };
  let settings: Settings = options.settings ?? {};
  const settingsListeners = new Set<(settings: Settings) => void>();
  // SDK 1.7.0 (CR-0042): a data type's `fade` from its plugin's settings, as the shell resolves it;
  // the plugin under test's own settings for its own types.
  const settingsOf = (plugin: string): unknown => (plugin === pluginId ? settings : pluginSettings[plugin]);
  let dataTypes: readonly DataType[] = withSteppedFades([
    GENERAL_DATA_TYPE_INFO,
    ...(options.dataTypes ?? []).filter((t) => t.id !== GENERAL_DATA_TYPE_INFO.id).map((t) => ({ ...t, behaviour: t.behaviour ?? t.defaults })),
  ], settingsOf);
  const dataTypeListeners = new Set<(dataTypes: readonly DataType[]) => void>();
  /** SDK 1.7.0: resolves the fades again after a settings change; calls the listeners when one changed. */
  const refreshFades = () => {
    const next = withSteppedFades(dataTypes, settingsOf);
    if (next.every((type, i) => type === dataTypes[i])) return;
    dataTypes = next;
    for (const l of [...dataTypeListeners]) l(dataTypes);
  };

  const register = (keyId: string, implementation: unknown): Unsubscribe => {
    const list = services.get(keyId) ?? [];
    list.push(implementation);
    services.set(keyId, list);
    for (const resolve of waiting.get(keyId) ?? []) resolve(implementation);
    waiting.delete(keyId);
    for (const watcher of listWatchers.get(keyId) ?? []) watcher([...list]);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const current = services.get(keyId) ?? [];
      const i = current.indexOf(implementation);
      if (i < 0) return;
      current.splice(i, 1);
      for (const watcher of [...(listWatchers.get(keyId) ?? [])]) watcher([...current]);
    };
  };
  const applySettings = (values: Settings) => {
    settings = values;
    for (const l of [...settingsListeners]) l(values);
    refreshFades();
  };

  const log = (level: LogRecord['level']) => (message: string, ...args: unknown[]) => {
    logs.push({ level, message, args });
  };

  const ctx: FakeContext = {
    pluginId,
    log: { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') },
    status: {
      set(state: PluginState, detail: string) {
        statusHistory.push({ state, detail });
      },
    },
    get settings() {
      return settings;
    },
    onSettingsChange(listener) {
      settingsListeners.add(listener);
      return () => settingsListeners.delete(listener);
    },
    user,
    get dataTypes() {
      return dataTypes;
    },
    declaredFields,
    fieldSets,
    relationKinds,
    workspaces: workspaceList,
    workspace: {
      get current() {
        return currentWorkspace;
      },
      onChange(listener) {
        workspaceListeners.add(listener);
        return () => workspaceListeners.delete(listener);
      },
    },
    onDataTypesChange(listener) {
      dataTypeListeners.add(listener);
      return () => dataTypeListeners.delete(listener);
    },
    services: {
      provide(key, implementation) {
        if (options.provides && !options.provides.includes(key.id)) {
          throw new Error(`${pluginId} may not provide ${key.id}: not in the manifest's "provides"`);
        }
        return register(key.id, implementation);
      },
      get<T>(key: ServiceKey<T, 'one'>): Promise<T> {
        const existing = services.get(key.id)?.[0];
        if (existing !== undefined) return Promise.resolve(existing as T);
        if (options.uses?.includes(key.id)) {
          return Promise.reject(new Error(`uses ${key.id}, which no loaded plugin provides`));
        }
        return new Promise<T>((resolve) => {
          const list = waiting.get(key.id) ?? [];
          list.push((value) => resolve(value as T));
          waiting.set(key.id, list);
        });
      },
      getAll<T>(key: ServiceKey<T, 'many'>): ServiceList<T> {
        return {
          get current() {
            return [...(services.get(key.id) ?? [])] as T[];
          },
          onChange(listener) {
            const set = listWatchers.get(key.id) ?? new Set();
            const wrapped = (current: readonly unknown[]) => listener(current as T[]);
            set.add(wrapped);
            listWatchers.set(key.id, set);
            return () => set.delete(wrapped);
          },
        };
      },
    },
    ui: {
      addControlPanel(panel) {
        panels.push(panel);
        return () => remove(panels, panel);
      },
      addPanel(panel) {
        if (addedPanels.some((p) => p.panel.id === panel.id) || panels.some((p) => p.id === panel.id)) {
          throw new Error(`${pluginId} already has a panel ${panel.id}`);
        }
        const entry = { panel, shown: 0 };
        addedPanels.push(entry);
        return {
          show() {
            entry.shown++;
          },
          remove() {
            remove(addedPanels, entry);
          },
        };
      },
      addTopBarItem(item) {
        topBarItems.push(item);
        return () => remove(topBarItems, item);
      },
      addMapPaneOverlay(overlay) {
        overlays.push(overlay);
        return () => remove(overlays, overlay);
      },
      setMapView(view) {
        mapViewMount = view;
      },
      setSettingsPanel(panel) {
        settingsPanel = panel;
        return () => {
          if (settingsPanel === panel) settingsPanel = null;
        };
      },
    },
    notify(notification) {
      notifications.push(notification);
    },
    livePicture: {
      subscribe(listener, options = {}) {
        const entry = { listener, options };
        listeners.push(entry);
        return () => remove(listeners, entry);
      },
    },
    changes: {
      submit(content) {
        const request = { ...content, requestId: uuidv7(), source: { plugin: pluginId } } as ChangeRequest;
        submitted.push(request);
        const answer = policy(request);
        if (answer === 'unknown') return Promise.reject(new OutcomeUnknownError('no answer from the server (fake)'));
        return Promise.resolve(answer);
      },
    },
    defaultLabel,
    classifications,
    newId: () => uuidv7(),
    serverBase: `/api/plugins/${pluginId}/`,
    webBase: `/plugins/${pluginId}/web/`,
    setup: {
      register(share) {
        setupShare = share;
        return () => {
          if (setupShare === share) setupShare = null;
        };
      },
      changed() {
        setupChanges++;
      },
    },
    actions: {
      addObjectAction(action) {
        if (objectActions.some((a) => a.id === action.id)) throw new Error(`${pluginId} already has an object action ${action.id}`);
        objectActions.push(action);
        return () => remove(objectActions, action);
      },
      addMapAction(action) {
        if (mapActions.some((a) => a.id === action.id)) throw new Error(`${pluginId} already has a map action ${action.id}`);
        mapActions.push(action);
        return () => remove(mapActions, action);
      },
      openMenu(at, target) {
        openedMenus.push({ at, target });
      },
    },
    objects: {
      get(ids) {
        if (queriesFail) return Promise.reject(new ObjectQueryError('no answer from the server (fake)'));
        if (ids.length > MAX_FETCH_IDS) return Promise.reject(new ObjectQueryError(`at most ${MAX_FETCH_IDS} ids: ${ids.length}`));
        const byId = new Map(serverObjects.map((o) => [o.id, o]));
        const found: MapObject[] = [];
        const missing: Uuid[] = [];
        for (const id of new Set(ids)) {
          const o = byId.get(id);
          if (o === undefined) missing.push(id);
          else found.push(o);
        }
        return Promise.resolve({ found, missing });
      },
      queryLayer(layerId, queryOptions) {
        try {
          const { page, pageSize } = layerQueryOptions(queryOptions);
          if (queriesFail) throw new ObjectQueryError('no answer from the server (fake)');
          if (serverLayers !== null && !serverLayers.has(layerId)) throw new ObjectQueryError(`no layer ${layerId}`);
          const all = serverObjects.filter((o) => o.layerId === layerId).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
          const result: LayerPage = { layerId, page, pageSize, objects: all.slice(page * pageSize, (page + 1) * pageSize), total: all.length };
          return Promise.resolve(result);
        } catch (e) {
          return Promise.reject(e);
        }
      },
    },
    userDocuments: {
      get(name) {
        if (userDocsFail) return docsUnavailable();
        if (!USER_DOCUMENT_NAME.test(name)) return Promise.reject(new UserDocumentError('bad-name', `not a document name: ${name}`));
        const text = userDocs.get(name);
        return Promise.resolve(text === undefined ? null : (JSON.parse(text) as JsonValue));
      },
      put(name, value) {
        if (userDocsFail) return docsUnavailable();
        if (!USER_DOCUMENT_NAME.test(name)) return Promise.reject(new UserDocumentError('bad-name', `not a document name: ${name}`));
        const text = JSON.stringify(value);
        const bytes = utf8Bytes(text);
        if (bytes > USER_DOCUMENT_LIMITS.maxBytes) return Promise.reject(new UserDocumentError('too-large', `${name} has ${bytes} bytes`));
        if (!userDocs.has(name) && userDocs.size >= USER_DOCUMENT_LIMITS.maxDocuments) {
          return Promise.reject(new UserDocumentError('too-many', `at most ${USER_DOCUMENT_LIMITS.maxDocuments} documents`));
        }
        let total = bytes;
        for (const [other, t] of userDocs) if (other !== name) total += utf8Bytes(t);
        if (total > USER_DOCUMENT_LIMITS.maxBytesPerUser) return Promise.reject(new UserDocumentError('user-full', `the user's documents would take ${total} bytes`));
        userDocs.set(name, text);
        return Promise.resolve();
      },
      delete(name) {
        if (userDocsFail) return docsUnavailable();
        userDocs.delete(name);
        return Promise.resolve();
      },
      list() {
        if (userDocsFail) return docsUnavailable();
        return Promise.resolve([...userDocs.keys()].sort());
      },
    },
    theme: {
      get current() {
        return themeState;
      },
      tokens: () => tokenValues,
      onChange(listener) {
        themeListeners.add(listener);
        return () => themeListeners.delete(listener);
      },
    },
    changeTheme(state, tokens) {
      themeState = { ...themeState, ...state };
      tokenValues = { ...tokenValues, ...tokens };
      for (const l of [...themeListeners]) l(themeState);
    },
    get storedUserDocuments() {
      return Object.fromEntries([...userDocs].map(([n, text]) => [n, JSON.parse(text) as JsonValue]));
    },
    failUserDocuments(fail) {
      userDocsFail = fail;
    },
    objectActions,
    mapActions,
    openedMenus,
    async runObjectAction(actionId, ids) {
      const action = objectActions.find((a) => a.id === actionId);
      if (action === undefined) throw new Error(`${pluginId} has no object action ${actionId}`);
      const { found, missing } = await ctx.objects.get(ids);
      if (missing.length > 0) throw new Error(`the fake server holds no objects ${missing.join(', ')}`);
      if (!applicableObjectActions([action], found, (p) => user.has(p)).includes(action)) {
        throw new Error(`the menu would not offer ${actionId} for these ${ids.length} objects`);
      }
      await action.run(ids);
    },
    async runMapAction(actionId, position) {
      const action = mapActions.find((a) => a.id === actionId);
      if (action === undefined) throw new Error(`${pluginId} has no map action ${actionId}`);
      if (!applicableMapActions([action], (p) => user.has(p)).includes(action)) throw new Error(`the user may not use ${actionId}`);
      await action.run(position);
    },
    setServerObjects(objects) {
      serverObjects = [...objects];
    },
    setServerLayers(layerIds) {
      serverLayers = new Set(layerIds);
    },
    failObjectQueries(fail) {
      queriesFail = fail;
    },
    get addedPanels() {
      return addedPanels;
    },
    topBarItems,
    get setupShare() {
      return setupShare;
    },
    get setupChanges() {
      return setupChanges;
    },
    saveSetup() {
      if (setupShare === null) throw new Error(`${pluginId} registered no setup share`);
      const value = setupShare.save();
      const bytes = jsonBytes(value);
      if (bytes > MAX_SETUP_SHARE_BYTES) throw new Error(`the setup share of ${pluginId} has ${bytes} bytes, more than ${MAX_SETUP_SHARE_BYTES}`);
      const copy = JSON.parse(JSON.stringify(value)) as JsonValue;
      sharesByWorkspace.set(currentWorkspace.id, copy);
      return copy;
    },
    restoreSetup(share) {
      setupShare?.restore(share);
    },
    switchWorkspace(id) {
      currentWorkspace = findWorkspace(id);
      if (lastFull !== null) {
        const full = lastFull;
        for (const { listener, options: o } of [...listeners]) if (o.workspaces === undefined) listener.snapshot(filterSnapshot(full, o, lastCounts));
      }
      const share = sharesByWorkspace.get(id);
      if (share !== undefined) setupShare?.restore(share);
      for (const l of [...workspaceListeners]) l(currentWorkspace);
    },
    logs,
    notifications,
    statusHistory,
    panels,
    overlays,
    get mapViewMount() {
      return mapViewMount;
    },
    live: {
      snapshot(snapshot) {
        const full: Snapshot = { layers: snapshot.layers ?? [], objects: snapshot.objects ?? [], sequenceNo: snapshot.sequenceNo ?? sequenceNo };
        lastFull = full;
        lastCounts = snapshot.objectCounts;
        layerWorkspace.clear();
        objectLayer.clear();
        objectState.clear();
        knownLayers.clear();
        for (const l of full.layers) knownLayers.set(l.id, l);
        for (const l of full.layers) layerWorkspace.set(l.id, workspaceOf(l));
        for (const o of full.objects) objectLayer.set(o.id, o.layerId);
        for (const o of full.objects) objectState.set(o.id, o);
        // SDK 1.2.0: each subscription gets the layers and objects of its workspaces only.
        for (const { listener, options } of [...listeners]) listener.snapshot(filterSnapshot(full, options, snapshot.objectCounts));
      },
      changes(batch) {
        for (const e of batch) {
          if (e.entityType === 'layer' && e.state != null) layerWorkspace.set(e.entityId, workspaceOf(e.state as Layer));
          if (e.entityType === 'layer' && e.state != null) knownLayers.set(e.entityId, e.state as Layer);
          if (e.entityType === 'object' && e.state != null) objectLayer.set(e.entityId, (e.state as MapObject).layerId);
          if (e.entityType === 'object' && e.state != null) objectState.set(e.entityId, e.state as MapObject);
        }
        // The picture a switch replays (switchWorkspace) follows the batches: upserts and deletes.
        if (lastFull !== null) {
          let { layers, objects } = lastFull;
          for (const e of batch) {
            if (e.entityType === 'layer') {
              layers = layers.filter((l) => l.id !== e.entityId);
              if (e.state != null) layers = [...layers, e.state as Layer];
            } else {
              objects = objects.filter((o) => o.id !== e.entityId);
              if (e.state != null) objects = [...objects, e.state as MapObject];
            }
          }
          const last = batch.at(-1);
          lastFull = { layers, objects, sequenceNo: last?.sequenceNo ?? lastFull.sequenceNo };
        }
        for (const { listener, options } of [...listeners]) {
          const list = followed(options);
          const mine = batch.filter((e) => eventAllowed(list, e));
          const events = options.objects === false ? mine.filter((e) => e.entityType === 'layer') : mine;
          if (events.length > 0 || (options.objects !== false && batch.length === 0)) listener.changes(events);
        }
        for (const e of batch) {
          if (e.state != null) continue;
          if (e.entityType === 'layer') {
            layerWorkspace.delete(e.entityId);
            knownLayers.delete(e.entityId);
          } else {
            objectLayer.delete(e.entityId);
            objectState.delete(e.entityId);
          }
        }
      },
      area(change) {
        for (const { listener, options } of [...listeners]) {
          if (options.area === undefined) continue;
          const list = followed(options);
          listener.area?.({ ...change, entered: change.entered.filter((o) => layerAllowed(list, o.layerId)) });
        }
      },
      clusters(update) {
        for (const { listener, options } of [...listeners]) if (options.area !== undefined) listener.clusters?.(update);
      },
      counts(counts) {
        for (const { listener, options } of [...listeners]) if (options.objects === false) listener.counts?.(counts);
      },
    },
    get liveSubscriptions() {
      return listeners.map((l) => l.options);
    },
    submitted,
    answerWith(newPolicy) {
      policy = newPolicy;
    },
    provideAs(key, implementation) {
      return register(key.id, implementation);
    },
    changeSettings(values) {
      applySettings(values);
    },
    get settingsPanel() {
      return settingsPanel;
    },
    settingsPanelProps() {
      return {
        values: settings,
        save(values) {
          settingsSaves.push(values);
          if (!user.has('settings.admin')) return Promise.reject(new Error('403: saving settings needs settings.admin (fake)'));
          let result: SettingsSaveResult;
          try {
            result = options.saveSettings?.(values) ?? { ok: true, values };
          } catch (e) {
            return Promise.reject(e instanceof Error ? e : new Error(String(e)));
          }
          if (result.ok) applySettings(result.values);
          return Promise.resolve(result);
        },
        markUnsaved(unsaved) {
          settingsPanelUnsaved = unsaved;
        },
      };
    },
    settingsSaves,
    get settingsPanelUnsaved() {
      return settingsPanelUnsaved;
    },
    changeDataTypeBehaviour(id, behaviour) {
      if (!dataTypes.some((t) => t.id === id)) throw new Error(`no data type ${id}`);
      dataTypes = dataTypes.map((t) => (t.id === id ? { ...t, behaviour } : t));
      for (const l of [...dataTypeListeners]) l(dataTypes);
    },
    setTime(time) {
      const problem = userTimeProblem(time);
      if (problem !== null) throw new Error(problem);
      currentTime = time;
      for (const l of [...timeListeners]) l(time);
    },
    get currentTime() {
      return currentTime;
    },
    onTimeChange(listener) {
      timeListeners.add(listener);
      return () => timeListeners.delete(listener);
    },
    symbolPalettes: Object.freeze([...(options.symbolPalettes ?? [])]),
    relationLines: {
      get value() {
        return relationLines;
      },
      onChange(listener) {
        relationLineListeners.add(listener);
        return () => relationLineListeners.delete(listener);
      },
    },
    setPluginSettings(pluginId, settings) {
      pluginSettings[pluginId] = settings;
      relationLines = resolveRelationLines(relationKinds, (p) => pluginSettings[p]);
      for (const l of [...relationLineListeners]) l(relationLines);
      refreshFades();
    },
    display: {
      get value() {
        return display;
      },
      onChange(listener) {
        displayListeners.add(listener);
        return () => displayListeners.delete(listener);
      },
    },
    setDisplay(choices) {
      const problem = displayChoicesProblem(choices);
      if (problem !== null) throw new Error(problem);
      const { speedVectorMinutes: oldMinutes, speedVectorSeconds: oldSeconds, ...rest } = displayChoices;
      // SDK 1.5.0: a speed vector set in one unit replaces one set earlier in the other
      const kept = choices.speedVectorMinutes !== undefined || choices.speedVectorSeconds !== undefined ? {} : {
        ...(oldMinutes === undefined ? {} : { speedVectorMinutes: oldMinutes }), ...(oldSeconds === undefined ? {} : { speedVectorSeconds: oldSeconds }),
      };
      // SDK 1.8.0 (CR-0043 part A): places or the arrow replace a stored 1.7.0 list, and a list replaces them
      const { labels: oldLabels, labelPlaces: oldPlaces, directionArrow: oldArrow, ...others } = { ...rest, ...kept };
      const byPlace = choices.labelPlaces !== undefined || choices.directionArrow !== undefined;
      const labelsKept = choices.labels !== undefined ? {} : byPlace
        ? { ...(oldPlaces === undefined ? {} : { labelPlaces: oldPlaces }), ...(oldArrow === undefined ? {} : { directionArrow: oldArrow }) }
        : { ...(oldLabels === undefined ? {} : { labels: oldLabels }), ...(oldPlaces === undefined ? {} : { labelPlaces: oldPlaces }), ...(oldArrow === undefined ? {} : { directionArrow: oldArrow }) };
      displayChoices = { ...others, ...labelsKept, ...choices, relations: { ...displayChoices.relations, ...choices.relations }, classes: { ...displayChoices.classes, ...choices.classes } };
      display = resolveDisplay(displayChoices, {}, relationKinds);
      for (const l of [...displayListeners]) l(display);
    },
  };
  return ctx;
}

/**
 * SDK 1.4.0: starts a web module on a fake context as the shell does: awaits `activate`, then,
 * for a module with `capabilities.temporal`, calls `timeChanged` with the context's current
 * time, and again at each `ctx.setTime` (ADR-0045 point 4). Resolves with a function that stops
 * the time updates.
 *
 * @example
 * const ctx = createFakeContext({ time: { time: '2026-11-06T08:00:00.000Z' } });
 * await activatePlugin(plugin, ctx);
 * ctx.setTime({ interval: { from: '2026-11-06T08:00:00Z', to: '2026-11-06T09:30:00Z' } }); // now, with an interval
 */
export async function activatePlugin(plugin: WebPlugin, ctx: FakeContext): Promise<Unsubscribe> {
  await plugin.activate(ctx);
  const temporal = plugin.capabilities?.temporal;
  if (temporal === undefined) return () => {};
  temporal.timeChanged(ctx.currentTime);
  return ctx.onTimeChange((time) => temporal.timeChanged(time));
}

/**
 * SDK 1.4.0 (ADR-0045 point 7): a temporal test module for the shell's and the ITA's tests: it
 * does nothing in `activate` and records every time it is told, in order.
 */
export function createTemporalTestPlugin(): WebPlugin & { readonly times: readonly UserTime[] } {
  const times: UserTime[] = [];
  return {
    activate() {},
    capabilities: { temporal: { timeChanged: (time) => void times.push(time) } },
    times,
  };
}

function countsOf(objects: readonly MapObject[]): ObjectCounts {
  const counts: Record<string, number> = {};
  for (const o of objects) counts[o.layerId] = (counts[o.layerId] ?? 0) + 1;
  return counts;
}

function remove<T>(list: T[], item: T): void {
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
}

/** The change event the object store would publish for an applied request. */
export function appliedEvent(
  request: ChangeRequest, sequenceNo: number, deletedLabel: SecurityLabel, stored?: MapObject,
  dataTypes?: readonly { readonly id: string; readonly fieldSets?: readonly string[] }[],
): ChangeEvent {
  const at = new Date().toISOString();
  const by = request.source;
  const previousVersion = request.operation === 'create' ? null : (request.baseVersion ?? 1);
  const version = previousVersion === null ? 1 : previousVersion + 1;
  const base = {
    sequenceNo, requestId: request.requestId, entityType: request.entityType, operation: request.operation, entityId: request.entityId,
    version, previousVersion, at, by,
    ...(request.baseVersion !== undefined ? { baseVersion: request.baseVersion } : {}),
  };
  if (!('data' in request)) {
    return { ...base, state: null, label: deletedLabel };
  }
  const externalRef = 'externalRef' in request ? request.externalRef : undefined;
  const meta = { created: { at, by }, modified: { at, by }, ...(externalRef !== undefined ? { externalRef } : {}) };
  const fields = 'fields' in request ? (request.fields ?? []) : [];
  const withValues = fields.length === 0 ? request.data : { ...request.data, extensions: withFieldValues(request.data.extensions ?? {}, fields) };
  // SDK 1.4.0: on update the stored sets stay and the listed ones are added (rule 5's third exception).
  const listed = request.entityType === 'object' && request.operation === 'update' && stored !== undefined
    ? [...new Set([...(stored.fieldSets ?? []), ...((request.data as MapObjectContent).fieldSets ?? [])])]
    : undefined;
  // SDK 1.5.0, model rule 21: a symbol's create, or its update that changes the data type, adds the data type's sets (owner, NO A).
  const symbol = request.entityType === 'object' && (request.data as MapObjectContent).type === 'core.symbol';
  const dataType = symbol ? (request.data as MapObjectContent).dataType : undefined;
  const typeChanges = symbol && (request.operation === 'create' || (stored !== undefined && stored.dataType !== dataType));
  const typeSets = typeChanges ? (dataTypes?.find((t) => t.id === dataType)?.fieldSets ?? []) : [];
  const sets = typeSets.length === 0 ? listed : withDataTypeSets(listed ?? (request.data as MapObjectContent).fieldSets, { fieldSets: typeSets });
  const data = sets === undefined ? withValues : sets.length === 0 ? withValues : { ...withValues, fieldSets: sets };
  const state = { ...data, id: request.entityId, version, meta } as MapObject | Layer;
  return { ...base, state, label: request.data.label };
}

/** SDK 1.2.0: the declared fields after the content (ADR-0038): a value sets the key, null removes it; an emptied namespace goes. */
function withFieldValues(extensions: Extensions, fields: readonly FieldValue[]): Extensions {
  const out: Record<string, Record<string, JsonValue>> = {};
  for (const [plugin, data] of Object.entries(extensions)) out[plugin] = { ...data };
  for (const f of fields) {
    const ns = { ...(out[f.plugin] ?? {}) };
    if (f.value === null) delete ns[f.name];
    else ns[f.name] = f.value;
    if (Object.keys(ns).length === 0) delete out[f.plugin];
    else out[f.plugin] = ns;
  }
  return out;
}

/**
 * SDK 1.2.0: the object store's check of a request's declared fields (ADR-0038 point 2), as the
 * fake's default policy applies it: each field declared, editable by others unless it is the
 * requester's own, listed once, and valid for its declaration; otherwise `VALIDATION_FAILED` at
 * `/fields/<i>`. Null when every field passes.
 */
export function fieldsRejection(request: ChangeRequest, declared: readonly DeclaredField[]): ChangeRejection | null {
  const fields = 'fields' in request ? (request.fields ?? []) : [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    const name = `${f.plugin}.${f.name}`;
    const field = declared.find((d) => sameField(d, f));
    const problem =
      fields.slice(0, i).some((g) => sameField(g, f)) ? `the field ${name} is listed twice`
      : field === undefined ? `no plugin declares the field ${name}`
      : field.editableByOthers !== true && field.plugin !== request.source.plugin ? `the field ${name} is not editable by others`
      : declaredFieldProblem(field, f.value);
    if (problem !== null) {
      return {
        requestId: request.requestId, entityType: request.entityType, operation: request.operation, entityId: request.entityId,
        code: 'VALIDATION_FAILED', message: problem, details: [{ path: `/fields/${i}`, problem }], at: new Date().toISOString(),
      };
    }
  }
  return null;
}

/**
 * SDK 1.4.0: the object store's checks of field sets (model rule 18) and relations (rule 17), as the
 * fake's default policy applies them: each set a request adds is declared, and each relation's kind
 * is declared unless the stored object carries that entry (on update, when the fake knows the object
 * from a snapshot or batch the test sent). Otherwise `VALIDATION_FAILED` at
 * `/data/fieldSets/<i>` or `/data/relations/<i>/kind`. The other object of a relation is never
 * checked. Null when everything passes.
 */
export function setsAndRelationsRejection(
  request: ChangeRequest, fieldSets: readonly FieldSet[], relationKinds: readonly RelationKind[], stored?: MapObject,
): ChangeRejection | null {
  if (request.entityType !== 'object' || !('data' in request)) return null;
  const data = request.data as MapObjectContent;
  const reject = (path: string, problem: string): ChangeRejection => ({
    requestId: request.requestId, entityType: request.entityType, operation: request.operation, entityId: request.entityId,
    code: 'VALIDATION_FAILED', message: problem, details: [{ path, problem }], at: new Date().toISOString(),
  });
  const relations = data.relations ?? [];
  for (let i = 0; i < relations.length; i++) {
    const r = relations[i]!;
    const kept = stored?.relations?.some((s) => s.kind === r.kind && s.objectId === r.objectId) === true;
    if (!kept && !relationKinds.some((k) => k.id === r.kind)) return reject(`/data/relations/${i}/kind`, `no loaded plugin declares the relation kind ${r.kind} (model rule 17)`);
  }
  const sets = data.fieldSets ?? [];
  for (let i = 0; i < sets.length; i++) {
    const s = sets[i]!;
    if (stored?.fieldSets?.includes(s) !== true && !fieldSets.some((d) => d.id === s)) return reject(`/data/fieldSets/${i}`, `no loaded plugin declares the field set ${s} (model rule 18)`);
  }
  return null;
}

/**
 * SDK 1.3.0 (ADR-0042): the fake's default policy refuses a change to a locked layer's content with
 * `LAYER_LOCKED`, as the store does, since every request from a web part is a user's. It knows the
 * layers and where objects are from the snapshots and batches a test sends; a layer or object it
 * does not know is not locked. The lock comes before the declared fields (model/README.md, "Changes
 * in 1.3.0"); a layer's create is never refused for it.
 */
function lockRejection(request: ChangeRequest, layers: ReadonlyMap<Uuid, Layer>, objectLayer: ReadonlyMap<Uuid, Uuid>): ChangeRejection | null {
  const refuse = (layer: Layer, path: string): ChangeRejection => ({
    requestId: request.requestId, entityType: request.entityType, operation: request.operation, entityId: request.entityId,
    code: 'LAYER_LOCKED', message: `the layer ${layer.name} is locked (ADR-0042)`, details: [{ path, problem: `layer ${layer.id} is locked` }],
    at: new Date().toISOString(),
  });
  const locked = (id: Uuid | undefined): Layer | null => {
    const layer = id === undefined ? undefined : layers.get(id);
    return layer?.locked === true ? layer : null;
  };
  if (request.entityType === 'object') {
    // The layer it goes to, then the layer it leaves; the path names the request's layerId (N2).
    const to = locked(request.operation === 'delete' ? undefined : request.data.layerId);
    if (to !== null) return refuse(to, '/data/layerId');
    const from = locked(objectLayer.get(request.entityId));
    return from !== null ? refuse(from, '') : null;
  }
  const stored = request.operation === 'create' ? null : locked(request.entityId);
  if (stored === null) return null;
  return request.operation === 'update' && onlyLockOrOrder(request.data, stored, request.source.plugin) ? null : refuse(stored, '');
}

/** ADR-0042 point 3: the update's result differs from the stored layer only in `locked` and `drawOrder` (an absent workspace and lock are kept; model rule 5). */
function onlyLockOrOrder(data: LayerContent, stored: Layer, requester: string): boolean {
  const view = (ws: string | undefined) => (ws === VIEW_WORKSPACE ? undefined : ws);
  const own = data.extensions?.[requester];
  const ownAfter = own === undefined ? stored.extensions?.[requester] : Object.keys(own).length === 0 ? undefined : own;
  return data.name === stored.name && data.visible === stored.visible && sameJson(data.label, stored.label)
    && (data.workspace === undefined || view(data.workspace) === view(stored.workspace))
    && sameJson(ownAfter, stored.extensions?.[requester]);
}

/** Equal JSON values, whatever the order of their keys. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** A shared value with change events. */
export function sharedState<T>(initial: T): SharedState<T> {
  let value = initial;
  const listeners = new Set<(v: T) => void>();
  return {
    get value() {
      return value;
    },
    set(next) {
      value = next;
      for (const l of [...listeners]) l(next);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** A fake map view with hooks to drive it from tests. */
export interface FakeMapView extends MapView {
  setViewport(viewport: Viewport): void;
  firePointer(event: MapPointerEvent): void;
  /** What `pick` returns from now on. */
  setPickResult(ids: readonly Uuid[]): void;
  /** Resolves the pending `pickPoint` or `dragObject`. */
  completeInteraction(position: Position | null): void;
  /** SDK 1.1.0: resolves the pending `draw` or `edit`; SDK 1.6.0: or `append`, with the whole line. */
  completeDrawing(geometry: Geometry | null): void;
  /**
   * SDK 1.3.0: the user's right click on the map while an interaction runs (`MapView`). It ends a
   * running `pickPoint` or `draw` with null, as the map view does before a press or with no point
   * left, and leaves `edit` and `dragObject` running. With nothing running it does nothing (the
   * shell's menu is not faked).
   */
  rightClick(): void;
  /** The kind of the running interaction, or null. */
  readonly runningInteraction: 'pickPoint' | 'dragObject' | `draw:${DrawKind}` | 'edit' | 'append' | null;
  /** Ids `edit` and, from SDK 1.6.0, `append` refuse with NotOnMapError, as for objects outside the area. */
  setNotDrawn(ids: readonly Uuid[]): void;
  /** SDK 1.6.0: ids `append` refuses with NotALineError, as for objects that are not a `LineString`. */
  setNotLines(ids: readonly Uuid[]): void;
  /** SDK 1.6.0: every `append` call, with its style. */
  readonly appendCalls: readonly { readonly id: Uuid; readonly style?: Style }[];
  /** `goTo` moves the fake's viewport (from SDK 1.1.0; the visible ring moves with the centre) and records the call. */
  readonly goToCalls: readonly { readonly center: Position; readonly resolution?: number }[];
  readonly centreOnCalls: readonly (readonly Uuid[])[];
  readonly zoomToCalls: readonly (readonly Uuid[])[];
  /** How often a `selection.set` was cut to 1 000 ids. */
  readonly selectionWarnings: number;
  /** Every `draw` and `edit` call, with its options. */
  readonly drawCalls: readonly { readonly kind: DrawKind; readonly style?: Style; readonly graphic?: MilSymbol }[];
  readonly editCalls: readonly { readonly id: Uuid; readonly style?: Style }[];
  /**
   * Where objects are, for `centreOn` and `zoomTo`: they centre the viewport on the mean of the
   * known positions (zoomTo also sets a resolution of 10 m per pixel), and report the others as
   * `missing`. Without positions, both only record the call and report nothing missing.
   */
  setObjectPositions(positions: { readonly [id: Uuid]: Position }): void;
  readonly overlayItems: readonly (readonly OverlayItem[])[];
  /** SDK 1.4.0: per `set` or `clear`, in the order of `overlayItems`, the reason the map view would draw nothing (`overlayProblem`), or `null`. */
  readonly overlayProblems: readonly (string | null)[];
  /** SDK 1.2.0: every fade list made with `createFadeList`, with the plugin that made it and its ids now. */
  readonly fadeLists: readonly { readonly plugin: string; readonly ids: readonly Uuid[] }[];
  /** SDK 1.2.0: the objects drawn faded: the union of all fade lists. */
  readonly faded: ReadonlySet<Uuid>;
  /** SDK 1.2.0: this map view as plugin `pluginId` sees it, so that its fade lists are recorded as that plugin's. */
  asPlugin(pluginId: string): MapView;
  /**
   * SDK 1.2.0: the map view's moment of a workspace switch (step 2 of `CurrentWorkspace`): the
   * running interaction ends with null, every fade list is cleared, and the selection is cleared
   * (ADR-0039, ADR-0040). Call it before the fake context's `switchWorkspace(id)`. The active layer
   * is left as it is.
   */
  switchWorkspace(): void;
}

export interface FakeMapViewOptions {
  readonly renderingMode?: RenderingMode;
  /** The configured projections; default EPSG:3857 and EPSG:3413. */
  readonly projections?: readonly string[];
  /** The background ids available; default none. */
  readonly backgrounds?: readonly string[];
  /** SDK 1.2.0: the plugin whose fade lists `createFadeList` makes; default `test-plugin`. See {@link FakeMapView.asPlugin}. */
  readonly pluginId?: string;
}

type Running = { readonly kind: NonNullable<FakeMapView['runningInteraction']>; readonly resolve: (value: unknown) => void };

export function createFakeMapView(options: FakeMapViewOptions = {}): FakeMapView {
  let viewport: Viewport = {
    center: [15, 62], resolution: 4891.97, projection: 'EPSG:3857',
    visibleArea: [[-10, 50], [40, 50], [40, 72], [-10, 72], [-10, 50]],
  };
  const projections = options.projections ?? ['EPSG:3857', 'EPSG:3413'];
  const backgrounds = options.backgrounds ?? [];
  let mapType: MapType = { projection: viewport.projection, background: backgrounds[0] ?? null };
  const viewportListeners = new Set<(v: Viewport) => void>();
  const mapTypeListeners = new Set<(m: MapType) => void>();
  const visibilityListeners = new Set<(layerId: Uuid, visible: boolean) => void>();
  const pointerListeners = new Set<(e: MapPointerEvent) => void>();
  const goToCalls: { center: Position; resolution?: number }[] = [];
  const centreOnCalls: (readonly Uuid[])[] = [];
  const zoomToCalls: (readonly Uuid[])[] = [];
  const overlayItems: (readonly OverlayItem[])[] = [];
  const overlayProblems: (string | null)[] = [];
  const visible = new Map<Uuid, boolean>();
  let notDrawn = new Set<Uuid>();
  let pickResult: readonly Uuid[] = [];
  const fadeLists: { readonly plugin: string; ids: readonly Uuid[] }[] = [];
  const makeFadeList = (plugin: string): FadeList => {
    const entry: { readonly plugin: string; ids: readonly Uuid[] } = { plugin, ids: [] };
    fadeLists.push(entry);
    return {
      set(ids) {
        entry.ids = [...ids];
      },
      clear() {
        entry.ids = [];
      },
    };
  };
  let selectionWarnings = 0;
  const drawCalls: { readonly kind: DrawKind; readonly style?: Style }[] = [];
  const editCalls: { readonly id: Uuid; readonly style?: Style }[] = [];
  const appendCalls: { readonly id: Uuid; readonly style?: Style }[] = [];
  let notLines = new Set<Uuid>();
  let positions: { readonly [id: Uuid]: Position } | null = null;
  let running: Running | null = null;
  // One interaction at a time: a new one ends the running one with null. SDK 1.2.0 (CR-0020): an
  // aborted signal ends its own interaction with null, and one aborted before starts nothing.
  const start = <T>(kind: Running['kind'], signal: AbortSignal | undefined) =>
    new Promise<T | null>((resolve) => {
      if (signal?.aborted === true) {
        resolve(null);
        return;
      }
      const before = running;
      const own: Running = { kind, resolve: resolve as (value: unknown) => void };
      running = own;
      before?.resolve(null);
      signal?.addEventListener(
        'abort',
        () => {
          if (running !== own) return;
          running = null;
          own.resolve(null);
        },
        { once: true },
      );
    });
  const finish = (accepts: (kind: Running['kind']) => boolean, value: unknown) => {
    const r = running;
    if (r === null || !accepts(r.kind)) return;
    running = null;
    r.resolve(value);
  };
  const setViewport = (next: Viewport) => {
    viewport = next;
    for (const l of [...viewportListeners]) l(next);
  };
  const moveTo = (ids: readonly Uuid[], resolution: number | undefined): { readonly missing: readonly Uuid[] } => {
    if (positions === null) return { missing: [] };
    const known = ids.flatMap((id) => (positions?.[id] === undefined ? [] : [positions[id]]));
    const missing = ids.filter((id) => positions?.[id] === undefined);
    if (known.length > 0) {
      const center: Position = [known.reduce((s, p) => s + p[0], 0) / known.length, known.reduce((s, p) => s + p[1], 0) / known.length];
      setViewport({ ...viewport, center, resolution: resolution ?? viewport.resolution });
    }
    return { missing };
  };
  const selection = sharedState<readonly Uuid[]>([]);
  const cappedSelection: SharedState<readonly Uuid[]> = {
    get value() {
      return selection.value;
    },
    set(next) {
      if (next.length > MAX_SELECTION) selectionWarnings++;
      selection.set(next.length > MAX_SELECTION ? next.slice(0, MAX_SELECTION) : next);
    },
    onChange: (listener) => selection.onChange(listener),
  };
  return {
    get viewport() {
      return viewport;
    },
    onViewportChange(listener) {
      viewportListeners.add(listener);
      return () => viewportListeners.delete(listener);
    },
    goTo(center, resolution) {
      goToCalls.push(resolution === undefined ? { center } : { center, resolution });
      const dLon = center[0] - viewport.center[0];
      const dLat = center[1] - viewport.center[1];
      const visibleArea = viewport.visibleArea.map(([lon, lat]) => [lon + dLon, Math.max(-90, Math.min(90, lat + dLat))] as Position);
      setViewport({ ...viewport, center, resolution: resolution ?? viewport.resolution, visibleArea });
    },
    onPointer(listener) {
      pointerListeners.add(listener);
      return () => pointerListeners.delete(listener);
    },
    pick: (_pixel: Pixel) => pickResult,
    pickPoint: (pickOptions) => start<Position>('pickPoint', pickOptions?.signal),
    dragObject: (_id: Uuid, dragOptions) => start<Position>('dragObject', dragOptions?.signal),
    draw(kind, drawOptions) {
      drawCalls.push({ kind, ...(drawOptions?.style === undefined ? {} : { style: drawOptions.style }), ...(drawOptions?.graphic === undefined ? {} : { graphic: drawOptions.graphic }) });
      return start<DrawnGeometry>(`draw:${kind}`, drawOptions?.signal);
    },
    edit(id, editOptions) {
      editCalls.push(editOptions?.style === undefined ? { id } : { id, style: editOptions.style });
      // An already aborted signal wins over NotOnMapError (InteractionOptions).
      if (notDrawn.has(id) && editOptions?.signal?.aborted !== true) return Promise.reject(new NotOnMapError(`not on the map: ${id}`));
      return start<Geometry>('edit', editOptions?.signal);
    },
    append(id, appendOptions) {
      appendCalls.push(appendOptions?.style === undefined ? { id } : { id, style: appendOptions.style });
      // An already aborted signal wins over the refusals (InteractionOptions).
      if (appendOptions?.signal?.aborted !== true) {
        if (notDrawn.has(id)) return Promise.reject(new NotOnMapError(`not on the map: ${id}`));
        if (notLines.has(id)) return Promise.reject(new NotALineError(`not a line: ${id}`));
      }
      return start<Geometry>('append', appendOptions?.signal).then((g) => {
        if (g !== null && g.type !== 'LineString') throw new Error(`append completes with a LineString, not a ${g.type}`);
        return g;
      });
    },
    createFadeList: () => makeFadeList(options.pluginId ?? 'test-plugin'),
    get fadeLists() {
      return fadeLists.map((f) => ({ plugin: f.plugin, ids: f.ids }));
    },
    get faded() {
      return new Set(fadeLists.flatMap((f) => f.ids));
    },
    asPlugin(pluginId) {
      const view = this as MapView;
      return new Proxy(view, { get: (target, key) => (key === 'createFadeList' ? () => makeFadeList(pluginId) : Reflect.get(target, key, target)) });
    },
    switchWorkspace() {
      finish(() => true, null);
      for (const f of fadeLists) f.ids = [];
      cappedSelection.set([]);
    },
    createOverlay(): Overlay {
      return {
        set(items) {
          overlayItems.push(items);
          overlayProblems.push(overlayProblem(items));
        },
        clear() {
          overlayItems.push([]);
          overlayProblems.push(null);
        },
      };
    },
    selection: cappedSelection,
    activeLayer: sharedState<Uuid | null>(null),
    setLayerVisible(layerId, value) {
      const before = visible.get(layerId) ?? true;
      visible.set(layerId, value);
      if (before !== value) for (const l of [...visibilityListeners]) l(layerId, value);
    },
    isLayerVisible: (layerId) => visible.get(layerId) ?? true,
    onLayerVisibilityChange(listener) {
      visibilityListeners.add(listener);
      return () => visibilityListeners.delete(listener);
    },
    centreOn(ids) {
      centreOnCalls.push([...ids]);
      return Promise.resolve(moveTo(ids, undefined));
    },
    zoomTo(ids) {
      zoomToCalls.push([...ids]);
      return Promise.resolve(moveTo(ids, 10));
    },
    get mapType() {
      return mapType;
    },
    onMapTypeChange(listener) {
      mapTypeListeners.add(listener);
      return () => mapTypeListeners.delete(listener);
    },
    setMapType(wanted) {
      const projection = projections.includes(wanted.projection) ? wanted.projection : mapType.projection;
      const background = wanted.background !== null && backgrounds.includes(wanted.background) ? wanted.background : (backgrounds[0] ?? null);
      mapType = { projection, background };
      if (projection !== viewport.projection) setViewport({ ...viewport, projection });
      for (const l of [...mapTypeListeners]) l(mapType);
      return mapType;
    },
    renderingMode: options.renderingMode ?? 'hardware',
    renderer: null,
    setViewport,
    firePointer(event) {
      for (const l of [...pointerListeners]) l(event);
    },
    setPickResult(ids) {
      pickResult = ids;
    },
    completeInteraction(position) {
      finish((k) => k === 'pickPoint' || k === 'dragObject', position);
    },
    completeDrawing(geometry) {
      finish((k) => k === 'edit' || k === 'append' || k.startsWith('draw:'), geometry);
    },
    rightClick() {
      finish((k) => k === 'pickPoint' || k.startsWith('draw:'), null);
    },
    get runningInteraction() {
      return running?.kind ?? null;
    },
    setNotDrawn(ids) {
      notDrawn = new Set(ids);
    },
    setNotLines(ids) {
      notLines = new Set(ids);
    },
    appendCalls,
    goToCalls,
    centreOnCalls,
    zoomToCalls,
    drawCalls,
    editCalls,
    setObjectPositions(next) {
      positions = next;
    },
    get selectionWarnings() {
      return selectionWarnings;
    },
    overlayItems,
    overlayProblems,
  };
}

/**
 * A fake objects panel service (`OBJECT_LIST`), for plugins that open it, e.g. `layer-panel`.
 *
 * @example
 * const list = createFakeObjectListService();
 * ctx.provideAs(OBJECT_LIST, list);
 * expect(list.opened).toEqual([layerId]);
 */
export function createFakeObjectListService(): ObjectListService & { readonly opened: readonly Uuid[] } {
  const opened: Uuid[] = [];
  return {
    open(layerId) {
      opened.push(layerId);
    },
    opened,
  };
}

const SIDC = { 'APP-6B': /^[A-Z0-9*-]{15}$/, 'APP-6D': /^1[0-2]\d{18}$/, 'APP-6E': /^1[34]\d{18}(\d{10})?$/, vessel: /^[0-2][0-6]\d{2}$/ } as const;

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const named = (codes: readonly number[], name: string) => codes.map((code) => ({ code, name }));

/**
 * SDK 1.4.0: the fake symbol service's ship-type groups of vessel symbols, every AIS type 0 to 99 in
 * one group, with placeholder colours (the real ones are `symbology`'s, ADR-0047 point 4).
 */
export const FAKE_VESSEL_GROUPS: readonly VesselGroup[] = [
  { id: 'cargo', label: 'Cargo', color: '#5A9E3A', shipTypes: named(range(70, 79), 'Cargo') },
  { id: 'tanker', label: 'Tanker', color: '#C23B30', shipTypes: named(range(80, 89), 'Tanker') },
  { id: 'passenger', label: 'Passenger', color: '#2F6FD0', shipTypes: named(range(60, 69), 'Passenger') },
  { id: 'fishing', label: 'Fishing', color: '#E08A2E', shipTypes: named([30], 'Fishing') },
  { id: 'pleasure', label: 'Pleasure craft', color: '#B248B8', shipTypes: [{ code: 36, name: 'Sailing' }, { code: 37, name: 'Pleasure craft' }] },
  { id: 'highSpeed', label: 'High-speed craft', color: '#D8B820', shipTypes: named(range(40, 49), 'High-speed craft') },
  { id: 'tugSpecial', label: 'Tug and special craft', color: '#2AA6A6', shipTypes: named([...range(31, 35), ...range(50, 59)], 'Special craft') },
  { id: 'other', label: 'Other', color: '#808080', shipTypes: named([...range(1, 29), 38, 39, ...range(90, 99)], 'Other') },
  { id: 'unknown', label: 'Unknown', color: '#D0D0D0', shipTypes: named([0], 'Not available') },
];

/**
 * SDK 1.4.0: the fake symbol service's tactical graphics, APP-6D only: a boundary, a phase line, an
 * axis of advance with a width point, and a sector range fan with distances and azimuths.
 */
export const FAKE_GRAPHICS: readonly GraphicCatalogEntry[] = [
  { standard: 'APP-6D', symbolSet: '25', entity: '110100', name: 'Boundary', path: ['Control Measure', 'Command and Control Lines'], kind: 'line', geometry: 'LineString',
    minPoints: 2, maxPoints: null, points: ['a point of the line, in order'], requiredModifiers: [], allowedModifiers: ['uniqueDesignation', 'uniqueDesignation1', 'country'], echelon: true },
  { standard: 'APP-6D', symbolSet: '25', entity: '140300', name: 'Phase Line', path: ['Control Measure', 'Maneuver Lines'], kind: 'line', geometry: 'LineString',
    minPoints: 2, maxPoints: null, points: ['a point of the line, in order'], requiredModifiers: [], allowedModifiers: ['uniqueDesignation'], echelon: false },
  { standard: 'APP-6D', symbolSet: '25', entity: '151403', name: 'Main Attack', path: ['Control Measure', 'Maneuver Areas', 'Axis of Advance'], kind: 'arrow', geometry: 'LineString',
    minPoints: 3, maxPoints: 50, points: ['the tip of the arrow', 'the axis, from the tip back to the tail', 'the width of the arrowhead'], requiredModifiers: [], allowedModifiers: ['uniqueDesignation', 'dtg', 'dtg1'], echelon: false },
  { standard: 'APP-6D', symbolSet: '25', entity: '242200', name: 'Weapon/Sensor Range fan, Sector', path: ['Control Measure', 'Fires Areas'], kind: 'points', geometry: 'MultiPoint',
    minPoints: 1, maxPoints: 1, points: ['the weapon or sensor'], requiredModifiers: ['distances', 'azimuths'], allowedModifiers: ['distances', 'azimuths', 'altitudeDepth'], echelon: false },
];

/**
 * SDK 1.5.0 part 3 (CR-0039 point 6): the fake symbol service's sensor report symbol, a placeholder
 * 12 by 12 pixel image anchored at its centre (no canvas in tests), the same object at every call.
 */
export const FAKE_SENSOR_REPORT_SYMBOL: SymbolImage = Object.freeze({ image: {} as ImageBitmap, width: 12, height: 12, anchor: [6, 6] as const });

/**
 * SDK 1.5.0 (CR-0039 part 2): a small SVG data URI, a black ring, for {@link fakeGraphicImage}.
 */
export const FAKE_GRAPHIC_IMAGE_SVG = 'data:image/svg+xml;base64,'
  + 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiI+PGNpcmNsZSBjeD0iOCIgY3k9IjgiIHI9IjYiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzAwMDAwMCIvPjwvc3ZnPg==';

/**
 * SDK 1.5.0 (CR-0039 part 2): a graphic image for tests, 16 by 16 pixels, upright unless `angle` is
 * given, with {@link FAKE_GRAPHIC_IMAGE_SVG}.
 */
export function fakeGraphicImage(position: Position, angle = 0): GraphicImage {
  return { position, svg: FAKE_GRAPHIC_IMAGE_SVG, width: 16, height: 16, angle };
}

/**
 * A fake symbol service: validates SIDCs like the model, renders placeholder images (no canvas in tests).
 * SDK 1.5.0 part 3 (CR-0039 point 6): `sensorReportSymbol` gives {@link FAKE_SENSOR_REPORT_SYMBOL}.
 * SDK 1.4.0 part 3: it validates and renders `vessel` codes, and `vesselGroups` gives
 * {@link FAKE_VESSEL_GROUPS}.
 * SDK 1.4.0: `graphicCatalog` gives {@link FAKE_GRAPHICS} for APP-6D (none for APP-6E), and
 * `renderGraphic` draws one black line through the points (closed for an `area`) with the unique
 * designation as a label at the first point. It refuses a graphic that is not in the catalogue, has too
 * few or too many points, or lacks a required amplifier, with the reason; `refuse(reason)` makes the
 * next calls refuse with that reason (`refuse(null)` stops it).
 * SDK 1.5.0 (CR-0039 part 2): its graphics carry no images, as before, until `withImages(images)`:
 * then every drawn graphic carries those images (`withImages(null)` stops it). Use
 * {@link fakeGraphicImage} for one.
 */
export function createFakeSymbolService(): SymbolService & {
  readonly renderCalls: number;
  /** SDK 1.4.0 part 5: every `render` request, in order, e.g. to check the size and `labels` a map view passes. */
  readonly renderRequests: readonly Parameters<SymbolService['render']>[0][];
  readonly renderGraphicCalls: number;
  refuse(reason: string | null): void;
  /** SDK 1.5.0: the images every drawn graphic carries from now on, or `null` for none (the default). */
  withImages(images: readonly GraphicImage[] | null): void;
} {
  let renderCalls = 0;
  const renderRequests: Parameters<SymbolService['render']>[0][] = [];
  let renderGraphicCalls = 0;
  let refusing: string | null = null;
  let images: readonly GraphicImage[] | null = null;
  return {
    get renderCalls() {
      return renderCalls;
    },
    renderRequests,
    get renderGraphicCalls() {
      return renderGraphicCalls;
    },
    withImages(list) {
      images = list === null ? null : [...list];
    },
    refuse(reason) {
      refusing = reason;
    },
    graphicCatalog: async (standard) => (standard === 'APP-6D' ? FAKE_GRAPHICS : []),
    renderGraphic: async (request): Promise<GraphicRendering> => {
      renderGraphicCalls++;
      if (refusing !== null) return { ok: false, reason: refusing };
      const entry = request.standard === 'APP-6D' ? FAKE_GRAPHICS.find((g) => g.symbolSet === request.sidc.slice(4, 6) && g.entity === request.sidc.slice(10, 16)) : undefined;
      if (entry === undefined) return { ok: false, reason: `not a graphic: ${request.sidc}` };
      const n = request.points.length;
      if (n < entry.minPoints || (entry.maxPoints !== null && n > entry.maxPoints)) return { ok: false, reason: `${entry.name} takes ${entry.minPoints} to ${entry.maxPoints ?? 'any number of'} points, not ${n}` };
      const missing = entry.requiredModifiers.find((m) => request.modifiers?.[m] === undefined);
      if (missing !== undefined) return { ok: false, reason: `${entry.name} needs ${missing}` };
      const first = request.points[0] as Position;
      const ring = entry.kind === 'area' && n > 2 ? [...request.points, first] : request.points;
      const coordinates = new Float64Array(ring.flatMap((p) => [p[0], p[1]]));
      const text = request.modifiers?.uniqueDesignation;
      return {
        ok: true,
        lines: [{ coordinates, color: '#000000', width: 2 }],
        fills: [],
        labels: text === undefined ? [] : [{ position: first, text, angle: 0, font: '12px sans-serif', color: '#000000', align: 'left' }],
        ...(images === null ? {} : { images }),
      };
    },
    render(request) {
      renderCalls++;
      renderRequests.push(request);
      return { image: {} as ImageBitmap, width: request.size, height: request.size, anchor: [request.size / 2, request.size / 2] };
    },
    validate(standard, sidc) {
      return SIDC[standard].test(sidc) ? { valid: true } : { valid: false, problem: `not a valid ${standard} SIDC` };
    },
    compose(p: SidcParts) {
      const version = p.standard === 'APP-6D' ? '10' : '13';
      return `${version}0${p.standardIdentity}${p.symbolSet}${p.status}${p.hqTaskForceDummy}${p.echelonMobility}${p.entity}0000`;
    },
    describe(standard, sidc) {
      return {
        standard, standardIdentity: sidc.slice(3, 4), symbolSet: sidc.slice(4, 6), status: sidc.slice(6, 7),
        hqTaskForceDummy: sidc.slice(7, 8), echelonMobility: sidc.slice(8, 10), entity: sidc.slice(10, 16),
      };
    },
    catalog: () => ({
      entities: [{ name: 'Infantry', symbolSet: '10', entity: '121100' }, { name: 'Armour', symbolSet: '10', entity: '120500' }],
      standardIdentities: [{ code: '3', name: 'Friend' }, { code: '6', name: 'Hostile' }, { code: '4', name: 'Neutral' }, { code: '1', name: 'Unknown' }],
      echelons: [{ code: '00', name: 'None' }, { code: '15', name: 'Company' }, { code: '16', name: 'Battalion' }],
    }),
    modifierNames: ['uniqueDesignation', 'higherFormation', 'additionalInformation', 'direction', 'speed'],
    vesselGroups: () => FAKE_VESSEL_GROUPS,
    sensorReportSymbol: () => FAKE_SENSOR_REPORT_SYMBOL,
  };
}

/** A fake coordinate service: formats and parses decimal degrees only (`60.5 N 15.25 E`). */
export function createFakeCoordinateService(): CoordinateService {
  return {
    format([lon, lat]) {
      return `${Math.abs(lat)} ${lat < 0 ? 'S' : 'N'} ${Math.abs(lon)} ${lon < 0 ? 'W' : 'E'}`;
    },
    parse(text) {
      const m = /^\s*([\d.]+)\s*([NS])\s+([\d.]+)\s*([EW])\s*$/i.exec(text);
      if (!m) return { error: 'expected e.g. "60.5 N 15.25 E"' };
      const lat = Number(m[1]) * (m[2]?.toUpperCase() === 'S' ? -1 : 1);
      const lon = Number(m[3]) * (m[4]?.toUpperCase() === 'W' ? -1 : 1);
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { error: 'out of range' };
      return { position: [lon, lat] };
    },
    chosenFormat: sharedState<CoordinateFormat>('dms'),
  };
}

/** One GetMap image, for {@link wmsGetMapUrl}. */
export interface WmsGetMap {
  /** The projection's code, e.g. `EPSG:3857`. */
  readonly projection: string;
  /**
   * `[minX, minY, maxX, maxY]` in the projection's own coordinates; longitude, latitude for
   * EPSG:4326 (ADR-0007). The helper swaps the axes where WMS 1.3.0 wants latitude first.
   */
  readonly bbox: readonly [number, number, number, number];
  /** Whole pixels, 1 to 4 096. */
  readonly width: number;
  readonly height: number;
}

/**
 * SDK 1.3.0 (CR-0023): the URL the map view sends for one image of a `wms` source, by the contract
 * in {@link WmsSource}: `SERVICE`, `REQUEST`, `VERSION`, `LAYERS`, `STYLES`, `FORMAT`,
 * `TRANSPARENT`, `CRS` or `SRS`, `BBOX`, `WIDTH`, `HEIGHT`, each once, in that order. For tests
 * on both sides: the map view's and a web part's tests compare their requests' **parameters** with
 * its parameters, not the strings, since the contract fixes no order (the map view may send them in
 * another); a server part's tests copy its query strings, and reorder them to show the order does
 * not matter. A web part does not build GetMap URLs; the map view does.
 *
 * @throws RangeError for no layers, a size outside 1 to 4 096, a box that is empty or not finite
 *
 * @example
 * wmsGetMapUrl(source, { projection: 'EPSG:4326', bbox: [10, 55, 20, 65], width: 256, height: 256 })
 * // …&CRS=EPSG%3A4326&BBOX=55%2C10%2C65%2C20&WIDTH=256&HEIGHT=256 for version 1.3.0
 */
export function wmsGetMapUrl(source: WmsSource, request: WmsGetMap): string {
  const { projection, bbox, width, height } = request;
  if (source.layers.length === 0) throw new RangeError('a wms source needs at least one layer');
  for (const [name, size] of [['width', width], ['height', height]] as const) {
    if (!Number.isInteger(size) || size < 1 || size > 4096) throw new RangeError(`${name} must be a whole number from 1 to 4096: ${String(size)}`);
  }
  const [minX, minY, maxX, maxY] = bbox;
  if (!bbox.every(Number.isFinite) || minX >= maxX || minY >= maxY) throw new RangeError(`not a box: ${bbox.join(',')}`);
  const latitudeFirst = source.version === '1.3.0' && projection === 'EPSG:4326';
  const box = latitudeFirst ? [minY, minX, maxY, maxX] : [minX, minY, maxX, maxY];
  const query = new URLSearchParams([
    ['SERVICE', 'WMS'],
    ['REQUEST', 'GetMap'],
    ['VERSION', source.version],
    ['LAYERS', source.layers.join(',')],
    ['STYLES', ''],
    ['FORMAT', source.format],
    ['TRANSPARENT', source.transparent === true ? 'TRUE' : 'FALSE'],
    [source.version === '1.3.0' ? 'CRS' : 'SRS', projection],
    ['BBOX', box.map(String).join(',')],
    ['WIDTH', String(width)],
    ['HEIGHT', String(height)],
  ]);
  return `${source.url}${source.url.includes('?') ? '&' : '?'}${query.toString()}`;
}

/**
 * A vector background provider for tests (ADR-0025), with a counter of `load()` calls.
 *
 * @example
 * const background = createFakeVectorBackground([{ layer: 'land', geometry: { type: 'Polygon', coordinates: [ring] } }]);
 * ctx.provideAs(BACKGROUND_MAP, background);
 */
export function createFakeVectorBackground(
  features: readonly VectorFeature[] = [],
  options: { readonly id?: string; readonly name?: string } = {},
): BackgroundMapProvider & { readonly loadCalls: number } {
  let loadCalls = 0;
  return {
    id: options.id ?? 'fake-vector',
    name: options.name ?? 'Fake vector background',
    projections: 'any',
    attribution: { text: 'Fake data' },
    source: {
      type: 'vector',
      background: '#c9dbe8',
      layers: [{ id: 'land', style: { fillColor: '#efeadf' } }, { id: 'coastline', style: { strokeColor: '#7c8c99', strokeWidth: 1 } }],
      load() {
        loadCalls++;
        return Promise.resolve({ features });
      },
    },
    get loadCalls() {
      return loadCalls;
    },
  };
}

export * from './look.ts';
