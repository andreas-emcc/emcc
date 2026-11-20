// M4 (T-120, brief function 25, criteria 39 and 40; T-103, function 24, criterion 36): the layer lock of SDK 1.3.0 (ADR-0042) and the right click.
import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DeclaredField, MapObject } from '@emc2/plugin-sdk';
import { FakeServer, layer, symbolObject } from './fakeServer.ts';
import { isolateDocumentListeners, openBrowser, settle, showPanels } from './harness.tsx';
import { dataOf, input, placeAt, select } from './scene.tsx';

isolateDocumentListeners();

const hint = (name: string) => `Layer "${name}" is locked`;

/** One layer, active, with a symbol in it; the browser has it selected unless `selected` is false. */
async function scene(options: { readonly locked?: boolean; readonly selected?: boolean; readonly fields?: readonly DeclaredField[]; readonly carries?: boolean; readonly extensions?: MapObject['extensions'] } = {}) {
  const lay = layer('Alpha', 0);
  const server = new FakeServer([lay]);
  const symbol = server.seed(symbolObject(lay.id, { properties: { name: 'Mine' }, ...(options.carries === true ? { fieldSets: ['cot.unit'] } : {}), ...(options.extensions === undefined ? {} : { extensions: options.extensions }) }));
  if (options.locked === true) server.setLocked(lay.id, true);
  const one = await openBrowser(server, options.fields === undefined ? {} : { declaredFields: options.fields, fieldSets: [{ id: 'cot.unit', plugin: 'cot', name: 'unit', label: 'CoT unit', fields: options.fields.map((f) => f.name) }] });
  const two = await openBrowser(server);
  one.map.activeLayer.set(lay.id);
  const p1 = showPanels(one);
  if (options.selected !== false) await select(one, symbol.id);
  return { server, lay, symbol, one, two, p1 };
}

const placeButton = (p: ReturnType<typeof showPanels>) => p.symbols.getByRole('button', { name: /Place on map|Stop placing/ }) as HTMLButtonElement;

describe('placing in a locked layer (criterion 39)', () => {
  it('disables the place button with the title, and follows the lock live', async () => {
    const { server, lay, one, p1 } = await scene({ selected: false });
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Infantry' }));
    expect(placeButton(p1).disabled).toBe(false);
    act(() => { server.setLocked(lay.id, true); });
    await settle();
    expect(placeButton(p1).disabled).toBe(true);
    expect(placeButton(p1).title).toBe('The active layer "Alpha" is locked');
    expect(p1.symbols.getByRole('status').textContent).toBe('The active layer "Alpha" is locked');
    fireEvent.click(placeButton(p1));
    expect(one.map.runningInteraction).toBeNull();
    act(() => { server.setLocked(lay.id, false); });
    await settle();
    expect(placeButton(p1).disabled).toBe(false);
  });

  it('ends a placing that runs when the layer is locked, and sends nothing', async () => {
    const { server, lay, one, p1 } = await scene({ selected: false });
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Infantry' }));
    fireEvent.click(placeButton(p1));
    await settle();
    expect(one.map.runningInteraction).toBe('pickPoint');
    act(() => { server.setLocked(lay.id, true); });
    await settle();
    expect(one.map.runningInteraction).toBeNull();
    expect(placeButton(p1).textContent).toBe('Place on map');
    await act(async () => {
      one.map.completeInteraction([15.5, 60.25]); // a click that arrives too late
      await Promise.resolve();
    });
    await settle();
    expect(server.requests).toHaveLength(0);
  });
});

