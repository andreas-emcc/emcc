/** Test helpers: monitor snapshots (`GET /api/monitor`). Only tests import this. */
import type {
  MonitorAllocation, MonitorChannel, MonitorComputeTask, MonitorPlugin, MonitorSnapshot, MonitorTask, MonitorWorker,
} from '../ui/monitor/api.ts';

/** SDK 1.9.0: a compute task, running since 5 s before the snapshots' 10 000 ms, with `change`. */
export function computeTask(name: string, change: Partial<MonitorComputeTask> = {}): MonitorComputeTask {
  return {
    id: 1, name, state: 'RUNNING', sinceMillis: 5_000, restarts: 0, nextMillis: null, reason: null, counters: {}, details: {}, hung: false,
    cpuMillis: 0, runMillis: 0, waitMillis: 0, inbox: { queued: 0, accepted: 0, dropped: 0, evicted: 0, coalesced: 0 }, ...change,
  };
}

export function worker(name: string, change: Partial<MonitorWorker> = {}): MonitorWorker {
  return {
    owner: 'cot', name, state: 'RUNNING', queued: 0, capacity: 1000, accepted: 0, dropped: 0, evicted: 0, coalesced: 0,
    processed: 0, failures: 0, hung: 0, restarts: 0, maxHandlerMicros: 0, totalHandlerMicros: 0, ...change,
  };
}

export function plugin(id: string, change: Partial<MonitorPlugin> = {}): MonitorPlugin {
  return {
    id, name: id, active: true, state: 'OK', detail: '',
    caps: { outstandingAsks: 0, maxAsks: 10_000, refusedAsks: 0, activeTimers: 0, maxTimers: 1000, refusedTimers: 0 },
    workers: [], listeners: [], internet: null, notSavedUpdates: 0, connections: [], tasks: [], channels: [], capabilities: [], capabilityFault: null, folders: [], streams: [], conversions: [], compute: null, ...change,
  };
}

export function snapshot(
  atMillis: number, plugins: readonly MonitorPlugin[], coreWorkers: readonly MonitorWorker[] = [], allocation: Partial<MonitorAllocation> = {},
): MonitorSnapshot {
  return {
    atMillis,
    core: {
      state: 'RUNNING', uptimeSeconds: 3_725, liveSessions: 2, layers: 3, objects: 1_234, sequenceNo: 5_678, compute: { cap: 7, held: 0 }, tls: [],
      jvm: { heapUsed: 256 * 1024 * 1024, heapCommitted: 512 * 1024 * 1024, heapMax: 1024 * 1024 * 1024, platformThreads: 40, processors: 8,
        allocation: { totalBytes: 0, sampling: true, sampledBytes: 0, ecoreBytes: 0, ...allocation } },
    },
    plugins, coreWorkers, https: null,
  };
}

let taskIds = 0;

/** A connection task of a plugin, running since 5 s before the snapshots' 10 000 ms, with `change` (a new id unless given). */
export function task(plugin: string, name: string, change: Partial<MonitorTask> = {}): MonitorTask {
  return {
    plugin, id: ++taskIds, name, state: 'RUNNING', sinceMillis: 5_000, restarts: 0, nextMillis: null, reason: null, listening: null, peer: null,
    counters: {}, details: {}, lastActivityMillis: null, notEnding: false, queued: 0, lost: 0, coalesced: 0, ...change,
  };
}

/** An output channel a plugin offers, with `change`. */
export function channel(plugin: string, link: string, change: Partial<MonitorChannel> = {}): MonitorChannel {
  return {
    plugin, link, name: link, outputType: 'cot', state: 'READY', stateDetail: '', canDelete: false, declaredKinds: [], sent: 0, replaced: 0, delivered: 0, dropped: 0, pending: 0, inFlight: 0,
    ...change,
  };
}
