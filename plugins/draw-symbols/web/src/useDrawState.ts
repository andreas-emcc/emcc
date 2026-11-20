import { useSyncExternalStore } from 'react';
import type { DrawController, DrawState } from './controller.ts';

export function useDrawState(controller: DrawController): DrawState {
  return useSyncExternalStore(controller.subscribe, controller.getState);
}
