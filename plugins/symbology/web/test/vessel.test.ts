import { describe, expect, it } from 'vitest';
import type { MilSymbol, SymbolService } from '@emc2/plugin-sdk';
import { createSymbolService } from '../src/service.ts';
import { groupOf, IDENTITY_OUTLINES, VESSEL_GROUPS } from '../src/vessel.ts';
import { callsOn, isDrawn } from './canvas.ts';
import { exampleSymbols } from './examples.ts';

const GROUND = '#0f1217';

function service(ground = GROUND): SymbolService {
  return createSymbolService({ cacheSize: 1000, ground: () => ground }).service;
}

/** The drawing calls of a vessel image: the turn (degrees), the shape and its fill and outline. */
function drawing(image: HTMLCanvasElement | ImageBitmap) {
  if (!(image instanceof HTMLCanvasElement)) throw new Error('not a canvas');
  const calls = callsOn(image);
  const rotate = calls.find((c) => c.name === 'rotate');
  const fill = calls.find((c) => c.name === 'fill');
  const strokes = calls.filter((c) => c.name === 'stroke');
  const stroke = strokes[0];
  return {
    degrees: rotate === undefined ? null : ((rotate.args[0] as number) * 180) / Math.PI,
    hull: calls.some((c) => c.name === 'lineTo'),
    mark: calls.some((c) => c.name === 'arc'),
    fill: fill?.fillStyle,
    outline: stroke?.strokeStyle,
    /** Strokes are centred on the shape's edge: the outside half of each shows. */
    outlineWidth: typeof stroke?.lineWidth === 'number' ? stroke.lineWidth / 2 : undefined,
    gap: strokes[1] === undefined ? undefined : { colour: strokes[1].strokeStyle, width: (strokes[1].lineWidth as number) / 2 },
    order: calls.filter((c) => c.name === 'stroke' || c.name === 'fill').map((c) => c.name),
    texts: calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]),
  };
}

const ship = (): MilSymbol => {
  const example = exampleSymbols('valid').find((e) => e.file === 'object-vessel.json');
  if (example === undefined) throw new Error('object-vessel.json has no symbol');
  return example.symbol;
};

