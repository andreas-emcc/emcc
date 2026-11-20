/**
 * The form the shell makes from a settings schema (ADR-0031 point 2: a plugin's Settings entry shows its settings as a
 * form generated from the JSON Schema it declares; overview 4.11, "Settings"). The server validates
 * every value against the whole schema (JSON Schema 2020-12); the form only has to offer the right
 * inputs. It knows what the plugins' schemas use: objects with properties, yes/no, text, whole
 * numbers and numbers, fixed choices (`enum`), and lists of any of these. Anything else (`oneOf`,
 * `$ref`, a list of types, ...) becomes a JSON text box for that one value, so nothing is out of reach.
 *
 * SDK 1.2.0 (ADR-0037 point 2): an object annotated `"x-emc2": {"kind": "layer"}` on `{id?, name}`
 * is a picked layer (`layer`), and a list of them a set of picked layers (`layers`); `"allowNew":
 * false` offers existing layers only.
 *
 * SDK 1.3.0 (CR-0028 part 5; T-098): a property whose `x-emc2` carries `enabledWhen: {property, in}`
 * is enabled only while that sibling's value is in `in` (an absent sibling counts as its `default`;
 * with neither, it is enabled). One the form cannot use (no such sibling, an empty `in`) is ignored
 * and reported to `unusable` (T-128, owner FH: the entry logs a warning once). It changes no
 * validation: the value stays, is saved and is checked as before.
 *
 * SDK 1.5.0 part 4 (CR-0039 point 8; T-160): `visibleWhen`, of the same shape, hides the field
 * unless the sibling's value is in `in` (the same rules; one the form cannot use shows the field and
 * is reported). A hidden field keeps its value, which is still saved and checked; with both, the
 * field is hidden first, then greyed. An object's `if`/`then`/`else`, and an `allOf` made only of
 * them, are validation only: the form shows the object's fields, and the server checks them (A1).
 *
 * SDK 1.8.0 part D, the forms of T-203 part E (owner, this session): each field carries the SDK's
 * {@link fieldHint} (a short hint, the rest behind an info button), {@link fieldWidth} (short fields
 * side by side) and `x-emc2.unit`; each object its {@link formSections} (the unheaded first section,
 * the groups, the nested objects, the advanced groups).
 */
import { fieldHint, fieldWidth, formSections, type FieldWidth, type FormSection } from '@emc2/plugin-sdk';

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
export type JsonObject = { readonly [key: string]: Json };

interface Common {
  readonly label: string;
  readonly description: string | undefined;
  /** The schema's `default`, if any. */
  readonly default: Json | undefined;
  /** Part E: the line under the field (`x-emc2.hint`, or a description of 80 characters or less). */
  readonly hint: string | null;
  /** Part E: the longer text behind the field's info button. */
  readonly more: string | null;
  /** Part E: a short field stands beside others; a full one takes the row. */
  readonly width: FieldWidth;
  /** Part E: `x-emc2.unit`, shown after a number. */
  readonly unit: string | undefined;
}

export type Field =
  | (Common & { readonly kind: 'object'; readonly properties: readonly Property[]; readonly sections: readonly FormSection[] })
  | (Common & { readonly kind: 'boolean' })
  | (Common & {
    readonly kind: 'text'; readonly minLength?: number; readonly maxLength?: number; readonly pattern?: string;
    /** SDK 1.6.0 (CR-0041 part F): marked `"x-emc2": {"kind": "colour"}`, shown with a colour picker. */
    readonly colour?: true;
    /**
     * SDK 1.9.0 (CR-0048 point 1.3): marked `"x-emc2": {"kind": "tls-credential"}`, the name of a TLS
     * credential ECore has, or empty for the link's own name. A select of the names ECore serves (M9 C3); a text
     * field where they cannot be had.
     */
    readonly credential?: true;
    /** The schema's first string `examples`, for a problem with the pattern in plain words (the MCA's fix 1). */
    readonly example?: string;
  })
  | (Common & { readonly kind: 'number'; readonly integer: boolean; readonly minimum?: number; readonly maximum?: number })
  | (Common & { readonly kind: 'choice'; readonly options: readonly Json[] })
  | (Common & { readonly kind: 'list'; readonly item: Field; readonly minItems?: number; readonly maxItems?: number })
  | (Common & { readonly kind: 'layer'; readonly allowNew: boolean })
  | (Common & { readonly kind: 'layers'; readonly allowNew: boolean; readonly minItems?: number; readonly maxItems?: number })
  | (Common & { readonly kind: 'json' });

