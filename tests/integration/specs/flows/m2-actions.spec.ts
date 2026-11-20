// Quick run: @settings @plugin-map-view-2d @plugin-draw-symbols @plugin-draw-shapes @plugin-coordinates @plugin-symbology
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createSymbol, seededLayer, type LiveClient } from '../../lib/live.mjs';
import {
  colourAround,
  drag,
  frameSymbol,
  FRIEND,
  HIGHLIGHT,
  HOSTILE,
  IDENTITY,
  mapCentre,
  nextEvent,
  positionAt,
  settle,
  userPause,
  withM0,
  type LonLat,
  type Point,
} from '../../lib/m0';
import { pickAt, viewport } from '../../lib/perf';

// The M2 actions in the browser (T-056 part 2; ADR-0032; plugins/map-view-2d/README.md "Selects
// objects", "Right-click menu"; web/shell/src/actions/, web/shell/src/layers/): selecting with
// clicks, Ctrl+click and a Ctrl+drag box, the right-click menu, the shared Delete of several in two
// browsers, and Settings › Layers raising a layer's objects. Each test has a server of its own.
// Without a GPU here: software mode.

test.describe.configure({ timeout: 120_000 });

const NEUTRAL = IDENTITY.neutral.colour;
const UNKNOWN = IDENTITY.unknown.colour;
/** The drawn circle's fill, opaque so that its pixels have exactly this colour. */
const SHAPE_FILL = [32, 192, 32] as const;
const NATO = (classification: string) => ({ policyIdentifier: { name: 'NATO' }, classification });

const offset = (p: Point, dx: number, dy: number): Point => ({ x: p.x + dx, y: p.y + dy });

type Placed = { at: Point; position: LonLat; id: string };
/**
 * Three symbols and a circle at fixed offsets from the map's centre, clear of the Map Pane's
 * controls and notices at the top right: A friend and B hostile above, C neutral and the circle S
 * below. `rim` is a point on the circle's outline (an area is picked there only, T-102), `empty` a point on empty map.
 */
type Scene = { a: Placed; b: Placed; c: Placed; s: Placed; rim: Point; empty: Point; centre: Point; layer: string };

function circleShape(layerId: string, center: LonLat, radius: number) {
  return {
    requestId: randomUUID(),
    entityType: 'object',
    operation: 'create',
    entityId: randomUUID(),
    data: {
      type: 'core.shape',
      dataType: 'core.general',
      dataSource: 'manual',
      layerId,
      geometry: { type: 'Circle', center, radius },
      style: { strokeColor: '#106010', strokeWidth: 2, fillColor: '#20C020', fillOpacity: 1 },
      properties: { name: 'ITA circle' },
      label: NATO('UNCLASSIFIED'),
    },
    source: { plugin: 'ita-test' },
  };
}

async function created(live: LiveClient, request: { entityId: string }): Promise<string> {
  const outcome = await live.change(request);
  expect(outcome.outcome, JSON.stringify(outcome.rejection ?? '')).toBe('applied');
  return request.entityId;
}

async function scene(page: Page, live: LiveClient, snapshot: unknown): Promise<Scene> {
  const layer = seededLayer(snapshot);
  const centre = await mapCentre(page);
  const at = { a: offset(centre, -180, -40), b: offset(centre, -60, -40), c: offset(centre, -180, 110), s: offset(centre, 60, 120) };
  const position = {
    a: await positionAt(page, at.a),
    b: await positionAt(page, at.b),
    c: await positionAt(page, at.c),
    s: await positionAt(page, at.s),
  };
  // A radius of 25 px: the map view's resolution is ground metres per pixel at the map's centre
  // (SDK Viewport), scaled to the circle's latitude (Web Mercator).
  const { resolution, center } = await viewport(page);
  const radius = Math.round((25 * resolution * Math.cos((position.s[1] * Math.PI) / 180)) / Math.cos((center[1] * Math.PI) / 180));
  const ids = {
    a: await created(live, frameSymbol(layer, position.a, 'friend')),
    b: await created(live, frameSymbol(layer, position.b, 'hostile')),
    c: await created(live, frameSymbol(layer, position.c, 'neutral')),
    s: await created(live, circleShape(layer, position.s, radius)),
  };
  await drawn(page, [[at.a, FRIEND], [at.b, HOSTILE], [at.c, NEUTRAL], [at.s, SHAPE_FILL]]);
  const placed = (k: 'a' | 'b' | 'c' | 's'): Placed => ({ at: at[k], position: position[k], id: ids[k] });
  // The circle is picked on its outline only (T-102): `rim` is on it, 25 px east of its centre.
  return { a: placed('a'), b: placed('b'), c: placed('c'), s: placed('s'), rim: offset(at.s, 25, 0), empty: offset(centre, 130, 170), centre, layer };
}

