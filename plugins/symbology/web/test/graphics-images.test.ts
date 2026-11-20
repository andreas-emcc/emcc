// @vitest-environment node
// Brief function 15 (SDK 1.5.0 part 2, CR-0039): the icons inside 21 graphics, as GraphicRendering.images.
import { describe, expect, it } from 'vitest';
import type { GraphicCatalogEntry, GraphicRendering } from '@emc2/plugin-sdk';
import { RENDERER_VERSIONS, type GraphicStandard } from '../src/graphics/catalogue.ts';
import { callRenderer, createEngine } from '../src/graphics/engine.ts';
import { byKey, parse, prepare, svgSize } from '../src/graphics/render.ts';

const engine = createEngine();

/** The 21 graphics of function 15 (README "Images inside graphics"): 14 in APP-6D, 7 in APP-6E. */
const WITH_IMAGES: Readonly<Record<GraphicStandard, readonly string[]>> = {
  'APP-6D': ['270706', '270707', '270800', '270801', '270900', '270901', '271700', '271701', '271800', '271801', '271900', '272000', '272001', '290101'],
  'APP-6E': ['271700', '271701', '271800', '271801', '271900', '272000', '272001'],
};

/** Sample points round Uppsala, latitude ≠ longitude. */
const SAMPLE: readonly (readonly [number, number])[] = [
  [17.6, 59.9],
  [17.9, 59.85],
  [17.8, 60.1],
  [17.65, 60.05],
  [17.7, 59.95],
  [17.75, 60.0],
];

function requestFor(entry: GraphicCatalogEntry) {
  return {
    standard: entry.standard,
    sidc: `${String(RENDERER_VERSIONS[entry.standard])}03${entry.symbolSet}0000${entry.entity}0000`,
    points: SAMPLE.slice(0, Math.max(entry.minPoints, 1)),
    modifiers: { distances: [3000, 6000], azimuths: [10, 80], uniqueDesignation: 'T' },
    resolution: 13,
    extent: [17, 59, 19, 61] as const,
  };
}

const ok = (r: GraphicRendering) => {
  if (!r.ok) throw new Error(r.reason);
  return r;
};

describe('criterion 25: the 21 graphics', () => {
  it.each(['APP-6D', 'APP-6E'] as const)('%s: images on exactly the graphics of function 15, each an SVG data URI of a size above 0; no other graphic has images', (standard) => {
    const found: string[] = [];
    for (const entry of engine.catalogue(standard)) {
      const r = ok(engine.render(requestFor(entry)).rendering);
      if (r.images === undefined) continue;
      found.push(entry.entity);
      expect(r.images.length, entry.name).toBeGreaterThan(0);
      for (const image of r.images) {
        expect(image.svg.startsWith('data:image/svg+xml'), entry.name).toBe(true);
        expect(image.width, entry.name).toBeGreaterThan(0);
        expect(image.height, entry.name).toBeGreaterThan(0);
      }
    }
    expect(found).toEqual(WITH_IMAGES[standard]);
  });
});

describe('criterion 26: placing', () => {
  it.each([
    ['APP-6D', /minefield/i],
    ['APP-6E', /contaminated/i],
  ] as const)("%s: each image's position and angle are mil-sym-ts's own for the same request, its size the SVG's", (standard, name) => {
    const entry = engine.catalogue(standard).find((e) => WITH_IMAGES[standard].includes(e.entity) && name.test(e.name));
    if (entry === undefined) throw new Error(`no ${standard} graphic like ${String(name)}`);
    const request = requestFor(entry);
    const call = prepare(request, () => byKey(engine.catalogue(standard)));
    if ('ok' in call) throw new Error(call.reason);
    const json = JSON.parse(callRenderer(call)) as { features: { geometry: { type: string; coordinates: number[] }; properties: Record<string, unknown> }[] };
    const own = json.features.filter((f) => f.geometry.type === 'Point' && typeof f.properties['image'] === 'string');
    const images = ok(engine.render(request).rendering).images ?? [];
    expect(images).toHaveLength(own.length);
    images.forEach((image, i) => {
      const point = own[i];
      if (point === undefined) throw new Error('fewer image points');
      // Longitude first: the image lies at the graphic's longitude (about 17.7), not its latitude (about 60).
      expect(image.position).toEqual([point.geometry.coordinates[0], point.geometry.coordinates[1]]);
      expect(image.position[0]).toBeLessThan(18);
      expect(image.angle).toBe(Number(point.properties['rotation']));
      expect(image.svg).toBe(point.properties['image']);
      expect([image.width, image.height]).toEqual(Object.values(svgSize(image.svg) ?? {}));
    });
  });
});

