// Child processes that can be stopped as a whole, on Windows and Linux.
//
// Linux: every child is started in a process group of its own (detached), so that killing the
// group also ends whatever the child started (Playwright workers, the servers they start).
// Windows: taskkill /T ends the whole process tree. Either way the runner, not the terminal, is
// responsible for stopping its children.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const isWindows = process.platform === 'win32';

/** spawn() with the child in a process group of its own on Linux. */
export function spawnGroup(command, args, options) {
  return spawn(command, args, { ...options, detached: !isWindows });
}

/** Ends the process and everything it started, at once. */
export function killTree(pid) {
  if (pid === undefined) return;
  if (isWindows) {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

/**
 * Asks the process and everything it started to stop: SIGINT to the group on Linux. Windows has
 * no signal for that, so the tree is killed there.
 */
export function interruptTree(pid) {
  if (pid === undefined) return;
  if (isWindows) {
    killTree(pid);
    return;
  }
  try {
    process.kill(-pid, 'SIGINT');
  } catch {
    // Already gone.
  }
}

/**
 * The command line of a running process, or undefined if it is gone or cannot be read. Used to
 * make sure a recorded pid still belongs to the same program before killing it (pids are reused).
 */
export function commandLineOf(pid) {
  try {
    if (isWindows) {
      const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`],
        { encoding: 'utf8', timeout: 30_000 },
      );
      const line = result.stdout?.trim();
      return line ? line : undefined;
    }
    return readFileSync(`/proc/${Number(pid)}/cmdline`, 'utf8').replaceAll('\0', ' ').trim() || undefined;
  } catch {
    return undefined;
  }
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** Resolves with the child's exit code (or signal) once it has exited and its pipes are drained. */
export function closedOf(child) {
  return new Promise((resolveClosed) => child.once('close', (code, signal) => resolveClosed(code ?? signal)));
}
