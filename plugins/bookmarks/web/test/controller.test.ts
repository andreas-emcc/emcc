import { describe, expect, it } from 'vitest';
import type { Notification } from '@emc2/plugin-sdk';
import { createFakeContext, createFakeMapView } from '@emc2/plugin-sdk/testing';
import { BookmarksController } from '../src/controller.ts';
import { BookmarkStore } from '../src/store.ts';
import { DOCUMENT_NAME, parseDocument, serialize, type TreeItem } from '../src/tree.ts';

describe('going to a bookmark that is not in the tree', () => {
  it('says that it is gone, and leaves the map where it is', () => {
    const ctx = createFakeContext({ pluginId: 'bookmarks' });
    const map = createFakeMapView();
    const notifications: Notification[] = [];
    const controller = new BookmarksController({
      store: new BookmarkStore(ctx.userDocuments),
      newId: () => ctx.newId(),
      notify: (n) => notifications.push(n),
      logError: () => undefined,
      maxItems: 1000,
    });
    controller.setMap(map);
    controller.goTo('removed-in-another-browser');
    expect(notifications).toEqual([{ severity: 'warning', message: 'That bookmark is gone; it was probably removed in another browser.' }]);
    expect(map.goToCalls).toEqual([]);
  });
});

describe('moving to a position (what drag and drop will call, CR-0019)', () => {
  const mark = (id: string): TreeItem => ({ type: 'bookmark', id, name: id.toUpperCase(), mapType: { projection: 'EPSG:3857', background: null }, center: [15.25, 62.5], resolution: 100 });

  it('puts the item before the one at the index of the list without it, and the others keep their order', async () => {
    const ctx = createFakeContext({ pluginId: 'bookmarks' });
    const folder: TreeItem = { type: 'folder', id: 'f', name: 'F', children: [mark('x'), mark('y')] };
    await ctx.userDocuments.put(DOCUMENT_NAME, serialize({ items: [mark('a'), mark('b'), mark('c'), folder] }));
    const controller = new BookmarksController({
      store: new BookmarkStore(ctx.userDocuments),
      newId: () => ctx.newId(),
      notify: () => undefined,
      logError: () => undefined,
      maxItems: 1000,
    });
    await controller.opened();
    expect((await controller.moveTo('c', null, 0)).saved).toBe(true);
    expect((await controller.moveTo('a', 'f', 1)).saved).toBe(true);
    const parsed = parseDocument(ctx.storedUserDocuments[DOCUMENT_NAME] ?? null);
    if (parsed.kind !== 'tree') throw new Error('no tree');
    expect(parsed.tree.items.map((i) => i.id)).toEqual(['c', 'b', 'f']);
    const inner = parsed.tree.items[2];
    expect(inner?.type === 'folder' && inner.children.map((i) => i.id)).toEqual(['x', 'a', 'y']);
  });
});
