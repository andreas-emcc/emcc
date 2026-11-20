import { type Page, type WebSocket } from '@playwright/test';

// What the server sends to the map view's own subscription (protocol version 2), read from the
// page's live picture WebSocket: the map view draws what it receives (map-view-2d criteria 20-22).
// It follows the newest subscription the page opened with an area and a budget: the map view's.
// Other plugins may follow the viewport too (an area without a budget); a new budget means a new
// subscription. It holds what that subscription holds: the objects shown one by one and the
// clusters.

type Frame = { type: string; subscription?: string; [key: string]: unknown };
type Cluster = { cell: string; position: [number, number]; count: number; byLayer: Record<string, number>; byIdentity: Record<string, number> };

export type MapSubscription = {
  /** The subscription's id, once the page has opened one with an area. */
  id(): string | undefined;
  /** The ids of the objects it holds one by one. */
  objectIds(): Set<string>;
  clusters(): Cluster[];
  /** Objects plus clusters: the items the map view draws. */
  items(): number;
  /** How many subscriptions with an area and a budget the page has opened. */
  subscriptions(): number;
  /** The subscribe message of the current one (area, resolution, budget). */
  subscribe(): Frame | undefined;
  /** Area moves the page sent for it, and the `area-objects` answers it got. */
  moves(): { sent: number; answered: number };
  /** Every `error` the server sent on the page's socket (a refused subscribe or move, e.g. a limit). */
  errors(): string[];
};

/** Call before the app loads (in withM0's `open(beforeLoad)`). */
export function watchMapSubscription(page: Page): MapSubscription {
  let id: string | undefined;
  let subscribeFrame: Frame | undefined;
  let opened = 0;
  let sent = 0;
  let answered = 0;
  const errors: string[] = [];
  let objects = new Set<string>();
  let clusters = new Map<string, Cluster>();
  page.on('websocket', (socket: WebSocket) => {
    if (!socket.url().endsWith('/api/live')) return;
    socket.on('framesent', ({ payload }) => {
      const message = JSON.parse(String(payload)) as Frame;
      if (message.type === 'subscribe' && message.area !== undefined && message.budget !== undefined) {
        id = message.subscription;
        subscribeFrame = message;
        opened++;
        objects = new Set();
        clusters = new Map();
      }
      if (message.type === 'area' && message.subscription === id) sent++;
    });
    socket.on('framereceived', ({ payload }) => {
      const message = JSON.parse(String(payload)) as Frame;
      if (message.type === 'error') errors.push(JSON.stringify(message));
      if (id === undefined || message.subscription !== id) return;
      switch (message.type) {
        case 'snapshot-begin':
          objects = new Set();
          clusters = new Map();
          break;
        case 'snapshot-objects':
          for (const o of message.objects as Array<{ id: string }>) objects.add(o.id);
          break;
        case 'changes':
          for (const e of message.events as Array<{ entityType: string; entityId: string; state: unknown }>) {
            if (e.entityType !== 'object') continue;
            if (e.state === null) objects.delete(e.entityId);
            else objects.add(e.entityId);
          }
          break;
        case 'area-objects':
          answered++;
          for (const o of message.entered as Array<{ id: string }>) objects.add(o.id);
          for (const left of message.left as string[]) objects.delete(left);
          break;
        case 'clusters':
          if (message.full) clusters = new Map();
          for (const c of message.upsert as Cluster[]) clusters.set(c.cell, c);
          for (const cell of message.remove as string[]) clusters.delete(cell);
          break;
      }
    });
  });
  return {
    id: () => id,
    objectIds: () => objects,
    clusters: () => [...clusters.values()],
    items: () => objects.size + clusters.size,
    subscriptions: () => opened,
    subscribe: () => subscribeFrame,
    moves: () => ({ sent, answered }),
    errors: () => [...errors],
  };
}
