// Quick run: @login @streams
import { expect, test } from '@playwright/test';
import { useTestRealm, withLoginServer } from '../../lib/login';

// The streams to a plugin's web part with login (T-208; SDK 1.8.0 part E1, CR-0044): GET
// /api/plugins/{id}/stream/{name} answers 401 without a login and 403 without the stream's
// permission, and a viewer's response ends with its login session (server README, "Streams to the
// web part"). The ITA's test plugin ita-stream's streams need plugin.ita-stream.view, given here to
// the admins group only. The rest of the rules are specs/live/streams.spec.ts. Runs only with
// run.mjs --keycloak.

const realm = useTestRealm();
const PATH = '/api/plugins/ita-stream/stream/feed';
const options = { testPlugins: ['ita-stream'], permissions: { 'plugin.ita-stream.view': ['admins'] } };

test('without a login a stream gets 401; without plugin.ita-stream.view 403; with it 200, and the viewer\'s response ends when its login session ends', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const none = await fetch(`${run.server.baseUrl}${PATH}`, { redirect: 'manual' });
    expect(none.status, 'no login: 401').toBe(401);
    await none.body?.cancel();

    const { context: viewerContext } = await run.logIn('viewer');
    const refused = await run.api(viewerContext, PATH);
    expect(refused.status, 'the viewer, without plugin.ita-stream.view: 403').toBe(403);
    await refused.body?.cancel();

    const { context: adminContext } = await run.logIn('admin');
    const watching = await run.api(adminContext, PATH);
    expect(watching.status, 'the admin, with it: 200').toBe(200);
    expect(watching.headers.get('content-type')).toBe('video/mp2t');
    let ended = false;
    const reading = (async () => {
      const reader = watching.body!.getReader();
      try {
        for (;;) if ((await reader.read()).done) break;
      } catch {
        // a reset counts as ended too
      }
      ended = true;
    })();
    // A start point, so that the viewer has something to write.
    expect((await run.api(adminContext, '/api/plugins/ita-stream/write?stream=feed&fill=A&start=true&size=100')).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(ended, 'still watching').toBe(false);

    // The admin's sessions end at the IAM (back-channel logout): the response ends.
    const loggedOut = Date.now();
    await run.realm.logOut('admin');
    await expect.poll(() => ended, { timeout: 30_000, message: "the viewer's response ends with the login session" }).toBe(true);
    testInfo.annotations.push({ type: 'ended after the logout', description: `${Date.now() - loggedOut} ms` });
    await reading;
  }, options);
});
