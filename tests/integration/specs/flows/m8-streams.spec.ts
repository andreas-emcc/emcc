// Quick run: @streams
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/flows/m8-streams.spec.ts
import { expect, test } from '@playwright/test';
import { withM0 } from '../../lib/m0';

// The Monitor's streams table (T-208; SDK 1.8.0 part E1, CR-0044): a plugin's open streams to its
// web part, one row each with its media type, viewers, bytes in and out, chunks dropped, viewer
// losses and start buffer, and a "Check" mark when chunks were dropped or viewers lost data
// (shell `streamAttention`). The ITA's test plugin ita-stream (fixtures/plugins/ita-stream) opens
// `feed` and `other`; the HTTP rules are specs/live/streams.spec.ts.

const PLUGIN = 'ita-stream';
const KiB = 1024;

test('the Monitor shows a plugin\'s streams: feed (video/mp2t) with its viewer, bytes in and out and start buffer, and "Check" once chunks were dropped past the rate; other with nothing yet', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const write = async (query: string) => {
      const response = await fetch(`${server.baseUrl}/api/plugins/${PLUGIN}/write?stream=feed&${query}`);
      expect(response.status).toBe(200);
      return (await response.text()).split(' ').map(Number);
    };
    // A viewer reading all it gets.
    const abort = new AbortController();
    const response = await fetch(`${server.baseUrl}/api/plugins/${PLUGIN}/stream/feed`, { signal: abort.signal });
    expect(response.status).toBe(200);
    let got = 0;
    const reading = (async () => {
      try {
        const reader = response.body!.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value.length;
        }
      } catch {
        // aborted at the end
      }
    })();
    await write('fill=A&start=true&size=2048&count=1');
    await write('fill=a&size=1024&count=1');
    await expect.poll(() => got, { message: 'the viewer got 3 KiB' }).toBe(3 * KiB);

    const page = await open();
    await page.goto(`${server.baseUrl}/#monitor`);
    const plugins = page.getByRole('table', { name: 'Plugins' });
    await plugins.getByRole('button', { name: 'ITA stream test plugin' }).click();
    const table = page.getByRole('table', { name: 'ITA stream test plugin: streams' });
    await expect(table.getByRole('columnheader')).toHaveText(['Stream', 'Viewers', 'In', 'Out', 'Dropped', 'Viewer losses', 'Start buffer']);
    const row = (name: string) => table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: new RegExp(`^${name} `) }) });
    await expect(row('feed').getByRole('rowheader'), 'feed with its type, no mark').toHaveText('feed (video/mp2t)');
    await expect(row('feed').getByRole('cell'), 'feed: 1 viewer, 3 KiB in and out, nothing dropped or lost, 3 KiB since its start point').toHaveText(['1', '3.0 KiB', '3.0 KiB', '0', '0', '3.0 KiB']);
    await expect(row('other').getByRole('rowheader')).toHaveText('other (application/octet-stream)');
    await expect(row('other').getByRole('cell'), 'other: nothing yet').toHaveText(['0', '0 B', '0 B', '0', '0', '0 B']);

    // Past 50 Mbit/s in a second: dropped and counted, and the row asks for a look.
    const [accepted, dropped] = await write(`fill=x&size=${64 * KiB}&count=128`);
    testInfo.annotations.push({ type: 'burst', description: `${accepted} accepted, ${dropped} dropped` });
    expect(dropped, 'dropped past the rate').toBeGreaterThan(0);
    await expect(row('feed').getByRole('cell').nth(3), 'the Dropped column').toHaveText(String(dropped), { timeout: 10_000 });
    await expect(row('feed').getByRole('rowheader'), 'marked for a look').toHaveText('feed (video/mp2t) Check');
    await page.screenshot({ path: testInfo.outputPath('monitor-streams.png') });
    abort.abort();
    await reading;
  }, { testPlugins: [PLUGIN] });
});
