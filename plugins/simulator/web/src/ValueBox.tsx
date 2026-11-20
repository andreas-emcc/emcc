import { useRef, useState } from 'react';
import { TextField } from '@emc2/plugin-sdk';

/**
 * A value the route editor saves when it is committed (Enter, or leaving the field; A37). While
 * typing, the draft is shown; after a commit, the committed text until the route's new value
 * arrives. `onCommit` returns why the value cannot be saved, shown under the field, or null.
 */
export function ValueBox(props: {
  readonly label: string;
  readonly value: string;
  readonly onCommit: (text: string) => string | null;
  /** Shown next to the box, e.g. "typed" or "computed". */
  readonly note?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly readOnly: boolean;
  readonly numeric?: boolean;
  /** Raised when a change was not applied: the committed text is no longer shown as saved. */
  readonly rejections?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // The committed text, with the value it replaced: shown until the value changes.
  const [committed, setCommitted] = useState<{ readonly text: string; readonly over: string; readonly rejections: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The draft as typed, for the second commit of one edit (Enter, then blur), which must not send again.
  const typed = useRef<string | null>(null);
  const shown = draft ?? (committed !== null && committed.over === props.value && committed.rejections === (props.rejections ?? 0) ? committed.text : props.value);
  return (
    <div className="simulator-value">
      <TextField
        label={props.label}
        value={shown}
        onChange={(text) => {
          typed.current = text;
          setDraft(text);
          setError(null);
        }}
        onCommit={() => {
          const text = typed.current;
          if (text === null) return;
          if (text.trim() === props.value.trim()) {
            typed.current = null;
            setDraft(null);
            return;
          }
          const problem = props.onCommit(text);
          if (problem === null) {
            typed.current = null;
            setCommitted({ text, over: props.value, rejections: props.rejections ?? 0 });
            setDraft(null);
          } else {
            setError(problem);
          }
        }}
        {...(error === null ? {} : { error })}
        {...(props.placeholder === undefined ? {} : { placeholder: props.placeholder })}
        readOnly={props.readOnly}
        inputMode={props.numeric === false ? 'text' : 'decimal'}
        autoComplete="off"
        spellCheck={false}
        data
      />
      {props.note === undefined ? null : <span className="simulator-muted">{props.note}</span>}
    </div>
  );
}
