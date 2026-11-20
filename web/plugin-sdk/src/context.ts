/**
 * The plugin context and the entry module contract (S4 rec. 10, docs/plugins/sdk-v0.md and sdk-v1.md).
 *
 * @example
 * export default definePlugin({
 *   async activate(ctx) {
 *     const symbols = await ctx.services.get(SYMBOLS);
 *     ctx.ui.addControlPanel({ id: 'symbols', title: 'Symbols', component: SymbolPanel });
 *   },
 * });
 */
import type { SteppedFade } from './fade.ts';
import type { DisplaySettings } from './display.ts';
import type { ComponentType } from 'react';
import type { Unsubscribe } from './events.ts';
import type {
  ChangeEvent, ChangeRejection, ChangeRequest, ExternalRef, FieldValue, JsonValue, Layer, LayerContent, MapObject, MapObjectContent, Position, SecurityLabel,
  Timestamp, Uuid,
} from './model.ts';
import type { ReadonlyState, Services, Viewport } from './services.ts';
import type { CurrentWorkspace, Panel, PanelHandle, Setup, TopBarItem, WorkspaceInfo } from './workspace.ts';
import type { Actions } from './actions.ts';
import type { Objects } from './objects.ts';
import type { UserDocuments } from './userDocuments.ts';
import type { Theme } from './theme.ts';
import type { DeclaredField } from './fields.ts';
import { MAX_FIELD_SETS, type FieldSet, type RelationKind, type RelationLine } from './sets.ts';
import type { SymbolPalette } from './palettes.ts';
import type { WebCapabilities } from './time.ts';

/** The default export of a plugin's web entry module. */
export interface WebPlugin {
  /** Registers panels and services. May be async; the shell times it out after 10 s. */
  activate(ctx: PluginContext): void | Promise<void>;
  /**
   * SDK 1.4.0 (ADR-0044 point 3): the capabilities the web part implements, one object each, for
   * those its manifest declares in `capabilities` (owner, Q11: every declared capability is
   * implemented by at least one part, and a part implements only declared ones). The shell checks
   * it after `activate` and reports a mismatch to the server. `temporal`: the shell calls
   * `timeChanged` with the session's time once after `activate`, and at each change (ADR-0045).
   *
   * @example
   * export default definePlugin({
   *   activate(ctx) { ... },
   *   capabilities: { temporal: { timeChanged: (time) => history.show(time) } },
   * });
   */
  readonly capabilities?: WebCapabilities;
}

/** Marks the entry module's default export, with type checking. */
export function definePlugin(plugin: WebPlugin): WebPlugin {
  return plugin;
}

