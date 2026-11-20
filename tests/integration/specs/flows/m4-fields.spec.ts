// Quick run: @plugin-draw-symbols @plugin-simulator @plugin-cot @plugin-ais @plugin-gmti @plugin-layer-panel @settings
import { expect, test, type Locator } from '@playwright/test';
import { setLinks } from '../../lib/cot';
import { addable, addSet, applied, chosen, fieldSets, properties, select, symbolAt, symbolsPanel, updatesOf, watchRequests, type Request, type State } from '../../lib/fields';
import { createLayer, createSymbol, LiveClient, seededLayer } from '../../lib/live.mjs';
import { bottomPanel, mapCentre, userPause, withM0 } from '../../lib/m0';

// The last M4 flows (T-109), as SDK 1.5.0 part 1 leaves them (ADR-0054 point 5, CR-0038, which
// replaces ADR-0050 point 5's groups): the field sets in draw-symbols' edit and create (its
// functions 27, 29 and 30, criteria 44 to 47 and 49) and the simulator's event panel (its criterion
// 51, which replaces 34), and cot's greyed link fields in the settings form (cot criterion 31, via
// x-emc2.enabledWhen; T-107, T-098). DeclaredFields shows one set at a time: a drop-down "Field set"
// of the sets the object carries (then "(not added)" ones with values, read only), and a "+" ("Add
// a field set") whose menu offers the declared sets it lacks. The assembled plugins declare their
// fields for no data type, each in its own set: cot's cot.unit, "CoT unit" (Callsign, Team, Role,
// Stale time, How, Circular error, Linear error; cot functions 23 to 25, owner LU and LV,
// 2026-11-08), ais' "AIS ship", gmti's "GMTI report" (and, from M6, adsb's "ADS-B aircraft"); the
// tests use cot's, on symbols of core.general, whose data type names no set. A data type's own sets
// are m6-field-sets'. Each test has a server of its own; change requests are read from the page's
// live picture socket.

test.describe.configure({ timeout: 180_000 });

const SIMULATION = 'simulator.simulation';

/** Sets the assembled plugins declare (adsb's comes with M6; checked as "at least these"). */
const DECLARED_SETS = ['AIS ship', 'CoT unit', 'GMTI report'];

/** cot.unit's group in a panel, while it is the set chosen. */
function unitGroup(panel: Locator): Locator {
  return panel.getByRole('group', { name: 'CoT unit', exact: true });
}

/** A field's combobox or text box by its label, from the shared components (their selects' values are indexes). */
function field(group: Locator, label: string | RegExp): Locator {
  return group.getByRole(label === 'Team' || label === 'Role' ? 'combobox' : 'textbox', { name: label, ...(typeof label === 'string' ? { exact: true } : {}) });
}

/** cot.unit's fields, as its manifest declares them, with the labels the shared editor gives them (the unit in brackets). */
const COT_UNIT = [
  ['callsign', 'textbox', 'Callsign'],
  ['team', 'combobox', 'Team'],
  ['role', 'combobox', 'Role'],
  ['staleSeconds', 'textbox', 'Stale time (s)'],
  ['how', 'textbox', 'How'],
  ['ce', 'textbox', 'Circular error (m)'],
  ['le', 'textbox', 'Linear error (m)'],
] as const;

