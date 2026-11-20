import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BACKGROUND_MAP, type BackgroundMapProvider, type VectorSource } from '@emc2/plugin-sdk';
import { createFakeVectorBackground, type FakeContext } from '@emc2/plugin-sdk/testing';
import { layer, symbolObject } from './fixtures.ts';
import { activate } from './harness.ts';
import { CONTROLS_OPEN_KEY, storageControlsOpen } from '../src/ui/controlsOpen.ts';

afterEach(cleanup);

function provider(id: string, name: string, projections: readonly string[]): BackgroundMapProvider {
  return {
    id, name, projections, attribution: { text: name },
    source: { type: 'xyz', url: `/api/plugins/${id}/tiles/{z}/{x}/{y}.png`, minZoom: 0, maxZoom: 19, tileSize: 256 },
  };
}

/** Opens the collapsed Map Pane controls (owner, 2026-10-21: they start as one button). */
function openControls() {
  fireEvent.click(screen.getByRole('button', { name: /^Map controls/ }));
}

function overlay(ctx: FakeContext, id: string) {
  const found = ctx.overlays.find((o) => o.id === id);
  if (found === undefined) throw new Error(`no overlay ${id}`);
  const Component = found.component;
  render(<Component />);
  return found;
}

describe('Map Pane controls (brief functions 2 and 3)', () => {
  it('sits top right and switches the projection', () => {
    const { ctx, engine } = activate();
    expect(overlay(ctx, 'map-view-2d-controls').position).toBe('top-right');
    openControls();
    const select = screen.getByLabelText('Projection');
    expect([...select.querySelectorAll('option')].map((o) => o.value)).toEqual(['EPSG:3857', 'EPSG:3413', 'EPSG:3031']);
    fireEvent.change(select, { target: { value: 'EPSG:3413' } });
    expect(engine?.projection.def.code).toBe('EPSG:3413');
    expect(screen.getByLabelText<HTMLSelectElement>('Projection').value).toBe('EPSG:3413');
  });

  it('offers only the background maps of the current projection, and none', () => {
    const { ctx, engine } = activate();
    const osm = provider('basemap-osm', 'OpenStreetMap', ['EPSG:3857']);
    const polar = provider('polar', 'Arctic', ['EPSG:3413']);
    ctx.provideAs(BACKGROUND_MAP, osm);
    ctx.provideAs(BACKGROUND_MAP, polar);
    overlay(ctx, 'map-view-2d-controls');
    openControls();
    const options = () => [...screen.getByLabelText('Background').querySelectorAll('option')].map((o) => o.textContent);
    expect(options()).toEqual(['OpenStreetMap', 'None (grid)']);
    expect(engine?.background).toBe(osm);

    fireEvent.change(screen.getByLabelText('Background'), { target: { value: '' } });
    expect(engine?.background).toBeNull();

    fireEvent.change(screen.getByLabelText('Projection'), { target: { value: 'EPSG:3413' } });
    expect(options()).toEqual(['Arctic', 'None (grid)']);
  });

  it('follows a background map that arrives while it is shown', () => {
    const { ctx } = activate();
    overlay(ctx, 'map-view-2d-controls');
    openControls();
    expect(screen.getByLabelText('Background').querySelectorAll('option')).toHaveLength(1);
    act(() => {
      ctx.provideAs(BACKGROUND_MAP, provider('basemap-osm', 'OpenStreetMap', ['EPSG:3857']));
    });
    expect(screen.getByLabelText<HTMLSelectElement>('Background').value).toBe('basemap-osm');
  });

  it('says so when a vector background cannot be loaded (brief function 11)', async () => {
    const { ctx } = activate();
    const fake = createFakeVectorBackground([], { id: 'basemap-naturalearth', name: 'Natural Earth' });
    const failing: BackgroundMapProvider = { ...fake, source: { ...(fake.source as VectorSource), load: () => Promise.reject(new Error('404')) } };
    overlay(ctx, 'map-view-2d-controls');
    openControls();
    act(() => {
      ctx.provideAs(BACKGROUND_MAP, failing);
    });
    expect((await screen.findByText('Background unavailable: Natural Earth')).getAttribute('role')).toBe('status');
    expect(screen.getByLabelText<HTMLSelectElement>('Background').value).toBe('basemap-naturalearth');
  });

  it('is not shown when the map cannot be drawn', () => {
    const { ctx } = activate({ mode: 'none' });
    expect(ctx.overlays).toEqual([]);
  });
});

