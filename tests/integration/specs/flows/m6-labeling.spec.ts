// Quick run: @settings
import { expect, test, type Page } from '@playwright/test';
import { withM0 } from '../../lib/m0';

// Settings › Labeling (T-170, round 3b: way C, one section per policy, highest classification first;
// web/shell/src/ui/settings/labeling/, server/README.md "Premade security labels"): an admin makes
// premade security labels from a policy, a classification and Releasable To values; nothing is sent
// before the one Save, and a reload shows what was saved. The SWE policy has two sections, its
// Swedish national classifications and NATO's (labeling-definitions.json). In M6 the labels are
// cosmetic and connected to nothing (owner, 2026-11-10). A non-admin's 403:
// specs/keycloak/m6-rights.spec.ts. Each test has a server of its own (the labels are stored).
// The entry is being iterated with the owner (T-170 rounds): its texts may still change.

const SEP = '·';
const NATO_ORDER = ['COSMIC TOP SECRET', 'SECRET', 'CONFIDENTIAL', 'RESTRICTED', 'UNCLASSIFIED'];
const SWE_ORDER = ['KVALIFICERAT HEMLIG', 'HEMLIG', 'KONFIDENTIELL', 'BEGRÄNSAT HEMLIG', 'EJ SEKRETESS'];

async function openLabeling(page: Page) {
  await page.goto('/#settings/labeling');
  const entry = page.getByRole('region', { name: 'Labeling', exact: true });
  await expect(entry.getByRole('region', { name: 'NATO', exact: true })).toBeVisible();
  return {
    entry,
    nato: entry.getByRole('region', { name: 'NATO', exact: true }),
    swe: entry.getByRole('region', { name: 'SWE', exact: true }),
    save: entry.getByRole('button', { name: 'Save', exact: true }),
  };
}

async function stored(page: Page) {
  const response = await page.request.get('/api/settings/labeling');
  expect(response.status()).toBe(200);
  return response.json();
}

async function saved(page: Page, ui: Awaited<ReturnType<typeof openLabeling>>) {
  // The surface's pinned foot counts what is unsaved (T-203 part C: "1 unsaved change").
  await expect(ui.entry.getByRole('group', { name: 'Panel actions' }).getByRole('status')).toHaveText(/^\d+ unsaved changes?$/);
  await ui.save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await expect(ui.save, 'nothing left to save').toBeDisabled();
}

const releasable = (values: string[]) => [{ tagName: 'Releasable To', type: 'permissive', values }];