export interface PluginLog {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export type PluginState = 'OK' | 'DEGRADED' | 'FAILED';

/** The same shape as the Java SDK's status. */
export interface PluginStatus {
  readonly state: PluginState;
  readonly detail: string;
}

/** The web status is per browser session; it never affects the server's status or health. */
export interface StatusReporter {
  set(state: PluginState, detail: string): void;
}

export interface Notification {
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
}

export interface ControlPanel {
  readonly id: string;
  readonly title: string;
  /** Lower comes first; default 100. */
  readonly order?: number;
  readonly component: ComponentType;
  /**
   * SDK 1.2.0: the workspaces it appears in (ADR-0039 point 4); `'*'` for every workspace.
   * Default `['core.view']`, so what a plugin built before 1.2.0 adds appears in View only.
   */
  readonly workspaces?: readonly string[];
}

export interface MapPaneOverlay {
  readonly id: string;
  readonly position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /**
   * Lower comes first within a corner; default 100. SDK 1.3.0, documented: the shell stacks a
   * corner's overlays in one column, in `order`, with one gap between them, aligned to the corner's
   * side: top corners downwards, bottom corners upwards. So an icon at `top-right` with order 15
   * sits under `map-view-2d`'s controls (10) and above its rendering notice (20), on the same right
   * edge. The design pattern gives the tokens for an icon's frame over the map.
   */
  readonly order?: number;
  readonly component: ComponentType;
  /**
   * SDK 1.2.0: the workspaces it appears in (ADR-0039 point 4); `'*'` for every workspace.
   * Default `['core.view']`, so what a plugin built before 1.2.0 adds appears in View only.
   */
  readonly workspaces?: readonly string[];
}

/**
 * SDK 1.3.0 (CR-0023, ADR-0035): a plugin's own settings panel, shown **instead of** the generated
 * form in the plugin's entry of the Settings list, when the form is not enough (e.g. `basemap-wms`'
 * layer lists). The manifest's settings schema still defines, validates and defaults the settings.
 *
 * - The shell shows it only to users with `settings.admin`, inside its own frame for the entry
 *   (title, status), and keeps it mounted as long as the page lives, so its unsaved values survive
 *   switching entries and tabs, as the form's drafts do.
 * - The panel edits and saves the **whole** settings with {@link SettingsPanelProps.save}.
 * - Another admin's save reaches it as new {@link SettingsPanelProps.values}, also while it has
 *   unsaved changes. Then do as the generated form does: keep the edits, say that someone else
 *   changed the settings, and offer "Take their values".
 * - Data from its own server part comes from its own endpoints under `ctx.serverBase`, which
 *   require `settings.admin`.
 */
export interface SettingsPanel {
  readonly component: ComponentType<SettingsPanelProps>;
}

/** SDK 1.3.0: what the shell gives a {@link SettingsPanel}. */
export interface SettingsPanelProps {
  /**
   * The saved settings, as `ctx.settings`: new values after every accepted change, another admin's
   * too, also while the panel has unsaved changes. The panel decides what to do with them. Its own
   * accepted `save` arrives here too, and is not another admin's change.
   */
  readonly values: Settings;
  /**
   * Saves the complete values through `PUT /api/settings/plugins/{id}`. ECore validates them
   * against the schema and checks `settings.admin`: the result is `ok` with the values as saved,
   * or the problems. Rejects only on a transport failure or a refused permission.
   */
  save(values: Settings): Promise<SettingsSaveResult>;
  /** Whether the panel holds unsaved changes; the shell marks the entry as it does for the form. */
  markUnsaved(unsaved: boolean): void;
}

/** SDK 1.3.0: the answer to {@link SettingsPanelProps.save}. */
export type SettingsSaveResult =
  | { readonly ok: true; readonly values: Settings }
  | { readonly ok: false; readonly problems: readonly SettingsProblem[] };

/** SDK 1.3.0: one problem ECore found in saved settings. `path` is a JSON Pointer into the values, as ECore reports it. */
export interface SettingsProblem {
  readonly path: string;
  readonly problem: string;
}

/** The map view plugin's hold on the Map Pane. */
export interface MapViewMount {
  /** Called once with the Map Pane element; returns what undoes it. */
  mount(element: HTMLElement): () => void;
}

export interface Ui {
  /** A panel in the right pane (SDK v1). From 1.1.0 prefer {@link Ui.addPanel}, which this is the same as with `defaultPane: 'right'`. */
  addControlPanel(panel: ControlPanel): Unsubscribe;
  /** SDK 1.1.0: a panel with a default pane (ADR-0031 point 4). */
  addPanel(panel: Panel): PanelHandle;
  /** SDK 1.1.0: a small control on the right of the top bar (ADR-0031 point 6). */
  addTopBarItem(item: TopBarItem): Unsubscribe;
  addMapPaneOverlay(overlay: MapPaneOverlay): Unsubscribe;
  /** Only for the active `map-view` plugin. */
  setMapView(view: MapViewMount): void;
  /**
   * SDK 1.3.0 (CR-0023): the plugin's own settings panel, instead of the generated form; a second
   * call replaces the first. The `Unsubscribe` brings the generated form back.
   *
   * Required since the shell has it (CDA, T-073), as the 1.2.0 members became (W1; owner,
   * 2026-10-30, Q3): call it without `?.`.
   */
  setSettingsPanel(panel: SettingsPanel): Unsubscribe;
}

/** The live picture as one consistent state. */
export interface Snapshot {
  readonly layers: readonly Layer[];
  /** Empty for a subscription with `objects: false`. */
  readonly objects: readonly MapObject[];
  /** The sequence number the snapshot is consistent with; change batches continue after it. */
  readonly sequenceNo: number;
  /** Only with `objects: false`: layer id → the number of objects in it, kept by the server. */
  readonly objectCounts?: ObjectCounts;
}

/** Layer id → the number of objects in that layer, over the whole picture. */
export type ObjectCounts = { readonly [layerId: Uuid]: number };

/**
 * An area of interest (spike S3): a closed lon/lat ring with geodesic edges, a position on its
 * inside, and a margin the server adds. Never a lon/lat box, so it works at the poles and across
 * the antimeridian. The Java SDK's `Area` is the same.
 */
export interface Area {
  /** At least 4 positions, the first equal to the last. */
  readonly ring: readonly Position[];
  /** A position inside the ring; it decides which side is meant (around a pole, both sides are closed). */
  readonly inside: Position;
  /** Metres, or a share of the greatest distance from `inside` to the ring. Default: none. */
  readonly margin?: { readonly metres: number } | { readonly share: number };
}

/** The area of a viewport: its visible ring, inside on the centre's side, with a margin (default half, as spike S3 recommends). */
export function viewportArea(viewport: Viewport, share = 0.5): Area {
  return { ring: viewport.visibleArea, inside: viewport.center, margin: { share } };
}

/**
 * A group of objects drawn as one symbol when the area holds more than the subscriber's budget
 * (spike S3). The counts per layer let a browser hide a layer at once without asking the server.
 */
export interface Cluster {
  /** The cell's id; stable while the cluster level stays the same. */
  readonly cell: string;
  /** The mean position of the cluster's objects. */
  readonly position: Position;
  readonly count: number;
  /** Layer id → objects of that layer in the cluster. */
  readonly byLayer: { readonly [layerId: Uuid]: number };
  /**
   * Objects per standard identity: friend (with assumed friend), hostile (with suspect, joker and
   * faker), neutral, and unknown (with pending, and objects without a symbol).
   */
  readonly byIdentity: { readonly friend: number; readonly hostile: number; readonly neutral: number; readonly unknown: number };
}

/** Clusters for a subscription: a full set (on (re)subscription and after a snapshot), or the changes of one batch. */
export interface ClusterUpdate {
  /** The cluster level (cell size); a new level always comes as a full set. */
  readonly level: number;
  /** True: `upsert` is the complete set and replaces all clusters held. */
  readonly full: boolean;
  readonly upsert: readonly Cluster[];
  /** Cells whose clusters are gone. */
  readonly remove: readonly string[];
}

/** Objects entering and leaving a subscription's area: after the view moved, or when a change took an object out of the area. */
export interface AreaChange {
  readonly sequenceNo: number;
  /** Objects now in the area that the subscriber did not have. */
  readonly entered: readonly MapObject[];
  /** Ids of objects no longer in the area; drop them (they were not deleted). */
  readonly left: readonly Uuid[];
}

/**
 * Receives the live picture: first a snapshot, then batches of change events in sequence order.
 * A new snapshot may arrive at any time (after a reconnect or a gap) and replaces everything.
 *
 * With an `area` (spike S3):
 * - the snapshot holds the area's objects shown individually;
 * - a change event for an id the listener does not hold means "add"; a delete for such an id is ignored;
 * - `area` reports objects that entered or left, after every `changes` batch up to its
 *   `sequenceNo` was delivered;
 * - above the budget the rest arrives as `clusters`.
 *
 * A listener without these methods gets neither, and should subscribe without an area.
 */
export interface LivePictureListener {
  snapshot(snapshot: Snapshot): void;
  changes(batch: readonly ChangeEvent[]): void;
  /** Area mode only. */
  area?(change: AreaChange): void;
  /** Area mode only, when the area holds more objects than the budget. */
  clusters?(update: ClusterUpdate): void;
  /** `objects: false` only: the complete counts per layer, after every batch that changed them. */
  counts?(counts: ObjectCounts): void;
}

/**
 * What a subscription wants (spike S3). Each subscription has its own area; to move a fixed area,
 * unsubscribe and subscribe again.
 *
 * - Without `area`: the whole live picture, as in SDK v0. That is about 79 MB uncompressed at
 *   100 000 objects, so only for plugins that really need everything.
 * - `area: 'viewport'`: follows the map view; the shell adds the margin (half the screen's half
 *   diagonal) and asks again only when the view leaves the area it holds, or shrinks below a quarter of it.
 * - `area: Area`: a fixed area.
 * - `budget`: the most objects the subscriber wants individually; above it, clusters. The server
 *   caps it by its own setting. Without `budget`, the server's cap applies.
 * - `objects: false`: **no objects at all**, only the layers (snapshot and layer change events)
 *   and the object counts per layer (`snapshot.objectCounts`, then `counts`), kept by the server.
 *   For panels such as the layer list. `area` and `budget` are then ignored.
 *
 * Which to use (design pattern, section 6): the map view and plugins that act on the objects in
 * view subscribe with `area: 'viewport'`; plugins that need only layers and counts with
 * `objects: false`; nobody to the whole picture unless it is known to be small.
 */
export interface LivePictureOptions {
  readonly area?: 'viewport' | Area;
  readonly budget?: number;
  /** Default true. */
  readonly objects?: boolean;
  /**
   * SDK 1.2.0 (ADR-0039): the workspaces whose layers and objects it receives; `'*'` for every
   * one the user may see. **Without it, it follows the workspace shown** and gets a fresh snapshot
   * on each switch. A plugin that wants View's layers only, whatever is shown, passes
   * `['core.view']`; so does one whose code should not see another workspace, since a plugin's code
   * keeps running when its panels are unmounted. Each layer in a snapshot carries its `workspace`.
   * The server sends only what the user may see.
   */
  readonly workspaces?: readonly string[];
}

export interface LivePicture {
  subscribe(listener: LivePictureListener, options?: LivePictureOptions): Unsubscribe;
}

/** A change request as a plugin sends it: the shell fills in `requestId` and `source`. */
export type ChangeRequestContent = ChangeRequest extends infer R ? (R extends unknown ? Omit<R, 'requestId' | 'source'> : never) : never;

/** The answer from the object store. */
export type ChangeOutcome =
  | { readonly outcome: 'applied'; readonly event: ChangeEvent }
  | { readonly outcome: 'rejected'; readonly rejection: ChangeRejection };

/** Thrown (as a rejected promise) when no answer arrived: connection lost or timeout. The change may or may not have been applied. */
export class OutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutcomeUnknownError';
  }
}

