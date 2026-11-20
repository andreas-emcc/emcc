/**
 * Settings › Labeling (T-170 round 3 and 3b; owner's round 2 answers OI A, OJ B, OK, OL A; OY and
 * OZ A): an admin makes premade security labels, one card per policy of the labeling definitions.
 * The card's left column has the classifications of each of the policy's sections (classification
 * sets), highest first and each in its colour, and the values its labels may be released to; the
 * right one its labels, by section and classification in the same order, as round 2's pictures. Every change
 * waits for the one Save of the entry, as plugins' settings do: the entry is marked unsaved in the
 * list and leaving the page asks first (the draft `labeling`). In M6 the labels are cosmetic and
 * connected to nothing (owner, 2026-11-10).
 */
import { Button, ConfirmDialog, Notice, type SecurityLabel, type Unsubscribe } from '@emc2/plugin-sdk';
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import type { Problem, SettingsApi } from '../api.ts';
import type { Drafts } from '../drafts.ts';
import { changedValues, sameJson, type Json } from '../schema.ts';
import { SaveFoot } from '../SaveFoot.tsx';
import {
  colorOf, labelParts, labelText, makeLabel, policyOf, releasedTo, renamed, sameAs, sections, sectionsOf, shownPolicies, usedBy, valueProblem,
  withPolicy, type ClassificationSet, type LabelDefinitions, type LabelFormat, type PolicyLabels, type Premade,
} from './model.ts';
import { NATIONS } from './nations.ts';

/** The draft's key, also the entry's id. */
export const LABELING_DRAFT = 'labeling';

/** What the entry needs from the shell besides the server's calls. */
export interface LabelingSource {
  /** The labeling definitions and the label form (`GET /api/config`), once they have arrived. */
  readonly config: () => { readonly definitions: LabelDefinitions; readonly format: LabelFormat } | null;
  /** Called when the configuration arrives and when someone has saved the labels (the live notice `labeling`). */
  readonly subscribe: (listener: () => void) => Unsubscribe;
}

interface Outcome {
  readonly ok: boolean;
  readonly message: string;
  readonly problems: readonly Problem[];
}

export function LabelingEntry({ api, drafts, source }: { readonly api: SettingsApi; readonly drafts: Drafts; readonly source: LabelingSource }) {
  const config = useSyncExternalStore(source.subscribe, source.config);
  const draft = useSyncExternalStore(drafts.subscribe, () => drafts.get(LABELING_DRAFT));
  const [saved, setSaved] = useState<Premade | null>(null);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    let shown = true;
    const read = () => {
      void api.labeling().then((answer) => {
        if (!shown) return;
        if (answer.ok) {
          setSaved(answer.value);
          setLoadProblem(null);
        } else {
          setLoadProblem(answer.message);
        }
      });
    };
    read();
    const stop = source.subscribe(read);
    return () => { shown = false; stop(); };
  }, [api, source]);

  const heading = (
    <>
      <h2 id="settings-labeling">Labeling</h2>
      <p className="muted">
        Premade security labels, one section per policy: its classifications, highest first, and the values its labels may be released
        to; then its labels by classification. Changes are kept here until you save them. In this version the labels are not offered
        anywhere else yet.
      </p>
    </>
  );
  if (config === null || saved === null) {
    return (
      <section className="settings-section labeling" aria-labelledby="settings-labeling">
        {heading}
        {loadProblem === null ? <p className="muted">Loading…</p> : <Notice severity="error">{loadProblem}</Notice>}
      </section>
    );
  }

  const shown = (draft?.value as unknown as Premade | undefined) ?? saved;
  // Not while our own save is out: the server tells every browser of it before it answers us.
  const conflict = draft !== undefined && !busy && !sameJson(draft.base, saved);
  const edit = (next: Premade) => {
    drafts.edit(LABELING_DRAFT, draft?.base ?? (saved as unknown as Json), next as unknown as Json);
    if (outcome?.ok === true) setOutcome(null);
  };
  const save = async () => {
    setBusy(true);
    const answer = await api.saveLabeling(shown);
    if (answer.ok) {
      drafts.drop(LABELING_DRAFT);
      setSaved(answer.value);
      setOutcome({ ok: true, message: 'Saved.', problems: [] });
    } else {
      setOutcome({ ok: false, message: answer.message, problems: answer.problems });
    }
    setBusy(false);
  };
  const discard = () => {
    drafts.drop(LABELING_DRAFT);
    setOutcome(null);
  };
  const policies = shownPolicies(shown, config.definitions);

  return (
    <section className="settings-section labeling" aria-labelledby="settings-labeling">
      {heading}
      {conflict && (
        <div className="settings-notice" role="alert">
          <p>Someone else saved the labels while you were editing. Saving now replaces theirs with yours.</p>
          <button type="button" onClick={discard}>Take their labels</button>
        </div>
      )}
      {policies.length === 0 && <p className="muted">The labeling definitions name no policy.</p>}
      {policies.map((policy) => (
        <PolicySection
          key={policy} policy={policy} sets={sectionsOf(config.definitions, policy)}
          defined={config.definitions.policies.some((p) => p.name === policy)}
          part={policyOf(shown, policy)} format={config.format} disabled={busy}
          onChange={(part) => { edit(withPolicy(shown, policy, part)); }}
        />
      ))}
      {/* T-203 part C: the entry's one Save, pinned to its bottom edge (was a floating bar) */}
      <SaveFoot count={draft === undefined ? 0 : changedValues(draft.base, draft.value)} busy={busy} onDiscard={discard} onSave={() => { void save(); }} />
      <p role="status" className="settings-saved">{outcome?.ok === true ? outcome.message : ''}</p>
      {outcome?.ok === false && (
        <div role="alert" className="settings-refused">
          <p>{outcome.message}</p>
          {outcome.problems.length > 0 && (
            <ul>{outcome.problems.map((p, i) => <li key={i}>{where(p.path, shown, config.format)}{p.problem}</li>)}</ul>
          )}
        </div>
      )}
    </section>
  );
}

