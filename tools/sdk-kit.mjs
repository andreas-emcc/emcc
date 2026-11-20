// The SDK kit (M9 B5; plugin gap analysis G1 and G20; owner GQ1 A): what someone outside this repository needs to build,
// test and package a plugin for this release, in one zip next to it. Made from the build's output, with the JDK's own
// tools (jar, javadoc), Maven's dependency plugin already in the build's cache, and the repository's TypeScript and npm;
// nothing is downloaded. The parts:
//   maven/       a Maven repository: the stand-alone emc2-plugin-parent, the SDK and the test kit, each jar with its
//                sources and Javadoc, and flattened POMs (no parent chain into this repository's server build);
//   web/         the web SDK as an npm package of JavaScript with types and the data model's schemas, and the shell's
//                import map;
//   schemas/     the data model's JSON schemas;
//   template/    the plugin template, with its two repository paths pointed at the kit;
//   install-maven.bat / .sh, README.md (with the release runtime's Java modules), LICENSE.
// Usage: node tools/sdk-kit.mjs [--out <folder>] (after node tools/build.mjs); tools/release.mjs calls buildSdkKit.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { isWindows, root } from './lib.mjs';
import { zipDirectory } from './zip.mjs';

/** Java modules of the release's runtime (jlink; G20): a plugin may use only these. */
export const RUNTIME_MODULES = [
  'java.base', 'java.compiler', 'java.desktop', 'java.instrument', 'java.logging', 'java.management',
  'java.naming', 'java.net.http', 'java.prefs', 'java.scripting', 'java.security.jgss', 'java.security.sasl',
  'java.sql', 'java.transaction.xa', 'java.xml', 'jdk.charsets', 'jdk.crypto.ec', 'jdk.localedata',
  'jdk.jfr', 'jdk.management', 'jdk.naming.dns', 'jdk.net', 'jdk.unsupported', 'jdk.zipfs',
];

const DEPENDENCY_PLUGIN = 'org.apache.maven.plugins:maven-dependency-plugin:3.11.0';
const GROUP = 'dev.emcc';

function fail(message) { throw new Error(`SDK kit: ${message}`); }
function read(...p) { return readFileSync(join(root, ...p), 'utf8'); }
const tag = (xml, name) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];

/** The SDK's Maven version (CR-0005: emc2-plugin-sdk-parent's, e.g. 1.9.0, or 1.9.0-SNAPSHOT before a freeze) and the web SDK's (1.9.0). */
export function sdkVersions() {
  const pom = read('server', 'plugin-sdk', 'pom.xml').replace(/<parent>[\s\S]*?<\/parent>/, '');
  const maven = tag(pom, 'version');
  const web = JSON.parse(read('web', 'plugin-sdk', 'package.json')).version;
  if (!maven || maven.replace(/-SNAPSHOT$/, '') !== web) fail(`the Java SDK (${maven}) and the web SDK (${web}) differ`);
  return { maven, web };
}

/** server/pom.xml's managed versions: artifactId -> version, and groupId -> version for the imported BOMs. */
export function managedVersions(serverPom = read('server', 'pom.xml')) {
  const props = Object.fromEntries([...serverPom.matchAll(/<([\w.-]+)>([^<]*)<\/\1>/g)]
    .filter(([, k]) => k.endsWith('.version')).map(([, k, v]) => [k, v]));
  // ${project.version} is the server's own modules' version, not one the SDK uses: those entries are left out.
  const resolve = (v) => (v?.includes('${project.') ? undefined
    : v?.replace(/\$\{([\w.-]+)\}/g, (_, k) => props[k] ?? fail(`unknown property ${k}`)));
  const managed = serverPom.match(/<dependencyManagement>([\s\S]*?)<\/dependencyManagement>/)?.[1] ?? '';
  const byArtifact = {}; const byBomGroup = {};
  for (const [, dep] of managed.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const v = resolve(tag(dep, 'version'));
    if (v === undefined) continue;
    if (tag(dep, 'scope') === 'import') byBomGroup[tag(dep, 'groupId')] = v;
    else byArtifact[tag(dep, 'artifactId')] = v;
  }
  // The BOMs' groups cover their sub-groups (junit-bom: org.junit.jupiter, org.junit.platform).
  return { byArtifact, byBomGroup };
}

/**
 * A flattened POM for one SDK module: its coordinates and its non-test dependencies at exact versions, and no parent, so
 * that Maven outside this repository needs nothing of the server build.
 */
