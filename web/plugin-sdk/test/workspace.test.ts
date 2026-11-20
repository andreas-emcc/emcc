import { describe, expect, it } from 'vitest';
import { Layers } from 'lucide-react';
import type { Panel } from '../src/index.ts';
import { jsonBytes, MAX_SETUP_SHARE_BYTES } from '../src/index.ts';
import { createFakeContext } from '../src/testing/index.ts';

const Empty = () => null;

describe('SDK 1.1.0 workspace (ADR-0031, CR-0015 items 1 to 4)', () => {
  it('adds a panel with a default pane, shows it and removes it', () => {
    const ctx = createFakeContext({ pluginId: 'object-list' });
    const panel: Panel = { id: 'objects', title: 'Objects', icon: Layers, defaultPane: 'bottom', component: Empty };
    const handle = ctx.ui.addPanel(panel);
    expect(ctx.addedPanels).toEqual([{ panel, shown: 0 }]);
    handle.show();
    handle.show();
    expect(ctx.addedPanels[0]?.shown).toBe(2);
    handle.remove();
    expect(ctx.addedPanels).toEqual([]);
  });

  it('refuses a second panel with the same id, also next to a control panel', () => {
    const ctx = createFakeContext({ pluginId: 'draw-symbols' });
    ctx.ui.addControlPanel({ id: 'symbols', title: 'Symbols', component: Empty });
    expect(() => ctx.ui.addPanel({ id: 'symbols', title: 'Symbols', defaultPane: 'right', component: Empty })).toThrow(/already has a panel/);
  });

  it('adds and removes a top bar item', () => {
    const ctx = createFakeContext({ pluginId: 'bookmarks' });
    const off = ctx.ui.addTopBarItem({ id: 'bookmarks', order: 10, component: Empty });
    expect(ctx.topBarItems.map((i) => i.id)).toEqual(['bookmarks']);
    off();
    expect(ctx.topBarItems).toEqual([]);
  });

  it('saves and restores a setup share, and counts changes', () => {
    const ctx = createFakeContext({ pluginId: 'map-view-2d' });
    let dim = 0.3;
    ctx.setup.register({
      save: () => ({ dim, projection: 'EPSG:3413' }),
      restore: (share) => {
        const value = typeof share === 'object' && share !== null ? (share as { readonly dim?: unknown }).dim : undefined;
        if (typeof value === 'number') dim = value;
      },
    });
    dim = 0.5;
    ctx.setup.changed();
    expect(ctx.setupChanges).toBe(1);
    expect(ctx.saveSetup()).toEqual({ dim: 0.5, projection: 'EPSG:3413' });
    ctx.restoreSetup({ dim: 0.8 });
    expect(dim).toBe(0.8);
    ctx.restoreSetup('not a share');
    expect(dim).toBe(0.8);
  });

  it('refuses a share larger than 64 KiB, measured as UTF-8 JSON', () => {
    const ctx = createFakeContext();
    ctx.setup.register({ save: () => 'å'.repeat(MAX_SETUP_SHARE_BYTES / 2), restore: () => undefined });
    expect(jsonBytes('å')).toBe(4);
    expect(() => ctx.saveSetup()).toThrow(/more than 65536/);
  });

  it('a second registration replaces the first; unsubscribing the replaced one changes nothing', () => {
    const ctx = createFakeContext();
    const first = ctx.setup.register({ save: () => 1, restore: () => undefined });
    ctx.setup.register({ save: () => 2, restore: () => undefined });
    first();
    expect(ctx.saveSetup()).toBe(2);
  });
});
