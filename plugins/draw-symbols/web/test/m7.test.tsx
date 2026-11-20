// M7 (brief, function 31, criteria 54 to 56; T-156; SDK 1.6.0 part G): symbol palettes in the Symbols panel, declared by other plugins and
// given in `ctx.symbolPalettes`.
import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MapObject, SymbolPalette } from '@emc2/plugin-sdk';
import { FakeServer, layer } from './fakeServer.ts';
import { isolateDocumentListeners, openBrowser, settle, showPanels, STOCKHOLM } from './harness.tsx';
import { choose } from './scene.tsx';

isolateDocumentListeners();

const INFANTRY = '10031000001211000000'; // friend, no echelon, Infantry (the test catalog names it)
const ARMOUR = '10031000001205001234'; // digits the service does not carry (the test double writes zeros for them): a code that is not changed must keep them
const COT: SymbolPalette = {
  plugin: 'cot', id: 'cot.cot', name: 'CoT',
  symbols: [
    { standard: 'APP-6D', code: INFANTRY }, // no label: the catalogue's name
    { standard: 'APP-6D', code: ARMOUR, label: 'Tank platoon' },
    { standard: 'APP-6B', code: 'SFGPUCI--------', label: 'Legacy unit' },
  ],
};
const TEST: SymbolPalette = { plugin: 'test', id: 'test.test', name: 'Test', symbols: [{ standard: 'APP-6D', code: INFANTRY, label: 'Only one' }] };
const AIR: SymbolPalette = { plugin: 'air', id: 'air.air', name: 'Air', symbols: [{ standard: 'APP-6D', code: '10030100001101000000', label: 'Fighter' }] };
const BROKEN: SymbolPalette = { plugin: 'bad', id: 'bad.bad', name: 'Broken', symbols: [{ standard: 'APP-6D', code: '1234', label: 'Bad code' }, { standard: 'APP-6D', code: INFANTRY, label: 'Good code' }] };

async function scene(palettes: readonly SymbolPalette[] = [COT, TEST], options: { readonly kept?: string } = {}) {
  const lay = layer('Default', 0);
  const server = new FakeServer([lay]);
  const one = await openBrowser(server, { symbolPalettes: palettes });
  if (options.kept !== undefined) await one.ctx.userDocuments.put('symbol-palette', { palette: options.kept });
  const panels = showPanels(one);
  act(() => { one.map.activeLayer.set(lay.id); });
  await settle();
  return { server, lay, one, panels };
}

const names = (panels: ReturnType<typeof showPanels>) =>
  [...panels.symbols.getByRole('group', { name: 'Symbols' }).querySelectorAll('.draw-symbols-entity-name')].map((e) => e.textContent);
const creates = (server: FakeServer) => server.requests.filter((r) => r.operation === 'create') as unknown as { data: MapObject }[];
const place = async (one: Awaited<ReturnType<typeof scene>>['one'], panels: ReturnType<typeof showPanels>, name: string) => {
  fireEvent.click(panels.symbols.getByRole('button', { name }));
  fireEvent.click(panels.symbols.getByRole('button', { name: 'Place on map' }));
  await settle();
  await act(async () => { one.map.completeInteraction(STOCKHOLM); await Promise.resolve(); });
  await settle();
};

describe('palettes offered (criterion 54)', () => {
  it('the drop-down offers General symbols, then each palette in the context\'s order', async () => {
    const { panels } = await scene();
    const select = panels.symbols.getByLabelText('Palette') as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(['General symbols', 'CoT', 'Test']);
    expect(select.value).toBe(''); // General symbols
  });

  it('General symbols shows the catalogue as before', async () => {
    const { panels } = await scene();
    expect(names(panels)).toEqual(['Infantry', 'Armour']);
    expect(panels.symbols.getByLabelText('Category')).toBeTruthy();
    expect(panels.symbols.queryByLabelText('Search')).toBeNull();
  });

  it('without palettes there is no drop-down', async () => {
    const { panels } = await scene([]);
    expect(panels.symbols.queryByLabelText('Palette')).toBeNull();
    expect(names(panels)).toEqual(['Infantry', 'Armour']);
  });
});

