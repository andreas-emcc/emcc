/** Activating the plugin with fake browser dependencies, for the activate and UI tests. */
import type { JsonValue, PluginContext, RenderingMode } from '@emc2/plugin-sdk';
import { createFakeContext, type FakeContext } from '@emc2/plugin-sdk/testing';
import { activateMapView, type MountableEngine } from '../src/activate.tsx';
import type { ProbeCanvas } from '../src/core/rendering.ts';
import type { ControlsOpenStore } from '../src/ui/controlsOpen.ts';
import { FakeEngine } from './fakeEngine.ts';
import { FakeClock } from './fixtures.ts';

const ORIGIN = 'http://127.0.0.1:8080';

/** Canvases that answer like a browser in the given rendering mode. */
export function canvases(mode: RenderingMode, renderer = mode === 'software' ? 'Google SwiftShader' : 'NVIDIA GeForce RTX 4070'): () => ProbeCanvas {
  const gl = { RENDERER: 1, getParameter: () => renderer, getExtension: () => null };
  return () => ({
    getContext: (_type, attributes) => {
      if (mode === 'none') return null;
      if (mode === 'software' && attributes?.failIfMajorPerformanceCaveat === true) return null;
      return gl;
    },
  });
}

export class MountableFakeEngine extends FakeEngine implements MountableEngine {
  mounted: HTMLElement | null = null;

  mount(element: HTMLElement): () => void {
    this.mounted = element;
    const center = this.projection.forward([15, 62]);
    if (center !== null) this.show(center, 4892);
    return () => {
      this.mounted = null;
    };
  }
}

export function activate(options: { mode?: RenderingMode; settings?: Record<string, JsonValue>; ctx?: FakeContext; context?: PluginContext; controlsOpen?: ControlsOpenStore } = {}) {
  const ctx = options.ctx ?? createFakeContext({ pluginId: 'map-view-2d', provides: ['emc2.map-view'], settings: options.settings ?? {} });
  let engine: MountableFakeEngine | null = null;
  const clock = new FakeClock();
  const result = activateMapView(options.context ?? ctx, {
    createCanvas: canvases(options.mode ?? 'hardware'),
    createEngine: (request) => {
      engine = new MountableFakeEngine(request.projection);
      return engine;
    },
    clock,
    origin: ORIGIN,
    ...(options.controlsOpen === undefined ? {} : { controlsOpen: options.controlsOpen }),
  });
  return { ctx, result, engine: engine as MountableFakeEngine | null, clock };
}
