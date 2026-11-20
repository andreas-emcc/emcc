// Quick run: @plugin-draw-symbols @plugin-draw-shapes @plugin-draw-tactical @plugin-ais @plugin-cot @plugin-gmti @plugin-adsb @plugin-simulator @settings
import { expect, test, type Locator } from '@playwright/test';
import { addable, addSet, applied, chosen, fieldSets, properties, select, SENSOR_REPORT, symbolAt, symbolsPanel, updatesOf, watchRequests, type Request } from '../../lib/fields';
import { seededLayer } from '../../lib/live.mjs';
import { bottomPanel, colourAround, frameSymbol, FRIEND, HOSTILE, mapCentre, positionAt, userPause, withM0 } from '../../lib/m0';

// M6 part 1's flows (T-165; CR-0038, ADR-0054; the briefs as the owner approved them, NQ A,
// 2026-11-10): a data type brings its field sets. The store adds a data type's sets to a symbol on
// a create and on a data type change (ADR-0054 point 3, model rule 21; symbols only, owner NO A);
// the editors show them at once (point 4) in SDK 1.5.0's field-set editor, one set at a time with
// a "+" for the others (point 5); the data type selects leave out the types users do not make by
// hand, simulator.route, gmti.detection and gmti.platform, unless the object has one (point 6);
// and a hand-placed symbol of an in plugin's data type no longer expires, since the expiry counts
// from time.observed only (point 9). With the assembled plugins: ais.vessel names "AIS ship",
// cot.cot "CoT unit", gmti.detection "GMTI report" and adsb.aircraft "ADS-B aircraft". Each test
// has a server of its own; change requests are read from the page's live picture socket.
// m4-fields has the editor's other flows, on symbols whose data type names no set.

test.describe.configure({ timeout: 180_000 });

/** The data types users do not choose (`manual: false`), by their names. */
const NOT_MANUAL = ['Route', 'GMTI detection', 'GMTI platform'];
/** Data types every select still offers, by their names. */
const MANUAL = ['General', 'AIS vessel', 'CoT', 'ADS-B aircraft'];

/** A data type select's option labels. */
async function optionsOf(select: Locator): Promise<string[]> {
  return (await select.locator('option').allTextContents()).map((t) => t.trim());
}

function dataType(panel: Locator): Locator {
  return panel.getByRole('combobox', { name: 'Data type', exact: true });
}

/** A set's group, while it is the set chosen. */
function group(panel: Locator, label: string): Locator {
  return panel.getByRole('group', { name: label, exact: true });
}

test('the data type selects leave out Route, GMTI detection and GMTI platform (ADR-0054 point 6): the Symbols and Shapes panels offer the others, the Graphics panel has no select (T-190) and "Place graphic" at its top and bottom; "Symbol properties" of a gmti.detection symbol shows its type, and a rename keeps it', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    let sent: Request[] = [];
    const page = await open((p) => {
      sent = watchRequests(p);
    });
    // draw-symbols criterion 50, draw-shapes 36. From M8 a graphic is always General (T-190, owner SW A and US): the
    // Graphics panel has no data type select, and "Place graphic" is at its top and its bottom (SX A).
    const graphics = page.getByRole('region', { name: 'Graphics', exact: true }).last();
    await expect(graphics.getByRole('button', { name: 'Place graphic', exact: true }), 'Graphics: "Place graphic" twice').toHaveCount(2);
    await expect(dataType(graphics), 'Graphics: no data type select').toHaveCount(0);
    for (const name of ['Symbols', 'Shapes']) {
      const select = dataType(page.getByRole('region', { name, exact: true }).last());
      await expect(select, `${name}: the data type select`).toBeVisible();
      const offered = await optionsOf(select);
      expect(offered, `${name} offers`).toEqual(expect.arrayContaining(MANUAL));
      for (const type of NOT_MANUAL) expect(offered, `${name} leaves out ${type}`).not.toContain(type);
    }

    // A symbol that has such a type keeps it in the select, so that an edit does not change it unseen.
    const at = await mapCentre(page);
    // Drawn as a sensor report (gmti's data type has sensorReport: true; SDK 1.5.0 part 3).
    const detection = await symbolAt(page, live, seededLayer(snapshot), at, 'hostile', { data: { dataType: 'gmti.detection' }, drawnAs: SENSOR_REPORT });
    await select(page, at);
    const panel = properties(page);
    await expect(chosen(dataType(panel))).toHaveText('GMTI detection');
    const offered = await optionsOf(dataType(panel));
    expect(offered, 'its own type, and the others users choose').toEqual(expect.arrayContaining(['GMTI detection', ...MANUAL]));
    expect(offered, 'not the other types users do not choose').not.toContain('GMTI platform');
    expect(offered).not.toContain('Route');
    const from = sent.length;
    await panel.getByLabel('Name', { exact: true }).fill('By hand');
    await panel.getByLabel('Name', { exact: true }).press('Enter');
    const [update] = await updatesOf(sent, from, detection);
    expect(update.data?.dataType, 'the rename keeps the type').toBe('gmti.detection');
    await expect.poll(async () => (await live.getObjects([detection])).found[0].properties?.name).toBe('By hand');
    expect((await live.getObjects([detection])).found[0].dataType).toBe('gmti.detection');
  });
});

