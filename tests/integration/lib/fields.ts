import { expect, type Locator, type Page } from '@playwright/test';
import type { LiveClient } from './live.mjs';
import { colourAround, frameSymbol, FRIEND, HOSTILE, positionAt, userPause, type Point } from './m0';

// Helpers for the field-set flows (m4-fields, m6-field-sets): the change requests a page sends,
// "Symbol properties" and the SDK's field-set editor (DeclaredFields; SDK 1.5.0, ADR-0054 point 5).

export type State = Record<string, any>;
export type Request = { requestId: string; entityType: string; operation: string; entityId: string; data?: State; fields?: Array<{ plugin: string; name: string; value: unknown }> };

/** The change requests a page sends over its live picture connection, in order. */
export function watchRequests(page: Page): Request[] {
  const sent: Request[] = [];
  page.on('websocket', (socket) =>
    socket.on('framesent', (frame) => {
      try {
        const message = JSON.parse(String(frame.payload));
        if (message.type === 'change-request') sent.push(message.request);
      } catch {
        // not JSON: not a change request
      }
    }),
  );
  return sent;
}

/** Sends the request and resolves with the stored state; fails unless it is applied. */
export async function applied(client: LiveClient, request: Request): Promise<State> {
  const outcome = await client.change(request);
  expect(outcome, `${request.entityType} ${request.operation}: ${JSON.stringify(outcome.rejection ?? '')}`).toMatchObject({ outcome: 'applied' });
  return outcome.event.state;
}

/**
 * The sensor report symbol (SDK 1.5.0 part 3; map-view-2d function 39, symbology function 16) at
 * symbology's defaults: a 10 px orange dot with a black outline, about 52 orange pixels. A data type
 * with `sensorReport: true` (gmti.detection) is drawn with it instead of its APP-6 symbol.
 */
export const SENSOR_REPORT = [255, 128, 0] as const;

/**
 * A symbol at a pixel of the map, waited for until it is drawn: cot's Team if given (set through
 * `fields`, ADR-0038), and `data` merged into the request's content (e.g. a data type). It is
 * looked for in its identity's colour, or in `drawnAs` (e.g. SENSOR_REPORT for a gmti.detection).
 */
export async function symbolAt(
  page: Page,
  live: LiveClient,
  layerId: string,
  at: Point,
  identity: 'friend' | 'hostile',
  options: { team?: string; data?: State; drawnAs?: typeof SENSOR_REPORT } = {},
): Promise<string> {
  const request = frameSymbol(layerId, await positionAt(page, at), identity) as Request;
  if (options.team !== undefined) request.fields = [{ plugin: 'cot', name: 'team', value: options.team }];
  Object.assign(request.data!, options.data ?? {});
  await applied(live, request);
  const colour = options.drawnAs ?? (identity === 'friend' ? FRIEND : HOSTILE);
  // A frame symbol has hundreds of pixels of its colour, a sensor report about 52.
  const least = options.drawnAs === undefined ? 50 : 30;
  await expect.poll(() => colourAround(page, at, colour), { timeout: 10_000, message: 'the symbol is drawn' }).toBeGreaterThan(least);
  return request.entityId;
}

/** "Symbol properties": the plugin's frame inside the shell's panel of the same name. */
export function properties(page: Page): Locator {
  return page.getByRole('region', { name: 'Symbol properties', exact: true }).last();
}

/** The Symbols panel: the plugin's frame inside the shell's panel of the same name. */
export function symbolsPanel(page: Page): Locator {
  return page.getByRole('region', { name: 'Symbols', exact: true }).last();
}

/** Selects the symbol at the pixel with a click on the map, until "Symbol properties" shows it. */
export async function select(page: Page, at: Point): Promise<void> {
  await expect(async () => {
    await page.mouse.click(at.x, at.y);
    await userPause(page);
    await expect(properties(page).getByLabel('Name', { exact: true })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/** The label of a select's chosen option. */
export function chosen(select: Locator): Locator {
  return select.locator('option:checked');
}

/** The updates the page sent for an object after `from`, waited for until there are `count`. */
export async function updatesOf(sent: Request[], from: number, id: string, count = 1): Promise<Request[]> {
  await expect.poll(() => sent.slice(from).filter((r) => r.entityId === id).length, { message: `${count} update(s) of ${id}` }).toBeGreaterThanOrEqual(count);
  return sent.slice(from).filter((r) => r.entityId === id);
}

/**
 * The field-set editor in a panel (SDK 1.5.0, ADR-0054 point 5): the drop-down "Field set" of the
 * object's sets, the "+" ("Add a field set") with its menu of the sets it lacks, and the chosen
 * set's group (named by the set's label, `data-set` its id, `data-carried` false when "(not added)").
 */
export function fieldSets(panel: Locator) {
  const page = panel.page();
  return {
    list: panel.getByRole('combobox', { name: 'Field set', exact: true }),
    plus: panel.getByRole('button', { name: 'Add a field set', exact: true }),
    /** The "+"'s menu, once open (a popover: looked for on the whole page). */
    menu: page.getByRole('menu', { name: 'Field sets to add', exact: true }),
    /** The chosen set's group. */
    group: panel.locator('.emc2-fields-set[role="group"]'),
  };
}

/**
 * The labels the "+"'s menu offers: opens it, reads them and closes it again with the "+" (not
 * Escape, which the shell may take as "deselect" as well).
 */
export async function addable(panel: Locator): Promise<string[]> {
  const sets = fieldSets(panel);
  await sets.plus.click();
  await expect(sets.menu).toBeVisible();
  const labels = await sets.menu.getByRole('menuitem').allTextContents();
  await sets.plus.click();
  await expect(sets.menu).toBeHidden();
  return labels.map((l) => l.trim());
}

/** Adds a set through the "+"'s menu, by its label. */
export async function addSet(panel: Locator, label: string): Promise<void> {
  const sets = fieldSets(panel);
  await sets.plus.click();
  await sets.menu.getByRole('menuitem', { name: label, exact: true }).click();
  await expect(sets.menu).toBeHidden();
}
