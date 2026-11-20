import { useSyncExternalStore } from 'react';
import type { SharedState } from '@emc2/plugin-sdk';

/** A value with change events, as the SDK's `SharedState`. `accept` refuses values that are not allowed. */
export function sharedState<T>(initial: T, accept: (value: T) => boolean = () => true): SharedState<T> {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    get value() {
      return value;
    },
    set(next) {
      if (!accept(next)) throw new Error(`not an allowed value: ${String(next)}`);
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener(next);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The current value of a shared state in a React component. */
export function useSharedState<T>(state: SharedState<T>): T {
  return useSyncExternalStore(
    (onChange) => state.onChange(onChange),
    () => state.value,
  );
}
