import ms from 'milsymbol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DISPLAY, type LabelId, type SymbolService } from '@emc2/plugin-sdk';
import { drawnModifiers } from '../src/modifiers.ts';
import { createSymbolService } from '../src/service.ts';
import { callsOn } from './canvas.ts';

const INFANTRY = '10031000001211000000';

function service(): SymbolService {
  return createSymbolService({ cacheSize: 100 }).service;
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** The options milsymbol was given for one render. */
function optionsFor(render: (symbols: SymbolService) => void): Record<string, unknown> {
  const spy = vi.spyOn(ms, 'Symbol');
  render(service());
  const options = spy.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
  if (options === undefined) throw new Error('milsymbol was not called');
  return options;
}

describe('criterion 22: the labels filter the amplifiers', () => {
  const modifiers = { uniqueDesignation: '1', higherFormation: '2 BDE', quantity: '5' };
  const drawn = (labels?: readonly LabelId[]) =>
    optionsFor((symbols) => symbols.render({ standard: 'APP-6D', sidc: INFANTRY, modifiers, size: 30, withText: true, ...(labels === undefined ? {} : { labels }) }));

  it("with ['uniqueDesignation']: T and the quantity, not M", () => {
    const options = drawn(['uniqueDesignation']);
    expect(options).toMatchObject({ uniqueDesignation: '1', quantity: '5' });
    expect(options).not.toHaveProperty('higherFormation');
  });

  it('with []: only the quantity', () => {
    const options = drawn([]);
    expect(options).toMatchObject({ quantity: '5' });
    expect(options).not.toHaveProperty('uniqueDesignation');
    expect(options).not.toHaveProperty('higherFormation');
  });

  it('without labels: all three', () => {
    expect(drawn()).toMatchObject({ uniqueDesignation: '1', higherFormation: '2 BDE', quantity: '5' });
  });

  it('the speed text follows the Speed label; name is ignored', () => {
    expect(drawnModifiers({ speed: 10 }, true, ['speed']).options).toMatchObject({ speed: '36 km/h' });
    expect(drawnModifiers({ speed: 10 }, true, ['name']).options).not.toHaveProperty('speed');
    expect(drawnModifiers({ speed: 10, quantity: '5' }, true, ['name'])).toEqual(drawnModifiers({ speed: 10, quantity: '5' }, true, []));
  });

  it('the text amplifiers still need withText', () => {
    expect(drawnModifiers({ uniqueDesignation: '1' }, false, ['uniqueDesignation']).options).toEqual({});
  });
});

describe("criterion 23: symbology's direction arrow", () => {
  const arrow = (withText: boolean, labels?: readonly LabelId[]) =>
    optionsFor((symbols) => symbols.render({ standard: 'APP-6D', sidc: INFANTRY, modifiers: { direction: 90 }, size: 30, withText, ...(labels === undefined ? {} : { labels }) }))['direction'];

  it.each([false, true])('without direction in the labels: no arrow (withText %s)', (withText) => {
    expect(arrow(withText, ['uniqueDesignation'])).toBeUndefined();
  });

  it.each([false, true])('with direction listed: the arrow (withText %s)', (withText) => {
    expect(arrow(withText, ['direction'])).toBe(90);
  });

  it('the default labels list it, so a user who changes nothing sees the arrow', () => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- what a 1.7.0 map view passes: the deprecated list, still filled
    expect(DEFAULT_DISPLAY.labels).toContain('direction');
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the default list a 1.7.0 map view passes to render
    expect(arrow(false, DEFAULT_DISPLAY.labels)).toBe(90);
  });

  it("a vessel's hull turns to 90 either way", () => {
    const symbols = service();
    for (const labels of [[], ['direction']] as const) {
      const image = symbols.render({ standard: 'vessel', sidc: '0470', modifiers: { direction: 90, speed: 5 }, size: 30, labels });
      const rotate = image.image instanceof HTMLCanvasElement ? callsOn(image.image).find((c) => c.name === 'rotate') : undefined;
      expect(((rotate?.args[0] as number) * 180) / Math.PI).toBeCloseTo(90);
    }
  });

  it("a vessel's texts follow the labels as APP-6's do", () => {
    const symbols = service();
    const texts = (labels: readonly LabelId[]) => {
      const image = symbols.render({ standard: 'vessel', sidc: '0470', modifiers: { direction: 90, speed: 5, uniqueDesignation: 'STENA', quantity: '2' }, size: 30, withText: true, labels });
      return image.image instanceof HTMLCanvasElement ? callsOn(image.image).filter((c) => c.name === 'fillText').map((c) => c.args[0]) : [];
    };
    expect(texts(['speed'])).toEqual(['2', '18 km/h']);
    expect(texts(['uniqueDesignation'])).toEqual(['2', 'STENA']);
  });
});

describe('criterion 24: keys', () => {
  it('two label lists that change the drawing give two cached images', () => {
    const symbols = service();
    const modifiers = { uniqueDesignation: '1', higherFormation: '2 BDE' };
    const t = symbols.render({ standard: 'APP-6D', sidc: INFANTRY, modifiers, size: 30, withText: true, labels: ['uniqueDesignation'] });
    const m = symbols.render({ standard: 'APP-6D', sidc: INFANTRY, modifiers, size: 30, withText: true, labels: ['higherFormation'] });
    expect(m).not.toBe(t);
    expect(symbols.render({ standard: 'APP-6D', sidc: INFANTRY, modifiers, size: 30, withText: true, labels: ['uniqueDesignation'] })).toBe(t);
  });

  it('a symbol with no amplifiers on the list gives one image for any list', () => {
    const symbols = service();
    const lists: (readonly LabelId[] | undefined)[] = [undefined, [], ['name'], ['uniqueDesignation', 'speed'], ['name', 'uniqueDesignation', 'direction']];
    const plain = new Set(lists.map((labels) => symbols.render({ standard: 'APP-6D', sidc: INFANTRY, size: 30, withText: true, ...(labels === undefined ? {} : { labels }) })));
    expect(plain.size).toBe(1);
    const quantity = new Set(lists.map((labels) => symbols.render({ standard: 'APP-6D', sidc: INFANTRY, modifiers: { quantity: '5' }, size: 30, withText: true, ...(labels === undefined ? {} : { labels }) })));
    expect(quantity.size).toBe(1);
  });

  it('a label list that hides the arrow shares the image without direction', () => {
    const symbols = service();
    const none = symbols.render({ standard: 'APP-6D', sidc: INFANTRY, size: 30 });
    expect(symbols.render({ standard: 'APP-6D', sidc: INFANTRY, modifiers: { direction: 90 }, size: 30, labels: [] })).toBe(none);
  });
});
