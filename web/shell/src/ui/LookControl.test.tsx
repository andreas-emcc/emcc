import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LookControl } from './LookControl.tsx';
import { ShellStore } from './store.ts';

function setUp() {
  const store = new ShellStore();
  store.setInstallationLook('chart-room');
  const Shown = () => <LookControl view={store.getView()} store={store} />;
  const view = render(<Shown />);
  store.subscribe(() => { view.rerender(<Shown />); });
  return { store };
}

afterEach(() => {
  cleanup();
});

describe('the look control (ADR-0034; owner, 2026-10-17)', () => {
  it('offers the three choices, naming the defaults they come to, and applies each at once', () => {
    const t = setUp();
    fireEvent.click(screen.getByRole('button', { name: 'Look' }));
    const menu = within(screen.getByRole('dialog', { name: 'Look' }));
    const look = menu.getByRole<HTMLSelectElement>('combobox', { name: 'Look' });
    expect(document.activeElement).toBe(look); // so that Escape works at once
    expect([...look.options].map((o) => o.text)).toEqual(['Installation default (Chart Room)', 'Night Watch', 'Chart Room', 'Signal']);
    expect([...menu.getByRole<HTMLSelectElement>('combobox', { name: 'Density' }).options].map((o) => o.text))
      .toEqual(["The look's default (Comfortable)", 'Compact', 'Comfortable']);

    fireEvent.change(look, { target: { value: 'signal' } });
    expect(t.store.getView().look).toEqual({ look: 'signal', scheme: 'system', density: 'look' });
    expect(menu.getByRole<HTMLSelectElement>('combobox', { name: 'Density' }).options[0]?.text).toBe("The look's default (Compact)");
    fireEvent.change(menu.getByRole('combobox', { name: 'Light or dark' }), { target: { value: 'dark' } });
    fireEvent.change(menu.getByRole('combobox', { name: 'Density' }), { target: { value: 'comfortable' } });
    expect(t.store.getView().look).toEqual({ look: 'signal', scheme: 'dark', density: 'comfortable' });

    fireEvent.keyDown(look, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Look' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Look' }));
  });

  it('closes on a press outside, and a press on its own button opens and closes it (review F11)', () => {
    setUp();
    const outside = document.body.appendChild(document.createElement('div'));
    fireEvent.click(screen.getByRole('button', { name: 'Look' }));
    expect(screen.getByRole('dialog', { name: 'Look' })).toBeTruthy();
    fireEvent.pointerDown(outside);
    expect(screen.queryByRole('dialog', { name: 'Look' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Look' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Look' }));
    expect(screen.getByRole('dialog', { name: 'Look' })).toBeTruthy(); // its own button is not outside
    fireEvent.click(screen.getByRole('button', { name: 'Look' }));
    expect(screen.queryByRole('dialog', { name: 'Look' })).toBeNull();
    outside.remove();
  });
});
