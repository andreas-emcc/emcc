// The routes panel's model (brief functions 14 and 22): the routes' states from `GET /routes`,
// start, pause and reset per route and for all (`plugin.simulator.run`), and each route's end
// behaviour, a change request on the route's extension (A30).
import { changeRequests, OutcomeUnknownError } from '@emc2/plugin-sdk';
import type { Changes, MapObject, MapObjectContent, Uuid } from '@emc2/plugin-sdk';
import { Model, READ_EVERY_MS, Watched } from './model.ts';
import type { Failure } from './model.ts';
import { PLUGIN_ID } from './picture.ts';
import type { SimulationPicture } from './picture.ts';
import type { SimulatorServer } from './server.ts';

export type RunState = 'running' | 'paused' | 'ended';
export type Action = 'start' | 'pause' | 'reset';

export interface RouteProblem {
  /** The point, from 0; null for the whole route. */
  readonly point: number | null;
  readonly message: string;
}

/** A point's values the server part computes (brief function 6); null where it cannot. */
export interface ComputedPoint {
  /** The leg into the point. */
  readonly legMetres: number | null;
  readonly distanceMetres: number | null;
  /** From the route's start. */
  readonly arrivalSeconds: number | null;
  /** m/s. */
  readonly speed: number | null;
  /** Where the speed comes from: typed at the point, from its own time, or from the next point's time. */
  readonly speedFrom: 'typed' | 'time' | 'next-time' | null;
}

/** A route as `GET /routes` serves it (the plugin's README, "Endpoints"). */
export interface RouteInfo {
  readonly id: Uuid;
  readonly version: number;
  readonly name: string;
  readonly state: RunState;
  readonly runnable: boolean;
  readonly problems: readonly RouteProblem[];
  readonly objects: readonly Uuid[];
  readonly lengthMetres: number | null;
  readonly durationSeconds: number | null;
  /** One per point of the route version `version`; empty when the route could not be planned. */
  readonly points: readonly ComputedPoint[];
}

export interface RoutesState {
  /** Null until the first answer. */
  readonly routes: readonly RouteInfo[] | null;
  /** Whether the simulation runs: a route running or stopped at its end. */
  readonly running: boolean;
  /** Why the last read failed, or null. */
  readonly readError: string | null;
  /** The last command or change that failed, or null. */
  readonly failure: Failure | null;
  /** A command or change waits for its answer. */
  readonly busy: boolean;
}

export class RoutesModel extends Model<RoutesState> {
  private readonly watched: Watched;

  constructor(
    private readonly server: SimulatorServer,
    private readonly picture: SimulationPicture,
    private readonly changes: Changes,
    intervalMs = READ_EVERY_MS,
  ) {
    super({ routes: null, running: false, readError: null, failure: null, busy: false });
    this.watched = new Watched(() => this.read(), intervalMs);
  }

  /** For the panel's effect: reads `GET /routes` while it is mounted. */
  readonly watch = (): (() => void) => this.watched.watch();

  async read(): Promise<void> {
    const answer = await this.server.get('routes');
    if (!answer.ok) {
      if (answer.status === 403) this.watched.stop();
      this.update({ readError: answer.message });
      return;
    }
    const parsed = parseRoutes(answer.body);
    if (parsed === null) this.update({ readError: 'The server answered something the panel cannot read' });
    else this.update({ routes: parsed.routes, running: parsed.running, readError: null });
  }

  /** Start, pause or reset one route, or all with `routeId` null. */
  async control(action: Action, routeId: Uuid | null): Promise<void> {
    const path = routeId === null ? `routes/${action}` : `routes/${encodeURIComponent(routeId)}/${action}`;
    this.update({ busy: true, failure: null });
    const answer = await this.server.post(path, {});
    this.update({
      busy: false,
      failure: answer.ok ? null : { message: answer.message, retry: answer.retry ? () => void this.control(action, routeId) : null },
    });
    this.watched.readNow();
  }

