// The panel's logic: follows the layers and their counts, knows which layer the list shows, and
// reads that layer's objects page by page. The React component only renders its state. Reads
// objects only (the plugin sends no change requests, brief function 6 and criterion 11).
import { MAX_SELECTION, workspaceOf } from '@emc2/plugin-sdk';
import type { Layer, LayerPage, MapObject, MapView, PluginContext, SymbolService, Unsubscribe, Uuid } from '@emc2/plugin-sdk';
import { lastPageIndex, pageSizeOf } from './format.ts';
import { EMPTY_STATE, LayerTracker, type LayerState } from './layerState.ts';

/** Whether the map view (selection, map actions) can be used. */
export type MapViewStatus = 'waiting' | 'ready' | 'failed';

/** The page the list shows. */
export interface PageState {
  /** Whether a read is on its way (the objects below are the previous ones until it arrives). */
  readonly loading: boolean;
  /** Whether a page of this layer has been read yet; false until the first answer. */
  readonly read: boolean;
  /** 0-based index of the page the objects belong to. */
  readonly index: number;
  readonly objects: readonly MapObject[];
  /** All objects of the layer when the page was read. */
  readonly total: number;
  /** Why the last read failed, or null. The last page stays (brief, function 8). */
  readonly error: string | null;
}

const NO_PAGE: PageState = { loading: false, read: false, index: 0, objects: [], total: 0, error: null };

/** Everything the panel renders. Immutable: every change makes a new value. */
export interface ListState extends LayerState {
  readonly mapView: MapViewStatus;
  /** The layer the list shows, or null when none was chosen yet. */
  readonly layerId: Uuid | null;
  /** The shown layer, once the live picture holds it. */
  readonly layer: Layer | null;
  /** The shown layer's object count according to the live picture (0 while unknown). */
  readonly total: number;
  readonly page: PageState;
  readonly pageSize: number;
  /** Set when the list was closed because its layer is gone; cleared when a layer is chosen. */
  readonly closedNotice: string | null;
  /** The ids of the map's selection, which the rows share (brief, function 5). Empty without a map view. */
  readonly selected: ReadonlySet<Uuid>;
  /** The symbol service, when `emc2.symbols` is loaded. */
  readonly symbols: SymbolService | null;
  /** The pixel size of a row's symbol image, from the density's row height. */
  readonly imageSize: number;
}

/** Shown when a Ctrl/Cmd+click would take the selection past the limit (brief, function 5). */
export const SELECTION_FULL = `At most ${String(MAX_SELECTION)} objects can be selected`;

/** Shown when `open` gets a layer that the workspace shown does not hold (brief, function 11). */
export const NOT_IN_WORKSPACE = 'That layer is not in the workspace shown';

/** The side of a row's symbol image in pixels: the row's height less a little, as the density sets it. */
function imageSizeOf(rowToken: string | undefined): number {
  const row = Number.parseFloat(rowToken ?? '');
  return Number.isFinite(row) ? Math.max(12, Math.round(row - 4)) : 22;
}

export class ObjectListController {
  private readonly tracker = new LayerTracker();
  private readonly listeners = new Set<() => void>();
  private mapStatus: MapViewStatus = 'waiting';
  private shown: Uuid | null = null;
  /** The shown layer's name as last seen, for the notice when it is deleted. */
  private shownName: string | null = null;
  private page: PageState = NO_PAGE;
  private pageSize: number;
  private closedNotice: string | null = null;
  /** The page asked for last; the one a count change or a setting change reads again. */
  private wantedIndex = 0;
  /** Every read gets a number; an answer that is not the latest is dropped. */
  private seq = 0;
  /** A count changed while a read was on its way: read again when it arrives. */
  private dirty = false;
  /** The shown layer's count as last seen by the live picture; null before the first snapshot. */
  private lastCount: number | null = null;
  private showPanel: () => void = () => undefined;
  private current: ListState;
  private map: MapView | null = null;
  private selected: ReadonlySet<Uuid> = new Set();
  private symbols: SymbolService | null = null;
  private imageSize: number;
  /** The workspace the state belongs to: the one shown when the last picture arrived. */
  private workspace: string;
  /** The layer each workspace showed when it was left, for the way back (brief, function 12). Lives as long as the page. */
  private readonly lastLayer = new Map<string, Uuid>();
  /** After a switch: the layer to show again once the new workspace's snapshot is in. */
  private restore: Uuid | null = null;
  /** After a switch and until its snapshot: the picture held is the old workspace's, so nothing is known about the layers. */
  private awaitingPicture = false;

