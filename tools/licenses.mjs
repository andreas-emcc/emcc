// Checks the licenses of the dependencies against CLAUDE.md section 4 and ADR-0016.
// Usage: node tools/licenses.mjs
//   - npm: reads package-lock.json (the repository root: web client and plugin web parts), model/package-lock.json and tests/integration/package-lock.json. A package that only the dev
//     dependencies need ("dev": true) is dev-only; everything else ships.
//   - Maven: reads the library list inside the built server jar (server/app/target/emc2-app.jar, build
//     first) and looks up each library's license in the local Maven repository (~/.m2). What is in the
//     jar ships; test libraries are not in it.
// Exit code 1 when a dependency has a license that the policy does not allow. Dependencies without
// license information are reported as warnings. Spikes (spikes/) are never shipped and are not checked.
// No dependencies, nothing is downloaded or installed.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './lib.mjs';

// ---------- the policy (ADR-0016; change only together with CLAUDE.md section 4) ----------
export const SHIPPED = new Set(['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'EPL-2.0', 'ISC', 'Zlib', 'CC0-1.0',
  'EPL-1.0' /* unmodified binary dependencies only, CR-0003 */]);
const DEV_ONLY = new Set([...SHIPPED, 'MPL-2.0', 'CC-BY-4.0', 'BlueOak-1.0.0', 'MIT-0' /* CR-0001 */]);

// ---------- license expressions ----------
/** Evaluates an SPDX expression: OR needs one allowed alternative, AND needs all. */
export function allowed(expression, set) {
  const text = expression.replace(/[()]/g, ' ').trim();
  return text.split(/\s+OR\s+/i).some((alt) => alt.split(/\s+AND\s+/i).every((id) => set.has(id.trim())));
}

/** Maps the free-text license names found in POMs to SPDX identifiers where we can. */
function spdxOf(name) {
  const n = name.trim();
  if (/^[A-Za-z0-9.+-]+$/.test(n) && /-|^MIT$|^ISC$|^Zlib$/.test(n)) return n; // already an identifier
  const l = n.toLowerCase();
  if (/apache/.test(l) && /2/.test(l)) return 'Apache-2.0';
  if (/^epl[ -]?v?2/.test(l) || (/eclipse public license/.test(l) && /(2\.0|v ?2)/.test(l))) return 'EPL-2.0';
  if (/^epl[ -]?v?1/.test(l) || (/eclipse public license/.test(l) && /1\.0/.test(l))) return 'EPL-1.0';
  if (/eclipse distribution license|new bsd|bsd.?3|3-clause/.test(l)) return 'BSD-3-Clause';
  if (/bsd.?2|simplified bsd|2-clause/.test(l)) return 'BSD-2-Clause';
  if (/^bsd/.test(l)) return 'BSD-3-Clause';
  if (/^(the )?mit( license)?$/.test(l)) return 'MIT';
  if (/lesser general public|lgpl/.test(l)) return 'LGPL-2.1';
  if (/general public|gpl/.test(l)) return 'GPL';
  if (/mozilla|mpl/.test(l)) return 'MPL-2.0';
  if (/cddl/.test(l)) return 'CDDL-1.0';
  return n;
}

// ---------- npm ----------
/** The packages of an npm lock file: { ecosystem, source, path, name: "id@version", license, dev }. */
export function checkNpm(lockPath) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const found = [];
  for (const [path, info] of Object.entries(lock.packages || {})) {
    if (!path.includes('node_modules/') || info.link) continue; // the project's own packages
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const license = typeof info.license === 'string' ? info.license : info.license?.type || info.licenses?.map((x) => x.type).join(' OR ');
    found.push({ ecosystem: 'npm', source: lockPath.replace(root, '').replace(/^[\\/]/, ''), path, name: `${name}@${info.version}`, license, dev: !!info.dev });
  }
  return found;
}

// ---------- Maven ----------
/** The names of the entries in a zip file, read from its central directory (no tools needed). */
function zipNames(file) {
  const buf = readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`${file} is not a zip file`);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('unexpected zip layout (zip64 is not supported)');
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    names.push(buf.toString('utf8', p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

export function indexPoms(repo) {
  const index = new Map(); // "artifactId@version" -> pom path
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.pom')) {
        const parts = full.slice(repo.length + 1).split(/[\\/]/);
        const version = parts[parts.length - 2];
        const artifact = parts[parts.length - 3];
        if (entry.name === `${artifact}-${version}.pom`) index.set(`${artifact}@${version}`, full);
      }
    }
  };
  walk(repo);
  return index;
}

