import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAKE_GRAPHIC_IMAGE_SVG } from '@emc2/plugin-sdk/testing';
import { GraphicImageCache } from '../../src/engine/graphicImages.ts';

describe('the decoded images of tactical graphics (brief function 37, criteria 90 and 91)', () => {
  const made: HTMLImageElement[] = [];
  beforeEach(() => {
    made.length = 0;
    const RealImage = globalThis.Image;
    vi.stubGlobal('Image', function FakeImage() {
      const image = new RealImage();
      made.push(image);
      return image;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('makes no image, and no request, for anything that is not an SVG data URI', () => {
    const cache = new GraphicImageCache(() => undefined);
    for (const bad of ['https://example.com/a.svg', 'http://127.0.0.1/a.svg', 'data:text/html,<b>x</b>', 'javascript:alert(1)', '']) expect(cache.get(bad)).toBeNull();
    expect(made).toHaveLength(0);
    expect(cache.size).toBe(0);
  });

  it('decodes an svg once whoever asks, gives it only when ready, and says so when it is', () => {
    const ready = vi.fn();
    const cache = new GraphicImageCache(ready);
    expect(cache.get(FAKE_GRAPHIC_IMAGE_SVG)).toBeNull(); // decoding
    expect(cache.get(FAKE_GRAPHIC_IMAGE_SVG)).toBeNull();
    expect(made).toHaveLength(1);
    expect(made[0]?.src).toBe(FAKE_GRAPHIC_IMAGE_SVG);
    made[0]?.onload?.(new Event('load'));
    expect(ready).toHaveBeenCalledTimes(1);
    expect(cache.get(FAKE_GRAPHIC_IMAGE_SVG)).toBe(made[0]);
    expect(made).toHaveLength(1);
  });

  it('keeps asking for nothing after a failure, and keeps a bounded number of images', () => {
    const cache = new GraphicImageCache(() => undefined);
    cache.get(FAKE_GRAPHIC_IMAGE_SVG);
    made[0]?.onerror?.(new Event('error'));
    expect(cache.get(FAKE_GRAPHIC_IMAGE_SVG)).toBeNull();
    expect(made).toHaveLength(1);
    for (let i = 0; i < 300; i++) cache.get(`data:image/svg+xml,%3Csvg%20id%3D%22${String(i)}%22%2F%3E`);
    expect(cache.size).toBeLessThanOrEqual(256);
  });
});
