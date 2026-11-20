/**
 * SDK 1.2.0: the shared editor for declared fields (ADR-0038 point 5; CR-0025 part 4). SDK 1.4.0:
 * the field-set editor (ADR-0050 point 5; CR-0030 part 3), which replaces SDK 1.3.0's "Other fields".
 * SDK 1.5.0 (CR-0038 point 5): one set at a time, chosen in a drop-down, with a "+" for the others.
 * `draw-symbols` and the simulator use it, so that every editor offers field sets the same way.
 */
import { Plus } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { declaredFieldProblem, fieldEditableBy, parseFieldNumber, sameField, type DeclaredField } from '../fields.ts';
import type { FieldValue } from '../model.ts';
import type { FieldSet } from '../sets.ts';
import { Checkbox, IconButton, Menu, Popover, Select, TextField } from './index.tsx';

/** The field's label with its unit, e.g. `Cruise speed (m/s)`. */
function labelOf(field: DeclaredField): string {
  return field.unit === undefined ? field.label : `${field.label} (${field.unit})`;
}

const keyOf = (f: { readonly plugin: string; readonly name: string }) => `${f.plugin}.${f.name}`;

/**
 * The declared fields of one object, for a create or edit dialog: the **field-set editor**
 * (ADR-0050 point 5; SDK 1.5.0, CR-0038 point 5: **one set at a time**). After the caller's core
 * fields it shows:
 *
 * 1. **a drop-down "Field set" of the object's sets:** those it carries (`objectSets`, in its order;
 *    in a create dialog those the new object will carry, see `withDataTypeSets`), then each declared
 *    set it does **not** carry but one of whose fields has a value, marked "(not added)" and read
 *    only until the set is added. Only the chosen set's fields are shown. It opens on the first set
 *    of the object's data type (`dataType` in `dataTypes`), else on the first in the list, and again
 *    when `dataType` changes. **Without a set, there is no drop-down.** A set no loaded plugin
 *    declares any more is not listed (the store keeps it);
 * 2. **a "+"** next to it, unless `readOnly` or without `onAddSet`, which offers in a menu the
 *    declared sets the object does not carry. Choosing one calls `onAddSet(setId)` and chooses it in
 *    the drop-down; the caller adds the id to its `objectSets` (and sends it with
 *    `changeRequests.withFieldSets`). With no set yet the "+" stands alone, and it is not shown when
 *    no set is left to add (the owner's Q1: an object may carry more sets than its data type's).
 *
 * A field the editor may not set is read only. In a "(not added)" set only the fields with a value
 * are shown, and a field that a carried set has is shown there instead. Text goes through
 * `TextField`, numbers through `TextField` with the unit, choices through `Select`, yes/no through
 * `Checkbox`. There is no remove button: emptying a field (an empty text or number, a choice's "—")
 * clears it, and a set is never removed (ADR-0050 point 3). A check box that is set and cleared
 * again sends `false`. **SDK 1.5.0:** a field's `dataTypes` no longer gives it a group of its own
 * (deprecated, CR-0038 point 8).
 *
 * It is controlled: `values` holds what the dialog shows, a `null` value for a field emptied. A
 * number that does not parse is `NaN` in `values`. Start from `fieldValuesOf(object, fields)`, and
 * before you send, check `fieldProblems(fields, values, start)`: send only when it is empty, with
 * `changedFields(start, values)` in the request (`changeRequests.withFields`), which names only
 * what the user changed. A value that breaks its declaration shows its problem under the field, as
 * the store would say it.
 *
 * @example
 * const type = ctx.dataTypes.find((t) => t.id === content.dataType);
 * <DeclaredFields key={object.id} fields={ctx.declaredFields} fieldSets={ctx.fieldSets} dataTypes={ctx.dataTypes}
 *   objectSets={withDataTypeSets(sets, type)} onAddSet={(id) => setSets([...sets, id])}
 *   values={values} onChange={setValues} dataType={content.dataType} pluginId={ctx.pluginId} />
 */
