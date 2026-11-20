import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsServices } from '../../testing/fakes.ts';
import { PluginSettingsView } from './PluginSettingsView.tsx';
import { fieldOf, isEnabled, type Field, type JsonObject } from './schema.ts';

/** Like `model/examples/valid/manifest-layer-picker.json`: links whose layer fields depend on their direction. */
const SCHEMA = {
  type: 'object',
  properties: {
    links: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          direction: { enum: ['in', 'out', 'both'], default: 'both' },
          target: { type: 'string', 'x-emc2': { enabledWhen: { property: 'direction', in: ['in', 'both'] } } },
          sources: { type: 'array', items: { type: 'string' }, default: [], 'x-emc2': { enabledWhen: { property: 'direction', in: ['out', 'both'] } } },
        },
      },
    },
    mode: { enum: ['a', 'b'] },
    onlyB: { type: 'string', 'x-emc2': { enabledWhen: { property: 'mode', in: ['b'] } } },
  },
};

const propertiesOf = (field: Field) => (field.kind === 'object' ? field.properties : []);
const property = (schema: unknown, name: string) => {
  const found = propertiesOf(fieldOf(schema, 'Settings')).find((p) => p.name === name);
  if (found === undefined) throw new Error(`no ${name}`);
  return found;
};

describe('enabledWhen in the form model (SDK 1.3.0, CR-0028 part 5)', () => {
  const object = (when: unknown, siblings: Record<string, unknown> = { mode: { enum: ['a', 'b'], default: 'a' } }) => ({
    type: 'object', properties: { ...siblings, field: { type: 'string', 'x-emc2': { enabledWhen: when } } },
  });

  it('enables the field while the sibling\'s value is in "in"; an absent sibling counts as its default, with neither it is enabled', () => {
    const field = property(object({ property: 'mode', in: ['b', 2, true] }), 'field');
    expect(field.enabledWhen).toEqual({ property: 'mode', label: 'Mode', default: 'a', in: ['b', 2, true] });
    expect(isEnabled(field, { mode: 'b' })).toBe(true);
    expect(isEnabled(field, { mode: 'a' })).toBe(false);
    expect(isEnabled(field, { mode: 2 })).toBe(true);
    expect(isEnabled(field, {})).toBe(false); // the default, 'a'

    const noDefault = property(object({ property: 'mode', in: ['b'] }, { mode: { enum: ['a', 'b'] } }), 'field');
    expect(isEnabled(noDefault, {})).toBe(true);
  });

  it('ignores one it cannot use: no such sibling, itself, an empty or a missing "in"; and changes nothing else about the field', () => {
    expect(property(object({ property: 'nothing', in: ['b'] }), 'field').enabledWhen).toBeUndefined();
    expect(property(object({ property: 'field', in: ['b'] }), 'field').enabledWhen).toBeUndefined();
    expect(property(object({ property: 'mode', in: [] }), 'field').enabledWhen).toBeUndefined();
    expect(property(object({ property: 'mode' }), 'field').enabledWhen).toBeUndefined();
    expect(property(object({ property: 'mode', in: ['b'] }), 'field').field.kind).toBe('text');
    expect(property({ type: 'object', properties: { pick: {
      type: 'object', 'x-emc2': { kind: 'layer', enabledWhen: { property: 'mode', in: ['b'] } }, properties: { name: { type: 'string' } },
    }, mode: { enum: ['a', 'b'] } } }, 'pick').field.kind).toBe('layer'); // kind and enabledWhen together
  });
});

