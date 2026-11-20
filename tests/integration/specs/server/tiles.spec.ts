// Quick run: @always @plugin-basemap-osm
import { expect, test } from '@playwright/test';

// basemap-osm in the shared server fetches its tiles from the run's fake tile server, never from
// OpenStreetMap (README "How a run uses the server"). This proves the server side of that: the
// browser-side offline guard cannot see the server's own outbound requests.

test("a tile from basemap-osm's endpoint comes from the run's fake tile server", async ({ request }) => {
  const fake = process.env.EMC2_FAKE_TILES;
  expect(fake, 'EMC2_FAKE_TILES (set by run.mjs)').toBeTruthy();

  const tile = await request.get('/api/plugins/basemap-osm/tiles/3/4/2.png');
  expect(tile.status()).toBe(200);
  expect(tile.headers()['content-type']).toBe('image/png');
  const body = await tile.body();
  expect(body.subarray(1, 4).toString('ascii')).toBe('PNG');

  const served = (await (await fetch(`${fake}/_requests`)).json()) as string[];
  expect(served).toContain('/3/4/2.png');
});
