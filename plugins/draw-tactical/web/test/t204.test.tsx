// T-204 (M8; SDK 1.8.0 parts B, C and D, and G: the frame without a heading, its foot, closed groups): the icon, the settings hints, no inner heading that repeats the panel's
// title, the panel foot, and the Graphics catalogue as picture tiles (owner: the graphic itself, drawn small;
// one grid with the short list first and "All graphics" below it).
import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fieldHint, pluginIcon, PLUGIN_ICONS, settingsHintsProblem } from '@emc2/plugin-sdk';
import { createFakeSymbolService } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import { chooseGraphic, editGraphic, openBrowser, settle, showGraphicsPanel, toolButtons } from './harness.tsx';
import { FakeServer, graphicObject, layer } from './fakeServer.ts';

function setup() {
  const ops = layer('Operations', 1);
  const server = new FakeServer([ops], ['core.general']);
  const symbols = createFakeSymbolService();
  return { server, ops, symbols };
}

describe('T-204: the manifest', () => {
  it('names SDK 1.8.0 and the icon Swords, a name the shell knows', () => {
    expect(manifest.sdkVersion).toBe('^1.8.0');
    expect(manifest.icon).toBe('Swords');
    expect(Object.hasOwn(PLUGIN_ICONS, manifest.icon)).toBe(true);
    expect(pluginIcon(manifest.icon)).not.toBeNull();
  });

  it('has settings hints the SDK finds nothing wrong with, short ones, one per setting', () => {
    expect(settingsHintsProblem(manifest.settings)).toBeNull();
    for (const [name, field] of Object.entries(manifest.settings.properties)) {
      const hint = (field as { readonly 'x-emc2'?: { readonly hint?: string } })['x-emc2']?.hint;
      expect(hint, name).toBeDefined();
      expect((hint ?? '').length, name).toBeLessThanOrEqual(80);
      expect(fieldHint(field as never), name).toEqual({ hint, more: (field as { readonly description: string }).description }); // the description sits behind the info button
    }
  });

  it('gives every panel an icon', async () => {
    const { server, ops, symbols } = setup();
    const shown = server.seed(graphicObject(ops.id));
    const browser = await openBrowser(server, { symbols });
    await editGraphic(browser, shown.id);
    expect(browser.ctx.addedPanels.map((p) => [p.panel.id, p.panel.icon !== undefined])).toEqual([
      ['draw-tactical', true],
      ['draw-tactical-edit', true],
    ]);
  });
});

describe('T-204: name once, and the actions where they act', () => {
  it('the Graphics panel has no heading that repeats its title; its Place button is in the foot, full width after the body (SDK 1.8.0 part G)', async () => {
    const { server, symbols } = setup();
    const browser = await openBrowser(server, { symbols });
    const panel = await showGraphicsPanel(browser);
    expect(within(panel.container).queryByRole('heading', { name: 'Graphics' })).toBeNull();
    const frame = panel.container.querySelector('section.emc2-panel');
    expect(frame?.getAttribute('aria-label')).toBe('Graphics'); // the title is still the panel's accessible name
    const foot = frame?.lastElementChild as HTMLElement;
    expect(foot.classList.contains('emc2-panel-foot')).toBe(true); // after the scrolling body, not inside it
    expect(frame?.querySelector('.emc2-panel-body')?.contains(foot)).toBe(false);
    expect(within(foot).getByRole('button', { name: 'Place graphic' })).toBeTruthy();
    expect(toolButtons()).toHaveLength(2); // T-190: the top one stays
  });

  it('the Edit panel has no heading that repeats its title; Close is in the action bar of the frame, and an empty panel has no bar', async () => {
    const { server, ops, symbols } = setup();
    const shown = server.seed(graphicObject(ops.id));
    const browser = await openBrowser(server, { symbols });
    const panel = await editGraphic(browser, shown.id);
    expect(within(panel.container).queryByRole('heading', { name: 'Edit graphic' })).toBeNull();
    expect(panel.container.querySelector('section.emc2-panel')?.getAttribute('aria-label')).toBe('Edit graphic');
    const actions = panel.container.querySelector('.emc2-panel-actions') as HTMLElement;
    expect(within(actions).getByRole('button', { name: 'Close' })).toBeTruthy();
    fireEvent.click(within(actions).getByRole('button', { name: 'Close' }));
    await settle();
    expect(panel.container.querySelector('.emc2-panel-head')).toBeNull(); // no editor: no heading and no actions, so no bar
    expect(within(panel.container).getByText('Select one tactical graphic on the map and choose Edit.')).toBeTruthy();
  });
});

