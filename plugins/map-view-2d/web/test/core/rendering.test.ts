import { describe, expect, it, vi } from 'vitest';
import { checkRendering, RenderingNotice, softwareNotice, type ProbeCanvas } from '../../src/core/rendering.ts';

const UNMASKED_RENDERER = 0x9246;
const RENDERER = 0x1f01;

/** A fake WebGL context with a renderer name; `lost` counts released contexts. */
function context(renderer: string | null, withDebugInfo = true) {
  const lose = vi.fn();
  return {
    lose,
    gl: {
      RENDERER,
      getParameter: (name: number) => (name === UNMASKED_RENDERER && withDebugInfo ? renderer : name === RENDERER ? 'WebKit WebGL' : null),
      getExtension: (name: string) =>
        name === 'WEBGL_debug_renderer_info' ? (withDebugInfo ? { UNMASKED_RENDERER_WEBGL: UNMASKED_RENDERER } : null)
          : name === 'WEBGL_lose_context' ? { loseContext: lose } : null,
    },
  };
}

/** Canvases that give `accelerated` for a context with failIfMajorPerformanceCaveat, `plain` otherwise. */
function canvases(accelerated: unknown, plain: unknown): () => ProbeCanvas {
  return () => ({
    getContext: (_type, attributes) => (attributes?.failIfMajorPerformanceCaveat === true ? accelerated : plain),
  });
}

describe('rendering check (brief function 9, criterion 13)', () => {
  it('reports hardware when an accelerated context exists with a GPU renderer', () => {
    const gpu = context('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)');
    expect(checkRendering(canvases(gpu.gl, gpu.gl))).toEqual({ mode: 'hardware', renderer: expect.stringContaining('NVIDIA') as unknown });
    expect(gpu.lose).toHaveBeenCalled();
  });

  it('reports software when only a context with a performance caveat exists', () => {
    const warp = context('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)');
    expect(checkRendering(canvases(null, warp.gl))).toEqual({ mode: 'software', renderer: expect.stringContaining('Basic Render Driver') as unknown });
  });

  it('reports software when the renderer name is a software rasterizer, even without a caveat', () => {
    for (const name of ['Google SwiftShader', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))']) {
      expect(checkRendering(canvases(context(name).gl, null)).mode).toBe('software');
    }
  });

  it('falls back to the plain renderer name without the debug extension', () => {
    const masked = context(null, false);
    expect(checkRendering(canvases(masked.gl, masked.gl))).toEqual({ mode: 'hardware', renderer: 'WebKit WebGL' });
  });

  it('reports none without WebGL (criterion 13: simulated)', () => {
    expect(checkRendering(canvases(null, null))).toEqual({ mode: 'none', renderer: null });
  });

  it('treats a browser that throws on getContext like one without WebGL', () => {
    const throwing = (): ProbeCanvas => ({
      getContext: () => {
        throw new Error('blocked');
      },
    });
    expect(checkRendering(throwing).mode).toBe('none');
  });

  it('tries WebGL 1 when WebGL 2 is missing', () => {
    const gpu = context('Apple M2');
    const create = (): ProbeCanvas => ({ getContext: (type) => (type === 'webgl' ? gpu.gl : null) });
    expect(checkRendering(create).mode).toBe('hardware');
  });
});

describe('software notice (brief function 9)', () => {
  it('shows nothing with a GPU', () => {
    expect(new RenderingNotice('hardware').visible).toBe(false);
  });

  it('shows the notice in software mode until it is dismissed', () => {
    const notice = new RenderingNotice('software');
    const changes = vi.fn();
    notice.onChange(changes);
    expect(notice.visible).toBe(true);
    notice.dismiss();
    notice.dismiss();
    expect(notice.visible).toBe(false);
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it('names the budget in the text', () => {
    expect(softwareNotice(10_000)).toContain('10,000');
  });
});
