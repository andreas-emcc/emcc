import { useSyncExternalStore } from 'react';
import type { ShapesController, ShapesState } from './controller.ts';

export function useShapesState(controller: ShapesController): ShapesState {
  return useSyncExternalStore(controller.subscribe, controller.getState);
}