export function flatPom(modulePom, { maven }, managed = managedVersions()) {
  const own = modulePom.replace(/<parent>[\s\S]*?<\/parent>/, '').replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/, '');
  const artifactId = tag(own, 'artifactId');
  const name = tag(own, 'name') ?? artifactId;
  const deps = [];
  for (const [, dep] of (own.match(/<dependencies>([\s\S]*?)<\/dependencies>/)?.[1] ?? '').matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const scope = tag(dep, 'scope') ?? 'compile';
    if (scope === 'test') continue;
    const groupId = tag(dep, 'groupId'); const depId = tag(dep, 'artifactId');
    let version = tag(dep, 'version');
    if (version === '${project.parent.version}' || version === '${project.version}') version = maven;
    version ??= managed.byArtifact[depId]
      ?? Object.entries(managed.byBomGroup).find(([g]) => groupId === g || groupId.startsWith(`${g}.`))?.[1];
    if (!version || version.includes('${')) fail(`${artifactId}: no version for ${groupId}:${depId}`);
    deps.push(`    <dependency>\n      <groupId>${groupId}</groupId>\n      <artifactId>${depId}</artifactId>\n      <version>${version}</version>${scope === 'compile' ? '' : `\n      <scope>${scope}</scope>`}\n    </dependency>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Flattened for the emcc SDK kit (M9 B5): the module's own dependencies at exact versions, no parent. -->
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>${GROUP}</groupId>
  <artifactId>${artifactId}</artifactId>
  <version>${maven}</version>
  <name>${name}</name>
  <licenses>
    <license><name>Apache-2.0</name><url>https://www.apache.org/licenses/LICENSE-2.0</url></license>
  </licenses>
  <dependencies>
${deps.join('\n')}
  </dependencies>
</project>
`;
}

/** The template, with its two repository paths pointed at the kit (its web SDK package and its copy of the import map). */
export function kitTemplateFiles({ web }, files) {
  const once = (text, from, to, file) => {
    if (text.split(from).length !== 2) fail(`${file}: expected "${from}" once (the template changed?)`);
    return text.replace(from, to);
  };
  return {
    'server/pom.xml': once(files['server/pom.xml'], /<relativePath>[^<]*<\/relativePath>/.exec(files['server/pom.xml'])?.[0] ?? '<relativePath>',
      '<relativePath/> <!-- the SDK kit: Maven takes the parent from the local repository (install-maven) -->', 'server/pom.xml'),
    'web/vite.config.ts': once(files['web/vite.config.ts'], "'../../../web/shell/dist/importmap.json'", "'../../web/importmap.json'", 'web/vite.config.ts'),
    'web/package.json': (() => {
      const pkg = JSON.parse(files['web/package.json']);
      if (pkg.devDependencies?.['@emc2/plugin-sdk'] !== web) fail(`web/package.json: expected @emc2/plugin-sdk ${web} in devDependencies`);
      pkg.devDependencies['@emc2/plugin-sdk'] = `file:../../web/emc2-plugin-sdk-${web}.tgz`;
      return `${JSON.stringify(pkg, null, 2)}\n`;
    })(),
  };
}

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], shell: isWindows && !cmd.endsWith('.exe') && !/[\\/]/.test(cmd) });
}

