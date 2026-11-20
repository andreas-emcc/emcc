/**
 * SDK 1.8.0 (CR-0043 part D; owner UZ A, 2026-11-14; T-203 parts C to E): what a plugin's settings
 * schema tells the shell's generated forms, beyond JSON Schema itself. Every hint is an annotation in
 * `x-emc2`, so validation does not change and a schema without hints still gets a form.
 *
 * - On an object: `groups`, the headed and folding groups of its properties.
 * - On a property: `hint` (one line, at most 80 characters), `width` (`short` or `full`), `unit`.
 * - On an array of objects: `item` (`name`, `noun`, `state`, `columns`): a table with a side form;
 *   and `item.id` (part F, CR-0047): the items' stable id, which ECore fills in and the form hides.
 * - The manifest's `icon`: a name from {@link PLUGIN_ICONS}.
 * - SDK 1.9.0 (CR-0048 point 1): a group's `description`; `kind: "tls-credential"` on a string; and
 *   the texts rule, {@link settingsTextProblem}: a title and a description on every shown setting
 *   and a description on every group, checked in each plugin's build, not by ECore or the shell.
 *
 * The rules below are functions, so the shell and the tests read a schema alike.
 *
 * @example
 * "links": { "type": "array", "title": "Links",
 *   "x-emc2": { "item": { "name": "name", "noun": "link", "state": "enabled" } },
 *   "items": { "type": "object", "properties": { ... },
 *     "x-emc2": { "groups": [{ "id": "advanced", "label": "Advanced", "properties": ["idleSeconds"], "advanced": true }] } } }
 */
import {
  Anchor, Antenna, Bookmark, Cable, Car, Clock, Cloud, CloudSun, Compass, Crosshair, Database, Flag, Globe,
  Hexagon, Layers, List, Map as MapIcon, MapPin, Mountain, Navigation, Network, Plane, Play, Puzzle, Radar,
  Radio, Route, Satellite, Server, Shapes, Ship, Swords, Target, Truck, Users, Video, Waves, Waypoints, Wind,
} from 'lucide-react';
import type { IconComponent } from './workspace.ts';

/** A condition on a sibling's value (`enabledWhen`, `visibleWhen`; data model 1.3.0 and 1.5.0). */
export interface SettingsCondition {
  readonly property: string;
  readonly in: readonly (string | number | boolean)[];
}

/** A headed, folding group of an object's properties (part D point 1). */
export interface SettingsGroup {
  readonly id: string;
  readonly label: string;
  /** The object's own properties, in the order shown. */
  readonly properties: readonly string[];
  /** Starts folded. */
  readonly folded?: boolean;
  /** Starts folded and goes last. */
  readonly advanced?: boolean;
  /** SDK 1.9.0 (CR-0048 point 1.2): what the group holds, 1 to {@link DESCRIPTION_MAX} characters, shown under its heading. */
  readonly description?: string;
}

/** How an array of objects is shown as a table with a side form (part D point 3). */
export interface SettingsItem {
  /** A string property of the items that names the row and the side form's head. */
  readonly name: string;
  /** Lower case, e.g. `link`: "Add link", "Delete link?", "New link". */
  readonly noun: string;
  /** A boolean property of the items, shown as an On or Off chip. */
  readonly state?: string;
  /** Up to {@link MAX_ITEM_COLUMNS} properties of the items, shown after the name. */
  readonly columns?: readonly string[];
  /**
   * A string property of the items that holds each item's stable id (part F, CR-0047): a UUID v7 in
   * lower case, made with the item (the form's Add, else ECore at load and at each change) and never
   * changed by emcc, so a renamed item is the same item to the plugin. Not the name, the state or a
   * column; the form does not show it ({@link formSections} with the list leaves it out).
   */
  readonly id?: string;
}

/** A field's width: short fields stand side by side. */
export type FieldWidth = 'short' | 'full';

