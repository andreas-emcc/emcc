// Quick run: @plugin-nvg
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { externalMissing, externalPath } from '../../lib/external.mjs';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLayer, createSymbol, LiveClient, seededLayer } from '../../lib/live.mjs';
import { withM0 } from '../../lib/m0';
import { stopOwnServer, withOwnServers } from '../../lib/own-server';
import { installPlugins } from '../../lib/plugins.mjs';
import { startServer } from '../../lib/server.mjs';

// T-173, the nvg plugin (docs/plugins/briefs/nvg.md, ADR-0055; SDK 1.6.0 part A): NVG 2.0.x in
// and out. Import NVG… in the NVG panel puts a file's items into a layer as ordinary objects
// (core.general; a text as core.text; a composite's parts linked to the first by nvg.part) with
// externalRef nvg-file:<file> + uri, so the same file again updates them (criterion 12); Export NVG…
// writes the chosen layers, one g per layer (criterion 13), and the export imports again to the same
// objects (section 7). The XML is read without DTDs or external entities (criterion 2). The links:
// a soap-provider answers GetCapabilities and GetNvg at /api/services/nvg/nvg/<link>, and a
// soap-consumer of the same server reads it (criteria 14 and 15, end to end); against the ESA's ANET
// (external/anet/README.md) when it runs, else that test is skipped with the reason. "Get
// capabilities" for admins only is in specs/keycloak/nvg-capabilities.spec.ts. The NVG files are
// written here by hand, latitude ≠ longitude (ADR-0007), around Sundsvall.

test.describe.configure({ timeout: 180_000 });

type State = Record<string, any>;
type Event = { sequenceNo: number; entityType: string; entityId: string; operation: string; state: State | null; by?: { plugin?: string; user?: string } };

