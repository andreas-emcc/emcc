// The part of the live picture this plugin needs: the objects of the area it subscribes to by id,
// and the layers. A snapshot replaces everything (it can come at any time). A change event is
// applied only if it is newer than what is known, so the same event from the live picture and from a
// change outcome is applied once. In area mode (SDK v1) an event for an id we do not hold means
// "add", and an object can go away without a delete: `left` objects are dropped, not deleted.
import type { Actor, AreaChange, ChangeEvent, Layer, MapObject, Snapshot, Unsubscribe, Uuid } from '@emc2/plugin-sdk';

/** What disappeared from the tracker: objects that were deleted, and objects that left the area (not deleted). */
export interface TrackerChange {
  readonly removed: readonly Uuid[];
  /** Who deleted each of the `removed` objects (the delete event's `by`). */
  readonly removedBy: ReadonlyMap<Uuid, Actor>;
  /** The `removed` objects as this tracker held them before the delete. */
  readonly removedObjects: ReadonlyMap<Uuid, MapObject>;
  readonly left: readonly Uuid[];
}

export type TrackerListener = (change: TrackerChange) => void;

export class ObjectTracker {
  private objects = new Map<Uuid, MapObject>();
  private layerById = new Map<Uuid, Layer>();
  /** Deleted ids with the version of their delete, so that a late older event does not bring an object back. */
  private tombstones = new Map<Uuid, number>();
  private readonly listeners = new Set<TrackerListener>();
  private sorted: readonly Layer[] = [];
  loaded = false;

  onChange(listener: TrackerListener): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get(id: Uuid): MapObject | undefined {
    return this.objects.get(id);
  }

  /** The layers, top first: a higher `drawOrder` is on top, and the higher id wins a tie. */
  get layers(): readonly Layer[] {
    return this.sorted;
  }

  /** A snapshot: what the subscription's area holds. Objects we had that it lacks are reported as `left`: we cannot tell a delete from a move out of the area. */
  snapshot(snapshot: Snapshot): void {
    const before = this.objects;
    this.objects = new Map(snapshot.objects.map((o) => [o.id, o]));
    this.layerById = new Map(snapshot.layers.map((l) => [l.id, l]));
    this.tombstones.clear();
    this.loaded = true;
    this.resort();
    this.emit([], new Map(), new Map(), [...before.keys()].filter((id) => !this.objects.has(id)));
  }

  /** The layers alone, from the subscription with `objects: false`: the objects are left as they are. */
  layerSnapshot(snapshot: Pick<Snapshot, 'layers'>): void {
    this.layerById = new Map(snapshot.layers.map((l) => [l.id, l]));
    this.loaded = true;
    this.resort();
    this.emit([], new Map(), new Map(), []);
  }

  /** The objects alone, from the subscription round the selected symbol: the layers are left as they are. */
  objectSnapshot(snapshot: Pick<Snapshot, 'objects'>): void {
    const before = this.objects;
    this.objects = new Map(snapshot.objects.map((o) => [o.id, o]));
    this.tombstones.clear();
    this.emit([], new Map(), new Map(), [...before.keys()].filter((id) => !this.objects.has(id)));
  }

  /** Forgets every object (the subscription that brought them ended). Nothing is reported as left. */
  dropObjects(): void {
    if (this.objects.size === 0 && this.tombstones.size === 0) return;
    this.objects = new Map();
    this.tombstones.clear();
    this.emit([], new Map(), new Map(), []);
  }

  changes(batch: readonly ChangeEvent[]): void {
    const removed: Uuid[] = [];
    const removedBy = new Map<Uuid, Actor>();
    const removedObjects = new Map<Uuid, MapObject>();
    for (const event of batch) this.apply(event, removed, removedBy, removedObjects);
    this.resort();
    this.emit(removed, removedBy, removedObjects, []);
  }

  /** The outcome of one of our own requests, which may arrive before the live picture's event. */
  applyEvent(event: ChangeEvent): void {
    this.changes([event]);
  }

  /** Objects entered the area; objects left it (they were not deleted). */
  area(change: AreaChange): void {
    for (const object of change.entered) {
      const known = this.objects.get(object.id);
      if (known !== undefined && object.version <= known.version) continue;
      const deletedAt = this.tombstones.get(object.id);
      if (deletedAt !== undefined && object.version <= deletedAt) continue;
      this.tombstones.delete(object.id);
      this.objects.set(object.id, object);
    }
    const left = change.left.filter((id) => this.objects.delete(id));
    this.emit([], new Map(), new Map(), left);
  }

  private apply(event: ChangeEvent, removed: Uuid[], removedBy: Map<Uuid, Actor>, removedObjects: Map<Uuid, MapObject>): void {
    if (event.entityType === 'layer') {
      const known = this.layerById.get(event.entityId);
      if (known !== undefined && event.version <= known.version) return;
      if (event.state === null) this.layerById.delete(event.entityId);
      else this.layerById.set(event.entityId, event.state as Layer);
      return;
    }
    const known = this.objects.get(event.entityId);
    if (event.state === null) {
      if (known !== undefined && event.version > known.version) {
        this.objects.delete(event.entityId);
        removed.push(event.entityId);
        removedBy.set(event.entityId, event.by);
        removedObjects.set(event.entityId, known);
      }
      // A delete of an id we do not hold is ignored in area mode, but remembered against a late older event.
      if (known === undefined || event.version > known.version) this.tombstones.set(event.entityId, event.version);
      return;
    }
    if (known !== undefined && event.version <= known.version) return;
    const deletedAt = this.tombstones.get(event.entityId);
    if (deletedAt !== undefined && event.version <= deletedAt) return;
    this.tombstones.delete(event.entityId);
    this.objects.set(event.entityId, event.state as MapObject); // unknown id: it entered the area
  }

  private resort(): void {
    this.sorted = [...this.layerById.values()].sort((a, b) => b.drawOrder - a.drawOrder || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  }

  private emit(removed: readonly Uuid[], removedBy: ReadonlyMap<Uuid, Actor>, removedObjects: ReadonlyMap<Uuid, MapObject>, left: readonly Uuid[]): void {
    for (const listener of [...this.listeners]) listener({ removed, removedBy, removedObjects, left });
  }
}
