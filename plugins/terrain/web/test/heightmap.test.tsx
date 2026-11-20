import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAP_VIEW, overlayProblem, type JsonValue, type OverlayItem, type Position } from '@emc2/plugin-sdk';
import { createFakeContext, createFakeMapView, type FakeContext, type FakeMapView } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import plugin from '../src/index.tsx';
import { bandColor, destination, heightMapItems, metresPerPixelAt } from '../src/overlay.ts';
import { formatHeight, heightLabel } from '../src/format.ts';
import { radiusProblem } from '../src/controller.ts';
import type { HeightMapResult } from '../src/api.ts';

// The height map in a circle (the brief's function 10, T-166): the third tool of the panel. Every
// position has a latitude different from its longitude (ADR-0007).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SUNDSVALL: Position = [17.31, 62.39];
const RADIUS = 10_000;

function settingDefaults(): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(manifest.settings.properties).map(([name, schema]) => [name, schema.default]));
}

function ring(west: number, south: number, east: number, north: number): number[][] {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

/** The server's answer for 16 bands rising from 100 m to 260 m, a strip of ground in each, the highest point on the north edge. */
function heightMapAnswer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const bands = Array.from({ length: 16 }, (_, b) => ({
    index: b,
    lowest: 100 + 10 * b,
    highest: 110 + 10 * b,
    areas: [[ring(17.2, 62.3 + 0.01 * b, 17.4, 62.31 + 0.01 * b)]],
  }));
  return {
    bands,
    highest: { position: [17.3, 62.46], height: 260 },
    lowest: 100,
    level: 2,
    cells: 2,
    heightCells: 400_000,
    simplified: 0,
    leftOut: 0,
    positions: 80,
    partlyWithoutData: false,
    millis: 123,
    notes: [],
    ...overrides,
  };
}

function flatAnswer(): Record<string, unknown> {
  return heightMapAnswer({ bands: [{ index: 0, lowest: 12, highest: 12, areas: [[ring(17.2, 62.3, 17.4, 62.5)]] }], highest: { position: [17.3, 62.4], height: 12 }, lowest: 12 });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Server {
  readonly calls: { readonly path: string; readonly method: string; readonly body: unknown }[];
}

function stubServer(answers: { heightmap?: () => Response | Promise<Response>; status?: () => Response } = {}): Server {
  const server: Server = { calls: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.slice(url.lastIndexOf('/') + 1);
      server.calls.push({ path, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined });
      if (path === 'heightmap') return Promise.resolve(answers.heightmap?.() ?? jsonResponse(heightMapAnswer()));
      if (path === 'status') return Promise.resolve(answers.status?.() ?? jsonResponse({ state: 'ready', cells: 6 }));
      return Promise.resolve(new Response('not found', { status: 404 }));
    }),
  );
  return server;
}

async function activated(settings: Record<string, JsonValue> = settingDefaults()): Promise<{ ctx: FakeContext; map: FakeMapView }> {
  const ctx = createFakeContext({ pluginId: manifest.id, settings, uses: manifest.uses });
  const map = createFakeMapView({ pluginId: manifest.id });
  ctx.provideAs(MAP_VIEW, map);
  await plugin.activate(ctx);
  return { ctx, map };
}

function renderPanel(ctx: FakeContext) {
  const Panel = ctx.addedPanels[0]?.panel.component;
  if (!Panel) throw new Error('no panel');
  return render(<Panel />);
}

/** What the height map's overlay shows now: its last `set` or `clear`, leaving out the cross's overlay (the one with the label) that is set after it. */
const lastItems = (map: FakeMapView): readonly OverlayItem[] => map.overlayItems.findLast((items) => !items.some((i) => i.kind === 'label')) ?? [];

/** What the cross's overlay shows now: its last `set` with a label in it (the cross and its label are in their own overlay, set after the bands). */
const markerItems = (map: FakeMapView): readonly OverlayItem[] => map.overlayItems.findLast((items) => items.some((i) => i.kind === 'label')) ?? [];

