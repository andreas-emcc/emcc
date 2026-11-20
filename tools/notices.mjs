// Generates the third-party notices file (T-028, CR-0002, CR-0003, CR-0008): the licence and copyright
// texts of every shipped dependency, collected from disk; nothing is downloaded.
//   - npm: the packages the root package-lock.json does not mark "dev" (the web client, its shared
//     libraries and the plugins' bundled libraries); texts from LICENSE/NOTICE files in node_modules.
//   - Maven: the libraries inside the built server jar; texts from META-INF/LICENSE*/NOTICE* in each jar.
//   - A package without a text gets its own text kept in tools/third-party-texts/<ecosystem>-<name>.txt
//     (for licences whose text names the copyright holder, e.g. ASM's BSD-3-Clause), or else the standard
//     text of its licence (Apache-2.0 from the project's own LICENSE, EPL-2.0 from a shipped jar that
//     carries it), marked as added, with the copyright holder and source named in its POM or package.json.
//   - Data that installed plugins ship (DATA_SETS in licenses.mjs, e.g. Natural Earth, CR-0009), with its
//     text from tools/third-party-texts/, when the plugin is in build/plugins/ (T-044).
//   - The Java runtime of a release zip keeps its own texts in runtime/legal/ (CR-0008).
//   - Extra notes beside a package's own texts (EXTRA_NOTES, e.g. CR-0029's CC-BY-3.0 note in mil-sym-ts),
//     kept in tools/third-party-texts/, so they ship even when minifying drops the comment.
// Usage: node tools/notices.mjs   writes build/THIRD-PARTY-NOTICES.txt; exit code 1 when a shipped
// package has no text and none can be added, or when the server jar has not been built.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './lib.mjs';
import { allowed, checkMaven, checkNpm, DATA_SETS, MAVEN_REPO, pomValue, SERVER_JAR, SHIPPED } from './licenses.mjs';
import { readZipEntries } from './zip.mjs';

export const NOTICES_FILE = join(root, 'build', 'THIRD-PARTY-NOTICES.txt');
/** Licence texts of shipped packages that carry none themselves, one file per package (without version). */
export const KEPT_TEXTS = join(root, 'tools', 'third-party-texts');

/**
 * Notes that ship beside a package's own texts, each allowed by a CR: the package's name without its
 * version, and the kept file in tools/third-party-texts/.
 */
export const EXTRA_NOTES = [
  { ecosystem: 'npm', name: '@armyc2.c5isr.renderer/mil-sym-ts-web', text: 'npm-@armyc2.c5isr.renderer-mil-sym-ts-web-cc-by-3.0-note.txt', cr: 'CR-0029' },
];

/** Adds each extra note to its package's texts; a package that is not shipped gets none. Returns the notes whose file is missing. */
export function addNotes(packages, keptDir = KEPT_TEXTS, notes = EXTRA_NOTES) {
  const missing = [];
  for (const note of notes) {
    for (const p of packages.filter((x) => x.ecosystem === note.ecosystem && x.name.startsWith(`${note.name}@`))) {
      const file = join(keptDir, note.text);
      if (!existsSync(file)) { missing.push(note); continue; }
      p.texts = [...p.texts, { file: `${note.text} (kept in tools/third-party-texts/, ${note.cr})`, text: clean(readFileSync(file, 'utf8')) }];
    }
  }
  return missing;
}

/** File names of licence texts in an npm package folder. */
const NPM_TEXT = /^(licen[sc]e|copying|notice)([-._].*)?$/i;
/** Entries of licence texts in a jar: directly in META-INF/, e.g. LICENSE.txt, NOTICE, FastDoubleParser-LICENSE. */
const JAR_TEXT = /^META-INF\/[^/]*(licen[sc]e|notice|copying)[^/]*$/i;

/** Line ends unified, trailing spaces and blank lines at the ends removed. */
export function clean(text) {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '');
}

