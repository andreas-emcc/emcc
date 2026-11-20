// Follows the one shape that is open in the edit panel (brief, function 7): a subscription with a
// small fixed area round the shape's centroid, from the moment the shape is opened for editing to
// the moment that ends. The plugin never subscribes by the viewport.
//
// The store sends everything that reaches into the area, and the watch keeps only its own shape.
// The area is renewed (unsubscribe, subscribe) when the shape's centroid leaves the ring: after
// the store reports the shape as `left`, and after our own change that moved it, without waiting.
// A shape the store does not send (clustered in a crowded area, deleted meanwhile) is simply not
// held: the controller then reads it by id.
import type { AreaChange, ChangeEvent, LivePictureListener, LivePictureOptions, MapObject, Position, Snapshot, Unsubscribe, Uuid } from '@emc2/plugin-sdk';
import { areaRound, centroidOf, withinRing } from './geo.ts';

/** The most objects the store sends individually for the area; above it, the rest comes as clusters this plugin ignores. */
export const WATCH_BUDGET = 500;

/** What happened to the followed shape: it was deleted, it left the area (it was not deleted), or neither (a new state: only a repaint). */
export interface WatchChange {
  readonly removed: boolean;
  readonly left: boolean;
}

export type WatchListener = (change: WatchChange) => void;

export type Subscribe = (listener: LivePictureListener, options: LivePictureOptions) => Unsubscribe;

export class GraphicWatch {
  private target: Uuid | null = null;
  private live: MapObject | undefined;
  private centre: Position | null = null;
  private stop: Unsubscribe | null = null;
  /** Counts subscriptions, so that a late callback of an ended one is ignored. */
  private generation = 0;
  private readonly listeners = new Set<WatchListener>();

  constructor(private readonly subscribe: Subscribe) {}

  onChange(listener: WatchListener): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The id being followed, or null. */
  get id(): Uuid | null {
    return this.target;
  }

  /** The newest state the store sent for the followed shape, or undefined if it holds none (not sent yet, clustered, left the area). */
  get object(): MapObject | undefined {
    return this.live;
  }

  /**
   * Starts following `object`, or keeps following it: a second call for the same shape renews the
   * area only if the shape's centroid is no longer inside the ring.
   */
  follow(object: MapObject): void {
    const centroid = centroidOf(object.geometry);
    if (this.target === object.id && this.centre !== null && withinRing(this.centre, centroid)) return;
    if (this.target !== object.id) this.live = undefined;
    this.end();
    this.target = object.id;
    this.centre = centroid;
    const generation = ++this.generation;
    const guarded = <A extends unknown[]>(f: (...args: A) => void) => (...args: A): void => {
      if (generation === this.generation) f(...args);
    };
    this.stop = this.subscribe(
      {
        snapshot: guarded((snapshot: Snapshot) => {
          this.onSnapshot(snapshot);
        }),
        changes: guarded((batch: readonly ChangeEvent[]) => {
          this.onChanges(batch);
        }),
        area: guarded((change: AreaChange) => {
          this.onArea(change);
        }),
      },
      { area: areaRound(centroid), budget: WATCH_BUDGET },
    );
  }

  /** Ends the subscription (the edit ended). */
  release(): void {
    this.end();
    this.target = null;
    this.centre = null;
    this.live = undefined;
  }

  /** The outcome of our own change, which may arrive before the live picture's event. */
  applyEvent(event: ChangeEvent): void {
    this.onChanges([event]);
  }

  private end(): void {
    this.generation++;
    this.stop?.();
    this.stop = null;
  }

  private onSnapshot(snapshot: Snapshot): void {
    const id = this.target;
    if (id === null) return;
    const found = snapshot.objects.find((o) => o.id === id);
    const held = this.live !== undefined;
    this.live = found;
    // Held before, not in the new snapshot: deleted, or not sent any more: the controller finds out by reading it.
    if (found === undefined && held) this.emit({ removed: false, left: true });
    else this.emit({ removed: false, left: false });
    if (found !== undefined) this.follow(found); // the centroid may have moved out of the ring
  }

  private onChanges(batch: readonly ChangeEvent[]): void {
    const id = this.target;
    if (id === null) return;
    for (const event of batch) {
      if (event.entityType !== 'object' || event.entityId !== id) continue;
      if (event.state === null) {
        const known = this.live;
        if (known === undefined || event.version > known.version) {
          this.live = undefined;
          this.emit({ removed: true, left: false });
        }
        continue;
      }
      const state = event.state as MapObject;
      if (this.live !== undefined && state.version <= this.live.version) continue;
      this.live = state; // an id not held means "add"
      this.emit({ removed: false, left: false });
      this.follow(state); // renews the area if the change moved the centroid out of the ring
    }
  }

  private onArea(change: AreaChange): void {
    const id = this.target;
    if (id === null) return;
    const entered = change.entered.find((o) => o.id === id);
    if (entered !== undefined && (this.live === undefined || entered.version > this.live.version)) {
      this.live = entered;
      this.emit({ removed: false, left: false });
    }
    if (change.left.includes(id) && this.live !== undefined) {
      this.live = undefined;
      this.emit({ removed: false, left: true });
    }
  }

  private emit(change: WatchChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }
}
