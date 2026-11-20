import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLUGIN_ICONS, fieldHint, formSections, itemColumns, itemWords, settingsHintsProblem, type JsonValue, type Layer, type SettingsSchema, type WorkspaceInfo } from '@emc2/plugin-sdk';
import { Network } from 'lucide-react';
import { checkLookCss, createFakeContext, createFakeUser } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };
import plugin from '../src/index.tsx';
import { baseName } from '../src/NvgPanel.tsx';
import { describe as describeState, fileName } from '../src/server.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** The settings as the shell passes them when nothing is configured: the default of every setting. */
function settingDefaults(): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(manifest.settings.properties).map(([name, schema]) => [name, schema.default as JsonValue]));
}

const SIMULATION: WorkspaceInfo = { id: 'simulator.simulation', name: 'Simulation', viewPermission: 'plugin.simulator.view', editPermission: 'plugin.simulator.edit', order: 10 };

function layer(name: string, drawOrder: number, extra: Partial<Layer> = {}): Layer {
  const audit = { at: '2026-11-12T10:00:00Z', by: { plugin: 'layer-panel' } };
  return {
    id: `00000000-0000-0000-0000-00000000000${String(drawOrder)}`,
    version: 1,
    meta: { created: audit, modified: audit },
    name,
    drawOrder,
    visible: true,
    label: { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' },
    ...extra,
  };
}

async function shown(options: Parameters<typeof createFakeContext>[0] = {}) {
  const ctx = createFakeContext({ pluginId: manifest.id, settings: settingDefaults(), ...options });
  await plugin.activate(ctx);
  const Panel = ctx.addedPanels[0]?.panel.component;
  if (!Panel) throw new Error('no panel');
  render(<Panel />);
  return ctx;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function chooseFile(name = 'five.nvg', text = '<nvg version="2.0.2"/>') {
  const input = screen.getByLabelText('NVG file');
  fireEvent.change(input, { target: { files: [new File([text], name, { type: 'application/xml' })] } });
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name });
}

describe('nvg web part', () => {
  it('is named after the plugin id', () => {
    expect(pkg.name).toBe(`@emc2/plugin-${manifest.id}`);
  });

  it('lists the CSS file the build writes (<id>.css)', () => {
    expect(manifest.web.css).toEqual([`${manifest.id}.css`]);
  });

  it('adds its panel in every workspace, in the right pane (N1), and reports OK', async () => {
    const ctx = createFakeContext({ pluginId: manifest.id, settings: settingDefaults() });
    await plugin.activate(ctx);
    expect(ctx.addedPanels.map((p) => [p.panel.id, p.panel.defaultPane, p.panel.workspaces])).toEqual([['nvg', 'right', ['*']]]);
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
  });

  it('its CSS uses design tokens only', () => {
    const css = readFileSync(join(import.meta.dirname, '../src/nvg.css'), 'utf8');
    expect(checkLookCss(css, { pluginId: manifest.id })).toEqual([]);
  });

  it('names a new layer after the file without its extension (N2)', () => {
    expect(baseName('five.nvg')).toBe('five');
    expect(baseName('situation.2026.xml')).toBe('situation.2026');
    expect(baseName('.nvg')).toBe('.nvg');
  });
});