/** The `x-emc2` annotation of a settings schema, every key optional. */
export interface SettingsAnnotation {
  /**
   * 1.2.0 a layer picker; 1.6.0 a colour picker; 1.9.0 (CR-0048 point 1.3, ADR-0062) a TLS
   * credential's name, on a string without `enum` or `pattern`: the form lists the names ECore has,
   * and empty means the link's name.
   */
  readonly kind?: 'layer' | 'colour' | 'tls-credential';
  /** The layer picker's "New layer" (1.2.0). */
  readonly allowNew?: boolean;
  /** 1.3.0. A false condition greys the field and makes it read only; the value is kept (`visibleWhen` hides). */
  readonly enabledWhen?: SettingsCondition;
  readonly visibleWhen?: SettingsCondition;
  readonly groups?: readonly SettingsGroup[];
  readonly hint?: string;
  readonly item?: SettingsItem;
  readonly width?: FieldWidth;
  readonly unit?: string;
}

/** A settings schema as the form reads it: JSON Schema 2020-12 with `x-emc2`. */
export interface SettingsSchema {
  readonly type?: string | readonly string[];
  readonly title?: string;
  readonly description?: string;
  readonly enum?: readonly unknown[];
  readonly maxLength?: number;
  readonly readOnly?: boolean;
  readonly examples?: readonly unknown[];
  readonly properties?: Readonly<Record<string, SettingsSchema>>;
  readonly items?: SettingsSchema;
  readonly 'x-emc2'?: SettingsAnnotation;
  readonly [keyword: string]: unknown;
}

/** The longest hint, in characters. */
export const HINT_MAX = 80;
/** SDK 1.9.0: the longest setting's or group's description, in characters (the texts rule). */
export const DESCRIPTION_MAX = 512;
/** SDK 1.9.0: the longest setting's title, in characters (the texts rule). */
export const TITLE_MAX = 64;
/** The most groups on one object. */
export const MAX_GROUPS = 32;
/** The most columns an item names. */
export const MAX_ITEM_COLUMNS = 6;
/** The most columns the shell picks when an item names none. */
export const DEFAULT_ITEM_COLUMNS = 3;
/** The longest `maxLength` of a string that counts as short. */
export const SHORT_STRING_MAX = 24;

const annotation = (schema: SettingsSchema | undefined): SettingsAnnotation => schema?.['x-emc2'] ?? {};
const typeOf = (schema: SettingsSchema): readonly string[] =>
  schema.type === undefined ? [] : typeof schema.type === 'string' ? [schema.type] : schema.type;

/**
 * The hint under a field and the text behind its info button (part D point 2): `x-emc2.hint`, with
 * the `description` behind the button; else a `description` of up to 80 characters as the hint, and a
 * longer one behind the button only.
 */
export function fieldHint(schema: SettingsSchema): { readonly hint: string | null; readonly more: string | null } {
  const hint = annotation(schema).hint;
  const description = schema.description === undefined || schema.description.trim() === '' ? null : schema.description;
  if (hint !== undefined) return { hint, more: description };
  if (description !== null && description.length <= HINT_MAX) return { hint: description, more: null };
  return { hint: null, more: description };
}

/** Whether a property is short by its type: a number, integer, boolean, enum, colour or string of `maxLength` 24 or less. */
export function isShortByType(schema: SettingsSchema): boolean {
  if (schema.enum !== undefined) return true;
  if (annotation(schema).kind === 'colour') return true;
  const types = typeOf(schema).filter((t) => t !== 'null');
  if (types.length !== 1) return false;
  const [type] = types;
  if (type === 'number' || type === 'integer' || type === 'boolean') return true;
  return type === 'string' && schema.maxLength !== undefined && schema.maxLength <= SHORT_STRING_MAX;
}

/** A field's width (part D point 4): `x-emc2.width`, else short when {@link isShortByType}. */
export function fieldWidth(schema: SettingsSchema): FieldWidth {
  return annotation(schema).width ?? (isShortByType(schema) ? 'short' : 'full');
}

