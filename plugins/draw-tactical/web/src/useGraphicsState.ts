import { useSyncExternalStore } from 'react';
import type { GraphicsController, GraphicsState } from './controller.ts';

export function useGraphicsState(controller: GraphicsController): GraphicsState {
  return useSyncExternalStore(controller.subscribe, controller.getState);
}
