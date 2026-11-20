// SDK 1.4.0 part 5 (CR-0030 part 5, CR-0031 section 3; ADR-0046, ADR-0052): display settings.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISPLAY, LABEL_IDS, displayChoicesProblem, displaySettingsProblem, resolveDisplay, type DisplaySettings, type RelationKind,
} from '../src/index.ts';
import { createFakeContext, createFakeSymbolService } from '../src/testing/index.ts';

const line = { color: '#ff8800', width: 1, dash: 'dashed' } as unknown as RelationKind['line'];
const PAIRING: RelationKind = { id: 'gmti.pairing', label: 'GMTI Pairing', line, defaultOn: true };
const LINKS: RelationKind = { id: 'sim.links', label: 'Links', line, defaultOn: false };

describe('the display settings (ADR-0046)', () => {
  it('have the CR defaults and a closed list of labels', () => {
    expect(DEFAULT_DISPLAY).toEqual({ symbolSize: 30, speedVectorMinutes: 0, speedVectorSeconds: 0, labels: ['name', 'uniqueDesignation', 'direction'], labelPlaces: { topLeft: null, topRight: 'uniqueDesignation', bottomLeft: null, bottomRight: null, below: 'name' }, directionArrow: true, relations: {}, classes: { 'dwell-area': true, 'sensor-coverage': true } });
    expect(LABEL_IDS).toHaveLength(10);
    expect(Object.isFrozen(DEFAULT_DISPLAY)).toBe(true);
  });

  it('check each choice within its limits', () => {
    expect(displayChoicesProblem({})).toBeNull();
    expect(displayChoicesProblem({ symbolSize: 16, speedVectorMinutes: 60, labels: [], relations: { x: false } })).toBeNull();
    expect(displayChoicesProblem({ symbolSize: 15 })).toContain('16 to 96');
    expect(displayChoicesProblem({ symbolSize: 97 })).toContain('16 to 96');
    expect(displayChoicesProblem({ symbolSize: 30.5 })).toContain('whole number');
    expect(displayChoicesProblem({ speedVectorMinutes: -1 })).toContain('0 to 60');
    expect(displayChoicesProblem({ speedVectorMinutes: 61 })).toContain('0 to 60');
    expect(displayChoicesProblem({ labels: ['quantity'] })).toBe('unknown label: quantity');
    expect(displayChoicesProblem({ labels: ['name', 'name'] })).toBe('label listed twice: name');
    expect(displayChoicesProblem({ relations: { 'gmti.pairing': 1 } })).toContain('true or false');
    expect(displayChoicesProblem({ size: 30 })).toBe('unknown display setting: size');
    expect(displayChoicesProblem(null)).toContain('an object');
  });

  it('resolve as the user, else the admin, else the defaults, with a switch for every loaded kind and no other (CR-0031, the ACA R5)', () => {
    const user = { symbolSize: 48, relations: { 'gmti.pairing': false, 'gone.kind': true } };
    const admin = { symbolSize: 40, speedVectorMinutes: 5, relations: { 'sim.links': true } };
    const d = resolveDisplay(user, admin, [PAIRING, LINKS]);
    expect(d).toEqual({ symbolSize: 48, speedVectorMinutes: 5, speedVectorSeconds: 300, labels: ['name', 'uniqueDesignation', 'direction'], labelPlaces: { topLeft: null, topRight: 'uniqueDesignation', bottomLeft: null, bottomRight: null, below: 'name' }, directionArrow: true, relations: { 'gmti.pairing': false, 'sim.links': true }, classes: { 'dwell-area': true, 'sensor-coverage': true } });
    expect(resolveDisplay({}, {}, [PAIRING, LINKS]).relations).toEqual({ 'gmti.pairing': true, 'sim.links': false });
    expect(displaySettingsProblem(d, [PAIRING, LINKS])).toBeNull();
    expect(displaySettingsProblem(d, [PAIRING])).toContain('sim.links, which no loaded plugin declares');
    expect(displaySettingsProblem({ ...d, relations: {} }, [PAIRING])).toBe('no switch for the relation kind gmti.pairing');
    const { labels: _labels, ...withoutLabels } = d;
    expect(displaySettingsProblem(withoutLabels, [PAIRING, LINKS])).toBe('labels is missing');
  });
});

describe('the test kit: ctx.display', () => {
  it('starts from the options and the kinds, and setDisplay changes it as the user would', () => {
    const ctx = createFakeContext({ relationKinds: [PAIRING, LINKS], display: { labels: ['uniqueDesignation', 'speed'] } });
    expect(ctx.display.value).toEqual({ symbolSize: 30, speedVectorMinutes: 0, speedVectorSeconds: 0, labels: ['uniqueDesignation', 'speed', 'direction'], labelPlaces: { topLeft: null, topRight: 'uniqueDesignation', bottomLeft: null, bottomRight: 'speed', below: null }, directionArrow: true, relations: { 'gmti.pairing': true, 'sim.links': false }, classes: { 'dwell-area': true, 'sensor-coverage': true } });
    const seen: DisplaySettings[] = [];
    const stop = ctx.display.onChange((v) => seen.push(v));
    ctx.setDisplay({ relations: { 'sim.links': true } });
    ctx.setDisplay({ symbolSize: 64, speedVectorMinutes: 10 });
    expect(seen).toHaveLength(2);
    expect(seen[0]?.relations).toEqual({ 'gmti.pairing': true, 'sim.links': true });
    expect(ctx.display.value).toMatchObject({ symbolSize: 64, speedVectorMinutes: 10, labels: ['uniqueDesignation', 'speed', 'direction'], relations: { 'gmti.pairing': true, 'sim.links': true } });
    ctx.setDisplay({ relations: { 'not.loaded': true } });
    expect(Object.keys(ctx.display.value.relations)).toEqual(['gmti.pairing', 'sim.links']);
    stop?.();
    ctx.setDisplay({ symbolSize: 20 });
    expect(seen).toHaveLength(3);
    expect(() => ctx.setDisplay({ symbolSize: 200 })).toThrow('16 to 96');
    expect(() => createFakeContext({ display: { labels: ['quantity' as never] } })).toThrow('unknown label');
    expect('set' in ctx.display).toBe(false); // plugins never write it (ADR-0046 point 5)
  });

  it('records the size and labels a map view passes to render (owner, Q13)', () => {
    const symbols = createFakeSymbolService();
    symbols.render({ standard: 'APP-6D', sidc: '10031000001211000000', size: 48, withText: true, labels: ['uniqueDesignation'] });
    expect(symbols.renderRequests).toHaveLength(1);
    expect(symbols.renderRequests[0]).toMatchObject({ size: 48, labels: ['uniqueDesignation'] });
  });
});
