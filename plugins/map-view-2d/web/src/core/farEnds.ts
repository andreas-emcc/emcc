/**
 * The far ends of relation lines (brief function 41; T-183; owner, Q59 B): the objects a held object's
 * relations name that the map view does not hold, because they lie outside the subscription's area. They
 * are fetched with `ctx.objects.get`, only to be the end of a line: a line stays when the platform is far
 * outside the view. An object that comes into view arrives through the subscription as usual and is no
 * longer a far end.
 *
 * - **Fetched** when a relation names it first, and again every 2 s while a line to it is wanted, so a line
 *   follows the far end at most about 2 s late.
 * - **Forgotten** when no held object names it any more.
 * - **An id the fetch does not return** (deleted, or not visible to the user) is no far end, so no line.
 * - **Bounded:** at most {@link MAX_FAR_ENDS} far ends; the others get no line, and a warning is logged once.
 */
import { MAX_FETCH_IDS, type MapObject, type Objects, type PluginLog, type Uuid } from '@emc2/plugin-sdk';
import type { Clock } from './cadence.ts';

/** How often the far ends are fetched again while lines to them are wanted (brief function 41). */
export const FAR_END_REFRESH_MS = 2000;
/** The most far ends held (brief function 41). */
export const MAX_FAR_ENDS = 1000;

export interface FarEndsOptions {
  /** `ctx.objects`; without it (an older shell) there are no far ends. */
  readonly objects: Pick<Objects, 'get'> | undefined;
  readonly clock: Clock;
  readonly log: PluginLog;
  /** Called when a far end appeared, changed or went: the relation lines are drawn again. */
  readonly changed: () => void;
}

export class FarEnds {
  private readonly held = new Map<Uuid, MapObject>();
  private wanted: ReadonlySet<Uuid> = new Set();
  /** The wanted ids fetched at least once since they were wanted, so that one that is missing is not fetched at every redraw. */
  private readonly asked = new Set<Uuid>();
  private timer: unknown = null;
  private warnedBound = false;
  private warnedFailure = false;
  private disposed = false;

  constructor(private readonly options: FarEndsOptions) {}

  /** The objects held by the map at the last call of `want`, that relations name: one that leaves the area goes on as a far end at once. */
  private near: ReadonlyMap<Uuid, MapObject> = new Map();

  /** The far ends fetched so far, by id. */
  get objects(): ReadonlyMap<Uuid, MapObject> {
    return this.held;
  }

  /**
   * The far ends wanted now: the ids that held objects' relations name and the map does not hold. New ones are
   * fetched at once; the ones no longer wanted are forgotten. `near` are the named objects the map holds: one of them
   * that leaves the area is a far end from then on, with the object the map held, so its line does not go while the
   * fetch is on its way.
   */
  want(ids: ReadonlySet<Uuid>, near: ReadonlyMap<Uuid, MapObject> = new Map()): void {
    if (this.options.objects === undefined || this.disposed) return;
    const before = this.near;
    this.near = near.size > MAX_FAR_ENDS ? new Map([...near].slice(0, MAX_FAR_ENDS)) : near;
    let wanted = ids;
    if (ids.size > MAX_FAR_ENDS) {
      wanted = new Set([...ids].slice(0, MAX_FAR_ENDS));
      if (!this.warnedBound) {
        this.warnedBound = true;
        this.options.log.warn(`relation lines: ${String(ids.size)} objects are far ends; lines to all but ${String(MAX_FAR_ENDS)} of them are not drawn`);
      }
    }
    this.wanted = wanted;
    for (const id of [...this.held.keys()]) if (!wanted.has(id)) this.held.delete(id);
    for (const id of [...this.asked]) if (!wanted.has(id)) this.asked.delete(id);
    const fresh = [...wanted].filter((id) => !this.asked.has(id));
    for (const id of fresh) {
      this.asked.add(id);
      const last = before.get(id);
      if (last !== undefined && !this.held.has(id)) this.held.set(id, last); // it was held by the map a moment ago
    }
    if (fresh.length > 0) void this.fetch(fresh);
    if (wanted.size === 0) this.stop();
    else this.start();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.held.clear();
  }

  private start(): void {
    if (this.timer !== null) return;
    this.timer = this.options.clock.setTimeout(() => {
      this.timer = null;
      if (this.disposed || this.wanted.size === 0) return;
      void this.fetch([...this.wanted]).finally(() => {
        if (!this.disposed && this.wanted.size > 0) this.start();
      });
    }, FAR_END_REFRESH_MS);
  }

  private stop(): void {
    if (this.timer === null) return;
    this.options.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private async fetch(ids: readonly Uuid[]): Promise<void> {
    const objects = this.options.objects;
    if (objects === undefined) return;
    let changed = false;
    for (let from = 0; from < ids.length; from += MAX_FETCH_IDS) {
      let result;
      try {
        result = await objects.get(ids.slice(from, from + MAX_FETCH_IDS));
        this.warnedFailure = false;
      } catch (error) {
        if (!this.warnedFailure) this.options.log.warn('relation lines: the far ends could not be fetched; trying again', error);
        this.warnedFailure = true;
        continue; // the lines keep their last far ends; the next fetch tries again
      }
      if (this.disposed) return;
      for (const object of result.found) {
        if (!this.wanted.has(object.id)) continue; // not wanted any more, or held by the map now
        const before = this.held.get(object.id);
        if (before === undefined || before.version !== object.version) changed = true;
        this.held.set(object.id, object);
      }
      for (const id of result.missing) {
        if (this.held.delete(id)) changed = true;
      }
    }
    if (changed) this.options.changed();
  }
}
