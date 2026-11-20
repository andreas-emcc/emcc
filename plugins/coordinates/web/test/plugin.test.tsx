import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Crosshair } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  COORDINATES,
  MAP_VIEW,
  VIEW_WORKSPACE,
  appearsIn,
  fieldHint,
  fieldWidth,
  pluginIcon,
  settingsHintsProblem,
  type CurrentWorkspace,
  type JsonValue,
  type MapView,
  type Position,
  type SettingsSchema,
  type WorkspaceInfo,
} from '@emc2/plugin-sdk';
import { checkLookCss, createFakeContext, createFakeMapView, type FakeContext, type FakeMapView } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };
import { CoordinatesPanel } from '../src/CoordinatesPanel.tsx';
import { CursorPosition } from '../src/CursorPosition.tsx';
import plugin from '../src/index.tsx';
import { OPEN_KEY } from '../src/openStore.ts';
import { createCoordinateService, localFormatStore, STORAGE_KEY } from '../src/service.ts';
import { readSettings, type Settings } from '../src/settings.ts';
import { sharedState } from '../src/state.ts';
import { POLAR_REFERENCE_POINTS } from './polar-reference-points.ts';
import { REFERENCE_POINTS } from './reference-points.ts';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The settings as the shell passes them at start in SDK v1, when nobody has changed them: the default of every setting. */
function settingDefaults(): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(manifest.settings.properties).map(([name, schema]) => [name, schema.default]));
}

/** As the shell would load it. `uses` makes `get(MAP_VIEW)` reject at once when no map view is provided. */
function fakeContext(
  settings: Record<string, JsonValue> = settingDefaults(),
  options: { readonly uses?: readonly string[]; readonly workspaces?: readonly WorkspaceInfo[] } = { uses: manifest.uses },
): FakeContext {
  return createFakeContext({ pluginId: manifest.id, settings, provides: manifest.provides, ...options });
}

/**
 * The SDK's fake map view records `goTo` but keeps its viewport. map-view-2d moves the viewport at
 * once, to the nearest point its projection can show (its README; owner, 2026-10-12), and so does
 * this wrapper. `shows` gives where the map can go: everywhere, unless a test says otherwise.
 */
function movingMapView(shows: (center: Position) => Position = (center) => center, projection = 'EPSG:3857'): FakeMapView {
  const map = createFakeMapView();
  map.setViewport({ ...map.viewport, projection });
  const record = map.goTo.bind(map);
  map.goTo = (center, resolution) => {
    record(center, resolution);
    map.setViewport({ ...map.viewport, center: shows(center) });
  };
  return map;
}

/** Activated with a map view, with both overlays registered: the icon and the cursor display. */
async function activated(ctx = fakeContext(), map: FakeMapView = movingMapView()) {
  ctx.provideAs(MAP_VIEW, map);
  await plugin.activate(ctx);
  await vi.waitFor(() => {
    expect(ctx.overlays).toHaveLength(2);
  });
  const service = await ctx.services.get(COORDINATES);
  return { ctx, map, service };
}

function component(list: readonly { readonly id: string; readonly component: React.ComponentType }[], id: string) {
  const found = list.find((c) => c.id === id)?.component;
  if (!found) throw new Error(`no ${id}`);
  return found;
}

/** The icon over the map (brief function 8), with its window open, as a browser that remembers it open shows it. */
function openGoTo(ctx: FakeContext) {
  localStorage.setItem(OPEN_KEY, 'true');
  return component(ctx.overlays, 'coordinates-goto');
}

/** Distance in metres (equirectangular, short distances); the longitude difference is wrapped, for the poles and ±180°. */
function metres(a: Position, b: Position): number {
  const rad = Math.PI / 180;
  const radius = 6_371_008.8;
  const dlon = ((((a[0] - b[0]) % 360) + 540) % 360) - 180;
  return Math.hypot(dlon * Math.cos(((a[1] + b[1]) / 2) * rad) * radius * rad, (a[1] - b[1]) * radius * rad);
}

