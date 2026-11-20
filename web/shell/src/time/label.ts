/** The time control's texts (ADR-0045 point 3). */
import { dtg } from '../ui/dtg.ts';
import type { ClockMode, ShellView } from '../ui/store.ts';
import type { TimeChoice } from './choice.ts';

/** Whether a loaded plugin declares `temporal` (ADR-0045 point 3, GF): only then is the control shown. */
export function hasTemporalPlugin(view: ShellView): boolean {
  return view.plugins.some((p) => p.server.active && p.capabilities.includes('temporal'));
}

/**
 * The control's button text (CR-0032): the set time (Now, or a date-time group), then the interval
 * when it is on. When all its times share month and year, these come once at the end (`061851Z ·
 * 062047Z–062247Z NOV 26`), so it fits the top bar; otherwise each time is whole.
 */
export function timeLabel(choice: TimeChoice | null, mode: ClockMode): string {
  if (choice === null || (choice.now && !choice.interval)) return 'Now';
  const times = [...(choice.now ? [] : [choice.set]), ...(choice.interval ? [choice.from, choice.to] : [])].map((ms) => dtg(new Date(ms), mode));
  const months = new Set(times.map((t) => t.split(' ').slice(1).join(' ')));
  const day = (t: string) => (months.size === 1 ? (t.split(' ')[0] ?? t) : t);
  const set = choice.now ? 'Now' : day(times[0] ?? '');
  const tail = months.size === 1 ? ` ${[...months][0] ?? ''}` : '';
  if (!choice.interval) return `${set}${tail}`;
  const [from, to] = times.slice(choice.now ? 0 : 1);
  return `${set} · ${day(from ?? '')}–${day(to ?? '')}${tail}`;
}