/** Where a problem of the server is, in words: e.g. `NATO SECRET · REL TO SWE: `. */
function where(path: string, premade: Premade, format: LabelFormat): string {
  const [, policies, policy, part, index] = path.split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (policies !== 'policies' || policy === undefined) return path === '' ? '' : `${path}: `;
  const labels = policyOf(premade, policy);
  const at = Number(index);
  if (part === 'labels' && Number.isInteger(at) && labels.labels[at] !== undefined) return `${labelText(labels.labels[at], format)}: `;
  if (part === 'releasableTo' && Number.isInteger(at) && labels.releasableTo[at] !== undefined) return `${policy}, Releasable to ${labels.releasableTo[at]}: `;
  return `${policy}: `;
}

interface Editing {
  /** The label's index in the policy's list; null for a new label. */
  readonly index: number | null;
  readonly classification: string;
  readonly values: ReadonlySet<string>;
}

/** A label as round 2 showed it: the policy and classification on its colour, then its releasability (`aria-label`: the whole text). */
function LabelChip({ label, format, color, as = 'span', ...button }: {
  readonly label: SecurityLabel;
  readonly format: LabelFormat;
  readonly color: string;
  readonly as?: 'span' | 'button';
  readonly pressed?: boolean;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
}) {
  const parts = labelParts(label, format);
  const inner = (
    <>
      <span className="labeling-cls" style={{ background: color }}>{parts.classification}</span>
      {parts.releasable !== null && <span className="labeling-rel">{parts.releasable}</span>}
    </>
  );
  const text = labelText(label, format);
  if (as === 'span') return <span className="labeling-label" role="img" aria-label={text} title={text}>{inner}</span>;
  return (
    <button type="button" className="labeling-label" aria-label={text} title={`${text}: edit this label`} aria-pressed={button.pressed}
      disabled={button.disabled} onClick={button.onClick}>
      {inner}
    </button>
  );
}

