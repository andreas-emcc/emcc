import { useEffect, useState } from 'react';
import { dtg, fullTime } from './dtg.ts';
import type { ClockMode } from './store.ts';

const systemNow = () => new Date();

/**
 * The clock in the top bar (ADR-0031 point 1): a date-time group, UTC by default; a click switches
 * between UTC and local time (owner, 2026-10-16). It moves on at each full minute. The choice is the
 * user's, kept in the store for the setups (part 7).
 */
export function Clock({ mode, onChange, now = systemNow }: {
  readonly mode: ClockMode;
  readonly onChange: (mode: ClockMode) => void;
  readonly now?: () => Date;
}) {
  const [at, setAt] = useState(now);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = now();
      setAt(current);
      timer = setTimeout(tick, 60_000 - (current.getTime() % 60_000) + 50);
    };
    tick();
    return () => { clearTimeout(timer); };
  }, [now]);
  const other: ClockMode = mode === 'utc' ? 'local' : 'utc';
  return (
    <button
      type="button"
      className="clock"
      title={`${fullTime(at, mode)}. Click for ${other === 'utc' ? 'UTC' : 'local time'}.`}
      aria-label={`Time, ${mode === 'utc' ? 'UTC' : 'local'}: ${dtg(at, mode)}. Switch to ${other === 'utc' ? 'UTC' : 'local time'}`}
      onClick={() => { onChange(other); }}
    >
      {dtg(at, mode)}
    </button>
  );
}