test('placing by data type (ADR-0054 points 3 to 5; draw-symbols criterion 51): AIS vessel in the Symbols panel shows "AIS ship" chosen with its fields before placing; the symbol placed names the Call sign typed and no set, and the store gives it ais.ship', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, open }) => {
    let sent: Request[] = [];
    const page = await open((p) => {
      sent = watchRequests(p);
    });
    const symbols = symbolsPanel(page);
    await symbols.getByRole('group', { name: 'Symbols' }).getByRole('button', { name: 'Infantry', exact: true }).click();
    await expect(symbols.getByRole('button', { name: 'Place on map' })).toBeEnabled();
    await expect(fieldSets(symbols).list, 'General names no set: no drop-down').toHaveCount(0);
    const before = sent.length;
    await dataType(symbols).selectOption({ label: 'AIS vessel' });
    await expect(chosen(fieldSets(symbols).list), 'the data type\'s set at once').toHaveText('AIS ship');
    const ship = group(symbols, 'AIS ship');
    await expect(ship).toHaveAttribute('data-set', 'ais.ship');
    await expect(ship).toHaveAttribute('data-carried', 'true');
    const callSign = ship.getByRole('textbox', { name: 'Call sign', exact: true });
    await expect(callSign, 'settable before placing').toBeEnabled();
    expect(await addable(symbols), 'the "+" offers the others, not the type\'s own').not.toContain('AIS ship');
    // At most 7 characters: ais' callSign has maxLength 7, and draw-symbols refuses a longer one.
    await callSign.fill('ITASHIP');
    await callSign.press('Tab');
    expect(sent.slice(before), 'nothing sent before placing').toEqual([]);

    await symbols.getByRole('button', { name: 'Place on map' }).click();
    const at = await mapCentre(page);
    const from = sent.length;
    await page.mouse.click(at.x, at.y);
    await userPause(page);
    await page.keyboard.press('Escape');
    await expect.poll(() => sent.slice(from).filter((r) => r.operation === 'create').length, { message: 'one symbol placed' }).toBe(1);
    const create = sent.slice(from).find((r) => r.operation === 'create')!;
    expect(create.data?.dataType).toBe('ais.vessel');
    expect(create.fields, 'only the field with a value').toEqual([{ plugin: 'ais', name: 'callSign', value: 'ITASHIP' }]);
    expect(create.data?.fieldSets ?? [], 'the create lists no set the user did not add: the store adds it').toEqual([]);
    await expect.poll(async () => {
      const o = (await live.getObjects([create.entityId])).found[0];
      return [o?.fieldSets, o?.extensions?.ais?.callSign];
    }, { message: 'stored with ais.ship and the value' }).toEqual([['ais.ship'], 'ITASHIP']);
  });
});

