import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { JsonValue } from '@emc2/plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.tsx';
import { memoryDocuments, settingsServices } from '../testing/fakes.ts';
import { DEFAULT_LAYOUT } from '../ui/layout.ts';
import { addStatusPanel } from '../ui/status.ts';
import { ShellStore } from '../ui/store.ts';
import { NAMED_PREFIX, SETUP_VERSION, Setups } from './setups.ts';

const named = (name: string, clock: string): JsonValue => ({
  version: SETUP_VERSION, shell: { layout: DEFAULT_LAYOUT as unknown as JsonValue, clock }, plugins: {}, name, saved: '2026-10-16T10:00:00.000Z',
});

function shell(initial: Record<string, JsonValue> = {}) {
  const store = new ShellStore();
  store.setLogin({ mode: 'none', user: { id: 'local', name: 'Local user' } });
  addStatusPanel(store);
  store.setPanelCollapsed('core-shell/status', false); // panels start collapsed (T-153)
  const docs = memoryDocuments(initial);
  const setups = new Setups({ store, documents: docs.documents, console: { warn: vi.fn(), error: vi.fn() } });
  render(<App store={store} services={{ ...settingsServices(), setups }} />);
  return { store, docs, setups };
}

const control = () => screen.getByRole('button', { name: 'Setups' });
const menu = () => within(screen.getByRole('dialog', { name: 'Setups' }));
const open = async () => {
  fireEvent.click(control());
  await waitFor(() => { expect(menu().queryByText(/Reading your setups/)).toBeNull(); });
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined))); // the server status
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('the setups control', () => {
  it('sits in the top bar before the clock, and lists the named setups by name when opened', async () => {
    shell({ [`${NAMED_PREFIX}b`]: named('Baltic', 'utc'), [`${NAMED_PREFIX}a`]: named('arctic', 'utc') });
    const end = control().closest('.top-bar-end');
    const order = [...(end?.querySelectorAll('.setups-control, .clock') ?? [])].map((e) => e.className);
    expect(order).toEqual(['setups-control', 'clock']);

    await open();
    expect(menu().getAllByRole('button', { name: /^Restore / }).map((b) => b.textContent)).toEqual(['arctic', 'Baltic']);
    expect(document.activeElement).toBe(menu().getByRole('textbox', { name: 'Save current setup as' }));
  });

  it('restores a setup at a click, without asking, and closes', async () => {
    const { store } = shell({ [`${NAMED_PREFIX}a`]: named('Arctic', 'local') });
    await open();
    fireEvent.click(menu().getByRole('button', { name: 'Restore Arctic' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Setups' })).toBeNull(); });
    expect(store.getView().clock).toBe('local');
    expect(document.activeElement).toBe(control());
  });

  it('saves the current setup under a name, and asks before replacing one of that name', async () => {
    const { store, setups } = shell({ [`${NAMED_PREFIX}a`]: named('Arctic', 'utc') });
    await open();
    const field = menu().getByRole('textbox', { name: 'Save current setup as' });

    fireEvent.click(menu().getByRole('button', { name: 'Save' }));
    expect(await menu().findByText('Enter a name.')).toBeTruthy();

    fireEvent.change(field, { target: { value: 'Baltic' } });
    fireEvent.click(menu().getByRole('button', { name: 'Save' }));
    expect(await menu().findByRole('button', { name: 'Restore Baltic' })).toBeTruthy();
    expect((field as HTMLInputElement).value).toBe('');

    act(() => { store.setClock('local'); });
    fireEvent.change(field, { target: { value: 'arctic' } });
    fireEvent.submit(field);
    const question = await screen.findByRole('alertdialog', { name: 'Replace setup' });
    fireEvent.keyDown(within(question).getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Setups' })).toBeTruthy(); // Escape closed the question only

    fireEvent.submit(field);
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Replace setup' })).getByRole('button', { name: 'Replace' }));
    await waitFor(() => { expect(menu().getByRole('button', { name: 'Restore arctic' })).toBeTruthy(); });
    expect(setups.getState().named?.map((s) => s.name)).toEqual(['arctic', 'Baltic']);
  });

  it('deletes a setup after asking', async () => {
    const { docs } = shell({ [`${NAMED_PREFIX}a`]: named('Arctic', 'utc') });
    await open();
    fireEvent.click(menu().getByRole('button', { name: 'Delete Arctic' }));
    const question = screen.getByRole('alertdialog', { name: 'Delete setup' });
    expect(question.textContent).toContain('Delete the setup Arctic? This cannot be undone.');
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole('dialog', { name: 'Setups' })).toBeTruthy(); // a press outside does not close it under its question
    fireEvent.click(within(question).getByRole('button', { name: 'Delete' }));
    expect(await menu().findByText('No named setups yet.')).toBeTruthy();
    expect(docs.stored.has(`${NAMED_PREFIX}a`)).toBe(false);
  });

  it('says when the setups cannot be read, and closes on Escape and on a click outside', async () => {
    const { docs } = shell();
    docs.fail(new Error('no answer'));
    fireEvent.click(control());
    expect(await menu().findByText('Your named setups could not be read: no answer')).toBeTruthy();
    expect(menu().getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
    fireEvent.keyDown(menu().getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Setups' })).toBeNull();

    docs.fail(null);
    await open();
    expect(menu().queryByRole('alert')).toBeNull(); // the old error is not shown again (review F7)
    fireEvent.pointerDown(control());
    expect(screen.getByRole('dialog', { name: 'Setups' })).toBeTruthy(); // a press on its own button is not outside
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Setups' })).toBeNull();
    expect(document.activeElement).toBe(control());
  });
});

describe('the Status panel', () => {
  it('says when the setup is not remembered in this session', () => {
    const { store } = shell();
    act(() => { store.setSetupProblem('not remembered in this session: it could not be read from the server (no answer)'); });
    expect(screen.getByRole('status', { name: 'Setup' }).textContent).toBe('Setup: not remembered in this session: it could not be read from the server (no answer)');
  });
});
