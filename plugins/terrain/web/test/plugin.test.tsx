import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAP_VIEW, overlayProblem, type JsonValue, type OverlayItem, type Position } from '@emc2/plugin-sdk';
import { checkLookCss, createFakeContext, createFakeMapView, createFakeUser, type FakeContext, type FakeMapView } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };
import plugin from '../src/index.tsx';
import terrainCss from '../src/terrain.css?raw';
import { circle, destination } from '../src/overlay.ts';
import { formatBearing, formatDistance, formatPosition, rangeLabel } from '../src/format.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The settings as the shell passes them when nothing is configured: the default of every setting. */
function settingDefaults(): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(manifest.settings.properties).map(([name, schema]) => [name, schema.default]));
}

const STOCKHOLM: Position = [18.0686, 59.3293];
const UPPSALA: Position = [17.6389, 59.8586];

const RANGE_ANSWER = {
  distance: 63766.001,
  initialBearing: 345.2123,
  finalBearing: 346.5,
  backBearing: 166.5,
  midpoint: [17.85, 59.59],
};

function viewshedAnswer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const ring = [
    [18.0, 59.2],
    [18.2, 59.2],
    [18.2, 59.4],
    [18.0, 59.4],
    [18.0, 59.2],
  ];
  const hole = [
    [18.05, 59.25],
    [18.05, 59.3],
    [18.1, 59.3],
    [18.1, 59.25],
    [18.05, 59.25],
  ];
  return { areas: [[ring, hole]], level: 2, cells: 2, heightCells: 400_000, simplified: 0, leftOut: 0, positions: 10, partlyWithoutData: false, millis: 1234, notes: [], ...overrides };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Server {
  readonly calls: { readonly path: string; readonly method: string; readonly body: unknown }[];
}

/** A server that answers like the plugin's: `range`, `viewshed` and `status`, each from a function the test can change. */
function stubServer(answers: { range?: () => Response; viewshed?: () => Response | Promise<Response>; status?: () => Response } = {}): Server {
  const server: Server = { calls: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.slice(url.lastIndexOf('/') + 1);
      server.calls.push({ path, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined });
      if (path === 'range') return Promise.resolve(answers.range?.() ?? jsonResponse(RANGE_ANSWER));
      if (path === 'viewshed') return Promise.resolve(answers.viewshed?.() ?? jsonResponse(viewshedAnswer()));
      if (path === 'status') return Promise.resolve(answers.status?.() ?? jsonResponse({ state: 'ready', cells: 6 }));
      return Promise.resolve(new Response('not found', { status: 404 }));
    }),
  );
  return server;
}