describe('coordinates web part', () => {
  it('is named after the plugin id', () => {
    // npm refuses two workspaces with the same name, so a copy must rename the package.
    expect(pkg.name).toBe(`@emc2/plugin-${manifest.id}`);
  });

  it('gives every setting a title, a description and a default, for the settings view (T-039)', () => {
    // The settings view labels a field with its schema's title; without one it makes a label from the property name ("Mgrs precision").
    const properties: Record<string, { readonly title?: string; readonly description?: string; readonly default?: unknown }> = manifest.settings.properties;
    expect(Object.fromEntries(Object.entries(properties).map(([name, schema]) => [name, schema.title]))).toEqual({
      defaultFormat: 'Default format',
      mgrsPrecision: 'MGRS precision',
      dmsSecondsDecimals: 'DMS seconds decimals',
    });
    for (const schema of Object.values(properties)) {
      expect(schema.description).toEqual(expect.any(String));
      expect(schema.default).toBeDefined();
    }
  });

  it('gives the settings form its hints, short fields and units, and the manifest the icon Crosshair (T-204, SDK 1.8.0 part D)', () => {
    expect(manifest.sdkVersion).toBe('^1.8.0');
    expect(settingsHintsProblem(manifest.settings)).toBeNull();
    expect(pluginIcon(manifest.icon)).toBe(Crosshair);
    const properties: Record<string, SettingsSchema> = manifest.settings.properties;
    // Each description is at most 80 characters, so it is the hint under the field, with no info button.
    for (const schema of Object.values(properties)) expect(fieldHint(schema)).toEqual({ hint: schema.description, more: null });
    expect(Object.values(properties).map((schema) => fieldWidth(schema))).toEqual(['short', 'short', 'short']);
    // Three fields: no groups (owner, 2026-11-15: units on the two numbers).
    expect(Object.fromEntries(Object.entries(properties).map(([name, schema]) => [name, schema['x-emc2']?.unit]))).toEqual({
      defaultFormat: undefined,
      mgrsPrecision: 'digits',
      dmsSecondsDecimals: 'decimals',
    });
  });

  it('lists the CSS file the build writes (<id>.css)', () => {
    expect(manifest.web.css).toEqual([`${manifest.id}.css`]);
  });

  it('pins mgrs and declares proj4 and lucide-react as shared peers', () => {
    expect(pkg.dependencies.mgrs).toBe('2.2.0');
    expect(pkg.peerDependencies.proj4).toBe('2.22.0');
    expect(pkg.peerDependencies['lucide-react']).toBe('1.49.0');
  });

  it('provides the coordinate service, the icon over the map and the cursor display, no panel, and reports OK', async () => {
    const { ctx, service } = await activated();
    expect(service.chosenFormat.value).toBe('dms');
    expect(ctx.addedPanels).toEqual([]);
    // After the map view's "Map controls" (order 10) in the top right corner (brief function 8).
    expect(ctx.overlays.map((o) => [o.id, o.position, o.order])).toEqual([
      ['coordinates-goto', 'top-right', 15],
      ['coordinates-cursor', 'bottom-left', undefined],
    ]);
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
  });

  it('uses the map view, and does not require it (CR-0012)', () => {
    expect(manifest.uses).toEqual(['emc2.map-view']);
    expect('requires' in manifest).toBe(false);
  });

  it('provides the service and the icon before the map view is there, and adds the cursor display when it comes', async () => {
    // Without "uses" here, the fake context waits for a provider that activates later.
    const ctx = fakeContext(settingDefaults(), {});
    await plugin.activate(ctx);
    const service = await ctx.services.get(COORDINATES);
    expect(service.format([15.654321, 60.123456])).toBe('60°07\'24.4" N 015°39\'15.6" E');
    expect(ctx.overlays.map((o) => o.id)).toEqual(['coordinates-goto']);
    expect(ctx.statusHistory).toEqual([]);
    ctx.provideAs(MAP_VIEW, createFakeMapView());
    await vi.waitFor(() => {
      expect(ctx.overlays).toHaveLength(2);
    });
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
  });

  it('works without a map view, and says so', async () => {
    const ctx = fakeContext();
    await plugin.activate(ctx);
    await vi.waitFor(() => {
      expect(ctx.statusHistory.at(-1)?.state).toBe('DEGRADED');
    });
    expect(ctx.statusHistory.at(-1)?.detail).toBe('map view unavailable: no cursor position and no go to');
    const service = await ctx.services.get(COORDINATES);
    expect(service.parse('33VWG 36360 65340')).toHaveProperty('position');
    expect(ctx.overlays.map((o) => o.id)).toEqual(['coordinates-goto']);
    const Panel = openGoTo(ctx);
    render(<Panel />);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Go' }).disabled).toBe(true);
    expect(screen.getByText('The map view is not available.')).toBeDefined();
  });

  it('reports bad settings and uses the defaults', async () => {
    const { ctx, service } = await activated(fakeContext({ defaultFormat: 'ups', mgrsPrecision: 9, dmsSecondsDecimals: 1 }));
    expect(service.chosenFormat.value).toBe('dms');
    expect(service.format(REFERENCE_POINTS[1]?.position ?? [0, 0], 'mgrs')).toBe('33VWG 36360 65340');
    expect(ctx.logs.filter((l) => l.level === 'warn').map((l) => l.message)).toEqual([
      expect.stringMatching(/defaultFormat/),
      expect.stringMatching(/mgrsPrecision/),
    ]);
    expect(ctx.statusHistory.at(-1)?.state).toBe('DEGRADED');
  });
});

