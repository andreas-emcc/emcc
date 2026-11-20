/**
 * SDK 1.9.0 (ADR-0064 point 4; owner PQ1 A, M9 C7): a plugin's compute threads, at the top of its
 * Settings entry for a plugin that declares some. The admin sets how many compute tasks it may run at
 * once, 0 to its declaration, with its own Save; the server applies the number at once, and lowering
 * it stops the plugin's newest tasks first. The manifest's reason says why the plugin needs them.
 */
import { useEffect, useId, useState } from 'react';
import type { ComputeThreads, SettingsApi } from './api.ts';

type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'shown'; readonly stored: ComputeThreads };

export function ComputeThreadsField({ pluginId, api }: { readonly pluginId: string; readonly api: Pick<SettingsApi, 'compute' | 'saveCompute'> }) {
  const id = useId();
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let open = true;
    void api.compute(pluginId).then((answer) => {
      if (!open) return;
      if (answer.ok) {
        setLoaded({ kind: 'shown', stored: answer.value });
        setText(String(answer.value.allowed));
      } else {
        setLoaded({ kind: 'failed', message: answer.message });
      }
    });
    return () => {
      open = false;
    };
  }, [pluginId, api]);

  if (loaded.kind === 'loading') return <p className="muted">Loading the compute threads…</p>;
  if (loaded.kind === 'failed') return <p role="alert" className="settings-refused">{loaded.message}</p>;
  const { declared, reason, allowed } = loaded.stored;
  const value = /^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN;
  const invalid = !Number.isInteger(value) || value < 0 || value > declared;
  const changed = !invalid && value !== allowed;
  const save = async () => {
    setSaving(true);
    const answer = await api.saveCompute(pluginId, value);
    setSaving(false);
    if (answer.ok) {
      setLoaded({ kind: 'shown', stored: answer.value });
      setText(String(answer.value.allowed));
      setProblem(null);
    } else {
      setProblem(answer.problems[0]?.problem ?? answer.message);
    }
  };
  const help = `${id}-help`;
  return (
    <fieldset className="field-group">
      <legend>Compute threads</legend>
      <div className="field">
        <label htmlFor={id}>Tasks at once</label>
        <input id={id} type="text" inputMode="numeric" value={text} aria-invalid={invalid || undefined} aria-describedby={help}
          onChange={(e) => { setText(e.target.value); setProblem(null); }} />
        <p id={help} className="field-help">
          {`How many compute tasks the plugin may run at once, 0 to ${String(declared)}; 0 switches them off. `}
          {`It declares ${String(declared)}: ${reason} Lowering the number stops its newest tasks at once.`}
        </p>
        {invalid && <p role="alert" className="field-help">{`A whole number from 0 to ${String(declared)}.`}</p>}
        {problem !== null && <p role="alert" className="settings-refused">{problem}</p>}
      </div>
      <button type="button" disabled={!changed || saving} onClick={() => { void save(); }}>Save</button>
    </fieldset>
  );
}
