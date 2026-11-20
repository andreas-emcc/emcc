// Quick run: @plugin-gmti @settings
import { expect, test, type Locator, type Page } from '@playwright/test';
import { withM0 } from '../../lib/m0';

// gmti's link fields by mode and direction (T-160; gmti criteria 30 and 31; SDK 1.5.0 part 4,
// CR-0039 point 8; the owner's Q45 A; the CDA's A1 and A2): in Settings › gmti a link shows only the
// fields its mode and direction use (`visibleWhen`; hidden, not greyed): host and port for
// tcp-client and udp, listen for tcp-server and udp, the multicast fields for udp; the in fields
// for in, the out fields for out. A hidden field keeps its value through a save. The schema's own
// if/then requires listen for a udp in link: Save is refused and the problem is shown at the item
// (A2). The link is a form of fields, not "As JSON" (A1). Each test has a server of its own.

test.describe.configure({ timeout: 120_000 });

type Link = Record<string, unknown>;

async function stored(baseUrl: string): Promise<Link[]> {
  return (await (await fetch(`${baseUrl}/api/settings/plugins/gmti`)).json()).values.links ?? [];
}

/** Settings › gmti, the plugin's entry. */
async function gmtiForm(page: Page): Promise<Locator> {
  await page.goto('/#settings/plugin/gmti');
  const form = page.getByRole('tabpanel').last();
  await expect(links(form).getByRole('button', { name: 'Add link', exact: true })).toBeVisible();
  return form;
}

/** The Links table with its side form (T-203 part D). */
function links(form: Locator): Locator {
  return form.getByRole('region', { name: 'Links', exact: true });
}

/** The side form of the chosen link: one per list, named by the link. */
function sideForm(form: Locator): Locator {
  return links(form).getByRole('complementary');
}

/** A new link in the side form, after "Add link". */
async function addLink(form: Locator): Promise<Locator> {
  await links(form).getByRole('button', { name: 'Add link', exact: true }).click();
  const side = sideForm(form);
  await expect(side.getByRole('heading', { name: 'New link', exact: true })).toBeVisible();
  return openSections(side);
}

/**
 * Every folded group of the side form opened (T-203 part E: a group folds, "Advanced" always), so
 * that only a field's own visibility hides it.
 */
async function openSections(side: Locator): Promise<Locator> {
  const folded = side.locator('details:not([open]) > summary');
  for (let n = await folded.count(); n > 0; n = await folded.count()) await folded.first().click();
  return side;
}

/** A saved link chosen in the table, its side form. */
async function chooseLink(form: Locator, name: string): Promise<Locator> {
  await links(form).getByRole('button', { name, exact: true }).click();
  return openSections(sideForm(form));
}

/**
 * A link's parts in the form, hidden ones included: hidden means there and hidden, its value kept.
 * Its own "Port" is the first; listen's is inside the "Listen on" group.
 */
function linkParts(section: Locator) {
  const listen = section.getByRole('group', { name: 'Listen on', exact: true, includeHidden: true });
  return {
    // Required fields, used only while shown: with includeHidden a name takes in the label's
    // aria-hidden "*" (the CDA's e977e1a9), so these look up shown fields only.
    name: section.getByRole('textbox', { name: 'Name', exact: true }),
    mode: section.getByRole('combobox', { name: 'Mode', exact: true, includeHidden: true }),
    direction: section.getByRole('combobox', { name: 'Direction', exact: true, includeHidden: true }),
    host: section.getByRole('textbox', { name: 'Host', exact: true, includeHidden: true }),
    port: section.getByRole('textbox', { name: 'Port', exact: true, includeHidden: true }).first(),
    listen,
    listenPort: listen.getByRole('textbox', { name: 'Port', exact: true }),
    multicastGroup: section.getByRole('textbox', { name: 'Multicast group', exact: true, includeHidden: true }),
    multicastInterface: section.getByRole('textbox', { name: 'Multicast interface', exact: true, includeHidden: true }),
    // An in field and an out field of each kind (the brief's section 5).
    platformSymbol: section.getByRole('textbox', { name: 'Platform symbol', exact: true, includeHidden: true }),
    maxReportsPerDwell: section.getByRole('textbox', { name: 'Most reports per dwell', exact: true, includeHidden: true }),
    nationality: section.getByRole('textbox', { name: 'Nationality', exact: true, includeHidden: true }),
    exercise: section.getByRole('checkbox', { name: 'Exercise', exact: true, includeHidden: true }),
    // Both directions.
    idleSeconds: section.getByRole('textbox', { name: 'Reconnect when idle', exact: true, includeHidden: true }),
  };
}

type Parts = ReturnType<typeof linkParts>;
type Name = Exclude<keyof Parts, never>;

/**
 * Fields whose whole group can be hidden: a group whose fields are all hidden is left out of the
 * page (T-203 part E, review R1). gmti's Picture group holds only in fields, so an out link has none.
 */
const WHOLE_GROUP_HIDDEN: Name[] = ['platformSymbol'];

async function shows(parts: Parts, visible: Name[], hidden: Name[], what: string): Promise<void> {
  for (const n of visible) await expect(parts[n], `${what}: ${n} shown`).toBeVisible();
  for (const n of hidden) {
    if (!WHOLE_GROUP_HIDDEN.includes(n)) await expect(parts[n], `${what}: ${n} still there`).toHaveCount(1);
    await expect(parts[n], `${what}: ${n} hidden`).toBeHidden();
  }
}