/** Javadoc of one module's sources into a jar; the classpath from Maven, offline. */
function javadocJar(moduleDir, classpath, outJar, work, title) {
  const javaHome = process.env.JAVA_HOME ?? fail('JAVA_HOME is not set');
  const doc = join(work, `${basename(outJar)}-html`);
  rmSync(doc, { recursive: true, force: true });
  execFileSync(join(javaHome, 'bin', isWindows ? 'javadoc.exe' : 'javadoc'), [
    '-quiet', '-Xdoclint:none', '-encoding', 'UTF-8', '-d', doc, '-doctitle', title, '-windowtitle', title,
    '-sourcepath', join(moduleDir, 'src', 'main', 'java'), '-subpackages', 'dev.emcc', '-classpath', classpath,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  execFileSync(join(javaHome, 'bin', isWindows ? 'jar.exe' : 'jar'), ['--create', '--file', outJar, '-C', doc, '.']);
}

function sourcesJar(moduleDir, outJar) {
  const javaHome = process.env.JAVA_HOME ?? fail('JAVA_HOME is not set');
  execFileSync(join(javaHome, 'bin', isWindows ? 'jar.exe' : 'jar'), ['--create', '--file', outJar, '-C', join(moduleDir, 'src', 'main', 'java'), '.']);
}

/**
 * Each module's compile classpath ({dir: artifactId}), from Maven's dependency plugin in the build's cache (offline). One
 * run in the SDK's reactor, so that the test kit's classpath names the SDK built here (its target/classes) and never
 * needs dev.emcc:emc2-plugin-sdk in the local repository (the PDA's finding at the 1.9.0 freeze, without -SNAPSHOT).
 */
function classpaths(modules, work) {
  run('mvn', ['-B', '-q', '-o', '-f', join(root, 'server', 'plugin-sdk', 'pom.xml'), '-pl', Object.keys(modules).join(','),
    'compile', `${DEPENDENCY_PLUGIN}:build-classpath`, '-Dmdep.includeScope=compile',
    `-Dmdep.outputFile=${join(work, '${project.artifactId}.classpath')}`], root);
  return Object.fromEntries(Object.entries(modules).map(([dir, artifact]) => [dir, readFileSync(join(work, `${artifact}.classpath`), 'utf8').trim()]));
}

/** Builds the kit's folder and zip; returns the zip's path. */
export function buildSdkKit({ outDir = join(root, 'releases'), name } = {}) {
  const versions = sdkVersions();
  const kitName = name ?? `emcc-sdk-${versions.web}`;
  const work = join(root, 'build', 'sdk-kit');
  const stage = join(work, kitName);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  // Maven: the parent, the SDK and the test kit, in the local repository's layout.
  const sdk = join(root, 'server', 'plugin-sdk');
  const modules = { api: 'emc2-plugin-sdk', testkit: 'emc2-plugin-sdk-testkit' };
  for (const [dir, artifact] of Object.entries(modules)) {
    const jar = join(sdk, dir, 'target', `${artifact}-${versions.maven}.jar`);
    if (!existsSync(jar)) fail(`no ${jar}: run node tools/build.mjs first`);
  }
  const cps = classpaths(modules, work);
  const repo = join(stage, 'maven');
  const place = (artifact, files) => {
    const dir = join(repo, ...GROUP.split('.'), artifact, versions.maven);
    mkdirSync(dir, { recursive: true });
    for (const [file, write] of Object.entries(files)) write(join(dir, `${artifact}-${versions.maven}${file}`));
  };
  place('emc2-plugin-parent', { '.pom': (to) => cpSync(join(sdk, 'plugin-parent', 'pom.xml'), to) });
  const apiJar = join(sdk, 'api', 'target', `emc2-plugin-sdk-${versions.maven}.jar`);
  for (const [dir, artifact] of Object.entries(modules)) {
    const moduleDir = join(sdk, dir);
    // The test kit's Javadoc needs the SDK's jar from this build, not one from the local repository.
    const cp = dir === 'testkit' ? [apiJar, ...cps[dir].split(isWindows ? ';' : ':').filter((p) => !p.includes(`${GROUP.replace('.', isWindows ? '\\' : '/')}`))].join(isWindows ? ';' : ':') : cps[dir];
    place(artifact, {
      '.jar': (to) => cpSync(join(moduleDir, 'target', `${artifact}-${versions.maven}.jar`), to),
      '.pom': (to) => writeFileSync(to, flatPom(readFileSync(join(moduleDir, 'pom.xml'), 'utf8'), versions)),
      '-sources.jar': (to) => sourcesJar(moduleDir, to),
      '-javadoc.jar': (to) => javadocJar(moduleDir, cp, to, work, `emcc ${artifact} ${versions.web}`),
    });
  }

  // Web: the SDK compiled to JavaScript with declarations, its schemas and its components' CSS, packed by npm.
  const pkgDir = join(work, 'web-sdk');
  mkdirSync(pkgDir, { recursive: true });
  const tsconfig = join(work, 'tsconfig.kit.json');
  writeFileSync(tsconfig, JSON.stringify({
    extends: join(root, 'web', 'plugin-sdk', 'tsconfig.json').replace(/\\/g, '/'),
    compilerOptions: {
      noEmit: false, declaration: true, rewriteRelativeImportExtensions: true, outDir: join(pkgDir, 'dist').replace(/\\/g, '/'),
      rootDir: join(root, 'web', 'plugin-sdk', 'src').replace(/\\/g, '/'), types: [],
    },
    include: [join(root, 'web', 'plugin-sdk', 'src').replace(/\\/g, '/')],
    exclude: [join(root, 'web', 'plugin-sdk', 'src', '**', '*.test.*').replace(/\\/g, '/')],
  }, null, 2));
  execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', tsconfig], { cwd: root, stdio: 'inherit' });
  cpSync(join(root, 'web', 'plugin-sdk', 'src', 'components', 'components.css'), join(pkgDir, 'dist', 'components', 'components.css'));
  cpSync(join(root, 'model', 'schemas'), join(pkgDir, 'schemas'), { recursive: true });
  cpSync(join(root, 'LICENSE'), join(pkgDir, 'LICENSE'));
  const source = JSON.parse(read('web', 'plugin-sdk', 'package.json'));
  const js = (p) => p.replace(/^\.\/src\//, './dist/').replace(/\.tsx?$/, '.js');
  const exportsMap = Object.fromEntries(Object.entries(source.exports).map(([k, v]) => [k,
    v.endsWith('.css') ? js(v) : { types: js(v).replace(/\.js$/, '.d.ts'), default: js(v) }]));
  writeFileSync(join(pkgDir, 'package.json'), `${JSON.stringify({
    name: source.name, version: source.version, license: source.license,
    description: 'The emcc web plugin SDK, from the SDK kit: JavaScript with types, and the data model\'s schemas.',
    type: 'module', exports: exportsMap, files: ['dist', 'schemas', 'LICENSE'],
    dependencies: source.dependencies, peerDependencies: source.peerDependencies,
  }, null, 2)}\n`);
  mkdirSync(join(stage, 'web'), { recursive: true });
  run('npm', ['pack', '--pack-destination', join(stage, 'web')], pkgDir);
  const shellMap = join(root, 'web', 'shell', 'dist', 'importmap.json');
  if (!existsSync(shellMap)) fail(`no ${shellMap}: run node tools/build.mjs first`);
  cpSync(shellMap, join(stage, 'web', 'importmap.json'));

  // The schemas, the template, the install scripts, the readme, the licence.
  cpSync(join(root, 'model', 'schemas'), join(stage, 'schemas'), { recursive: true });
  const template = join(root, 'plugins', '_template');
  cpSync(template, join(stage, 'template'), { recursive: true, filter: (src) => !/[\\/](node_modules|dist|target)([\\/]|$)/.test(src) });
  const rel = ['server/pom.xml', 'web/vite.config.ts', 'web/package.json'];
  const changed = kitTemplateFiles(versions, Object.fromEntries(rel.map((f) => [f, readFileSync(join(template, f), 'utf8')])));
  for (const [f, text] of Object.entries(changed)) writeFileSync(join(stage, 'template', f), text);
  writeFileSync(join(stage, 'install-maven.bat'), installBat());
  writeFileSync(join(stage, 'install-maven.sh'), installSh(), { mode: 0o755 });
  writeFileSync(join(stage, 'README.md'), kitReadme(versions));
  cpSync(join(root, 'LICENSE'), join(stage, 'LICENSE'));

  mkdirSync(outDir, { recursive: true });
  const zip = join(outDir, `${kitName}.zip`);
  const result = zipDirectory(stage, zip, kitName);
  console.log(`SDK kit: ${zip} (${result.files} files, ${(result.bytes / 1024 / 1024).toFixed(1)} MB)`);
  return zip;
}

/** Copies maven/ into the local Maven repository (default ~/.m2/repository, or the folder given). */
export function installBat() {
  return [
    '@echo off',
    'rem Installs the emcc SDK kit\'s Maven artifacts (the plugin parent, the SDK, the test kit) into your local Maven',
    'rem repository: install-maven.bat [repository folder]; the default is %USERPROFILE%\\.m2\\repository.',
    'setlocal',
    'set "REPO=%~1"',
    'if "%REPO%"=="" set "REPO=%USERPROFILE%\\.m2\\repository"',
    'if not exist "%~dp0maven\\dev\\emcc" (echo There is no maven folder next to this script: unpack the whole zip first.& exit /b 1)',
    'xcopy /e /i /y /q "%~dp0maven" "%REPO%" >nul || (echo Could not copy into "%REPO%".& exit /b 1)',
    'echo Installed into "%REPO%": dev.emcc emc2-plugin-parent, emc2-plugin-sdk, emc2-plugin-sdk-testkit.',
    '',
  ].join('\r\n');
}

export function installSh() {
  return [
    '#!/bin/sh',
    '# Installs the emcc SDK kit\'s Maven artifacts into your local Maven repository: ./install-maven.sh [repository folder];',
    '# the default is ~/.m2/repository.',
    'REPO="${1:-$HOME/.m2/repository}"',
    'cd "$(dirname "$0")" || exit 1',
    '[ -d maven/dev/emcc ] || { echo "There is no maven folder next to this script: unpack the whole zip first."; exit 1; }',
    'mkdir -p "$REPO" && cp -R maven/. "$REPO"/ || { echo "Could not copy into $REPO."; exit 1; }',
    'echo "Installed into $REPO: dev.emcc emc2-plugin-parent, emc2-plugin-sdk, emc2-plugin-sdk-testkit."',
    '',
  ].join('\n');
}

export function kitReadme({ maven, web }) {
  return `# emcc SDK kit ${web}

Everything needed to build, test and package an emcc plugin outside the emcc source tree, for the emcc release this kit
came with. The plugin documentation (the design pattern, the reference, the cookbook) is in the emcc repository's
\`docs/plugins/\`; the template here follows it.

## What is in it

| Folder | Holds |
|---|---|
| \`maven/\` | The server part's Maven artifacts, \`dev.emcc\` version \`${maven}\`: \`emc2-plugin-parent\` (the stand-alone parent POM), \`emc2-plugin-sdk\` and \`emc2-plugin-sdk-testkit\`, each with its sources and Javadoc |
| \`web/emc2-plugin-sdk-${web}.tgz\` | The web SDK, \`@emc2/plugin-sdk\` ${web}: JavaScript with type declarations, the components' CSS and the data model's schemas (for the manifest guard) |
| \`web/importmap.json\` | The shell's import map: the shared libraries a web part may import and their exact versions |
| \`schemas/\` | The data model's JSON schemas, among them \`plugin-manifest.schema.json\` |
| \`template/\` | The plugin template, ready to copy |
| \`install-maven.bat\`, \`install-maven.sh\` | Copy \`maven/\` into your local Maven repository |

## Build the template

You need a JDK 25 and Maven 3.9 or later for a server part, and Node.js 24 with npm for a web part. Maven and npm fetch
the usual third-party libraries (JUnit, Vite, ...) from Maven Central and npm.

1. Install the Maven artifacts once: \`install-maven.bat\` (Windows) or \`./install-maven.sh\`.
2. Copy \`template/\` next to \`web/\` (the template's web part finds the kit's SDK package and import map at
   \`../../web/\`: keep the kit's folders together, or change those two paths in \`template/web/package.json\` and
   \`template/web/vite.config.ts\`), and rename it to your plugin's id. Change the id in \`plugin.json\`, the
   \`artifactId\` in \`server/pom.xml\` (\`emc2-plugin-<id>\`) and the package name in \`web/package.json\`, as the
   template's README says.
3. Server part: \`mvn verify\` in \`server/\`. It builds \`target/emc2-plugin-<id>-<version>.jar\` and runs the tests,
   among them \`InstalledPluginIT\`, which loads the packaged jar as emcc does.
4. Web part: \`npm install\`, then \`npm test\` and \`npm run build\` in \`web/\`. The build writes \`dist/\`: the entry
   module, the CSS and the built \`plugin.json\`.

## Install it in emcc

Make a folder named after the plugin's id with \`plugin.json\` (the built one from \`web/dist/\` if the plugin has a
web part), \`server/\` with the plugin's jar, and \`web/\` with the rest of \`web/dist/\`. Copy it into the release's
\`plugins/\` folder and restart emcc. A plugin is trusted code: it runs inside the server with the server's rights.
An admin then maps its permissions to roles in \`settings/emcc.properties\`.

## The release's Java runtime

emcc's release runs on a Java runtime made with \`jlink\` that holds only these modules. A plugin's server part may use
only them (or the server runs on an admin's own Java, \`EMCC_JAVA_HOME\`):

${RUNTIME_MODULES.map((m) => `- \`${m}\``).join('\n')}

## Versions

A plugin built with this kit declares \`"sdkVersion": "^${web}"\` and runs on emcc releases whose SDK satisfies it. The
shell checks a web part's shared libraries by major version and at least this version.

## Licence

emcc and this kit are licensed under the Apache License 2.0 (\`LICENSE\`).
`;
}

if (process.argv[1] && basename(process.argv[1]) === 'sdk-kit.mjs') {
  const i = process.argv.indexOf('--out');
  try {
    buildSdkKit(i > 0 ? { outDir: process.argv[i + 1] } : {});
  } catch (e) {
    console.error(`\nFAILED: ${e.message}`);
    process.exit(1);
  }
}