/** A picked layer as the settings hold it (the SDK's `LayerChoice`): an existing layer's id and name, or a new layer's name only. */
export interface LayerPick {
  readonly id?: string;
  readonly name: string;
}

/** The longest name of a layer (`LayerContent`). */
export const MAX_LAYER_NAME = 256;

/** Whether `value` is a picked layer: `{id?, name}` with strings. */
export function isLayerPick(value: unknown): value is LayerPick {
  return isObject(value) && typeof value.name === 'string' && (value.id === undefined || typeof value.id === 'string')
    && Object.keys(value).every((k) => k === 'id' || k === 'name');
}

/** The `allowNew` of an object schema annotated as a layer picker; null if it is not one. */
function layerPicker(s: Record<string, unknown>): { readonly allowNew: boolean } | null {
  const ext = s['x-emc2'];
  if (!isObject(ext) || ext.kind !== 'layer') return null;
  return { allowNew: ext.allowNew !== false };
}

export interface Property {
  readonly name: string;
  readonly required: boolean;
  readonly field: Field;
  /** SDK 1.3.0: enabled only while the sibling `property`'s value is in `in` ({@link isEnabled}). */
  readonly enabledWhen?: EnabledWhen;
  /** SDK 1.5.0 part 4: shown only while the sibling `property`'s value is in `in` ({@link isVisible}). */
  readonly visibleWhen?: EnabledWhen;
}

export interface EnabledWhen {
  /** The sibling it depends on, with its label and default. */
  readonly property: string;
  readonly label: string;
  readonly default: Json | undefined;
  readonly in: readonly Json[];
}

/** Told of an `x-emc2.enabledWhen` or `visibleWhen` the form cannot use: where it is in the schema (a JSON Pointer), and why. */
export type Unusable = (path: string, problem: string) => void;

type WhenKey = 'enabledWhen' | 'visibleWhen';

/**
 * `x-emc2.enabledWhen` or `visibleWhen` of `schema`, if the form can use it among `siblings` (the
 * object's properties); a string saying why not; or undefined when there is none.
 */
function whenOf(key: WhenKey, name: string, schema: unknown, siblings: Record<string, unknown>): EnabledWhen | string | undefined {
  const ext = isObject(schema) ? schema['x-emc2'] : undefined;
  if (!isObject(ext) || !(key in ext)) return undefined;
  const when = ext[key];
  if (!isObject(when)) return 'it is not an object';
  if (typeof when.property !== 'string') return 'its "property" is not a string';
  if (when.property === name) return 'it names the field itself';
  const sibling = Object.hasOwn(siblings, when.property) ? siblings[when.property] : undefined;
  if (!isObject(sibling)) return `there is no field "${when.property}" beside it`;
  const values = Array.isArray(when.in) ? when.in.filter((v): v is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof v)) : [];
  if (values.length === 0) return 'its "in" holds no strings, numbers or booleans';
  return { property: when.property, label: str(sibling.title) ?? labelOf(when.property), default: sibling.default as Json | undefined, in: values };
}

/** Whether `when` holds in `value`, the object that holds the field and its sibling; true without one. */
function holds(when: EnabledWhen | undefined, value: JsonObject): boolean {
  if (when === undefined) return true;
  const sibling = Object.hasOwn(value, when.property) ? value[when.property] : when.default;
  return sibling === undefined || when.in.some((v) => sameJson(v, sibling));
}

/** Whether `property` is enabled in `value`, the object that holds it and its sibling (SDK 1.3.0, `enabledWhen`). */
export function isEnabled(property: Property, value: JsonObject): boolean {
  return holds(property.enabledWhen, value);
}

/** Whether `property` is shown in `value`, the object that holds it and its sibling (SDK 1.5.0 part 4, `visibleWhen`). */
export function isVisible(property: Property, value: JsonObject): boolean {
  return holds(property.visibleWhen, value);
}

