/**
 * SDK 1.4.0 part 5 (CR-0030 part 5, CR-0031 section 3; ADR-0046, ADR-0052): each user's display
 * settings. SDK 1.5.0 part 3 (CR-0039 point 5; T-164): the speed vector in fixed steps of seconds.
 */
import type { RelationKind } from './sets.ts';
import { DISPLAY_CLASS_IDS, type DisplayClass } from './model.ts';

/** The smallest and largest symbol size, CSS pixels (CR-0030 part 5). */
export const SYMBOL_SIZE_MIN = 16;
export const SYMBOL_SIZE_MAX = 96;
/**
 * The longest speed vector, in minutes; 0 hides it.
 *
 * @deprecated SDK 1.5.0 (CR-0039 point 5): the speed vector is one of {@link SPEED_VECTOR_STEPS_SECONDS}.
 * It still bounds a stored `speedVectorMinutes`.
 */
export const SPEED_VECTOR_MAX_MINUTES = 60;

/**
 * SDK 1.5.0 (CR-0039 point 5; T-164): the speed vector's lengths a user chooses from, as the seconds
 * of travel at the object's speed: 5 s, 10 s, 15 s, 30 s, 1, 2, 5, 10, 20 and 30 min. 0 hides it.
 */
export const SPEED_VECTOR_STEPS_SECONDS = Object.freeze([5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800] as const);

/** SDK 1.5.0: a speed vector's length, one of {@link SPEED_VECTOR_STEPS_SECONDS}, or 0 for none. */
export type SpeedVectorSeconds = 0 | (typeof SPEED_VECTOR_STEPS_SECONDS)[number];

/**
 * SDK 1.5.0 (CR-0039 point 5; the owner's Q5 and A1): the step nearest `seconds`: 0 stays 0, any
 * other value becomes the nearest of {@link SPEED_VECTOR_STEPS_SECONDS}, above 30 min 30 min, and a
 * value half-way between two steps the shorter one (15 min becomes 10 min, 25 min 20 min). For
 * stored minutes, pass `minutes * 60`.
 *
 * @example
 * nearestSpeedVectorStep(4 * 60); // 300: 4 min becomes 5 min
 */
export function nearestSpeedVectorStep(seconds: number): SpeedVectorSeconds {
  if (!(seconds > 0)) return 0;
  let best: SpeedVectorSeconds = SPEED_VECTOR_STEPS_SECONDS[0];
  for (const step of SPEED_VECTOR_STEPS_SECONDS) {
    if (Math.abs(step - seconds) < Math.abs(best - seconds)) best = step; // a tie keeps the shorter
  }
  return best;
}

const isStep = (v: unknown): v is SpeedVectorSeconds => v === 0 || (SPEED_VECTOR_STEPS_SECONDS as readonly unknown[]).includes(v);

/**
 * The labels a user may show next to a symbol, a closed list in 1.4.0 (CR-0030 part 5). `name` is
 * the object's `properties.name`, which the map view draws; the others are APP-6 amplifiers, named
 * as in `Modifiers`, which `symbology` draws (owner, Q13, 2026-11-07).
 */
export const LABEL_IDS = [
  'name',
  'uniqueDesignation', 'higherFormation', 'additionalInformation', 'staffComments', 'type',
  'dtg', 'altitudeDepth', 'speed', 'direction',
] as const;

/** A label id. */
export type LabelId = (typeof LABEL_IDS)[number];

/**
 * SDK 1.8.0 (CR-0043 part A; T-163, owner A): the places round a symbol where the map view draws a
 * label, in the display settings window's order.
 */
export const LABEL_PLACES = Object.freeze(['topLeft', 'topRight', 'bottomLeft', 'bottomRight', 'below'] as const);

/** SDK 1.8.0: a place round a symbol. */
export type LabelPlace = (typeof LABEL_PLACES)[number];