/** Whether a property is an array of objects, which the form shows as a table with a side form. */
export function isItemList(schema: SettingsSchema): boolean {
  return typeOf(schema).includes('array') && schema.items !== undefined && typeOf(schema.items).includes('object');
}

/**
 * The columns after an item's name (part D point 3): `item.columns`, else up to three properties of the
 * items that are short by type, in schema order, without the name, the state and the id.
 */
export function itemColumns(list: SettingsSchema): readonly string[] {
  const item = annotation(list).item;
  if (item?.columns !== undefined) return item.columns;
  const properties = list.items?.properties ?? {};
  return Object.entries(properties)
    .filter(([key, p]) => key !== item?.name && key !== item?.state && key !== item?.id && isShortByType(p))
    .slice(0, DEFAULT_ITEM_COLUMNS)
    .map(([key]) => key);
}

const capital = (s: string) => (s === '' ? s : s[0]!.toUpperCase() + s.slice(1));

/** The words for an item (part D point 3): from `item.noun`, else the list's title, else "item". */
export function itemWords(list: SettingsSchema): { readonly noun: string; readonly add: string; readonly remove: string; readonly fresh: string } {
  const noun = annotation(list).item?.noun ?? (list.items?.title ?? list.title ?? 'item').toLowerCase();
  return { noun, add: `Add ${noun}`, remove: `Delete ${noun}?`, fresh: `New ${noun}` };
}

/**
 * An item's name in the table and its side form's head (part D point 3): its `item.name` property when
 * not empty; else "New link" for an item not yet saved, and "Link 3" (its place, from 1) for one saved.
 * A list without `item` names each row by the items' title or the list's: "Link 3".
 */
export function itemName(list: SettingsSchema, value: unknown, index: number, saved: boolean): string {
  const item = annotation(list).item;
  if (item === undefined) return `${list.items?.title ?? list.title ?? 'Item'} ${index + 1}`;
  const name = value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[item.name] : undefined;
  if (typeof name === 'string' && name.trim() !== '') return name;
  return saved ? `${capital(item.noun)} ${index + 1}` : `New ${item.noun}`;
}

/**
 * An item's stable id (part F, CR-0047): the value of the property its list's `item.id` names, when a
 * string that is not empty; else null, also for a list without `item.id`. The shell keeps a list's
 * rows by it and gives a new item the web SDK's `uuidv7()`; ECore fills in a missing one.
 */
export function itemId(list: SettingsSchema, value: unknown): string | null {
  const key = annotation(list).item?.id;
  if (key === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>)[key];
  return typeof id === 'string' && id !== '' ? id : null;
}

/** A section of a generated form (part D point 1). */
export interface FormSection {
  /** The group's id, the nested object's property, or null for the first, unheaded section. */
  readonly id: string | null;
  readonly label: string | null;
  readonly properties: readonly string[];
  readonly folded: boolean;
  readonly advanced: boolean;
  /** SDK 1.9.0: a group's description, when it has one. */
  readonly description?: string;
  /** For a nested object's section: its property, whose own schema gives its fields. */
  readonly object?: string;
}

/**
 * An object's form in sections (part D point 1), in this order: the properties in no group, without a
 * heading; the groups that are not advanced, as declared; each nested object in no group, under its
 * `title`; the advanced groups, folded. Empty sections are left out.
 *
 * For an item's side form, pass its list too (`formSections(list.items, list)`): the property the
 * list's `item.id` names is left out, also from a group (part F, CR-0047). The form keeps its value.
 */
