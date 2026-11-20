/**
 * The labels round a symbol, by place (SDK 1.8.0, CR-0043 part A; T-163, owner A): the user chooses a label for each of
 * five places and switches the direction arrow on or off, and the map view draws each placed label as text at its place,
 * from the object. `symbology` is asked with `withText` and `labels: []`, so it draws none of the labels that can be placed.
 */
import { LABEL_IDS, LABEL_PLACES, type DisplaySettings, type LabelPlace, type LabelPlaces, type MilSymbol, type TextLabelId } from '@emc2/plugin-sdk';

/** What the engine needs of the user's labels. */
export interface PlacedLabels {
  readonly labelPlaces: LabelPlaces;
  readonly directionArrow: boolean;
}

/** The places and the arrow of the display settings: required since the SDK's 1.8.0 freeze, the shell gives both. */
export function placedLabelsOf(display: DisplaySettings): PlacedLabels {
  return { labelPlaces: display.labelPlaces, directionArrow: display.directionArrow };
}

/** The places and the arrow of a symbol that shows nothing placed, with the arrow on. */
export const NO_PLACED_LABELS: PlacedLabels = Object.freeze({
  labelPlaces: Object.freeze({ topLeft: null, topRight: null, bottomLeft: null, bottomRight: null, below: null }),
  directionArrow: true,
});

/** Whether two sets of places hold the same labels. */
export function samePlaces(a: LabelPlaces, b: LabelPlaces): boolean {
  return LABEL_PLACES.every((place) => a[place] === b[place]);
}

/** A speed as `symbology` writes it (its `speedText`): model speeds are metres per second, shown in km/h. */
export function speedLabel(metresPerSecond: number): string {
  return `${String(Math.round(metresPerSecond * 3.6))} km/h`;
}

/**
 * The text of a label for an object: the name from `properties.name`, the speed in km/h, and any other label as the
 * amplifier of that name in the symbol's modifiers. undefined when the object has none, or it is empty.
 */
export function labelText(label: TextLabelId, symbol: MilSymbol, name: string | undefined): string | undefined {
  if (label === 'name') return name === undefined || name === '' ? undefined : name;
  const modifiers = symbol.modifiers as Readonly<Record<string, unknown>> | undefined;
  const value = modifiers?.[label];
  if (label === 'speed') return typeof value === 'number' && Number.isFinite(value) ? speedLabel(value) : undefined;
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The modifiers `symbology` does not draw for a single-point symbol: the measurements, and the text amplifiers of tactical graphics only. */
const NOT_DRAWN_ON_SYMBOLS: ReadonlySet<string> = new Set(['distances', 'azimuths', 'dtg1', 'targetNumber', 'uniqueDesignation1', 'uniqueDesignation2']);

/**
 * Whether a symbol has an amplifier that `symbology` still draws when it is asked with `labels: []` (CR-0043 part A): one that is
 * not among the labels that can be placed (and that a symbol draws at all). Only then is a symbol's image with text different from
 * its image without.
 */
export function hasOffListText(symbol: MilSymbol): boolean {
  const modifiers = symbol.modifiers;
  return modifiers !== undefined && Object.keys(modifiers).some((name) => !(LABEL_IDS as readonly string[]).includes(name) && !NOT_DRAWN_ON_SYMBOLS.has(name));
}

/** A placed label's text and where it goes. */
export interface PlacedText {
  readonly place: LabelPlace;
  readonly text: string;
}

/** The texts of a symbol object's placed labels, in {@link LABEL_PLACES}' order; places with no label or no text are left out. */
export function placedTexts(symbol: MilSymbol, name: string | undefined, places: LabelPlaces): PlacedText[] {
  const texts: PlacedText[] = [];
  for (const place of LABEL_PLACES) {
    const label = places[place];
    if (label === null) continue;
    const text = labelText(label, symbol, name);
    if (text !== undefined) texts.push({ place, text });
  }
  return texts;
}
