// T-204 (M8; SDK 1.8.0 parts C and D): the manifest's icon and its settings hints, and the panels' "name once,
// icon always" (a panel icon, no inner heading, its buttons at the top of the body) with the panel foot for the
// edit panel's Reshape and Append.
import { cleanup, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Pencil, Shapes } from 'lucide-react';
import { formSections, PLUGIN_ICONS, settingsHintsProblem, pluginIcon, fieldHint, fieldWidth } from '../../../../web/plugin-sdk/src/settings-form.ts';
import type { SettingsSchema } from '../../../../web/plugin-sdk/src/settings-form.ts';
import manifest from '../../plugin.json' with { type: 'json' };
import { buttonOf, editShape, openBrowser, showShapesPanel } from './harness.tsx';
import { FakeServer, layer, shapeObject } from './fakeServer.ts';

afterEach(cleanup);

const schema = manifest.settings as unknown as SettingsSchema;
const properties = (manifest.settings as { properties: Record<string, { description: string; 'x-emc2'?: { hint?: string; unit?: string } }> }).properties;

describe('T-204: the manifest (SDK 1.8.0 part D)', () => {
  it('declares the icon Shapes, which the SDK has, and needs SDK 1.8.0', () => {
    expect(manifest.icon).toBe('Shapes');
    expect(Object.keys(PLUGIN_ICONS)).toContain(manifest.icon);
    expect(pluginIcon(manifest.icon)).toBe(Shapes);
    expect(manifest.sdkVersion).toBe('^1.8.0');
  });

  it("its settings' x-emc2 annotations pass the SDK's check", () => {
    expect(settingsHintsProblem(manifest.settings)).toBeNull();
  });

  it('every description longer than 80 characters has a hint of 1 to 80, and the other descriptions are their own hint', () => {
    for (const [name, property] of Object.entries(properties)) {
      const { hint, more } = fieldHint(property);
      expect(hint, name).not.toBeNull();
      expect(hint?.length ?? 0, name).toBeLessThanOrEqual(80);
      if (property.description.length > 80) {
        expect(property['x-emc2']?.hint, name).toBeDefined();
        expect(more, name).toBe(property.description); // the description is behind the info button
      }
    }
  });

  it('the form is the free dataType, then Outline (colour, width, dash) and Fill (fill, colour, opacity)', () => {
    const sections = formSections(schema);
    expect(sections.map((s) => [s.label, s.properties])).toEqual([
      [null, ['dataType']],
      ['Outline', ['outlineColor', 'outlineWidth', 'outlineDash']],
      ['Fill', ['fill', 'fillColor', 'fillOpacity']],
    ]);
  });

  it('the outline width is in pixels, the colours are short by annotation, and every field is short but the data type', () => {
    expect(properties['outlineWidth']?.['x-emc2']?.unit).toBe('px');
    for (const [name, property] of Object.entries(properties)) {
      if (name === 'dataType') expect(fieldWidth(property as unknown as SettingsSchema)).toBe('full');
      else expect(fieldWidth(property as unknown as SettingsSchema), name).toBe('short');
    }
  });
});

describe('T-204: the panels (SDK 1.8.0 part C)', () => {
  function world() {
    const ops = layer('Operations', 1);
    const server = new FakeServer([ops], ['core.general']);
    const line = server.seed(shapeObject(ops.id, { geometry: { type: 'LineString', coordinates: [[17.5, 59.1], [18.5, 59.6]] }, properties: { name: 'Axis' } }));
    const rect = server.seed(shapeObject(ops.id, { geometry: { type: 'Polygon', coordinates: [[[18.0, 59.3], [18.3, 59.3], [18.3, 59.4], [18.0, 59.4], [18.0, 59.3]]] }, properties: { name: 'Objective' } }));
    return { server, line, rect };
  }

  it('both panels have an icon, and their titles are as before', async () => {
    const { server, line } = world();
    const browser = await openBrowser(server);
    expect(browser.ctx.addedPanels.map((p) => [p.panel.id, p.panel.title, p.panel.icon])).toEqual([['draw-shapes', 'Shapes', Shapes]]);
    // the edit panel exists while a shape is edited
    await editShape(browser, line.id);
    expect(browser.ctx.addedPanels.find((p) => p.panel.id === 'draw-shapes-edit')?.panel).toMatchObject({ title: 'Edit shape', icon: Pencil });
  });

  it('the Shapes panel repeats no heading: no PanelFrame header, no heading at all', async () => {
    const { server } = world();
    const browser = await openBrowser(server);
    const panel = showShapesPanel(browser);
    expect(panel.container.querySelector('.emc2-panel-head')).toBeNull();
    expect(within(panel.container).queryAllByRole('heading')).toEqual([]);
    expect(within(panel.container).getByRole('button', { name: 'Circle' })).toBeTruthy(); // its tools are the body's first thing
  });

  it('the edit panel repeats no heading, and its Close button is the first thing in the body', async () => {
    const { server, line } = world();
    const browser = await openBrowser(server);
    const panel = await editShape(browser, line.id);
    expect(panel.container.querySelector('.emc2-panel-head')).toBeNull();
    expect(within(panel.container).queryAllByRole('heading')).toEqual([]);
    const buttons = within(panel.container).getAllByRole('button');
    expect(buttons[0]?.getAttribute('aria-label') ?? buttons[0]?.textContent).toBe('Close');
  });

  it('Reshape and Append are the panel foot, the last element of the body, for a line', async () => {
    const { server, line } = world();
    const browser = await openBrowser(server);
    const panel = await editShape(browser, line.id);
    const foot = panel.container.querySelector('.emc2-panel-foot');
    expect(foot).not.toBeNull();
    expect(foot?.nextElementSibling).toBeNull();
    expect(foot?.parentElement).toBe(panel.container); // a direct child of the body, so the shell can pin it
    expect(within(foot as HTMLElement).getAllByRole('button').map((b) => b.textContent)).toEqual(['Reshape', 'Append']);
    expect(buttonOf(panel, 'Reshape')).toBeTruthy();
  });

  it('a polygon has the foot with Reshape alone (Append is for a line)', async () => {
    const { server, rect } = world();
    const browser = await openBrowser(server);
    const panel = await editShape(browser, rect.id);
    const foot = panel.container.querySelector('.emc2-panel-foot') as HTMLElement;
    expect(within(foot).getAllByRole('button').map((b) => b.textContent)).toEqual(['Reshape']);
  });
});
