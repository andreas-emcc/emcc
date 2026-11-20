// The messages between the main thread and the graphics worker. Types only.
import type { GraphicCatalogEntry, GraphicRenderRequest, GraphicRendering } from '@emc2/plugin-sdk';
import type { GraphicStandard } from './catalogue.ts';

export type ToWorker =
  | { readonly type: 'catalogue'; readonly id: number; readonly standard: GraphicStandard }
  /** The requests of one frame, in one message. */
  | { readonly type: 'render'; readonly items: readonly { readonly id: number; readonly request: GraphicRenderRequest }[] };

export type FromWorker =
  /** Sent once, when mil-sym-ts is loaded: requests' timeouts start from here. */
  | { readonly type: 'ready' }
  | { readonly type: 'catalogue'; readonly id: number; readonly entries: readonly GraphicCatalogEntry[] }
  | { readonly type: 'render'; readonly results: readonly { readonly id: number; readonly rendering: GraphicRendering }[] };
