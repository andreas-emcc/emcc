// Quick run: @harness
import { expect, test } from '@playwright/test';
import { checkLog, checkLogExpecting } from '../../lib/log-check.mjs';

// The server log check of run.mjs and of the specs' own servers catches what it must catch.

const at = '2026-10-07T15:09:05.772+02:00';
const prefix = '17996 --- [emc2] [           main] dev.emcc.Example             :';

test('the log check reports error lines and uncaught JVM errors', () => {
  const log = [
    `${at}  INFO ${prefix} Started`,
    `${at} ERROR ${prefix} Persistence failed`,
    'Exception in thread "emc2-stop" java.lang.IllegalStateException: boom',
    `${at}  INFO ${prefix} done`,
  ].join('\n');
  expect(checkLog(log)).toEqual([
    `${at} ERROR ${prefix} Persistence failed`,
    'Exception in thread "emc2-stop" java.lang.IllegalStateException: boom',
  ]);
});

test('the log check reports a warning followed by a stack trace, with its first line', () => {
  const log = [
    `${at}  WARN ${prefix} Handler failed`,
    'java.lang.IllegalArgumentException: bad input',
    '\tat dev.emcc.Example.run(Example.java:12)',
    `${at}  WARN ${prefix} Retrying`,
    '\tat dev.emcc.Example.retry(Example.java:20)',
  ].join('\r\n');
  expect(checkLog(log)).toEqual([
    `${at}  WARN ${prefix} Handler failed\n    java.lang.IllegalArgumentException: bad input`,
    `${at}  WARN ${prefix} Retrying\n    \tat dev.emcc.Example.retry(Example.java:20)`,
  ]);
});

test('the log check accepts plain warnings and the word ERROR inside a message', () => {
  const log = [
    `${at}  WARN ${prefix} *** NO LOGIN *** emc2.login.mode=none: everyone who can reach this server works as the local user, with all permissions. Not a protected system.`,
    `${at}  INFO ${prefix} Counted 0 ERROR lines`,
    `${at}  INFO ${prefix} Stopped`,
  ].join('\n');
  expect(checkLog(log)).toEqual([]);
});

test('a declared expected line is tolerated only when it appears, and nothing else is', () => {
  const hung = `${at} ERROR ${prefix} Worker ita-limits/sleeper hung: handler call running for 1060 ms (budget 1000 ms).`;
  const other = `${at} ERROR ${prefix} Persistence failed`;
  const expected = [/Worker ita-limits\/sleeper hung/];
  expect(checkLogExpecting(hung, expected)).toEqual({ missing: [], unexpected: [] });
  expect(checkLogExpecting([hung, other].join('\n'), expected)).toEqual({ missing: [], unexpected: [other] });
  expect(checkLogExpecting(`${at}  INFO ${prefix} Started`, expected)).toEqual({ missing: expected, unexpected: [] });
});