/** SDK 1.8.0: each place's name in the display settings window. */
export const LABEL_PLACE_NAMES: Readonly<Record<LabelPlace, string>> = Object.freeze({
  topLeft: 'Top left', topRight: 'Top right', bottomLeft: 'Bottom left', bottomRight: 'Bottom right', below: 'Below',
});

/** SDK 1.8.0: the labels that are text and so go in a place: every label but `direction`, the arrow. */
export const TEXT_LABEL_IDS = Object.freeze(LABEL_IDS.filter((l): l is Exclude<LabelId, 'direction'> => l !== 'direction'));

/** SDK 1.8.0: a label that goes in a place. */
export type TextLabelId = Exclude<LabelId, 'direction'>;

/** SDK 1.8.0: for each place, the label drawn there, or null for nothing. */
export type LabelPlaces = Readonly<Record<LabelPlace, TextLabelId | null>>;

/** SDK 1.8.0: the order in which a 1.7.0 list's text labels other than `name` fill the places. */
const LIST_PLACE_ORDER: readonly LabelPlace[] = ['topRight', 'bottomRight', 'topLeft', 'bottomLeft'];

/**
 * SDK 1.8.0 (CR-0043 part A): the places and the arrow a stored 1.7.0 `labels` list stands for:
 * `name` below; the other text labels fill top right, bottom right, top left and bottom left in the
 * list's order, and those beyond them are dropped. The arrow is always on (owner WZ A, 2026-11-15),
 * whether or not the list has `direction`, so no stored 1.7.0 choice loses the arrow.
 *
 * @example
 * placesFromLabels(['name', 'uniqueDesignation']);
 * // { labelPlaces: { topLeft: null, topRight: 'uniqueDesignation', bottomLeft: null, bottomRight: null, below: 'name' }, directionArrow: true }
 */
export function placesFromLabels(labels: readonly LabelId[]): { readonly labelPlaces: LabelPlaces; readonly directionArrow: boolean } {
  const places: Record<LabelPlace, TextLabelId | null> = { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null, below: null };
  let next = 0;
  for (const l of labels) {
    if (l === 'direction') continue;
    if (l === 'name') places.below = 'name';
    else if (next < LIST_PLACE_ORDER.length) places[LIST_PLACE_ORDER[next++] as LabelPlace] = l;
  }
  return Object.freeze({ labelPlaces: Object.freeze(places), directionArrow: true });
}

/** SDK 1.8.0: the labels `labelPlaces` and the arrow show, as a 1.7.0 list: the placed ones in {@link LABEL_PLACES}' order, then `direction` while the arrow is on. */
export function labelsOfPlaces(labelPlaces: LabelPlaces, directionArrow: boolean): readonly LabelId[] {
  const out: LabelId[] = [];
  for (const place of LABEL_PLACES) {
    const l = labelPlaces[place];
    if (l !== null) out.push(l);
  }
  if (directionArrow) out.push('direction');
  return Object.freeze(out);
}

/**
 * A user's display settings (ADR-0046), as the shell gives them in `ctx.display`: the user's own
 * value for each, else the admin's default (ECore's settings), else, for a relation kind, the kind's
 * `defaultOn` (CR-0031 section 3). So a reader never applies defaults itself.
 */
