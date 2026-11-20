// Quick run: @login @plugin-bookmarks
import { expect, test, type Page } from '@playwright/test';
import { expectNoFailures, openBookmarks, treeNames, watchFailures, type Failures } from '../../lib/bookmarks';
import { logInAt, useTestRealm, withLoginServer, type LoginRun, type UserKey } from '../../lib/login';
import { openApp } from '../../lib/m0';

// bookmarks with login against a real Keycloak (T-056 part 5; docs/plugins/briefs/bookmarks.md,
// function 6 and acceptance criterion 4): each user's tree is that user's own document (ADR-0027
// point 2). Runs only with run.mjs --keycloak.

const realm = useTestRealm();

/** Logs the user in in a new browser, watched for failed responses from before the app loads. */
async function logInWatched(run: LoginRun, user: UserKey, failures: Failures) {
  const context = await run.newContext();
  const page = await context.newPage();
  watchFailures(page, failures);
  await logInAt(page, run.realm, user, run.server.baseUrl);
  await openApp(page);
  return { context, page };
}

async function addBookmark(page: Page, name: string) {
  const menu = await openBookmarks(page);
  await menu.getByRole('button', { name: 'Add bookmark' }).click();
  await menu.getByLabel('Name').fill(name);
  await menu.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(menu.getByRole('treeitem', { name })).toBeVisible();
  await page.keyboard.press('Escape');
}

/** The names the menu shows when it opens (it reads the document again each time). */
async function shownNames(page: Page): Promise<string[]> {
  await openBookmarks(page);
  const names = await treeNames(page);
  await page.keyboard.press('Escape');
  return names;
}

test('criterion 4: a user\'s bookmarks appear in a second browser of that user, and never for another user', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const failures: Failures = { responses: [] };
  await withLoginServer(
    testInfo,
    browser,
    realm(),
    async (run) => {
      const drawer = await logInWatched(run, 'drawer', failures);
      await addBookmark(drawer.page, "The drawer's view");

      // A second browser of the same user, loaded afresh.
      const again = await logInWatched(run, 'drawer', failures);
      expect(await shownNames(again.page), 'the drawer in a second browser').toEqual(["The drawer's view"]);

      // Another user sees none of them, and keeps its own.
      const viewer = await logInWatched(run, 'viewer', failures);
      expect(await shownNames(viewer.page), 'the viewer sees none of the drawer\'s').toEqual([]);
      await addBookmark(viewer.page, "The viewer's view");
      expect(await shownNames(viewer.page)).toEqual(["The viewer's view"]);
      // The drawer's menu reads the document again when it opens: still only the drawer's.
      expect(await shownNames(drawer.page), 'the drawer does not see the viewer\'s').toEqual(["The drawer's view"]);

      // The server keeps them apart: each user's document holds only that user's bookmark.
      const tree = async (context: typeof drawer.context) => (await run.api(context, '/api/user-documents/bookmarks/tree')).text();
      const drawers = await tree(drawer.context);
      const viewers = await tree(viewer.context);
      expect(drawers).toContain("The drawer's view");
      expect(drawers).not.toContain("The viewer's view");
      expect(viewers).toContain("The viewer's view");
      expect(viewers).not.toContain("The drawer's view");

      expectNoFailures(failures);
    },
  );
});