test('draw-symbols, edit (criteria 44, 45, 47 and 49 with the real cot; one set at a time, ADR-0054 point 5): a symbol without sets has no drop-down, and its "+" offers cot.unit; one update adds the set, chosen in the drop-down, and the "+" no longer offers it; the set\'s fields send only the field changed, emptied sends null, typed and emptied sends nothing; a value of a set not carried is read only, "(not added)"; a rename forwards the sets; in a locked layer no "+", the drop-down still there and read only', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const layer = seededLayer(snapshot);
    let sent: Request[] = [];
    const page = await open((p) => {
      sent = watchRequests(p);
    });
    const centre = await mapCentre(page);
    const plainAt = { x: centre.x - 120, y: centre.y - 60 };
    const teamAt = { x: centre.x + 60, y: centre.y - 60 };
    const plain = await symbolAt(page, live, layer, plainAt, 'friend');
    const team = await symbolAt(page, live, layer, teamAt, 'hostile', { team: 'Cyan' });

    // A symbol without sets and without values: no drop-down and no group, the "+" alone, offering every declared set (criterion 44).
    await select(page, plainAt);
    let panel = properties(page);
    await expect(fieldSets(panel).list, 'no set: no drop-down').toHaveCount(0);
    await expect(fieldSets(panel).group, 'no set: no group').toHaveCount(0);
    expect(await addable(panel), 'every declared set').toEqual(expect.arrayContaining(DECLARED_SETS));

    // A value of a set the symbol does not carry is shown, read only ("CoT unit (not added)").
    await select(page, teamAt);
    panel = properties(page);
    await expect(chosen(fieldSets(panel).list)).toHaveText('CoT unit (not added)');
    await expect(unitGroup(panel)).toHaveAttribute('data-carried', 'false');
    await expect(chosen(field(unitGroup(panel), 'Team'))).toHaveText('Cyan');
    await expect(field(unitGroup(panel), 'Team'), 'read only').toBeDisabled();
    await expect(field(unitGroup(panel), 'Callsign'), 'only the fields with a value').toHaveCount(0);
    expect(await addable(panel), 'the set can be added').toContain('CoT unit');

    // A rename of that symbol names no fields and adds no set; cot's value stays (forwarded untouched, ADR-0007).
    let from = sent.length;
    const name = panel.getByLabel('Name', { exact: true });
    await name.fill('Renamed');
    await name.press('Enter');
    let [update] = await updatesOf(sent, from, team);
    expect(update.fields ?? [], 'no fields named').toEqual([]);
    expect(update.data?.fieldSets ?? [], 'no set added').toEqual([]);
    await expect.poll(async () => (await live.getObjects([team])).found[0].properties?.name).toBe('Renamed');
    expect((await live.getObjects([team])).found[0].extensions?.cot?.team, 'cot\'s value stays').toBe('Cyan');

    // The "+": one update listing the set and naming no field; the set chosen in the drop-down with its fields settable, and no longer offered.
    await select(page, plainAt);
    panel = properties(page);
    from = sent.length;
    await addSet(panel, 'CoT unit');
    [update] = await updatesOf(sent, from, plain);
    expect(update.operation).toBe('update');
    expect(update.data?.fieldSets, 'the set listed').toEqual(['cot.unit']);
    expect(update.fields ?? [], 'no field named').toEqual([]);
    expect(update.data?.symbol, 'the complete core content').toBeDefined();
    await expect.poll(async () => (await live.getObjects([plain])).found[0].fieldSets ?? []).toEqual(['cot.unit']);
    await expect(chosen(fieldSets(panel).list), 'the set added is chosen').toHaveText('CoT unit');
    const unit = unitGroup(panel);
    await expect(unit).toHaveAttribute('data-carried', 'true');
    expect(await unit.locator('[data-field]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-field')))).toEqual(COT_UNIT.map(([n]) => `cot.${n}`));
    for (const [, role, label] of COT_UNIT) await expect(unit.getByRole(role, { name: label, exact: true }), `${label} settable`).toBeEnabled();
    expect(await addable(panel), 'not offered once carried').not.toContain('CoT unit');

    // Callsign typed: only cot.callsign (criterion 45); Team chosen: only cot.team; Callsign emptied: null.
    await userPause(page);
    from = sent.length;
    const callsign = field(unit, 'Callsign');
    await callsign.fill('VIPER 2');
    await callsign.press('Enter');
    [update] = await updatesOf(sent, from, plain);
    expect(update.fields, 'only cot.callsign').toEqual([{ plugin: 'cot', name: 'callsign', value: 'VIPER 2' }]);
    expect(update.data?.fieldSets, 'the set forwarded').toEqual(['cot.unit']);
    await expect.poll(async () => (await live.getObjects([plain])).found[0].extensions?.cot?.callsign).toBe('VIPER 2');
    await userPause(page);
    from = sent.length;
    await field(unit, 'Team').selectOption({ label: 'Red' });
    [update] = await updatesOf(sent, from, plain);
    expect(update.fields, 'only cot.team').toEqual([{ plugin: 'cot', name: 'team', value: 'Red' }]);
    await expect.poll(async () => (await live.getObjects([plain])).found[0].extensions?.cot?.team).toBe('Red');
    await userPause(page);
    from = sent.length;
    await callsign.fill('');
    await callsign.press('Enter');
    [update] = await updatesOf(sent, from, plain);
    expect(update.fields, 'emptied: null').toEqual([{ plugin: 'cot', name: 'callsign', value: null }]);
    await expect.poll(async () => (await live.getObjects([plain])).found[0].extensions?.cot?.callsign ?? null).toBeNull();
    // Typed and emptied on a field without a value: nothing.
    await userPause(page);
    from = sent.length;
    const stale = field(unit, /^Stale time/);
    await stale.fill('45');
    await stale.fill('');
    await stale.press('Enter');
    await page.waitForTimeout(1_500); // nothing may be sent: a fixed wait, the absence is the check
    expect(sent.slice(from).filter((r) => r.entityId === plain), 'typed and emptied: nothing sent').toEqual([]);

    // A rename forwards the set and names no field (criterion 49's forwarding, with sets).
    from = sent.length;
    await properties(page).getByLabel('Name', { exact: true }).fill('With a set');
    await properties(page).getByLabel('Name', { exact: true }).press('Enter');
    [update] = await updatesOf(sent, from, plain);
    expect(update.fields ?? [], 'no fields named').toEqual([]);
    expect(update.data?.fieldSets, 'the set forwarded').toEqual(['cot.unit']);
    await expect.poll(async () => (await live.getObjects([plain])).found[0].properties?.name).toBe('With a set');
    const stored = (await live.getObjects([plain])).found[0];
    expect(stored.fieldSets, 'the set stays').toEqual(['cot.unit']);
    expect(stored.extensions?.cot?.team, 'Team stays').toBe('Red');

    // Read only (criterion 47; draw-symbols criterion 53): the layer locked in the layer list.
    const lock = (await bottomPanel(page, 'Layers')).getByRole('button', { name: 'Lock Drawing', exact: true });
    await lock.click();
    await expect((await bottomPanel(page, 'Layers')).getByRole('button', { name: 'Unlock Drawing', exact: true })).toBeVisible();
    await select(page, plainAt);
    panel = properties(page);
    await expect(panel).toContainText('Layer "Drawing" is locked');
    await expect(fieldSets(panel).plus, 'no "+"').toHaveCount(0);
    await expect(chosen(fieldSets(panel).list), 'the drop-down still chooses the set to see').toHaveText('CoT unit');
    await expect(chosen(field(unitGroup(panel), 'Team'))).toHaveText('Red');
    for (const [, role, label] of COT_UNIT) await expect(unitGroup(panel).getByRole(role, { name: label, exact: true }), `${label} read only`).toBeDisabled();
  });
});

