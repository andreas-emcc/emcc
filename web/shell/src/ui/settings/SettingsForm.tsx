/**
 * A settings form with Save and Discard (T-039 part 2): the generated inputs, the server's answer,
 * and the unsaved edits, which are kept in `Drafts` so that switching tabs loses nothing. The server
 * is the only validator (the inputs only refuse what they cannot read: text that is not a number, a
 * required value left empty): Save sends the complete values, a refusal shows each problem at its
 * input until that value is changed.
 * When someone else saves while edits are open, the last save wins: the edits are kept, with a
 * notice and a button to take the new values instead (owner, 2026-10-13).
 */
import { Button } from '@emc2/plugin-sdk';
import { useCallback, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { LayerCreator } from '../../layers/creator.ts';
import type { KnownLayers } from '../../layers/known.ts';
import type { Answer, Problem } from './api.ts';
import type { CredentialNames } from './credentials.ts';
import type { Drafts } from './drafts.ts';
import { FormContext, type FormContextValue } from './form-context.ts';
import { FieldEditor, Properties } from './SchemaForm.tsx';
import { SaveFoot } from './SaveFoot.tsx';
import { changedValues, sameJson, valueAt, type Field, type Json, type JsonObject } from './schema.ts';

export interface SettingsFormProps {
  /** The draft's key, e.g. `plugin/coordinates`. */
  readonly draftKey: string;
  readonly field: Field;
  /** The saved values, kept current by the caller. */
  readonly current: JsonObject;
  readonly drafts: Drafts;
  /** Sends the complete values; the answer is the saved values. */
  readonly save: (values: JsonObject) => Promise<Answer<JsonObject>>;
  /** A further action besides Save, e.g. "Use defaults"; the answer is the saved values. */
  readonly reset?: { readonly label: string; readonly done: string; readonly disabled: boolean; readonly run: () => Promise<Answer<JsonObject>> };
  /** The layers its layer pickers offer (SDK 1.2.0); without, a picker can keep what is saved but offers no layers. */
  readonly layers?: KnownLayers;
  /** SDK 1.4.0 (T-133): what the layer pickers' "+" creates a layer with; without, no "+". */
  readonly creator?: LayerCreator;
  /** ADR-0062 (M9 C3): the TLS credentials' names its `tls-credential` fields offer; without, they are text fields. */
  readonly credentials?: CredentialNames;
  /**
   * T-203 part D: where the form's values are in the plugin's settings (a list item's `/links/2`),
   * so that the server's problems, which name the whole settings, reach the item's inputs; default
   * the whole (`""`).
   */
  readonly at?: string;
  /** T-203 part D: the Save button's words; default "Save". */
  readonly saveLabel?: string;
  /** T-203 part D: an action at the foot before Discard, e.g. a list item's Delete. */
  readonly start?: ReactNode;
  /** T-203 part D: after each save, whether it was taken. */
  readonly onOutcome?: (ok: boolean) => void;
  /** T-203 part D: after a save was taken, with the saved values. */
  readonly onSaved?: (values: JsonObject) => void;
}

interface Outcome {
  readonly ok: boolean;
  readonly message: string;
  readonly problems: readonly Problem[];
}

/** A problem as the list says it: never with a regular expression (the MCA's fix 1; the input says it with an example). */
const plain = (problem: string): string => (/regex/i.test(problem) ? 'is not in the expected form' : problem);

export function SettingsForm({ draftKey, field, current, drafts, save, reset, layers, creator, credentials, at = '', saveLabel, start, onOutcome, onSaved }: SettingsFormProps) {
  const idPrefix = useId().replace(/:/g, '');
  const draft = useSyncExternalStore(drafts.subscribe, () => drafts.get(draftKey));
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Saved here: shown until the server's message about it (`settings`, `data-types`) changes `current`.
  const [pending, setPending] = useState<{ readonly value: JsonObject; readonly over: JsonObject } | null>(null);
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());

  const saved = pending !== null && pending.over === current ? pending.value : current;
  const shown = (draft?.value ?? saved) as JsonObject;
  // Not while our own save is out: the server tells every browser of it before it answers us, and
  // anyone else's save meanwhile is replaced by ours (the last save wins). A refusal shows it again.
  const conflict = draft !== undefined && !busy && !sameJson(draft.base, saved);

  const markInvalid = useCallback((pointer: string, bad: boolean) => {
    setInvalid((set) => {
      if (set.has(pointer) === bad) return set;
      const next = new Set(set);
      if (bad) next.add(pointer);
      else next.delete(pointer);
      return next;
    });
  }, []);
  const context = useMemo<FormContextValue>(() => {
    const problems = outcome?.problems ?? [];
    return {
      idPrefix,
      problemsAt: (pointer) => problems.filter((p) => p.path === pointer).map((p) => p.problem),
      problemsUnder: (pointer) => problems.filter((p) => p.path === pointer || p.path.startsWith(`${pointer}/`)),
      needsAttention: (pointer) => [...problems.map((p) => p.path), ...invalid].some((at) => at === pointer || at.startsWith(`${pointer}/`)),
      setInvalid: markInvalid,
      layers: layers ?? null,
      creator: creator ?? null,
      credentials: credentials ?? null,
    };
  }, [idPrefix, outcome, invalid, markInvalid, layers, creator, credentials]);

  const edit = (value: Json | undefined) => {
    const next = value ?? {};
    drafts.edit(draftKey, draft?.base ?? saved, next);
    if (outcome?.ok === true) setOutcome(null);
    else if (outcome !== null && outcome.problems.length > 0) {
      // A problem goes once the value it is about changes; one about the whole form stays until the
      // next save. With the last one goes the refusal. Pointers name list entries by position, so
      // after Up, Down or Remove a problem of a moved entry goes too: the next save says it again.
      // A refusal without problems (the server could not be reached, say) stays until the next save.
      const inside = (path: string) => (path.startsWith(`${at}/`) ? path.slice(at.length) : path === at ? '' : null);
      const left = outcome.problems.filter((p) => {
        const local = inside(p.path);
        return local === null || local === '' || sameJson(valueAt(shown, local), valueAt(next, local));
      });
      if (left.length < outcome.problems.length) setOutcome(left.length === 0 ? null : { ...outcome, problems: left });
    }
  };
  const run = async (action: () => Promise<Answer<JsonObject>>, done: string) => {
    setBusy(true);
    const answer = await action();
    if (answer.ok) {
      drafts.drop(draftKey);
      setPending({ value: answer.value, over: current });
      setOutcome({ ok: true, message: done, problems: [] });
      onOutcome?.(true);
      onSaved?.(answer.value);
    } else {
      // A list item's form shows its own problems only (T-203 part D); the page's form shows all
      const own = at === '' ? answer.problems : answer.problems.filter((p) => p.path === at || p.path.startsWith(`${at}/`));
      setOutcome({ ok: false, message: answer.message, problems: own });
      onOutcome?.(false);
    }
    setBusy(false); // after the draft is gone: never a moment with the draft and no save out
  };
  const discard = () => {
    drafts.drop(draftKey);
    setOutcome(null);
  };

  return (
    <FormContext.Provider value={context}>
      <form
        className="settings-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => save(shown), 'Saved.');
        }}
      >
        {conflict && (
          <div className="settings-notice" role="alert">
            <p>Someone else saved these settings while you were editing. Saving now replaces their values with yours.</p>
            <button type="button" onClick={discard}>Take their values</button>
          </div>
        )}
        {field.kind === 'object' ? (
          <Properties field={field} value={shown} onChange={edit} pointer={at} />
        ) : (
          <FieldEditor field={field} value={shown} onChange={edit} pointer={at} required />
        )}
        {/* Always there, so that screen readers announce the text when it comes. */}
        <p role="status" className="settings-saved">{outcome?.ok === true ? outcome.message : ''}</p>
        {outcome?.ok === false && (
          <div role="alert" className="settings-refused">
            <p>{outcome.message}</p>
            {outcome.problems.length > 0 && (
              <ul>
                {outcome.problems.map((p, i) => <li key={i}>{p.path === at ? plain(p.problem) : `${p.path}: ${plain(p.problem)}`}</li>)}
              </ul>
            )}
          </div>
        )}
        {/* T-203 part C: one Save per surface, pinned to its bottom edge, with Discard and the count */}
        <SaveFoot count={draft === undefined ? 0 : changedValues(draft.base, draft.value)} busy={busy} onDiscard={discard}
          saveDisabled={invalid.size > 0}
          {...(saveLabel === undefined ? {} : { saveLabel })}
          extra={start ?? (reset !== undefined && (
            // Off while there are unsaved edits: it would drop them (save or discard them first).
            <Button disabled={busy || reset.disabled || draft !== undefined} onClick={() => { void run(reset.run, reset.done); }}>
              {reset.label}
            </Button>
          ))} />
      </form>
    </FormContext.Provider>
  );
}
