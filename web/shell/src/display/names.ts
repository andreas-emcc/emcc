/** The display window's texts (ADR-0052), shared by the user's window and the admin's entry. */
import {
  LABEL_PLACES, SPEED_VECTOR_STEPS_SECONDS, type DisplayChoices, type DisplayClass, type DisplaySettings, type FriendlyGraphicColour,
  type LabelId, type LabelPlace, type LabelPlaces, type SpeedVectorSeconds, type TextLabelId,
} from '@emc2/plugin-sdk';

/** The window's and the icon's name, and what the ITA's tests look for. */
export const DISPLAY_LABEL = 'Display settings';

/** The labels' names, in the SDK's `LABEL_IDS` order. */
export const LABEL_NAMES: Readonly<Record<LabelId, string>> = {
  name: 'Name',
  uniqueDesignation: 'Unique designation',
  higherFormation: 'Higher formation',
  additionalInformation: 'Additional information',
  staffComments: 'Staff comments',
  type: 'Type',
  dtg: 'Date-time group',
  altitudeDepth: 'Altitude or depth',
  speed: 'Speed',
  direction: 'Direction',
};

/** A change from the form: the parts it sets, a relation switch at a time. */
export type DisplayChange =
  | { readonly symbolSize: number }
  | { readonly speedVectorSeconds: SpeedVectorSeconds }
  /** SDK 1.8.0 (CR-0043 part A): every place and the arrow together, never `labels` beside them. */
  | { readonly labelPlaces: LabelPlaces; readonly directionArrow: boolean }
  | { readonly relation: string; readonly on: boolean }
  /** SDK 1.6.0 (CR-0041 part D; T-182): a display class's switch. */
  | { readonly displayClass: DisplayClass; readonly on: boolean }
  /** SDK 1.9.0 (CR-0048 section 6): black or blue friendly control measures. */
  | { readonly friendlyGraphicColour: FriendlyGraphicColour };

/**
 * `choices` with `change`: the other parts kept, and the other relation switches kept, those of
 * kinds that are not loaded too (the ACA's R5 on CR-0031). A relation switch sets that one switch.
 */
export function changed(choices: DisplayChoices, change: DisplayChange): DisplayChoices {
  if ('relation' in change) return { ...choices, relations: { ...choices.relations, [change.relation]: change.on } };
  if ('displayClass' in change) return { ...choices, classes: { ...choices.classes, [change.displayClass]: change.on } };
  if ('labelPlaces' in change) {
    // SDK 1.8.0: a stored 1.7.0 list goes with the change, its labels carried over in the places
    const rest = Object.fromEntries(Object.entries(choices).filter(([key]) => key !== 'labels')) as DisplayChoices;
    return { ...rest, labelPlaces: change.labelPlaces, directionArrow: change.directionArrow };
  }
  if ('speedVectorSeconds' in change) {
    // SDK 1.5.0 part 3 (T-164, A1): seconds are saved, and 1.4.0's stored minutes go with the change
    const rest = Object.fromEntries(Object.entries(choices).filter(([key]) => key !== 'speedVectorMinutes')) as DisplayChoices;
    return { ...rest, ...change };
  }
  return { ...choices, ...change };
}

/** SDK 1.5.0 part 3 (T-164): the speed vector slider's positions, Off and then the SDK's steps. */
export const SPEED_VECTOR_POSITIONS: readonly SpeedVectorSeconds[] = [0, ...SPEED_VECTOR_STEPS_SECONDS];

/**
 * The slider position of `shown`'s seconds. The shell's `resolveDisplay` always fills them, stored
 * minutes as their nearest step (required since the 1.5.0 freeze).
 */
export function speedVectorPosition(shown: DisplaySettings): number {
  return Math.max(0, SPEED_VECTOR_POSITIONS.indexOf(shown.speedVectorSeconds));
}

/** The speed vector's text: off, its seconds below a minute, else its minutes. */
export function secondsText(seconds: number): string {
  if (seconds === 0) return 'Off';
  return seconds < 60 ? `${String(seconds)} s` : `${String(seconds / 60)} min`;
}

/** SDK 1.8.0: the places and the arrow `shown` has; required since the 1.8.0 freeze, the shell's `resolveDisplay` fills both. */
export function shownPlaces(shown: DisplaySettings): { readonly labelPlaces: LabelPlaces; readonly directionArrow: boolean } {
  return { labelPlaces: shown.labelPlaces, directionArrow: shown.directionArrow };
}

/**
 * SDK 1.8.0 (CR-0043 part A): `shown`'s places with `label` at `place` (null: none there), and its arrow.
 * Each label stands in one place: one already elsewhere moves here, and that place is left empty.
 */
export function withLabelAt(shown: DisplaySettings, place: LabelPlace, label: TextLabelId | null): { readonly labelPlaces: LabelPlaces; readonly directionArrow: boolean } {
  const { labelPlaces, directionArrow } = shownPlaces(shown);
  const next = Object.fromEntries(LABEL_PLACES.map((p) => [p, p === place ? label : labelPlaces[p] === label && label !== null ? null : labelPlaces[p]]));
  return { labelPlaces: next as LabelPlaces, directionArrow };
}
