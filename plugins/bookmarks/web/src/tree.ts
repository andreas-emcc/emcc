// The bookmark tree as plain data, and every operation on it as a pure function: nothing here
// touches the SDK, React or storage, so the rules of the brief (functions 2 to 5) are tested apart.
import type { JsonValue, MapType } from '@emc2/plugin-sdk';

/** The name of the user document that holds the tree (ADR-0027: the plugin's own namespace). */
export const DOCUMENT_NAME = 'tree';
/** The document format this plugin writes. A document with a higher number was written by a newer plugin and is never overwritten. */
export const FORMAT_VERSION = 1;
/** Folders inside folders: a top level folder is level 1, and no folder may sit deeper than level 5 (brief function 4). */
export const MAX_DEPTH = 5;
/** A name has 1 to 100 characters (brief function 5). */
export const MAX_NAME_LENGTH = 100;
/** The default of the `maxItems` setting. */
export const DEFAULT_MAX_ITEMS = 1000;

/** What a bookmark remembers (ADR-0031 point 5): the map type, the centre and the zoom as metres per pixel at the centre. */
export interface BookmarkView {
  readonly mapType: MapType;
  /** Longitude, latitude (WGS84). */
  readonly center: readonly [longitude: number, latitude: number];
  /** Metres per CSS pixel at the centre (owner, 2026-10-15). */
  readonly resolution: number;
}

export interface Bookmark extends BookmarkView {
  readonly type: 'bookmark';
  readonly id: string;
  readonly name: string;
}

export interface Folder {
  readonly type: 'folder';
  readonly id: string;
  readonly name: string;
  readonly children: readonly TreeItem[];
}

export type TreeItem = Bookmark | Folder;

/** The user's tree: the items at the top level, in the user's own order. */
export interface Tree {
  readonly items: readonly TreeItem[];
}

export const EMPTY_TREE: Tree = { items: [] };

/** Why an operation was refused. */
export type Refusal =
  | 'bad-name'
  | 'bad-view'
  | 'limit'
  | 'too-deep'
  | 'not-found'
  | 'not-a-folder'
  | 'into-itself'
  | 'duplicate-id';

export type Outcome = { readonly ok: true; readonly tree: Tree } | { readonly ok: false; readonly reason: Refusal };

const refuse = (reason: Refusal): Outcome => ({ ok: false, reason });
const accept = (items: readonly TreeItem[]): Outcome => ({ ok: true, tree: { items } });

// ---------------------------------------------------------------------------------------------
// Names and views

/** The name as it is stored (trimmed), or null when it has no 1 to 100 characters. Counts characters, not UTF-16 units. */
export function normalizeName(name: string): string | null {
  const trimmed = name.trim();
  const length = Array.from(trimmed).length;
  return length >= 1 && length <= MAX_NAME_LENGTH ? trimmed : null;
}

function isValidView(view: BookmarkView): boolean {
  const [lon, lat] = view.center;
  return (
    view.mapType.projection.length > 0 &&
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= -180 &&
    lon <= 180 &&
    lat >= -90 &&
    lat <= 90 &&
    Number.isFinite(view.resolution) &&
    view.resolution > 0
  );
}

// ---------------------------------------------------------------------------------------------
// Reading and writing the document

/** Why a document cannot be read: `newer` was written by a newer plugin version, `damaged` is not a tree this plugin understands. */
export type Unreadable = 'damaged' | 'newer';

export type ParseResult =
  | { readonly kind: 'empty' }
  | { readonly kind: 'tree'; readonly tree: Tree }
  | { readonly kind: 'unreadable'; readonly reason: Unreadable };

type JsonObject = { readonly [key: string]: JsonValue };

const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseView(value: JsonObject): BookmarkView | null {
  const { mapType, center, resolution } = value;
  if (!isObject(mapType) || !Array.isArray(center) || center.length !== 2 || typeof resolution !== 'number') return null;
  const { projection, background } = mapType;
  const [lon, lat] = center as readonly JsonValue[];
  if (typeof projection !== 'string' || (background !== null && typeof background !== 'string')) return null;
  if (typeof lon !== 'number' || typeof lat !== 'number') return null;
  const view: BookmarkView = { mapType: { projection, background }, center: [lon, lat], resolution };
  return isValidView(view) ? view : null;
}

