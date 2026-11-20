/**
 * What the monitor view works out from two snapshots: per worker the messages per second and the
 * average handler time over the interval, and what needs attention. The server sends totals only
 * and keeps no state between requests.
 */
import type { MonitorChannel, MonitorComputeTask, MonitorConversion, MonitorFolder, MonitorPlugin, MonitorSnapshot, MonitorStream, MonitorTask, MonitorWorker } from './api.ts';

/** How often the Monitor tab asks the server while it is shown (owner, 2026-10-13: polling). */
export const POLL_MS = 2_000;

export interface WorkerRate {
  /** Handler calls per second over the interval; null without an earlier snapshot of this worker. */
  readonly perSecond: number | null;
  /** The average handler call in the interval, in milliseconds; null without calls or an earlier snapshot. */
  readonly averageMs: number | null;
}

export const workerKey = (w: MonitorWorker): string => `${w.owner}/${w.name}`;

/** Every worker's rate between `previous` (if any) and `current`, by {@link workerKey}. */
export function rates(previous: MonitorSnapshot | null, current: MonitorSnapshot): ReadonlyMap<string, WorkerRate> {
  const before = new Map<string, MonitorWorker>();
  if (previous !== null) for (const w of allWorkers(previous)) before.set(workerKey(w), w);
  const seconds = previous === null ? 0 : (current.atMillis - previous.atMillis) / 1000;
  const result = new Map<string, WorkerRate>();
  for (const w of allWorkers(current)) {
    const b = before.get(workerKey(w));
    // A restarted server or a new worker with the same name counts from zero again.
    if (b === undefined || seconds <= 0 || w.processed < b.processed) {
      result.set(workerKey(w), { perSecond: null, averageMs: null });
      continue;
    }
    const calls = w.processed - b.processed;
    result.set(workerKey(w), {
      perSecond: calls / seconds,
      averageMs: calls === 0 ? null : (w.totalHandlerMicros - b.totalHandlerMicros) / calls / 1000,
    });
  }
  return result;
}

function allWorkers(s: MonitorSnapshot): MonitorWorker[] {
  return [...s.plugins.flatMap((p) => p.workers), ...s.coreWorkers];
}

/** A task counter's key: plugin, task (its id, not only its name) and counter. */
export const counterKey = (t: MonitorTask, counter: string): string => `${t.plugin}/${t.name}#${String(t.id)}/${counter}`;

/**
 * Every task counter's rate per second between `previous` (if any) and `current`, by {@link
 * counterKey}; null without an earlier value of the same task (a new task of a name has a new id),
 * or when it went down.
 */
export function taskRates(previous: MonitorSnapshot | null, current: MonitorSnapshot): ReadonlyMap<string, number | null> {
  const before = new Map<string, number>();
  if (previous !== null) {
    for (const t of previous.plugins.flatMap((p) => p.tasks)) {
      for (const [counter, value] of Object.entries(t.counters)) before.set(counterKey(t, counter), value);
    }
  }
  const seconds = previous === null ? 0 : (current.atMillis - previous.atMillis) / 1000;
  const result = new Map<string, number | null>();
  for (const t of current.plugins.flatMap((p) => p.tasks)) {
    for (const [counter, value] of Object.entries(t.counters)) {
      const b = before.get(counterKey(t, counter));
      result.set(counterKey(t, counter), b === undefined || seconds <= 0 || value < b ? null : (value - b) / seconds);
    }
  }
  return result;
}

/** An output channel's key: plugin and link. */
export const channelKey = (c: MonitorChannel): string => `${c.plugin}/${c.link}`;

/** An output channel's rates per second: items sent to it and items its worker handled. */
export interface ChannelRate {
  readonly sent: number | null;
  readonly delivered: number | null;
}

/**
 * Every output channel's rates between `previous` (if any) and `current`, by {@link channelKey};
 * null without an earlier value, or when a total went down (a channel offered again).
 */
