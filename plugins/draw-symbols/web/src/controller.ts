// The plugin's logic: follows the live picture and the map's selection (the map view selects, ADR-0032),
// runs the map interactions (place, drag) and turns the user's actions into change requests (ADR-0005). The React
// components only render its state and call it. No method of the controller rejects: unexpected
// errors are logged and shown as a notification.
import { changedFields, changeRequests, choosableDataTypes, fieldProblems, GENERAL_DATA_TYPE, OutcomeUnknownError, PERMISSIONS, sameField, VIEW_WORKSPACE, withDataTypeSets } from '@emc2/plugin-sdk';
import type {
  ChangeEvent, ChangeOutcome, ChangeRejection, ChangeRequestContent, DataType, DeclaredField, FieldSet, FieldValue, Layer, MapObject, MapObjectContent, MapView,
  MilSymbol, PluginContext, Position, SymbolPalette, Unsubscribe, UserDocuments, Uuid,
} from '@emc2/plugin-sdk';
import { coreOf, isEditableSymbol, isInsideRing, newSymbolContent, pointOf, sameJson, validPosition, withPosition } from './content.ts';
import { keepDataType, readKeptDataType } from './keptChoice.ts';
import { readSettings } from './settings.ts';
import type { DrawSettings } from './settings.ts';
import type { ObjectTracker, TrackerChange } from './tracker.ts';
import { AreaWatch } from './watch.ts';

/** At most this many change requests wait (sent or queued) at once. The server refuses more than 100 per browser. */
export const MAX_WAITING = 20;
export const NO_LAYER_HINT = 'Select or create a layer in the layer panel';
/** Shown when the user lacks `objects.edit` (brief, function 11). */
export const READ_ONLY_HINT = 'You may not edit objects';
/** The hint in a declared workspace: View keeps {@link READ_ONLY_HINT}. */
export const readOnlyHintIn = (workspace: { readonly id: string; readonly name: string }): string =>
  workspace.id === VIEW_WORKSPACE ? READ_ONLY_HINT : `${READ_ONLY_HINT} in ${workspace.name}`;
export const NOT_READ_HINT = 'Could not read the symbol, try again.';
/**
 * Two clicks closer in time than this are one placement (a double-click). It is the double-click
 * time the map view uses, which is OpenLayers' (250 ms in the version shipped, ol 10.10.0,
 * `MapBrowserEventHandler`; owner decision of 2026-10-10, draw-symbols brief function 2). The map view
 * does not zoom on a double-click while placing.
 */
export const DOUBLE_CLICK_MS = 250;
/**
 * How long the area round a symbol, and the record of the symbol whose panel was open, outlive the selection. The map view empties the
 * selection when it hears that the selected symbol was deleted, and this plugin's own channel (opened later) may bring the same news
 * a moment after: ending at once would lose the notice "deleted by someone else".
 */
export const WATCH_GRACE_MS = 2000;

/** Everything the panels render. Immutable: every change makes a new value. */
export interface DrawState {
  readonly layers: readonly Layer[];
  /** The active layer, if it exists. */
  readonly activeLayer: Uuid | null;
  readonly placing: boolean;
  readonly canPlace: boolean;
  /** Why placing is impossible because of the permission or the layers, or null. */
  readonly placeHint: string | null;
  /** The user may change objects in the workspace shown (its edit permission, or `objects.edit` in View). */
  readonly canEdit: boolean;
  /** The values of declared fields that go with each symbol placed (brief, function 21): kept here, until the user changes them or reloads the page. */
  readonly placeFields: readonly FieldValue[];
  /** The field sets added for the symbols about to be placed (brief, function 27): they go with each create, as long as the panel lives. */
  readonly placeSets: readonly string[];
  /** The user lacks the workspace's edit permission, or the selected symbol is not in the workspace: placing, editing and dragging are off (brief, functions 11, 17 and 18). */
  readonly readOnly: boolean;
  /** Why it is read only: the permission's hint, that the selected symbol is not in the workspace (function 17), or that its layer is locked (function 25). */
  readonly readOnlyHint: string;
  /** The selected symbol is in none of the workspace's layers (another plugin put it into the selection): shown read only, never dragged. */
  readonly foreign: boolean;
  /** The selected symbol's layer is locked (SDK 1.3.0, ADR-0042): shown read only, never dragged, and the store would refuse a change. */
  readonly locked: boolean;
  /** The settings now in force. */
  readonly settings: DrawSettings;
  /** The available data types, `core.general` first (ADR-0023). */
  readonly dataTypes: readonly DataType[];
  /** The data type new symbols get: the choice kept in this browser if it is available, else the setting, else `core.general`. */
  readonly dataType: string;
  /** How many objects are selected (the map view's selection, shared by all plugins). */
  readonly selectionCount: number;
  /** The selected object when exactly one is selected. */
  readonly selectedId: Uuid | null;
  /** The selected object, if it is known: held by this plugin (in view) or read by id from the server. */
  readonly selected: MapObject | null;
  /** This plugin holds the selected object (the area subscription round it delivered it), so it follows the live picture. False: it was read from the server. */
  readonly held: boolean;
  /** The selected object is inside the map view's visible area. False: the panel says "Not in view" and nothing can be dragged. */
  readonly inView: boolean;
  /** Reading the selected object by id, when this plugin does not hold it. */
  readonly readStatus: 'idle' | 'loading' | 'missing' | 'failed';
  /** Objects with a change request waiting for the server. */
  readonly pendingIds: ReadonlySet<Uuid>;
}

