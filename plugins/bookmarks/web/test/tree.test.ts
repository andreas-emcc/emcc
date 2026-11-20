import { describe, expect, it } from 'vitest';
import type { JsonValue } from '@emc2/plugin-sdk';
import {
  EMPTY_TREE,
  MAX_DEPTH,
  addBookmark,
  addFolder,
  countItems,
  findItem,
  folderLevel,
  move,
  moveTargets,
  normalizeName,
  parentOf,
  pathOf,
  parseDocument,
  remove,
  removalContents,
  rename,
  serialize,
  type BookmarkView,
  type Outcome,
  type Tree,
} from '../src/tree.ts';

const MAX = 1000;
/** Latitude and longitude differ, so a swapped pair shows (CLAUDE.md section 4). */
const VIEW: BookmarkView = { mapType: { projection: 'EPSG:3413', background: 'naturalearth' }, center: [15.25, 62.5], resolution: 1234.5 };

function tree(outcome: Outcome): Tree {
  if (!outcome.ok) throw new Error(`refused: ${outcome.reason}`);
  return outcome.tree;
}
const names = (t: Tree, ...path: string[]): string[] => {
  let items = t.items;
  for (const step of path) {
    const folder = items.find((i) => i.name === step);
    if (folder?.type !== 'folder') throw new Error(`no folder ${step}`);
    items = folder.children;
  }
  return items.map((i) => i.name);
};
const mark = (t: Tree, parent: string | null, id: string) => tree(addBookmark(t, parent, { id, name: id, view: VIEW }, MAX));
const folder = (t: Tree, parent: string | null, id: string) => tree(addFolder(t, parent, id, id, MAX));

describe('names', () => {
  it('are trimmed and have 1 to 100 characters', () => {
    expect(normalizeName('  Home  ')).toBe('Home');
    expect(normalizeName('x'.repeat(100))).toBe('x'.repeat(100));
    expect(normalizeName('x'.repeat(101))).toBeNull();
    expect(normalizeName('')).toBeNull();
    expect(normalizeName('   ')).toBeNull();
  });

  it('count characters, not UTF-16 units', () => {
    expect(normalizeName('🧭'.repeat(100))).not.toBeNull();
    expect(normalizeName('🧭'.repeat(101))).toBeNull();
  });
});

describe('the document', () => {
  it('has no tree before the first write', () => {
    expect(parseDocument(null)).toEqual({ kind: 'empty' });
  });

  it('keeps names, order, map type, centre and resolution through a write and a read (AC 1, data)', () => {
    let t = mark(EMPTY_TREE, null, 'a');
    t = folder(t, null, 'f');
    t = mark(t, 'f', 'b');
    const parsed = parseDocument(JSON.parse(JSON.stringify(serialize(t))) as JsonValue);
    expect(parsed).toEqual({ kind: 'tree', tree: t });
    const a = findItem(t, 'a');
    if (a?.type !== 'bookmark') throw new Error('no bookmark');
    // longitude first, and the two are not mixed up
    expect(a.center).toEqual([15.25, 62.5]);
    expect(a.mapType).toEqual({ projection: 'EPSG:3413', background: 'naturalearth' });
    expect(a.resolution).toBe(1234.5);
  });

  it('keeps a bookmark without a background', () => {
    const t = tree(addBookmark(EMPTY_TREE, null, { id: 'a', name: 'a', view: { ...VIEW, mapType: { projection: 'EPSG:3857', background: null } } }, MAX));
    expect(parseDocument(serialize(t))).toEqual({ kind: 'tree', tree: t });
  });

  it('is unreadable when it was written by a newer version', () => {
    expect(parseDocument({ version: 2, items: [] })).toEqual({ kind: 'unreadable', reason: 'newer' });
  });

  it.each<[string, JsonValue]>([
    ['a string', 'hello'],
    ['an array', []],
    ['no version', { items: [] }],
    ['version 0', { version: 0, items: [] }],
    ['a fractional version', { version: 1.5, items: [] }],
    ['no items', { version: 1 }],
    ['items that are not a list', { version: 1, items: {} }],
    ['an item that is not an object', { version: 1, items: [3] }],
    ['an unknown type', { version: 1, items: [{ type: 'link', id: 'a', name: 'a' }] }],
    ['a missing id', { version: 1, items: [{ type: 'folder', name: 'a', children: [] }] }],
    ['a name that is too long', { version: 1, items: [{ type: 'folder', id: 'a', name: 'x'.repeat(101), children: [] }] }],
    ['an untrimmed name', { version: 1, items: [{ type: 'folder', id: 'a', name: ' a', children: [] }] }],
    ['a folder without children', { version: 1, items: [{ type: 'folder', id: 'a', name: 'a' }] }],
    ['the same id twice', { version: 1, items: [{ type: 'folder', id: 'a', name: 'a', children: [] }, { type: 'folder', id: 'a', name: 'b', children: [] }] }],
    ['a latitude out of range', { version: 1, items: [bookmarkJson({ center: [10, 91] })] }],
    ['a longitude out of range', { version: 1, items: [bookmarkJson({ center: [181, 10] })] }],
    ['a centre of three numbers', { version: 1, items: [bookmarkJson({ center: [10, 20, 30] })] }],
    ['a resolution of 0', { version: 1, items: [bookmarkJson({ resolution: 0 })] }],
    ['a resolution that is not a number', { version: 1, items: [bookmarkJson({ resolution: '5' })] }],
    ['an empty projection', { version: 1, items: [bookmarkJson({ mapType: { projection: '', background: null } })] }],
    ['a background that is a number', { version: 1, items: [bookmarkJson({ mapType: { projection: 'EPSG:3857', background: 7 } })] }],
    ['folders six levels deep', { version: 1, items: [nested(6)] }],
  ])('is damaged with %s', (_what, value) => {
    expect(parseDocument(value)).toEqual({ kind: 'unreadable', reason: 'damaged' });
  });

  it('is readable with folders five levels deep', () => {
    expect(parseDocument({ version: 1, items: [nested(5)] }).kind).toBe('tree');
  });
});