export function channelRates(previous: MonitorSnapshot | null, current: MonitorSnapshot): ReadonlyMap<string, ChannelRate> {
  const before = new Map<string, MonitorChannel>();
  if (previous !== null) {
    for (const c of previous.plugins.flatMap((p) => p.channels)) before.set(channelKey(c), c);
  }
  const seconds = previous === null ? 0 : (current.atMillis - previous.atMillis) / 1000;
  const rate = (now: number, then: number | undefined) => (then === undefined || seconds <= 0 || now < then ? null : (now - then) / seconds);
  const result = new Map<string, ChannelRate>();
  for (const c of current.plugins.flatMap((p) => p.channels)) {
    const b = before.get(channelKey(c));
    result.set(channelKey(c), { sent: rate(c.sent, b?.sent), delivered: rate(c.delivered, b?.delivered) });
  }
  return result;
}

/** The span the allocation line averages over (T-148; owner, 2026-11-05: JFR's numbers come in ~1 s chunks). */
export const ALLOCATION_WINDOW_MS = 10_000;

/** The snapshots an allocation rate needs: those at most {@link ALLOCATION_WINDOW_MS} (and half a poll) older than the newest. */
export function allocationHistory(history: readonly MonitorSnapshot[], current: MonitorSnapshot): readonly MonitorSnapshot[] {
  return [...history, current].filter((s) => current.atMillis - s.atMillis <= ALLOCATION_WINDOW_MS + POLL_MS / 2);
}

export interface AllocationRate {
  /** Bytes per second over the span, all threads; null where the JVM does not count them. */
  readonly total: number | null;
  /** ECore's part of it, 0 to 1, from JFR's samples; null without sampling or without samples in the span. */
  readonly ecoreShare: number | null;
  readonly sampling: boolean;
  /** The span in seconds. */
  readonly seconds: number;
}

/**
 * The allocation rate between the oldest and the newest of `history` (oldest first), since the last
 * restart in it; null before there are two snapshots. ECore's share is the part of JFR's sampled
 * bytes that had no plugin frame, applied to the exact total (spike S5).
 */
export function allocationRate(history: readonly MonitorSnapshot[]): AllocationRate | null {
  const current = history.at(-1);
  if (current === undefined) return null;
  let first = history.length - 1;
  // A restarted server counts from zero again: only the snapshots since then.
  while (first > 0 && counted(history[first - 1], history[first])) first--;
  const base = history[first];
  if (base === undefined || base === current) return null;
  const seconds = (current.atMillis - base.atMillis) / 1000;
  const now = current.core.jvm.allocation;
  const then = base.core.jvm.allocation;
  const sampled = now.sampledBytes - then.sampledBytes;
  return {
    total: now.totalBytes < 0 || then.totalBytes < 0 ? null : (now.totalBytes - then.totalBytes) / seconds,
    ecoreShare: !now.sampling || !then.sampling || sampled <= 0 ? null : Math.min(1, Math.max(0, (now.ecoreBytes - then.ecoreBytes) / sampled)),
    sampling: now.sampling,
    seconds,
  };
}

function counted(before: MonitorSnapshot | undefined, after: MonitorSnapshot | undefined): boolean {
  if (before === undefined || after === undefined) return false;
  const b = before.core.jvm.allocation;
  const a = after.core.jvm.allocation;
  return after.atMillis > before.atMillis && a.totalBytes >= b.totalBytes && a.sampledBytes >= b.sampledBytes && a.ecoreBytes >= b.ecoreBytes;
}

export type Attention = 'ok' | 'warn' | 'bad';

/** A channel that dropped items needs a look: its plugin does not keep up with what is sent to it. */
export function channelAttention(c: MonitorChannel): Attention {
  return c.dropped > 0 || c.state !== 'READY' ? 'warn' : 'ok'; // SDK 1.9.0: a channel that is not sending, or degraded
}