/**
 * The map view's stacking of the plugin's overlays, as map-view-2d's engine does it (`olEngine.rebuildOverlays`): in
 * the order in which they were first set to something, a later one drawn above an earlier one; a `clear` takes an
 * overlay out of that order. The test kit's fake does not tell the overlays apart, so this wraps `createOverlay`.
 * It answers the roles from the bottom up: 'viewshed' (the range tool and the viewshed's), 'bands', 'cross'.
 */
function stackedOverlays(map: FakeMapView): () => string[] {
  const stack = new Map<number, readonly OverlayItem[]>();
  const made = map.createOverlay.bind(map);
  let count = 0;
  map.createOverlay = () => {
    const id = ++count;
    const overlay = made();
    return {
      set(items) {
        overlay.set(items);
        if (items.length === 0) stack.delete(id);
        else stack.set(id, items);
      },
      clear() {
        overlay.clear();
        stack.delete(id);
      },
    };
  };
  return () =>
    [...stack.values()].map((items) => {
      if (items.some((i) => i.kind === 'point')) return 'viewshed';
      if (items.some((i) => i.kind === 'area')) return 'bands';
      return items.some((i) => i.kind === 'label') ? 'cross' : 'viewshed';
    });
}

/** The user's press and drag on the map: the circle the draw resolves with. */
async function drawCircle(map: FakeMapView, center: Position, radius: number | null) {
  await waitFor(() => {
    expect(map.runningInteraction).toBe('draw:circle');
  });
  await act(async () => {
    map.completeDrawing(radius === null ? null : { type: 'Circle', center, radius });
    await Promise.resolve();
  });
}

/** The distance between two positions on a sphere of the earth's mean radius, metres: precise enough to check what is drawn. */
function distance(a: Position, b: Position): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