  constructor(private readonly ctx: PluginContext) {
    this.pageSize = this.readPageSize();
    this.imageSize = imageSizeOf(ctx.theme.tokens().sizeRow);
    this.workspace = this.shownWorkspace();
    this.current = this.derive(EMPTY_STATE);
    // Subscribed at once, not when the panel is shown, so no snapshot is missed. Layers and the
    // server's object counts only, no objects (brief, functions 3 and 7). It names no workspace, so it
    // follows the workspace shown and gets a fresh snapshot on a switch (rule 2, function 10).
    ctx.livePicture.subscribe(
      {
        snapshot: (snapshot) => {
          this.followWorkspace();
          this.awaitingPicture = false;
          this.update(this.tracker.snapshot(snapshot));
          this.restoreLayer();
        },
        changes: (batch) => {
          this.update(this.tracker.changes(batch));
        },
        counts: (counts) => {
          this.update(this.tracker.objectCounts(counts));
        },
      },
      { objects: false },
    );
    ctx.onSettingsChange(() => {
      this.settingsChanged();
    });
    ctx.theme.onChange(() => {
      this.imageSize = imageSizeOf(ctx.theme.tokens().sizeRow);
      this.publish();
    });
    // The shell calls this after the fresh snapshots, so the snapshot has normally done the work.
    ctx.workspace.onChange(() => {
      if (this.followWorkspace()) this.publish();
    });
  }

  /** The id of the workspace shown. */
  private shownWorkspace(): string {
    return this.ctx.workspace.current.id;
  }

  /**
   * A switch (rule 3): remembers the layer the old workspace showed and starts the new one with none
   * chosen, without the "deleted" notice: the old layers leaving the picture are not deletions. Returns
   * whether the workspace changed. Stale answers for the old layer are dropped.
   */
  private followWorkspace(): boolean {
    const now = this.shownWorkspace();
    if (now === this.workspace) return false;
    // A layer still waiting to be restored stays remembered: a second switch before the snapshot must not lose it.
    if (this.shown !== null) this.lastLayer.set(this.workspace, this.shown);
    else if (this.restore === null) this.lastLayer.delete(this.workspace);
    this.workspace = now;
    this.awaitingPicture = true;
    this.seq++;
    this.dirty = false;
    this.shown = null;
    this.shownName = null;
    this.page = NO_PAGE;
    this.wantedIndex = 0;
    this.lastCount = null;
    this.closedNotice = null;
    this.restore = this.lastLayer.get(now) ?? null;
    return true;
  }

  /** After a switch and the new snapshot: the layer this workspace showed last, if it is still there. */
  private restoreLayer(): void {
    const id = this.restore;
    if (id === null) return;
    this.restore = null;
    if (this.ownLayers(this.tracker.state).some((l) => l.id === id)) this.choose(id);
  }

  /** The workspace's own layers (rule 6): never another workspace's, whatever the picture holds. */
  private ownLayers(layers: LayerState): readonly Layer[] {
    return layers.layers.filter((l) => workspaceOf(l) === this.workspace);
  }

  /** What `panel.show()` does; set once the panel is added. */
  setShowPanel(show: () => void): void {
    this.showPanel = show;
  }

  /** The map view has activated: from now on rows can be selected. */
  attachMapView(map: MapView): void {
    this.map = map;
    this.mapStatus = 'ready';
    this.selected = new Set(map.selection.value);
    // The rows follow the selection however it was made, on the map or here (brief, function 5).
    map.selection.onChange((ids) => {
      this.selected = new Set(ids);
      this.publish();
    });
    this.update(this.tracker.state);
  }

  /** `emc2.symbols` has activated: symbol rows get their image. */
  attachSymbols(symbols: SymbolService): void {
    this.symbols = symbols;
    this.publish();
  }