export interface DisplaySettings {
  /** A symbol's size, whole CSS pixels, {@link SYMBOL_SIZE_MIN} to {@link SYMBOL_SIZE_MAX}. */
  readonly symbolSize: number;
  /**
   * The speed vector's length as the distance covered in this many minutes at the object's speed,
   * along its direction (GD); 0 hides it. Drawn only for objects with both a speed and a direction.
   *
   * @deprecated SDK 1.5.0 (CR-0039 point 5): use {@link DisplaySettings.speedVectorSeconds}. The shell
   * still fills it, as `speedVectorSeconds / 60`, so it may be a fraction (5 s is 1/12) and a
   * reader of it draws the same length.
   */
  readonly speedVectorMinutes: number;
  /**
   * SDK 1.5.0 (CR-0039 point 5; T-164): the speed vector's length as the seconds of travel at the
   * object's speed, along its direction: one of {@link SPEED_VECTOR_STEPS_SECONDS}, or 0 to hide it.
   * Required since the 1.5.0 freeze (the owner's Q49 A); the shell gives it through `resolveDisplay`.
   */
  readonly speedVectorSeconds: SpeedVectorSeconds;
  /**
   * The labels shown, each once. In M5 the drawing follows APP-6's places, not this order: the APP-6
   * amplifiers keep their places, and the map view draws `name` under the symbol (the ACA's R2 on
   * part 5).
   *
   * @deprecated SDK 1.8.0 (CR-0043 part A; the 1.8.0 freeze): read {@link DisplaySettings.labelPlaces}
   * and {@link DisplaySettings.directionArrow}. The shell goes on filling it with the same labels,
   * the placed ones and the arrow's `direction` while it is on, so a reader built for 1.4.0 to 1.7.0
   * sees what is shown. Removed only in a major version.
   */
  readonly labels: readonly LabelId[];
  /**
   * SDK 1.8.0 (CR-0043 part A; T-163, owner A): for each place round a symbol, the label the map view
   * draws there, or null; a label in at most one place. The map view draws them as text and asks
   * `symbology` with `withText` and `labels: []`. Required since the 1.8.0 freeze; the shell gives it
   * through `resolveDisplay`.
   */
  readonly labelPlaces: LabelPlaces;
  /**
   * SDK 1.8.0 (CR-0043 part A; owner A): the direction arrow's own switch, "Direction arrow", on by
   * default. Required since the 1.8.0 freeze; the shell gives it through `resolveDisplay`.
   */
  readonly directionArrow: boolean;
  /**
   * The switch per relation kind (ADR-0051 point 7, ADR-0052): **one value for every kind the loaded
   * plugins declare** (`ctx.relationKinds`), and no other. A user's choice for a kind whose plugin is
   * not loaded stays saved, but is not here (the ACA's R5 on CR-0031).
   */
  readonly relations: Readonly<Record<string, boolean>>;
  /**
   * SDK 1.6.0 (CR-0041 part D; T-182, owner QN B): the switch per display class, "Dwell areas" and
   * "Sensor coverage" ({@link DISPLAY_CLASSES}), one value for each, **on by default** (owner,
   * 2026-11-11). The map view hides what is marked with a class that is off. Required since the 1.6.0
   * freeze; `resolveDisplay` fills it, and a reader uses {@link classShown}.
   */
  readonly classes: Readonly<Record<DisplayClass, boolean>>;
  /**
   * SDK 1.9.0 (CR-0048 section 6; owner YE B, PQ5 A; APP-6 8.1.4.1): the colour of friendly and
   * assumed-friend control measures (tactical graphics), black or blue; absent means black. A viewing
   * choice per user with the admin's default (ADR-0046), like the symbol size. **Optional for good:**
   * `resolveDisplay` gives it when the user or the admin chose one, and leaves it out otherwise, so a
   * display of 1.8.0 is unchanged; a reader takes absent as black ({@link friendlyGraphicColourOf}).
   * APP-6's own colours still win: obstacles stay green and CBRN hatching yellow.
   */
  readonly friendlyGraphicColour?: FriendlyGraphicColour;
}

/** SDK 1.9.0 (CR-0048 section 6): the colours of friendly control measures, black the default. */
export type FriendlyGraphicColour = 'black' | 'blue';

/** SDK 1.9.0: the choices of {@link FriendlyGraphicColour}, in the display window's order, with their labels. */
export const FRIENDLY_GRAPHIC_COLOURS: readonly { readonly id: FriendlyGraphicColour; readonly label: string }[] = Object.freeze([
  Object.freeze({ id: 'black' as const, label: 'Black' }),
  Object.freeze({ id: 'blue' as const, label: 'Blue' }),
]);