describe('criterion 19: a vessel is drawn', () => {
  it("object-vessel.json's ship (0470, direction 212.5, speed 6.4) is a hull pointing 212.5° to the whole degree, filled cargo green, a 1 px gap in the ground colour, outlined neutral green, 2 px", () => {
    const { standard, sidc, modifiers } = ship();
    expect([standard, sidc, modifiers?.direction, modifiers?.speed]).toEqual(['vessel', '0470', 212.5, 6.4]);
    const image = service().render({ standard, sidc, ...(modifiers === undefined ? {} : { modifiers }), size: 30 });
    expect(isDrawn(image.image)).toBe(true);
    const d = drawing(image.image);
    expect(d.hull).toBe(true);
    expect(d.mark).toBe(false);
    expect(Math.abs((d.degrees ?? NaN) - 212.5)).toBeLessThanOrEqual(0.5);
    expect(d.fill).toBe('#5A9E3A');
    expect(d.outline).toBe('#aaffaa');
    // 2 px of outline beyond the 1 px gap.
    expect((d.outlineWidth ?? 0) - (d.gap?.width ?? 0)).toBe(2);
    expect(d.gap).toEqual({ colour: GROUND, width: 1 });
    // The anchor is the hull's centre, the middle of the image without text.
    expect(image.anchor).toEqual([image.width / 2, image.height / 2]);
  });

  it.each([
    ['without direction', { speed: 6.4 }],
    ['with speed 0', { direction: 212.5, speed: 0 }],
    ['without modifiers', undefined],
  ])('%s, it is the mark: a filled circle, not turned', (_case, modifiers) => {
    const image = service().render({ standard: 'vessel', sidc: '0470', ...(modifiers === undefined ? {} : { modifiers }), size: 30 });
    const d = drawing(image.image);
    expect(d.mark).toBe(true);
    expect(d.hull).toBe(false);
    expect(d.degrees).toBeNull();
    expect(d.fill).toBe('#5A9E3A');
  });

  it('a direction without speed is moving: the hull', () => {
    expect(drawing(service().render({ standard: 'vessel', sidc: '0470', modifiers: { direction: 90 }, size: 30 }).image).degrees).toBeCloseTo(90);
  });

  it('the hull is about the symbol size long, and the mark half of it across', () => {
    const symbols = service();
    const hull = symbols.render({ standard: 'vessel', sidc: '0470', modifiers: { direction: 0 }, size: 40 });
    const mark = symbols.render({ standard: 'vessel', sidc: '0470', size: 40 });
    expect(hull.width).toBeGreaterThanOrEqual(40);
    expect(hull.width).toBeLessThanOrEqual(50);
    expect(mark.width).toBeGreaterThanOrEqual(20);
    expect(mark.width).toBeLessThanOrEqual(26);
  });

  it.each([
    ['0', 'pending', '#ffff80'],
    ['1', 'unknown', '#ffff80'],
    ['2', 'assumed friend', '#80e0ff'],
    ['3', 'friend', '#80e0ff'],
    ['4', 'neutral', '#aaffaa'],
    ['5', 'suspect', '#ff8080'],
    ['6', 'hostile', '#ff8080'],
  ])('identity %s (%s) is outlined in %s, the APP-6 frame colour', (identity, _name, colour) => {
    expect(IDENTITY_OUTLINES[Number(identity)]).toBe(colour);
    expect(drawing(service().render({ standard: 'vessel', sidc: `0${identity}80`, modifiers: { direction: 10 }, size: 30 }).image).outline).toBe(colour);
  });

  it('every group fills in its colour; the context digit changes nothing in the drawing', () => {
    for (const group of VESSEL_GROUPS) {
      const code = group.shipTypes[0]?.code ?? 0;
      const sidc = `03${String(code).padStart(2, '0')}`;
      expect(drawing(service().render({ standard: 'vessel', sidc, size: 30 }).image).fill).toBe(group.color);
      expect(drawing(service().render({ standard: 'vessel', sidc: `2${sidc.slice(1)}`, size: 30 }).image).fill).toBe(group.color);
    }
  });

  it('with withText, the text amplifiers stand beside the hull, upright; without it, none', () => {
    const symbols = service();
    const modifiers = { direction: 45, speed: 5, uniqueDesignation: 'STENA' };
    const plain = symbols.render({ standard: 'vessel', sidc: '0470', modifiers, size: 30 });
    const text = symbols.render({ standard: 'vessel', sidc: '0470', modifiers, size: 30, withText: true });
    expect(drawing(plain.image).texts).toEqual([]);
    expect(drawing(text.image).texts).toEqual(['STENA', '18 km/h']);
    expect(text.width).toBeGreaterThan(plain.width);
    // The hull keeps its place: the anchor is its centre, not the middle of the wider image.
    expect(text.anchor[0]).toBe(plain.anchor[0]);
  });

  it('an invalid code still draws, as an unknown ship of unknown identity', () => {
    const d = drawing(service().render({ standard: 'vessel', sidc: '9999', size: 30 }).image);
    expect(d.fill).toBe('#D0D0D0');
    expect(d.outline).toBe('#ffff80');
  });
});

describe('criterion 20: ship-type groups', () => {
  it("lists function 13's nine groups in its order, labels and colours", () => {
    expect(service().vesselGroups().map((g) => [g.id, g.label, g.color])).toEqual([
      ['cargo', 'Cargo', '#5A9E3A'],
      ['tanker', 'Tanker', '#C23B30'],
      ['passenger', 'Passenger', '#2F6FD0'],
      ['fishing', 'Fishing', '#E08A2E'],
      ['pleasure', 'Pleasure craft', '#B248B8'],
      ['highSpeed', 'High-speed craft', '#D8B820'],
      ['tugSpecial', 'Tug and special craft', '#2AA6A6'],
      ['other', 'Other', '#808080'],
      ['unknown', 'Unknown', '#D0D0D0'],
    ]);
  });

  it('puts every AIS type 0 to 99 in exactly one group, each with a name', () => {
    const codes = VESSEL_GROUPS.flatMap((g) => g.shipTypes.map((t) => t.code)).sort((a, b) => a - b);
    expect(codes).toEqual(Array.from({ length: 100 }, (_, i) => i));
    expect(VESSEL_GROUPS.flatMap((g) => g.shipTypes).every((t) => t.name.trim() !== '')).toBe(true);
  });

  it.each([
    [0, 'unknown', 'Not available'],
    [30, 'fishing', 'Fishing'],
    [31, 'tugSpecial', 'Towing'],
    [36, 'pleasure', 'Sailing'],
    [37, 'pleasure', 'Pleasure craft'],
    [41, 'highSpeed', 'High-speed craft, hazardous category A'],
    [52, 'tugSpecial', 'Tug'],
    [60, 'passenger', 'Passenger'],
    [70, 'cargo', 'Cargo'],
    [79, 'cargo', 'Cargo, no additional information'],
    [84, 'tanker', 'Tanker, hazardous category D'],
    [95, 'other', 'Other type, reserved'],
    [20, 'other', 'Wing in ground'],
    [5, 'other', 'Reserved'],
  ])('type %i is in %s, named "%s"', (code, group, name) => {
    expect(groupOf(code).id).toBe(group);
    expect(groupOf(code).shipTypes.find((t) => t.code === code)?.name).toBe(name);
  });

  it('gives the same frozen list every time', () => {
    const symbols = service();
    expect(symbols.vesselGroups()).toBe(symbols.vesselGroups());
    expect(Object.isFrozen(VESSEL_GROUPS[0])).toBe(true);
  });
});

