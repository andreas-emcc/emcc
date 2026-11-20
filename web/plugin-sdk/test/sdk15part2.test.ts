// SDK 1.5.0 part 2 (CR-0039 part 2; owner, HW): images inside a drawn tactical graphic.
import { describe, expect, it } from 'vitest';
import type { GraphicImage, GraphicRenderRequest, GraphicRendering } from '../src/index.ts';
import { createFakeSymbolService, FAKE_GRAPHIC_IMAGE_SVG, fakeGraphicImage } from '../src/testing/index.ts';

const view = { resolution: 20, extent: [17.5, 59.2, 18.5, 59.6] as const };
// lon differs from lat, so a swapped order would show
const PHASE_LINE: GraphicRenderRequest = {
  standard: 'APP-6D', sidc: '10032500001403000000', points: [[18.0723, 59.3311], [18.1102, 59.3408]], ...view,
};

const imagesOf = (r: GraphicRendering) => (r.ok ? r.images : undefined);

describe('SDK 1.5.0 part 2: graphic images', () => {
  it('a drawn graphic may carry images; without them it is drawn as in 1.4.0', async () => {
    const symbols = createFakeSymbolService();
    const plain = await symbols.renderGraphic(PHASE_LINE);
    expect(plain.ok).toBe(true);
    expect(imagesOf(plain)).toBeUndefined();
    expect(plain).not.toHaveProperty('images');
  });

  it('withImages gives every drawn graphic those images, and null stops it', async () => {
    const symbols = createFakeSymbolService();
    const mine = fakeGraphicImage([18.0912, 59.3359], 30);
    symbols.withImages([mine]);
    expect(imagesOf(await symbols.renderGraphic(PHASE_LINE))).toEqual([mine]);
    expect(imagesOf(await symbols.renderGraphic(PHASE_LINE))).toEqual([mine]);
    symbols.withImages(null);
    expect(imagesOf(await symbols.renderGraphic(PHASE_LINE))).toBeUndefined();
  });

  it('a refusal carries no images', async () => {
    const symbols = createFakeSymbolService();
    symbols.withImages([fakeGraphicImage([18.0912, 59.3359])]);
    symbols.refuse('the view has no size');
    expect(await symbols.renderGraphic(PHASE_LINE)).toEqual({ ok: false, reason: 'the view has no size' });
  });

  it('withImages keeps its own copy of the list', async () => {
    const symbols = createFakeSymbolService();
    const list: GraphicImage[] = [fakeGraphicImage([18.0912, 59.3359])];
    symbols.withImages(list);
    list.push(fakeGraphicImage([18.1, 59.34]));
    expect(imagesOf(await symbols.renderGraphic(PHASE_LINE))).toHaveLength(1);
  });

  it('the fake image is a 16 px SVG data URI centred on its position, lon first', () => {
    const image = fakeGraphicImage([18.0912, 59.3359]);
    expect(image).toEqual({ position: [18.0912, 59.3359], svg: FAKE_GRAPHIC_IMAGE_SVG, width: 16, height: 16, angle: 0 });
    expect(FAKE_GRAPHIC_IMAGE_SVG.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const svg = atob(FAKE_GRAPHIC_IMAGE_SVG.slice('data:image/svg+xml;base64,'.length));
    expect(svg).toContain('width="16"');
    expect(svg).toContain('height="16"');
    expect(svg).not.toMatch(/<script|on\w+=/i);
  });

  it('a GraphicRendering with images type-checks, and one without them still does', () => {
    const withImages: GraphicRendering = { ok: true, lines: [], fills: [], labels: [], images: [fakeGraphicImage([18.0912, 59.3359])] };
    const without: GraphicRendering = { ok: true, lines: [], fills: [], labels: [] };
    expect(imagesOf(withImages)).toHaveLength(1);
    expect(imagesOf(without)).toBeUndefined();
  });
});
