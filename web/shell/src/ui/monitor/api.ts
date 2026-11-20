/**
 * `GET /api/monitor` (server/app MonitorController): the live health of the core and the plugins,
 * for `settings.admin` only. Counters are totals since the start; the view takes rates from two
 * snapshots (`rates.ts`).
 */
import type { Answer } from '../settings/api.ts';

export interface MonitorWorker {
  readonly owner: string;
  readonly name: string;
  /** `RUNNING`, `HUNG`, `STOPPED` or `FAILED`. */
  readonly state: string;
  readonly queued: number;
  readonly capacity: number;
  readonly accepted: number;
  readonly dropped: number;
  readonly evicted: number;
  readonly coalesced: number;
  readonly processed: number;
  readonly failures: number;
  readonly hung: number;
  readonly restarts: number;
  readonly maxHandlerMicros: number;
  readonly totalHandlerMicros: number;
}

export interface MonitorListener {
  readonly plugin: string;
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly connected: boolean;
  readonly bytesRead: number;
  readonly bytesWritten: number;
  readonly reconnects: number;
}

/** One of the manifest's declared connections (SDK 1.2.0, ADR-0036 point 7): a declaration, not an allow-list. */
export interface MonitorConnection {
  /** `tcp-client`, `tcp-server`, `udp`, `multicast` or `other`. */
  readonly kinds: readonly string[];
  /** `in`, `out` or `both`. */
  readonly direction: string;
  /** A JSON Pointer to the links in the plugin's settings, or null. */
  readonly settings: string | null;
  readonly reason: string;
}

/**
 * A local folder the manifest declares (SDK 1.4.0, ADR-0049 point 4): ECore reads it for the plugin,
 * read only. Checked by ECore without waiting, so the state is that of the last poll's check.
 */
export interface MonitorFolder {
  readonly plugin: string;
  readonly id: string;
  readonly reason: string;
  /** The JSON Pointer into the plugin's settings that holds its path. */
  readonly setting: string;
  /** The path its setting holds, as typed, or null while it is empty. */
  readonly path: string | null;
  /** SDK 1.6.0 (CR-0041 part H): for a setting relative to emcc (`%emcc%/...`), the folder it resolves to; else null or absent. */
  readonly resolved?: string | null;
  /** `READABLE`, `NOT_SET`, `MISSING` (not there, not readable, or not an absolute path), or `CHECKING` until ECore's first check. */
  readonly state: string;
}

/** A connection task (ADR-0036 point 6): ECore's view of it and the plugin's own counters. */
export interface MonitorTask {
  readonly plugin: string;
  /** Unique among the server's tasks: a new task of the same name has another. */
  readonly id: number;
  readonly name: string;
  /**
   * `STARTING`, `RUNNING`, `RESTARTING`, `STOPPING`, `STOPPED` (only while it waits behind a stuck
   * run of its name) or `FAILED` (a task the plugin started itself, not a child: its last failure,
   * until a new task of the name starts; at most 20 per plugin).
   */
  readonly state: string;
  readonly sinceMillis: number;
  readonly restarts: number;
  /** When a restarting task runs again; null otherwise. */
  readonly nextMillis: number | null;
  /** Why it restarts, failed or still waits; null otherwise. */
  readonly reason: string | null;
  readonly listening: string | null;
  readonly peer: string | null;
  /** The plugin's own counters, totals since the task started. */
  readonly counters: Readonly<Record<string, number>>;
  readonly details: Readonly<Record<string, string>>;
  readonly lastActivityMillis: number | null;
  /** Stopped, but its run has not ended within 5 s. */
  readonly notEnding: boolean;
  readonly queued: number;
  /** Inbox items dropped or evicted when it was full. */
  readonly lost: number;
  readonly coalesced: number;
}

/**
 * An output channel the plugin offers (SDK 1.2.0, ADR-0037), one per output link: what ECore's inbox
 * for it holds and hands over. Totals since it was offered.
 */
export interface MonitorChannel {
  readonly plugin: string;
  /** The link: the channel's id is `plugin/link`. */
  readonly link: string;
  readonly name: string;
  /** What it sends, e.g. `cot`. */
  readonly outputType: string;
  /** SDK 1.9.0 (CR-0050 point 2): its state for its senders, as its plugin set it, and the detail. */
  readonly state: 'READY' | 'DEGRADED' | 'NOT_SENDING';
  readonly stateDetail: string;
  readonly canDelete: boolean;
  /** SDK 1.9.0 (CR-0048 point 4): the ids of the declared kinds it takes, sorted; empty for none. */
  readonly declaredKinds: readonly string[];
  /** Items accepted for it. */
  readonly sent: number;
  /** Items that replaced a pending item of the same object. */
  readonly replaced: number;
  /** Items the plugin's worker has handled. */
  readonly delivered: number;
  /** Items that went because its inbox was full (10 000 objects), or whose worker stopped first. */
  readonly dropped: number;
  /** Objects waiting in its inbox. */
  readonly pending: number;
  /** Items handed to the plugin's worker and not handled yet (at most 16). */
  readonly inFlight: number;
}