test('a data type change in "Symbol properties" (ADR-0054 points 3 and 4; draw-symbols criterion 52): General to CoT is one update with the new type, and "CoT unit" is shown chosen and stored; CoT to AIS vessel keeps cot.unit and its value and adds ais.ship, shown chosen', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    let sent: Request[] = [];
    const page = await open((p) => {
      sent = watchRequests(p);
    });
    const at = await mapCentre(page);
    const id = await symbolAt(page, live, seededLayer(snapshot), at, 'friend');
    await select(page, at);
    const panel = properties(page);
    await expect(chosen(dataType(panel))).toHaveText('General');
    await expect(fieldSets(panel).list, 'no set yet').toHaveCount(0);

    let from = sent.length;
    await dataType(panel).selectOption({ label: 'CoT' });
    let updates = await updatesOf(sent, from, id);
    await page.waitForTimeout(1_000); // a second update would come at once: a fixed wait, its absence is the check
    updates = sent.slice(from).filter((r) => r.entityId === id);
    expect(updates, 'one update').toHaveLength(1);
    expect(updates[0].data?.dataType).toBe('cot.cot');
    expect(updates[0].fields ?? [], 'no field named').toEqual([]);
    await expect(chosen(fieldSets(panel).list), 'the new type\'s set shown chosen').toHaveText('CoT unit');
    await expect.poll(async () => (await live.getObjects([id])).found[0].fieldSets ?? [], { message: 'the store adds cot.unit' }).toEqual(['cot.unit']);

    // A value in cot.unit, then AIS vessel: the set and its value stay, ais.ship is added and chosen.
    await userPause(page);
    from = sent.length;
    const callsign = group(panel, 'CoT unit').getByRole('textbox', { name: 'Callsign', exact: true });
    await callsign.fill('VIPER 2');
    await callsign.press('Enter');
    await updatesOf(sent, from, id);
    await expect.poll(async () => (await live.getObjects([id])).found[0].extensions?.cot?.callsign).toBe('VIPER 2');
    await userPause(page);
    from = sent.length;
    await dataType(panel).selectOption({ label: 'AIS vessel' });
    const [toAis] = await updatesOf(sent, from, id);
    expect(toAis.data?.dataType).toBe('ais.vessel');
    await expect(chosen(fieldSets(panel).list), 'the new type\'s set shown chosen').toHaveText('AIS ship');
    expect(await optionsOf(fieldSets(panel).list), 'both sets in the drop-down').toEqual(['CoT unit', 'AIS ship']);
    await expect.poll(async () => (await live.getObjects([id])).found[0].fieldSets ?? [], { message: 'cot.unit kept, ais.ship added' }).toEqual(['cot.unit', 'ais.ship']);
    expect((await live.getObjects([id])).found[0].extensions?.cot?.callsign, 'cot.unit\'s value kept').toBe('VIPER 2');
  });
});

test('the "+" and read only (ADR-0054 point 5; draw-symbols criterion 53): an AIS vessel symbol\'s "+" offers CoT unit, and adding it is one update and chooses it; once every set is carried the "+" is gone; in a locked layer no "+", the drop-down still chooses the set to see and its fields are read only', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    let sent: Request[] = [];
    const page = await open((p) => {
      sent = watchRequests(p);
    });
    const at = await mapCentre(page);
    // The request lists ais.ship itself, as an in plugin may: the store adds a set only once.
    const id = await symbolAt(page, live, seededLayer(snapshot), at, 'friend', { data: { dataType: 'ais.vessel', fieldSets: ['ais.ship'] } });
    expect((await live.getObjects([id])).found[0].fieldSets, 'ais.ship once').toEqual(['ais.ship']);
    await select(page, at);
    let panel = properties(page);
    await expect(chosen(fieldSets(panel).list), 'opens on the data type\'s first set').toHaveText('AIS ship');
    const offered = await addable(panel);
    expect(offered, 'the declared sets it lacks').toEqual(expect.arrayContaining(['CoT unit', 'GMTI report']));
    expect(offered, 'not one it carries').not.toContain('AIS ship');

    let from = sent.length;
    await addSet(panel, 'CoT unit');
    const [update] = await updatesOf(sent, from, id);
    expect(update.data?.fieldSets, 'one update listing the set').toEqual(['ais.ship', 'cot.unit']);
    expect(update.fields ?? [], 'no field named').toEqual([]);
    await expect(chosen(fieldSets(panel).list), 'the set added is chosen').toHaveText('CoT unit');
    await expect(group(panel, 'CoT unit')).toHaveAttribute('data-carried', 'true');
    await expect.poll(async () => (await live.getObjects([id])).found[0].fieldSets ?? []).toEqual(['ais.ship', 'cot.unit']);

    // Every other declared set, one at a time, until none is left: then there is no "+" (the owner's Q1).
    for (let left = (await addable(panel)).length; left > 0; left--) {
      const [next] = await addable(panel);
      await userPause(page);
      from = sent.length;
      await addSet(panel, next);
      await updatesOf(sent, from, id);
      await expect(chosen(fieldSets(panel).list)).toHaveText(next);
    }
    await expect(fieldSets(panel).plus, 'no set left: no "+"').toHaveCount(0);
    const carried = await optionsOf(fieldSets(panel).list);
    expect(carried, 'every declared set').toEqual(expect.arrayContaining(['AIS ship', 'CoT unit', 'GMTI report']));
    await expect.poll(async () => ((await live.getObjects([id])).found[0].fieldSets ?? []).length, { message: 'each set stored once' }).toBe(carried.length);

    // Read only: the layer locked in the layer list.
    const layers = await bottomPanel(page, 'Layers');
    await layers.getByRole('button', { name: 'Lock Drawing', exact: true }).click();
    await expect(layers.getByRole('button', { name: 'Unlock Drawing', exact: true })).toBeVisible();
    await select(page, at);
    panel = properties(page);
    await expect(panel).toContainText('Layer "Drawing" is locked');
    await expect(fieldSets(panel).plus, 'no "+"').toHaveCount(0);
    await fieldSets(panel).list.selectOption({ label: 'AIS ship' });
    await expect(group(panel, 'AIS ship').getByRole('textbox', { name: 'Call sign', exact: true }), 'read only').toBeDisabled();
    await fieldSets(panel).list.selectOption({ label: 'CoT unit' });
    await expect(group(panel, 'CoT unit').getByRole('textbox', { name: 'Callsign', exact: true }), 'read only').toBeDisabled();
  });
});

