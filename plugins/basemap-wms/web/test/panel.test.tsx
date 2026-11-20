// The plugin's own settings panel (brief, function 6) and criteria 6, 7, 8 and 12 as far as the browser is concerned.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { BACKGROUND_MAP } from '@emc2/plugin-sdk';
import type { Settings, WmsSource } from '@emc2/plugin-sdk';
import { createFakeContext, createFakeUser, wmsGetMapUrl } from '@emc2/plugin-sdk/testing';
import type { FakeContext, FakeContextOptions } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import plugin from '../src/index.tsx';
import { BackgroundSync } from '../src/providers.ts';
import { FakeServerPart, GROUP, LAND, SEA, SERVER_BASE, background, server, settings } from './fakeServer.ts';

let fake: FakeServerPart;
let starts: MockInstance<BackgroundSync['start']>;

beforeEach(() => {
  starts = vi.spyOn(BackgroundSync.prototype, 'start');
  fake = new FakeServerPart();
  fake.layers = { geo: [LAND, SEA, GROUP], other: [LAND] };
  fake.offered = [{ id: 'topo', projections: ['EPSG:3857'] }];
  fake.install();
});

afterEach(() => {
  cleanup();
  for (const sync of starts.mock.contexts as BackgroundSync[]) sync.stop();
  starts.mockRestore();
  vi.unstubAllGlobals();
});

const TWO_LAYERS = settings([server('geo')], [background('topo', 'geo', ['land', 'sea'])]);

interface Opened {
  readonly ctx: FakeContext;
  readonly view: RenderResult;
  /** Renders the panel again with the props the shell would give now (after a change of settings). */
  readonly refresh: () => void;
}

async function open(initial: Settings = TWO_LAYERS, options: FakeContextOptions = {}): Promise<Opened> {
  const ctx = createFakeContext({ pluginId: manifest.id, settings: initial, ...options });
  await plugin.activate(ctx);
  const Panel = ctx.settingsPanel?.component;
  if (!Panel) throw new Error('no settings panel');
  const props = ctx.settingsPanelProps();
  const view = render(<Panel {...props} />);
  return {
    ctx,
    view,
    refresh() {
      view.rerender(<Panel {...ctx.settingsPanelProps()} />);
    },
  };
}

const card = (name: RegExp | string) => screen.getByRole('region', { name });
const type = (label: string, scope: HTMLElement, value: string) => {
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
};
const click = (name: RegExp | string, scope?: HTMLElement) => {
  fireEvent.click((scope ? within(scope) : screen).getByRole('button', { name }));
};
async function save(): Promise<void> {
  await act(async () => {
    click('Save');
    await Promise.resolve();
  });
}
const layersOf = (text: string): string[] => within(screen.getByRole('list', { name: text })).getAllByRole('listitem').map((li) => li.textContent);

