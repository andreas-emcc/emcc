import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MAP_VIEW } from '@emc2/plugin-sdk';
import { createFakeContext, createFakeMapView } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };
import plugin from '../src/index.tsx';
import { settingDefaults } from './harness.tsx';

afterEach(cleanup);

async function activated() {
  const ctx = createFakeContext({ pluginId: manifest.id, settings: settingDefaults() });
  const map = createFakeMapView();
  ctx.provideAs(MAP_VIEW, map);
  await plugin.activate(ctx);
  return { ctx, map };
}

describe('draw-shapes web part', () => {
  it('is named after the plugin id', () => {
    // npm refuses two workspaces with the same name, so a copy must rename the package.
    expect(pkg.name).toBe(`@emc2/plugin-${manifest.id}`);
  });

  it('lists the CSS file the build writes (<id>.css)', () => {
    expect(manifest.web.css).toEqual([`${manifest.id}.css`]);
  });

  it('is a web-only plugin that requires the map view and the objects.edit permission', () => {
    expect(manifest.id).toBe('draw-shapes');
    expect(manifest.sdkVersion).toBe('^1.8.0');
    expect(manifest.requires).toEqual(['emc2.map-view']);
    expect(manifest.permissions).toEqual(['objects.edit']);
    expect('server' in manifest).toBe(false);
    expect('internet' in manifest).toBe(false); // no internet access (brief)
  });

  it('declares a default for every setting of the brief', () => {
    expect(settingDefaults()).toEqual({
      dataType: 'core.general',
      outlineColor: '#1f3a93',
      outlineWidth: 2,
      outlineDash: 'solid',
      fill: 'none',
      fillColor: '#1f3a93',
      fillOpacity: 0.2,
    });
  });

  it('adds its Shapes panel with the right pane as default, and the Edit action, and reports OK', async () => {
    const { ctx } = await activated();
    expect(ctx.addedPanels.map((p) => [p.panel.id, p.panel.title, p.panel.defaultPane])).toEqual([['draw-shapes', 'Shapes', 'left']]);
    expect(ctx.objectActions.map((a) => a.id)).toEqual(['edit']);
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
  });

  it('subscribes to the layers only, never by the viewport and never to the whole picture (criterion 18)', async () => {
    const { ctx } = await activated();
    expect(ctx.liveSubscriptions).toEqual([{ objects: false }]);
  });

  it('renders the Shapes panel with a tool for each kind', async () => {
    const { ctx } = await activated();
    const Panel = ctx.addedPanels[0]?.panel.component;
    if (!Panel) throw new Error('no panel');
    render(<Panel />);
    for (const name of ['Circle', 'Ellipse', 'Square', 'Rectangle', 'Area', 'Arrow', 'Route']) {
      expect(screen.getByRole('button', { name })).toBeDefined();
    }
  });

  it('reports a bad setting as DEGRADED and works with the default', async () => {
    const ctx = createFakeContext({ pluginId: manifest.id, settings: { ...settingDefaults(), outlineWidth: 500 } });
    ctx.provideAs(MAP_VIEW, createFakeMapView());
    await plugin.activate(ctx);
    expect(ctx.statusHistory.at(-1)?.state).toBe('DEGRADED');
    expect(ctx.statusHistory.at(-1)?.detail).toContain('outlineWidth');
  });

  it('does not get the map view before it is provided: the manifest requires it', async () => {
    // The shell activates the plugin after the provider; the plugin waits for the service as every plugin does.
    const ctx = createFakeContext({ pluginId: manifest.id, settings: settingDefaults() });
    let done = false;
    const activating = Promise.resolve(plugin.activate(ctx)).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    ctx.provideAs(MAP_VIEW, createFakeMapView());
    await activating;
    expect(done).toBe(true);
  });
});
