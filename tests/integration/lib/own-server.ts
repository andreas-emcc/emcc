import { expect, type TestInfo } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { checkLogExpecting } from './log-check.mjs';
import { makeRunFolders, startServer } from './server.mjs';

export type OwnServer = Awaited<ReturnType<typeof startServer>>;
export type RunFolders = ReturnType<typeof makeRunFolders>;

/**
 * Runs `body` with fresh data and plugin folders and a `start` function for servers of the
 * test's own on them, with optional extra server arguments (each start logs into the test's output
 * folder: server-1.log, ...).
 * Afterwards every server still running is stopped. The folders are removed when the body
 * passed, or failed as a known fault (test.fail); when it failed otherwise they are kept and named
 * in the test's annotations and on the console.
 */
export async function withOwnServers(
  testInfo: TestInfo,
  body: (folders: RunFolders, start: (extraArgs?: string[], options?: { https?: boolean; env?: Record<string, string>; port?: number }) => Promise<OwnServer>) => Promise<void>,
): Promise<void> {
  const folders = makeRunFolders();
  const servers: OwnServer[] = [];
  const start = async (extraArgs: string[] = [], options: { https?: boolean; env?: Record<string, string>; port?: number } = {}) => {
    const logFile = testInfo.outputPath(`server-${servers.length + 1}.log`);
    testInfo.annotations.push({ type: 'server log', description: logFile });
    const server = await startServer({ dataDir: folders.dataDir, pluginsDir: folders.pluginsDir, logFile, extraArgs, ...options });
    servers.push(server);
    return server;
  };
  let known: unknown;
  try {
    await body(folders, start);
  } catch (error) {
    // A known fault (test.fail) fails as expected: nothing to look into, as in lib/login.ts.
    if (testInfo.expectedStatus === 'failed') known = error;
    else {
      testInfo.annotations.push({ type: 'kept folders', description: folders.base });
      console.error(`[${testInfo.title}] failed; kept its data and plugin folders: ${folders.base}`);
      throw error;
    }
  } finally {
    for (const server of servers) {
      if (server.exitCode === null) await server.stop();
    }
  }
  folders.remove();
  if (known !== undefined) throw known;
}

/**
 * Stops the server through the stop endpoint and requires a clean stop and a clean log. A test that
 * provokes errors on purpose declares them in `expectedLog`: each pattern must match a line of the
 * log, and log problems (lib/log-check.mjs) are tolerated only if one of the patterns matches them.
 */
export async function stopOwnServer(server: OwnServer, { expectedLog = [] as RegExp[] } = {}): Promise<void> {
  const stopped = await server.stop();
  expect(stopped.detail, 'graceful stop').toBe('stopped cleanly (exit code 0)');
  const { missing, unexpected } = checkLogExpecting(readFileSync(server.logFile, 'utf8'), expectedLog);
  expect(missing.map(String), `expected but missing in ${server.logFile}`).toEqual([]);
  expect(unexpected, `problems in ${server.logFile}`).toEqual([]);
}
