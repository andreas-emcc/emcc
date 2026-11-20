// SDK 1.4.0 part 6 (CR-0030 part 6, ADR-0049 point 8): the overlay's area and label, and its caps.
import { describe, expect, it } from 'vitest';
import {
  OVERLAY_LABEL_MAX_LENGTH, OVERLAY_MAX_ITEMS, OVERLAY_MAX_POSITIONS, overlayProblem,
  type OverlayItem, type Position,
} from '../src/index.ts';
import { createFakeMapView } from '../src/testing/index.ts';

// Latitude differs from longitude in every position (ADR-0007).
const SQUARE: readonly Position[] = [[18.0, 59.3], [18.1, 59.3], [18.1, 59.4], [18.0, 59.4], [18.0, 59.3]];
const HOLE: readonly Position[] = [[18.04, 59.34], [18.04, 59.36], [18.06, 59.36], [18.06, 59.34], [18.04, 59.34]];

describe('overlay area and label', () => {
  it('accepts an area with a hole and a label', () => {
    const items: OverlayItem[] = [
      { kind: 'area', rings: [SQUARE, HOLE], style: { fillColor: '#00ff00', fillOpacity: 0.3, strokeColor: '#008000' } },
      { kind: 'label', position: [18.0723, 59.3311], text: '12.3 km\n045.2°', style: { color: '#ffffff', size: 14, haloColor: '#000000' } },
    ];
    expect(overlayProblem(items)).toBeNull();
  });

  it('refuses open, short and missing rings', () => {
    expect(overlayProblem([{ kind: 'area', rings: [] }])).toMatch(/at least one ring/);
    expect(overlayProblem([{ kind: 'area', rings: [SQUARE.slice(0, 4)] }])).toMatch(/ring 0: not closed/);
    expect(overlayProblem([{ kind: 'area', rings: [SQUARE, [[18.0, 59.3], [18.1, 59.3], [18.0, 59.3]]] }])).toMatch(/ring 1: at least 4/);
  });

  it('refuses empty, long and oddly sized labels', () => {
    expect(overlayProblem([{ kind: 'label', position: [18.07, 59.33], text: '' }])).toMatch(/1 to 256 characters/);
    expect(overlayProblem([{ kind: 'label', position: [18.07, 59.33], text: 'x'.repeat(OVERLAY_LABEL_MAX_LENGTH + 1) }])).toMatch(/characters/);
    expect(overlayProblem([{ kind: 'label', position: [18.07, 59.33], text: 'x', style: { size: 7 } }])).toMatch(/size is 8 to 32/);
  });

  it('caps the items and the positions', () => {
    const point: OverlayItem = { kind: 'point', position: [18.07, 59.33] };
    expect(overlayProblem(Array.from({ length: OVERLAY_MAX_ITEMS }, () => point))).toBeNull();
    expect(overlayProblem(Array.from({ length: OVERLAY_MAX_ITEMS + 1 }, () => point))).toMatch(/more than 20000 items/);
    const ring: Position[] = Array.from({ length: 50_000 }, (_, i) => [18 + i * 1e-6, 59.3] as Position);
    ring.push(ring[0]!);
    const big: OverlayItem = { kind: 'area', rings: [ring] };
    expect(overlayProblem([big, big, big])).toBeNull();
    expect(overlayProblem([big, big, big, big])).toMatch(new RegExp(`more than ${OVERLAY_MAX_POSITIONS} positions`));
  });

  it('the fake map view records each set with its problem', () => {
    const view = createFakeMapView();
    const overlay = view.createOverlay();
    overlay.set([{ kind: 'area', rings: [SQUARE] }]);
    overlay.set([{ kind: 'area', rings: [SQUARE.slice(0, 4)] }]);
    overlay.clear();
    expect(view.overlayItems).toHaveLength(3);
    expect(view.overlayProblems[0]).toBeNull();
    expect(view.overlayProblems[1]).toMatch(/not closed/);
    expect(view.overlayProblems[2]).toBeNull();
  });
});
