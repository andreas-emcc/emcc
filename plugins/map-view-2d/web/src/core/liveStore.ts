/**
 * The live picture as the map view holds it (SDK `livePicture.subscribe`): a snapshot replaces
 * everything, then change batches are applied in sequence order. The store itself is updated at
 * once (cheap); what the map must redraw is collected per map layer as a set of object ids, so
 * several changes of one object merge and the latest state wins when the layer is redrawn
 * (brief function 5, spike S2).
 *
 * In area mode (brief function 12, spike S3) a change for an id the store does not hold adds it, a
 * delete for such an id changes nothing, and objects also leave without a delete (`applyArea`).
 */
import type { AreaChange, ChangeEvent, Layer, MapObject, Snapshot, Uuid } from '@emc2/plugin-sdk';

export interface BatchResult {
  /** A layer was created, changed or deleted: the layer list must be redrawn. */
  readonly layersChanged: boolean;
  /** Map layers whose objects changed. */
  readonly dirtyLayers: ReadonlySet<Uuid>;
}

export class LiveStore {
  readonly layers = new Map<Uuid, Layer>();
  readonly objects = new Map<Uuid, MapObject>();
  /** The sequence number the store is consistent with. */
  sequenceNo = -1;
  /** Map layer id → ids of its objects that changed since the layer was last redrawn. */
  private readonly pending = new Map<Uuid, Set<Uuid>>();
  /** Map layer id → number of objects in it (also for layer ids the live picture has no layer for). */
  private readonly counts = new Map<Uuid, number>();

  /** Replaces everything (first state, or after a reconnect or a gap). Nothing is pending afterwards. */
  snapshot(snapshot: Snapshot): void {
    this.layers.clear();
    this.objects.clear();
    this.pending.clear();
    this.counts.clear();
    for (const layer of snapshot.layers) this.layers.set(layer.id, layer);
    for (const object of snapshot.objects) {
      const before = this.objects.get(object.id);
      if (before !== undefined) this.count(before.layerId, -1);
      this.objects.set(object.id, object);
      this.count(object.layerId, 1);
    }
    this.sequenceNo = snapshot.sequenceNo;
  }

  /** Applies a batch. Events the store already has (sequence number not newer) are skipped. */
  apply(batch: readonly ChangeEvent[]): BatchResult {
    let layersChanged = false;
    const dirtyLayers = new Set<Uuid>();
    for (const event of batch) {
      if (event.sequenceNo <= this.sequenceNo) continue;
      this.sequenceNo = event.sequenceNo;
      if (event.entityType === 'layer') {
        if (event.state === null) this.layers.delete(event.entityId);
        else this.layers.set(event.entityId, event.state as Layer);
        layersChanged = true;
        continue;
      }
      const before = this.objects.get(event.entityId);
      if (before !== undefined) {
        this.markDirty(before.layerId, event.entityId, dirtyLayers);
        this.count(before.layerId, -1);
      }
      if (event.state === null) {
        this.objects.delete(event.entityId);
      } else {
        const after = event.state as MapObject;
        this.objects.set(event.entityId, after);
        this.count(after.layerId, 1);
        this.markDirty(after.layerId, event.entityId, dirtyLayers);
      }
    }
    return { layersChanged, dirtyLayers };
  }

  /** Objects that entered or left the subscription's area: the left ones are dropped (they were not deleted). */
  applyArea(change: AreaChange): BatchResult {
    const dirtyLayers = new Set<Uuid>();
    for (const id of change.left) {
      const before = this.objects.get(id);
      if (before === undefined) continue;
      this.markDirty(before.layerId, id, dirtyLayers);
      this.count(before.layerId, -1);
      this.objects.delete(id);
    }
    for (const object of change.entered) {
      const before = this.objects.get(object.id);
      if (before !== undefined) {
        this.markDirty(before.layerId, object.id, dirtyLayers);
        this.count(before.layerId, -1);
      }
      this.objects.set(object.id, object);
      this.count(object.layerId, 1);
      this.markDirty(object.layerId, object.id, dirtyLayers);
    }
    return { layersChanged: false, dirtyLayers };
  }

  private count(layerId: Uuid, delta: number): void {
    const next = (this.counts.get(layerId) ?? 0) + delta;
    if (next > 0) this.counts.set(layerId, next);
    else this.counts.delete(layerId);
  }

  /** Whether objects of the picture name this map layer. */
  holdsObjectsIn(layerId: Uuid): boolean {
    return this.counts.has(layerId);
  }

  /** Ids of map layers that hold objects but are not in the live picture's layers (drawn anyway, criterion 10). */
  unknownLayers(): Uuid[] {
    return [...this.counts.keys()].filter((id) => !this.layers.has(id));
  }

  private markDirty(layerId: Uuid, objectId: Uuid, dirtyLayers: Set<Uuid>): void {
    let ids = this.pending.get(layerId);
    if (ids === undefined) {
      ids = new Set();
      this.pending.set(layerId, ids);
    }
    ids.add(objectId);
    dirtyLayers.add(layerId);
  }

  /** How many objects of a map layer wait to be redrawn. */
  pendingCount(layerId: Uuid): number {
    return this.pending.get(layerId)?.size ?? 0;
  }

  /**
   * Takes what a map layer must redraw: for each changed object, its latest state if it is still
   * in this layer, otherwise `null` (deleted, or moved to another layer).
   */
  takePending(layerId: Uuid): Map<Uuid, MapObject | null> {
    const ids = this.pending.get(layerId);
    this.pending.delete(layerId);
    const result = new Map<Uuid, MapObject | null>();
    for (const id of ids ?? []) {
      const object = this.objects.get(id);
      result.set(id, object !== undefined && object.layerId === layerId ? object : null);
    }
    return result;
  }

  /** All objects grouped by map layer id, in one pass (for redrawing everything after a snapshot). */
  objectsByLayer(): Map<Uuid, MapObject[]> {
    const groups = new Map<Uuid, MapObject[]>();
    for (const object of this.objects.values()) {
      const group = groups.get(object.layerId);
      if (group === undefined) groups.set(object.layerId, [object]);
      else group.push(object);
    }
    return groups;
  }
}
