/**
 * `ctx.livePicture.subscribe` for every plugin (SDK v1, `LivePictureOptions`): picks the channel.
 *
 * - With `area` (`'viewport'` or a fixed `Area`): a channel of its own, so each plugin gets its own
 *   area and budget (spike S3, recommendation 5).
 * - With `objects: false`: the shared layers-and-counts channel of its workspaces.
 * - Without options: the shared whole-picture channel of its workspaces, as in SDK v0.
 *
 * Workspaces (SDK 1.2.0, ADR-0039; T-080, owner 2026-10-27): without `workspaces` a subscription
 * follows the workspace shown, and gets a fresh snapshot at a switch ({@link
 * LiveSubscriptions.follow}); with them it gets those (`'*'`: every one the user may see, the server
 * leaves out the others) and does not follow. Each set of workspaces has its own shared channels.
 *
 * A shared channel is subscribed on the server while at least one plugin uses it.
 */
import { EVERY_WORKSPACE, VIEW_WORKSPACE, type LivePictureListener, type LivePictureOptions, type MapView, type Unsubscribe } from '@emc2/plugin-sdk';
import { AreaChannel, CountsChannel, WholeChannel, type Channel, type ChannelWorkspaces } from './channels.ts';
import type { LiveConnection } from './connection.ts';
import type { ListenerErrorHandler } from './picture.ts';

/** The key of a set of workspaces: `''` for the one shown (it follows), `'*'`, or the ids in order. */
function keyOf(workspaces: readonly string[] | undefined): string {
  if (workspaces === undefined) return '';
  if (workspaces.includes(EVERY_WORKSPACE)) return EVERY_WORKSPACE;
  return [...new Set(workspaces)].sort().join(',');
}

export class LiveSubscriptions {
  private readonly whole = new Map<string, WholeChannel>();
  private readonly counts = new Map<string, CountsChannel>();
  private readonly areas = new Set<AreaChannel>();
  private channelNumbers = 0;
  private shown: string = VIEW_WORKSPACE;

  /** @param mapView the map view to follow for `area: 'viewport'` (rejects when there is none) */
  constructor(
    private readonly connection: LiveConnection,
    private readonly mapView: () => Promise<MapView>,
  ) {}

  subscribe(listener: LivePictureListener, onError: ListenerErrorHandler, options?: LivePictureOptions): Unsubscribe {
    const key = keyOf(options?.workspaces);
    if (options?.objects === false) {
      const counts = this.counts.get(key) ?? this.open(this.counts, key, (id, w) => new CountsChannel(id, this.connection, w), 'counts');
      const stop = counts.add(listener, onError);
      return () => {
        stop();
        if (counts.isEmpty && this.counts.get(key) === counts) {
          this.connection.close(counts);
          this.counts.delete(key);
        }
      };
    }
    if (options?.area !== undefined) {
      const channel = new AreaChannel(`area-${String(++this.channelNumbers)}`, this.connection, listener, onError, options, this.mapView,
        this.workspacesFor(options.workspaces));
      this.areas.add(channel);
      this.connection.open(channel);
      return () => {
        this.areas.delete(channel);
        this.connection.close(channel);
      };
    }
    const whole = this.whole.get(key) ?? this.open(this.whole, key, (id, w) => new WholeChannel(id, this.connection, w), 'all');
    const stop = whole.picture.subscribe(listener, onError);
    return () => {
      stop();
      if (whole.picture.isEmpty && this.whole.get(key) === whole) {
        this.connection.close(whole);
        this.whole.delete(key);
      }
    };
  }

  /**
   * A switch's third step (SDK `CurrentWorkspace`): every channel that follows the workspace shown
   * subscribes again for `workspace`. Resolves when each that is subscribed has its fresh snapshot.
   */
  follow(workspace: string): Promise<void> {
    this.shown = workspace;
    const following: Channel[] = [...this.whole.values(), ...this.counts.values(), ...this.areas].filter((c) => c.follows);
    const snapshots: Promise<void>[] = [];
    for (const channel of following) {
      if (!this.connection.isSubscribed(channel)) continue; // it subscribes with the new workspace when it can
      snapshots.push(channel.nextSnapshot());
      this.connection.resubscribe(channel);
    }
    return Promise.all(snapshots).then(() => undefined);
  }

  private workspacesFor(named: readonly string[] | undefined): ChannelWorkspaces {
    return { named: named === undefined ? null : [...named], shown: () => this.shown };
  }

  /** A shared channel of a set of workspaces: `all` and `counts` follow the one shown, the others are numbered. */
  private open<C extends Channel>(channels: Map<string, C>, key: string, make: (id: string, w: ChannelWorkspaces) => C, name: string): C {
    const id = key === '' ? name : `${name}-${String(++this.channelNumbers)}`;
    const channel = make(id, this.workspacesFor(key === '' ? undefined : key === EVERY_WORKSPACE ? [EVERY_WORKSPACE] : key.split(',')));
    channels.set(key, channel);
    this.connection.open(channel);
    return channel;
  }
}