describe('the layer list (criterion 7)', () => {
  it('lists the saved server’s layers with title, name and projections, the chosen ones checked', async () => {
    await open();

    const land = await screen.findByRole('checkbox', { name: 'Land (land)' });
    expect((land as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole<HTMLInputElement>('checkbox', { name: 'Sea (sea)' })).checked).toBe(true);
    expect((screen.getByRole<HTMLInputElement>('checkbox', { name: 'A group (group)' })).checked).toBe(false);
    expect(screen.getAllByText('EPSG:4326, EPSG:3857, EPSG:3413').length).toBeGreaterThan(0);
    expect(fake.layerRequests).toEqual([`${SERVER_BASE}servers/geo/layers`]);
  });

  it('says “Save the server to see its layers” for a server that is not saved, and lists the layers after the save', async () => {
    const { ctx, refresh } = await open(settings([], []));
    fake.layers['local'] = [LAND, SEA];

    click('Add server');
    const serverCard = card('Server New server');
    type('Name', serverCard, 'Local');
    type('Address', serverCard, 'http://wms.test/ows');
    click('Add background');
    const backgroundCard = card('Background New background');
    fireEvent.change(within(backgroundCard).getByLabelText('Server'), { target: { value: 'local' } });

    expect(within(backgroundCard).getByText('Save the server to see its layers')).toBeDefined();
    expect(fake.layerRequests).toEqual([]);

    // the background is not finished, so it goes for now; the server alone is saved
    click('Remove background New background');
    await save();
    refresh();
    expect(ctx.settingsSaves.at(-1)?.['servers']).toEqual([{ id: 'local', name: 'Local', url: 'http://wms.test/ows', protocol: 'wms', version: '1.3.0', timeoutSeconds: 8 }]);

    click('Add background');
    fireEvent.change(within(card('Background New background')).getByLabelText('Server'), { target: { value: 'local' } });
    expect(await screen.findByRole('checkbox', { name: 'Land (land)' })).toBeDefined();
    expect(screen.getByRole('checkbox', { name: 'Sea (sea)' })).toBeDefined();
    expect(fake.layerRequests).toEqual([`${SERVER_BASE}servers/local/layers`]);
  });

  it('says it again for a saved server whose address was changed and not saved', async () => {
    await open();
    await screen.findByRole('checkbox', { name: 'Land (land)' });

    type('Address', card('Server Server geo'), 'http://moved.test/ows');

    expect(within(card('Background Background topo')).getByText('Save the server to see its layers')).toBeDefined();
  });

  it('“Read the layers again” asks the server part to read the capabilities again', async () => {
    await open();
    await screen.findByRole('checkbox', { name: 'Land (land)' });
    fake.layers['geo'] = [LAND];

    click('Read the layers again');

    await waitFor(() => { expect(screen.queryByRole('checkbox', { name: 'Sea (sea)' })).toBeNull(); });
    expect(fake.layerRequests.at(-1)).toBe(`${SERVER_BASE}servers/geo/layers?refresh=true`);
    // the chosen layer the server no longer has stays, marked missing, until the admin removes it
    expect(screen.getByRole('checkbox', { name: 'sea (missing on the server)' })).toBeDefined();
    fireEvent.click(screen.getByRole('checkbox', { name: 'sea (missing on the server)' }));
    expect(screen.queryByRole('checkbox', { name: 'sea (missing on the server)' })).toBeNull();
  });

  it('shows the reason when the layer list is refused (criterion 8 from the browser’s side)', async () => {
    fake.layersStatus = 403;
    await open();

    expect(await screen.findByText(/needs the settings permission/)).toBeDefined();
  });

  it('shows the projections every chosen layer lists', async () => {
    await open(settings([server('geo')], [background('both', 'geo', ['land', 'group'])]));
    await screen.findByRole('checkbox', { name: 'Land (land)' });

    expect(screen.getByText('Offered in: EPSG:4326, EPSG:3857')).toBeDefined();
    fireEvent.click(screen.getByRole('checkbox', { name: 'A group (group)' })); // unchecked: only land remains
    expect(screen.getByText('Offered in: EPSG:4326, EPSG:3857, EPSG:3413')).toBeDefined();
  });
});

describe('the drawing order (criterion 6)', () => {
  it('lists the chosen layers top-most first; Move up on the lower one, then Save, draws it on top and LAYERS follow', async () => {
    const { ctx } = await open();
    await screen.findByRole('checkbox', { name: 'Land (land)' });
    // stored bottom first [land, sea]: sea is on top
    expect(layersOf('Drawing order of Background topo, top-most first').map((t) => t.replace(/Move.*$/, ''))).toEqual(['Sea', 'Land']);

    click('Move up land');
    expect(layersOf('Drawing order of Background topo, top-most first').map((t) => t.replace(/Move.*$/, ''))).toEqual(['Land', 'Sea']);
    await save();

    const saved = ctx.settingsSaves.at(-1)?.['backgrounds'] as { layers: string[] }[];
    expect(saved[0]?.layers).toEqual(['sea', 'land']);
    // the saved settings reach the map view's provider at once, and the request's LAYERS follow the new order
    await waitFor(() => {
      const source = ctx.services.getAll(BACKGROUND_MAP).current[0]?.source as WmsSource | undefined;
      expect(source?.layers).toEqual(['sea', 'land']);
    });
    const source = ctx.services.getAll(BACKGROUND_MAP).current[0]?.source as WmsSource;
    expect(wmsGetMapUrl(source, { projection: 'EPSG:3857', bbox: [0, 0, 1, 1], width: 256, height: 256 })).toContain('LAYERS=sea%2Cland');
  });

  it('disables Move up at the top and Move down at the bottom, and says why; the moves are plain buttons, so the keyboard works', async () => {
    await open();
    await screen.findByRole('checkbox', { name: 'Land (land)' });

    const upSea = screen.getByRole<HTMLButtonElement>('button', { name: 'Move up sea' });
    const downLand = screen.getByRole<HTMLButtonElement>('button', { name: 'Move down land' });
    expect(upSea.disabled).toBe(true);
    expect(upSea.title).toBe('Already the top-most layer');
    expect(downLand.disabled).toBe(true);
    expect(downLand.title).toBe('Already the bottom layer');
    const upLand = screen.getByRole('button', { name: 'Move up land' });
    expect(upLand.tagName).toBe('BUTTON');
    expect(upLand.getAttribute('tabindex')).not.toBe('-1');
  });

  it('puts a layer checked later on top', async () => {
    await open();
    await screen.findByRole('checkbox', { name: 'Land (land)' });

    fireEvent.click(screen.getByRole('checkbox', { name: 'A group (group)' }));

    expect(layersOf('Drawing order of Background topo, top-most first').map((t) => t.replace(/Move.*$/, ''))).toEqual(['A group', 'Sea', 'Land']);
  });
});

