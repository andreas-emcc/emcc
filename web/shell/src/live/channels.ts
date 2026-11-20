/**
 * The shell's side of the live picture's subscriptions (server/live-picture-protocol.md, version 2):
 * one channel per subscription on the server. Plugins without options share one whole-picture
 * channel, plugins with `objects: false` one layers-and-counts channel, each per set of workspaces;
 * each area subscription has its own channel (SDK v1; spike S3, recommendation 5: the shell does
 * not merge areas).
 *
 * Workspaces (SDK 1.2.0, T-080): a channel names its workspaces when it subscribes. One that follows
 * the workspace shown ({@link Channel.follows}) names that one, and subscribes again at a switch
 * (`LiveSubscriptions.follow`), so that it gets a fresh snapshot of the new workspace. The server leaves out the changes of other
 * workspaces, so a channel's `changes` may skip sequence numbers.
 *
 * A channel assembles its snapshots from their parts and checks that its messages continue without
 * a gap; otherwise it asks for a new snapshot (unsubscribe, subscribe). Documents are frozen here
 * and shared by reference.
 */
import type {
  AreaChange, ChangeEvent, ClusterUpdate, Layer, LivePictureListener, LivePictureOptions, MapObject, MapView, ObjectCounts, Snapshot,
  Unsubscribe, Viewport,
} from '@emc2/plugin-sdk';
import { deepFreeze, Picture, type ListenerErrorHandler } from './picture.ts';
import type { ChannelMessage, SubscribeOptions } from './protocol.ts';
import { hasArea, hold, mustMove, thinRing, type HeldArea } from './viewport.ts';

/** What a channel needs from the connection. */
export interface ChannelHost {
  /** Sends `subscribe` for the channel, if the connection is open and the channel is not subscribed yet. */
  subscribe(channel: Channel): void;
  /** True if the channel is subscribed on the current connection. */
  isSubscribed(channel: Channel): boolean;
  /** Sends a message about the channel, if the connection is open and the channel subscribed. */
  sendArea(channel: Channel, held: HeldArea): void;
  /** Unsubscribes and subscribes again: the channel needs a new snapshot. */
  resubscribe(channel: Channel): void;
  readonly log: Pick<Console, 'warn'>;
}

interface IncomingSnapshot {
  readonly sequenceNo: number;
  readonly layers: readonly Layer[];
  readonly objectCount: number;
  readonly objectCounts: ObjectCounts | undefined;
  readonly objects: MapObject[];
}

/**
 * The workspaces a channel subscribes with: its own (the plugin named them), or the one shown
 * (it follows the workspace shown; `shown` gives it). `['*']`: every one the user may see.
 */
export interface ChannelWorkspaces {
  readonly named: readonly string[] | null;
  readonly shown: () => string;
}

/** The workspaces to subscribe with: those named, or the one shown. */
export const workspacesOf = (w: ChannelWorkspaces): readonly string[] => w.named ?? [w.shown()];

/** One subscription on the server. */
export abstract class Channel {
  /** The last change this channel has been brought up to; -1 while it waits for a snapshot. */
  sequenceNo = -1;
  private incoming: IncomingSnapshot | null = null;
  /** Waiting for the next snapshot ({@link nextSnapshot}). */
  private waiting: (() => void)[] = [];

  constructor(
    readonly id: string,
    protected readonly host: ChannelHost,
    readonly workspaces: ChannelWorkspaces = { named: null, shown: () => 'core.view' },
  ) {}

  /** What to subscribe with, or null while the channel cannot subscribe yet (a viewport not known). */
  abstract options(): SubscribeOptions | null;

  /** True if it follows the workspace shown: it subscribes again at a switch. */
  get follows(): boolean {
    return this.workspaces.named === null;
  }

  /** Resolves when the channel's next snapshot has been delivered (a switch waits for it, step 3). */
  nextSnapshot(): Promise<void> {
    return new Promise((resolve) => { this.waiting.push(resolve); });
  }

  /** True while the channel has had no snapshot since it subscribed: an error about it then means it was not opened. */
  refusedBeforeSnapshot(): boolean {
    return this.sequenceNo < 0 && this.incoming === null;
  }

  /** The connection was lost, or a new snapshot was asked for: everything until the next snapshot is ignored. */
  reset(): void {
    this.sequenceNo = -1;
    this.incoming = null;
  }

  /** The connection was lost: a switch waiting for this channel's snapshot goes on, as one made while disconnected does. */
  disconnected(): void {
    this.endWaiting();
  }

  /** Ends the waiting for a next snapshot that will not come now (the channel closed, the connection lost). */
  protected endWaiting(): void {
    for (const resolve of this.waiting.splice(0)) resolve();
  }