export function DeclaredFields(props: {
  /** Every declared field, usually `ctx.declaredFields`. */
  readonly fields: readonly DeclaredField[];
  readonly values: readonly FieldValue[];
  readonly onChange: (values: readonly FieldValue[]) => void;
  /** The object's data type: the drop-down opens on its first set. */
  readonly dataType: string;
  /** The editor's plugin, whose own fields count as editable; default: only fields editable by others. */
  readonly pluginId?: string;
  readonly readOnly?: boolean;
  /** SDK 1.4.0: every declared field set, usually `ctx.fieldSets`; default none. */
  readonly fieldSets?: readonly FieldSet[];
  /** SDK 1.4.0: the ids of the sets the object carries, those added in the dialog included; default none. */
  readonly objectSets?: readonly string[];
  /** SDK 1.4.0: called with a set's id when the user adds it; without it there is no "+". */
  readonly onAddSet?: (setId: string) => void;
  /** SDK 1.5.0: the available data types, usually `ctx.dataTypes`, for the data type's first set; default none. */
  readonly dataTypes?: readonly { readonly id: string; readonly fieldSets?: readonly string[] }[];
}): ReactNode {
  const declaredSets = props.fieldSets ?? [];
  const objectSets = props.objectSets ?? [];
  const editable = (f: DeclaredField) => !props.readOnly && fieldEditableBy(f, props.pluginId ?? '');
  const hasValue = (f: DeclaredField) => props.values.some((v) => sameField(v, f) && v.value !== null);
  const valueOf = (f: DeclaredField) => props.values.find((v) => sameField(v, f))?.value ?? null;
  const fieldOf = (plugin: string, name: string) => props.fields.find((f) => f.plugin === plugin && f.name === name);
  const fieldsOf = (set: FieldSet) => set.fields.map((n) => fieldOf(set.plugin, n)).filter((f): f is DeclaredField => f !== undefined);

  const carried = [...new Set(objectSets)].map((id) => declaredSets.find((s) => s.id === id)).filter((s): s is FieldSet => s !== undefined);
  const listed: { readonly set: FieldSet; readonly fields: readonly DeclaredField[]; readonly readOnly: boolean }[] =
    carried.map((set) => ({ set, fields: fieldsOf(set), readOnly: false }));
  const shown = new Set(listed.flatMap((g) => g.fields.map(keyOf)));
  for (const set of declaredSets) {
    if (objectSets.includes(set.id)) continue;
    const valued = fieldsOf(set).filter((f) => hasValue(f) && !shown.has(keyOf(f)));
    valued.forEach((f) => shown.add(keyOf(f)));
    if (valued.length > 0) listed.push({ set, fields: valued, readOnly: true });
  }

  // The user's choice holds until the data type changes; then the new type's first set is chosen.
  const [chosen, setChosen] = useState<{ readonly id: string; readonly dataType: string } | null>(null);
  const typeFirst = props.dataTypes?.find((t) => t.id === props.dataType)?.fieldSets?.[0];
  const picked = chosen !== null && chosen.dataType === props.dataType ? chosen.id : undefined;
  const current = listed.find((g) => g.set.id === picked) ?? listed.find((g) => g.set.id === typeFirst) ?? listed[0];
  const addable = props.readOnly === true || props.onAddSet === undefined ? [] : declaredSets.filter((s) => !objectSets.includes(s.id));

  const set = (f: DeclaredField, value: FieldValue['value']) => {
    const next = { plugin: f.plugin, name: f.name, value };
    props.onChange(props.values.some((v) => sameField(v, f)) ? props.values.map((v) => (sameField(v, f) ? next : v)) : [...props.values, next]);
  };
  const row = (f: DeclaredField, readOnly: boolean) => (
    <div key={keyOf(f)} className="emc2-fields-row" data-field={keyOf(f)}>
      <FieldInput field={f} value={valueOf(f)} disabled={readOnly || !editable(f)} onChange={(v) => set(f, v)} />
    </div>
  );

  return (
    <div className="emc2-fields">
      {current === undefined && addable.length === 0 ? null : (
        <div className="emc2-fields-row emc2-fields-add">
          {current === undefined ? null : (
            <Select
              label="Field set"
              value={current.set.id}
              options={listed.map((g) => ({ value: g.set.id, label: g.readOnly ? `${g.set.label} (not added)` : g.set.label }))}
              onChange={(id) => setChosen({ id, dataType: props.dataType })}
            />
          )}
          {addable.length === 0 ? null : (
            <AddSet
              sets={addable}
              onAdd={(id) => {
                setChosen({ id, dataType: props.dataType });
                props.onAddSet?.(id);
              }}
            />
          )}
        </div>
      )}
      {current === undefined ? null : (
        <div className="emc2-fields-set" role="group" aria-label={current.set.label} data-set={current.set.id} data-carried={current.readOnly ? 'false' : 'true'}>
          {current.fields.map((f) => row(f, current.readOnly))}
        </div>
      )}
    </div>
  );
}

