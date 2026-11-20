import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { DataType } from '@emc2/plugin-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pluginEntry, settingsServices } from '../../testing/fakes.ts';
import { ShellStore } from '../store.ts';
import { describeBehaviour } from './behaviour.ts';
import { readTime, unitOf } from './durations.ts';
import { SettingsView } from './SettingsView.tsx';

const GENERAL: DataType = {
  id: 'core.general', name: 'General', description: 'The built-in data type.', declaredBy: null,
  defaults: { fadeWhenExpired: false }, behaviour: { fadeWhenExpired: false },
};
const COT: DataType = {
  id: 'cot.cot', name: 'CoT', declaredBy: 'cot',
  defaults: { fadeWhenExpired: true, removeAfterExpirySeconds: 600 }, behaviour: { expiresAfterSeconds: 60, fadeWhenExpired: false },
};

function show(answer: (method: string, path: string, body: unknown) => Response) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const services = settingsServices((input, init) => {
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: pathOf(input), body });
    return Promise.resolve(answer(method, pathOf(input), body));
  });
  services.shared.initialDataTypes([GENERAL, COT]);
  const store = new ShellStore();
  store.setPlugins([pluginEntry('cot', { name: 'Cursor on Target' })]);
  render(<SettingsView services={services} plugins={store.getView().plugins} />);
  return { calls, services };
}

const pathOf = (input: RequestInfo | URL): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

afterEach(() => {
  cleanup();
});

