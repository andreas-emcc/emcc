/**
 * Listeners and shared values. Listeners belong to other plugins: one that throws is reported and
 * the others still run.
 */
import type { SharedState, Unsubscribe } from '@emc2/plugin-sdk';

export class Emitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  constructor(private readonly onError: (error: unknown) => void) {}

  on(listener: (value: T) => void): Unsubscribe {
    // Wrapped, so the same function registered twice is two listeners and each unsubscribe removes one.
    const entry = (value: T) => {
      listener(value);
    };
    this.listeners.add(entry);
    return () => {
      this.listeners.delete(entry);
    };
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(value);
      } catch (error) {
        this.onError(error);
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}

/** A shared value that tells its listeners only about real changes (`equals`). */
export function createSharedState<T>(initial: T, onError: (error: unknown) => void, equals: (a: T, b: T) => boolean = Object.is): SharedState<T> {
  let value = initial;
  const changes = new Emitter<T>(onError);
  return {
    get value() {
      return value;
    },
    set(next) {
      if (equals(value, next)) return;
      value = next;
      changes.emit(next);
    },
    onChange: (listener) => changes.on(listener),
  };
}

export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