export interface Changes {
  /** Resolves with the applied event or the rejection; rejects with {@link OutcomeUnknownError} only on transport failure or timeout. */
  submit(request: ChangeRequestContent): Promise<ChangeOutcome>;
}

/** Core permissions (ADR-0022). A plugin's own are `plugin.<id>.<name>`, declared in its manifest. */
export const PERMISSIONS = {
  /** Create, change and delete map objects. */
  objectsEdit: 'objects.edit',
  /** Create, rename, reorder and delete layers. */
  layersEdit: 'layers.edit',
  /** Change settings in the Settings tab (ADR-0031), and see the Monitor tab. */
  settingsAdmin: 'settings.admin',
} as const;

/**
 * The logged-in user of this browser session (ADR-0022), fixed for the session. A web part uses it
 * to show read-only panels; the server checks every change anyway.
 *
 * @example
 * const readOnly = !ctx.user.has(PERMISSIONS.objectsEdit);
 */
export interface User {
  /** The IAM's user id (OIDC `sub`), or `local` in the no-login mode. */
  readonly id: string;
  readonly name: string;
  readonly permissions: ReadonlySet<string>;
  /** True in the no-login mode, where the local user has every permission. */
  readonly noLogin: boolean;
  /** Whether the user has `permission`; always true in the no-login mode. */
  has(permission: string): boolean;
}

