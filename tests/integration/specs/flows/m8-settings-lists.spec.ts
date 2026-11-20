// Quick run: @settings @plugin-cot
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/flows/m8-settings-lists.spec.ts
import { expect, test, type Locator, type Page } from '@playwright/test';
import { withM0 } from '../../lib/m0';
import type { OwnServer } from '../../lib/own-server';

// Settings' lists in SDK 1.8.0 (M8), on cot's links, which need no external service:
// - CR-0047 (part F, the owner's WF A, WE A): an item of a list that declares `item.id` has a stable
//   id, a UUID v7 in lower case. ECore fills in a missing or empty one at every change, keeps it
//   through a rename, refuses two items with one id (400, with the path), and the shell's form gives
//   a new item its id and does not show it. fmv's renamed link keeping its camera and arc (F5, WA B,
//   WW A) needs the ESA's replay: specs/external/fmv-replay.spec.ts.
// - T-203 part D (the UXA's "Table + side form", owner 2026-11-13): a plugin's list is a table with
//   a row per item and a side form for the chosen one; Add makes a new item there, its Save saves
//   that item alone, its Delete asks first and then saves at once; an item's unsaved changes are
//   counted at its row and in the entry's badge in the Settings list.
// - Settings › Data types is one table edited in place, with one Save for every changed row.
// Each test has a server of its own.

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const COT = '/api/settings/plugins/cot';

type Item = Record<string, unknown>;

async function values(server: OwnServer): Promise<Record<string, unknown>> {
  return (await (await fetch(`${server.baseUrl}${COT}`)).json()).values;
}

async function links(server: OwnServer): Promise<Item[]> {
  return ((await values(server)).links as Item[] | undefined) ?? [];
}