  receive(message: ChannelMessage): void {
    switch (message.type) {
      case 'snapshot-begin':
        this.sequenceNo = -1;
        this.incoming = {
          sequenceNo: message.sequenceNo, layers: message.layers, objectCount: message.objectCount, objectCounts: message.objectCounts, objects: [],
        };
        return;
      case 'snapshot-objects':
        if (this.incoming !== null) for (const object of message.objects) this.incoming.objects.push(object);
        return;
      case 'snapshot-end': {
        const snapshot = this.incoming;
        this.incoming = null;
        if (snapshot === null || snapshot.sequenceNo !== message.sequenceNo || snapshot.objects.length !== snapshot.objectCount) {
          this.host.log.warn(`Live picture: an incomplete snapshot of ${this.id} was dropped; asking for a new one`);
          this.host.resubscribe(this);
          return;
        }
        this.sequenceNo = snapshot.sequenceNo;
        this.snapshot(deepFreeze(snapshot.layers), deepFreeze(snapshot.objects), snapshot.sequenceNo, snapshot.objectCounts);
        for (const resolve of this.waiting.splice(0)) resolve();
        return;
      }
      default:
        if (this.sequenceNo < 0) return; // waiting for a snapshot
        if (message.sequenceNo < this.sequenceNo || (message.type === 'changes' && !this.continues(message.events, message.sequenceNo))) {
          this.host.log.warn(`Live picture: ${this.id} does not continue at ${String(this.sequenceNo + 1)}; asking for a new snapshot`);
          this.host.resubscribe(this);
          return;
        }
        this.update(deepFreeze(message));
        this.sequenceNo = message.sequenceNo;
    }
  }

  /** True if a `changes` batch continues the channel: its events after the last change, in order, up to its sequence number. */
  protected continues(events: readonly ChangeEvent[], sequenceNo: number): boolean {
    let last = this.sequenceNo;
    for (const event of events) {
      if (event.sequenceNo <= last) return false;
      last = event.sequenceNo;
    }
    return last <= sequenceNo;
  }

  protected abstract snapshot(layers: readonly Layer[], objects: readonly MapObject[], sequenceNo: number, counts: ObjectCounts | undefined): void;

  protected abstract update(message: Exclude<ChannelMessage, { type: 'snapshot-begin' | 'snapshot-objects' | 'snapshot-end' }>): void;

  /** The channel is no longer needed: a switch waiting for its snapshot goes on (review, 2). */
  close(): void {
    this.endWaiting();
  }
}

function deliver(onError: ListenerErrorHandler, during: 'snapshot' | 'changes', call: () => void): void {
  try {
    call();
  } catch (error) {
    onError(error, during);
  }
}

/**
 * The whole picture of a set of workspaces, shared by every plugin that subscribes with it and no
 * other options, kept in the shell's {@link Picture}. Its batches continue at the last change in
 * order, and may skip the changes of other workspaces (the base rule).
 */
export class WholeChannel extends Channel {
  readonly picture = new Picture();

  options(): SubscribeOptions {
    return { workspaces: workspacesOf(this.workspaces) };
  }

  protected snapshot(layers: readonly Layer[], objects: readonly MapObject[], sequenceNo: number): void {
    this.picture.replace(layers, objects, sequenceNo);
  }

  protected update(message: Exclude<ChannelMessage, { type: 'snapshot-begin' | 'snapshot-objects' | 'snapshot-end' }>): void {
    if (message.type === 'changes') this.picture.apply(message.events);
  }
}

interface CountsSubscriber {
  readonly listener: LivePictureListener;
  readonly onError: ListenerErrorHandler;
  /** The counts last given to it, as JSON. */
  lastCounts: string;
}

/** Layers and the object count per layer (`objects: false`), kept by the server, shared by every such plugin. */
export class CountsChannel extends Channel {
  private readonly layers = new Map<string, Layer>();
  private perLayer: ObjectCounts = {};
  private ready = false;
  private readonly subscribers = new Set<CountsSubscriber>();

  options(): SubscribeOptions {
    return { objects: false, workspaces: workspacesOf(this.workspaces) };
  }

  get isEmpty(): boolean {
    return this.subscribers.size === 0;
  }

  /** Delivers the current state at once if there is one, then every snapshot and change. */
  add(listener: LivePictureListener, onError: ListenerErrorHandler): Unsubscribe {
    const s: CountsSubscriber = { listener, onError, lastCounts: '' };
    this.subscribers.add(s);
    if (this.ready) this.sendSnapshot(s);
    return () => { this.subscribers.delete(s); };
  }

  /** The counts of every layer, layers without objects included. */
  private counts(): ObjectCounts {
    const counts: Record<string, number> = {};
    for (const id of this.layers.keys()) counts[id] = this.perLayer[id] ?? 0;
    return Object.freeze(counts);
  }

  private sendSnapshot(s: CountsSubscriber): void {
    const counts = this.counts();
    s.lastCounts = JSON.stringify(counts);
    const snapshot: Snapshot = Object.freeze({
      layers: Object.freeze([...this.layers.values()]), objects: Object.freeze([]), sequenceNo: this.sequenceNo, objectCounts: counts,
    });
    deliver(s.onError, 'snapshot', () => { s.listener.snapshot(snapshot); });
  }

