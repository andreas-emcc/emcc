import { LABEL_IDS, type LabelId, type Modifiers, type TextModifierName } from '@emc2/plugin-sdk';
import type { SymbolOptions } from 'milsymbol';

/**
 * The text amplifiers of tactical graphics only (SDK 1.4.0). Single-point symbols ignore them: they
 * change neither the image nor its key.
 */
const GRAPHIC_TEXT_MODIFIERS = ['dtg1', 'targetNumber', 'uniqueDesignation1', 'uniqueDesignation2'] as const satisfies readonly TextModifierName[];

/** The text amplifiers a single-point symbol draws. */
type SymbolTextModifierName = Exclude<TextModifierName, (typeof GRAPHIC_TEXT_MODIFIERS)[number]>;

/**
 * The text amplifiers of single-point symbols. Each has the name of its milsymbol option and is passed on
 * unchanged. All of them are drawn as text, including `engagementBar` and `headquartersElement`,
 * which milsymbol draws as a bar or inside the frame: they hold per-object text, so they are drawn
 * only when the caller asks for text.
 */
export const TEXT_MODIFIERS = Object.keys({
  // A Record, so that the build fails when the SDK gains a text modifier that is missing here.
  additionalInformation: true, altitudeDepth: true, auxiliaryEquipmentIndicator: true, combatEffectiveness: true, commonIdentifier: true,
  country: true, dtg: true, engagementBar: true, engagementType: true, equipmentTeardownTime: true, evaluationRating: true,
  guardedUnit: true, headquartersElement: true, higherFormation: true, hostile: true, iffSif: true, installationComposition: true,
  location: true, platformType: true, quantity: true, reinforcedReduced: true, sigint: true, signatureEquipment: true,
  specialDesignator: true, specialHeadquarters: true, staffComments: true, type: true, uniqueDesignation: true,
} satisfies Record<SymbolTextModifierName, true>) as readonly SymbolTextModifierName[];

/** Every supported modifier name (camelCase, as in `model/`), sorted. */
export const MODIFIER_NAMES: readonly string[] = Object.freeze([...TEXT_MODIFIERS, ...GRAPHIC_TEXT_MODIFIERS, 'direction', 'speed', 'distances', 'azimuths'].sort());

/** Speed as display text. Model speeds are metres per second; shown in km/h until units become a setting. */
export function speedText(metresPerSecond: number): string {
  return `${String(Math.round(metresPerSecond * 3.6))} km/h`;
}

/**
 * Direction in whole degrees, so that tracks whose courses differ by a fraction of a degree share one
 * image (at most 360 images per symbol and size).
 */
export function wholeDegrees(direction: number): number {
  return ((Math.round(direction) % 360) + 360) % 360;
}

/**
 * The amplifiers the user's labels choose (SDK 1.4.0 part 5, brief function 14): the closed list
 * without `name`, which the map view draws. Amplifiers not on it are drawn whatever the labels.
 */
const LABELLED: ReadonlySet<string> = new Set(LABEL_IDS.filter((id) => id !== 'name'));

/** True if an amplifier is drawn with these labels: no labels given, not on the list, or listed. */
export function shown(name: string, labels: readonly LabelId[] | undefined): boolean {
  return labels === undefined || !LABELLED.has(name) || (labels as readonly string[]).includes(name);
}

/** A drawn text amplifier: its name (a milsymbol option) and its text. */
export type DrawnText = readonly [name: SymbolTextModifierName | 'speed', text: string];

/** The text amplifiers drawn with these labels, in `TEXT_MODIFIERS`' order, the speed last. */
export function drawnTexts(modifiers: Modifiers, labels: readonly LabelId[] | undefined): DrawnText[] {
  const texts: DrawnText[] = [];
  for (const name of TEXT_MODIFIERS) {
    const value = modifiers[name];
    if (value !== undefined && shown(name, labels)) texts.push([name, value]);
  }
  if (modifiers.speed !== undefined && shown('speed', labels)) texts.push(['speed', speedText(modifiers.speed)]);
  return texts;
}

/** The milsymbol options for a symbol's modifiers, and the part of the appearance key they make. */
export interface Drawn {
  readonly options: SymbolOptions;
  /** Equal for equal options, different otherwise. Empty when nothing is drawn. */
  readonly key: string;
}

const NOTHING: Drawn = Object.freeze({ options: Object.freeze({}), key: '' });

/**
 * What is drawn of a symbol's modifiers. Without text, only `direction` (an arrow) changes the
 * drawing; with text, every text amplifier and the speed are added. With `labels`, the amplifiers on
 * the closed list are drawn only when listed, the direction's arrow with or without text. The key is
 * made of what is drawn, so labels that change nothing share the image. Runs on every render.
 */
export function drawnModifiers(modifiers: Modifiers | undefined, withText: boolean, labels?: readonly LabelId[]): Drawn {
  if (modifiers === undefined || (modifiers.direction === undefined && !withText)) return NOTHING;
  const options: SymbolOptions = {};
  let key = '';
  if (modifiers.direction !== undefined && shown('direction', labels)) {
    options.direction = wholeDegrees(modifiers.direction);
    key = String(options.direction);
  }
  if (!withText) return key === '' ? NOTHING : { options, key };
  const texts = drawnTexts(modifiers, labels);
  for (const [name, text] of texts) options[name] = text;
  if (texts.length === 0) return key === '' ? NOTHING : { options, key };
  return { options, key: key + JSON.stringify(texts.flat()) };
}
