// The Sensors panel's model (brief functions 27 to 29 and 36 to 39; A95, A105, A106): the
// simulation's sensors (ground radars and generic sensors) and the channels that take sensor reports, from `GET /sensors`, read every 2 s while the
// panel or the warning watches; sensors are created, changed and removed with `POST /sensors` and
// `POST /sensors/remove` (`plugin.simulator.edit`). The server part decides what is out of an
// output's range (the ACA's R3): the browser only shows its names.
import type { DrawKind, MapView, Polygon, Position, Style, Uuid } from '@emc2/plugin-sdk';
import { Model, Watched } from './model.ts';
import type { Failure } from './model.ts';
import { parseOutputs } from './outputs.ts';
import type { ChannelInfo, Chosen } from './outputs.ts';
import type { SimulatorServer } from './server.ts';

export const SENSORS_EVERY_MS = 2000;

/** Function 36: what type of sensor it is, as `SensorType` names it; fixed when it is made (A5). */
export type SensorKind = 'GROUND_RADAR' | 'GENERIC';

export const KIND_LABELS: Readonly<Record<SensorKind, string>> = { GROUND_RADAR: 'Ground radar', GENERIC: 'Generic sensor' };

/**
 * The types "New sensor" offers (function 36). M6 offers ground radars only (owner, PX, 2026-11-11:
 * no real plugin has an output for a generic sensor yet); the generic sensor's code stays for a later
 * milestone, and with it offered "New sensor" asks for the type. A scenario file's sensor of a type
 * not offered is left out on import and listed (Q52 B).
 */
export const OFFERED_KINDS: readonly SensorKind[] = ['GROUND_RADAR'];

/** The type a stored or scenario sensor's settings name; a ground radar without one (A7). */
export function kindOf(settings: { readonly [key: string]: unknown }): SensorKind {
  return settings['type'] === 'GENERIC' ? 'GENERIC' : 'GROUND_RADAR';
}

/** Function 37's presets (A4; Default from M8, T-191). */
export type Preset = 'default' | 'narrow' | 'medium' | 'wide' | 'custom';

export const PRESET_LABELS: Readonly<Record<Preset, string>> = {
  default: 'Default',
  narrow: 'Narrow wedge',
  medium: 'Medium wedge',
  wide: 'Wide wedge',
  custom: 'Custom',
};

/** A ground radar's Mode (function 50, T-197). */
export type Mode = 'random' | 'systematic';

export const MODE_LABELS: Readonly<Record<Mode, string>> = { random: 'Random', systematic: 'Systematic' };

/**
 * What each preset sets (function 37 from M8, function 50): the three dwell values and the Mode, the
 * Narrow wedge also the Target revisit (null: left as it is). The Wide wedge's depth is the whole band
 * (null here), and follows it (A3).
 */
export const PRESETS: Readonly<Record<Exclude<Preset, 'custom'>, {
  readonly searchWidth: number;
  readonly dwellDepth: number | null;
  readonly dwellInterval: number;
  readonly mode: Mode;
  readonly targetRevisitSeconds: number | null;
}>> = {
  default: { searchWidth: 2, dwellDepth: 20_000, dwellInterval: 0.2, mode: 'random', targetRevisitSeconds: null }, // M7's Narrow wedge (T-191)
  narrow: { searchWidth: 1.7, dwellDepth: 95_000, dwellInterval: 0.1, mode: 'systematic', targetRevisitSeconds: 2 }, // like AFSERS (T-191)
  medium: { searchWidth: 40, dwellDepth: 50_000, dwellInterval: 1, mode: 'random', targetRevisitSeconds: null },
  wide: { searchWidth: 180, dwellDepth: null, dwellInterval: 4, mode: 'random', targetRevisitSeconds: null },
};

/** A sensor's settings, in SI units as the server part keeps them (functions 27 and 36 to 39, generic: JQ). */
export interface SensorSettings {
  readonly type: SensorKind;
  readonly revisitSeconds: number;
  readonly minRange: number;
  readonly maxRange: number;
  readonly startBearing: number;
  readonly endBearing: number;
  readonly detectionProbability: number;
  readonly rangeError: number;
  readonly crossRangeError: number;
  readonly minimumDetectableSpeed: number;
  readonly maxDetections: number;
  readonly mission: string | null;
  readonly detectAll: boolean;
  readonly outputs: readonly string[];
  readonly preset: Preset;
  readonly searchWidth: number;
  readonly dwellDepth: number;
  readonly dwellInterval: number;
  /** Function 50: Random or Systematic. */
  readonly mode: Mode;
  /** Function 50: a found target's own dwell every this many seconds, in Systematic. */
  readonly targetRevisitSeconds: number;
  /** The generic sensor's range, metres. */
  readonly range: number;
  /** The generic sensor's position error, metres, one sigma east and north. */
  readonly positionError: number;
  /** Function 39: four corners in the order drawn, closed, or null. */
  readonly jobArea: Polygon | null;
}

