/**
 * The Data types entry of the Settings list (ADR-0031 point 2; ADR-0023 point 7): every data type's
 * behaviour in one table edited in place, one surface with one Save (T-203 part D; the UXA's design;
 * owner, M1 to M8). A column per value: Expires after and Remove after as a number and a unit, Fade as
 * a check box; each row's "Back to the default" acts at once. The drafts stay per data type
 * (`data-type/<id>`), and Save sends one PUT per changed type: the saved ones leave their drafts, a
 * refused one keeps its draft and shows why under its row.
 */
import { Button, Chip, ConfirmDialog, IconButton, type DataType, type DataTypeDefaults } from '@emc2/plugin-sdk';
import { RotateCcw } from 'lucide-react';
import { Fragment, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { PluginRow } from '../store.ts';
import type { Answer, Problem } from './api.ts';
import { behaviourValues } from './behaviour.ts';
import type { Drafts } from './drafts.ts';
import { readTime, shownUnit, TIME_UNITS, UNIT_SECONDS, unitOf, type TimeUnit } from './durations.ts';
import { SaveFoot } from './SaveFoot.tsx';
import { sameJson, type JsonObject } from './schema.ts';
import type { ViewServices } from '../services.ts';

const KEY = (id: string) => `data-type/${id}`;
const LABELS: Readonly<Record<string, string>> = { expiresAfterSeconds: 'Expires after', fadeWhenExpired: 'Fade', removeAfterExpirySeconds: 'Remove after' };

/** What a row's last save or reset said: its problems, or a message without any. */
interface RowOutcome { readonly kind: 'save' | 'reset'; readonly message: string; readonly problems: readonly Problem[] }

export function SettingsView({ services, plugins }: { readonly services: ViewServices; readonly plugins: readonly PluginRow[] }) {
  const { shared, drafts, api } = services;
  const dataTypes = useSyncExternalStore((listener) => shared.onDataTypes(listener), () => shared.dataTypes);
  useSyncExternalStore(drafts.subscribe, () => drafts.keys());
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<ReadonlyMap<string, RowOutcome>>(new Map());
  const [said, setSaid] = useState<{ readonly ok: boolean; readonly text: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());

  const edited = dataTypes.filter((t) => drafts.get(KEY(t.id)) !== undefined);
  const count = edited.reduce((n, t) => n + drafts.count(KEY(t.id)), 0);
  const notDefault = dataTypes.filter((t) => !sameJson(behaviourValues(t.behaviour), behaviourValues(t.defaults)));
  const setRow = (id: string, outcome: RowOutcome | null) => {
    setRefused((map) => {
      if (outcome === null && !map.has(id)) return map;
      const next = new Map(map);
      if (outcome === null) next.delete(id);
      else next.set(id, outcome);
      return next;
    });
  };
  const outcomeOf = (kind: RowOutcome['kind'], answer: Answer<DataType>): RowOutcome | null =>
    (answer.ok ? null : { kind, message: answer.message, problems: answer.problems });

  const saveAll = async () => {
    setBusy(true);
    setSaid(null);
    const results = await Promise.all(edited.map(async (t) => {
      const sent = drafts.get(KEY(t.id))?.value ?? {};
      const answer = await api.saveDataType(t.id, sent as DataTypeDefaults);
      // The controls are off while saving; should the draft still have changed, it stays (review R1)
      if (answer.ok && sameJson(drafts.get(KEY(t.id))?.value, sent)) drafts.drop(KEY(t.id));
      setRow(t.id, outcomeOf('save', answer));
      return answer.ok;
    }));
    const failed = results.filter((ok) => !ok).length;
    setSaid(failed === 0 ? { ok: true, text: 'Saved.' }
      : { ok: false, text: `${String(results.length - failed)} of ${String(results.length)} saved; the rows marked "Not saved" were refused.` });
    setBusy(false);
  };
  const reset = async (types: readonly DataType[]) => {
    setBusy(true);
    setSaid(null);
    const results = await Promise.all(types.map(async (t) => {
      const answer = await api.resetDataType(t.id);
      setRow(t.id, outcomeOf('reset', answer));
      return answer.ok;
    }));
    const failed = results.filter((ok) => !ok).length;
    setSaid(failed === 0 ? { ok: true, text: 'Back to the defaults.' } : { ok: false, text: `${String(failed)} could not be set back; see their rows.` });
    setBusy(false);
  };
  const discard = () => {
    for (const t of dataTypes) drafts.drop(KEY(t.id));
    setRefused(new Map());
    setInvalid(new Set()); // the fields with text that is not a time start again from the saved values
    setSaid(null);
  };
  const markInvalid = (key: string, bad: boolean) => {
    setInvalid((set) => {
      if (set.has(key) === bad) return set;
      const next = new Set(set);
      if (bad) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  return (
    <section className="settings-section settings-data-types" aria-labelledby="settings-data-types">
      <h2 id="settings-data-types">Data types</h2>
      <p className="muted">
        How long the objects of each data type stay current, and what happens when they expire. Empty: never. A change applies at once, in every browser.
      </p>
      {dataTypes.length === 0 ? <p className="muted">The data types have not arrived from the server yet.</p> : (
        <div className="settings-table-scroll">
          <table className="settings-data-type-table">
            <thead>
              <tr>
                <th scope="col">Data type</th>
                <th scope="col">From</th>
                <th scope="col">Expires after</th>
                <th scope="col">Fade</th>
                <th scope="col">Remove after</th>
                <th scope="col"><span className="visually-hidden">Defaults</span></th>
              </tr>
            </thead>
            <tbody>
              {dataTypes.map((t) => (
                <DataTypeRow key={t.id} dataType={t} plugins={plugins} drafts={drafts} busy={busy} outcome={refused.get(t.id) ?? null}
                  onEdited={() => { setRow(t.id, null); setSaid(null); }} onInvalid={markInvalid}
                  onReset={() => { void reset([t]); }} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p role="status" className="settings-saved">{said?.ok === true ? said.text : ''}</p>
      {said?.ok === false && <p role="alert" className="settings-refused">{said.text}</p>}
      <SaveFoot count={count} busy={busy} onSave={() => { void saveAll(); }} onDiscard={discard} saveDisabled={invalid.size > 0}
        extra={(
          // Off while anything is unsaved: it would drop those edits (M4)
          <Button disabled={busy || count > 0 || notDefault.length === 0} onClick={() => { setAsking(true); }}>Use defaults for all</Button>
        )} />
      <ConfirmDialog open={asking} title={`Use the defaults for ${String(notDefault.length)} data ${notDefault.length === 1 ? 'type' : 'types'}?`}
        message={`${notDefault.map((t) => t.name).join(', ')} go back to their plugins' defaults at once.`} confirmLabel="Use defaults"
        onConfirm={() => { setAsking(false); void reset(notDefault); }} onCancel={() => { setAsking(false); }} />
    </section>
  );
}

function DataTypeRow({ dataType, plugins, drafts, busy, outcome, onEdited, onInvalid, onReset }: {
  readonly dataType: DataType; readonly plugins: readonly PluginRow[]; readonly drafts: Drafts; readonly busy: boolean;
  readonly outcome: RowOutcome | null; readonly onEdited: () => void; readonly onInvalid: (key: string, bad: boolean) => void;
  readonly onReset: () => void;
}) {
  const id = dataType.id;
  const saved = behaviourValues(dataType.behaviour);
  const draft = drafts.get(KEY(id));
  const shown = (draft?.value ?? saved) as JsonObject;
  const conflict = draft !== undefined && !busy && !sameJson(draft.base, saved);
  const atDefaults = sameJson(saved, behaviourValues(dataType.defaults));
  const from = dataType.declaredBy === null ? 'Built in' : plugins.find((p) => p.id === dataType.declaredBy)?.name ?? dataType.declaredBy;
  const noteId = `${useId().replace(/:/g, '')}-note`;
  const problemAt = (field: string) => outcome?.problems.find((p) => p.path === `/${field}`)?.problem;
  const set = (field: string, value: number | boolean | undefined) => {
    const kept = Object.entries(shown).filter(([k]) => k !== field);
    const next: JsonObject = Object.fromEntries(value === undefined ? kept : [...kept, [field, value]]);
    drafts.edit(KEY(id), draft?.base ?? saved, next);
    onEdited();
  };
  const seconds = (field: string) => (typeof shown[field] === 'number' ? shown[field] : undefined);
  const note = outcome !== null || conflict;
  return (
    <Fragment>
      <tr data-refused={outcome !== null ? '' : undefined} title={dataType.description}>
        <th scope="row">
          <div className="settings-item-cell">
            <span>{dataType.name}</span>
            {drafts.count(KEY(id)) > 0 && <span className="unsaved-count" title={`${String(drafts.count(KEY(id)))} unsaved`}>{drafts.count(KEY(id))}</span>}
            {outcome !== null && <Chip tone="error" label={outcome.kind === 'reset' ? 'Not reset' : 'Not saved'} />}
          </div>
          <span className="muted settings-id">{id}</span>
        </th>
        <td>{from}</td>
        <td>
          <TimeField edited={draft !== undefined} disabled={busy} label={`Expires after, ${dataType.name}`} seconds={seconds('expiresAfterSeconds')} problem={problemAt('expiresAfterSeconds')}
            describedBy={note ? noteId : undefined} onChange={(v) => { set('expiresAfterSeconds', v); }}
            onInvalid={(bad) => { onInvalid(`${id}/expires`, bad); }} />
        </td>
        <td>
          <input type="checkbox" aria-label={`Fade, ${dataType.name}`} checked={shown.fadeWhenExpired === true} disabled={busy}
            onChange={(e) => { set('fadeWhenExpired', e.currentTarget.checked); }} />
        </td>
        <td>
          <TimeField edited={draft !== undefined} disabled={busy} label={`Remove after, ${dataType.name}`} seconds={seconds('removeAfterExpirySeconds')} problem={problemAt('removeAfterExpirySeconds')}
            describedBy={note ? noteId : undefined} onChange={(v) => { set('removeAfterExpirySeconds', v); }}
            onInvalid={(bad) => { onInvalid(`${id}/remove`, bad); }} />
        </td>
        <td>
          {/* Off with unsaved edits, which it would drop, or at the defaults already (M3) */}
          <IconButton icon={RotateCcw} label={`Back to the defaults, ${dataType.name}`} disabled={busy || draft !== undefined || atDefaults}
            onClick={onReset} />
        </td>
      </tr>
      {note && (
        <tr className="settings-row-note">
          <td colSpan={6} id={noteId}>
            {conflict && (
              <div className="settings-notice" role="alert">
                <p>Someone else saved this data type while you were editing. Saving now replaces their values with yours.</p>
                <button type="button" onClick={() => { drafts.drop(KEY(id)); onEdited(); }}>Take their values</button>
              </div>
            )}
            {outcome !== null && (
              <div role="alert" className="settings-refused">
                <p>{outcome.message}</p>
                {outcome.problems.length > 0 && (
                  <ul>{outcome.problems.map((p, i) => <li key={i}>{`${LABELS[p.path.slice(1)] ?? p.path}: ${p.problem}`}</li>)}</ul>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/** A time as a number and a unit (M units A): empty is never; text that is not a whole number stays, marked. */
function TimeField({ label, seconds, problem, describedBy, edited, disabled, onChange, onInvalid }: {
  readonly label: string; readonly edited: boolean; readonly disabled: boolean; readonly seconds: number | undefined; readonly problem: string | undefined; readonly describedBy: string | undefined;
  readonly onChange: (seconds: number | undefined) => void; readonly onInvalid: (bad: boolean) => void;
}) {
  // The unit typed in, kept while it divides the value; else the largest unit that does (M units A)
  const [chosen, setChosen] = useState<TimeUnit | null>(null);
  const [typed, setTyped] = useState<string | null>(null); // text that is not a whole number
  const unit = chosen === null ? unitOf(seconds) : shownUnit(seconds, chosen);
  const text = typed ?? (seconds === undefined ? '' : String(seconds / UNIT_SECONDS[unit]));
  // The row's draft gone (Discard, a save, "Take their values"): the field starts again from the values (review R2)
  const [wasEdited, setWasEdited] = useState(edited);
  if (wasEdited !== edited) {
    setWasEdited(edited);
    if (!edited) {
      setTyped(null);
      setChosen(null);
    }
  }
  const bad = typed !== null || problem !== undefined;
  const report = useRef(onInvalid);
  useEffect(() => { report.current = onInvalid; });
  useEffect(() => { if (!edited) report.current(false); }, [edited]);
  useEffect(() => () => { report.current(false); }, []);
  return (
    <span className="settings-time">
      <input className="emc2-input emc2-data" inputMode="numeric" aria-label={label} placeholder="never" value={text} disabled={disabled}
        aria-invalid={bad ? 'true' : undefined} aria-describedby={describedBy}
        onChange={(e) => {
          const read = readTime(e.currentTarget.value, unit);
          if (read === 'invalid') {
            setTyped(e.currentTarget.value);
            onInvalid(true);
            return;
          }
          setTyped(null);
          setChosen(unit); // "60" stays 60 seconds while it is typed
          onInvalid(false);
          onChange(read === 'never' ? undefined : read);
        }} />
      <select className="emc2-input" aria-label={`Unit, ${label}`} value={unit} disabled={disabled}
        onChange={(e) => {
          const next = e.currentTarget.value as TimeUnit;
          setChosen(next);
          if (seconds !== undefined && typed === null) onChange((seconds / UNIT_SECONDS[unit]) * UNIT_SECONDS[next]);
        }}>
        {TIME_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
    </span>
  );
}
