// Brief functions 1, 6 and 13; acceptance criterion 17 (M8, T-190; owner SW A and US): a graphic's data type is not
// chosen at all, so there is no select and no setting. A new graphic is core.general, an existing one keeps its own.
// Criterion 19: "Place graphic" at the top as well.
import { fireEvent, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChangeRequest, DataType } from '@emc2/plugin-sdk';
import manifest from '../../plugin.json' with { type: 'json' };
import { chooseGraphic, clickTool, editGraphic, finishDrawing, inputOf, openBrowser, settle, showGraphicsPanel, toolButtons, typeAndEnter } from './harness.tsx';
import { FakeServer, graphicObject, layer } from './fakeServer.ts';

const type = (id: string, declaredBy: string, name: string, manual?: boolean): Omit<DataType, 'behaviour'> => ({
  id, name, declaredBy, defaults: {}, ...(manual !== undefined ? { manual } : {}),
});
const ROUTE = type('simulator.route', 'simulator', 'Route', false);
const DETECTION = type('gmti.detection', 'gmti', 'GMTI detection', false);
const VESSEL = type('ais.vessel', 'ais', 'AIS vessel');
const TYPES = [ROUTE, DETECTION, VESSEL];
const IDS = ['core.general', 'simulator.route', 'gmti.detection', 'ais.vessel'];
const LINE = { type: 'LineString', coordinates: [[16.5, 58.6], [17.1, 58.9], [18.07, 59.33]] } as const;

type Create = Extract<ChangeRequest, { readonly operation: 'create' }>;
type Update = Extract<ChangeRequest, { readonly operation: 'update' }>;
const created = (server: FakeServer): Create[] => server.requests.filter((r): r is Create => r.operation === 'create');
/** `dataType` is a setting of M8's first build; a value left in the store is ignored. */
const settings = (dataType?: string) => ({ standard: 'APP-6D', standardIdentity: 'Friend', ...(dataType !== undefined ? { dataType } : {}) });

async function place(server: FakeServer, dataType?: string): Promise<void> {
  const browser = await openBrowser(server, { dataTypes: TYPES, settings: settings(dataType) });
  await showGraphicsPanel(browser);
  await chooseGraphic('Phase Line');
  await clickTool();
  await finishDrawing(browser, LINE);
}

describe('criterion 17: no data type select', () => {
  it('the Graphics panel shows no data type', async () => {
    const server = new FakeServer([layer('Operations', 1)], IDS);
    const browser = await openBrowser(server, { dataTypes: TYPES });
    const panel = await showGraphicsPanel(browser);
    expect(within(panel.container).queryByLabelText('Data type')).toBeNull();
    expect(within(panel.container).queryByText('Data type')).toBeNull();
  });

  it('the plugin has no data type setting', () => {
    expect(Object.keys(manifest.settings.properties)).toEqual(['standard', 'standardIdentity']);
  });

  it.each([undefined, 'ais.vessel', 'gmti.detection', 'nothing.here'])('a new graphic is core.general, whatever dataType setting an earlier build left (%s)', async (leftover) => {
    const server = new FakeServer([layer('Operations', 1)], IDS);
    await place(server, leftover);
    expect(created(server)).toHaveLength(1);
    expect(created(server)[0]?.data.dataType).toBe('core.general');
    expect(created(server)[0]?.data.dataSource).toBe('manual');
  });

  it('the browser keeps no data type choice of an older version: a value in localStorage is ignored', async () => {
    window.localStorage.setItem('draw-tactical.dataType', 'ais.vessel');
    try {
      const server = new FakeServer([layer('Operations', 1)], IDS);
      await place(server);
      expect(created(server)[0]?.data.dataType).toBe('core.general');
    } finally {
      window.localStorage.removeItem('draw-tactical.dataType');
    }
  });

  it.each(['gmti.detection', 'ais.vessel'])('the Edit panel shows no data type; a rename of a stored %s graphic sends it unchanged', async (stored) => {
    const ops = layer('Operations', 1);
    const server = new FakeServer([ops], IDS);
    const shown = server.seed(graphicObject(ops.id, { dataType: stored, properties: { name: 'Seen' } }));
    const browser = await openBrowser(server, { dataTypes: TYPES });
    const panel = await editGraphic(browser, shown.id);
    expect(within(panel.container).queryByLabelText('Data type')).toBeNull();
    await typeAndEnter(inputOf(panel, 'Name'), 'Renamed');
    const after = server.objects.get(shown.id);
    expect(after?.properties?.name).toBe('Renamed');
    expect(after?.dataType).toBe(stored);
    const update = server.requests.find((r): r is Update => r.operation === 'update');
    expect((update?.data as { readonly dataType?: string } | undefined)?.dataType).toBe(stored);
  });
});

describe('criterion 19: "Place graphic" at the top as well', () => {
  it('has the button at the top and at the bottom of the panel, with the same label', async () => {
    const server = new FakeServer([layer('Operations', 1)], IDS);
    const browser = await openBrowser(server, { dataTypes: TYPES });
    const panel = await showGraphicsPanel(browser);
    const buttons = toolButtons();
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => b.textContent)).toEqual(['Place graphic', 'Place graphic']);
    // The top one is above the search field and the tiles; the bottom one is in the panel's foot, after them.
    const all = [...panel.container.querySelectorAll('button, input')];
    const search = within(panel.container).getByLabelText('Find a graphic');
    const tile = within(panel.container).getByRole('option', { name: 'Boundary' });
    expect(all.indexOf(buttons[0] as HTMLButtonElement)).toBeLessThan(all.indexOf(search));
    expect(all.indexOf(buttons[1] as HTMLButtonElement)).toBeGreaterThan(all.indexOf(tile));
    expect(buttons[1]?.closest('.emc2-panel-foot')).not.toBeNull();
    expect(buttons[0]?.closest('.emc2-panel-foot')).toBeNull();
  });

  it.each([0, 1])('pressing the button at index %i (0 the top, 1 the bottom) starts the tool and both then read "Stop placing"', async (which) => {
    const server = new FakeServer([layer('Operations', 1)], IDS);
    const browser = await openBrowser(server, { dataTypes: TYPES });
    await showGraphicsPanel(browser);
    await chooseGraphic('Phase Line');
    expect(toolButtons().map((b) => b.disabled)).toEqual([false, false]);
    fireEvent.click(toolButtons()[which] as HTMLButtonElement);
    await settle();
    expect(browser.map.runningInteraction).toBe('draw:line');
    expect(toolButtons().map((b) => b.textContent)).toEqual(['Stop placing', 'Stop placing']);
    fireEvent.click(toolButtons()[which] as HTMLButtonElement);
    await settle();
    expect(browser.map.runningInteraction).toBeNull();
    expect(toolButtons().map((b) => b.textContent)).toEqual(['Place graphic', 'Place graphic']);
  });

  it('without an active layer both are disabled, with the same hint', async () => {
    const server = new FakeServer([layer('Operations', 1)], IDS);
    const browser = await openBrowser(server, { dataTypes: TYPES, activeLayer: null });
    await showGraphicsPanel(browser);
    await chooseGraphic('Phase Line');
    const buttons = toolButtons();
    expect(buttons.map((b) => b.disabled)).toEqual([true, true]);
    expect(buttons[0]?.title).toBe('Select or create a layer in the layer panel');
    expect(buttons[1]?.title).toBe(buttons[0]?.title);
  });
});
