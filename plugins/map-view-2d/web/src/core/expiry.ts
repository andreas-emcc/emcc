/**
 * Expired objects (brief function 13, model rule 15, ADR-0023 point 7): an object whose data type's
 * effective behaviour has `fadeWhenExpired` is drawn faded from its expiry on. Expiry comes without
 * a change event, so the map view keeps the expiry times of the objects that will fade and checks
 * them as time passes. An object whose data type is not available gets the default behaviour:
 * never faded. Removal is ECore's (the delete arrives as a change event).
 *
 * The fade in steps (brief function 46, CR-0042 option A; SDK 1.7.0): an object whose data type has a
 * `fade` is drawn at `fadeOpacity` in place of the expiry fade, so its expiry fades nothing on top.
 * Its opacity changes without a change event too, so the time of its next step is kept and checked
 * the same way.
 */
import { DEFAULT_BEHAVIOUR, expiresAt, fadeOpacity, type DataType, type DataTypeDefaults, type MapObject, type SteppedFade, type Uuid } from '@emc2/plugin-sdk';

/** The opacity of a faded object, its symbol and its highlight alike (about 40 %). */
export const FADED_OPACITY = 0.4;

/** The opacity an item is drawn at: its own (a stepped fade, brief function 46), else `FADED_OPACITY` when faded, else 1. */
export function itemOpacity(item: { readonly faded?: boolean; readonly opacity?: number }): number {
  return item.opacity ?? (item.faded === true ? FADED_OPACITY : 1);
}

/**
 * When a stepped fade next changes an object's opacity (ms since 1970), or null when it never will: the object has no
 * parsable `time.observed`, or it is invisible already. `opacity` is what `fadeOpacity` gave at `now`.
 */
export function nextFadeStep(object: MapObject, fade: SteppedFade, now: number, opacity: number): number | null {
  const observed = Date.parse(object.time?.observed ?? '');
  if (Number.isNaN(observed) || opacity <= 0) return null;
  const fromMs = fade.fromSeconds * 1000;
  const age = now - observed;
  if (age < fromMs) return observed + fromMs;
  const stepMs = (fade.invisibleAtSeconds - fade.fromSeconds) * 10 * fade.stepPercent; // the SDK's step length, a whole number of ms
  return observed + fromMs + (Math.floor((age - fromMs) / stepMs) + 1) * stepMs;
}

export class ExpiryTracker {
  private behaviours = new Map<string, DataTypeDefaults>();
  /** The stepped fades of the data types that have one (brief function 46). */
  private fades = new Map<string, SteppedFade>();
  /** Objects that will fade: id → expiry time (ms since 1970). */
  private readonly pending = new Map<Uuid, number>();
  /** Objects drawn faded now. */
  private readonly faded = new Set<Uuid>();
  /** Objects of a data type with a stepped fade: id → the opacity they have now. */
  private readonly steps = new Map<Uuid, number>();
  /** The objects whose opacity will step: id → the time of the next step (ms since 1970). */
  private readonly stepPending = new Map<Uuid, number>();

  constructor(dataTypes: readonly DataType[]) {
    this.setDataTypes(dataTypes);
  }

  /** The data types' effective behaviour or fade changed (`onDataTypesChange`); call {@link track} again for every object. */
  setDataTypes(dataTypes: readonly DataType[]): void {
    this.behaviours = new Map(dataTypes.map((d) => [d.id, d.behaviour]));
    this.fades = new Map(dataTypes.flatMap((d): [string, SteppedFade][] => (d.fade === undefined ? [] : [[d.id, d.fade]])));
  }

  /**
   * Whether the object is faded by its expiry at `now` (ms since 1970), remembering when it will fade if it is not yet.
   * An object of a data type with a stepped fade is never faded by its expiry: its opacity is {@link step}.
   */
  track(object: MapObject, now: number): boolean {
    this.pending.delete(object.id);
    const fade = this.fades.get(object.dataType);
    if (fade !== undefined) {
      this.faded.delete(object.id);
      const opacity = fadeOpacity(object, fade, now);
      this.steps.set(object.id, opacity);
      const next = nextFadeStep(object, fade, now, opacity);
      if (next === null) this.stepPending.delete(object.id);
      else this.stepPending.set(object.id, next);
      return false;
    }
    this.steps.delete(object.id);
    this.stepPending.delete(object.id);
    const behaviour = this.behaviours.get(object.dataType) ?? DEFAULT_BEHAVIOUR;
    const at = behaviour.fadeWhenExpired === true ? expiresAt(object, behaviour) : null;
    const time = at === null ? Number.NaN : Date.parse(at);
    if (Number.isNaN(time) || time > now) {
      if (!Number.isNaN(time)) this.pending.set(object.id, time);
      this.faded.delete(object.id);
      return false;
    }
    this.faded.add(object.id);
    return true;
  }

  isFaded(id: Uuid): boolean {
    return this.faded.has(id);
  }

  /** The opacity of an object of a data type with a stepped fade, as tracked; undefined for any other object. */
  step(id: Uuid): number | undefined {
    return this.steps.get(id);
  }

  /** The object is gone (deleted, left the area). */
  forget(id: Uuid): void {
    this.pending.delete(id);
    this.faded.delete(id);
    this.steps.delete(id);
    this.stepPending.delete(id);
  }

  clear(): void {
    this.pending.clear();
    this.faded.clear();
    this.steps.clear();
    this.stepPending.clear();
  }

  /** True while some object will still fade or step, so the clock must be watched. */
  get waiting(): boolean {
    return this.pending.size > 0 || this.stepPending.size > 0;
  }

  /**
   * The objects whose expiry has passed, or whose opacity steps, since the last call: draw them again now. The ones that
   * step are given back to {@link track}, which sets their new opacity and the time of the next step.
   */
  due(now: number): Uuid[] {
    const ids: Uuid[] = [];
    for (const [id, time] of this.pending) {
      if (time > now) continue;
      this.pending.delete(id);
      this.faded.add(id);
      ids.push(id);
    }
    for (const [id, time] of this.stepPending) {
      if (time > now) continue;
      this.stepPending.delete(id);
      ids.push(id);
    }
    return ids;
  }
}