  /** The map view failed or is not loaded: the list still pages, rows cannot be selected. */
  mapViewFailed(): void {
    this.mapStatus = 'failed';
    this.update(this.tracker.state);
  }

  /** A data type's display name, or undefined for one that is not in the list. */
  dataTypeName(id: string): string | undefined {
    return this.ctx.dataTypes.find((d) => d.id === id)?.name;
  }

  /**
   * A click on a row (brief, function 5): it replaces the selection; with Ctrl or Cmd it adds the
   * object or removes it. The selection holds at most 1 000 objects: past that nothing is added, with
   * a notice. Without a map view nothing happens: rows cannot be selected.
   */
  select(id: Uuid, additive: boolean): void {
    const map = this.map;
    if (map === null) return;
    const current = map.selection.value;
    if (!additive) {
      map.selection.set([id]);
    } else if (current.includes(id)) {
      map.selection.set(current.filter((other) => other !== id));
    } else if (current.length >= MAX_SELECTION) {
      this.ctx.notify({ severity: 'warning', message: SELECTION_FULL });
    } else {
      map.selection.set([...current, id]);
    }
  }

  /**
   * A right click on a row (brief, function 6): the shell's object action menu opens with the map's
   * rules. On a selected row the actions apply to the whole selection; an unselected row becomes the
   * selection first. Without a map view the menu opens for the row alone, and has no map actions.
   */
  openMenu(id: Uuid, at: readonly [x: number, y: number]): void {
    const map = this.map;
    let ids: readonly Uuid[] = [id];
    if (map !== null) {
      const current = map.selection.value;
      if (current.includes(id)) ids = current;
      else map.selection.set([id]);
    }
    this.ctx.actions.openMenu(at, { objects: ids });
  }

  /** A double-click on a row (open question 2, decided): the map zooms to the object, also one the map does not hold. */
  zoomTo(id: Uuid): void {
    const map = this.map;
    if (map === null) return;
    map.zoomTo([id]).then(
      ({ missing }) => {
        if (missing.includes(id)) this.ctx.notify({ severity: 'warning', message: 'The object is gone or cannot be shown on this map' });
      },
      (error: unknown) => {
        this.ctx.log.warn('zooming to an object failed', error);
        this.ctx.notify({ severity: 'error', message: 'The map could not zoom to the object' });
      },
    );
  }