export function formSections(schema: SettingsSchema, list?: SettingsSchema): readonly FormSection[] {
  const id = list !== undefined && list.items === schema ? annotation(list).item?.id : undefined;
  const shown = (key: string) => key !== id;
  const properties = schema.properties ?? {};
  const groups = (annotation(schema).groups ?? []).map((g) => (g.properties.every(shown) ? g : { ...g, properties: g.properties.filter(shown) }));
  const grouped = new Set(groups.flatMap((g) => g.properties));
  const free = Object.keys(properties).filter((key) => !grouped.has(key) && shown(key));
  const isObject = (key: string) => {
    const p = properties[key]!;
    return typeOf(p).includes('object') && p.properties !== undefined && !isItemList(p);
  };
  const of = (g: SettingsGroup): FormSection => ({
    id: g.id, label: g.label, properties: g.properties, folded: g.advanced === true || g.folded === true, advanced: g.advanced === true,
    ...(g.description !== undefined ? { description: g.description } : {}),
  });
  const sections: FormSection[] = [
    { id: null, label: null, properties: free.filter((k) => !isObject(k)), folded: false, advanced: false },
    ...groups.filter((g) => g.advanced !== true).map(of),
    ...free.filter(isObject).map((k): FormSection => ({ id: k, label: properties[k]!.title ?? k, properties: [k], folded: false, advanced: false, object: k })),
    ...groups.filter((g) => g.advanced === true).map(of),
  ];
  return sections.filter((s) => s.properties.length > 0);
}

/**
 * The plugins' icons (part D point 7): the names a manifest's `icon` may give, Lucide icons. The list
 * grows in a minor SDK; the shell shows a name it does not know, or none, as its neutral icon. SDK
 * 1.8.0 part E (CR-0044 E4) adds `Video`.
 */
export const PLUGIN_ICONS: Readonly<Record<string, IconComponent>> = Object.freeze({
  Anchor, Antenna, Bookmark, Cable, Car, Clock, Cloud, CloudSun, Compass, Crosshair, Database, Flag, Globe,
  Hexagon, Layers, List, Map: MapIcon, MapPin, Mountain, Navigation, Network, Plane, Play, Puzzle, Radar,
  Radio, Route, Satellite, Server, Shapes, Ship, Swords, Target, Truck, Users, Video, Waves, Waypoints, Wind,
});

/** The pattern of a manifest's `icon`, as the data model's schema has it. */
export const PLUGIN_ICON_PATTERN = '^[A-Z][A-Za-z0-9]*$';

/** The icon a manifest's `icon` names, or null for none or a name not in {@link PLUGIN_ICONS}. */
export function pluginIcon(name: unknown): IconComponent | null {
  return typeof name === 'string' && Object.hasOwn(PLUGIN_ICONS, name) ? PLUGIN_ICONS[name]! : null;
}

const KEYS = new Set(['kind', 'allowNew', 'enabledWhen', 'visibleWhen', 'groups', 'hint', 'item', 'width', 'unit']);
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

function conditionProblem(value: unknown, siblings: readonly string[] | null, self: string | null): string | null {
  if (!isRecord(value)) return 'is not an object';
  if (Object.keys(value).some((k) => k !== 'property' && k !== 'in')) return 'has a key other than property and in';
  if (!nonEmpty(value.property)) return 'has no property';
  if (siblings !== null && !siblings.includes(value.property)) return `names ${value.property}, not a sibling`;
  if (value.property === self) return 'names the field itself';
  const values = value.in;
  if (!Array.isArray(values) || values.length < 1 || values.length > 32) return 'needs 1 to 32 values in in';
  if (values.some((v) => !['string', 'number', 'boolean'].includes(typeof v))) return 'has a value in in that is not a string, number or boolean';
  return null;
}

