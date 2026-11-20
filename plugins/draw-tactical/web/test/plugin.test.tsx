import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MAP_VIEW, SYMBOLS } from '@emc2/plugin-sdk';
import { createFakeContext, createFakeMapView, createFakeSymbolService } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };
import plugin from '../src/index.tsx';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { settingDefaults, settle } from './harness.tsx';

afterEach(cleanup);

async function activated(settings: Record<string, unknown> = settingDefaults()) {
  const ctx = createFakeContext({ pluginId: manifest.id, settings: settings as never });
  const map = createFakeMapView();
  ctx.provideAs(MAP_VIEW, map);
  ctx.provideAs(SYMBOLS, createFakeSymbolService());
  await plugin.activate(ctx);
  return { ctx, map };
}

describe('draw-tactical web part', () => {
  it('is named after the plugin id', () => {
    // npm refuses two workspaces with the same name, so a copy must rename the package.
    expect(pkg.name).toBe(`@emc2/plugin-${manifest.id}`);
  });

  it('lists the CSS file the build writes (<id>.css)', () => {
    expect(manifest.web.css).toEqual([`${manifest.id}.css`]);
  });

  it('is a web-only plugin that requires the map view and the symbology service, needs objects.edit and no internet', () => {
    expect(manifest.id).toBe('draw-tactical');
    expect(manifest.sdkVersion).toBe('^1.8.0');
    expect(manifest.requires).toEqual(['emc2.map-view', 'emc2.symbols']);
    expect(manifest.permissions).toEqual(['objects.edit']);
    expect(manifest.kind).toBe('general');
    expect('server' in manifest).toBe(false);
    expect('internet' in manifest).toBe(false); // no internet access (brief)
    expect('provides' in manifest).toBe(false);
  });

  it('declares the settings of the brief with their defaults, and the code reads the same defaults', () => {
    expect(settingDefaults()).toEqual({ standard: 'APP-6D', standardIdentity: 'Friend' });
    expect(DEFAULT_SETTINGS).toMatchObject({ standard: 'APP-6D', identityName: 'Friend', standardIdentity: '3' });
  });

  it('adds its Graphics panel with the left pane as default, and the Edit action, and reports OK', async () => {
    const { ctx } = await activated();
    expect(ctx.addedPanels.map((p) => [p.panel.id, p.panel.title, p.panel.defaultPane])).toEqual([['draw-tactical', 'Graphics', 'left']]);
    expect(ctx.objectActions.map((a) => a.id)).toEqual(['edit']);
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
  });

  it('subscribes to the layers only, never by the viewport and never to the whole picture', async () => {
    const { ctx } = await activated();
    expect(ctx.liveSubscriptions).toEqual([{ objects: false }]);
  });

  it('does not ask the symbology service for the catalogue before the panel is shown (the renderer loads only for someone who looks)', async () => {
    const ctx = createFakeContext({ pluginId: manifest.id, settings: settingDefaults() });
    ctx.provideAs(MAP_VIEW, createFakeMapView());
    let asked = 0;
    const symbols = createFakeSymbolService();
    ctx.provideAs(SYMBOLS, {
      ...symbols,
      graphicCatalog: (standard) => {
        asked++;
        return symbols.graphicCatalog(standard);
      },
    });
    await plugin.activate(ctx);
    await settle();
    expect(asked).toBe(0);
    const Panel = ctx.addedPanels[0]?.panel.component;
    if (!Panel) throw new Error('no panel');
    render(<Panel />);
    await settle();
    expect(asked).toBe(1);
  });

  it('renders the Graphics panel with the short list', async () => {
    const { ctx } = await activated();
    const Panel = ctx.addedPanels[0]?.panel.component;
    if (!Panel) throw new Error('no panel');
    render(<Panel />);
    await settle();
    expect(screen.getByRole('group', { name: 'Graphics' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'All graphics (4)' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'Boundary' })).toBeDefined();
  });

  it('reports a bad setting as DEGRADED and works with the default', async () => {
    const { ctx } = await activated({ ...settingDefaults(), standard: 'APP-6B' });
    expect(ctx.statusHistory.at(-1)?.state).toBe('DEGRADED');
    expect(ctx.statusHistory.at(-1)?.detail).toContain('standard');
  });

  it('waits for the services it requires: the manifest orders them first', async () => {
    const ctx = createFakeContext({ pluginId: manifest.id, settings: settingDefaults() });
    let done = false;
    const activating = Promise.resolve(plugin.activate(ctx)).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    ctx.provideAs(MAP_VIEW, createFakeMapView());
    ctx.provideAs(SYMBOLS, createFakeSymbolService());
    await activating;
    expect(done).toBe(true);
  });
});