  // For useSyncExternalStore.
  readonly subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): ListState => this.current;

  /** Shows the objects of a layer and brings the panel to the front (brief, function 2): the service `emc2.object-list`. */
  open(layerId: Uuid): void {
    // A layer the workspace shown does not hold (another workspace's, or none): nothing opens, the
    // shell says so (function 11). Before the first picture, and between a switch and its picture, nothing is
    // known, so the layer is taken as it is.
    if (this.tracker.state.loaded && !this.awaitingPicture && !this.ownLayers(this.tracker.state).some((l) => l.id === layerId)) {
      this.ctx.notify({ severity: 'warning', message: NOT_IN_WORKSPACE });
      return;
    }
    this.choose(layerId);
    this.showPanel();
  }

  /** Switches the list to another layer (the layer chooser, brief function 1) and reads its first page. */
  choose(layerId: Uuid | null): void {
    this.seq++;
    this.dirty = false;
    this.restore = null;
    this.shown = layerId;
    this.shownName = null;
    this.page = NO_PAGE;
    this.wantedIndex = 0;
    this.lastCount = null;
    if (layerId !== null) this.closedNotice = null;
    this.update(this.tracker.state);
    if (layerId !== null && this.shown === layerId) this.read(0);
  }

  /** Goes to a page (0-based); one past the ends goes to the nearest page. */
  goTo(index: number): void {
    if (this.shown === null) return;
    const last = lastPageIndex(this.page.total, this.pageSize);
    this.read(Math.min(Math.max(0, index), last));
  }

  first(): void {
    this.goTo(0);
  }

  previous(): void {
    this.goTo(this.wantedIndex - 1);
  }

  next(): void {
    this.goTo(this.wantedIndex + 1);
  }

  last(): void {
    this.goTo(lastPageIndex(this.page.total, this.pageSize));
  }

  /** Reads the page that is shown again: the Refresh button and Retry (brief, functions 7 and 8). */
  refresh(): void {
    if (this.shown === null) return;
    this.read(this.wantedIndex);
  }

  private read(index: number): void {
    const layerId = this.shown;
    if (layerId === null) return;
    const seq = ++this.seq;
    this.dirty = false;
    this.wantedIndex = index;
    this.page = { ...this.page, loading: true, error: null };
    this.publish();
    this.query(layerId, index).then(
      (result) => {
        if (seq !== this.seq) return;
        this.arrived(result, index);
      },
      (error: unknown) => {
        if (seq !== this.seq) return;
        const reason = error instanceof Error ? error.message : String(error);
        this.ctx.log.warn('reading a page of the layer failed', error);
        this.page = { ...this.page, loading: false, error: reason };
        this.dirty = false;
        this.publish();
      },
    );
  }

  private query(layerId: Uuid, index: number): Promise<LayerPage> {
    try {
      return this.ctx.objects.queryLayer(layerId, { page: index, pageSize: this.pageSize });
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private arrived(result: LayerPage, index: number): void {
    // Objects were deleted while the user was on a later page: the page is past the end, so read the last one.
    if (result.objects.length === 0 && result.total > 0 && index > 0) {
      this.read(lastPageIndex(result.total, this.pageSize));
      return;
    }
    this.page = { loading: false, read: true, index, objects: result.objects, total: result.total, error: null };
    this.publish();
    if (this.dirty) this.read(this.wantedIndex);
  }

  /** A change to the layer's object count: read the page that is shown again (brief, function 7). */
  private countChanged(): void {
    if (this.page.loading) this.dirty = true;
    else this.read(this.wantedIndex);
  }

  private settingsChanged(): void {
    const size = this.readPageSize();
    if (size === this.pageSize) return;
    // Keep the first object of the page in view.
    const offset = this.page.index * this.pageSize;
    this.pageSize = size;
    if (this.shown !== null) this.read(Math.floor(offset / size));
    else this.publish();
  }

  private readPageSize(): number {
    const { size, bad } = pageSizeOf(this.ctx.settings);
    if (bad) this.ctx.log.warn('the setting pageSize is not a whole number from 1 to 500: using the default');
    return size;
  }

  private derive(state: LayerState): ListState {
    const layers = { ...state, layers: this.ownLayers(state) };
    const layer = this.shown === null ? null : (layers.layers.find((l) => l.id === this.shown) ?? null);
    return {
      ...layers,
      mapView: this.mapStatus,
      layerId: this.shown,
      layer,
      total: this.shown === null ? 0 : (layers.counts.get(this.shown) ?? 0),
      page: this.page,
      pageSize: this.pageSize,
      closedNotice: this.closedNotice,
      selected: this.selected,
      symbols: this.symbols,
      imageSize: this.imageSize,
    };
  }

  private publish(): void {
    this.update(this.tracker.state);
  }

  private update(layers: LayerState): void {
    // Between a switch and its picture the layers held are the old workspace's: no layer is judged gone by them.
    if (this.shown !== null && layers.loaded && !this.awaitingPicture) {
      const layer = this.ownLayers(layers).find((l) => l.id === this.shown);
      if (layer === undefined) {
        // The layer is deleted (or never existed): close the list with a notice (brief, function 8).
        this.closeShown();
      } else {
        this.shownName = layer.name;
        const count = layers.counts.get(layer.id) ?? 0;
        const before = this.lastCount;
        this.lastCount = count;
        if (before !== null && before !== count) this.countChanged();
      }
    }
    this.current = this.derive(layers);
    for (const listener of [...this.listeners]) listener();
  }

  private closeShown(): void {
    this.seq++;
    this.dirty = false;
    this.closedNotice = this.shownName === null ? 'The layer no longer exists' : `The layer "${this.shownName}" was deleted`;
    this.shown = null;
    this.shownName = null;
    this.page = NO_PAGE;
    this.wantedIndex = 0;
    this.lastCount = null;
  }
}