test('draw-symbols, create (criterion 46 with the real cot; one set at a time): the Symbols panel\'s "+" adds cot.unit, chosen in the drop-down and no longer offered; with a Callsign set there, every symbol placed lists the set and names only cot.callsign', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, open }) => {
    let sent: Request[] = [];
    const page = await open((p) => {
      sent = watchRequests(p);
    });
    const symbols = symbolsPanel(page);
    await symbols.getByRole('group', { name: 'Symbols' }).getByRole('button', { name: 'Infantry', exact: true }).click();
    await expect(symbols.getByRole('button', { name: 'Place on map' })).toBeEnabled();
    await expect(chosen(symbols.getByRole('combobox', { name: 'Data type', exact: true })), 'a type without sets').toHaveText('General');
    await expect(fieldSets(symbols).list, 'no set yet: no drop-down').toHaveCount(0);
    const before = sent.length;
    expect(await addable(symbols), 'every declared set').toEqual(expect.arrayContaining(DECLARED_SETS));
    await addSet(symbols, 'CoT unit');
    await expect(chosen(fieldSets(symbols).list)).toHaveText('CoT unit');
    await expect(unitGroup(symbols)).toHaveAttribute('data-carried', 'true');
    expect(await addable(symbols), 'not offered once added').not.toContain('CoT unit');
    const callsign = field(unitGroup(symbols), 'Callsign');
    await callsign.fill('ALPHA');
    await callsign.press('Tab');
    expect(sent.slice(before), 'nothing sent before placing').toEqual([]);

    await symbols.getByRole('button', { name: 'Place on map' }).click();
    const centre = await mapCentre(page);
    const from = sent.length;
    for (const point of [{ x: centre.x - 100, y: centre.y + 40 }, { x: centre.x + 80, y: centre.y + 60 }]) {
      await page.mouse.click(point.x, point.y);
      await userPause(page);
    }
    await page.keyboard.press('Escape');
    await expect.poll(() => sent.slice(from).filter((r) => r.operation === 'create').length, { message: 'two symbols placed' }).toBe(2);
    const creates = sent.slice(from).filter((r) => r.operation === 'create');
    for (const create of creates) {
      expect(create.fields, 'only the field with a value').toEqual([{ plugin: 'cot', name: 'callsign', value: 'ALPHA' }]);
      expect(create.data?.fieldSets, 'the set listed').toEqual(['cot.unit']);
    }
    await expect.poll(async () => (await live.getObjects(creates.map((c) => c.entityId))).found.map((o: State) => [o.fieldSets, o.extensions?.cot?.callsign]), { message: 'stored with the set and the value' }).toEqual([[['cot.unit'], 'ALPHA'], [['cot.unit'], 'ALPHA']]);
  });
});