/** Default behaviour of a data type's objects (manifest `dataTypes[].defaults`); absent means never expires, not faded, never removed. */
export interface DataTypeDefaults {
  readonly expiresAfterSeconds?: number;
  readonly fadeWhenExpired?: boolean;
  readonly removeAfterExpirySeconds?: number;
}

/** An available data type (ADR-0023): `core.general`, or one a loaded plugin declares. */
export interface DataType {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** The declaring plugin, or null for `core.general`. */
  readonly declaredBy: string | null;
  /** The manifest's defaults. */
  readonly defaults: DataTypeDefaults;
  /**
   * SDK 1.5.0 (CR-0038 point 2): the full ids (`<plugin-id>.<id>`) of the field sets objects of
   * this type carry, in the manifest's order; absent or empty when there are none, and for
   * `core.general`. The object store adds them to a `core.symbol` object on a create and on a data
   * type change (model rule 21; symbols only in 1.5.0, owner NO A); an editor shows them as soon as the user chooses the type (`withDataTypeSets`).
   */
  readonly fieldSets?: readonly string[];
  /**
   * SDK 1.5.0 (CR-0038 point 6): `false` for a type users do not make by hand; editors leave it out
   * of their data type select (`choosableDataTypes`). Absent means `true`. The store does not check it.
   */
  readonly manual?: boolean;
  /**
   * SDK 1.5.0 (CR-0039 point 6; T-151, the owner's Q4): `true` when objects of this type are sensor
   * reports, which the map view draws with the symbology service's sensor report symbol
   * (`SymbolService.sensorReportSymbol`) instead of their APP-6 symbol. Absent means `false`. The store
   * does not check it.
   */
  readonly sensorReport?: boolean;
  /**
   * SDK 1.7.0 (CR-0042; T-192): the manifest's `fadeSetting`, a JSON Pointer into the declaring
   * plugin's settings to a stepped fade, e.g. `/detectionFade`; absent when it has none. ECore
   * gives it as declared.
   */
  readonly fadeSetting?: string;
  /**
   * SDK 1.7.0 (CR-0042; T-192): the stepped fade `fadeSetting` points to, from the declaring
   * plugin's **current** settings, while it is on and valid; absent otherwise. The shell resolves
   * it (`withSteppedFades`) and calls `ctx.onDataTypesChange` when it changes, without a reload.
   * The map view draws objects of this type at `fadeOpacity`, in place of the expiry fade.
   */
  readonly fade?: SteppedFade;
  /**
   * The **effective** behaviour: ECore's setting for this data type where one is configured, the
   * manifest's default otherwise (ADR-0023 point 7). It changes when a user with
   * `settings.admin` changes it; see `ctx.onDataTypesChange`.
   */
  readonly behaviour: DataTypeDefaults;
}