/** PUT cot's settings with these links, the rest as they are; the response. */
async function putLinks(server: OwnServer, items: Item[]): Promise<Response> {
  return fetch(`${server.baseUrl}${COT}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(await values(server)), links: items }),
  });
}

/** Settings › Cursor on Target: its Links table and side form. */
async function cotLinks(page: Page): Promise<{ table: Locator; side: Locator; tab: Locator }> {
  await page.goto('/#settings/plugin/cot');
  const table = page.getByRole('tabpanel').last().getByRole('region', { name: 'Links', exact: true });
  await expect(table.getByRole('button', { name: 'Add link', exact: true })).toBeVisible();
  return { table, side: table.getByRole('complementary'), tab: page.getByRole('tab', { name: /^Cursor on Target/ }) };
}

const link = (name: string, extra: Item = {}): Item => ({ name, direction: 'in', transport: 'udp', port: 9, enabled: false, ...extra });

test('CR-0047 through the API: ECore gives each cot link without an id (or with an empty one) a UUID v7, keeps it through a rename and another change, and refuses two links with one id with a 400 naming the item', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server }) => {
    expect((await putLinks(server, [link('ita-one'), link('ita-two', { id: '' })])).status).toBe(200);
    const [one, two] = await links(server);
    expect(one.id, 'filled in: a UUID v7').toEqual(expect.stringMatching(UUID_V7));
    expect(two.id, 'an empty one filled in too').toEqual(expect.stringMatching(UUID_V7));
    expect(one.id).not.toBe(two.id);

    // A rename and a port change keep the id.
    expect((await putLinks(server, [{ ...one, name: 'ita-one-renamed', port: 10 }, two])).status).toBe(200);
    const [renamed] = await links(server);
    expect(renamed).toMatchObject({ id: one.id, name: 'ita-one-renamed', port: 10 });

    // Two links with one id: refused, the stored links unchanged.
    const refused = await putLinks(server, [renamed, { ...two, id: one.id }]);
    const text = await refused.text();
    testInfo.annotations.push({ type: 'the refusal', description: text });
    expect(refused.status, 'a duplicate id').toBe(400);
    expect(text, 'names the item').toMatch(/\/links\/1/);
    expect((await links(server)).map((l) => l.id), 'nothing stored').toEqual([one.id, two.id]);
  }, { allowConsoleErrors: /status of 400/ });
});

test('T-203 part D and CR-0047 in Settings › Cursor on Target: Add opens a new link in the side form without an Id field; Save link saves it alone with a UUID v7; a rename keeps the id; an unsaved change is counted at the row and in the entry\'s badge; Delete asks first, Cancel keeps it, Delete removes it at once', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    expect((await putLinks(server, [link('ita-kept')])).status).toBe(200);
    const [kept] = await links(server);
    const page = await open();
    const { table, side, tab } = await cotLinks(page);
    await expect(table.getByText('1 link', { exact: true }), 'the count above the table').toBeVisible();
    await expect(side, 'nothing chosen yet').toContainText('Select a link, or add one.');

    // Add: a new link in the side form; the id is not shown anywhere in it.
    await table.getByRole('button', { name: 'Add link', exact: true }).click();
    await expect(side.getByRole('heading', { name: 'New link', exact: true })).toBeVisible();
    await expect(side.getByLabel(/^Id$/), 'no Id field (CR-0047 F3)').toHaveCount(0);
    await expect(side.getByRole('textbox', { name: /\bid\b/i }), 'no id text box').toHaveCount(0);
    await side.getByRole('textbox', { name: 'Name', exact: true }).fill('ita-new');
    await side.getByRole('textbox', { name: 'Port', exact: true }).fill('11');
    await side.getByRole('button', { name: 'Save link', exact: true }).click();
    await expect.poll(async () => (await links(server)).length, { message: 'saved' }).toBe(2);
    const [same, added] = await links(server);
    expect(same, 'the other link untouched').toEqual(kept);
    expect(added).toMatchObject({ name: 'ita-new', port: 11 });
    expect(added.id, 'the form gave it a UUID v7').toEqual(expect.stringMatching(UUID_V7));
    expect(added.id).not.toBe(kept.id);
    await expect(table.getByText('2 links', { exact: true })).toBeVisible();
    await expect(table.getByRole('button', { name: 'ita-new', exact: true })).toBeVisible();

    // Renamed in the side form: the id stays.
    await table.getByRole('button', { name: 'ita-new', exact: true }).click();
    await side.getByRole('textbox', { name: 'Name', exact: true }).fill('ita-renamed');
    await side.getByRole('button', { name: 'Save link', exact: true }).click();
    await expect.poll(async () => (await links(server))[1]?.name, { message: 'the rename saved' }).toBe('ita-renamed');
    expect((await links(server))[1].id, 'the id kept through the rename').toBe(added.id);

    // An unsaved change: counted at the row and in the entry's badge, kept while another row is chosen.
    const renamedRow = table.getByRole('row').filter({ has: page.getByRole('button', { name: 'ita-renamed', exact: true }) });
    await side.getByRole('textbox', { name: 'Port', exact: true }).fill('12');
    await expect(renamedRow.locator('.unsaved-count'), 'counted at its row').toHaveText('1');
    await expect(tab, 'and in the entry\'s badge').toHaveAccessibleName(/1 unsaved change$/);
    await table.getByRole('button', { name: 'ita-kept', exact: true }).click();
    await table.getByRole('button', { name: 'ita-renamed', exact: true }).click();
    await expect(side.getByRole('textbox', { name: 'Port', exact: true }), 'the draft kept').toHaveValue('12');
    expect((await links(server))[1].port, 'not sent').toBe(11);
    await side.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(side.getByRole('textbox', { name: 'Port', exact: true })).toHaveValue('11');
    await expect(renamedRow.locator('.unsaved-count'), 'nothing left to count').toHaveCount(0);
    await expect(tab).toHaveAccessibleName(/^Cursor on Target$/);

    // Delete asks first: Cancel keeps the link, Delete removes it at once.
    await side.getByRole('button', { name: 'Delete', exact: true }).click();
    const ask = page.getByRole('alertdialog', { name: 'Delete link?' });
    await expect(ask).toContainText('ita-renamed is deleted at once, with its settings.');
    await ask.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(ask).toBeHidden();
    expect((await links(server)).length, 'kept').toBe(2);
    await side.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Delete link?' }).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(async () => (await links(server)).map((l) => l.id), { message: 'deleted at once' }).toEqual([kept.id]);
    await expect(table.getByRole('button', { name: 'ita-renamed', exact: true })).toHaveCount(0);
    await expect(table.getByText('1 link', { exact: true })).toBeVisible();
  });
});

test('Settings › Data types: one table edited in place; changes in two rows are counted together and saved by the one Save, each as its own data type, and Discard leaves nothing unsaved', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const page = await open();
    await page.goto('/#settings/data-types');
    const entry = page.getByRole('region', { name: 'Data types', exact: true });
    const table = entry.getByRole('table');
    await expect(table.getByRole('columnheader')).toHaveText(['Data type', 'From', 'Expires after', 'Fade', 'Remove after', 'Defaults']);
    const names = await table.getByRole('rowheader').allTextContents();
    testInfo.annotations.push({ type: 'data types', description: names.join(' | ') });
    expect(names.length, 'a row per data type').toBeGreaterThan(5);
    const behaviour = async (id: string) => (await (await fetch(`${server.baseUrl}/api/settings/data-types/${id}`)).json()).behaviour;
    const general = await behaviour('core.general');
    const cot = await behaviour('cot.cot');
    const foot = entry.getByRole('group', { name: 'Panel actions' });
    const save = foot.getByRole('button', { name: 'Save', exact: true });
    await expect(save, 'nothing to save yet').toBeDisabled();

    // Two rows changed: one Save for both.
    const fade = async (name: string) => entry.getByRole('checkbox', { name: `Fade, ${name}`, exact: true });
    const generalName = (await page.evaluate(async () => (await (await fetch('/api/config')).json()).dataTypes.find((t: { id: string }) => t.id === 'core.general').name)) as string;
    const cotName = (await page.evaluate(async () => (await (await fetch('/api/config')).json()).dataTypes.find((t: { id: string }) => t.id === 'cot.cot').name)) as string;
    await (await fade(generalName)).setChecked(!general.fadeWhenExpired);
    await entry.getByRole('textbox', { name: `Expires after, ${cotName}`, exact: true }).fill('7');
    await entry.getByRole('combobox', { name: `Unit, Expires after, ${cotName}`, exact: true }).selectOption({ label: 'minutes' });
    await expect(foot.getByRole('status'), 'the changes of both rows, counted together').toHaveText(/^[23] unsaved changes$/);
    await save.click();
    await expect(entry.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    await expect.poll(() => behaviour('core.general'), { message: 'core.general saved' }).toMatchObject({ fadeWhenExpired: !general.fadeWhenExpired });
    expect(await behaviour('cot.cot'), 'cot.cot saved by the same Save').toMatchObject({ ...cot, expiresAfterSeconds: 420 });
    await expect(save, 'nothing left to save').toBeDisabled();

    // Discard drops an edit without sending it.
    await (await fade(generalName)).setChecked(general.fadeWhenExpired === true);
    await expect(foot.getByRole('status')).toHaveText('1 unsaved change');
    await foot.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(foot.getByRole('status')).toHaveText('');
    expect(await behaviour('core.general'), 'not sent').toMatchObject({ fadeWhenExpired: !general.fadeWhenExpired });
  });
});
