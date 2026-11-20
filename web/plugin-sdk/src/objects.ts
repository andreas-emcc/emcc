/**
 * Reading objects the browser may not hold (CR-0015 items 8 and 9): by id, and a layer's objects
 * page by page. Both ask the server, independent of the live picture's area of interest and of the
 * layers' local visibility. Any logged-in user may read; access by label comes later (overview
 * section 6).
 *
 * @example
 * const { found, missing } = await ctx.objects.get(map.selection.value);
 * const page = await ctx.objects.queryLayer(layerId, { page: 0, pageSize: 100 });
 */
import type { MapObject, Uuid } from './model.ts';

/** The most ids one `get` may ask for. */
export const MAX_FETCH_IDS = 1000;
/** The largest page of a layer query. */
export const MAX_PAGE_SIZE = 500;
/** The page size when none is given. */
export const DEFAULT_PAGE_SIZE = 100;

export interface FetchResult {
  /** The objects that exist, in the order asked for. */
  readonly found: readonly MapObject[];
  /** The ids that no object has (deleted, or never existed). */
  readonly missing: readonly Uuid[];
}

export interface LayerPage {
  readonly layerId: Uuid;
  /** 0-based. */
  readonly page: number;
  readonly pageSize: number;
  /** The objects of this page, in the order of creation (UUID v7 ids). */
  readonly objects: readonly MapObject[];
  /** All objects of the layer when the page was read. */
  readonly total: number;
}

/**
 * Raised (as a rejected promise) when the server did not answer in time, the connection was lost,
 * the request was invalid, the layer does not exist, or the server was busy (too many queries
 * waiting for this session): try again later.
 */
export class ObjectQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObjectQueryError';
  }
}

export interface Objects {
  /** The objects with these ids, also those the browser does not hold. At most {@link MAX_FETCH_IDS} ids; more rejects. */
  get(ids: readonly Uuid[]): Promise<FetchResult>;
  /**
   * One page of a layer's objects, in the order of creation, also for a layer hidden locally.
   * `pageSize` is 1 to {@link MAX_PAGE_SIZE}, default {@link DEFAULT_PAGE_SIZE}. A page past the end
   * is empty. A layer that does not exist rejects.
   */
  queryLayer(layerId: Uuid, options?: { readonly page?: number; readonly pageSize?: number }): Promise<LayerPage>;
}

/**
 * Checks a layer query's options as the shell does, and returns them complete.
 * Throws {@link ObjectQueryError} for a negative or fractional page, or a page size out of range.
 */
export function layerQueryOptions(options: { readonly page?: number; readonly pageSize?: number } = {}): { readonly page: number; readonly pageSize: number } {
  const page = options.page ?? 0;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(page) || page < 0) throw new ObjectQueryError(`page must be a whole number from 0: ${page}`);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) throw new ObjectQueryError(`pageSize must be 1 to ${MAX_PAGE_SIZE}: ${pageSize}`);
  return { page, pageSize };
}
