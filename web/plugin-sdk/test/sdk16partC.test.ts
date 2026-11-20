// SDK 1.6.0 part C (CR-0041; T-181, owner QM A): a relation line's colour from the declaring plugin's settings.
import { describe, expect, it } from 'vitest';
import { resolveRelationLines, settingAt, type RelationKind } from '../src/index.ts';
import { createFakeContext } from '../src/testing/index.ts';

const PAIRING: RelationKind = {
  id: 'gmti.pairing',
  label: 'GMTI Pairing',
  line: { strokeColor: '#FFFF00', strokeWidth: 1, strokeDash: 'solid', arrowhead: 'none', strokeColorSetting: '/pairingColour' },
  defaultOn: true,
};
const REACH: RelationKind = {
  id: 'simulator.beyond-reach',
  label: 'Beyond output reach',
  line: { strokeColor: '#FF0000', strokeWidth: 1, strokeDash: 'solid', arrowhead: 'none' },
  defaultOn: true,
};

describe('SDK 1.6.0 part C: settingAt', () => {
  it('follows a JSON Pointer through objects and arrays, with its escapes', () => {
    const settings = { pairingColour: '#00FF00', links: [{ port: 8087 }], 'a/b': { '~c': 1 } };
    expect(settingAt(settings, '/pairingColour')).toBe('#00FF00');
    expect(settingAt(settings, '/links/0/port')).toBe(8087);
    expect(settingAt(settings, '/a~1b/~0c')).toBe(1);
    expect(settingAt(settings, '')).toBe(settings);
    expect(settingAt(settings, '/links/01/port')).toBeUndefined();
    expect(settingAt(settings, '/missing/x')).toBeUndefined();
    expect(settingAt(settings, 'pairingColour')).toBeUndefined();
    expect(settingAt({}, '/toString')).toBeUndefined();
  });
});

describe('SDK 1.6.0 part C: resolveRelationLines', () => {
  it('takes the colour from the plugin\'s setting, and the manifest\'s without one', () => {
    const lines = resolveRelationLines([PAIRING, REACH], (p) => (p === 'gmti' ? { pairingColour: '#00FF00' } : undefined));
    expect(lines['gmti.pairing']?.strokeColor).toBe('#00FF00');
    expect(lines['gmti.pairing']?.strokeWidth).toBe(1);
    expect(lines['simulator.beyond-reach']?.strokeColor).toBe('#FF0000');
    expect(Object.isFrozen(lines)).toBe(true);
  });

  it('falls back to strokeColor while the setting is missing or not a colour', () => {
    for (const settings of [undefined, {}, { pairingColour: 'green' }, { pairingColour: '#0F0' }, { pairingColour: 7 }]) {
      expect(resolveRelationLines([PAIRING], () => settings)['gmti.pairing']?.strokeColor).toBe('#FFFF00');
    }
  });
});

describe('SDK 1.6.0 part C: ctx.relationLines in the fake', () => {
  it('resolves the lines from the plugins\' settings and follows a change', () => {
    const ctx = createFakeContext({ relationKinds: [PAIRING, REACH], pluginSettings: { gmti: { pairingColour: '#00FF00' } } });
    expect(ctx.relationLines.value['gmti.pairing']?.strokeColor).toBe('#00FF00');
    const seen: string[] = [];
    ctx.relationLines.onChange((lines) => seen.push(lines['gmti.pairing']?.strokeColor ?? ''));
    ctx.setPluginSettings('gmti', { pairingColour: '#FF00FF' });
    expect(seen).toEqual(['#FF00FF']);
    expect(ctx.relationLines.value['gmti.pairing']?.strokeColor).toBe('#FF00FF');
    expect(ctx.relationKinds[0]?.line.strokeColor).toBe('#FFFF00');
  });

  it('gives the manifest\'s colours without settings', () => {
    const ctx = createFakeContext({ relationKinds: [PAIRING] });
    expect(ctx.relationLines.value['gmti.pairing']?.strokeColor).toBe('#FFFF00');
  });
});