describe('T-204: the Graphics tiles', () => {
  it('are one grid with one Tab stop, and the arrow keys move the focus', async () => {
    const { server, symbols } = setup();
    const browser = await openBrowser(server, { symbols });
    await showGraphicsPanel(browser);
    const common = screen.getByRole('group', { name: 'Graphics' });
    const tiles = within(common).getAllByRole('option');
    expect(tiles.map((t) => t.tabIndex)).toEqual([0, -1, -1, -1]);
    (tiles[0] as HTMLElement).focus();
    fireEvent.keyDown(tiles[0] as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tiles[1]);
    fireEvent.keyDown(tiles[1] as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(tiles.at(-1));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });
    await settle();
    expect(screen.getByRole('heading', { name: 'Weapon/Sensor Range fan, Sector' })).toBeTruthy();
    expect(within(screen.getByRole('group', { name: 'Graphics' })).getAllByRole('option').map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false', 'true']);
  });

  it('show the graphic itself, drawn by the symbology service once; one that needs amplifiers shows its kind\'s icon', async () => {
    const { server, symbols } = setup();
    const browser = await openBrowser(server, { symbols });
    await showGraphicsPanel(browser);
    const hasPicture = (name: string): boolean => screen.getByRole('option', { name }).querySelector('svg.draw-tactical-thumb-picture') !== null;
    // The fake service draws one black line through the points: the tile has its path.
    expect(screen.getByRole('option', { name: 'Boundary' }).querySelector('svg.draw-tactical-thumb-picture path')?.getAttribute('stroke')).toBe('#000000');
    expect(hasPicture('Main Attack')).toBe(true);
    // The sector range fan needs distances and azimuths: no drawing is asked for, the tile keeps the icon.
    expect(hasPicture('Weapon/Sensor Range fan, Sector')).toBe(false);
    expect(symbols.renderGraphicCalls).toBe(3);
    expect(hasPicture('Phase Line')).toBe(true);
    // Choosing a graphic and a render of the panel again ask for nothing more.
    await chooseGraphic('Boundary');
    expect(symbols.renderGraphicCalls).toBe(3);
  });

  it('keep the kind\'s icon when the service does not draw the graphic', async () => {
    const { server, symbols } = setup();
    symbols.refuse('no picture today');
    const browser = await openBrowser(server, { symbols });
    await showGraphicsPanel(browser);
    expect(screen.getByRole('option', { name: 'Boundary' }).querySelector('svg.draw-tactical-thumb-picture')).toBeNull();
    expect(screen.getByRole('option', { name: 'Boundary' }).querySelector('svg.emc2-icon')).not.toBeNull();
  });
  it('are one grid: opening "All graphics" adds its folders to it, closed, and the keys go through the tiles that are shown', async () => {
    const { server, symbols } = setup();
    const browser = await openBrowser(server, { symbols });
    await showGraphicsPanel(browser);
    fireEvent.click(screen.getByRole('button', { name: 'All graphics (4)' }));
    await settle();
    expect(screen.getAllByRole('group', { name: 'Graphics' })).toHaveLength(1);
    // SDK 1.8.0 part G: the folders join the grid closed; no tile of theirs is drawn or asked for yet.
    expect(within(screen.getByRole('group', { name: 'Graphics' })).getAllByRole('option')).toHaveLength(4);
    for (const folder of ['Command and Control Lines (1)', 'Maneuver Lines (1)', 'Maneuver Areas (1)', 'Fires Areas (1)'])
      expect(screen.getByRole('button', { name: folder }).getAttribute('aria-expanded')).toBe('false');
    expect(symbols.renderGraphicCalls).toBe(3);
    // The user opens one folder; its tile joins the keys, and it stays open and one Tab stop over all.
    fireEvent.click(screen.getByRole('button', { name: 'Fires Areas (1)' }));
    await settle();
    const tiles = within(screen.getByRole('group', { name: 'Graphics' })).getAllByRole('option');
    expect(tiles).toHaveLength(5);
    expect(tiles.filter((t) => t.tabIndex === 0)).toHaveLength(1);
    (tiles[0] as HTMLElement).focus();
    fireEvent.keyDown(tiles[0] as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(tiles.at(-1));
    // Closing "All graphics" and opening it again keeps what the user did to the folder.
    fireEvent.click(screen.getByRole('button', { name: 'All graphics (4)' }));
    fireEvent.click(screen.getByRole('button', { name: 'All graphics (4)' }));
    expect(screen.getByRole('button', { name: 'Fires Areas (1)' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('open the folders by themselves while a search is on, and a search leaves what the user opened before it alone', async () => {
    const { server, symbols } = setup();
    const browser = await openBrowser(server, { symbols });
    await showGraphicsPanel(browser);
    fireEvent.click(screen.getByRole('button', { name: 'All graphics (4)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Maneuver Lines (1)' })); // the user opens it before the search
    fireEvent.change(screen.getByLabelText('Find a graphic'), { target: { value: 'phase' } });
    await settle();
    expect(screen.getByRole('button', { name: 'Maneuver Lines (1)' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('option', { name: 'Phase Line' })).toHaveLength(2); // its short-list tile and its folder's
    fireEvent.change(screen.getByLabelText('Find a graphic'), { target: { value: '' } });
    await settle();
    expect(screen.getByRole('button', { name: 'Maneuver Lines (1)' }).getAttribute('aria-expanded')).toBe('true'); // as the user left it
  });

  it('are drawn only when near the screen: with an observer that sees none, the service is not asked', async () => {
    const seen: IntersectionObserverCallback[] = [];
    const original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds = [];
      constructor(callback: IntersectionObserverCallback) {
        seen.push(callback);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    } as unknown as typeof IntersectionObserver;
    try {
      const { server, symbols } = setup();
      const browser = await openBrowser(server, { symbols });
      await showGraphicsPanel(browser);
      expect(seen.length).toBeGreaterThan(0); // one observer per tile
      expect(symbols.renderGraphicCalls).toBe(0);
      expect(screen.getByRole('option', { name: 'Boundary' }).querySelector('svg.draw-tactical-thumb-picture')).toBeNull();
      // The first tile scrolls into view: it, and only it, is drawn.
      act(() => {
        seen[0]?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      });
      await settle();
      expect(symbols.renderGraphicCalls).toBe(1);
      expect(screen.getByRole('option', { name: 'Boundary' }).querySelector('svg.draw-tactical-thumb-picture')).not.toBeNull();
    } finally {
      globalThis.IntersectionObserver = original;
    }
  });

  it('ask again after an error, but not again for a graphic the service refused', async () => {
    const { server, symbols } = setup();
    let failing = true;
    const flaky = { ...symbols, renderGraphic: (request: Parameters<typeof symbols.renderGraphic>[0]) => (failing ? Promise.reject(new Error('not ready')) : symbols.renderGraphic(request)) };
    const browser = await openBrowser(server, { symbols: flaky });
    await showGraphicsPanel(browser);
    expect(screen.getByRole('option', { name: 'Boundary' }).querySelector('svg.draw-tactical-thumb-picture')).toBeNull();
    failing = false;
    // a new panel (another browser pane) asks again, and the picture is there
    const second = await showGraphicsPanel(browser);
    expect(within(second.container).getByRole('option', { name: 'Boundary' }).querySelector('svg.draw-tactical-thumb-picture')).not.toBeNull();
  });
});