describe('placing from a palette (criterion 55)', () => {
  it('shows the palette\'s symbols in its order with their labels, else the catalogue\'s name', async () => {
    const { one, panels } = await scene();
    await choose(panels.symbols.getByLabelText('Palette'), 'cot.cot');
    expect(names(panels)).toEqual(['Infantry', 'Tank platoon', 'Legacy unit']);
    expect(one.symbols.renderRequests.some((r) => r.standard === 'APP-6B' && r.sidc === 'SFGPUCI--------')).toBe(true); // drawn with its own standard
    expect(panels.symbols.queryByLabelText('Category')).toBeNull(); // the catalogue's categories are not the palette's
    await choose(panels.symbols.getByLabelText('Palette'), 'test.test');
    expect(names(panels)).toEqual(['Only one']);
  });

  it('the search filters by the shown text, any case, and leaves one for "Infantry"', async () => {
    const { panels } = await scene();
    await choose(panels.symbols.getByLabelText('Palette'), 'cot.cot');
    fireEvent.change(panels.symbols.getByLabelText('Search'), { target: { value: 'Infantry' } });
    await settle();
    expect(names(panels)).toEqual(['Infantry']);
    fireEvent.change(panels.symbols.getByLabelText('Search'), { target: { value: 'TANK' } });
    await settle();
    expect(names(panels)).toEqual(['Tank platoon']);
    fireEvent.change(panels.symbols.getByLabelText('Search'), { target: { value: 'zzz' } });
    await settle();
    expect(names(panels)).toEqual([]);
  });

  it('a new palette starts with an empty search', async () => {
    const { panels } = await scene();
    await choose(panels.symbols.getByLabelText('Palette'), 'cot.cot');
    fireEvent.change(panels.symbols.getByLabelText('Search'), { target: { value: 'tank' } });
    await settle();
    await choose(panels.symbols.getByLabelText('Palette'), 'test.test');
    expect((panels.symbols.getByLabelText('Search') as HTMLInputElement).value).toBe('');
    expect(names(panels)).toEqual(['Only one']);
  });

  it('placing with the identity hostile sends one create with the palette\'s code and the hostile identity', async () => {
    const { server, one, panels } = await scene();
    await choose(panels.symbols.getByLabelText('Palette'), 'cot.cot');
    await choose(panels.symbols.getByLabelText('Identity'), '6');
    await place(one, panels, 'Infantry');
    expect(creates(server)).toHaveLength(1);
    expect(creates(server)[0]?.data.symbol).toEqual({ standard: 'APP-6D', sidc: '10061000001211000000' }); // hostile (6), the rest as the palette has it
    expect(creates(server)[0]?.data.geometry).toEqual({ type: 'Point', coordinates: [18.0686, 59.3293] });
  });

  it('a code that has the identity already is sent exactly as the palette has it', async () => {
    const { server, one, panels } = await scene();
    await choose(panels.symbols.getByLabelText('Palette'), 'cot.cot');
    await place(one, panels, 'Tank platoon'); // friend, the panel's default
    expect(creates(server)[0]?.data.symbol).toEqual({ standard: 'APP-6D', sidc: ARMOUR });
  });

  it('the echelon applies to a land unit when chosen, and "Unchanged" leaves it alone', async () => {
    const { server, one, panels } = await scene();
    await choose(panels.symbols.getByLabelText('Palette'), 'cot.cot');
    expect((panels.symbols.getByLabelText('Echelon') as HTMLSelectElement).value).toBe(''); // as in the palette
    await choose(panels.symbols.getByLabelText('Echelon'), '15'); // company
    await place(one, panels, 'Infantry');
    expect(creates(server)[0]?.data.symbol?.sidc).toBe('10031000151211000000');
  });

  it('the echelon is not applied to a symbol that is not a land unit', async () => {
    const { server, one, panels } = await scene([AIR]);
    await choose(panels.symbols.getByLabelText('Palette'), 'air.air');
    await choose(panels.symbols.getByLabelText('Echelon'), '15');
    await place(one, panels, 'Fighter');
    expect(creates(server)[0]?.data.symbol?.sidc).toBe('10030100001101000000');
  });

  it('a palette symbol of APP-6B is placed as it is, with its own standard', async () => {
    const { server, one, panels } = await scene();
    await choose(panels.symbols.getByLabelText('Palette'), 'cot.cot');
    await choose(panels.symbols.getByLabelText('Identity'), '6');
    await place(one, panels, 'Legacy unit');
    expect(creates(server)[0]?.data.symbol).toEqual({ standard: 'APP-6B', sidc: 'SFGPUCI--------' });
  });

  it('back to General symbols places a catalogue entry again', async () => {
    const { server, one, panels } = await scene();
    await choose(panels.symbols.getByLabelText('Palette'), 'cot.cot');
    await choose(panels.symbols.getByLabelText('Palette'), '');
    await place(one, panels, 'Infantry');
    expect(creates(server)[0]?.data.symbol).toEqual({ standard: 'APP-6D', sidc: INFANTRY });
  });
});