describe('an enabledWhen the form cannot use (T-128, owner FH; the ACA\'s final review F2)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('is reported with its place in the schema and why, also in a list\'s items; a usable one is not', () => {
    const told: [string, string][] = [];
    fieldOf({
      type: 'object',
      properties: {
        mode: { enum: ['a', 'b'] },
        good: { type: 'string', 'x-emc2': { enabledWhen: { property: 'mode', in: ['b'] } } },
        typo: { type: 'string', 'x-emc2': { enabledWhen: { property: 'mod', in: ['b'] } } },
        self: { type: 'string', 'x-emc2': { enabledWhen: { property: 'self', in: ['b'] } } },
        empty: { type: 'string', 'x-emc2': { enabledWhen: { property: 'mode', in: [] } } },
        odd: { type: 'string', 'x-emc2': { enabledWhen: 'mode is b' } },
        'a/b': { type: 'string', 'x-emc2': { enabledWhen: { property: 7, in: ['b'] } } },
        links: { type: 'array', items: { type: 'object', properties: {
          direction: { enum: ['in', 'out'] },
          target: { type: 'string', 'x-emc2': { enabledWhen: { property: 'way', in: ['in'] } } },
        } } },
        plain: { type: 'string', 'x-emc2': { kind: 'other' } },
      },
    }, 'Settings', (path, problem) => { told.push([path, problem]); });

    expect(told).toEqual([
      ['/properties/typo/x-emc2/enabledWhen', 'there is no field "mod" beside it'],
      ['/properties/self/x-emc2/enabledWhen', 'it names the field itself'],
      ['/properties/empty/x-emc2/enabledWhen', 'its "in" holds no strings, numbers or booleans'],
      ['/properties/odd/x-emc2/enabledWhen', 'it is not an object'],
      ['/properties/a~1b/x-emc2/enabledWhen', 'its "property" is not a string'],
      ['/properties/links/items/properties/target/x-emc2/enabledWhen', 'there is no field "way" beside it'],
    ]);
  });

  it('is logged as a warning once while the page lives, and the field stays enabled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const schema = { type: 'object', properties: { mode: { enum: ['a', 'b'] }, field: { type: 'string', 'x-emc2': { enabledWhen: { property: 'mod', in: ['b'] } } } } };
    const doFetch = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ schema, values: { mode: 'a' } })));
    const first = render(<PluginSettingsView pluginId="t128-check" services={settingsServices(doFetch)} />);
    expect((await screen.findByRole('textbox', { name: 'Field' })).closest('fieldset.field-when')).toBeNull();
    first.unmount();
    render(<PluginSettingsView pluginId="t128-check" services={settingsServices(doFetch)} />); // shown again
    await screen.findByRole('textbox', { name: 'Field' });

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("[core-shell] t128-check's settings schema: x-emc2.enabledWhen at /properties/field/x-emc2/enabledWhen"
      + ' cannot be used (there is no field "mod" beside it); the field stays enabled');
  });
});

describe('a field enabled by another field\'s value in the form', () => {
  afterEach(cleanup);

  function show(values: JsonObject) {
    const doFetch = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ schema: SCHEMA, values })));
    render(<PluginSettingsView pluginId="cot" services={settingsServices(doFetch)} />);
  }

  it('is greyed and read only, with its value kept and a note, while the condition does not hold, and follows changes at once', async () => {
    show({ mode: 'a', onlyB: 'kept', links: [] });
    const onlyB = await screen.findByRole('textbox', { name: 'Only b' });
    const frame = onlyB.closest('fieldset');
    expect(frame?.disabled).toBe(true);
    expect(frame?.matches('.field-when:disabled')).toBe(true);
    expect(onlyB).toHaveProperty('value', 'kept');
    expect(screen.getByText('Used only when Mode is b.')).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Mode' }), { target: { value: '"b"' } });
    await waitFor(() => { expect(onlyB.closest('fieldset')?.disabled).toBe(false); });
    expect(screen.getByRole('textbox', { name: 'Only b' })).toBe(onlyB); // the same input: a change keeps the editor
    expect(screen.queryByText('Used only when Mode is b.')).toBeNull();
  });

  it('works inside a list\'s items, each item by its own direction (cot\'s links, T-107)', async () => {
    show({ links: [{ name: 'Sender', direction: 'out', target: 'Old', sources: ['A'] }, { name: 'Default' }] });
    // T-203 part D: each link in its side form, chosen in the table
    fireEvent.click(await screen.findByRole('button', { name: 'Item 1' }));
    const sender = within(screen.getByRole('complementary', { name: 'Item 1' }));
    expect(sender.getByRole('textbox', { name: 'Target' }).closest('fieldset')?.disabled).toBe(true);
    expect(sender.getByRole('textbox', { name: 'Target' })).toHaveProperty('value', 'Old');
    expect(sender.getByText('Used only when Direction is in or both.')).toBeTruthy();
    expect(sender.getByRole('group', { name: 'Sources' }).closest('fieldset.field-when')?.hasAttribute('disabled')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Item 2' }));
    const byDefault = within(screen.getByRole('complementary', { name: 'Item 2' })); // no direction: its default, both
    expect(byDefault.getByRole('textbox', { name: 'Target' }).closest('fieldset')?.disabled).toBe(false);
  });
});
