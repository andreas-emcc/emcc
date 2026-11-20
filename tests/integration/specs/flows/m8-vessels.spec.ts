// Quick run: @plugin-map-view-2d @plugin-symbology @plugin-draw-symbols
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/flows/m8-vessels.spec.ts
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { LiveClient, seededLayer } from '../../lib/live.mjs';
import { frameSymbol, mapCentre, pixelsAround, positionAt, userPause, visibleMap, withM0, type LonLat, type Point } from '../../lib/m0';
import { decodePng } from '../../lib/png.mjs';

// Turning vessels (map-view-2d function 33 and criterion 108; T-200, owner TY B with 10° steps, TZ A): the map
// view rounds a vessel's direction to the nearest 10° before it asks symbology, so a hull turns in steps and
// its image only changes every 10°, and the atlas grows without a blank frame. In the browser: vessels with 34°
// and 30°, 35° and 40°, 356° and 0° are drawn alike, with and without a name, and the Symbol properties still
// show 34; 200 vessels each turning 1° a second for a minute (as an AIS playback of turning ships) keep every
// sampled frame of the map drawn. The frames are sampled with screenshots (about 7 a second), not every frame the
// browser draws: on a build without T-200's fix 450 samples showed no blank either (a screenshot waits for a whole
// frame), so the brief blank between two atlas swaps is the map view's own test, as are the atlas's image count and
// the swaps a second (PCA-map-view-2d). This check finds a map that stops drawing its symbols while they turn.
// Positions are [lon, lat], latitude ≠ longitude; every server is the test's own.

test.describe.configure({ timeout: 300_000 });

type State = Record<string, any>;
type Image = Awaited<ReturnType<typeof pixelsAround>>;

async function applied(client: LiveClient, request: { entityType: string; operation: string }): Promise<State> {
  const outcome = await client.change(request);
  expect(outcome, `${request.entityType} ${request.operation}: ${JSON.stringify(outcome.rejection ?? '')}`).toMatchObject({ outcome: 'applied' });
  return outcome.event.state;
}

/** A create request for a moving cargo vessel (`0471`, as m5-display's) heading `direction`. */
function vessel(layerId: string, at: LonLat, direction: number, name?: string) {
  const request = frameSymbol(layerId, at, 'friend') as any;
  request.data.symbol = { standard: 'vessel', sidc: '0471', modifiers: { direction, speed: 6 } };
  if (name !== undefined) request.data.properties = { ...(request.data.properties ?? {}), name };
  return request;
}

/** The share of pixels that differ between two crops of vessels, of those that either draws on its ground. */
function unlike(a: Image, aGround: Image, b: Image, bGround: Image): number {
  let drawn = 0;
  let differ = 0;
  const off = (p: number[], g: number[]) => Math.max(Math.abs(p[0] - g[0]), Math.abs(p[1] - g[1]), Math.abs(p[2] - g[2])) > 30;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const [pa, pb] = [a.pixel(x, y), b.pixel(x, y)];
      const [inA, inB] = [off(pa, aGround.pixel(x, y)), off(pb, bGround.pixel(x, y))];
      if (!inA && !inB) continue;
      drawn++;
      if (inA !== inB || Math.max(Math.abs(pa[0] - pb[0]), Math.abs(pa[1] - pb[1]), Math.abs(pa[2] - pb[2])) > 40) differ++;
    }
  }
  return drawn === 0 ? 1 : differ / drawn;
}

async function mapImage(page: Page): Promise<Image> {
  const box = await visibleMap(page);
  return decodePng(await page.screenshot({ clip: { x: box.x + 2, y: box.y + 2, width: box.width - 4, height: box.height - 4 } })) as Image;
}

/** Pixels of the map off its ground by more than 30 in some channel. */
function offGround(now: Image, ground: Image): number {
  let n = 0;
  for (let y = 0; y < now.height; y++) {
    for (let x = 0; x < now.width; x++) {
      const [p, g] = [now.pixel(x, y), ground.pixel(x, y)];
      if (Math.max(Math.abs(p[0] - g[0]), Math.abs(p[1] - g[1]), Math.abs(p[2] - g[2])) > 30) n++;
    }
  }
  return n;
}