function PolicySection({ policy, sets, defined, part, format, disabled, onChange }: {
  readonly policy: string;
  /** The policy's sections, in order. */
  readonly sets: readonly ClassificationSet[];
  /** False when the definitions no longer have the policy. */
  readonly defined: boolean;
  readonly part: PolicyLabels;
  readonly format: LabelFormat;
  readonly disabled: boolean;
  readonly onChange: (part: PolicyLabels) => void;
}) {
  const id = useId().replace(/:/g, '');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [open, setOpen] = useState(true);
  // An edit of a label that is gone (changes discarded, someone else's save taken) is closed.
  const editor = editing !== null && (editing.index === null || part.labels[editing.index] !== undefined) ? editing : null;
  const labelSections = sections(part.labels, sets);
  const many = sets.length > 1;
  const classifications = sets.reduce((n, s) => n + s.classifications.length, 0);
  const count = part.labels.length === 1 ? '1 label' : `${String(part.labels.length)} labels`;
  const color = (classification: string) => colorOf(sets, classification);

  const open_ = (index: number | null) => {
    const label = index === null ? undefined : part.labels[index];
    const lowest = sets[0]?.classifications.at(-1)?.name ?? '';
    setEditing({ index, classification: label?.classification ?? lowest, values: new Set(label === undefined ? [] : releasedTo(label)) });
  };
  const apply = (made: SecurityLabel) => {
    if (editor === null) return;
    const labels = editor.index === null ? [...part.labels, made] : part.labels.map((l, i) => (i === editor.index ? made : l));
    onChange({ ...part, labels });
    setEditing(null);
  };
  const remove = (index: number) => {
    onChange({ ...part, labels: part.labels.filter((_, i) => i !== index) });
    setEditing(null);
    setDeleting(null);
  };
  const editorView = editor === null ? null : (
    <LabelEditor
      policy={policy} sets={sets} list={part.releasableTo} labels={part.labels} format={format} editing={editor} color={color}
      disabled={disabled} onEdit={setEditing} onApply={apply} onCancel={() => { setEditing(null); }}
      onDelete={editor.index === null ? undefined : () => { setDeleting(editor.index); }}
    />
  );

  return (
    <section className="labeling-policy" aria-labelledby={`${id}-name`}>
      <header>
        <button type="button" className="labeling-toggle" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => { setOpen(!open); }}>
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          <strong id={`${id}-name`}>{policy}</strong>
          <span className="muted">{defined ? `${String(classifications)} classifications` : 'not in the definitions'} · {count}</span>
        </button>
      </header>
      {open && (
        <div id={`${id}-body`}>
          {!defined && (
            <Notice severity="warning">
              {policy} is not a policy in the labeling definitions any more. Its labels cannot be saved: delete them, and remove its values.
            </Notice>
          )}
          <div className="labeling-columns">
            <div>
              <h3>Classifications</h3>
              {sets.map((set) => (
                <div key={set.id} className="labeling-section">
                  {many && <h4>{set.name}</h4>}
                  <ul className="labeling-ladder" aria-label={many ? `${set.name} classifications, highest first` : 'Classifications, highest first'}>
                    {set.classifications.map((c) => (
                      <li key={c.name}><span className="labeling-swatch" style={{ background: c.color }} aria-hidden="true" />{c.name}</li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="labeling-help">Highest first, from the labeling definitions.</p>
              <ValueList policy={policy} part={part} disabled={disabled} onChange={onChange} />
            </div>
            <div>
              <h3>Labels</h3>
              {labelSections.length === 0 && (
                <p className="labeling-empty">No premade labels for {policy} yet. A label is a classification and, if you like, the values it may be released to.</p>
              )}
              {labelSections.map((section) => (
                <div key={section.set?.id ?? ''} className="labeling-section">
                  {many && section.set !== null && <h4 className="labeling-section-name">{section.set.name}</h4>}
                  {section.groups.map((group) => (
                    <div key={group.classification ?? ''} className="labeling-group">
                      <h5>{group.classification ?? 'Not in the definitions'}</h5>
                      <div className="labeling-made">
                        {group.labels.map(({ label, index }) => (
                          <LabelChip key={index} as="button" label={label} format={format} color={color(label.classification)}
                            pressed={editor?.index === index} disabled={disabled} onClick={() => { open_(index); }} />
                        ))}
                      </div>
                      {group.classification === null && (
                        <p className="labeling-warn">
                          ⚠ {group.labels.length === 1 ? 'This label has a classification' : 'These labels have classifications'} that {policy} no
                          longer has in the labeling definitions. Edit {group.labels.length === 1 ? 'it' : 'each'} to give it one, or delete it.
                        </p>
                      )}
                      {editor !== null && group.labels.some((l) => l.index === editor.index) && editorView}
                    </div>
                  ))}
                </div>
              ))}
              {editor?.index === null ? editorView : defined && (
                <p><Button disabled={disabled} onClick={() => { open_(null); }}>+ New label</Button></p>
              )}
            </div>
          </div>
        </div>
      )}
      {deleting !== null && part.labels[deleting] !== undefined && (
        <ConfirmDialog
          open title="Delete this label?" confirmLabel="Delete" danger
          message={(
            <>
              <p><LabelChip label={part.labels[deleting]} format={format} color={color(part.labels[deleting].classification)} /></p>
              <p>It is no longer offered once you save. Objects and layers that already carry it keep their labels.</p>
            </>
          )}
          onConfirm={() => { remove(deleting); }} onCancel={() => { setDeleting(null); }}
        />
      )}
    </section>
  );
}

function LabelEditor({ policy, sets, list, labels, format, editing, color, disabled, onEdit, onApply, onCancel, onDelete }: {
  readonly policy: string;
  readonly sets: readonly ClassificationSet[];
  readonly list: readonly string[];
  readonly labels: readonly SecurityLabel[];
  readonly format: LabelFormat;
  readonly editing: Editing;
  readonly color: (classification: string) => string;
  readonly disabled: boolean;
  readonly onEdit: (editing: Editing) => void;
  readonly onApply: (label: SecurityLabel) => void;
  readonly onCancel: () => void;
  readonly onDelete: (() => void) | undefined;
}) {
  const id = useId().replace(/:/g, '');
  const title = editing.index === null ? 'New label' : 'Edit label';
  const made = makeLabel(policy, editing.classification, editing.values, list);
  const same = sameAs(labels, made, editing.index ?? -1);
  const known = sets.some((s) => s.classifications.some((c) => c.name === editing.classification));
  const was = editing.index === null ? undefined : labels[editing.index];
  const toggle = (value: string) => {
    const values = new Set(editing.values);
    if (!values.delete(value)) values.add(value);
    onEdit({ ...editing, values });
  };
  const options = (set: ClassificationSet) => set.classifications.map((c) => <option key={c.name} value={c.name}>{c.name}</option>);
  return (
    <div className="labeling-editor" role="group" aria-label={title}>
      <h5>{title}</h5>
      <div className="labeling-editor-row">
        <label className="emc2-field">
          <span className="emc2-field-label">Classification</span>
          <select className="emc2-input" value={editing.classification} disabled={disabled}
            onChange={(e) => { onEdit({ ...editing, classification: e.currentTarget.value }); }}>
            {sets.length > 1
              ? sets.map((set) => <optgroup key={set.id} label={set.name}>{options(set)}</optgroup>)
              : sets.map(options)}
            {!known && <option value={editing.classification} disabled>{`${editing.classification} (not in the definitions)`}</option>}
          </select>
        </label>
        <fieldset className="labeling-toggles" aria-describedby={`${id}-help`}>
          <legend>Releasable to</legend>
          {list.length === 0
            ? <p className="labeling-help">Add values to the Releasable to list first.</p>
            : (
              <div className="labeling-chips">
                {list.map((v) => (
                  <button key={v} type="button" className={chipClass(v)} aria-pressed={editing.values.has(v)} disabled={disabled}
                    onClick={() => { toggle(v); }}>{v}</button>
                ))}
              </div>
            )}
          <p className="labeling-help" id={`${id}-help`}>Click to turn on or off. None: not released beyond {policy}.</p>
        </fieldset>
      </div>
      {same >= 0 && (
        <p className="labeling-error" role="alert">
          This label exists already ({labelText(labels[same] ?? made, format)}). The order of the values does not matter.
        </p>
      )}
      {!known && <p className="labeling-error" role="alert">Choose one of {policy}&apos;s classifications.</p>}
      <div className="labeling-editor-row labeling-editor-end">
        <LabelChip label={made} format={format} color={color(made.classification)} />
        <Button variant="primary" disabled={disabled || same >= 0 || !known} onClick={() => { onApply(made); }}>
          {editing.index === null ? 'Add label' : 'Change label'}
        </Button>
        <Button disabled={disabled} onClick={onCancel}>Cancel</Button>
        {onDelete !== undefined && <Button variant="danger" disabled={disabled} onClick={onDelete}>Delete label</Button>}
      </div>
      <p className="labeling-help">
        As text: {labelText(made, format)}
        {was !== undefined && !sameJson(was, made) && <> · Was: {labelText(was, format)}</>}
      </p>
    </div>
  );
}

/** A value's chip: a nation code in the data font, a text naming a group dashed (round 2). */
function chipClass(value: string): string {
  return /^[A-Z]{3}$/.test(value) ? 'labeling-chip' : 'labeling-chip labeling-chip-text';
}

/** The policy's Releasable To list: add a value, or click one to rename or remove it. */
function ValueList({ policy, part, disabled, onChange }: {
  readonly policy: string;
  readonly part: PolicyLabels;
  readonly disabled: boolean;
  readonly onChange: (part: PolicyLabels) => void;
}) {
  const id = useId().replace(/:/g, '');
  // The value being changed (null: a new one), and the text written so far.
  const [open, setOpen] = useState<{ readonly from: string | null; readonly text: string; readonly tried: boolean } | null>(null);
  const problem = open === null ? null : valueProblem(part.releasableTo, open.text, open.from ?? undefined);
  const used = open?.from == null ? 0 : usedBy(part.labels, open.from);
  const commit = () => {
    if (open === null) return;
    if (problem !== null) {
      setOpen({ ...open, tried: true });
      return;
    }
    const value = open.text.trim();
    onChange(open.from === null ? { ...part, releasableTo: [...part.releasableTo, value] } : renamed(part, open.from, value));
    setOpen(null);
  };
  const removeValue = (value: string) => {
    onChange({ ...part, releasableTo: part.releasableTo.filter((v) => v !== value) });
    setOpen(null);
  };
  const showProblem = open !== null && problem !== null && (open.tried || open.text.trim().length > 0);
  return (
    <>
      <h3>Releasable to</h3>
      {part.releasableTo.length === 0
        ? <p className="labeling-help">No values yet. Add the nations or groups that {policy}&apos;s labels may be released to.</p>
        : (
          <div className="labeling-chips">
            {part.releasableTo.map((v) => (
              <button key={v} type="button" className={chipClass(v)} aria-pressed={open?.from === v} disabled={disabled}
                aria-label={`${v}: rename or remove`} onClick={() => { setOpen({ from: v, text: v, tried: false }); }}>{v}</button>
            ))}
          </div>
        )}
      {open === null
        ? <p><Button disabled={disabled} onClick={() => { setOpen({ from: null, text: '', tried: false }); }}>+ Add a value</Button></p>
        : (
          <div className="labeling-value-edit" role="group" aria-label={open.from === null ? 'New value' : `Change ${open.from}`}>
            <label className="emc2-field">
              <span className="emc2-field-label">{open.from === null ? 'New value' : `Rename ${open.from}`}</span>
              <input
                className="emc2-input" value={open.text} list={`${id}-nations`} autoFocus spellCheck={false} autoComplete="off"
                maxLength={200} aria-invalid={showProblem} aria-describedby={showProblem ? `${id}-problem` : undefined} disabled={disabled}
                onChange={(e) => { setOpen({ ...open, text: e.currentTarget.value, tried: false }); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commit(); }
                  if (e.key === 'Escape') { e.preventDefault(); setOpen(null); }
                }}
              />
            </label>
            <datalist id={`${id}-nations`}>
              {NATIONS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </datalist>
            <div className="settings-actions">
              <Button variant="primary" disabled={disabled} onClick={commit}>{open.from === null ? 'Add' : 'Rename'}</Button>
              {open.from !== null && (
                <Button variant="danger" disabled={disabled || used > 0}
                  {...(used > 0 ? { title: `Used by ${used === 1 ? '1 label' : `${String(used)} labels`}: take it out of them first.` } : {})}
                  onClick={() => { if (open.from !== null) removeValue(open.from); }}>Remove</Button>
              )}
              <Button disabled={disabled} onClick={() => { setOpen(null); }}>Cancel</Button>
            </div>
            {showProblem && <p id={`${id}-problem`} className="labeling-error" role="alert">{problem}</p>}
            {open.from !== null && used > 0 && (
              <p className="muted">
                Used by {used === 1 ? '1 label' : `${String(used)} labels`}: a new name changes {used === 1 ? 'it' : 'them'} too. To remove it, take it
                out of {used === 1 ? 'that label' : 'those labels'} first.
              </p>
            )}
          </div>
        )}
      <p className="labeling-help">Three-letter nation codes, or a text naming a group or context. Click a value to rename or remove it.</p>
    </>
  );
}
