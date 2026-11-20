// The declared fields of the selected symbol, under its core fields (brief, function 20; ADR-0038 point 5). It is the web SDK's shared editor
// with the commit rules of the core fields (function 5): a text or number commits on Enter or when it is left, a choice and a yes/no at
// once, and Escape drops what is being typed. A commit names only the fields the user changed, so that another user's newer values
// survive; a value that breaks its declaration shows its problem at its field and is not sent.
import { useMemo, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import { changedFields, DeclaredFields, fieldProblems, fieldValuesOf, sameField, withDataTypeSets } from '@emc2/plugin-sdk';
import type { DataType, DeclaredField, FieldValue } from '@emc2/plugin-sdk';
import type { EditableSymbol } from './content.ts';
import type { DrawController } from './controller.ts';

const keyOf = (f: { readonly plugin: string; readonly name: string }) => `${f.plugin}.${f.name}`;

/** Fields whose commit waits for Enter or leaving the field; the others commit when they change. */
const typed = (field: DeclaredField | undefined): boolean => field?.type === 'text' || field?.type === 'number' || field?.type === 'integer';

export function FieldsEditor(props: {
  readonly object: EditableSymbol;
  readonly fields: readonly DeclaredField[];
  /** The available data types: the symbol's own gives the sets it carries by type (SDK 1.5.0, brief function 30). */
  readonly dataTypes: readonly DataType[];
  readonly readOnly: boolean;
  readonly controller: DrawController;
}) {
  const { object, fields, dataTypes, readOnly, controller } = props;
  const base = useMemo(() => fieldValuesOf(object, fields), [object, fields]);
  // What the user has changed and not committed yet, by field. A value set elsewhere shows at once, except in these fields.
  const [drafts, setDrafts] = useState<ReadonlyMap<string, FieldValue>>(new Map());
  const values = useMemo(() => [...base.filter((v) => !drafts.has(keyOf(v))), ...drafts.values()], [base, drafts]);
  // What a commit has sent and the store has not answered yet, by field (the newest value sent for it). A change is compared with what the
  // store will hold once these are answered, not with `base`: a change back to the value `base` still has (Red, then "—") is a change, and
  // Enter followed by leaving the field is none.
  const inFlight = useRef(new Map<string, FieldValue>());

  const commit = (list: readonly FieldValue[]) => {
    if (readOnly) return;
    const expected = [...base.filter((v) => !inFlight.current.has(keyOf(v))), ...inFlight.current.values()];
    const changed = changedFields(expected, list);
    if (changed.length === 0) {
      // Typed back to what the object holds: follow the object again.
      setDrafts((prev) => new Map([...prev].filter(([key, v]) => !base.some((b) => keyOf(b) === key && Object.is(b.value, v.value)))));
      return;
    }
    if (fieldProblems(fields, changed, expected).length > 0) return; // each is shown at its field
    for (const c of changed) inFlight.current.set(keyOf(c), c);
    controller.guard(
      controller.update(object.id, 'change the fields', (core) => core, false, changed).then((done) => {
        for (const c of changed) if (inFlight.current.get(keyOf(c)) === c) inFlight.current.delete(keyOf(c)); // a newer change keeps its entry
        // The draft goes when it is what was sent: a value typed or chosen since stays shown until its own answer.
        if (done) setDrafts((prev) => new Map([...prev].filter(([key, v]) => !changed.some((c) => keyOf(c) === key && Object.is(c.value, v.value)))));
      }),
    );
  };

  const onChange = (next: readonly FieldValue[]) => {
    // What changed against what is shown: a field's value. The editor keeps every field and sets an emptied one to null.
    let now = false;
    const nextDrafts = new Map(drafts);
    for (const v of next) {
      const before = values.find((x) => sameField(x, v));
      if (before !== undefined && Object.is(before.value, v.value)) continue;
      nextDrafts.set(keyOf(v), v);
      // A choice or a yes/no commits at once (also set back to "—"); a field that had no value and is emptied again has nothing to send: commit finds no change.
      if (!typed(fields.find((f) => sameField(f, v)))) now = true;
    }
    setDrafts(nextDrafts);
    if (now) commit(next);
  };

  // The "+" adds the set at once, as a committed field does: one update with the set listed (brief, function 27). The group shows when the object arrives with it.
  const onAddSet = (setId: string) => {
    controller.guard(controller.update(object.id, 'add the field set', (core) => core, false, [], [setId]));
  };

  // Enter and leaving a text or number field commit what was typed; Escape drops it.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) commit(values);
    else if (event.key === 'Escape' && drafts.size > 0) setDrafts(new Map());
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement && event.target.type !== 'checkbox') commit(values);
  };

  return (
    // The form is keyed by the symbol's id, so this editor and the shared one start afresh for each symbol.
    <div className="draw-symbols-wide draw-symbols-fields" onKeyDown={onKeyDown} onBlur={onBlur}>
      <DeclaredFields
        fields={fields}
        values={values}
        onChange={onChange}
        dataType={object.dataType}
        pluginId={controller.pluginId}
        readOnly={readOnly}
        fieldSets={controller.fieldSets}
        objectSets={withDataTypeSets(object.fieldSets, dataTypes.find((t) => t.id === object.dataType))}
        dataTypes={dataTypes}
        onAddSet={onAddSet}
      />
    </div>
  );
}
