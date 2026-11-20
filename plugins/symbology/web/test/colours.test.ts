import { afterEach, describe, expect, it } from 'vitest';
import type { SymbolService } from '@emc2/plugin-sdk';
import { createSymbolService, drawnSidc } from '../src/service.ts';
import { fillsOn } from './canvas.ts';

// The affiliation fills of docs/architecture/looks.md, fixed in every look and theme.
const FRIEND = 'rgb(128,224,255)';
const HOSTILE = 'rgb(255,128,128)';
const NEUTRAL = 'rgb(170,255,170)';
const UNKNOWN = 'rgb(255,255,128)';
// milsymbol's own colours, which emc2 does not use: the civilian purple and the 2525E suspect colour.
const NOT_USED = ['rgb(255,161,255)', 'rgb(255,229,153)', 'rgb(255,188,1)'];

/** The fill of each standard identity (SIDC digit 4). */
const IDENTITIES = [
  ['0', 'pending', UNKNOWN],
  ['1', 'unknown', UNKNOWN],
  ['2', 'assumed friend', FRIEND],
  ['3', 'friend', FRIEND],
  ['4', 'neutral', NEUTRAL],
  ['5', 'suspect', HOSTILE],
  ['6', 'hostile', HOSTILE],
] as const;

/** Civilian symbols (milsymbol's civilian rule) and military ones, as the rest of the SIDC after the identity. */
const SYMBOLS = [
  ['civilian fixed-wing aircraft', '0100001201000000'],
  ['civilian merchant ship', '3000001401000000'],
  ['military fixed-wing aircraft', '0100001101000000'],
  ['infantry', '1000001211000000'],
] as const;

const VERSIONS = [
  ['APP-6D', '10'],
  ['APP-6E', '13'],
  ['APP-6E', '14'],
] as const;

function service(): SymbolService {
  return createSymbolService({ cacheSize: 100 }).service;
}

function fillsOf(svc: SymbolService, standard: 'APP-6D' | 'APP-6E', sidc: string): string[] {
  return fillsOn(svc.render({ standard, sidc, size: 30 }).image as HTMLCanvasElement);
}

afterEach(() => {
  for (const name of ['data-look', 'data-scheme', 'data-density']) document.documentElement.removeAttribute(name);
});

describe("Identity colours: looks.md's four affiliation fills", () => {
  const cases = SYMBOLS.flatMap(([symbol, rest]) =>
    VERSIONS.flatMap(([standard, version]) => IDENTITIES.map(([digit, identity, fill]) => [symbol, identity, version, standard, `${version}0${digit}${rest}`, fill] as const)),
  );

  it.each(cases)('%s, %s, version %s: the frame is filled with its identity colour', (_symbol, _identity, _version, standard, sidc, fill) => {
    const fills = fillsOf(service(), standard, sidc);
    expect(fills).toContain(fill);
    for (const colour of NOT_USED) expect(fills).not.toContain(colour);
  });

  it('a suspect (and an exercise joker, digit 4 also 5) with version 13 is drawn as with version 14; nothing else changes', () => {
    expect(drawnSidc('13050100001101000000')).toBe('14050100001101000000');
    expect(drawnSidc('13150100001101000000')).toBe('14150100001101000000');
    expect(drawnSidc('13060100001101000000')).toBe('13060100001101000000');
    expect(drawnSidc('13160100001101000000')).toBe('13160100001101000000');
    expect(drawnSidc('14050100001101000000')).toBe('14050100001101000000');
    expect(drawnSidc('10050100001101000000')).toBe('10050100001101000000');
    const svc = service();
    expect(fillsOf(svc, 'APP-6E', '13051000001211000000')).toEqual(fillsOf(svc, 'APP-6E', '14051000001211000000'));
    for (const joker of ['13151000001211000000', '14151000001211000000', '10151000001211000000']) {
      expect(fillsOf(svc, joker.startsWith('10') ? 'APP-6D' : 'APP-6E', joker)).toContain(HOSTILE);
    }
  });

  it('the fills are the same in every look, theme and density', () => {
    const civilianUnknown = '10010100001201000000';
    for (const look of ['night-watch', 'chart-room', 'signal']) {
      for (const scheme of ['dark', 'light']) {
        for (const density of ['compact', 'comfortable']) {
          document.documentElement.setAttribute('data-look', look);
          document.documentElement.setAttribute('data-scheme', scheme);
          document.documentElement.setAttribute('data-density', density);
          expect(fillsOf(service(), 'APP-6D', civilianUnknown)).toContain(UNKNOWN);
        }
      }
    }
  });
});