/** The behaviour of an object whose data type is not available (its plugin was removed): never expires (model rule 14). */
export const DEFAULT_BEHAVIOUR: DataTypeDefaults = {};

/**
 * When `object` expires (model rule 15), as an RFC 3339 timestamp, or null if it never does:
 * `time.expires`, otherwise `behaviour.expiresAfterSeconds` after `time.observed`. **SDK 1.5.0**
 * (CR-0038 point 9, the owner's Q3): an object without `time.observed` does not expire by its data
 * type, so a symbol placed by hand with an in plugin's data type stays; before, it expired after its
 * last change. Expiry happens without a change event, so compare with the clock.
 *
 * @example
 * const at = expiresAt(object, behaviourOf(object.dataType));
 * const faded = at !== null && Date.parse(at) <= Date.now() && behaviour.fadeWhenExpired === true;
 */
export function expiresAt(object: MapObject, behaviour: DataTypeDefaults): Timestamp | null {
  if (object.time?.expires !== undefined) return object.time.expires;
  if (behaviour.expiresAfterSeconds === undefined || object.time?.observed === undefined) return null;
  const from = Date.parse(object.time.observed);
  return new Date(from + behaviour.expiresAfterSeconds * 1000).toISOString();
}

/** The plugin's settings: the configured values, validated by ECore against the manifest's schema. */
export type Settings = { readonly [name: string]: JsonValue };