/** SDK 1.9.0 (CR-0050 point 2): a channel's state in words, with its detail; empty when it is ready. */
export function channelStateText(c: MonitorChannel): string {
  if (c.state === 'READY') return '';
  const word = c.state === 'NOT_SENDING' ? 'Not sending' : 'Degraded';
  return c.stateDetail === '' ? word : `${word}: ${c.stateDetail}`;
}

/**
 * A failed task is a problem; one that restarts, has not ended after its stop, still waits behind
 * a stuck run, or lost inbox items needs a look.
 */
export function taskAttention(t: MonitorTask): Attention {
  if (t.state === 'FAILED') return 'bad';
  if (t.state === 'RESTARTING' || t.notEnding || t.lost > 0 || (t.state === 'STOPPED' && t.reason !== null)) return 'warn';
  return 'ok';
}

/** A worker that is hung, failed or stopped is bad; one that failed calls, hung or lost messages needs a look. */
export function workerAttention(w: MonitorWorker): Attention {
  if (w.state !== 'RUNNING') return 'bad';
  if (w.failures > 0 || w.hung > 0 || w.restarts > 0 || w.dropped + w.evicted > 0) return 'warn';
  return 'ok';
}

/** The worse of the plugin's status, its refusals, its workers, its connection tasks, its listeners and its output channels. */
/** A folder whose setting holds a path ECore cannot read wants a look; one not set yet does not (ADR-0049 point 4). */
export function folderAttention(f: MonitorFolder): Attention {
  return f.state === 'MISSING' ? 'warn' : 'ok';
}

export function pluginAttention(p: MonitorPlugin): Attention {
  if (!p.active || p.state === 'FAILED') return 'bad';
  const workers = p.workers.map(workerAttention);
  if (workers.includes('bad')) return 'bad';
  if (p.state === 'DEGRADED' || workers.includes('warn') || p.caps.refusedAsks + p.caps.refusedTimers > 0 || p.capabilityFault !== null) return 'warn';
  const tasks = p.tasks.map(taskAttention);
  if (tasks.includes('bad')) return 'bad';
  if (tasks.includes('warn') || p.listeners.some((l) => !l.connected) || p.channels.some((c) => channelAttention(c) !== 'ok')) return 'warn';
  if (p.folders.some((f) => folderAttention(f) !== 'ok')) return 'warn';
  if (p.streams.some((s) => streamAttention(s) !== 'ok')) return 'warn';
  if (p.conversions.some((c) => conversionAttention(c) !== 'ok')) return 'warn';
  return 'ok';
}

/** SDK 1.8.0 (T-211): a conversion that failed, waits for a slot or dropped input wants a look. */
export function conversionAttention(c: MonitorConversion): Attention {
  return c.state === 'FAILED' || c.state === 'WAITING' || c.dropped > 0 || c.lostOutputs > 0 ? 'warn' : 'ok';
}

/** SDK 1.8.0: a stream that dropped chunks past its rate, or whose viewers lost data, wants a look. */
export function streamAttention(s: MonitorStream): Attention {
  return s.dropped + s.losses > 0 ? 'warn' : 'ok';
}

/** "1 d 2 h", "3 h 4 min", "5 min 6 s", "7 s". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return `${String(d)} d ${String(h)} h`;
  if (h > 0) return `${String(h)} h ${String(m)} min`;
  if (m > 0) return `${String(m)} min ${String(s % 60)} s`;
  return `${String(s)} s`;
}

/** Bytes in MiB, KiB or B, e.g. "512 MiB". */
export function bytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(n >= 100 * 1024 ? 0 : 1)} KiB`;
  return `${String(n)} B`;
}

/**
 * The busy share of a compute task between two answers: the time it did not wait for its inbox, of
 * the time its runs lasted; null without an earlier answer or time between them.
 */
export function busyShare(now: MonitorComputeTask, before: MonitorComputeTask | undefined): number | null {
  if (before === undefined) return null;
  const ran = now.runMillis - before.runMillis;
  if (ran <= 0) return null;
  return Math.max(0, Math.min(1, 1 - (now.waitMillis - before.waitMillis) / ran));
}
