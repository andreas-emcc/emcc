// The layers and the number of objects per layer, kept current from a live picture subscription
// with `objects: false` (brief, function 7): the layers come with the snapshot and the layer change
// events, the counts from the server (`snapshot.objectCounts`, then `counts`). No objects arrive.
// Pure data: no React, no plugin context, so it is tested on its own.
import type { ChangeEvent, Layer, ObjectCounts, Snapshot, Uuid } from '@emc2/plugin-sdk';

/** What the panel shows of the live picture. Immutable: every change makes a new value. */
export interface LayerState {
  /** True once the first snapshot has arrived. */
  readonly loaded: boolean;
  /** All layers, top of the draw order first. */
  readonly layers: readonly Layer[];
  /** Number of objects per layer id over the whole picture, as the server counts them; absent means 0. */
  readonly counts: ReadonlyMap<Uuid, number>;
}

export const EMPTY_STATE: LayerState = { loaded: false, layers: [], counts: new Map() };

/** Follows the live picture: a snapshot replaces everything, layer events and counts update it. */
export class LayerTracker {
  private readonly layers = new Map<Uuid, Layer>();
  private counts: ReadonlyMap<Uuid, number> = new Map();
  private current: LayerState = EMPTY_STATE;

  get state(): LayerState {
    return this.current;
  }

  snapshot(snapshot: Snapshot): LayerState {
    this.layers.clear();
    for (const layer of snapshot.layers) this.layers.set(layer.id, layer);
    this.counts = countsOf(snapshot.objectCounts ?? {});
    return this.publish();
  }

  /** Applies the layer events of a batch. Object events do not arrive with `objects: false`; any that do are ignored. */
  changes(batch: readonly ChangeEvent[]): LayerState {
    for (const event of batch) {
      if (event.entityType !== 'layer') continue;
      if (event.state === null) this.layers.delete(event.entityId);
      else this.layers.set(event.entityId, event.state as Layer);
    }
    return this.publish();
  }

  /** Replaces the counts: the server sends the complete counts after every batch that changed them. */
  objectCounts(counts: ObjectCounts): LayerState {
    this.counts = countsOf(counts);
    return this.publish();
  }

  private publish(): LayerState {
    this.current = { loaded: true, layers: topFirst([...this.layers.values()]), counts: this.counts };
    return this.current;
  }
}

/** Layers with the highest draw order first, ties by id. */
export function topFirst(layers: readonly Layer[]): Layer[] {
  return [...layers].sort((a, b) => b.drawOrder - a.drawOrder || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** Only positive counts are kept, so "absent means 0" holds. */
function countsOf(counts: ObjectCounts): ReadonlyMap<Uuid, number> {
  return new Map(Object.entries(counts).filter(([, n]) => n > 0));
}
