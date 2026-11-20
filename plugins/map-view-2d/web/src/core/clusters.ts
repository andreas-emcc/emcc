/**
 * Clusters (brief function 12, spike S3): above the budget the server sends the area's dense cells
 * as clusters, a full set after a snapshot and with every new level, then the changed and removed
 * cells per batch. The map view draws each as one marker with its count, split by standard
 * identity, and subtracts locally hidden layers at once with `byLayer`. Clusters are never
 * selectable objects; a click on one zooms in.
 *
 * Known limit (owner, 2026-10-11): `byLayer` and `byIdentity` are separate totals, so when a layer
 * is hidden the count is exact but the identity split is scaled in proportion.
 */
import type { Cluster, ClusterUpdate, Pixel, Position, Uuid } from '@emc2/plugin-sdk';

/** Objects per standard identity, scaled to the drawn count (not necessarily whole numbers). */
export interface IdentityShares {
  readonly friend: number;
  readonly hostile: number;
  readonly neutral: number;
  readonly unknown: number;
}

/** A cluster as the engine draws it: plain data. */
export interface ClusterItem {
  readonly cell: string;
  readonly position: Position;
  /** The objects in the cluster minus those of locally hidden layers. */
  readonly count: number;
  readonly identity: IdentityShares;
}

/** The order of the identity sectors, clockwise from the top. */
export const IDENTITIES = ['friend', 'hostile', 'neutral', 'unknown'] as const;

/** The standard identity colours (APP-6 frame fills): friend blue, hostile red, neutral green, unknown yellow. */
export const IDENTITY_COLOURS = { friend: '#80e0ff', hostile: '#ff8080', neutral: '#aaffaa', unknown: '#ffff80' } as const;

/** Radius of a cluster marker in CSS pixels: grows slowly with the count. */
export function clusterRadius(count: number): number {
  return Math.min(30, 12 + 4 * Math.log10(Math.max(1, count)));
}

/** The count as the marker shows it: whole up to 999, then thousands (1.2k, 15k). */
export function clusterLabel(count: number): string {
  if (count < 1000) return String(Math.round(count));
  if (count < 10_000) return `${(Math.floor(count / 100) / 10).toFixed(1)}k`;
  return `${String(Math.floor(count / 1000))}k`;
}

/** How much a click on a cluster zooms in: two zoom levels. */
export const CLUSTER_ZOOM_FACTOR = 4;

/**
 * A click on a cluster this soon after a cluster zoom is the second click of a double-click and
 * does not zoom again (owner, 2026-10-13, review R2); longer than OpenLayers' double-click window
 * (250 ms).
 */
export const CLUSTER_CLICK_GRACE_MS = 300;

/** The clusters of the subscription, as the server sent them. */
export class ClusterStore {
  private level: number | null = null;
  private readonly cells = new Map<string, Cluster>();

  /** Applies an update; a new level always comes as a full set. */
  apply(update: ClusterUpdate): void {
    if (update.full || update.level !== this.level) this.cells.clear();
    this.level = update.level;
    for (const cell of update.remove) this.cells.delete(cell);
    for (const cluster of update.upsert) this.cells.set(cluster.cell, cluster);
  }

  /** A new snapshot replaces everything; the clusters for it come as a full set. */
  clear(): void {
    this.cells.clear();
    this.level = null;
  }

  get size(): number {
    return this.cells.size;
  }

  /** The clusters to draw: hidden layers subtracted, empty ones left out. */
  visible(isLayerVisible: (layerId: Uuid) => boolean): ClusterItem[] {
    const items: ClusterItem[] = [];
    for (const cluster of this.cells.values()) {
      let hidden = 0;
      for (const [layerId, n] of Object.entries(cluster.byLayer)) if (!isLayerVisible(layerId)) hidden += n;
      const count = Math.max(0, cluster.count - hidden);
      if (count === 0) continue;
      const total = IDENTITIES.reduce((sum, key) => sum + cluster.byIdentity[key], 0);
      const scale = total > 0 ? count / total : 0;
      const identity = total > 0
        ? { friend: cluster.byIdentity.friend * scale, hostile: cluster.byIdentity.hostile * scale, neutral: cluster.byIdentity.neutral * scale, unknown: cluster.byIdentity.unknown * scale }
        : { friend: 0, hostile: 0, neutral: 0, unknown: count };
      items.push({ cell: cluster.cell, position: cluster.position, count, identity });
    }
    return items;
  }
}

/**
 * The cluster under a pixel, or null: the nearest whose marker contains it. `toPixel` gives a
 * position's pixel on the map (null if it is not on it).
 */
export function clusterAt(items: readonly ClusterItem[], pixel: Pixel, toPixel: (position: Position) => Pixel | null): ClusterItem | null {
  let best: ClusterItem | null = null;
  let bestDistance = Infinity;
  for (const item of items) {
    const at = toPixel(item.position);
    if (at === null) continue;
    const distance = Math.hypot(at[0] - pixel[0], at[1] - pixel[1]);
    if (distance <= clusterRadius(item.count) && distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}
