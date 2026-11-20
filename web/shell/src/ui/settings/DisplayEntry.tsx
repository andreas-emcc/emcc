/**
 * Settings › Display (ADR-0052 point 5, ADR-0046 point 3; owner, 2026-11-07): the users' display
 * defaults, for every user who has not set their own, with the same controls as the display
 * window. Saved on the server for `settings.admin`; every open browser gets them at once (the live
 * notice `display`). "Built-in defaults" returns the form to the SDK's.
 */
import { Button, Notice, resolveDisplay, type DisplayChoices } from '@emc2/plugin-sdk';
import { useState } from 'react';
import { DisplayForm } from '../../display/DisplayForm.tsx';
import { changed, type DisplayChange } from '../../display/names.ts';
import type { DisplayState } from '../../display/state.ts';
import type { SettingsApi } from './api.ts';
import { SaveFoot } from './SaveFoot.tsx';
import { changedValues } from './schema.ts';

export function DisplayEntry({ api, display }: { readonly api: SettingsApi; readonly display: DisplayState | null }) {
  const [draft, setDraft] = useState<DisplayChoices | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ readonly ok: boolean; readonly message: string } | null>(null);
  if (display === null) {
    return (
      <section className="settings-section" aria-labelledby="settings-display">
        <h2 id="settings-display">Display</h2>
        <p className="muted">The display settings are not available here.</p>
      </section>
    );
  }
  const defaults = draft ?? display.defaults;
  const edit = (change: DisplayChange) => {
    setDraft(changed(defaults, change));
    setResult(null);
  };
  const save = async () => {
    setBusy(true);
    const answer = await api.saveDisplayDefaults(defaults);
    setBusy(false);
    if (answer.ok) {
      display.defaultsSaved(answer.value);
      setDraft(null);
      setResult({ ok: true, message: 'Saved. Users who have not set their own get these at once.' });
    } else {
      setResult({ ok: false, message: [answer.message, ...answer.problems.map((p) => p.problem)].join(' ') });
    }
  };
  return (
    <section className="settings-section" aria-labelledby="settings-display">
      <h2 id="settings-display">Display</h2>
      <article className="settings-card" aria-labelledby="settings-display-defaults">
        <h3 id="settings-display-defaults">Display defaults</h3>
        <p className="muted">
          How symbols are drawn for every user who has not set their own in the map&apos;s Display settings. Each user can go back to these
          with &quot;Use defaults&quot;.
        </p>
        <DisplayForm shown={resolveDisplay({}, defaults, display.relationKinds)} relationKinds={display.relationKinds}
          onPreview={edit} onChange={edit} idPrefix="settings-display" disabled={busy} />
        {result !== null && <Notice severity={result.ok ? 'info' : 'error'}>{result.message}</Notice>}
      </article>
      {/* T-203 part C: one Save per surface, with Discard (new) and the count */}
      <SaveFoot count={draft === null ? 0 : Math.max(1, changedValues(display.defaults, draft))} busy={busy} onSave={() => { void save(); }}
        onDiscard={() => { setDraft(null); setResult(null); }}
        extra={<Button disabled={busy} onClick={() => { setDraft({}); setResult(null); }}>Built-in defaults</Button>} />
    </section>
  );
}