export type NumberSetting = Exclude<keyof SensorSettings, 'type' | 'mission' | 'detectAll' | 'outputs' | 'preset' | 'mode' | 'jobArea'>;

/** Function 27's limits, in SI units; `whole` for a count. */
export const LIMITS: Readonly<Record<NumberSetting, { readonly min: number; readonly max: number; readonly whole?: boolean }>> = {
  revisitSeconds: { min: 1, max: 600 },
  minRange: { min: 0, max: 1_000_000 },
  maxRange: { min: 0, max: 1_000_000 },
  startBearing: { min: 0, max: 360 },
  endBearing: { min: 0, max: 360 },
  detectionProbability: { min: 0, max: 1 },
  rangeError: { min: 0, max: 10_000 },
  crossRangeError: { min: 0, max: 10_000 },
  minimumDetectableSpeed: { min: 0, max: 100 },
  maxDetections: { min: 1, max: 1024, whole: true },
  searchWidth: { min: 1, max: 360 },
  dwellDepth: { min: 1_000, max: 1_000_000 },
  dwellInterval: { min: 0.1, max: 60 },
  targetRevisitSeconds: { min: 0.5, max: 60 },
  range: { min: 100, max: 1_000_000 },
  positionError: { min: 0, max: 10_000 },
};

/** The three values every preset sets (A4): changing one makes it "Custom"; so do the Mode, and the Narrow wedge's Target revisit (function 50). */
export const DWELL_SETTINGS: readonly NumberSetting[] = ['searchWidth', 'dwellDepth', 'dwellInterval'];

/** Function 39's refusal. */
export const FOUR_CORNERS = 'A job area has four corners';

/**
 * The job area a drawing gives (function 39): its ring's four corners in the order drawn, closed, or
 * null when it has not exactly four.
 */
