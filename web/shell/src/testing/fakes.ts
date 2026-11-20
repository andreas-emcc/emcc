/** Test helpers: a scripted WebSocket and minimal model documents. Only tests import this. */
import type { ChangeEvent, JsonValue, Layer, MapObject, UserDocuments } from '@emc2/plugin-sdk';
import type { SocketLike } from '../live/connection.ts';
import type { PluginEntry } from '../plugins/plan.ts';
import { SharedState } from '../plugins/shared.ts';
import { MonitorApi } from '../ui/monitor/api.ts';
import { SettingsApi } from '../ui/settings/api.ts';
import { Drafts } from '../ui/settings/drafts.ts';
import type { ViewServices } from '../ui/services.ts';

type Listener = (event: never) => void;

/** A WebSocket the test plays the server for. */
export class FakeSocket implements SocketLike {
  /** Messages the shell sent, parsed. */
  readonly sent: { readonly type: string; readonly [field: string]: unknown }[] = [];
  closedWith: { readonly code: number | undefined; readonly reason: string | undefined } | null = null;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {}

  send(data: string): void {
    if (this.closedWith !== null) throw new Error('the socket is closed');
    this.sent.push(JSON.parse(data) as FakeSocket['sent'][number]);
  }

  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
  }

  addEventListener(type: 'open' | 'error' | 'message' | 'close', listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  /** The server sends a message. */
  receive(message: object): void {
    this.fire('message', { data: JSON.stringify(message) });
  }

  /** A message exactly as this text, e.g. one that is not JSON. */
  receiveText(text: string): void {
    this.fire('message', { data: text });
  }

  /** The connection ends. */
  drop(code = 1006): void {
    this.fire('close', { code, reason: '' });
  }

  /** The change request sent last. */
  lastRequest(): { readonly requestId: string; readonly source: unknown; readonly entityId: string } {
    const message = this.sent.findLast((m) => m.type === 'change-request');
    if (message === undefined) throw new Error('no change request was sent');
    return message.request as { readonly requestId: string; readonly source: unknown; readonly entityId: string };
  }

  /** Types of the messages sent so far. */
  get sentTypes(): string[] {
    return this.sent.map((m) => m.type);
  }

  private fire(type: string, event: object): void {
    for (const listener of this.listeners.get(type) ?? []) (listener as (event: object) => void)(event);
  }
}

/** Creates sockets and remembers them, newest last. */
export function socketFactory(): { readonly sockets: FakeSocket[]; readonly create: (url: string) => FakeSocket; readonly last: () => FakeSocket } {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    create: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    last: () => {
      const socket = sockets.at(-1);
      if (socket === undefined) throw new Error('no socket was opened');
      return socket;
    },
  };
}

// Model documents with only the fields the shell itself looks at; the server checks the rest.
export const layer = (id: string, name = id): Layer => ({ id, name, version: 1 }) as unknown as Layer;
export const mapObject = (id: string, version = 1): MapObject => ({ id, version, layerId: 'L' }) as unknown as MapObject;

export function objectEvent(sequenceNo: number, id: string, operation: 'create' | 'update' | 'delete', requestId = `r${String(sequenceNo)}`): ChangeEvent {
  return {
    sequenceNo, requestId, entityType: 'object', operation, entityId: id, version: sequenceNo, previousVersion: null,
    state: operation === 'delete' ? null : mapObject(id, sequenceNo),
  } as unknown as ChangeEvent;
}

export function layerEvent(sequenceNo: number, id: string, operation: 'create' | 'update' | 'delete'): ChangeEvent {
  return {
    sequenceNo, requestId: `r${String(sequenceNo)}`, entityType: 'layer', operation, entityId: id, version: sequenceNo,
    previousVersion: null, state: operation === 'delete' ? null : layer(id),
  } as unknown as ChangeEvent;
}

/** Plays a whole snapshot of one subscription (default `all`, the whole picture): begin, objects in parts of `partSize`, end. */
export function sendSnapshot(
  socket: FakeSocket, sequenceNo: number, layers: readonly Layer[], objects: readonly MapObject[],
  { subscription = 'all', partSize = 1_000, objectCounts }: { readonly subscription?: string; readonly partSize?: number; readonly objectCounts?: object } = {},
): void {
  socket.receive({ type: 'snapshot-begin', subscription, sequenceNo, layers, objectCount: objects.length, ...(objectCounts ? { objectCounts } : {}) });
  for (let i = 0; i < objects.length; i += partSize) socket.receive({ type: 'snapshot-objects', subscription, objects: objects.slice(i, i + partSize) });
  socket.receive({ type: 'snapshot-end', subscription, sequenceNo });
}

/** A `changes` message of one subscription; its sequence number is the last event's unless given. */
export function changes(subscription: string, events: readonly ChangeEvent[], sequenceNo = events.at(-1)?.sequenceNo ?? 0): object {
  return { type: 'changes', subscription, sequenceNo, events };
}

/** A plugin as `GET /api/plugins` lists it: active, with a web part built against the shell's libraries. */
export function pluginEntry(id: string, fields: Partial<Omit<PluginEntry, 'web'>> & { readonly web?: Partial<NonNullable<PluginEntry['web']>> | null } = {}): PluginEntry {
  const { web, ...rest } = fields;
  return {
    id, name: id, version: '0.1.0', kind: 'general', active: true, status: { state: 'OK', detail: '' },
    sdkVersion: '^1.0.0', dependsOn: [], provides: [], requires: [], required: false, settings: {},
    ...rest,
    web: web === null ? null : { entry: 'index.js', css: [], shared: {}, url: `/plugins/${id}/web/`, ...web },
  };
}

/** The views' services (settings, monitor); without `doFetch` the server never answers. */
export function settingsServices(doFetch?: typeof fetch): ViewServices {
  const answer = doFetch ?? (() => new Promise<Response>(() => undefined));
  return { api: new SettingsApi(answer), shared: new SharedState(), drafts: new Drafts(), monitor: new MonitorApi(answer) };
}

/**
 * A user's documents in one namespace, in memory, as `userDocumentsOf` gives them: `stored` holds
 * them as JSON values, `calls` lists what was asked, and `fail` makes every call reject until it is
 * called with null.
 */
export function memoryDocuments(initial: Readonly<Record<string, JsonValue>> = {}) {
  const stored = new Map<string, JsonValue>(Object.entries(initial));
  const calls: string[] = [];
  let failing: Error | null = null;
  const answer = <T,>(call: string, value: () => T): Promise<T> => {
    calls.push(call);
    return failing === null ? Promise.resolve(value()) : Promise.reject(failing);
  };
  const copy = (value: JsonValue): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
  const documents: UserDocuments = {
    get: (name) => answer(`get ${name}`, () => { const value = stored.get(name); return value === undefined ? null : copy(value); }),
    put: (name, value) => answer(`put ${name}`, () => { stored.set(name, copy(value)); }),
    delete: (name) => answer(`delete ${name}`, () => { stored.delete(name); }),
    list: () => answer('list', () => [...stored.keys()].sort()),
  };
  return {
    documents, stored, calls,
    fail(error: Error | null) { failing = error; },
  };
}