const NVG_NS = 'https://tide.act.nato.int/schemas/2012/10/nvg';
const SOAP11 = 'http://schemas.xmlsoap.org/soap/envelope/';
const SOAP12 = 'http://www.w3.org/2003/05/soap-envelope';
const WSDL_NS = 'https://tide.act.nato.int/wsdl/2012/nvg';
const LOCK_LABEL = { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' };

function nvgDocument(items: string, version = '2.0.2', prolog = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${prolog}<nvg xmlns="${NVG_NS}" version="${version}">\n${items}\n</nvg>\n`;
}

/** The five kinds of item of the import (criterion 12) and a composite of three parts: eight objects. */
function items({ pointName = 'ITA company' } = {}): string {
  return [
    `<point uri="urn:ita:m7:point" label="${pointName}" symbol="app6b:SFGPUCI----D---" x="17.31" y="62.39" speed="36" course="45"><textInfo>Dug in.</textInfo></point>`,
    '<multipoint uri="urn:ita:m7:graphic" label="ITA graphic" symbol="app6d:10002500001101000000" points="17.30,62.38 17.32,62.385 17.34,62.38"/>',
    '<polyline uri="urn:ita:m7:line" label="ITA line" points="17.20,62.30 17.25,62.32 17.28,62.35" style="stroke:#ff0000;stroke-width:3"/>',
    '<circle uri="urn:ita:m7:circle" label="ITA circle" cx="17.40" cy="62.42" r="1500"/>',
    '<text uri="urn:ita:m7:text" x="17.35" y="62.40" rotation="30"><content>ITA text</content></text>',
    '<composite uri="urn:ita:m7:composite" label="ITA composite" symbol="app6d:10002500001101000000">',
    '  <polyline uri="urn:ita:m7:composite:1" points="17.10,62.20 17.12,62.22"/>',
    '  <polyline uri="urn:ita:m7:composite:2" points="17.12,62.22 17.14,62.20"/>',
    '  <point uri="urn:ita:m7:composite:3" x="17.12" y="62.21"/>',
    '</composite>',
  ].join('\n');
}

const URIS = ['urn:ita:m7:point', 'urn:ita:m7:graphic', 'urn:ita:m7:line', 'urn:ita:m7:circle', 'urn:ita:m7:text', 'urn:ita:m7:composite:1', 'urn:ita:m7:composite:2', 'urn:ita:m7:composite:3'];

/** The current objects by id, from the events the live client has seen. */
function objects(live: LiveClient): Map<string, State> {
  const now = new Map<string, State>();
  for (const e of live.events as Event[]) {
    if (e.entityType !== 'object') continue;
    if (e.operation === 'delete' || e.state === null) now.delete(e.entityId);
    else now.set(e.entityId, e.state);
  }
  return now;
}

function layers(live: LiveClient): Map<string, State> {
  const now = new Map<string, State>();
  for (const e of live.events as Event[]) {
    if (e.entityType !== 'layer') continue;
    if (e.operation === 'delete' || e.state === null) now.delete(e.entityId);
    else now.set(e.entityId, e.state);
  }
  return now;
}

const byRef = (live: LiveClient, system: string) =>
  new Map([...objects(live).values()].filter((o) => o.meta?.externalRef?.system === system).map((o) => [o.meta.externalRef.id as string, o]));

async function applied(live: LiveClient, request: State): Promise<State> {
  const outcome = await live.change(request);
  expect(outcome.outcome, JSON.stringify(outcome.rejection ?? '')).toBe('applied');
  return outcome.event.state;
}

function updateOf(state: State, changes: State): State {
  const { id, version, meta: _meta, ...data } = state;
  return { requestId: randomUUID(), entityType: 'layerId' in state ? 'object' : 'layer', operation: 'update', entityId: id, baseVersion: version, data: { ...data, ...changes }, source: { plugin: 'ita-test' } };
}

function near(actual: number[], expected: number[], message: string, degrees = 1e-7) {
  expect(actual.length, message).toBe(expected.length);
  actual.forEach((v, i) => expect(Math.abs(v - expected[i]), `${message} [${i}]: ${actual} vs ${expected}`).toBeLessThan(degrees));
}

/** Imports through the plugin's endpoint as the browser context's session; resolves with the job's last state. */
async function importApi(request: APIRequestContext, layer: string, name: string, xml: string | Buffer): Promise<State> {
  const started = await request.post(`/api/plugins/nvg/import?layer=${layer}&name=${encodeURIComponent(name)}`, { headers: { 'Content-Type': 'application/xml' }, data: typeof xml === 'string' ? Buffer.from(xml, 'utf8') : xml });
  expect(started.status(), await started.text()).toBe(202);
  let state = await started.json();
  await expect
    .poll(async () => (state = await (await request.get(`/api/plugins/nvg/import/${state.job}`)).json()).state, { timeout: 30_000, message: `the import of ${name}` })
    .toMatch(/^(done|refused|failed)$/);
  return state;
}

/** One element of an NVG document by its uri: its name and attributes (the writer's prefix, if any, dropped). */
function element(xml: string, uri: string): { name: string; attributes: Record<string, string>; text: string } | null {
  const escaped = uri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<(?:[A-Za-z0-9_-]+:)?([A-Za-z-]+)\\b([^>]*?\\buri="${escaped}"[^>]*?)(/?)>`).exec(xml);
  if (match === null) return null;
  const attributes: Record<string, string> = {};
  for (const a of match[2].matchAll(/([A-Za-z_:-]+)="([^"]*)"/g)) attributes[a[1]] = a[2];
  let text = '';
  if (match[3] !== '/') {
    const close = xml.indexOf(`${match[1]}>`, match.index + match[0].length);
    text = xml.slice(match.index + match[0].length, close);
  }
  return { name: match[1], attributes, text };
}

const panel = (page: Page) => page.getByRole('region', { name: 'NVG', exact: true });

