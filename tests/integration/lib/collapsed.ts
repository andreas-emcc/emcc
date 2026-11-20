import { expect, type Locator, type Page } from '@playwright/test';

// Collapsed side panels and settings entries (T-153, T-161), for every spec's pages.

/** A side panel's header button, and a settings list entry's (T-161), while collapsed. */
const COLLAPSED = [
  'section.panel > header .panel-toggle[aria-expanded="false"]',
  'li.field-section > .field-section-toggle[aria-expanded="false"]',
].join(', ');
/** Per page: the handler's locator, or null once `keepCollapsed` stopped it. */
const expanding = new WeakMap<Page, Locator | null>();

/**
 * Side panels start collapsed (T-153), and so do a settings list's saved entries (T-161; owner,
 * 2026-11-10). The specs use their content as before: on a page opened with `openApp` (lib/m0)
 * or the fixtures' `page`, a collapsed side panel or settings entry that shows is expanded before
 * the spec's next action or assertion. It is a locator handler, so it works in every view, after a
 * reload and for panels that come later. The collapsed start itself is checked by `m2-workspace`
 * and `m4-fields`, with `keepCollapsed`.
 */
export async function expandWhenCollapsed(page: Page): Promise<void> {
  if (expanding.has(page)) return;
  const shown = page.locator(COLLAPSED).filter({ visible: true });
  const first = shown.first();
  expanding.set(page, first);
  // The click event on the button itself, not a pointer click: a view kept behind another (e.g.
  // View's panels behind Settings) counts as visible but takes no pointer. It never waits: just
  // after a load the panels show collapsed until the user's setup applies, and a button gone by
  // then would hold the page until the test ends.
  await page.addLocatorHandler(first, async () => {
    for (let n = 0; n < 50 && (await shown.count()) > 0; n++) {
      if (!(await shown.first().dispatchEvent('click', undefined, { timeout: 500 }).then(() => true, () => false))) break;
    }
  }, { noWaitAfter: true });
}

/**
 * Waits until the handler has expanded every collapsed side panel and settings entry that shows
 * (`openApp`): the handler's clicks have settled, so the spec's own waits do not race it, e.g. on a
 * server under load (criterion 22, q19). The assertion's own checks run the handler. Returns at
 * once after `keepCollapsed`.
 */
export async function settled(page: Page, timeout: number): Promise<void> {
  if (!expanding.get(page)) return;
  await expect(page.locator(COLLAPSED).filter({ visible: true }), 'the collapsed panels shown are expanded').toHaveCount(0, { timeout });
}

/**
 * Stops `expandWhenCollapsed` on this page for good (`openApp` then leaves it off too, e.g. in
 * withM0's `open` with `keepCollapsed` as its `beforeLoad`): collapsed panels and entries stay as
 * they are.
 */
export async function keepCollapsed(page: Page): Promise<void> {
  const first = expanding.get(page);
  expanding.set(page, null);
  if (first) await page.removeLocatorHandler(first);
}
