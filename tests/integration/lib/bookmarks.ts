import { expect, type Page } from '@playwright/test';

// Helpers for the bookmarks specs (T-056 part 5): the top bar's menu, and a record of failed responses.

/** Opens the top bar's Bookmarks menu; resolves with it. */
export async function openBookmarks(page: Page) {
  await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Bookmarks' });
  await expect(menu.getByRole('button', { name: 'Add bookmark' })).toBeVisible();
  await expect(menu.getByText('Loading…')).toHaveCount(0);
  return menu;
}

/** The names in the open menu's tree (top level and opened folders), as shown. */
export async function treeNames(page: Page): Promise<string[]> {
  const items = page.getByRole('dialog', { name: 'Bookmarks' }).getByRole('tree', { name: 'Bookmarks' }).getByRole('treeitem');
  return (await items.allTextContents()).map((t) => t.trim());
}

/** A page's responses of 400 or more: none is expected (the plugin lists its documents before it reads one). */
export type Failures = { responses: string[] };

/** Records a page's responses of 400 or more. Call before the page loads. */
export function watchFailures(page: Page, failures: Failures): void {
  page.on('response', (r) => {
    if (r.status() >= 400) failures.responses.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
}

/** No response of 400 or more: since PCA-bookmarks lists first (2026-10-22), a user without bookmarks gets no 404 either. */
export function expectNoFailures(failures: Failures): void {
  expect(failures.responses, 'responses of 400 or more').toEqual([]);
}