describe('the Data types table (T-203 part D)', () => {
  const field = (label: string) => screen.getByLabelText<HTMLInputElement>(label);
  const unit = (label: string) => screen.getByLabelText<HTMLSelectElement>(`Unit, ${label}`);
  const save = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });

  it('shows a row per data type with who declares it and its values, a time in its largest even unit', () => {
    show(() => new Response('', { status: 500 }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Data types');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((r) => [within(r).getByRole('rowheader').textContent, within(r).getAllByRole('cell')[0]?.textContent]))
      .toEqual([['Generalcore.general', 'Built in'], ['CoTcot.cot', 'Cursor on Target']]);
    expect(rows[0]?.getAttribute('title')).toBe('The built-in data type.');
    expect(field('Expires after, CoT').value).toBe('1');
    expect(unit('Expires after, CoT').value).toBe('minutes');
    expect(field('Remove after, CoT').value).toBe('');
    expect(field('Remove after, CoT').placeholder).toBe('never');
    expect(field('Fade, CoT').checked).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Back to the defaults, General' }).disabled, 'at its defaults').toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Back to the defaults, CoT' }).disabled).toBe(false);
    expect(save().disabled).toBe(true);
  });

  it('saves every changed data type with one Save, a time in its unit', async () => {
    const { calls, services } = show((_method, path, body) => Response.json({ ...(path.endsWith('cot.cot') ? COT : GENERAL), behaviour: body }));
    fireEvent.change(field('Expires after, General'), { target: { value: '5' } });
    fireEvent.change(unit('Expires after, General'), { target: { value: 'minutes' } });
    fireEvent.click(field('Fade, CoT'));
    expect(services.drafts.keys()).toEqual(['data-type/core.general', 'data-type/cot.cot']);
    expect(screen.getByText('2 unsaved changes')).toBeTruthy();
    fireEvent.click(save());
    expect((await screen.findByText('Saved.')).getAttribute('role')).toBe('status');
    expect(calls).toEqual([
      { method: 'PUT', path: '/api/settings/data-types/core.general', body: { expiresAfterSeconds: 300, fadeWhenExpired: false } },
      { method: 'PUT', path: '/api/settings/data-types/cot.cot', body: { expiresAfterSeconds: 60, fadeWhenExpired: true } },
    ]);
    expect(services.drafts.any()).toBe(false);
  });

  it("keeps a refused row's draft and says why under it; the saved ones leave theirs", async () => {
    const { services } = show((_method, path, body) => (path.endsWith('cot.cot')
      ? Response.json({ problems: [{ path: '/removeAfterExpirySeconds', problem: 'must be at least 0' }] }, { status: 400 })
      : Response.json({ ...GENERAL, behaviour: body })));
    fireEvent.change(field('Expires after, General'), { target: { value: '30' } });
    fireEvent.change(field('Remove after, CoT'), { target: { value: '10' } });
    fireEvent.click(save());
    expect((await screen.findByText(/1 of 2 saved/)).getAttribute('role')).toBe('alert');
    expect(services.drafts.keys()).toEqual(['data-type/cot.cot']);
    const cot = field('Remove after, CoT').closest('tr') as HTMLElement;
    expect(within(cot).getByText('Not saved')).toBeTruthy();
    expect(field('Remove after, CoT').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Remove after: must be at least 0')).toBeTruthy();
    fireEvent.change(field('Remove after, CoT'), { target: { value: '20' } });
    expect(screen.queryByText('Not saved'), 'gone once the row is edited').toBeNull();
  });

  it('keeps text that is not a whole number, marks it and does not save', () => {
    show(() => new Response('', { status: 500 }));
    fireEvent.change(field('Expires after, General'), { target: { value: '1.5' } });
    expect(field('Expires after, General').value).toBe('1.5');
    expect(field('Expires after, General').getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(field('Fade, General'));
    expect(save().disabled).toBe(true);
  });

  it('sets one data type back to its defaults at once, only without unsaved edits', async () => {
    const { calls } = show(() => Response.json({ ...COT, behaviour: COT.defaults }));
    const back = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Back to the defaults, CoT' });
    fireEvent.change(field('Expires after, CoT'), { target: { value: '90' } });
    expect(back().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    fireEvent.click(back());
    expect(await screen.findByText('Back to the defaults.')).toBeTruthy();
    expect(calls).toEqual([{ method: 'DELETE', path: '/api/settings/data-types/cot.cot', body: undefined }]);
  });

  it('sets all back after a question, only without unsaved edits', async () => {
    const { calls } = show(() => Response.json({ ...COT, behaviour: COT.defaults }));
    const all = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Use defaults for all' });
    fireEvent.click(field('Fade, General'));
    expect(all().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    fireEvent.click(all());
    const ask = within(screen.getByRole('alertdialog', { name: 'Use the defaults for 1 data type?' }));
    expect(ask.getByText("CoT go back to their plugins' defaults at once.")).toBeTruthy();
    fireEvent.click(ask.getByRole('button', { name: 'Use defaults' }));
    await screen.findByText('Back to the defaults.');
    expect(calls).toEqual([{ method: 'DELETE', path: '/api/settings/data-types/cot.cot', body: undefined }]);
  });

  it('follows changes made in another browser, and says so in an edited row', () => {
    const { services } = show(() => new Response('', { status: 500 }));
    act(() => { services.shared.dataTypesChanged([GENERAL, { ...COT, behaviour: { fadeWhenExpired: true, expiresAfterSeconds: 7200 } }]); });
    expect(field('Expires after, CoT').value).toBe('2');
    expect(unit('Expires after, CoT').value).toBe('hours');
    expect(field('Fade, CoT').checked).toBe(true);

    fireEvent.click(field('Fade, General'));
    act(() => { services.shared.dataTypesChanged([{ ...GENERAL, behaviour: { fadeWhenExpired: false, expiresAfterSeconds: 9 } }, COT]); });
    expect(screen.getByText(/Someone else saved this data type/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Take their values' }));
    expect(field('Expires after, General').value).toBe('9');
    expect(services.drafts.any()).toBe(false);
  });

  it('starts a field with unreadable text again on Discard, so it no longer holds Save', () => {
    show(() => new Response('', { status: 500 }));
    fireEvent.click(field('Fade, CoT'));
    fireEvent.change(field('Expires after, General'), { target: { value: '5' } });
    fireEvent.change(field('Expires after, General'), { target: { value: '5x' } });
    expect(save().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(field('Expires after, General').value).toBe('');
    expect(field('Expires after, General').hasAttribute('aria-invalid')).toBe(false);
    fireEvent.click(field('Fade, CoT'));
    expect(save().disabled, 'Save comes back with an edit').toBe(false);
  });

  it('turns the rows off while saving, and says "Not reset" for a refused reset', async () => {
    let answer: (r: Response) => void = () => undefined;
    const { services } = show((method) => (method === 'DELETE'
      ? Response.json({ problems: [] }, { status: 403 })
      : (null as unknown as Response)));
    services.api.saveDataType = () => new Promise((resolve) => { answer = (r) => { void r.json().then((v: DataType) => { resolve({ ok: true, value: v }); }); }; });
    fireEvent.click(field('Fade, General'));
    fireEvent.click(save());
    expect(field('Fade, General').disabled).toBe(true);
    expect(field('Expires after, CoT').disabled).toBe(true);
    await act(async () => { answer(Response.json({ ...GENERAL, behaviour: { fadeWhenExpired: true } })); await Promise.resolve(); });
    await screen.findByText('Saved.');
    expect(field('Fade, General').disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Back to the defaults, CoT' }));
    expect(await screen.findByText('Not reset')).toBeTruthy();
  });

  it('reads a time in a unit', () => {
    expect(readTime('9'.repeat(20), 'hours'), 'beyond a safe whole number').toBe('invalid');
    expect([readTime('', 'hours'), readTime(' 3 ', 'minutes'), readTime('1.5', 'seconds'), readTime('-1', 'seconds')]).toEqual(['never', 180, 'invalid', 'invalid']);
    expect([unitOf(undefined), unitOf(0), unitOf(90), unitOf(120), unitOf(7200)]).toEqual(['seconds', 'seconds', 'seconds', 'minutes', 'hours']);
  });

  it('describes a behaviour in words', () => {
    expect(describeBehaviour({})).toBe('never expire, not faded, never removed');
    expect(describeBehaviour({ expiresAfterSeconds: 60, fadeWhenExpired: true, removeAfterExpirySeconds: 0 }))
      .toBe('expire after 60 s, faded when expired, removed 0 s after expiry');
  });
});

describe('the shell with unsaved settings', () => {
  it('asks before the page is left', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined))); // the server status
    const { App } = await import('../../App.tsx');
    const services = settingsServices();
    render(<App store={new ShellStore()} services={services} />);
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);
    services.drafts.edit('plugin/a', { x: 1 }, { x: 2 });
    expect(leave()).toBe(true);
    vi.unstubAllGlobals();
  });

  it("drops the unsaved edits of a plugin's entry that is gone, and keeps the others", async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined))); // the server status
    const { App } = await import('../../App.tsx');
    const services = settingsServices();
    const store = new ShellStore();
    store.setPlugins([pluginEntry('coordinates', { hasSettings: true }), pluginEntry('gmti', { hasSettings: true })]);
    store.setLogin({ mode: 'none', user: { id: 'local', name: 'Local user' } });
    render(<App store={store} services={services} />);
    services.drafts.edit('plugin/coordinates', { x: 1 }, { x: 2 });
    services.drafts.edit('plugin/coordinates#/grids/@0', { x: 1 }, { x: 2 });
    services.drafts.edit('plugin/gmti#/links/@0', { x: 1 }, { x: 2 });
    services.drafts.edit('data-type/core.general', { fadeWhenExpired: false }, { fadeWhenExpired: true });

    act(() => { store.setPlugins([pluginEntry('coordinates', { hasSettings: false }), pluginEntry('gmti', { hasSettings: true })]); });

    expect(services.drafts.get('plugin/coordinates')).toBeUndefined();
    expect(services.drafts.get('plugin/coordinates#/grids/@0'), "a list item's draft goes with its entry (T-203 part D)").toBeUndefined();
    expect(services.drafts.get('plugin/gmti#/links/@0'), 'and stays with it').toBeDefined();
    expect(services.drafts.get('data-type/core.general')).toBeDefined();
    vi.unstubAllGlobals();
  });

  it('drops every unsaved edit of a user who may no longer see Settings', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined))); // the server status
    const { App } = await import('../../App.tsx');
    const services = settingsServices();
    const store = new ShellStore();
    store.setPlugins([pluginEntry('coordinates', { hasSettings: true })]);
    store.setLogin({ mode: 'oidc', user: { id: 'a', name: 'Alice', permissions: ['settings.admin'] } });
    render(<App store={store} services={services} />);
    services.drafts.edit('plugin/coordinates', { x: 1 }, { x: 2 });
    services.drafts.edit('data-type/core.general', { fadeWhenExpired: false }, { fadeWhenExpired: true });

    act(() => { store.setLogin({ mode: 'oidc', user: { id: 'a', name: 'Alice', permissions: [] } }); });

    expect(services.drafts.any()).toBe(false);
    vi.unstubAllGlobals();
  });
});
