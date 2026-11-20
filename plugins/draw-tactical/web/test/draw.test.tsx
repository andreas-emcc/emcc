// Brief functions 1 to 4; acceptance criteria 1 to 6 and 14: the Graphics panel and placing.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChangeRequest, Geometry } from '@emc2/plugin-sdk';
import { createFakeSymbolService } from '@emc2/plugin-sdk/testing';
import { DEFAULT_LABEL, chooseGraphic, clickTool, finishDrawing, inputOf, openBrowser, selectOf, settle, showGraphicsPanel, toolButton } from './harness.tsx';
import { AXIS_SIDC, BOUNDARY_SIDC, FAN_SIDC, FakeServer, PHASE_LINE_SIDC, layer } from './fakeServer.ts';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The longitude and the latitude of every point differ: a swapped pair cannot pass (criteria 2 and 3). */
const LINE: Geometry = { type: 'LineString', coordinates: [[16.5, 58.6], [17.1, 58.9], [18.07, 59.33]] };

function setup(options: Parameters<typeof openBrowser>[1] = {}) {
  const ops = layer('Operations', 1);
  const server = new FakeServer([ops], ['core.general']);
  return { server, ops, browser: openBrowser(server, options) };
}

type Create = Extract<ChangeRequest, { readonly operation: 'create' }>;

function created(server: FakeServer): Create[] {
  return server.requests.filter((r): r is Create => r.operation === 'create');
}