/** Everything the shell offers a plugin. */
export interface PluginContext {
  readonly pluginId: string;
  readonly log: PluginLog;
  readonly status: StatusReporter;
  /** The plugin's **current** settings, replaced as a whole when a user with `settings.admin` changes them (SDK v1). */
  readonly settings: Settings;
  /** Called with the complete new settings after each accepted change. */
  onSettingsChange(listener: (settings: Settings) => void): Unsubscribe;
  /** The logged-in user and their permissions (ADR-0022). */
  readonly user: User;
  /** The available data types, `core.general` first. The list is fixed while the page lives; their `behaviour` may change (ADR-0023). */
  readonly dataTypes: readonly DataType[];
  /** Called with the complete list after a user changed the behaviour of a data type. */
  onDataTypesChange(listener: (dataTypes: readonly DataType[]) => void): Unsubscribe;
  readonly services: Services;
  readonly ui: Ui;
  notify(notification: Notification): void;
  readonly livePicture: LivePicture;
  readonly changes: Changes;
  readonly defaultLabel: SecurityLabel;
  /** A new UUID v7. */
  newId(): Uuid;
  /**
   * `/api/plugins/{pluginId}/`, the base URL of the plugin's own endpoints.
   *
   * SDK 1.4.0: call them with `fetch`. The shell wraps the page's `fetch` to add the browser
   * session's header (`X-Emc2-Session`; owner, 2026-11-06), so ECore gives the endpoint that
   * session's time as `EndpointRequest.userTime()` (ADR-0045). A request made with
   * `XMLHttpRequest` carries no session, and its endpoint gets `now`.
   */
  readonly serverBase: string;
  /** `/plugins/{pluginId}/web/`, the base URL of the plugin's own built files, e.g. data files (SDK v1). */
  readonly webBase: string;
  /** SDK 1.1.0: the plugin's share of the user's setup (ADR-0031 point 5). */
  readonly setup: Setup;
  /** SDK 1.1.0: the shell's object and map actions, and its menu (ADR-0032). */
  readonly actions: Actions;
  /** SDK 1.1.0: objects by id and a layer's objects page by page, also those the browser does not hold. */
  readonly objects: Objects;
  /** SDK 1.1.0: the current user's own documents in this plugin's namespace (ADR-0027). */
  readonly userDocuments: UserDocuments;
  /** SDK 1.1.0: the current look and token values, for what a plugin draws on canvas (ADR-0034). */
  readonly theme: Theme;
  /**
   * SDK 1.2.0: the fields every loaded plugin declares (ADR-0038), in the order of the plugins and
   * their declarations; fixed while the page lives.
   */
  readonly declaredFields: readonly DeclaredField[];
  /** SDK 1.2.0: the workspace shown (ADR-0039). */
  readonly workspace: CurrentWorkspace;
  /** SDK 1.2.0: the workspaces this user may see, View first. */
  readonly workspaces: readonly WorkspaceInfo[];
  /**
   * SDK 1.4.0: the field sets every loaded plugin declares (ADR-0050), in the order of the plugins
   * and their declarations; fixed while the page lives. Required since the 1.4.0 freeze.
   */
  readonly fieldSets: readonly FieldSet[];
  /**
   * SDK 1.4.0: the relation kinds every loaded plugin declares (ADR-0051 point 2), with their lines;
   * fixed while the page lives. Required since the 1.4.0 freeze.
   */
  readonly relationKinds: readonly RelationKind[];
  /**
   * SDK 1.6.0 (CR-0041 part C; T-181): each declared kind's line as it is drawn now, its colour
   * resolved from the declaring plugin's settings (`strokeColorSetting`; `resolveRelationLines`).
   * The shell changes it when an admin changes such a setting, so the lines follow without a reload;
   * `relationKinds` stays as declared. Required since the 1.6.0 freeze.
   *
   * @example
   * const line = ctx.relationLines.value[kind];
   */
  readonly relationLines: ReadonlyState<Readonly<Record<string, RelationLine>>>;
  /**
   * SDK 1.6.0 (CR-0041 part G; T-156): the symbol palettes every enabled plugin declares, with a web
   * part or not (as `dataTypes`), in the plugins' order and their declarations' order; fixed while
   * the page lives. Required since the 1.6.0 freeze.
   */
  readonly symbolPalettes: readonly SymbolPalette[];
  /**
   * SDK 1.4.0 part 5 (ADR-0046, ADR-0052; CR-0030 part 5, CR-0031 section 3): the user's display
   * settings, the same in every workspace and browser, with the defaults already applied; plugins
   * read them and are told at each change, and never write them (ADR-0046 point 5). `map-view-2d`
   * passes the size and the labels to `render` and draws the name, the speed vector and, per
   * `relations`, the relation lines (owner, Q13). Required since the 1.4.0 freeze (CR-0030,
   * question 5).
   *
   * @example
   * const d = ctx.display.value;
   * ctx.display.onChange(() => redraw());
   */
  readonly display: ReadonlyState<DisplaySettings>;
  /**
   * SDK 1.5.0 part 4 (CR-0039 point 9; T-171): each security policy's classifications, lowest first,
   * from the same configuration as Settings › Layers and the Java `context.classifications()`
   * (ADR-0031 point 3); fixed while the page lives. Find a policy's order with
   * {@link classificationOrder}, which matches its name ignoring case. Labels stay cosmetic (owner,
   * 2026-11-10). Required since the 1.5.0 freeze (the owner's Q49 A); the shell gives the NATO order
   * when the server's configuration has none.
   *
   * @example
   * const order = classificationOrder(ctx.classifications, ctx.defaultLabel.policyIdentifier.name);
   */
  readonly classifications: ClassificationOrders;
}

/** SDK 1.5.0 part 4: each policy's name with its classifications, lowest first. */
export type ClassificationOrders = Readonly<Record<string, readonly string[]>>;

/**
 * SDK 1.5.0 part 4 (CR-0039 point 9): the policy's classifications, lowest first, its name matched
 * ignoring case, as the Java SDK's `Classifications.order` does (a policy set as an environment
 * variable arrives in lower case); empty when it has no order. Classifications match exactly.
 *
 * @example
 * classificationOrder({ NATO: ['UNCLASSIFIED', 'RESTRICTED'] }, 'nato'); // ['UNCLASSIFIED', 'RESTRICTED']
 */