/** The "+" and its menu of the declared sets the object does not carry. */
function AddSet(props: { readonly sets: readonly FieldSet[]; readonly onAdd: (setId: string) => void }): ReactNode {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const close = () => {
    setOpen(false);
    wrap.current?.querySelector('button')?.focus();
  };
  return (
    <span ref={wrap} className="emc2-fields-add-set">
      <IconButton icon={Plus} label="Add a field set" title="Add a field set" onClick={() => setOpen(!open)} />
      <Popover open={open} label="Add a field set" onClose={close}>
        <Menu
          label="Field sets to add"
          items={props.sets.map((s) => ({ id: s.id, label: s.label }))}
          onChoose={(id) => {
            close();
            props.onAdd(id);
          }}
        />
      </Popover>
    </span>
  );
}

/** One field's input, by its type, with its problem under it. */
function FieldInput(props: {
  readonly field: DeclaredField;
  readonly value: FieldValue['value'];
  readonly disabled: boolean;
  readonly onChange: (value: FieldValue['value']) => void;
}): ReactNode {
  const f = props.field;
  const label = labelOf(f);
  // A field without a value is no problem here: required only means a value may not be removed.
  const problem = props.value === null ? null : declaredFieldProblem(f, props.value);
  switch (f.type) {
    case 'boolean':
      return <Checkbox label={label} checked={props.value === true} disabled={props.disabled} onChange={props.onChange} />;
    case 'choice': {
      const known = typeof props.value === 'string' && (f.choices ?? []).some((c) => c.value === props.value);
      return (
        <div className="emc2-fields-input">
          <Select
            label={label}
            value={known ? (props.value as string) : ''}
            disabled={props.disabled}
            // Always a blank option, so that no value never looks like the first choice; a required field cannot go back to it.
            options={[{ value: '', label: '—', disabled: f.required === true }, ...(f.choices ?? [])]}
            onChange={(v) => props.onChange(v === '' ? null : v)}
          />
          {problem === null ? null : (
            <span className="emc2-field-error">
              {problem}
            </span>
          )}
        </div>
      );
    }
    case 'number':
    case 'integer':
      return <NumberInput field={f} label={label} value={props.value} disabled={props.disabled} onChange={props.onChange} problem={problem} />;
    case 'text':
      return (
        <TextField
          label={label}
          value={typeof props.value === 'string' ? props.value : ''}
          disabled={props.disabled}
          {...(problem === null ? {} : { error: problem })}
          onChange={(v) => props.onChange(v === '' ? null : v)}
        />
      );
  }
}

/** A number as text, so that a value being typed (`-`, `1.`) stays as it is; text that does not parse is `NaN`. */
function NumberInput(props: {
  readonly field: DeclaredField;
  readonly label: string;
  readonly value: FieldValue['value'];
  readonly disabled: boolean;
  readonly problem: string | null;
  readonly onChange: (value: FieldValue['value']) => void;
}): ReactNode {
  const shown = typeof props.value === 'number' && Number.isFinite(props.value) ? String(props.value) : '';
  const [text, setText] = useState(shown);
  useEffect(() => {
    // A new value from outside replaces what is being typed, unless it is what the text means.
    setText((t) => {
      const meant = parseFieldNumber(t);
      return meant === props.value || (Number.isNaN(meant) && Number.isNaN(props.value)) ? t : shown;
    });
  }, [shown, props.value]);
  return (
    <TextField
      label={props.label}
      value={text}
      data
      inputMode={props.field.type === 'integer' ? 'numeric' : 'decimal'}
      disabled={props.disabled}
      {...(props.problem === null ? {} : { error: props.problem })}
      onChange={(t) => {
        setText(t);
        props.onChange(parseFieldNumber(t));
      }}
    />
  );
}
