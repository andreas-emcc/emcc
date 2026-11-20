import { describe, expect, it } from 'vitest';
import { fakeGraphicImage, FAKE_GRAPHIC_IMAGE_SVG } from '@emc2/plugin-sdk/testing';
import { isSvgDataUri, MAX_IMAGES_PER_GRAPHIC, usableImages, withUsableImages } from '../../src/core/graphicImages.ts';
import { translatedParts } from '../../src/core/graphics.ts';

const GOOD = fakeGraphicImage([15.2, 58.41], 30);

describe('the images inside a graphic (brief function 37, criterion 90)', () => {
  it('takes only an SVG data URI as the source of an image', () => {
    expect(isSvgDataUri(FAKE_GRAPHIC_IMAGE_SVG)).toBe(true);
    expect(isSvgDataUri('data:image/svg+xml,%3Csvg%3E%3C/svg%3E')).toBe(true);
    for (const bad of ['data:text/html,<b>x</b>', 'data:image/png;base64,AAAA', 'https://example.com/a.svg', 'http://127.0.0.1/a.svg', '//example.com/a.svg', 'javascript:alert(1)', 'blob:x', '', 'data:image/svg+xml', 42, null, undefined]) {
      expect(isSvgDataUri(bad), String(bad)).toBe(false);
    }
    expect(isSvgDataUri(`data:image/svg+xml,${'a'.repeat(600_000)}`)).toBe(false); // too long to be an icon
  });

  it('keeps the images that can be drawn, and drops the rest', () => {
    const kept = usableImages([
      GOOD,
      { ...GOOD, svg: 'https://example.com/a.svg' },
      { ...GOOD, width: 0 },
      { ...GOOD, height: -4 },
      { ...GOOD, width: 5000 },
      { ...GOOD, angle: Number.POSITIVE_INFINITY },
      { ...GOOD, position: [15, 91] },
      { ...GOOD, position: [Number.NaN, 58] },
      { ...GOOD, position: [16, 59], angle: -45 },
    ]);
    expect(kept.map((i) => i.position)).toEqual([[15.2, 58.41], [16, 59]]);
    expect(usableImages(undefined)).toEqual([]);
    expect(usableImages(Array.from({ length: MAX_IMAGES_PER_GRAPHIC + 50 }, () => GOOD))).toHaveLength(MAX_IMAGES_PER_GRAPHIC);
  });

  it('an answer with no usable image has no `images` at all, as in M5', () => {
    const base = { ok: true as const, lines: [], fills: [], labels: [] };
    expect(withUsableImages({ ...base, images: [{ ...GOOD, svg: 'https://example.com/a.svg' }] })).toEqual(base);
    expect('images' in withUsableImages({ ...base, images: [] })).toBe(false);
    expect(withUsableImages({ ...base, images: [GOOD] }).images).toEqual([GOOD]);
  });

  it('moves the images with the graphic in a drag preview', () => {
    const moved = translatedParts({ ok: true, lines: [], fills: [], labels: [], images: [GOOD] }, 1, -2);
    expect(moved.images?.[0]?.position).toEqual([16.2, 56.41]);
    expect(moved.images?.[0]).toMatchObject({ width: 16, height: 16, angle: 30, svg: FAKE_GRAPHIC_IMAGE_SVG });
    expect(translatedParts({ ok: true, lines: [], fills: [], labels: [] }, 1, 1)).not.toHaveProperty('images');
  });
});
