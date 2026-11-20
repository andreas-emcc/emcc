import { afterEach, describe, expect, it, vi } from 'vitest';
import { USER_DOCUMENT_LIMITS, UserDocumentError } from '@emc2/plugin-sdk';
import { createFakeContext } from '@emc2/plugin-sdk/testing';
import { BookmarkStore, documentBytes } from '../src/store.ts';
import { DOCUMENT_NAME, EMPTY_TREE, addBookmark, addFolder, serialize, type BookmarkView, type Bookmark, type Tree } from '../src/tree.ts';
import { watchReads } from './support.tsx';

afterEach(() => {
  vi.restoreAllMocks();
});

const VIEW: BookmarkView = { mapType: { projection: 'EPSG:3857', background: 'osm' }, center: [15.25, 62.5], resolution: 611.5 };
const add = (id: string, name = id, parent: string | null = null) => (tree: Parameters<typeof addBookmark>[0]) => addBookmark(tree, parent, { id, name, view: VIEW }, 1000);

function setup() {
  const ctx = createFakeContext({ pluginId: 'bookmarks' });
  return { ctx, store: new BookmarkStore(ctx.userDocuments) };
}

describe('the stored tree', () => {
  it('is empty before the first write, and not written by reading', async () => {
    const { ctx, store } = setup();
    expect(await store.load()).toEqual({ status: 'ok', tree: EMPTY_TREE });
    expect(ctx.storedUserDocuments).toEqual({});
  });

  it('is saved as the document "tree" and read back', async () => {
    const { ctx, store } = setup();
    const saved = await store.update(add('a', 'Home'));
    expect(saved.status).toBe('saved');
    expect(Object.keys(ctx.storedUserDocuments)).toEqual([DOCUMENT_NAME]);
    const loaded = await store.load();
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.tree.items.map((i) => i.name)).toEqual(['Home']);
  });

  it('is seen by a second browser of the same user (AC 4, the same documents)', async () => {
    const { ctx, store } = setup();
    await store.update(add('a'));
    const second = new BookmarkStore(ctx.userDocuments);
    const loaded = await second.load();
    expect(loaded.status === 'ok' && loaded.tree.items.length).toBe(1);
  });

  it('is read again before every change, so a bookmark added elsewhere is not lost', async () => {
    const { ctx, store } = setup();
    const other = new BookmarkStore(ctx.userDocuments);
    await store.load(); // this browser has seen the empty tree
    await other.update(add('b')); // another browser adds one
    await store.update(add('a')); // this one adds another, from what it read just now
    const loaded = await store.load();
    expect(loaded.status === 'ok' && loaded.tree.items.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('runs changes of one browser one after the other, so two quick actions both stay', async () => {
    const { store } = setup();
    const results = await Promise.all([store.update(add('a')), store.update(add('b')), store.update((tree) => addFolder(tree, null, 'f', 'Folder', 1000))]);
    expect(results.map((r) => r.status)).toEqual(['saved', 'saved', 'saved']);
    const loaded = await store.load();
    expect(loaded.status === 'ok' && loaded.tree.items.map((i) => i.id)).toEqual(['a', 'b', 'f']);
  });

  it('goes on with the next change after one that threw', async () => {
    const { store } = setup();
    const broken = store.update(() => {
      throw new Error('a bug in a change');
    });
    const next = store.update(add('b'));
    await expect(broken).rejects.toThrow('a bug in a change');
    expect((await next).status).toBe('saved');
  });

  it('writes nothing for a change that is refused', async () => {
    const { ctx, store } = setup();
    await store.update(add('a'));
    const before = ctx.storedUserDocuments;
    const result = await store.update((tree) => addFolder(tree, null, 'f', ' ', 1000));
    expect(result).toEqual({ status: 'refused', reason: 'bad-name' });
    expect(ctx.storedUserDocuments).toEqual(before);
  });

  it('writes nothing for a change that would take the document over ECore\'s limit (AC 7)', async () => {
    const { ctx, store } = setup();
    // a bookmark with a long name takes over 200 bytes, so the size binds before the count of 1 000 can: fill the document up to a few bytes below ECore's limit
    const bookmark = (i: number): Bookmark => ({ type: 'bookmark', id: `id-${String(i).padStart(5, '0')}`, name: 'n'.repeat(100), ...VIEW });
    const perItem = documentBytes({ items: [bookmark(1), bookmark(2)] }) - documentBytes({ items: [bookmark(1)] });
    const count = Math.floor((USER_DOCUMENT_LIMITS.maxBytes - 400 - documentBytes(EMPTY_TREE)) / perItem);
    const tree: Tree = { items: Array.from({ length: count }, (_, i) => bookmark(i)) };
    await ctx.userDocuments.put(DOCUMENT_NAME, serialize(tree));
    const before = ctx.storedUserDocuments;
    const result = await store.update((t) => addBookmark(t, null, { id: 'one-more-' + 'y'.repeat(300), name: 'n'.repeat(100), view: VIEW }, 100_000));
    expect(result).toEqual({ status: 'failed', problem: 'too-large' });
    expect(ctx.storedUserDocuments).toEqual(before);
  });

  it('reports a lost connection, for reading and for writing', async () => {
    const { ctx, store } = setup();
    await store.update(add('a'));
    ctx.failUserDocuments(true);
    expect(await store.load()).toEqual({ status: 'unavailable' });
    expect(await store.update(add('b'))).toEqual({ status: 'failed', problem: 'unavailable' });
    ctx.failUserDocuments(false);
    const loaded = await store.load();
    expect(loaded.status === 'ok' && loaded.tree.items.length).toBe(1);
  });
});

describe('a user without bookmarks makes no request that fails', () => {
  it('when the tree is read', async () => {
    const { ctx, store } = setup();
    const failing = watchReads(ctx);
    expect(await store.load()).toEqual({ status: 'ok', tree: EMPTY_TREE });
    expect(failing).toEqual([]);
  });

  it('when the first item is added, and not afterwards either', async () => {
    const { ctx, store } = setup();
    const failing = watchReads(ctx);
    expect((await store.update(add('a'))).status).toBe('saved');
    expect((await store.update(add('b'))).status).toBe('saved');
    expect(failing).toEqual([]);
  });

  it('but reads the document once there is one (the list says so)', async () => {
    const { ctx, store } = setup();
    await store.update(add('a', 'Home'));
    const get = vi.spyOn(ctx.userDocuments, 'get');
    const loaded = await store.load();
    expect(get).toHaveBeenCalledWith(DOCUMENT_NAME);
    expect(loaded.status === 'ok' && loaded.tree.items.map((i) => i.name)).toEqual(['Home']);
  });

  it('and a document deleted between the list and the read is an empty tree (the real read answers null for it)', async () => {
    const { ctx, store } = setup();
    await store.update(add('a'));
    vi.spyOn(ctx.userDocuments, 'get').mockResolvedValue(null);
    expect(await store.load()).toEqual({ status: 'ok', tree: EMPTY_TREE });
  });

  it('and a failure of the read after a list that worked is "unavailable", not an error', async () => {
    const { ctx, store } = setup();
    await store.update(add('a'));
    vi.spyOn(ctx.userDocuments, 'get').mockRejectedValue(new UserDocumentError('unavailable', 'no answer'));
    expect(await store.load()).toEqual({ status: 'unavailable' });
    expect(await store.update(add('b'))).toEqual({ status: 'failed', problem: 'unavailable' });
  });

  it('when startEmpty is the first write (it does not read at all; this guards a later change)', async () => {
    const { ctx, store } = setup();
    const failing = watchReads(ctx);
    expect((await store.startEmpty()).status).toBe('saved');
    expect(failing).toEqual([]);
  });
});

describe('a document that cannot be read (AC 8)', () => {
  it.each([
    ['damaged', { version: 1, items: 'not a list' }],
    ['newer', { version: 2, items: [] }],
  ] as const)('(%s) is reported and not overwritten by a change', async (reason, document) => {
    const { ctx, store } = setup();
    await ctx.userDocuments.put(DOCUMENT_NAME, document);
    expect(await store.load()).toEqual({ status: 'unreadable', reason });
    expect(await store.update(add('a'))).toEqual({ status: 'unreadable', reason });
    expect(ctx.storedUserDocuments).toEqual({ [DOCUMENT_NAME]: document });
  });

  it('is replaced by an empty tree only by startEmpty, which a confirmation calls', async () => {
    const { ctx, store } = setup();
    await ctx.userDocuments.put(DOCUMENT_NAME, { version: 99, items: [] });
    expect((await store.startEmpty()).status).toBe('saved');
    expect(await store.load()).toEqual({ status: 'ok', tree: EMPTY_TREE });
    expect((await store.update(add('a'))).status).toBe('saved');
  });
});

describe('what the plugin stores (AC 12)', () => {
  it('is only the document "tree" in its own namespace, and nothing in browser storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { ctx, store } = setup();
    await store.update(add('a'));
    await store.update((tree) => addFolder(tree, null, 'f', 'Folder', 1000));
    expect(Object.keys(ctx.storedUserDocuments)).toEqual([DOCUMENT_NAME]);
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
