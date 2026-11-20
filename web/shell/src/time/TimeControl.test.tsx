import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { pluginEntry } from '../testing/fakes.ts';
import { ShellStore } from '../ui/store.ts';
import { TopBar } from '../ui/TopBar.tsx';
import { userTimeOf } from './choice.ts';
import { hasTemporalPlugin } from './label.ts';
import { TimeControl } from './TimeControl.tsx';

const NOW = Date.parse('2026-11-06T12:00:00Z');

function setUp() {
  const store = new ShellStore();
  const Shown = () => <TimeControl view={store.getView()} store={store} now={() => NOW} />;
  const view = render(<Shown />);
  store.subscribe(() => { view.rerender(<Shown />); });
  return { store };
}

const time = (store: ShellStore) => userTimeOf(store.getView().time);

afterEach(() => {
  cleanup();
});

describe('the time control (ADR-0045 point 3; the owner\'s design, 2026-11-06)', () => {
  it('shows only while a loaded plugin declares temporal', () => {
    const store = new ShellStore();
    store.setPlugins([pluginEntry('cot')]);
    expect(hasTemporalPlugin(store.getView())).toBe(false);
    const view = render(<TopBar view={store.getView()} store={store} />);
    expect(screen.queryByRole('button', { name: 'Now' })).toBeNull();

    store.setPlugins([pluginEntry('cot'), pluginEntry('grib', { capabilities: ['temporal'] })]);
    view.rerender(<TopBar view={store.getView()} store={store} />);
    expect(screen.getByRole('button', { name: 'Now' })).toBeTruthy();
    store.setPlugins([pluginEntry('grib', { capabilities: ['temporal'], active: false })]);
    expect(hasTemporalPlugin(store.getView()), 'not running').toBe(false);
  });

  it('opens at now ± 12 h; a marker moved by the keys sets the time, and the toggle picks the interval', () => {
    const t = setUp();
    fireEvent.click(screen.getByRole('button', { name: 'Now' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Time' }));
    const set = dialog.getByRole('slider', { name: 'Set time' });
    expect(document.activeElement).toBe(set);
    expect(dialog.getByLabelText<HTMLInputElement>('Slider start (UTC)').value).toBe('2026-11-06T00:00');
    expect(dialog.getByLabelText<HTMLInputElement>('Slider end (UTC)').value).toBe('2026-11-07T00:00');
    expect(dialog.getByRole('slider', { name: 'Start of interval' }).getAttribute('aria-disabled'), 'greyed').toBe('true');
    expect(time(t.store)).toEqual({});

    fireEvent.keyDown(set, { key: 'ArrowLeft', shiftKey: true });
    expect(time(t.store)).toEqual({ time: '2026-11-06T11:00:00.000Z' });
    expect(set.getAttribute('aria-valuetext')).toBe('06 NOV 11:00');
    expect(screen.getByRole('button', { name: '061100Z NOV 26' })).toBeTruthy();

    // CR-0032 (owner JA): the interval comes on top of the set time, which stays the user's.
    fireEvent.click(dialog.getByRole('button', { name: 'Interval' }));
    expect(dialog.getByRole('button', { name: 'Interval' }).getAttribute('aria-pressed')).toBe('true');
    const interval = { from: '2026-11-06T11:00:00.000Z', to: '2026-11-06T13:00:00.000Z' };
    expect(time(t.store)).toEqual({ time: '2026-11-06T11:00:00.000Z', interval });
    expect(set.getAttribute('aria-disabled'), 'the set time is not greyed').toBe('false');
    expect(screen.getByRole('button', { name: '061100Z · 061100Z–061300Z NOV 26' }), 'one month and year for both').toBeTruthy();
    // 2 h of a 24 h scale is under 10 %: the scale zooms in to 4 times the interval around it.
    expect(dialog.getByLabelText<HTMLInputElement>('Slider start (UTC)').value).toBe('2026-11-06T08:00');
    expect(dialog.getByLabelText<HTMLInputElement>('Slider end (UTC)').value).toBe('2026-11-06T16:00');
    fireEvent.keyDown(set, { key: 'Home' });
    expect(time(t.store), 'the set time may lie outside the interval').toEqual({ time: '2026-11-06T08:00:00.000Z', interval });
    fireEvent.keyDown(dialog.getByRole('slider', { name: 'Stop of interval' }), { key: 'End' });
    expect(time(t.store)).toEqual({ time: '2026-11-06T08:00:00.000Z', interval: { ...interval, to: '2026-11-06T16:00:00.000Z' } });

    fireEvent.click(dialog.getByRole('button', { name: 'Now' }));
    expect(time(t.store), 'Now resets both parts (owner)').toEqual({});
    expect(dialog.getByRole('button', { name: 'Interval' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(dialog.getByRole('button', { name: 'Interval' }));
    expect(time(t.store), 'now with an interval').toEqual({ interval: { from: '2026-11-06T11:00:00.000Z', to: '2026-11-06T16:00:00.000Z' } });
    expect(screen.getByRole('button', { name: 'Now · 061100Z–061600Z NOV 26' })).toBeTruthy();
  });

  it('takes the pickers\' ends, refusing a start that is not 10 minutes before the end', () => {
    const t = setUp();
    fireEvent.click(screen.getByRole('button', { name: 'Now' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Time' }));

    fireEvent.change(dialog.getByLabelText('Slider start (UTC)'), { target: { value: '2026-11-05T00:00' } });
    expect(t.store.getView().time?.start).toBe(Date.parse('2026-11-05T00:00:00Z'));
    fireEvent.change(dialog.getByLabelText('Slider end (UTC)'), { target: { value: '2026-11-05T00:05' } });
    expect(t.store.getView().time?.end).toBe(Date.parse('2026-11-07T00:00:00Z'));
  });
});
