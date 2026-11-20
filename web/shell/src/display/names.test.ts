import { resolveDisplay } from '@emc2/plugin-sdk';
import { describe, expect, it } from 'vitest';
import { changed, secondsText, SPEED_VECTOR_POSITIONS, speedVectorPosition, withLabelAt } from './names.ts';

describe('the speed vector in steps of seconds (SDK 1.5.0 part 3; T-164)', () => {
  it('saves seconds and drops the stored minutes with the change (A1), keeping the other parts', () => {
    expect(changed({ symbolSize: 40, speedVectorMinutes: 7 }, { speedVectorSeconds: 600 })).toEqual({ symbolSize: 40, speedVectorSeconds: 600 });
    expect(changed({ speedVectorMinutes: 7 }, { symbolSize: 20 }), 'another change keeps them').toEqual({ speedVectorMinutes: 7, symbolSize: 20 });
  });

  it('sets one display class switch at a time, keeping the other (SDK 1.6.0 part D)', () => {
    expect(changed({ classes: { 'sensor-coverage': false } }, { displayClass: 'dwell-area', on: false }))
      .toEqual({ classes: { 'sensor-coverage': false, 'dwell-area': false } });
  });

  it('stores the places and the arrow, and carries a stored 1.7.0 list over into them (SDK 1.8.0 part A)', () => {
    const shown = resolveDisplay({ labels: ['speed', 'name', 'direction'] }, {}, []);
    const change = withLabelAt(shown, 'topLeft', 'type');
    expect(change).toEqual({
      labelPlaces: { topLeft: 'type', topRight: 'speed', bottomLeft: null, bottomRight: null, below: 'name' }, directionArrow: true,
    });
    expect(changed({ symbolSize: 40, labels: ['speed', 'name', 'direction'] }, change), 'the list goes with the change')
      .toEqual({ symbolSize: 40, ...change });
    expect(withLabelAt(shown, 'below', 'speed').labelPlaces, 'a label moves, its old place left empty')
      .toEqual({ topLeft: null, topRight: null, bottomLeft: null, bottomRight: null, below: 'speed' });
    expect(withLabelAt(shown, 'below', null).labelPlaces.below).toBeNull();
  });

  it('places stored minutes at their nearest step and names each step', () => {
    expect(SPEED_VECTOR_POSITIONS).toEqual([0, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800]);
    expect(speedVectorPosition(resolveDisplay({ speedVectorMinutes: 4 }, {}, [])), '4 min: 5 min').toBe(7);
    expect(speedVectorPosition(resolveDisplay({}, { speedVectorSeconds: 30 }, []))).toBe(4);
    expect(speedVectorPosition(resolveDisplay({}, {}, []))).toBe(0);
    expect(SPEED_VECTOR_POSITIONS.map(secondsText)).toEqual(['Off', '5 s', '10 s', '15 s', '30 s', '1 min', '2 min', '5 min', '10 min', '20 min', '30 min']);
  });
});
