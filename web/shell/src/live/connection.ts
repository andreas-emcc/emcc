/**
 * The browser's one WebSocket to the live picture (server/live-picture-protocol.md, version 2),
 * shared by all plugins (overview 4.5).
 *
 * - Carries the subscriptions of the open {@link Channel}s: subscribes each after `welcome` (and
 *   when it can, e.g. once its viewport is known), passes each message to its channel, and
 *   unsubscribes and subscribes a channel again when it needs a new snapshot.
 * - Sends change requests with `requestId` (UUID v7) and `source.plugin` filled in, and answers each
 *   with exactly one outcome: applied (once every subscription has judged the change, so the plugin
 *   sees its own change), rejected, or {@link OutcomeUnknownError} on a lost connection, an `unknown`
 *   outcome or no answer in time.
 * - Sends the object queries (`ctx.objects`, CR-0015 items 8 and 9) with a `queryId` and answers
 *   each once: its result, or {@link ObjectQueryError} for the server's `query-failed`, a lost
 *   connection or no answer in time.
 * - Reconnects after a lost connection, with growing pauses; every channel then gets a new snapshot.
 */
import {
  NOW, ObjectQueryError, OutcomeUnknownError, uuidv7, type ChangeOutcome, type ChangeRequest, type ChangeRequestContent, type DataType, type FetchResult,
  type LayerPage, type Settings, type UserTime, type Uuid,
} from '@emc2/plugin-sdk';
import type { Channel, ChannelHost } from './channels.ts';
import { parseServerMessage, PROTOCOL_VERSION, type ChannelMessage, type ClientMessage, type QueryAnswer, type ServerMessage } from './protocol.ts';
import type { HeldArea } from './viewport.ts';

/**
 * What the shell shows about the connection. `incompatible`: the server speaks another protocol
 * version. `logged-out`: the login session has ended (ADR-0022); reconnecting cannot help, the user
 * must log in again.
 */
export type LiveState = 'connecting' | 'open' | 'closed' | 'incompatible' | 'logged-out';

/** The server's close code when the login session has ended (server/live-picture-protocol.md). */
export const LOGIN_ENDED = 4401;

/** The part of a browser WebSocket the connection uses. */
export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'error', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: 'close', listener: (event: { readonly code: number; readonly reason: string }) => void): void;
}

export interface ConnectionOptions {
  readonly url: string;
  readonly createSocket: (url: string) => SocketLike;
  readonly onState?: (state: LiveState) => void;
  /** A `data-types` message: every data type with its effective behaviour (SDK v1). */
  readonly onDataTypes?: (dataTypes: readonly DataType[]) => void;
  /** A `settings` message: one plugin's complete settings (SDK v1). */
  readonly onSettings?: (pluginId: string, values: Settings) => void;
  /**
   * SDK 1.4.0 part 5 (ADR-0046 point 6): the user's display settings or the admin's defaults may
   * have changed, so read them again. Also called after each `welcome`, for a change missed while
   * no connection was open.
   */
  readonly onDisplay?: () => void;
  /** T-170: someone saved the premade labels (Settings › Labeling). */
  readonly onLabeling?: () => void;
  /** How long a change request may wait for its outcome (SDK: 10 s). */
  readonly outcomeTimeoutMs?: number;
  /** How long an object query may wait for its answer. */
  readonly queryTimeoutMs?: number;
  /** Pauses before the 1st, 2nd, … reconnect; the last one repeats. Each is jittered: half of it fixed, half random. */
  readonly reconnectDelaysMs?: readonly number[];
  /** A number in [0, 1) for the jitter; `Math.random` by default. */
  readonly random?: () => number;
  readonly log?: Pick<Console, 'warn'>;
}

interface Pending {
  readonly resolve: (outcome: ChangeOutcome) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface PendingQuery {
  readonly answer: (message: QueryAnswer) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export const OUTCOME_TIMEOUT_MS = 10_000;
/** Longer than the server's 10 s for an answer from the object store, which then says so. */
export const QUERY_TIMEOUT_MS = 15_000;
export const RECONNECT_DELAYS_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000, 30_000];

const CHANNEL_MESSAGES = new Set(['snapshot-begin', 'snapshot-objects', 'snapshot-end', 'changes', 'area-objects', 'clusters', 'counts']);

export class LiveConnection implements ChannelHost {
  private readonly options: ConnectionOptions;
  readonly log: Pick<Console, 'warn'>;
  private socket: SocketLike | null = null;
  private current: LiveState = 'closed';
  private running = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly queries = new Map<string, PendingQuery>();
  private readonly channels = new Map<string, Channel>();
  /** The channels subscribed on the current connection. */
  private readonly subscribed = new Set<string>();
  private waiting: { readonly sequenceNo: number; readonly resolve: () => void }[] = [];
  /** The open connection's session id, from `welcome` (SDK 1.4.0); null while none is open. */
  private sessionId: string | null = null;
  /** The time the page's user picked (ADR-0045); sent at each change and after each `welcome`. */
  private userTime: UserTime = NOW;

