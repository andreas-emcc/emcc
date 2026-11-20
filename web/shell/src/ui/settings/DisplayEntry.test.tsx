import type { RelationKind } from '@emc2/plugin-sdk';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DisplayState } from '../../display/state.ts';
import { SettingsApi } from './api.ts';
import { DisplayEntry } from './DisplayEntry.tsx';

const GMTI = { id: 'gmti.pairing', label: 'GMTI Pairing', defaultOn: true } as unknown as RelationKind;

afterEach(() => {
  cleanup();
});

async function setUp(save: (body: unknown) => Response) {
  const display = new DisplayState({
    relationKinds: [GMTI],
    fetch: () => Promise.resolve(Response.json({ choices: { symbolSize: 50 }, defaults: { speedVectorMinutes: 5 } })),
  });
  await display.load();
  const calls: { readonly path: string; readonly method?: string; readonly body: unknown }[] = [];
  const api = new SettingsApi(vi.fn<typeof fetch>((input, init) => {
    const body: unknown = JSON.parse(init?.body as string);
    calls.push({ path: input as string, ...(init?.method === undefined ? {} : { method: init.method }), body });
    return Promise.resolve(save(body));
  }));
  render(<DisplayEntry api={api} display={display} />);
  return { display, calls };
}

describe('Settings › Display (ADR-0052 point 5; owner, 2026-11-07)', () => {
  it('edits the admin\'s defaults, not the admin\'s own choices, and saves them', async () => {
    const t = await setUp((body) => Response.json({ defaults: body }));
    const size = screen.getByRole<HTMLInputElement>('slider', { name: /^Symbol size/ });
    expect(size.value, 'the defaults, not the user\'s 50').toBe('30');
    const speed = screen.getByRole<HTMLInputElement>('slider', { name: /^Speed vector/ });
    expect(speed.getAttribute('aria-valuetext'), 'stored minutes as their step (T-164)').toBe('5 min');
    expect(speed.value).toBe('7');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.hasAttribute('disabled')).toBe(true);

    fireEvent.change(size, { target: { value: '40' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'GMTI Pairing' }));
    fireEvent.click(save);
    expect(await screen.findByText('Saved. Users who have not set their own get these at once.')).toBeTruthy();
    // SDK 1.8.0 (CR-0043 part A): the admin's defaults store places and the arrow, as the user's do
    fireEvent.change(screen.getByRole('combobox', { name: 'Bottom right' }), { target: { value: 'dtg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(t.calls).toHaveLength(2); });
    expect(t.calls[1]?.body).toEqual({ speedVectorMinutes: 5, symbolSize: 40, relations: { 'gmti.pairing': false }, directionArrow: true,
      labelPlaces: { topLeft: null, topRight: 'uniqueDesignation', bottomLeft: null, bottomRight: 'dtg', below: 'name' } });
    t.calls.splice(1);
    expect(t.calls).toEqual([{ path: '/api/settings/display', method: 'PUT', body: { speedVectorMinutes: 5, symbolSize: 40, relations: { 'gmti.pairing': false } } }]);
    expect(t.display.defaults).toEqual({ speedVectorMinutes: 5, symbolSize: 40, relations: { 'gmti.pairing': false }, directionArrow: true,
      labelPlaces: { topLeft: null, topRight: 'uniqueDesignation', bottomLeft: null, bottomRight: 'dtg', below: 'name' } });
    expect(t.display.value.symbolSize, 'the admin\'s own choice still wins for them').toBe(50);

    fireEvent.click(screen.getByRole('button', { name: 'Built-in defaults' }));
    expect(screen.getByRole<HTMLInputElement>('slider', { name: /^Speed vector/ }).value).toBe('0');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); await Promise.resolve(); });
    expect(t.calls.at(-1)?.body).toEqual({});
  });

  it('says why when the server refuses', async () => {
    await setUp(() => Response.json({ problems: [{ path: '', problem: 'label listed twice: name' }] }, { status: 400 }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Direction arrow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('The server refused the values; nothing was changed. label listed twice: name')).toBeTruthy();
  });
});