/** Checks the eight imported objects (criteria 3, 7, 8, 9 and 12): types, geometry, symbols, text, the parts' relation. */
function checkImported(found: Map<string, State>, layerId: string, system: string) {
  expect([...found.keys()].sort(), `the objects of ${system}`).toEqual([...URIS].sort());
  for (const [uri, o] of found) {
    expect(o.dataType, `${uri}: data type`).toBe('core.general');
    expect(o.dataSource, `${uri}: data source`).toBe('nvg-file');
    expect(o.layerId, `${uri}: layer`).toBe(layerId);
  }
  const point = found.get('urn:ita:m7:point')!;
  expect(point.type).toBe('core.symbol');
  near(point.geometry.coordinates, [17.31, 62.39], 'the point, lon first');
  expect(point.symbol).toMatchObject({ standard: 'APP-6B', sidc: 'SFGPUCI----D---', modifiers: { speed: 10, direction: 45 } });
  expect(point.properties).toMatchObject({ name: 'ITA company', description: 'Dug in.' });
  const graphic = found.get('urn:ita:m7:graphic')!;
  expect(graphic.type, 'a multipoint with a graphic code').toBe('core.multipoint');
  expect(graphic.geometry.type).toBe('MultiPoint');
  near(graphic.geometry.coordinates.flat(), [17.3, 62.38, 17.32, 62.385, 17.34, 62.38], 'the control points in the order sent');
  const line = found.get('urn:ita:m7:line')!;
  expect(line.type).toBe('core.shape');
  expect(line.geometry.type).toBe('LineString');
  near(line.geometry.coordinates.flat(), [17.2, 62.3, 17.25, 62.32, 17.28, 62.35], 'the polyline');
  expect(String(line.style?.strokeColor).toLowerCase(), 'its stroke').toBe('#ff0000');
  expect(line.style?.strokeWidth).toBe(3);
  const circle = found.get('urn:ita:m7:circle')!;
  expect(circle.geometry).toMatchObject({ type: 'Circle', radius: 1500 });
  near(circle.geometry.center, [17.4, 62.42], 'the circle');
  const text = found.get('urn:ita:m7:text')!;
  expect(text.type, 'a text is core.text').toBe('core.text');
  near(text.geometry.coordinates, [17.35, 62.4], 'the text');
  expect(text.text, 'counter-clockwise 30 is clockwise 330').toMatchObject({ value: 'ITA text', rotation: 330 });
  const [first, second, third] = ['urn:ita:m7:composite:1', 'urn:ita:m7:composite:2', 'urn:ita:m7:composite:3'].map((u) => found.get(u)!);
  expect(first.relations ?? [], 'the first part').toEqual([]);
  for (const part of [second, third]) expect(part.relations, 'a later part, related to the first').toEqual([{ kind: 'nvg.part', objectId: first.id }]);
}

test('Import NVG… (T-173, criterion 12): a file\'s symbol, graphic, shapes, text and composite land in a new layer named after it as core.general objects (the text core.text, the parts linked by nvg.part); the picker leaves out a locked layer; the same file again with one item changed updates that one where a user moved it, and creates nothing', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const locked = await applied(live, createLayer('ITA locked', { drawOrder: 3 }));
    await applied(live, updateOf(locked, { locked: true }));
    const moved = await applied(live, createLayer('ITA moved', { drawOrder: 4 }));
    const page = await open();
    const nvg = panel(page);
    await expect(nvg.getByRole('heading', { name: 'Import NVG', exact: true })).toBeVisible();
    const into = nvg.getByLabel('Into layer');
    await expect(into.locator('option')).toContainText(['New layer named after the file', 'ITA moved', 'Drawing']);
    await expect(into.locator('option', { hasText: 'ITA locked' }), 'a locked layer is not offered').toHaveCount(0);
    await expect(nvg.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
    await expect(nvg.getByRole('button', { name: 'Import', exact: true })).toHaveAttribute('title', 'Choose an NVG file first');

    await nvg.getByLabel('NVG file').setInputFiles({ name: 'ita-m7.nvg', mimeType: 'application/xml', buffer: Buffer.from(nvgDocument(items()), 'utf8') });
    await expect(into.locator('option:checked')).toHaveText('New layer: ita-m7');
    await nvg.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(nvg.getByText(/^ita-m7\.nvg: \d+ items: 8 created, 0 updated, 0 unchanged/)).toBeVisible({ timeout: 30_000 });
    const layer = [...layers(live).values()].find((l) => l.name === 'ita-m7');
    expect(layer, 'a new layer named after the file, without .nvg (N2)').toBeDefined();
    expect(layer!.workspace ?? 'view', 'in the workspace shown').toBe('view');
    const system = 'nvg-file:ita-m7.nvg';
    await expect.poll(() => byRef(live, system).size, { message: 'the eight objects' }).toBe(8);
    checkImported(byRef(live, system), layer!.id, system);
    const creators = new Set((live.events as Event[]).filter((e) => e.entityType === 'object' && e.state?.meta?.externalRef?.system === system).map((e) => e.by?.plugin));
    expect([...creators], 'written by the plugin').toEqual(['nvg']);

    // A user moves the point to another layer; the file comes again with the point renamed.
    const point = byRef(live, system).get('urn:ita:m7:point')!;
    await applied(live, updateOf(point, { layerId: moved.id }));
    const from = (live.events as Event[]).length;
    await nvg.getByLabel('NVG file').setInputFiles({ name: 'ita-m7.nvg', mimeType: 'application/xml', buffer: Buffer.from(nvgDocument(items({ pointName: 'ITA company, renamed' })), 'utf8') });
    await into.selectOption({ label: 'ita-m7' });
    await nvg.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(nvg.getByText(/^ita-m7\.nvg: \d+ items: 0 created, 1 updated, 7 unchanged/)).toBeVisible({ timeout: 30_000 });
    const after = (live.events as Event[]).slice(from).filter((e) => e.entityType === 'object' && e.by?.plugin === 'nvg');
    expect(after.map((e) => `${e.operation} ${e.state?.meta?.externalRef?.id}`), 'one update, nothing created').toEqual(['update urn:ita:m7:point']);
    expect(after[0].state, 'updated where the user moved it').toMatchObject({ id: point.id, layerId: moved.id, properties: { name: 'ITA company, renamed' } });
    void snapshot;
  });
});

