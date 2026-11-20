import { BACKGROUND_MAP, COORDINATES, SYMBOLS, type BackgroundMapProvider, type ServiceKey, type SymbolService } from '@emc2/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { ServiceRegistry } from './services.ts';

const symbols = { name: 'symbols' } as unknown as SymbolService;
const otherSymbols = { name: 'other' } as unknown as SymbolService;
const osm = { id: 'osm' } as unknown as BackgroundMapProvider;
const topo = { id: 'topo' } as unknown as BackgroundMapProvider;

function registry() {
  return new ServiceRegistry([
    { id: 'symbology', provides: ['emc2.symbols'] },
    { id: 'spare', provides: ['emc2.symbols'] },
    { id: 'osm', provides: ['emc2.background-map'] },
    { id: 'topo', provides: ['emc2.background-map'] },
    { id: 'user', provides: [] },
  ]);
}

describe('ServiceRegistry', () => {
  it('lets a plugin provide only the keys in its manifest', () => {
    const services = registry();
    expect(() => { services.provide('user', SYMBOLS, symbols); }).toThrow('user may not provide emc2.symbols: it is not in the manifest\'s "provides"');
  });

  it('refuses a second provider of a "one" key', () => {
    const services = registry();
    services.provide('symbology', SYMBOLS, symbols);
    expect(() => { services.provide('spare', SYMBOLS, otherSymbols); }).toThrow('emc2.symbols is already provided by symbology; there can be only one');
    expect(() => { services.provide('symbology', SYMBOLS, otherSymbols); }).toThrow('symbology already provides emc2.symbols');
  });

  it('get resolves once the provider has activated', async () => {
    const services = registry();
    const got = vi.fn();
    void services.get(SYMBOLS).then(got);
    services.provide('symbology', SYMBOLS, symbols);
    await Promise.resolve();
    expect(got).not.toHaveBeenCalled();

    services.activated('symbology');
    await vi.waitFor(() => { expect(got).toHaveBeenCalledWith(symbols); });
    await expect(services.get(SYMBOLS)).resolves.toBe(symbols);
  });

  it('get rejects at once for a key nobody provides', async () => {
    await expect(registry().get(COORDINATES)).rejects.toThrow('no loaded plugin provides emc2.coordinates');
  });

  it('get waits while a provider may still come, and rejects when all failed or did not provide it', async () => {
    const services = registry();
    const waiting = services.get(SYMBOLS);
    services.provide('symbology', SYMBOLS, symbols);
    services.failed('symbology');
    services.activated('spare'); // activated without providing the key
    await expect(waiting).rejects.toThrow('emc2.symbols is not available: its provider (symbology, spare) failed or did not provide it');
    await expect(services.get(SYMBOLS)).rejects.toThrow(/not available/);
  });

  it('a provider that fails after activating takes its service with it', async () => {
    const services = registry();
    services.provide('symbology', SYMBOLS, symbols);
    services.activated('symbology');
    services.activated('spare');
    services.failed('symbology');
    await expect(services.get(SYMBOLS)).rejects.toThrow(/not available/);
    expect(services.available('emc2.symbols')).toBe(false);
  });

  it('getAll lists the active providers in load order and reports changes', () => {
    const services = registry();
    const list = services.getAll(BACKGROUND_MAP);
    const changes: (readonly BackgroundMapProvider[])[] = [];
    const off = list.onChange((current) => changes.push(current));

    services.provide('topo', BACKGROUND_MAP, topo);
    services.provide('osm', BACKGROUND_MAP, osm);
    expect(list.current).toEqual([]); // not activated yet
    services.activated('topo');
    services.activated('osm');
    expect(list.current).toEqual([osm, topo]);
    services.failed('topo');
    expect(list.current).toEqual([osm]);
    off();
    services.failed('osm');

    expect(changes).toEqual([[topo], [osm, topo], [osm]]);
  });

  it('removes one implementation when its provide is undone, and getAll follows (SDK 1.3.0, CR-0023)', () => {
    const services = registry();
    const list = services.getAll(BACKGROUND_MAP);
    const changes: (readonly BackgroundMapProvider[])[] = [];
    list.onChange((current) => changes.push(current));
    const removeOsm = services.provide('osm', BACKGROUND_MAP, osm);
    services.provide('topo', BACKGROUND_MAP, topo);
    services.activated('osm');
    services.activated('topo');

    removeOsm();
    expect(list.current).toEqual([topo]);
    removeOsm(); // a second call does nothing
    expect(list.current).toEqual([topo]);

    const removeAgain = services.provide('osm', BACKGROUND_MAP, osm); // provided again
    expect(list.current).toEqual([osm, topo]);
    removeOsm(); // the first provide's undo does not reach the second
    expect(list.current).toEqual([osm, topo]);
    removeAgain();
    expect(list.current).toEqual([topo]);
    expect(changes).toEqual([[osm], [osm, topo], [topo], [osm, topo], [topo]]);
  });

  it('lets a plugin provide a "many" key several times, each with its own undo, but a "one" key once (step-2 review, F1)', () => {
    const services = registry();
    const list = services.getAll(BACKGROUND_MAP);
    const changes: (readonly BackgroundMapProvider[])[] = [];
    list.onChange((current) => changes.push(current));
    const wmsA = { id: 'wms-a' } as unknown as BackgroundMapProvider;
    const wmsB = { id: 'wms-b' } as unknown as BackgroundMapProvider;
    services.provide('topo', BACKGROUND_MAP, topo);
    const removeA = services.provide('osm', BACKGROUND_MAP, wmsA);
    services.activated('osm');
    services.activated('topo');
    const removeB = services.provide('osm', BACKGROUND_MAP, wmsB); // after activation: at once

    expect(list.current).toEqual([wmsA, wmsB, topo]); // each plugin's in the order provided, plugins in load order
    removeA();
    expect(list.current).toEqual([wmsB, topo]);
    removeA(); // a second call does nothing
    removeB();
    expect(list.current).toEqual([topo]);
    expect(changes).toEqual([[wmsA], [wmsA, topo], [wmsA, wmsB, topo], [wmsB, topo], [topo]]);

    services.provide('symbology', SYMBOLS, symbols);
    expect(() => { services.provide('symbology', SYMBOLS, otherSymbols); }).toThrow('symbology already provides emc2.symbols');
  });

  it('an undo before activation, or after the provider failed, changes nothing visible', () => {
    const services = registry();
    const list = services.getAll(BACKGROUND_MAP);
    const listener = vi.fn();
    list.onChange(listener);
    services.provide('osm', BACKGROUND_MAP, osm)();
    services.activated('osm');
    expect(list.current).toEqual([]);

    const removeTopo = services.provide('topo', BACKGROUND_MAP, topo);
    services.activated('topo');
    services.failed('topo');
    listener.mockClear();
    removeTopo();
    expect(listener).not.toHaveBeenCalled();
    expect(list.current).toEqual([]);
  });

  it('get refuses a "many" key', async () => {
    await expect(registry().get(BACKGROUND_MAP as unknown as ServiceKey<unknown>)).rejects.toThrow('emc2.background-map has many providers: use getAll');
  });

  it('a service provided after activation is visible at once', async () => {
    const services = registry();
    services.activated('symbology');
    services.provide('symbology', SYMBOLS, symbols);
    await expect(services.get(SYMBOLS)).resolves.toBe(symbols);
  });
});
