import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsServices } from '../../testing/fakes.ts';
import { ShellStore } from '../store.ts';
import { GeneralEntry } from './GeneralEntry.tsx';

function setUp(answer: () => Promise<Response>) {
  const store = new ShellStore();
  const fetched = vi.fn(answer);
  const services = settingsServices(fetched);
  const Shown = () => <GeneralEntry store={store} services={services} installationLook={store.getView().installationLook} />;
  const view = render(<Shown />);
  store.subscribe(() => { view.rerender(<Shown />); });
  return { store, fetched };
}

afterEach(() => {
  cleanup();
});

describe('Settings › General (ADR-0034)', () => {
  it("saves the installation's default look and applies it in this browser at once", async () => {
    const t = setUp(() => Promise.resolve(Response.json({ defaultLook: 'chart-room' })));
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.hasAttribute('disabled')).toBe(true); // nothing changed yet
    fireEvent.change(screen.getByRole('combobox', { name: 'Look' }), { target: { value: 'chart-room' } });
    fireEvent.click(save);
    expect(await screen.findByText('Saved: Chart Room. Users who keep the installation default get it when they next load the page.')).toBeTruthy();
    const [path, init] = t.fetched.mock.calls[0] as unknown as [string, RequestInit];
    expect([path, init.method, init.body]).toEqual(['/api/settings/general', 'PUT', '{"defaultLook":"chart-room"}']);
    expect(t.store.getView().installationLook).toBe('chart-room');
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Look' }).selectedOptions[0]?.text).toBe('Chart Room (now)');
  });

  it('says why when the server refuses, and changes nothing', async () => {
    const t = setUp(() => Promise.resolve(new Response(null, { status: 403 })));
    fireEvent.change(screen.getByRole('combobox', { name: 'Look' }), { target: { value: 'signal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This needs the settings.admin permission.')).toBeTruthy();
    expect(t.store.getView().installationLook).toBe('night-watch');
  });
});