/** Keywords the form cannot show as inputs: a schema with one of them gets a JSON text box. */
const UNSUPPORTED = [
  '$ref', '$dynamicRef', 'oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else', 'const',
  'patternProperties', 'dependentSchemas', 'dependentRequired', 'prefixItems', 'contains',
];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const CONDITIONAL = ['if', 'then', 'else'];
/** Only `if`, `then` and `else`, each a schema: a condition the server checks and the form leaves to it. */
const onlyConditional = (s: unknown) => isObject(s) && Object.keys(s).length > 0 && Object.keys(s).every((k) => CONDITIONAL.includes(k));

/**
 * Whether `s` uses a keyword the form cannot show. SDK 1.5.0 part 4 (A1): an object's `if`/`then`/
 * `else`, and an `allOf` made only of such conditions, are validation only and do not count.
 */
function unsupported(s: Record<string, unknown>): boolean {
  const isObjectSchema = s.type === 'object' || (s.type === undefined && isObject(s.properties));
  return UNSUPPORTED.some((k) => {
    if (!(k in s)) return false;
    if (!isObjectSchema) return true;
    if (CONDITIONAL.includes(k)) return !isObject(s[k]);
    return k !== 'allOf' || !Array.isArray(s.allOf) || s.allOf.length === 0 || !s.allOf.every(onlyConditional);
  });
}
const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** "upstreamTimeoutSeconds" → "Upstream timeout seconds". */
export function labelOf(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words === '' ? name : words.charAt(0).toUpperCase() + words.slice(1);
}

/** The line under a TLS credential field without a hint of its own. */
export const CREDENTIAL_HINT = "A TLS credential on the server; \"(the link's name)\" uses the one named as the link.";

/**
 * The field for `schema`, labelled `label` unless the schema has a `title`. `unusable` hears of
 * each `enabledWhen` and `visibleWhen` the form cannot use, at `path`, this schema's place in the whole.
 */
