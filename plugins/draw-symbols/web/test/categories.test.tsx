// M4 (T-118, brief functions 1 and 4, criteria 37 and 38): the picker shows one category at a time, the echelon applies to land units only.
import { fireEvent, within, type RenderResult } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeSymbolService } from '@emc2/plugin-sdk/testing';
import type { CatalogEntry } from '@emc2/plugin-sdk';
import { categoriesOf, categoryName } from '../src/categories.ts';
import { CATEGORY_KEY } from '../src/keptChoice.ts';
import { FakeServer, layer, symbolObject } from './fakeServer.ts';
import { isolateDocumentListeners, openBrowser, settle, showPanels } from './harness.tsx';
import { choose, dataOf, placeAt, select } from './scene.tsx';

isolateDocumentListeners();

const ENTITIES: readonly CatalogEntry[] = [
  { name: 'Infantry', symbolSet: '10', entity: '121100' },
  { name: 'Armour', symbolSet: '10', entity: '120500' },
  { name: 'Fixed wing', symbolSet: '01', entity: '110100' },
  { name: 'Radar', symbolSet: '01', entity: '110300' },
  { name: 'Radar', symbolSet: '51', entity: '110300' },
  { name: 'Odd', symbolSet: '99', entity: '100000' },
];

const open = (server = new FakeServer([layer('A', 0)])) => openBrowser(server, { entities: ENTITIES });
const names = (view: RenderResult) => within(view.getByRole('group', { name: 'Symbols' })).queryAllByRole('button').map((b) => b.textContent);
const options = (field: HTMLElement) => [...(field as HTMLSelectElement).options].map((o) => [o.value, o.textContent]);

describe('categories of the catalog', () => {
  it('groups by symbol set in the catalog order and names them; an unnamed set is listed by its code', () => {
    expect(categoriesOf(ENTITIES).map((c) => [c.code, c.name, c.entries.length])).toEqual([
      ['10', 'Land unit', 2], ['01', 'Air', 2], ['51', 'Signals intelligence, air', 1], ['99', '99', 1],
    ]);
  });

  it('names every symbol set the symbology catalog has', () => {
    expect(['10', '15', '20', '01', '02', '05', '30', '35', '36', '50', '51', '52', '53', '54'].map(categoryName)).toEqual([
      'Land unit', 'Land equipment', 'Land installation', 'Air', 'Air missile', 'Space', 'Sea surface', 'Sea subsurface', 'Mine warfare',
      'Signals intelligence, space', 'Signals intelligence, air', 'Signals intelligence, land', 'Signals intelligence, sea surface', 'Signals intelligence, subsurface',
    ]);
  });
});

