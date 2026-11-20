// The panel's logic: follows the live picture of the workspace shown, keeps the active layer one of
// its layers, and turns the user's actions into change requests (ADR-0005, ADR-0018, ADR-0039).
// The React component only renders its state.
import { changeRequests, classificationOrder, OutcomeUnknownError, PERMISSIONS, VIEW_WORKSPACE } from '@emc2/plugin-sdk';
import type { ChangeOutcome, ChangeRequestContent, Layer, MapView, ObjectListService, PluginContext, Unsubscribe, Uuid, WorkspaceInfo } from '@emc2/plugin-sdk';
import { EMPTY_STATE, LayerTracker, type LayerState } from './layerState.ts';
import { contentOf, drawOrderOnTop, nextLayerName, planMove } from './order.ts';

/** Whether the map view (active layer, local visibility) can be used. */
export type MapViewStatus = 'waiting' | 'ready' | 'failed';

/** Everything the panel renders. Immutable: every change makes a new value. */
export interface PanelState extends LayerState {
  readonly mapView: MapViewStatus;
  readonly activeLayer: Uuid | null;
  /** Layers hidden in this browser, the reference group's included. */
  readonly hidden: ReadonlySet<Uuid>;
  /** View's layers as a read-only reference while a declared workspace is shown; null in View (brief, function 20). */
  readonly reference: LayerState | null;
  /** Kinds of action still on their way ({@link CREATE}, {@link UPDATE}, `delete:<layer id>`); the same kind is refused meanwhile. */
  readonly pending: ReadonlySet<string>;
  /** Whether the user may create, rename, reorder and delete layers: `layers.edit` in View, the workspace's `editPermission` elsewhere (brief, functions 10 and 18). */
  readonly canEdit: boolean;
  /** Why the panel is read only, naming a declared workspace (brief, function 18). */
  readonly noEditHint: string;
  /** Whether `object-list` is there, so a double-click (or Enter) opens a layer's objects (brief, function 12). */
  readonly canOpenObjects: boolean;
}

/** The lock's title without the permission to change the layer (brief, function 22). */
export const NO_LOCK_HINT = 'You may not change this layer';

/** The title of Rename and Delete on a locked layer (brief, function 22). */
export const LOCKED_HINT = 'The layer is locked';

/** Shown in View when the user lacks `layers.edit` (brief, function 10). */
export const NO_EDIT_HINT = 'You may not change layers';

/** The read-only hint: View's as in M2, another workspace's with its name (brief, function 18; owner, 2026-10-27). */
export function noEditHint(workspace: WorkspaceInfo): string {
  return workspace.id === VIEW_WORKSPACE ? NO_EDIT_HINT : `${NO_EDIT_HINT} in ${workspace.name}`;
}

/** The status detail when `object-list` is not there: not installed, failed or disabled (a `uses` key, CR-0011; brief, function 12). */
export const NO_OBJECT_LIST = 'object-list not available: double-click opens nothing';

/** Pending key of a create. */
export const CREATE = 'create';
/** Pending key of renames, moves and locks: one at a time, so none is based on content the server has already changed. */
export const UPDATE = 'update';
/** Pending key of the delete of one layer. */
export const deleteKey = (layerId: Uuid): string => `delete:${layerId}`;

export const MAX_NAME_LENGTH = 256;

/** What the new-layer dialog starts with (brief, function 23). */
export interface NewLayer {
  /** "Layer N" (function 5). */
  readonly name: string;
  /** The default policy's classifications, lowest first; empty without an order, and then the dialog has no select. */
  readonly classifications: readonly string[];
  /** The default label's classification, chosen at the start. */
  readonly classification: string;
}
/** How long an applied change may wait for its live event before the same kind of action is allowed again. */
export const PENDING_TIMEOUT_MS = 5_000;