export function classificationOrder(orders: ClassificationOrders, policy: string): readonly string[] {
  const wanted = policy.toLowerCase();
  for (const [name, order] of Object.entries(orders)) {
    if (name.toLowerCase() === wanted) return order;
  }
  return [];
}

/** SDK 1.5.0 part 4: the NATO order, lowest first, the default configuration (the Java `Classifications.NATO`). */
export const NATO_CLASSIFICATIONS: readonly string[] = Object.freeze(['UNCLASSIFIED', 'RESTRICTED', 'CONFIDENTIAL', 'SECRET', 'COSMIC TOP SECRET']);

/** Helpers to build change requests. */
export const changeRequests = {
  /** With `externalRef`, the object's identity in an external system (model rule 16). */
  createObject: (entityId: Uuid, data: MapObjectContent, externalRef?: ExternalRef): ChangeRequestContent =>
    externalRef === undefined
      ? { entityType: 'object', operation: 'create', entityId, data }
      : { entityType: 'object', operation: 'create', entityId, data, externalRef },
  updateObject: (object: MapObject, data: MapObjectContent): ChangeRequestContent => ({
    entityType: 'object', operation: 'update', entityId: object.id, baseVersion: object.version, data,
  }),
  deleteObject: (object: MapObject): ChangeRequestContent => ({ entityType: 'object', operation: 'delete', entityId: object.id, baseVersion: object.version }),
  createLayer: (entityId: Uuid, data: LayerContent): ChangeRequestContent => ({ entityType: 'layer', operation: 'create', entityId, data }),
  updateLayer: (layer: Layer, data: LayerContent): ChangeRequestContent => ({
    entityType: 'layer', operation: 'update', entityId: layer.id, baseVersion: layer.version, data,
  }),
  deleteLayer: (layer: Layer): ChangeRequestContent => ({ entityType: 'layer', operation: 'delete', entityId: layer.id, baseVersion: layer.version }),
  /**
   * SDK 1.2.0: `request` with the declared fields to set (ADR-0038), so that `createObject` and
   * `updateObject` keep their arguments. An empty list gives the request without `fields`. At most
   * 64; each field once.
   *
   * @throws Error for anything but the create or update of an object
   */
  withFields: (request: ChangeRequestContent, fields: readonly FieldValue[]): ChangeRequestContent => {
    if (request.entityType !== 'object' || request.operation === 'delete') throw new Error('only the create and update of an object carry declared fields');
    if (fields.length > 64) throw new Error(`at most 64 declared fields: ${fields.length}`);
    // JSON has no NaN or Infinity: such a value would go out as null and remove the field.
    const bad = fields.find((f) => typeof f.value === 'number' && !Number.isFinite(f.value));
    if (bad !== undefined) throw new Error(`${bad.plugin}.${bad.name} is not a number; check fieldProblems first`);
    const { fields: _old, ...rest } = request as typeof request & { readonly fields?: readonly FieldValue[] };
    return (fields.length === 0 ? rest : { ...rest, fields: [...fields] }) as ChangeRequestContent;
  },
  /**
   * SDK 1.4.0 (ADR-0050): `request` with the field sets `setIds` added to its content's
   * `fieldSets`, after those it lists, each once. On update the store keeps the stored sets anyway
   * (rule 5's third exception), so list only the sets to add. An empty list gives the request as it is.
   *
   * @throws Error for anything but the create or update of an object, or more than 64 sets
   *
   * @example
   * await ctx.changes.submit(changeRequests.withFieldSets(changeRequests.updateObject(object, content), ['cot.unit']));
   */
  withFieldSets: (request: ChangeRequestContent, setIds: readonly string[]): ChangeRequestContent => {
    if (request.entityType !== 'object' || request.operation === 'delete') throw new Error('only the create and update of an object carry field sets');
    if (setIds.length === 0) return request;
    const data = request.data as MapObjectContent;
    const sets = [...new Set([...(data.fieldSets ?? []), ...setIds])];
    if (sets.length > MAX_FIELD_SETS) throw new Error(`at most ${MAX_FIELD_SETS} field sets: ${sets.length}`);
    return { ...request, data: { ...data, fieldSets: sets } } as ChangeRequestContent;
  },
};