function groupsProblem(value: unknown, schema: Record<string, unknown>): string | null {
  const properties = isRecord(schema.properties) ? Object.keys(schema.properties) : null;
  if (properties === null) return 'is on a schema without properties';
  if (!Array.isArray(value) || value.length > MAX_GROUPS) return `is not a list of at most ${MAX_GROUPS} groups`;
  const ids = new Set<string>();
  const seen = new Set<string>();
  for (const [i, g] of value.entries()) {
    if (!isRecord(g)) return `${i} is not an object`;
    if (Object.keys(g).some((k) => !['id', 'label', 'properties', 'folded', 'advanced', 'description'].includes(k))) return `${i} has an unknown key`;
    if (!nonEmpty(g.id) || ids.has(g.id)) return `${i} has no id, or one used twice`;
    ids.add(g.id);
    if (!nonEmpty(g.label)) return `${i} has no label`;
    if (g.description !== undefined && (!nonEmpty(g.description) || g.description.length > DESCRIPTION_MAX)) return `${i}'s description is not 1 to ${DESCRIPTION_MAX} characters`;
    if (g.folded !== undefined && typeof g.folded !== 'boolean') return `${i}'s folded is not a boolean`;
    if (g.advanced !== undefined && typeof g.advanced !== 'boolean') return `${i}'s advanced is not a boolean`;
    if (!Array.isArray(g.properties) || g.properties.length === 0) return `${i} has no properties`;
    for (const p of g.properties) {
      if (typeof p !== 'string' || !properties.includes(p)) return `${i} names ${String(p)}, not a property of the object`;
      if (seen.has(p)) return `${i} names ${p}, already in a group`;
      seen.add(p);
    }
  }
  return null;
}

function itemProblem(value: unknown, schema: Record<string, unknown>): string | null {
  const items = schema.items;
  if (!isRecord(items) || !isRecord(items.properties)) return 'is not on an array of objects with properties';
  const properties = items.properties as Record<string, SettingsSchema>;
  if (!isRecord(value)) return 'is not an object';
  if (Object.keys(value).some((k) => !['name', 'noun', 'state', 'columns', 'id'].includes(k))) return 'has an unknown key';
  const has = (key: unknown, type: string) => typeof key === 'string' && Object.hasOwn(properties, key) && typeOf(properties[key]!).includes(type);
  if (!has(value.name, 'string')) return 'name is not a string property of the items';
  if (typeof value.noun !== 'string' || !/^[a-z][a-z -]{0,31}$/.test(value.noun)) return 'noun is not 1 to 32 lower case letters';
  if (value.state !== undefined && !has(value.state, 'boolean')) return 'state is not a boolean property of the items';
  if (value.columns !== undefined) {
    const columns = value.columns;
    if (!Array.isArray(columns) || columns.length > MAX_ITEM_COLUMNS) return `columns is not a list of at most ${MAX_ITEM_COLUMNS}`;
    if (new Set(columns).size !== columns.length) return 'columns names a property twice';
    const bad = columns.find((c) => typeof c !== 'string' || !Object.hasOwn(properties, c));
    if (bad !== undefined) return `columns names ${String(bad)}, not a property of the items`;
  }
  if (value.id !== undefined) {
    if (!has(value.id, 'string')) return 'id is not a string property of the items';
    if (value.id === value.name || value.id === value.state) return 'id is also the name or the state';
    if (Array.isArray(value.columns) && value.columns.includes(value.id)) return 'id is also a column';
    const groups = isRecord(items['x-emc2']) ? items['x-emc2'].groups : undefined;
    if (Array.isArray(groups) && groups.some((g) => isRecord(g) && Array.isArray(g.properties) && g.properties.includes(value.id))) return 'id is in a group of the items';
  }
  return null;
}

/** The colour pattern a `kind` `colour` field carries, `#RRGGBB`. */
const COLOUR_PATTERN = '^#[0-9A-Fa-f]{6}$';

