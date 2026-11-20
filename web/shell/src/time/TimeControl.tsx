import { Button, Popover } from '@emc2/plugin-sdk';
import { CalendarClock } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { ClockMode, ShellStore, ShellView } from '../ui/store.ts';
import { timeLabel } from './label.ts';
import {
  fractionOf, HOUR, initialChoice, markerText, MINUTE, moved, nearEnd, pickerTime, pickerValue, rescaled, spansDays, valueAt,
  zoomedIn, zoomedOut, ZOOM_OUT_EVERY_MS, type Marker, type TimeChoice,
} from './choice.ts';

const systemNow = () => Date.now();

/** Near an end, a marker's text stays inside the slider. */
const edgeClass = (fraction: number) => (fraction < 0.1 ? ' at-start' : fraction > 0.9 ? ' at-end' : '');

/**
 * The time control in the top bar, beside the clock (ADR-0045 point 3; the owner's design,
 * 2026-11-06): a button that opens a slider with three markers, the set time and an interval's
 * start and stop. Under it Now, the Interval toggle (which greys the markers it does not use), and
 * the date pickers of the slider's start (left) and end (right). Under each marker its time, with the
 * date when the slider covers several days. A new time goes out when a marker is let go, at each
 * arrow key, and at Now, the toggle and a picker. The markers zoom: see `choice.ts`. Times are shown
 * as the clock shows them, in UTC or local time.
 */
export function TimeControl({ view, store, now = systemNow }: {
  readonly view: ShellView;
  readonly store: ShellStore;
  readonly now?: () => number;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    button.current?.querySelector<HTMLElement>(':scope > button')?.focus();
  };
  const choice = view.time;
  const active = choice !== null && !(choice.now && !choice.interval);
  return (
    <div className={active ? 'time-control picked' : 'time-control'} ref={button}>
      <Button icon={CalendarClock} expanded={open} hasPopup="dialog" title="The time shown by temporal plugins" onClick={() => {
        if (open) close();
        else {
          if (view.time === null) store.setTime(initialChoice(now()));
          setOpen(true);
        }
      }}>
        {timeLabel(choice, view.clock)}
      </Button>
      <Popover open={open} label="Time" onClose={close}>
        {view.time === null ? null : <TimeSlider choice={view.time} mode={view.clock} store={store} now={now} />}
      </Popover>
    </div>
  );
}

