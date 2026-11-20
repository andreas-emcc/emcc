/**
 * The Monitor tab (ADR-0026, overview 4.10): the live health of the core and of each plugin. It asks
 * the server every 2 s while it is shown and the page is visible (owner, 2026-10-13: polling, no
 * push), and works out rates from the last two answers; the allocation line from the last 10 s
 * (T-148). Memory is not split per plugin (spike S5; owner, 2026-11-05).
 */
import { Chip, Tabs, TextField } from '@emc2/plugin-sdk';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { serverChip, stateWord, webChip, type StateChip } from '../plugin-status.ts';
import type { ViewServices } from '../services.ts';
import type { PluginRow } from '../store.ts';
import type {
  MonitorApi, MonitorChannel, MonitorCompute, MonitorComputeTask, MonitorConnection, MonitorConversion, MonitorFolder, MonitorListener, MonitorPlugin, MonitorSnapshot, MonitorStream, MonitorTask, MonitorTlsCredential, MonitorCertificate,
  MonitorWorker,
} from './api.ts';
import {
  allocationHistory, allocationRate, bytes, channelAttention, channelKey, channelStateText, channelRates, conversionAttention, counterKey, duration, folderAttention, pluginAttention, POLL_MS, rates, streamAttention, taskAttention,
  taskRates,
  workerAttention, workerKey, busyShare, type AllocationRate, type Attention, type ChannelRate, type WorkerRate,
} from './rates.ts';

interface Polled {
  readonly previous: MonitorSnapshot | null;
  readonly current: MonitorSnapshot | null;
  /** The answers of the allocation line's span, oldest first, the current one last. */
  readonly history: readonly MonitorSnapshot[];
  readonly error: string | null;
}