/** The EPL-2.0 part of a licence file that starts with it (e.g. a dual EPL-2.0 / GPL-2.0 file), or undefined. */
export function eplSection(text) {
  const t = clean(text);
  if (!/^#?\s*Eclipse Public License - v 2\.0/.test(t)) return undefined;
  const gpl = t.search(/^#+\s+The GNU General Public License/m);
  return clean((gpl < 0 ? t : t.slice(0, gpl)).replace(/\n-{3,}\s*$/, ''));
}

/**
 * Chooses the licence whose standard text is added for a package without a text: the first alternative of
 * the SPDX expression for which a standard text is known (e.g. "EPL-2.0 OR LGPL-2.1-only" gives EPL-2.0).
 */
export function fallbackLicence(expression, standard) {
  if (!expression) return undefined;
  return expression.replace(/[()]/g, ' ').split(/\s+OR\s+/i).map((s) => s.trim()).find((id) => standard[id] !== undefined);
}

/** The file name of a package's kept text: "<ecosystem>-<name without version>.txt", e.g. maven-asm.txt. */
export function keptTextFile(p) {
  return `${p.ecosystem}-${p.name.replace(/@[^@]*$/, '').replace(/[\/:]/g, '-')}.txt`;
}

/** How a package's licence is shown in the summary: the option used when there is a choice. */
export function licenceLabel(p) {
  if (p.kept) return `${p.license ?? 'see its text'} (no text in the package: its own text kept in tools/third-party-texts/)`;
  if (p.added) {
    const choice = /\sOR\s/i.test(p.license ?? '') ? `; used option of: ${p.license}` : '';
    return `${p.added.licence} (no text in the package: standard text added${choice})`;
  }
  if (!p.license) return 'licence not named in its metadata: see its text';
  const options = p.license.replace(/[()]/g, ' ').split(/\s+OR\s+/i).map((s) => s.trim());
  if (options.length < 2) return p.license;
  const used = options.find((o) => allowed(o, SHIPPED));
  return used ? `${used} (used option of: ${p.license})` : p.license;
}

function npmTexts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => NPM_TEXT.test(f) && statSync(join(dir, f)).isFile())
    .sort()
    .map((f) => ({ file: f, text: clean(readFileSync(join(dir, f), 'utf8')) }));
}

function npmOrigin(dir) {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) return {};
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const author = typeof json.author === 'string' ? json.author : json.author?.name;
  const repo = typeof json.repository === 'string' ? json.repository : json.repository?.url;
  return { holder: author, source: repo?.replace(/^git\+/, '') };
}

/** All shipped packages with their texts. Returns { packages, missing } (missing: packages without any text). */
export function collect(keptDir = KEPT_TEXTS, pluginsDir = join(root, 'build', 'plugins')) {
  if (!existsSync(SERVER_JAR)) throw new Error('server/app/target/emc2-app.jar not found: run node tools/build.mjs first');
  const packages = [];
  for (const dep of checkNpm(join(root, 'package-lock.json')).filter((d) => !d.dev)) {
    const dir = join(root, dep.path);
    packages.push({ ...dep, texts: npmTexts(dir), origin: () => npmOrigin(dir) });
  }
  const jarEntries = new Map(readZipEntries(readFileSync(SERVER_JAR)).map((e) => [e.name, e]));
  for (const dep of checkMaven()) {
    const inner = readZipEntries(jarEntries.get(dep.entry).read());
    const texts = inner
      .filter((e) => JAR_TEXT.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => ({ file: e.name.slice('META-INF/'.length), text: clean(e.read().toString('utf8')) }));
    const origin = () => (dep.pom ? {
      holder: pomValue(dep.pom, MAVEN_REPO, /<organization>[\s\S]*?<name>([^<]+)<\/name>/),
      source: pomValue(dep.pom, MAVEN_REPO, /<scm>[\s\S]*?<url>([^<]+)<\/url>/),
    } : {});
    packages.push({ ...dep, texts, origin });
  }

  // Data shipped by installed plugins, each with its text kept in tools/third-party-texts/.
  for (const set of DATA_SETS) {
    if (!existsSync(join(pluginsDir, set.plugin))) continue;
    const file = join(keptDir, set.text);
    packages.push({ ecosystem: 'data', name: set.name, license: set.license, texts: existsSync(file) ? [{ file: set.text, text: clean(readFileSync(file, 'utf8')) }] : [], origin: () => ({}) });
  }

  // Standard texts for packages that carry none: the project's own LICENSE is the Apache License 2.0.
  const standard = { 'Apache-2.0': clean(readFileSync(join(root, 'LICENSE'), 'utf8')) };
  for (const p of packages) {
    for (const t of p.texts) standard['EPL-2.0'] ??= eplSection(t.text);
  }
  const missing = [];
  for (const p of packages) {
    if (p.texts.length > 0) continue;
    const kept = join(keptDir, keptTextFile(p));
    if (existsSync(kept)) {
      p.kept = true;
      p.texts = [{ file: `${keptTextFile(p)} (kept in tools/third-party-texts/)`, text: clean(readFileSync(kept, 'utf8')) }];
      continue;
    }
    const id = fallbackLicence(p.license, standard);
    if (!id) { missing.push(p); continue; }
    const { holder, source } = p.origin();
    p.added = { licence: id, holder, source };
    p.texts = [{ file: `${id} (standard text, added)`, text: standard[id] }];
  }
  for (const note of addNotes(packages, keptDir)) missing.push({ ecosystem: note.ecosystem, name: note.name, license: `its ${note.cr} note`, note });
  return { packages, missing };
}