test('Export NVG… (T-173, criterion 13 and section 7): two layers as one file named after the first, one g each with its name, every object written (a shape Point as unknown:unknown); the file imports again to the same objects', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const page = await open();
    const imported = await applied(live, createLayer('ITA imported', { drawOrder: 5 }));
    const done = await importApi(page.request, imported.id, 'ita-m7.nvg', nvgDocument(items()));
    expect(done, 'the API import').toMatchObject({ state: 'done', created: 8 });
    const drawn = await applied(live, createLayer('ITA drawn', { drawOrder: 4 }));
    const symbol = await applied(live, createSymbol(drawn.id, 7, { name: 'ITA drawn symbol' }));
    const spot = await applied(live, {
      requestId: randomUUID(),
      entityType: 'object',
      operation: 'create',
      entityId: randomUUID(),
      data: { type: 'core.shape', dataType: 'core.general', dataSource: 'manual', layerId: drawn.id, geometry: { type: 'Point', coordinates: [17.45, 62.47] }, label: LOCK_LABEL, properties: { name: 'ITA spot' } },
      source: { plugin: 'ita-test' },
    });
    await expect.poll(() => objects(live).size).toBeGreaterThanOrEqual(10);

    const nvg = panel(page);
    const group = nvg.getByRole('group', { name: 'Layers to export' });
    const exportButton = nvg.getByRole('button', { name: 'Export', exact: true });
    await expect(exportButton).toBeDisabled();
    await group.getByLabel('ITA imported', { exact: true }).check();
    await group.getByLabel('ITA drawn', { exact: true }).check();
    const downloading = page.waitForEvent('download');
    await exportButton.click();
    const download = await downloading;
    // The layers come top first in the list; the file is named after the first chosen there.
    expect(download.suggestedFilename(), 'named after the first layer').toBe('ITA imported.nvg');
    const xml = readFileSync(await download.path(), 'utf8');
    expect(xml, 'NVG 2.0.2').toMatch(/<(?:\w+:)?nvg\b[^>]*version="2\.0\.2"/);
    const groups = [...xml.matchAll(/<(?:\w+:)?g\b[^>]*\blabel="([^"]*)"/g)].map((m) => m[1]);
    expect(groups.sort(), 'one g per layer, named after it').toEqual(['ITA drawn', 'ITA imported']);
    const point = element(xml, 'urn:ita:m7:point')!;
    expect(point, 'the point, by its uri').not.toBeNull();
    expect(point.name).toBe('point');
    expect(point.attributes).toMatchObject({ symbol: 'app6b:SFGPUCI----D---', label: 'ITA company' });
    near([Number(point.attributes.x), Number(point.attributes.y)], [17.31, 62.39], 'the point out, x the longitude');
    expect(Number(point.attributes.speed), 'km/h again').toBeCloseTo(36, 6);
    expect(Number(point.attributes.course)).toBeCloseTo(45, 6);
    const text = element(xml, 'urn:ita:m7:text')!;
    expect(text.name).toBe('text');
    expect(Number(text.attributes.rotation), 'counter-clockwise again').toBeCloseTo(30, 6);
    expect(text.text).toContain('ITA text');
    expect(element(xml, 'urn:ita:m7:graphic')!.name).toBe('multipoint');
    expect(element(xml, 'urn:ita:m7:line')!.name).toBe('polyline');
    expect(element(xml, 'urn:ita:m7:circle')!.attributes).toMatchObject({ r: expect.stringMatching(/^1500(\.0+)?$/) });
    for (const part of ['urn:ita:m7:composite:1', 'urn:ita:m7:composite:2', 'urn:ita:m7:composite:3']) {
      expect(element(xml, part), `${part}: each part its own element`).not.toBeNull();
    }
    expect(element(xml, `urn:uuid:${symbol.id}`), 'the hand-made symbol, urn:uuid:<id>').toMatchObject({ name: 'point', attributes: { label: 'ITA drawn symbol' } });
    expect(element(xml, `urn:uuid:${spot.id}`), 'a shape Point').toMatchObject({ name: 'point', attributes: { symbol: 'unknown:unknown', label: 'ITA spot' } });

    // The exported file imported again, under another name, into a new layer: the same objects.
    const nvgImport = nvg.getByRole('region', { name: 'Import NVG', exact: true });
    await nvgImport.getByLabel('NVG file').setInputFiles({ name: 'ita-again.nvg', mimeType: 'application/xml', buffer: Buffer.from(xml, 'utf8') });
    await nvgImport.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(nvgImport.getByText(/^ita-again\.nvg: \d+ items: 10 created, 0 updated, 0 unchanged/)).toBeVisible({ timeout: 30_000 });
    const again = [...layers(live).values()].find((l) => l.name === 'ita-again')!;
    const first = byRef(live, 'nvg-file:ita-m7.nvg');
    const second = byRef(live, 'nvg-file:ita-again.nvg');
    expect(second.size, 'every object came back').toBe(10);
    for (const [uri, o] of first) {
      const back = second.get(uri)!;
      expect(back, `${uri} again`).toBeDefined();
      expect(back.layerId).toBe(again.id);
      expect({ type: back.type, symbol: back.symbol, text: back.text, name: back.properties?.name ?? null }, `${uri}: the same object`).toEqual({ type: o.type, symbol: o.symbol, text: o.text, name: o.properties?.name ?? null });
      expect(JSON.stringify(roundAll(back.geometry)), `${uri}: the same geometry`).toBe(JSON.stringify(roundAll(o.geometry)));
    }
    const parts = ['urn:ita:m7:composite:1', 'urn:ita:m7:composite:2', 'urn:ita:m7:composite:3'].map((u) => second.get(u)!);
    expect(parts[1].relations ?? [], 'the composite is not built again from its parts').toEqual([]);
    expect(second.get(`urn:uuid:${symbol.id}`)).toMatchObject({ type: 'core.symbol', symbol: symbol.symbol });
    expect(second.get(`urn:uuid:${spot.id}`)?.geometry.type, 'the shape Point back as a point').toBe('Point');
    void snapshot;
  });
});