describe('servers and backgrounds', () => {
  it('refuses removing a server that a background still uses, and removes one that is free', async () => {
    await open(settings([server('geo'), server('other')], [background('topo', 'geo', ['land'])]));

    const used = within(card('Server Server geo')).getByRole<HTMLButtonElement>('button', { name: 'Remove server Server geo' });
    expect(used.disabled).toBe(true);
    expect(used.title).toContain('Background topo');
    const free = within(card('Server Server other')).getByRole('button', { name: 'Remove server Server other' });
    fireEvent.click(free);
    expect(screen.queryByRole('region', { name: 'Server Server other' })).toBeNull();
  });

  it('makes each id from the name, unique, and keeps it when the name changes later', async () => {
    const { ctx, refresh } = await open(settings([], []));

    click('Add server');
    type('Name', card('Server New server'), 'Local WMS');
    type('Address', card('Server Local WMS'), 'http://a.test/ows');
    click('Add server');
    type('Name', card('Server New server'), 'Local WMS');
    type('Address', screen.getAllByRole('region', { name: 'Server Local WMS' })[1] as HTMLElement, 'http://b.test/ows');
    await save();
    refresh();

    expect((ctx.settingsSaves.at(-1)?.['servers'] as { id: string }[]).map((s) => s.id)).toEqual(['local-wms', 'local-wms-2']);
    type('Name', screen.getAllByRole('region', { name: 'Server Local WMS' })[0] as HTMLElement, 'Renamed');
    await save();
    expect((ctx.settingsSaves.at(-1)?.['servers'] as { id: string }[]).map((s) => s.id)).toEqual(['local-wms', 'local-wms-2']);
  });

  it('refuses a background without a server, without layers, and without attribution; nothing is saved', async () => {
    const { ctx } = await open(settings([server('geo')], []));
    click('Add background');
    const backgroundCard = card('Background New background');
    fireEvent.change(within(backgroundCard).getByLabelText('Server'), { target: { value: '' } });

    await save();

    expect(ctx.settingsSaves).toEqual([]);
    expect(within(backgroundCard).getByText('Give the background a name.')).toBeDefined();
    expect(within(backgroundCard).getByText('Choose a server.')).toBeDefined();
    expect(within(backgroundCard).getByText('Choose at least one layer.')).toBeDefined();
    expect(within(backgroundCard).getByText('Enter the attribution text.')).toBeDefined();
  });

  it('checks the address and the timeout of a server where they are typed', async () => {
    const { ctx } = await open(settings([], []));
    click('Add server');
    const serverCard = card('Server New server');
    type('Name', serverCard, 'Bad');
    type('Address', serverCard, 'http://user:secret@wms.test/ows');
    type('Timeout (seconds)', card('Server Bad'), '99');

    await save();

    expect(ctx.settingsSaves).toEqual([]);
    expect(within(card('Server Bad')).getByText('Use an http or https address without a user name or password.')).toBeDefined();
    expect(within(card('Server Bad')).getByText('Use a whole number of seconds from 1 to 20.')).toBeDefined();
  });

  it('takes the format of a transparent background as PNG, and clears transparency when the format becomes JPEG', async () => {
    await open();
    const backgroundCard = card('Background Background topo');
    const transparent = within(backgroundCard).getByRole<HTMLInputElement>('checkbox', { name: 'Transparent (PNG only)' });

    fireEvent.click(transparent);
    expect(transparent.checked).toBe(true);
    fireEvent.change(within(backgroundCard).getByLabelText('Image format'), { target: { value: 'image/jpeg' } });

    expect(transparent.checked).toBe(false);
    expect(transparent.disabled).toBe(true);
  });

  it('saves the whole settings in the manifest’s shape, with the mode, format and attribution', async () => {
    const { ctx } = await open();
    const backgroundCard = card('Background Background topo');
    fireEvent.change(within(backgroundCard).getByLabelText('Maps are drawn as'), { target: { value: 'image' } });
    type('Attribution link (optional)', backgroundCard, '');

    await save();

    expect(ctx.settingsSaves.at(-1)).toEqual({
      servers: [{ id: 'geo', name: 'Server geo', url: 'http://wms.test/ows', protocol: 'wms', version: '1.3.0', timeoutSeconds: 8 }],
      backgrounds: [
        { id: 'topo', name: 'Background topo', server: 'geo', layers: ['land', 'sea'], mode: 'image', format: 'image/png', transparent: false, attribution: { text: '(c) topo' } },
      ],
    });
  });
});

