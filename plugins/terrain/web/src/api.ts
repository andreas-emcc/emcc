// The calls to this plugin's own server part (ADR-0030: the browser talks only to the emc2 server).
// Every answer is checked before it is used; an error answer carries the server's reason.
import type { Position } from '@emc2/plugin-sdk';

/** Range and bearing between two points, from the server's geodesy (ADR-0049 point 2). */
export interface RangeResult {
  /** Metres. */
  readonly distance: number;
  /** Degrees from true north at the first point. */
  readonly initialBearing: number;
  /** Degrees from true north at the second point. */
  readonly finalBearing: number;
  /** The final bearing plus 180 degrees, normalised. */
  readonly backBearing: number;
  /** Half way along the geodesic, where the label goes. */
  readonly midpoint: Position;
}

/** A viewshed: the visible ground as areas with holes (ADR-0049 point 8). */
export interface ViewshedResult {
  /** Each area is its rings, the exterior first, each ring closed, in longitude, latitude. */
  readonly areas: readonly (readonly (readonly Position[])[])[];
  readonly level: number;
  /** The DTED cells read. */
  readonly cells: number;
  readonly heightCells: number;
  /** How many times the tolerance was doubled to fit the map's limits. */
  readonly simplified: number;
  readonly leftOut: number;
  readonly partlyWithoutData: boolean;
  readonly millis: number;
  readonly notes: readonly string[];
}

/** What `GET /status` says about the height data. */
export interface HeightStatus {
  readonly state: 'building' | 'ready' | 'notSet' | 'notReadable' | 'noFolders';
  readonly cells: number;
  /** ECore's words for why the folder cannot be read (for example "outside the emcc folder"); empty when there is none. */
  readonly reason: string;
}

/** Why a call failed, in words for the user. */
export class TerrainError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TerrainError';
    this.status = status;
  }
}

export interface ViewshedRequest {
  readonly observer: Position;
  readonly observerHeight: number;
  readonly targetHeight: number;
  readonly maxRange: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TerrainError(`The server's answer has no number "${what}".`, 502);
  return value;
}

function position(value: unknown, what: string): Position {
  if (!Array.isArray(value) || value.length < 2) throw new TerrainError(`The server's answer has no position "${what}".`, 502);
  return [num(value[0], what), num(value[1], what)];
}

/** The reason an error answer carries, or a sentence for the status. */
async function failure(response: Response): Promise<TerrainError> {
  let reason = '';
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body['error'] === 'string') reason = body['error'];
  } catch {
    // an answer without a JSON body: the status says enough
  }
  const text = reason === '' ? '' : reason.charAt(0).toUpperCase() + reason.slice(1) + (/[.!?]$/.test(reason) ? '' : '.');
  switch (response.status) {
    case 401:
      return new TerrainError('You are logged out. Log in again.', 401);
    case 403:
      return new TerrainError('You may not use the terrain tools.', 403);
    case 413:
      return new TerrainError(text === '' ? 'The request is too large.' : text, 413);
    case 504:
      return new TerrainError('The server did not answer in time. The request may have run: try again in a moment.', 504);
    case 503:
      return new TerrainError(text === '' ? 'The server could not answer now. Try again.' : `${text} Try again later.`, 503);
    default:
      return new TerrainError(text === '' ? `The server answered ${String(response.status)}.` : text, response.status);
  }
}

async function post(serverBase: string, path: string, body: unknown, signal: AbortSignal | undefined): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${serverBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new TerrainError('The server cannot be reached.', 0);
  }
  if (!response.ok) throw await failure(response);
  return response.json();
}

/** Range and bearing from `from` to `to`; the server computes it (the web SDK has no geodesy). */
export async function postRange(serverBase: string, from: Position, to: Position, signal?: AbortSignal): Promise<RangeResult> {
  const body = await post(serverBase, 'range', { from: [from[0], from[1]], to: [to[0], to[1]] }, signal);
  if (!isRecord(body)) throw new TerrainError("The server's answer is not an object.", 502);
  return {
    distance: num(body['distance'], 'distance'),
    initialBearing: num(body['initialBearing'], 'initialBearing'),
    finalBearing: num(body['finalBearing'], 'finalBearing'),
    backBearing: num(body['backBearing'], 'backBearing'),
    midpoint: position(body['midpoint'], 'midpoint'),
  };
}