describe('the Symbols panel by category (criterion 37)', () => {
  it('shows the first category, and only its entries, with the categories to choose from', async () => {
    const { symbols } = showPanels(await open());
    expect(options(symbols.getByLabelText('Category'))).toEqual([['10', 'Land unit'], ['01', 'Air'], ['51', 'Signals intelligence, air'], ['99', '99'], ['vessels', 'Vessels']]);
    expect(names(symbols)).toEqual(['Infantry', 'Armour']);
  });

  it('shows another category by itself, so that a name does not repeat', async () => {
    const { symbols } = showPanels(await open());
    await choose(symbols.getByLabelText('Category'), '01');
    expect(names(symbols)).toEqual(['Fixed wing', 'Radar']);
    await choose(symbols.getByLabelText('Category'), '51');
    expect(names(symbols)).toEqual(['Radar']);
  });

  it('keeps the category in this browser and shows it again after a reload', async () => {
    const first = showPanels(await open());
    await choose(first.symbols.getByLabelText('Category'), '01');
    expect(window.localStorage.getItem(CATEGORY_KEY)).toBe('01');
    const reloaded = showPanels(await open());
    const fields = reloaded.symbols.getAllByLabelText('Category');
    expect((fields[0] as HTMLSelectElement).value).toBe('01');
    expect(names(reloaded.symbols)).toEqual(['Fixed wing', 'Radar']);
  });

  it('shows the first category when the kept one is not in the catalog', async () => {
    window.localStorage.setItem(CATEGORY_KEY, '77');
    const { symbols } = showPanels(await open());
    expect((symbols.getByLabelText('Category') as HTMLSelectElement).value).toBe('10');
  });

  it('works when browser storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { symbols } = showPanels(await open());
    expect(names(symbols)).toEqual(['Infantry', 'Armour']);
    await choose(symbols.getByLabelText('Category'), '01');
    expect(names(symbols)).toEqual(['Fixed wing', 'Radar']);
  });

  it('shows no symbol chosen in another category, and the symbol again when the user goes back', async () => {
    const { symbols } = showPanels(await open());
    fireEvent.click(symbols.getByRole('button', { name: 'Infantry' }));
    expect(symbols.getByText('10031000001211000000')).toBeDefined();
    await choose(symbols.getByLabelText('Category'), '01');
    expect(symbols.getByText('No symbol chosen')).toBeDefined();
    await choose(symbols.getByLabelText('Category'), '10');
    expect(symbols.getByRole('button', { name: 'Infantry' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('composes every entry of every category with each identity into a valid symbol of that entry', async () => {
    const service = createFakeSymbolService();
    const { symbols } = showPanels(await open());
    for (const category of categoriesOf(ENTITIES)) {
      await choose(symbols.getByLabelText('Category'), category.code);
      for (const identity of service.catalog().standardIdentities) {
        await choose(symbols.getByLabelText('Identity'), identity.code);
        for (const entry of category.entries) {
          fireEvent.click(within(symbols.getByRole('group', { name: 'Symbols' })).getByRole('button', { name: entry.name }));
          const sidc = symbols.container.querySelector('.draw-symbols-preview code')?.textContent ?? '';
          expect(service.validate('APP-6D', sidc).valid).toBe(true);
          expect(service.describe('APP-6D', sidc)).toMatchObject({ symbolSet: entry.symbolSet, entity: entry.entity, standardIdentity: identity.code });
        }
      }
    }
  });
});

describe('the echelon (criterion 37)', () => {
  it('is offered for land units and used there, and for no other category', async () => {
    const { symbols } = showPanels(await open());
    await choose(symbols.getByLabelText('Echelon'), '16');
    fireEvent.click(symbols.getByRole('button', { name: 'Infantry' }));
    expect(symbols.getByText('10031000161211000000')).toBeDefined(); // battalion
    await choose(symbols.getByLabelText('Category'), '01');
    expect(symbols.queryByLabelText('Echelon')).toBeNull();
    fireEvent.click(symbols.getByRole('button', { name: 'Fixed wing' }));
    expect(symbols.getByText('10030100001101000000')).toBeDefined(); // no echelon, although battalion was chosen
    await choose(symbols.getByLabelText('Category'), '10');
    expect((symbols.getByLabelText('Echelon') as HTMLSelectElement).value).toBe('16'); // the choice is still there
  });

  it('places an air symbol without echelon', async () => {
    const lay = layer('A', 0);
    const server = new FakeServer([lay]);
    const browser = await open(server);
    const panels = showPanels(browser);
    browser.map.activeLayer.set(lay.id);
    await choose(panels.symbols.getByLabelText('Echelon'), '16');
    await choose(panels.symbols.getByLabelText('Category'), '01');
    await placeAt(browser, panels, [15.5, 60.25], 'Fixed wing');
    expect(dataOf(server.requests.at(-1)).symbol?.sidc).toBe('10030100001101000000');
  });
});

describe('the properties panel by category', () => {
  async function selected(sidc: string) {
    const lay = layer('A', 0);
    const server = new FakeServer([lay]);
    const object = server.seed(symbolObject(lay.id, { symbol: { standard: 'APP-6D', sidc } }));
    const browser = await open(server);
    const panels = showPanels(browser);
    await select(browser, object.id);
    await settle();
    return { server, browser, panels, object };
  }

  it("lists the entities of the symbol's own category only, and shows its category", async () => {
    const { panels } = await selected('10031000001211000000');
    expect((panels.properties.getByLabelText('Category') as HTMLSelectElement).value).toBe('10');
    expect(options(panels.properties.getByLabelText('Entity')).map(([, label]) => label)).toEqual(['Infantry', 'Armour']);
    expect(panels.properties.getByLabelText('Echelon')).toBeDefined();
  });

  it('hides the echelon for a symbol of another set and keeps its own digits when other parts change', async () => {
    const { server, panels } = await selected('10030100161101000000');
    expect(panels.properties.queryByLabelText('Echelon')).toBeNull();
    expect(options(panels.properties.getByLabelText('Entity')).map(([, label]) => label)).toEqual(['Fixed wing', 'Radar']);
    await choose(panels.properties.getByLabelText('Identity'), '6');
    expect(dataOf(server.requests.at(-1)).symbol?.sidc).toBe('10060100161101000000');
  });

  it('changes the category to the first entity of the new one and drops the echelon', async () => {
    const { server, panels } = await selected('10031000161211000000');
    await choose(panels.properties.getByLabelText('Category'), '01');
    expect(dataOf(server.requests.at(-1)).symbol?.sidc).toBe('10030100001101000000');
    expect(panels.properties.queryByLabelText('Echelon')).toBeNull();
  });
});