async function drawn(page: Page, items: Array<[Point, readonly number[]]>) {
  for (const [point, colour] of items) {
    await expect.poll(() => colourAround(page, point, colour), { timeout: 10_000, message: `drawn at ${point.x}, ${point.y}` }).toBeGreaterThan(50);
  }
}

/** The shared selection (`MapView.selection`), sorted. */
function selection(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window as unknown as { __itaProbe: { mapView: { selection: { value: readonly string[] } } } }).__itaProbe.mapView.selection.value].sort());
}
const sorted = (...ids: string[]) => [...ids].sort();

async function click(page: Page, p: Point) {
  await page.mouse.click(p.x, p.y);
  await userPause(page);
}

// Ctrl, as on Windows and Linux where the suite runs; on a Mac the map view takes Cmd instead.
async function ctrlClick(page: Page, p: Point) {
  await page.keyboard.down('Control');
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Control');
  await userPause(page);
}

/** Ctrl+drag: a box that replaces the selection. */
async function ctrlBox(page: Page, from: Point, to: Point) {
  await page.keyboard.down('Control');
  await drag(page, from, to);
  await page.keyboard.up('Control');
  await userPause(page);
}

/** Right-clicks and returns the shell's "Actions" menu with its entries' labels, once it has read the objects. */
async function menuAt(page: Page, p: Point) {
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Actions' });
  await expect(menu.getByRole('menuitem').first()).toBeVisible();
  return { menu, labels: (await menu.getByRole('menuitem').allTextContents()).map((t) => t.trim()) };
}

async function closeMenu(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
}

test('selection on the map: a click selects one, Ctrl+click adds and removes, a Ctrl+drag box selects symbols and shapes, a click on empty map and Escape clear it', async ({
  browser,
}, testInfo) => {
  await withM0(
    testInfo,
    browser,
    async ({ live, snapshot, open }) => {
      const page = await open();
      const s = await scene(page, live, snapshot);

      await click(page, s.a.at);
      await expect.poll(() => selection(page)).toEqual([s.a.id]);
      await expect.poll(() => colourAround(page, s.a.at, HIGHLIGHT, 32), { timeout: 10_000, message: 'A highlighted' }).toBeGreaterThan(20);
      await ctrlClick(page, s.b.at);
      await expect.poll(() => selection(page), { message: 'Ctrl+click adds' }).toEqual(sorted(s.a.id, s.b.id));
      await ctrlClick(page, s.a.at);
      await expect.poll(() => selection(page), { message: 'Ctrl+click on a selected one removes it' }).toEqual([s.b.id]);
      await click(page, s.empty);
      await expect.poll(() => selection(page), { message: 'a click on empty map clears' }).toEqual([]);

      // A box around A and C (not B, which is to the right of it).
      await ctrlBox(page, offset(s.centre, -230, -90), offset(s.centre, -130, 160));
      await expect.poll(() => selection(page), { message: 'the box A, C' }).toEqual(sorted(s.a.id, s.c.id));
      // A box around C and the whole circle replaces it (a shape counts by its outline).
      await ctrlBox(page, offset(s.centre, -230, 60), offset(s.centre, 120, 170));
      await expect.poll(() => selection(page), { message: 'the box C, S replaces it' }).toEqual(sorted(s.c.id, s.s.id));
      await page.keyboard.press('Escape');
      await expect.poll(() => selection(page), { message: 'Escape clears' }).toEqual([]);
    },
    { probe: true },
  );
});

