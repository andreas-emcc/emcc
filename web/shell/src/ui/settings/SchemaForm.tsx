/**
 * The inputs of a generated settings form (`schema.ts`): one editor per field kind, nested for
 * objects and lists. Each input has its label, the schema's description and limits as help, whether
 * it is required, and the server's problems at its JSON Pointer. A value the field cannot show (e.g.
 * stored data of another shape) gets the JSON text box, as an unsupported schema does. A picked
 * layer (SDK 1.2.0) gets a list of View's layers, a set of them checkboxes; from SDK 1.4.0 each with
 * a "+" that creates a layer at once (T-133).
 *
 * T-203 part E (SDK 1.8.0 part D): an object's properties stand in its sections, each a grid where
 * short fields go side by side; a group folds (`<details>`), says how many settings it holds and how
 * many differ from their defaults while folded, and opens for a problem inside. The line under a field
 * is its hint and its limits; the longer text is behind its info button; a number shows its unit.
 */
import { Button, IconButton, isColour, Popover, Select, TextField, type Layer } from '@emc2/plugin-sdk';
import { ChevronDown, ChevronRight, Info, Plus } from 'lucide-react';
import { Fragment, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { LayersState } from '../../layers/known.ts';
import { FormContext, inputId } from './form-context.ts';
import type { CredentialNamesState } from './credentials.ts';
import {
  below, emptyOf, isEnabled, isLayerPick, isVisible, MAX_LAYER_NAME, readNumber, sameJson, type EnabledWhen, type Field, type Json, type JsonObject, type LayerPick,
  type Property,
} from './schema.ts';
import type { FormSection } from '@emc2/plugin-sdk';

export interface EditorProps {
  readonly field: Field;
  /** Undefined: not set (an optional property left out). */
  readonly value: Json | undefined;
  readonly onChange: (value: Json | undefined) => void;
  readonly pointer: string;
  readonly required: boolean;
  /** An entry of a list: always there, so it is not marked as required. */
  readonly item?: boolean;
  /** Overrides the field's label, e.g. "Streams 2" for a list item. */
  readonly label?: string;
}

/** How an input is marked: a required property, an optional one, or a list entry (neither). */
type Need = 'required' | 'optional' | 'item';

const needOf = (props: EditorProps): Need => (props.item === true ? 'item' : props.required ? 'required' : 'optional');

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether `field` can show `value` with its own inputs. */
function fits(field: Field, value: Json | undefined): boolean {
  if (value === undefined) return true;
  switch (field.kind) {
    case 'object': return isObject(value);
    case 'boolean': return typeof value === 'boolean';
    case 'text': return typeof value === 'string';
    case 'number': return typeof value === 'number';
    case 'choice': return field.options.some((o) => sameJson(o, value));
    case 'list': return Array.isArray(value);
    case 'layer': return value === null || isLayerPick(value);
    case 'layers': return Array.isArray(value) && value.every(isLayerPick);
    case 'json': return true;
  }
}

const show = (value: Json): string => (typeof value === 'string' ? value : JSON.stringify(value));

/** The line under an input (part E, owner: hint + limits): the hint, then the limits and the default (none for an empty text, PCA-cot K1). */
function hints(field: Field, need: Need): string[] {
  const out: string[] = [];
  if (field.hint !== null) out.push(/[.!?:;…)"'”’]$/.test(field.hint) ? field.hint : `${field.hint}.`); // a hint often has no full stop
  if (field.kind === 'number') {
    const whole = field.integer ? 'A whole number' : 'A number';
    if (field.minimum !== undefined && field.maximum !== undefined) out.push(`${whole} from ${String(field.minimum)} to ${String(field.maximum)}.`);
    else if (field.minimum !== undefined) out.push(`${whole}, at least ${String(field.minimum)}.`);
    else if (field.maximum !== undefined) out.push(`${whole}, at most ${String(field.maximum)}.`);
    else out.push(`${whole}.`);
  }
  if (field.kind === 'text') {
    if (field.minLength !== undefined && field.minLength > 0 && field.maxLength !== undefined) {
      out.push(`${String(field.minLength)} to ${String(field.maxLength)} characters.`);
    } else if (field.maxLength !== undefined) out.push(`At most ${String(field.maxLength)} characters.`);
  }
  if (field.kind === 'list' && field.maxItems !== undefined && field.maxItems !== field.minItems) out.push(`At most ${String(field.maxItems)} entries.`);
  if (field.kind === 'layers' && field.maxItems !== undefined) out.push(`At most ${String(field.maxItems)} layers.`);
  if ((field.kind === 'layer' || field.kind === 'layers') && !field.allowNew) out.push('Existing layers only.');
  if (field.kind === 'json') out.push('As JSON.');
  if (need === 'optional' && field.default !== undefined && field.kind !== 'object' && field.kind !== 'list' && field.kind !== 'layer'
    && field.kind !== 'layers' && show(field.default).trim() !== '' && show(field.default).length <= 80) {
    out.push(`Default: ${show(field.default)}${field.unit === undefined ? '' : ` ${field.unit}`}.`);
  }
  return out;
}

/**
 * The help and the problems under an input, with the ids its `aria-describedby` names; part E: an
 * info button that shows the field's longer text below it.
 */
function Help({ id, field, need, problems }: { readonly id: string; readonly field: Field; readonly need: Need; readonly problems: readonly string[] }) {
  const text = hints(field, need);
  const [more, setMore] = useState(false);
  return (
    <>
      {(text.length > 0 || field.more !== null) && (
        <div className="field-help-line">
          {text.length > 0 && <p className="field-help" id={`${id}-help`}>{text.join(' ')}</p>}
          {field.more !== null && (
            <button type="button" className="field-more-toggle" aria-expanded={more} aria-controls={`${id}-more`}
              aria-label={`More about ${field.label}`} title={`More about ${field.label}`} onClick={() => { setMore(!more); }}>
              <Info className="emc2-icon" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {field.more !== null && <p className="field-more" id={`${id}-more`} hidden={!more}>{field.more}</p>}
      {problems.length > 0 && <p className="field-problem" id={`${id}-problem`}>{problems.join(' ')}</p>}
    </>
  );
}

function describedBy(id: string, field: Field, need: Need, problems: readonly string[]): string | undefined {
  const ids = [
    hints(field, need).length > 0 ? `${id}-help` : null,
    field.kind === 'number' && field.unit !== undefined ? `${id}-unit` : null,
    problems.length > 0 ? `${id}-problem` : null,
  ].filter((x) => x !== null);
  return ids.length === 0 ? undefined : ids.join(' ');
}

/** Part E: a required input's label is marked (the input also says aria-required). */
const labelClass = (need: Need): string | undefined => (need === 'required' ? 'field-required' : undefined);

/** The UXA's mark after a required input's label: seen, not read (aria-required says it). */
const mark = (need: Need) => (need === 'required' ? <span className="field-required-mark" aria-hidden="true">*</span> : null);

/**
 * The server's problem with a string's pattern in plain words (the MCA's fix 1; part D: the shell never
 * shows the regular expression): with the schema's example where it has one.
 */
function plainProblem(field: Field, problem: string): string {
  if (field.kind !== 'text' || field.pattern === undefined || field.pattern === '') return problem;
  if (!problem.includes(field.pattern) && !/regex|pattern/i.test(problem)) return problem;
  if (field.colour === true) return 'Not a colour: write # and six hexadecimal digits, for example #FF0000.';
  return `Not in the expected form${field.example === undefined ? '' : `, for example ${field.example}`}.`;
}

/** The attributes every input shares: its help, its problems and whether it is required. */
function inputAttributes(id: string, field: Field, need: Need, problems: readonly string[]) {
  return {
    id,
    'aria-invalid': problems.length > 0 || undefined,
    'aria-required': need === 'required' || undefined,
    'aria-describedby': describedBy(id, field, need, problems),
  };
}

export function FieldEditor(props: EditorProps) {
  const { field, value } = props;
  // A list entry emptied is null (a list has no "not set"): it keeps its input, which says it is required.
  const cleared = props.item === true && value === null && (field.kind === 'number' || field.kind === 'choice');
  if (!cleared && !fits(field, value)) return <JsonEditor {...props} />;
  switch (field.kind) {
    case 'object': return <ObjectEditor {...props} field={field} />;
    case 'boolean': return <BooleanEditor {...props} />;
    case 'text': return field.credential === true ? <CredentialEditor {...props} /> : <TextEditor {...props} />;
    case 'number': return <NumberEditor {...props} field={field} />;
    case 'choice': return <ChoiceEditor {...props} field={field} />;
    case 'list': return <ListEditor {...props} field={field} />;
    case 'layer': return <LayerEditor {...props} field={field} />;
    case 'layers': return <LayersEditor {...props} field={field} />;
    case 'json': return <JsonEditor {...props} />;
  }
}

/** The properties of an object, one editor each; the root object has no frame of its own. */
export function Properties({ field, value, onChange, pointer }: {
  readonly field: Extract<Field, { kind: 'object' }>;
  readonly value: JsonObject;
  readonly onChange: (value: JsonObject) => void;
  readonly pointer: string;
}) {
  const { idPrefix, problemsUnder } = useContext(FormContext);
  const shown = new Set(field.properties.filter((p) => isVisible(p, value)).map((p) => p.name));
  // SDK 1.5.0 part 4 (A2): a hidden field's problems show after the field that hides it, else in its place
  const hiddenNotes = (at: string) => field.properties
    .filter((q) => !shown.has(q.name) && q.visibleWhen !== undefined && (shown.has(q.visibleWhen.property) ? q.visibleWhen.property : q.name) === at)
    .flatMap((q) => problemsUnder(below(pointer, q.name)).map((p) => ({ q, ...p })));
  const notes = (at: string) => {
    const list = hiddenNotes(at);
    if (list.length === 0) return null;
    return list.map(({ q, path, problem }) => {
      const inside = path.slice(below(pointer, q.name).length).split('/').filter((x) => x !== '').map((x) => x.replace(/~1/g, '/').replace(/~0/g, '~'));
      return (
        <p key={`${q.name}${path}${problem}`} className="field-problem field-hidden-problem">
          {`${q.field.label}${inside.length > 0 ? ` › ${inside.join(' › ')}` : ''} (${whenNote(q.visibleWhen as EnabledWhen, 'Shown')}): ${problem}`}
        </p>
      );
    });
  };
  const cell = (p: Property) => {
        const editor = (
          <FieldEditor
            field={p.field}
            value={value[p.name]}
            required={p.required}
            pointer={below(pointer, p.name)}
            onChange={(v) => {
              // In place, so that the members keep their order.
              const next = Object.entries(value).flatMap(([name, x]): [string, Json][] => (name !== p.name ? [[name, x]] : v === undefined ? [] : [[name, v]]));
              if (v !== undefined && !(p.name in value)) next.push([p.name, v]);
              onChange(Object.fromEntries(next));
            }}
          />
        );
        // SDK 1.3.0 (`enabledWhen`): greyed and read only while the sibling's value does not match,
        // its value kept; always in this frame, so that a change of the sibling keeps the editor.
        const enabled = isEnabled(p, value);
        const noteId = `${inputId(idPrefix, below(pointer, p.name))}-when`;
        const greyed = p.enabledWhen === undefined ? editor : (
          <fieldset className="field-when" disabled={!enabled} aria-describedby={enabled ? undefined : noteId}>
            {editor}
            {!enabled && <p id={noteId} className="field-help">{whenNote(p.enabledWhen)}</p>}
          </fieldset>
        );
        // SDK 1.5.0 part 4 (`visibleWhen`): hidden first, then greyed; kept in the page while hidden,
        // so that it keeps its value and its editor's state, and is saved as it is.
        // Part E: a cell of the section's grid, short or the whole row
        const full = p.field.kind === 'object' || p.field.kind === 'list' || p.field.kind === 'layers' || p.field.kind === 'json'
          || p.field.width === 'full';
        return (
          <div key={p.name} className={full ? 'field-cell field-cell-full' : 'field-cell field-cell-short'}
            hidden={p.visibleWhen !== undefined && !shown.has(p.name) && notes(p.name) === null}>
            {p.visibleWhen === undefined ? greyed : <div className="field-shown-when" hidden={!shown.has(p.name)}>{greyed}</div>}
            {notes(p.name)}
          </div>
        );
  };
  const byName = new Map(field.properties.map((p) => [p.name, p]));
  const placed = new Set(field.sections.flatMap((s) => s.properties));
  const loose = field.properties.filter((p) => !placed.has(p.name)); // none from the SDK's rules; kept should they differ
  return (
    <>
      {field.sections.map((section) => {
        const properties = section.properties.flatMap((name) => byName.get(name) ?? []);
        if (properties.length === 0) return null;
        const grid = <div className="field-grid">{properties.map(cell)}</div>;
        if (section.label === null || section.object !== undefined) return <Fragment key={section.id ?? ''}>{grid}</Fragment>;
        // A group whose fields are all hidden is left out, unless a hidden field's problem note is in it (review R1)
        const noted = properties.some((p) => notes(p.name) !== null);
        if (!noted && properties.every((p) => !shown.has(p.name))) return null;
        return (
          <Group key={section.id} section={section} properties={properties.filter((p) => shown.has(p.name))} value={value} pointer={pointer}
            noted={noted}>
            {grid}
          </Group>
        );
      })}
      {loose.length > 0 && <div className="field-grid">{loose.map(cell)}</div>}
    </>
  );
}

/**
 * A group of an object's properties (part E, SDK 1.8.0 part D point 1): a `<details>` that starts
 * folded when the group says so (advanced ones always), and opens for a problem or an unreadable input
 * inside. Folded, its head says how many settings it holds and how many differ from their defaults.
 */
function Group({ section, properties, value, pointer, noted, children }: {
  readonly section: FormSection;
  /** The group's fields that are shown: they are counted. */
  readonly properties: readonly Property[];
  readonly value: JsonObject; readonly pointer: string;
  /** A problem or a hidden field's note is inside: the group opens. */
  readonly noted: boolean;
  readonly children: ReactNode;
}) {
  const { needsAttention } = useContext(FormContext);
  const attention = noted || properties.some((p) => needsAttention(below(pointer, p.name)));
  const [open, setOpen] = useState(!section.folded || attention); // one that comes with a problem in it comes open
  const [wasAttention, setWasAttention] = useState(attention);
  if (attention !== wasAttention) { // opened once for a problem, then the user's to close (review R2)
    setWasAttention(attention);
    if (attention) setOpen(true);
  }
  // Changed: set, and neither its default nor its empty value (review R3)
  const changed = properties.filter((p) => Object.hasOwn(value, p.name) && !sameJson(value[p.name], p.field.default)
    && !(p.field.default === undefined && sameJson(value[p.name], emptyOf(p.field)))).length;
  const n = properties.length;
  return (
    <details className="field-section-group" open={open} onToggle={(e) => { setOpen(e.currentTarget.open); }}>
      <summary>
        <span className="field-section-label">{section.label}</span>
        {!open && (
          <span className="field-section-count">
            {`${String(n)} ${n === 1 ? 'setting' : 'settings'}, ${changed === 0 ? (n === 1 ? 'default' : 'all default') : `${String(changed)} changed`}`}
          </span>
        )}
      </summary>
      {section.description !== undefined && <p className="field-help">{section.description}</p>}
      {children}
    </details>
  );
}

/** "Used only when Direction is in or both."; with `lead` "Shown", "shown when Mode is udp" (SDK 1.5.0 part 4). */
function whenNote(when: EnabledWhen, lead?: 'Shown'): string {
  const values = when.in.map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
  const listed = values.length === 1 ? values[0] : `${values.slice(0, -1).join(', ')} or ${values.at(-1) ?? ''}`;
  return lead === undefined ? `Used only when ${when.label} is ${listed ?? ''}.` : `shown when ${when.label} is ${listed ?? ''}`;
}

function ObjectEditor({ field, value, onChange, pointer, required, label }: EditorProps & { readonly field: Extract<Field, { kind: 'object' }> }) {
  const { idPrefix, problemsAt } = useContext(FormContext);
  const id = inputId(idPrefix, pointer);
  const problems = problemsAt(pointer);
  const name = label ?? field.label;
  return (
    <fieldset className="field-group" aria-describedby={describedBy(id, field, 'item', problems)}>
      <legend>{name}</legend>
      <Help id={id} field={field} need="item" problems={problems} />
      {/* Not set: the plugin's own default (owner, this session: "Set" and "Use the default", not "Add" and "Remove") */}
      {value === undefined ? (
        <>
          <p className="field-help">{`${name}: the plugin's default.`}</p>
          <Button onClick={() => { onChange(emptyOf(field)); }}>{`Set ${name}`}</Button>
        </>
      ) : (
        <>
          <Properties field={field} value={value as JsonObject} onChange={onChange} pointer={pointer} />
          {!required && (
            <Button onClick={() => { onChange(undefined); }}>{named('Use the default', `Use the default for ${name}`)}</Button>
          )}
        </>
      )}
    </fieldset>
  );
}

function BooleanEditor(props: EditorProps) {
  const { field, value, onChange, pointer, label } = props;
  const { idPrefix, problemsAt } = useContext(FormContext);
  const id = inputId(idPrefix, pointer);
  const problems = problemsAt(pointer);
  const need = needOf(props);
  const checked = (value ?? field.default ?? false) === true;
  return (
    <div className="field field-check">
      <input
        {...inputAttributes(id, field, need, problems)}
        aria-required={undefined} // a checkbox always has a value
        type="checkbox"
        checked={checked}
        onChange={(e) => { onChange(e.target.checked); }}
      />
      <label htmlFor={id}>{label ?? field.label}</label>
      <Help id={id} field={field} need={need} problems={problems} />
    </div>
  );
}

/**
 * A string's text input. SDK 1.6.0 (CR-0041 part F; owner Q60 A): a colour string has the browser's
 * own colour picker before it; both edit the same value, and the hex stays editable as text. A value
 * the picker cannot show (empty, or not `#RRGGBB`) leaves the text as it is, and the schema's
 * pattern reports it; the picker then shows black until a colour is picked.
 */
function TextEditor(props: EditorProps & { readonly note?: string | null }) {
  const { field, value, onChange, pointer, required, label, note } = props;
  const { idPrefix, problemsAt } = useContext(FormContext);
  const id = inputId(idPrefix, pointer);
  const problems = problemsAt(pointer).map((p) => plainProblem(field, p));
  const need = needOf(props);
  const text = typeof value === 'string' ? value : '';
  const input = (
    <input
      {...inputAttributes(id, field, need, problems)}
      type="text"
      value={text}
      {...(field.kind === 'text' && field.maxLength !== undefined ? { maxLength: field.maxLength } : {})}
      {...(field.kind === 'text' && field.credential === true ? { placeholder: "(the link's name)", autoComplete: 'off' } : {})}
      onChange={(e) => { onChange(e.target.value === '' && !required ? undefined : e.target.value); }}
    />
  );
  return (
    <div className="field">
      <label htmlFor={id} className={labelClass(need)}>{label ?? field.label}{mark(need)}</label>
      {field.kind === 'text' && field.colour === true ? (
        <span className="field-colour">
          <input
            type="color"
            aria-label={`${label ?? field.label}: pick a colour`}
            value={isColour(text) ? text.toLowerCase() : '#000000'}
            onChange={(e) => { onChange(e.target.value.toUpperCase()); }}
          />
          {input}
        </span>
      ) : input}
      <Help id={id} field={field} need={need} problems={problems} />
      {note != null && <p className="field-help">{note}</p>}
    </div>
  );
}

/**
 * ADR-0062 point 3 (M9 C3, CR-0048 point 1.3): a TLS credential, picked from the names the server has, and nothing
 * else of it. "(the link's name)" stands for empty; a stored name the server lacks shows as "<name> (missing)" and is
 * kept until another is picked. Where the names cannot be had, a text field with a note.
 */
function CredentialEditor(props: EditorProps) {
  const { field, value, onChange, pointer, required, label } = props;
  const { idPrefix, problemsAt, credentials } = useContext(FormContext);
  const [state, setState] = useState<CredentialNamesState>({ kind: 'loading' });
  useEffect(() => {
    if (credentials === null) return undefined;
    let open = true;
    void credentials.names().then((s) => { if (open) setState(s); });
    return () => { open = false; };
  }, [credentials]);
  if (credentials === null) return <TextEditor {...props} />;
  if (state.kind === 'loading') return <TextEditor {...props} note="Loading the TLS credentials…" />;
  if (state.kind === 'failed') return <TextEditor {...props} note={`The TLS credentials could not be read: ${state.message}`} />;
  const id = inputId(idPrefix, pointer);
  const need = needOf(props);
  const text = typeof value === 'string' ? value : '';
  const missing = text !== '' && !state.names.includes(text);
  const problems = problemsAt(pointer).map((p) => plainProblem(field, p));
  return (
    <div className="field">
      <label htmlFor={id} className={labelClass(need)}>{label ?? field.label}{mark(need)}</label>
      <select
        {...inputAttributes(id, field, need, problems)}
        value={text}
        onChange={(e) => { onChange(e.target.value === '' && !required ? undefined : e.target.value); }}
      >
        <option value="">(the link&apos;s name)</option>
        {missing && <option value={text}>{`${text} (missing)`}</option>}
        {state.names.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <Help id={id} field={field} need={need} problems={problems} />
      {missing && <p className="field-help">{`The server has no TLS credential named ${text}: the link fails until one is picked or added.`}</p>}
    </div>
  );
}

/**
 * A text input, not `type="number"`: the browser would turn text that is not a number into an empty
 * value without a word, and show decimals in the user's locale. The typed text stays as it is; if it
 * is not a number, the input says so and the form cannot be saved.
 */
function NumberEditor(props: EditorProps & { readonly field: Extract<Field, { kind: 'number' }> }) {
  const { field, value, onChange, pointer, label } = props;
  const { idPrefix, problemsAt, setInvalid } = useContext(FormContext);
  const id = inputId(idPrefix, pointer);
  const need = needOf(props);
  const [text, setText] = useState(() => (typeof value === 'number' ? String(value) : ''));
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    // A value from outside (Discard, someone else's save) replaces the text; our own edit does not.
    setShownValue(value);
    if (readNumber(text, field.integer).value !== value) setText(typeof value === 'number' ? String(value) : '');
  }
  const typed = readNumber(text, field.integer);
  // Empty is "not set": for a required value (or a list entry) the server would only refuse it.
  const own = typed.problem ?? (props.required && typed.value === undefined ? 'Required: enter a value.' : null);
  const bad = own !== null;
  useEffect(() => {
    setInvalid(pointer, bad);
    return () => { setInvalid(pointer, false); };
  }, [pointer, bad, setInvalid]);
  const problems = own === null ? problemsAt(pointer) : [own, ...problemsAt(pointer)];
  return (
    <div className="field">
      <label htmlFor={id} className={labelClass(need)}>{label ?? field.label}{mark(need)}</label>
      <span className="field-with-unit">
      <input
        {...inputAttributes(id, field, need, problems)}
        type="text"
        className="field-number"
        inputMode={field.integer && field.minimum !== undefined && field.minimum >= 0 ? 'numeric' : 'decimal'}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(readNumber(e.target.value, field.integer).value);
        }}
      />
      {field.unit !== undefined && <span className="field-unit" id={`${id}-unit`}>{field.unit}</span>}
      </span>
      <Help id={id} field={field} need={need} problems={problems} />
    </div>
  );
}

function ChoiceEditor(props: EditorProps & { readonly field: Extract<Field, { kind: 'choice' }> }) {
  const { field, value, onChange, pointer, required, label } = props;
  const { idPrefix, problemsAt, setInvalid } = useContext(FormContext);
  const id = inputId(idPrefix, pointer);
  const need = needOf(props);
  const index = field.options.findIndex((o) => sameJson(o, value));
  // A value the stored settings lack, or a list entry emptied: a required choice offers no "Not set".
  const missing = required && index < 0;
  useEffect(() => {
    setInvalid(pointer, missing);
    return () => { setInvalid(pointer, false); };
  }, [pointer, missing, setInvalid]);
  const problems = missing ? ['Required: choose one.', ...problemsAt(pointer)] : problemsAt(pointer);
  return (
    <div className="field">
      <label htmlFor={id} className={labelClass(need)}>{label ?? field.label}{mark(need)}</label>
      <select
        {...inputAttributes(id, field, need, problems)}
        value={index < 0 ? '' : String(index)}
        onChange={(e) => { onChange(e.target.value === '' ? undefined : field.options[Number(e.target.value)]); }}
      >
        {(!required || index < 0) && <option value="">{required ? 'Choose one' : 'Not set'}</option>}
        {field.options.map((o, i) => <option key={show(o)} value={String(i)}>{show(o)}</option>)}
      </select>
      <Help id={id} field={field} need={need} problems={problems} />
    </div>
  );
}

/** The name an object list item is known by, e.g. a stream's `name` or a projection's `code`. */
function itemName(item: Json | undefined): string | null {
  if (!isObject(item)) return null;
  for (const key of ['name', 'code', 'id']) {
    const v = item[key];
    if (typeof v === 'string' && v !== '') return v;
  }
  return null;
}

/** A button's short word, read out as its full name ("Up", read "Move Streams 2 up"). */
function named(word: string, name: string) {
  return (
    <>
      <span aria-hidden="true">{word}</span>
      <span className="visually-hidden">{name}</span>
    </>
  );
}

/** Where focus goes after a list's buttons changed it: an entry (or one of its move buttons), or Add. */
type ListFocus = { readonly index: number; readonly button?: 'up' | 'down' } | 'add';

const FOCUSABLE = 'input, select, textarea, button:not(:disabled)';

/**
 * A list (an array in the settings): its entries with Up, Down and Remove, and Add. A list of
 * sections (entries that are objects, e.g. a plugin's links) shows each entry under a header that
 * names it, collapsed until the user opens it (T-161; owner, 2026-11-10): saved entries start
 * collapsed, an added one is open, and one with a problem opens. An entry keeps its state when it
 * moves.
 */
function ListEditor({ field, value, onChange, pointer, label }: EditorProps & { readonly field: Extract<Field, { kind: 'list' }> }) {
  const { idPrefix, problemsAt, needsAttention } = useContext(FormContext);
  const id = inputId(idPrefix, pointer);
  const problems = problemsAt(pointer);
  const items: readonly Json[] = Array.isArray(value) ? value : [];
  const name = label ?? field.label;
  const fixed = field.minItems !== undefined && field.minItems === field.maxItems;
  const frame = useRef<HTMLFieldSetElement>(null);
  const focusNext = useRef<ListFocus | null>(null);
  const sections = field.item.kind === 'object';
  // Which entries the user opened, by position; moved, removed and added with the entries.
  const [opened, setOpened] = useState<readonly boolean[]>([]);
  const isOpen = (i: number) => !sections || opened[i] === true || needsAttention(below(pointer, i));
  const toggle = (i: number) => {
    const open = !isOpen(i);
    setOpened(items.map((_, j) => (j === i ? open : opened[j] === true)));
  };
  // After Add, Remove, Up or Down the pressed button is gone or elsewhere: focus follows the entry.
  useEffect(() => {
    const target = focusNext.current;
    const root = frame.current;
    if (target === null || root === null) return;
    focusNext.current = null;
    const entry = target === 'add' ? null : root.querySelectorAll<HTMLElement>(':scope > ol > li').item(target.index);
    if (entry === null || target === 'add') {
      root.querySelector<HTMLElement>(':scope > [data-list-add] > button')?.focus();
      return;
    }
    // The pressed move button, else the other one (at the end of the list), else the entry's first input.
    const moves = target.button === undefined ? [] : [target.button, target.button === 'up' ? 'down' : 'up'];
    const button = moves.map((m) => entry.querySelector<HTMLElement>(`:scope > .field-list-actions > [data-move="${m}"] > button:not(:disabled)`))
      .find((b) => b !== null);
    // In an open section, its first input rather than its header (T-161).
    const inside = entry.querySelector<HTMLElement>(`:scope > .field-section-body:not([hidden]) :is(${FOCUSABLE})`);
    (button ?? inside ?? entry.querySelector<HTMLElement>(FOCUSABLE))?.focus();
  });
  const set = (i: number, v: Json | undefined) => {
    // An entry edited while a problem holds it open stays open once the problem is gone.
    if (sections && opened[i] !== true) setOpened(items.map((_, j) => j === i || opened[j] === true));
    onChange(items.map((x, j) => (j === i ? (v ?? null) : x)));
  };
  const move = (i: number, by: number) => {
    const next = [...items];
    const [moved] = next.splice(i, 1);
    if (moved !== undefined) next.splice(i + by, 0, moved);
    const open = items.map((_, j) => opened[j] === true);
    const [was] = open.splice(i, 1);
    open.splice(i + by, 0, was === true);
    setOpened(open);
    focusNext.current = { index: i + by, button: by < 0 ? 'up' : 'down' };
    onChange(next);
  };
  const remove = (i: number) => {
    const left = items.length - 1;
    focusNext.current = left === 0 ? 'add' : { index: Math.min(i, left - 1) };
    setOpened(items.map((_, j) => opened[j] === true).filter((_, j) => j !== i));
    onChange(items.filter((_, j) => j !== i));
  };
  const add = () => {
    focusNext.current = { index: items.length };
    setOpened([...items.map((_, j) => opened[j] === true), true]);
    onChange([...items, emptyOf(field.item)]);
  };
  const full = field.maxItems !== undefined && items.length >= field.maxItems;
  return (
    <fieldset ref={frame} className="field-group" aria-describedby={describedBy(id, field, 'item', problems)}>
      <legend>{name}</legend>
      <Help id={id} field={field} need="item" problems={problems} />
      {fixed ? (
        <div className="field-row">
          {items.map((item, i) => (
            <FieldEditor key={i} field={field.item} value={item} required item pointer={below(pointer, i)} label={`${name} ${String(i + 1)}`}
              onChange={(v) => { set(i, v); }} />
          ))}
        </div>
      ) : (
        <ol className="field-list">
          {items.map((item, i) => {
            const n = `${name} ${String(i + 1)}`;
            const known = itemName(item);
            const title = known === null ? n : `${n}: ${known}`;
            const open = isOpen(i);
            const bodyId = `${inputId(idPrefix, below(pointer, i))}-section`;
            const editor = (
              <FieldEditor field={field.item} value={item} required item pointer={below(pointer, i)} label={title}
                onChange={(v) => { set(i, v); }} />
            );
            return (
              <li key={i} className={sections ? `field-section${open ? '' : ' field-section-collapsed'}` : undefined}>
                {sections ? (
                  <>
                    <button type="button" className="field-section-toggle" aria-expanded={open} aria-controls={bodyId}
                      onClick={() => { toggle(i); }}>
                      {open ? <ChevronDown className="emc2-icon" aria-hidden="true" /> : <ChevronRight className="emc2-icon" aria-hidden="true" />}
                      <span>{title}</span>
                    </button>
                    <div id={bodyId} className="field-section-body" hidden={!open}>{editor}</div>
                  </>
                ) : editor}
                <div className="field-list-actions">
                  <span data-move="up"><Button disabled={i === 0} onClick={() => { move(i, -1); }}>{named('Up', `Move ${n} up`)}</Button></span>
                  <span data-move="down">
                    <Button disabled={i === items.length - 1} onClick={() => { move(i, 1); }}>{named('Down', `Move ${n} down`)}</Button>
                  </span>
                  <Button disabled={field.minItems !== undefined && items.length <= field.minItems} onClick={() => { remove(i); }}>
                    {named('Remove', `Remove ${n}`)}
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {!fixed && (
        <span data-list-add><Button disabled={full} onClick={add}>{named('Add', `Add to ${name}`)}</Button></span>
      )}
    </fieldset>
  );
}

const NO_LAYERS: LayersState = { layers: [], counts: {}, arrived: false, error: null };
const noSubscription = () => () => undefined;
const noLayers = () => NO_LAYERS;

/** A layer of View (in M3 the pickers offer View's layers only; ADR-0037 point 2): no workspace, or `core.view`. */
const inView = (layer: Layer): boolean => layer.workspace === undefined || layer.workspace === 'core.view';

interface ViewLayers {
  /** View's layers, the top one first. */
  readonly layers: readonly Layer[];
  /** Every layer the shell knows, to tell a gone layer from one in another workspace. */
  readonly all: readonly Layer[];
  /** What to say about the list itself (not known here, could not be read, still loading); null when it is there. */
  readonly note: string | null;
  readonly arrived: boolean;
}

/** The layers a picker offers, following them as they come and go. */
function useViewLayers(): ViewLayers {
  const { layers } = useContext(FormContext);
  const state = useSyncExternalStore(layers?.subscribe ?? noSubscription, layers?.getState ?? noLayers);
  useEffect(() => { void layers?.ready(); }, [layers]);
  const note = layers === null ? 'The layers are not known here.'
    : state.error !== null ? `The layers could not be read: ${state.error}`
      : !state.arrived ? 'Loading the layers…' : null;
  return { layers: state.layers.filter(inView), all: state.layers, note, arrived: state.arrived };
}

/** How a saved layer the picker does not offer is shown: by its saved name, with why. */
function notOffered(pick: LayerPick, view: ViewLayers, created?: ReadonlySet<string>): string {
  if (!view.arrived || (pick.id !== undefined && created?.has(pick.id) === true)) return pick.name;
  return view.all.some((l) => l.id === pick.id) ? `${pick.name} (not in View)` : `${pick.name} (no longer exists)`;
}

const NONE = '';
const NEW = 'new';
const keyOf = (layerId: string): string => `id:${layerId}`;

/** What to say about the list a picker offers: `view.note`, or that View has no layers; null when there is nothing to say. */
function listNote(view: ViewLayers): string | null {
  return view.note ?? (view.arrived && view.layers.length === 0 ? 'View has no layers.' : null);
}

/**
 * A picked layer (SDK 1.2.0, `LayerChoice`): View's layers, "New layer…" with a name (unless
 * `allowNew` is false), and "None" when it is optional. A pick saves the layer's id and name, a new
 * layer its name only. A saved layer the list does not hold stays picked, marked, until changed.
 */
function LayerEditor(props: EditorProps & { readonly field: Extract<Field, { kind: 'layer' }> }) {
  const { field, value, onChange, pointer, required, label } = props;
  const { idPrefix, problemsAt, setInvalid } = useContext(FormContext);
  const view = useViewLayers();
  const id = inputId(idPrefix, pointer);
  const namePointer = below(pointer, 'name');
  const nameId = inputId(idPrefix, namePointer);
  const need = needOf(props);
  const name = label ?? field.label;
  const pick = isLayerPick(value) ? value : null;
  const selected = pick === null ? NONE : pick.id === undefined ? NEW : keyOf(pick.id);
  const other = pick?.id !== undefined && !view.layers.some((l) => l.id === pick.id) ? pick : null;
  const [created, setCreated] = useState<ReadonlySet<string>>(new Set());
  const unchosen = required && selected === NONE;
  const unnamed = selected === NEW && pick !== null && pick.name.trim() === '';
  useEffect(() => {
    setInvalid(pointer, unchosen || unnamed);
    return () => { setInvalid(pointer, false); };
  }, [pointer, unchosen, unnamed, setInvalid]);
  // A value saved before SDK 1.4.0 without an id ("New layer…") keeps its name field; the form offers no new one.
  const nameInput = useRef<HTMLInputElement>(null);
  const focusName = useRef(false);
  useEffect(() => {
    if (focusName.current) {
      focusName.current = false;
      nameInput.current?.focus();
    }
  });
  const problems = unchosen ? ['Required: choose a layer.', ...problemsAt(pointer)] : problemsAt(pointer);
  const nameProblems = unnamed ? ['Required: name the new layer.', ...problemsAt(namePointer)] : problemsAt(namePointer);
  const note = listNote(view);
  const attributes = inputAttributes(id, field, need, problems);
  const describedBy = [attributes['aria-describedby'], note === null ? undefined : `${id}-layers`].filter((x) => x !== undefined).join(' ');
  return (
    <div className="field">
      <label htmlFor={id} className={labelClass(need)}>{name}{mark(need)}</label>
      <div className="layer-picker-row">
      <select
        {...attributes}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        value={selected}
        onChange={(e) => {
          const chosen = e.target.value;
          if (chosen === NONE) onChange(undefined);
          else if (chosen === NEW) {
            focusName.current = true;
            onChange({ name: '' });
          } else {
            const layer = view.layers.find((l) => keyOf(l.id) === chosen);
            if (layer !== undefined) onChange({ id: layer.id, name: layer.name });
          }
        }}
      >
        {(!required || selected === NONE) && <option value={NONE}>{required ? 'Choose a layer' : 'None'}</option>}
        {view.layers.map((l) => <option key={l.id} value={keyOf(l.id)}>{l.name}</option>)}
        {other?.id !== undefined && <option value={keyOf(other.id)}>{notOffered(other, view, created)}</option>}
        {selected === NEW && <option value={NEW}>New layer…</option>}
      </select>
      {field.allowNew && (
        <NewLayerButton
          fieldName={name}
          onCreated={(layer) => {
            setCreated((was) => new Set([...was, layer.id]));
            onChange({ id: layer.id, name: layer.name });
          }}
        />
      )}
      </div>
      <Help id={id} field={field} need={need} problems={problems} />
      {note !== null && <p className="field-help" id={`${id}-layers`}>{note}</p>}
      {selected === NEW && (
        <div className="field">
          <label htmlFor={nameId}><span className="visually-hidden">{name}: </span>Name of the new layer</label>
          <input
            ref={nameInput}
            id={nameId}
            type="text"
            maxLength={MAX_LAYER_NAME}
            aria-required
            aria-invalid={nameProblems.length > 0 || undefined}
            aria-describedby={[`${nameId}-help`, nameProblems.length > 0 ? `${nameId}-problem` : null].filter((x) => x !== null).join(' ')}
            value={pick?.name ?? ''}
            onChange={(e) => { onChange({ name: e.target.value }); }}
          />
          <p className="field-help" id={`${nameId}-help`}>
            {`The plugin makes this layer in View when it needs it. 1 to ${String(MAX_LAYER_NAME)} characters.`}
          </p>
          {nameProblems.length > 0 && <p className="field-problem" id={`${nameId}-problem`}>{nameProblems.join(' ')}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * A set of picked layers (SDK 1.2.0): View's layers as checkboxes, the top one first, and new layers
 * by name (unless `allowNew` is false). Saved in that order: the checked layers, saved layers the
 * list does not hold (marked; unchecking drops them), then the new ones.
 */
function LayersEditor(props: EditorProps & { readonly field: Extract<Field, { kind: 'layers' }> }) {
  const { field, value, onChange, pointer, label } = props;
  const { idPrefix, problemsAt, setInvalid } = useContext(FormContext);
  const view = useViewLayers();
  const id = inputId(idPrefix, pointer);
  const problems = problemsAt(pointer);
  const name = label ?? field.label;
  const picks: readonly LayerPick[] = Array.isArray(value) ? value.filter(isLayerPick) : [];
  const picked = new Set(picks.flatMap((p) => (p.id === undefined ? [] : [p.id])));
  const others = picks.filter((p) => p.id !== undefined && !view.layers.some((l) => l.id === p.id));
  const fresh = picks.filter((p) => p.id === undefined).map((p) => p.name);
  const full = field.maxItems !== undefined && picks.length >= field.maxItems;
  const [created, setCreated] = useState<ReadonlySet<string>>(new Set());
  const unnamed = fresh.some((n) => n.trim() === '');
  useEffect(() => {
    setInvalid(pointer, unnamed);
    return () => { setInvalid(pointer, false); };
  }, [pointer, unnamed, setInvalid]);
  // After Add or Remove the pressed button is gone or elsewhere: focus goes to a new layer's name, else to Add.
  const focusNext = useRef<number | 'add' | null>(null);
  const frame = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === null) return;
    const root = frame.current;
    const input = target === 'add' ? undefined : root?.querySelectorAll<HTMLInputElement>('input[data-new-layer]')[target];
    (input ?? root?.querySelector<HTMLElement>('[data-add-layer]'))?.focus();
  });
  const write = (ids: ReadonlySet<string>, names: readonly string[]) => {
    onChange([
      ...view.layers.filter((l) => ids.has(l.id)).map((l): Json => ({ id: l.id, name: l.name })),
      ...others.filter((p) => p.id !== undefined && ids.has(p.id)).map((p): Json => ({ id: p.id ?? '', name: p.name })),
      ...names.map((n): Json => ({ name: n })),
    ]);
  };
  const toggle = (layerId: string, on: boolean) => {
    const ids = new Set(picked);
    if (on) ids.add(layerId);
    else ids.delete(layerId);
    write(ids, fresh);
  };
  const remove = (i: number) => {
    const left = fresh.length - 1;
    focusNext.current = left === 0 ? 'add' : Math.min(i, left - 1);
    write(picked, fresh.filter((_, j) => j !== i));
  };
  const checkbox = (layerId: string, text: string) => {
    const boxId = `${id}-${layerId}`;
    const on = picked.has(layerId);
    return (
      <div key={layerId} className="field field-check">
        <input id={boxId} type="checkbox" checked={on} disabled={full && !on} onChange={(e) => { toggle(layerId, e.target.checked); }} />
        <label htmlFor={boxId}>{text}</label>
      </div>
    );
  };
  const existing = picks.length - fresh.length;
  const note = listNote(view);
  const described = [describedBy(id, field, 'item', problems), note === null ? undefined : `${id}-layers`].filter((x) => x !== undefined).join(' ');
  return (
    <fieldset ref={frame} className="field-group" aria-describedby={described === '' ? undefined : described}>
      <legend>{name}</legend>
      <Help id={id} field={field} need="item" problems={problems} />
      {note !== null && <p className="field-help" id={`${id}-layers`}>{note}</p>}
      {view.layers.map((l) => checkbox(l.id, l.name))}
      {others.map((p) => (p.id === undefined ? null : checkbox(p.id, notOffered(p, view, created))))}
      {fresh.map((n, i) => {
        const pointerOf = below(below(pointer, existing + i), 'name');
        const inputIdOf = inputId(idPrefix, pointerOf);
        const own = n.trim() === '' ? ['Required: name the new layer.'] : [];
        const all = [...own, ...problemsAt(pointerOf)];
        const text = `New layer ${String(i + 1)}`;
        return (
          <div key={i} className="field">
            <label htmlFor={inputIdOf}><span className="visually-hidden">{name}: </span>{text}</label>
            <input
              id={inputIdOf}
              data-new-layer
              type="text"
              maxLength={MAX_LAYER_NAME}
              aria-required
              aria-invalid={all.length > 0 || undefined}
              aria-describedby={all.length > 0 ? `${inputIdOf}-problem` : undefined}
              value={n}
              onChange={(e) => { write(picked, fresh.map((x, j) => (j === i ? e.target.value : x))); }}
            />
            {all.length > 0 && <p className="field-problem" id={`${inputIdOf}-problem`}>{all.join(' ')}</p>}
            <button type="button" aria-label={`Remove ${name}: ${text}`} onClick={() => { remove(i); }}>Remove</button>
          </div>
        );
      })}
      {field.allowNew && (
        <NewLayerButton
          fieldName={name}
          disabled={full}
          onCreated={(layer) => {
            setCreated((was) => new Set([...was, layer.id]));
            // Checked at once; saved after the layers already picked, before names saved without an id.
            onChange([...picks.filter((p) => p.id !== undefined).map((p): Json => ({ id: p.id ?? '', name: p.name })),
              { id: layer.id, name: layer.name }, ...fresh.map((n): Json => ({ name: n }))]);
          }}
        />
      )}
    </fieldset>
  );
}

/**
 * SDK 1.4.0 (CR-0030 part 1a, T-133; owner, 2026-11-05: a popover, also for a list): a picker's "+".
 * It asks for a name in a popover, creates the layer in View at once (`layers/creator.ts`), and
 * hands it over to be picked with its id. Not shown without `layers.edit` (the ACA's R6) or where the
 * form cannot create layers; the picker leaves it out for `"allowNew": false`.
 */
function NewLayerButton({ fieldName, disabled = false, onCreated }: {
  readonly fieldName: string; readonly disabled?: boolean; readonly onCreated: (layer: { readonly id: string; readonly name: string }) => void;
}) {
  const { creator } = useContext(FormContext);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  // SDK 1.5.0 part 4 (A4): the classification, the default's until chosen; read again at each opening
  const [classification, setClassification] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) body.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, [open]);
  if (creator === null || !creator.allowed) return null;
  const offered = open ? creator.classifications() : null;
  const chosen = offered === null ? undefined : (classification !== null && offered.order.includes(classification) ? classification : offered.chosen);
  const close = () => {
    setOpen(false);
    setName('');
    setClassification(null);
    setError(undefined);
  };
  const create = async () => {
    if (busy) return;
    setBusy(true);
    const result = await creator.create(name, chosen);
    setBusy(false);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    close();
    onCreated({ id: result.id, name: result.name });
  };
  return (
    <span className="layer-new">
      <IconButton icon={Plus} label={`New layer for ${fieldName}`} disabled={disabled} hasPopup="dialog" expanded={open}
        onClick={() => { if (open) close(); else setOpen(true); }} />
      <Popover open={open} label={`New layer for ${fieldName}`} onClose={close}>
        {/* No form of its own: it sits inside the settings form, whose Save a nested submit would trigger. */}
        <div
          ref={body}
          className="layer-new-form"
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
            e.preventDefault(); // not the settings form's implicit submit
            void create();
          }}
        >
          <TextField label="Name of the new layer" value={name} onChange={(v) => { setName(v); setError(undefined); }}
            spellCheck={false} autoComplete="off" {...(error === undefined ? {} : { error })} />
          {offered !== null && chosen !== undefined && (
            <Select label="Classification" value={chosen} options={offered.order.map((c) => ({ value: c, label: c }))}
              onChange={(v) => { setClassification(v); setError(undefined); }} />
          )}
          <p className="field-help">{`Created in View at once, on top. 1 to ${String(MAX_LAYER_NAME)} characters.`}</p>
          <Button variant="primary" disabled={busy} onClick={() => { void create(); }}>Create</Button>
        </div>
      </Popover>
    </span>
  );
}

const toText = (value: Json | undefined): string => (value === undefined ? '' : JSON.stringify(value, null, 2));

function parse(text: string): { readonly ok: true; readonly value: Json | undefined } | { readonly ok: false } {
  if (text.trim() === '') return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) as Json };
  } catch {
    return { ok: false };
  }
}

function JsonEditor(props: EditorProps) {
  const { field, value, onChange, pointer, required, label } = props;
  const { idPrefix, problemsAt, setInvalid } = useContext(FormContext);
  const id = inputId(idPrefix, pointer);
  const problems = problemsAt(pointer);
  const need = needOf(props);
  const [text, setText] = useState(() => toText(value));
  const [bad, setBad] = useState(false);
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    // A value from outside (Discard, someone else's save) replaces the text; our own edit does not.
    setShownValue(value);
    const parsed = parse(text);
    if (!(parsed.ok && sameJson(parsed.value, value))) {
      setText(toText(value));
      setBad(false);
    }
  }
  useEffect(() => {
    setInvalid(pointer, bad);
    return () => { setInvalid(pointer, false); };
  }, [pointer, bad, setInvalid]);
  const all = bad ? ['Not valid JSON: the form cannot be saved until it is.', ...problems] : problems;
  const asJson: Field = { ...field, kind: 'json' };
  return (
    <div className="field">
      <label htmlFor={id} className={labelClass(need)}>{label ?? field.label}{mark(need)}</label>
      <textarea
        {...inputAttributes(id, asJson, need, all)}
        className="field-json"
        value={text}
        rows={Math.min(12, Math.max(2, text.split('\n').length))}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parse(e.target.value);
          setBad(!parsed.ok);
          if (parsed.ok) onChange(parsed.value === undefined && required ? null : parsed.value);
        }}
      />
      <Help id={id} field={asJson} need={need} problems={all} />
    </div>
  );
}
