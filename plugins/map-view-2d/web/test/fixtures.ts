/** Test data and a controllable clock for the core tests. */
import { GENERAL_DATA_TYPE, MANUAL_DATA_SOURCE, type ChangeEvent, type DataType, type DataTypeDefaults, type Geometry, type Layer, type MapObject, type MilSymbol, type Uuid } from '@emc2/plugin-sdk';
import type { Clock } from '../src/core/cadence.ts';

export const LABEL = { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' } as const;
const META = { created: { at: '2026-10-09T08:00:00.000Z', by: { plugin: 'test' } }, modified: { at: '2026-10-09T08:00:00.000Z', by: { plugin: 'test' } } };

/** A UUID-shaped id from a small number, so ids sort like the numbers. */
export function uuid(n: number): Uuid {
  return `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
}

export function layer(n: number, drawOrder = 0, visible = true): Layer {
  return { id: uuid(n), version: 1, meta: META, name: `Layer ${String(n)}`, drawOrder, visible, label: LABEL };
}

export const INFANTRY: MilSymbol = { standard: 'APP-6D', sidc: '10031000001211000000' };

export function symbolObject(n: number, layerId: Uuid, lon: number, lat: number, symbol: MilSymbol = INFANTRY): MapObject {
  return { id: uuid(n), version: 1, meta: META, type: 'core.symbol', dataType: GENERAL_DATA_TYPE, dataSource: MANUAL_DATA_SOURCE, layerId, geometry: { type: 'Point', coordinates: [lon, lat] }, symbol, label: LABEL };
}

export function object(n: number, layerId: Uuid, type: string, geometry: Geometry, extra: Partial<MapObject> = {}): MapObject {
  return { id: uuid(n), version: 1, meta: META, type, dataType: GENERAL_DATA_TYPE, dataSource: MANUAL_DATA_SOURCE, layerId, geometry, label: LABEL, ...extra };
}

let sequence = 0;

/** A change event for an object or layer; `state` null means delete. */
export function event(sequenceNo: number, state: MapObject | Layer | null, entity: { id: Uuid; type: 'object' | 'layer' } | null = null): ChangeEvent {
  const entityId = state?.id ?? entity?.id ?? uuid(0);
  const entityType = entity?.type ?? (state !== null && 'drawOrder' in state ? 'layer' : 'object');
  sequence = sequenceNo;
  return {
    sequenceNo, requestId: uuid(100_000 + sequence), entityType, operation: state === null ? 'delete' : 'update', entityId,
    version: state?.version ?? 2, previousVersion: 1, state, label: LABEL, at: '2026-10-09T08:00:00.000Z', by: { plugin: 'test' },
  };
}

/** A clock whose time only moves when the test says so. */
/** The fake clock's wall time at its start. */
export const WALL_START = Date.parse('2026-10-11T10:00:00Z');

export class FakeClock implements Clock {
  time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.time;
  }

  /** Wall time: 2026-10-11T10:00:00Z when the clock starts, moving with it. */
  wallNow(): number {
    return WALL_START + this.time;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + ms, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** Moves time forward, running due timers in time order. */
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (due === undefined) break;
      this.timers.delete(due[0]);
      this.time = Math.max(this.time, due[1].at);
      due[1].callback();
    }
    this.time = end;
  }

  get pending(): number {
    return this.timers.size;
  }
}

/**
 * Textbook projection formulas (Snyder, "Map Projections: A Working Manual", 1987), written out
 * independently of proj4 and the plugin, so a round trip through the plugin is checked against
 * maths it does not share (review remark N4).
 */
export const textbook = {
  /** EPSG:3857: Mercator on a sphere of radius 6 378 137 m (Snyder 7-1, 7-2). */
  webMercator: (lon: number, lat: number): [number, number] => {
    const a = 6_378_137;
    const rad = Math.PI / 180;
    return [a * lon * rad, a * Math.log(Math.tan(Math.PI / 4 + (lat * rad) / 2))];
  },
  /**
   * EPSG:3031: south polar stereographic on WGS84, true scale at 71° S, central meridian 0°.
   * Snyder's south aspect (p. 161): the north formulas with the signs of φ, λ, φc, λ0, x and y changed.
   */
  polarStereographic3031: (lon: number, lat: number): [number, number] => {
    const a = 6_378_137;
    const f = 1 / 298.257223563;
    const e = Math.sqrt(f * (2 - f));
    const rad = Math.PI / 180;
    const t = (phi: number) => Math.tan(Math.PI / 4 - phi / 2) / ((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi))) ** (e / 2);
    const m = (phi: number) => Math.cos(phi) / Math.sqrt(1 - e * e * Math.sin(phi) ** 2);
    const rho = (a * m(71 * rad) * t(-lat * rad)) / t(71 * rad);
    return [rho * Math.sin(lon * rad), rho * Math.cos(lon * rad)];
  },
  /** EPSG:3413: north polar stereographic on WGS84, true scale at 70° N, central meridian 45° W (Snyder 21-33, 21-34, 15-9, 14-15). */
  polarStereographic3413: (lon: number, lat: number): [number, number] => {
    const a = 6_378_137;
    const f = 1 / 298.257223563;
    const e = Math.sqrt(f * (2 - f));
    const rad = Math.PI / 180;
    const t = (phi: number) => Math.tan(Math.PI / 4 - phi / 2) / ((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi))) ** (e / 2);
    const m = (phi: number) => Math.cos(phi) / Math.sqrt(1 - e * e * Math.sin(phi) ** 2);
    const rho = (a * m(70 * rad) * t(lat * rad)) / t(70 * rad);
    const dLambda = (lon + 45) * rad;
    return [rho * Math.sin(dLambda), -rho * Math.cos(dLambda)];
  },
};

/** A data type whose expired objects fade (as the cot plugin declares it), with its effective behaviour. */
export function cotDataType(behaviour: DataTypeDefaults = { fadeWhenExpired: true }): DataType {
  return { id: 'cot.cot', name: 'CoT', declaredBy: 'cot', defaults: { fadeWhenExpired: true }, behaviour };
}

/** A `cot.cot` track at a position, expiring `expiresInMs` after the fake clock's start. */
export function cotObject(n: number, layerId: Uuid, lon: number, lat: number, expiresInMs: number): MapObject {
  return { ...symbolObject(n, layerId, lon, lat), dataType: 'cot.cot', dataSource: 'tak-north', time: { expires: new Date(WALL_START + expiresInMs).toISOString() } };
}
