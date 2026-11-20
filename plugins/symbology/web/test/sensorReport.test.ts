import { describe, expect, it } from 'vitest';
import { SYMBOLS, type JsonValue } from '@emc2/plugin-sdk';
import { createFakeContext } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import plugin from '../src/index.ts';
import { lineWidth, SENSOR_REPORT_COLOURS, SENSOR_REPORT_SHAPES, sensorReportPixels, type SensorReportLook } from '../src/sensorReport.ts';
import { createSymbolService } from '../src/service.ts';
import { callsOn } from './canvas.ts';

const defaults = (): Record<string, JsonValue> =>
  Object.fromEntries(Object.entries(manifest.settings.properties).map(([name, schema]) => [name, schema.default]));

async function activated(settings: Record<string, JsonValue> = defaults()) {
  const ctx = createFakeContext({ pluginId: manifest.id, settings, provides: manifest.provides });
  await plugin.activate(ctx);
  return { ctx, symbols: await ctx.services.get(SYMBOLS) };
}

/** The pixel at (x, y) as `#rrggbb`, or `transparent`. */
function pixel(pixels: Uint8ClampedArray, size: number, x: number, y: number): string {
  const i = (y * size + x) * 4;
  if (pixels[i + 3] === 0) return 'transparent';
  return `#${[pixels[i], pixels[i + 1], pixels[i + 2]].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')}`;
}

/** The pixels the service put on its canvas. */
function drawnPixels(image: HTMLCanvasElement | ImageBitmap): Uint8ClampedArray {
  if (!(image instanceof HTMLCanvasElement)) throw new Error('not a canvas');
  const put = callsOn(image).find((c) => c.name === 'putImageData');
  return (put?.args[0] as { data: Uint8ClampedArray } | undefined)?.data ?? new Uint8ClampedArray();
}

describe('criterion 29: the default', () => {
  it('is a 10 by 10 orange dot with a black outline, anchored at [5, 5]', async () => {
    const { symbols } = await activated();
    const image = symbols.sensorReportSymbol();
    expect([image.width, image.height, ...image.anchor]).toEqual([10, 10, 5, 5]);
    const pixels = drawnPixels(image.image);
    expect(pixel(pixels, 10, 5, 5)).toBe('#ff8000');
    expect(pixel(pixels, 0, 0, 0)).toBe('transparent');
    expect(pixel(pixels, 10, 0, 0)).toBe('transparent');
    expect(pixel(pixels, 10, 0, 5)).toBe('#000000');
    expect(pixel(pixels, 10, 5, 0)).toBe('#000000');
    expect(pixel(pixels, 10, 9, 4)).toBe('#000000');
  });
});

describe('criterion 30: every shape and colour', () => {
  const looks = SENSOR_REPORT_SHAPES.flatMap((shape) => (Object.keys(SENSOR_REPORT_COLOURS) as SensorReportLook['color'][]).flatMap((color) => [4, 32].map((size) => ({ shape, color, size }))));

  it.each(looks)('$shape $color at $size px: that size, anchored at its centre, outlined', (look) => {
    const symbols = createSymbolService({ cacheSize: 10, sensorReport: look });
    const image = symbols.service.sensorReportSymbol();
    expect([image.width, image.height, ...image.anchor]).toEqual([look.size, look.size, look.size / 2, look.size / 2]);
    const pixels = sensorReportPixels(look);
    const colours = new Set(Array.from({ length: look.size * look.size }, (_, i) => pixel(pixels, look.size, i % look.size, Math.floor(i / look.size))));
    // Outlined in black, white for a black symbol.
    expect(colours.has(look.color === 'black' ? '#ffffff' : '#000000')).toBe(true);
    // Nothing but the fill, the outline and transparency.
    expect([...colours].every((c) => ['transparent', SENSOR_REPORT_COLOURS[look.color], look.color === 'black' ? '#ffffff' : '#000000'].includes(c))).toBe(true);
    // The colour shows, except in a 4 px ring, which is only its outline (owner, 2026-11-10).
    if (!(look.shape === 'ring' && look.size === 4)) expect(colours.has(SENSOR_REPORT_COLOURS[look.color])).toBe(true);
  });

  it.each([4, 5, 10, 32])("the ring's centre and the cross's corners are transparent at %i px", (size) => {
    const ring = sensorReportPixels({ shape: 'ring', color: 'orange', size });
    const c = Math.floor(size / 2);
    expect(pixel(ring, size, c, c)).toBe('transparent');
    const cross = sensorReportPixels({ shape: 'cross', color: 'orange', size });
    for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]] as const) expect(pixel(cross, size, x, y)).toBe('transparent');
  });

  it('the cross and the ring have lines size / 5 wide, at least 2 px; a 4 px ring 1 px', () => {
    expect(lineWidth('cross', 32)).toBeCloseTo(6.4);
    expect(lineWidth('cross', 4)).toBe(2);
    expect(lineWidth('ring', 10)).toBe(2);
    expect(lineWidth('ring', 4)).toBe(1);
    // A 32 px cross's arm is 6 or 7 px wide across.
    const cross = sensorReportPixels({ shape: 'cross', color: 'red', size: 32 });
    const row = Array.from({ length: 32 }, (_, x) => pixel(cross, 32, x, 0)).filter((p) => p !== 'transparent');
    expect(row.length).toBeGreaterThanOrEqual(6);
    expect(row.length).toBeLessThanOrEqual(7);
  });

  it('a diamond stands on its point: the middles of the sides are coloured, the corners transparent', () => {
    const d = sensorReportPixels({ shape: 'diamond', color: 'cyan', size: 20 });
    expect(pixel(d, 20, 10, 0)).toBe('#000000');
    expect(pixel(d, 20, 0, 0)).toBe('transparent');
    expect(pixel(d, 20, 10, 10)).toBe('#00ffff');
    const s = sensorReportPixels({ shape: 'square', color: 'cyan', size: 20 });
    expect(pixel(s, 20, 0, 0)).toBe('#000000');
    expect(pixel(s, 20, 1, 1)).toBe('#00ffff');
  });
});