export function fieldOf(schema: unknown, label: string, unusable?: Unusable, path = ''): Field {
  const s = isObject(schema) ? schema : {};
  const help = fieldHint(s);
  const ext = isObject(s['x-emc2']) ? s['x-emc2'] : {};
  const common: Common = {
    label: str(s.title) ?? label,
    description: str(s.description),
    default: s.default as Json | undefined,
    hint: help.hint ?? (ext.kind === 'tls-credential' ? CREDENTIAL_HINT : null),
    more: help.more,
    width: fieldWidth(s),
    unit: str(ext.unit),
  };
  if (!isObject(schema) || unsupported(s)) return { ...common, kind: 'json' };
  if (Array.isArray(s.enum)) {
    return s.enum.every((o) => o === null || ['string', 'number', 'boolean'].includes(typeof o))
      ? { ...common, kind: 'choice', options: s.enum as Json[] }
      : { ...common, kind: 'json' };
  }
  const type = s.type ?? (isObject(s.properties) ? 'object' : undefined);
  switch (type) {
    case 'object': {
      const picker = layerPicker(s);
      if (picker !== null) return { ...common, kind: 'layer', allowNew: picker.allowNew };
      if (!isObject(s.properties)) return { ...common, kind: 'json' };
      const required = Array.isArray(s.required) ? s.required : [];
      const siblings = s.properties;
      const properties = Object.entries(siblings).map(([name, sub]): Property => {
        const at = below(below(path, 'properties'), name);
        const when = whenOf('enabledWhen', name, sub, siblings);
        if (typeof when === 'string') unusable?.(`${at}/x-emc2/enabledWhen`, when);
        const shown = whenOf('visibleWhen', name, sub, siblings);
        if (typeof shown === 'string') unusable?.(`${at}/x-emc2/visibleWhen`, shown);
        const field = fieldOf(sub, labelOf(name), unusable, at);
        return {
          name, required: required.includes(name), field,
          ...(when === undefined || typeof when === 'string' ? {} : { enabledWhen: when }),
          ...(shown === undefined || typeof shown === 'string' ? {} : { visibleWhen: shown }),
        };
      });
      return { ...common, kind: 'object', properties, sections: formSections(s) };
    }
    case 'array': {
      if (!isObject(s.items)) return { ...common, kind: 'json' };
      const picker = (s.items.type ?? 'object') === 'object' && !unsupported(s.items)
        ? layerPicker(s.items) : null;
      if (picker !== null) {
        return {
          ...common, kind: 'layers', allowNew: picker.allowNew,
          ...optional('minItems', num(s.minItems)), ...optional('maxItems', num(s.maxItems)),
        };
      }
      return {
        ...common, kind: 'list', item: fieldOf(s.items, common.label, unusable, `${path}/items`),
        ...optional('minItems', num(s.minItems)), ...optional('maxItems', num(s.maxItems)),
      };
    }
    case 'boolean':
      return { ...common, kind: 'boolean' };
    case 'string':
      return {
        ...common, kind: 'text',
        ...optional('minLength', num(s.minLength)), ...optional('maxLength', num(s.maxLength)), ...optional('pattern', str(s.pattern)),
        ...optional('example', Array.isArray(s.examples) ? str(s.examples[0]) : undefined),
        ...(isObject(s['x-emc2']) && s['x-emc2'].kind === 'colour' ? { colour: true as const } : {}),
        ...(isObject(s['x-emc2']) && s['x-emc2'].kind === 'tls-credential' ? { credential: true as const } : {}),
      };
    case 'integer':
    case 'number':
      return {
        ...common, kind: 'number', integer: type === 'integer',
        ...optional('minimum', num(s.minimum)), ...optional('maximum', num(s.maximum)),
      };
    default:
      return { ...common, kind: 'json' };
  }
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

/**
 * A new value for `field`, e.g. for a list item just added: its default, else an empty value; an
 * object gets its properties' defaults and empty values for its required properties.
 */
export function emptyOf(field: Field): Json {
  if (field.default !== undefined) return field.default;
  switch (field.kind) {
    case 'object': {
      const value: Record<string, Json> = {};
      for (const p of field.properties) {
        if (p.field.default !== undefined || p.required) value[p.name] = emptyOf(p.field);
      }
      return value;
    }
    case 'boolean': return false;
    case 'text': return '';
    case 'number': return field.minimum !== undefined && field.minimum > 0 ? field.minimum : 0;
    case 'choice': return field.options[0] ?? null;
    case 'list': return [];
    case 'layer': return null; // none picked yet: a required one says so
    case 'layers': return [];
    case 'json': return null;
  }
}

/** A JSON Pointer one step below `pointer` (RFC 6901). */
export function below(pointer: string, step: string | number): string {
  return `${pointer}/${String(step).replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

const isList = (value: Json | undefined): value is readonly Json[] => Array.isArray(value);

/** The value at `pointer` (RFC 6901) in `value`; undefined where there is none. */
export function valueAt(value: Json | undefined, pointer: string): Json | undefined {
  if (pointer === '') return value;
  let at: Json | undefined = value;
  for (const raw of pointer.slice(1).split('/')) {
    const step = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (isList(at)) at = /^(0|[1-9]\d*)$/.test(step) ? at[Number(step)] : undefined;
    else if (isObject(at)) at = Object.hasOwn(at, step) ? at[step] : undefined;
    else return undefined;
  }
  return at;
}

/** Whether two JSON values are equal; the order of an object's members does not count. */
/**
 * T-203 part C (findings S1): how many values differ between `a` and `b`: each leaf value that
 * differs counts one, and so does a list item or a property that only one of them has.
 */
export function changedValues(a: unknown, b: unknown): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    let n = Math.abs(a.length - b.length);
    for (let i = 0; i < Math.min(a.length, b.length); i++) n += changedValues(a[i], b[i]);
    return n;
  }
  if (isObject(a) && isObject(b)) {
    let n = 0;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      n += key in a && key in b ? changedValues(a[key], b[key]) : 1;
    }
    return n;
  }
  return sameJson(a, b) ? 0 : 1;
}

export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a).filter((k) => a[k] !== undefined);
    return keys.length === Object.keys(b).filter((k) => b[k] !== undefined).length && keys.every((k) => sameJson(a[k], b[k]));
  }
  return false;
}

const NUMBER = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;

/** The number typed, or why it is not one; empty text is "not set". */
export function readNumber(text: string, integer: boolean): { readonly value: number | undefined; readonly problem: string | null } {
  const t = text.trim();
  if (t === '') return { value: undefined, problem: null };
  const n = Number(t);
  if (!NUMBER.test(t) || !Number.isFinite(n)) return { value: undefined, problem: 'Not a number.' };
  if (integer && !Number.isInteger(n)) return { value: undefined, problem: 'Not a whole number.' };
  return { value: n, problem: null };
}