function TimeSlider({ choice, mode, store, now }: {
  readonly choice: TimeChoice;
  readonly mode: ClockMode;
  readonly store: ShellStore;
  readonly now: () => number;
}) {
  // While a marker is dragged, the choice is local; it goes to the store (and the server) at release.
  const [dragging, setDragging] = useState<{ readonly marker: Marker; readonly choice: TimeChoice } | null>(null);
  const shown = dragging?.choice ?? choice;
  const track = useRef<HTMLDivElement>(null);
  const zoomTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFraction = useRef(0.5);
  const [clockTick, setClockTick] = useState(0);
  const body = useRef<HTMLDivElement>(null);

  // Now: the set time follows the clock, once a minute.
  useEffect(() => {
    if (!choice.now) return;
    const timer = setTimeout(() => { setClockTick((n) => n + 1); }, MINUTE - (now() % MINUTE) + 50);
    return () => { clearTimeout(timer); };
  }, [choice.now, clockTick, now]);
  useEffect(() => () => { if (zoomTimer.current !== null) clearInterval(zoomTimer.current); }, []);
  useEffect(() => { body.current?.querySelector<HTMLElement>('[role="slider"]:not([aria-disabled="true"])')?.focus(); }, []);

  const setAt = choice.now ? Math.min(shown.end, Math.max(shown.start, now())) : shown.set;
  const withDate = spansDays(shown, mode);
  // CR-0032 (owner JA): the set time is always the user's; the interval's markers only with the toggle on.
  const enabled = (m: Marker) => m === 'set' || shown.interval;
  const commit = (next: TimeChoice) => { store.setTime(next); };

  const fractionAt = (clientX: number): number => {
    const r = track.current?.getBoundingClientRect();
    return r === undefined || r.width === 0 ? lastFraction.current : (clientX - r.left) / r.width;
  };
  const stopZoom = () => {
    if (zoomTimer.current !== null) clearInterval(zoomTimer.current);
    zoomTimer.current = null;
  };
  const onPointerDown = (marker: Marker) => (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled(marker)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging({ marker, choice });
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging === null) return;
    const fraction = fractionAt(event.clientX);
    lastFraction.current = fraction;
    setDragging({ marker: dragging.marker, choice: moved(dragging.choice, dragging.marker, valueAt(dragging.choice, fraction)) });
    const end = nearEnd(fraction);
    if (end === null) stopZoom();
    else if (zoomTimer.current === null) {
      // Held at an end: the scale grows away from it, and the marker stays under the pointer.
      zoomTimer.current = setInterval(() => {
        setDragging((d) => {
          if (d === null) return d;
          const grown = zoomedOut(d.choice, end);
          return { marker: d.marker, choice: moved(grown, d.marker, valueAt(grown, lastFraction.current)) };
        });
      }, ZOOM_OUT_EVERY_MS);
    }
  };
  const onPointerUp = () => {
    stopZoom();
    if (dragging !== null) commit(zoomedIn(dragging.choice));
    setDragging(null);
  };
  const onKeyDown = (marker: Marker) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (!enabled(marker)) return;
    const value = marker === 'set' ? setAt : shown[marker];
    const step = event.shiftKey ? HOUR : MINUTE;
    const to = ({
      ArrowLeft: value - step, ArrowDown: value - step, ArrowRight: value + step, ArrowUp: value + step,
      PageDown: value - HOUR, PageUp: value + HOUR, Home: shown.start, End: shown.end,
    } as Readonly<Record<string, number>>)[event.key];
    if (to === undefined) return;
    event.preventDefault();
    commit(zoomedIn(moved(choice, marker, to)));
  };

  const marker = (m: Marker, value: number, name: string) => (
    <div
      key={m}
      className={`time-marker time-marker-${m}${enabled(m) ? '' : ' disabled'}${edgeClass(fractionOf(shown, value))}`}
      style={{ left: `${String(fractionOf(shown, value) * 100)}%` }}
      role="slider"
      tabIndex={enabled(m) ? 0 : -1}
      aria-label={name}
      aria-disabled={!enabled(m)}
      aria-valuemin={shown.start}
      aria-valuemax={shown.end}
      aria-valuenow={value}
      aria-valuetext={markerText(value, mode, true)}
      onPointerDown={onPointerDown(m)}
      onKeyDown={onKeyDown(m)}
    >
      <span className="time-marker-text">{markerText(value, mode, withDate)}</span>
    </div>
  );
  const zone = mode === 'utc' ? ' (UTC)' : ' (local time)';
  return (
    <div className="time-popover" ref={body}>
      <div className="time-track" ref={track} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <div className="time-track-line" />
        {shown.interval ? (
          <div className="time-span" style={{
            left: `${String(fractionOf(shown, shown.from) * 100)}%`,
            width: `${String((fractionOf(shown, shown.to) - fractionOf(shown, shown.from)) * 100)}%`,
          }} />
        ) : null}
        {marker('from', shown.from, 'Start of interval')}
        {marker('to', shown.to, 'Stop of interval')}
        {marker('set', setAt, 'Set time')}
      </div>
      <div className="time-buttons">
        <label className="time-picker">
          <span>Slider start{zone}</span>
          <input type="datetime-local" step={60} value={pickerValue(shown.start, mode)} onChange={(e) => {
            const next = rescaled(choice, pickerTime(e.target.value, mode), choice.end);
            if (next !== null) commit(next);
          }} />
        </label>
        <button type="button" className={choice.now && !choice.interval ? 'emc2-button emc2-button-primary' : 'emc2-button'}
          aria-pressed={choice.now && !choice.interval} onClick={() => {
            commit({ ...choice, now: true, interval: false, set: now() });
          }}>
          <span>Now</span>
        </button>
        <button type="button" className={choice.interval ? 'emc2-button emc2-button-primary' : 'emc2-button'} aria-pressed={choice.interval}
          onClick={() => {
            commit(zoomedIn({ ...choice, interval: !choice.interval }));
          }}>
          <span>Interval</span>
        </button>
        <label className="time-picker">
          <span>Slider end{zone}</span>
          <input type="datetime-local" step={60} value={pickerValue(shown.end, mode)} onChange={(e) => {
            const next = rescaled(choice, choice.start, pickerTime(e.target.value, mode));
            if (next !== null) commit(next);
          }} />
        </label>
      </div>
    </div>
  );
}