test('the simulator\'s event panel (criterion 51, with cot.unit; one set at a time): a drop-down of every declared set and no "+"; CoT unit chosen shows its seven fields, all enabled; an event that sets Team names only cot.team, a field chosen and emptied again names nothing, and the event adds no set', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await LiveClient.open(server.baseUrl);
    try {
      await all.subscribe({ workspaces: ['*'] });
      const layer = await applied(all, createLayer('Ground truth', { workspace: SIMULATION, drawOrder: 1 }));
      const route = createSymbol(layer.id, 0, { name: 'Route A' }) as Request & { data: State };
      route.data = {
        type: 'core.shape',
        dataType: 'simulator.route',
        dataSource: 'manual',
        layerId: layer.id,
        geometry: { type: 'LineString', coordinates: [[18.0, 59.0], [18.01, 59.0], [18.01, 59.006]] },
        style: { strokeColor: '#2C784C', strokeWidth: 2, strokeDash: 'dash', pointMarkers: 'circle' },
        properties: { name: 'Route A' },
        label: route.data.label,
        extensions: { simulator: { points: [{ speedKind: 'instant', speed: 30 }, { speedKind: 'instant', speed: 30 }, {}], groups: [], end: 'stop' } },
      };
      await applied(all, route);

      let sent: Request[] = [];
      const page = await open((p) => {
        sent = watchRequests(p);
      });
      const views = page.getByRole('tablist', { name: 'Views' });
      await views.getByRole('tab', { name: 'Simulation', exact: true }).click();
      await expect(views.getByRole('tab', { name: 'Simulation', exact: true })).toHaveAttribute('aria-selected', 'true');
      await page.getByRole('region', { name: 'Routes', exact: true }).first().getByRole('button', { name: 'Edit Route A' }).click();
      const editor = page.getByRole('region', { name: 'Route editor', exact: true }).first();
      await expect(editor.getByLabel('Name')).toHaveValue('Route A');
      await editor.getByRole('button', { name: /^Add event at/ }).click();
      // T-204: the panel's region is named "Event" (the shell's head shows its title); its own is the inner one.
      const event = page.getByRole('region', { name: 'Event', exact: true }).last();
      await expect(chosen(event.getByRole('combobox', { name: 'Kind', exact: true }))).toHaveText('Change fields');
      // Every declared set in the drop-down (simulator function 35), settable, and no "+".
      const sets = fieldSets(event);
      await expect(sets.list).toBeVisible();
      expect(await sets.list.locator('option').allTextContents(), 'every declared set').toEqual(expect.arrayContaining(DECLARED_SETS));
      await expect(sets.plus, 'no "+"').toHaveCount(0);
      await expect(event.getByRole('button', { name: /^Other fields/ }), 'SDK 1.3.0\'s "Other fields" is gone').toHaveCount(0);
      await sets.list.selectOption({ label: 'CoT unit' });
      const unit = unitGroup(event);
      await expect(unit, 'cot.unit\'s fields, once chosen').toBeVisible();
      await expect(unit).toHaveAttribute('data-set', 'cot.unit');
      await expect(unit, 'carried: settable, not "(not added)"').toHaveAttribute('data-carried', 'true');
      expect(await unit.locator('[data-field]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-field')))).toEqual(COT_UNIT.map(([name]) => `cot.${name}`));
      for (const [, role, label] of COT_UNIT) await expect(unit.getByRole(role, { name: label, exact: true }), `${label} settable`).toBeEnabled();

      // Team set; Role chosen and emptied again, it had no value, so it is not named.
      await unit.getByRole('combobox', { name: 'Team', exact: true }).selectOption({ label: 'Cyan' });
      const role = unit.getByRole('combobox', { name: 'Role', exact: true });
      await role.selectOption({ label: 'Medic' });
      await role.selectOption({ label: '—' });
      await event.getByRole('combobox', { name: 'Name', exact: true }).selectOption({ label: 'Set to' });
      await event.getByRole('textbox', { name: 'New name', exact: true }).fill('Renamed by the event');
      const from = sent.length;
      await event.getByRole('button', { name: 'Save', exact: true }).click();
      const [update] = await updatesOf(sent, from, route.entityId);
      const events = (update.data!.extensions.simulator.points as Array<{ events?: Array<{ fields?: unknown }> }>).flatMap((p) => p.events ?? []);
      expect(events, 'one event').toHaveLength(1);
      expect(events[0].fields, 'only cot.team named').toEqual([{ plugin: 'cot', name: 'team', value: 'Cyan' }]);
      expect(update.fields ?? [], 'the route\'s update names no fields itself').toEqual([]);
      expect(update.data?.fieldSets ?? [], 'the route gets no set').toEqual([]);
      expect(JSON.stringify(events[0]), 'the event adds no set (owner, IE)').not.toContain('fieldSets');
    } finally {
      await all.close();
    }
  });
});

