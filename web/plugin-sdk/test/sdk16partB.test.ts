// SDK 1.6.0 part B (CR-0041; T-176, owner QG A and QH A): Append, continuing a line from its last point.
import { describe, expect, it } from 'vitest';
import { NotALineError, NotOnMapError, type LineString, type MapView } from '../src/index.ts';
import { createFakeMapView } from '../src/testing/index.ts';

const id = (n: number) => `0192a5c4-3b1e-7c2d-9f00-${n.toString(16).padStart(12, '0')}`;
// Latitude ≠ longitude, the line's own three points first.
const LINE: LineString = { type: 'LineString', coordinates: [[15.2, 58.4], [15.3, 58.45], [15.4, 58.5], [15.5, 58.55], [15.6, 58.6]] };

describe('SDK 1.6.0 part B: MapView.append', () => {
  it('resolves with the line the user continued, and records the call', async () => {
    const map = createFakeMapView();
    const style = { strokeColor: '#1F3A93' };
    const result = map.append(id(1), { style });
    expect(map.runningInteraction).toBe('append');
    map.completeDrawing(LINE);
    await expect(result).resolves.toEqual(LINE);
    expect(map.appendCalls).toEqual([{ id: id(1), style }]);
    expect(map.runningInteraction).toBeNull();
  });

  it('resolves with null on Escape, an abort or another interaction', async () => {
    const map = createFakeMapView();
    const escaped = map.append(id(1));
    map.completeDrawing(null);
    await expect(escaped).resolves.toBeNull();
    const tool = new AbortController();
    const aborted = map.append(id(1), { signal: tool.signal });
    tool.abort();
    await expect(aborted).resolves.toBeNull();
    const replaced = map.append(id(1));
    const drawing = map.draw('line');
    await expect(replaced).resolves.toBeNull();
    map.completeDrawing(null);
    await drawing;
  });

  it('refuses an object not drawn and one that is not a line, unless already aborted', async () => {
    const map = createFakeMapView();
    map.setNotDrawn([id(2)]);
    map.setNotLines([id(3)]);
    await expect(map.append(id(2))).rejects.toBeInstanceOf(NotOnMapError);
    await expect(map.append(id(3))).rejects.toBeInstanceOf(NotALineError);
    const done = new AbortController();
    done.abort();
    await expect(map.append(id(3), { signal: done.signal })).resolves.toBeNull();
    expect(new NotALineError('x').name).toBe('NotALineError');
  });

  it('a right click leaves it running, as for edit (the map view takes back a point)', async () => {
    const map = createFakeMapView();
    const result = map.append(id(1));
    map.rightClick();
    expect(map.runningInteraction).toBe('append');
    map.completeDrawing(LINE);
    await expect(result).resolves.toEqual(LINE);
  });

  it('is required on MapView since the 1.6.0 freeze', () => {
    const view: MapView = createFakeMapView();
    expect(typeof view.append).toBe('function');
  });
});