/** The viewshed from an observer's point. */
export async function postViewshed(serverBase: string, request: ViewshedRequest, signal?: AbortSignal): Promise<ViewshedResult> {
  const body = await post(
    serverBase,
    'viewshed',
    {
      observer: [request.observer[0], request.observer[1]],
      observerHeight: request.observerHeight,
      targetHeight: request.targetHeight,
      maxRange: request.maxRange,
    },
    signal,
  );
  if (!isRecord(body) || !Array.isArray(body['areas'])) throw new TerrainError("The server's answer has no areas.", 502);
  const areas = body['areas'].map((area: unknown) => {
    if (!Array.isArray(area)) throw new TerrainError("The server's answer has a bad area.", 502);
    return area.map((ring: unknown) => {
      if (!Array.isArray(ring)) throw new TerrainError("The server's answer has a bad ring.", 502);
      return ring.map((p: unknown) => position(p, 'ring position'));
    });
  });
  const notes = Array.isArray(body['notes']) ? body['notes'].filter((n: unknown): n is string => typeof n === 'string') : [];
  return {
    areas,
    level: num(body['level'], 'level'),
    cells: num(body['cells'], 'cells'),
    heightCells: num(body['heightCells'], 'heightCells'),
    simplified: num(body['simplified'], 'simplified'),
    leftOut: num(body['leftOut'], 'leftOut'),
    partlyWithoutData: body['partlyWithoutData'] === true,
    millis: num(body['millis'], 'millis'),
    notes,
  };
}

/** What the server's index of height data says. */
export async function getHeightStatus(serverBase: string, signal?: AbortSignal): Promise<HeightStatus> {
  let response: Response;
  try {
    response = await fetch(`${serverBase}status`, signal === undefined ? {} : { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new TerrainError('The server cannot be reached.', 0);
  }
  if (!response.ok) throw await failure(response);
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new TerrainError("The server's answer is not an object.", 502);
  const state = body['state'];
  if (state !== 'building' && state !== 'ready' && state !== 'notSet' && state !== 'notReadable' && state !== 'noFolders') {
    throw new TerrainError("The server's answer has an unknown state.", 502);
  }
  const reason = body['reason'];
  return { state, cells: num(body['cells'], 'cells'), reason: typeof reason === 'string' ? reason : '' };
}

/** One band of a height map: the ground from `lowest` up to `highest` metres, as areas with holes. */
export interface HeightMapBand {
  /** 0 is the lowest band. */
  readonly index: number;
  readonly lowest: number;
  readonly highest: number;
  /** Each area is its rings, the exterior first, each ring closed, in longitude, latitude. */
  readonly areas: readonly (readonly (readonly Position[])[])[];
}

/** A height map in a circle (the brief's function 10): 16 equal bands of height, or one band for flat ground. */
export interface HeightMapResult {
  /** From the lowest band to the highest. */
  readonly bands: readonly HeightMapBand[];
  /** The highest ground inside the circle: where, and how high in metres above mean sea level. */
  readonly highestPosition: Position;
  readonly highestHeight: number;
  /** The lowest ground inside the circle, metres above mean sea level. */
  readonly lowest: number;
  readonly level: number;
  readonly cells: number;
  readonly heightCells: number;
  readonly simplified: number;
  readonly leftOut: number;
  readonly partlyWithoutData: boolean;
  readonly millis: number;
  readonly notes: readonly string[];
}

export interface HeightMapRequest {
  readonly center: Position;
  /** Metres. */
  readonly radius: number;
}

function areasOf(value: unknown): (readonly Position[])[][] {
  if (!Array.isArray(value)) throw new TerrainError("The server's answer has no areas.", 502);
  return value.map((area: unknown) => {
    if (!Array.isArray(area)) throw new TerrainError("The server's answer has a bad area.", 502);
    return area.map((ring: unknown) => {
      if (!Array.isArray(ring)) throw new TerrainError("The server's answer has a bad ring.", 502);
      return ring.map((p: unknown) => position(p, 'ring position'));
    });
  });
}

/** The height map of a circle; the server reads the heights and draws the bands' areas. */
export async function postHeightMap(serverBase: string, request: HeightMapRequest, signal?: AbortSignal): Promise<HeightMapResult> {
  const body = await post(serverBase, 'heightmap', { center: [request.center[0], request.center[1]], radius: request.radius }, signal);
  if (!isRecord(body) || !Array.isArray(body['bands']) || body['bands'].length === 0) throw new TerrainError("The server's answer has no bands.", 502);
  const bands = body['bands'].map((band: unknown, at: number): HeightMapBand => {
    if (!isRecord(band)) throw new TerrainError("The server's answer has a bad band.", 502);
    return { index: at, lowest: num(band['lowest'], 'band lowest'), highest: num(band['highest'], 'band highest'), areas: areasOf(band['areas']) };
  });
  const highest = body['highest'];
  if (!isRecord(highest)) throw new TerrainError("The server's answer has no highest point.", 502);
  const notes = Array.isArray(body['notes']) ? body['notes'].filter((n: unknown): n is string => typeof n === 'string') : [];
  return {
    bands,
    highestPosition: position(highest['position'], 'highest position'),
    highestHeight: num(highest['height'], 'highest height'),
    lowest: num(body['lowest'], 'lowest'),
    level: num(body['level'], 'level'),
    cells: num(body['cells'], 'cells'),
    heightCells: num(body['heightCells'], 'heightCells'),
    simplified: num(body['simplified'], 'simplified'),
    leftOut: num(body['leftOut'], 'leftOut'),
    partlyWithoutData: body['partlyWithoutData'] === true,
    millis: num(body['millis'], 'millis'),
    notes,
  };
}
