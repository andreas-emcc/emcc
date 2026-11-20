/**
 * When a map layer is redrawn after changes (brief function 5, ADR-0017 point 4, spike S2).
 *
 * OpenLayers rebuilds a whole layer's buffers for any change, so the cost is per redraw, not per
 * change. The rule: at most one redraw per layer per cadence period (default 1 s). The first change
 * after a quiet period is drawn at once (in the next task, so changes arriving together are drawn
 * together); changes during the period wait until it ends. A user's own edit therefore appears
 * at once, and a stream of 1 000 changes per second costs one redraw per second.
 */
import type { Uuid } from '@emc2/plugin-sdk';

/** Time and timers, so tests can drive them. */
export interface Clock {
  /** Monotonic milliseconds, for intervals. */
  now(): number;
  /** Milliseconds since 1970 (wall time), for comparing with timestamps such as expiry (brief function 13). */
  wallNow(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const browserClock: Clock = {
  now: () => performance.now(),
  wallNow: () => Date.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    window.clearTimeout(handle as number);
  },
};

interface LayerTiming {
  lastRedraw: number;
  timer: unknown;
}

export class RedrawScheduler {
  private readonly layers = new Map<Uuid, LayerTiming>();

  constructor(
    private readonly clock: Clock,
    private cadenceMs: number,
    private readonly redraw: (layerId: Uuid) => void,
  ) {}

  /** A layer has changes waiting. */
  changed(layerId: Uuid): void {
    let timing = this.layers.get(layerId);
    if (timing === undefined) {
      timing = { lastRedraw: Number.NEGATIVE_INFINITY, timer: null };
      this.layers.set(layerId, timing);
    }
    if (timing.timer !== null) return;
    const delay = Math.max(0, timing.lastRedraw + this.cadenceMs - this.clock.now());
    const t = timing;
    t.timer = this.clock.setTimeout(() => {
      t.timer = null;
      t.lastRedraw = this.clock.now();
      this.redraw(layerId);
    }, delay);
  }

  /** Forgets a layer (deleted, or everything redrawn after a snapshot); a waiting redraw is cancelled. */
  forget(layerId: Uuid): void {
    const timing = this.layers.get(layerId);
    if (timing?.timer != null) this.clock.clearTimeout(timing.timer);
    this.layers.delete(layerId);
  }

  /** A new cadence (a settings change); it applies from the next redraw a layer waits for. */
  setCadence(ms: number): void {
    this.cadenceMs = ms;
  }

  /** Cancels every waiting redraw. */
  dispose(): void {
    for (const id of [...this.layers.keys()]) this.forget(id);
  }
}