describe('a symbol in a locked layer (criterion 40)', () => {
  it('opens read only with the notice, sends nothing and arms no drag; an unlock in a second browser makes it editable', async () => {
    const { server, lay, one, p1 } = await scene({ locked: true });
    expect(p1.properties.getByText(hint('Alpha'))).toBeDefined();
    expect(input(p1, 'Name').disabled).toBe(true);
    expect((p1.properties.getByLabelText('Identity') as HTMLSelectElement).disabled).toBe(true);
    expect((p1.properties.getByLabelText('Layer') as HTMLSelectElement).disabled).toBe(true);
    expect(one.map.runningInteraction).toBeNull(); // no drag armed
    expect(server.requests).toHaveLength(0);
    act(() => { server.setLocked(lay.id, false); });
    await settle();
    expect(p1.properties.queryByText(hint('Alpha'))).toBeNull();
    expect(input(p1, 'Name').disabled).toBe(false);
    expect(one.map.runningInteraction).toBe('dragObject');
  });

  it('becomes read only when the layer is locked while it is open, ends the drag, and a change typed before sends nothing', async () => {
    const { server, lay, one, p1 } = await scene();
    expect(one.map.runningInteraction).toBe('dragObject');
    fireEvent.change(input(p1, 'Name'), { target: { value: 'Typed' } });
    act(() => { server.setLocked(lay.id, true); });
    await settle();
    expect(p1.properties.getByText(hint('Alpha'))).toBeDefined();
    expect(one.map.runningInteraction).toBeNull();
    fireEvent.keyDown(input(p1, 'Name'), { key: 'Enter' });
    await settle();
    expect(server.requests).toHaveLength(0);
    expect(one.ctx.notifications.at(-1)).toMatchObject({ severity: 'warning' });
  });

  it('shows the fields of the set of the symbol read only: the value, no input to change it, no "+" and no drop-down of sets to add', async () => {
    const fields: readonly DeclaredField[] = [
      { plugin: 'cot', name: 'callsign', type: 'text', label: 'Callsign', editableByOthers: true, maxLength: 12 },
      { plugin: 'cot', name: 'role', type: 'text', label: 'Role', editableByOthers: true },
    ];
    const { p1 } = await scene({ locked: true, fields, carries: true, extensions: { cot: { callsign: 'Hawk' } } });
    const callsign = p1.properties.getByLabelText('Callsign') as HTMLInputElement;
    expect(callsign.value).toBe('Hawk');
    expect(callsign.disabled).toBe(true);
    expect((p1.properties.getByLabelText('Role') as HTMLInputElement).disabled).toBe(true); // also a field without a value
    expect(p1.properties.queryByRole('button', { name: 'Add a field set' })).toBeNull();
  });

  it('shows no field for a symbol in a locked layer that carries no set', async () => {
    const fields: readonly DeclaredField[] = [{ plugin: 'cot', name: 'role', type: 'text', label: 'Role', editableByOthers: true }];
    const { p1 } = await scene({ locked: true, fields });
    expect(p1.properties.queryByLabelText('Role')).toBeNull();
    expect(p1.properties.queryByRole('button', { name: 'Add a field set' })).toBeNull();
  });

  it('offers no locked layer as a target in the layer field, but keeps the symbol\'s own layer', async () => {
    const lay = layer('Alpha', 0);
    const other = layer('Beta', 1);
    const locked = layer('Gamma', 2);
    const server = new FakeServer([lay, other, locked]);
    server.setLocked(locked.id, true);
    const symbol = server.seed(symbolObject(lay.id));
    const one = await openBrowser(server);
    const p1 = showPanels(one);
    await select(one, symbol.id);
    const options = [...(p1.properties.getByLabelText('Layer') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options.sort()).toEqual(['Alpha', 'Beta']);
  });

  it('shows the locked layer the symbol is in by its name, as the only choice that stays', async () => {
    const { p1 } = await scene({ locked: true });
    const field = p1.properties.getByLabelText('Layer') as HTMLSelectElement;
    expect([...field.options].map((o) => o.textContent)).toEqual(['Alpha']);
    expect(field.selectedOptions[0]?.textContent).toBe('Alpha');
  });

  it('shows a LAYER_LOCKED refusal like any other when the layer was locked in between', async () => {
    const { server, lay, symbol, one, p1 } = await scene();
    one.connection.hold = true;
    fireEvent.change(input(p1, 'Name'), { target: { value: 'Late' } });
    fireEvent.keyDown(input(p1, 'Name'), { key: 'Enter' });
    await settle();
    server.setLocked(lay.id, true);
    await act(async () => {
      one.connection.release();
      await Promise.resolve();
    });
    await settle();
    expect(one.ctx.notifications.at(-1)).toMatchObject({ severity: 'error' });
    expect(server.objects.get(symbol.id)?.properties?.name).toBe('Mine');
  });
});

describe('right click while placing (T-103, criterion 36)', () => {
  it('ends placing like Escape, creates nothing, and a click on a symbol then selects it', async () => {
    const { server, one, p1 } = await scene({ selected: false });
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Infantry' }));
    fireEvent.click(placeButton(p1));
    await settle();
    expect(one.map.runningInteraction).toBe('pickPoint');
    await act(async () => {
      one.map.rightClick();
      await Promise.resolve();
    });
    await settle();
    expect(one.map.runningInteraction).toBeNull();
    expect(placeButton(p1).textContent).toBe('Place on map');
    expect(server.requests).toHaveLength(0);
    await select(one, [...server.objects.values()][0]?.id ?? null);
    expect(input(p1, 'Name').value).toBe('Mine');
  });

  it('places again after a new start of placing', async () => {
    const { server, one, p1 } = await scene({ selected: false });
    await placeAt(one, p1, [15.5, 60.25]);
    one.map.rightClick();
    await settle();
    await placeAt(one, p1, [15.75, 60.5]);
    expect(server.requests.filter((r) => r.operation === 'create')).toHaveLength(2);
    expect(dataOf(server.requests.at(-1)).geometry).toBeDefined();
  });
});

