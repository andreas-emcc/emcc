import { EVERY_WORKSPACE, topBarItemAppearsIn } from '@emc2/plugin-sdk';
import { useState, type KeyboardEvent } from 'react';
import { SetupsControl } from '../setups/SetupsControl.tsx';
import type { Setups } from '../setups/setups.ts';
import { Clock } from './Clock.tsx';
import { LookControl } from './LookControl.tsx';
import { hasTemporalPlugin } from '../time/label.ts';
import { TimeControl } from '../time/TimeControl.tsx';
import { HelpMenu } from './HelpMenu.tsx';
import { Logo } from './Logo.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { logOut } from './logout.ts';
import type { LoginInfo, ShellStore, ShellView, TopBarEntry } from './store.ts';
import { hashOf, panelId, SETTINGS, shownTab, tabId, tabLabel, tabsFor, VIEW, workspaceOfTab, type Tab } from './tabs.ts';

/**
 * The top bar (ADR-0031 point 1): the logo (`Logo.tsx`) and the view tabs on the left; on the right the plugins' items
 * (`ui.addTopBarItem`, each at most 12 rem wide), the clock, and who works here with logout, or
 * the "No login" mark (ADR-0022). The look control (`LookControl.tsx`, ADR-0034) and the setups
 * control (`setups/SetupsControl.tsx`) come before the clock. The help menu (`HelpMenu.tsx`, M9 RC2) is last.
 *
 * SDK 1.6.0 (T-152; CR-0041 part F): a plugin's item shows only in its workspaces
 * (`topBarItemAppearsIn`); one without a list shows everywhere, as before. On the Settings and
 * Monitor tabs, which are no workspace, only the items of every workspace show.
 *
 * The tabs follow the WAI-ARIA tabs pattern: one tab stop (the selected tab), the arrow keys move
 * between tabs and Home and End to the first and last, each choosing its view at once; each tab
 * names the view it controls.
 */
export function TopBar({ view, store, setups }: { readonly view: ShellView; readonly store: ShellStore; readonly setups?: Setups | undefined }) {
  const tabs = tabsFor(view.login, view.workspaces);
  const shown = shownTab(view.tab, view.login, view.workspaces);
  const here = workspaceOfTab(shown);
  const items = view.topBarItems.filter(({ item }) => (here === null
    ? item.workspaces === undefined || item.workspaces.includes(EVERY_WORKSPACE)
    : topBarItemAppearsIn(item, here)));
  const choose = (tab: Tab) => {
    store.setTab(tab);
    const hash = hashOf({ tab, entry: tab === SETTINGS ? view.settingsEntry : null });
    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', hash === '' ? `${window.location.pathname}${window.location.search}` : hash);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const at = tabs.indexOf(shown);
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const tab = tabs[(next + tabs.length) % tabs.length] ?? shown;
    choose(tab);
    document.getElementById(tabId(tab))?.focus();
  };
  return (
    <header className="top-bar">
      <Logo />
      <nav aria-label="Views" className="view-nav">
        <div role="tablist" aria-label="Views" className="view-tabs">
          {tabs.map((tab) => (
            <button
              key={tab}
              id={tabId(tab)}
              type="button"
              role="tab"
              aria-selected={tab === shown}
              aria-controls={workspaceOfTab(tab) === view.workspace ? panelId(VIEW) : tab === shown ? panelId(tab) : undefined}
              tabIndex={tab === shown ? 0 : -1}
              className={tab === shown ? 'view-tab selected' : 'view-tab'}
              onClick={() => { choose(tab); }}
              onKeyDown={onKeyDown}
            >
              {tabLabel(tab, view.workspaces)}
            </button>
          ))}
        </div>
      </nav>
      <div className="top-bar-end">
        {items.length > 0 && (
          <div className="top-bar-items">
            {items.map((entry) => <TopBarSlot key={entry.key} entry={entry} store={store} />)}
          </div>
        )}
        <LookControl view={view} store={store} />
        {setups === undefined ? null : <SetupsControl setups={setups} />}
        <Clock mode={view.clock} onChange={(mode) => { store.setClock(mode); }} />
        {hasTemporalPlugin(view) ? <TimeControl view={view} store={store} /> : null}
        <LoginStatus login={view.login} ended={view.live === 'logged-out'} setups={setups} />
        <HelpMenu />
      </div>
    </header>
  );
}

/** One plugin's item; one that fails makes its plugin DEGRADED and leaves the top bar alone. */
function TopBarSlot({ entry, store }: { readonly entry: TopBarEntry; readonly store: ShellStore }) {
  const Item = entry.item.component;
  return (
    <div className="top-bar-item">
      <ErrorBoundary
        name={entry.pluginId}
        onError={(error) => {
          store.observe(entry.pluginId, { state: 'DEGRADED', detail: `top bar item ${entry.item.id} failed: ${error.message}` });
        }}
      >
        <Item />
      </ErrorBoundary>
    </div>
  );
}

/**
 * Who works here (ADR-0022). The no-login mode gets a mark that cannot be missed, so that nobody
 * takes it for a protected system.
 */
function LoginStatus({ login, ended, setups }: {
  readonly login: LoginInfo | null; readonly ended: boolean; readonly setups?: Setups | undefined;
}) {
  // One logout at a time: a second click while the setup's last save runs does nothing (review F4).
  const [loggingOut, setLoggingOut] = useState(false);
  if (login === null) return null;
  if (login.mode === 'none') {
    const who = login.user?.name ?? 'the local user';
    return (
      <p role="status" aria-label="Login" className="no-login" title={`No login: everyone who reaches this server works as ${who}, with all permissions.`}>
        <strong>No login</strong>: everyone who reaches this server works as {who}, with all permissions.
      </p>
    );
  }
  // Once the login has ended, the Status panel offers "Log in again" (CDA's Keycloak check, 2026-10-14).
  const status = ended ? 'Login ended' : login.user === null ? 'Not logged in' : `Logged in as ${login.user.name}`;
  return (
    <div className="login">
      <p role="status" aria-label="Login" title={status}>{status}</p>
      {login.user !== null && !ended && (
        <button
          type="button"
          aria-disabled={loggingOut}
          onClick={() => {
            if (loggingOut) return;
            setLoggingOut(true);
            void logOut(fetch, undefined, () => setups?.finish() ?? Promise.resolve());
          }}
        >
          Log out
        </button>
      )}
    </div>
  );
}
