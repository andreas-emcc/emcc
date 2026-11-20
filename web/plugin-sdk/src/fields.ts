/**
 * SDK 1.2.0: declared fields (ADR-0038; CR-0025 part 4). A plugin declares fields in its manifest's
 * `fields`; their values live in `extensions.<plugin>.<name>`. An editor sets another plugin's
 * fields that are `editableByOthers` by naming them in a change request
 * (`changeRequests.withFields`), never by writing that plugin's namespace in the content, which the
 * store ignores on an update (blind forwarding, ADR-0018).
 */
import type { FieldValue, MapObject, MapObjectContent } from './model.ts';

/** A declared field's type. */
export type FieldType = 'text' | 'number' | 'integer' | 'choice' | 'boolean';

/** One value of a choice field. */
export interface FieldChoice {
  readonly value: string;
  readonly label: string;
}

/** A field a loaded plugin declares (the manifest's `fields`, with the declaring plugin). */
export interface DeclaredField {
  readonly plugin: string;
  readonly name: string;
  readonly type: FieldType;
  readonly label: string;
  readonly description?: string;
  /** For number and integer: the unit values are stored in (an SI unit where one exists, `deg` for angles). */
  readonly unit?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  /** For text: the longest value; absent means {@link DEFAULT_FIELD_MAX_LENGTH}. */
  readonly maxLength?: number;
  /** The value may not be removed. */
  readonly required?: boolean;
  /** For choice. */
  readonly choices?: readonly FieldChoice[];
  /** Whether users may set it through any plugin's editor. */
  readonly editableByOthers?: boolean;
  /**
   * The data types it belongs to; absent: every object.
   *
   * @deprecated SDK 1.5.0 (CR-0038 point 8): a data type names its field sets instead
   * (`DataType.fieldSets`); `DeclaredFields` no longer shows a group for it. Still valid in 1.x.
   */
  readonly dataTypes?: readonly string[];
}

/** The longest text value when a declaration names no `maxLength`. */
export const DEFAULT_FIELD_MAX_LENGTH = 1024;

/** Whether `a` and `b` are the same field. */
export function sameField(a: { readonly plugin: string; readonly name: string }, b: { readonly plugin: string; readonly name: string }): boolean {
  return a.plugin === b.plugin && a.name === b.name;
}

/**
 * Whether `field` belongs to objects of `dataType`: it names that data type, or names none. The
 * `DeclaredFields` editor shows first only the fields that **name** the data type; one that names
 * none belongs to every object and is in the editor's "Other fields" (SDK 1.3.0; the "+" before).
 *
 * @deprecated SDK 1.5.0 (CR-0038 point 8), with `DeclaredField.dataTypes`: an object's fields are
 * those of the sets it carries (`fieldSets`, and its data type's, `withDataTypeSets`).
 */
export function fieldBelongsTo(field: DeclaredField, dataType: string): boolean {
  return field.dataTypes === undefined || field.dataTypes.includes(dataType);
}

/** Whether a user of plugin `pluginId`'s editor may set `field`: it is editable by others, or it is the plugin's own. */
export function fieldEditableBy(field: DeclaredField, pluginId: string): boolean {
  return field.editableByOthers === true || field.plugin === pluginId;
}

/**
 * What is wrong with `value` for `field`, as the object store says it; null if nothing. `null` as
 * the value removes the field, which a required field refuses.
 */
export function declaredFieldProblem(field: DeclaredField, value: FieldValue['value']): string | null {
  if (value === null) return field.required === true ? `${field.label} is required` : null;
  switch (field.type) {
    case 'text':
      if (typeof value !== 'string') return `${field.label} must be text`;
      return [...value].length > (field.maxLength ?? DEFAULT_FIELD_MAX_LENGTH) ? `${field.label} is too long` : null;
    case 'choice':
      if (typeof value !== 'string') return `${field.label} must be one of its choices`;
      return (field.choices ?? []).some((c) => c.value === value) ? null : `${field.label} has no choice ${value}`;
    case 'boolean':
      return typeof value === 'boolean' ? null : `${field.label} must be yes or no`;
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${field.label} must be a number`;
      if (field.type === 'integer' && !Number.isInteger(value)) return `${field.label} must be a whole number`;
      const unit = field.unit === undefined ? '' : ` ${field.unit}`;
      if (field.minimum !== undefined && value < field.minimum) return `${field.label} is below ${field.minimum}${unit}`;
      if (field.maximum !== undefined && value > field.maximum) return `${field.label} is above ${field.maximum}${unit}`;
      return null;
    }
  }
}

/**
 * A typed number: a decimal with a point or a comma (`12.5`, `12,5`), an optional sign and
 * exponent; `null` for empty text, `NaN` for text that is no such number (e.g. `fast`, `0x1F`),
 * which {@link declaredFieldProblem} refuses. Text being typed, such as `12.`, is its number.
 */
export function parseFieldNumber(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  const normal = t.includes('.') ? t : t.replace(',', '.');
  return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(normal) ? Number(normal) : Number.NaN;
}

/**
 * Every value in `values` that breaks its declaration in `fields`, with the problem; check it is
 * empty before sending. A value of no declared field is a problem too. With `start` (what the
 * object held), a required field without a value is a problem only if it had one: required means a
 * value may not be removed, and a field that never had one sends nothing ({@link changedFields}).
 */
export function fieldProblems(
  fields: readonly DeclaredField[],
  values: readonly FieldValue[],
  start?: readonly FieldValue[],
): { readonly value: FieldValue; readonly problem: string }[] {
  const out: { readonly value: FieldValue; readonly problem: string }[] = [];
  for (const v of values) {
    const field = fields.find((f) => sameField(f, v));
    const neverSet = start !== undefined && v.value === null && !start.some((s) => sameField(s, v) && s.value !== null);
    const problem = field === undefined ? `no plugin declares the field ${v.plugin}.${v.name}` : neverSet ? null : declaredFieldProblem(field, v.value);
    if (problem !== null) out.push({ value: v, problem });
  }
  return out;
}

/** The values `object` holds for the declared `fields`, in the order of `fields`: what an editor starts from. */
export function fieldValuesOf(object: MapObject | MapObjectContent, fields: readonly DeclaredField[]): FieldValue[] {
  const out: FieldValue[] = [];
  for (const f of fields) {
    const value = object.extensions?.[f.plugin]?.[f.name];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out.push({ plugin: f.plugin, name: f.name, value });
  }
  return out;
}

/**
 * The fields to name in a change request for an edit from `before` to `after`: each field whose
 * value changed, and `null` for each field `before` had that `after` no longer has (or has as
 * null). Unchanged fields are left out, so that the request does not overwrite what others set
 * meanwhile.
 *
 * @example
 * const fields = changedFields(fieldValuesOf(object, ctx.declaredFields), edited);
 * await ctx.changes.submit(changeRequests.withFields(changeRequests.updateObject(object, content), fields));
 */
export function changedFields(before: readonly FieldValue[], after: readonly FieldValue[]): FieldValue[] {
  const out: FieldValue[] = [];
  for (const a of after) {
    const b = before.find((x) => sameField(x, a));
    if (b === undefined ? a.value !== null : b.value !== a.value) out.push(a);
  }
  for (const b of before) {
    if (b.value !== null && !after.some((a) => sameField(a, b))) out.push({ plugin: b.plugin, name: b.name, value: null });
  }
  return out;
}
