// Quick run: @plugin-map-view-2d @plugin-draw-symbols @plugin-draw-shapes @plugin-object-list
import { expect, test, type Page } from '@playwright/test';
import { colourAround, frameSymbol, IDENTITY, mapCentre, positionAt, withM0, type LonLat } from '../../lib/m0';
import { seededLayer } from '../../lib/live.mjs';
import { watchMapSubscription, type MapSubscription } from '../../lib/map-subscription';
import { select, viewport } from '../../lib/perf';

// The shared selection with the map's area of interest (map-view-2d criteria 20 and 40,
// docs/plugins/briefs/map-view-2d.md). In a file of its own so that a quick run for any plugin that
// uses the selection (draw-symbols, draw-shapes, object-list) runs it without map-view-2d's other
// criteria. Without a GPU here: software mode.

type ProbeView = { goTo(c: LonLat, r: number): void; selection: { value: readonly string[] } };

async function goTo(page: Page, center: LonLat, resolution: number) {
  await page.evaluate(([c, r]) => (window as unknown as { __itaProbe: { mapView: ProbeView } }).__itaProbe.mapView.goTo(c, r), [center, resolution] as const);
}

test('criteria 20 and 40: the map view holds only its area: an object that leaves it leaves the map but stays selected, one that enters appears; a delete removes the id from the selection', async ({
  browser,
}, testInfo) => {
  await withM0(
    testInfo,
    browser,
    async ({ live, snapshot, open }) => {
      let map!: MapSubscription;
      const page = await open((p) => {
        map = watchMapSubscription(p);
      });
      const layer = seededLayer(snapshot);
      const centre = await mapCentre(page);
      const here = await positionAt(page, centre);
      const far: LonLat = [here[0] + 60.5, here[1] - 40.25]; // far outside the view, which is about 40° wide
      const a = (await live.change(frameSymbol(layer, here, 'friend'))).event.entityId;
      const b = (await live.change(frameSymbol(layer, far, 'hostile'))).event.entityId;
      await expect.poll(() => colourAround(page, centre, IDENTITY.friend.colour), { timeout: 10_000 }).toBeGreaterThan(50);
      await expect.poll(() => map.objectIds().has(a), { message: 'A is in the area' }).toBe(true);
      expect(map.objectIds().has(b), 'B is not').toBe(false);
      await select(page, [a]);

      const { resolution } = await viewport(page);
      await goTo(page, far, resolution);
      await expect.poll(() => map.objectIds().has(b), { timeout: 10_000, message: 'B entered' }).toBe(true);
      expect(map.objectIds().has(a), 'A left').toBe(false);
      await expect.poll(() => colourAround(page, centre, IDENTITY.hostile.colour), { timeout: 10_000, message: 'B is drawn' }).toBeGreaterThan(50);
      // Criterion 40 (from M2): a selected object that leaves the area stays in the selection. To read
      // the selection only after the map view has handled A's "left", a third object C enters the
      // area afterwards: the subscription's messages are handled in order, so once C is drawn, A's
      // "left" has been handled too.
      const nearB: LonLat = [far[0] + 0.5, far[1] + 0.25];
      const c = (await live.change(frameSymbol(layer, nearB, 'friend'))).event.entityId;
      await expect.poll(() => map.objectIds().has(c), { timeout: 10_000, message: 'C entered' }).toBe(true);
      await expect.poll(() => colourAround(page, centre, IDENTITY.friend.colour, 60), { timeout: 10_000, message: 'C is drawn' }).toBeGreaterThan(50);
      const selection = () => page.evaluate(() => (window as unknown as { __itaProbe: { mapView: ProbeView } }).__itaProbe.mapView.selection.value);
      expect(await selection(), 'A stays selected outside the area').toEqual([a]);

      // A delete event removes the id.
      const deleted = await live.change({ requestId: crypto.randomUUID(), entityType: 'object', operation: 'delete', entityId: a, source: { plugin: 'ita-test' } });
      expect(deleted.outcome).toBe('applied');
      await expect.poll(selection, { timeout: 10_000, message: 'A left the selection with its delete' }).toEqual([]);
    },
    { probe: true },
  );
});
