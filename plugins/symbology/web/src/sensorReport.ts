// The sensor report symbol (SDK 1.5.0 part 3, brief function 16): one small image for every object
// whose data type declares `sensorReport` (today `gmti.detection`), from the plugin's three settings.
// It is drawn pixel by pixel, without anti-aliasing, so that a 4 px symbol stays crisp and a test can
// read its pixels in jsdom, which has no canvas.

/** The shapes of `sensorReportShape`, as in plugin.json. */
export const SENSOR_REPORT_SHAPES = ['dot', 'cross', 'ring', 'diamond', 'square'] as const;
export type SensorReportShape = (typeof SENSOR_REPORT_SHAPES)[number];

/** The colours of `sensorReportColor`, by name, as in plugin.json (owner, Q42, 2026-11-10). */
export const SENSOR_REPORT_COLOURS = {
  yellow: '#ffff00',
  orange: '#ff8000',
  red: '#ff0000',
  magenta: '#ff00ff',
  cyan: '#00ffff',
  green: '#00c000',
  blue: '#0060ff',
  white: '#ffffff',
  black: '#000000',
} as const;
export type SensorReportColour = keyof typeof SENSOR_REPORT_COLOURS;

/** The size limits of `sensorReportSize`, in pixels (owner, Q41). */
export const MIN_SENSOR_REPORT_SIZE = 4;
export const MAX_SENSOR_REPORT_SIZE = 32;

/** What the three settings choose. */
export interface SensorReportLook {
  readonly shape: SensorReportShape;
  readonly color: SensorReportColour;
  readonly size: number;
}

/** The defaults: an orange dot, 10 px (brief, Settings). */
export const DEFAULT_SENSOR_REPORT: SensorReportLook = Object.freeze({ shape: 'dot', color: 'orange', size: 10 });

/**
 * The width of the cross's and the ring's lines: size / 5, at least 2 px. Below 5 px the ring's is
 * 1 px, so that its centre stays open (owner, 2026-11-10); a 4 px ring then shows only its outline.
 */
export function lineWidth(shape: SensorReportShape, size: number): number {
  return shape === 'ring' && size < 5 ? 1 : Math.max(2, size / 5);
}

/** Whether the point (dx, dy) from the image's centre is in the shape. */
function inside(shape: SensorReportShape, size: number, dx: number, dy: number): boolean {
  const r = size / 2;
  const w = lineWidth(shape, size);
  switch (shape) {
    case 'dot':
      return Math.hypot(dx, dy) <= r;
    case 'square':
      return Math.max(Math.abs(dx), Math.abs(dy)) <= r;
    case 'diamond':
      return Math.abs(dx) + Math.abs(dy) <= r;
    case 'ring':
      return Math.abs(Math.hypot(dx, dy) - (r - w / 2)) <= w / 2;
    case 'cross':
      // An upright cross: a vertical and a horizontal bar, each the image's length.
      return Math.abs(dx) <= w / 2 || Math.abs(dy) <= w / 2;
  }
}

function rgb(hex: string): readonly [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/**
 * The symbol's pixels, RGBA, `size` by `size`. A pixel whose centre is in the shape is filled in the
 * colour, or in the outline's colour (black, white for a black symbol; owner, Q43) when one of its
 * four neighbours is not in the shape or off the image. Every other pixel is transparent.
 */
export function sensorReportPixels(look: SensorReportLook): Uint8ClampedArray {
  const { shape, color, size } = look;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && inside(shape, size, x + 0.5 - size / 2, y + 0.5 - size / 2);
  const fill = rgb(SENSOR_REPORT_COLOURS[color]);
  const outline = rgb(color === 'black' ? '#ffffff' : '#000000');
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!at(x, y)) continue;
      const edge = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1);
      pixels.set([...(edge ? outline : fill), 255], (y * size + x) * 4);
    }
  }
  return pixels;
}

/** The symbol on a new canvas, `size` by `size`; its anchor is the centre. */
export function drawSensorReport(look: SensorReportLook): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = look.size;
  canvas.height = look.size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return canvas;
  const image = ctx.createImageData(look.size, look.size);
  image.data.set(sensorReportPixels(look));
  ctx.putImageData(image, 0, 0);
  return canvas;
}
