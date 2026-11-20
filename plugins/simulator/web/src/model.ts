// What the panels' models share: an immutable state that React reads with `useSyncExternalStore`,
// and reading the server part while a panel that shows it is mounted (A25).
import { useSyncExternalStore } from 'react';
import type { Unsubscribe } from '@emc2/plugin-sdk';

/** How often the GET endpoints are read while a panel shows them (A25). */
export const READ_EVERY_MS = 1000;

/** A failed command, with a Retry where one may help (A33). */
export interface Failure {
  readonly message: string;
  readonly retry: (() => void) | null;
}

export class Model<S> {
  private readonly listeners = new Set<() => void>();

  constructor(private current: S) {}

  readonly subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): S => this.current;

  protected update(patch: Partial<S>): void {
    this.current = { ...this.current, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}

export function useModel<S>(model: Model<S>): S {
  return useSyncExternalStore(model.subscribe, model.getState);
}

/**
 * Calls `read` at once and then every `intervalMs` while anyone watches, and never while nobody
 * does. A read still running when the next is due is not started twice. `stop` ends the reading
 * every `intervalMs` until the next first watcher; `readNow` still reads once. A later watcher
 * reads at once too, so a panel opened while something else watches (the coverage, function 33)
 * shows fresh values.
 */
export class Watched {
  private watchers = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reading = false;
  private again = false;
  private stopped = false;

  constructor(
    private readonly read: () => Promise<void>,
    private readonly intervalMs: number,
  ) {}

  /** For a panel's effect; returns its cleanup. */
  readonly watch = (): (() => void) => {
    if (this.watchers++ === 0) {
      this.stopped = false;
      this.tick();
      this.timer = setInterval(() => {
        this.tick();
      }, this.intervalMs);
    } else if (!this.stopped) {
      this.readNow();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.watchers === 0) this.clear();
    };
  };

  /** After a refusal (403, A48): reading again would only be refused again, once a second. */
  stop(): void {
    this.stopped = true;
    this.again = false;
    this.clear();
  }

  /** Reads now (after a command, A25); while a read runs, once more when it ends, since it may have started before the command. */
  readNow(): void {
    if (this.reading) this.again = true;
    else this.tick(true);
  }

  private clear(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** `force`: a read asked for (`readNow`), which a stop does not refuse (the review of the view fix). */
  private tick(force = false): void {
    if (this.reading || (this.stopped && !force)) return;
    this.reading = true;
    void this.read().finally(() => {
      this.reading = false;
      if (this.again) {
        this.again = false;
        this.tick(true);
      }
    });
  }
}