function annotationProblem(value: unknown, schema: Record<string, unknown>, siblings: readonly string[] | null, depth: number, self: string | null): string | null {
  if (!isRecord(value)) return 'is not an object';
  const unknown = Object.keys(value).find((k) => !KEYS.has(k));
  if (unknown !== undefined) return `has the unknown key ${unknown}`;
  if (value.kind !== undefined && value.kind !== 'layer' && value.kind !== 'colour' && value.kind !== 'tls-credential') return 'kind is not layer, colour or tls-credential';
  if (value.kind === 'tls-credential') {
    const types = typeOf(schema as SettingsSchema).filter((t) => t !== 'null');
    if (types.length !== 1 || types[0] !== 'string') return 'kind tls-credential is on a field that is not a string';
    if (schema.enum !== undefined || schema.pattern !== undefined) return 'kind tls-credential is on a string with an enum or a pattern';
  }
  if (value.kind === 'colour') {
    const types = typeOf(schema as SettingsSchema).filter((t) => t !== 'null');
    if (types.length !== 1 || types[0] !== 'string' || schema.pattern !== COLOUR_PATTERN) return `kind colour is not on a string with the pattern ${COLOUR_PATTERN}`;
  }
  if (value.kind === 'layer') {
    const properties = isRecord(schema.properties) ? Object.keys(schema.properties) : [];
    if (!properties.includes('name') || properties.some((p) => p !== 'id' && p !== 'name')) return 'kind layer is not on an object of {id?, name}';
  }
  if (value.allowNew !== undefined && typeof value.allowNew !== 'boolean') return 'allowNew is not a boolean';
  if (value.allowNew !== undefined && value.kind !== 'layer') return 'allowNew is on a field without kind layer';
  for (const key of ['enabledWhen', 'visibleWhen'] as const) {
    if (value[key] === undefined) continue;
    const problem = conditionProblem(value[key], siblings, self);
    if (problem !== null) return `${key} ${problem}`;
  }
  if (value.groups !== undefined) {
    if (depth > 1) return 'groups is on an object nested deeper than one level (the page, a nested object or an item only)';
    const problem = groupsProblem(value.groups, schema);
    if (problem !== null) return `groups ${problem}`;
  }
  if (value.hint !== undefined && (!nonEmpty(value.hint) || value.hint.length > HINT_MAX)) return `hint is not 1 to ${HINT_MAX} characters`;
  if (value.item !== undefined) {
    const problem = itemProblem(value.item, schema);
    if (problem !== null) return `item ${problem}`;
  }
  if (value.width !== undefined && value.width !== 'short' && value.width !== 'full') return 'width is not short or full';
  if (value.unit !== undefined) {
    if (typeof value.unit !== 'string' || value.unit.length < 1 || value.unit.length > 8) return 'unit is not 1 to 8 characters';
    const types = typeOf(schema as SettingsSchema);
    if (!types.includes('number') && !types.includes('integer')) return 'unit is on a field that is not a number';
  }
  return null;
}

/**
 * The first wrong `x-emc2` annotation in a settings schema, as "<JSON pointer>/x-emc2: <problem>", or
 * null (part D point 8). It checks every key the data model documents (1.2.0 to 1.9.0): a condition
 * names a sibling, a group the object's own properties, an item its items' properties (its `id` a
 * string property apart from its name, state, columns and groups; part F), a hint is at
 * most 80 characters, a unit sits on a number, groups sit no deeper than one nested object (an item
 * schema counts as a page), a condition does not name its own field, `colour` sits on a string with
 * the pattern `#RRGGBB`, `layer` on an object of `{id?, name}`, and `allowNew` only with `layer`.
 * Run on every plugin's settings by the SDK's tests.
 */
export function settingsHintsProblem(schema: unknown): string | null {
  // depth: how many object properties down from the page or an item schema
  const walk = (node: unknown, path: string, siblings: readonly string[] | null, depth: number, self: string | null = null): string | null => {
    if (Array.isArray(node)) {
      for (const [i, n] of node.entries()) {
        const problem = walk(n, `${path}/${i}`, null, depth);
        if (problem !== null) return problem;
      }
      return null;
    }
    if (!isRecord(node)) return null;
    if (node['x-emc2'] !== undefined) {
      const problem = annotationProblem(node['x-emc2'], node, siblings, depth, self);
      if (problem !== null) return `${path}/x-emc2: ${problem}`;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'x-emc2' || key === 'default' || key === 'examples' || key === 'const' || key === 'enum') continue;
      if (key === 'properties' && isRecord(child)) {
        const names = Object.keys(child);
        for (const [name, property] of Object.entries(child)) {
          const problem = walk(property, `${path}/properties/${name}`, names, depth + 1, name);
          if (problem !== null) return problem;
        }
        continue;
      }
      const problem = walk(child, `${path}/${key}`, null, key === 'items' ? 0 : depth);
      if (problem !== null) return problem;
    }
    return null;
  };
  return walk(schema, '', null, 0);
}

