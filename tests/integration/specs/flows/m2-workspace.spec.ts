// Quick run: @settings @plugin-draw-symbols
import { expect, test as base, type Page, type Response } from '@playwright/test';
import { test } from '../../fixtures';
import { keepCollapsed, withM0 } from '../../lib/m0';

// The M2 workspace in the browser (T-056; ADR-0031; web/README.md "Layout", "Settings", "Setups"):
// the Settings list, panels moved between panes and resized panes, remembered and named setups,
// and the clock. A setup is the user's document on the server, so every test that changes one has
// a server of its own; the read-only Settings list test uses the run's shared server.

type PluginInfo = { id: string; name: string; active: boolean; hasSettings?: boolean; category?: string | null };

/** The Settings workspace's category order (SDK 1.6.0 part F, PLUGIN_CATEGORIES; T-174); absent is general. */
const CATEGORIES = ['data-links', 'geometoc', 'map-and-symbols', 'drawing', 'simulation', 'general'];

test('the Settings list: one entry per running plugin with runtime settings, by name within its category in the order of the categories (T-174), General, Display, Data types, Layers and Labeling first in General; the arrow keys move along it and the address follows', async ({ page, request }) => {
  const plugins = (await (await request.get('/api/plugins')).json()) as PluginInfo[];
  const byName = (a: PluginInfo, b: PluginInfo) => a.name.localeCompare(b.name);
  const withSettings = plugins.filter((p) => p.active && p.hasSettings);
  expect(withSettings.length, 'some plugins have runtime settings').toBeGreaterThan(0);
  const inCategory = (id: string) => withSettings.filter((p) => (p.category ?? 'general') === id).sort(byName).map((p) => p.name);
  // The shell's own entries lead General (Display: SDK 1.4.0 part 5; Labeling: T-170); flows/m7-settings checks the headings.
  const SHELL = ['General', 'Display', 'Data types', 'Layers', 'Labeling'];
  const expected = CATEGORIES.flatMap((id) => (id === 'general' ? [...SHELL, ...inCategory(id)] : inCategory(id)));

  await page.goto('/#settings');
  const list = page.getByRole('tablist', { name: 'Settings' });
  await expect(list.getByRole('tab')).toHaveText(expected);

  await list.getByRole('tab', { name: 'General', exact: true }).click();
  await page.keyboard.press('ArrowDown');
  await expect(list.getByRole('tab', { name: 'Display' })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/#settings\/display$/);
  await page.keyboard.press('ArrowDown');
  await expect(list.getByRole('tab', { name: 'Data types' })).toHaveAttribute('aria-selected', 'true');
  await expect(list.getByRole('tab', { name: 'Data types' })).toBeFocused();
  await expect(page).toHaveURL(/#settings\/data-types$/);
  await page.keyboard.press('End');
  await expect(list.getByRole('tab', { name: expected.at(-1)!, exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(list.getByRole('tab', { name: expected[0], exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/#settings\/plugin\/[a-z0-9-]+$/); // the first entry is a plugin's (Data Links)
});

type ShellShare = { layout?: { placed?: Record<string, string>; panes?: Record<string, { size: number | null }> }; clock?: string };

/** The shell's share in a saved setup (web/README.md "Setups"), or null when the body is not one. */
function shellShareOf(body: string | null): ShellShare | null {
  try {
    const doc = JSON.parse(body ?? '');
    return (doc?.shell ?? doc?.content?.shell ?? null) as ShellShare | null;
  } catch {
    return null;
  }
}

/**
 * Resolves with the save of the remembered setup (`setup.current` of the user's `core` documents)
 * whose shell share shows the change: an earlier save in flight (the shell saves at most once a
 * second, plugin shares too) does not count.
 */
function setupSaved(page: Page, shows: (shell: ShellShare) => boolean): Promise<Response> {
  return page.waitForResponse((r) => {
    if (!r.url().includes('/api/user-documents/core/setup.current') || r.request().method() !== 'PUT' || !r.ok()) return false;
    const shell = shellShareOf(r.request().postData());
    return shell !== null && shows(shell);
  }, { timeout: 15_000 });
}

base('a panel moved to another pane and a resized pane are remembered: after a reload and in a second browser of the user', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ open }) => {
    const page = await open();
    const left = page.getByRole('complementary', { name: 'Left pane' });
    const right = page.getByRole('complementary', { name: 'Control Pane' });
    await expect(right.getByRole('region', { name: 'Symbol properties', exact: true })).toBeVisible();

    let saved = setupSaved(page, (shell) => Object.values(shell.layout?.placed ?? {}).includes('left'));
    await page.getByRole('button', { name: 'Move Symbol properties to the left pane' }).click();
    await expect(left.getByRole('region', { name: 'Symbol properties', exact: true })).toBeVisible();
    await expect(right.getByRole('region', { name: 'Symbol properties', exact: true })).toHaveCount(0);
    await saved;

    // The left pane's handle: two arrow keys widen it by 2 × 16 px.
    const handle = page.getByRole('separator', { name: 'Resize the left pane' });
    const before = Number(await handle.getAttribute('aria-valuenow'));
    saved = setupSaved(page, (shell) => shell.layout?.panes?.left?.size === before + 32);
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(handle).toHaveAttribute('aria-valuenow', String(before + 32));
    await saved;

    for (const shown of [page, await open()]) {
      if (shown === page) await page.reload();
      await expect(shown.getByRole('complementary', { name: 'Left pane' }).getByRole('region', { name: 'Symbol properties', exact: true })).toBeVisible();
      await expect(shown.getByRole('separator', { name: 'Resize the left pane' })).toHaveAttribute('aria-valuenow', String(before + 32));
    }
  });
});

base('named setups: saved under a name, restored at a click; the same name asks to replace it; deleting asks first', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ open }) => {
    const page = await open();
    const right = page.getByRole('complementary', { name: 'Control Pane' });
    const left = page.getByRole('complementary', { name: 'Left pane' });
    const openSetups = async () => {
      await page.getByRole('button', { name: 'Setups', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Save current setup as' })).toBeVisible();
    };
    const saveAs = async (name: string) => {
      await page.getByRole('textbox', { name: 'Save current setup as' }).fill(name);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
    };

    // "Symbol properties on the right" as the setup ITA one.
    await openSetups();
    await expect(page.getByText('No named setups yet.')).toBeVisible();
    await saveAs('ITA one');
    await expect(page.getByRole('list', { name: 'Named setups' }).getByRole('button', { name: 'Restore ITA one' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Move the panel, then restore the setup: it goes back.
    await page.getByRole('button', { name: 'Move Symbol properties to the left pane' }).click();
    await expect(left.getByRole('region', { name: 'Symbol properties', exact: true })).toBeVisible();
    await openSetups();
    await page.getByRole('button', { name: 'Restore ITA one' }).click();
    await expect(right.getByRole('region', { name: 'Symbol properties', exact: true })).toBeVisible();
    await expect(left.getByRole('region', { name: 'Symbol properties', exact: true })).toHaveCount(0);

    // The same name in other case asks whether to replace it; there is still one setup.
    await page.getByRole('button', { name: 'Move Symbol properties to the left pane' }).click();
    await openSetups();
    await saveAs('ita ONE');
    const replace = page.getByRole('alertdialog', { name: 'Replace setup' });
    await expect(replace).toContainText('A setup named ITA one exists. Replace it with the current setup?');
    await replace.getByRole('button', { name: 'Replace' }).click();
    await expect(replace).toBeHidden();
    // Still one setup (its document kept), now with the name as typed.
    await expect(page.getByRole('list', { name: 'Named setups' }).getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Restore ita ONE' })).toBeVisible();

    // A second browser of the user restores the replaced setup: Symbol properties on the left.
    const second = await open();
    // Wherever its remembered setup put the panel, move it to the bottom pane first.
    await second.getByRole('button', { name: 'Move Symbol properties to the bottom pane' }).click();
    await expect(second.getByRole('complementary', { name: 'Bottom pane' }).getByRole('tab', { name: 'Symbol properties' })).toBeVisible();
    await second.getByRole('button', { name: 'Setups', exact: true }).click();
    await second.getByRole('button', { name: 'Restore ita ONE' }).click();
    await expect(second.getByRole('complementary', { name: 'Left pane' }).getByRole('region', { name: 'Symbol properties', exact: true })).toBeVisible();

    // Deleting asks first.
    await page.getByRole('button', { name: 'Delete ita ONE' }).click();
    const question = page.getByRole('alertdialog', { name: 'Delete setup' });
    await expect(question).toContainText('Delete the setup ita ONE? This cannot be undone.');
    await question.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('No named setups yet.')).toBeVisible();
  });
});

/** The date-time group of `at` in UTC, as the clock shows it, e.g. "161045Z OCT 26". */
function dtgUtc(at: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${two(at.getUTCDate())}${two(at.getUTCHours())}${two(at.getUTCMinutes())}Z ${months[at.getUTCMonth()]} ${two(at.getUTCFullYear() % 100)}`;
}

base('the clock shows a UTC date-time group; a click switches to local time with the zone letter (I for UTC+9, J for a half-hour offset); the choice is remembered', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ open }) => {
    const page = await open(undefined, { context: { timezoneId: 'Asia/Tokyo' } });
    const clock = page.getByRole('button', { name: /^Time, / });
    const label = async () => (await clock.getAttribute('aria-label')) ?? '';
    const before = new Date();
    const utc = /^Time, UTC: (\d{6}Z [A-Z]{3} \d{2})\. Switch to local time$/.exec(await label());
    expect(utc, `the clock's name: ${await label()}`).not.toBeNull();
    const after = new Date();
    // The clock turns at the full minute plus a little: just after it, it may still show the last one.
    expect([dtgUtc(new Date(before.getTime() - 60_000)), dtgUtc(before), dtgUtc(after)], 'the current UTC minute').toContain(utc![1]);

    const saved = setupSaved(page, (shell) => shell.clock === 'local');
    await clock.click();
    await expect(clock).toHaveAccessibleName(/^Time, local: \d{6}I [A-Z]{3} \d{2}\. Switch to UTC$/);
    await saved;
    await page.reload();
    await expect(page.getByRole('button', { name: /^Time, / }), 'remembered after a reload').toHaveAccessibleName(/^Time, local: \d{6}I /);

    // A half-hour offset has no letter of its own: J.
    const india = await open(undefined, { context: { timezoneId: 'Asia/Kolkata' } });
    await expect(india.getByRole('button', { name: /^Time, / }), 'the user\'s setup, in another zone').toHaveAccessibleName(/^Time, local: \d{6}J /);
  });
});

base('the side panels start collapsed; a click on a panel\'s header expands it, and that is remembered after a reload (T-153; owner, 2026-11-10)', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ open }) => {
    const page = await open(keepCollapsed); // the specs' handler would expand them
    const headers = page.locator('section.panel > header .panel-toggle').filter({ visible: true });
    const states = () => headers.evaluateAll((all) => all.map((b) => `${b.textContent}: ${b.getAttribute('aria-expanded')}`));
    const expanded = async () => (await states()).filter((s) => !s.endsWith(': false'));
    expect((await states()).length, 'side panels shown').toBeGreaterThan(2);
    expect(await expanded(), 'every side panel collapsed').toEqual([]);
    const symbols = page.getByRole('complementary').getByRole('region', { name: 'Symbols', exact: true });
    const palette = symbols.getByRole('group', { name: 'Symbols' });
    await expect(palette, 'its content hidden').toBeHidden();
    const header = symbols.locator('header .panel-toggle');
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await expect(palette.getByRole('button', { name: 'Infantry', exact: true })).toBeVisible();
    expect(await expanded(), 'only that one').toEqual(['Symbols: true']);

    await new Promise((resolve) => setTimeout(resolve, 1_500)); // the setup is saved about once a second
    await page.reload();
    await expect(page.getByRole('status', { name: 'Live picture', includeHidden: true })).toHaveText('Live picture: connected');
    await expect(header, 'remembered').toHaveAttribute('aria-expanded', 'true');
    await expect(palette.getByRole('button', { name: 'Infantry', exact: true })).toBeVisible();
    expect(await expanded(), 'and still only that one').toEqual(['Symbols: true']);
  });
});
