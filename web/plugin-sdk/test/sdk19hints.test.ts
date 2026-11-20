import { describe, expect, it } from 'vitest';
import { settingsHintsProblem } from '../src/settings-form.ts';

// SDK 1.9.0's freeze: the hints check's four gaps (found writing the SDK reference, D4).
const page = (properties: Record<string, unknown>) => ({ type: 'object', properties });

describe('settingsHintsProblem, the 1.9.0 checks', () => {
  it('kind colour sits on a string with the colour pattern', () => {
    const colour = (extra: Record<string, unknown>) => page({ c: { type: 'string', 'x-emc2': { kind: 'colour' }, ...extra } });
    expect(settingsHintsProblem(colour({ pattern: '^#[0-9A-Fa-f]{6}$' }))).toBeNull();
    expect(settingsHintsProblem(colour({}))).toBe('/properties/c/x-emc2: kind colour is not on a string with the pattern ^#[0-9A-Fa-f]{6}$');
    expect(settingsHintsProblem(colour({ type: 'integer', pattern: '^#[0-9A-Fa-f]{6}$' }))).toMatch(/kind colour/);
  });

  it('kind layer sits on an object of {id?, name}', () => {
    const layer = (properties: Record<string, unknown>) => page({ l: { type: 'object', 'x-emc2': { kind: 'layer' }, properties } });
    expect(settingsHintsProblem(layer({ id: { type: 'string' }, name: { type: 'string' } }))).toBeNull();
    expect(settingsHintsProblem(layer({ name: { type: 'string' } }))).toBeNull();
    expect(settingsHintsProblem(layer({ id: { type: 'string' } }))).toBe('/properties/l/x-emc2: kind layer is not on an object of {id?, name}');
    expect(settingsHintsProblem(layer({ name: { type: 'string' }, colour: { type: 'string' } }))).toMatch(/kind layer/);
    expect(settingsHintsProblem(page({ l: { type: 'string', 'x-emc2': { kind: 'layer' } } }))).toMatch(/kind layer/);
  });

  it('allowNew only with kind layer', () => {
    const picker = { type: 'object', properties: { name: { type: 'string' } } };
    expect(settingsHintsProblem(page({ l: { ...picker, 'x-emc2': { kind: 'layer', allowNew: false } } }))).toBeNull();
    expect(settingsHintsProblem(page({ l: { ...picker, 'x-emc2': { allowNew: false } } }))).toBe('/properties/l/x-emc2: allowNew is on a field without kind layer');
  });

  it('a condition does not name its own field', () => {
    const when = (key: string, property: string) => page({ mode: { type: 'string' }, port: { type: 'integer', 'x-emc2': { [key]: { property, in: [1] } } } });
    expect(settingsHintsProblem(when('enabledWhen', 'mode'))).toBeNull();
    expect(settingsHintsProblem(when('enabledWhen', 'port'))).toBe('/properties/port/x-emc2: enabledWhen names the field itself');
    expect(settingsHintsProblem(when('visibleWhen', 'port'))).toBe('/properties/port/x-emc2: visibleWhen names the field itself');
  });
});
