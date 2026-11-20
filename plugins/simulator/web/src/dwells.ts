// The ground radars' dwells on the Simulation map (brief function 43; T-179; owner, QJ A and Q57 A).
// The server part keeps, per sensor, the drawn set: each dwell index's latest dwell, a revisit's last
// dwell removing the higher ones. This web part reads it from `GET /sensors/dwells` and draws each
// dwell as an overlay `area` beside the coverage (coverage.ts). Not objects: not stored, not sent to
// any output, not in a scenario's file, not picked. For the eye only: up to about a second late.
import type { ArcBand, MapObject, OverlayItem, Uuid } from '@emc2/plugin-sdk';
import { arcBandRings, colourFor, DWELL_CLASS, dwellStyle } from './coverage.ts';
import type { ColourUse } from './coverage.ts';
import { Model } from './model.ts';
import type { SimulatorServer } from './server.ts';

/** About once a second while the simulation runs (function 43). */
export const DWELLS_EVERY_MS = 1000;

export interface DrawnDwell {
  readonly index: number;
  readonly revisit: number;
  readonly time: string;
  readonly area: ArcBand;
}

export interface DwellsState {
  /** The drawn dwells by sensor (its platform's id). */
  readonly sets: ReadonlyMap<Uuid, readonly DrawnDwell[]>;
  /** The server's sequence number of what is held; null before the first answer. */
  readonly seq: number | null;
}

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function arcBandOf(value: unknown): ArcBand | null {
  if (!isRecord(value) || value['type'] !== 'ArcBand') return null;
  const c = value['center'];
  const { innerRadius, outerRadius, startBearing, endBearing } = value;
  if (!Array.isArray(c) || !isNumber(c[0]) || !isNumber(c[1]) || !isNumber(innerRadius) || !isNumber(outerRadius) || !isNumber(startBearing) || !isNumber(endBearing)) return null;
  return { type: 'ArcBand', center: [c[0], c[1]], innerRadius, outerRadius, startBearing, endBearing };
}

/** `GET /sensors/dwells`'s answer, or null when it is not one. */
export function parseDwells(body: unknown): { readonly seq: number; readonly whole: boolean; readonly sets: ReadonlyMap<Uuid, readonly DrawnDwell[]> } | null {
  if (!isRecord(body) || !isNumber(body['seq']) || !Array.isArray(body['sensors'])) return null;
  const sets = new Map<Uuid, readonly DrawnDwell[]>();
  for (const s of body['sensors'] as unknown[]) {
    if (!isRecord(s) || typeof s['platform'] !== 'string' || !Array.isArray(s['dwells'])) return null;
    const dwells: DrawnDwell[] = [];
    for (const d of s['dwells'] as unknown[]) {
      const area = isRecord(d) ? arcBandOf(d['area']) : null;
      if (!isRecord(d) || area === null || !isNumber(d['index']) || !isNumber(d['revisit']) || typeof d['time'] !== 'string') return null;
      dwells.push({ index: d['index'], revisit: d['revisit'], time: d['time'], area });
    }
    sets.set(s['platform'], dwells);
  }
  return { seq: body['seq'], whole: body['whole'] === true, sets };
}

/**
 * Reads the drawn dwells while the overlay draws them: about once a second while the simulation runs,
 * and once after a pause, a reset or a switch back to Simulation. A paused or reset simulation is
 * seen from the sensors' answer, whose `dwells` number is the server's sequence number: a number
 * other than the one held means a change, such as a reset while paused.
 */
export class DwellsModel extends Model<DwellsState> {
  private active = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reading = false;
  private again = false;
  private refused = false;
  /** The sequence number the sensors' answer named when last followed. */
  private sensorsSeq: number | null = null;

  constructor(
    private readonly server: SimulatorServer,
    private readonly intervalMs = DWELLS_EVERY_MS,
  ) {
    super({ sets: new Map(), seq: null });
  }

  /**
   * The overlay's state: whether the dwells are drawn (Simulation shown and "Show dwells" on),
   * whether the simulation runs, and the sensors' answer's sequence number. Idempotent.
   */
  follow(active: boolean, running: boolean, seq: number | null): void {
    if (!active) {
      this.stopTimer();
      if (this.active && this.getState().sets.size > 0) this.update({ sets: new Map() }); // no old dwells when shown again
      this.active = false;
      return;
    }
    const starting = !this.active;
    this.active = true;
    if (starting) this.refused = false; // shown again: a 403 may no longer hold
    if (running && this.timer === null) {
      this.timer = setInterval(() => {
        this.read();
      }, this.intervalMs);
    }
    // A new number in the sensors' answer (each read of it once): a change, such as a reset while paused.
    const changed = seq !== null && seq !== this.sensorsSeq && seq !== this.getState().seq;
    this.sensorsSeq = seq;
    if (!running && this.timer !== null) {
      this.stopTimer();
      this.read(); // once after a pause
      return;
    }
    if (starting || (!running && changed)) this.read(starting);
  }

  /** The overlay's items: one `area` per drawn dwell whose platform is in the picture, in the dwell colour (function 46). */
  items(platformOf: (id: string) => MapObject | undefined, colour: ColourUse): OverlayItem[] {
    const items: OverlayItem[] = [];
    for (const [platform, dwells] of this.getState().sets) {
      const p = platformOf(platform);
      if (p === undefined) continue;
      const style = dwellStyle(colourFor(colour, p.symbol));
      for (const d of dwells) {
        const rings = arcBandRings(d.area);
        // Function 47: hidden by the map view while the user's "Dwell areas" switch is off.
        if (rings !== null) items.push({ kind: 'area', rings, style, displayClass: DWELL_CLASS });
      }
    }
    return items;
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** `whole`: everything, as after a switch back to Simulation. A read asked for while one runs follows it. */
  private read(whole = false): void {
    if (this.refused) return;
    if (this.reading) {
      this.again = true;
      return;
    }
    this.reading = true;
    const seq = this.getState().seq;
    void this.fetch(whole || seq === null ? null : seq).finally(() => {
      this.reading = false;
      if (this.again) {
        this.again = false;
        this.read();
      }
    });
  }

  private async fetch(since: number | null): Promise<void> {
    const answer = await this.server.get(since === null ? 'sensors/dwells' : `sensors/dwells?since=${String(since)}`);
    if (!answer.ok) {
      if (answer.status === 403) {
        this.refused = true; // reading again would only be refused again (A48)
        this.stopTimer();
      }
      return; // 304: nothing changed; otherwise the last drawing stays
    }
    const parsed = parseDwells(answer.body);
    if (parsed === null) return;
    const sets = parsed.whole ? new Map(parsed.sets) : new Map([...this.getState().sets, ...parsed.sets]);
    this.update({ sets, seq: parsed.seq });
  }
}
