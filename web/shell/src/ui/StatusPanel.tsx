import { useSyncExternalStore } from 'react';
import type { LiveState } from '../live/connection.ts';
import { ServerStatus } from '../ServerStatus.tsx';
import { webText } from './plugin-status.ts';
import type { PluginRow, ShellStore } from './store.ts';

/**
 * The shell's Status panel (owner, 2026-10-16): whether the server and the live picture are there,
 * and every plugin's state. A panel like the plugins' ones, which the user may move; it starts at
 * the bottom of the right pane (`status.ts`). It also says when the user's setup is not remembered. While the live picture is not connected, the Map Pane
 * says so as well ({@link LiveNotice}), so that a collapsed panel hides nothing that matters.
 */
export function StatusPanel({ store }: { readonly store: ShellStore }) {
  const view = useSyncExternalStore(store.subscribe, store.getView);
  return (
    <div className="status-panel">
      <ServerStatus />
      <LiveStatus state={view.live} />
      {view.setupProblem === null ? null : <p role="status" aria-label="Setup" className="setup-problem">Setup: {view.setupProblem}</p>}
      <PluginList plugins={view.plugins} />
    </div>
  );
}

/**
 * Over the map while the live picture is not connected: what the map shows may be out of date. It
 * offers what helps: "Log in again" once the login has ended, "Reload" for a server of another
 * version. The live region stays on the page, so that screen readers announce each change.
 */
export function LiveNotice({ state }: { readonly state: LiveState }) {
  const reload = () => { window.location.reload(); };
  return (
    <div className="live-notice-region" aria-live="polite">
      {state !== 'open' && (
        <p className={`live-notice live-${state}`}>
          <span>Live picture: {LIVE_TEXT[state]}</span>
          {state === 'logged-out' && <button type="button" onClick={reload}>Log in again</button>}
          {state === 'incompatible' && <button type="button" onClick={reload}>Reload</button>}
        </p>
      )}
    </div>
  );
}

const LIVE_TEXT: Record<LiveState, string> = {
  connecting: 'connecting…',
  open: 'connected',
  closed: 'not connected, retrying',
  incompatible: 'the server has another version: reload the page',
  'logged-out': 'your login has ended',
};

/** The connection's state; what to do about it is in the notice over the map ({@link LiveNotice}). */
function LiveStatus({ state }: { readonly state: LiveState }) {
  return (
    <p role="status" aria-label="Live picture" className={`live live-${state}`}>
      Live picture: {LIVE_TEXT[state]}
    </p>
  );
}

/** One line per plugin: its server status and, for web parts, how it stands in this browser. */
function PluginList({ plugins }: { readonly plugins: readonly PluginRow[] }) {
  if (plugins.length === 0) return null;
  return (
    <details className="plugin-list">
      <summary>Plugins ({plugins.length})</summary>
      <ul>
        {plugins.map((p) => {
          const web = webText(p);
          return (
            <li key={p.id} className={`plugin plugin-${web.severity}`}>
              <span className="plugin-name">{p.name}</span>
              <span className="plugin-state">
                server {p.server.active ? p.server.state : `disabled (${p.server.detail})`}
                {web.text === null ? null : ` · web ${web.text}`}
              </span>
              {p.notes.map((note) => <span key={note} className="plugin-note">{note}</span>)}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