/** The notices file: a summary, then each distinct set of texts once, with the packages it belongs to. */
export function render(packages, { commit, date }) {
  const sorted = [...packages].sort((a, b) => a.ecosystem.localeCompare(b.ecosystem) || a.name.localeCompare(b.name));
  const groups = new Map();
  for (const p of sorted) {
    const key = createHash('sha256').update(p.texts.map((t) => `${t.file}\n${t.text}`).join('\n\f\n')).digest('hex');
    if (!groups.has(key)) groups.set(key, { texts: p.texts, members: [] });
    groups.get(key).members.push(p);
  }
  const rule = '='.repeat(78);
  const out = [
    'THIRD-PARTY NOTICES',
    '',
    `emc2 (commit ${commit}, ${date}) is licensed under the Apache License 2.0 (LICENSE).`,
    'It includes the third-party software and data listed below. Each package is used under its own licence;',
    'the licence and copyright texts follow. Packages with a choice of licences are used under the',
    'option named in their entry (for example Logback under the EPL-2.0, never the LGPL).',
    '',
    'Release zips also contain a Java runtime: OpenJDK (Eclipse Temurin), GPL-2.0 with the Classpath',
    'Exception. Its licence and the notices of its components are in runtime/legal/ (CR-0008).',
    '',
    `Packages (${sorted.length}):`,
    ...sorted.map((p) => `  ${p.ecosystem.padEnd(6)} ${p.name.padEnd(42)} ${licenceLabel(p)}`),
  ];
  let n = 0;
  for (const { texts, members } of groups.values()) {
    n++;
    out.push('', rule, `[${n}] ${members.map((m) => m.name).join(', ')}`, rule);
    for (const m of members.filter((x) => x.kept)) {
      out.push(`${m.name} carries no licence text. Its own licence text, kept with emc2's build tools, follows.`);
    }
    for (const m of members.filter((x) => x.added)) {
      out.push(`${m.name} carries no licence text. It is used under the ${m.added.licence}; the standard text is added below.`);
      if (m.added.holder) out.push(`Copyright holder: ${m.added.holder}.`);
      if (m.added.source) out.push(`Source: ${m.added.source}`);
    }
    for (const t of texts) out.push('', `--- ${t.file} ---`, '', t.text);
  }
  return `${out.join('\n')}\n`;
}

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** Writes build/THIRD-PARTY-NOTICES.txt. Returns a list of problems (empty when every shipped package has a text). */
export function writeNotices(file = NOTICES_FILE) {
  let result;
  try {
    result = collect();
  } catch (e) {
    console.error(`\nNotices: ${e.message}`);
    return [e.message];
  }
  const { packages, missing } = result;
  const commit = git('rev-parse', '--short', 'HEAD');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, render(packages.filter((p) => !missing.includes(p)), { commit, date: new Date().toISOString().slice(0, 10) }));
  const added = packages.filter((p) => p.added);
  console.log(`\n==> notices: ${packages.length - missing.length} packages in ${file.replace(root, '').replace(/^[\\/]/, '')}${added.length ? `, standard text added for ${added.map((p) => p.name).join(', ')}` : ''}`);
  for (const p of missing) console.error(`  NO LICENCE TEXT: ${p.ecosystem} ${p.name} (${p.license ?? 'licence unknown'}): add its text as tools/third-party-texts/${keptTextFile(p)}`);
  return missing.map((p) => `no licence text for ${p.name}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = writeNotices();
  process.exit(problems.length ? 1 : 0);
}
