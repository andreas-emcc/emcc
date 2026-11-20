// Quick run: @login @plugin-map-view-2d @plugin-gmti
import { expect, test, type Page } from '@playwright/test';
import { useTestRealm, withLoginServer } from '../../lib/login';
import { mapPane } from '../../lib/m0';

// M7, T-182 (SDK 1.6.0 part D; map-view-2d function 40): the Display window's "Areas" (Dwell areas,
// Sensor coverage) are each user's own display choice. With login against a real Keycloak (no-login
// mode has one local user only, so flows/m7-display cannot show it): the viewer switches Dwell areas
// off; the drawer still has both on, in the browser and in /api/display. Runs only with
// run.mjs --keycloak.

const realm = useTestRealm();

async function areas(page: Page) {
  await mapPane(page).getByRole('button', { name: 'Display settings', exact: true }).click();
  const window = page.getByRole('dialog', { name: 'Display settings', exact: true });
  await expect(window).toBeVisible();
  const region = window.getByRole('region', { name: 'Areas', exact: true });
  return {
    dwell: region.getByRole('checkbox', { name: 'Dwell areas', exact: true }),
    coverage: region.getByRole('checkbox', { name: 'Sensor coverage', exact: true }),
  };
}

test('the Display window\'s Areas with login (T-182): one user\'s "Dwell areas" off is that user\'s own; another user keeps both on, also after a reload', async ({ browser }, testInfo) => {
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const viewer = await run.logIn('viewer');
    const drawer = await run.logIn('drawer');
    const classesOf = async (context: typeof viewer.context) => {
      const response = await run.api(context, '/api/display');
      expect(response.status, 'GET /api/display').toBe(200);
      const classes = (await response.json()).choices?.classes; // the user's own choices; absent is on
      return { dwell: classes?.['dwell-area'] ?? true, coverage: classes?.['sensor-coverage'] ?? true };
    };

    const mine = await areas(viewer.page);
    await expect(mine.dwell, 'on by default').toBeChecked();
    await expect(mine.coverage).toBeChecked();
    await mine.dwell.uncheck();
    await expect.poll(() => classesOf(viewer.context), { message: 'the viewer\'s choice stored' }).toEqual({ dwell: false, coverage: true });

    expect(await classesOf(drawer.context), 'the drawer\'s choice untouched').toEqual({ dwell: true, coverage: true });
    await drawer.page.reload();
    const theirs = await areas(drawer.page);
    await expect(theirs.dwell, 'the drawer still sees dwell areas').toBeChecked();
    await expect(theirs.coverage).toBeChecked();

    await viewer.page.reload();
    const again = await areas(viewer.page);
    await expect(again.dwell, 'the viewer\'s stays off after a reload').not.toBeChecked();
    await expect(again.coverage).toBeChecked();
  });
});
