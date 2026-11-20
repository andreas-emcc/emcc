// The server log check: which lines of an emc2 server log fail a test run.

/** Spring Boot's ERROR level, and uncaught JVM errors. */
const ERROR_LINE = /^\S+\s+ERROR\s|^Exception in thread |^Caused by: java\.lang\.(OutOfMemoryError|StackOverflowError)/;
const WARN_LINE = /^\S+\s+WARN\s/;
/** The first line after a log line that starts a stack trace. */
const STACK_START = /^\s+at |^Caused by: |^[\w.$]+(Exception|Error|Throwable)(: |$)/;

/**
 * Returns the problems in a server log: every error line, and every WARN line followed by a stack
 * trace (an unexpected exception logged as a warning), with the trace's first line.
 */
export function checkLog(text) {
  const lines = text.split(/\r?\n/);
  const problems = [];
  lines.forEach((line, i) => {
    if (ERROR_LINE.test(line)) {
      problems.push(line);
    } else if (WARN_LINE.test(line) && STACK_START.test(lines[i + 1] ?? '')) {
      problems.push(`${line}\n    ${lines[i + 1]}`);
    }
  });
  return problems;
}

/**
 * The log check for a test that provokes errors on purpose: every pattern in `expected` must match
 * a line of the log (`missing` lists those that do not), and a problem of `checkLog` is tolerated
 * only if a pattern matches it (`unexpected` lists the others). Patterns must not have the g or y
 * flag (RegExp.test would then keep state between calls).
 */
export function checkLogExpecting(text, expected) {
  const missing = expected.filter((pattern) => !pattern.test(text));
  const unexpected = checkLog(text).filter((problem) => !expected.some((pattern) => pattern.test(problem)));
  return { missing, unexpected };
}