describe('terrain web part: the height map', () => {
  it('has a Height map section with a Draw a circle button and the circle\'s limits', async () => {
    stubServer();
    const { ctx } = await activated();
    renderPanel(ctx);
    expect(screen.getByRole('region', { name: 'Height map' })).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Draw a circle' }).disabled).toBe(false);
    expect(screen.getByText(/A circle of 100 m to 50 km/)).toBeDefined();
  });

  it('criterion 15: draws the circle, asks the server and shows 16 bands from red to green, the circle, the white cross and the label "260 m"', async () => {
    let finish: (response: Response) => void = () => undefined;
    const server = stubServer({ heightmap: () => new Promise<Response>((resolve) => { finish = resolve; }) });
    const { ctx, map } = await activated();
    renderPanel(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }));
    expect(screen.getByText('Press on the centre and drag to the radius. Escape cancels.')).toBeDefined();
    expect(map.drawCalls.at(-1)?.kind).toBe('circle');
    await drawCircle(map, SUNDSVALL, RADIUS);
    await screen.findByText('Computing…');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Draw a circle' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Pick the observer' }).disabled).toBe(true);
    expect(server.calls.at(-1)).toEqual({ path: 'heightmap', method: 'POST', body: { center: [17.31, 62.39], radius: 10_000 } });

    await act(async () => {
      finish(jsonResponse(heightMapAnswer()));
      await Promise.resolve();
    });
    const result = await screen.findByLabelText('Height map result');
    expect(result.textContent).toContain('260 m');
    expect(result.textContent).toContain('100 m');
    expect(result.textContent).toContain('DTED level 2, 2 cells read');
    expect(screen.queryByText('Computing…')).toBeNull();

    const items = lastItems(map);
    const areas = items.filter((i) => i.kind === 'area');
    expect(areas).toHaveLength(16);
    // each band at half opacity with no outline; the colours run from red (lowest) to green (highest)
    expect(areas[0]).toMatchObject({ style: { fillColor: '#ff0000', fillOpacity: 0.5, strokeOpacity: 0, strokeWidth: 0 } });
    expect(areas[15]).toMatchObject({ style: { fillColor: '#00ff00', fillOpacity: 0.5 } });
    const colours = areas.map((a) => a.style?.fillColor);
    expect(new Set(colours).size).toBe(16);
    // the circle's outline: a closed line the plugin densifies itself, round the centre
    const lines = items.filter((i) => i.kind === 'line');
    expect(lines).toHaveLength(1);
    const outline = lines[0];
    if (outline?.kind !== 'line') throw new Error('no outline');
    expect(outline.positions).toHaveLength(181);
    expect(outline.positions[0]).toEqual(outline.positions[180]);
    expect(distance(SUNDSVALL, outline.positions[37] ?? [0, 0])).toBeGreaterThan(9_950);
    expect(distance(SUNDSVALL, outline.positions[37] ?? [0, 0])).toBeLessThan(10_050);
    // the white cross on the highest ground, in its own overlay: two lines each 16 pixels long (RV C), one north to south, one west to east
    const marker = markerItems(map);
    const arms = marker.filter((i) => i.kind === 'line');
    expect(arms).toHaveLength(2);
    const metresPerPixel = metresPerPixelAt(map.viewport, [17.3, 62.46]);
    for (const arm of arms) {
      expect(arm.style).toMatchObject({ strokeColor: '#ffffff' });
      expect(arm.positions).toHaveLength(2);
      expect(distance(arm.positions[0] ?? [0, 0], arm.positions[1] ?? [0, 0]) / (16 * metresPerPixel)).toBeCloseTo(1, 2);
    }
    const [vertical, horizontal] = [arms[0], arms[1]];
    if (vertical?.kind !== 'line' || horizontal?.kind !== 'line') throw new Error('no cross');
    expect(vertical.positions[0]?.[0]).toBeCloseTo(vertical.positions[1]?.[0] ?? 0, 6);
    expect(horizontal.positions[0]?.[1]).toBeCloseTo(horizontal.positions[1]?.[1] ?? 0, 4);
    const coordinate = (position: Position | undefined, at: 0 | 1): number => position?.[at] ?? 0;
    const middle = [
      (coordinate(vertical.positions[0], 0) + coordinate(vertical.positions[1], 0)) / 2,
      (coordinate(vertical.positions[0], 1) + coordinate(vertical.positions[1], 1)) / 2,
    ];
    expect(middle[0]).toBeCloseTo(17.3, 5);
    expect(middle[1]).toBeCloseTo(62.46, 5);
    // the label: the height above mean sea level to the metre, white with a dark halo, just above the cross (8 + 12 pixels from its centre)
    const label = marker.find((i) => i.kind === 'label');
    expect(label).toMatchObject({ kind: 'label', text: '260 m', style: { color: '#ffffff' } });
    if (label?.kind === 'label') {
      expect(label.style?.haloColor).toBeDefined();
      expect(distance(label.position, [17.3, 62.46]) / (20 * metresPerPixel)).toBeCloseTo(1, 2);
      expect(label.position[1]).toBeGreaterThan(62.46);
    }
    expect(items.some((i) => i.kind === 'label')).toBe(false);
    expect(map.overlayProblems.at(-1)).toBeNull();
    expect(overlayProblem(items)).toBeNull();
    expect(overlayProblem(marker)).toBeNull();

    // the legend: 16 steps from the lowest height to the highest
    const legend = screen.getByRole('img', { name: 'Height bands from 100 m to 260 m' });
    expect(legend.children).toHaveLength(16);
    expect((legend.children[0] as HTMLElement).style.background).toBe('rgb(255, 0, 0)');
    expect((legend.children[15] as HTMLElement).style.background).toBe('rgb(0, 255, 0)');
  });

  it('RV C: the cross stays 16 pixels at every zoom, and its label stays just above it', async () => {
    stubServer();
    const { ctx, map } = await activated();
    renderPanel(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }));
    await drawCircle(map, SUNDSVALL, RADIUS);
    await screen.findByLabelText('Height map result');
    const armLength = (): number => {
      const arm = markerItems(map).find((i) => i.kind === 'line');
      if (arm?.kind !== 'line') throw new Error('no cross');
      return distance(arm.positions[0] ?? [0, 0], arm.positions[1] ?? [0, 0]);
    };
    const labelGap = (): number => {
      const label = markerItems(map).find((i) => i.kind === 'label');
      if (label?.kind !== 'label') throw new Error('no label');
      return distance(label.position, [17.3, 62.46]);
    };
    const bandSets = map.overlayItems.filter((items) => items.some((i) => i.kind === 'area')).length;
    for (const resolution of [2_000, 50, 4.5, 400, 12_000]) {
      act(() => {
        map.setViewport({ ...map.viewport, resolution });
      });
      const perPixel = metresPerPixelAt(map.viewport, [17.3, 62.46]);
      expect(armLength() / (16 * perPixel)).toBeCloseTo(1, 2);
      expect(labelGap() / (20 * perPixel)).toBeCloseTo(1, 2);
    }
    // only the cross's overlay was set again, never the bands'
    expect(map.overlayItems.filter((items) => items.some((i) => i.kind === 'area')).length).toBe(bandSets);

    // a pan that leaves the scale as it is draws nothing again; one that changes Mercator's scale by more than half a percent does
    const sets = map.overlayItems.length;
    act(() => {
      map.setViewport({ ...map.viewport, center: [map.viewport.center[0] + 0.001, map.viewport.center[1]] });
    });
    expect(map.overlayItems.length).toBe(sets);
    act(() => {
      map.setViewport({ ...map.viewport, center: [17.3, 30] });
    });
    expect(map.overlayItems.length).toBe(sets + 1);
    expect(armLength() / (16 * metresPerPixelAt(map.viewport, [17.3, 62.46]))).toBeCloseTo(1, 2);
  });

  it('SN A: the cross and its label are drawn above the bands, however the overlays were set before', async () => {
    stubServer();
    const ctx = createFakeContext({ pluginId: manifest.id, settings: settingDefaults(), uses: manifest.uses });
    const map = createFakeMapView({ pluginId: manifest.id });
    const stack = stackedOverlays(map);
    ctx.provideAs(MAP_VIEW, map);
    await plugin.activate(ctx);
    renderPanel(ctx);
    const circle = async (): Promise<void> => {
      fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }));
      await drawCircle(map, SUNDSVALL, RADIUS);
      await waitFor(() => {
        expect(stack()).toContain('cross');
      });
    };

    // the first height map: bands, then the cross above them
    await circle();
    expect(stack()).toEqual(['bands', 'cross']);
    // a zoom sets the cross again and it keeps its place
    act(() => {
      map.setViewport({ ...map.viewport, resolution: 77 });
    });
    expect(stack()).toEqual(['bands', 'cross']);
    // a second height map replaces the first: still the cross on top
    await circle();
    expect(stack()).toEqual(['bands', 'cross']);
    // Clear takes both away, and a third starts again from nothing
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(stack()).toEqual([]);
    await circle();
    expect(stack()).toEqual(['bands', 'cross']);
  });

  it('RV C: Clear takes the cross with it, and the zoom is no longer watched', async () => {
    stubServer();
    const { ctx, map } = await activated();
    renderPanel(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }));
    await drawCircle(map, SUNDSVALL, RADIUS);
    await screen.findByLabelText('Height map result');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(lastItems(map)).toEqual([]);
    expect(map.overlayItems.slice(-2).every((items) => items.length === 0)).toBe(true);
    const sets = map.overlayItems.length;
    act(() => {
      map.setViewport({ ...map.viewport, resolution: 77 });
    });
    expect(map.overlayItems.length).toBe(sets);
  });

  it("the metres per pixel at a position: Mercator's scale follows the latitude, another projection uses the centre's value", () => {
    const viewport = { center: [15, 62] as Position, resolution: 1000, projection: 'EPSG:3857', visibleArea: [] };
    expect(metresPerPixelAt(viewport, [15, 62])).toBeCloseTo(1000, 6);
    expect(metresPerPixelAt(viewport, [30, 62])).toBeCloseTo(1000, 6);
    expect(metresPerPixelAt(viewport, [15, 0])).toBeCloseTo(1000 / Math.cos((62 * Math.PI) / 180), 3);
    expect(metresPerPixelAt({ ...viewport, projection: 'EPSG:3413' }, [15, 0])).toBe(1000);
  });

  it('the colours: hue 0 (red) at the lowest band to 120 (green) at the highest, yellow between; one band is yellow', () => {
    expect(bandColor(0, 16)).toBe('#ff0000');
    expect(bandColor(15, 16)).toBe('#00ff00');
    expect(bandColor(0, 1)).toBe('#ffff00');
    expect(bandColor(5, 11)).toBe('#ffff00');
    // from red the green rises to full, then the red falls to nothing: green plus the missing red grows with every band
    const channels = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
    let before = -1;
    for (let b = 0; b < 16; b++) {
      const [r = 0, g = 0] = channels(bandColor(b, 16));
      const progress = g + (255 - r);
      expect(progress).toBeGreaterThan(before);
      before = progress;
    }
  });

  it('criterion 16: a flat circle is one band and its height, in the legend, the label and the panel', async () => {
    stubServer({ heightmap: () => jsonResponse(flatAnswer()) });
    const { ctx, map } = await activated();
    renderPanel(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }));
    await drawCircle(map, SUNDSVALL, RADIUS);
    const result = await screen.findByLabelText('Height map result');
    expect(result.textContent).toContain('12 m');
    expect(lastItems(map).filter((i) => i.kind === 'area')).toHaveLength(1);
    expect(markerItems(map).find((i) => i.kind === 'label')).toMatchObject({ text: '12 m' });
    expect(screen.getByRole('img', { name: 'Height bands from 12 m to 12 m' }).children).toHaveLength(1);
  });

  it('criterion 16: partly without data is said, and the server\'s notes are shown', async () => {
    stubServer({ heightmap: () => jsonResponse(heightMapAnswer({ partlyWithoutData: true, notes: ['Level 1 is used: level 2 needs 12345 height cells within the circle, the cap is 10000.'] })) });
    const { ctx, map } = await activated();
    renderPanel(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }));
    await drawCircle(map, SUNDSVALL, RADIUS);
    await screen.findByLabelText('Height map result');
    expect(screen.getByText(/Partly without data/)).toBeDefined();
    expect(screen.getByText(/Level 1 is used/)).toBeDefined();
  });

  it('criterion 17: a circle over the admin\'s longest range or under 100 m is refused at the field\'s message, without asking the server', async () => {
    const server = stubServer();
    const { ctx, map } = await activated();
    renderPanel(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }));
    await drawCircle(map, SUNDSVALL, 50_001);
    expect((await screen.findByRole('alert')).textContent).toBe('At most 50 km.');
    expect(server.calls.filter((c) => c.path === 'heightmap')).toHaveLength(0);
    expect(screen.queryByLabelText('Height map result')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }));
    await drawCircle(map, SUNDSVALL, 99);
    expect((await screen.findByRole('alert')).textContent).toBe('At least 100 m.');
    expect(server.calls.filter((c) => c.path === 'heightmap')).toHaveLength(0);

    // exactly at the limits it is asked for
    fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }));
    await drawCircle(map, SUNDSVALL, 50_000);
    await screen.findByLabelText('Height map result');
    expect(server.calls.filter((c) => c.path === 'heightmap')).toHaveLength(1);
  });

  it('the longest radius is the admin\'s setting, and follows a change', async () => {
    const server = stubServer();
    const { ctx, map } = await activated({ ...settingDefaults(), maxRange: 20000 });
    renderPanel(ctx);
    expect(screen.getByText(/A circle of 100 m to 20 km/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }));
    await drawCircle(map, SUNDSVALL, 20_001);
    expect((await screen.findByRole('alert')).textContent).toBe('At most 20 km.');
    act(() => {
      ctx.changeSettings({ ...settingDefaults(), maxRange: 80000 });
    });
    expect(screen.getByText(/A circle of 100 m to 80 km/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }));
    await drawCircle(map, SUNDSVALL, 70_000);
    await screen.findByLabelText('Height map result');
    expect(server.calls.at(-1)?.body).toEqual({ center: [17.31, 62.39], radius: 70_000 });
  });

  it('radiusProblem words the limits, and writes a fractional maximum plainly', () => {
    expect(radiusProblem(100, 50_000)).toBeNull();
    expect(radiusProblem(50_000, 50_000)).toBeNull();
    expect(radiusProblem(50_001, 50_000)).toBe('At most 50 km.');
    expect(radiusProblem(99.9, 50_000)).toBe('At least 100 m.');
    expect(radiusProblem(12_600, 12_500)).toBe('At most 12.5 km.');
  });

  it('criterion 17: shows the server\'s refusal with its reason: a second one (409) and over the cap (413)', async () => {
    let status = 409;
    let error = 'a viewshed is already running for you';
    stubServer({ heightmap: () => jsonResponse({ error }, status) });
    const { ctx, map } = await activated();
    renderPanel(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }));
    await drawCircle(map, SUNDSVALL, RADIUS);
    expect((await screen.findByRole('alert')).textContent).toBe('A viewshed is already running for you.');
    status = 413;
    error = 'the height map needs 200200 height cells within the circle at level 0, the coarsest level with data here; the cap is 100000: use a smaller circle';
    fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }));
    await drawCircle(map, SUNDSVALL, RADIUS);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('the cap is 100000: use a smaller circle'.replace('the', 'the'));
    });
    expect(screen.queryByLabelText('Height map result')).toBeNull();
  });

  it('Escape or Cancel ends the circle without asking the server', async () => {
    const server = stubServer();
    const { ctx, map } = await activated();
    renderPanel(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }));
    await drawCircle(map, SUNDSVALL, null); // Escape: the draw resolves with nothing
    await screen.findByRole('button', { name: 'Draw a circle' });
    fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }));
    await waitFor(() => {
      expect(map.runningInteraction).toBe('draw:circle');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByRole('button', { name: 'Draw a circle' });
    expect(map.runningInteraction).toBeNull();
    expect(server.calls.filter((c) => c.path === 'heightmap')).toHaveLength(0);
  });

  it('a new height map replaces the shown one, and Clear removes it with the circle waiting', async () => {
    stubServer();
    const { ctx, map } = await activated();
    renderPanel(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }));
    await drawCircle(map, SUNDSVALL, RADIUS);
    await screen.findByLabelText('Height map result');
    fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }));
    await drawCircle(map, [17.5, 62.5], 5_000);
    await waitFor(() => {
      expect(lastItems(map).filter((i) => i.kind === 'area')).toHaveLength(16);
    });
    expect(lastItems(map).filter((i) => i.kind === 'area')).toHaveLength(16);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(lastItems(map)).toEqual([]);
    expect(screen.queryByLabelText('Height map result')).toBeNull();

    // Clear while a circle is awaited ends the drawing
    fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }));
    await waitFor(() => {
      expect(map.runningInteraction).toBe('draw:circle');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => {
      expect(map.runningInteraction).toBeNull();
    });
  });

  it('an answer that arrives after Clear is not shown', async () => {
    let finish: (response: Response) => void = () => undefined;
    stubServer({ heightmap: () => new Promise<Response>((resolve) => { finish = resolve; }) });
    const { ctx, map } = await activated();
    renderPanel(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }));
    await drawCircle(map, SUNDSVALL, RADIUS);
    await screen.findByText('Computing…');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await act(async () => {
      finish(jsonResponse(heightMapAnswer()));
      await Promise.resolve();
    });
    expect(screen.queryByLabelText('Height map result')).toBeNull();
    expect(lastItems(map)).toEqual([]);
  });

  it('keeps the viewshed on the map when a height map is drawn: each tool has its own overlay and caps', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const path = url.slice(url.lastIndexOf('/') + 1);
        if (path === 'heightmap') return Promise.resolve(jsonResponse(heightMapAnswer()));
        if (path === 'viewshed') {
          return Promise.resolve(jsonResponse({ areas: [[ring(18, 59.2, 18.2, 59.4)]], level: 2, cells: 1, heightCells: 10, simplified: 0, leftOut: 0, positions: 5, partlyWithoutData: false, millis: 5, notes: [] }));
        }
        return Promise.resolve(jsonResponse({ state: 'ready', cells: 6 }));
      }),
    );
    const { ctx, map } = await activated();
    renderPanel(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Pick the observer' }));
    await waitFor(() => {
      expect(map.runningInteraction).toBe('pickPoint');
    });
    await act(async () => {
      map.completeInteraction([18.1, 59.3]);
      await Promise.resolve();
    });
    await screen.findByLabelText('Viewshed result');
    const viewshedSets = map.overlayItems.length;
    fireEvent.click(screen.getByRole('button', { name: 'Draw a circle' }));
    await drawCircle(map, SUNDSVALL, RADIUS);
    await screen.findByLabelText('Height map result');
    expect(screen.getByLabelText('Viewshed result')).toBeDefined();
    // nothing cleared the viewshed's overlay: after it only the cross's own overlay was cleared (to come last), and the height map's two were set
    const after = map.overlayItems.slice(viewshedSets);
    expect(after.filter((items) => items.length === 0)).toHaveLength(1);
    expect(after.some((items) => items.some((i) => i.kind === 'label'))).toBe(true);
    expect(after.some((items) => items.some((i) => i.kind === 'area'))).toBe(true);
  });

  it('is unavailable with the reason while there is no height data, and works again when there is', async () => {
    stubServer({ status: () => jsonResponse({ state: 'notSet', cells: 0 }) });
    const { ctx } = await activated();
    renderPanel(ctx);
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Draw a circle' }).disabled).toBe(true);
    });
    expect(screen.getAllByText(/The height folder is not set/)).toHaveLength(2); // the viewshed's and the height map's sections
  });

  it('formats a height to the metre above mean sea level, with a minus below it', () => {
    expect(formatHeight(412.4)).toBe('412 m');
    expect(formatHeight(412.5)).toBe('413 m');
    expect(formatHeight(0)).toBe('0 m');
    expect(formatHeight(-12.4)).toBe('−12 m');
    expect(heightLabel(517)).toBe('517 m');
  });

  it('draws what the answer holds within the overlay\'s caps: 2 000 areas of 20 positions and the extras fit', () => {
    const many: HeightMapResult = {
      bands: Array.from({ length: 16 }, (_, b) => ({
        index: b,
        lowest: b,
        highest: b + 1,
        areas: Array.from({ length: 1_240 }, (_, a) => [ring(17 + a * 0.0001, 62, 17.00005 + a * 0.0001, 62.00005)] as never),
      })),
      highestPosition: [17.3, 62.46],
      highestHeight: 15,
      lowest: 0,
      level: 2,
      cells: 1,
      heightCells: 1,
      simplified: 0,
      leftOut: 0,
      partlyWithoutData: false,
      millis: 1,
      notes: [],
    };
    const items = heightMapItems(SUNDSVALL, RADIUS, many);
    expect(items.length).toBe(16 * 1_240 + 1);
    expect(overlayProblem(items)).toBeNull();
    expect(destination([17.3, 62.46], 90, 500)[0]).toBeGreaterThan(17.3);
  });
});