/** mil-sym-ts's result for one line and one image point, with the image's text given. */
function doctored(image: unknown): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[17.6, 59.9], [17.9, 59.85]] }, properties: { strokeColor: '#000000', strokeWidth: 3 } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [17.7, 59.95] }, properties: { image, rotation: 30 } },
    ],
  });
}

const SVG = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="81" height="25"></svg>')}`;

describe('criterion 27: left out', () => {
  it.each([
    ['a PNG data URI', 'data:image/png;base64,iVBORw0KGgo='],
    ['a URL', 'http://example.org/mine.svg'],
    ['an SVG without a size', `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg"></svg>')}`],
    ['an SVG that is not base64', 'data:image/svg+xml;base64,@@@'],
    ['not text', 42],
  ])('an image point with %s is left out, and the graphic still draws', (_case, image) => {
    const r = ok(parse(doctored(image)).rendering);
    expect(r.lines).toHaveLength(1);
    expect(r.images).toBeUndefined();
    expect(r.labels).toEqual([]);
  });

  it('an SVG data URI is kept with its size, angle and position, longitude first', () => {
    expect(ok(parse(doctored(SVG)).rendering).images).toEqual([{ position: [17.7, 59.95], svg: SVG, width: 81, height: 25, angle: 30 }]);
  });
});

describe("svgSize: the SVG's own size", () => {
  const uri = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;
  it.each([
    ['width and height', '<svg width="81" height="25" viewBox="0 0 10 10">', { width: 81, height: 25 }],
    ['px units', "<svg width='12px' height='8.5px'>", { width: 12, height: 8.5 }],
    ['the viewBox without width and height', '<svg viewBox="0 0 40 30">', { width: 40, height: 30 }],
    ['the viewBox when the width is a percentage', '<svg width="100%" height="100%" viewBox="0,0,40,30">', { width: 40, height: 30 }],
  ])('from %s', (_case, svg, size) => {
    expect(svgSize(uri(`${svg}</svg>`))).toEqual(size);
  });

  it('reads a percent-encoded data URI too', () => {
    expect(svgSize(`data:image/svg+xml,${encodeURIComponent('<svg width="5" height="6"></svg>')}`)).toEqual({ width: 5, height: 6 });
  });

  it.each([
    ['no size', '<svg>'],
    ['a zero size', '<svg width="0" height="0">'],
    ['no svg element', '<g width="5" height="5">'],
  ])('is null for %s', (_case, svg) => {
    expect(svgSize(uri(`${svg}</svg>`))).toBeNull();
  });
});

describe('criterion 28 (unit part): the images load nothing', () => {
  it.each(['APP-6D', 'APP-6E'] as const)('%s: no image of the 21 graphics refers to anything outside itself (no href, url() or http beyond namespaces)', (standard) => {
    for (const entry of engine.catalogue(standard).filter((e) => WITH_IMAGES[standard].includes(e.entity))) {
      for (const image of ok(engine.render(requestFor(entry)).rendering).images ?? []) {
        // Namespace declarations name a URI but load nothing.
        const text = atob(image.svg.slice(image.svg.indexOf(',') + 1)).replace(/\sxmlns(:\w+)?\s*=\s*"[^"]*"/g, '');
        expect(text, entry.name).not.toMatch(/href|url\(|https?:|@import/i);
      }
    }
  });
});
