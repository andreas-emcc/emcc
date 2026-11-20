/**
 * The map view's share of the user's setup (brief function 20, ADR-0031 point 5): the map type,
 * the centre, the zoom, the dim level and the layers' local visibility, as JSON. No OpenLayers.
 */
import type { JsonValue, Position, Uuid } from '@emc2/plugin-sdk';

/** The share's format; a share of another version is not read. */
export const SHARE_VERSION = 1;
/** At most this many layer overrides are kept in a share (inputs are bounded; a share is at most 64 KiB). */
export const MAX_SHARED_LAYERS = 500;
/** The dim level moves in these steps, in percent (owner, 2026-10-17). */
export const DIM_STEP = 10;

export interface MapShare {
  readonly projection: string;
  /** A background provider's id, or null for none (the graticule). */
  readonly background: string | null;
  readonly center: Position;
  /** The zoom as metres per pixel at the centre, the same in every projection. */
  readonly metresPerPixel: number;
  /** Percent, 0 to the highest dim level. */
  readonly dim: number;
  /** The layers whose local visibility differs from their own `visible` field. */
  readonly layers: { readonly [layerId: Uuid]: boolean };
}

export function shareToJson(share: MapShare): JsonValue {
  return {
    v: SHARE_VERSION,
    projection: share.projection,
    background: share.background,
    center: [share.center[0], share.center[1]],
    metresPerPixel: share.metresPerPixel,
    dim: share.dim,
    layers: { ...share.layers },
  };
}

const isNumber = (v: JsonValue | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** The share in `json`, or null if it is not one this version can read. */
export function readShare(json: JsonValue): MapShare | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const o = json as { readonly [key: string]: JsonValue };
  const { projection, background, center, metresPerPixel, dim, layers } = o;
  if (o['v'] !== SHARE_VERSION) return null;
  if (typeof projection !== 'string' || projection.length === 0) return null;
  if (background !== null && typeof background !== 'string') return null;
  if (!Array.isArray(center) || center.length !== 2) return null;
  const [lon, lat] = center as readonly JsonValue[];
  if (!isNumber(lon) || !isNumber(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  if (!isNumber(metresPerPixel) || metresPerPixel <= 0) return null;
  if (!isNumber(dim) || dim < 0 || dim > 100) return null;
  if (typeof layers !== 'object' || layers === null || Array.isArray(layers)) return null;
  const entries = Object.entries(layers as { readonly [id: string]: JsonValue });
  if (entries.length > MAX_SHARED_LAYERS || entries.some(([, v]) => typeof v !== 'boolean')) return null;
  return {
    projection,
    background: background ?? null,
    center: [lon, lat],
    metresPerPixel,
    dim,
    layers: Object.fromEntries(entries) as { readonly [layerId: Uuid]: boolean },
  };
}

/** A dim level the slider can take: a whole step from 0 to the highest level. */
export function dimLevel(percent: number, highest: number): number {
  if (!Number.isFinite(percent)) return 0;
  const top = Math.floor(Math.max(0, highest) / DIM_STEP) * DIM_STEP;
  return Math.min(Math.max(Math.round(percent / DIM_STEP) * DIM_STEP, 0), top);
}
