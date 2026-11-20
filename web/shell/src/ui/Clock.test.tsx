import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Clock } from './Clock.tsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the clock', () => {
  it('moves on at each full minute, and says the full time on hover', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T10:45:30Z'));
    render(<Clock mode="utc" onChange={() => undefined} now={() => new Date()} />);
    const clock = screen.getByRole('button');
    expect(clock.textContent).toBe('161045Z OCT 26');
    expect(clock.title).toBe('2026-10-16 10:45 UTC. Click for local time.');
    act(() => { vi.advanceTimersByTime(29_000); });
    expect(clock.textContent).toBe('161045Z OCT 26');
    act(() => { vi.advanceTimersByTime(1_100); }); // past 10:46:00
    expect(clock.textContent).toBe('161046Z OCT 26');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(clock.textContent).toBe('161047Z OCT 26');
  });
});
