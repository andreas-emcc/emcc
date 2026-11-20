// Assembles the installed layout of every plugin into build/plugins/<id>/ (docs/plugins/design-pattern.md
// section 4), for development runs (tools/start.mjs) and for the integration tests.
//
//   plugins/<id>/plugin.json            -> build/plugins/<id>/plugin.json
//     (the built one in plugins/<id>/web/dist/plugin.json, which carries web.shared, wins if there is a web part)
//   plugins/<id>/server/target/*.jar    -> build/plugins/<id>/server/*.jar   (not -sources, -tests or original-*)
//   plugins/<id>/web/dist/**            -> build/plugins/<id>/web/**          (everything but plugin.json)
//
// Folders whose names start with "_" or "." (the template) are never assembled. A plugin whose manifest id differs
// from its folder name, or that misses a built part its manifest declares, is an error: the plugin host would refuse it.
// Usage: node tools/assemble-plugins.mjs      (also run by tools/build.mjs after the builds)
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './lib.mjs';

const isServerJar = (name) => name.endsWith('.jar') && !name.endsWith('-sources.jar') && !name.endsWith('-tests.jar') && !name.startsWith('original-');

/**
 * Assembles all plugins found in `source` into `out`. `out` is emptied first.
 * Returns { assembled: [ids], skipped: [names], problems: [text] }. Nothing is thrown for a broken plugin:
 * the caller decides (the build fails on problems).
 */
export function assemblePlugins({ source, out, log = () => {} }) {
  const assembled = [];
  const skipped = [];
  const problems = [];
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  if (!existsSync(source)) return { assembled, skipped, problems };

  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    if (id.startsWith('_') || id.startsWith('.')) {
      skipped.push(id);
      continue;
    }
    const dir = join(source, id);
    const builtManifest = join(dir, 'web', 'dist', 'plugin.json');
    const manifestFile = existsSync(builtManifest) ? builtManifest : join(dir, 'plugin.json');
    if (!existsSync(manifestFile)) {
      problems.push(`${id}: no plugin.json (neither web/dist/plugin.json nor plugin.json)`);
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    } catch (e) {
      problems.push(`${id}: ${manifestFile} is not valid JSON: ${e.message}`);
      continue;
    }
    if (manifest.id !== id) {
      problems.push(`${id}: the manifest's id is "${manifest.id}"; the folder must be named like the id`);
      continue;
    }

    const target = join(out, id);
    const own = [];
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');

    if (manifest.server) {
      const targetDir = join(dir, 'server', 'target');
      const jars = existsSync(targetDir) ? readdirSync(targetDir).filter(isServerJar) : [];
      if (jars.length === 0) {
        problems.push(`${id}: the manifest declares a server part but there is no jar in plugins/${id}/server/target/ (build the server first)`);
        rmSync(target, { recursive: true, force: true });
        continue;
      }
      mkdirSync(join(target, 'server'), { recursive: true });
      for (const jar of jars) cpSync(join(targetDir, jar), join(target, 'server', jar));
      own.push(`server ${jars.join(', ')}`);
    }

    if (manifest.web) {
      const dist = join(dir, 'web', 'dist');
      const entryFile = join(dist, manifest.web.entry ?? 'index.js');
      if (!existsSync(entryFile)) {
        problems.push(`${id}: the manifest declares a web part but ${entryFile} does not exist (build the web part first)`);
        rmSync(target, { recursive: true, force: true });
        continue;
      }
      cpSync(dist, join(target, 'web'), { recursive: true, filter: (src) => resolve(src) !== resolve(builtManifest) });
      own.push('web');
    }
    assembled.push(id);
    log(`  ${id}: ${own.join('; ') || 'manifest only'}`);
  }
  return { assembled, skipped, problems };
}

/** The same with the repository's folders, printing what it did. Returns the problems. */
export function assembleRepositoryPlugins() {
  const source = join(root, 'plugins');
  const out = join(root, 'build', 'plugins');
  console.log(`\n==> Assemble the plugins into ${out}`);
  const result = assemblePlugins({ source, out, log: (line) => console.log(line) });
  if (result.assembled.length === 0) console.log('  (no plugins to assemble)');
  if (result.skipped.length) console.log(`  skipped: ${result.skipped.join(', ')}`);
  for (const problem of result.problems) console.error(`  PROBLEM: ${problem}`);
  return result.problems;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(dirname(fileURLToPath(import.meta.url)), 'assemble-plugins.mjs')) {
  const problems = assembleRepositoryPlugins();
  if (problems.length) {
    console.error(`\nFAILED: ${problems.length} plugin(s) could not be assembled`);
    process.exit(1);
  }
  console.log('\nOK');
}
