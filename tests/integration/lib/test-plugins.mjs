// Builds and installs the ITA's test-only plugins with a server part (owner decision 2026-10-10,
// option A): compiled with the JDK's javac and jar against the Plugin SDK jar that
// tools/build.mjs builds, into the run's output folder, and installed only into a test's own
// plugin folder. Nothing is installed, nothing outside tests/integration/ and the temporary
// folders is written, and the project's build never sees these plugins (so the plugin rules,
// which they break on purpose, do not check them).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtures } from './plugins.mjs';
import { root } from './server.mjs';

const sdkModule = join(root, 'server', 'plugin-sdk', 'api');
// The run's own output folder when run.mjs started the tests (pruned with the run), else out/.
const outRoot = join(process.env.EMC2_OUT ?? join(root, 'tests', 'integration', 'out'), 'test-plugins');
const built = new Map();

/**
 * The Maven version of the Plugin SDK module (server/plugin-sdk/api/pom.xml): its own <version>, or
 * the parent's it inherits. E.g. "0.1.1-SNAPSHOT".
 */
export function sdkMavenVersion() {
  const pom = readFileSync(join(sdkModule, 'pom.xml'), 'utf8');
  const parent = /<parent>[\s\S]*?<version>([^<]+)<\/version>[\s\S]*?<\/parent>/.exec(pom)?.[1];
  const own = /<version>([^<]+)<\/version>/.exec(
    pom.replace(/<(parent|dependencies|dependencyManagement|build|profiles)>[\s\S]*?<\/\1>/g, ''),
  )?.[1];
  const version = own ?? parent;
  if (!version) throw new Error(`no version in ${join(sdkModule, 'pom.xml')}`);
  return version.trim();
}

/** The SDK version ECore implements, as manifests name it: the Maven version without -SNAPSHOT. */
export function sdkVersion() {
  return sdkMavenVersion().replace(/-SNAPSHOT$/, '');
}

/** The Plugin SDK jar of the current version, built by tools/build.mjs. */
export function sdkJar() {
  const jar = join(sdkModule, 'target', `emc2-plugin-sdk-${sdkMavenVersion()}.jar`);
  if (!existsSync(jar)) throw new Error(`no ${jar}: run node tools/build.mjs`);
  return jar;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw new Error(`could not run ${command}: ${result.error.message} (is JDK 25 on the PATH?)`);
  if (result.status !== 0) throw new Error(`${command} failed:\n${result.stdout}\n${result.stderr}`);
}

function javaSources(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? javaSources(path) : entry.name.endsWith('.java') ? [path] : [];
  });
}

/** Compiles a test plugin's server part once per process; returns the jar's path. */
export function buildTestPlugin(id) {
  if (built.has(id)) return built.get(id);
  const sources = javaSources(join(fixtures, id, 'server', 'src'));
  const out = join(outRoot, `${id}-${process.pid}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'classes'), { recursive: true });
  run('javac', ['--release', '25', '-proc:none', '-Xlint:-options', '-cp', sdkJar(), '-d', join(out, 'classes'), ...sources]);
  const jar = join(out, `${id}.jar`);
  run('jar', ['--create', '--file', jar, '-C', join(out, 'classes'), '.']);
  built.set(id, jar);
  return jar;
}

/**
 * Installs a test plugin into `pluginsDir` in the installed layout (plugin.json, server/*.jar).
 * In the installed copy only: `settings` overrides the manifest's setting defaults (in M0 the
 * defaults are a plugin's settings), `as` installs it under another id (folder and id),
 * `sdkVersion` replaces the SDK range it asks for, and `dataTypes` declares data types (SDK v1
 * manifest field, e.g. `{ suffix: 'thing', name: 'ITA thing' }`: the id becomes
 * `<plugin id>.<suffix>`, as ECore requires).
 */
export function installTestPlugin(pluginsDir, id, { settings = {}, as = id, sdkVersion, dataTypes } = {}) {
  const target = join(pluginsDir, as);
  mkdirSync(join(target, 'server'), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(fixtures, id, 'plugin.json'), 'utf8'));
  for (const [name, value] of Object.entries(settings)) manifest.settings.properties[name].default = value;
  manifest.id = as;
  if (sdkVersion) manifest.sdkVersion = sdkVersion;
  if (dataTypes) manifest.dataTypes = dataTypes.map(({ suffix, ...rest }) => ({ id: `${as}.${suffix}`, ...rest }));
  writeFileSync(join(target, 'plugin.json'), JSON.stringify(manifest, null, 2));
  cpSync(buildTestPlugin(id), join(target, 'server', `${as}.jar`));
}
