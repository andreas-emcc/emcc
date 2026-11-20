// jsdom has no canvas: `getContext('2d')` returns null. This module gives every canvas a recording
// 2D context, so that milsymbol can draw, and a test checks that drawing happened instead of reading
// pixels. Real pixels and the render time with rasterization are checked in a browser by the ITA
// (CR-0007, rejected by the owner 2026-10-08). Import it before rendering.

/** Context methods that put something on the canvas. */
const DRAWING = new Set(['fill', 'stroke', 'fillText', 'strokeText', 'fillRect', 'strokeRect', 'drawImage', 'putImageData']);

const drawCalls = new WeakMap<HTMLCanvasElement, number>();
const fills = new WeakMap<HTMLCanvasElement, string[]>();

/** A call on a recording context, with the styles set when it was made. */
export interface Call {
  readonly name: string;
  readonly args: readonly unknown[];
  readonly fillStyle: unknown;
  readonly strokeStyle: unknown;
  readonly lineWidth: unknown;
}

const calls = new WeakMap<HTMLCanvasElement, Call[]>();

function recordingContext(canvas: HTMLCanvasElement): unknown {
  const state = new Map<PropertyKey, unknown>();
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'canvas') return canvas;
        if (state.has(property)) return state.get(property);
        if (property === 'getLineDash') return () => [];
        // No font metrics in jsdom: 6 pixels per character.
        if (property === 'measureText') return (text: string) => ({ width: text.length * 6 });
        if (property === 'createImageData') return (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
        return (...args: unknown[]) => {
          if (typeof property === 'string') calls.set(canvas, [...(calls.get(canvas) ?? []), { name: property, args, fillStyle: state.get('fillStyle'), strokeStyle: state.get('strokeStyle'), lineWidth: state.get('lineWidth') }]);
          if (typeof property === 'string' && DRAWING.has(property)) drawCalls.set(canvas, (drawCalls.get(canvas) ?? 0) + 1);
          if (property === 'fill' || property === 'fillRect') fills.set(canvas, [...(fills.get(canvas) ?? []), String(state.get('fillStyle'))]);
        };
      },
      set(_target, property, value) {
        state.set(property, value);
        return true;
      },
    },
  );
}

const contexts = new WeakMap<HTMLCanvasElement, unknown>();
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value(this: HTMLCanvasElement, type: string): unknown {
    if (type !== '2d') return null;
    let context = contexts.get(this);
    if (context === undefined) {
      context = recordingContext(this);
      contexts.set(this, context);
    }
    return context;
  },
});

/** The number of drawing calls made on the canvas's 2D context. */
export function drawCallsOn(canvas: HTMLCanvasElement): number {
  return drawCalls.get(canvas) ?? 0;
}

/** The fill style of each fill on the canvas's 2D context, in order, with spaces removed: `rgb(255,128,128)`. */
export function fillsOn(canvas: HTMLCanvasElement): string[] {
  return (fills.get(canvas) ?? []).map((fill) => fill.replaceAll(' ', ''));
}

/** Every call made on the canvas's 2D context, in order. */
export function callsOn(canvas: HTMLCanvasElement): readonly Call[] {
  return calls.get(canvas) ?? [];
}

/** True if the image is a canvas of positive size on which something was drawn. */
export function isDrawn(image: HTMLCanvasElement | ImageBitmap): boolean {
  return image instanceof HTMLCanvasElement && image.width > 0 && image.height > 0 && drawCallsOn(image) > 0;
}
