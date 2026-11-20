import type { RelationKind } from '@emc2/plugin-sdk';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DisplayControl } from './DisplayControl.tsx';
import { DisplayState } from './state.ts';

const GMTI = { id: 'gmti.pairing', label: 'GMTI Pairing', defaultOn: true, line: { strokeColor: '#336699' } } as unknown as RelationKind;

/** A server that keeps the user's choices as written and answers reads with them. */
function setUp(kinds: readonly RelationKind[], stored: Record<string, unknown> = {}) {
  let choices: unknown = stored;
  const writes: unknown[] = [];
  const doFetch = vi.fn<typeof fetch>((_input, init) => {
    if (init?.method === 'PUT') {
      choices = JSON.parse(init.body as string);
      writes.push(choices);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(Response.json({ choices, defaults: {} }));
  });
  const display = new DisplayState({ relationKinds: kinds, fetch: doFetch });
  render(<DisplayControl display={display} />);
  return { display, writes };
}

afterEach(() => {
  cleanup();
});

describe('the display settings window (ADR-0052; owner, 2026-11-07)', () => {
  it('opens from its icon with the focus on the size, and closes back to the icon', () => {
    setUp([]);
    const icon = screen.getByRole('button', { name: 'Display settings' });
    fireEvent.click(icon);
    const dialog = within(screen.getByRole('dialog', { name: 'Display settings' }));
    expect(document.activeElement).toBe(dialog.getByRole('slider', { name: /^Symbol size/ }));
    expect(dialog.getByRole('heading', { name: 'Symbols' })).toBeTruthy();
    expect(dialog.queryByRole('heading', { name: 'Relations' }), 'no section without kinds').toBeNull();
    // SDK 1.8.0 (CR-0043 part A): the five places in LABEL_PLACES' order, then the arrow's check box
    expect(dialog.getAllByRole('combobox').map((c) => c.closest('label')?.querySelector('.emc2-field-label')?.textContent)).toEqual([
      'Top left', 'Top right', 'Bottom left', 'Bottom right', 'Below',
      'Friendly control measures', // SDK 1.9.0 (CR-0048 section 6)
    ]);
    expect(dialog.getAllByRole('checkbox').map((c) => c.closest('label')?.textContent)).toEqual([
      'Direction arrow', 'Dwell areas', 'Sensor coverage', // SDK 1.6.0: Areas, on by default
    ]);
    expect(dialog.getByRole('heading', { name: 'Areas' })).toBeTruthy();
    expect(dialog.getByRole<HTMLInputElement>('checkbox', { name: 'Dwell areas' }).checked).toBe(true);

    fireEvent.click(dialog.getByRole('button', { name: 'Close display settings' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(icon);
  });

  it("opens in the icon's place, like the map settings window, and closes on Escape or a press outside (T-162)", () => {
    setUp([]);
    const icon = screen.getByRole('button', { name: 'Display settings' });
    expect(icon.closest('.display-toggle'), "the map settings icon's frame").not.toBeNull();
    fireEvent.click(icon);
    const window = screen.getByRole('dialog', { name: 'Display settings' });
    expect(window.closest('.display-control'), 'in the corner, not in the top layer').not.toBeNull();
    expect(window.hasAttribute('popover')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Display settings' }), 'the icon makes room').toBeNull();

    fireEvent.pointerDown(window);
    expect(screen.getByRole('dialog'), 'a press inside keeps it').toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(icon);

    fireEvent.click(icon);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog'), 'a press outside closes it').toBeNull();
    expect(document.activeElement).toBe(icon);
  });

  it('shows a slider\'s moves at once and saves on release; a check box saves at once', async () => {
    const t = setUp([GMTI], { relations: { 'gone.kind': false } });
    await act(() => t.display.load());
    fireEvent.click(screen.getByRole('button', { name: 'Display settings' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Display settings' }));
    const size = dialog.getByRole('slider', { name: /^Symbol size/ });

    fireEvent.change(size, { target: { value: '44' } });
    fireEvent.change(size, { target: { value: '48' } });
    expect(t.display.value.symbolSize, 'at once').toBe(48);
    expect(size.getAttribute('aria-valuetext')).toBe('48 px');
    expect(t.writes, 'nothing saved while held').toEqual([]);
    fireEvent.pointerUp(size);
    await waitFor(() => { expect(t.writes).toEqual([{ relations: { 'gone.kind': false }, symbolSize: 48 }]); });

    const speed = dialog.getByRole('slider', { name: /^Speed vector/ });
    expect(speed.getAttribute('max'), 'Off and the SDK\'s ten steps (T-164)').toBe('10');
    fireEvent.change(speed, { target: { value: '1' } });
    expect(speed.getAttribute('aria-valuetext')).toBe('5 s');
    expect(t.display.value.speedVectorSeconds, 'at once').toBe(5);
    fireEvent.change(speed, { target: { value: '6' } });
    expect(speed.getAttribute('aria-valuetext')).toBe('2 min');
    fireEvent.pointerUp(speed);
    await waitFor(() => { expect(t.writes.at(-1)).toEqual({ relations: { 'gone.kind': false }, symbolSize: 48, speedVectorSeconds: 120 }); });
    fireEvent.change(speed, { target: { value: '0' } });
    expect(speed.getAttribute('aria-valuetext')).toBe('Off');

    // SDK 1.8.0 (CR-0043 part A): a drop-down per place, then the arrow; each label in one place
    const below = dialog.getByRole<HTMLSelectElement>('combobox', { name: 'Below' });
    expect(below.value, 'the default').toBe('name');
    expect([...below.options].map((o) => o.text)).toEqual(['None', 'Name', 'Unique designation', 'Higher formation',
      'Additional information', 'Staff comments', 'Type', 'Date-time group', 'Altitude or depth', 'Speed']);
    fireEvent.change(dialog.getByRole('combobox', { name: 'Bottom left' }), { target: { value: 'speed' } });
    await waitFor(() => { expect(t.display.value.labelPlaces.bottomLeft).toBe('speed'); });
    fireEvent.change(dialog.getByRole('combobox', { name: 'Top left' }), { target: { value: 'name' } });
    await waitFor(() => {
      expect(t.display.value.labelPlaces).toEqual({ topLeft: 'name', topRight: 'uniqueDesignation', bottomLeft: 'speed', bottomRight: null, below: null });
    });
    expect(below.value, 'Name moved from Below').toBe('none');
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Direction arrow' }));
    await waitFor(() => { expect(t.display.value.directionArrow).toBe(false); });
    expect(t.writes.at(-1), 'the places and the arrow, never labels beside them').toEqual({
      relations: { 'gone.kind': false }, symbolSize: 48, speedVectorSeconds: 0, directionArrow: false,
      labelPlaces: { topLeft: 'name', topRight: 'uniqueDesignation', bottomLeft: 'speed', bottomRight: null, below: null },
    });
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- what a 1.7.0 reader sees: the deprecated list, still filled
    expect([...t.display.value.labels].sort(), "1.7.0 readers' list: the same labels").toEqual(['name', 'speed', 'uniqueDesignation']);

    // SDK 1.9.0 (CR-0048 section 6): black by default, given only once chosen
    const colour = dialog.getByRole<HTMLSelectElement>('combobox', { name: 'Friendly control measures' });
    expect(colour.value).toBe('black');
    expect([...colour.options].map((o) => o.text)).toEqual(['Black', 'Blue']);
    expect(t.display.value.friendlyGraphicColour, 'none chosen: left out, as 1.8.0').toBeUndefined();
    fireEvent.change(colour, { target: { value: 'blue' } });
    await waitFor(() => { expect(t.display.value.friendlyGraphicColour).toBe('blue'); });
    expect(t.writes.at(-1)).toMatchObject({ friendlyGraphicColour: 'blue', directionArrow: false });

    expect(dialog.getByRole('heading', { name: 'Relations' })).toBeTruthy();
    const pairing = dialog.getByRole<HTMLInputElement>('checkbox', { name: 'GMTI Pairing' });
    expect(pairing.checked, 'its defaultOn').toBe(true);
    fireEvent.click(pairing);
    await waitFor(() => { expect(t.display.value.relations).toEqual({ 'gmti.pairing': false }); });
    expect(t.display.choices.relations, 'the switch of a kind not loaded is kept (R5)').toEqual({ 'gone.kind': false, 'gmti.pairing': false });

    fireEvent.click(dialog.getByRole('button', { name: 'Use defaults' }));
    await waitFor(() => { expect(t.writes.at(-1)).toEqual({}); });
    await waitFor(() => { expect(t.display.value.symbolSize).toBe(30); });
  });
});
