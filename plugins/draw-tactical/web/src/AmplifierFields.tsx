// The amplifier fields of a graphic (brief, function 4), used by the Graphics panel (the next graphic) and the
// edit panel. A text amplifier is a text field; `distances` and `azimuths` are lists of numbers, one value
// (one field) per line, in the order the graphic's `points` text describes. The caller keeps the input
// and decides when it commits; this component shows the input, the APP-6 letter and name, what is required,
// and what is wrong.
import { Plus, X } from 'lucide-react';
import { Button, IconButton, TextField } from '@emc2/plugin-sdk';
import type { GraphicCatalogEntry, ModifierName } from '@emc2/plugin-sdk';
import { isListAmplifier, labelOf } from './amplifiers.ts';
import type { AmplifierDrafts, AmplifierProblems } from './amplifiers.ts';

export interface AmplifierFieldsProps {
  readonly entry: GraphicCatalogEntry;
  /** What the fields show: the user's input, or the object's values. */
  readonly drafts: AmplifierDrafts;
  readonly problems: AmplifierProblems;
  readonly disabled: boolean;
  /** The input changed. */
  readonly onChange: (name: ModifierName, value: string | readonly string[]) => void;
  /** The user committed a field (Enter, leaving the field, or removing a value of a list). */
  readonly onCommit?: (name: ModifierName, value: string | readonly string[]) => void;
}

function rowsOf(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return [''];
  if (typeof value === 'string') return [value];
  return value.length === 0 ? [''] : value;
}

function titleOf(entry: GraphicCatalogEntry, name: ModifierName): string {
  return entry.requiredModifiers.includes(name) ? `${labelOf(name)} (required)` : labelOf(name);
}

function TextAmplifier(props: AmplifierFieldsProps & { readonly name: ModifierName }) {
  const { name, drafts, entry } = props;
  const value = typeof drafts[name] === 'string' ? drafts[name] : '';
  const problem = props.problems[name];
  // "Required" is shown from the start only as the field's mark; a real fault shows as the error.
  return (
    <TextField
      label={titleOf(entry, name)}
      value={value}
      disabled={props.disabled}
      spellCheck={false}
      autoComplete="off"
      {...(problem !== undefined && problem !== 'Required' ? { error: problem } : {})}
      onChange={(text) => {
        props.onChange(name, text);
      }}
      onCommit={() => {
        props.onCommit?.(name, value);
      }}
    />
  );
}

function ListAmplifier(props: AmplifierFieldsProps & { readonly name: ModifierName }) {
  const { name, entry } = props;
  const rows = rowsOf(props.drafts[name]);
  const problem = props.problems[name];
  const title = titleOf(entry, name);
  const set = (next: readonly string[], commit: boolean) => {
    props.onChange(name, next);
    if (commit) props.onCommit?.(name, next);
  };
  return (
    <fieldset className="draw-tactical-list">
      <legend className="draw-tactical-legend">{title}</legend>
      {rows.map((row, i) => (
        // The rows have no identity of their own: they are the numbers in their order.
        <div className="draw-tactical-list-row" key={i}>
          <TextField
            label={`${title} ${String(i + 1)}`}
            value={row}
            data
            inputMode="decimal"
            spellCheck={false}
            autoComplete="off"
            disabled={props.disabled}
            {...(problem !== undefined && problem !== 'Required' && i === 0 ? { error: problem } : {})}
            onChange={(text) => {
              set(rows.map((r, j) => (j === i ? text : r)), false);
            }}
            onCommit={() => {
              props.onCommit?.(name, rows);
            }}
          />
          <IconButton
            icon={X}
            label={`Remove ${title} ${String(i + 1)}`}
            disabled={props.disabled || rows.length === 1}
            onClick={() => {
              set(rows.filter((_, j) => j !== i), true);
            }}
          />
        </div>
      ))}
      <Button
        icon={Plus}
        disabled={props.disabled || rows.length >= 64}
        onClick={() => {
          set([...rows, ''], false);
        }}
      >
        {`Add value to ${title}`}
      </Button>
    </fieldset>
  );
}

/** A field for each amplifier the graphic allows (its `allowedModifiers`), required ones marked. */
export function AmplifierFields(props: AmplifierFieldsProps) {
  const names = props.entry.allowedModifiers;
  return (
    <div className="draw-tactical-amplifiers">
      {names.map((name) => (isListAmplifier(name) ? <ListAmplifier key={name} {...props} name={name} /> : <TextAmplifier key={name} {...props} name={name} />))}
    </div>
  );
}
