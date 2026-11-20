// T-204 (SDK 1.8.0 part C: name once, icon always): the panels show no inner heading that repeats the shell's title, and "Place on map",
// which applies to the whole Symbols panel, is the panel foot, the last element of the body.
import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeServer, layer, symbolObject } from './fakeServer.ts';
import { isolateDocumentListeners, openBrowser, settle, showPanels } from './harness.tsx';
import { select } from './scene.tsx';

isolateDocumentListeners();

async function scene(selected: boolean) {
  const lay = layer('Default', 0);
  const server = new FakeServer([lay]);
  const symbol = server.seed(symbolObject(lay.id, {}));
  const one = await openBrowser(server);
  const panels = showPanels(one);
  act(() => { one.map.activeLayer.set(lay.id); });
  await settle();
  if (selected) await select(one, symbol.id);
  return { one, panels };
}

const HEADINGS = 'h1, h2, h3, h4, h5, h6, [role="heading"]';

describe('name once (T-204, SDK 1.8.0 part C)', () => {
  it('the Symbols panel has no heading of its own', async () => {
    const { panels } = await scene(false);
    expect(panels.symbols.container.querySelectorAll(HEADINGS)).toHaveLength(0);
  });

  it('Symbol properties has no heading of its own, with nothing selected and with a symbol selected', async () => {
    const none = await scene(false);
    expect(none.panels.properties.container.querySelectorAll(HEADINGS)).toHaveLength(0);
    document.body.replaceChildren();
    const some = await scene(true);
    expect(some.panels.properties.container.querySelector('.draw-symbols-facts, input, select')).not.toBeNull(); // the symbol's fields are shown
    expect(some.panels.properties.container.querySelectorAll(HEADINGS)).toHaveLength(0);
  });

  it('the Place button is the panel foot, the last element of the Symbols body', async () => {
    const { panels } = await scene(false);
    const foot = panels.symbols.container.querySelector('.emc2-panel-foot');
    expect(foot).not.toBeNull();
    expect(foot?.contains(panels.symbols.getByRole('button', { name: 'Place on map' }))).toBe(true);
    expect(foot?.nextElementSibling).toBeNull();
    expect(foot?.parentElement?.lastElementChild).toBe(foot);
  });

  it('the foot keeps the button when it turns into Stop placing', async () => {
    const { panels } = await scene(false);
    fireEvent.click(panels.symbols.getByRole('button', { name: 'Infantry' }));
    fireEvent.click(panels.symbols.getByRole('button', { name: 'Place on map' }));
    await settle();
    const foot = panels.symbols.container.querySelector('.emc2-panel-foot');
    expect(foot?.contains(panels.symbols.getByRole('button', { name: 'Stop placing' }))).toBe(true);
    expect(foot?.parentElement?.lastElementChild).toBe(foot);
  });
});
