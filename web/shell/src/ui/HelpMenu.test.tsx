import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HelpMenu } from './HelpMenu.tsx';
import { helpItems, versionLine } from './help.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const health = (extra: object) => vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ status: 'UP', ecore: 'RUNNING', ...extra })));

describe('the help menu (M9 RC2, owner ACQ)', () => {
  it('says the release, a build from a changed tree, and a developer run', () => {
    expect(versionLine({ name: 'M9-RC1', date: '2026-11-18', commit: 'ea32e90f', dirty: false, sdk: '1.9.0' }))
      .toBe('emcc M9-RC1 · 2026-11-18 · ea32e90f');
    expect(versionLine({ name: 'M9-RC1', date: '2026-11-18', commit: 'ea32e90f', dirty: true }))
      .toBe('emcc M9-RC1 · 2026-11-18 · ea32e90f · uncommitted changes');
    expect(versionLine({ name: 'dev', sdk: '1.9.0' })).toBe('emcc · dev build · SDK 1.9.0');
    expect(versionLine(undefined)).toBe('emcc · version not known');
  });

  it('keeps its items in a list, the manual disabled without one', () => {
    expect(helpItems({ manual: true })).toEqual([{ id: 'manual', label: 'Manual', group: 'docs' }]);
    expect(helpItems({})).toEqual([{ id: 'manual', label: 'Manual not installed', group: 'docs', disabled: true }]);
  });

  it('opens from the "?" button, shows the version only inside, and opens the manual in a new tab', async () => {
    const doFetch = health({ version: { name: 'M9-RC1', date: '2026-11-18', commit: 'ea32e90f', dirty: false, sdk: '1.9.0' }, manual: true });
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<HelpMenu doFetch={doFetch} />);
    expect(screen.queryByText(/M9-RC1/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    const menu = within(screen.getByRole('dialog', { name: 'Help' }));
    expect(await menu.findByText('emcc M9-RC1 · 2026-11-18 · ea32e90f')).toBeTruthy();
    expect(doFetch).toHaveBeenCalledWith('/api/health', expect.anything());
    const manual = menu.getByRole('menuitem', { name: 'Manual' });
    expect(document.activeElement).toBe(manual);

    fireEvent.click(manual);
    expect(opened).toHaveBeenCalledWith('/manual/', '_blank', 'noopener');
    expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Help' }));
  });

  it('says the manual is not installed on a developer run, and closes on Escape', async () => {
    render(<HelpMenu doFetch={health({ version: { name: 'dev', sdk: '1.9.0' }, manual: false })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    const menu = within(screen.getByRole('dialog', { name: 'Help' }));
    const manual = await menu.findByRole<HTMLButtonElement>('menuitem', { name: 'Manual not installed' });
    expect(manual.disabled).toBe(true);
    expect(menu.getByText('emcc · dev build · SDK 1.9.0')).toBeTruthy();
    await waitFor(() => { expect(screen.getByRole('dialog', { name: 'Help' }).contains(document.activeElement)).toBe(true); });

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull();
  });

  it('says the version is not known when the server does not answer', async () => {
    render(<HelpMenu doFetch={vi.fn<typeof fetch>(() => Promise.reject(new Error('offline')))} />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(await screen.findByText('emcc · version not known')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'Manual not installed' }).disabled).toBe(true);
  });
});
