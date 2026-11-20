// Geodesics for the ITA's checks, from the Java SDK's own Geodesy (owner, 2026-10-29, Q5): the
// simulator moves along `Geodesy` paths (its brief, criteria 3 and 7), so the tests compare with the
// same SDK, not with a formula of their own. The SDK's and GeographicLib's jars are taken from the
// built server jar (nothing installed), once per build, and lib/GeodesyQuery.java runs with the
// JDK's single-file launcher. Positions are [longitude, latitude] (ADR-0007). Plain Node.js.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jarPath, runFoldersParent } from './server.mjs';

const helper = join(dirname(fileURLToPath(import.meta.url)), 'GeodesyQuery.java');
const LIBS = /^BOOT-INF\/lib\/(emc2-plugin-sdk-[^/]*\.jar|GeographicLib-Java-[^/]*\.jar)$/;

let classPath = null;

/** The class path of the SDK and GeographicLib, extracted from the server jar of this build. */
function sdkClassPath() {
  if (classPath !== null) return classPath;
  if (!existsSync(jarPath)) throw new Error(`no server jar at ${jarPath} (build first)`);
  // In the run's output, beside its temporary folders (which must be left empty), once per build.
  const folder = join(dirname(runFoldersParent()), `geodesy-${Math.round(statSync(jarPath).mtimeMs)}`);
  const libs = join(folder, 'BOOT-INF', 'lib');
  if (!existsSync(libs) || readdirSync(libs).length < 2) {
    mkdirSync(folder, { recursive: true });
    const names = execFileSync('jar', ['tf', jarPath], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split(/\r?\n/).filter((n) => LIBS.test(n));
    if (names.length !== 2) throw new Error(`the server jar should hold the SDK and GeographicLib, found: ${names.join(', ')}`);
    execFileSync('jar', ['xf', jarPath, ...names], { cwd: folder, timeout: 60_000 });
  }
  classPath = readdirSync(libs).map((name) => join(libs, name)).join(delimiter);
  return classPath;
}

/** Runs queries (GeodesyQuery.java's lines) and returns each answer's numbers. */
function run(queries) {
  if (queries.length === 0) return [];
  const input = queries.map((q) => q.map((v) => (typeof v === 'number' ? v.toString() : v)).join(' ')).join('\n') + '\n';
  const output = execFileSync('java', ['--class-path', sdkClassPath(), helper], { input, encoding: 'utf8', timeout: 60_000 });
  const lines = output.trim().split(/\r?\n/);
  if (lines.length !== queries.length) throw new Error(`geodesy: ${queries.length} queries, ${lines.length} answers`);
  return lines.map((line) => line.trim().split(' ').map(Number));
}

/** For each pair [from, to]: { metres, initialAzimuth, finalAzimuth } along the geodesic. */
export function inverse(pairs) {
  return run(pairs.map(([a, b]) => ['inverse', a[0], a[1], b[0], b[1]])).map(([metres, initialAzimuth, finalAzimuth]) => ({ metres, initialAzimuth, finalAzimuth }));
}

/** The distance in metres between two positions, along the geodesic. */
export function distance(a, b) {
  return inverse([[a, b]])[0].metres;
}

/** For each { from, azimuth, metres }: the position reached, [lon, lat]. */
export function direct(moves) {
  return run(moves.map(({ from, azimuth, metres }) => ['direct', from[0], from[1], azimuth, metres])).map(([lon, lat]) => [lon, lat]);
}

/** For each distance along the path through `points`: { position, azimuth, leg, fraction }, as `GeodesicPath.at` gives it. */
export function along(points, distances) {
  return run(distances.map((d) => ['at', d, ...points.flat()])).map(([lon, lat, azimuth, leg, fraction]) => ({ position: [lon, lat], azimuth, leg, fraction }));
}