  constructor(options: ConnectionOptions) {
    this.options = options;
    this.log = options.log ?? console;
  }

  /**
   * The open connection's session id, as `welcome` gave it, or null (SDK 1.4.0): the shell names it
   * in requests to the plugins' endpoints (`X-Emc2-Session`), so that they carry the page's time.
   */
  get session(): string | null {
    return this.sessionId;
  }

  /**
   * The time the page's user picked (ADR-0045 point 4; CR-0032: both parts in one message): sent now
   * if the connection is open, and again after each reconnect unless it is now, since a new session
   * starts at now. Only a change is sent.
   */
  setTime(time: UserTime): void {
    if (JSON.stringify(time) === JSON.stringify(this.userTime)) return;
    this.userTime = time;
    const socket = this.socket;
    if (socket !== null && this.current === 'open') this.send(socket, { type: 'time', time });
  }

  get state(): LiveState {
    return this.current;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  /** The login session has ended: closes the connection for good and does not reconnect. */
  loggedOut(): void {
    this.stop();
    this.setState('logged-out');
  }

  /** Closes the connection for good; waiting change requests end with an unknown outcome. */
  stop(): void {
    this.running = false;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, 'shell stopped');
    this.lost('the shell closed the connection');
    this.setState('closed');
  }

  // ---- Channels ---------------------------------------------------------------------------------

  /** Opens a channel: it is subscribed now if it can be, and after every reconnect. */
  open(channel: Channel): void {
    this.channels.set(channel.id, channel);
    this.subscribe(channel);
  }

  /** Closes a channel and its subscription. */
  close(channel: Channel): void {
    if (this.channels.get(channel.id) !== channel) return;
    this.channels.delete(channel.id);
    channel.close();
    if (this.subscribed.delete(channel.id) && this.socket !== null && this.current === 'open') {
      this.send(this.socket, { type: 'unsubscribe', subscription: channel.id });
    }
    this.release();
  }

  subscribe(channel: Channel): void {
    const socket = this.socket;
    if (socket === null || this.current !== 'open' || this.channels.get(channel.id) !== channel || this.subscribed.has(channel.id)) return;
    const options = channel.options();
    if (options === null) return;
    channel.reset();
    this.subscribed.add(channel.id);
    this.send(socket, { type: 'subscribe', subscription: channel.id, ...options });
  }

  isSubscribed(channel: Channel): boolean {
    return this.subscribed.has(channel.id);
  }

  sendArea(channel: Channel, held: HeldArea): void {
    const socket = this.socket;
    if (socket === null || this.current !== 'open' || !this.subscribed.has(channel.id)) return;
    this.send(socket, { type: 'area', subscription: channel.id, area: held.area, resolution: held.resolution });
  }

  resubscribe(channel: Channel): void {
    const socket = this.socket;
    if (socket === null || this.current !== 'open' || !this.subscribed.has(channel.id)) return;
    this.send(socket, { type: 'unsubscribe', subscription: channel.id });
    this.subscribed.delete(channel.id);
    this.subscribe(channel);
  }

  /**
   * Resolves once every subscribed channel has judged the change with this sequence number (also
   * at once without one), or when the connection is lost: the change is known to be applied.
   */
  reached(sequenceNo: number): Promise<void> {
    if (this.hasReached(sequenceNo)) return Promise.resolve();
    return new Promise((resolve) => this.waiting.push({ sequenceNo, resolve }));
  }

  private hasReached(sequenceNo: number): boolean {
    for (const id of this.subscribed) {
      const channel = this.channels.get(id);
      if (channel !== undefined && channel.sequenceNo < sequenceNo) return false;
    }
    return true;
  }

  private release(): void {
    if (this.waiting.length === 0) return;
    const due = this.waiting.filter((w) => this.hasReached(w.sequenceNo));
    this.waiting = this.waiting.filter((w) => !this.hasReached(w.sequenceNo));
    for (const w of due) w.resolve();
  }

  // ---- Change requests --------------------------------------------------------------------------