type Sent = { readonly kind: 'applied'; readonly event: ChangeEvent } | { readonly kind: 'rejected'; readonly rejection: ChangeRejection } | { readonly kind: 'unknown' };

/** A map interaction this plugin waits for, with what ends it. */
interface Armed {
  readonly key: string;
  readonly abort: AbortController;
  /** The workspace it was asked for in: a null that comes after the workspace changed is the switch's, not Escape. */
  readonly workspace: string;
}

export class DrawController {
  private readonly listeners = new Set<() => void>();
  private readonly cleanup: Unsubscribe[] = [];
  private pickerSymbol: MilSymbol | null = null;
  /**
   * The values of declared fields for the symbols about to be placed (function 21). They are kept here and not in the panel, so that a
   * switch that mounts the panel again keeps them; they are the same in every workspace and not kept over a reload.
   */
  private placeFields: readonly FieldValue[] = [];
  /** The ids of the field sets added for the symbols about to be placed (function 27); kept like {@link placeFields}, and not pruned when the data type changes (ADR-0050 point 8). */
  private placeSets: readonly string[] = [];
  /** The data type the values to place were last pruned for: they are pruned when the data type changes, not on every refresh, so that a field the user adds with the "+" stays. */
  private prunedFor: string | null = null;
  private placing = false;
  /**
   * The map interaction we are waiting for, with the `AbortController` that ends it (CR-0020, SDK 1.2.0): the result of one this
   * plugin ended is not used, and neither is the null of one the map view ended at a workspace switch.
   */
  private armed: Armed | null = null;
  /** The workspace whose switch has ended (its last step, `ctx.workspace.onChange`): nothing is armed between a switch's first step and this. */
  private settledWorkspace: string;
  /** Placing was on at a switch and waits for an active layer in the new workspace (function 19). */
  private waitsForLayer = false;
  /**
   * The selected object for which the early drag (armed before the object is known) was armed or given up: it is armed once per
   * selection (T-066), so that it cannot take the map again and again from another plugin's drag, such as `draw-shapes`'.
   */
  private earlyFor: Uuid | null = null;
  private failedKey: string | null = null;
  /**
   * A drag that ended with null (Escape, another interaction, or an object the map does not draw) is not asked
   * for again until something that could change the answer happens: another selection, a change of the
   * objects we hold, of the view or of a layer's visibility. Without this, a selected symbol the map does not
   * draw makes `dragObject` resolve null at once, again and again (found by map-view-2d, T-054 part D).
   */
  private suspendedKey: string | null = null;
  /** The symbol as we held it when its drag was suspended (null: we did not hold it): a change of it, or its arrival, resumes the drag. */
  private suspendedObject: MapObject | undefined;
  private waiting = 0;
  private readonly pendingCount = new Map<Uuid, number>();
  private readonly chains = new Map<Uuid, Promise<void>>();
  /** The selected object this plugin does not hold, read by id from the server (brief, function 14). */
  private read: { readonly id: Uuid; readonly status: 'loading' | 'missing' | 'failed' | 'done'; readonly object?: MapObject } | null = null;
  /** Objects the user has already been told are gone, so their disappearance from the live picture is not announced again. */
  private readonly announcedGone = new Set<Uuid>();
  /** The symbol whose panel is open, by our own record of the selection: it stays, to the end of the step, when the map view clears the selection because the object was deleted. */
  private watchedId: Uuid | null = null;
  /** When the last symbol was placed in this placing session, to merge a double-click into one placement. */
  private lastPlacedAt: number | null = null;
  private settings: DrawSettings;
  private dataTypes: readonly DataType[];
  /** The user's choice of data type for new symbols, kept in this browser. */
  private kept: string | null = readKeptDataType();
  private current: DrawState;
  /** The selected symbol as it was last shown: while it is read again (it left the area, or the connection came back), the panel keeps showing it instead of closing under the user's hands. */
  private lastShown: MapObject | null = null;
  /** The small area round the selected symbol: the plugin's only subscription to objects. */
  private readonly areaWatch: AreaWatch;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ctx: PluginContext,
    private readonly tracker: ObjectTracker,
    private readonly map: MapView,
    /** A monotonic clock in milliseconds; tests replace it. */
    private readonly now: () => number = () => performance.now(),
  ) {
    this.settledWorkspace = this.workspaceId();
    this.areaWatch = new AreaWatch(ctx.livePicture, tracker, () => {
      this.onAreaSnapshot();
    });
    this.dataTypes = ctx.dataTypes;
    this.settings = this.applySettings(ctx.settings);
    this.current = this.build();
    this.cleanup.push(
      tracker.onChange((change) => {
        this.onTrackerChange(change);
      }),
      ctx.onDataTypesChange((dataTypes) => {
        this.dataTypes = dataTypes;
        this.refresh();
      }),
      ctx.onSettingsChange((raw) => {
        this.settings = this.applySettings(raw);
        this.refresh();
      }),
      map.selection.onChange(() => {
        const ids = this.map.selection.value;
        if (ids.length === 1) {
          this.watchedId = ids[0] ?? null;
        } else {
          this.endLater();
        }
        this.refresh();
      }),
      map.activeLayer.onChange(() => {
        this.refresh();
      }),
      map.onViewportChange(() => {
        // The selected symbol may have come into view or gone out of it, and a drag that ended with null may be asked for again
        // (not the early drag of an object that is not known yet: it is armed once per selection, see armInteraction).
        this.suspendedKey = null;
        if (this.current.selectedId !== null) this.refresh();
      }),
      map.onLayerVisibilityChange(() => {
        this.resumeDrag();
      }),
    );
    this.cleanup.push(
      ctx.workspace.onChange(() => {
        this.onWorkspaceChanged();
      }),
    );
    this.armInteraction();
  }

  /** The id of the workspace shown (rule 7 of the M3 briefs). */
  private workspaceId(): string {
    return this.ctx.workspace.current.id;
  }

  /** The permission to change objects in the workspace shown: its `editPermission`, or `objects.edit` in View (ADR-0022, ADR-0039). The server checks it anyway. */
  private get canEdit(): boolean {
    return this.ctx.user.has(this.ctx.workspace.current.editPermission ?? PERMISSIONS.objectsEdit);
  }

  private get permissionHint(): string {
    return readOnlyHintIn(this.ctx.workspace.current);
  }

  // For useSyncExternalStore.
  readonly subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): DrawState => this.current;

  /** Reads the settings, reports a bad value (log and status), and returns what to use. */
  private applySettings(raw: PluginContext['settings']): DrawSettings {
    const { settings, problems } = readSettings(raw);
    for (const problem of problems) this.ctx.log.warn(problem);
    if (problems.length > 0) this.ctx.status.set('DEGRADED', problems.join('; '));
    else this.ctx.status.set('OK', 'ready');
    return settings;
  }

  /** Chooses the data type of new symbols and keeps the choice in this browser (brief, function 1). */
  setDataType(id: string): void {
    if (!this.dataTypes.some((t) => t.id === id)) return;
    this.kept = id;
    if (!keepDataType(id)) this.ctx.log.warn('the data type choice could not be kept in this browser');
    this.refresh();
  }

  dispose(): void {
    for (const undo of this.cleanup.splice(0)) undo();
    if (this.graceTimer !== null) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    this.areaWatch.stop();
    this.endArmed();
  }

  /**
   * A workspace switch has ended (its last step; ADR-0039 point 3). The map view has ended its interactions and cleared the selection
   * at its moment, so the symbol's panel is gone and its area ends now, not after the grace period (nothing was deleted). Placing, if
   * it was on, starts again in the new workspace's active layer, or waits for one.
   */
  private onWorkspaceChanged(): void {
    this.settledWorkspace = this.workspaceId();
    this.endArmed();
    if (this.map.selection.value.length !== 1) {
      if (this.graceTimer !== null) clearTimeout(this.graceTimer);
      this.graceTimer = null;
      this.watchedId = null;
      this.areaWatch.stop();
    }
    this.refresh();
  }

  /**
   * The selection ended: after {@link WATCH_GRACE_MS} (if nothing is selected again by then) the record of the symbol is forgotten and
   * the area ends. Until then a deletion that reaches this plugin is still announced, and the same symbol selected again keeps its area.
   */
  private endLater(): void {
    if (this.graceTimer !== null) return;
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      if (this.map.selection.value.length === 1) return;
      this.watchedId = null;
      this.areaWatch.stop();
    }, WATCH_GRACE_MS);
  }

  /** The symbol the picker shows, or null if it has none (nothing chosen, or an invalid SIDC). Placing stops without one. */
  setPickerSymbol(symbol: MilSymbol | null): void {
    if (symbol?.standard === this.pickerSymbol?.standard && symbol?.sidc === this.pickerSymbol?.sidc) return;
    this.pickerSymbol = symbol;
    this.refresh();
  }

  /** The user changes the declared fields' values of the symbols about to be placed (brief, function 21). */
  setPlaceFields(values: readonly FieldValue[]): void {
    this.placeFields = values;
    this.refresh();
  }

  /** The user adds a field set to the symbols about to be placed (brief, function 27). */
  addPlaceSet(setId: string): void {
    this.placeSets = [...this.placeSets, setId];
    this.refresh();
  }

  /** Starts or stops placing (brief, function 2): while on, every click on the map places the picker's symbol. */
  setPlacing(on: boolean): void {
    if ((on && !this.current.canPlace) || this.placing === on) return;
    this.placing = on;
    this.refresh();
  }

  /** Selects one symbol (the Edit action, brief function 14): the map view's shared selection, which every plugin follows. */
  select(id: Uuid): void {
    this.watchedId = id;
    this.map.selection.set([id]);
  }

  /** Reads the selected symbol by id again, after the read failed (the panel's "Try again"). */
  retryRead(): void {
    if (this.read?.status === 'failed') {
      this.read = null;
      this.refresh();
    }
  }

  /** The fields the loaded plugins declare (ADR-0038). */
  get declaredFields(): readonly DeclaredField[] {
    return this.ctx.declaredFields;
  }

  /** The symbol palettes the enabled plugins declare (SDK 1.6.0, brief function 31). */
  get symbolPalettes(): readonly SymbolPalette[] {
    return this.ctx.symbolPalettes;
  }

  /** Writes a warning to the plugin's log. */
  warn(message: string): void {
    this.ctx.log.warn(message);
  }

  /** The user's own documents of this plugin: the chosen palette is kept there (brief, function 31, P2). */
  get userDocuments(): UserDocuments {
    return this.ctx.userDocuments;
  }

  /** The field sets the loaded plugins declare (SDK 1.4.0, ADR-0050). */
  get fieldSets(): readonly FieldSet[] {
    return this.ctx.fieldSets;
  }

  /** This plugin's id, whose own declared fields count as editable here. */
  get pluginId(): string {
    return this.ctx.pluginId;
  }

  /**
   * Changes one object: `change` gets the core content of the latest state and returns the new
   * content, and `fields` are the declared fields to set (only the ones the user changed, so that
   * another user's newer values are not overwritten, ADR-0038). Nothing is sent if the content is
   * equal and there are no fields. `sets` are field sets to add (SDK 1.4.0, brief function 27); one the object has is not sent
   * again. True if applied or nothing to do; false if the server refused it or did not answer (the user has been told).
   */
  update(id: Uuid, what: string, change: (core: MapObjectContent) => MapObjectContent, quiet = false, fields: readonly FieldValue[] = [], sets: readonly string[] = []): Promise<boolean> {
    if (!this.canEdit) return Promise.resolve(this.refuseReadOnly());
    return this.enqueue(id, async () => {
      let latest = this.tracker.get(id);
      const wasHeld = latest !== undefined;
      if (latest === undefined) {
        // Not in view: the newest version comes from the server, fetched again before every commit (brief, function 14).
        const got = await this.readById(id);
        if (got.kind === 'failed') {
          this.ctx.notify({ severity: 'warning', message: NOT_READ_HINT });
          return false;
        }
        if (got.kind === 'missing') {
          this.announcedGone.add(id);
          this.ctx.notify({ severity: 'warning', message: 'The symbol was deleted by someone else, so the change was not made.' });
          return false;
        }
        latest = got.object;
      }
      if (!isEditableSymbol(latest)) {
        if (!quiet) this.ctx.notify({ severity: 'warning', message: 'This object is not a point symbol and cannot be edited here.' });
        return false;
      }
      const layerOfSymbol = this.tracker.layers.find((l) => l.id === latest.layerId);
      if (layerOfSymbol === undefined) {
        if (!quiet) this.ctx.notify({ severity: 'warning', message: `This symbol is not in ${this.ctx.workspace.current.name}.` });
        return false;
      }
      if (layerOfSymbol.locked === true) {
        if (!quiet) this.ctx.notify({ severity: 'warning', message: `Layer "${layerOfSymbol.name}" is locked, so the change was not made.` });
        return false; // the store would refuse it (function 25): nothing is sent
      }
      const core = coreOf(latest);
      const next = change(core);
      const newSets = sets.filter((setId) => latest.fieldSets?.includes(setId) !== true);
      if (fields.length === 0 && newSets.length === 0 && sameJson(core, next)) return true;
      const request = changeRequests.withFieldSets(changeRequests.updateObject(latest, next), newSets);
      const sent = await this.submit(fields.length === 0 ? request : changeRequests.withFields(request, fields));
      if (sent.kind === 'rejected' && sent.rejection.code === 'ENTITY_NOT_FOUND') {
        this.announcedGone.add(id);
        this.ctx.notify({ severity: 'warning', message: 'The symbol was deleted by someone else, so the change was not made.' });
        return false;
      }
      return this.report(sent, what, wasHeld ? undefined : id);
    });
  }

  /** When the data type changes, keeps the values of the symbols about to be placed that still apply: their field is declared and in a set the new symbols will carry (functions 21 and 30). */
  private prunePlaceFields(): void {
    const dataType = this.effectiveDataType();
    if (dataType === this.prunedFor) return;
    this.prunedFor = dataType;
    if (this.placeFields.length === 0) return;
    const declared = this.ctx.declaredFields;
    // The new symbols will carry the sets added in the panel and the new data type's (SDK 1.5.0): the values of their fields stay, the others go.
    const sets = withDataTypeSets(this.placeSets, this.dataTypes.find((t) => t.id === dataType));
    const carried = this.ctx.fieldSets.filter((s) => sets.includes(s.id));
    const kept = this.placeFields.filter((v) => {
      const field = declared.find((f) => sameField(f, v));
      return field !== undefined && carried.some((s) => s.plugin === v.plugin && s.fields.includes(v.name));
    });
    if (kept.length !== this.placeFields.length) this.placeFields = kept;
  }

  /** Reads one object by id from the server (SDK 1.1.0, `ctx.objects.get`). Never rejects. */
  private async readById(id: Uuid): Promise<{ readonly kind: 'found'; readonly object: MapObject } | { readonly kind: 'missing' } | { readonly kind: 'failed' }> {
    try {
      const { found } = await this.ctx.objects.get([id]);
      const object = found.find((o) => o.id === id);
      return object === undefined ? { kind: 'missing' } : { kind: 'found', object };
    } catch (error) {
      this.ctx.log.warn(`could not read ${id} by id: ${error instanceof Error ? error.message : String(error)}`);
      return { kind: 'failed' };
    }
  }

  // ---- state ----

  private build(): DrawState {
    const layers = this.tracker.layers;
    const active = this.map.activeLayer.value;
    const activeLayer = active !== null && layers.some((l) => l.id === active) ? active : null;
    const selection = this.map.selection.value;
    const selectedId = selection.length === 1 ? (selection[0] ?? null) : null;
    const held = selectedId === null ? undefined : this.tracker.get(selectedId);
    const readHere = selectedId !== null && this.read?.id === selectedId ? this.read : null;
    const readObject = readHere?.status === 'done' ? (readHere.object ?? null) : null;
    const rereading = readHere?.status === 'loading' && this.lastShown?.id === selectedId ? this.lastShown : null;
    const selected = held ?? readObject ?? rereading;
    this.lastShown = selected;
    const position = selected === null ? null : pointOf(selected.geometry);
    const inView = selected !== null && (position === null || isInsideRing(position, this.map.viewport.visibleArea));
    const readStatus = selectedId === null || held !== undefined || readHere === null || readHere.status === 'done' ? 'idle' : readHere.status;
    const canEdit = this.canEdit;
    // A locked layer takes no new symbol (function 25): the store would refuse it.
    const activeLocked = layers.find((l) => l.id === activeLayer)?.locked === true;
    const canPlace = canEdit && activeLayer !== null && !activeLocked && this.pickerSymbol !== null;
    let placeHint: string | null = null;
    if (!canEdit) placeHint = this.permissionHint;
    else if (activeLayer === null) placeHint = NO_LAYER_HINT;
    else if (activeLocked) placeHint = `The active layer "${layers.find((l) => l.id === activeLayer)?.name ?? ''}" is locked`;
    // A symbol of another workspace's layer (another plugin may have put it into the selection) is read only here (brief, function 17).
    const selectedLayer = selected === null ? undefined : layers.find((l) => l.id === selected.layerId);
    const foreign = selected !== null && selectedLayer === undefined;
    const locked = selectedLayer?.locked === true;
    const workspaceName = this.ctx.workspace.current.name;
    return {
      layers,
      activeLayer,
      placing: this.placing,
      canPlace,
      placeHint,
      canEdit,
      placeFields: this.placeFields,
      placeSets: this.placeSets,
      readOnly: !canEdit || foreign || locked,
      readOnlyHint: !canEdit ? this.permissionHint : foreign ? `This symbol is not in ${workspaceName}` : `Layer "${selectedLayer?.name ?? ''}" is locked`,
      foreign,
      locked,
      settings: this.settings,
      dataTypes: this.dataTypes,
      dataType: this.effectiveDataType(),
      selectionCount: selection.length,
      selectedId,
      selected,
      held: held !== undefined,
      inView,
      readStatus,
      pendingIds: new Set(this.pendingCount.keys()),
    };
  }

  /** The kept choice if that data type is available and one users choose (SDK 1.5.0: not a route or a detection), else the setting if it is, else `core.general`. */
  private effectiveDataType(): string {
    const available = (id: string | null): id is string => id !== null && choosableDataTypes(this.dataTypes).some((t) => t.id === id);
    if (available(this.kept)) return this.kept;
    if (available(this.settings.dataType)) return this.settings.dataType;
    return GENERAL_DATA_TYPE;
  }

  /**
   * Exactly one object is selected and this plugin does not hold it (another plugin selected it, or it
   * left the area): read it by id, once, and show what was read, marked "not in view" (brief, function 14).
   */
  private syncRead(): void {
    const ids = this.map.selection.value;
    const id = ids.length === 1 ? (ids[0] ?? null) : null;
    if (id === null || this.tracker.get(id) !== undefined) {
      this.read = null;
      return;
    }
    if (this.read?.id === id) return;
    this.read = { id, status: 'loading' };
    void this.readById(id).then((got) => {
      if (this.read?.id !== id || this.read.status !== 'loading') return; // the selection moved on
      this.read = got.kind === 'found' ? { id, status: 'done', object: got.object } : { id, status: got.kind };
      this.refresh();
    });
  }

  /**
   * The area's snapshot has arrived. If the symbol it was made for is not in it, the symbol moved away between the read and the snapshot
   * (it never entered, so no `left` will come): read it again, which gives the new position and a new area.
   */
  private onAreaSnapshot(): void {
    const id = this.areaWatch.id;
    if (id === null || this.tracker.get(id) !== undefined) return;
    if (this.read?.id === id && this.read.status === 'done') {
      this.read = null;
      this.refresh();
    }
  }

  /**
   * Follows the one selected symbol with a small area round it (the plugin does not subscribe to the viewport). The
   * position comes from the object this plugin holds, or from the read by id. When the symbol moves out of the area
   * (`left`), the read starts again and the area is subscribed again round the new position. A selection that is
   * not one editable symbol, or none, follows nothing.
   */
  private syncWatch(): void {
    const ids = this.map.selection.value;
    const id = ids.length === 1 ? (ids[0] ?? null) : null;
    if (id === null) {
      this.endLater();
      return;
    }
    const held = this.tracker.get(id);
    const readHere = this.read?.id === id ? this.read : null;
    const known = held ?? (readHere?.status === 'done' ? readHere.object : undefined);
    if (known === undefined) {
      // Still reading, or not readable: another symbol's area is not this one's.
      if (readHere?.status !== 'loading' || this.areaWatch.id !== id) this.areaWatch.stop();
      return;
    }
    if (!isEditableSymbol(known)) {
      this.areaWatch.stop();
      return;
    }
    if (held !== undefined && this.areaWatch.id === id) return; // delivered: stays until the selection ends or it leaves
    const position = pointOf(known.geometry);
    if (position === null || this.areaWatch.isAround(id, position)) return;
    this.areaWatch.around(id, position);
  }

  /** Recomputes the state after any change, stops placing if it became impossible, and tells the listeners. */
  private refresh(): void {
    this.syncRead();
    this.syncWatch();
    this.prunePlaceFields();
    let state = this.build();
    if (this.placing && !state.canPlace) {
      // At a switch, placing stays on and waits for the new workspace's active layer (function 19); in any other case it stops. The switch
      // is noticed here: the shell shows the new workspace first, and the layers' fresh snapshot (its third step) refreshes this state
      // before the switch's last step.
      if (this.workspaceId() !== this.settledWorkspace) this.waitsForLayer = true;
      const waits = this.waitsForLayer && (this.workspaceId() !== this.settledWorkspace || (this.canEdit && this.pickerSymbol !== null && state.activeLayer === null));
      if (!waits) {
        this.placing = false;
        state = this.build();
      }
    }
    if (state.canPlace || !this.placing) this.waitsForLayer = false;
    this.current = state;
    if (!this.placing) this.lastPlacedAt = null;
    this.armInteraction();
    for (const listener of [...this.listeners]) listener();
  }

  /**
   * Our own tracker decides what was deleted, not the shared selection: the map view removes a
   * deleted object from the selection too, possibly before this plugin hears of the deletion.
   * An object that left the area is not a deletion and gets no notice: it stays selected and its panel
   * shows what is read from the server.
   */
  private onTrackerChange({ removed, removedBy, removedObjects }: TrackerChange): void {
    // The symbol may have entered the area or changed: ask for the drag again. Other objects' changes do not count.
    if (this.suspendedKey !== null && this.tracker.get(this.suspendedKey.slice('drag:'.length)) !== this.suspendedObject) this.suspendedKey = null;
    const id = this.watchedId;
    if (id !== null && removed.includes(id)) {
      // Only a symbol is this plugin's to announce: a shape or a track has its own plugin.
      if (removedObjects.get(id)?.type === 'core.symbol') {
        // The shell's shared Delete sends the change, so who deleted it is in the event: no notice for our own user.
        const own = removedBy.get(id)?.user === this.ctx.user.id;
        if (!own && !this.announcedGone.has(id)) this.ctx.notify({ severity: 'info', message: 'The selected symbol was deleted by someone else.' });
        if (this.map.selection.value.includes(id)) this.map.selection.set([]);
      }
      this.watchedId = null;
    }
    for (const gone of removed) this.announcedGone.delete(gone);
    this.refresh();
  }

  // ---- map interactions ----

  /** Asks the map view for what the user can do now: place a point, or drag the selected symbol. */
  private armInteraction(): void {
    const { selectedId, selected } = this.current;
    if (selectedId !== this.earlyFor) this.earlyFor = null; // another selection: its early drag may be armed once
    // A symbol selected while placing: the pick is what is armed, and placing may end because another plugin's drag started. The
    // early drag must not take the map from that one, so it counts as used.
    if (this.placing && selectedId !== null && selected === null) this.earlyFor = selectedId;
    // Between a workspace switch's first step and its last nothing new is armed: the layers and the active layer are not the new
    // workspace's yet. What was armed ended with the map view's moment (its null is dropped in `watch`), or ends at the last step.
    if (this.workspaceId() !== this.settledWorkspace) return;
    const dragId = this.dragTarget();
    let key: string | null = null;
    if (this.placing) key = this.current.canPlace ? 'pick' : null; // waiting for an active layer after a switch: nothing to ask for
    else if (dragId !== null) key = `drag:${dragId}`;
    // The interaction is no longer wanted (another object, placing switched off, the object proves not to be an editable symbol in the
    // view, the selection ended): end it with its signal, so that the map is free for another plugin's drag (T-066, CR-0020). One that
    // another plugin's interaction replaced is not touched: its null has already cleared `armed`.
    if (this.armed !== null && this.armed.key !== key) this.endArmed();
    if (key !== this.suspendedKey) this.suspendedKey = null; // another selection (or none): ask again when it is selected
    if (key === null) return;
    if (key !== this.failedKey) this.failedKey = null;
    else return;
    if (key === this.suspendedKey) return;
    if (this.armed?.key === key) return;
    const early = dragId !== null && selected === null;
    if (early && this.earlyFor === dragId) return; // armed once per selection (T-066)

    const armed: Armed = { key, abort: new AbortController(), workspace: this.settledWorkspace };
    this.armed = armed;
    if (key === 'pick') {
      this.watch(armed, this.map.pickPoint({ signal: armed.abort.signal }), (position) => {
        this.onPicked(position);
      });
    } else if (dragId !== null) {
      if (early) this.earlyFor = dragId;
      this.watch(armed, this.map.dragObject(dragId, { signal: armed.abort.signal }), (position) => {
        this.onDropped(dragId, position);
      });
    }
  }

  /** Ends the armed interaction with its signal. What it resolves with is not used, so it suspends nothing and, after `dispose`, arms nothing. */
  private endArmed(): void {
    const armed = this.armed;
    if (armed === null) return;
    this.armed = null;
    armed.abort.abort();
  }

  /**
   * The symbol to wait for a drag of: the one selected object, as soon as it is selected. A press can start a drag only when the drag is
   * already armed, and this plugin knows nothing about the object (type, position) until the read by id answers, one round trip later: a
   * drag that begins right after the click would be lost. So it is armed before the read, once per selection. Once the object is known, a
   * symbol that is not on the map's view, not in the workspace's layers, or an object that is not an editable symbol, is not waited for:
   * {@link armInteraction} ends the drag armed for it with its signal, so that `draw-shapes`' drag can take over (T-066).
   */
  private dragTarget(): Uuid | null {
    const { selectedId, selected, inView, readStatus, foreign, locked } = this.current;
    if (!this.canEdit || selectedId === null) return null;
    if (selected === null) return readStatus === 'idle' || readStatus === 'loading' ? selectedId : null; // not known yet
    return isEditableSymbol(selected) && inView && !foreign && !locked ? selectedId : null;
  }

  private watch(armed: Armed, interaction: Promise<Position | null>, handle: (position: Position | null) => void): void {
    interaction
      .then(
        (position) => {
          if (armed.abort.signal.aborted) return; // ended by this plugin: its result is not used
          if (this.armed === armed) this.armed = null;
          if (armed.workspace !== this.workspaceId()) {
            // The map view ended it at a workspace switch (its null is no Escape): it is asked for again at the switch's last step.
            this.refresh();
            return;
          }
          handle(position);
        },
        (error: unknown) => {
          if (armed.abort.signal.aborted) return;
          if (this.armed === armed) this.armed = null;
          this.failedKey = armed.key;
          this.unexpected(error);
          this.refresh();
        },
      )
      .catch((error: unknown) => {
        this.unexpected(error);
      });
  }

  private onPicked(position: Position | null): void {
    if (position === null) {
      this.placing = false; // Escape
    } else if (this.placing) {
      // Two clicks within the double-click time are one placement, at the first click's point.
      const at = this.now();
      if (this.lastPlacedAt === null || at - this.lastPlacedAt >= DOUBLE_CLICK_MS) {
        this.lastPlacedAt = at;
        this.guard(this.place(position));
      }
    } // else not placing any more: the click is dropped
    this.refresh(); // arms the next interaction
  }

  /** Something that could change the answer of the map view happened: a drag that ended with null may be asked for again. */
  private resumeDrag(): void {
    if (this.suspendedKey === null) return;
    this.suspendedKey = null;
    this.refresh();
  }

  private onDropped(id: Uuid, position: Position | null): void {
    if (position === null) {
      this.suspendedKey = `drag:${id}`;
      this.suspendedObject = this.tracker.get(id);
    }
    // A drag armed before the object was known: once it is known not to be an editable symbol that the map shows, its drop is ignored.
    const known = this.current.selected;
    const draggable = known === null || (isEditableSymbol(known) && this.current.inView && !this.current.foreign);
    if (position !== null && !this.placing && this.current.selectedId === id && draggable) {
      const point = validPosition(position);
      if (point === null) this.ctx.notify({ severity: 'warning', message: 'That point is outside the valid coordinates.' });
      else this.guard(this.update(id, 'move the symbol', (core) => withPosition(core, point), true)); // quiet: the drag may have been armed for an object not yet known to be a symbol
    }
    this.refresh();
  }

  // ---- change requests ----

  private async place(position: Position): Promise<boolean> {
    const symbol = this.pickerSymbol;
    const layerId = this.current.activeLayer;
    if (symbol === null || layerId === null) {
      this.ctx.notify({ severity: 'warning', message: `Cannot place a symbol: ${NO_LAYER_HINT.toLowerCase()}.` });
      return false;
    }
    const point = validPosition(position);
    if (point === null) {
      this.ctx.notify({ severity: 'warning', message: 'That point is outside the valid coordinates.' });
      return false;
    }
    // The declared fields set for new symbols go with the create; a value that breaks its declaration stops the placing click (it is shown at its field).
    const fields = changedFields([], this.placeFields);
    const problem = fieldProblems(this.ctx.declaredFields, fields)[0];
    if (problem !== undefined) {
      this.ctx.notify({ severity: 'warning', message: `Cannot place a symbol: ${problem.problem}.` });
      return false;
    }
    // The sets added in the panel go too, those that are still declared (the store refuses one that no loaded plugin declares: rule 18).
    const sets = this.placeSets.filter((setId) => this.ctx.fieldSets.some((s) => s.id === setId));
    return this.create(newSymbolContent({ layerId, position: point, symbol, label: this.ctx.defaultLabel, dataType: this.current.dataType }), fields, sets);
  }

  private async create(content: MapObjectContent, fields: readonly FieldValue[] = [], sets: readonly string[] = []): Promise<boolean> {
    if (!this.reserve()) return false;
    const id = this.ctx.newId();
    this.markPending(id, 1);
    try {
      const request = changeRequests.withFieldSets(changeRequests.withFields(changeRequests.createObject(id, content), fields), sets);
      let sent = await this.submit(request);
      if (sent.kind === 'unknown') {
        // The same id again: if the first request arrived, the store answers ENTITY_EXISTS.
        sent = await this.submit(request);
        if (sent.kind === 'rejected' && sent.rejection.code === 'ENTITY_EXISTS') return true;
      }
      // A new symbol is not selected and not in the area this plugin follows: it is not put into the tracker.
      return this.report(sent, 'place the symbol', undefined, false);
    } catch (error) {
      this.unexpected(error);
      return false;
    } finally {
      this.waiting--;
      this.markPending(id, -1);
    }
  }

  /**
   * Runs `task` after the earlier tasks for the same object, so that each one starts from the
   * state the previous one produced. `task` is built when it runs, from the latest state.
   */
  private enqueue(id: Uuid, task: () => Promise<boolean>): Promise<boolean> {
    if (!this.reserve()) return Promise.resolve(false);
    this.markPending(id, 1);
    const previous = this.chains.get(id) ?? Promise.resolve();
    const run = previous.then(async () => {
      try {
        return await task();
      } catch (error) {
        this.unexpected(error);
        return false;
      } finally {
        this.waiting--;
        this.markPending(id, -1);
      }
    });
    const tail = run.then(() => undefined);
    this.chains.set(id, tail);
    void tail.then(() => {
      if (this.chains.get(id) === tail) this.chains.delete(id);
    });
    return run;
  }

  /** Counts a waiting request; false (with a notification) above {@link MAX_WAITING}. */
  private reserve(): boolean {
    if (this.waiting >= MAX_WAITING) {
      this.ctx.notify({ severity: 'warning', message: 'Too many changes are waiting for the server. Try again in a moment.' });
      return false;
    }
    this.waiting++;
    return true;
  }

  private markPending(id: Uuid, delta: number): void {
    const count = (this.pendingCount.get(id) ?? 0) + delta;
    if (count > 0) this.pendingCount.set(id, count);
    else this.pendingCount.delete(id);
    this.refresh();
  }

  private async submit(request: ChangeRequestContent): Promise<Sent> {
    let outcome: ChangeOutcome;
    try {
      outcome = await this.ctx.changes.submit(request);
    } catch (error) {
      if (error instanceof OutcomeUnknownError) return { kind: 'unknown' };
      throw error;
    }
    return outcome.outcome === 'applied' ? { kind: 'applied', event: outcome.event } : { kind: 'rejected', rejection: outcome.rejection };
  }

  /** Tells the user what went wrong; true if the change was applied. An applied event of an object we hold updates our state at once. */
  private report(sent: Sent, what: string, readId?: Uuid, track = true): boolean {
    if (sent.kind === 'applied') {
      if (readId !== undefined && this.tracker.get(readId) === undefined) {
        // A symbol this plugin does not hold: the panel shows the state the server answered with, still marked "not in view".
        if (this.read?.id === readId && sent.event.state !== null) {
          this.read = { id: readId, status: 'done', object: sent.event.state as MapObject };
          this.refresh();
        }
      } else if (track) {
        this.tracker.applyEvent(sent.event);
      }
      return true;
    }
    if (sent.kind === 'unknown') {
      this.ctx.notify({ severity: 'warning', message: `No answer from the server to the request to ${what}. Look at the map before trying again.` });
    } else {
      const { code, message } = sent.rejection;
      this.ctx.notify({ severity: 'error', message: `Could not ${what}: ${message} (${code})` });
    }
    return false;
  }

  /** Defence in depth: the panels are read only without `objects.edit`, and the server checks anyway. */
  private refuseReadOnly(): boolean {
    this.ctx.notify({ severity: 'warning', message: `${this.permissionHint}.` });
    return false;
  }

  private unexpected(error: unknown): void {
    this.ctx.log.error('unexpected error', error);
    this.ctx.notify({ severity: 'error', message: `Unexpected error: ${error instanceof Error ? error.message : String(error)}` });
  }

  /** Runs a promise nobody awaits, so that a failure becomes a notification instead of vanishing. */
  guard(promise: Promise<unknown>): void {
    promise.catch((error: unknown) => {
      this.unexpected(error);
    });
  }
}
