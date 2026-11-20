/**
 * The layers as the shell knows them, with their object counts: for the menu's list of overlapping
 * objects (their layers' names), the shared Delete (their workspaces) and Settings › Layers. Kept
 * from a layers-and-counts channel (`objects: false`) of every workspace the user may see
 * (`workspaces: ['*']`; T-080, the layer picker's review F4: Settings is no workspace, so it does
 * not follow the one shown), subscribed when first needed, so that a page that never needs them
 * sends nothing more. The channel exists once the plugins have loaded; until then {@link
 * KnownLayers.ready} resolves at once and tries again at its next call.
 */
import {
  EVERY_WORKSPACE, workspaceOf, type ChangeEvent, type Layer, type LivePictureListener, type LivePictureOptions, type ObjectCounts, type Snapshot,
  type Unsubscribe, type Uuid,
} from '@emc2/plugin-sdk';

export interface LayerSource {
  subscribe(listener: LivePictureListener, onError: (error: unknown) => void, options?: LivePictureOptions): Unsubscribe;
}

/** How long the first {@link KnownLayers.ready} waits for the layers. */
export const FIRST_WAIT_MS = 2_000;

export interface LayersState {
  /** The layers, the top one first (highest draw order; ties by id). */
  readonly layers: readonly Layer[];
  readonly counts: ObjectCounts;
  /** The first snapshot has arrived. */
  readonly arrived: boolean;
  /** Why the layers could not be read, if they could not (review F9). */
  readonly error: string | null;
}

const byDrawOrder = (a: Layer, b: Layer): number => b.drawOrder - a.drawOrder || a.id.localeCompare(b.id);

export class KnownLayers {
  private readonly byId = new Map<Uuid, Layer>();
  private state: LayersState = { layers: [], counts: {}, arrived: false, error: null };
  private readonly listeners = new Set<() => void>();
  private first: Promise<void> | null = null;
  private arrivedNow: (() => void) | null = null;

  constructor(private readonly source: () => LayerSource | null) {}

  readonly subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly getState = (): LayersState => this.state;

  /** Subscribes on the first call; resolves once the layers have arrived, or after {@link FIRST_WAIT_MS}; at once later on. */
  ready(): Promise<void> {
    if (this.first !== null) return this.first;
    const source = this.source();
    if (source === null) return Promise.resolve(); // no channels yet: the next call tries again
    this.first = new Promise<void>((resolve) => {
      this.arrivedNow = resolve;
      setTimeout(resolve, FIRST_WAIT_MS);
    });
    source.subscribe(
      { snapshot: (s) => { this.snapshot(s); }, changes: (b) => { this.changes(b); }, counts: (c) => { this.set({ counts: c }); } },
      (error) => { this.set({ error: error instanceof Error ? error.message : String(error) }); },
      { objects: false, workspaces: [EVERY_WORKSPACE] },
    );
    return this.first;
  }

  /** The workspace of a layer the user may see (`workspaceOf`), or null for one not known. */
  workspaceOf(layerId: Uuid): string | null {
    const layer = this.byId.get(layerId);
    return layer === undefined ? null : workspaceOf(layer);
  }

  name(layerId: Uuid): string | null {
    return this.byId.get(layerId)?.name ?? null;
  }

  layer(layerId: Uuid): Layer | null {
    return this.byId.get(layerId) ?? null;
  }

  private snapshot(snapshot: Snapshot): void {
    this.byId.clear();
    for (const layer of snapshot.layers) this.byId.set(layer.id, layer);
    this.set({ counts: snapshot.objectCounts ?? {}, arrived: true, error: null });
    this.arrivedNow?.();
  }

  private changes(batch: readonly ChangeEvent[]): void {
    let changed = false;
    for (const event of batch) {
      if (event.entityType !== 'layer') continue;
      changed = true;
      if (event.state === null) this.byId.delete(event.entityId);
      else this.byId.set(event.entityId, event.state as Layer);
    }
    if (changed) this.set({});
  }

  private set(change: Partial<LayersState>): void {
    this.state = { ...this.state, ...change, layers: [...this.byId.values()].sort(byDrawOrder) };
    for (const listener of [...this.listeners]) listener();
  }
}
