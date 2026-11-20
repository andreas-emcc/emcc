/**
 * The fade in steps at the plugin's level (brief function 46, criterion 107; SDK 1.7.0, CR-0042 A): a data type's `fadeSetting`
 * resolved by the test kit as the shell will, a changed setting through `onDataTypesChange`, and the relation line of a faded detection.
 */
import { describe, expect, it } from 'vitest';
import type { DataType, MapObject, Relation } from '@emc2/plugin-sdk';
import { createFakeContext } from '@emc2/plugin-sdk/testing';
import { itemOpacity } from '../src/core/expiry.ts';
import { relationItemId } from '../src/core/relations.ts';
import { layer, symbolObject, uuid, WALL_START } from './fixtures.ts';
import { activate } from './harness.ts';

const L = layer(1);
const ON = { on: true, fromSeconds: 10, stepPercent: 5, invisibleAtSeconds: 100 };
const DETECTION: Omit<DataType, 'behaviour'> = {
  id: 'gmti.detection', name: 'GMTI detection', declaredBy: 'gmti', defaults: { fadeWhenExpired: true }, fadeSetting: '/detectionFade',
};
const PAIRING = { id: 'gmti.pairing', label: 'GMTI Pairing', defaultOn: true, line: { strokeColor: '#FFFF00', strokeWidth: 1, strokeDash: 'solid' as const, arrowhead: 'none' as const } };

const observed = new Date(WALL_START).toISOString();
const track = (n: number, lon: number, relations?: readonly Relation[]): MapObject => ({
  ...symbolObject(n, L.id, lon, 58.4),
  dataType: 'gmti.detection',
  dataSource: 'gmti',
  time: { observed },
  ...(relations === undefined ? {} : { relations }),
});

function start(setting: unknown = ON) {
  const ctx = createFakeContext({
    pluginId: 'map-view-2d', provides: ['emc2.map-view'], dataTypes: [DETECTION], relationKinds: [PAIRING],
    pluginSettings: { gmti: { detectionFade: setting } },
  });
  const run = activate({ ctx });
  if (run.engine === null) throw new Error('no engine');
  return { ...run, engine: run.engine, ctx };
}

describe("the fade in steps from a plugin's setting (function 46, criterion 107)", () => {
  it("draws the objects at the setting's steps, and a changed setting applies at once, without a reload or a new subscription", () => {
    const { engine, ctx, clock } = start();
    ctx.live.snapshot({ layers: [L], objects: [track(10, 15.2)] });
    const opacity = () => {
      const drawn = engine.items.get(L.id)?.get(uuid(10));
      return drawn === undefined ? undefined : itemOpacity(drawn);
    };
    clock.advance(55_000);
    expect(opacity()).toBe(0.5);
    const subscriptions = ctx.liveSubscriptions.length;
    ctx.setPluginSettings('gmti', { detectionFade: { ...ON, invisibleAtSeconds: 50 } });
    expect(opacity()).toBeUndefined(); // invisible at 50 s
    ctx.setPluginSettings('gmti', { detectionFade: { ...ON, on: false } });
    expect(opacity()).toBe(1); // off: not expired yet, and no step
    ctx.setPluginSettings('gmti', { detectionFade: ON });
    expect(opacity()).toBe(0.5);
    expect(ctx.liveSubscriptions).toHaveLength(subscriptions);
  });

  it('a type whose fade is off, or whose setting is not of the form, is not faded in steps', () => {
    for (const setting of [{ ...ON, on: false }, { ...ON, stepPercent: 3 }, null]) {
      const { engine, ctx, clock } = start(setting);
      ctx.live.snapshot({ layers: [L], objects: [track(10, 15.2)] });
      clock.advance(55_000);
      expect(engine.items.get(L.id)?.get(uuid(10))).not.toHaveProperty('opacity');
    }
  });

  it("its pairing line has the detection's opacity, and goes when the detection is invisible", () => {
    const { engine, ctx, clock } = start();
    const platform = symbolObject(11, L.id, 15.9, 58.95);
    ctx.live.snapshot({ layers: [L], objects: [track(10, 15.2, [{ kind: 'gmti.pairing', objectId: uuid(11) }]), platform] });
    const line = relationItemId('gmti.pairing', uuid(10), uuid(11));
    const lineOpacity = () => {
      const drawn = engine.items.get(L.id)?.get(line);
      return drawn === undefined ? undefined : itemOpacity(drawn);
    };
    expect(lineOpacity()).toBe(1);
    clock.advance(55_000);
    expect(lineOpacity()).toBe(0.5);
    clock.advance(45_000);
    expect(engine.items.get(L.id)?.get(uuid(10))).toBeUndefined();
    expect(lineOpacity()).toBeUndefined();
    expect(engine.items.get(L.id)?.get(uuid(11))).toBeDefined(); // the platform is not faded
  });
});