/**
 * SDK 1.9.0 (CR-0048 point 1.1; ADR-0060 point 2, owner Q11 A): the first setting or group of a
 * settings schema that does not explain itself, as "<JSON pointer>: <problem>", or null. Every
 * property the form shows has a `title` (1 to {@link TITLE_MAX} characters) and a `description` (1
 * to {@link DESCRIPTION_MAX}), at every depth, inside an array's `items` too, and every group in
 * `x-emc2.groups` a `description`.
 *
 * **Exempt:** the property an `item.id` names (never shown, CR-0047), and the properties inside a
 * field with an `x-emc2` `kind` (a layer's `id` and `name`), which the form draws as one; so also
 * inside the items of a list whose `items` carry the `kind` `layer` (a list of layer pickers, e.g. `cot`'s
 * `sourceLayers`): the list has its title and description, each item is one field.
 *
 * A build rule: the template's manifest guard calls it, so each plugin's build checks it. ECore and
 * the shell do not, so a plugin without the texts still loads, and the form shows the property's key.
 *
 * @example
 * settingsTextProblem({ type: 'object', properties: { port: { type: 'integer', title: 'Port' } } })
 * // '/properties/port: has no description'
 */
export function settingsTextProblem(schema: unknown): string | null {
  const texts = (node: Record<string, unknown>, path: string): string | null => {
    if (!nonEmpty(node.title) || node.title.length > TITLE_MAX) return `${path}: has no title of 1 to ${TITLE_MAX} characters`;
    if (!nonEmpty(node.description) || node.description.length > DESCRIPTION_MAX) return `${path}: has no description of 1 to ${DESCRIPTION_MAX} characters`;
    return null;
  };
  // An object schema's own properties and groups; `hidden` is the property an item.id names.
  const object = (node: Record<string, unknown>, path: string, hidden: string | undefined): string | null => {
    const groups = isRecord(node['x-emc2']) ? node['x-emc2'].groups : undefined;
    if (Array.isArray(groups)) {
      for (const [i, g] of groups.entries()) {
        if (isRecord(g) && (!nonEmpty(g.description) || g.description.length > DESCRIPTION_MAX)) {
          return `${path}/x-emc2/groups/${i}: has no description of 1 to ${DESCRIPTION_MAX} characters`;
        }
      }
    }
    if (!isRecord(node.properties)) return null;
    for (const [name, property] of Object.entries(node.properties)) {
      if (name === hidden || !isRecord(property)) continue;
      const at = `${path}/properties/${name}`;
      const problem = texts(property, at) ?? field(property, at);
      if (problem !== null) return problem;
    }
    return null;
  };
  // What is inside one shown field: a nested object's properties, a list's item properties.
  const field = (node: Record<string, unknown>, path: string): string | null => {
    const hints = isRecord(node['x-emc2']) ? node['x-emc2'] : {};
    if (hints.kind !== undefined) return null;
    if (isRecord(node.properties)) return object(node, path, undefined);
    if (isRecord(node.items) && isRecord(node.items.properties)) {
      if (isRecord(node.items['x-emc2']) && node.items['x-emc2'].kind === 'layer') return null; // the shell draws one picker list
      const item = isRecord(hints.item) ? hints.item : {};
      return object(node.items, `${path}/items`, typeof item.id === 'string' ? item.id : undefined);
    }
    return null;
  };
  return isRecord(schema) ? object(schema, '', undefined) : null;
}
