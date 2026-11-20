// The ESA's external services folder (the sheets in external/*/README.md: their credentials and data), named only by
// the environment variable EMC2_EXTERNAL_ROOT (owner ADN A: no computer's folder in the repository). Without it the
// specs and helpers that need something there are skipped, or fail, with the reason.
import { join } from 'node:path';

/** EMC2_EXTERNAL_ROOT, or '' when it is not set. */
export const EXTERNAL_ROOT = process.env.EMC2_EXTERNAL_ROOT ?? '';

/** A path below EMC2_EXTERNAL_ROOT, or '' when it is not set (existsSync('') is false; never a relative path). */
export function externalPath(...parts) {
  return EXTERNAL_ROOT === '' ? '' : join(EXTERNAL_ROOT, ...parts);
}

/** Why `what` is not there: EMC2_EXTERNAL_ROOT is not set, or nothing is at `path`. */
export function externalMissing(what, path) {
  return path === '' ? `${what}: set EMC2_EXTERNAL_ROOT to the ESA's external services folder` : `${what} is not at ${path}`;
}
