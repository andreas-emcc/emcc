// Quick run: @plugin-draw-shapes @plugin-map-view-2d @plugin-coordinates
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { seededLayer, type LiveClient } from '../../lib/live.mjs';
import { colourAround, drag, layerRequest, mapCentre, nextEvent, positionAt, settle, userPause, withM0, type LonLat, type Point } from '../../lib/m0';
import { mapPixel, viewport } from '../../lib/perf';

// draw-shapes in the real shell (T-056 part 3; docs/plugins/briefs/draw-shapes.md, acceptance
// criteria 1, 7, 9, 10 and 11; criterion 12 is in specs/keycloak/shapes.spec.ts). Every test has a
// server of its own. The server checks every change request against the schema and refuses an
// invalid one, so an applied create is schema-valid. Without a GPU here: software mode.

test.describe.configure({ timeout: 180_000 });

const MAGENTA = [255, 0, 255] as const;
const offset = (p: Point, dx: number, dy: number): Point => ({ x: p.x + dx, y: p.y + dy });

function shapesPanel(page: Page) {
  return page.getByRole('region', { name: 'Shapes', exact: true });
}

function editPanel(page: Page) {
  return page.getByRole('region', { name: 'Edit shape', exact: true });
}

/** The change requests a page sends over its live picture connection, in order. */
function watchRequests(page: Page): Array<{ requestId: string; entityType: string; operation: string; entityId: string; baseVersion?: number; data?: any }> {
  const sent: any[] = [];
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

type TimedWindow = Window & {
  __itaProbe?: { mapView: { pick(pixel: readonly [number, number], tolerance?: number): readonly string[] } };
  __itaLastInput?: number;
  __itaShown?: Promise<number>;
};

/** Before the app loads: records when the page last took a gesture's end (a pointer release or Enter), by the wall clock. */
async function watchLastInput(page: Page) {
  await page.addInitScript(() => {
    const w = window as TimedWindow;
    const note = () => {
      w.__itaLastInput = Date.now();
    };
    window.addEventListener('pointerup', note, true);
    window.addEventListener('keydown', (e) => e.key === 'Enter' && note(), true);
  });
}

/**
 * In the page, frame by frame: `__itaShown` resolves with the wall clock time by which the map has
 * drawn a new object at a page pixel. MapView.pick reads the map view's data and drawing can take a
 * frame longer, so it resolves two frames after pick first finds it: the frame with it is then drawn.
 */
async function watchShown(page: Page, at: Point, tolerance: number) {
  const pixel = await mapPixel(page, at);
  await page.evaluate(
    ([p, t]) => {
      const view = (window as TimedWindow).__itaProbe!.mapView;
      const before = new Set(view.pick(p, t));
      (window as TimedWindow).__itaShown = new Promise((resolve) => {
        const frame = () => {
          if (view.pick(p, t).some((id) => !before.has(id))) requestAnimationFrame(() => requestAnimationFrame(() => resolve(Date.now())));
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
    },
    [pixel, tolerance] as const,
  );
}

type Kind = { kind: string; label: string; geometry: string; draw: (page: Page, at: Point) => Promise<void> };

/** Press and drag, as for a circle (centre to rim), an ellipse, a square or a rectangle (corner to corner). */
const dragged = (from: [number, number], to: [number, number]) => async (page: Page, at: Point) => {
  await drag(page, offset(at, ...from), offset(at, ...to));
};

/** Point by point at a user's pace; Enter finishes. */
const clicked = (points: Array<[number, number]>) => async (page: Page, at: Point) => {
  for (const p of points) {
    const point = offset(at, ...p);
    await page.mouse.click(point.x, point.y);
    await userPause(page);
  }
  await page.keyboard.press('Enter');
};

const KINDS: Kind[] = [
  { kind: 'circle', label: 'Circle', geometry: 'Circle', draw: dragged([0, 0], [30, 0]) },
  { kind: 'ellipse', label: 'Ellipse', geometry: 'Ellipse', draw: dragged([-35, -20], [35, 20]) },
  { kind: 'square', label: 'Square', geometry: 'Polygon', draw: dragged([-25, -25], [25, 25]) },
  { kind: 'rectangle', label: 'Rectangle', geometry: 'Polygon', draw: dragged([-35, -20], [35, 20]) },
  { kind: 'polygon', label: 'Area', geometry: 'Polygon', draw: clicked([[-30, -25], [30, -25], [0, 30]]) },
  { kind: 'arrow', label: 'Arrow', geometry: 'LineString', draw: clicked([[-35, 20], [0, -20], [35, 10]]) },
  { kind: 'route', label: 'Route', geometry: 'LineString', draw: clicked([[-35, -15], [0, 20], [35, -10]]) },
];

test('criterion 1: drawing each kind sends exactly one create of a core.shape in the active layer, with a new id, the default label, the chosen data type and dataSource manual; a second browser shows it within 1 s', async ({
  browser,
}, testInfo) => {
  await withM0(
    testInfo,
    browser,
    async ({ server, live, snapshot, open }) => {
      let sent: ReturnType<typeof watchRequests> = [];
      const page = await open(async (p) => {
        sent = watchRequests(p);
        await watchLastInput(p);
      });
      const other = await open();
      const config = await (await fetch(`${server.baseUrl}/api/config`)).json();
      // A second layer, made active in the Layers panel: the shapes go there, not to the first layer.
      const layer = randomUUID();
      expect((await live.change(layerRequest('create', { id: layer, name: 'ITA drawing layer', drawOrder: 50 }))).outcome).toBe('applied');
      const activate = page.getByRole('tabpanel', { name: 'Layers', exact: true }).getByRole('button', { name: 'Make ITA drawing layer active' });
      await activate.click();
      await expect(activate).toHaveAttribute('aria-pressed', 'true');

      // The style for new shapes: a magenta outline, 6 px, so the second browser's pixels show each shape.
      const panel = shapesPanel(page);
      const colour = panel.getByLabel('Outline colour', { exact: true });
      await colour.fill('#ff00ff');
      await colour.press('Enter');
      await panel.getByLabel('Outline width').selectOption('6');
      // The last data type offered (another than the default, where there is one).
      const dataTypes = await panel.getByLabel('Data type').locator('option').evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
      expect(dataTypes.length, 'a data type besides the default to choose (cot declares one)').toBeGreaterThan(1);
      const dataType = dataTypes.at(-1)!;
      expect(dataType).not.toBe('core.general');
      await panel.getByLabel('Data type').selectOption(dataType);
      testInfo.annotations.push({ type: 'data types offered', description: dataTypes.join(', ') });

      const centre = await mapCentre(page);
      const cells = [-260, -130, 0, 130].flatMap((dx) => [-80, 120].map((dy) => offset(centre, dx, dy)));
      const ids = new Set<string>(snapshot.objects.map((o: { id: string }) => o.id));
      const times: string[] = [];
      for (const [i, kind] of KINDS.entries()) {
        const at = cells[i];
        expect(await colourAround(other, at, MAGENTA, 45), `${kind.kind}: nothing there before`).toBe(0);
        await watchShown(other, at, 45);
        await panel.getByRole('group', { name: 'Shape tools' }).getByRole('button', { name: kind.label, exact: true }).click();
        await kind.draw(page, at);
        const input = await page.evaluate(() => (window as TimedWindow).__itaLastInput!);
        // The pixels: screenshots of the second browser until the shape is there.
        while ((await colourAround(other, at, MAGENTA, 45)) < 30) {
          expect(Date.now() - input, `${kind.kind}'s pixels in the second browser`).toBeLessThan(10_000);
        }
        const screenshots = Date.now() - input;
        // The time: from the gesture's end in the drawing browser to the frame the second browser drew
        // it in, both read in the browsers. Screenshots alone took longer than the shape under load
        // (rc6: 1142 ms in a full run, 9 of 9 alone), so their time is only recorded.
        const shown = (await other.evaluate(() => (window as TimedWindow).__itaShown!)) - input;
        expect(shown, `${kind.kind} in the second browser`).toBeLessThan(1000);
        times.push(`${kind.kind} ${shown} ms (by screenshots ${screenshots} ms)`);
        await userPause(page);

        const created = await nextEvent(live, (e) => e.entityType === 'object' && e.operation === 'create' && !ids.has(e.entityId));
        ids.add(created.entityId);
        const state = created.state;
        expect(state.type, kind.kind).toBe('core.shape');
        expect(state.layerId, `${kind.kind}: the active layer`).toBe(layer);
        expect(state.label, `${kind.kind}: the default label`).toEqual(config.defaultLabel);
        expect(state.dataType, `${kind.kind}: the chosen data type`).toBe(dataType);
        expect(state.dataSource).toBe('manual');
        expect(state.geometry.type, `${kind.kind}: the geometry`).toBe(kind.geometry);
        expect(state.extensions?.['draw-shapes'], `${kind.kind}: the kind as drawn`).toEqual({ kind: kind.kind });
        expect(state.style).toMatchObject({ strokeColor: expect.stringMatching(/^#ff00ff$/i), strokeWidth: 6 });
        expect(created.entityId, `${kind.kind}: a new UUID v7`).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      }
      await page.keyboard.press('Escape');
      testInfo.annotations.push({ type: 'criterion 1', description: `end of the gesture to the frame the second browser drew it in: ${times.join(', ')}` });

      // Exactly one change request per shape went over the WebSocket, each a create, and each was applied.
      const requests = sent.filter((r) => r.entityType === 'object');
      expect(requests.map((r) => r.operation)).toEqual(KINDS.map(() => 'create'));
      const events = (await settle(live, seededLayer(snapshot))).filter((e) => e.operation === 'create' && requests.some((r) => r.entityId === e.entityId));
      expect(events).toHaveLength(KINDS.length);
    },
    { probe: true },
  );
});

/** A filled circle created elsewhere, carrying another plugin's extension (all namespaces are kept on create). */
function circleWithExtension(layerId: string, center: LonLat, radius: number) {
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
      style: { strokeColor: '#106010', strokeWidth: 2, fillColor: '#20c020', fillOpacity: 1 },
      properties: { name: 'ITA circle' },
      label: { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' },
      extensions: { 'nvg-in': { kept: 'exactly as it was', n: 0.1 } },
    },
    source: { plugin: 'ita-test' },
  };
}

/** A filled circle about 60 px across, 120 px left of the map's centre; resolves with its request and point. */
async function circleOnMap(page: Page, live: LiveClient, layer: string) {
  const at = offset(await mapCentre(page), -120, 60);
  const position = await positionAt(page, at);
  // 30 px: the resolution is ground metres per pixel at the map's centre (SDK Viewport), scaled to the circle's latitude.
  const { resolution, center } = await viewport(page);
  const request = circleWithExtension(layer, position, Math.round((30 * resolution * Math.cos((position[1] * Math.PI) / 180)) / Math.cos((center[1] * Math.PI) / 180)));
  const outcome = await live.change(request);
  expect(outcome.outcome).toBe('applied');
  return { request, at, version: outcome.event.state.version as number };
}

/**
 * Right-click on the circle of `circleOnMap` (centre `at`) and choose Edit: the edit panel shows it.
 * An area is picked on its outline only (T-102), so the click is on the rim, 30 px east of the centre.
 */
async function editAt(page: Page, at: Point) {
  await expect.poll(() => colourAround(page, at, [32, 192, 32]), { timeout: 10_000, message: 'the circle is drawn' }).toBeGreaterThan(50);
  await page.mouse.click(at.x + 30, at.y, { button: 'right' });
  await page.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: 'Edit' }).click();
  await expect(editPanel(page).getByLabel('Name')).toBeVisible();
}

test('criteria 7, 9 and 11: name, style, layer and data type edited in one browser reach the other; each update has all core fields and baseVersion, keeps dataSource and the other plugin\'s extension; of two edits the later commit wins in both', async ({
  browser,
}, testInfo) => {
  await withM0(
    testInfo,
    browser,
    async ({ server, live, snapshot, open }) => {
      let sent: ReturnType<typeof watchRequests> = [];
      const page = await open((p) => {
        sent = watchRequests(p);
      });
      const other = await open();
      const layer = seededLayer(snapshot);
      const second = { id: randomUUID(), name: 'ITA second layer', drawOrder: 50 };
      expect((await live.change(layerRequest('create', second))).outcome).toBe('applied');
      const shape = await circleOnMap(page, live, layer);
      const id = shape.request.entityId;
      await editAt(page, shape.at);
      await editAt(other, shape.at);
      await expect(editPanel(other).getByLabel('Name')).toHaveValue('ITA circle');

      let version = shape.version;
      /** The one update the step sent, and its event: checked against criteria 7 and 9. */
      const updated = async (step: string) => {
        const event = await nextEvent(live, (e) => e.entityId === id && e.operation === 'update' && e.state.version > version);
        const requests = sent.filter((r) => r.entityId === id);
        expect(requests, `${step}: one request`).toHaveLength(1);
        const [request] = requests.splice(0);
        sent.splice(sent.indexOf(request), 1);
        expect(request.operation).toBe('update');
        expect(request.baseVersion, `${step}: baseVersion`).toBe(version);
        expect(Object.keys(request.data).sort(), `${step}: all core fields`).toEqual(
          expect.arrayContaining(['dataSource', 'dataType', 'geometry', 'label', 'layerId', 'properties', 'style', 'type']),
        );
        expect(request.data.dataSource, `${step}: dataSource unchanged`).toBe('manual');
        expect(request.data.extensions?.['nvg-in'], `${step}: the other plugin's extension is not sent`).toBeUndefined();
        expect(request.data.extensions?.['draw-shapes'], `${step}: nor its own (the store keeps it)`).toBeUndefined();
        expect(event.state.extensions?.['nvg-in'], `${step}: the other plugin's extension is kept`).toEqual(shape.request.data.extensions['nvg-in']);
        version = event.state.version;
        return event;
      };
      // The requests sent so far are not edits of this shape.
      sent.splice(0);

      const name = editPanel(page).getByLabel('Name');
      await name.fill('ITA renamed');
      await name.press('Enter');
      expect((await updated('name')).state.properties.name).toBe('ITA renamed');
      await expect(editPanel(other).getByLabel('Name'), 'the name in the second browser').toHaveValue('ITA renamed');

      await editPanel(page).getByLabel('Outline width').selectOption('8');
      expect((await updated('style')).state.style.strokeWidth).toBe(8);
      await expect(editPanel(other).getByLabel('Outline width'), 'the style in the second browser').toHaveValue('8');

      await editPanel(page).getByLabel('Layer').selectOption(second.id);
      expect((await updated('layer')).state.layerId).toBe(second.id);
      await expect(editPanel(other).getByLabel('Layer'), 'the layer in the second browser').toHaveValue(second.id);

      const config = await (await fetch(`${server.baseUrl}/api/config`)).json();
      // One the select offers: not one users do not choose (`manual` false, ADR-0054 point 6).
      const otherType = (config.dataTypes as Array<{ id: string; manual?: boolean }>).filter((t) => t.manual !== false).map((t) => t.id).find((t) => t !== 'core.general');
      if (otherType === undefined) {
        testInfo.annotations.push({ type: 'not tested', description: 'only core.general is installed: no other data type to choose' });
      } else {
        await editPanel(page).getByLabel('Data type').selectOption(otherType);
        expect((await updated('data type')).state.dataType).toBe(otherType);
        await expect(editPanel(other).getByLabel('Data type'), 'the data type in the second browser').toHaveValue(otherType);
      }

      // Criterion 11: both type a name; the first commits, the second's field keeps its typing, then
      // the second commits: the later commit wins, and both show it.
      const mine = editPanel(page).getByLabel('Name');
      const theirs = editPanel(other).getByLabel('Name');
      await mine.fill('From the first');
      await theirs.fill('From the second');
      await mine.press('Enter');
      const first = await updated('first commit');
      expect(first.state.properties.name).toBe('From the first');
      // Once the second browser has the first commit (its Version fact), its typed name is still there.
      const versionFact = (shown: Page) => editPanel(shown).locator('dt', { hasText: /^Version$/ }).locator('xpath=following-sibling::dd[1]');
      await expect(versionFact(other), 'the second browser has the first commit').toHaveText(String(first.state.version));
      await expect(theirs, 'a field being typed in is not overwritten').toHaveValue('From the second');
      await theirs.press('Enter');
      const last = await nextEvent(live, (e) => e.entityId === id && e.operation === 'update' && e.state.version > version);
      expect(last.state.properties.name, 'the later commit wins').toBe('From the second');
      expect(last.state.extensions?.['nvg-in']).toEqual(shape.request.data.extensions['nvg-in']);
      await expect(mine, 'the first browser shows it').toHaveValue('From the second');
      await expect(theirs).toHaveValue('From the second');
    },
    { probe: true },
  );
});

test('criterion 10: draw-shapes has no Delete of its own; the shell\'s shared Delete removes a shape', async ({ browser }, testInfo) => {
  await withM0(
    testInfo,
    browser,
    async ({ live, snapshot, open }) => {
      const page = await open();
      const layer = seededLayer(snapshot);
      const shape = await circleOnMap(page, live, layer);
      await editAt(page, shape.at);
      for (const panel of [shapesPanel(page), editPanel(page)]) {
        await expect(panel.getByRole('button', { name: /delete/i }), 'no Delete button').toHaveCount(0);
      }

      // Selected with a click on the map (so the focus is not in the edit panel's fields), the
      // Delete key asks the shell's question. On the rim: an area is picked on its outline only (T-102).
      await page.mouse.click(shape.at.x + 30, shape.at.y);
      await userPause(page);
      await page.keyboard.press('Delete');
      const question = page.getByRole('alertdialog', { name: 'Delete objects' });
      await expect(question).toContainText('Delete 1 object? This cannot be undone.');
      await question.getByRole('button', { name: 'Delete 1 object' }).click();
      await nextEvent(live, (e) => e.entityId === shape.request.entityId && e.operation === 'delete');
      await expect.poll(() => colourAround(page, shape.at, [32, 192, 32]), { timeout: 10_000, message: 'gone from the map' }).toBe(0);
      const deletes = (await settle(live, layer)).filter((e) => e.operation === 'delete');
      expect(deletes.map((e) => e.entityId), 'exactly that one').toEqual([shape.request.entityId]);
    },
    { probe: true },
  );
});
