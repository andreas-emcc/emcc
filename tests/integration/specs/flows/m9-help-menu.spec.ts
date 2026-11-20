// Quick run: @always
import { expect, test } from '../../fixtures';

// The help menu of M9 RC2 (owner ACQ, 2026-11-18) in a developer run, on the run's shared server (no release, so no
// version.properties and no manual/): GET /api/health's "version" is {name: "dev", sdk} and "manual" false, GET
// /manual/ is 404; the shell's "?" button (named "Help", web/shell/src/ui/HelpMenu.tsx) opens the Help popover with
// the line "emcc · dev build · SDK <sdk>" (help.ts) and its one item greyed out as "Manual not installed". The
// release's side is release/help-menu.spec.ts's.

test('a developer run: GET /api/health\'s version is "dev" with the SDK and manual false; the "?" menu shows "emcc · dev build · SDK …" and "Manual not installed", disabled (M9 RC2, owner ACQ)', async ({ page, request }) => {
  const health = await (await request.get('/api/health')).json();
  test.info().annotations.push({ type: 'GET /api/health', description: JSON.stringify(health) });
  expect(health.version, 'no version.properties: "dev" and the SDK').toEqual({ name: 'dev', sdk: expect.stringMatching(/^\d+\.\d+\.\d+$/) });
  expect(health.manual, 'no manual/ folder').toBe(false);
  expect((await request.get('/manual/', { maxRedirects: 0 })).status(), 'GET /manual/ without the folder').toBe(404);

  await page.goto('/');
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const popover = page.getByRole('dialog', { name: 'Help' });
  const menu = popover.getByRole('menu', { name: 'Help' });
  await expect(menu).toBeVisible();
  await expect(popover.locator('.help-version'), 'the version line').toHaveText(`emcc · dev build · SDK ${health.version.sdk}`);
  test.info().annotations.push({ type: 'the "?" menu', description: (await popover.innerText()).replace(/\s+/g, ' ').trim() });
  await expect(menu.getByRole('menuitem'), 'one item').toHaveCount(1);
  const manual = menu.getByRole('menuitem', { name: 'Manual not installed', exact: true });
  await expect(manual, '"Manual" greyed out').toBeDisabled();

  // Disabled: a click opens no tab.
  let opened = false;
  page.context().once('page', () => (opened = true));
  await manual.click({ force: true });
  await page.waitForTimeout(500);
  expect(opened, 'no new tab').toBe(false);

  // Escape closes it.
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
});