describe("the gap in the look's ground colour (owner, LS, 2026-11-08)", () => {
  it.each([
    ['hull', { direction: 30, speed: 4 }],
    ['mark', undefined],
  ])('the %s has a 1 px gap in the ground colour between its fill and its 2 px outline', (_shape, modifiers) => {
    const d = drawing(service().render({ standard: 'vessel', sidc: '0370', ...(modifiers === undefined ? {} : { modifiers }), size: 30 }).image);
    // Outline stroke 6 wide (3 px outside), gap stroke 2 wide (1 px outside) over it, the fill over both insides.
    expect(d.order).toEqual(['stroke', 'stroke', 'fill']);
    expect(d.outline).toBe('#80e0ff');
    expect(d.outlineWidth).toBe(3);
    expect(d.gap).toEqual({ colour: GROUND, width: 1 });
    expect(d.fill).toBe('#5A9E3A');
  });

  it('another look gives another image with its own ground colour; the same look shares it', () => {
    let ground = '#0f1217';
    const symbols = createSymbolService({ cacheSize: 100, ground: () => ground }).service;
    const dark = symbols.render({ standard: 'vessel', sidc: '0470', size: 30 });
    ground = '#f4f1ea';
    const light = symbols.render({ standard: 'vessel', sidc: '0470', size: 30 });
    expect(light).not.toBe(dark);
    expect(drawing(light.image).gap?.colour).toBe('#f4f1ea');
    expect(symbols.render({ standard: 'vessel', sidc: '0470', size: 30 })).toBe(light);
  });

  it('without a ground colour (no look), the gap is black', () => {
    const symbols = createSymbolService({ cacheSize: 10 }).service;
    expect(drawing(symbols.render({ standard: 'vessel', sidc: '0470', size: 30 }).image).gap?.colour).toBe('#000000');
  });
});

describe('criterion 21: shared images', () => {
  it('100 ships of one type and identity at 100 headings within 10 whole degrees make at most 10 images', () => {
    const symbols = service();
    const images = new Set(Array.from({ length: 100 }, (_, i) => symbols.render({ standard: 'vessel', sidc: '0470', modifiers: { direction: 40 + i * 0.094, speed: 5 }, size: 30 }).image));
    expect(images.size).toBeLessThanOrEqual(10);
    expect(images.size).toBeGreaterThan(1);
  });

  it('every ship that is not moving shares one mark, whatever its last heading', () => {
    const symbols = service();
    const marks = new Set([0, 90, 180, 270].map((direction) => symbols.render({ standard: 'vessel', sidc: '0470', modifiers: { direction, speed: 0 }, size: 30 }).image));
    expect(marks.size).toBe(1);
  });

  it('another code or size is another image', () => {
    const symbols = service();
    const a = symbols.render({ standard: 'vessel', sidc: '0470', size: 30 });
    expect(symbols.render({ standard: 'vessel', sidc: '0480', size: 30 })).not.toBe(a);
    expect(symbols.render({ standard: 'vessel', sidc: '0470', size: 31 })).not.toBe(a);
    expect(symbols.render({ standard: 'vessel', sidc: '0470', size: 30 })).toBe(a);
  });
});