  /** Sets a route's end behaviour, from the newest state of the route object (A30). */
  async setEnd(routeId: Uuid, end: 'stop' | 'restart'): Promise<void> {
    const route = this.picture.object(routeId);
    if (route === undefined) {
      this.update({ failure: { message: 'The route no longer exists', retry: null } });
      return;
    }
    const own = route.extensions?.[PLUGIN_ID] ?? {};
    const content: MapObjectContent = { ...contentOf(route), extensions: { ...route.extensions, [PLUGIN_ID]: { ...own, end } } };
    this.update({ busy: true, failure: null });
    try {
      const outcome = await this.changes.submit(changeRequests.updateObject(route, content));
      this.update({
        busy: false,
        failure: outcome.outcome === 'applied' ? null : { message: rejectionMessage(outcome.rejection.code, outcome.rejection.message), retry: null },
      });
    } catch (e) {
      // submit rejects only when no answer came; anything else is a bug, shown rather than lost.
      const message = e instanceof OutcomeUnknownError ? 'No answer from the server; the change may have been made' : `The change failed: ${String(e)}`;
      this.update({ busy: false, failure: { message, retry: null } });
    }
  }

  dismissFailure(): void {
    this.update({ failure: null });
  }
}

/** The content of an object, for an update that replaces it as a whole (model rule 5). */
export function contentOf(object: MapObject): MapObjectContent {
  return {
    type: object.type,
    dataType: object.dataType,
    dataSource: object.dataSource,
    ...(object.time !== undefined ? { time: object.time } : {}),
    layerId: object.layerId,
    geometry: object.geometry,
    ...(object.symbol !== undefined ? { symbol: object.symbol } : {}),
    ...(object.style !== undefined ? { style: object.style } : {}),
    ...(object.properties !== undefined ? { properties: object.properties } : {}),
    label: object.label,
    ...(object.extensions !== undefined ? { extensions: object.extensions } : {}),
  };
}

export function rejectionMessage(code: string, message: string): string {
  return code === 'PERMISSION_DENIED' ? 'You may not change the simulation' : message;
}

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function computedPoint(value: unknown): ComputedPoint {
  const p = isRecord(value) ? value : {};
  const from = p['speedFrom'];
  return {
    legMetres: numberOrNull(p['legMetres']),
    distanceMetres: numberOrNull(p['distanceMetres']),
    arrivalSeconds: numberOrNull(p['arrivalSeconds']),
    speed: numberOrNull(p['speed']),
    speedFrom: from === 'typed' || from === 'time' || from === 'next-time' ? from : null,
  };
}

/** One route of the answer, or null for one the panel cannot read. */
export function parseRoute(value: unknown): RouteInfo | null {
  if (!isRecord(value)) return null;
  const { id, version, name, state, runnable, problems, objects } = value;
  if (typeof id !== 'string' || typeof version !== 'number' || typeof name !== 'string') return null;
  if (state !== 'running' && state !== 'paused' && state !== 'ended') return null;
  return {
    id,
    version,
    name,
    state,
    runnable: runnable === true,
    problems: Array.isArray(problems)
      ? problems.filter(isRecord).map((p) => ({ point: numberOrNull(p['point']), message: typeof p['message'] === 'string' ? p['message'] : 'cannot run' }))
      : [],
    objects: Array.isArray(objects) ? objects.filter((o): o is string => typeof o === 'string') : [],
    lengthMetres: numberOrNull(value['lengthMetres']),
    durationSeconds: numberOrNull(value['durationSeconds']),
    points: Array.isArray(value['points']) ? value['points'].map(computedPoint) : [],
  };
}

export function parseRoutes(body: unknown): { readonly running: boolean; readonly routes: readonly RouteInfo[] } | null {
  if (!isRecord(body) || !Array.isArray(body['routes'])) return null;
  const routes = body['routes'].map(parseRoute).filter((r): r is RouteInfo => r !== null);
  return { running: body['running'] === true, routes };
}