describe('criterion 1: the short list, all graphics and the points', () => {
  it('shows the short list as tiles in groups, with the graphics the catalogue has', async () => {
    const { browser: pending } = setup();
    const browser = await pending;
    await showGraphicsPanel(browser);
    // The groups fold under their headings (the TileGrid's buttons); "Areas" is not shown, since the fake catalogue has none of its graphics.
    expect(screen.getByRole('button', { name: 'Boundaries and lines' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Axes and tasks' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fires and obstacles' })).toBeTruthy();
    // The fake catalogue has four graphics; a short-list entry it lacks is not shown, and no group is empty.
    expect(graphicNames()).toEqual(['Boundary', 'Phase Line', 'Main Attack', 'Weapon/Sensor Range fan, Sector']);
    expect(screen.queryByRole('button', { name: 'Areas' })).toBeNull();
  });

  it('"All graphics" folds open to the catalogue as tiles by folder, and a search for "phase" finds the phase line', async () => {
    const { browser: pending } = setup();
    const browser = await pending;
    await showGraphicsPanel(browser);
    const all = screen.getByRole('button', { name: 'All graphics (4)' });
    expect(all.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Command and Control Lines (1)' })).toBeNull(); // folded: no folder groups yet
    fireEvent.click(all);
    // The root "Control Measure" is one pointless level; the next level is the folders, each with its count.
    expect(screen.getByRole('button', { name: 'Command and Control Lines (1)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Maneuver Areas (1)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Maneuver Lines (1)' })).toBeTruthy();
    // SDK 1.8.0 part G: the folders start closed, so opening "All graphics" adds no tiles until a folder is opened.
    expect(screen.getByRole('button', { name: 'Maneuver Lines (1)' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByRole('option', { name: 'Phase Line' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Maneuver Lines (1)' }));
    expect(screen.getAllByRole('option', { name: 'Phase Line' })).toHaveLength(2);

    fireEvent.change(screen.getByLabelText('Find a graphic'), { target: { value: 'phase' } });
    await settle();
    // A search opens "All graphics" by itself and shows only the matches, in the short list and in the folders.
    expect(screen.getByRole('button', { name: 'All graphics (1)' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('option', { name: 'Boundary' })).toBeNull();
    const phase = screen.getAllByRole('option', { name: 'Phase Line' });
    expect(phase).toHaveLength(2); // its short-list tile and its folder's tile

    fireEvent.click(phase[1] as HTMLElement);
    await settle();
    expect(screen.getByRole('heading', { name: 'Phase Line' })).toBeTruthy();
    // Only the tile that was clicked shows as chosen, though the graphic is in two groups.
    expect(screen.getAllByRole('option', { name: 'Phase Line' }).map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'true']);
  });

  it('choosing a graphic shows its points texts in order, and its point counts', async () => {
    const { browser: pending } = setup();
    const browser = await pending;
    await showGraphicsPanel(browser);
    await chooseGraphic('Main Attack');
    expect(screen.getByText('3 to 50 points, in this order:')).toBeTruthy();
    expect(screen.getByText('1: the tip of the arrow')).toBeTruthy();
    expect(screen.getByText('2 to n−1: the axis, from the tip back to the tail')).toBeTruthy();
    expect(screen.getByText('n: the width of the arrowhead')).toBeTruthy();
    await chooseGraphic('Weapon/Sensor Range fan, Sector');
    expect(screen.getByText('exactly 1 point, in this order:')).toBeTruthy();
    expect(screen.getByText('1: the weapon or sensor')).toBeTruthy();
  });
});

describe('criterion 2: placing a line', () => {
  it('calls draw("line") with the composed SIDC and sends one schema-valid create request for the points in order', async () => {
    const { server, ops, browser: pending } = setup();
    const browser = await pending;
    const panel = await showGraphicsPanel(browser);
    await chooseGraphic('Boundary');
    fireEvent.change(selectOf(panel, 'Echelon'), { target: { value: '16' } }); // Battalion in the fake catalogue
    fireEvent.change(inputOf(panel, 'T Unique designation 1'), { target: { value: '1st Brigade' } });
    fireEvent.change(inputOf(panel, 'T1 Unique designation 2'), { target: { value: '2nd Brigade' } });
    fireEvent.change(inputOf(panel, 'Name'), { target: { value: 'Brigade boundary' } });
    await clickTool();

    expect(browser.map.runningInteraction).toBe('draw:line');
    expect(browser.map.drawCalls).toHaveLength(1);
    expect(browser.map.drawCalls[0]?.graphic).toEqual({
      standard: 'APP-6D',
      sidc: BOUNDARY_SIDC,
      modifiers: { uniqueDesignation: '1st Brigade', uniqueDesignation1: '2nd Brigade' },
    });

    await finishDrawing(browser, LINE);

    // The fake store double checks every request against change-request.schema.json (data model 1.4.0).
    expect(created(server)).toHaveLength(1);
    const request = created(server)[0];
    expect(request).toMatchObject({
      entityType: 'object',
      operation: 'create',
      data: {
        type: 'core.multipoint',
        dataType: 'core.general',
        dataSource: 'manual',
        layerId: ops.id,
        label: DEFAULT_LABEL,
        geometry: { type: 'LineString', coordinates: [[16.5, 58.6], [17.1, 58.9], [18.07, 59.33]] },
        symbol: { standard: 'APP-6D', sidc: BOUNDARY_SIDC, modifiers: { uniqueDesignation: '1st Brigade', uniqueDesignation1: '2nd Brigade' } },
        properties: { name: 'Brigade boundary' },
      },
    });
    expect(request?.entityId).toMatch(UUID_V7);
    // This plugin writes no extension of its own.
    expect((request?.data as { extensions?: unknown } | undefined)?.extensions).toBeUndefined();
    // A planned graphic is the same code with status 1 (dashed by the renderer): see the next test.
    expect(server.objects.get(request?.entityId ?? '')?.version).toBe(1);
  });

  it('puts the identity and the status into the SIDC (hostile, planned)', async () => {
    const { browser: pending } = setup();
    const browser = await pending;
    const panel = await showGraphicsPanel(browser);
    await chooseGraphic('Phase Line');
    fireEvent.change(selectOf(panel, 'Identity'), { target: { value: '6' } });
    fireEvent.change(selectOf(panel, 'Status'), { target: { value: '1' } });
    await clickTool();
    // identity 6 at position 4, status 1 at position 7: 10 0 6 25 1 0 00 140300 0000
    expect(browser.map.drawCalls[0]?.graphic?.sidc).toBe('10062510001403000000');
    expect(PHASE_LINE_SIDC).toBe('10032500001403000000'); // the friend, present phase line it differs from
  });

  it('starts with the standard identity of the setting, and the second browser shows the graphic', async () => {
    const ops = layer('Operations', 1);
    const server = new FakeServer([ops], ['core.general']);
    const first = await openBrowser(server, { settings: { standard: 'APP-6D', standardIdentity: 'Hostile' } });
    const second = await openBrowser(server);
    // A second browser's map view holds the whole picture.
    const seen: string[] = [];
    second.ctx.livePicture.subscribe(
      { snapshot: (snapshot) => seen.push(...snapshot.objects.map((o) => o.id)), changes: (batch) => seen.push(...batch.map((e) => e.entityId)) },
      {},
    );
    const panel = await showGraphicsPanel(first);
    expect(selectOf(panel, 'Identity').value).toBe('6');
    await chooseGraphic('Phase Line');
    await clickTool();
    await finishDrawing(first, LINE);
    expect(created(server)).toHaveLength(1);
    const id = created(server)[0]?.entityId ?? '';
    expect(seen).toContain(id);
  });

  it('keeps the tool on for the next graphic; the name is cleared, the text amplifiers too', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    const panel = await showGraphicsPanel(browser);
    await chooseGraphic('Boundary');
    fireEvent.change(inputOf(panel, 'Name'), { target: { value: 'First' } });
    fireEvent.change(inputOf(panel, 'T Unique designation 1'), { target: { value: 'A' } });
    await clickTool();
    await finishDrawing(browser, LINE);
    expect(browser.map.runningInteraction).toBe('draw:line');
    expect(toolButton().textContent).toBe('Stop placing');
    expect(inputOf(panel, 'Name').value).toBe('');
    expect(inputOf(panel, 'T Unique designation 1').value).toBe('');
    await finishDrawing(browser, { type: 'LineString', coordinates: [[19.5, 60.2], [20.5, 60.9]] });
    expect(created(server)).toHaveLength(2);
    expect(created(server)[1]?.data).not.toHaveProperty('properties');
  });
});

describe('criterion 3: an arrow', () => {
  it('stores the four points in the clicked order', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    await showGraphicsPanel(browser);
    await chooseGraphic('Main Attack');
    await clickTool();
    expect(browser.map.runningInteraction).toBe('draw:line');
    expect(browser.map.drawCalls[0]?.graphic?.sidc).toBe(AXIS_SIDC);
    const points: [number, number][] = [[18.07, 59.33], [17.4, 58.95], [16.8, 58.7], [18.5, 58.8]];
    await finishDrawing(browser, { type: 'LineString', coordinates: points });
    expect(created(server)).toHaveLength(1);
    expect(created(server)[0]?.data).toMatchObject({ geometry: { type: 'LineString', coordinates: points } });
  });

  it('sends nothing for a drawing with two points', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    await showGraphicsPanel(browser);
    await chooseGraphic('Main Attack');
    await clickTool();
    await finishDrawing(browser, { type: 'LineString', coordinates: [[18.07, 59.33], [17.4, 58.95]] });
    expect(created(server)).toHaveLength(0);
    expect(browser.ctx.notifications.some((n) => /takes 3 to 50 points, not 2/.test(n.message))).toBe(true);
    // The tool stays on for the next try.
    expect(browser.map.runningInteraction).toBe('draw:line');
  });
});

describe('criteria 4 and 5: a range fan and the amplifiers', () => {
  it('disables the tool until the distances and azimuths are filled; one click stores a MultiPoint with numbers', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    const panel = await showGraphicsPanel(browser);
    await chooseGraphic('Weapon/Sensor Range fan, Sector');
    expect(toolButton().disabled).toBe(true);
    expect(toolButton().title).toMatch(/distances/);
    expect(screen.getAllByText(/\(required\)/).length).toBeGreaterThanOrEqual(2);

    fireEvent.change(inputOf(panel, 'AM Distances (metres) (required) 1'), { target: { value: '5000' } });
    expect(toolButton().disabled).toBe(true); // the azimuths are still missing
    fireEvent.change(inputOf(panel, 'AN Azimuths (degrees) (required) 1'), { target: { value: '30' } });
    fireEvent.click(buttonNamed('Add value to AN Azimuths (degrees) (required)'));
    fireEvent.change(inputOf(panel, 'AN Azimuths (degrees) (required) 2'), { target: { value: '120.5' } });
    expect(toolButton().disabled).toBe(false);
    await clickTool();

    expect(browser.map.runningInteraction).toBe('pickPoint');
    expect(browser.map.drawCalls).toHaveLength(0);
    act(() => {
      browser.map.completeInteraction([18.0686, 59.3293]);
    });
    await settle();

    expect(created(server)).toHaveLength(1);
    expect(created(server)[0]?.data).toMatchObject({
      type: 'core.multipoint',
      geometry: { type: 'MultiPoint', coordinates: [[18.0686, 59.3293]] },
      symbol: { standard: 'APP-6D', sidc: FAN_SIDC, modifiers: { distances: [5000], azimuths: [30, 120.5] } },
    });
    // The numbers stay for the next fan, and the tool waits for its next point.
    expect(browser.map.runningInteraction).toBe('pickPoint');
    expect(inputOf(panel, 'AM Distances (metres) (required) 1').value).toBe('5000');
  });

  it('shows a field for each allowed amplifier, with the APP-6 letter and name', async () => {
    const { browser: pending } = setup();
    const browser = await pending;
    const panel = await showGraphicsPanel(browser);
    await chooseGraphic('Boundary');
    for (const label of ['T Unique designation 1', 'T1 Unique designation 2', 'AS Country']) expect(inputOf(panel, label)).toBeTruthy();
    expect(within(panel.container).queryByLabelText('W Date-time group 1')).toBeNull();
    await chooseGraphic('Main Attack');
    for (const label of ['T Unique designation 1', 'W Date-time group 1', 'W1 Date-time group 2']) expect(inputOf(panel, label)).toBeTruthy();
    expect(within(panel.container).queryByLabelText('AS Country')).toBeNull();
  });

  it('cannot start the tool with a distance of -1 or an azimuth of 400', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    const panel = await showGraphicsPanel(browser);
    await chooseGraphic('Weapon/Sensor Range fan, Sector');
    fireEvent.change(inputOf(panel, 'AM Distances (metres) (required) 1'), { target: { value: '-1' } });
    fireEvent.change(inputOf(panel, 'AN Azimuths (degrees) (required) 1'), { target: { value: '400' } });
    expect(toolButton().disabled).toBe(true);
    expect(within(panel.container).getByText(/Each value must be from 0 to 20 000 000 metres/)).toBeTruthy();
    expect(within(panel.container).getByText(/Each value must be from 0 to 360 degrees/)).toBeTruthy();
    fireEvent.change(inputOf(panel, 'AM Distances (metres) (required) 1'), { target: { value: '1000' } });
    fireEvent.change(inputOf(panel, 'AN Azimuths (degrees) (required) 1'), { target: { value: '360' } }); // 360 is allowed
    expect(toolButton().disabled).toBe(false);
    expect(created(server)).toHaveLength(0);
  });
});

describe('criterion 6: cancel', () => {
  it('Escape while placing a line sends nothing and switches the tool off', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    await showGraphicsPanel(browser);
    await chooseGraphic('Phase Line');
    await clickTool();
    expect(browser.map.runningInteraction).toBe('draw:line');
    await finishDrawing(browser, null); // Escape
    expect(created(server)).toHaveLength(0);
    expect(browser.map.runningInteraction).toBeNull();
    expect(toolButton().textContent).toBe('Place graphic');
  });

  it('a pick that ends with null (Escape, a right click) sends nothing and switches the tool off', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    const panel = await showGraphicsPanel(browser);
    await chooseGraphic('Weapon/Sensor Range fan, Sector');
    fireEvent.change(inputOf(panel, 'AM Distances (metres) (required) 1'), { target: { value: '1000' } });
    fireEvent.change(inputOf(panel, 'AN Azimuths (degrees) (required) 1'), { target: { value: '30' } });
    await clickTool();
    act(() => {
      browser.map.rightClick();
    });
    await settle();
    expect(created(server)).toHaveLength(0);
    expect(browser.map.runningInteraction).toBeNull();
    expect(toolButton().textContent).toBe('Place graphic');
  });

  it('choosing another graphic while the tool is on starts the placing again for it, and sends nothing', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    await showGraphicsPanel(browser);
    await chooseGraphic('Phase Line');
    await clickTool();
    await chooseGraphic('Main Attack');
    expect(browser.map.drawCalls).toHaveLength(2);
    expect(browser.map.drawCalls[1]?.graphic?.sidc).toBe(AXIS_SIDC);
    expect(created(server)).toHaveLength(0);
  });
});

// Criterion 14 (a symbology service without graphicCatalog) is retired: the member is required since the 1.4.0 freeze.
describe('the catalogue that cannot be read', () => {
  it('a catalogue that cannot be read: the error and a Retry', async () => {
    let calls = 0;
    const symbols = {
      ...createFakeSymbolService(),
      graphicCatalog: async () => {
        calls++;
        if (calls === 1) throw new Error('the renderer did not load');
        return createFakeSymbolService().graphicCatalog('APP-6D');
      },
    };
    const { browser: pending } = setup({ symbols });
    const browser = await pending;
    await showGraphicsPanel(browser);
    expect(screen.getByText('The graphics could not be read: the renderer did not load')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await settle();
    expect(graphicNames()).toHaveLength(4);
    expect(browser.ctx.logs.some((l) => l.level === 'warn')).toBe(true);
  });
});

/** The graphics of the short list's rows: the options of the lists, not of the selects. */
function graphicNames(): (string | null)[] {
  return screen.getAllByRole('listbox').flatMap((list) => within(list).getAllByRole('option').map((o) => o.textContent));
}

function buttonNamed(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}
