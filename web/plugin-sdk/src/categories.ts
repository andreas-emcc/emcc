/**
 * SDK 1.6.0 (CR-0041 part F; T-174, owner QC A and QD A): the categories of the Settings workspace,
 * a fixed list. A plugin names its category in its manifest's `category`; none named means General.
 * The shell groups the plugins' entries in this order, alphabetically within a category; its own
 * entries (Labeling, Display and the others) are General.
 *
 * And a colour setting (part F, owner Q60 A): a settings string marked `"x-emc2": { "kind": "colour" }`,
 * with the pattern {@link COLOUR_PATTERN}, is shown by the shell's form as a colour picker.
 *
 * @example
 * // plugin.json: "category": "data-links"
 * const label = categoryLabel(manifest.category);   // 'Data Links'
 */

/** The categories, in the Settings workspace's order. */
export const PLUGIN_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'data-links', label: 'Data Links' }),
  Object.freeze({ id: 'geometoc', label: 'GeoMetoc' }),
  Object.freeze({ id: 'map-and-symbols', label: 'Map and Symbols' }),
  Object.freeze({ id: 'drawing', label: 'Drawing' }),
  Object.freeze({ id: 'simulation', label: 'Simulation' }),
  Object.freeze({ id: 'general', label: 'General' }),
] as const);

/** A category's id, as a manifest's `category` names it. */
export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number]['id'];

/** The category of a manifest without one. */
export const DEFAULT_PLUGIN_CATEGORY: PluginCategory = 'general';

/** The category a manifest's `category` value stands for: a known id, else General. */
export function pluginCategory(value: unknown): PluginCategory {
  const hit = PLUGIN_CATEGORIES.find((c) => c.id === value);
  return hit === undefined ? DEFAULT_PLUGIN_CATEGORY : hit.id;
}

/** The label shown for a manifest's `category` value, e.g. `'Data Links'`; General for none. */
export function categoryLabel(value: unknown): string {
  const id = pluginCategory(value);
  return PLUGIN_CATEGORIES.find((c) => c.id === id)!.label;
}

/** The pattern a colour setting's string has: `#RRGGBB`. */
export const COLOUR_PATTERN = '^#[0-9A-Fa-f]{6}$';

/** Whether `value` is a colour as a colour setting holds it, `#RRGGBB`. */
export function isColour(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value);
}
