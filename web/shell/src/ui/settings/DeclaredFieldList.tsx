/**
 * A plugin's declared fields (SDK 1.2.0, ADR-0038), read-only, in its entry in the Settings list
 * (owner, 2026-10-26): so that an admin sees what the plugin adds to objects and which fields other
 * plugins' editors may set. Nothing here is configurable; the fields come from the manifests, fixed
 * while the server runs (`declaredFields` in `GET /api/config`).
 */
import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_FIELD_MAX_LENGTH, type DataType, type DeclaredField, type FieldSet } from '@emc2/plugin-sdk';
import type { SharedState } from '../../plugins/shared.ts';

/** What a field holds, in words: its type with its unit, limits and choices. */
function describeField(field: DeclaredField): string {
  const range = rangeOf(field);
  switch (field.type) {
    case 'text':
      return `Text, at most ${String(field.maxLength ?? DEFAULT_FIELD_MAX_LENGTH)} characters`;
    case 'number':
    case 'integer':
      return [field.type === 'number' ? 'Number' : 'Whole number', field.unit === undefined ? null : `in ${field.unit}`, range]
        .filter((x) => x !== null).join(', ');
    case 'choice':
      return `One of: ${(field.choices ?? []).map((c) => c.label).join(', ')}`;
    case 'boolean':
      return 'Yes or no';
  }
}

function rangeOf(field: DeclaredField): string | null {
  const { minimum, maximum } = field;
  if (minimum !== undefined && maximum !== undefined) return `from ${String(minimum)} to ${String(maximum)}`;
  if (minimum !== undefined) return `at least ${String(minimum)}`;
  if (maximum !== undefined) return `at most ${String(maximum)}`;
  return null;
}

/**
 * The plugin's field sets that hold a field, and the data types that bring them (SDK 1.5.0,
 * CR-0038): "In Unit, brought by CoT track." Null for a field in no set. A field's own `dataTypes`
 * is deprecated and no longer shown (point 8).
 */
function inSets(field: DeclaredField, sets: readonly FieldSet[], dataTypes: readonly DataType[]): string | null {
  const holding = sets.filter((s) => s.plugin === field.plugin && s.fields.includes(field.name));
  if (holding.length === 0) return null;
  const bringing = dataTypes.filter((t) => holding.some((s) => t.fieldSets?.includes(s.id) === true)).map((t) => t.name);
  return `In ${holding.map((s) => s.label).join(', ')}${bringing.length === 0 ? '' : `, brought by ${bringing.join(', ')}`}`;
}

export function DeclaredFieldList({ pluginId, shared }: { readonly pluginId: string; readonly shared: SharedState }) {
  const all = useSyncExternalStore(shared.onDeclaredFields, () => shared.declaredFields);
  const onDataTypes = useCallback((listener: () => void) => shared.onDataTypes(listener), [shared]);
  const dataTypes = useSyncExternalStore(onDataTypes, () => shared.dataTypes);
  const fields = all.filter((f) => f.plugin === pluginId);
  if (fields.length === 0) return null;
  const headingId = `declared-fields-${pluginId}`;
  return (
    <section className="settings-card" aria-labelledby={headingId}>
      <h3 id={headingId}>Declared fields</h3>
      <p className="muted">
        What this plugin adds to objects. Editors show these fields; those marked "Others may set it" can be set in any plugin's editor.
      </p>
      <ul className="declared-fields">
        {fields.map((f) => (
          <li key={f.name}>
            <span className="declared-field-name">{f.label}</span> <span className="muted settings-id">{f.name}</span>
            {f.description !== undefined && <p>{f.description}</p>}
            <p className="muted">
              {[describeField(f), f.required === true ? 'Required' : null, f.editableByOthers === true ? 'Others may set it' : 'Only this plugin sets it',
                inSets(f, shared.fieldSets, dataTypes)].filter((x) => x !== null).map((x) => `${x}.`).join(' ')}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