describe('criterion 6: the cursor display follows the pointer and switches format at once', () => {
  it('shows the position under the pointer in the chosen format', async () => {
    const { ctx, map, service } = await activated();
    const Cursor = component(ctx.overlays, 'coordinates-cursor');
    render(<Cursor />);
    const display = screen.getByLabelText('Pointer position');
    expect(display.textContent).toBe('–');

    act(() => {
      map.firePointer({ type: 'move', position: [15.654321, 60.123456], pixel: [10, 20] });
    });
    expect(display.textContent).toBe('60°07\'24.4" N 015°39\'15.6" E');

    act(() => {
      map.firePointer({ type: 'move', position: [-43.210487, -22.951916], pixel: [11, 21] });
    });
    expect(display.textContent).toBe('22°57\'06.9" S 043°12\'37.8" W');

    act(() => {
      service.chosenFormat.set('mgrs');
    });
    expect(display.textContent).toBe('23KPQ 83477 60685');

    act(() => {
      service.chosenFormat.set('utm');
    });
    expect(display.textContent).toBe('23K 683478 7460686');

    act(() => {
      map.firePointer({ type: 'move', position: null, pixel: [0, 0] });
    });
    expect(display.textContent).toBe('–');
  });

  it('switches when the user picks a format in the window', async () => {
    const { ctx, map, service } = await activated();
    const Cursor = component(ctx.overlays, 'coordinates-cursor');
    const Panel = openGoTo(ctx);
    render(
      <>
        <Cursor />
        <Panel />
      </>,
    );
    act(() => {
      map.firePointer({ type: 'move', position: [15.654321, 60.123456], pixel: [10, 20] });
    });
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'dd' } });
    expect(service.chosenFormat.value).toBe('dd');
    expect(screen.getByLabelText('Pointer position').textContent).toBe('60.123456° N 15.654321° E');
  });

  it('keeps the chosen format in this browser', async () => {
    const first = await activated();
    first.service.chosenFormat.set('mgrs');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('mgrs');
    const second = await activated();
    expect(second.service.chosenFormat.value).toBe('mgrs');
  });

  it('ignores a stored value that is not a format', async () => {
    localStorage.setItem(STORAGE_KEY, 'ups');
    const { service } = await activated();
    expect(service.chosenFormat.value).toBe('dms');
    const untyped = service.chosenFormat as unknown as { set(value: string): void };
    expect(() => {
      untyped.set('ups');
    }).toThrow();
  });
});

describe('settings changed at runtime (SDK v1, CR-0012)', () => {
  const brief: Position = [15.654321, 60.123456];

  it('applies new precisions at once, in the service and the cursor display', async () => {
    const { ctx, map, service } = await activated();
    const Cursor = component(ctx.overlays, 'coordinates-cursor');
    render(<Cursor />);
    act(() => {
      service.chosenFormat.set('mgrs');
      map.firePointer({ type: 'move', position: brief, pixel: [1, 2] });
    });
    expect(screen.getByLabelText('Pointer position').textContent).toBe('33VWG 36360 65340');
    act(() => {
      ctx.changeSettings({ ...settingDefaults(), mgrsPrecision: 3, dmsSecondsDecimals: 2 });
    });
    expect(screen.getByLabelText('Pointer position').textContent).toBe('33VWG 363 653');
    expect(service.format(brief, 'dms')).toBe('60°07\'24.44" N 015°39\'15.56" E');
    expect(service.format(brief, 'mgrs', { precision: 5 })).toBe('33VWG 36360 65340');
  });

  it('applies a new default format while the user has not picked one', async () => {
    const { ctx, service } = await activated();
    expect(service.chosenFormat.value).toBe('dms');
    act(() => {
      ctx.changeSettings({ ...settingDefaults(), defaultFormat: 'mgrs' });
    });
    expect(service.chosenFormat.value).toBe('mgrs');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("keeps the user's pick when the default format changes", async () => {
    const { ctx, service } = await activated();
    service.chosenFormat.set('dd');
    ctx.changeSettings({ ...settingDefaults(), defaultFormat: 'utm' });
    expect(service.chosenFormat.value).toBe('dd');
  });

  it('keeps a pick stored in an earlier session when the default format changes', async () => {
    localStorage.setItem(STORAGE_KEY, 'dd');
    const { ctx, service } = await activated();
    ctx.changeSettings({ ...settingDefaults(), defaultFormat: 'utm' });
    expect(service.chosenFormat.value).toBe('dd');
  });

  it('reports a bad value in a change, uses the default, and reports OK again when fixed', async () => {
    const { ctx, service } = await activated();
    ctx.changeSettings({ ...settingDefaults(), mgrsPrecision: 9 });
    expect(ctx.statusHistory.at(-1)?.state).toBe('DEGRADED');
    expect(ctx.statusHistory.at(-1)?.detail).toMatch(/mgrsPrecision/);
    expect(service.format(brief, 'mgrs')).toBe('33VWG 36360 65340');
    ctx.changeSettings({ ...settingDefaults(), mgrsPrecision: 4 });
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
    expect(service.format(brief, 'mgrs')).toBe('33VWG 3636 6534');
  });
});

describe('local storage that the browser refuses', () => {
  it('works with the defaults when the storage calls throw', async () => {
    const refuse = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse });
    const { service } = await activated();
    expect(service.chosenFormat.value).toBe('dms');
    service.chosenFormat.set('utm');
    expect(service.chosenFormat.value).toBe('utm');
  });

  it('works with the defaults when even reading localStorage throws', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    onTestFinished(() => {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
    });
    const { service } = await activated();
    expect(service.chosenFormat.value).toBe('dms');
    service.chosenFormat.set('mgrs');
    expect(service.chosenFormat.value).toBe('mgrs');
  });
});