  /** Sends a plugin's change request; see the class comment for the outcomes. */
  submit(content: ChangeRequestContent, pluginId: string): Promise<ChangeOutcome> {
    const socket = this.socket;
    if (socket === null || this.current !== 'open') {
      return Promise.reject(new OutcomeUnknownError('not connected to the server'));
    }
    const requestId = uuidv7();
    const request = { ...content, requestId, source: { plugin: pluginId } } as ChangeRequest;
    return new Promise<ChangeOutcome>((resolve, reject) => {
      const timeoutMs = this.options.outcomeTimeoutMs ?? OUTCOME_TIMEOUT_MS;
      const timer = setTimeout(() => {
        if (this.pending.delete(requestId)) {
          reject(new OutcomeUnknownError(`no answer from the server within ${String(timeoutMs / 1000)} s`));
        }
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.send(socket, { type: 'change-request', request });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new OutcomeUnknownError(`the change request could not be sent: ${String(error)}`));
      }
    });
  }

  // ---- Object queries ---------------------------------------------------------------------------

  /** The objects with these ids (`get-objects`); the server checks the ids. */
  getObjects(ids: readonly Uuid[]): Promise<FetchResult> {
    return this.query({ type: 'get-objects', ids }, (message) => {
      if (message.type !== 'objects') throw new ObjectQueryError(`the server answered get-objects with ${message.type}`);
      return { found: message.found, missing: message.missing };
    });
  }

  /** One page of a layer's objects (`query-layer`); `page` and `pageSize` checked by the caller. */
  queryLayer(layerId: Uuid, page: number, pageSize: number): Promise<LayerPage> {
    return this.query({ type: 'query-layer', layerId, page, pageSize }, (message) => {
      if (message.type !== 'layer-page') throw new ObjectQueryError(`the server answered query-layer with ${message.type}`);
      return { layerId: message.layerId, page: message.page, pageSize: message.pageSize, objects: message.objects, total: message.total };
    });
  }

  private query<T>(
    message: { readonly type: 'get-objects'; readonly ids: readonly Uuid[] } | { readonly type: 'query-layer'; readonly layerId: Uuid; readonly page: number; readonly pageSize: number },
    result: (answer: Exclude<QueryAnswer, { type: 'query-failed' }>) => T,
  ): Promise<T> {
    const socket = this.socket;
    if (socket === null || this.current !== 'open') return Promise.reject(new ObjectQueryError('not connected to the server'));
    const queryId = uuidv7();
    return new Promise<T>((resolve, reject) => {
      const timeoutMs = this.options.queryTimeoutMs ?? QUERY_TIMEOUT_MS;
      const timer = setTimeout(() => {
        if (this.queries.delete(queryId)) reject(new ObjectQueryError(`no answer from the server within ${String(timeoutMs / 1000)} s`));
      }, timeoutMs);
      const answer = (reply: QueryAnswer) => {
        if (reply.type === 'query-failed') {
          reject(new ObjectQueryError(reply.message));
          return;
        }
        try {
          resolve(result(reply));
        } catch (error) {
          reject(error instanceof Error ? error : new ObjectQueryError(String(error)));
        }
      };
      this.queries.set(queryId, { answer, reject, timer });
      try {
        this.send(socket, { ...message, queryId });
      } catch (error) {
        clearTimeout(timer);
        this.queries.delete(queryId);
        reject(new ObjectQueryError(`the query could not be sent: ${String(error)}`));
      }
    });
  }

  private queryAnswer(message: QueryAnswer): void {
    const pending = this.queries.get(message.queryId);
    if (pending === undefined) return; // answered already (timeout or lost connection)
    this.queries.delete(message.queryId);
    clearTimeout(pending.timer);
    pending.answer(message);
  }

  // ---- The socket -------------------------------------------------------------------------------

  private connect(): void {
    this.reconnectTimer = null;
    this.setState('connecting');
    let socket: SocketLike;
    try {
      socket = this.options.createSocket(this.options.url);
    } catch (error) {
      this.log.warn('Live picture: cannot open the connection', error);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      if (socket === this.socket) this.receive(socket, event.data);
    });
    socket.addEventListener('close', (event) => {
      if (socket !== this.socket) return;
      this.socket = null;
      if (event.code === LOGIN_ENDED) {
        this.loggedOut();
        return;
      }
      this.lost('the connection to the server was lost');
      if (this.current === 'incompatible') return;
      this.setState('closed');
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    const delays = this.options.reconnectDelaysMs ?? RECONNECT_DELAYS_MS;
    const base = delays[Math.min(this.attempt, delays.length - 1)] ?? 1_000;
    // Jitter (T-014 review (5)): after a server restart, browsers do not all come back at the same instant.
    const delay = base / 2 + (this.options.random ?? Math.random)() * (base / 2);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => { this.connect(); }, delay);
  }

