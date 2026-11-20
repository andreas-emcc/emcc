// The Ground truth outputs panel's model (brief function 18; from M5 the channels that take ground truth): the output channels other plugins offer, and the
// simulation's choice, from `GET /outputs`; the choice is changed with `POST /outputs`
// (`plugin.simulator.edit`). A chosen channel that is not offered now is missing, not dropped (N8).
import { Model, READ_EVERY_MS, Watched } from './model.ts';
import type { Failure } from './model.ts';
import type { SimulatorServer } from './server.ts';

export interface ChannelInfo {
  /** `plugin/link`. */
  readonly id: string;
  readonly plugin: string;
  readonly name: string;
  readonly outputType: string;
  readonly canDelete: boolean;
  /** The declared fields the channel's protocol uses, as `plugin.name`. */
  readonly fields: readonly string[];
  /** From M5 (function 31): the full id of the channel's field set, or null. */
  readonly fieldSet: string | null;
  /** CR-0035: how deep an area the channel carries, metres, or null for no limit. */
  readonly maxAreaDepth: number | null;
  /** SDK 1.5.0 (CR-0039 point 7): the sensor types it takes, as `SensorType` names them; empty for every type. */
  readonly sensorTypes: readonly string[];
}

/** Function 36: whether a channel takes reports of a sensor of `type` (empty takes every type). */
export function takesType(channel: ChannelInfo, type: string): boolean {
  return channel.sensorTypes.length === 0 || channel.sensorTypes.includes(type);
}

export interface Chosen {
  readonly id: string;
  readonly missing: boolean;
}

export interface OutputsState {
  /** Null until the first answer. */
  readonly channels: readonly ChannelInfo[] | null;
  readonly chosen: readonly Chosen[];
  readonly readError: string | null;
  readonly failure: Failure | null;
  readonly busy: boolean;
}

export class OutputsModel extends Model<OutputsState> {
  private readonly watched: Watched;

  constructor(
    private readonly server: SimulatorServer,
    intervalMs = READ_EVERY_MS,
  ) {
    super({ channels: null, chosen: [], readError: null, failure: null, busy: false });
    this.watched = new Watched(() => this.read(), intervalMs);
  }

  readonly watch = (): (() => void) => this.watched.watch();

  async read(): Promise<void> {
    const answer = await this.server.get('outputs');
    if (!answer.ok) {
      if (answer.status === 403) this.watched.stop();
      this.update({ readError: answer.message });
      return;
    }
    this.apply(answer.body, 'readError');
  }

  /** Chooses or unchooses one channel; the rest of the choice stays. */
  async set(id: string, chosen: boolean): Promise<void> {
    const now = this.getState().chosen.map((c) => c.id);
    const next = chosen ? (now.includes(id) ? now : [...now, id]) : now.filter((c) => c !== id);
    this.update({ busy: true, failure: null });
    const answer = await this.server.post('outputs', { channels: next });
    if (answer.ok) {
      this.update({ busy: false });
      this.apply(answer.body, 'failure');
    } else {
      this.update({ busy: false, failure: { message: answer.message, retry: answer.retry ? () => void this.set(id, chosen) : null } });
    }
    this.watched.readNow();
  }

  dismissFailure(): void {
    this.update({ failure: null });
  }

  private apply(body: unknown, problem: 'readError' | 'failure'): void {
    const parsed = parseOutputs(body);
    if (parsed === null) {
      const message = 'The server answered something the panel cannot read';
      this.update(problem === 'readError' ? { readError: message } : { failure: { message, retry: null } });
    } else {
      this.update({ ...parsed, readError: null });
    }
  }
}

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseOutputs(body: unknown): { readonly channels: readonly ChannelInfo[]; readonly chosen: readonly Chosen[] } | null {
  if (!isRecord(body) || !Array.isArray(body['channels']) || !Array.isArray(body['chosen'])) return null;
  const channels: ChannelInfo[] = [];
  for (const c of body['channels']) {
    if (!isRecord(c) || typeof c['id'] !== 'string' || typeof c['plugin'] !== 'string' || typeof c['name'] !== 'string') continue;
    const fields = Array.isArray(c['fields'])
      ? c['fields'].filter(isRecord).flatMap((f) => (typeof f['plugin'] === 'string' && typeof f['name'] === 'string' ? [`${f['plugin']}.${f['name']}`] : []))
      : [];
    channels.push({
      id: c['id'],
      plugin: c['plugin'],
      name: c['name'],
      outputType: typeof c['outputType'] === 'string' ? c['outputType'] : '',
      canDelete: c['canDelete'] === true,
      fields,
      fieldSet: typeof c['fieldSet'] === 'string' ? c['fieldSet'] : null,
      maxAreaDepth: typeof c['maxAreaDepth'] === 'number' ? c['maxAreaDepth'] : null,
      sensorTypes: Array.isArray(c['sensorTypes']) ? c['sensorTypes'].filter((t): t is string => typeof t === 'string') : [],
    });
  }
  const chosen = body['chosen'].filter(isRecord).flatMap((c) => (typeof c['id'] === 'string' ? [{ id: c['id'], missing: c['missing'] === true }] : []));
  return { channels, chosen };
}