const PEER: Name[] = ['host', 'port'];
const LISTEN: Name[] = ['listen'];
const MULTICAST: Name[] = ['multicastGroup', 'multicastInterface'];
const IN: Name[] = ['platformSymbol', 'maxReportsPerDwell'];
const OUT: Name[] = ['nationality', 'exercise'];

test('criterion 31: a link\'s fields follow its mode and direction (hidden, not greyed), a udp link shows both directions\' peer and listen fields and the multicast ones, the form is fields and not "As JSON", and a hidden host keeps its value through a save', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const page = await open();
    const form = await gmtiForm(page);
    const section = await addLink(form);
    const link = linkParts(section);
    await expect(link.mode).toBeVisible();
    await expect(section.getByRole('textbox', { name: /As JSON/ }), 'A1: fields, not a JSON box').toHaveCount(0);
    expect(await section.locator('textarea.field-json').count(), 'A1: no JSON text box for the link').toBe(0);

    // A new link: tcp-client and in, the defaults.
    await shows(link, [...PEER, ...IN, 'idleSeconds'], [...LISTEN, ...MULTICAST, ...OUT], 'tcp-client in');
    await link.name.fill('ita-link');
    await link.host.fill('127.0.0.1');
    await link.port.fill('47011');

    await link.mode.selectOption('tcp-server');
    await shows(link, [...LISTEN, ...IN, 'idleSeconds'], [...PEER, ...MULTICAST, ...OUT], 'tcp-server in');
    await link.listen.getByRole('button', { name: 'Set Listen on', exact: true }).click(); // optional: set first ("Set <name>", the CDA's part E fixes)
    await link.listenPort.fill('47012');

    await link.mode.selectOption('udp');
    await shows(link, [...PEER, ...LISTEN, ...MULTICAST, ...IN, 'idleSeconds'], OUT, 'udp in');
    await link.direction.selectOption('out');
    await shows(link, [...PEER, ...LISTEN, ...MULTICAST, ...OUT, 'idleSeconds'], IN, 'udp out');
    await link.direction.selectOption('in');
    await shows(link, IN, OUT, 'udp in again');

    // Saved as a tcp-server in link: its hidden host and port are kept, and still there after switching back.
    await link.mode.selectOption('tcp-server');
    await section.getByRole('button', { name: 'Save link', exact: true }).click();
    // Saved: the side form has nothing left to save (it shows no "Saved."; T-203 part D).
    await expect(section.getByRole('button', { name: 'Save link', exact: true })).toBeDisabled();
    await expect.poll(async () => (await stored(server.baseUrl)).length, { message: 'stored' }).toBe(1);
    expect(await stored(server.baseUrl), 'the hidden fields saved as they are').toEqual([expect.objectContaining({ name: 'ita-link', mode: 'tcp-server', host: '127.0.0.1', port: 47011, listen: expect.objectContaining({ port: 47012 }) })]);
    await link.mode.selectOption('tcp-client');
    await expect(link.host, 'the hidden host is still there').toHaveValue('127.0.0.1');
    await expect(link.port).toHaveValue('47011');

    // After a reload too.
    await page.reload();
    const again = await gmtiForm(page);
    const reloaded = linkParts(await chooseLink(again, 'ita-link'));
    await shows(reloaded, LISTEN, PEER, 'tcp-server after a reload');
    await reloaded.mode.selectOption('tcp-client');
    await expect(reloaded.host).toHaveValue('127.0.0.1');
  });
});

test('criterion 31: Save refuses a udp in link without a listen port, the RC1 case, and shows why at the link (A2); with one it is saved', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const before = await stored(server.baseUrl);
    const page = await open();
    const form = await gmtiForm(page);
    const section = await addLink(form);
    const link = linkParts(section);
    await link.name.fill('ita-udp-in');
    await link.mode.selectOption('udp');
    await shows(link, [...LISTEN, ...IN], OUT, 'udp in');
    await section.getByRole('button', { name: 'Save link', exact: true }).click();
    await expect(form.getByRole('alert').filter({ hasText: /./ }).first(), 'refused').toBeVisible();
    await expect(section, 'the problem at the link names listen').toContainText(/listen/i);
    await expect(section.getByRole('button', { name: 'Save link', exact: true }), 'still to save').toBeEnabled();
    expect(await stored(server.baseUrl), 'nothing saved').toEqual(before);

    await link.listen.getByRole('button', { name: 'Set Listen on', exact: true }).click();
    await link.listenPort.fill('47013');
    await section.getByRole('button', { name: 'Save link', exact: true }).click();
    // Saved: the side form has nothing left to save (it shows no "Saved."; T-203 part D).
    await expect(section.getByRole('button', { name: 'Save link', exact: true })).toBeDisabled();
    await expect.poll(async () => (await stored(server.baseUrl)).length, { message: 'stored' }).toBe(1);
    expect(await stored(server.baseUrl)).toEqual([expect.objectContaining({ name: 'ita-udp-in', mode: 'udp', listen: expect.objectContaining({ port: 47013 }) })]);
    await expect(section, 'the problem is gone').not.toContainText(/required property/i);
  }, { allowConsoleErrors: /Failed to load resource: the server responded with a status of 400/ }); // the refused save
});