describe('criterion 7: go to', () => {
  it('says where the map went when the projection cannot show the point (map-view-2d centres on the nearest point it can)', async () => {
    // As in EPSG:3413, which map-view-2d keeps north of about 44° N on this meridian: 31° N 18° E centres at 44.2° N 8.1° E.
    const shown: Position = [8.1, 44.2];
    const map = movingMapView(([lon, lat]) => (lat < 44 ? shown : [lon, lat]), 'EPSG:3413');
    const { ctx } = await activated(fakeContext(), map);
    const Panel = openGoTo(ctx);
    render(<Panel />);

    fireEvent.change(screen.getByLabelText('Go to'), { target: { value: '31 N 18 E' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(map.goToCalls.at(-1)?.center).toEqual([18, 31]);
    expect(screen.getByRole('status').textContent).toBe(
      'Centred on 44°12\'00.0" N 008°06\'00.0" E, the nearest point this map (EPSG:3413) can show to 31°00\'00.0" N 018°00\'00.0" E',
    );

    // A point the map can show is reported as it was asked for.
    fireEvent.change(screen.getByLabelText('Go to'), { target: { value: 'Z 2000000 2000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByRole('status').textContent).toBe('Centred on 90°00\'00.0" N 000°00\'00.0" E');
  });

  it('counts a centre within 1 m as the requested point, and one 5 m away as moved', async () => {
    const metre = 1 / 111_195; // degrees of latitude per metre
    let offset = 0.5 * metre;
    const map = movingMapView(([lon, lat]) => [lon, lat + offset]);
    const { ctx } = await activated(fakeContext(), map);
    const Panel = openGoTo(ctx);
    render(<Panel />);
    fireEvent.change(screen.getByLabelText('Go to'), { target: { value: '60.5 N 18.25 E' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByRole('status').textContent).toBe('Centred on 60°30\'00.0" N 018°15\'00.0" E');

    offset = 5 * metre;
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByRole('status').textContent).toMatch(/, the nearest point this map \(EPSG:3857\) can show to 60°30'00\.0" N 018°15'00\.0" E$/);
  });

  it('reports the centre in the chosen format', async () => {
    const map = movingMapView(() => [8.1, 44.2], 'EPSG:3413');
    const { ctx, service } = await activated(fakeContext(), map);
    service.chosenFormat.set('mgrs');
    const Panel = openGoTo(ctx);
    render(<Panel />);
    fireEvent.change(screen.getByLabelText('Go to'), { target: { value: '31 N 18 E' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByRole('status').textContent).toBe(
      `Centred on ${service.format([8.1, 44.2])}, the nearest point this map (EPSG:3413) can show to ${service.format([18, 31])}`,
    );
    expect(screen.getByRole('status').textContent).toMatch(
      /^Centred on 32T[A-Z]{2} \d{5} \d{5}, the nearest point this map \(EPSG:3413\) can show to 34R[A-Z]{2} \d{5} \d{5}$/,
    );
  });

  it('centres the map on an MGRS text within 1 m', async () => {
    const { ctx, map } = await activated();
    const Panel = openGoTo(ctx);
    render(<Panel />);
    for (const p of REFERENCE_POINTS) {
      fireEvent.change(screen.getByLabelText('Go to'), { target: { value: p.mgrs5 } });
      fireEvent.click(screen.getByRole('button', { name: 'Go' }));
      const call = map.goToCalls.at(-1);
      if (!call) throw new Error('no go to');
      expect(metres(call.center, p.mgrs5Corner), p.note).toBeLessThan(1);
      expect(call.resolution).toBeUndefined();
    }
    expect(map.goToCalls).toHaveLength(REFERENCE_POINTS.length);
    expect(screen.getByRole('status').textContent).toMatch(/^Centred on /);
  });

  it('centres the map on polar MGRS and UPS text within 1 m (criteria 7 and 9)', async () => {
    const { ctx, map } = await activated();
    const Panel = openGoTo(ctx);
    render(<Panel />);
    for (const p of POLAR_REFERENCE_POINTS) {
      for (const [text, expected] of [
        [p.mgrs5, p.mgrs5Corner],
        [p.upsMetres, p.upsMetresPosition],
      ] as const) {
        fireEvent.change(screen.getByLabelText('Go to'), { target: { value: text } });
        fireEvent.click(screen.getByRole('button', { name: 'Go' }));
        const call = map.goToCalls.at(-1);
        if (!call) throw new Error('no go to');
        expect(metres(call.center, expected), `${p.note}: ${text}`).toBeLessThan(1);
      }
    }
    expect(map.goToCalls).toHaveLength(2 * POLAR_REFERENCE_POINTS.length);
  });

  it('accepts every supported format', async () => {
    const { ctx, map } = await activated();
    const Panel = openGoTo(ctx);
    render(<Panel />);
    for (const text of ['60.123456 15.654321', '60°07\'24.4" N 015°39\'15.6" E', '33V 536360 6665340', '33VWG 36360 65340']) {
      fireEvent.change(screen.getByLabelText('Go to'), { target: { value: text } });
      fireEvent.click(screen.getByRole('button', { name: 'Go' }));
      const call = map.goToCalls.at(-1);
      if (!call) throw new Error('no go to');
      expect(metres(call.center, [15.654321, 60.123456]), text).toBeLessThan(3);
    }
  });

  it('shows the error and does not move the map for invalid text', async () => {
    const { ctx, map } = await activated();
    const Panel = openGoTo(ctx);
    render(<Panel />);
    fireEvent.change(screen.getByLabelText('Go to'), { target: { value: '151.2153 -33.8568' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByRole('alert').textContent).toMatch(/latitude first/i);
    expect(map.goToCalls).toHaveLength(0);
  });
});

describe('criterion 8: no network request', () => {
  it('uses no fetch, XMLHttpRequest, WebSocket, EventSource or beacon', async () => {
    const fetch = vi.fn();
    const xhr = vi.fn();
    const socket = vi.fn();
    const events = vi.fn();
    const beacon = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('XMLHttpRequest', xhr);
    vi.stubGlobal('WebSocket', socket);
    vi.stubGlobal('EventSource', events);
    // jsdom has no sendBeacon: add one for this test only.
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    onTestFinished(() => {
      Reflect.deleteProperty(navigator, 'sendBeacon');
    });

    const { ctx, map, service } = await activated();
    const Cursor = component(ctx.overlays, 'coordinates-cursor');
    const Panel = openGoTo(ctx);
    render(
      <>
        <Cursor />
        <Panel />
      </>,
    );
    for (const format of ['dd', 'dms', 'utm', 'mgrs'] as const) {
      act(() => {
        service.chosenFormat.set(format);
      });
      for (const p of [...REFERENCE_POINTS, ...POLAR_REFERENCE_POINTS]) {
        act(() => {
          map.firePointer({ type: 'move', position: p.position, pixel: [1, 2] });
        });
        service.parse(service.format(p.position));
      }
    }
    fireEvent.change(screen.getByLabelText('Go to'), { target: { value: '33VWG 36360 65340' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));

    for (const spy of [fetch, xhr, socket, events, beacon]) expect(spy).not.toHaveBeenCalled();
  });
});

describe('the shared look (T-054, ADR-0034), in every pane, density and look', () => {
  // The pane, density and look are the shell's: the panel and the cursor display follow them only if
  // the CSS uses the design tokens alone. That they look right in each is checked in the browser.
  const source = readFileSync(join(import.meta.dirname, '../src/coordinates.css'), 'utf8');
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');

  // SDK 1.2.0: the shared check, the CSS part of the conformance reviewer's check 9 (CR-0025 part 1).
  it('takes its look from the design tokens only (check 9)', () => {
    expect(checkLookCss(source, { pluginId: 'coordinates' })).toEqual([]);
  });

  it("finds what check 9 fails in this plugin's CSS, so the check runs on it", () => {
    const broken = `${source}
.coordinates-x { color: var(--shell-fg); padding: 2px; background: #fff; font-family: monospace; }
.emc2-button { margin: 0; }`;
    expect(checkLookCss(broken, { pluginId: 'coordinates' }).map((f) => f.rule).sort()).toEqual(['alias', 'class', 'colour', 'font-family', 'length']);
  });

  it('frames the window as the map view\'s map settings window, sized in rows, and the field as high as Go', () => {
    // T-162 (owner, 2026-11-10): the map settings frame. The field: found in the browser check
    // (2026-10-21), the content-box input stood 2px above Select and Go.
    expect(css).toMatch(/\.coordinates-window\s*\{[^}]*width:\s*calc\(var\(--emc2-size-row\)\s*\*\s*10\);\s*max-width:\s*100%/);
    expect(css).toMatch(
      /\.coordinates-window\s*\{[^}]*padding:\s*var\(--emc2-space-padding\);\s*border:\s*1px solid var\(--emc2-color-border\);\s*border-radius:\s*var\(--emc2-radius\);\s*background:\s*var\(--emc2-color-pane\);\s*box-shadow:\s*var\(--emc2-shadow-card\)/,
    );
    expect(css).toMatch(/\.coordinates-toggle\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
    expect(css).toMatch(/\.coordinates-input\s*\{[^}]*box-sizing:\s*border-box/);
  });

  it('opens from the shared icon button with the Crosshair icon, a map control like the map view\'s, headed in the heading style', async () => {
    const { ctx } = await activated();
    const Icon = component(ctx.overlays, 'coordinates-goto');
    render(<Icon />);
    const button = screen.getByRole('button', { name: 'Coordinates' });
    expect([button.classList.contains('emc2-icon-button'), button.getAttribute('aria-haspopup'), button.parentElement?.className]).toEqual([true, 'dialog', 'coordinates-toggle']);
    cleanup();
    const crosshair = render(<Crosshair />).container.innerHTML;
    cleanup();
    render(<Icon />);
    expect(screen.getByRole('button', { name: 'Coordinates' }).innerHTML).toContain(crosshair.slice(crosshair.indexOf('<path'), crosshair.indexOf('</svg>')));
    expect(css).toMatch(/\.coordinates-toggle\s*\{[^}]*background:\s*var\(--emc2-color-pane\);[^}]*box-shadow:\s*var\(--emc2-shadow-card\)/);
    expect(css).toMatch(/\.coordinates-head\s*\{[^}]*font-family:\s*var\(--emc2-font-heading\);[^}]*text-transform:\s*var\(--emc2-heading-case\)/);
  });

  it('builds the panel from the shared components and Lucide icons', async () => {
    const { ctx } = await activated();
    const Panel = openGoTo(ctx);
    render(<Panel />);
    expect(screen.getByLabelText('Format').classList.contains('emc2-input')).toBe(true);
    const go = screen.getByRole('button', { name: 'Go' });
    expect([go.classList.contains('emc2-button'), go.classList.contains('emc2-button-primary'), go.getAttribute('type')]).toEqual([true, true, 'submit']);
    expect(go.querySelector('svg.emc2-icon')).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Go to'), { target: { value: '33VWG 36360 65340' } });
    fireEvent.click(go);
    expect(screen.getByRole('status').classList.contains('emc2-notice')).toBe(true);
    fireEvent.change(screen.getByLabelText('Go to'), { target: { value: 'not a position' } });
    fireEvent.click(go);
    expect(screen.getByRole('alert').classList.contains('emc2-notice-error')).toBe(true);
  });

  it("keeps its own 'go to' field, with the spell check off, marked invalid after an error until the text changes", async () => {
    // The SDK's TextField cannot turn the spell check off (owner, 2026-10-21: keep the plugin's own input).
    const { ctx } = await activated();
    const Panel = openGoTo(ctx);
    render(<Panel />);
    const field = screen.getByLabelText<HTMLInputElement>('Go to');
    expect([field.classList.contains('coordinates-input'), field.getAttribute('spellcheck'), field.getAttribute('aria-invalid')]).toEqual([true, 'false', null]);
    fireEvent.change(field, { target: { value: 'not a position' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(field.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(field, { target: { value: '33VWG' } });
    expect(field.getAttribute('aria-invalid')).toBeNull();
  });

  it('says so in a warning notice without a map view', async () => {
    const ctx = fakeContext();
    await plugin.activate(ctx);
    const Panel = openGoTo(ctx);
    render(<Panel />);
    expect(screen.getByText('The map view is not available.').classList.contains('emc2-notice-warning')).toBe(true);
  });

  it('shows the pointer position as a map control in the data font', async () => {
    const { ctx } = await activated();
    const Cursor = component(ctx.overlays, 'coordinates-cursor');
    render(<Cursor />);
    expect(screen.getByLabelText('Pointer position').className).toBe('coordinates-cursor');
    expect(css).toMatch(/\.coordinates-cursor\s*\{[^}]*font-family:\s*var\(--emc2-font-data\)/);
    expect(css).toMatch(/\.coordinates-input\s*\{[^}]*font-family:\s*var\(--emc2-font-data\)/);
  });
});

describe('criterion 11 (M4): the icon over the map', () => {
  /** The icon and the cursor display, the window closed unless the browser remembers it open. */
  async function icon() {
    const { ctx, map } = await activated();
    const Icon = component(ctx.overlays, 'coordinates-goto');
    const Cursor = component(ctx.overlays, 'coordinates-cursor');
    render(
      <>
        <Cursor />
        <Icon />
      </>,
    );
    // Hidden while the window is open, in its place (T-162).
    return { map, button: screen.getByRole('button', { name: 'Coordinates', hidden: true }) };
  }

  it('starts closed, opens the window with the focus on the format choice, and remembers it', async () => {
    const { button } = await icon();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog', { name: 'Coordinates' })).toBeNull();
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Coordinates' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(dialog.querySelector('.coordinates-head')?.textContent).toBe('Coordinates');
    expect(document.activeElement).toBe(screen.getByLabelText('Format'));
    expect(localStorage.getItem(OPEN_KEY)).toBe('true');
  });

  it("opens in the icon's place in the overlay, not in the top layer, the icon hidden meanwhile (T-162)", async () => {
    const { button } = await icon();
    const control = button.closest('.coordinates-goto-control');
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Coordinates' });
    // In the corner, where the icon was: the map view's map settings window does the same, so it grows to the left.
    expect([dialog.className, dialog.parentElement === control, dialog.hasAttribute('popover')]).toEqual(['coordinates-window', true, false]);
    expect(control?.firstElementChild).toBe(dialog);
    expect(button.closest('.coordinates-toggle')?.hasAttribute('hidden')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Coordinates' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close coordinates' }));
    expect(button.closest('.coordinates-toggle')?.hasAttribute('hidden')).toBe(false);
  });

  it('stays open on a press inside it', async () => {
    const { button } = await icon();
    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByLabelText('Go to'));
    fireEvent.pointerUp(screen.getByLabelText('Go to'));
    fireEvent.pointerDown(screen.getByRole('dialog', { name: 'Coordinates' }));
    fireEvent.pointerUp(document.body);
    await new Promise((done) => setTimeout(done, 10));
    expect(screen.getByRole('dialog', { name: 'Coordinates' })).toBeDefined();
    expect(localStorage.getItem(OPEN_KEY)).toBe('true');
  });

  it('closes with its close button, the focus back on the icon, and remembers it', async () => {
    const { button } = await icon();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Close coordinates' }));
    expect(screen.queryByRole('dialog', { name: 'Coordinates' })).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(localStorage.getItem(OPEN_KEY)).toBe('false');
  });

  it('closes on Escape, the focus back on the icon, and the Escape does not reach the map (no clearing of the selection)', async () => {
    const reached = vi.fn();
    document.addEventListener('keydown', reached);
    onTestFinished(() => {
      document.removeEventListener('keydown', reached);
    });
    const { button } = await icon();
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByLabelText('Format'), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Coordinates' })).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(reached).not.toHaveBeenCalled();
  });

  it('closes on a press outside once it has ended, the focus back on the icon', async () => {
    const { button } = await icon();
    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    // The browser's mousedown on something that takes no focus (the map) blurs.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(screen.getByRole('dialog', { name: 'Coordinates' })).toBeDefined();
    fireEvent.pointerUp(document.body);
    fireEvent.click(document.body);
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Coordinates' })).toBeNull();
    });
    expect(document.activeElement).toBe(button);
    expect(localStorage.getItem(OPEN_KEY)).toBe('false');
  });

  it('lets a click on the icon below it land before it closes (owner, 2026-11-10)', async () => {
    // The display settings icon stands below this one and moves up when the window closes.
    const below = vi.fn();
    const { button } = await icon();
    const other = document.body.appendChild(document.createElement('button'));
    other.addEventListener('click', () => {
      below(screen.queryByRole('dialog', { name: 'Coordinates' }) !== null);
    });
    onTestFinished(() => {
      other.remove();
    });
    fireEvent.click(button);
    fireEvent.pointerDown(other);
    // A hand takes a moment to let go.
    await new Promise((done) => setTimeout(done, 10));
    expect(screen.getByRole('dialog', { name: 'Coordinates' })).toBeDefined();
    fireEvent.pointerUp(other);
    fireEvent.click(other);
    expect(below).toHaveBeenCalledWith(true);
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Coordinates' })).toBeNull();
    });
  });

  it('closes when the browser cancels the press outside (a touch that scrolls)', async () => {
    const { button } = await icon();
    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    fireEvent.pointerCancel(document.body);
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Coordinates' })).toBeNull();
    });
  });

  it('opens as this browser remembers it, after a reload, without taking the focus', async () => {
    localStorage.setItem(OPEN_KEY, 'true');
    const { button } = await icon();
    expect(screen.getByRole('dialog', { name: 'Coordinates' })).toBeDefined();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(document.body);
  });

  it('stays open after "Go", having centred the map, and a new format shows at once in the cursor display', async () => {
    const { button, map } = await icon();
    fireEvent.click(button);
    // Latitude and longitude differ, so a swap would show.
    fireEvent.change(screen.getByLabelText('Go to'), { target: { value: '60.123456 15.654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    const call = map.goToCalls.at(-1);
    if (!call) throw new Error('no go to');
    expect(metres(call.center, [15.654321, 60.123456])).toBeLessThan(1);
    expect(screen.getByRole('dialog', { name: 'Coordinates' })).toBeDefined();
    expect(screen.getByRole('status').textContent).toBe('Centred on 60°07\'24.4" N 015°39\'15.6" E');
    act(() => {
      map.firePointer({ type: 'move', position: [15.654321, 60.123456], pixel: [10, 20] });
    });
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'mgrs' } });
    expect(screen.getByLabelText('Pointer position').textContent).toBe('33VWG 36360 65340');
  });

  it('opens and closes for this page only when the storage refuses', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { button } = await icon();
    fireEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Coordinates' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Close coordinates' }));
    expect(screen.queryByRole('dialog', { name: 'Coordinates' })).toBeNull();
  });
});

describe('criterion 10 (M3): the cursor display and "go to" in every workspace', () => {
  // The simulator's workspace, as the shell would list it. Only this test names it: the plugin's
  // code names no workspace (briefs README, M3 rule 1).
  const SIMULATION: WorkspaceInfo = {
    id: 'simulator.simulation',
    name: 'Simulation',
    viewPermission: 'plugin.simulator.view',
    editPermission: 'plugin.simulator.edit',
    order: 10,
  };

  async function inTwoWorkspaces() {
    return activated(fakeContext(settingDefaults(), { uses: manifest.uses, workspaces: [SIMULATION] }));
  }

  /**
   * A switch in the shell's order (M3 rule 9): the map view's moment first, then the context's.
   * The shell also mounts the panel and the overlay again (SDK CurrentWorkspace; checked in the
   * browser). Nothing here unmounts them, so the tests show what they do in a shell that kept them
   * mounted, as the shell did until 2026-10-29.
   */
  function switchTo(ctx: FakeContext, map: FakeMapView, id: string) {
    act(() => {
      map.switchWorkspace();
      ctx.switchWorkspace(id);
    });
  }

  it('adds the icon and the cursor display for every workspace, View and Simulation alike', async () => {
    const { ctx } = await inTwoWorkspaces();
    expect(ctx.overlays).toHaveLength(2);
    for (const item of ctx.overlays) {
      expect(item.workspaces, item.id).toEqual(['*']);
      expect([appearsIn(item, VIEW_WORKSPACE), appearsIn(item, SIMULATION.id), appearsIn(item, 'a.later-workspace')], item.id).toEqual([true, true, true]);
    }
  });

  it('centres the map of Simulation and shows positions there, after a switch from View', async () => {
    const { ctx, map } = await inTwoWorkspaces();
    const statuses = ctx.statusHistory.length;
    switchTo(ctx, map, SIMULATION.id);
    expect(ctx.workspace.current.id).toBe(SIMULATION.id);

    const Panel = openGoTo(ctx);
    const Cursor = component(ctx.overlays, 'coordinates-cursor');
    render(
      <>
        <Cursor />
        <Panel />
      </>,
    );
    // Latitude and longitude differ, so a swap would show.
    fireEvent.change(screen.getByLabelText('Go to'), { target: { value: '33VWG 36360 65340' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    const call = map.goToCalls.at(-1);
    if (!call) throw new Error('no go to');
    expect(metres(call.center, [15.654321, 60.123456])).toBeLessThan(1);
    expect(screen.getByRole('status').textContent).toBe('Centred on 60°07\'24.4" N 015°39\'15.6" E');

    act(() => {
      map.firePointer({ type: 'move', position: [-43.210487, -22.951916], pixel: [11, 21] });
    });
    expect(screen.getByLabelText('Pointer position').textContent).toBe('22°57\'06.9" S 043°12\'37.8" W');
    // Nothing on a switch changes the plugin's status.
    expect(ctx.statusHistory).toHaveLength(statuses);
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
  });

  it('keeps the chosen format in every workspace; a panel kept mounted keeps the typed text and clears the last message on a switch', async () => {
    const { ctx, map, service } = await inTwoWorkspaces();
    const Panel = openGoTo(ctx);
    const Cursor = component(ctx.overlays, 'coordinates-cursor');
    render(
      <>
        <Cursor />
        <Panel />
      </>,
    );
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'mgrs' } });
    fireEvent.change(screen.getByLabelText('Go to'), { target: { value: '60.123456 15.654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByRole('status').textContent).toBe('Centred on 33VWG 36360 65340');

    // Each workspace has its own map state, so "Centred on …" would speak of View's map in Simulation.
    switchTo(ctx, map, SIMULATION.id);
    expect(screen.queryByRole('status')).toBeNull();
    expect(service.chosenFormat.value).toBe('mgrs');
    expect(screen.getByLabelText<HTMLSelectElement>('Format').value).toBe('mgrs');
    expect(screen.getByLabelText<HTMLInputElement>('Go to').value).toBe('60.123456 15.654321');
    act(() => {
      map.firePointer({ type: 'move', position: [15.654321, 60.123456], pixel: [10, 20] });
    });
    expect(screen.getByLabelText('Pointer position').textContent).toBe('33VWG 36360 65340');

    // An error goes too, and back in View the format is the same.
    fireEvent.change(screen.getByLabelText('Go to'), { target: { value: '95 15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByLabelText('Go to').getAttribute('aria-invalid')).toBe('true');
    switchTo(ctx, map, VIEW_WORKSPACE);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Go to').getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>('Go to').value).toBe('95 15');
    expect(screen.getByLabelText<HTMLSelectElement>('Format').value).toBe('mgrs');
  });

  it('shows no position on a switch until the pointer moves over the new map', async () => {
    const { ctx, map } = await inTwoWorkspaces();
    const Cursor = component(ctx.overlays, 'coordinates-cursor');
    render(<Cursor />);
    const display = screen.getByLabelText('Pointer position');
    act(() => {
      map.firePointer({ type: 'move', position: [-43.210487, -22.951916], pixel: [11, 21] });
    });
    expect(display.textContent).toBe('22°57\'06.9" S 043°12\'37.8" W');

    // The last position was on View's map; Simulation's map shows another place (browser check, 2026-10-28).
    switchTo(ctx, map, SIMULATION.id);
    expect(display.textContent).toBe('–');
    act(() => {
      map.firePointer({ type: 'move', position: [15.654321, 60.123456], pixel: [10, 20] });
    });
    expect(display.textContent).toBe('60°07\'24.4" N 015°39\'15.6" E');

    switchTo(ctx, map, VIEW_WORKSPACE);
    expect(display.textContent).toBe('–');
  });

  /** A workspace that counts its listeners, in the shape the shell gives it. */
  function spyWorkspace() {
    const listeners = new Set<(workspace: WorkspaceInfo) => void>();
    const workspace: CurrentWorkspace = {
      current: { id: VIEW_WORKSPACE, name: 'View', order: 0 },
      onChange(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    return { listeners, workspace };
  }

  /** The panel on its own, with the workspace the shell gives it. */
  function panelWith(workspace: CurrentWorkspace) {
    const settings = sharedState<Settings>(readSettings(settingDefaults()).settings);
    const service = createCoordinateService(settings, localFormatStore());
    const map = createFakeMapView();
    const view = render(<CoordinatesPanel service={service} mapView={sharedState<MapView | null>(map)} settings={settings} workspace={workspace} />);
    return { map, view };
  }

  /** The cursor display on its own, likewise. */
  function cursorWith(workspace: CurrentWorkspace) {
    const settings = sharedState<Settings>(readSettings(settingDefaults()).settings);
    const service = createCoordinateService(settings, localFormatStore());
    const map = createFakeMapView();
    const view = render(<CursorPosition map={map} service={service} settings={settings} workspace={workspace} />);
    return { map, view };
  }

  it('stops listening for switches when the panel or the cursor display is unmounted', () => {
    for (const mount of [panelWith, cursorWith]) {
      const { listeners, workspace } = spyWorkspace();
      const { view } = mount(workspace);
      expect(listeners.size, mount.name).toBe(1);
      view.unmount();
      expect(listeners.size, mount.name).toBe(0);
    }
  });
});