/**
 * SDK 1.8.0 (CR-0044 E1, T-208): a stream from the plugin's server part to its web part, while it is
 * open. Totals since it was opened.
 */
export interface MonitorStream {
  readonly plugin: string;
  readonly name: string;
  /** Its `Content-Type`, e.g. `video/mp2t`. */
  readonly mediaType: string;
  readonly viewers: number;
  readonly bytesIn: number;
  readonly bytesOut: number;
  /** Chunks dropped past the stream's rate (50 Mbit/s). */
  readonly dropped: number;
  /** Times a slow viewer lost its queue and resumed at the next start point. */
  readonly losses: number;
  /** What a new viewer starts from: the bytes since the last start point. */
  readonly startBufferBytes: number;
}

/**
 * SDK 1.8.0 (CR-0044 E2, T-211): a conversion by ECore's converter into one of the plugin's streams,
 * running or one of its last ten ended ones. Totals since it started.
 */
export interface MonitorConversion {
  readonly plugin: string;
  /** Its target stream, or (SDK 1.9.0) the encoder's name. */
  readonly stream: string;
  /** SDK 1.9.0 (CR-0050 point 1): MPEG-2 into a stream, or raw pictures encoded into a compute task. */
  readonly kind: 'conversion' | 'encoder';
  readonly state: 'WAITING' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'FAILED';
  /** Input handed to the converter, and its output. */
  readonly bytesIn: number;
  readonly bytesOut: number;
  /** Input dropped: while it waited for a slot, past its queue or past the rate; an encoder's pictures past 2 waiting. */
  readonly dropped: number;
  /** SDK 1.9.0: encoded pictures the compute task's inbox did not take; 0 for a conversion. */
  readonly lostOutputs: number;
  /** The converter's CPU time; -1 where the platform does not say. */
  readonly cpuMillis: number;
  /** Why it ended: "START: no output 10 s after its first input", "stopped", ... */
  readonly detail: string;
}

export interface MonitorPlugin {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  /** The effective status: `OK`, `DEGRADED` or `FAILED`. */
  readonly state: string;
  readonly detail: string;
  readonly caps: {
    readonly outstandingAsks: number;
    readonly maxAsks: number;
    readonly refusedAsks: number;
    readonly activeTimers: number;
    readonly maxTimers: number;
    readonly refusedTimers: number;
  };
  readonly workers: readonly MonitorWorker[];
  readonly listeners: readonly MonitorListener[];
  /**
   * The manifest's declared internet use, or null for none (ADR-0030): why, and the hosts of its
   * default settings, empty when it has none (CR-0022). A declaration, not a limit: it may also
   * reach other hosts.
   */
  readonly internet: { readonly hosts: readonly string[]; readonly reason: string } | null;
  /** Its updates that were not saved (ADR-0041: a running simulation's moves), since the start. */
  readonly notSavedUpdates: number;
  /** Its manifest's declared connections; empty for none. */
  readonly connections: readonly MonitorConnection[];
  /** Its connection tasks, by name. */
  readonly tasks: readonly MonitorTask[];
  /** The output channels it offers, by link. */
  readonly channels: readonly MonitorChannel[];
  /** SDK 1.4.0: the capabilities its manifest declares (ADR-0044 point 7). */
  readonly capabilities: readonly string[];
  /**
   * SDK 1.4.0: what a browser last found wrong with its capabilities and the web part, naming the
   * capability, and when (ADR-0044 point 4; owner, 2026-11-06); null when nothing is. The plugin keeps running.
   */
  readonly capabilityFault: { readonly problem: string; readonly atMillis: number } | null;
  /** SDK 1.4.0: the local folders its manifest declares, while it runs, in the manifest's order (ADR-0049 point 4). */
  readonly folders: readonly MonitorFolder[];
  /** SDK 1.8.0: its open streams to its web part, by name (CR-0044 E1). */
  readonly streams: readonly MonitorStream[];
  /** SDK 1.8.0: its conversions, running and recently ended (CR-0044 E2, T-211). */
  readonly conversions: readonly MonitorConversion[];
  /** SDK 1.9.0 (ADR-0064 point 5): its compute threads while it runs and declares some; null otherwise. */
  readonly compute: MonitorCompute | null;
}

/** ADR-0062 point 4 (M9 C3): a TLS credential of the server; never a path or a password. */
export interface MonitorTlsCredential {
  readonly name: string;
  /** The keys it was read from: `emc2.tls.<name>`, or the deprecated `emc2.listeners.credentials.<name>`. */
  readonly setting: string;
  /** Why its files cannot be read; null when they can. */
  readonly error: string | null;
  /** The client's chain, its own certificate first; empty without one. */
  readonly identity: readonly MonitorCertificate[];
  readonly trusted: readonly MonitorCertificate[];
}