test('the right-click menu: an unselected object becomes the selection, with Edit; a selected one acts on the whole mixed selection, without Edit; overlapping objects ask which; Centre map and Centre on move the map', async ({
  browser,
}, testInfo) => {
  await withM0(
    testInfo,
    browser,
    async ({ live, snapshot, open }) => {
      const page = await open();
      const s = await scene(page, live, snapshot);
      const objectActions = ['Centre on object(s)', 'Zoom to object(s)', 'Delete'];

      // On an object that is not selected: it alone becomes the selection; Edit is offered for one.
      let { labels } = await menuAt(page, s.a.at);
      await expect.poll(() => selection(page)).toEqual([s.a.id]);
      expect(labels).toEqual(expect.arrayContaining([...objectActions, 'Edit']));
      expect(labels, 'no map actions on an object').not.toContain('Centre map');
      await closeMenu(page);
      // On the shape alone: draw-shapes' Edit for one shape.
      ({ labels } = await menuAt(page, s.rim));
      await expect.poll(() => selection(page)).toEqual([s.s.id]);
      expect(labels).toEqual(expect.arrayContaining([...objectActions, 'Edit']));
      await closeMenu(page);

      // A mixed selection (two symbols and a shape): the menu on a selected one acts on all three.
      await ctrlBox(page, offset(s.centre, -230, 60), offset(s.centre, 120, 170));
      await ctrlClick(page, s.b.at);
      const three = sorted(s.b.id, s.c.id, s.s.id);
      await expect.poll(() => selection(page)).toEqual(three);
      ({ labels } = await menuAt(page, s.c.at));
      expect(await selection(page), 'the selection stays').toEqual(three);
      expect(labels).toEqual(expect.arrayContaining(objectActions));
      expect(labels, 'Edit takes one object only').not.toContain('Edit');
      await closeMenu(page);
      await click(page, s.empty);

      // Two objects at one point, neither selected: the user chooses one, which is then selected.
      const x = offset(s.centre, -60, 110);
      const position = await positionAt(page, x);
      const upper = createSymbol(s.layer, 0, { name: 'ITA upper' });
      const lower = createSymbol(s.layer, 0, { name: 'ITA lower' });
      for (const r of [lower, upper]) {
        r.data.geometry.coordinates = position;
        r.data.symbol = { standard: 'APP-6D', sidc: `100${IDENTITY.unknown.code}1000000000000000` };
        await created(live, r);
      }
      await drawn(page, [[x, UNKNOWN]]);
      // Both held by the map (it may draw the second a moment after the first).
      await expect.poll(async () => [...(await pickAt(page, x))].sort(), { timeout: 10_000 }).toEqual(sorted(upper.entityId, lower.entityId));
      await page.mouse.click(x.x, x.y, { button: 'right' });
      const choice = page.getByRole('menu', { name: 'Choose an object' });
      await expect(choice.getByRole('menuitem')).toHaveCount(2);
      await expect(choice).toContainText('ITA upper');
      await choice.getByRole('menuitem').filter({ hasText: 'ITA lower' }).click();
      await expect.poll(() => selection(page), { message: 'the chosen one is selected' }).toEqual([lower.entityId]);
      await expect(page.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: 'Edit' })).toBeVisible();
      await closeMenu(page);

      // On empty map: Centre map moves that point to the centre (B moves by the same amount).
      ({ labels } = await menuAt(page, s.empty));
      expect(labels).toContain('Centre map');
      expect(labels, 'no object actions on empty map').not.toContain('Delete');
      await page.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: 'Centre map' }).click();
      const b = offset(s.b.at, s.centre.x - s.empty.x, s.centre.y - s.empty.y);
      await expect.poll(() => colourAround(page, b, HOSTILE), { timeout: 10_000, message: 'B moved with the map' }).toBeGreaterThan(50);
      await userPause(page);

      // Centre on object(s) for B alone: B is at the centre.
      await menuAt(page, b);
      await expect.poll(() => selection(page)).toEqual([s.b.id]);
      await page.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: 'Centre on object(s)' }).click();
      await expect.poll(() => colourAround(page, s.centre, HOSTILE), { timeout: 10_000, message: 'B at the centre' }).toBeGreaterThan(50);
    },
    { probe: true },
  );
});