test('a vessel\'s hull turns in 10° steps (map-view-2d criterion 108; T-200): 34° is drawn as 30°, 35° as 40°, 356° as 0°, without and with a name, while 30° and 40° differ; selected, its Symbol properties still show 34', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const layer = seededLayer(snapshot);
    const page = await open();
    const centre = await mapCentre(page);
    const rest = { x: centre.x + 320, y: centre.y + 240 };
    await page.mouse.move(rest.x, rest.y);
    const pairs: [number, number][] = [[34, 30], [35, 40], [356, 0]];
    const placed: { direction: number; at: Point; name?: string; id: string; ground: Image }[] = [];
    for (const [row, name] of [[0, undefined], [1, 'SHIP']] as const) {
      for (const [i, pair] of pairs.entries()) {
        for (const [j, direction] of pair.entries()) {
          const at = { x: centre.x - 280 + i * 190 + j * 80, y: centre.y - 110 + row * 150 };
          const ground = await pixelsAround(page, at, 26);
          const position = await positionAt(page, at);
          const state = await applied(live, vessel(layer, position, direction, name));
          placed.push({ direction, at, name, id: state.id, ground });
        }
      }
    }
    const crop = async (v: (typeof placed)[number]) => (await pixelsAround(page, v.at, 26)) as Image;
    await page.mouse.move(rest.x, rest.y);
    await expect.poll(async () => { let n = 0; for (const v of placed) if (offGround(await crop(v), v.ground) > 30) n++; return n; }, { timeout: 15_000, message: 'every vessel drawn' }).toBe(placed.length);
    await page.screenshot({ path: testInfo.outputPath('hulls.png') });
    const find = (direction: number, name?: string) => placed.find((v) => v.direction === direction && v.name === name)!;
    const shares: string[] = [];
    for (const name of [undefined, 'SHIP']) {
      for (const [a, b] of pairs) {
        const [va, vb] = [find(a, name), find(b, name)];
        const share = unlike(await crop(va), va.ground, await crop(vb), vb.ground);
        shares.push(`${a}° vs ${b}°${name ? ' named' : ''}: ${(share * 100).toFixed(1)} %`);
        expect(share, `${a}° drawn as ${b}°${name ? ', with a name' : ''}`).toBeLessThanOrEqual(0.1);
      }
      const [v30, v40] = [find(30, name), find(40, name)];
      const apart = unlike(await crop(v30), v30.ground, await crop(v40), v40.ground);
      shares.push(`30° vs 40°${name ? ' named' : ''}: ${(apart * 100).toFixed(1)} %`);
      expect(apart, `30° and 40° differ${name ? ', with a name' : ''}`).toBeGreaterThan(0.2);
    }
    testInfo.annotations.push({ type: 'pixels unlike', description: shares.join('; ') });

    // Selected, the vessel's Symbol properties show its exact heading.
    const v34 = find(34);
    await page.mouse.click(v34.at.x, v34.at.y);
    await userPause(page);
    await expect(page.getByRole('textbox', { name: 'Heading (°)', exact: true }), 'the properties keep 34').toHaveValue('34');
  });
});

test('200 vessels turning for a minute keep the map drawn (map-view-2d criterion 108; T-200): each turns 1° a second, as in an AIS playback, and no sampled frame of the map loses its symbols', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const layer = seededLayer(snapshot);
    const page = await open();
    const box = await visibleMap(page);
    await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10);
    const ground = await mapImage(page);
    // A grid of 20 by 10 vessels over the map, each starting at its own direction.
    const [nw, se] = [await positionAt(page, { x: box.x + 40, y: box.y + 40 }), await positionAt(page, { x: box.x + box.width - 40, y: box.y + box.height - 60 })];
    expect(Math.abs(nw[0] - nw[1]), 'latitude ≠ longitude').toBeGreaterThan(1);
    const ships: State[] = [];
    for (let k = 0; k < 200; k++) {
      const [c, r] = [k % 20, Math.floor(k / 20)];
      const at: LonLat = [nw[0] + ((se[0] - nw[0]) * c) / 19, nw[1] + ((se[1] - nw[1]) * r) / 9];
      ships.push(await applied(live, vessel(layer, at, (k * 1.8) % 360)));
    }
    let still = 0;
    await expect.poll(async () => { const n = offGround(await mapImage(page), ground); const was = still; still = n; return n > 2_000 && Math.abs(n - was) < n * 0.02; }, { timeout: 30_000, intervals: [1_000], message: 'all 200 drawn and settled' }).toBe(true);
    const drawnAtStart = still;

    // The playback: every second each ship turns 1°; meanwhile the map is sampled.
    const samples: number[] = [];
    let playing = true;
    const sampler = (async () => {
      while (playing) samples.push(offGround(await mapImage(page), ground));
    })();
    const started = Date.now();
    for (let second = 1; second <= 60; second++) {
      for (let i = 0; i < ships.length; i += 50) {
        const updates = ships.slice(i, i + 50).map(async (ship, j) => {
          const { id, version, meta: _meta, ...data } = ship;
          const symbol = { ...data.symbol, modifiers: { ...data.symbol.modifiers, direction: (data.symbol.modifiers.direction + 1) % 360 } };
          ships[i + j] = await applied(live, { requestId: randomUUID(), entityType: 'object', operation: 'update', entityId: id, baseVersion: version, data: { ...data, symbol }, source: { plugin: 'ita-test' } } as any);
        });
        await Promise.all(updates);
      }
      const wait = started + second * 1000 - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
    }
    playing = false;
    await sampler;
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    testInfo.annotations.push({ type: 'sampled frames', description: `${samples.length} in ${((Date.now() - started) / 1000).toFixed(0)} s; pixels off the ground: at the start ${drawnAtStart}, lowest ${sorted[0]}, median ${median}, highest ${sorted.at(-1)}` });
    expect(samples.length, 'frames sampled').toBeGreaterThan(30);
    expect(sorted[0], 'no sampled frame lost its symbols (the lowest at least 80 % of the median)').toBeGreaterThanOrEqual(median * 0.8);
    const turned = ships.filter((s, k) => Math.abs(((s.symbol.modifiers.direction - (k * 1.8) % 360 + 360) % 360) - 60) < 1e-6).length;
    expect(turned, 'every ship turned 60°').toBe(ships.length);
  });
});
