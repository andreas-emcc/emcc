/**
 * The messages of the live picture protocol, version 2 (server/live-picture-protocol.md).
 * The model documents inside are exactly as in model/schemas, as the SDK's types describe them.
 */
import type { Area, ChangeEvent, ChangeRejection, ChangeRequest, Cluster, DataType, Layer, MapObject, ObjectCounts, Settings, UserTime, Uuid } from '@emc2/plugin-sdk';

/** The protocol version this shell speaks. */
export const PROTOCOL_VERSION = 2;

/** Messages from the server. */
export type ServerMessage =
  | { readonly type: 'welcome'; readonly protocol: number; readonly session?: string }
  | { readonly type: 'data-types'; readonly dataTypes: readonly DataType[] }
  | { readonly type: 'settings'; readonly plugin: string; readonly values: Settings }
  /** SDK 1.4.0 part 5: read the display settings again (`GET /api/display`). */
  | { readonly type: 'display' }
  /** T-170: someone saved the premade labels; read them again (`GET /api/settings/labeling`). */
  | { readonly type: 'labeling' }
  | ChannelMessage
  | {
      readonly type: 'change-outcome';
      readonly requestId: string;
      readonly outcome: 'applied' | 'rejected' | 'unknown';
      readonly event?: ChangeEvent;
      readonly rejection?: ChangeRejection;
    }
  | { readonly type: 'error'; readonly message: string; readonly requestId?: string; readonly subscription?: string }
  | QueryAnswer;

/** The answers to the object queries (`get-objects`, `query-layer`), one per `queryId`. */
export type QueryAnswer =
  | { readonly type: 'objects'; readonly queryId: string; readonly sequenceNo: number; readonly found: readonly MapObject[]; readonly missing: readonly Uuid[] }
  | {
      readonly type: 'layer-page'; readonly queryId: string; readonly sequenceNo: number; readonly layerId: Uuid; readonly page: number;
      readonly pageSize: number; readonly total: number; readonly objects: readonly MapObject[];
    }
  | { readonly type: 'query-failed'; readonly queryId: string; readonly problem: string; readonly message: string };

/** Messages about one subscription. */
export type ChannelMessage =
  | {
      readonly type: 'snapshot-begin'; readonly subscription: string; readonly sequenceNo: number; readonly layers: readonly Layer[];
      readonly objectCount: number; readonly objectCounts?: ObjectCounts;
    }
  | { readonly type: 'snapshot-objects'; readonly subscription: string; readonly objects: readonly MapObject[] }
  | { readonly type: 'snapshot-end'; readonly subscription: string; readonly sequenceNo: number }
  | { readonly type: 'changes'; readonly subscription: string; readonly sequenceNo: number; readonly events: readonly ChangeEvent[] }
  | {
      readonly type: 'area-objects'; readonly subscription: string; readonly sequenceNo: number; readonly entered: readonly MapObject[];
      readonly left: readonly string[];
    }
  | {
      readonly type: 'clusters'; readonly subscription: string; readonly sequenceNo: number; readonly level: number; readonly full: boolean;
      readonly upsert: readonly Cluster[]; readonly remove: readonly string[];
    }
  | { readonly type: 'counts'; readonly subscription: string; readonly sequenceNo: number; readonly counts: ObjectCounts };

/**
 * What a `subscribe` asks for: the whole picture, layers and counts, or an area; and `workspaces`
 * (data model 1.2.0, T-080): the workspace ids, or `['*']`; without it the server gives View only.
 */
export type SubscribeOptions = { readonly workspaces?: readonly string[] } & (
  | { readonly objects?: undefined; readonly area?: undefined }
  | { readonly objects: false }
  | { readonly area: Area; readonly resolution?: number; readonly budget?: number }
);

