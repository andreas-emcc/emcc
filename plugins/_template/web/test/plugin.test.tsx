import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JsonValue } from '@emc2/plugin-sdk';
import { createFakeContext } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };
import plugin from '../src/index.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The settings as the shell passes them when nothing is configured: the default of every setting. */
function settingDefaults(): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(manifest.settings.properties).map(([name, schema]) => [name, schema.default]));
}

async function activated() {
  const ctx = createFakeContext({ pluginId: manifest.id, settings: settingDefaults() });
  await plugin.activate(ctx);
  return ctx;
}

describe('template web part', () => {
  it('is named after the plugin id', () => {
    // npm refuses two workspaces with the same name, so a copy must rename the package.
    expect(pkg.name).toBe(`@emc2/plugin-${manifest.id}`);
  });

  it('lists the CSS file the build writes (<id>.css)', () => {
    expect(manifest.web.css).toEqual([`${manifest.id}.css`]);
  });

  it('adds its panel and reports OK', async () => {
    const ctx = await activated();
    expect(ctx.addedPanels.map((p) => [p.panel.id, p.panel.defaultPane])).toEqual([['template', 'right']]);
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
  });

  it('gives its panel an icon and does not repeat its title (SDK 1.8.0: name once, icon always)', async () => {
    const ctx = await activated();
    const panel = ctx.addedPanels[0]?.panel;
    if (!panel) throw new Error('no panel');
    expect(panel.icon).toBeDefined();
    render(<panel.component />);
    expect(screen.queryByRole('heading', { name: panel.title })).toBeNull();
    expect(screen.getByRole('region', { name: panel.title })).toBeDefined();
  });

  it('shows the greeting from the settings', async () => {
    const ctx = await activated();
    const Panel = ctx.addedPanels[0]?.panel.component;
    if (!Panel) throw new Error('no panel');
    render(<Panel />);
    expect(screen.getByText(manifest.settings.properties.greeting.default)).toBeDefined();
  });

  it('asks its own server part', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('Hello from the server', { status: 200 })));
    vi.stubGlobal('fetch', fetch);
    const ctx = await activated();
    const Panel = ctx.addedPanels[0]?.panel.component;
    if (!Panel) throw new Error('no panel');
    render(<Panel />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask the server' }));
    expect((await screen.findByRole('status')).textContent).toBe('Hello from the server');
    expect(fetch).toHaveBeenCalledWith(`${ctx.serverBase}greeting`);
  });
});
