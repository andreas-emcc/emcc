/**
 * The rendering check (brief function 9, ADR-0017 point 3): does WebGL run on a GPU?
 *
 * A context requested with `failIfMajorPerformanceCaveat: true` that fails while a plain one works
 * means software rendering. A renderer name such as "SwiftShader" or "Basic Render Driver" means
 * software too. Without any WebGL context the map cannot be drawn.
 */
import type { RenderingMode } from '@emc2/plugin-sdk';

/** The parts of a WebGL context the check uses. */
export interface ProbeContext {
  readonly RENDERER: number;
  getParameter(name: number): unknown;
  getExtension(name: string): unknown;
}

/** The parts of a canvas the check uses. */
export interface ProbeCanvas {
  getContext(type: 'webgl2' | 'webgl', attributes?: WebGLContextAttributes): unknown;
}

export interface RenderingCheck {
  readonly mode: RenderingMode;
  /** The WebGL renderer name, if known. */
  readonly renderer: string | null;
}

const SOFTWARE_RENDERERS = /swiftshader|basic render driver|llvmpipe|softpipe|software|microsoft warp/i;

/** Runs the check with fresh canvases from `createCanvas` (each probe needs its own canvas). */
export function checkRendering(createCanvas: () => ProbeCanvas): RenderingCheck {
  const accelerated = probe(createCanvas(), { failIfMajorPerformanceCaveat: true });
  if (accelerated !== null) {
    const renderer = rendererName(accelerated);
    release(accelerated);
    return { mode: renderer !== null && SOFTWARE_RENDERERS.test(renderer) ? 'software' : 'hardware', renderer };
  }
  const plain = probe(createCanvas(), {});
  if (plain !== null) {
    const renderer = rendererName(plain);
    release(plain);
    return { mode: 'software', renderer };
  }
  return { mode: 'none', renderer: null };
}

function probe(canvas: ProbeCanvas, attributes: WebGLContextAttributes): ProbeContext | null {
  for (const type of ['webgl2', 'webgl'] as const) {
    try {
      const context = canvas.getContext(type, attributes);
      if (isContext(context)) return context;
    } catch {
      // A browser may throw instead of returning null; try the next type.
    }
  }
  return null;
}

function isContext(value: unknown): value is ProbeContext {
  return typeof value === 'object' && value !== null && 'getParameter' in value && 'getExtension' in value;
}

function rendererName(context: ProbeContext): string | null {
  try {
    const info = context.getExtension('WEBGL_debug_renderer_info') as { readonly UNMASKED_RENDERER_WEBGL: number } | null;
    const name = context.getParameter(info?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER);
    return typeof name === 'string' && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/** Gives the probe context back at once; browsers allow only a few live WebGL contexts. */
function release(context: ProbeContext): void {
  try {
    (context.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
  } catch {
    // Nothing to give back.
  }
}

/** The software notice text (brief function 9). */
export function softwareNotice(budget: number): string {
  return `This computer draws the map without a GPU. Up to about ${budget.toLocaleString('en')} objects are drawn one by one; beyond that the map shows clusters.`;
}
export const CANNOT_DRAW_MESSAGE = 'This browser cannot draw the map: WebGL is not available.';

/**
 * The software notice (brief function 9): shown in software mode until the user dismisses it. The
 * budget warning of M0 (criterion 14) is gone: in area mode the server keeps every view within the
 * budget with clusters (brief function 12).
 */
export class RenderingNotice {
  private dismissed = false;
  private readonly listeners = new Set<() => void>();

  constructor(readonly mode: RenderingMode) {}

  dismiss(): void {
    if (this.dismissed) return;
    this.dismissed = true;
    this.emit();
  }

  /** True while the software notice is shown. */
  get visible(): boolean {
    return this.mode === 'software' && !this.dismissed;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
