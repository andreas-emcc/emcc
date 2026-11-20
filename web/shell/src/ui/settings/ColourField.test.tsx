import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsServices } from '../../testing/fakes.ts';
import { PluginSettingsView } from './PluginSettingsView.tsx';
import { fieldOf, type JsonObject } from './schema.ts';

const COLOUR = { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$', 'x-emc2': { kind: 'colour' } };
/** Like `model/examples/valid/manifest-category-and-colour.json`: a colour, one that depends on a switch, and a plain text. */
const SCHEMA = {
  type: 'object',
  properties: {
    lineColour: { ...COLOUR, default: '#1F6F8B' },
    fade: { type: 'boolean', default: false },
    fadeColour: { ...COLOUR, 'x-emc2': { kind: 'colour', enabledWhen: { property: 'fade', in: [true] } } },
    note: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
  },
};

afterEach(cleanup);

describe('a colour setting (SDK 1.6.0, CR-0041 part F)', () => {
  it('is a text field marked as a colour in the form model, and a string without the mark is not', () => {
    const field = fieldOf(SCHEMA, 'Settings');
    const kinds = field.kind === 'object' ? field.properties.map((p) => [p.name, p.field.kind, 'colour' in p.field]) : [];
    expect(kinds).toEqual([['lineColour', 'text', true], ['fade', 'boolean', false], ['fadeColour', 'text', true], ['note', 'text', false]]);
  });

  function show(values: JsonObject) {
    const doFetch = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ schema: SCHEMA, values })));
    render(<PluginSettingsView pluginId="gmti" services={settingsServices(doFetch)} />);
  }

  it('shows the browser\'s colour picker beside its hex, both editing the same value; off with its field', async () => {
    show({ lineColour: '#1f6f8b', fade: false, note: '#000000' });
    const hex = await screen.findByRole('textbox', { name: 'Line colour' });
    const picker = screen.getByLabelText<HTMLInputElement>('Line colour: pick a colour');
    expect(picker.type).toBe('color');
    expect(picker.value).toBe('#1f6f8b');

    fireEvent.input(picker, { target: { value: '#ff8800' } });
    await waitFor(() => { expect(hex).toHaveProperty('value', '#FF8800'); });
    fireEvent.change(hex, { target: { value: '#00aa00' } });
    await waitFor(() => { expect(picker.value).toBe('#00aa00'); });

    fireEvent.change(hex, { target: { value: 'teal' } }); // the picker cannot show it: the text stays, the pattern reports it
    await waitFor(() => { expect(picker.value).toBe('#000000'); });
    expect(hex).toHaveProperty('value', 'teal');

    const fadePicker = screen.getByLabelText<HTMLInputElement>('Fade colour: pick a colour');
    expect(fadePicker.closest('fieldset')?.disabled).toBe(true); // with its hex, while Fade is off
    expect(screen.queryByLabelText('Note: pick a colour')).toBeNull(); // no mark: a text field only
  });
});