/** Messages to the server. */
export type ClientMessage =
  | ({ readonly type: 'subscribe'; readonly subscription: string } & SubscribeOptions)
  | { readonly type: 'area'; readonly subscription: string; readonly area: Area; readonly resolution?: number }
  | { readonly type: 'unsubscribe'; readonly subscription: string }
  | { readonly type: 'change-request'; readonly request: ChangeRequest }
  | { readonly type: 'get-objects'; readonly queryId: string; readonly ids: readonly Uuid[] }
  | { readonly type: 'query-layer'; readonly queryId: string; readonly layerId: Uuid; readonly page: number; readonly pageSize: number }
  /** SDK 1.4.0 (ADR-0045 point 4): the time the page's user picked; each connection starts at now. */
  | { readonly type: 'time'; readonly time: UserTime };

type Fields = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const OUTCOMES = new Set(['applied', 'rejected', 'unknown']);

type Check = (value: unknown) => boolean;

/**
 * What each type needs, as a check per field (T-014 review (5): a malformed message must not throw
 * in the shell's code or a listener): the top-level fields, and of the lists the shell reads into,
 * each element's kind and the fields the shell uses to place it (an id, a change's sequence number
 * and entity type). The model documents are not checked further: the server made them from
 * validated documents.
 */
const SHAPES: ReadonlyMap<string, Readonly<Record<string, Check>>> = (() => {
  const num: Check = (v) => typeof v === 'number' && Number.isFinite(v);
  const str: Check = (v) => typeof v === 'string';
  const obj: Check = isObject;
  const list = (each: Check): Check => (v) => Array.isArray(v) && v.every(each);
  const optional = (check: Check): Check => (v) => v === undefined || check(v);
  const withId: Check = (v) => isObject(v) && typeof v.id === 'string';
  const event: Check = (v) => isObject(v) && num(v.sequenceNo) && str(v.entityType) && str(v.entityId);
  const sub = { subscription: str };
  return new Map<string, Readonly<Record<string, Check>>>([
    ['welcome', { protocol: num, session: optional(str) }],
    ['data-types', { dataTypes: list(withId) }],
    ['settings', { plugin: str, values: obj }],
    ['change-outcome', { requestId: str, outcome: (v) => typeof v === 'string' && OUTCOMES.has(v), event: optional(event), rejection: optional(obj) }],
    ['error', { message: str, requestId: optional(str), subscription: optional(str) }],
    ['snapshot-begin', { ...sub, sequenceNo: num, layers: list(withId), objectCount: num, objectCounts: optional(obj) }],
    ['snapshot-objects', { ...sub, objects: list(withId) }],
    ['snapshot-end', { ...sub, sequenceNo: num }],
    ['changes', { ...sub, sequenceNo: num, events: list(event) }],
    ['area-objects', { ...sub, sequenceNo: num, entered: list(withId), left: list(str) }],
    ['clusters', { ...sub, sequenceNo: num, level: num, full: (v) => typeof v === 'boolean', upsert: list(obj), remove: list(str) }],
    ['counts', { ...sub, sequenceNo: num, counts: obj }],
    ['objects', { queryId: str, sequenceNo: num, found: list(withId), missing: list(str) }],
    ['layer-page', { queryId: str, sequenceNo: num, layerId: str, page: num, pageSize: num, total: num, objects: list(withId) }],
    ['query-failed', { queryId: str, problem: str, message: str }],
  ]);
})();

/**
 * Parses a message from the server and checks its shape ({@link SHAPES}): an object with a known
 * `type` and the fields that type needs. Returns the message, or why it was not one. A message of a
 * type this shell does not know passes, so that the caller can say so.
 */
export function parseServerMessage(text: string): ServerMessage | string {
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return 'not JSON';
  }
  if (!isObject(message) || typeof message.type !== 'string') return 'not an object with a type';
  const shape = SHAPES.get(message.type); // a Map: "__proto__" or "constructor" is no type
  if (shape === undefined) return message as unknown as ServerMessage;
  for (const [field, valid] of Object.entries(shape)) {
    if (!valid(message[field])) return `a ${message.type} message without a valid ${field}`;
  }
  return message as unknown as ServerMessage;
}

/** The live picture's address on the server the page came from. */
export function liveUrl(location: { readonly protocol: string; readonly host: string }): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`;
}