describe('saving, discarding and unsaved changes', () => {
  it('reports unsaved changes, and clears them on Save and on Discard', async () => {
    const { ctx } = await open();
    expect(ctx.settingsPanelUnsaved).toBe(false);
    expect((screen.getByRole<HTMLButtonElement>('button', { name: 'Save' })).disabled).toBe(true);

    type('Name', card('Background Background topo'), 'Changed');
    expect(ctx.settingsPanelUnsaved).toBe(true);
    click('Discard');
    expect(ctx.settingsPanelUnsaved).toBe(false);
    expect((within(card('Background Background topo')).getByLabelText<HTMLInputElement>('Name')).value).toBe('Background topo');

    type('Name', card('Background Background topo'), 'Changed');
    await save();
    expect(ctx.settingsPanelUnsaved).toBe(false);
    expect(screen.getByText('Saved.')).toBeDefined();
  });

  it('shows what ECore refused at its field, and keeps the changes', async () => {
    const { ctx } = await open(TWO_LAYERS, {
      saveSettings: () => ({ ok: false, problems: [{ path: '/servers/0/url', problem: 'must match the pattern' }] }),
    });
    type('Address', card('Server Server geo'), 'http://other.test/ows');

    await save();

    expect(within(card('Server Server geo')).getByText('must match the pattern')).toBeDefined();
    expect(screen.getByText('The server refused the values; nothing was changed.')).toBeDefined();
    expect(ctx.settingsPanelUnsaved).toBe(true);
  });

  it('says so when saving fails, for a user without the settings permission', async () => {
    await open(TWO_LAYERS, { user: createFakeUser({ permissions: [] }) });
    type('Name', card('Background Background topo'), 'Changed');

    await save();

    expect(screen.getByText(/Saving failed/)).toBeDefined();
  });
});

describe('another admin’s save', () => {
  it('keeps unsaved changes, says that someone else changed the settings, and offers their values', async () => {
    const { ctx, refresh } = await open();
    type('Name', card('Background Background topo'), 'Mine');

    act(() => { ctx.changeSettings(settings([server('geo')], [background('topo', 'geo', ['land']), background('theirs', 'geo', ['sea'])])); });
    refresh();

    expect(screen.getByText(/changed by someone else/)).toBeDefined();
    expect((within(card('Background Mine')).getByLabelText<HTMLInputElement>('Name')).value).toBe('Mine');
    expect(screen.queryByRole('region', { name: 'Background Background theirs' })).toBeNull();

    click('Take their values');
    expect(screen.queryByText(/changed by someone else/)).toBeNull();
    expect(screen.getByRole('region', { name: 'Background Background theirs' })).toBeDefined();
    expect(ctx.settingsPanelUnsaved).toBe(false);
  });

  it('follows their values at once when there are no unsaved changes', async () => {
    const { ctx, refresh } = await open();

    act(() => { ctx.changeSettings(settings([server('geo')], [background('theirs', 'geo', ['sea'])])); });
    refresh();

    expect(screen.queryByText(/changed by someone else/)).toBeNull();
    expect(screen.getByRole('region', { name: 'Background Background theirs' })).toBeDefined();
  });

  it('does not take the panel’s own save for another admin’s', async () => {
    const { refresh } = await open();
    type('Name', card('Background Background topo'), 'Mine');

    await save();
    refresh();

    expect(screen.queryByText(/changed by someone else/)).toBeNull();
    expect((within(card('Background Mine')).getByLabelText<HTMLInputElement>('Name')).value).toBe('Mine');
  });
});
