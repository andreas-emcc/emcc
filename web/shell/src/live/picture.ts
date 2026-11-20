/**
 * The shell's copy of the whole live picture, for the plugins that subscribe without options (SDK
 * v1: without `area`, as in v0; CDA review B4). A late subscriber gets the current state as a
 * snapshot, then the same batches as everyone else. Objects and layers are frozen and shared by
 * reference. Kept only while such a plugin subscribes (its {@link WholeChannel}).
 */
import type { ChangeEvent, Layer, LivePictureListener, MapObject, Snapshot, Unsubscribe } from '@emc2/plugin-sdk';

/** Freezes a parsed JSON value and everything inside it. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** Called when a listener throws; the other listeners still get the message. */
export type ListenerErrorHandler = (error: unknown, during: 'snapshot' | 'changes') => void;

interface Subscription {
  readonly listener: LivePictureListener;
  readonly onError: ListenerErrorHandler;
}

export class Picture {
  private readonly layers = new Map<string, Layer>();
  private readonly objects = new Map<string, MapObject>();
  private sequence = -1;
  private ready = false;
  private current: Snapshot | null = null;
  private readonly subscriptions = new Set<Subscription>();

  /** The sequence number of the last change in the picture; -1 before the first snapshot. */
  get sequenceNo(): number {
    return this.sequence;
  }

  get hasSnapshot(): boolean {
    return this.ready;
  }

  get objectCount(): number {
    return this.objects.size;
  }

  get isEmpty(): boolean {
    return this.subscriptions.size === 0;
  }

  /** Delivers the current state at once if there is one, then every snapshot and batch. */
  subscribe(listener: LivePictureListener, onError: ListenerErrorHandler): Unsubscribe {
    const subscription: Subscription = { listener, onError };
    this.subscriptions.add(subscription);
    if (this.ready) {
      const snapshot = this.snapshot();
      deliver(subscription, 'snapshot', () => { listener.snapshot(snapshot); });
    }
    return () => {
      this.subscriptions.delete(subscription);
    };
  }

  /** Replaces everything (a snapshot from the server). The documents are frozen here. */
  replace(layers: readonly Layer[], objects: readonly MapObject[], sequenceNo: number): void {
    this.layers.clear();
    this.objects.clear();
    for (const layer of layers) this.layers.set(layer.id, deepFreeze(layer));
    for (const object of objects) this.objects.set(object.id, deepFreeze(object));
    this.sequence = sequenceNo;
    this.ready = true;
    this.current = null;
    const snapshot = this.snapshot();
    for (const s of [...this.subscriptions]) deliver(s, 'snapshot', () => { s.listener.snapshot(snapshot); });
  }

  /** Applies a batch that continues the picture without a gap (the channel checks that). */
  apply(events: readonly ChangeEvent[]): void {
    if (events.length === 0) return;
    deepFreeze(events);
    for (const event of events) {
      if (event.entityType === 'object') {
        if (event.state === null) this.objects.delete(event.entityId);
        else this.objects.set(event.entityId, event.state as MapObject);
      } else if (event.state === null) {
        this.layers.delete(event.entityId);
      } else {
        this.layers.set(event.entityId, event.state as Layer);
      }
      this.sequence = event.sequenceNo;
    }
    this.current = null;
    for (const s of [...this.subscriptions]) deliver(s, 'changes', () => { s.listener.changes(events); });
  }

  /** The current state, built once per change. */
  snapshot(): Snapshot {
    this.current ??= Object.freeze({
      layers: Object.freeze([...this.layers.values()]),
      objects: Object.freeze([...this.objects.values()]),
      sequenceNo: this.sequence,
    });
    return this.current;
  }
}

function deliver(subscription: Subscription, during: 'snapshot' | 'changes', call: () => void): void {
  try {
    call();
  } catch (error) {
    subscription.onError(error, during);
  }
}
