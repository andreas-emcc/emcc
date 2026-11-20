// Quick run: @settings @persistence @plugin-coordinates
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coordinates, withM0 } from '../../lib/m0';
import { root } from '../../lib/server.mjs';

// The looks in the real shell (T-056 part 6; ADR-0034, T-052): Night Watch, Chart Room and Signal,
// light and dark, compact and comfortable; the user's choice, the computer's setting and the
// installation's default. The oracle is docs/architecture/looks.md, read at run time; the page's
// computed styles are compared with it. Each test has a server of its own.
//
// Not checked here (for each PCA's own check and a visual check): shadows, panel headings, the
// active view tab, focus, hover and disabled states, fonts, icons, the colours and sizes not named
// below, and plugin panels; of the plugins only the first field of the Coordinates dialog.

test.describe.configure({ timeout: 180_000 });

type Look = 'night-watch' | 'chart-room' | 'signal';
type Scheme = 'light' | 'dark';
type Density = 'compact' | 'comfortable';
const LOOKS: Look[] = ['night-watch', 'chart-room', 'signal'];
const LETTER: Record<Look, string> = { 'night-watch': 'A', 'chart-room': 'B', signal: 'C' };

/** The rows of the Markdown table that follows `heading` in looks.md, as cells. */
function table(heading: string): string[][] {
  const text = readFileSync(join(root, 'docs', 'architecture', 'looks.md'), 'utf8');
  const from = text.indexOf(heading);
  expect(from, `looks.md has "${heading}"`).toBeGreaterThanOrEqual(0);
  const lines = text.slice(from).split('\n').slice(1);
  const start = lines.findIndex((l) => l.startsWith('|'));
  const rows: string[][] = [];
  for (const line of lines.slice(start)) {
    if (!line.startsWith('|')) break;
    rows.push(line.split('|').slice(1, -1).map((c) => c.trim().replace(/`/g, '')));
  }
  return rows;
}

const COLOURS = table('## Colours');
const SIZES = table('## Density');
const LOOK_TABLE = table('## What a look sets');

/** The row of a table whose first cell is exactly `name`. */
function row(rows: string[][], name: string, where: string): string[] {
  const found = rows.find((r) => r[0] === name);
  expect(found, `looks.md, ${where}: a row "${name}"`).toBeDefined();
  return found!;
}

/** A colour of looks.md for a look in a scheme, e.g. colour('Ground', 'signal', 'light'). */
function colour(token: string, look: Look, scheme: Scheme): string {
  const column = COLOURS[0].indexOf(`${LETTER[look]} ${scheme}`);
  expect(column, `looks.md, Colours: a column "${LETTER[look]} ${scheme}"`).toBeGreaterThan(0);
  return row(COLOURS, token, 'Colours')[column];
}

/** A size of looks.md in px for a density, e.g. size('Top bar', 'compact'). */
function size(name: string, density: Density): number {
  return parseFloat(row(SIZES, name, 'Density')[density === 'compact' ? 1 : 2]);
}

/**
 * What a look sets: its controls' corners in px (the Look button is one: looks.md's "Control corners"
 * row from SDK 1.8.0, the UXA's look; Chart Room's pills are 999 px, as the computed style keeps them)
 * and its default density.
 */
function lookSets(look: Look) {
  const column = LOOKS.indexOf(look) + 1;
  return {
    corners: parseFloat(row(LOOK_TABLE, 'Control corners (buttons, chips, tabs)', 'What a look sets')[column]),
    density: row(LOOK_TABLE, 'Default density', 'What a look sets')[column].toLowerCase() as Density,
  };
}

/** `#a1b2c3` as the browser's computed `rgb(161, 178, 195)`. */
function rgb(hex: string): string {
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `rgb(${n(1)}, ${n(3)}, ${n(5)})`;
}

/**
 * What the page shows: the root's attributes, the page's ground and text, the top bar (in the
 * shell's pane colour), the accent token, the first field of the Coordinates dialog (opened if a
 * press elsewhere closed it) and the Look button's corners. `topBarDrawn` is the top bar's drawn height, checked apart (see below).
 */
async function shown(page: Page) {
  const field = await (await coordinates(page)).getByRole('combobox').first().boundingBox();
  const values = await page.evaluate(() => {
    const html = document.documentElement;
    const css = getComputedStyle(html);
    const bar = document.querySelector('header.top-bar') as HTMLElement;
    const button = [...bar.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Look') as HTMLElement;
    return {
      look: html.dataset.look,
      scheme: html.dataset.scheme,
      density: html.dataset.density,
      ground: css.backgroundColor,
      text: css.color,
      fontSize: parseFloat(css.fontSize),
      // The token as set for the look (no element is drawn in the accent in every look's View).
      accent: css.getPropertyValue('--emc2-color-accent').trim().toLowerCase(),
      // The top bar is drawn in the shell's pane colour (web/shell/src/shell-look.css: --control-pane-bg, the Pane token; T-199).
      pane: getComputedStyle(bar).backgroundColor,
      // Its set height (one fixed height in every workspace from M7: shell.css's height: var(--shell-top-bar); owner SD A).
      topBar: parseFloat(getComputedStyle(bar).height),
      topBarDrawn: bar.getBoundingClientRect().height,
      corners: parseFloat(getComputedStyle(button).borderTopLeftRadius),
    };
  });
  const { topBarDrawn, ...checked } = values;
  return { checked: { ...checked, field: field!.height }, topBarDrawn };
}

/** The values looks.md gives a look, scheme and density. */
function expected(look: Look, scheme: Scheme, density: Density) {
  return {
    look,
    scheme,
    density,
    ground: rgb(colour('Ground', look, scheme)),
    text: rgb(colour('Text', look, scheme)),
    fontSize: size('Text', density),
    accent: colour('Accent', look, scheme).toLowerCase(),
    pane: rgb(colour('Pane', look, scheme)),
    topBar: size('Top bar', density),
    corners: lookSets(look).corners,
    field: size('Input field height', density),
  };
}

/**
 * Waits until the page shows a look, scheme and density as looks.md says, the drawn top bar exactly
 * its height (the 1 px over, known since 2026-10-21, is gone with the CDA's T-113). Resolves with the
 * drawn height.
 */
async function expectShows(page: Page, look: Look, scheme: Scheme, density: Density, what: string): Promise<number> {
  await expect.poll(async () => (await shown(page)).checked, { message: what }).toEqual(expected(look, scheme, density));
  const drawn = (await shown(page)).topBarDrawn;
  expect(drawn, `${what}: the drawn top bar`).toBe(size('Top bar', density));
  return drawn;
}

/**
 * Chooses in the top bar's Look control: the look, light or dark, the density (each by its value).
 * The three lists are in that order; their accessible names include their options' texts.
 */
async function choose(page: Page, choice: { look?: string; scheme?: string; density?: string }) {
  await page.locator('header.top-bar').getByRole('button', { name: 'Look', exact: true }).click();
  const popover = page.getByRole('dialog', { name: 'Look' });
  const [look, scheme, density] = [0, 1, 2].map((i) => popover.getByRole('combobox').nth(i));
  if (choice.look !== undefined) await look.selectOption(choice.look);
  if (choice.scheme !== undefined) await scheme.selectOption(choice.scheme);
  if (choice.density !== undefined) await density.selectOption(choice.density);
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
}

test('every look, light and dark, compact and comfortable, shows the values of looks.md at once, without a reload; "the look\'s default" density is the look\'s own', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ open }) => {
    const page = await open();
    await page.evaluate(() => {
      (window as unknown as { itaNoReload: boolean }).itaNoReload = true;
    });
    const drawn = new Set<string>();
    for (const look of LOOKS) {
      for (const scheme of ['light', 'dark'] as Scheme[]) {
        for (const density of ['compact', 'comfortable'] as Density[]) {
          await choose(page, { look, scheme, density });
          drawn.add(`${density}: ${await expectShows(page, look, scheme, density, `${look} ${scheme} ${density}`)} px`);
        }
        await choose(page, { density: 'look' });
        await expect.poll(async () => (await shown(page)).checked.density, { message: `${look}'s default density` }).toBe(lookSets(look).density);
      }
    }
    expect(await page.evaluate(() => (window as unknown as { itaNoReload?: boolean }).itaNoReload), 'no reload in between').toBe(true);
    testInfo.annotations.push({ type: 'top bar drawn', description: [...drawn].join('; ') });
  });
});

/** Waits for the save of the remembered setup whose shell share holds this look choice. */
function lookSaved(page: Page, look: string) {
  return page.waitForResponse((r) => {
    if (!r.url().includes('/api/user-documents/core/setup.current') || r.request().method() !== 'PUT' || !r.ok()) return false;
    try {
      return JSON.parse(r.request().postData() ?? '').shell?.look?.look === look;
    } catch {
      return false;
    }
  }, { timeout: 15_000 });
}

test('defaults: without a choice the installation\'s look (Night Watch, then the admin\'s) in the computer\'s light or dark, kept across a restart; the user\'s own choice wins, is remembered in a reload and a second browser, and can go back to the default', async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open, restart }) => {
    const defaultLook = async (baseUrl: string) => (await (await fetch(`${baseUrl}/api/config`)).json()).defaultLook;
    // No choice yet: the built-in default, light or dark as the computer is.
    const dark = await open(undefined, { context: { colorScheme: 'dark' } });
    await expectShows(dark, 'night-watch', 'dark', lookSets('night-watch').density, 'no choice, a dark computer');
    const light = await open(undefined, { context: { colorScheme: 'light' } });
    await expectShows(light, 'night-watch', 'light', lookSets('night-watch').density, 'no choice, a light computer');
    await dark.close();

    // The admin's default in Settings › General; a wrong value is refused and changes nothing.
    const general = `${server.baseUrl}/api/settings/general`;
    const refused = await fetch(general, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ defaultLook: 'paper' }) });
    expect(refused.status, 'an unknown look').toBe(400);
    expect(await defaultLook(server.baseUrl), 'unchanged after the refusal').toBe('night-watch');
    await light.goto('/#settings');
    await light.getByRole('tablist', { name: 'Settings' }).getByRole('tab', { name: 'General' }).click();
    const card = light.getByRole('article', { name: 'Default look' });
    await card.getByRole('combobox').selectOption('signal');
    // T-203 part C: the entry's one Save sits in its pinned foot, not in the card.
    await light.getByRole('region', { name: 'General', exact: true }).getByRole('group', { name: 'Panel actions' }).getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => defaultLook(server.baseUrl)).toBe('signal');
    await light.close();

    // After a clean restart the default is still Signal, for a user who has not chosen.
    const { server: restarted } = await restart();
    expect(await defaultLook(restarted.baseUrl), 'kept across the restart').toBe('signal');
    const page = await open(undefined, { context: { colorScheme: 'light' } });
    await expectShows(page, 'signal', 'light', lookSets('signal').density, 'the admin\'s default');

    // The user's own choice wins over the default, and is remembered with the setup: after a
    // reload and in a second browser.
    let saved = lookSaved(page, 'chart-room');
    await choose(page, { look: 'chart-room' });
    await saved;
    await page.reload();
    await expectShows(page, 'chart-room', 'light', lookSets('chart-room').density, 'remembered after a reload');
    const second = await open(undefined, { context: { colorScheme: 'light' } });
    await expectShows(second, 'chart-room', 'light', lookSets('chart-room').density, 'remembered in a second browser');
    await second.close();
    await page.locator('header.top-bar').getByRole('button', { name: 'Look', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Look' }).getByRole('combobox').first().locator('option[value="default"]')).toHaveText('Installation default (Signal)');
    await page.keyboard.press('Escape');

    // Back to the installation's default.
    saved = lookSaved(page, 'default');
    await choose(page, { look: 'default' });
    await saved;
    await expectShows(page, 'signal', 'light', lookSets('signal').density, 'back to the default');
  });
});