describe('criterion 31: the same until changed', () => {
  it('two calls return the same image; after square, red and 20 the next call returns a new 20 by 20 red square', async () => {
    const { ctx, symbols } = await activated();
    const first = symbols.sensorReportSymbol();
    expect(symbols.sensorReportSymbol()).toBe(first);
    ctx.changeSettings({ ...defaults(), sensorReportShape: 'square', sensorReportColor: 'red', sensorReportSize: 20 });
    const next = symbols.sensorReportSymbol();
    expect(next).not.toBe(first);
    expect([next.width, next.height]).toEqual([20, 20]);
    const pixels = drawnPixels(next.image);
    expect(pixel(pixels, 20, 10, 10)).toBe('#ff0000');
    expect(pixel(pixels, 20, 0, 0)).toBe('#000000');
    expect(ctx.statusHistory.at(-1)?.state).toBe('OK');
    // Settings that change something else keep the image.
    ctx.changeSettings({ ...defaults(), sensorReportShape: 'square', sensorReportColor: 'red', sensorReportSize: 20, imageCacheSize: 50 });
    expect(symbols.sensorReportSymbol()).toBe(next);
  });

  it("the manifest's schema refuses a size of 3 or 33, the shape star and the colour pink", () => {
    const { sensorReportShape, sensorReportColor, sensorReportSize } = manifest.settings.properties;
    expect(sensorReportSize).toMatchObject({ type: 'integer', minimum: 4, maximum: 32, default: 10 });
    expect(sensorReportShape).toMatchObject({ type: 'string', enum: [...SENSOR_REPORT_SHAPES], default: 'dot' });
    expect(sensorReportColor).toMatchObject({ type: 'string', enum: Object.keys(SENSOR_REPORT_COLOURS), default: 'orange' });
    expect(sensorReportShape.enum).not.toContain('star');
    expect(sensorReportColor.enum).not.toContain('pink');
    expect(manifest.settings.required).toEqual(expect.arrayContaining(['sensorReportShape', 'sensorReportColor', 'sensorReportSize']));
  });

  it.each([
    ['sensorReportSize', 3, 'sensorReportSize 3 is not a whole number from 4 to 32; using 10'],
    ['sensorReportSize', 33, 'sensorReportSize 33 is not a whole number from 4 to 32; using 10'],
    ['sensorReportShape', 'star', 'sensorReportShape "star" is not one of dot, cross, ring, diamond, square; using dot'],
    ['sensorReportColor', 'pink', 'sensorReportColor "pink" is not one of yellow, orange, red, magenta, cyan, green, blue, white, black; using orange'],
  ])('the plugin also refuses %s %j: DEGRADED, and keeps the current symbol', async (name, value, detail) => {
    const { ctx, symbols } = await activated();
    const first = symbols.sensorReportSymbol();
    ctx.changeSettings({ ...defaults(), [name]: value });
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'DEGRADED', detail });
    expect(symbols.sensorReportSymbol()).toBe(first);
  });

  it('missing settings take their defaults', async () => {
    const { imageCacheSize, graphicTimeoutSeconds } = defaults();
    const { ctx, symbols } = await activated({ imageCacheSize: imageCacheSize ?? 2000, graphicTimeoutSeconds: graphicTimeoutSeconds ?? 5 });
    expect(ctx.statusHistory.at(-1)?.state).toBe('OK');
    expect(symbols.sensorReportSymbol().width).toBe(10);
  });
});

describe('criterion 32: apart from APP-6', () => {
  const DETECTION = '10061500001100000000';

  it("render for a detection's SIDC gives the same image and key with any sensor report settings", async () => {
    const { ctx, symbols } = await activated();
    const before = symbols.render({ standard: 'APP-6D', sidc: DETECTION, size: 30 });
    ctx.changeSettings({ ...defaults(), sensorReportShape: 'cross', sensorReportColor: 'yellow', sensorReportSize: 32 });
    expect(symbols.render({ standard: 'APP-6D', sidc: DETECTION, size: 30 })).toBe(before);
    expect(symbols.sensorReportSymbol()).not.toBe(before);
  });

  it("the user's symbol size and labels do not change the sensor report image", async () => {
    const { symbols } = await activated();
    const image = symbols.sensorReportSymbol();
    symbols.render({ standard: 'APP-6D', sidc: DETECTION, size: 48, withText: true, labels: [] });
    symbols.render({ standard: 'APP-6D', sidc: DETECTION, size: 20, withText: true, labels: ['uniqueDesignation'] });
    expect(symbols.sensorReportSymbol()).toBe(image);
    expect(image.width).toBe(10);
  });

  it('the sensor report image is read-only and frozen, as render\'s are', async () => {
    const { symbols } = await activated();
    const image = symbols.sensorReportSymbol();
    expect(Object.isFrozen(image)).toBe(true);
    expect(image.image instanceof HTMLCanvasElement ? image.image.getContext('2d') : 'none').toBeNull();
  });
});