function roundAll(value: unknown): unknown {
  if (typeof value === 'number') return Math.round(value * 1e7) / 1e7;
  if (Array.isArray(value)) return value.map(roundAll);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundAll(v)]));
  return value;
}

test('NVG import safety (T-173, criterion 2 and section 4): a DTD, an external entity, NVG 1.5 and bytes that are not XML are refused with their reason and write nothing, no entity is fetched; a locked layer answers 409 and an unknown one 404', async ({ browser }, testInfo) => {
  // A local HTTP server the external entity points at: it must never be asked.
  const asked: string[] = [];
  const bait = createServer((request, response) => {
    asked.push(request.url ?? '');
    response.end('<point/>');
  });
  await new Promise<void>((resolve) => bait.listen(0, '127.0.0.1', resolve));
  const baitUrl = `http://127.0.0.1:${(bait.address() as AddressInfo).port}/entity`;
  try {
    await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
      const page = await open();
      const layer = seededLayer(snapshot);
      const point = '<point uri="urn:ita:safety" x="17.31" y="62.39" label="&x;"/>';
      const cases = [
        { name: 'dtd.nvg', xml: nvgDocument('<point uri="urn:ita:dtd" x="17.31" y="62.39"/>', '2.0.2', '<!DOCTYPE nvg>\n'), reason: 'a document with a DTD is refused' },
        { name: 'entity.nvg', xml: nvgDocument(point, '2.0.2', `<!DOCTYPE nvg [<!ENTITY x SYSTEM "${baitUrl}">]>\n`), reason: 'a document with a DTD is refused' },
        { name: 'file-entity.nvg', xml: nvgDocument(point, '2.0.2', `<!DOCTYPE nvg [<!ENTITY x SYSTEM "file:///${join(process.cwd(), 'package.json').replace(/\\/g, '/')}">]>\n`), reason: 'a document with a DTD is refused' },
        { name: 'old.nvg', xml: nvgDocument('<point uri="urn:ita:old" x="17.31" y="62.39"/>', '1.5'), reason: 'NVG 1.5 is not supported; 2.0.x only' },
        { name: 'broken.nvg', xml: 'this is not XML', reason: /^not XML/ },
      ];
      const from = (live.events as Event[]).length;
      for (const c of cases) {
        const state = await importApi(page.request, layer, c.name, c.xml);
        expect(state.state, `${c.name}: refused`).toBe('refused');
        if (typeof c.reason === 'string') expect(state.reason, c.name).toBe(c.reason);
        else expect(state.reason, c.name).toMatch(c.reason);
      }
      expect(asked, 'the external entity was never fetched').toEqual([]);

      const locked = await applied(live, createLayer('ITA locked', { drawOrder: 3 }));
      await applied(live, updateOf(locked, { locked: true }));
      const good = nvgDocument('<point uri="urn:ita:good" x="17.31" y="62.39"/>');
      const toLocked = await page.request.post(`/api/plugins/nvg/import?layer=${locked.id}&name=good.nvg`, { headers: { 'Content-Type': 'application/xml' }, data: Buffer.from(good) });
      expect(toLocked.status(), 'a locked layer').toBe(409);
      expect((await toLocked.json()).error).toBe('The layer is locked');
      const unknown = await page.request.post(`/api/plugins/nvg/import?layer=${randomUUID()}&name=good.nvg`, { headers: { 'Content-Type': 'application/xml' }, data: Buffer.from(good) });
      expect(unknown.status(), 'an unknown layer').toBe(404);
      const json = await page.request.post(`/api/plugins/nvg/import?layer=${layer}&name=good.nvg`, { headers: { 'Content-Type': 'application/json' }, data: '{}' });
      expect(json.status(), 'not XML by its media type').toBe(415);
      expect((await page.request.get(`/api/plugins/nvg/import/${randomUUID()}`)).status(), 'an unknown job').toBe(404);
      expect((live.events as Event[]).slice(from).filter((e) => e.entityType === 'object'), 'nothing written').toEqual([]);
    });
  } finally {
    await new Promise<void>((resolve) => bait.close(() => resolve()));
  }
});