  private receive(socket: SocketLike, data: unknown): void {
    const message = parseServerMessage(String(data));
    if (typeof message === 'string') {
      this.log.warn(`Live picture: a message was ignored: ${message}`);
      return;
    }
    if (CHANNEL_MESSAGES.has(message.type)) {
      const channelMessage = message as ChannelMessage;
      const channel = this.channels.get(channelMessage.subscription);
      if (channel !== undefined && this.subscribed.has(channel.id)) {
        channel.receive(channelMessage);
        this.release();
      }
      return;
    }
    switch (message.type) {
      case 'welcome':
        if (message.protocol !== PROTOCOL_VERSION) {
          this.log.warn(`Live picture: the server speaks protocol ${String(message.protocol)}, this page ${String(PROTOCOL_VERSION)}. Reload the page.`);
          this.setState('incompatible');
          socket.close(1000, 'incompatible protocol');
          return;
        }
        this.attempt = 0;
        this.sessionId = message.session ?? null;
        this.setState('open');
        if (Object.keys(this.userTime).length > 0) this.send(socket, { type: 'time', time: this.userTime }); // {} is now
        this.subscribed.clear();
        for (const channel of [...this.channels.values()]) this.subscribe(channel);
        this.options.onDisplay?.();
        return;
      case 'display':
        this.options.onDisplay?.();
        return;
      case 'labeling':
        this.options.onLabeling?.();
        return;
      case 'data-types':
        this.options.onDataTypes?.(message.dataTypes);
        return;
      case 'settings':
        this.options.onSettings?.(message.plugin, message.values);
        return;
      case 'change-outcome':
        this.outcome(message);
        return;
      case 'objects':
      case 'layer-page':
      case 'query-failed':
        this.queryAnswer(message);
        return;
      case 'error':
        this.serverError(message.message, message.requestId, message.subscription);
        return;
      default:
        this.log.warn('Live picture: a message of an unknown type was ignored', message);
    }
  }

  private outcome(message: Extract<ServerMessage, { type: 'change-outcome' }>): void {
    const pending = this.take(message.requestId);
    if (pending === null) return; // answered already (timeout or lost connection)
    if (message.outcome === 'applied' && message.event) {
      const event = message.event;
      // Applied: it resolves once every subscription has judged it, and at the latest after the
      // outcome timeout (a subscription that never gets a snapshot must not hold it up).
      let done = false;
      const resolve = () => {
        if (done) return;
        done = true;
        clearTimeout(latest);
        pending.resolve({ outcome: 'applied', event });
      };
      const latest = setTimeout(resolve, this.options.outcomeTimeoutMs ?? OUTCOME_TIMEOUT_MS);
      void this.reached(event.sequenceNo).then(resolve);
    } else if (message.outcome === 'rejected' && message.rejection) {
      pending.resolve({ outcome: 'rejected', rejection: message.rejection });
    } else {
      pending.reject(new OutcomeUnknownError('the object store did not answer in time; the live picture shows what happened'));
    }
  }

  private serverError(text: string, requestId: string | undefined, subscription: string | undefined): void {
    const channel = subscription === undefined ? undefined : this.channels.get(subscription);
    if (channel !== undefined && channel.refusedBeforeSnapshot() && this.subscribed.delete(channel.id)) {
      this.release(); // the server did not open it: it no longer holds up outcomes, and may subscribe again
    }
    const pending = requestId === undefined ? null : this.take(requestId);
    if (pending === null) {
      this.log.warn(`Live picture: the server reports an error${subscription === undefined ? '' : ` about ${subscription}`}: ${text}`);
      return;
    }
    pending.reject(new OutcomeUnknownError(`the server could not take the change request: ${text}`));
  }

  private take(requestId: string): Pending | null {
    const pending = this.pending.get(requestId);
    if (pending === undefined) return null;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    return pending;
  }

  /** Every waiting change request ends with an unknown outcome, every waiting query fails; applied ones resolve. */
  private lost(reason: string): void {
    this.sessionId = null;
    this.subscribed.clear();
    for (const channel of this.channels.values()) {
      channel.reset();
      channel.disconnected();
    }
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const pending of all) {
      clearTimeout(pending.timer);
      pending.reject(new OutcomeUnknownError(reason));
    }
    const queries = [...this.queries.values()];
    this.queries.clear();
    for (const query of queries) {
      clearTimeout(query.timer);
      query.reject(new ObjectQueryError(reason));
    }
    const waiting = this.waiting;
    this.waiting = [];
    for (const w of waiting) w.resolve();
  }

  private send(socket: SocketLike, message: ClientMessage): void {
    socket.send(JSON.stringify(message));
  }

  private setState(state: LiveState): void {
    if (this.current === state) return;
    this.current = state;
    this.options.onState?.(state);
  }
}
