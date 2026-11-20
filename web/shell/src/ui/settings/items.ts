/** T-203 part D: the rules of a settings list shown as a table ({@link ItemList} in `ItemList.tsx`). */
import { isItemList, type SettingsSchema } from '@emc2/plugin-sdk';
import { isLayerPick, type Json, type JsonObject } from './schema.ts';

/** The draft key of a list item: the entry's key, then `#`, then the list's pointer and the row's key. */
export function itemDraftKey(entryKey: string, list: string, row: string): string {
  return `${entryKey}#/${list}/${row}`;
}

/**
 * The top-level lists of a settings schema that show as tables (part D; nested lists stay in the
 * item's form, D3 A): lists of objects with properties, but not a set of layer picks (SDK 1.4.0),
 * which keeps its checkboxes.
 */
export function itemLists(schema: SettingsSchema): readonly string[] {
  return Object.entries(schema.properties ?? {})
    .filter(([, p]) => isItemList(p) && p.items?.properties !== undefined && p.items['x-emc2']?.kind !== 'layer')
    .map(([key]) => key);
}

/** A cell's text: a value as text, a boolean as Yes or No, a picked layer by its name, nothing as an en dash. */
export function cellText(value: Json | undefined): string {
  if (value === undefined || value === null || value === '') return '–';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (isLayerPick(value)) return value.name;
  return JSON.stringify(value);
}

/** A list's items in the values; none when it is missing or not a list. */
export function itemsOf(values: JsonObject, name: string): readonly Json[] {
  const items = values[name];
  return Array.isArray(items) ? (items as readonly Json[]) : [];
}

/** A value as an object, or null. */
export function asObject(value: Json | undefined): JsonObject | null {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null;
}

/**
 * The items' schema as the side form shows it (CR-0047 F3): without the property the list's `item.id`
 * names, which is for the plugin, not for people. The form keeps its value, so a saved item's id goes
 * back unchanged.
 */
export function itemFormSchema(list: SettingsSchema): SettingsSchema | undefined {
  const items = list.items;
  const id = list['x-emc2']?.item?.id;
  if (items === undefined || id === undefined || items.properties?.[id] === undefined) return items;
  const properties = Object.fromEntries(Object.entries(items.properties).filter(([key]) => key !== id));
  const required = Array.isArray(items.required) ? (items.required as unknown[]).filter((k) => k !== id) : undefined;
  const ext = items['x-emc2'];
  const groups = ext?.groups?.map((g) => ({ ...g, properties: g.properties.filter((k) => k !== id) }));
  return {
    ...items, properties, ...(required === undefined ? {} : { required }),
    ...(ext === undefined || groups === undefined ? {} : { 'x-emc2': { ...ext, groups } }),
  };
}

/** A new item (CR-0047 F3): the form's empty value, with a new `uuidv7()` where the list declares `item.id`. */
export function newItem(list: SettingsSchema, empty: Json, makeId: () => string): Json {
  const id = list['x-emc2']?.item?.id;
  const value = asObject(empty);
  return id === undefined || value === null ? empty : { ...value, [id]: makeId() };
}
