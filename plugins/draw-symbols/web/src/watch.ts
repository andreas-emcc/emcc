// The plugin's second live picture subscription: a small fixed area round the one selected symbol
// (T-054, owner 2026-10-17). The plugin does not subscribe to the viewport any more: that makes the object store
// read the whole view on every map move and sends every object in it. The layers come from a subscription with
// `objects: false` (see index.tsx); the objects only from here.
import type { Area, LivePicture, Position, Unsubscribe, Uuid } from '@emc2/plugin-sdk';
import type { ObjectTracker } from './tracker.ts';

/** Half the side of the square round the symbol, in metres. */
export const WATCH_HALF_SIDE_M = 1000;
const METRES_PER_DEGREE = 111_320;
/** The centre of an area stays this far from a pole, and the ring's edges never reach one. */
const POLE_LIMIT = 89.999;
const RING_POLE_LIMIT = 89.9999;

/** A longitude brought into -180 to 180. */
function wrapLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * A square of about {@link WATCH_HALF_SIDE_M} metres half side round `position` (lon, lat), as a closed ring with the
 * position inside. The longitude step grows with the latitude and is capped; the ring may cross the antimeridian
 * (the edges are geodesic) and is clamped at the poles.
 */
export function areaAround(position: Position, halfSideMetres = WATCH_HALF_SIDE_M): Area {
  const [lon, rawLat] = position;
  // Not at the pole itself: a ring with two equal vertices has an edge of no length. The centre moves with it, so it stays inside.
  const lat = Math.min(Math.max(rawLat, -POLE_LIMIT), POLE_LIMIT);
  const dLat = halfSideMetres / METRES_PER_DEGREE;
  const dLon = Math.min(dLat / Math.max(Math.cos((lat * Math.PI) / 180), 0.01), 90);
  const south = Math.max(lat - dLat, -RING_POLE_LIMIT);
  const north = Math.min(lat + dLat, RING_POLE_LIMIT);
  const west = wrapLongitude(lon - dLon);
  const east = wrapLongitude(lon + dLon);
  return { ring: [[west, south], [east, south], [east, north], [west, north], [west, south]], inside: [lon, lat] };
}

/** Follows one symbol: one area subscription at a time, whose objects go to the tracker. */
export class AreaWatch {
  private stopSubscription: Unsubscribe | null = null;
  private target: { readonly id: Uuid; readonly position: Position } | null = null;

  constructor(
    private readonly picture: LivePicture,
    private readonly tracker: ObjectTracker,
    /** Called after every snapshot of the area has gone into the tracker. */
    private readonly onSnapshot: () => void = () => undefined,
  ) {}

  /** The symbol being followed, or null. */
  get id(): Uuid | null {
    return this.target?.id ?? null;
  }

  /** Whether the area is the one round exactly this position (so that nothing is subscribed twice). */
  isAround(id: Uuid, position: Position): boolean {
    return this.target?.id === id && this.target.position[0] === position[0] && this.target.position[1] === position[1];
  }

  /** Follows `id` at `position`: replaces an earlier area, whose objects are forgotten. */
  around(id: Uuid, position: Position): void {
    this.release();
    this.target = { id, position };
    this.stopSubscription = this.picture.subscribe(
      {
        snapshot: (snapshot) => {
          this.tracker.objectSnapshot(snapshot);
          this.onSnapshot();
        },
        changes: (batch) => {
          this.tracker.changes(batch);
        },
        area: (change) => {
          this.tracker.area(change);
        },
      },
      { area: areaAround(position) },
    );
  }

  /** Follows nothing: the subscription ends and the objects it brought are forgotten. */
  stop(): void {
    if (this.target === null) return;
    this.release();
    this.tracker.dropObjects();
  }

  private release(): void {
    this.stopSubscription?.();
    this.stopSubscription = null;
    this.target = null;
  }
}