export class LayerPanelController {
  private readonly tracker = new LayerTracker();
  private readonly listeners = new Set<() => void>();
  private map: MapView | null = null;
  private mapStatus: MapViewStatus = 'waiting';
  private objectList: ObjectListService | null = null;
  /** View's layers while a declared workspace is shown (brief, function 20); null in View. */
  private reference: { readonly tracker: LayerTracker; readonly end: Unsubscribe } | null = null;
  private current: PanelState;
  /** Action key → the sequence number whose arrival ends it (Infinity while waiting for the answer). */
  private readonly pending = new Map<string, number>();
  /** The layer order (top first) of the last state, to find the successor of a deleted active layer. */
  private lastOrder: readonly Uuid[] = [];
  /** Whether the layers were last replaced by a snapshot, after which a gap is filled with the top layer (brief, function 21). */
  private fromSnapshot = false;
  /** A layer created here, made active once the live picture lists it (brief, function 5; owner, 2026-10-27). */
  private awaitingActive: Uuid | null = null;
  /** Counts the user's activations, so that one made while a create is on its way wins over the new layer. */
  private activations = 0;

  constructor(private readonly ctx: PluginContext) {
    const workspace = this.workspace();
    this.current = {
      ...EMPTY_STATE, mapView: 'waiting', activeLayer: null, hidden: new Set(), reference: null, pending: new Set(),
      canEdit: this.mayEdit(workspace), noEditHint: noEditHint(workspace), canOpenObjects: false,
    };
    // Subscribed at once, not when the panel is shown, so no snapshot is missed. Layers and the
    // server's object counts only, no objects (brief, function 11). Without `workspaces` it
    // follows the workspace shown, with a fresh snapshot on a switch (function 16).
    ctx.livePicture.subscribe(
      {
        snapshot: (snapshot) => {
          this.tracker.snapshot(snapshot);
          this.fromSnapshot = true;
          this.update();
        },
        changes: (batch) => {
          this.tracker.changes(batch);
          this.update();
        },
        counts: (counts) => {
          this.tracker.objectCounts(counts);
          this.update();
        },
      },
      { objects: false },
    );
    this.followReference();
    // The fresh snapshot came before this; the reference group follows here. A layer created in
    // the old workspace is no longer made active.
    ctx.workspace.onChange(() => {
      this.awaitingActive = null;
      this.followReference();
      this.update();
    });
  }

  /** The workspace shown. */
  private workspace(): WorkspaceInfo {
    return this.ctx.workspace.current;
  }

  /** Whether the user may change the layers of a workspace (ADR-0022; ADR-0039 point 7). */
  private mayEdit(workspace: WorkspaceInfo): boolean {
    return this.ctx.user.has(workspace.editPermission ?? PERMISSIONS.layersEdit);
  }

  /**
   * Holds the reference subscription, View's layers and counts only, while a declared workspace is
   * shown, and ends it in View (brief, function 20). It names its workspace, so a switch gives it
   * no fresh snapshot; a new subscription starts with its own.
   */
  private followReference(): void {
    const declared = this.workspace().id !== VIEW_WORKSPACE;
    if (declared && this.reference === null) {
      const tracker = new LayerTracker();
      const end = this.ctx.livePicture.subscribe(
        {
          snapshot: (snapshot) => {
            tracker.snapshot(snapshot);
            this.update();
          },
          changes: (batch) => {
            tracker.changes(batch);
            this.update();
          },
          counts: (counts) => {
            tracker.objectCounts(counts);
            this.update();
          },
        },
        { objects: false, workspaces: [VIEW_WORKSPACE] },
      );
      this.reference = { tracker, end };
      // A snapshot delivered during subscribe() found no reference yet.
      this.update();
    } else if (!declared && this.reference !== null) {
      this.reference.end();
      this.reference = null;
    }
  }

  /** The map view has activated: from now on the active layer and local visibility work. */
  attachMapView(map: MapView): void {
    this.map = map;
    this.mapStatus = 'ready';
    map.activeLayer.onChange(() => {
      this.update();
    });
    // Also when the map view restores a setup, so the eyes follow at once (brief, function 13).
    map.onLayerVisibilityChange(() => {
      this.update();
    });
    this.update();
  }