test('an admin adds a label from a classification and Releasable To values, edits it and deletes it; nothing is sent before Save, and each Save is kept after a reload', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ open }) => {
    const page = await open();
    let ui = await openLabeling(page);
    expect(await stored(page), 'none yet').toEqual({ policies: {} });

    // Two Releasable To values for NATO.
    for (const value of ['SWE', 'NOR']) {
      await ui.nato.getByRole('button', { name: '+ Add a value', exact: true }).click();
      await ui.nato.getByRole('combobox', { name: 'New value', exact: true }).fill(value);
      await ui.nato.getByRole('group', { name: 'New value', exact: true }).getByRole('button', { name: 'Add', exact: true }).click();
      await expect(ui.nato.getByRole('button', { name: `${value}: rename or remove`, exact: true })).toBeVisible();
    }

    // A new label: NATO SECRET, released to SWE.
    await ui.nato.getByRole('button', { name: '+ New label', exact: true }).click();
    let editor = ui.nato.getByRole('group', { name: 'New label', exact: true });
    await editor.getByRole('combobox', { name: 'Classification', exact: true }).selectOption('SECRET');
    await editor.getByRole('button', { name: 'SWE', exact: true }).click();
    await expect(editor.getByRole('button', { name: 'SWE', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(editor.getByRole('img', { name: `NATO SECRET ${SEP} REL TO SWE`, exact: true }), 'the preview').toBeVisible();
    await editor.getByRole('button', { name: 'Add label', exact: true }).click();
    await expect(ui.nato.getByRole('button', { name: `NATO SECRET ${SEP} REL TO SWE`, exact: true })).toBeVisible();
    expect(await stored(page), 'nothing sent before Save').toEqual({ policies: {} });
    await saved(page, ui);
    expect(await stored(page)).toEqual({
      policies: { NATO: { releasableTo: ['SWE', 'NOR'], labels: [{ policyIdentifier: { name: 'NATO' }, classification: 'SECRET', categories: releasable(['SWE']) }] } },
    });
    await page.reload();
    ui = await openLabeling(page);
    await expect(ui.nato.getByRole('button', { name: `NATO SECRET ${SEP} REL TO SWE`, exact: true }), 'kept after a reload').toBeVisible();

    // Edited: CONFIDENTIAL, released to SWE and NOR.
    await ui.nato.getByRole('button', { name: `NATO SECRET ${SEP} REL TO SWE`, exact: true }).click();
    editor = ui.nato.getByRole('group', { name: 'Edit label', exact: true });
    await editor.getByRole('combobox', { name: 'Classification', exact: true }).selectOption('CONFIDENTIAL');
    await editor.getByRole('button', { name: 'NOR', exact: true }).click();
    await editor.getByRole('button', { name: 'Change label', exact: true }).click();
    await saved(page, ui);
    expect((await stored(page)).policies.NATO.labels).toEqual([{ policyIdentifier: { name: 'NATO' }, classification: 'CONFIDENTIAL', categories: releasable(['SWE', 'NOR']) }]);
    await page.reload();
    ui = await openLabeling(page);
    await expect(ui.nato.getByRole('button', { name: `NATO CONFIDENTIAL ${SEP} REL TO SWE, NOR`, exact: true }), 'the edit kept after a reload').toBeVisible();
    await expect(ui.nato.getByRole('button', { name: `NATO SECRET ${SEP} REL TO SWE`, exact: true })).toHaveCount(0);

    // Deleted, after the question.
    await ui.nato.getByRole('button', { name: `NATO CONFIDENTIAL ${SEP} REL TO SWE, NOR`, exact: true }).click();
    await ui.nato.getByRole('button', { name: 'Delete label', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Delete this label?' }).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(ui.nato.getByRole('button', { name: `NATO CONFIDENTIAL ${SEP} REL TO SWE, NOR`, exact: true })).toHaveCount(0);
    await saved(page, ui);
    expect((await stored(page)).policies.NATO.labels ?? [], 'no label stored').toEqual([]);
    await page.reload();
    ui = await openLabeling(page);
    await expect(ui.nato.getByRole('button', { name: 'SWE: rename or remove', exact: true }), 'the values stay').toBeVisible();
    await expect(ui.nato.getByRole('button', { name: new RegExp(`^NATO .* ${SEP} REL TO`) }), 'the deletion kept after a reload').toHaveCount(0);
  });
});

test('the SWE policy has two sections, its Swedish national classifications and NATO\'s, each highest first; a SWE label takes a classification of either', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ open }) => {
    const page = await open();
    const ui = await openLabeling(page);

    await expect(ui.nato.getByRole('list', { name: 'Classifications, highest first', exact: true }).getByRole('listitem')).toHaveText(NATO_ORDER);
    await expect(ui.swe.getByRole('list', { name: 'Swedish national classifications, highest first', exact: true }).getByRole('listitem')).toHaveText(SWE_ORDER);
    await expect(ui.swe.getByRole('list', { name: 'NATO classifications, highest first', exact: true }).getByRole('listitem')).toHaveText(NATO_ORDER);

    // A new SWE label: the choice has both sections, the lowest of the first chosen at the start.
    await ui.swe.getByRole('button', { name: '+ New label', exact: true }).click();
    let editor = ui.swe.getByRole('group', { name: 'New label', exact: true });
    const classification = editor.getByRole('combobox', { name: 'Classification', exact: true });
    expect(await classification.locator('optgroup').evaluateAll((groups) => groups.map((g) => (g as HTMLOptGroupElement).label))).toEqual(['Swedish national', 'NATO']);
    await expect(classification.locator('optgroup').first().locator('option')).toHaveText(SWE_ORDER);
    await expect(classification.locator('optgroup').last().locator('option')).toHaveText(NATO_ORDER);
    await expect(classification).toHaveValue('EJ SEKRETESS');
    await classification.selectOption('HEMLIG');
    await editor.getByRole('button', { name: 'Add label', exact: true }).click();

    // And one with a NATO classification: it reads "SWE SECRET".
    await ui.swe.getByRole('button', { name: '+ New label', exact: true }).click();
    editor = ui.swe.getByRole('group', { name: 'New label', exact: true });
    await editor.getByRole('combobox', { name: 'Classification', exact: true }).selectOption('SECRET');
    await editor.getByRole('button', { name: 'Add label', exact: true }).click();

    await expect(ui.swe.getByRole('button', { name: 'SWE HEMLIG', exact: true })).toBeVisible();
    await expect(ui.swe.getByRole('button', { name: 'SWE SECRET', exact: true })).toBeVisible();
    await expect(ui.swe.getByRole('heading', { level: 4 }), 'the labels by section as well').toContainText(['Swedish national', 'NATO']);
    await saved(page, ui);
    expect((await stored(page)).policies.SWE.labels).toEqual(
      expect.arrayContaining([
        { policyIdentifier: { name: 'SWE' }, classification: 'HEMLIG' },
        { policyIdentifier: { name: 'SWE' }, classification: 'SECRET' },
      ]),
    );
  });
});

test('the server refuses what the entry would not send: a value twice, a classification the policy does not have; and stores nothing', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server }) => {
    const put = (body: unknown) => fetch(`${server.baseUrl}/api/settings/labeling`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let response = await put({ policies: { NATO: { releasableTo: ['SWE', 'SWE'] } } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ problems: [{ path: '/policies/NATO/releasableTo/1', problem: 'SWE is in the list already' }] });
    response = await put({ policies: { NATO: { releasableTo: [], labels: [{ policyIdentifier: { name: 'NATO' }, classification: 'HEMLIG' }] } } });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('HEMLIG is not one of NATO');
    expect(await (await fetch(`${server.baseUrl}/api/settings/labeling`)).json(), 'nothing stored').toEqual({ policies: {} });
  });
});
