/**
 * The images inside a tactical graphic (brief function 37; SDK 1.5.0 part 2, CR-0039): the icons of
 * minefields and contaminated areas, as `GraphicRendering.images`. What the service answers is checked
 * here, before any of it reaches the engine: only an SVG data URI is ever the source of an image (the
 * page never gets it as markup, and no request is made for anything else, ADR-0030), and an image whose
 * numbers cannot be drawn is left out. A graphic with no usable image is as in M5: no `images` at all.
 */
import type { GraphicImage, Position } from '@emc2/plugin-sdk';
import type { GraphicParts } from './drawData.ts';

/** The most images of one graphic that are drawn; the rest are left out. */
export const MAX_IMAGES_PER_GRAPHIC = 1000;

/** The longest `svg` text that is drawn, in characters. */
export const MAX_SVG_LENGTH = 500_000;

/** The largest an image may be drawn, in screen pixels on a side. */
export const MAX_IMAGE_SIDE = 1024;

const SVG_DATA_URI = /^data:image\/svg\+xml[;,]/i;

/** Whether `svg` is an SVG data URI, the only thing an image is drawn from. */
export function isSvgDataUri(svg: unknown): svg is string {
  return typeof svg === 'string' && svg.length <= MAX_SVG_LENGTH && SVG_DATA_URI.test(svg);
}

function isPosition(position: unknown): position is Position {
  if (!Array.isArray(position) || position.length < 2) return false;
  const [lon, lat] = position as unknown[];
  return typeof lon === 'number' && typeof lat === 'number' && Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90;
}

/** The images that can be drawn, in the service's order; at most {@link MAX_IMAGES_PER_GRAPHIC}. */
export function usableImages(images: readonly GraphicImage[] | undefined): readonly GraphicImage[] {
  if (!Array.isArray(images)) return [];
  const usable: GraphicImage[] = [];
  for (const image of images as readonly Partial<GraphicImage>[]) {
    if (usable.length >= MAX_IMAGES_PER_GRAPHIC) break;
    const { position, svg, width, height, angle } = image;
    if (!isSvgDataUri(svg) || !isPosition(position)) continue;
    if (typeof width !== 'number' || typeof height !== 'number' || !(width > 0) || !(height > 0) || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) continue;
    if (typeof angle !== 'number' || !Number.isFinite(angle)) continue;
    usable.push({ position: [position[0], position[1]], svg, width, height, angle });
  }
  return usable;
}

/** The answer as the map view keeps it: its images checked, and no `images` when none can be drawn. */
export function withUsableImages(parts: GraphicParts): GraphicParts {
  const images = usableImages(parts.images);
  return images.length === 0 ? { ok: true, lines: parts.lines, fills: parts.fills, labels: parts.labels } : { ok: true, lines: parts.lines, fills: parts.fills, labels: parts.labels, images };
}