describe('collapsible Map Pane controls (owner, 2026-10-21)', () => {
  it('start as one button; it opens the box with the focus in the first list, and the close button collapses it again, with the focus back on the button', () => {
    const { ctx } = activate();
    overlay(ctx, 'map-view-2d-controls');
    expect(screen.queryByLabelText('Projection')).toBeNull();
    openControls();
    expect(document.activeElement).toBe(screen.getByLabelText('Projection'));
    expect(screen.getByRole('group', { name: 'Map controls' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close map controls' }));
    expect(screen.queryByLabelText('Projection')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Map controls' }));
  });

  it("Escape in the box closes it, from the first list where the focus starts as from any other control, and does not reach the document, where the map's Escape would clear the selection (T-172)", () => {
    const { ctx } = activate();
    const reached: string[] = [];
    const onKeyDown = (event: KeyboardEvent) => {
      reached.push(`${event.key} on ${(event.target as Element).tagName}`);
    };
    document.addEventListener('keydown', onKeyDown);
    try {
      overlay(ctx, 'map-view-2d-controls');
      openControls();
      expect(document.activeElement).toBe(screen.getByLabelText('Projection'));
      fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' }); // right after opening: the focus is in the first list
      expect(screen.queryByLabelText('Projection')).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Map controls' }));
      openControls();
      for (const control of [() => screen.getByLabelText('Background'), () => screen.getByLabelText('Dim'), () => screen.getByRole('button', { name: 'Close map controls' })]) {
        fireEvent.keyDown(control(), { key: 'Escape' });
        expect(screen.queryByLabelText('Projection')).toBeNull();
        openControls();
      }
      fireEvent.keyDown(screen.getByLabelText('Projection'), { key: 'Enter' }); // another key does nothing
      expect(screen.queryByLabelText('Projection')).not.toBeNull();
      expect(reached).toEqual(['Enter on SELECT']); // no Escape reached the document
    } finally {
      document.removeEventListener('keydown', onKeyDown);
    }
  });

  it('are remembered per browser: opened, they start open on the next page', () => {
    const storage = new Map<string, string>();
    const store = storageControlsOpen(() => ({ getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }));
    const { ctx } = activate({ controlsOpen: store });
    overlay(ctx, 'map-view-2d-controls');
    openControls();
    expect(storage.get(CONTROLS_OPEN_KEY)).toBe('true');
    cleanup();
    const next = activate({ controlsOpen: storageControlsOpen(() => ({ getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) })) });
    overlay(next.ctx, 'map-view-2d-controls');
    expect(screen.getByLabelText('Projection')).not.toBeNull();
  });

  it('storage that refuses keeps the state for the page; collapsed when nothing is stored', () => {
    const refusing = storageControlsOpen(() => ({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } }));
    expect(refusing.load()).toBe(false);
    refusing.save(true);
    expect(refusing.load()).toBe(true);
    expect(storageControlsOpen(() => ({ getItem: () => null, setItem: () => undefined })).load()).toBe(false);
  });

  it('while collapsed, a problem puts a warning marker on the button and its text in the button name', async () => {
    const { ctx } = activate();
    const fake = createFakeVectorBackground([], { id: 'basemap-naturalearth', name: 'Natural Earth' });
    const failing: BackgroundMapProvider = { ...fake, source: { ...(fake.source as VectorSource), load: () => Promise.reject(new Error('404')) } };
    overlay(ctx, 'map-view-2d-controls');
    expect(document.querySelector('.map-view-2d-controls-marker')).toBeNull();
    act(() => {
      ctx.provideAs(BACKGROUND_MAP, failing);
    });
    expect(await screen.findByRole('button', { name: 'Map controls: Background unavailable: Natural Earth' })).not.toBeNull();
    expect(document.querySelector('.map-view-2d-controls-marker')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('rendering notice (brief function 9)', () => {
  it('criterion 13: no notice with a GPU', () => {
    const { ctx } = activate({ mode: 'hardware' });
    expect(ctx.overlays.map((o) => o.id)).toEqual(['map-view-2d-controls']);
  });

  it('criterion 13: shows the notice without a GPU; the user can dismiss it', () => {
    const { ctx } = activate({ mode: 'software' });
    overlay(ctx, 'map-view-2d-rendering');
    expect(screen.getByRole('status').textContent).toContain('This computer draws the map without a GPU. Up to about 10,000 objects are drawn one by one; beyond that the map shows clusters.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows no budget warning above the budget: in area mode the server keeps the view within it (criterion 14 replaced by 20 to 22)', () => {
    const { ctx, engine } = activate({ mode: 'software', settings: { softwareBudget: 3 } });
    overlay(ctx, 'map-view-2d-rendering');
    const L = layer(1);
    act(() => {
      ctx.live.snapshot({ layers: [L], objects: [1, 2, 3, 4, 5].map((n) => symbolObject(10 + n, L.id, 15, 60)) });
    });
    expect(screen.getByRole('status').textContent).not.toContain('may be slow. All symbols');
    expect(engine?.idsIn(L.id)).toHaveLength(5);
  });
});

describe('the look of the Map Pane overlays (brief function 21, criterion 43)', () => {
  it("uses the SDK's shared components, which take the shell's tokens: the two lists, the slider, the notice and its button", () => {
    const { ctx } = activate({ mode: 'software' });
    overlay(ctx, 'map-view-2d-controls');
    openControls();
    overlay(ctx, 'map-view-2d-rendering');
    for (const name of ['Projection', 'Background']) {
      const select = screen.getByLabelText(name);
      expect(select.className).toBe('emc2-input');
      expect(select.closest('label')?.className).toBe('emc2-field');
    }
    expect(document.querySelector('.map-view-2d-controls .emc2-slider')).not.toBeNull();
    expect(screen.getByText(/draws the map without a GPU/).closest('[role="status"]')?.className).toBe('emc2-notice emc2-notice-warning');
    expect(screen.getByRole('button', { name: 'Dismiss' }).className).toBe('emc2-button');
  });
});

describe('the dim slider (brief function 19)', () => {
  it('criterion 37: moves in steps of 10 % up to the highest level of the settings and dims the background through the engine', () => {
    const { ctx, engine } = activate({ settings: { highestDim: 70 } });
    overlay(ctx, 'map-view-2d-controls');
    openControls();
    const slider = screen.getByRole<HTMLInputElement>('slider', { name: /Dim/ });
    expect([slider.min, slider.max, slider.step, slider.value]).toEqual(['0', '70', '10', '0']);
    fireEvent.change(slider, { target: { value: '40' } });
    expect(engine?.dim).toBeCloseTo(0.4, 9);
    expect(screen.getByText('40 %')).toBeDefined();
  });
});