  /** `object-list` has activated: from now on a double-click opens a layer's objects (brief, function 12). */
  attachObjectList(list: ObjectListService): void {
    this.objectList = list;
    this.update();
  }

  /** The map view failed or is disabled: the list still works, the active layer and the eye do not. */
  mapViewFailed(): void {
    this.mapStatus = 'failed';
    this.update();
  }

  // For useSyncExternalStore.
  readonly subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): PanelState => this.current;

  /** Makes a layer the active one (brief, function 4); only one of the workspace's own (function 21). */
  activate(layerId: Uuid): void {
    if (this.layer(layerId) === undefined) return;
    this.awaitingActive = null;
    this.activations++;
    this.map?.activeLayer.set(layerId);
  }

  /** Shows or hides a layer in this browser only (brief, function 3). Sends nothing. */
  toggleVisible(layerId: Uuid): void {
    if (this.map === null) return;
    this.map.setLayerVisible(layerId, !this.map.isLayerVisible(layerId));
    // The visibility event updates too; this covers a map view that does not send it.
    this.update();
  }

  /**
   * Opens `object-list` for a layer, also a hidden one, and also without `layers.edit`: reading is
   * always allowed (brief, functions 12 and 15). Without `object-list` it does nothing.
   */
  openObjects(layerId: Uuid): void {
    const list = this.objectList;
    if (list === null || this.layer(layerId) === undefined) return;
    try {
      list.open(layerId);
    } catch (error) {
      this.reportUnexpected('open the objects of the layer', error);
    }
  }

  /**
   * The new-layer dialog's start (brief, function 23): "Layer N", and the order of the default
   * label's policy (`ctx.classifications`, its name ignoring case). Without an order for the policy,
   * or the default classification in it, there is nothing to choose.
   */
  newLayer(): NewLayer {
    const { policyIdentifier, classification } = this.ctx.defaultLabel;
    const order = classificationOrder(this.ctx.classifications, policyIdentifier.name);
    return { name: nextLayerName(this.current.layers), classifications: order.includes(classification) ? order : [], classification };
  }

  /**
   * Creates a layer on top, visible, in the workspace shown, and makes it active once the live
   * picture lists it (brief, functions 5, 17 and 23). In View it carries no `workspace`. The name
   * defaults to "Layer N"; the label is the default one, with the chosen classification (labels are
   * cosmetic in M6; owner, 2026-11-10). An empty name sends nothing.
   */
  create(choice: { readonly name?: string; readonly classification?: string } = {}): Promise<void> {
    const chosen = choice.name?.trim().slice(0, MAX_NAME_LENGTH);
    if (!this.current.canEdit || chosen === '') return Promise.resolve();
    return this.once(CREATE, 'create a layer', async () => {
      const layers = this.current.layers;
      const id = this.ctx.newId();
      const name = chosen ?? nextLayerName(layers);
      const workspace = this.workspace().id;
      const activations = this.activations;
      const label = choice.classification === undefined ? this.ctx.defaultLabel : { ...this.ctx.defaultLabel, classification: choice.classification };
      const request = changeRequests.createLayer(id, {
        ...(workspace !== VIEW_WORKSPACE ? { workspace } : {}),
        name, drawOrder: drawOrderOnTop(layers), visible: true, label,
      });
      const applied = await this.submit(request, `create layer "${name}"`);
      // Not when the user made a layer active meanwhile, or the workspace changed: their choice wins.
      if (applied > 0 && this.workspace().id === workspace && this.activations === activations) {
        // The answer may come before the live event; the active layer is always one the panel lists.
        this.awaitingActive = id;
        this.update();
      }
      return applied;
    });
  }

  /** Renames a layer; an empty or unchanged name sends nothing (brief, function 6). */
  rename(layerId: Uuid, newName: string): Promise<void> {
    const layer = this.layer(layerId);
    const name = newName.trim();
    if (!this.current.canEdit || layer === undefined || name === '' || name === layer.name) return Promise.resolve();
    if (this.pending.has(UPDATE)) {
      this.ctx.notify({ severity: 'info', message: `Layer "${layer.name}" was not renamed: another change to the layers is still on its way. Try again.` });
      return Promise.resolve();
    }
    return this.once(UPDATE, `rename layer "${layer.name}"`, () =>
      this.submit(changeRequests.updateLayer(layer, contentOf(layer, { name: name.slice(0, MAX_NAME_LENGTH) })), `rename layer "${layer.name}"`),
    );
  }

  /** Moves a layer to a position in the list, top first (brief, function 2). */
  move(layerId: Uuid, newIndex: number): Promise<void> {
    if (!this.current.canEdit) return Promise.resolve();
    const name = this.layer(layerId)?.name ?? '';
    return this.once(UPDATE, `move layer "${name}"`, async () => {
      const changes = planMove(this.current.layers, layerId, newIndex);
      const applied = await Promise.all(
        changes.map(({ layer, drawOrder }) => this.submit(changeRequests.updateLayer(layer, contentOf(layer, { drawOrder })), `move layer "${name}"`)),
      );
      return Math.max(0, ...applied);
    });
  }

  /**
   * Locks or unlocks a layer for every user: one update with the complete content and `locked`
   * (brief, function 22; ADR-0042). The server refuses it without the layer's edit permission.
   */
  setLocked(layerId: Uuid, locked: boolean): Promise<void> {
    const layer = this.layer(layerId);
    if (!this.current.canEdit || layer === undefined || (layer.locked === true) === locked) return Promise.resolve();
    const what = `${locked ? 'lock' : 'unlock'} layer "${layer.name}"`;
    return this.once(UPDATE, what, () => this.submit(changeRequests.updateLayer(layer, contentOf(layer, { locked })), what));
  }

  /** Deletes an empty layer (brief, function 7). The panel asks for confirmation before calling this. */
  remove(layerId: Uuid): Promise<void> {
    const layer = this.layer(layerId);
    if (!this.current.canEdit || layer === undefined || (this.current.counts.get(layerId) ?? 0) > 0) return Promise.resolve();
    return this.once(deleteKey(layerId), `delete layer "${layer.name}"`, () => this.submit(changeRequests.deleteLayer(layer), `delete layer "${layer.name}"`));
  }

  private layer(layerId: Uuid): Layer | undefined {
    return this.current.layers.find((l) => l.id === layerId);
  }

  /**
   * Runs an action unless one with the same key is still on its way: from the click until the live
   * picture shows the applied change (its sequence number), or until it was rejected or lost. So a
   * double click sends one request, and no update is computed from a state the server has already
   * changed. An unexpected error is logged and shown, never left as an unhandled rejection.
   *
   * @param action resolves with the highest sequence number of the changes it applied, 0 if none
   */
  private async once(key: string, what: string, action: () => Promise<number>): Promise<void> {
    if (this.pending.has(key)) return;
    this.pending.set(key, Infinity);
    this.update();
    let waitFor = 0;
    try {
      waitFor = await action();
    } catch (error) {
      this.reportUnexpected(what, error);
    }
    this.pending.set(key, waitFor);
    this.update();
    if (this.pending.get(key) === waitFor) {
      // The live picture normally catches up within a batch (about 200 ms); never lock the panel for good.
      setTimeout(() => {
        if (this.pending.get(key) !== waitFor) return;
        this.pending.delete(key);
        this.update();
      }, PENDING_TIMEOUT_MS);
    }
  }

  /**
   * Logs and shows an unexpected error. Never throws: if the log or the notification fails too, the
   * browser console is the last place left, and the action must still release its guard.
   */
  private reportUnexpected(what: string, error: unknown): void {
    const text = error instanceof Error ? error.message : String(error);
    for (const report of [
      () => {
        this.ctx.log.error(`layer panel: could not ${what}`, error);
      },
      () => {
        this.ctx.notify({ severity: 'error', message: `Could not ${what}: unexpected error (${text})` });
      },
    ]) {
      try {
        report();
      } catch (reportError) {
        console.error(`layer panel: could not report that it could not ${what}`, error, reportError);
      }
    }
  }

  /**
   * Submits one request. Resolves with the applied event's sequence number, or 0 if it was rejected
   * or its answer was lost; those become notifications. Other errors propagate to {@link once}.
   */
  private async submit(request: ChangeRequestContent, what: string): Promise<number> {
    let outcome: ChangeOutcome;
    try {
      outcome = await this.ctx.changes.submit(request);
    } catch (error) {
      if (!(error instanceof OutcomeUnknownError)) throw error;
      this.ctx.notify({ severity: 'warning', message: `No answer from the server to the request to ${what}. Check the layer list before trying again.` });
      return 0;
    }
    if (outcome.outcome === 'applied') return outcome.event.sequenceNo;
    const { code, message } = outcome.rejection;
    // The server checks the permission even when the panel thinks the user has it (brief, functions 10 and 18).
    const reason = code === 'PERMISSION_DENIED' ? `${noEditHint(this.workspace())} (the server refused: ${message})` : `${message} (${code})`;
    this.ctx.notify({ severity: 'error', message: `Could not ${what}: ${reason}` });
    return 0;
  }

  /** Recomputes the state after any change, keeps the active layer valid and tells the listeners. */
  private update(): void {
    const { loaded, layers, counts, sequenceNo } = this.tracker.state;
    for (const [key, waitFor] of this.pending) if (waitFor <= sequenceNo) this.pending.delete(key);
    const map = this.map;
    const fromSnapshot = this.fromSnapshot;
    this.fromSnapshot = false;
    if (map !== null && loaded) this.keepActiveLayerValid(map, layers, fromSnapshot);
    this.lastOrder = layers.map((l) => l.id);
    const workspace = this.workspace();
    const reference = this.reference?.tracker.state ?? null;
    const all = reference === null ? layers : [...layers, ...reference.layers];
    this.current = {
      loaded,
      layers,
      counts,
      sequenceNo,
      reference,
      pending: new Set(this.pending.keys()),
      canEdit: this.mayEdit(workspace),
      noEditHint: noEditHint(workspace),
      canOpenObjects: this.objectList !== null,
      mapView: this.mapStatus,
      activeLayer: map?.activeLayer.value ?? null,
      hidden: new Set(map === null ? [] : all.filter((l) => !map.isLayerVisible(l.id)).map((l) => l.id)),
    };
    for (const listener of [...this.listeners]) listener();
  }

  /**
   * Keeps the active layer one of the workspace's own layers, at any time (brief, functions 4 and
   * 21). A layer created here becomes active once it is listed. Otherwise, if a change deleted the
   * active layer from the list, the layer below it becomes active, or the top layer when none is
   * below. When it is none, or any other id the list does not hold (another workspace's layer, a
   * reference layer, an unknown id, or one a fresh snapshot no longer has), the top layer does.
   * With no layer, none is active. So the order of the plugins' `onChange` listeners on a switch
   * does not matter: a layer the map view brings back stands, and the top layer only fills a gap.
   */
  private keepActiveLayerValid(map: MapView, layers: readonly Layer[], fromSnapshot: boolean): void {
    const exists = (id: Uuid) => layers.some((l) => l.id === id);
    const created = this.awaitingActive;
    if (created !== null && exists(created)) {
      this.awaitingActive = null;
      if (map.activeLayer.value !== created) map.activeLayer.set(created);
      return;
    }
    const active = map.activeLayer.value;
    if (active !== null && exists(active)) return;
    const was = active === null || fromSnapshot ? -1 : this.lastOrder.indexOf(active);
    const below = was < 0 ? undefined : this.lastOrder.slice(was + 1).find(exists);
    const next = below ?? layers[0]?.id ?? null;
    if (next !== active) map.activeLayer.set(next);
  }
}