/** A SOAP request for an operation (GetCapabilities, GetNvg with an empty filter). */
function soap(operation: 'GetCapabilities' | 'GetNvg', version: '1.1' | '1.2' = '1.1'): string {
  const body = operation === 'GetCapabilities' ? `<nvgw:GetCapabilities xmlns:nvgw="${WSDL_NS}"/>` : `<nvgw:GetNvg xmlns:nvgw="${WSDL_NS}"><nvg:nvg_filter xmlns:nvg="${NVG_NS}" version="2.0.2"/></nvgw:GetNvg>`;
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="${version === '1.1' ? SOAP11 : SOAP12}"><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;
}

async function call(baseUrl: string, link: string, body: string, version: '1.1' | '1.2' = '1.1', operation = 'GetNvg') {
  const headers: Record<string, string> = version === '1.1' ? { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${WSDL_NS}/${operation}"` } : { 'Content-Type': 'application/soap+xml; charset=utf-8' };
  const response = await fetch(`${baseUrl}/api/services/nvg/nvg/${link}`, { method: 'POST', headers, body });
  return { status: response.status, type: response.headers.get('content-type') ?? '', text: await response.text() };
}

async function setNvgLinks(baseUrl: string, links: State[]) {
  const url = `${baseUrl}/api/settings/plugins/nvg`;
  const values = (await (await fetch(url)).json()).values;
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, links }) });
  expect(response.status, `nvg settings: ${await response.clone().text()}`).toBe(200);
}