test('the shared Delete of a mixed selection of 3: it asks first, Cancel keeps them, Delete removes them in this and a second browser, and says so', async ({
  browser,
}, testInfo) => {
  await withM0(
    testInfo,
    browser,
    async ({ live, snapshot, open }) => {
      const page = await open();
      const s = await scene(page, live, snapshot);
      const other = await open();
      await drawn(other, [[s.a.at, FRIEND], [s.b.at, HOSTILE], [s.c.at, NEUTRAL], [s.s.at, SHAPE_FILL]]);

      await ctrlBox(page, offset(s.centre, -230, 60), offset(s.centre, 120, 170));
      await ctrlClick(page, s.a.at);
      const three = sorted(s.a.id, s.c.id, s.s.id);
      await expect.poll(() => selection(page)).toEqual(three);

      const ask = async () => {
        await menuAt(page, s.a.at);
        await page.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: 'Delete' }).click();
        const question = page.getByRole('alertdialog', { name: 'Delete objects' });
        await expect(question).toContainText('Delete 3 objects? This cannot be undone.');
        return question;
      };
      let question = await ask();
      await question.getByRole('button', { name: 'Cancel' }).click();
      await expect(question).toBeHidden();
      const before = await settle(live, s.layer);
      expect(before.filter((e) => e.operation === 'delete'), 'nothing deleted after Cancel').toEqual([]);
      expect(await selection(page)).toEqual(three);

      question = await ask();
      await question.getByRole('button', { name: 'Delete 3 objects' }).click();
      for (const id of three) await nextEvent(live, (e) => e.entityId === id && e.operation === 'delete');
      await expect(page.getByRole('list', { name: 'Notifications' })).toContainText('Deleted 3 objects.');
      await expect.poll(() => selection(page), { message: 'the deleted ids leave the selection' }).toEqual([]);

      for (const shown of [page, other]) {
        for (const [p, colour] of [[s.a.at, FRIEND], [s.c.at, NEUTRAL], [s.s.at, SHAPE_FILL]] as const) {
          await expect.poll(() => colourAround(shown, p, colour), { timeout: 10_000, message: 'gone from the map' }).toBe(0);
        }
        expect(await colourAround(shown, s.b.at, HOSTILE), 'B stays').toBeGreaterThan(50);
      }
      const after = await settle(live, s.layer);
      expect(after.filter((e) => e.operation === 'delete').map((e) => e.entityId).sort(), 'exactly the three').toEqual(three);
    },
    { probe: true },
  );
});

test("Settings › Layers: a layer's classification raised with its lower objects; higher ones and another policy's are left alone, and the summary says so", async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const layer = seededLayer(snapshot);
    const objectWith = (label: object) => {
      const r = createSymbol(layer, 0);
      r.data.label = label;
      return r;
    };
    const lower = objectWith(NATO('UNCLASSIFIED'));
    const higher = objectWith(NATO('SECRET'));
    const otherPolicy = objectWith({ policyIdentifier: { name: 'EU' }, classification: 'RESTRICTED' });
    for (const r of [lower, higher, otherPolicy]) await created(live, r);

    const page = await open();
    await page.goto('/#settings/layers');
    const card = page.getByRole('article', { name: 'Drawing' });
    await expect(card).toContainText('NATO UNCLASSIFIED · 3 objects');
    await card.getByLabel('Classification').selectOption('CONFIDENTIAL');
    await card.getByRole('checkbox', { name: 'Also raise objects below it' }).check();
    await card.getByRole('button', { name: 'Apply' }).click();
    const question = page.getByRole('alertdialog', { name: 'Change layer classification' });
    await expect(question).toContainText('Change the layer Drawing from UNCLASSIFIED to CONFIDENTIAL, and raise its objects?');
    await expect(question).toContainText('The layer has 3 objects');
    await question.getByRole('button', { name: 'Change and raise' }).click();

    const layerChanged = await nextEvent(live, (e) => e.entityId === layer && e.operation === 'update');
    expect(layerChanged.state.label).toEqual(NATO('CONFIDENTIAL'));
    const raised = await nextEvent(live, (e) => e.entityId === lower.entityId && e.operation === 'update');
    expect(raised.state.label).toEqual(NATO('CONFIDENTIAL'));
    const { label: _was, ...rest } = lower.data;
    expect(raised.state, 'only the classification changes').toMatchObject(rest);
    expect(Object.keys(raised.state).filter((k) => !['id', 'version', 'meta', 'label'].includes(k)).sort(), 'no field added').toEqual(Object.keys(rest).sort());
    await expect(page.getByRole('list', { name: 'Notifications' })).toContainText(
      'The layer Drawing is now CONFIDENTIAL. Raised 1 object; 1 already CONFIDENTIAL or higher; 1 left alone (another policy, or a classification outside the order).',
    );
    await expect(card).toContainText('NATO CONFIDENTIAL · 3 objects');
    const updates = (await settle(live, layer)).filter((e) => e.operation === 'update').map((e) => e.entityId);
    expect(updates.sort(), 'the layer and the lower object only').toEqual(sorted(layer, lower.entityId));
  });
});
