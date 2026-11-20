import { describe, expect, it } from 'vitest';
import { arrowRotation, attributionHtml, cssColor, dashPattern, northOnScreen, rgba, shapeLook } from '../../src/core/appearance.ts';
import { registerProjections, type Projection } from '../../src/core/projections.ts';
import { DEFAULT_SETTINGS } from '../../src/core/settings.ts';

const { projections } = registerProjections(DEFAULT_SETTINGS.projections);
const mercator = projections[0] as Projection;
const polar = projections[1] as Projection;
const DEG = Math.PI / 180;

describe('appearance', () => {
  it('turns #rrggbb and an opacity into rgba, with a fallback for anything else', () => {
    expect(rgba('#ff8000', 0.5)).toEqual([255, 128, 0, 0.5]);
    expect(rgba('#FF8000', undefined)).toEqual([255, 128, 0, 1]);
    expect(rgba('red', 2, '#000000')).toEqual([0, 0, 0, 1]);
    expect(cssColor([1, 2, 3, 0.5])).toBe('rgba(1, 2, 3, 0.5)');
  });

  it('gives shapes a look from their style, with defaults', () => {
    expect(shapeLook({ strokeColor: '#00ff00', strokeWidth: 4, strokeDash: 'dot', fillColor: '#0000ff', fillOpacity: 0.3 }, 'polygon')).toEqual({
      stroke: [0, 255, 0, 1], strokeWidth: 4, dash: 2, fill: [0, 0, 255, 0.3], hatch: false,
    });
    expect(shapeLook({ fillPattern: 'hatch' }, 'polygon').hatch).toBe(true);
    expect(shapeLook({ fillPattern: 'hatch' }, 'line').hatch).toBe(false);
    expect(shapeLook(undefined, 'line').fill[3]).toBe(0);
    expect(shapeLook(undefined, 'polygon').fill).toEqual([31, 78, 140, 0.2]);
    expect(shapeLook({ strokeWidth: 500 }, 'line').strokeWidth).toBe(50);
  });

  it('scales dash patterns with the line width', () => {
    expect(dashPattern(0, 2)).toEqual([]);
    expect(dashPattern(1, 2)).toEqual([8, 6]);
    expect(dashPattern(2, 3)).toEqual([3, 6]);
  });

  it('knows where north is on screen: always up in Web Mercator', () => {
    expect(northOnScreen(mercator, [15, 60])).toBeCloseTo(0, 6);
    expect(northOnScreen(mercator, [-120, -30])).toBeCloseTo(0, 6);
  });

  it('knows where north is on screen in EPSG:3413: towards the pole, turned by the longitude', () => {
    // 15° E is 60° east of the central meridian (−45°): north points up and 60° to the left.
    expect(northOnScreen(polar, [15, 60])).toBeCloseTo(-60 * DEG, 6);
    expect(northOnScreen(polar, [-45, 70])).toBeCloseTo(0, 6);
    expect(Math.abs(northOnScreen(polar, [135, 70]))).toBeCloseTo(Math.PI, 6); // straight down: ±π
  });

  it('turns the direction arrow by the direction plus where north is', () => {
    expect(arrowRotation(mercator, [15, 60], 90)).toBeCloseTo(90 * DEG, 6);
    expect(arrowRotation(polar, [15, 60], 90)).toBeCloseTo(30 * DEG, 6);
  });

  it('escapes a provider attribution and keeps only http(s) links', () => {
    expect(attributionHtml({ text: '© OpenStreetMap', url: 'https://www.openstreetmap.org/copyright' })).toBe(
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>',
    );
    expect(attributionHtml({ text: '<img src=x onerror=alert(1)>' })).toBe('&#60;img src=x onerror=alert(1)&#62;');
    expect(attributionHtml({ text: 'x', url: 'javascript:alert(1)' })).toBe('x');
    expect(attributionHtml({ text: 'x', url: 'https://a.example/"><script>' })).not.toContain('<script>');
  });
});