test('NVG web service (T-173, criteria 14 and 15, end to end): a soap-provider serves its source layer (GetCapabilities lists it, GetNvg its objects without the one above its highest classification, SOAP 1.2 in SOAP 1.2, a fault for anything else, 404 for an unknown link); a soap-consumer of the same server reads it into a layer and deletes what the provider no longer sends; Get capabilities lists the provider\'s filter item', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, live, open }) => {
    const served = await applied(live, createLayer('ITA served', { drawOrder: 5 }));
    const kept = await applied(live, createSymbol(served.id, 11, { name: 'ITA served 1' }));
    const gone = await applied(live, createSymbol(served.id, 12, { name: 'ITA served 2' }));
    const restricted = createSymbol(served.id, 13, { name: 'ITA restricted' });
    const secret = await applied(live, { ...restricted, data: { ...restricted.data, label: { policyIdentifier: { name: 'NATO' }, classification: 'RESTRICTED' } } });
    await setNvgLinks(server.baseUrl, [
      { name: 'ita-out', kind: 'soap-provider', sourceLayers: [{ id: served.id, name: 'ITA served' }], highestClassification: { policy: 'NATO', classification: 'UNCLASSIFIED' } },
    ]);
    let answer = await call(server.baseUrl, 'ita-out', soap('GetNvg'));
    await expect
      .poll(async () => (answer = await call(server.baseUrl, 'ita-out', soap('GetNvg'))).text.includes(`urn:uuid:${gone.id}`), { timeout: 20_000, message: 'the provider serves its layer' })
      .toBe(true);
    expect(answer.status).toBe(200);
    expect(answer.type, 'SOAP 1.1').toMatch(/^text\/xml/);
    expect(answer.text).toContain(SOAP11);
    expect(answer.text).toContain(`urn:uuid:${kept.id}`);
    expect(answer.text, 'above the highest classification: not served').not.toContain(`urn:uuid:${secret.id}`);
    const capabilities = await call(server.baseUrl, 'ita-out', soap('GetCapabilities'), '1.1', 'GetCapabilities');
    expect(capabilities.status).toBe(200);
    expect(capabilities.text, 'one select item, layers').toMatch(/<(?:\w+:)?select\b[^>]*\bid="layers"/);
    expect(capabilities.text, 'listing the source layer').toContain('ITA served');
    const twelve = await call(server.baseUrl, 'ita-out', soap('GetNvg', '1.2'), '1.2');
    expect(twelve.status).toBe(200);
    expect(twelve.type, 'SOAP 1.2 in SOAP 1.2').toMatch(/^application\/soap\+xml/);
    expect(twelve.text).toContain(SOAP12);
    expect(twelve.text).toContain(`urn:uuid:${kept.id}`);
    const other = await call(server.baseUrl, 'ita-out', `<soapenv:Envelope xmlns:soapenv="${SOAP11}"><soapenv:Body><Other xmlns="urn:ita"/></soapenv:Body></soapenv:Envelope>`);
    expect(other.text, 'another operation: a fault').toMatch(/<(?:\w+:)?Fault\b/);
    expect(other.text).not.toContain('urn:uuid:');
    const dtd = await call(server.baseUrl, 'ita-out', `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>${soap('GetNvg').replace(/^<\?xml[^>]*\?>/, '')}`);
    expect(dtd.text, 'a request with a DTD: a fault, nothing served').toMatch(/<(?:\w+:)?Fault\b/);
    expect(dtd.text).not.toContain('urn:uuid:');
    expect((await call(server.baseUrl, 'ita-nobody', soap('GetNvg'))).status, 'an unknown link').toBe(404);

    // A consumer on the same server, polling the provider every 10 s, into a new layer.
    await setNvgLinks(server.baseUrl, [
      { name: 'ita-out', kind: 'soap-provider', sourceLayers: [{ id: served.id, name: 'ITA served' }], highestClassification: { policy: 'NATO', classification: 'UNCLASSIFIED' } },
      { name: 'ita-in', kind: 'soap-consumer', url: `${server.baseUrl}/api/services/nvg/nvg/ita-out`, intervalSeconds: 10, targetLayer: { name: 'ITA loop' } },
    ]);
    await expect.poll(() => [...byRef(live, 'ita-in').keys()].sort(), { timeout: 30_000, message: 'the consumer\'s objects' }).toEqual([`urn:uuid:${kept.id}`, `urn:uuid:${gone.id}`].sort());
    const loop = [...layers(live).values()].find((l) => l.name === 'ITA loop');
    expect(loop, 'the link\'s new layer').toBeDefined();
    const copy = byRef(live, 'ita-in').get(`urn:uuid:${kept.id}`)!;
    expect(copy).toMatchObject({ type: 'core.symbol', dataType: 'core.general', dataSource: 'ita-in', layerId: loop!.id, symbol: kept.symbol, properties: { name: 'ITA served 1' } });
    near(copy.geometry.coordinates, kept.geometry.coordinates, 'the copy where the original is');
    // The provider no longer sends one: the consumer's next complete answer deletes it.
    const deleted = await live.change({ requestId: randomUUID(), entityType: 'object', operation: 'delete', entityId: gone.id, source: { plugin: 'ita-test' } });
    expect(deleted.outcome).toBe('applied');
    await expect.poll(() => [...byRef(live, 'ita-in').keys()], { timeout: 30_000, message: 'the whole picture: gone at the provider, gone here' }).toEqual([`urn:uuid:${kept.id}`]);

    // Get capabilities in the panel (the no-login mode's user has settings.admin).
    const page = await open();
    const links = panel(page).getByRole('region', { name: 'NVG links', exact: true });
    await expect(links.getByText('ita-in', { exact: false }).first()).toBeVisible();
    await links.getByRole('button', { name: 'Get capabilities', exact: true }).click();
    await expect(links.getByRole('list', { name: 'Filter items of ita-in', exact: true }), 'the provider\'s filter item').toContainText('layers');
  });
});