export function MonitorView({ services, plugins }: { readonly services: ViewServices; readonly plugins: readonly PluginRow[] }) {
  const [polled, setPolled] = useState<Polled>({ previous: null, current: null, history: [], error: null });
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  // T-203 (findings L3): All or only the plugins that need a look, and a search by name or id
  const [shown, setShown] = useState<'all' | 'problems'>('all');
  const [query, setQuery] = useState('');
  useEffect(() => {
    let live = true;
    let asking = false;
    const poll = async () => {
      if (asking || document.visibilityState === 'hidden') return;
      asking = true;
      let answer: Awaited<ReturnType<MonitorApi['snapshot']>>;
      try {
        answer = await services.monitor.snapshot();
      } catch (e) {
        answer = { ok: false, message: `The monitor failed: ${String(e)}`, problems: [] };
      } finally {
        asking = false; // whatever happened, the next tick asks again
      }
      if (!live) return;
      const got = answer;
      setPolled((p) => (got.ok
        ? { previous: p.current, current: got.value, history: allocationHistory(p.history, got.value), error: null }
        : { ...p, error: got.message }));
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, POLL_MS);
    const visible = () => { if (document.visibilityState === 'visible') void poll(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [services]);

  const { previous, current, history, error } = polled;
  if (current === null) {
    return error === null ? <p className="muted">Loading…</p> : <p role="alert" className="settings-refused">{error}</p>;
  }
  const workerRates = rates(previous, current);
  const counterRates = taskRates(previous, current);
  const previousCompute = new Map((previous?.plugins ?? []).flatMap((p) => p.compute?.tasks ?? []).map((t) => [t.id, t] as const));
  const outputRates = channelRates(previous, current);
  const toggle = (id: string) => {
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };
  const problems = current.plugins.filter((p) => pluginAttention(p) !== 'ok');
  const words = query.trim().toLowerCase();
  const listed = (shown === 'all' ? current.plugins : problems)
    .filter((p) => words === '' || p.name.toLowerCase().includes(words) || p.id.toLowerCase().includes(words));
  return (
    <div className="monitor">
      {error !== null && <p role="alert" className="settings-refused">{error} Showing the last answer.</p>}
      <CoreSection snapshot={current} allocation={allocationRate(history)} />
      {current.core.tls.length > 0 && <TlsSection credentials={current.core.tls} />}
      <section className="monitor-section monitor-card" aria-labelledby="monitor-plugins">
        <div className="monitor-bar">
          <h2 id="monitor-plugins">Plugins</h2>
          <Tabs label="Show plugins" value={shown} onChange={setShown}
            tabs={[{ value: 'all', label: `All ${String(current.plugins.length)}` }, { value: 'problems', label: `Problems ${String(problems.length)}` }]} />
          <span className="monitor-bar-space" />
          <TextField label="Find a plugin" value={query} onChange={setQuery} placeholder="Name or id" />
          <p className="muted monitor-updated">
            Updated {new Date(current.atMillis).toLocaleTimeString()}, every {String(POLL_MS / 1000)} s while this tab is open.
          </p>
        </div>
        <table className="monitor-table">
          <caption className="visually-hidden">Plugins</caption>
          <thead>
            <tr>
              <th scope="col">Plugin</th>
              <th scope="col">Server</th>
              <th scope="col">Web part here</th>
              <th scope="col">Workers</th>
              <th scope="col">Messages/s</th>
              <th scope="col">Queued</th>
              <th scope="col">Refused</th>
              <th scope="col">Connections</th>
              <th scope="col">Internet</th>
            </tr>
          </thead>
          <tbody>
            {listed.map((p) => (
              <PluginRows key={p.id} plugin={p} row={plugins.find((r) => r.id === p.id)} rates={workerRates}
                counterRates={counterRates} outputRates={outputRates} previousCompute={previousCompute} at={current.atMillis} open={open.has(p.id)} onToggle={() => { toggle(p.id); }} />
            ))}
            {listed.length === 0 && (
              <tr><td colSpan={9} className="muted">{shown === 'problems' && words === '' ? 'No plugin needs a look.' : 'No plugin matches.'}</td></tr>
            )}
          </tbody>
        </table>
      </section>
      <section className="monitor-section monitor-card" aria-labelledby="monitor-core-workers">
        <h2 id="monitor-core-workers">Core workers</h2>
        <WorkersTable caption="Core workers" workers={current.coreWorkers} rates={workerRates} showOwner />
      </section>
    </div>
  );
}

function CoreSection({ snapshot, allocation }: { readonly snapshot: MonitorSnapshot; readonly allocation: AllocationRate | null }) {
  const { core } = snapshot;
  const { jvm } = core;
  const share = jvm.heapMax > 0 ? Math.round((jvm.heapUsed / jvm.heapMax) * 100) : null;
  const running = core.state === 'RUNNING';
  // T-203 (findings L3): the core's numbers as tiles, each a label, a value and a note
  return (
    <section className="monitor-section monitor-card" aria-labelledby="monitor-core">
      <h2 id="monitor-core">Core</h2>
      <div className="monitor-tiles">
        <Tile label="ECore" value={stateWord(core.state)}>
          <Chip tone={running ? 'ok' : 'error'} label={`up ${duration(core.uptimeSeconds)}`} />
        </Tile>
        <Tile label="Live picture" value={`${String(core.objects)} objects`} note={`${String(core.layers)} layers · change ${String(core.sequenceNo)}`} />
        <Tile label="Browser sessions" value={String(core.liveSessions)} />
        <Tile label="Java heap" value={bytes(jvm.heapUsed)} note={share === null ? 'no limit' : `of ${bytes(jvm.heapMax)} (${String(share)} %)`}>
          {share !== null && <meter className="monitor-meter" min={0} max={jvm.heapMax} value={jvm.heapUsed} aria-label="Java heap used" />}
        </Tile>
        <Tile label="Allocation" {...allocationText(allocation)} />
        <Tile label="Threads" value={String(jvm.platformThreads)} note={`${String(jvm.processors)} processors · workers on virtual threads`} />
        <Tile label="Compute threads" value={`${String(core.compute.held)} of ${String(core.compute.cap)}`}
          note="plugins' compute tasks against the server's cap (emc2.compute.max-threads)" />
        <HttpsTile certificate={snapshot.https} />
      </div>
      <p className="muted">
        Allocation is not shown per plugin: plugins' workers share threads, so the JVM cannot tell their bytes apart. ECore's share is
        approximate.
      </p>
    </section>
  );
}

/**
 * ADR-0062 point 4 (M9 C3): the server's TLS credentials, each certificate with its expiry; one within 30 days of it
 * needs a look, an expired one or a credential that cannot be read is a problem. Read at start: a change needs a restart.
 */
function TlsSection({ credentials }: { readonly credentials: readonly MonitorTlsCredential[] }) {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const certificateRow = (name: string, role: string, c: MonitorCertificate, i: number) => {
    const attention: Attention = c.state === 'expired' ? 'bad' : c.state === 'soon' ? 'warn' : 'ok';
    return (
      <tr key={`${name}-${role}-${String(i)}`} className={rowClass(attention)}>
        <th scope="row">{name}</th>
        <td>{role}</td>
        <td>{c.subject}</td>
        <td>{c.issuer}</td>
        <td>
          {c.state === 'expired' ? `expired ${day(c.notAfterMillis)}` : day(c.notAfterMillis)}
          <Mark attention={attention} />
        </td>
      </tr>
    );
  };
  return (
    <section className="monitor-section monitor-card" aria-labelledby="monitor-tls">
      <h2 id="monitor-tls">TLS credentials</h2>
      <table className="monitor-table">
        <caption className="visually-hidden">TLS credentials</caption>
        <thead>
          <tr>
            <th scope="col">Credential</th>
            <th scope="col">Certificate</th>
            <th scope="col">Subject</th>
            <th scope="col">Issuer</th>
            <th scope="col">Expires</th>
          </tr>
        </thead>
        <tbody>
          {credentials.flatMap((t) => (t.error !== null
            ? [
              <tr key={t.name} className={rowClass('bad')}>
                <th scope="row">{t.name}</th>
                <td colSpan={4}>{`Cannot be used: ${t.error}`}<Mark attention="bad" /></td>
              </tr>,
            ]
            : [
              ...t.identity.slice(0, 1).map((c, i) => certificateRow(t.name, 'Client', c, i)),
              ...t.trusted.map((c, i) => certificateRow(t.name, 'Trusted', c, i)),
            ]))}
        </tbody>
      </table>
      <p className="muted">
        Read when the server starts; a changed credential needs a restart. A deprecated setting (emc2.listeners.credentials) is named in
        the server's log.
      </p>
    </section>
  );
}

/**
 * ADR-0061 point 6 (M9 C2; owner: a tile in Core): the server's own certificate, its end date with a chip, valid,
 * expiring within 30 days or expired, and who it names and who issued it; "Off" over plain HTTP.
 */
function HttpsTile({ certificate: c }: { readonly certificate: MonitorCertificate | null | undefined }) {
  if (c == null) return <Tile label="HTTPS" value="Off" note="plain HTTP: no certificate is set (ADR-0061)" />;
  const day = new Date(c.notAfterMillis).toISOString().slice(0, 10);
  const chip = c.state === 'expired' ? <Chip tone="error" label="expired" />
    : c.state === 'soon' ? <Chip tone="warning" label="expires soon" /> : <Chip tone="ok" label="valid" />;
  return (
    <Tile label="HTTPS" value={`until ${day}`} note={`${c.subject}, issued by ${c.issuer}`}>
      {chip}
    </Tile>
  );
}

/** A state's chip (icon and word), then its detail as text that wraps: a long detail never widens the chip. */
function StateCell({ state }: { readonly state: StateChip }) {
  return (
    <span className="monitor-state">
      <Chip tone={state.tone} label={state.label} />
      {state.detail !== '' && <span className="monitor-state-detail">{state.detail}</span>}
    </span>
  );
}

/** One of the core's tiles (T-203): its label, its value, then a chip or a meter and a note. */
function Tile({ label, value, note, children }: { readonly label: string; readonly value: string; readonly note?: string; readonly children?: ReactNode }) {
  return (
    <div className="monitor-tile" role="group" aria-label={label}>
      <span className="monitor-tile-label">{label}</span>
      <span className="monitor-tile-value">{value}</span>
      {children}
      {note !== undefined && <span className="monitor-tile-note">{note}</span>}
    </div>
  );
}

/**
 * The allocation tile (T-148; owner, 2026-11-05): the JVM's total as its value, "45.2 MiB/s", and
 * ECore's share where JFR samples and the span as its note, "ECore ≈ 2.1 MiB/s (5 %), over 10 s"
 * (the UXA, T-203: a sentence in the value wrapped over five lines).
 */
function allocationText(a: AllocationRate | null): { readonly value: string; readonly note?: string } {
  if (a === null) return { value: 'Measuring…' };
  if (a.total === null) return { value: 'Not counted', note: 'by this Java runtime' };
  const perSecond = (n: number) => `${bytes(Math.round(n))}/s`;
  const over = `over ${String(Math.round(a.seconds))} s`;
  if (!a.sampling) return { value: perSecond(a.total), note: `${over}; ECore's share: off` };
  if (a.ecoreShare === null) return { value: perSecond(a.total), note: `${over}; ECore's share: no samples yet` };
  return { value: perSecond(a.total), note: `ECore ≈ ${perSecond(a.total * a.ecoreShare)} (${String(Math.round(a.ecoreShare * 100))} %), ${over}` };
}

/** The mark of a row that needs a look or has a problem: text, so it does not rest on colour alone. */
function Mark({ attention }: { readonly attention: Attention }) {
  if (attention === 'ok') return null;
  return (
    <>
      {' '}
      <span className={`attention-mark attention-mark-${attention}`}>{attention === 'bad' ? 'Problem' : 'Check'}</span>
    </>
  );
}

const rowClass = (a: Attention): string | undefined => (a === 'ok' ? undefined : `attention-${a}`);

function sum(workers: readonly MonitorWorker[], rates: ReadonlyMap<string, WorkerRate>): string {
  let total = 0;
  for (const w of workers) {
    const r = rates.get(workerKey(w))?.perSecond;
    if (r === null || r === undefined) return '–';
    total += r;
  }
  return total.toFixed(1);
}

/**
 * The Connections column: the plugin's connection tasks (SDK 1.2.0) and its deprecated listeners
 * together, e.g. "2 of 3 running" (owner, 2026-10-26).
 */
function connectionsText(p: MonitorPlugin): string {
  const total = p.tasks.length + p.listeners.length;
  if (total === 0) return '–';
  const running = p.tasks.filter((t) => t.state === 'RUNNING').length + p.listeners.filter((l) => l.connected).length;
  return `${String(running)} of ${String(total)} running`;
}

const DIRECTIONS: Readonly<Record<string, string>> = { in: 'receives', out: 'sends', both: 'receives and sends' };

/** A declared connection as a sentence: what it uses, which way, where in the settings, and why. */
function declared(c: MonitorConnection): string {
  const where = c.settings === null ? '' : `, configured at ${c.settings} in its settings`;
  return `Declares connections (ADR-0036): ${c.kinds.join(', ')}; ${DIRECTIONS[c.direction] ?? c.direction}${where}. ${c.reason}`;
}

function PluginRows({ plugin: p, row, rates, counterRates, outputRates, previousCompute, at, open, onToggle }: {
  readonly plugin: MonitorPlugin;
  /** SDK 1.9.0: the previous answer's compute tasks, by id, for their busy share. */
  readonly previousCompute: ReadonlyMap<number, MonitorComputeTask>;
  readonly row: PluginRow | undefined;
  readonly rates: ReadonlyMap<string, WorkerRate>;
  readonly counterRates: ReadonlyMap<string, number | null>;
  readonly outputRates: ReadonlyMap<string, ChannelRate>;
  readonly at: number;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const attention = pluginAttention(p);
  const web = row === undefined ? null : webChip(row);
  const server = serverChip(p.active, p.state, p.detail);
  const refused = p.caps.refusedAsks + p.caps.refusedTimers;
  const hung = p.workers.filter((w) => w.state !== 'RUNNING').length;
  const detailsId = `monitor-plugin-${p.id.replace(/[^A-Za-z0-9-]/g, '-')}`;
  return (
    <Fragment>
      <tr className={rowClass(attention)}>
        <th scope="row">
          <button type="button" className="monitor-toggle" aria-expanded={open} aria-controls={open ? detailsId : undefined} onClick={onToggle}>
            {p.name}
          </button>
          <Mark attention={attention} />
        </th>
        <td><StateCell state={server} /></td>
        <td>{web === null ? '–' : <StateCell state={web} />}</td>
        <td>{p.workers.length}{hung > 0 ? `, ${String(hung)} not running` : ''}</td>
        <td>{sum(p.workers, rates)}</td>
        <td>{p.workers.reduce((n, w) => n + w.queued, 0)}</td>
        <td>{refused}</td>
        <td>{connectionsText(p)}</td>
        <td>{p.internet === null ? '–' : 'declared'}</td>
      </tr>
      {open && (
        <tr id={detailsId} className="monitor-details">
          <td colSpan={9}>
            <p>
              Asks waiting {p.caps.outstandingAsks} of at most {p.caps.maxAsks} ({p.caps.refusedAsks} refused) · timers {p.caps.activeTimers} of
              at most {p.caps.maxTimers} ({p.caps.refusedTimers} refused)
            </p>
            {p.internet !== null && (
              <p>
                {/* No default hosts (CR-0022): every outside host comes from settings an admin fills in (owner, 2026-10-24). */}
                {p.internet.hosts.length === 0
                  ? `Reaches outside hosts: ${p.internet.reason} The hosts come from its settings (ADR-0030).`
                  : `Reaches outside hosts: ${p.internet.reason} With its default settings: ${p.internet.hosts.join(', ')}. Its settings may `
                    + 'name other hosts (ADR-0030).'}
              </p>
            )}
            <p>Capabilities: {p.capabilities.length === 0 ? 'none' : p.capabilities.join(', ')} (ADR-0044)</p>
            {p.capabilityFault !== null && (
              <p className="monitor-fault">
                A browser found at {new Date(p.capabilityFault.atMillis).toISOString().slice(11, 16)} UTC: {p.capabilityFault.problem}.
                The plugin keeps running; that browser does not use its web part's capabilities.
              </p>
            )}
            {p.connections.map((c, i) => <p key={i}>{declared(c)}</p>)}
            {p.notSavedUpdates > 0 && (
              <p>
                Updates not saved since the start: {p.notSavedUpdates} (a running simulation's moves; ADR-0041).
              </p>
            )}
            {p.workers.length > 0 && <WorkersTable caption={`${p.name}: workers`} workers={p.workers} rates={rates} />}
            {p.tasks.length > 0 && <TasksTable caption={`${p.name}: connection tasks`} tasks={p.tasks} rates={counterRates} at={at} />}
            {p.listeners.length > 0 && <ListenersTable caption={`${p.name}: listeners`} listeners={p.listeners} />}
            {p.channels.length > 0 && <ChannelsTable caption={`${p.name}: output channels`} channels={p.channels} rates={outputRates} />}
            {p.folders.length > 0 && <FoldersTable caption={`${p.name}: local folders`} folders={p.folders} />}
            {p.streams.length > 0 && <StreamsTable caption={`${p.name}: streams`} streams={p.streams} />}
            {p.conversions.length > 0 && <ConversionsTable caption={`${p.name}: conversions`} conversions={p.conversions} />}
            {p.compute !== null && <ComputeSection name={p.name} compute={p.compute} before={previousCompute} at={at} />}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

const ms = (micros: number): string => (micros / 1000).toFixed(micros >= 100_000 ? 0 : 1);

function WorkersTable({ caption, workers, rates, showOwner = false }: {
  readonly caption: string;
  readonly workers: readonly MonitorWorker[];
  readonly rates: ReadonlyMap<string, WorkerRate>;
  readonly showOwner?: boolean;
}) {
  return (
    <table className="monitor-table">
      <caption className={showOwner ? 'visually-hidden' : undefined}>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Worker</th>
          <th scope="col">State</th>
          <th scope="col">Queued</th>
          <th scope="col">Messages/s</th>
          <th scope="col">Average ms</th>
          <th scope="col">Longest ms</th>
          <th scope="col">Failures</th>
          <th scope="col">Hung</th>
          <th scope="col">Restarts</th>
          <th scope="col">Lost</th>
        </tr>
      </thead>
      <tbody>
        {workers.map((w) => {
          const r = rates.get(workerKey(w));
          const attention = workerAttention(w);
          return (
            <tr key={workerKey(w)} className={rowClass(attention)}>
              <th scope="row">
                {showOwner ? `${w.owner} / ${w.name}` : w.name}
                <Mark attention={attention} />
              </th>
              <td>{w.state}</td>
              <td>{w.queued} of {w.capacity}</td>
              <td>{r?.perSecond == null ? '–' : r.perSecond.toFixed(1)}</td>
              <td>{r?.averageMs == null ? '–' : r.averageMs.toFixed(2)}</td>
              <td>{ms(w.maxHandlerMicros)}</td>
              <td>{w.failures}</td>
              <td>{w.hung}</td>
              <td>{w.restarts}</td>
              <td>{w.dropped + w.evicted}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const clock = (millis: number): string => new Date(millis).toLocaleTimeString();

const REFUSALS: Readonly<Record<string, string>> = {
  NOT_DECLARED: 'not declared', SWITCHED_OFF: 'switched off', PLUGIN_LIMIT: "at the plugin's number", TOTAL_CAP: "at the server's cap",
};

/** SDK 1.9.0 (ADR-0064 point 5): a plugin's compute threads, declared, allowed and running, its refusals and its tasks. */
function ComputeSection({ name, compute: c, before, at }: {
  readonly name: string; readonly compute: MonitorCompute; readonly before: ReadonlyMap<number, MonitorComputeTask>; readonly at: number;
}) {
  const refused = Object.entries(c.refusals).filter(([, n]) => n > 0)
    .map(([reason, n]) => `${String(n)} ${REFUSALS[reason] ?? reason}`);
  return (
    <>
      <p>
        {`Compute threads: ${String(c.running)} running of ${String(c.allowed)} allowed (declares ${String(c.declared)}: ${c.reason})`}
        {refused.length > 0 ? ` · refused starts: ${refused.join(', ')}` : ''}
      </p>
      {c.tasks.length > 0 && (
        <table className="monitor-table">
          <caption>{`${name}: compute tasks`}</caption>
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">State</th>
              <th scope="col">For</th>
              <th scope="col">Restarts</th>
              <th scope="col">Busy</th>
              <th scope="col">CPU time</th>
              <th scope="col">Counters and details</th>
              <th scope="col">Inbox</th>
            </tr>
          </thead>
          <tbody>
            {c.tasks.map((t) => {
              const share = busyShare(t, before.get(t.id));
              const attention: Attention = t.hung || t.state === 'FAILED' ? 'bad' : t.state === 'RESTARTING' ? 'warn' : 'ok';
              const counters = [...Object.entries(t.counters).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} ${String(v)}`),
                ...Object.entries(t.details).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}: ${v}`)];
              return (
                <tr key={t.id} className={rowClass(attention)}>
                  <th scope="row">
                    {t.name}
                    <Mark attention={attention} />
                  </th>
                  <td>{t.hung ? 'did not end after its stop' : taskState({ ...t, notEnding: false } as unknown as MonitorTask)}</td>
                  <td>{duration((at - t.sinceMillis) / 1000)}</td>
                  <td>{t.restarts}</td>
                  <td>{share === null ? '–' : `${String(Math.round(share * 100))} %`}</td>
                  <td>{t.cpuMillis < 0 ? '–' : `${(t.cpuMillis / 1000).toFixed(1)} s`}</td>
                  <td>{counters.length === 0 ? '–' : counters.join(' · ')}</td>
                  <td>{t.inbox.queued} queued{t.inbox.dropped + t.inbox.evicted > 0 ? `, ${String(t.inbox.dropped + t.inbox.evicted)} lost` : ''}{t.inbox.coalesced > 0 ? `, ${String(t.inbox.coalesced)} replaced` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

/** A task's state in words, with the reason when it restarts, failed or waits. */
function taskState(t: MonitorTask): string {
  switch (t.state) {
    case 'RESTARTING':
      return `restarting at ${t.nextMillis === null ? '–' : clock(t.nextMillis)}${t.reason === null ? '' : ` (${t.reason})`}`;
    case 'FAILED':
      return `failed${t.reason === null ? '' : `: ${t.reason}`}`;
    case 'STOPPING':
      return t.notEnding ? 'stopping, has not ended' : 'stopping';
    case 'STOPPED':
      return t.reason ?? 'stopped';
    default:
      return t.state.toLowerCase();
  }
}

/** The plugin's own counters with their rates, then its details, e.g. "received 1204 (20.0/s) · protocol: CoT 2.0". */
function countersText(t: MonitorTask, rates: ReadonlyMap<string, number | null>): string {
  const counters = Object.entries(t.counters).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => {
    const r = rates.get(counterKey(t, name));
    return `${name} ${String(value)}${r === null || r === undefined ? '' : ` (${r.toFixed(1)}/s)`}`;
  });
  const details = Object.entries(t.details).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}: ${value}`);
  const all = [...counters, ...details];
  return all.length === 0 ? '–' : all.join(' · ');
}

function TasksTable({ caption, tasks, rates, at }: {
  readonly caption: string;
  readonly tasks: readonly MonitorTask[];
  readonly rates: ReadonlyMap<string, number | null>;
  readonly at: number;
}) {
  return (
    <table className="monitor-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Task</th>
          <th scope="col">State</th>
          <th scope="col">For</th>
          <th scope="col">Restarts</th>
          <th scope="col">Listening</th>
          <th scope="col">Peer</th>
          <th scope="col">Counters and details</th>
          <th scope="col">Inbox</th>
          <th scope="col">Last activity</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => {
          const attention = taskAttention(t);
          return (
            <tr key={t.id} className={rowClass(attention)}>
              <th scope="row">
                {t.name}
                <Mark attention={attention} />
              </th>
              <td>{taskState(t)}</td>
              <td>{duration((at - t.sinceMillis) / 1000)}</td>
              <td>{t.restarts}</td>
              <td>{t.listening ?? '–'}</td>
              <td>{t.peer ?? '–'}</td>
              <td>{countersText(t, rates)}</td>
              <td>{t.queued} queued{t.lost > 0 ? `, ${String(t.lost)} lost` : ''}{t.coalesced > 0 ? `, ${String(t.coalesced)} replaced` : ''}</td>
              <td>{t.lastActivityMillis === null ? '–' : `${duration((at - t.lastActivityMillis) / 1000)} ago`}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** A total with its rate, e.g. "1204 (20.0/s)". */
function withRate(total: number, rate: number | null | undefined): string {
  return `${String(total)}${rate === null || rate === undefined ? '' : ` (${rate.toFixed(1)}/s)`}`;
}

/** The output channels a plugin offers (SDK 1.2.0, ADR-0037): what was sent to each, and how its plugin keeps up. */
const FOLDER_STATES: Readonly<Record<string, string>> = {
  READABLE: 'readable', NOT_SET: 'not set', MISSING: 'cannot be read', CHECKING: 'being checked',
};

/** The local folders ECore reads for the plugin, read only (SDK 1.4.0, ADR-0049 point 4): where each is and whether it is readable. */
function FoldersTable({ caption, folders }: { readonly caption: string; readonly folders: readonly MonitorFolder[] }) {
  return (
    <table className="monitor-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Folder</th>
          <th scope="col">State</th>
          <th scope="col">Path</th>
          <th scope="col">Why</th>
        </tr>
      </thead>
      <tbody>
        {folders.map((f) => {
          const attention = folderAttention(f);
          return (
            <tr key={f.id} className={rowClass(attention)}>
              <th scope="row">
                {f.id}
                <Mark attention={attention} />
              </th>
              <td>{FOLDER_STATES[f.state] ?? f.state}</td>
              <td>
                {f.path ?? '–'} <span className="muted">(setting {f.setting})</span>
                {typeof f.resolved === 'string' && <span className="monitor-resolved"> → {f.resolved}</span>}
              </td>
              <td>{f.reason}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ChannelsTable({ caption, channels, rates }: {
  readonly caption: string;
  readonly channels: readonly MonitorChannel[];
  readonly rates: ReadonlyMap<string, ChannelRate>;
}) {
  return (
    <table className="monitor-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Channel</th>
          <th scope="col">Sends</th>
          <th scope="col">Received</th>
          <th scope="col">Handled</th>
          <th scope="col">Replaced</th>
          <th scope="col">Dropped</th>
          <th scope="col">Waiting</th>
        </tr>
      </thead>
      <tbody>
        {channels.map((c) => {
          const attention = channelAttention(c);
          const r = rates.get(channelKey(c));
          return (
            <tr key={c.link} className={rowClass(attention)}>
              <th scope="row">
                {c.name} <span className="muted">({channelKey(c)})</span>
                {channelStateText(c) !== '' && <span className="monitor-state-detail">{channelStateText(c)}</span>}
                <Mark attention={attention} />
              </th>
              <td>{c.outputType}{c.canDelete ? ', with deletes' : ''}{c.declaredKinds.length > 0 ? `; takes ${c.declaredKinds.join(', ')}` : ''}</td>
              <td>{withRate(c.sent, r?.sent)}</td>
              <td>{withRate(c.delivered, r?.delivered)}</td>
              <td>{c.replaced}</td>
              <td>{c.dropped}</td>
              <td>{c.pending} pending{c.inFlight > 0 ? `, ${String(c.inFlight)} handed over` : ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** SDK 1.8.0 (CR-0044 E1): the plugin's streams to its web part: who watches, what went in and out, and what was lost. */
function StreamsTable({ caption, streams }: { readonly caption: string; readonly streams: readonly MonitorStream[] }) {
  return (
    <table className="monitor-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Stream</th>
          <th scope="col">Viewers</th>
          <th scope="col">In</th>
          <th scope="col">Out</th>
          <th scope="col">Dropped</th>
          <th scope="col">Viewer losses</th>
          <th scope="col">Start buffer</th>
        </tr>
      </thead>
      <tbody>
        {streams.map((s) => {
          const attention = streamAttention(s);
          return (
            <tr key={s.name} className={rowClass(attention)}>
              <th scope="row">
                {s.name} <span className="muted">({s.mediaType})</span>
                <Mark attention={attention} />
              </th>
              <td>{s.viewers}</td>
              <td>{bytes(s.bytesIn)}</td>
              <td>{bytes(s.bytesOut)}</td>
              <td>{s.dropped}</td>
              <td>{s.losses}</td>
              <td>{bytes(s.startBufferBytes)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** SDK 1.8.0 (T-211): the words of a conversion's state chip. */
const CONVERSION_STATES: Readonly<Record<MonitorConversion['state'], { readonly tone: 'ok' | 'warning' | 'error' | 'neutral'; readonly label: string }>> = {
  WAITING: { tone: 'warning', label: 'Waiting for a slot' },
  RUNNING: { tone: 'ok', label: 'Running' },
  STOPPING: { tone: 'neutral', label: 'Stopping' },
  STOPPED: { tone: 'neutral', label: 'Stopped' },
  FAILED: { tone: 'error', label: 'Failed' },
};

function ConversionsTable({ caption, conversions }: { readonly caption: string; readonly conversions: readonly MonitorConversion[] }) {
  return (
    <table className="monitor-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Into stream or task</th>
          <th scope="col">State</th>
          <th scope="col">In</th>
          <th scope="col">Out</th>
          <th scope="col">Dropped</th>
          <th scope="col">CPU</th>
          <th scope="col">Detail</th>
        </tr>
      </thead>
      <tbody>
        {conversions.map((c, i) => {
          const attention = conversionAttention(c);
          const state = CONVERSION_STATES[c.state];
          return (
            <tr key={`${c.stream}-${String(i)}`} className={rowClass(attention)}>
              <th scope="row">
                {c.stream}{c.kind === 'encoder' && <span className="muted"> (encoder)</span>}
                <Mark attention={attention} />
              </th>
              <td><Chip tone={state.tone} label={state.label} /></td>
              <td>{bytes(c.bytesIn)}</td>
              <td>{bytes(c.bytesOut)}</td>
              <td>{c.kind === 'encoder' ? `${String(c.dropped)} pictures, ${String(c.lostOutputs)} lost out` : c.dropped}</td>
              <td>{c.cpuMillis < 0 ? '–' : duration(c.cpuMillis / 1000)}</td>
              <td>{c.detail}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ListenersTable({ caption, listeners }: { readonly caption: string; readonly listeners: readonly MonitorListener[] }) {
  return (
    <table className="monitor-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Listener</th>
          <th scope="col">Endpoint</th>
          <th scope="col">Connected</th>
          <th scope="col">Received</th>
          <th scope="col">Sent</th>
          <th scope="col">Reconnects</th>
        </tr>
      </thead>
      <tbody>
        {listeners.map((l) => (
          <tr key={l.name} className={l.connected ? undefined : 'attention-warn'}>
            <th scope="row">
              {l.name}
              <Mark attention={l.connected ? 'ok' : 'warn'} />
            </th>
            <td>{l.host}:{l.port}</td>
            <td>{l.connected ? 'yes' : 'no'}</td>
            <td>{bytes(l.bytesRead)}</td>
            <td>{bytes(l.bytesWritten)}</td>
            <td>{l.reconnects}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