export function jobAreaOf(geometry: { readonly type: string; readonly coordinates?: unknown } | null): Polygon | null {
  if (geometry?.type !== 'Polygon') return null;
  const rings = geometry.coordinates as readonly (readonly Position[])[];
  const ring = (rings[0] ?? []).map((p): Position => [p[0], p[1]]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = first !== undefined && last !== undefined && ring.length > 1 && first[0] === last[0] && first[1] === last[1];
  const corners = closed ? ring.slice(0, -1) : ring;
  if (corners.length !== 4 || first === undefined) return null;
  return { type: 'Polygon', coordinates: [[...corners, [first[0], first[1]]]] };
}

export const MAX_MISSION = 64;

export interface SensorInfo {
  /** The platform track's id, also the sensor's id. */
  readonly platform: Uuid;
  /** The platform's name, or "Ground radar" or "Generic sensor". */
  readonly name: string;
  /** Its track was deleted: it does nothing (function 27). */
  readonly missing: boolean;
  readonly settings: SensorSettings;
  readonly outputs: readonly Chosen[];
  /** CR-0035: the chosen outputs that leave out some of its detected tracks, by name. */
  readonly outOfRange: readonly string[];
}

export interface SensorsState {
  /** Null until the first answer. */
  readonly channels: readonly ChannelInfo[] | null;
  readonly sensors: readonly SensorInfo[];
  readonly running: boolean;
  /** Function 43: the drawn dwells' sequence number on the server, so a change while paused (a reset) is seen; null before the first answer. */
  readonly dwells: number | null;
  /** Whether `gmti.pairing` is declared (function 30). */
  readonly pairing: boolean;
  /** The map's selection, for "New sensor". */
  readonly selection: readonly Uuid[];
  readonly readError: string | null;
  readonly failure: Failure | null;
  readonly busy: boolean;
}

export class SensorsModel extends Model<SensorsState> {
  private readonly watched: Watched;
  private map: MapView | null = null;

  constructor(
    private readonly server: SimulatorServer,
    intervalMs = SENSORS_EVERY_MS,
  ) {
    super({ channels: null, sensors: [], running: false, dwells: null, pairing: false, selection: [], readError: null, failure: null, busy: false });
    this.watched = new Watched(() => this.read(), intervalMs);
  }

  readonly watch = (): (() => void) => this.watched.watch();

  /** Follows the map's selection, for "New sensor" (A106). */
  setMap(map: MapView): void {
    this.map = map;
    this.update({ selection: map.selection.value });
    map.selection.onChange((ids) => {
      this.update({ selection: ids });
    });
  }

  async read(): Promise<void> {
    const answer = await this.server.get('sensors');
    if (!answer.ok) {
      if (answer.status === 403) this.watched.stop();
      this.update({ readError: answer.message });
      return;
    }
    this.apply(answer.body, 'readError');
  }

  /** "New sensor": a sensor of `type` on `platform` with that type's defaults (functions 27, 36 to 38). */
  create(platform: Uuid, type: SensorKind): Promise<boolean> {
    return this.call('sensors', { platform, create: true, type });
  }

  /**
   * Function 39: draws the sensor's job area on the Simulation map, a rectangle or four points, and
   * saves it; a polygon without exactly four corners is refused with "A job area has four corners".
   * False when nothing was saved (cancelled, refused, or no map).
   */
  async drawJobArea(platform: Uuid, kind: Extract<DrawKind, 'rectangle' | 'polygon'>, style: Style): Promise<boolean> {
    if (this.map === null) return false;
    this.update({ failure: null });
    const geometry = await this.map.draw(kind, { style });
    if (geometry === null) return false;
    const jobArea = jobAreaOf(geometry);
    if (jobArea === null) {
      this.update({ failure: { message: FOUR_CORNERS, retry: null } });
      return false;
    }
    return this.call('sensors', { platform, jobArea });
  }

  clearJobArea(platform: Uuid): Promise<boolean> {
    return this.call('sensors', { platform, jobArea: null });
  }

  /** Saves the changed settings of one sensor; the server part refuses a value outside its limits. */
  save(platform: Uuid, settings: Partial<SensorSettings>): Promise<boolean> {
    return this.call('sensors', { platform, ...settings });
  }

  remove(platform: Uuid): Promise<boolean> {
    return this.call('sensors/remove', { platform });
  }

  dismissFailure(): void {
    this.update({ failure: null });
  }

  private async call(path: string, body: { readonly [key: string]: unknown }): Promise<boolean> {
    this.update({ busy: true, failure: null });
    const answer = await this.server.post(path, body);
    if (answer.ok) {
      this.update({ busy: false });
      this.apply(answer.body, 'failure');
    } else {
      this.update({ busy: false, failure: { message: answer.message, retry: answer.retry ? () => void this.call(path, body) : null } });
    }
    this.watched.readNow();
    return answer.ok;
  }

  private apply(body: unknown, problem: 'readError' | 'failure'): void {
    const parsed = parseSensors(body);
    if (parsed === null) {
      const message = 'The server answered something the panel cannot read';
      this.update(problem === 'readError' ? { readError: message } : { failure: { message, retry: null } });
    } else {
      this.update({ ...parsed, readError: null });
    }
  }
}

/** The warning's lines (function 29, KL; A105): one per sensor and output that leaves units out, without numbers. */
export function warnings(state: SensorsState): readonly string[] {
  return state.sensors.flatMap((s) => s.outOfRange.map((output) => `${s.name}: some units are out of range for ${output}`));
}

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseSettings(value: unknown): SensorSettings | null {
  if (!isRecord(value)) return null;
  const numbers: Partial<Record<NumberSetting, number>> = {};
  for (const key of Object.keys(LIMITS) as NumberSetting[]) {
    const n = value[key];
    if (typeof n !== 'number') return null;
    numbers[key] = n;
  }
  const outputs = Array.isArray(value['outputs']) ? value['outputs'].filter((o): o is string => typeof o === 'string') : [];
  const preset = value['preset'];
  const area = value['jobArea'];
  return {
    ...(numbers as Record<NumberSetting, number>),
    type: value['type'] === 'GENERIC' ? 'GENERIC' : 'GROUND_RADAR',
    mission: typeof value['mission'] === 'string' ? value['mission'] : null,
    detectAll: value['detectAll'] === true,
    outputs,
    preset: typeof preset === 'string' && preset in PRESET_LABELS ? (preset as Preset) : 'custom',
    mode: value['mode'] === 'systematic' ? 'systematic' : 'random', // function 50: a sensor without one is Random
    jobArea: isRecord(area) ? jobAreaOf(area as { readonly type: string; readonly coordinates?: unknown }) : null,
  };
}

export function parseSensors(body: unknown): Omit<SensorsState, 'selection' | 'readError' | 'failure' | 'busy'> | null {
  if (!isRecord(body) || !Array.isArray(body['sensors'])) return null;
  const channels = parseOutputs({ channels: body['channels'], chosen: [] })?.channels ?? [];
  const sensors: SensorInfo[] = [];
  for (const s of body['sensors']) {
    if (!isRecord(s) || typeof s['platform'] !== 'string') continue;
    const settings = parseSettings(s['settings']);
    if (settings === null) continue;
    const chosen = parseOutputs({ channels: [], chosen: s['outputs'] })?.chosen ?? [];
    sensors.push({
      platform: s['platform'],
      name: typeof s['name'] === 'string' ? s['name'] : KIND_LABELS[settings.type],
      missing: s['missing'] === true,
      settings,
      outputs: chosen,
      outOfRange: Array.isArray(s['outOfRange']) ? s['outOfRange'].filter((o): o is string => typeof o === 'string') : [],
    });
  }
  const dwells = body['dwells'];
  return { channels, sensors, running: body['running'] === true, dwells: typeof dwells === 'number' ? dwells : null, pairing: body['pairing'] === true };
}