/** The ESA's ANET credentials file (external/anet/README.md): its NVG address and access token. */
const ANET_CREDENTIALS = externalPath('credentials', 'anet', 'anet.json');
const SWEDISH = [
  [17.3069, 62.3908],
  [18.0686, 59.3293],
  [11.9746, 57.7089],
  [15.5869, 56.1612],
  [22.1547, 65.5848],
  [18.2948, 57.6348],
];

async function anetRunning(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}?wsdl`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

test('ANET (T-173, section 7, the live check): a soap-consumer with ANET\'s token as its credential and pastDays=1 gets ANET\'s three youngest demo reports as core.symbol with names at their places, and keeps them on the next poll; Get capabilities lists ANET\'s pastDays', async ({}, testInfo) => {
  let anet: { url: string; accessToken: string } | null = null;
  try {
    anet = JSON.parse(readFileSync(ANET_CREDENTIALS, 'utf8')).nvg;
  } catch {
    anet = null;
  }
  test.skip(anet === null, `${externalMissing("ANET's credentials file", ANET_CREDENTIALS)} (external/anet/README.md)`);
  test.skip(!(await anetRunning(anet!.url)), `ANET does not run (node external/anet/status.mjs; start it with node external/anet/start.mjs)`);
  await withOwnServers(testInfo, async (folders) => {
    installPlugins(folders.pluginsDir, { only: ['nvg'] });
    // The token by name, from local configuration (SDK 1.6.0 part A): an environment variable of the server, never a setting.
    const logFile = testInfo.outputPath('server-anet.log');
    const server = await startServer({ dataDir: folders.dataDir, pluginsDir: folders.pluginsDir, logFile, env: { EMC2_HTTP_CREDENTIALS_ANET_TOKEN: anet!.accessToken } });
    let live: LiveClient | undefined;
    try {
      live = await LiveClient.open(server.baseUrl);
      await live.subscribe();
      await setNvgLinks(server.baseUrl, [
        { name: 'anet', kind: 'soap-consumer', url: anet!.url, credential: 'anet', intervalSeconds: 10, filter: [{ refid: 'pastDays', value: '1' }], targetLayer: { name: 'ANET' } },
      ]);
      await expect.poll(() => byRef(live!, 'anet').size, { timeout: 40_000, message: 'ANET\'s reports' }).toBe(3);
      const reports = [...byRef(live, 'anet').values()];
      const layer = [...layers(live).values()].find((l) => l.name === 'ANET')!;
      for (const r of reports) {
        expect(r.meta.externalRef.id, 'ANET\'s report uri').toMatch(/^urn:anet:reports:/);
        expect(r).toMatchObject({ type: 'core.symbol', dataType: 'core.general', dataSource: 'anet', layerId: layer.id });
        expect(String(r.properties?.name ?? ''), 'a name').not.toBe('');
        const [lon, lat] = r.geometry.coordinates;
        expect(SWEDISH.some(([x, y]) => Math.abs(lon - x) < 1e-3 && Math.abs(lat - y) < 1e-3), `${lon}, ${lat}: one of the six Swedish places, lon first`).toBe(true);
      }
      const calls = async () => (await (await fetch(`${server.baseUrl}/api/plugins/nvg/links`)).json()).links.find((l: State) => l.name === 'anet');
      const firstDetail = (await calls()).detail;
      await expect.poll(async () => (await calls()).detail, { timeout: 30_000, message: 'the next poll' }).not.toBe(firstDetail);
      expect(byRef(live, 'anet').size, 'kept on the next poll').toBe(3);
      expect((live.events as Event[]).filter((e) => e.operation === 'delete'), 'nothing deleted').toEqual([]);
      const capabilities = await fetch(`${server.baseUrl}/api/plugins/nvg/links/anet/capabilities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(capabilities.status).toBe(200);
      const ids = ((await capabilities.json()).items as State[]).map((i) => i.id);
      expect(ids, 'ANET\'s filter items').toEqual(expect.arrayContaining(['pastDays', 'accessToken']));
      testInfo.annotations.push({ type: 'ANET', description: `${reports.length} reports: ${reports.map((r) => r.properties?.name).join('; ')}` });
    } finally {
      await live?.close();
      await stopOwnServer(server);
    }
  });
});