/** SDK 1.9.0 (CR-0048 section 6): the colour of friendly control measures a display gives, black when it gives none. */
export function friendlyGraphicColourOf(display: DisplaySettings): FriendlyGraphicColour {
  return display.friendlyGraphicColour ?? 'black';
}

/** SDK 1.9.0: the blue of friendly control measures, PCA-symbology's sensor report blue (the UXA checks it on the looks' maps). */
export const FRIENDLY_GRAPHIC_BLUE = '#0060FF';

/** SDK 1.6.0 (CR-0041 part D): the display classes with their switches' labels, in the window's order. */
export const DISPLAY_CLASSES: readonly { readonly id: DisplayClass; readonly label: string }[] = Object.freeze([
  Object.freeze({ id: 'dwell-area' as const, label: 'Dwell areas' }),
  Object.freeze({ id: 'sensor-coverage' as const, label: 'Sensor coverage' }),
]);

/** SDK 1.6.0: whether things of `displayClass` are shown; with no class, true. */
export function classShown(display: DisplaySettings, displayClass: DisplayClass | undefined): boolean {
  return displayClass === undefined || display.classes[displayClass];
}

/**
 * The SDK's defaults, which the admin's start from (CR-0030 part 5): size 30, no speed vector,
 * `name`, `uniqueDesignation` and `direction` (owner, JF (Q14), 2026-11-07: so symbols keep today's
 * direction arrow), and no relation kinds (each kind's own default is its `defaultOn`).
 */
export const DEFAULT_DISPLAY: DisplaySettings = Object.freeze({
  symbolSize: 30,
  speedVectorMinutes: 0,
  speedVectorSeconds: 0,
  labels: Object.freeze(['name', 'uniqueDesignation', 'direction'] as const),
  // SDK 1.8.0 (CR-0043 part A): the same, by place
  labelPlaces: Object.freeze({ topLeft: null, topRight: 'uniqueDesignation', bottomLeft: null, bottomRight: null, below: 'name' } as const),
  directionArrow: true,
  relations: Object.freeze({}),
  classes: Object.freeze({ 'dwell-area': true, 'sensor-coverage': true }),
});

