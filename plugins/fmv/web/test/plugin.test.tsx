import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeContext } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };
import plugin from '../src/index.tsx';

afterEach(cleanup);

async function activated() {
  const ctx = createFakeContext({ pluginId: manifest.id, settings: {} });
  await plugin.activate(ctx);
  return ctx;
}

describe('fmv web part', () => {
  it('is named after the plugin id', () => {
    expect(pkg.name).toBe(`@emc2/plugin-${manifest.id}`);
  });

  it('lists the CSS file the build writes (<id>.css)', () => {
    expect(manifest.web.css).toEqual([`${manifest.id}.css`]);
  });

  it('adds its control panel to View and reports OK', async () => {
    const ctx = await activated();
    expect(ctx.panels.map((p) => [p.id, p.workspaces])).toEqual([['fmv', ['core.view']]]);
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
  });

  it('adds the windows beside the panel, in the map pane, for every workspace', async () => {
    const ctx = await activated();
    expect(ctx.overlays.map((o) => [o.id, o.workspaces])).toEqual([['fmv-windows', ['*']]]);
  });
});