  protected snapshot(layers: readonly Layer[], _objects: readonly MapObject[], _sequenceNo: number, counts: ObjectCounts | undefined): void {
    this.layers.clear();
    for (const layer of layers) this.layers.set(layer.id, layer);
    this.perLayer = counts ?? {};
    this.ready = true;
    for (const s of [...this.subscribers]) this.sendSnapshot(s);
  }

  protected update(message: Exclude<ChannelMessage, { type: 'snapshot-begin' | 'snapshot-objects' | 'snapshot-end' }>): void {
    let events: readonly ChangeEvent[] = [];
    if (message.type === 'changes') {
      events = message.events.filter((e) => e.entityType === 'layer');
      for (const e of events) {
        if (e.state === null) this.layers.delete(e.entityId);
        else this.layers.set(e.entityId, e.state as Layer);
      }
    } else if (message.type === 'counts') {
      this.perLayer = message.counts;
    } else {
      return;
    }
    const counts = this.counts();
    const json = JSON.stringify(counts);
    for (const s of [...this.subscribers]) {
      const changed = json !== s.lastCounts;
      s.lastCounts = json;
      deliver(s.onError, 'changes', () => {
        if (events.length > 0) s.listener.changes(events);
        if (changed) s.listener.counts?.(counts);
      });
    }
  }
}

/**
 * One plugin's area subscription. With `area: 'viewport'` it follows the map view: it subscribes once
 * the view is known, and sends the server a new area when the view leaves the one it holds.
 */
export class AreaChannel extends Channel {
  private held: HeldArea | null = null;
  private stopFollowing: Unsubscribe | null = null;
  private closed = false;

  constructor(
    id: string,
    host: ChannelHost,
    private readonly listener: LivePictureListener,
    private readonly onError: ListenerErrorHandler,
    private readonly wanted: LivePictureOptions,
    mapView: () => Promise<MapView>,
    workspaces?: ChannelWorkspaces,
  ) {
    super(id, host, workspaces);
    if (wanted.area === 'viewport') {
      mapView().then((view) => { this.follow(view); }, (error: unknown) => {
        host.log.warn(`Live picture: ${id} follows the viewport, but there is no map view: ${String(error)}`);
      });
    }
  }

  private follow(view: MapView): void {
    if (this.closed) return;
    this.stopFollowing = view.onViewportChange((viewport: Viewport) => { this.viewed(viewport); });
    this.viewed(view.viewport);
  }

  /** A view without an area (a map with no size yet) is not known yet; the first one with an area subscribes. */
  private viewed(viewport: Viewport): void {
    if (!hasArea(viewport)) return;
    const held = this.held;
    const moved = held === null || mustMove(held, viewport);
    if (moved) this.held = hold(viewport);
    if (!this.host.isSubscribed(this)) {
      this.host.subscribe(this);
    } else if (moved && this.held !== null) {
      this.host.sendArea(this, this.held);
    }
  }

  options(): SubscribeOptions | null {
    // A budget the server would refuse is left out (the server's cap applies), so a view cannot resubscribe in a loop.
    const budget = Number.isInteger(this.wanted.budget) && (this.wanted.budget ?? 0) >= 1 ? this.wanted.budget : undefined;
    const area = this.wanted.area;
    if (area === undefined) return null;
    const workspaces = workspacesOf(this.workspaces);
    if (area === 'viewport') {
      const held = this.held;
      if (held === null) return null;
      return { area: held.area, resolution: held.resolution, workspaces, ...(budget === undefined ? {} : { budget }) };
    }
    return { area: { ...area, ring: thinRing(area.ring) }, workspaces, ...(budget === undefined ? {} : { budget }) };
  }

  protected snapshot(layers: readonly Layer[], objects: readonly MapObject[], sequenceNo: number): void {
    const snapshot: Snapshot = Object.freeze({ layers, objects, sequenceNo });
    deliver(this.onError, 'snapshot', () => { this.listener.snapshot(snapshot); });
  }

  protected update(message: Exclude<ChannelMessage, { type: 'snapshot-begin' | 'snapshot-objects' | 'snapshot-end' }>): void {
    switch (message.type) {
      case 'changes':
        if (message.events.length > 0) deliver(this.onError, 'changes', () => { this.listener.changes(message.events); });
        return;
      case 'area-objects': {
        const change: AreaChange = { sequenceNo: message.sequenceNo, entered: message.entered, left: message.left };
        deliver(this.onError, 'changes', () => { this.listener.area?.(change); });
        return;
      }
      case 'clusters': {
        const update: ClusterUpdate = { level: message.level, full: message.full, upsert: message.upsert, remove: message.remove };
        deliver(this.onError, 'changes', () => { this.listener.clusters?.(update); });
        return;
      }
      default:
        return;
    }
  }

  override close(): void {
    super.close();
    this.closed = true;
    this.stopFollowing?.();
    this.stopFollowing = null;
  }
}
