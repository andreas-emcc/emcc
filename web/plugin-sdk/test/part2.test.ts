import { describe, expect, it } from 'vitest';
import type { GraphicRenderRequest, MapObjectContent, Modifiers } from '../src/index.ts';
import { createFakeMapView, createFakeSymbolService, FAKE_GRAPHICS } from '../src/testing/index.ts';

// SDK 1.4.0 part 2 (CR-0030, ADR-0043 point 9): tactical graphics' amplifiers, catalogue and draw call.

const view = { resolution: 20, extent: [17.5, 59.2, 18.5, 59.6] as const };

function request(entity: string, points: GraphicRenderRequest['points'], modifiers?: Modifiers): GraphicRenderRequest {
  return { standard: 'APP-6D', sidc: `1003250000${entity}0000`, points, ...(modifiers === undefined ? {} : { modifiers }), ...view };
}

describe('tactical graphics (SDK 1.4.0)', () => {
  it('types the graphics amplifiers in the model', () => {
    const modifiers: Modifiers = { distances: [500, 3000], azimuths: [315, 45], uniqueDesignation1: '3 BDE', uniqueDesignation2: 'X', dtg1: '061800ZNOV26', targetNumber: 'AB1234' };
    const content: MapObjectContent = {
      type: 'core.multipoint', dataType: 'core.general', dataSource: 'manual', layerId: '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e01',
      geometry: { type: 'MultiPoint', coordinates: [[18.0702, 59.3293]] }, symbol: { standard: 'APP-6D', sidc: '10032500002422000000', modifiers },
      label: { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' },
    };
    expect(content.symbol?.modifiers?.distances).toEqual([500, 3000]);
  });

  it('gives a catalogue for APP-6D and none for APP-6E', async () => {
    const symbols = createFakeSymbolService();
    const d = await symbols.graphicCatalog!('APP-6D');
    expect(d).toBe(FAKE_GRAPHICS);
    expect(d.map((g) => g.kind)).toEqual(['line', 'line', 'arrow', 'points']);
    expect(d.filter((g) => g.echelon).map((g) => g.name)).toEqual(['Boundary']);
    expect(d.every((g) => g.allowedModifiers.every((m) => typeof m === 'string') && g.requiredModifiers.every((m) => g.allowedModifiers.includes(m)))).toBe(true);
    expect(await symbols.graphicCatalog!('APP-6E')).toEqual([]);
  });

  it('draws a line through the points in longitude, latitude order, with the unique designation', async () => {
    const symbols = createFakeSymbolService();
    const points = [[17.6001, 59.9012], [17.7005, 59.8521]] as const;
    const result = await symbols.renderGraphic!(request('140300', points, { uniqueDesignation: 'PL BLUE' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.from(result.lines[0]?.coordinates ?? [])).toEqual([17.6001, 59.9012, 17.7005, 59.8521]);
    expect(result.labels[0]).toMatchObject({ text: 'PL BLUE', position: [17.6001, 59.9012] });
    expect(symbols.renderGraphicCalls).toBe(1);
  });

  it('refuses with a reason: an unknown code, a wrong point count, a missing amplifier, or on demand', async () => {
    const symbols = createFakeSymbolService();
    const one = [[18.0702, 59.3293]] as const;
    expect(await symbols.renderGraphic!(request('999999', one))).toEqual({ ok: false, reason: expect.stringContaining('not a graphic') });
    expect(await symbols.renderGraphic!(request('151403', [[18, 59], [18.1, 59.1]]))).toMatchObject({ ok: false, reason: expect.stringContaining('3 to 50') });
    expect(await symbols.renderGraphic!(request('242200', one, { distances: [3000] }))).toMatchObject({ ok: false, reason: expect.stringContaining('azimuths') });
    expect((await symbols.renderGraphic!(request('242200', one, { distances: [3000], azimuths: [315, 45] }))).ok).toBe(true);
    symbols.refuse('renderer not loaded');
    expect(await symbols.renderGraphic!(request('140300', [[18, 59], [18.1, 59.1]]))).toEqual({ ok: false, reason: 'renderer not loaded' });
    symbols.refuse(null);
    expect((await symbols.renderGraphic!(request('140300', [[18, 59], [18.1, 59.1]]))).ok).toBe(true);
  });

  it('records a draw call with a graphic to preview (owner, 2026-11-06)', () => {
    const map = createFakeMapView();
    const graphic = { standard: 'APP-6D', sidc: '10032500001514030000' } as const;
    void map.draw('line', { graphic });
    void map.draw('polygon');
    expect(map.drawCalls).toEqual([{ kind: 'line', graphic }, { kind: 'polygon' }]);
  });
});