/** The first value of `tag` in a POM or its parents, e.g. the organization's name or the SCM URL. */
export function pomValue(pomPath, repo, pattern, depth = 0) {
  const xml = readFileSync(pomPath, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const m = xml.match(pattern);
  if (m) return m[1].trim();
  const parent = xml.match(/<parent>[\s\S]*?<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>\s*<version>([^<]+)<\/version>/);
  if (parent && depth < 6) {
    const parentPom = join(repo, ...parent[1].trim().split('.'), parent[2].trim(), parent[3].trim(), `${parent[2].trim()}-${parent[3].trim()}.pom`);
    if (existsSync(parentPom)) return pomValue(parentPom, repo, pattern, depth + 1);
  }
  return undefined;
}

function pomLicenses(pomPath, repo, depth = 0) {
  const xml = readFileSync(pomPath, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const block = xml.match(/<licenses>([\s\S]*?)<\/licenses>/);
  if (block) {
    const names = [...block[1].matchAll(/<license>[\s\S]*?<name>([^<]*)<\/name>/g)].map((m) => spdxOf(m[1]));
    if (names.length) return names.join(' OR '); // several licenses in a POM are alternatives
  }
  const parent = xml.match(/<parent>[\s\S]*?<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>\s*<version>([^<]+)<\/version>/);
  if (parent && depth < 6) {
    const parentPom = join(repo, ...parent[1].trim().split('.'), parent[2].trim(), parent[3].trim(), `${parent[2].trim()}-${parent[3].trim()}.pom`);
    if (existsSync(parentPom)) return pomLicenses(parentPom, repo, depth + 1);
  }
  return undefined;
}

export const SERVER_JAR = join(root, 'server', 'app', 'target', 'emc2-app.jar');
export const MAVEN_REPO = join(homedir(), '.m2', 'repository');

/** The libraries inside the built server jar: { ecosystem, source, entry, pom, name: "id@version", license, dev: false }. */
export function checkMaven() {
  const jar = SERVER_JAR;
  const repo = MAVEN_REPO;
  if (!existsSync(jar)) {
    console.warn('Maven: server/app/target/emc2-app.jar not found. Run "node tools/build.mjs" first. Skipped.');
    return [];
  }
  if (!existsSync(repo)) {
    console.warn(`Maven: ${repo} not found. Skipped.`);
    return [];
  }
  const index = indexPoms(repo);
  const libs = zipNames(jar).filter((n) => /^BOOT-INF\/lib\/.+\.jar$/.test(n)).map((n) => n.slice('BOOT-INF/lib/'.length, -'.jar'.length));
  const found = [];
  for (const lib of libs) {
    const m = lib.match(/^(.*?)-(\d[\w.+-]*)$/);
    const [artifact, version] = m ? [m[1], m[2]] : [lib, ''];
    if (artifact.startsWith('emc2-')) continue; // the project's own modules
    const pom = index.get(`${artifact}@${version}`);
    found.push({ ecosystem: 'maven', source: 'server/app/target/emc2-app.jar', entry: `BOOT-INF/lib/${lib}.jar`, pom, name: `${artifact}@${version}`, license: pom ? pomLicenses(pom, repo) : undefined, dev: false });
  }
  return found;
}

// ---------- run ----------
/**
 * Map and other data that plugins ship in a data/ folder, each approved by a change request
 * (CLAUDE.md section 4). Natural Earth: public domain, converted in format or simplified, not edited
 * in content (CR-0009). Any other plugin data folder is a violation until a CR approves it.
 */
export const DATA_SETS = [
  { plugin: 'basemap-naturalearth', name: 'Natural Earth vector 5.1.2', license: 'Public domain', approval: 'CR-0009', text: 'data-natural-earth.txt' },
];

/** Every plugins/<id>/data folder: { ecosystem: 'data', name, plugin, license, approved, source }. */
export function checkData(pluginsDir = join(root, 'plugins')) {
  if (!existsSync(pluginsDir)) return [];
  const found = [];
  for (const id of readdirSync(pluginsDir).sort()) {
    if (!existsSync(join(pluginsDir, id, 'data'))) continue;
    const set = DATA_SETS.find((d) => d.plugin === id);
    found.push({ ecosystem: 'data', plugin: id, name: set ? set.name : `plugins/${id}/data`, license: set?.license, approved: set?.approval, source: `plugins/${id}/data` });
  }
  return found;
}

function main() {
const all = [];
for (const lock of ['package-lock.json', 'model/package-lock.json', 'tests/integration/package-lock.json']) {
  if (existsSync(join(root, lock))) all.push(...checkNpm(join(root, lock)));
}
all.push(...checkMaven());

const violations = [];
const unknown = [];
const counts = {};
for (const d of all) {
  const key = `${d.ecosystem}:${d.dev ? 'dev-only' : 'shipped'}`;
  counts[key] = (counts[key] || 0) + 1;
  if (!d.license) unknown.push(d);
  else if (!allowed(d.license, d.dev ? DEV_ONLY : SHIPPED)) violations.push(d);
}

const data = checkData();
for (const d of data) {
  counts['data:shipped'] = (counts['data:shipped'] || 0) + 1;
  if (!d.approved) violations.push({ ...d, dev: false, license: 'data without an approving change request' });
}

console.log('License check (CLAUDE.md section 4, ADR-0016)');
for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k.padEnd(20)} ${v} packages`);
if (all.length === 0) console.log('  Nothing to check: no lock files and no built server jar.');

if (unknown.length) {
  console.log(`\nWARNING: ${unknown.length} without license information (check by hand):`);
  for (const d of unknown) console.log(`  ${d.ecosystem} ${d.dev ? '[dev]' : '[shipped]'} ${d.name}`);
}
if (violations.length) {
  console.log(`\nNOT ALLOWED: ${violations.length} dependencies:`);
  for (const d of violations) console.log(`  ${d.ecosystem} ${d.dev ? '[dev]' : '[shipped]'} ${d.name}: ${d.license}  (${d.source})`);
  console.log('\nA license outside the policy needs the owner\'s approval through a change request.');
  process.exit(1);
}
console.log(`\nOK: no dependency breaks the policy${unknown.length ? ' (see the warnings above)' : ''}.`);
}

// The check runs when this file is started as a script; tools/notices.mjs imports its package lists.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