test('cot\'s greyed link fields (criterion 31): switching a link from both to in greys its source layers and keeps them, saving keeps them, and switching back brings them back; the saved link is a row of the Links table, its fields in the side form once chosen (T-203 part D)', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, snapshot, open }) => {
    const drawing = { id: seededLayer(snapshot), name: 'Drawing' };
    await setLinks(server, [{ name: 'ita-both', direction: 'both', port: 9, targetLayer: drawing, sourceLayers: [drawing], enabled: false }]);
    const page = await open();
    await page.goto('/#settings/plugin/cot');
    const entry = page.getByRole('tabpanel').last(); // the plugin's entry inside the Settings view
    // T-203 part D: the saved link is a row of the Links table (name, columns, On/Off); its fields
    // are in the side form once the row is chosen.
    const links = entry.getByRole('region', { name: 'Links', exact: true });
    const name = links.getByRole('button', { name: 'ita-both', exact: true });
    const row = links.getByRole('row').filter({ has: page.getByRole('button', { name: 'ita-both', exact: true }) });
    await expect(row, 'the link\'s row').toHaveCount(1);
    await expect(row.getByRole('cell').last(), 'off').toHaveText('Off');
    const form = entry.getByRole('complementary', { name: 'ita-both', exact: true });
    const direction = form.getByRole('combobox', { name: 'Direction', exact: true }); // a required field's label ends in an aria-hidden "*" (e977e1a9): by role and name
    await expect(direction, 'not before the row is chosen').toBeHidden();
    await name.click();
    await expect(name).toHaveAttribute('aria-current', 'true');
    const source = form.getByRole('group', { name: 'Send from layers', exact: true }); // T-204: cot's title for sourceLayers
    await expect(chosen(direction)).toHaveText('both');
    await expect(source.getByRole('checkbox', { name: 'Drawing' })).toBeChecked();
    await expect(source.getByRole('checkbox', { name: 'Drawing' })).toBeEnabled();

    await direction.selectOption({ label: 'in' });
    await expect(source.getByRole('checkbox', { name: 'Drawing' }), 'greyed').toBeDisabled();
    await expect(source.getByRole('checkbox', { name: 'Drawing' }), 'its layers kept').toBeChecked();
    await expect(form).toContainText('Used only when Direction is out or both.');
    await form.getByRole('button', { name: 'Save link', exact: true }).click();
    await expect.poll(async () => (await (await fetch(`${server.baseUrl}/api/settings/plugins/cot`)).json()).values.links[0], { message: 'saved as in, with its source layers' }).toMatchObject({ direction: 'in', sourceLayers: [drawing] });

    await direction.selectOption({ label: 'both' });
    await expect(source.getByRole('checkbox', { name: 'Drawing' }), 'back').toBeEnabled();
    await expect(source.getByRole('checkbox', { name: 'Drawing' })).toBeChecked();
  });
});
