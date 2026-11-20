import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.tsx';
import { settingsServices } from '../testing/fakes.ts';
import { SPLASH_MILLIS } from './Logo.tsx';
import { ShellStore } from './store.ts';

function shell() {
  const store = new ShellStore();
  store.setLogin({ mode: 'none', user: { id: 'local', name: 'Local user' } });
  render(<App store={store} services={settingsServices()} />);
}

const logo = () => within(screen.getByRole('banner')).getByRole('button', { name: 'Show the emcc splash' });
const splash = () => screen.queryByRole('dialog', { name: 'emcc splash' });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined))); // the server status
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the logo (owner, 2026-10-29)', () => {
  it('is a button in the header, first, showing the logo', () => {
    shell();
    const header = screen.getByRole('banner');
    expect(header.firstElementChild).toBe(logo());
    expect(logo().querySelector('img')?.getAttribute('alt')).toBe(''); // the button carries the name
    expect(header.textContent).not.toContain('emc2'); // the text it replaces
  });

  it('opens the splash at a click, drawn from the logo: four half lines from the gap and the two letter outlines', () => {
    shell();
    expect(splash()).toBeNull();

    fireEvent.click(logo());

    const dialog = splash();
    expect(dialog).not.toBeNull();
    expect(document.activeElement).toBe(dialog);
    const lines = [...(dialog?.querySelectorAll('line') ?? [])];
    expect(lines.map((l) => [l.getAttribute('x1'), l.getAttribute('x2'), l.getAttribute('y1')])).toEqual([
      ['118.5', '10', '51'], ['118.5', '211.36', '51'], ['118.5', '10', '63'], ['118.5', '211.36', '63'],
    ]);
    expect(lines.every((l) => l.getAttribute('stroke') === '#d1d5db')).toBe(true);
    expect(dialog?.querySelectorAll('.splash-wordmark path')).toHaveLength(2);
    expect(dialog?.querySelector('text')).toBeNull(); // no font
  });

  it('closes after 10 s, and the focus goes back to the logo', () => {
    shell();
    fireEvent.click(logo());

    act(() => { vi.advanceTimersByTime(SPLASH_MILLIS - 1); });
    expect(splash()).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(splash()).toBeNull();
    expect(document.activeElement).toBe(logo());
    expect(SPLASH_MILLIS).toBe(10_000);
  });

  it('closes at once on a click outside the pane, a click inside it, or Escape', () => {
    shell();
    fireEvent.click(logo());
    fireEvent.click(splash() as HTMLElement); // the backdrop: everywhere outside the pane
    expect(splash()).toBeNull();

    fireEvent.click(logo());
    fireEvent.click(splash()?.querySelector('.splash path') as Element); // the pane
    expect(splash()).toBeNull();

    fireEvent.click(logo());
    fireEvent.keyDown(splash() as HTMLElement, { key: 'Escape' });
    expect(splash()).toBeNull();

    act(() => { vi.advanceTimersByTime(SPLASH_MILLIS); }); // no timer of a closed splash is left
    expect(splash()).toBeNull();
  });
});