/** `level` is the level of the folder that holds the items (0 at the top level). */
function parseItems(value: JsonValue | undefined, level: number, ids: Set<string>): readonly TreeItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: TreeItem[] = [];
  for (const raw of value as readonly JsonValue[]) {
    if (!isObject(raw)) return null;
    const { id, name, type } = raw;
    if (typeof id !== 'string' || id.length === 0 || ids.has(id) || typeof name !== 'string') return null;
    if (normalizeName(name) !== name) return null;
    ids.add(id);
    if (type === 'folder') {
      if (level + 1 > MAX_DEPTH) return null;
      const children = parseItems(raw['children'], level + 1, ids);
      if (children === null) return null;
      items.push({ type: 'folder', id, name, children });
    } else if (type === 'bookmark') {
      const view = parseView(raw);
      if (view === null) return null;
      items.push({ type: 'bookmark', id, name, ...view });
    } else {
      return null;
    }
  }
  return items;
}

/** Reads the stored document (`null`: there is none yet). Anything that is not exactly a tree of this format is unreadable and must be left alone. */
export function parseDocument(value: JsonValue | null): ParseResult {
  if (value === null) return { kind: 'empty' };
  if (!isObject(value)) return { kind: 'unreadable', reason: 'damaged' };
  const version = value['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { kind: 'unreadable', reason: 'damaged' };
  if (version > FORMAT_VERSION) return { kind: 'unreadable', reason: 'newer' };
  const items = parseItems(value['items'], 0, new Set());
  return items === null ? { kind: 'unreadable', reason: 'damaged' } : { kind: 'tree', tree: { items } };
}

function itemToJson(item: TreeItem): JsonValue {
  if (item.type === 'folder') return { type: 'folder', id: item.id, name: item.name, children: item.children.map(itemToJson) };
  return {
    type: 'bookmark',
    id: item.id,
    name: item.name,
    mapType: { projection: item.mapType.projection, background: item.mapType.background },
    center: [item.center[0], item.center[1]],
    resolution: item.resolution,
  };
}

/** The document to store. */
export function serialize(tree: Tree): JsonValue {
  return { version: FORMAT_VERSION, items: tree.items.map(itemToJson) };
}

// ---------------------------------------------------------------------------------------------
// Looking things up

/** The number of bookmarks and folders in a list, at every level (what the limit counts). */
export function countItems(items: readonly TreeItem[]): number {
  let n = 0;
  for (const item of items) n += item.type === 'folder' ? 1 + countItems(item.children) : 1;
  return n;
}

/** What goes with a folder when it is deleted (brief function 4): everything inside it, not the folder itself. */
export interface Contents {
  readonly bookmarks: number;
  readonly folders: number;
}

function contentsOf(items: readonly TreeItem[]): Contents {
  let bookmarks = 0;
  let folders = 0;
  for (const item of items) {
    if (item.type === 'bookmark') {
      bookmarks += 1;
    } else {
      folders += 1;
      const inner = contentsOf(item.children);
      bookmarks += inner.bookmarks;
      folders += inner.folders;
    }
  }
  return { bookmarks, folders };
}

export function findItem(tree: Tree, id: string): TreeItem | null {
  const search = (items: readonly TreeItem[]): TreeItem | null => {
    for (const item of items) {
      if (item.id === id) return item;
      if (item.type === 'folder') {
        const inner = search(item.children);
        if (inner !== null) return inner;
      }
    }
    return null;
  };
  return search(tree.items);
}

/** What the confirmation of a delete states: the contents of a folder, `{0, 0}` for a bookmark or an empty folder, null for an unknown id. */
export function removalContents(tree: Tree, id: string): Contents | null {
  const item = findItem(tree, id);
  if (item === null) return null;
  return item.type === 'folder' ? contentsOf(item.children) : { bookmarks: 0, folders: 0 };
}

/** The level of a folder: 1 at the top level. 0 for `null` (the top level itself), -1 for an id that is not a folder. */
export function folderLevel(tree: Tree, id: string | null): number {
  if (id === null) return 0;
  const search = (items: readonly TreeItem[], level: number): number => {
    for (const item of items) {
      if (item.type !== 'folder') continue;
      if (item.id === id) return level;
      const inner = search(item.children, level + 1);
      if (inner > 0) return inner;
    }
    return -1;
  };
  return search(tree.items, 1);
}

/** How many levels of folders a folder takes up, itself included: 1 for a folder without folders in it. */
function folderHeight(folder: Folder): number {
  let deepest = 0;
  for (const child of folder.children) if (child.type === 'folder') deepest = Math.max(deepest, folderHeight(child));
  return 1 + deepest;
}

function contains(folder: Folder, id: string): boolean {
  return folder.children.some((c) => c.id === id || (c.type === 'folder' && contains(c, id)));
}

// ---------------------------------------------------------------------------------------------
// Changing the tree. Every function returns a new tree and leaves the old one alone.

/** Applies `edit` to the list of the folder `parentId` (`null`: the top level). Null when there is no such folder. */
function editList(
  items: readonly TreeItem[],
  parentId: string | null,
  edit: (list: readonly TreeItem[]) => readonly TreeItem[],
): readonly TreeItem[] | null {
  if (parentId === null) return edit(items);
  for (const [i, item] of items.entries()) {
    if (item.type !== 'folder') continue;
    const children = item.id === parentId ? edit(item.children) : editList(item.children, parentId, edit);
    if (children !== null) return [...items.slice(0, i), { ...item, children }, ...items.slice(i + 1)];
  }
  return null;
}

function checkParent(tree: Tree, parentId: string | null): Refusal | null {
  if (parentId === null) return null;
  const parent = findItem(tree, parentId);
  if (parent === null) return 'not-found';
  return parent.type === 'folder' ? null : 'not-a-folder';
}

/** New items go to the end of their folder (brief function 4). `maxItems` is the setting. */
export function addBookmark(tree: Tree, parentId: string | null, bookmark: { readonly id: string; readonly name: string; readonly view: BookmarkView }, maxItems: number): Outcome {
  const name = normalizeName(bookmark.name);
  if (name === null) return refuse('bad-name');
  if (!isValidView(bookmark.view)) return refuse('bad-view');
  const parentProblem = checkParent(tree, parentId);
  if (parentProblem !== null) return refuse(parentProblem);
  if (findItem(tree, bookmark.id) !== null) return refuse('duplicate-id');
  if (countItems(tree.items) >= maxItems) return refuse('limit');
  const created: Bookmark = { type: 'bookmark', id: bookmark.id, name, ...bookmark.view };
  const items = editList(tree.items, parentId, (list) => [...list, created]);
  return items === null ? refuse('not-found') : accept(items);
}

/** A new empty folder at the end of `parentId`'s folder; at most {@link MAX_DEPTH} levels. */
export function addFolder(tree: Tree, parentId: string | null, id: string, name: string, maxItems: number): Outcome {
  const clean = normalizeName(name);
  if (clean === null) return refuse('bad-name');
  const parentProblem = checkParent(tree, parentId);
  if (parentProblem !== null) return refuse(parentProblem);
  if (folderLevel(tree, parentId) + 1 > MAX_DEPTH) return refuse('too-deep');
  if (findItem(tree, id) !== null) return refuse('duplicate-id');
  if (countItems(tree.items) >= maxItems) return refuse('limit');
  const created: Folder = { type: 'folder', id, name: clean, children: [] };
  const items = editList(tree.items, parentId, (list) => [...list, created]);
  return items === null ? refuse('not-found') : accept(items);
}

function mapItem(items: readonly TreeItem[], id: string, change: (item: TreeItem) => TreeItem): readonly TreeItem[] | null {
  for (const [i, item] of items.entries()) {
    let replacement: TreeItem | null = null;
    if (item.id === id) {
      replacement = change(item);
    } else if (item.type === 'folder') {
      const children = mapItem(item.children, id, change);
      if (children !== null) replacement = { ...item, children };
    }
    if (replacement !== null) return [...items.slice(0, i), replacement, ...items.slice(i + 1)];
  }
  return null;
}

export function rename(tree: Tree, id: string, name: string): Outcome {
  const clean = normalizeName(name);
  if (clean === null) return refuse('bad-name');
  const items = mapItem(tree.items, id, (item) => ({ ...item, name: clean }));
  return items === null ? refuse('not-found') : accept(items);
}

function withoutItem(items: readonly TreeItem[], id: string): readonly TreeItem[] {
  return items.filter((i) => i.id !== id).map((i) => (i.type === 'folder' ? { ...i, children: withoutItem(i.children, id) } : i));
}

/** Deletes a bookmark, or a folder with everything in it. Asking first is the caller's job (`removalContents`). */
export function remove(tree: Tree, id: string): Outcome {
  if (findItem(tree, id) === null) return refuse('not-found');
  return accept(withoutItem(tree.items, id));
}

/**
 * Moves an item into the folder `parentId` (`null`: the top level), by "Move to…" or by drag and
 * drop. Without `index` it goes to the end. With `index` it goes before the item that stands at
 * that position in the destination's list **after the item has been taken out of it**; an index
 * past the end means the end. The other items keep their order (brief function 4, criterion 6).
 */
export function move(tree: Tree, id: string, parentId: string | null, index?: number): Outcome {
  const item = findItem(tree, id);
  if (item === null) return refuse('not-found');
  const parentProblem = checkParent(tree, parentId);
  if (parentProblem !== null) return refuse(parentProblem);
  if (item.type === 'folder') {
    if (parentId !== null && (parentId === id || contains(item, parentId))) return refuse('into-itself');
    if (folderLevel(tree, parentId) + folderHeight(item) > MAX_DEPTH) return refuse('too-deep');
  }
  const without = withoutItem(tree.items, id);
  const items = editList(without, parentId, (list) => {
    const at = index === undefined || !Number.isFinite(index) ? list.length : Math.max(0, Math.min(Math.trunc(index), list.length));
    return [...list.slice(0, at), item, ...list.slice(at)];
  });
  return items === null ? refuse('not-found') : accept(items);
}

/** The folder that holds an item: its id, `null` for the top level, `undefined` for an unknown id. */
export function parentOf(tree: Tree, id: string): string | null | undefined {
  const search = (items: readonly TreeItem[], parent: string | null): string | null | undefined => {
    for (const item of items) {
      if (item.id === id) return parent;
      if (item.type === 'folder') {
        const inner = search(item.children, item.id);
        if (inner !== undefined) return inner;
      }
    }
    return undefined;
  };
  return search(tree.items, null);
}

/** The names of a folder and the folders above it, from the top down; empty for the top level (`null`) or an unknown folder. */
export function pathOf(tree: Tree, folderId: string | null): readonly string[] {
  const path: string[] = [];
  let id = folderId;
  while (id !== null) {
    const item = findItem(tree, id);
    if (item?.type !== 'folder') return [];
    path.unshift(item.name);
    id = parentOf(tree, id) ?? null;
  }
  return path;
}

/** A place an item may be moved to: the folder's id (`null`: the top level) and the names from the top down, for "Move to…". */
export interface MoveTarget {
  readonly parentId: string | null;
  /** Empty for the top level. */
  readonly path: readonly string[];
}

/** Every folder the item may be moved to, in tree order, the top level first; not the place it already is. */
export function moveTargets(tree: Tree, id: string): readonly MoveTarget[] {
  const item = findItem(tree, id);
  if (item === null) return [];
  const targets: MoveTarget[] = [];
  const current = parentOf(tree, id);
  const consider = (parentId: string | null, path: readonly string[]) => {
    if (parentId !== current && move(tree, id, parentId).ok) targets.push({ parentId, path });
  };
  const walk = (items: readonly TreeItem[], path: readonly string[]) => {
    for (const i of items) {
      if (i.type !== 'folder') continue;
      const here = [...path, i.name];
      consider(i.id, here);
      walk(i.children, here);
    }
  };
  consider(null, []);
  walk(tree.items, []);
  return targets;
}
