import { describe, expect, it } from 'vitest';
import { RedrawScheduler } from '../../src/core/cadence.ts';
import { FakeClock, uuid } from '../fixtures.ts';

function setup(cadenceMs = 1000) {
  const clock = new FakeClock();
  const redraws: { layer: string; at: number }[] = [];
  const scheduler = new RedrawScheduler(clock, cadenceMs, (layer) => redraws.push({ layer, at: clock.now() }));
  return { clock, redraws, scheduler };
}

describe('redraw cadence (brief function 5)', () => {
  it('draws the first change after a quiet period at once (criterion 2: within 1 s)', () => {
    const { clock, redraws, scheduler } = setup();
    clock.advance(5000);
    scheduler.changed(uuid(1));
    clock.advance(0);
    expect(redraws).toEqual([{ layer: uuid(1), at: 5000 }]);
  });

  it('draws changes that arrive together in one redraw', () => {
    const { clock, redraws, scheduler } = setup();
    scheduler.changed(uuid(1));
    scheduler.changed(uuid(1));
    scheduler.changed(uuid(1));
    clock.advance(0);
    expect(redraws).toHaveLength(1);
  });

  it('criterion 9: 1 000 changes per second redraw a layer about once per second, never per change', () => {
    const { clock, redraws, scheduler } = setup();
    for (let ms = 0; ms < 5000; ms++) {
      scheduler.changed(uuid(1));
      clock.advance(1);
    }
    clock.advance(1000);
    // At 0, 1000, 2000, 3000, 4000 and the last pending changes at 5000.
    expect(redraws.map((r) => r.at)).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
  });

  it('keeps the cadence per layer: a busy layer does not delay another', () => {
    const { clock, redraws, scheduler } = setup();
    scheduler.changed(uuid(1));
    clock.advance(100);
    scheduler.changed(uuid(1));
    scheduler.changed(uuid(2));
    clock.advance(0);
    expect(redraws).toEqual([{ layer: uuid(1), at: 0 }, { layer: uuid(2), at: 100 }]);
    clock.advance(900);
    expect(redraws.at(-1)).toEqual({ layer: uuid(1), at: 1000 });
  });

  it('uses the configured cadence', () => {
    const { clock, redraws, scheduler } = setup(250);
    scheduler.changed(uuid(1));
    clock.advance(10);
    scheduler.changed(uuid(1));
    clock.advance(1000);
    expect(redraws.map((r) => r.at)).toEqual([0, 250]);
  });

  it('cancels a waiting redraw when the layer is forgotten or the scheduler disposed', () => {
    const { clock, redraws, scheduler } = setup();
    scheduler.changed(uuid(1));
    scheduler.changed(uuid(2));
    scheduler.forget(uuid(1));
    clock.advance(0);
    expect(redraws.map((r) => r.layer)).toEqual([uuid(2)]);
    scheduler.changed(uuid(2));
    scheduler.dispose();
    clock.advance(5000);
    expect(redraws).toHaveLength(1);
    expect(clock.pending).toBe(0);
  });
});