function bookmarkJson(over: { [key: string]: JsonValue }): JsonValue {
  return { type: 'bookmark', id: 'b', name: 'b', mapType: { projection: 'EPSG:3857', background: null }, center: [10, 20], resolution: 100, ...over };
}
function nested(levels: number): JsonValue {
  let node: JsonValue = { type: 'folder', id: `f${String(levels)}`, name: 'f', children: [] };
  for (let level = levels - 1; level >= 1; level -= 1) node = { type: 'folder', id: `f${String(level)}`, name: 'f', children: [node] };
  return node;
}

describe('adding', () => {
  it('puts new items at the end of their folder', () => {
    let t = folder(EMPTY_TREE, null, 'f');
    t = mark(t, null, 'a');
    t = mark(t, 'f', 'b');
    t = mark(t, 'f', 'c');
    t = mark(t, null, 'd');
    expect(names(t)).toEqual(['f', 'a', 'd']);
    expect(names(t, 'f')).toEqual(['b', 'c']);
  });

  it('trims the name and refuses a bad one', () => {
    const t = tree(addBookmark(EMPTY_TREE, null, { id: 'a', name: '  62°30′N 015°15′E ', view: VIEW }, MAX));
    expect(names(t)).toEqual(['62°30′N 015°15′E']);
    expect(addBookmark(EMPTY_TREE, null, { id: 'a', name: ' ', view: VIEW }, MAX)).toEqual({ ok: false, reason: 'bad-name' });
    expect(addFolder(EMPTY_TREE, null, 'a', 'x'.repeat(101), MAX)).toEqual({ ok: false, reason: 'bad-name' });
  });

  it('refuses a view that cannot be shown', () => {
    expect(addBookmark(EMPTY_TREE, null, { id: 'a', name: 'a', view: { ...VIEW, center: [15, 95] } }, MAX)).toEqual({ ok: false, reason: 'bad-view' });
    expect(addBookmark(EMPTY_TREE, null, { id: 'a', name: 'a', view: { ...VIEW, resolution: -1 } }, MAX)).toEqual({ ok: false, reason: 'bad-view' });
    expect(addBookmark(EMPTY_TREE, null, { id: 'a', name: 'a', view: { ...VIEW, center: [Number.NaN, 5] } }, MAX)).toEqual({ ok: false, reason: 'bad-view' });
  });

  it('refuses an unknown folder, a bookmark as a folder, and a used id', () => {
    const t = mark(folder(EMPTY_TREE, null, 'f'), null, 'a');
    expect(addBookmark(t, 'nope', { id: 'x', name: 'x', view: VIEW }, MAX)).toEqual({ ok: false, reason: 'not-found' });
    expect(addFolder(t, 'a', 'x', 'x', MAX)).toEqual({ ok: false, reason: 'not-a-folder' });
    expect(addFolder(t, null, 'a', 'again', MAX)).toEqual({ ok: false, reason: 'duplicate-id' });
  });

  it('allows folders five levels deep and a bookmark in the fifth, not a sixth folder (AC 5)', () => {
    let t = EMPTY_TREE;
    let parent: string | null = null;
    for (let level = 1; level <= MAX_DEPTH; level += 1) {
      t = folder(t, parent, `f${String(level)}`);
      parent = `f${String(level)}`;
    }
    expect(folderLevel(t, 'f5')).toBe(5);
    expect(addFolder(t, 'f5', 'f6', 'f6', MAX)).toEqual({ ok: false, reason: 'too-deep' });
    t = mark(t, 'f5', 'deep');
    expect(findItem(t, 'deep')?.name).toBe('deep');
  });

  it('stops at the limit, for bookmarks and folders together (AC 7)', () => {
    let t = EMPTY_TREE;
    t = folder(t, null, 'f');
    t = mark(t, 'f', 'a');
    expect(countItems(t.items)).toBe(2);
    expect(addBookmark(t, null, { id: 'x', name: 'x', view: VIEW }, 2)).toEqual({ ok: false, reason: 'limit' });
    expect(addFolder(t, null, 'y', 'y', 2)).toEqual({ ok: false, reason: 'limit' });
    expect(addBookmark(t, null, { id: 'x', name: 'x', view: VIEW }, 3).ok).toBe(true);
  });

  it('does not change the tree it was given', () => {
    const before = mark(EMPTY_TREE, null, 'a');
    const snapshot = JSON.stringify(before);
    mark(before, null, 'b');
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('renaming and deleting', () => {
  it('renames a bookmark or a folder wherever it is', () => {
    let t = folder(EMPTY_TREE, null, 'f');
    t = mark(t, 'f', 'a');
    t = tree(rename(t, 'a', ' Harbour '));
    t = tree(rename(t, 'f', 'Ports'));
    expect(names(t)).toEqual(['Ports']);
    expect(names(t, 'Ports')).toEqual(['Harbour']);
    expect(rename(t, 'a', '')).toEqual({ ok: false, reason: 'bad-name' });
    expect(rename(t, 'nope', 'x')).toEqual({ ok: false, reason: 'not-found' });
  });

  it('states what goes with a folder, and nothing for one bookmark (AC 5)', () => {
    let t = folder(EMPTY_TREE, null, 'f');
    t = folder(t, 'f', 'g');
    t = mark(t, 'f', 'a');
    t = mark(t, 'g', 'b');
    t = mark(t, 'g', 'c');
    t = folder(t, null, 'empty');
    expect(removalContents(t, 'f')).toEqual({ bookmarks: 3, folders: 1 });
    expect(removalContents(t, 'g')).toEqual({ bookmarks: 2, folders: 0 });
    expect(removalContents(t, 'empty')).toEqual({ bookmarks: 0, folders: 0 });
    expect(removalContents(t, 'a')).toEqual({ bookmarks: 0, folders: 0 });
    expect(removalContents(t, 'nope')).toBeNull();
  });

  it('deletes a folder with everything in it, and keeps the rest in order', () => {
    let t = mark(EMPTY_TREE, null, 'a');
    t = folder(t, null, 'f');
    t = mark(t, 'f', 'b');
    t = mark(t, null, 'c');
    t = tree(remove(t, 'f'));
    expect(names(t)).toEqual(['a', 'c']);
    expect(findItem(t, 'b')).toBeNull();
    t = tree(remove(t, 'a'));
    expect(names(t)).toEqual(['c']);
    expect(remove(t, 'a')).toEqual({ ok: false, reason: 'not-found' });
  });
});

describe('moving', () => {
  const base = (): Tree => {
    let t = mark(EMPTY_TREE, null, 'a');
    t = mark(t, null, 'b');
    t = mark(t, null, 'c');
    t = folder(t, null, 'f');
    t = mark(t, 'f', 'x');
    t = mark(t, 'f', 'y');
    return t;
  };

  it('puts the item at the end of the folder without an index, and the others keep their order (AC 6)', () => {
    const t = tree(move(base(), 'a', 'f'));
    expect(names(t)).toEqual(['b', 'c', 'f']);
    expect(names(t, 'f')).toEqual(['x', 'y', 'a']);
  });

  it('puts the item before the one at the index of the list without it (drag and drop, AC 6)', () => {
    const t = tree(move(base(), 'c', null, 0));
    expect(names(t)).toEqual(['c', 'a', 'b', 'f']);
    // within one list: b goes before the item at index 2 of [a, c, f], which is f
    expect(names(tree(move(base(), 'b', null, 2)))).toEqual(['a', 'c', 'b', 'f']);
    expect(names(tree(move(base(), 'a', 'f', 1)), 'f')).toEqual(['x', 'a', 'y']);
  });

  it('puts the item at the end for an index past the end, and at the start for a negative one', () => {
    expect(names(tree(move(base(), 'a', null, 99)))).toEqual(['b', 'c', 'f', 'a']);
    expect(names(tree(move(base(), 'c', null, -4)))).toEqual(['c', 'a', 'b', 'f']);
  });

  it('puts the item at the end for an index that is not a number', () => {
    expect(names(tree(move(base(), 'a', null, Number.NaN)))).toEqual(['b', 'c', 'f', 'a']);
  });

  it('moves a bookmark up to the top level', () => {
    const t = tree(move(base(), 'x', null));
    expect(names(t)).toEqual(['a', 'b', 'c', 'f', 'x']);
    expect(names(t, 'f')).toEqual(['y']);
  });

  it('moves a folder with what is in it', () => {
    let t = folder(base(), null, 'g');
    t = tree(move(t, 'f', 'g'));
    expect(names(t)).toEqual(['a', 'b', 'c', 'g']);
    expect(names(t, 'g', 'f')).toEqual(['x', 'y']);
  });

  it('refuses a folder into itself or into one of its own folders', () => {
    let t = folder(base(), 'f', 'inner');
    expect(move(t, 'f', 'f')).toEqual({ ok: false, reason: 'into-itself' });
    expect(move(t, 'f', 'inner')).toEqual({ ok: false, reason: 'into-itself' });
    t = tree(move(t, 'inner', null));
    expect(move(t, 'inner', 'f').ok).toBe(true);
  });

  it('refuses a move that would put a folder deeper than level 5, counting what is inside it', () => {
    let t = EMPTY_TREE;
    let parent: string | null = null;
    for (let level = 1; level <= 4; level += 1) {
      t = folder(t, parent, `f${String(level)}`);
      parent = `f${String(level)}`;
    }
    t = folder(t, null, 'g');
    t = folder(t, 'g', 'h'); // g is one level, with h inside: two levels in all
    // g and h under f3 (level 3): g is level 4, h is level 5: fine
    expect(move(t, 'g', 'f3').ok).toBe(true);
    // under f4 (level 4): g is level 5, h level 6: refused
    expect(move(t, 'g', 'f4')).toEqual({ ok: false, reason: 'too-deep' });
    // a bookmark may go anywhere
    t = mark(t, null, 'm');
    expect(move(t, 'm', 'f4').ok).toBe(true);
  });

  it('refuses an unknown item, an unknown folder and a bookmark as a folder', () => {
    expect(move(base(), 'nope', null)).toEqual({ ok: false, reason: 'not-found' });
    expect(move(base(), 'a', 'nope')).toEqual({ ok: false, reason: 'not-found' });
    expect(move(base(), 'a', 'b')).toEqual({ ok: false, reason: 'not-a-folder' });
  });

  it('lists where an item may go: the top level and every folder it fits in, not where it is', () => {
    let t = folder(base(), 'f', 'inner');
    t = folder(t, null, 'g');
    expect(moveTargets(t, 'a')).toEqual([
      { parentId: 'f', path: ['f'] },
      { parentId: 'inner', path: ['f', 'inner'] },
      { parentId: 'g', path: ['g'] },
    ]);
    expect(moveTargets(t, 'x')).toEqual([
      { parentId: null, path: [] },
      { parentId: 'inner', path: ['f', 'inner'] },
      { parentId: 'g', path: ['g'] },
    ]);
    // a folder may not go into itself or its own folders, nor where it is
    expect(moveTargets(t, 'f')).toEqual([{ parentId: 'g', path: ['g'] }]);
    expect(moveTargets(t, 'nope')).toEqual([]);
  });
});

describe('where an item is', () => {
  it('knows the folder that holds it and the names above a folder', () => {
    let t = folder(EMPTY_TREE, null, 'f');
    t = folder(t, 'f', 'g');
    t = mark(t, 'g', 'x');
    t = mark(t, null, 'top');
    expect(parentOf(t, 'x')).toBe('g');
    expect(parentOf(t, 'g')).toBe('f');
    expect(parentOf(t, 'f')).toBeNull();
    expect(parentOf(t, 'top')).toBeNull();
    expect(parentOf(t, 'nope')).toBeUndefined();
    expect(pathOf(t, 'g')).toEqual(['f', 'g']);
    expect(pathOf(t, 'f')).toEqual(['f']);
    expect(pathOf(t, null)).toEqual([]);
    expect(pathOf(t, 'x')).toEqual([]); // a bookmark is not a folder
    expect(pathOf(t, 'nope')).toEqual([]);
  });
});