describe('T-204: SDK 1.8.0 parts C and D (settings hints, name once, icon always)', () => {
  const settings = manifest.settings as unknown as SettingsSchema;
  const links = settings.properties?.links as SettingsSchema;
  const link = links.items as SettingsSchema;

  it('the settings hints pass the SDK check, and every long description has a hint of at most 80 characters', () => {
    expect(settingsHintsProblem(manifest.settings)).toBeNull();
    const walk = (s: SettingsSchema, at: string): string[] => [
      ...(s.description !== undefined && s.description.length > 80 && (fieldHint(s).hint ?? '').length === 0 ? [at] : []),
      ...Object.entries(s.properties ?? {}).flatMap(([k, p]) => walk(p, `${at}/${k}`)),
      ...(s.items === undefined ? [] : walk(s.items, `${at}/items`)),
    ];
    expect(walk(settings, '')).toEqual([]);
  });

  it("a link's side form: name, enabled and kind first, then Calls, Picture and Serving", () => {
    expect(formSections(link).map((s) => [s.label, s.properties])).toEqual([
      [null, ['name', 'enabled', 'kind']],
      ['Calls', ['url', 'credential', 'intervalSeconds', 'timeoutSeconds', 'filter']],
      ['Picture', ['targetLayer', 'label', 'clearOnEmpty']],
      ['Serving', ['sourceLayers', 'highestClassification', 'authentication']],
    ]);
  });

  it('the three lists name their items: links, filter answers and layers', () => {
    expect(itemWords(links).add).toBe('Add link');
    expect(itemColumns(links)).toEqual(['kind', 'url']);
    const filter = link.properties?.filter as SettingsSchema;
    expect(itemWords(filter).add).toBe('Add filter answer');
    expect(itemColumns(filter)).toEqual(['value']);
    expect(itemWords(link.properties?.sourceLayers as SettingsSchema).add).toBe('Add layer');
  });

  it('the manifest and the panel have the icon Network, and the panel does not repeat its title', async () => {
    expect(manifest.icon).toBe('Network');
    expect(Object.hasOwn(PLUGIN_ICONS, manifest.icon)).toBe(true);
    expect(manifest.sdkVersion).toBe('^1.8.0');
    const ctx = await shown();
    expect(ctx.addedPanels[0]?.panel.icon).toBe(Network);
    expect(screen.queryByRole('heading', { name: 'NVG' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Import NVG' })).toBeDefined();
  });
});

describe('import (criterion 12)', () => {
  it('imports a file into an existing layer and shows the counts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve(json(202, { job: 'j1', name: 'five.nvg', state: 'reading' }));
      expect(url).toContain('import/j1');
      return Promise.resolve(json(200, { job: 'j1', name: 'five.nvg', state: 'done', items: 6, created: 5, updated: 0, unchanged: 0, skipped: { 'skipped: content-item': 1 } }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = await shown({ user: createFakeUser({ permissions: ['objects.edit', 'layers.edit'] }) });
    const target = layer('Target', 2);
    act(() => {
      ctx.live.snapshot({ layers: [layer('Other', 1), target] });
    });
    chooseFile();
    fireEvent.change(screen.getByLabelText('Into layer'), { target: { value: target.id } });
    fireEvent.click(button('Import'));
    await waitFor(() => {
      expect(screen.getByText(/five\.nvg: 6 items: 5 created, 0 updated, 0 unchanged; skipped: content-item 1/)).toBeDefined();
    }, { timeout: 3000 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ctx.serverBase}import?layer=${target.id}&name=five.nvg&policy=NATO&classification=UNCLASSIFIED`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/xml' });
    expect(ctx.submitted).toEqual([]);
  });

  it('makes a new layer named after the file in the workspace shown, then imports into it', async () => {
    const fetch = vi.fn(() => Promise.resolve(json(202, { job: 'j2', name: 'situation.nvg', state: 'done', items: 2, created: 2 })));
    vi.stubGlobal('fetch', fetch);
    const ctx = await shown({ user: createFakeUser({ permissions: ['objects.edit', 'layers.edit'] }) });
    act(() => {
      ctx.live.snapshot({ layers: [layer('Other', 3)] });
    });
    chooseFile('situation.nvg');
    fireEvent.click(button('Import'));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });
    const create = ctx.submitted[0];
    expect(create?.entityType).toBe('layer');
    expect(create?.operation).toBe('create');
    expect(create !== undefined && 'data' in create ? create.data : undefined).toMatchObject({ name: 'situation', drawOrder: 4, workspace: 'core.view' });
    const [url] = fetch.mock.calls[0] as unknown as [string];
    expect(url).toContain(`layer=${String(create?.entityId)}`);
    // Something went into it, so it stays, chosen for the next import once the live picture has it.
    act(() => {
      ctx.live.snapshot({ layers: [layer('Other', 3), { ...layer('situation', 4), id: String(create?.entityId) }] });
    });
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLSelectElement>('Into layer').value).toBe(create?.entityId);
    });
    expect(ctx.submitted).toHaveLength(1);
  });

  /** Imports `five.nvg` into a new layer with `fetch` answering; the layer's create and what followed. */
  async function intoANewLayer(fetch: (url: string, init?: RequestInit) => Promise<Response>) {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('fetch', vi.fn(fetch));
    const ctx = await shown({ user: createFakeUser({ permissions: ['objects.edit', 'layers.edit'] }) });
    act(() => {
      ctx.live.snapshot({ layers: [layer('Other', 1)] });
    });
    chooseFile();
    fireEvent.click(button('Import'));
    return ctx;
  }

  it.each([
    ['refused (another version)', { state: 'refused', reason: 'NVG 1.5 is not supported; 2.0.x only' }, 'NVG 1.5 is not supported; 2.0.x only'],
    ['refused (a DTD)', { state: 'refused', reason: 'the document has a DTD' }, 'the document has a DTD'],
    ['done with nothing created', { state: 'done', items: 3, created: 0, updated: 3, unchanged: 0 }, '3 updated'],
  ])('removes the new layer it made when the import is %s (UDA, 2026-11-12)', async (_case, end, shownText) => {
    const ctx = await intoANewLayer((_url, init) =>
      Promise.resolve(init?.method === 'POST' ? json(202, { job: 'j3', name: 'five.nvg', state: 'reading' }) : json(200, { job: 'j3', name: 'five.nvg', ...end })));
    await waitFor(() => {
      expect(ctx.submitted).toHaveLength(2);
    }, { timeout: 3000 });
    const [create, remove] = ctx.submitted;
    expect(remove).toMatchObject({ entityType: 'layer', operation: 'delete', entityId: create?.entityId, baseVersion: 1 });
    expect(screen.getByText(new RegExp(shownText))).toBeDefined();
    expect(screen.getByLabelText<HTMLSelectElement>('Into layer').value).toBe('__new__');
  });

  it.each([
    [400, 'not XML'],
    [403, 'You may not edit this layer'],
    [422, 'The file is larger than the limit'],
  ])('removes the new layer it made when the server answers %i', async (status, error) => {
    const ctx = await intoANewLayer(() => Promise.resolve(json(status, { error })));
    expect((await screen.findByRole('alert')).textContent).toBe(error);
    await waitFor(() => {
      expect(ctx.submitted.map((r) => r.operation)).toEqual(['create', 'delete']);
    });
    expect(ctx.submitted[1]?.entityId).toBe(ctx.submitted[0]?.entityId);
  });

  it('keeps the new layer while a started job cannot be followed, as it may still write into it', async () => {
    let polls = 0;
    const ctx = await intoANewLayer((_url, init) => {
      if (init?.method === 'POST') return Promise.resolve(json(202, { job: 'j4', name: 'five.nvg', state: 'reading' }));
      polls++;
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    expect((await screen.findByRole('alert', {}, { timeout: 3000 })).textContent).toContain('Failed to fetch');
    expect(polls).toBe(1);
    expect(ctx.submitted.map((r) => r.operation)).toEqual(['create']);
  });

  it('never removes an existing layer it imported into', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === 'POST' ? json(202, { job: 'j5', name: 'five.nvg', state: 'reading' }) : json(200, { job: 'j5', name: 'five.nvg', state: 'refused', reason: 'not NVG' }))));
    const ctx = await shown({ user: createFakeUser({ permissions: ['objects.edit', 'layers.edit'] }) });
    const target = layer('Target', 1);
    act(() => {
      ctx.live.snapshot({ layers: [target] });
    });
    chooseFile();
    fireEvent.change(screen.getByLabelText('Into layer'), { target: { value: target.id } });
    fireEvent.click(button('Import'));
    await waitFor(() => {
      expect(screen.getByText(/not NVG/)).toBeDefined();
    }, { timeout: 3000 });
    expect(ctx.submitted).toEqual([]);
  });

  it('is greyed with its reason without the edit right in the workspace', async () => {
    const ctx = await shown({ user: createFakeUser({ permissions: [] }) });
    act(() => {
      ctx.live.snapshot({ layers: [layer('Target', 1)] });
    });
    expect(button('Import').disabled).toBe(true);
    expect(button('Import').title).toBe('You may not edit the layers of View');
    expect(screen.getByText(/import is not available/)).toBeDefined();
  });

  it('in another workspace its own edit permission counts', async () => {
    const ctx = await shown({
      user: createFakeUser({ permissions: ['objects.edit', 'layers.edit', 'plugin.simulator.view'] }),
      workspaces: [SIMULATION],
      workspace: SIMULATION.id,
    });
    act(() => {
      ctx.live.snapshot({ layers: [layer('Sim', 1, { workspace: SIMULATION.id })] });
    });
    expect(button('Import').title).toBe('You may not edit the layers of Simulation');
  });

  it('the layer picker lists only the layers the user may edit (criterion 12)', async () => {
    const ctx = await shown({ user: createFakeUser({ permissions: ['objects.edit', 'layers.edit'] }) });
    act(() => {
      ctx.live.snapshot({ layers: [layer('Open', 2), layer('Locked', 1, { locked: true })] });
    });
    const picker = screen.getByLabelText('Into layer');
    const names = [...picker.querySelectorAll('option')].map((o) => o.textContent);
    expect(names).toEqual(['New layer named after the file', 'Open']);
  });

  it('without the edit right the picker lists no layer', async () => {
    const ctx = await shown({ user: createFakeUser({ permissions: [] }) });
    act(() => {
      ctx.live.snapshot({ layers: [layer('Open', 1)] });
    });
    const names = [...screen.getByLabelText('Into layer').querySelectorAll('option')].map((o) => o.textContent);
    expect(names).toEqual(['New layer named after the file']);
  });

  it('a layer locked after it was chosen falls back to a new layer', async () => {
    const ctx = await shown({ user: createFakeUser({ permissions: ['objects.edit', 'layers.edit'] }) });
    const open = layer('Open', 1);
    act(() => {
      ctx.live.snapshot({ layers: [open] });
    });
    fireEvent.change(screen.getByLabelText('Into layer'), { target: { value: open.id } });
    act(() => {
      ctx.live.snapshot({ layers: [{ ...open, locked: true }] });
    });
    expect(screen.getByLabelText<HTMLSelectElement>('Into layer').value).toBe('__new__');
  });

  it("shows the server's refusal", async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(409, { error: 'The layer is locked' }))));
    const ctx = await shown({ user: createFakeUser({ permissions: ['objects.edit', 'layers.edit'] }) });
    const target = layer('Target', 1);
    act(() => {
      ctx.live.snapshot({ layers: [target] });
    });
    chooseFile();
    fireEvent.change(screen.getByLabelText('Into layer'), { target: { value: target.id } });
    fireEvent.click(button('Import'));
    expect((await screen.findByRole('alert')).textContent).toBe('The layer is locked');
  });

  it('a rejected new layer is shown and nothing is sent', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const ctx = await shown({ user: createFakeUser({ permissions: ['objects.edit', 'layers.edit'] }) });
    ctx.answerWith((request) => ({
      outcome: 'rejected',
      rejection: {
        requestId: request.requestId, entityType: request.entityType, operation: request.operation, entityId: request.entityId,
        code: 'PERMISSION_DENIED', message: 'not allowed', details: [], at: '2026-11-12T10:00:00Z',
      },
    }));
    chooseFile();
    fireEvent.click(button('Import'));
    expect((await screen.findByRole('alert')).textContent).toContain('The layer could not be made');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a second snapshot replaces the layers', async () => {
    const ctx = await shown({ user: createFakeUser({ permissions: ['objects.edit', 'layers.edit'] }) });
    act(() => {
      ctx.live.snapshot({ layers: [layer('First', 1)] });
    });
    expect(screen.getByRole('option', { name: 'First' })).toBeDefined();
    act(() => {
      ctx.live.snapshot({ layers: [layer('Second', 2)] });
    });
    expect(screen.queryByRole('option', { name: 'First' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Second' })).toBeDefined();
  });
});

describe('export (criterion 13)', () => {
  it('exports the chosen layers and saves <layer>.nvg', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response('<nvg/>', { status: 200, headers: { 'Content-Disposition': 'attachment; filename="Units.nvg"; filename*=UTF-8\'\'Units.nvg' } })),
    );
    vi.stubGlobal('fetch', fetch);
    const created = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const ctx = await shown({ user: createFakeUser({ permissions: [] }) });
    const units = layer('Units', 2);
    const routes = layer('Routes', 1);
    act(() => {
      ctx.live.snapshot({ layers: [units, routes] });
    });
    expect(button('Export').disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Units' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Routes' }));
    fireEvent.click(button('Export'));
    await waitFor(() => {
      expect(click).toHaveBeenCalled();
    });
    const [url] = fetch.mock.calls[0] as unknown as [string];
    expect(url).toBe(`${ctx.serverBase}export?layer=${units.id}&layer=${routes.id}`);
    const anchor: unknown = click.mock.instances[0];
    expect(anchor instanceof HTMLAnchorElement ? anchor.download : null).toBe('Units.nvg');
    click.mockRestore();
  });

  it('shows a 403', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(403, { error: 'You may not see this layer' }))));
    const ctx = await shown({ user: createFakeUser({ permissions: [] }) });
    act(() => {
      ctx.live.snapshot({ layers: [layer('Units', 1)] });
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Units' }));
    fireEvent.click(button('Export'));
    expect((await screen.findByRole('alert')).textContent).toBe('You may not see this layer');
  });

  it('reads the file name of an answer', () => {
    expect(fileName('attachment; filename="L_.nvg"; filename*=UTF-8\'\'L%C3%A5.nvg')).toBe('Lå.nvg');
    expect(fileName('attachment; filename="Units.nvg"')).toBe('Units.nvg');
    expect(fileName(null)).toBeNull();
  });
});

describe('links for admins (NV1)', () => {
  it('lists the links and gets a consumer link\'s capabilities', async () => {
    const fetch = vi.fn((url: string) => {
      if (url.endsWith('links')) {
        return Promise.resolve(json(200, { links: [
          { name: 'anet', kind: 'soap-consumer', enabled: true, ok: true, detail: '3 items, 3 created, 0 updated, 0 deleted', counters: {}, capabilities: [] },
          { name: 'out', kind: 'soap-provider', enabled: true, ok: true, detail: 'waiting for calls', counters: {}, path: '/api/services/nvg/nvg/out' },
        ] }));
      }
      return Promise.resolve(json(200, { items: [{ kind: 'input', id: 'pastDays', name: 'Past days', type: 'int' }] }));
    });
    vi.stubGlobal('fetch', fetch);
    await shown({ user: createFakeUser({ permissions: ['settings.admin'] }) });
    expect(await screen.findByText('3 items, 3 created, 0 updated, 0 deleted')).toBeDefined();
    expect(screen.getByText('/api/services/nvg/nvg/out')).toBeDefined();
    fireEvent.click(button('Get capabilities'));
    expect(await screen.findByText('pastDays')).toBeDefined();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('links/anet/capabilities'), expect.objectContaining({ method: 'POST' }));
  });

  it('is not shown to others', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await shown({ user: createFakeUser({ permissions: ['objects.edit'] }) });
    expect(screen.queryByRole('region', { name: 'NVG links' })).toBeNull();
  });
});

describe('describe', () => {
  it('says why an import was refused', () => {
    expect(describeState({ job: 'j', name: 'n', state: 'refused', reason: 'NVG 1.5 is not supported; 2.0.x only' })).toBe('NVG 1.5 is not supported; 2.0.x only');
  });
});