/** The parts of the display settings a user or an admin has set; each one may be left out. */
export interface DisplayChoices {
  readonly symbolSize?: number;
  /**
   * Whole minutes, 0 to {@link SPEED_VECTOR_MAX_MINUTES}: what 1.4.0 stored.
   *
   * @deprecated SDK 1.5.0: use `speedVectorSeconds`. A stored value is read as its nearest step
   * ({@link nearestSpeedVectorStep}), and `speedVectorSeconds` wins when both are given.
   */
  readonly speedVectorMinutes?: number;
  /** SDK 1.5.0 (CR-0039 point 5): one of {@link SPEED_VECTOR_STEPS_SECONDS}, or 0. */
  readonly speedVectorSeconds?: SpeedVectorSeconds;
  /**
   * A 1.7.0 list. Never together with `labelPlaces` or `directionArrow`.
   *
   * @deprecated SDK 1.8.0 (the 1.8.0 freeze): store `labelPlaces` and `directionArrow`. A stored list
   * is still read, by {@link placesFromLabels} (the arrow on, owner WZ A).
   */
  readonly labels?: readonly LabelId[];
  /** SDK 1.8.0 (CR-0043 part A): the places set; a place left out has no label. */
  readonly labelPlaces?: Readonly<Partial<Record<LabelPlace, TextLabelId | null>>>;
  /** SDK 1.8.0: the direction arrow's switch. */
  readonly directionArrow?: boolean;
  /** May hold kinds that are not loaded now: they are kept, and ignored. */
  readonly relations?: Readonly<Record<string, boolean>>;
  /** SDK 1.6.0 (CR-0041 part D): switches per display class; only known classes. */
  readonly classes?: Readonly<Partial<Record<DisplayClass, boolean>>>;
  /** SDK 1.9.0 (CR-0048 section 6): black or blue friendly control measures. */
  readonly friendlyGraphicColour?: FriendlyGraphicColour;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const wholeIn = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/**
 * Why `value` is not well-formed display choices (each part optional), or null: the size and the
 * minutes whole numbers within their limits; known labels, each once; relation switches booleans.
 * ECore and the shell refuse what this refuses; the shell uses it on a user's and an admin's values.
 */
export function displayChoicesProblem(value: unknown): string | null {
  if (!isObject(value)) return 'display settings are an object';
  for (const key of Object.keys(value)) {
    if (!['symbolSize', 'speedVectorMinutes', 'speedVectorSeconds', 'labels', 'labelPlaces', 'directionArrow', 'relations', 'classes', 'friendlyGraphicColour'].includes(key)) return `unknown display setting: ${key}`;
  }
  // SDK 1.8.0 (CR-0043 part A): a stored 1.7.0 list, or the places and the arrow, never both
  if ('labels' in value && ('labelPlaces' in value || 'directionArrow' in value)) return 'labels is not stored together with labelPlaces or directionArrow';
  if ('labelPlaces' in value) {
    const places = value.labelPlaces;
    if (!isObject(places)) return 'labelPlaces maps a place to a label or null';
    const seen = new Set<unknown>();
    for (const [place, l] of Object.entries(places)) {
      if (!(LABEL_PLACES as readonly string[]).includes(place)) return `unknown label place: ${place}`;
      if (l === null) continue;
      if (!(TEXT_LABEL_IDS as readonly unknown[]).includes(l)) return `unknown text label: ${String(l)}`;
      if (seen.has(l)) return `label placed twice: ${String(l)}`;
      seen.add(l);
    }
  }
  if ('directionArrow' in value && typeof value.directionArrow !== 'boolean') return 'directionArrow is true or false';
  if ('friendlyGraphicColour' in value && value.friendlyGraphicColour !== 'black' && value.friendlyGraphicColour !== 'blue') return 'friendlyGraphicColour is black or blue';
  if ('symbolSize' in value && !wholeIn(value.symbolSize, SYMBOL_SIZE_MIN, SYMBOL_SIZE_MAX)) {
    return `symbolSize is a whole number from ${SYMBOL_SIZE_MIN} to ${SYMBOL_SIZE_MAX}`;
  }
  if ('speedVectorMinutes' in value && !wholeIn(value.speedVectorMinutes, 0, SPEED_VECTOR_MAX_MINUTES)) {
    return `speedVectorMinutes is a whole number from 0 to ${SPEED_VECTOR_MAX_MINUTES}`;
  }
  if ('speedVectorSeconds' in value && !isStep(value.speedVectorSeconds)) {
    return `speedVectorSeconds is 0 or one of ${SPEED_VECTOR_STEPS_SECONDS.join(', ')}`;
  }
  if ('labels' in value) {
    const labels = value.labels;
    if (!Array.isArray(labels)) return 'labels is a list of label ids';
    const seen = new Set<unknown>();
    for (const l of labels) {
      if (!(LABEL_IDS as readonly unknown[]).includes(l)) return `unknown label: ${String(l)}`;
      if (seen.has(l)) return `label listed twice: ${String(l)}`;
      seen.add(l);
    }
  }
  if ('relations' in value) {
    const relations = value.relations;
    if (!isObject(relations)) return 'relations maps a relation kind to true or false';
    for (const [kind, on] of Object.entries(relations)) {
      if (typeof on !== 'boolean') return `the switch of ${kind} is true or false`;
    }
  }
  if ('classes' in value) {
    const classes = value.classes;
    if (!isObject(classes)) return 'classes maps a display class to true or false';
    for (const [c, on] of Object.entries(classes)) {
      if (!(DISPLAY_CLASS_IDS as readonly string[]).includes(c)) return `unknown display class: ${c}`;
      if (typeof on !== 'boolean') return `the switch of ${c} is true or false`;
    }
  }
  return null;
}

/**
 * Why `value` is not what `ctx.display` may hold for the loaded `relationKinds`, or null: every part
 * set and well formed ({@link displayChoicesProblem}), and `relations` with exactly the declared kinds.
 */
export function displaySettingsProblem(value: unknown, relationKinds: readonly RelationKind[]): string | null {
  // SDK 1.5.0: with speedVectorSeconds, speedVectorMinutes is its sixtieth and may be a fraction
  const seconds = isObject(value) ? value.speedVectorSeconds : undefined;
  const minutes = isObject(value) ? value.speedVectorMinutes : undefined;
  if (seconds !== undefined && isStep(seconds) && minutes !== seconds / 60) return 'speedVectorMinutes is speedVectorSeconds / 60';
  const withMinutes = isObject(value) && seconds !== undefined ? { ...value, speedVectorMinutes: 0 } : value;
  // SDK 1.8.0 (CR-0043 part A): the filled display holds labels beside labelPlaces and directionArrow
  const choices = isObject(withMinutes) ? Object.fromEntries(Object.entries(withMinutes).filter(([k]) => k !== 'labels')) : withMinutes;
  const problem = displayChoicesProblem(choices);
  if (problem !== null) return problem;
  const v = value as DisplayChoices;
  // SDK 1.8.0: labelPlaces and directionArrow required since the freeze
  for (const key of ['symbolSize', 'speedVectorMinutes', 'speedVectorSeconds', 'labels', 'labelPlaces', 'directionArrow', 'relations', 'classes'] as const) {
    if (v[key] === undefined) return `${key} is missing`;
  }
  // the deprecated list, still filled: label ids, each once (checked only here, as the filled list)
  const labels = v.labels as readonly LabelId[];
  if (!Array.isArray(labels) || labels.some((l) => !(LABEL_IDS as readonly unknown[]).includes(l)) || new Set(labels).size !== labels.length) return 'labels is a list of label ids, each once';
  const places = v.labelPlaces as Readonly<Partial<Record<LabelPlace, TextLabelId | null>>>;
  const empty = LABEL_PLACES.find((place) => places[place] === undefined);
  if (empty !== undefined) return `no label choice for the place ${empty}`;
  // the deprecated list shows the same labels: the placed ones, and direction while the arrow is on
  const shown = labelsOfPlaces(places as LabelPlaces, v.directionArrow as boolean);
  if (labels.length !== shown.length || shown.some((l) => !labels.includes(l))) return 'labels is the placed labels and direction while the arrow is on';
  const relations = v.relations as Readonly<Record<string, boolean>>;
  const missing = relationKinds.find((k) => relations[k.id] === undefined);
  if (missing !== undefined) return `no switch for the relation kind ${missing.id}`;
  const extra = Object.keys(relations).find((id) => !relationKinds.some((k) => k.id === id));
  if (extra !== undefined) return `a switch for ${extra}, which no loaded plugin declares`;
  // SDK 1.6.0: every class, required since the freeze
  const classes = v.classes as Readonly<Partial<Record<DisplayClass, boolean>>>;
  const absent = DISPLAY_CLASS_IDS.find((c) => classes[c] === undefined);
  return absent === undefined ? null : `no switch for the display class ${absent}`;
}

/** SDK 1.8.0: a choice's places: its `labelPlaces` with every place, else its stored list's, else undefined. */
function placesOf(choices: DisplayChoices): LabelPlaces | undefined {
  if (choices.labelPlaces !== undefined) {
    const set = choices.labelPlaces;
    return Object.freeze(Object.fromEntries(LABEL_PLACES.map((place) => [place, set[place] ?? null])) as Record<LabelPlace, TextLabelId | null>);
  }
  return choices.labels === undefined ? undefined : placesFromLabels(choices.labels).labelPlaces;
}

/** SDK 1.8.0: a choice's arrow: its `directionArrow`, else on for a stored list ({@link placesFromLabels}), else undefined. */
function arrowOf(choices: DisplayChoices): boolean | undefined {
  if (choices.directionArrow !== undefined) return choices.directionArrow;
  return choices.labels === undefined ? undefined : placesFromLabels(choices.labels).directionArrow;
}

const sameLabels = (a: readonly LabelId[], b: readonly LabelId[]) => a.length === b.length && a.every((l) => b.includes(l));

/** A choice's speed vector in seconds: its `speedVectorSeconds`, else its stored minutes' nearest step, else undefined. */
function secondsOf(choices: DisplayChoices): SpeedVectorSeconds | undefined {
  if (choices.speedVectorSeconds !== undefined) return choices.speedVectorSeconds;
  return choices.speedVectorMinutes === undefined ? undefined : nearestSpeedVectorStep(choices.speedVectorMinutes * 60);
}

/**
 * The display settings the shell gives in `ctx.display` (CR-0031 section 3): for each part the
 * user's choice, else the admin's default, else {@link DEFAULT_DISPLAY}; for each loaded relation
 * kind the user's switch, else the admin's, else the kind's `defaultOn`. Switches for kinds that are
 * not loaded are left out here, never dropped from what is saved (the ACA's R5).
 *
 * SDK 1.5.0 (CR-0039 point 5; Q5): the speed vector is the user's `speedVectorSeconds`, else their
 * stored `speedVectorMinutes` as its nearest step, else the same of the admin's, else 0; and
 * `speedVectorMinutes` is that, divided by 60.
 *
 * @example
 * const display = resolveDisplay(userChoices, adminDefaults, relationKinds);
 */
export function resolveDisplay(user: DisplayChoices, admin: DisplayChoices, relationKinds: readonly RelationKind[]): DisplaySettings {
  const relations: Record<string, boolean> = {};
  for (const k of relationKinds) relations[k.id] = user.relations?.[k.id] ?? admin.relations?.[k.id] ?? k.defaultOn;
  const speedVectorSeconds = secondsOf(user) ?? secondsOf(admin) ?? 0;
  const labelPlaces = placesOf(user) ?? placesOf(admin) ?? (DEFAULT_DISPLAY.labelPlaces as LabelPlaces);
  const directionArrow = arrowOf(user) ?? arrowOf(admin) ?? true;
  const friendly = user.friendlyGraphicColour ?? admin.friendlyGraphicColour;
  // SDK 1.8.0: a stored list keeps its own order in the deprecated labels, `direction` after it while
  // the arrow is on (owner WZ A: a stored list converts with the arrow on); places give theirs
  const stored = user.labels ?? (user.labelPlaces !== undefined || user.directionArrow !== undefined ? undefined : admin.labels);
  const list = stored === undefined ? undefined
    : [...stored.filter((l) => l !== 'direction' || directionArrow), ...(directionArrow && !stored.includes('direction') ? ['direction' as const] : [])];
  const labels = list !== undefined && sameLabels(list, labelsOfPlaces(labelPlaces, directionArrow))
    ? list
    : labelPlaces === DEFAULT_DISPLAY.labelPlaces && directionArrow ? DEFAULT_DISPLAY.labels : labelsOfPlaces(labelPlaces, directionArrow);
  return Object.freeze({
    symbolSize: user.symbolSize ?? admin.symbolSize ?? DEFAULT_DISPLAY.symbolSize,
    speedVectorMinutes: speedVectorSeconds / 60,
    speedVectorSeconds,
    labels: Object.freeze([...labels]),
    labelPlaces,
    directionArrow,
    relations: Object.freeze(relations),
    classes: Object.freeze(Object.fromEntries(DISPLAY_CLASS_IDS.map((c) => [c, user.classes?.[c] ?? admin.classes?.[c] ?? true])) as Record<DisplayClass, boolean>),
    // SDK 1.9.0 (CR-0048 section 6): only when a user or the admin chose one, so that a 1.8.0 display is unchanged
    ...(friendly !== undefined ? { friendlyGraphicColour: friendly } : {}),
  });
}
