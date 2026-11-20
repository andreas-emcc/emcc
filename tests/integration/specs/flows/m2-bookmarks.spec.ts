// Quick run: @persistence @plugin-bookmarks @plugin-map-view-2d @plugin-coordinates
import { expect, test, type Page } from '@playwright/test';
import { expectNoFailures, openBookmarks, treeNames, watchFailures, type Failures } from '../../lib/bookmarks';
import { withM0, type LonLat } from '../../lib/m0';
import { viewport } from '../../lib/perf';

// bookmarks in the no-login mode (T-056 part 5; docs/plugins/briefs/bookmarks.md, acceptance
// criteria 9 and 12, and criterion 4's second browser of the same user; criterion 4 with two users
// is in specs/keycloak/bookmarks.spec.ts). The tree is the user's own document `bookmarks/tree`
// (ADR-0027), kept by the server. Without a GPU here: software mode.

test.describe.configure({ timeout: 180_000 });

type ProbeMap = { goTo(c: LonLat, r?: number): void };

/** Moves the map through `MapView.goTo` (the probe) and waits until it is there; resolves with the viewport. */
async function goTo(page: Page, center: LonLat, resolution: number) {
  const before = await viewport(page);
  await page.evaluate(([c, r]) => (window as unknown as { __itaProbe: { mapView: ProbeMap } }).__itaProbe.mapView.goTo(c, r), [center, resolution] as const);
  await expect
    .poll(async () => {
      const now = await viewport(page);
      return Math.max(Math.abs(now.center[0] - center[0]), Math.abs(now.center[1] - center[1])) < 1e-6 && now.resolution !== before.resolution;
    }, { timeout: 10_000, message: `the map at ${center}` })
    .toBe(true);
  return viewport(page);
}

const VIEW: { center: LonLat; resolution: number } = { center: [16.5, 59.25], resolution: 750 };
const NAME = 'ITA Mälaren';
const FOLDER = 'ITA folder';
const MINE = /bookmark|Mälaren|ITA folder/i;

/** What the page keeps in the browser: web storage, IndexedDB's databases, Cache Storage, cookies. */
async function browserStorage(page: Page) {
  return page.evaluate(async () => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
    databases: (await indexedDB.databases()).map((d) => d.name ?? ''),
    caches: await caches.keys(),
    cookies: document.cookie,
  }));
}

test('criteria 9 and 12: without login a bookmark and a folder are kept for the local user, also in a second browser and after a server restart, and go to the saved view; nothing is in browser storage or outside the plugin\'s document', async ({
  browser,
}, testInfo) => {
  const failures: Failures = { responses: [] };
  const watch = (p: Page) => watchFailures(p, failures);
  await withM0(
    testInfo,
    browser,
    async ({ server, open, restart }) => {
      const page = await open(watch);
      // The user's documents of every other namespace before: `core` and the running plugins with a web part.
      const documents = async (namespace: string) => ((await (await fetch(`${server.baseUrl}/api/user-documents/${namespace}`)).json()) as { names: string[] }).names;
      const plugins = ((await (await fetch(`${server.baseUrl}/api/plugins`)).json()) as Array<{ id: string; active: boolean; web: unknown }>)
        .filter((p) => p.active && p.web != null && p.id !== 'bookmarks')
        .map((p) => p.id);
      const listed = async () => Object.fromEntries(await Promise.all(plugins.map(async (id) => [id, await documents(id)] as const)));
      const othersBefore = await listed();

      const saved = await goTo(page, VIEW.center, VIEW.resolution);
      let menu = await openBookmarks(page);
      await expect(menu.getByText('No bookmarks yet')).toBeVisible();

      // Add the current view; the proposed name is its centre in the user's format (decimal degrees here).
      await menu.getByRole('button', { name: 'Add bookmark' }).click();
      const name = menu.getByLabel('Name');
      await expect(name, 'the centre is proposed as the name').toHaveValue(/59\.25\d*° N .*16\.5\d*° E/);
      await name.fill(NAME);
      await menu.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(menu.getByRole('tree', { name: 'Bookmarks' }).getByRole('treeitem', { name: NAME })).toBeVisible();
      await menu.getByRole('button', { name: 'New folder' }).click();
      await menu.getByLabel('Name').fill(FOLDER);
      await menu.getByRole('button', { name: 'Create folder' }).click();
      await expect.poll(() => treeNames(page)).toEqual([NAME, FOLDER]);
      await page.keyboard.press('Escape');

      // The server holds them as the plugin's one document (criterion 12: nothing outside its
      // namespace): no other plugin's documents changed, and none of the user's other documents
      // (the shell's `core` included) names the bookmark or the folder.
      expect(await documents('bookmarks'), 'one document: the tree').toEqual(['tree']);
      const tree = await (await fetch(`${server.baseUrl}/api/user-documents/bookmarks/tree`)).text();
      expect(tree).toContain(NAME);
      expect(tree).toContain(FOLDER);
      expect(await listed(), 'the other plugins\' documents are as before').toEqual(othersBefore);
      for (const namespace of ['core', ...plugins]) {
        for (const document of await documents(namespace)) {
          const text = await (await fetch(`${server.baseUrl}/api/user-documents/${namespace}/${document}`)).text();
          expect(text, `${namespace}/${document}`).not.toMatch(MINE);
        }
      }
      const expectNothingStored = async (shown: Page, when: string) => {
        const stored = await browserStorage(shown);
        testInfo.annotations.push({ type: `browser storage ${when}`, description: JSON.stringify(stored) });
        for (const [key, value] of [...stored.local, ...stored.session]) expect(`${key} ${value}`, `web storage ${when}`).not.toMatch(MINE);
        // Database and cache names only: no plugin keeps one today (the annotation shows them).
        expect([...stored.databases, ...stored.caches].filter((n) => MINE.test(n)), `IndexedDB and Cache Storage ${when}`).toEqual([]);
        expect(stored.cookies, `cookies ${when}`).not.toMatch(MINE);
      };
      await expectNothingStored(page, 'after saving');

      // A second browser of the same (local) user has them.
      const second = await open(watch);
      await openBookmarks(second);
      await expect.poll(() => treeNames(second), { message: 'the second browser' }).toEqual([NAME, FOLDER]);
      // The pages go before the server does (their reconnect attempts would be console errors).
      await second.close();
      await page.close();

      // Criterion 9: after a clean restart a new page has them, and the bookmark goes to the view.
      await restart();
      const after = await open(watch);
      await goTo(after, [5.25, 45.5], 5000);
      menu = await openBookmarks(after);
      await expect.poll(() => treeNames(after), { message: 'kept across the restart' }).toEqual([NAME, FOLDER]);
      await menu.getByRole('treeitem', { name: NAME }).click();
      await expect
        .poll(async () => {
          const [lon, lat] = (await viewport(after)).center;
          return Math.max(Math.abs(lon - saved.center[0]), Math.abs(lat - saved.center[1]));
        }, { timeout: 10_000, message: 'the saved centre' })
        .toBeLessThan(1e-6);
      expect(Math.abs((await viewport(after)).resolution / saved.resolution - 1), 'the saved zoom').toBeLessThan(0.001);
      await expectNothingStored(after, 'after the restart');

      expectNoFailures(failures);
      testInfo.annotations.push({ type: 'view', description: `saved ${JSON.stringify(saved.center)} at ${saved.resolution} m/px; restored ${JSON.stringify((await viewport(after)).center)} at ${(await viewport(after)).resolution}` });
    },
    { probe: true },
  );
});