describe('kept choice, fallback and a refused code (criterion 56)', () => {
  it('the chosen palette is kept for the user, and survives a reload', async () => {
    const { one, panels } = await scene();
    await choose(panels.symbols.getByLabelText('Palette'), 'cot.cot');
    await settle();
    expect(one.ctx.storedUserDocuments).toEqual({ 'symbol-palette': { palette: 'cot.cot' } });
    // A reload: another browser of the same user, with the same documents.
    const lay = layer('Default', 0);
    const second = await openBrowser(new FakeServer([lay]), { symbolPalettes: [COT, TEST] });
    await second.ctx.userDocuments.put('symbol-palette', one.ctx.storedUserDocuments['symbol-palette'] ?? null);
    const again = showPanels(second);
    await settle();
    expect((again.symbols.getByLabelText('Palette') as HTMLSelectElement).value).toBe('cot.cot');
    expect(names(again)).toEqual(['Infantry', 'Tank platoon', 'Legacy unit']);
  });

  it('a user who never chose a palette has no document read: no request for one that does not exist', async () => {
    const lay = layer('Default', 0);
    const one = await openBrowser(new FakeServer([lay]), { symbolPalettes: [COT, TEST] });
    const read: string[] = [];
    const get = one.ctx.userDocuments.get.bind(one.ctx.userDocuments);
    one.ctx.userDocuments.get = (name) => { read.push(name); return get(name); };
    const panels = showPanels(one);
    await settle();
    expect(read).toEqual([]);
    expect((panels.symbols.getByLabelText('Palette') as HTMLSelectElement).value).toBe('');
    await choose(panels.symbols.getByLabelText('Palette'), 'cot.cot');
    await settle();
    expect(read).toEqual([]);
    // Once a choice is kept, it is read (the other browser of the same user).
    const second = await openBrowser(new FakeServer([layer('Default', 0)]), { symbolPalettes: [COT, TEST] });
    await second.ctx.userDocuments.put('symbol-palette', { palette: 'test.test' });
    const getSecond = second.ctx.userDocuments.get.bind(second.ctx.userDocuments);
    second.ctx.userDocuments.get = (name) => { read.push(name); return getSecond(name); };
    const again = showPanels(second);
    await settle();
    expect(read).toEqual(['symbol-palette']);
    expect((again.symbols.getByLabelText('Palette') as HTMLSelectElement).value).toBe('test.test');
  });

  it('a context that hands out a new palette list on every read does not read the documents again each time', async () => {
    const lay = layer('Default', 0);
    const one = await openBrowser(new FakeServer([lay]), { symbolPalettes: [COT, TEST] });
    Object.defineProperty(one.ctx, 'symbolPalettes', { get: () => [COT, TEST] });
    let lists = 0;
    const list = one.ctx.userDocuments.list.bind(one.ctx.userDocuments);
    one.ctx.userDocuments.list = () => { lists += 1; return list(); };
    const panels = showPanels(one);
    await settle();
    await choose(panels.symbols.getByLabelText('Palette'), 'cot.cot');
    fireEvent.change(panels.symbols.getByLabelText('Search'), { target: { value: 'tank' } });
    await settle();
    expect(lists).toBe(1);
  });

  it('choosing General symbols is kept too', async () => {
    const { one, panels } = await scene([COT, TEST], { kept: 'cot.cot' });
    await settle();
    await choose(panels.symbols.getByLabelText('Palette'), '');
    await settle();
    expect(one.ctx.storedUserDocuments).toEqual({ 'symbol-palette': { palette: '' } });
  });

  it('a kept document that is not a choice is ignored', async () => {
    for (const kept of ['cot.cot', { palette: 5 }, ['cot.cot'], null]) {
      const lay = layer('Default', 0);
      const one = await openBrowser(new FakeServer([lay]), { symbolPalettes: [COT] });
      await one.ctx.userDocuments.put('symbol-palette', kept);
      const panels = showPanels(one);
      await settle();
      expect((panels.symbols.getByLabelText('Palette') as HTMLSelectElement).value).toBe('');
      document.body.replaceChildren();
    }
  });

  it('a kept palette whose plugin is gone falls back to General symbols', async () => {
    const { panels } = await scene([], { kept: 'cot.cot' });
    expect(panels.symbols.queryByLabelText('Palette')).toBeNull();
    expect(names(panels)).toEqual(['Infantry', 'Armour']);
    const other = await scene([TEST], { kept: 'cot.cot' });
    expect((other.panels.symbols.getByLabelText('Palette') as HTMLSelectElement).value).toBe('');
    expect(names(other.panels)).toEqual(['Infantry', 'Armour']);
  });

  it('a choice made before the kept one is read is not overwritten by it', async () => {
    const lay = layer('Default', 0);
    const server = new FakeServer([lay]);
    const one = await openBrowser(server, { symbolPalettes: [COT, TEST] });
    await one.ctx.userDocuments.put('symbol-palette', { palette: 'cot.cot' });
    const panels = showPanels(one);
    await choose(panels.symbols.getByLabelText('Palette'), 'test.test'); // before the read has answered
    await settle();
    expect((panels.symbols.getByLabelText('Palette') as HTMLSelectElement).value).toBe('test.test');
  });

  it('a document that cannot be read or written leaves the choice working for the page', async () => {
    const lay = layer('Default', 0);
    const one = await openBrowser(new FakeServer([lay]), { symbolPalettes: [COT, TEST] });
    one.ctx.failUserDocuments(true);
    const panels = showPanels(one);
    await settle();
    await choose(panels.symbols.getByLabelText('Palette'), 'cot.cot');
    await settle();
    expect((panels.symbols.getByLabelText('Palette') as HTMLSelectElement).value).toBe('cot.cot');
    expect(one.ctx.logs.some((l) => l.level === 'warn' && l.message.includes('palette'))).toBe(true);
  });

  it('a symbol chosen whose code the service then refuses with another identity is not placed', async () => {
    const { server, one, panels } = await scene();
    await choose(panels.symbols.getByLabelText('Palette'), 'cot.cot');
    fireEvent.click(panels.symbols.getByRole('button', { name: 'Infantry' }));
    expect((panels.symbols.getByRole('button', { name: 'Place on map' }) as HTMLButtonElement).disabled).toBe(false);
    const real = one.symbols.validate.bind(one.symbols);
    one.symbols.validate = (standard, sidc) => (sidc.startsWith('1006') ? { valid: false, problem: 'refused for the test' } : real(standard, sidc));
    await choose(panels.symbols.getByLabelText('Identity'), '6');
    expect((panels.symbols.getByRole('button', { name: 'Infantry' }) as HTMLButtonElement).disabled).toBe(true);
    expect((panels.symbols.getByRole('button', { name: 'Place on map' }) as HTMLButtonElement).disabled).toBe(true);
    expect(server.requests).toHaveLength(0);
  });

  it('a code the symbol service refuses shows the error frame and cannot be placed', async () => {
    const { server, one, panels } = await scene([BROKEN]);
    await choose(panels.symbols.getByLabelText('Palette'), 'bad.bad');
    const bad = panels.symbols.getByRole('button', { name: /Bad code/ }) as HTMLButtonElement;
    expect(bad.disabled).toBe(true);
    expect(bad.querySelector('.draw-symbols-picture-missing')).not.toBeNull(); // the error frame, not a symbol
    expect((panels.symbols.getByRole('button', { name: 'Good code' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(bad);
    await settle();
    expect((panels.symbols.getByRole('button', { name: 'Place on map' }) as HTMLButtonElement).disabled).toBe(true); // nothing chosen
    expect(server.requests).toHaveLength(0);
    expect(one.ctx.notifications).toEqual([]);
  });
});