/** A certificate: `soon` is within 30 days of its expiry. */
export interface MonitorCertificate {
  readonly subject: string;
  readonly issuer: string;
  readonly notAfterMillis: number;
  readonly state: 'valid' | 'soon' | 'expired';
}

/** SDK 1.9.0 (ADR-0064 point 5): a plugin's compute threads. */
export interface MonitorCompute {
  readonly declared: number;
  /** Why it needs them, from its manifest. */
  readonly reason: string;
  /** What the admin allows it now, 0 to `declared`. */
  readonly allowed: number;
  /** Its tasks that count against `allowed` now. */
  readonly running: number;
  /** Its refused starts since it started, by reason: NOT_DECLARED, SWITCHED_OFF, PLUGIN_LIMIT, TOTAL_CAP. */
  readonly refusals: { readonly [reason: string]: number };
  readonly tasks: readonly MonitorComputeTask[];
}

/** One compute task (ADR-0064 point 5). Times are totals since it started; the busy share comes from two answers. */
export interface MonitorComputeTask {
  readonly id: number;
  readonly name: string;
  /** STARTING, RUNNING, RESTARTING, STOPPING, STOPPED or FAILED. */
  readonly state: string;
  readonly sinceMillis: number;
  readonly restarts: number;
  readonly nextMillis: number | null;
  readonly reason: string | null;
  readonly counters: { readonly [name: string]: number };
  readonly details: { readonly [key: string]: string };
  /** It did not end 5 s after its stop; its thread may stay until the server restarts. */
  readonly hung: boolean;
  /** Its runs' CPU time so far; -1 when the JVM cannot say. */
  readonly cpuMillis: number;
  /** How long its runs have lasted so far. */
  readonly runMillis: number;
  /** Of those, how long it waited for its inbox. */
  readonly waitMillis: number;
  readonly inbox: { readonly queued: number; readonly accepted: number; readonly dropped: number; readonly evicted: number; readonly coalesced: number };
}

/**
 * The bytes allocated since the start (T-148, spike S5): the JVM's total, exact, and the weight of
 * JFR's allocation samples, all and ECore's (those with no plugin frame). Not split per plugin.
 */
export interface MonitorAllocation {
  /** Every thread's bytes since the JVM started; -1 where the JVM does not count them. */
  readonly totalBytes: number;
  /** Whether JFR samples (`emc2.monitor.allocation`); without, the two below stay 0. */
  readonly sampling: boolean;
  readonly sampledBytes: number;
  readonly ecoreBytes: number;
}

export interface MonitorSnapshot {
  readonly atMillis: number;
  readonly core: {
    readonly state: string;
    readonly uptimeSeconds: number;
    readonly jvm: {
      readonly heapUsed: number;
      readonly heapCommitted: number;
      /** -1 if not limited. */
      readonly heapMax: number;
      readonly platformThreads: number;
      readonly processors: number;
      readonly allocation: MonitorAllocation;
    };
    readonly liveSessions: number;
    readonly layers: number;
    readonly objects: number;
    readonly sequenceNo: number;
    /** SDK 1.9.0 (ADR-0064 point 4): the server's cap on compute tasks and the places held now, hung tasks included. */
    readonly compute: { readonly cap: number; readonly held: number };
    /** ADR-0062 point 4 (M9 C3): the server's TLS credentials, by name. */
    readonly tls: readonly MonitorTlsCredential[];
  };
  readonly plugins: readonly MonitorPlugin[];
  readonly coreWorkers: readonly MonitorWorker[];
  /** ADR-0061 point 6 (M9 C2): the server's own HTTPS certificate, read at each answer; null over plain HTTP. */
  readonly https: MonitorCertificate | null;
}

const TIMEOUT_MS = 5_000;

export class MonitorApi {
  private readonly doFetch: typeof fetch;

  constructor(doFetch?: typeof fetch, private readonly timeoutMs = TIMEOUT_MS) {
    // Not stored as `fetch` itself: called as a method of this object, the browser's fetch throws.
    this.doFetch = doFetch ?? ((input, init) => fetch(input, init));
  }

  async snapshot(): Promise<Answer<MonitorSnapshot>> {
    let response: Response;
    try {
      response = await this.doFetch('/api/monitor', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      return failed('The server did not answer.');
    }
    if (response.status === 401) return failed('Your login has ended. Reload the page to log in again.');
    if (response.status === 403) return failed('This needs the settings.admin permission.');
    if (!response.ok) return failed(`The server answered HTTP ${String(response.status)}.`);
    try {
      const body: unknown = await response.json();
      if (typeof body !== 'object' || body === null || !('core' in body) || !('plugins' in body) || !('coreWorkers' in body)) {
        return failed('The server sent an answer this page cannot read.');
      }
      return { ok: true, value: body as MonitorSnapshot };
    } catch {
      return failed('The server sent an answer this page cannot read.');
    }
  }
}

function failed(message: string): Answer<never> {
  return { ok: false, message, problems: [] };
}
