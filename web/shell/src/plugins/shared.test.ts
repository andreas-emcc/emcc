import type { DataType } from '@emc2/plugin-sdk';
import { describe, expect, it } from 'vitest';
import { SharedState } from './shared.ts';

const general: DataType = { id: 'core.general', name: 'General', declaredBy: null, defaults: {}, behaviour: {} };
const track = (expiresAfterSeconds: number): DataType => ({
  id: 'cot.track', name: 'Track', declaredBy: 'cot', defaults: { expiresAfterSeconds: 300 }, behaviour: { expiresAfterSeconds },
});

describe('SharedState', () => {
  it('a socket message always counts; an HTTP value only where no socket message has set it', () => {
    const shared = new SharedState();
    shared.settingsChanged('cot', { mode: 'from the socket' });
    shared.initialSettings('cot', { mode: 'from an older HTTP answer' });
    shared.initialSettings('draw', { size: 32 });
    shared.dataTypesChanged([general, track(60)]);
    shared.initialDataTypes([general, track(300)]);

    expect(shared.settingsOf('cot')).toEqual({ mode: 'from the socket' });
    expect(shared.settingsOf('draw')).toEqual({ size: 32 });
    expect(shared.settingsOf('unknown')).toEqual({});
    expect(shared.dataTypes[1]?.behaviour).toEqual({ expiresAfterSeconds: 60 });
  });

  it('tells listeners only of real changes, with frozen values', () => {
    const shared = new SharedState();
    shared.initialSettings('cot', { mode: 'a' });
    const seen: unknown[] = [];
    shared.onSettings('cot', (s) => seen.push(s));
    const types: unknown[] = [];
    const stop = shared.onDataTypes((t) => types.push(t));

    shared.settingsChanged('cot', { mode: 'a' }); // the same: no call
    shared.settingsChanged('cot', { mode: 'b' });
    shared.settingsChanged('draw', { size: 1 }); // another plugin's
    shared.dataTypesChanged([general]);
    stop();
    shared.dataTypesChanged([general, track(5)]);

    expect(seen).toEqual([{ mode: 'b' }]);
    expect(Object.isFrozen(seen[0])).toBe(true);
    expect(types).toEqual([[{ ...general, fieldSets: [], manual: true }]]);
    expect(Object.isFrozen(shared.dataTypes)).toBe(true);
  });

  it('gives every data type its field sets and whether it is made by hand (SDK 1.5.0)', () => {
    const shared = new SharedState();
    const vessel: DataType = { ...track(600), id: 'ais.vessel', declaredBy: 'ais', fieldSets: ['ais.ship'], manual: false };
    shared.initialDataTypes([general, vessel]);

    expect(shared.dataTypes[0]).toMatchObject({ fieldSets: [], manual: true });
    expect(shared.dataTypes[1]).toMatchObject({ fieldSets: ['ais.ship'], manual: false });
  });

  it('takes the declared fields once, from /api/config, and keeps them frozen', () => {
    const shared = new SharedState();
    let told = 0;
    shared.onDeclaredFields(() => { told++; });
    const callsign = { plugin: 'cot', name: 'callsign', type: 'text', label: 'Callsign' } as const;

    shared.initialDeclaredFields([]); // none declared: nothing to tell
    shared.initialDeclaredFields([callsign]);
    shared.initialDeclaredFields([{ ...callsign, label: 'Other' }]); // fixed while the server runs

    expect(shared.declaredFields).toEqual([callsign]);
    expect(Object.isFrozen(shared.declaredFields[0])).toBe(true);
    expect(told).toBe(1);
  });

  it("takes the field sets and relation kinds once, from /api/config, frozen, with the line's defaults filled in (SDK 1.4.0)", () => {
    const shared = new SharedState();
    const unit = { id: 'cot.unit', plugin: 'cot', name: 'unit', label: 'CoT unit', fields: ['callsign'] } as const;

    shared.initialSetsAndKinds([unit], [{ id: 'gmti.pairing', label: 'GMTI Pairing', line: { strokeColor: '#FFFF00' } },
      { id: 'gmti.lead', label: 'Leads', line: { strokeColor: '#00FF00', strokeWidth: 2, strokeDash: 'dot', arrowhead: 'end' }, defaultOn: true }]);
    shared.initialSetsAndKinds([{ ...unit, label: 'Other' }], [{ id: 'other.kind', label: 'Other', line: { strokeColor: '#000000' } }]);

    expect(shared.fieldSets).toEqual([unit]);
    expect(shared.relationKinds).toEqual([
      { id: 'gmti.pairing', label: 'GMTI Pairing', defaultOn: false, line: { strokeColor: '#FFFF00', strokeWidth: 1, strokeDash: 'solid', arrowhead: 'none' } },
      { id: 'gmti.lead', label: 'Leads', defaultOn: true, line: { strokeColor: '#00FF00', strokeWidth: 2, strokeDash: 'dot', arrowhead: 'end' } },
    ]);
    expect(Object.isFrozen(shared.fieldSets[0]?.fields)).toBe(true);
    expect(Object.isFrozen(shared.relationKinds[0]?.line)).toBe(true);
  });

  it("gives each kind's line in its declaring plugin's colour, again after that plugin's settings change (SDK 1.6.0 part C)", () => {
    const shared = new SharedState();
    const told: unknown[] = [];
    shared.relationLines.onChange((lines) => told.push(lines['gmti.pairing']?.strokeColor));
    shared.initialSettings('gmti', { pairingColour: '#FF8800' });
    shared.initialSetsAndKinds([], [
      { id: 'gmti.pairing', label: 'GMTI Pairing', line: { strokeColor: '#FFFF00', strokeColorSetting: '/pairingColour' } },
      { id: 'cot.link', label: 'Links', line: { strokeColor: '#00FF00' } },
    ]);

    expect(shared.relationKinds[0]?.line.strokeColorSetting, 'kept from /api/config').toBe('/pairingColour');
    expect(shared.relationLines.value['gmti.pairing']).toEqual({
      strokeColor: '#FF8800', strokeWidth: 1, strokeDash: 'solid', arrowhead: 'none', strokeColorSetting: '/pairingColour',
    });
    expect(shared.relationLines.value['cot.link']?.strokeColor).toBe('#00FF00');

    shared.settingsChanged('gmti', { pairingColour: '#0000FF' });
    shared.settingsChanged('cot', { other: 1 }); // no kind of cot's takes a colour from its settings: nothing to tell
    shared.settingsChanged('gmti', { pairingColour: 'teal' }); // not a colour: the manifest's
    expect(told).toEqual(['#FF8800', '#0000FF', '#FFFF00']);
    expect(Object.isFrozen(shared.relationLines.value)).toBe(true);
  });

  it("gives each data type its stepped fade from its declaring plugin's settings, again after they change (SDK 1.7.0)", () => {
    const shared = new SharedState();
    const told: unknown[] = [];
    shared.onDataTypes((types) => told.push(types.find((t) => t.id === 'gmti.detection')?.fade));
    const detection: DataType = {
      id: 'gmti.detection', name: 'Detection', declaredBy: 'gmti', defaults: {}, behaviour: {}, fadeSetting: '/detectionFade',
    };
    const fade = { on: true, fromSeconds: 10, stepPercent: 5, invisibleAtSeconds: 100 };
    shared.initialSettings('gmti', { detectionFade: fade });
    shared.initialDataTypes([general, track(300), detection]);

    expect(shared.dataTypes[2]?.fadeSetting, 'kept from /api/config').toBe('/detectionFade');
    expect(shared.dataTypes[2]?.fade).toEqual({ fromSeconds: 10, stepPercent: 5, invisibleAtSeconds: 100 });
    expect(shared.dataTypes[1]?.fade, 'none declared').toBeUndefined();

    shared.settingsChanged('gmti', { detectionFade: fade, other: 1 }); // the fade is the same: nothing to tell
    shared.settingsChanged('cot', { other: 1 }); // no type of cot's has a fade
    shared.settingsChanged('gmti', { detectionFade: { ...fade, stepPercent: 10 } });
    shared.settingsChanged('gmti', { detectionFade: { ...fade, on: false } }); // off: none
    shared.dataTypesChanged([general, track(300), { ...detection, fade: { fromSeconds: 1, stepPercent: 50, invisibleAtSeconds: 2 } }]);
    expect(told).toEqual([
      { fromSeconds: 10, stepPercent: 5, invisibleAtSeconds: 100 },
      { fromSeconds: 10, stepPercent: 10, invisibleAtSeconds: 100 },
      undefined,
    ]);
    expect(shared.dataTypes[2]?.fade, "a server's fade is not taken").toBeUndefined();
    expect(Object.isFrozen(shared.dataTypes[2])).toBe(true);
  });
});