async function activated(options: { permissions?: readonly string[]; settings?: Record<string, JsonValue> } = {}): Promise<{ ctx: FakeContext; map: FakeMapView }> {
  const ctx = createFakeContext({
    pluginId: manifest.id,
    settings: options.settings ?? settingDefaults(),
    uses: manifest.uses,
    ...(options.permissions === undefined ? {} : { user: createFakeUser({ permissions: options.permissions }) }),
  });
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

const lastItems = (map: FakeMapView): readonly OverlayItem[] => map.overlayItems.at(-1) ?? [];

/** Picks a point as the user's click on the map, once the tool is waiting for it. */
async function click(map: FakeMapView, position: Position | null) {
  await waitFor(() => {
    expect(map.runningInteraction).toBe('pickPoint');
  });
  await act(async () => {
    map.completeInteraction(position);
    await Promise.resolve();
  });
}

describe('terrain web part', () => {
  it('is named after the plugin id', () => {
    expect(pkg.name).toBe(`@emc2/plugin-${manifest.id}`);
  });

  it('lists the CSS file the build writes (<id>.css)', () => {
    expect(manifest.web.css).toEqual([`${manifest.id}.css`]);
  });

  it('styles with design tokens only, every class prefixed with the plugin id (ADR-0034)', () => {
    expect(checkLookCss(terrainCss, { pluginId: manifest.id })).toEqual([]);
  });

  it('declares its permission, the folder and the map view it requires', () => {
    expect(manifest.permissions).toEqual(['plugin.terrain.use']);
    expect(manifest.requires).toEqual(['emc2.map-view']);
    expect(manifest.folders).toEqual([{ id: 'heights', setting: '/heightDataFolder', reason: expect.stringContaining('DTED') as unknown }]);
  });

  it('adds its panel to the right pane in every workspace, and reports OK', async () => {
    stubServer();
    const { ctx } = await activated();
    expect(ctx.addedPanels.map((p) => [p.panel.id, p.panel.title, p.panel.defaultPane, p.panel.workspaces])).toEqual([['terrain', 'Terrain', 'right', ['*']]]);
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
  });

  it('criterion 11: shows no panel to a user without plugin.terrain.use', async () => {
    stubServer();
    const { ctx } = await activated({ permissions: [] });
    expect(ctx.addedPanels).toHaveLength(0);
    const allowed = await activated({ permissions: ['plugin.terrain.use'] });
    expect(allowed.ctx.addedPanels).toHaveLength(1);
  });

  it('criterion 2: range and bearing show the line, the end marks and the label, and the panel the four values', async () => {
    const server = stubServer();
    const { ctx, map } = await activated();
    renderPanel(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Pick two points' }));
    await click(map, STOCKHOLM);
    expect(screen.getByText('Click the second point. Escape ends the tool.')).toBeDefined();
    await click(map, UPPSALA);

    await screen.findByRole('group', { name: 'Range and bearing result' }).catch(() => undefined);
    const result = await screen.findByLabelText('Range and bearing result');
    expect(result.textContent).toContain('Distance63.77 km');
    expect(result.textContent).toContain('Initial bearing345.2°');
    expect(result.textContent).toContain('Final bearing346.5°');
    expect(result.textContent).toContain('Back bearing166.5°');
    expect(result.textContent).toContain('59.32930° N, 18.06860° E');
    expect(result.textContent).toContain('59.85860° N, 17.63890° E');
    expect(server.calls.filter((c) => c.path === 'range')).toEqual([{ path: 'range', method: 'POST', body: { from: [18.0686, 59.3293], to: [17.6389, 59.8586] } }]);

    const items = lastItems(map);
    expect(items.map((i) => i.kind)).toEqual(['line', 'point', 'point', 'label']);
    expect(items[0]).toMatchObject({ kind: 'line', positions: [STOCKHOLM, UPPSALA] });
    expect(items[3]).toMatchObject({ kind: 'label', position: [17.85, 59.59], text: '63.77 km  345.2°' });
    expect(map.overlayProblems.at(-1)).toBeNull();
  });

  it('criterion 2: picking again starts a new pair and replaces the result; Escape ends the tool', async () => {
    let answer = RANGE_ANSWER;
    stubServer({ range: () => jsonResponse(answer) });
    const { ctx, map } = await activated();
    renderPanel(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Pick two points' }));
    await click(map, STOCKHOLM);
    await click(map, UPPSALA);
    await screen.findByLabelText('Range and bearing result');

    answer = { ...RANGE_ANSWER, distance: 842.4, initialBearing: 45.23, midpoint: [18.07, 59.33] };
    await click(map, [18.07, 59.33]);
    // the old result stays until the new pair is complete, with the new first point marked
    expect(screen.getByLabelText('Range and bearing result').textContent).toContain('63.77 km');
    expect(lastItems(map).map((i) => i.kind)).toEqual(['line', 'point', 'point', 'label', 'point']);
    await click(map, [18.08, 59.335]);
    await waitFor(() => {
      expect(screen.getByLabelText('Range and bearing result').textContent).toContain('842 m');
    });
    expect(screen.getByLabelText('Range and bearing result').textContent).toContain('045.2°');
    expect(lastItems(map).map((i) => i.kind)).toEqual(['line', 'point', 'point', 'label']);
    expect(lastItems(map)[3]).toMatchObject({ text: '842 m  045.2°' });

    // Escape (null) ends the tool and leaves the result
    await click(map, null);
    await screen.findByRole('button', { name: 'Pick two points' });
    expect(screen.getByLabelText('Range and bearing result').textContent).toContain('842 m');
  });

  it('criterion 2: Escape after the first point removes the lone mark and keeps the earlier result', async () => {
    stubServer();
    const { ctx, map } = await activated();
    renderPanel(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Pick two points' }));
    await click(map, STOCKHOLM);
    await click(map, UPPSALA);
    await screen.findByLabelText('Range and bearing result');
    await click(map, [18, 59]);
    await click(map, null);
    await screen.findByRole('button', { name: 'Pick two points' });
    expect(lastItems(map).map((i) => i.kind)).toEqual(['line', 'point', 'point', 'label']);
  });

  it('shows the server\'s reason when range and bearing fail', async () => {
    stubServer({ range: () => jsonResponse({ error: 'the latitude is -90 to 90' }, 400) });
    const { ctx, map } = await activated();
    renderPanel(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Pick two points' }));
    await click(map, STOCKHOLM);
    await click(map, UPPSALA);
    expect((await screen.findByRole('alert')).textContent).toBe('The latitude is -90 to 90.');
    expect(lastItems(map)).toEqual([expect.objectContaining({ kind: 'point' })]);
  });

  it('the viewshed has the brief\'s defaults and checks every field against its limits', async () => {
    stubServer();
    const { ctx } = await activated();
    renderPanel(ctx);
    expect(screen.getByLabelText<HTMLInputElement>('Observer height above ground (m)').value).toBe('2');
    expect(screen.getByLabelText<HTMLInputElement>('Target height above ground (m)').value).toBe('2');
    expect(screen.getByLabelText<HTMLInputElement>('Maximum range (m)').value).toBe('10000');
    const pick = screen.getByRole<HTMLButtonElement>('button', { name: 'Pick the observer' });
    expect(pick.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Maximum range (m)'), { target: { value: '50001' } });
    expect(screen.getByText('A range from 100 to 50000 m.')).toBeDefined();
    expect(pick.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Maximum range (m)'), { target: { value: '99' } });
    expect(screen.getByText('A range from 100 to 50000 m.')).toBeDefined();
    fireEvent.change(screen.getByLabelText('Maximum range (m)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Observer height above ground (m)'), { target: { value: '-1' } });
    expect(screen.getByText('A height from 0 to 1000 m.')).toBeDefined();
    fireEvent.change(screen.getByLabelText('Observer height above ground (m)'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('Target height above ground (m)'), { target: { value: '1001' } });
    expect(screen.getByText('A height from 0 to 1000 m.')).toBeDefined();
    fireEvent.change(screen.getByLabelText('Target height above ground (m)'), { target: { value: '1,5' } });
    expect(pick.disabled).toBe(false);
  });

  it('the longest range is the admin\'s setting, and follows a change', async () => {
    stubServer();
    const { ctx } = await activated({ settings: { ...settingDefaults(), maxRange: 20000 } });
    renderPanel(ctx);
    fireEvent.change(screen.getByLabelText('Maximum range (m)'), { target: { value: '20001' } });
    expect(screen.getByText('A range from 100 to 20000 m.')).toBeDefined();
    act(() => {
      ctx.changeSettings({ ...settingDefaults(), maxRange: 80000 });
    });
    fireEvent.change(screen.getByLabelText('Maximum range (m)'), { target: { value: '70000' } });
    expect(screen.queryByText(/A range from/)).toBeNull();
  });

  it('shows Computing… while the viewshed runs, then the areas, the observer, the circle and the answer', async () => {
    let finish: (response: Response) => void = () => undefined;
    const server = stubServer({ viewshed: () => new Promise<Response>((resolve) => { finish = resolve; }) });
    const { ctx, map } = await activated();
    renderPanel(ctx);
    fireEvent.change(screen.getByLabelText('Observer height above ground (m)'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pick the observer' }));
    expect(screen.getByText("Click the observer's point on the map. Escape cancels.")).toBeDefined();
    await click(map, [18.1, 59.3]);
    await screen.findByText('Computing…');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Pick the observer' }).disabled).toBe(true);
    expect(server.calls.at(-1)).toEqual({ path: 'viewshed', method: 'POST', body: { observer: [18.1, 59.3], observerHeight: 12, targetHeight: 2, maxRange: 10000 } });

    await act(async () => {
      finish(jsonResponse(viewshedAnswer({ partlyWithoutData: true, notes: ['Level 1 is used: level 2 needs 12345 height cells within the range, the cap is 10000.'] })));
      await Promise.resolve();
    });
    const result = await screen.findByLabelText('Viewshed result');
    expect(result.textContent).toContain('DTED level 2, 2 cells read');
    expect(result.textContent).toContain('1.2 s');
    expect(screen.getByText(/Partly without data/)).toBeDefined();
    expect(screen.getByText(/Level 1 is used/)).toBeDefined();
    expect(screen.queryByText('Computing…')).toBeNull();

    const items = lastItems(map);
    expect(items.map((i) => i.kind)).toEqual(['area', 'line', 'point']);
    const area = items[0];
    expect(area).toMatchObject({ kind: 'area', style: { strokeWidth: 1, fillOpacity: 0.3 } });
    expect(area && area.kind === 'area' ? area.rings.length : 0).toBe(2);
    const ringLine = items[1];
    if (ringLine?.kind !== 'line') throw new Error('no circle');
    expect(ringLine.positions.length).toBe(181);
    expect(ringLine.positions[0]).toEqual(ringLine.positions[180]);
    expect(items[2]).toMatchObject({ kind: 'point', position: [18.1, 59.3] });
    expect(map.overlayProblems.at(-1)).toBeNull();
    expect(overlayProblem(items)).toBeNull();
  });

  it('a new viewshed replaces the shown one, and Clear removes both tools\' results', async () => {
    stubServer();
    const { ctx, map } = await activated();
    renderPanel(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Pick two points' }));
    await click(map, STOCKHOLM);
    await click(map, UPPSALA);
    await screen.findByLabelText('Range and bearing result');
    await click(map, null);

    fireEvent.click(screen.getByRole('button', { name: 'Pick the observer' }));
    await click(map, [18.1, 59.3]);
    await screen.findByLabelText('Viewshed result');
    expect(lastItems(map).map((i) => i.kind)).toEqual(['line', 'point', 'point', 'label', 'area', 'line', 'point']);

    fireEvent.click(screen.getByRole('button', { name: 'Pick the observer' }));
    await click(map, [18.15, 59.35]);
    await waitFor(() => {
      expect(lastItems(map).at(-1)).toMatchObject({ position: [18.15, 59.35] });
    });
    expect(lastItems(map).filter((i) => i.kind === 'area')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(lastItems(map)).toEqual([]);
    expect(screen.queryByLabelText('Range and bearing result')).toBeNull();
    expect(screen.queryByLabelText('Viewshed result')).toBeNull();
  });

  it('shows a refusal with its reason: a second viewshed (409), over a limit (413) and a timeout (503)', async () => {
    let status = 409;
    let error = 'a viewshed is already running for you';
    stubServer({ viewshed: () => jsonResponse({ error }, status) });
    const { ctx, map } = await activated();
    renderPanel(ctx);
    for (const [s, e, shown] of [
      [409, 'a viewshed is already running for you', 'A viewshed is already running for you.'],
      [413, 'the viewshed needs 123 height cells within the range at level 0; the cap is 100: use a shorter range', 'The viewshed needs 123 height cells within the range at level 0; the cap is 100: use a shorter range.'],
      [503, 'the viewshed took longer than 30 seconds', 'The viewshed took longer than 30 seconds. Try again later.'],
      [403, 'x', 'You may not use the terrain tools.'],
    ] as const) {
      status = s;
      error = e;
      fireEvent.click(screen.getByRole('button', { name: 'Pick the observer' }));
      await click(map, [18.1, 59.3]);
      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toBe(shown);
      });
    }
    expect(lastItems(map)).toEqual([]);
  });

  it('says so when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('network'))));
    const { ctx, map } = await activated();
    renderPanel(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Pick the observer' }));
    await click(map, [18.1, 59.3]);
    expect((await screen.findByRole('alert')).textContent).toBe('The server cannot be reached.');
  });

  it('Escape while picking the observer cancels it without a request', async () => {
    const server = stubServer();
    const { ctx, map } = await activated();
    renderPanel(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Pick the observer' }));
    await click(map, null);
    await screen.findByRole('button', { name: 'Pick the observer' });
    expect(server.calls.filter((c) => c.path === 'viewshed')).toHaveLength(0);
  });

  it('says that the height folder is not set and still offers range and bearing', async () => {
    stubServer({ status: () => jsonResponse({ state: 'notSet', cells: 0 }) });
    const { ctx } = await activated();
    renderPanel(ctx);
    expect((await screen.findAllByText(/The height folder is not set/)).length).toBeGreaterThan(0);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Pick the observer' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Pick two points' }).disabled).toBe(false);
  });

  it("says why the height folder cannot be read, in ECore's words (T-157)", async () => {
    stubServer({ status: () => jsonResponse({ state: 'notReadable', cells: 0, reason: 'outside the emcc folder' }) });
    const { ctx } = await activated();
    renderPanel(ctx);
    // each section names its own tool: the viewshed's says viewsheds, the height map's says height maps
    const notices = await screen.findAllByText(/The height folder cannot be read \(outside the emcc folder\), so .* are not available/);
    expect(notices.map((n) => n.textContent)).toEqual([
      'The height folder cannot be read (outside the emcc folder), so viewsheds are not available. Ask an administrator to check the terrain settings.',
      'The height folder cannot be read (outside the emcc folder), so height maps are not available. Ask an administrator to check the terrain settings.',
    ]);
  });

  it('still says that the height folder cannot be read when the server gives no reason', async () => {
    stubServer({ status: () => jsonResponse({ state: 'notReadable', cells: 0 }) });
    const { ctx } = await activated();
    renderPanel(ctx);
    expect(await screen.findAllByText(/The height folder cannot be read, so viewsheds are not available/)).toHaveLength(1);
    expect(screen.getAllByText(/The height folder cannot be read, so height maps are not available/)).toHaveLength(1);
  });

  it('refuses to draw an overlay the map view would refuse, and says so', async () => {
    const huge = Array.from({ length: 30_000 }, () => [[[18, 59], [18.1, 59], [18.1, 59.1], [18, 59]]]);
    stubServer({ viewshed: () => jsonResponse(viewshedAnswer({ areas: huge })) });
    const { ctx, map } = await activated();
    renderPanel(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Pick the observer' }));
    await click(map, [18.1, 59.3]);
    expect((await screen.findByText(/The map cannot show this result/)).textContent).toContain('20000 items');
    expect(lastItems(map)).toEqual([]);
  });

  it('keeps its results when the panel is unmounted and mounted again', async () => {
    stubServer();
    const { ctx, map } = await activated();
    const first = renderPanel(ctx);
    fireEvent.click(screen.getByRole('button', { name: 'Pick the observer' }));
    await click(map, [18.1, 59.3]);
    await screen.findByLabelText('Viewshed result');
    first.unmount();
    renderPanel(ctx);
    expect(screen.getByLabelText('Viewshed result')).toBeDefined();
  });
});

describe('formats', () => {
  it('writes distances in m below 1 000 m and in km with two decimals above', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(842.4)).toBe('842 m');
    expect(formatDistance(999.4)).toBe('999 m');
    expect(formatDistance(999.6)).toBe('1.00 km');
    expect(formatDistance(1000)).toBe('1.00 km');
    expect(formatDistance(63766.001)).toBe('63.77 km');
  });

  it('writes bearings with one decimal and three digits before it', () => {
    expect(formatBearing(45.23)).toBe('045.2°');
    expect(formatBearing(0)).toBe('000.0°');
    expect(formatBearing(7.04)).toBe('007.0°');
    expect(formatBearing(345.2123)).toBe('345.2°');
    expect(formatBearing(359.96)).toBe('000.0°');
    expect(rangeLabel(63766, 45.23)).toBe('63.77 km  045.2°');
  });

  it('writes a position with the hemispheres, latitude and longitude apart', () => {
    expect(formatPosition([18.0686, 59.3293], null)).toBe('59.32930° N, 18.06860° E');
    expect(formatPosition([-70.25, -33.5], null)).toBe('33.50000° S, 70.25000° W');
    expect(formatPosition([18.0686, 59.3293], { format: () => '59°19′45″N 018°04′07″E' } as never)).toBe('59°19′45″N 018°04′07″E');
  });
});

describe('the range circle', () => {
  /** The great-circle distance on the sphere of the earth's mean radius. */
  function haversine(a: Position, b: Position): number {
    const rad = Math.PI / 180;
    const dLat = (b[1] - a[1]) * rad;
    const dLon = (b[0] - a[0]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h));
  }

  it('is closed, 181 positions, every one at the range from the centre (latitude differs from longitude)', () => {
    const center: Position = [18.0686, 59.3293];
    const ring = circle(center, 50_000);
    expect(ring).toHaveLength(181);
    expect(ring[0]).toEqual(ring[180]);
    for (const p of ring) expect(haversine(center, p)).toBeGreaterThan(50_000 * 0.995);
    for (const p of ring) expect(haversine(center, p)).toBeLessThan(50_000 * 1.005);
    // north (azimuth 0) is more latitude, east (azimuth 90, the 46th position) more longitude
    expect(ring[0]?.[1]).toBeGreaterThan(center[1] + 0.4);
    expect(ring[45]?.[0]).toBeGreaterThan(center[0] + 0.8);
  });

  it('goes the right way: 10 km east of a point at 59.3 N is 0.17 degrees of longitude away', () => {
    const p = destination([18.0686, 59.3293], 90, 10_000);
    expect(p[0]).toBeCloseTo(18.0686 + 10_000 / (111_320 * Math.cos((59.3293 * Math.PI) / 180)), 2);
    expect(p[1]).toBeCloseTo(59.3293, 2);
  });

  it('wraps across the antimeridian', () => {
    const ring = circle([179.95, -17.3], 20_000);
    for (const p of ring) expect(p[0]).toBeGreaterThanOrEqual(-180);
    expect(ring.some((p) => p[0] < -179.5)).toBe(true);
    expect(ring.some((p) => p[0] > 179.5)).toBe(true);
  });
});