test('a symbol placed by hand as AIS vessel does not fade or go (ADR-0054 point 9): with ais.vessel expiring after 2 s, an observed vessel fades and ECore removes it, while the hand-placed one, without time.observed, stays in full colour', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, live, snapshot, open }) => {
    // Expires 2 s after its observation, faded, removed 4 s later (the settings view's endpoint).
    const behaviour = await fetch(`${server.baseUrl}/api/settings/data-types/ais.vessel`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fadeWhenExpired: true, expiresAfterSeconds: 2, removeAfterExpirySeconds: 4 }),
    });
    expect(behaviour.status).toBe(200);
    let sent: Request[] = [];
    const page = await open((p) => {
      sent = watchRequests(p);
    });
    const centre = await mapCentre(page);
    const handAt = { x: centre.x - 100, y: centre.y + 40 };
    const observedAt = { x: centre.x + 100, y: centre.y - 40 };

    // By hand first, so that it would have gone first under the old rule (expiry from the last change).
    const symbols = symbolsPanel(page);
    await symbols.getByRole('group', { name: 'Symbols' }).getByRole('button', { name: 'Infantry', exact: true }).click();
    await dataType(symbols).selectOption({ label: 'AIS vessel' });
    await symbols.getByRole('button', { name: 'Place on map' }).click();
    const from = sent.length;
    await page.mouse.click(handAt.x, handAt.y);
    await userPause(page);
    await page.keyboard.press('Escape');
    await expect.poll(() => sent.slice(from).filter((r) => r.operation === 'create').length, { message: 'one symbol placed' }).toBe(1);
    const hand = sent.slice(from).find((r) => r.operation === 'create')!;
    expect(hand.data?.dataType).toBe('ais.vessel');
    expect(hand.data?.time?.observed, 'a hand-placed symbol has no observation time').toBeUndefined();
    await expect.poll(() => colourAround(page, handAt, FRIEND), { timeout: 10_000, message: 'the hand-placed symbol is drawn' }).toBeGreaterThan(50);

    // The same data type with an observation, as ais writes it: it fades and goes.
    const observed = frameSymbol(seededLayer(snapshot), await positionAt(page, observedAt), 'hostile') as Request;
    Object.assign(observed.data!, { dataType: 'ais.vessel', time: { observed: new Date().toISOString() } });
    await applied(live, observed);
    await expect.poll(() => colourAround(page, observedAt, HOSTILE), { timeout: 15_000, message: 'the observed vessel no longer in full colour after its expiry' }).toBe(0);
    await live.next(
      (m: { type: string; events?: Array<{ entityId: string; operation: string }> }) => m.type === 'changes' && (m.events ?? []).some((e) => e.entityId === observed.entityId && e.operation === 'delete'),
      30_000,
    );

    // By now the hand-placed one would have faded and gone: it is still there, in full colour.
    expect(await colourAround(page, handAt, FRIEND), 'the hand-placed symbol in full colour').toBeGreaterThan(50);
    const stored = (await live.getObjects([hand.entityId])).found[0];
    expect(stored, 'the hand-placed symbol is not removed').toBeDefined();
    expect(stored.time?.observed, 'still without an observation time').toBeUndefined();
    expect(stored.fieldSets, 'with its data type\'s set').toEqual(['ais.ship']);
  });
});
