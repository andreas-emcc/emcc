/**
 * Settings › General (ADR-0031 point 2, ADR-0034): the installation's default look, for every user
 * who has not chosen one. Saved on the server for `settings.admin`; this browser applies it at once,
 * the others at their next load (owner, 2026-10-17).
 */
import { Notice, Select, type Look } from '@emc2/plugin-sdk';
import { useState } from 'react';
import type { ViewServices } from '../services.ts';
import type { ShellStore } from '../store.ts';
import { LOOK_NAMES, LOOKS } from '../theme.ts';
import { SaveFoot } from './SaveFoot.tsx';

export function GeneralEntry({ store, services, installationLook }: {
  readonly store: ShellStore; readonly services: ViewServices; readonly installationLook: Look;
}) {
  const [chosen, setChosen] = useState<Look | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ readonly ok: boolean; readonly message: string } | null>(null);
  const look = chosen ?? installationLook;
  const save = async () => {
    setBusy(true);
    const answer = await services.api.saveDefaultLook(look);
    setBusy(false);
    if (answer.ok) {
      store.setInstallationLook(look);
      setChosen(null);
      setResult({ ok: true, message: `Saved: ${LOOK_NAMES[look]}. Users who keep the installation default get it when they next load the page.` });
    } else {
      setResult({ ok: false, message: answer.message });
    }
  };
  return (
    <section className="settings-section" aria-labelledby="settings-general">
      <h2 id="settings-general">General</h2>
      <article className="settings-card" aria-labelledby="settings-default-look">
        <h3 id="settings-default-look">Default look</h3>
        <p className="muted">
          The look of every user who has not chosen one in the top bar's Look control. Light or dark follows each computer unless the
          user chooses.
        </p>
        <div className="settings-inline">
          <Select<Look>
            label="Look"
            value={look}
            options={LOOKS.map((l) => ({ value: l, label: l === installationLook ? `${LOOK_NAMES[l]} (now)` : LOOK_NAMES[l] }))}
            onChange={(value) => { setChosen(value); setResult(null); }}
            disabled={busy}
          />
        </div>
        {result !== null && <Notice severity={result.ok ? 'info' : 'error'}>{result.message}</Notice>}
      </article>
      {/* T-203 part C: one Save per surface, with Discard and the count */}
      <SaveFoot count={look === installationLook ? 0 : 1} busy={busy} onSave={() => { void save(); }}
        onDiscard={() => { setChosen(null); setResult(null); }} />
    </section>
  );
}
