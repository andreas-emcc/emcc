// Builds a self-contained release zip in releases/: the server jar, the web client, the installed
// plugins, a Java runtime made with jlink from the JDK that runs the build (CR-0008), the third-party
// notices (T-028), and a start script that takes the port. The zip unpacks to one folder and runs on a
// machine without Java. The start script runs the no-login mode (ADR-0022), bound to this computer, or with
// a Keycloak and a realm as arguments, the login with OpenID Connect. When documents/manual/src/ exists, the
// user manual is built there (its own npm project) and ships in manual/ (T-145).
// The product is called emcc in everything a user sees (owner, 2026-11-04, T-134); internal names stay emc2
// (the jar, the settings keys emc2.*, the Keycloak client and realm).
// When tools/ffmpeg/out/ holds the minimal ffmpeg (tools/ffmpeg-build.mjs, CR-0045), it ships in tools/ffmpeg/ with its
// notice, and its exact source goes into <name>-ffmpeg-source.zip next to the release; without it MPEG-2 FMV is not converted.
// Usage: node tools/release.mjs [--skip-build] [--milestone <name>] [--scenario <file>] [--ffmpeg-source <folder>]
//   [--procrun <folder>]
//   --milestone  the name's milestone part, e.g. M1-preview (default "snapshot")
//   --scenario   a demo scenario (tools/demo/scenario.json): the packaged server is started once, the
//                scenario's layers and symbols are created through the live picture, and the server's
//                data folder ships in the zip. This also proves that the packaged runtime starts.
//   --ffmpeg-source  the folder with ffmpeg's pinned tarball (default EMCC_BUILD_DIR\ffmpeg, else emc2-build\ffmpeg next to the repository; tools/ffmpeg-build.mjs)
//   --procrun    the unpacked procrun release, Windows only (default <that build folder>\procrun\1.6.1; tools/procrun.mjs)
// The runtime is native, so the release is for the platform the tool runs on (windows-x64 here).
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { arch, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { seedScenario } from './demo/seed.mjs';
import { isWindows, root, run } from './lib.mjs';
import { NOTICES_FILE, writeNotices } from './notices.mjs';
import { deepestLength, depthCheckLines } from './deep-path.mjs';
import { DEFAULT_SOURCE_DIR, ffmpegNotice, ffmpegOutDir, ffmpegSourceFiles } from './ffmpeg-build.mjs';
import { DEFAULT_PROCRUN_DIR, installScript, procrunFiles, procrunNotice, uninstallScript } from './procrun.mjs';
import { buildSdkKit, RUNTIME_MODULES, sdkVersions } from './sdk-kit.mjs';
import { versionProperties } from './version-file.mjs';
import { listFiles, zipDirectory } from './zip.mjs';

function option(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) {
    console.error(`\nFAILED: ${flag} needs a value`);
    process.exit(1);
  }
  return value;
}

const MILESTONE = option('--milestone') ?? 'snapshot';
if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(MILESTONE)) {
  console.error(`\nFAILED: --milestone ${MILESTONE}: letters, digits, dots and hyphens only`);
  process.exit(1);
}
const scenarioFile = option('--scenario');
const ffmpegSourceDir = option('--ffmpeg-source') ?? DEFAULT_SOURCE_DIR;
const procrunDir = option('--procrun') ?? DEFAULT_PROCRUN_DIR;
const scenario = scenarioFile ? JSON.parse(readFileSync(resolve(scenarioFile), 'utf8')) : undefined;

// Java modules the server needs (Spring Boot, Tomcat, Jackson, Logback, ECore, java.net.http for plugins); the SDK
// kit's readme lists the same (G20).
const MODULES = RUNTIME_MODULES;

function fail(message) {
  console.error(`\nFAILED: ${message}`);
  process.exit(1);
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

if (!process.argv.includes('--skip-build')) {
  const code = run('build', process.execPath, [join(root, 'tools', 'build.mjs')]);
  if (code !== 0) fail('the build failed');
}

const commit = git('rev-parse', '--short', 'HEAD');
const dirty = git('status', '--porcelain').length > 0;
const day = new Date().toISOString().slice(0, 10);
const os = isWindows ? 'windows' : platform();
const contracts = JSON.parse(readFileSync(join(root, 'model', 'package.json'), 'utf8')).version;
const name = `emcc-${MILESTONE}-${day}-${commit}${dirty ? '-dirty' : ''}-${os}-${arch()}`;

const jar = join(root, 'server', 'app', 'target', 'emc2-app.jar');
const serviceJar = join(root, 'server', 'service', 'target', 'emcc-service.jar'); // the service's entry (M9 C4)
const web = join(root, 'web', 'shell', 'dist');
const plugins = join(root, 'build', 'plugins');
for (const [what, path] of [['server jar', jar], ['service jar', serviceJar], ['web client', join(web, 'index.html')], ['installed plugins', plugins]]) {
  if (!existsSync(path)) fail(`no ${what} at ${path}: run node tools/build.mjs first`);
}
// The notices must match exactly what is zipped, also with --skip-build.
if (writeNotices().length > 0) fail('a shipped package has no licence text (see above)');
const javaHome = process.env.JAVA_HOME;
const jlink = javaHome ? join(javaHome, 'bin', isWindows ? 'jlink.exe' : 'jlink') : '';
if (!jlink || !existsSync(jlink)) fail('jlink not found: set JAVA_HOME to a JDK 25');

const stage = join(root, 'build', 'release', name);
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'app'), { recursive: true });
cpSync(jar, join(stage, 'app', 'emc2-app.jar'));
cpSync(serviceJar, join(stage, 'app', 'emcc-service.jar'));
cpSync(web, join(stage, 'web'), { recursive: true });
cpSync(plugins, join(stage, 'plugins'), { recursive: true });
cpSync(join(root, 'LICENSE'), join(stage, 'LICENSE'));
cpSync(NOTICES_FILE, join(stage, 'THIRD-PARTY-NOTICES.txt'));

// The minimal ffmpeg for ECore's MPEG-2 conversion (CR-0045), when it has been built; its source is checked now,
// so a release never ships the binary without it.
const ffmpegOut = ffmpegOutDir(root);
const ffmpeg = existsSync(join(ffmpegOut, 'ffmpeg.exe'));
let ffmpegSource = [];
if (ffmpeg) {
  try { ffmpegSource = ffmpegSourceFiles(root, ffmpegSourceDir, ffmpegOut); } catch (e) { fail(e.message); }
  cpSync(ffmpegOut, join(stage, 'tools', 'ffmpeg'), { recursive: true });
  appendFileSync(join(stage, 'THIRD-PARTY-NOTICES.txt'), ffmpegNotice(ffmpegOut));
  console.log('ffmpeg: tools/ffmpeg/ffmpeg.exe ships, with its notice and a source zip');
} else {
  console.warn('Note: no tools/ffmpeg/out/ffmpeg.exe (node tools/ffmpeg-build.mjs): MPEG-2 FMV is not converted in this release.');
}

// B2 (ADR-0063): the Windows service through procrun, pinned and checked, with its notice and the two scripts. Without
// the unpacked procrun the release has no service (a note); the Linux service comes with the Linux release (M10).
let service = false;
if (isWindows) {
  if (existsSync(procrunDir)) {
    let files;
    try { files = procrunFiles(procrunDir); } catch (e) { fail(e.message); }
    mkdirSync(join(stage, 'service'), { recursive: true });
    cpSync(files.exe, join(stage, 'service', 'prunsrv.exe'));
    appendFileSync(join(stage, 'THIRD-PARTY-NOTICES.txt'), procrunNotice(files));
    writeFileSync(join(stage, 'service-install.bat'), installScript());
    writeFileSync(join(stage, 'service-uninstall.bat'), uninstallScript());
    service = true;
    console.log('service: service/prunsrv.exe (procrun), service-install.bat and service-uninstall.bat ship');
  } else {
    console.warn(`Note: no procrun at ${procrunDir} (--procrun): this release cannot be installed as a Windows service.`);
  }
}

console.log(`\n==> runtime: jlink from ${javaHome}`);
execFileSync(jlink, [
  '--add-modules', MODULES.join(','), '--output', join(stage, 'runtime'),
  '--strip-debug', '--no-header-files', '--no-man-pages', '--compress=zip-6',
], { stdio: 'inherit' });

const appArgs = ['-jar', 'app/emc2-app.jar', '--emc2.web.root=web', '--emc2.plugins.directory=plugins', '--emc2.data.directory=data'];
// B1 (ADR-0060): the release's settings are the commented templates in settings/ (C1); the start scripts pass only the
// port, the login mode and the Keycloak address on their command line, which win over the files.

/** A free local port. */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

/**
 * Starts the packaged server once (its own runtime; the dev profile for the local stop), creates the
 * scenario through the live picture, and stops it cleanly, so that data/ holds the scenario.
 */
async function seed() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const java = join(stage, 'runtime', 'bin', isWindows ? 'java.exe' : 'java');
  console.log(`\n==> scenario: ${scenarioFile} on the packaged server, port ${port}`);
  const server = spawn(java, ['-Dspring.profiles.active=dev', ...appArgs, `--server.port=${port}`], { cwd: stage, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((resolveExit) => server.on('exit', (code) => resolveExit(code)));
  try {
    const deadline = Date.now() + 120_000;
    for (;;) {
      if (server.exitCode !== null) throw new Error('the packaged server stopped while starting');
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error('the packaged server did not start within 120 s');
      await new Promise((wait) => setTimeout(wait, 500));
    }
    const count = await seedScenario(base, scenario);
    console.log(`    ${count.layers} layers and ${count.symbols} symbols created`);
    const stop = await fetch(`${base}/api/dev/stop`, { method: 'POST' });
    if (stop.status !== 202) throw new Error(`the stop answered ${stop.status}`);
    const code = await Promise.race([exited, new Promise((wait) => setTimeout(() => wait('timeout'), 60_000))]);
    if (code === 'timeout') throw new Error('the packaged server did not stop within 60 s');
    if (/ ERROR /.test(log)) throw new Error('the server log has errors');
  } catch (e) {
    server.kill();
    console.error(log.split('\n').slice(-40).join('\n'));
    fail(`scenario: ${e.message}`);
  }
  rmSync(join(stage, 'logs'), { recursive: true, force: true });
}

if (scenario) await seed();

// The settings/ folder (T-157; owner SB A, 2026-11-12): terrain's default height data folder is
// %emcc%/settings/terrain, so the release ships it, empty but for a readme. Without it terrain reports the folder
// as not readable; with it the status says "Height data: 0 cells" until height data is put there.
mkdirSync(join(stage, 'settings', 'terrain'), { recursive: true });
writeFileSync(join(stage, 'settings', 'terrain', 'readme.txt'), [
  'Height data for terrain\'s viewshed and height map: DTED files (.dt0, .dt1, .dt2) in this folder or its subfolders.',
  'Terrain reads this folder by default (Settings > Terrain > height data folder: %emcc%/settings/terrain).',
  '',
].join(isWindows ? '\r\n' : '\n'));
// The same for fmv's imagery (owner ACC A, 2026-11-18): its output links read %emcc%/settings/imagery by default, so
// the release ships it, empty but for a readme; without it every fresh release showed fmv's folder as missing.
mkdirSync(join(stage, 'settings', 'imagery'), { recursive: true });
writeFileSync(join(stage, 'settings', 'imagery', 'readme.txt'), [
  'Imagery for fmv\'s output links (the simulated camera\'s picture): one subfolder per imagery set, each with its',
  'imagery.json and its JPEG or PNG tiles; a set without a source or a licence is refused.',
  'fmv reads this folder by default (Settings > FMV > Imagery folder: %emcc%/settings/imagery).',
  'The manual\'s chapter on FMV output links, imagery and terrain says how to make a set.',
  '',
].join(isWindows ? '\r\n' : '\n'));

// B1 (ADR-0060, M9): the settings folder is C1's commented templates (server/app/src/release/settings/: emcc.properties with
// every key, the credentials templates), copied as they are but for the folders: the release's own web/, plugins/ and data/
// are set in its emcc.properties (uncommented), so an admin changes them there and not on a command line. The log file
// and the demo realm's groups are already in the template; no application.properties or application-login.properties.
const settingsTemplates = join(root, 'server', 'app', 'src', 'release', 'settings');
if (!existsSync(join(settingsTemplates, 'emcc.properties'))) fail('no server/app/src/release/settings/emcc.properties (C1)');
cpSync(settingsTemplates, join(stage, 'settings'), { recursive: true });
{
  const file = join(stage, 'settings', 'emcc.properties');
  let text = readFileSync(file, 'utf8');
  for (const [from, to] of [
    ['# emc2.data.directory=data', 'emc2.data.directory=data'],
    ['# emc2.plugins.directory=plugins', 'emc2.plugins.directory=plugins'],
    ['# emc2.web.root=web/shell/dist', 'emc2.web.root=web'],
  ]) {
    if (text.split(from).length !== 2) fail(`settings/emcc.properties: expected the line "${from}" once (C1's template changed?)`);
    text = text.replace(from, to);
  }
  writeFileSync(file, isWindows ? text.replace(/\r?\n/g, '\r\n') : text);
}

/** Where start.bat's depth check goes; replaced just before the zip, when the deepest file is known. */
const DEPTH_CHECK = 'rem @@DEPTH_CHECK@@';
const noSecret = 'No client secret: put emc2.login.oidc.client-secret in settings/credentials/login.properties, or set EMC2_LOGIN_OIDC_CLIENT_SECRET.';
const noLoginSet = 'Note: settings/emcc.properties sets no login (emc2.login.mode or emc2.login.oidc.issuer-uri), so the server will stop and say why. For a quick start without login use -standalone.';
const ready = 'It prints "emcc ready at <address>" when it is ready: open that address in a browser.';
// B3 (owner ABE, ABF A, ABG A): without arguments the settings decide (the login too); -standalone starts without login on
// this computer only, as before; EMCC_JAVA_HOME names an admin's own Java 25+; the address is the server's ready line (C2's
// https:// and redirect port included), not one the script works out.
if (isWindows) {
  writeFileSync(join(stage, 'start.bat'), [
    '@echo off',
    'rem Starts emcc: start.bat [-standalone] [port] [keycloak realm]',
    'rem   start.bat                         with the settings in settings\\emcc.properties (login, port, HTTPS)',
    'rem   start.bat 9090                    the same on port 9090',
    'rem   start.bat -standalone             no login, this computer only, port 8080: nothing else needed',
    'rem   start.bat -standalone 9090        the same on port 9090',
    'rem   start.bat 8080 8180 emc2-demo     login with Keycloak on localhost:8180, realm emc2-demo',
    'rem   start.bat 8080 https://kc.example:8443 emc2   a Keycloak elsewhere',
    'rem Own Java: set EMCC_JAVA_HOME to a Java 25 or later; otherwise the runtime folder next to this script.',
    'setlocal',
    // ADE A: the folder before any shift, which moves %0 too (a start from another folder lost it).
    'set "HERE=%~dp0"',
    'set "MODE=settings"',
    'if /i "%~1"=="-standalone" set "MODE=standalone"',
    'if "%MODE%"=="standalone" shift',
    'set "PORT=%~1"',
    'set "KC=%~2"',
    'set "REALM=%~3"',
    'set "PORTARG="',
    'if "%PORT%"=="" goto noport',
    'echo %PORT%| findstr /r "^[0-9][0-9]*$" >nul || (echo The port must be a number, e.g. start.bat 8080& exit /b 1)',
    'set "PORTARG=--server.port=%PORT%"',
    ':noport',
    'cd /d "%HERE%"',
    // TJ A (M8): a folder too deep for Windows is named before anything else fails; filled in once every file is staged.
    DEPTH_CHECK,
    // T-146: a start from inside the zip (Explorer unpacks only the script).
    'if not exist "app\\emc2-app.jar" (echo There is no app folder next to this script, so the zip is not unpacked. Unpack the whole zip first with Extract All, then start start.bat in the unpacked folder.& exit /b 1)',
    'set "JAVA=%HERE%runtime\\bin\\java.exe"',
    'if not defined EMCC_JAVA_HOME goto ownjavadone',
    'set "JAVA=%EMCC_JAVA_HOME%\\bin\\java.exe"',
    'if not exist "%JAVA%" (echo EMCC_JAVA_HOME is set, but there is no "%JAVA%". Set it to a Java 25 or later, or remove it to use the runtime folder.& exit /b 1)',
    'echo Java: "%JAVA%" (EMCC_JAVA_HOME)',
    ':ownjavadone',
    'if not exist "%JAVA%" (echo There is no runtime folder next to this script, so the zip is not unpacked. Unpack the whole zip first with Extract All, then start start.bat in the unpacked folder.& exit /b 1)',
    'if exist settings\\emcc.properties.txt echo Found settings\\emcc.properties.txt: Windows hides the .txt ending. Rename it to emcc.properties, or the server does not read it.',
    'if exist settings\\emcc.properties (echo Settings: "%CD%\\settings\\emcc.properties") else (echo Settings: no settings\\emcc.properties in "%CD%", so emcc\'s defaults)', // quoted: a folder name may hold & or brackets
    'if exist application-local.properties echo Also read: application-local.properties, which is deprecated: move its lines to settings\\emcc.properties and its secrets to settings\\credentials\\.',
    'set "LOGIN="',
    'if not "%MODE%"=="standalone" goto keycloak',
    'if not "%KC%"=="" (echo -standalone has no login, so it takes no Keycloak: start.bat -standalone [port]& exit /b 1)',
    'set "LOGIN=--emc2.login.mode=none"',
    'echo Without login: everyone who opens it works as one local user with every permission, on this computer only.',
    'goto run',
    ':keycloak',
    'if "%KC%"=="" goto settingslogin',
    'if "%REALM%"=="" (echo Give the realm after the Keycloak, e.g. start.bat %PORT% 8180 emc2-demo& exit /b 1)',
    'echo %KC%| findstr /r "^[0-9][0-9]*$" >nul && set "KC=http://localhost:%KC%"',
    'if "%KC:~-1%"=="/" set "KC=%KC:~0,-1%"',
    'set "LOGIN=--emc2.login.mode=oidc --emc2.login.oidc.issuer-uri=%KC%/realms/%REALM%"',
    'set "SECRET="',
    'if defined EMC2_LOGIN_OIDC_CLIENT_SECRET set "SECRET=1"',
    'findstr /r /c:"^emc2.login.oidc.client-secret=." settings\\credentials\\login.properties >nul 2>&1 && set "SECRET=1"',
    'findstr /r /c:"^emc2.login.oidc.client-secret=." application-local.properties >nul 2>&1 && set "SECRET=1"',
    `if not defined SECRET (echo ${noSecret}& exit /b 1)`,
    'echo Login at %KC%/realms/%REALM%. Keycloak\'s client "emc2" must allow ^<the address below^>login/oauth2/code/emc2 as a redirect URI.',
    'goto run',
    ':settingslogin',
    'if defined EMC2_LOGIN_MODE goto run',
    'if defined EMC2_LOGIN_OIDC_ISSUER_URI goto run',
    `findstr /r /c:"^emc2.login.mode=" /c:"^emc2.login.oidc.issuer-uri=" settings\\emcc.properties >nul 2>&1 || echo ${noLoginSet}`,
    ':run',
    `echo Starting emcc (stop with Ctrl+C). ${ready}`,
    '"%JAVA%" -jar app\\emc2-app.jar %LOGIN% %PORTARG%',
    '',
  ].join('\r\n'));
  // RC3 (owner, 2026-11-19): a start without login that a double-click can run, the same as start.bat -standalone [port].
  writeFileSync(join(stage, 'start_standalone.bat'), [
    '@echo off',
    'rem Starts emcc without login, on this computer only: the same as start.bat -standalone [port]',
    'rem   start_standalone.bat          port 8080',
    'rem   start_standalone.bat 9090     port 9090',
    'call "%~dp0start.bat" -standalone %*',
    '',
  ].join('\r\n'));
} else {
  writeFileSync(join(stage, 'start.sh'), [
    '#!/bin/sh',
    '# Starts emcc: ./start.sh [-standalone] [port] [keycloak realm]',
    '#   ./start.sh                        with the settings in settings/emcc.properties (login, port, HTTPS)',
    '#   ./start.sh -standalone            no login, this computer only, port 8080: nothing else needed',
    '#   ./start.sh 8080 8180 emc2-demo    login with Keycloak on localhost:8180, realm emc2-demo',
    '# Own Java: set EMCC_JAVA_HOME to a Java 25 or later; otherwise the runtime folder next to this script.',
    'MODE=settings',
    'if [ "$1" = "-standalone" ]; then MODE=standalone; shift; fi',
    'PORT="$1"; KC="$2"; REALM="$3"; PORTARG=""',
    'if [ -n "$PORT" ]; then',
    '  case "$PORT" in (*[!0-9]*) echo "The port must be a number, e.g. ./start.sh 8080"; exit 1;; esac',
    '  PORTARG="--server.port=$PORT"',
    'fi',
    'cd "$(dirname "$0")" || exit 1',
    '[ -f app/emc2-app.jar ] || { echo "There is no app folder next to this script, so the zip is not unpacked. Unpack the whole zip first, then start ./start.sh in the unpacked folder."; exit 1; }',
    'JAVA=./runtime/bin/java',
    'if [ -n "$EMCC_JAVA_HOME" ]; then',
    '  JAVA="$EMCC_JAVA_HOME/bin/java"',
    '  [ -x "$JAVA" ] || { echo "EMCC_JAVA_HOME is set, but there is no $JAVA. Set it to a Java 25 or later, or unset it to use the runtime folder."; exit 1; }',
    '  echo "Java: $JAVA (EMCC_JAVA_HOME)"',
    'fi',
    '[ -x "$JAVA" ] || { echo "There is no runtime folder next to this script, so the zip is not unpacked. Unpack the whole zip first, then start ./start.sh in the unpacked folder."; exit 1; }',
    'if [ -f settings/emcc.properties ]; then echo "Settings: $(pwd)/settings/emcc.properties"; else echo "Settings: no settings/emcc.properties in $(pwd), so emcc\'s defaults"; fi',
    '[ -f application-local.properties ] && echo "Also read: application-local.properties, which is deprecated: move its lines to settings/emcc.properties and its secrets to settings/credentials/."',
    'set --',
    'if [ "$MODE" = standalone ]; then',
    '  [ -z "$KC" ] || { echo "-standalone has no login, so it takes no Keycloak: ./start.sh -standalone [port]"; exit 1; }',
    '  set -- --emc2.login.mode=none',
    '  echo "Without login: everyone who opens it works as one local user with every permission, on this computer only."',
    'elif [ -n "$KC" ]; then',
    '  [ -n "$REALM" ] || { echo "Give the realm after the Keycloak, e.g. ./start.sh $PORT 8180 emc2-demo"; exit 1; }',
    '  case "$KC" in (*[!0-9]*) ;; (*) KC="http://localhost:$KC";; esac',
    '  KC="${KC%/}"',
    '  if [ -z "$EMC2_LOGIN_OIDC_CLIENT_SECRET" ] && ! grep -qs "^emc2.login.oidc.client-secret=." settings/credentials/login.properties application-local.properties; then',
    `    echo "${noSecret}"; exit 1`,
    '  fi',
    '  set -- --emc2.login.mode=oidc "--emc2.login.oidc.issuer-uri=$KC/realms/$REALM"',
    '  echo "Login at $KC/realms/$REALM. Keycloak\'s client \\"emc2\\" must allow <the address below>login/oauth2/code/emc2 as a redirect URI."',
    'elif [ -z "$EMC2_LOGIN_MODE$EMC2_LOGIN_OIDC_ISSUER_URI" ] && ! grep -qs -e "^emc2.login.mode=" -e "^emc2.login.oidc.issuer-uri=" settings/emcc.properties; then',
    `  echo "${noLoginSet}"`,
    'fi',
    `echo "Starting emcc (stop with Ctrl+C). ${ready.replace(/"/g, '\\"')}"`,
    'exec "$JAVA" -jar app/emc2-app.jar "$@" $PORTARG',
    '',
  ].join('\n'), { mode: 0o755 });
}

// The user manual (T-145): built in its own npm project from its committed lock, offline, and shipped in manual/.
const manualSrc = join(root, 'documents', 'manual', 'src');
const manual = existsSync(join(manualSrc, 'package.json'));
if (manual) {
  console.log('\n==> manual: documents/manual/src');
  for (const step of ['npm ci --offline', 'npm run build']) {
    try {
      execFileSync(step, { cwd: manualSrc, stdio: 'inherit', shell: true });
    } catch {
      fail(`the manual: ${step} failed in documents/manual/src`);
    }
  }
  const manualHtml = join(root, 'documents', 'manual', 'html');
  if (!existsSync(join(manualHtml, 'index.html'))) fail('the manual: no documents/manual/html/index.html after its build');
  cpSync(manualHtml, join(stage, 'manual'), { recursive: true });
} else {
  console.warn('\nNote: no documents/manual/src: the release ships without the user manual.');
}

const pluginIds = readdirSync(plugins).sort();
const start = isWindows ? 'start.bat' : './start.sh';
// The version file (owner ACQ, 2026-11-18): the server reports it in GET /api/health.
writeFileSync(join(stage, 'version.properties'), versionProperties({ milestone: MILESTONE, day, commit, dirty, sdk: sdkVersions().web }, isWindows ? '\r\n' : '\n'));
writeFileSync(join(stage, 'README.txt'), [
  `emcc ${MILESTONE} - demo build`,
  `Built ${day} from commit ${commit}${dirty ? ' (with uncommitted changes)' : ''} for ${os}-${arch()}.`,
  ...(manual ? ['The user manual: open manual/index.html in a browser.'] : []),
  '',
  'Start',
  `  ${start} -standalone [port]   no login, this computer only, default port 8080, e.g. ${start} -standalone 9090`,
  ...(isWindows ? ['  start_standalone.bat [port]   the same, e.g. with a double-click in Explorer'] : []),
  '  Then open the address it prints ("emcc ready at ...") in a browser on the same computer. Stop with Ctrl+C.',
  '  A second browser window or tab on the same computer shares the same live map.',
  `  With your settings (login, HTTPS, other computers): see readme.md next to ${start}, and settings/emcc.properties.`,
  '  The server\'s log is logs/emcc.log. Send it with a problem report.',
  '',
  'What it is',
  `  emcc with data model ${contracts} and plugin SDK ${contracts}: a shared live map, APP-6 symbols,`,
  '  vessel symbols and tactical graphics (lines and areas), drawn shapes (circle, ellipse, square,',
  '  rectangle, polygon, arrow, route; hatched fills, arrowheads), layers, bookmarks, a list of a',
  '  layer\'s objects, coordinates (including UPS and polar MGRS), and backgrounds in three',
  '  projections: Web Mercator (EPSG:3857), Arctic (EPSG:3413) and Antarctic (EPSG:3031).',
  '  Links to other systems: Cursor on Target (TAK), AIS, ADS-B and GMTI (STANAG 4607); a simulator',
  '  with routes, convoys, sensors and scenarios; terrain (range and bearing, and a viewshed from',
  '  height data in a folder an admin names). Each user has display settings (symbol size, labels,',
  '  speed vectors) and a time control.',
  `  Plugins: ${pluginIds.join(', ')}.`,
  ...(scenario ? ['  It starts with a demo scenario: fictitious units around Stockholm, near Gotland, in the Arctic', '  and in Antarctica, each group on its own layer.'] : []),
  '  Everything needed is in this folder, including a Java runtime (runtime/, see runtime/legal/).',
  '',
  'The workspace',
  '  - The map is in the middle, with panes on the left, right and bottom. Their panels (Layers,',
  '    Symbols, Symbol properties, Shapes, Objects, Routes) can be moved to another pane with',
  '    the buttons in their heads, and the panes can be collapsed. The arrangement is remembered.',
  '  - The "Map controls" button on the map opens the projection, the background and the dim slider.',
  '  - Select on the map: a click selects one object, Ctrl+click adds or removes one, Ctrl+drag',
  '    selects all in a box. A right-click gives the menu: Centre on, Zoom to, Edit, Delete. The',
  '    Delete key deletes the selection after a question. Zoomed out over many objects, the map',
  '    shows clusters with counts; a click on a cluster zooms in.',
  '  - A double-click on a layer in Layers opens its objects in Objects.',
  '',
  'The top bar',
  '  - View: the workspace. Settings: a list with General (the default look), Data types, Layers',
  '    (a layer\'s classification) and one entry per plugin with settings (e.g. the OpenStreetMap',
  '    background and Cursor on Target); settings apply at once, without a reload. Monitor: the',
  '    state of the core and of each plugin, updated every 2 seconds while the tab is open.',
  '  - Bookmarks: saved map views in folders. Look: three looks (Night Watch, Chart Room, Signal),',
  '    each light or dark, compact or comfortable. Setups: the remembered arrangement, and named',
  '    ones to switch between. The clock shows UTC.',
  '  - Cursor on Target (cot) receives CoT from a TAK server or TAK clients and shows them as',
  '    symbols. It has no stream until one is set up in its Settings entry, so the Monitor shows',
  '    "no stream configured"; that is expected.',
  '',
  'Good to know',
  '  - With -standalone there is no login (the no-login mode): everyone who can reach the server',
  '    works as the local user. It listens on 127.0.0.1 only, so other computers cannot reach it.',
  ...(service ? ['  - As a Windows service, started at boot: service-install.bat, run as administrator (readme.md).'] : []),
  '  - Natural Earth is the offline background and always works. The OpenStreetMap background needs',
  '    this computer to reach tile.openstreetmap.org (the server fetches the tiles); without it,',
  '    choose Natural Earth as the background in "Map controls". Drawing works either way.',
  `  - The map's data is kept in the data/ folder next to this file. Delete it to start with an empty map${scenario ? ';' : '.'}`,
  ...(scenario ? ['    unpack the zip again to get the scenario back.'] : []),
  '  - The map needs a browser with WebGL. Without a GPU it draws up to about 10 000 objects one by',
  '    one and shows clusters beyond that.',
  '  - Drag a selected symbol or drawn shape to move it. Edit, then Reshape, changes a shape\'s',
  '    corners, points or size.',
  '  - Terrain\'s viewshed needs height data: put DTED files (.dt0, .dt1, .dt2) in settings\\terrain.',
  '    Terrain reads that folder by default (Settings > Terrain > height data folder:',
  '    %emcc%/settings/terrain), so no setting is needed. Range and bearing work without it.',
  '',
  'Licences: emcc is licensed under the Apache License 2.0 (LICENSE). The third-party software and',
  'data it includes, with their licence and copyright texts, are listed in THIRD-PARTY-NOTICES.txt',
  '(Natural Earth map data: public domain, "Made with Natural Earth"). The Java runtime is OpenJDK',
  '(Eclipse Temurin), GPL-2.0 with the Classpath Exception; its texts are in runtime/legal/ (CR-0008).',
  ...(ffmpeg ? [
    'tools/ffmpeg/ffmpeg.exe is a minimal build of ffmpeg, LGPL-2.1-or-later, which emcc runs as a separate',
    'program to convert MPEG-2 video (CR-0045). tools/ffmpeg/BUILD.txt names the build; its source is in',
    `${name}-ffmpeg-source.zip next to this release. You may replace ffmpeg.exe with your own build of it.`,
  ] : []),
  '',
].join(isWindows ? '\r\n' : '\n'));

// readme.md next to the start script: how to start the server and configure it (owner, 2026-11-01; M9 B1 and B3).
const nl = isWindows ? '\r\n' : '\n';
writeFileSync(join(stage, 'readme.md'), [
  `# Starting emcc ${MILESTONE}`,
  '',
  `Start the server with \`${start} -standalone\` in this folder and open the address it prints ("emcc ready at …") in a browser. Stop it with Ctrl+C. The rest of this demo build (what it is, the workspace, licences) is described in \`README.txt\`${manual ? ', and how to use and run it in the user manual, `manual/index.html`' : ''}.`,
  '',
  '## The start command',
  '',
  '| Command | Login | Port |',
  '|---|---|---|',
  `| \`${start} -standalone\` | none, this computer only | 8080 |`,
  `| \`${start} -standalone 9090\` | none, this computer only | 9090 |`,
  `| \`${start}\` | as \`settings/emcc.properties\` says | as the settings say (8080) |`,
  `| \`${start} 9090\` | as the settings say | 9090 |`,
  `| \`${start} 8080 8180 emc2-demo\` | Keycloak on this computer, port 8180, realm \`emc2-demo\` | 8080 |`,
  `| \`${start} 8080 https://kc.example:8443 emc2\` | Keycloak at that address, realm \`emc2\` | 8080 |`,
  '',
  'The arguments are, in order: `-standalone` or nothing, the port, then Keycloak and the realm, which are given together or not at all. What the command line sets wins over the settings files.',
  '',
  '**Your own Java:** set the environment variable `EMCC_JAVA_HOME` to the home folder of a Java 25 or later, of any vendor; otherwise the script uses the `runtime` folder next to it. The server logs the Java it runs on.',
  '',
  '## Standalone: without login',
  '',
  'With `-standalone` the server runs in the no-login mode and needs nothing else: everyone who opens it works as one local user with every permission. It listens on this computer only.',
  '',
  '## The settings folder',
  '',
  'Without `-standalone` the server follows `settings/emcc.properties`: every setting is there, commented out with its default and explained. Remove the `#` and change the value to set one. Passwords, secrets and tokens never go there but in `settings/credentials/`, one file per credential (the templates there say how). Only the account emcc runs as and administrators should be able to read that folder; the server warns at every start when others can. Some settings:',
  '',
  '| Setting | What it does |',
  '|---|---|',
  '| `emc2.login.mode=oidc` and `emc2.login.oidc.issuer-uri=…` | Login with Keycloak (or another OpenID Connect IAM) without giving it on the command line. |',
  '| `server.port=<port>` | The port. |',
  '| `server.address=0.0.0.0` | Listen on every network interface, so that other computers can reach the server. |',
  '| `emc2.allowed-hosts=<name>` | The name other computers use for this one (the server refuses requests for names it does not know). |',
  '| HTTPS | Copy `credentials/https-example.properties` to `credentials/https.properties` and name the certificate there; the server then serves HTTPS on its port, and its ready line says `https://`. |',
  '| `logging.level.plugin.<id>=DEBUG` | More detail in the log from one plugin, e.g. `logging.level.plugin.cot=DEBUG`. |',
  '',
  'An `application-local.properties` next to the start script, as earlier releases used, is still read but deprecated: move its lines to `settings/emcc.properties` and its secrets to `settings/credentials/`.',
  '',
  '## With Keycloak',
  '',
  'With a Keycloak and a realm, users log in with OpenID Connect and their Keycloak groups give their permissions (the groups are in `settings/emcc.properties`, as in the demo realm `emc2-demo`; everyone who logs in may see the map). It needs three things:',
  '',
  '1. **A client `emc2` in the realm** that allows `<the address the server prints>login/oauth2/code/emc2` as a redirect URI. Otherwise Keycloak shows "Invalid parameter: redirect_uri".',
  '2. **The client secret**, from Keycloak, in `settings/credentials/login.properties` (remove the `#` there), or in the environment variable `EMC2_LOGIN_OIDC_CLIENT_SECRET`. Never on the command line. Without it the script stops and says so.',
  '3. **Keycloak running** when the server starts. If it cannot be reached, the server does not start (it never falls back to no login by itself).',
  '',
  ...(service ? [
    '## As a Windows service',
    '',
    'Run `service-install.bat` as administrator (right-click, Run as administrator) to install emcc as the Windows service `emcc`. It starts at once and at every boot, with no user logged in, and is restarted after a failure (after 10 s, 30 s, then every 60 s). Stop and start it in the Services console or with `sc stop emcc` and `sc start emcc`; a stop shuts the server down in order, as Ctrl+C does. `service-uninstall.bat`, as administrator, removes it; the data, logs and settings stay.',
    '',
    '- **The settings decide**, as for `' + start + '` without arguments: `settings/emcc.properties` must set the login (`emc2.login.oidc.issuer-uri`, or `emc2.login.mode=none` for no login on this computer only), and with Keycloak the client secret must be in `settings/credentials/login.properties`. The service has no command line, and environment variables set where you install it do not reach it. The install script checks both and says what is missing.',
    '- **Its Java** is `runtime/`, or the Java that `EMCC_JAVA_HOME` names when you run the install script.',
    '- **Its account** is the virtual account `NT SERVICE\\emcc`, with no password: it may read this folder, change `data/` and `logs/`, and read `settings/credentials/`, which the install script limits to that account, administrators and SYSTEM. Edit the credentials as administrator from then on.',
    '- **Its log** is `logs/emcc.log`, with the address it prints ("emcc ready at …"); procrun\'s own log is `logs/procrun.<date>.log`.',
    '- **To change it** (another folder, another Java): `service-uninstall.bat`, then `service-install.bat` again. A change to the settings needs only a restart of the service.',
    '',
  ] : []),
  '## Folders',
  '',
  '| Folder | Holds |',
  '|---|---|',
  `| \`data/\` | The map's data. Delete it to start with an empty map${scenario ? '; unpack the zip again for the demo scenario' : ''}. |`,
  '| `logs/` | The server\'s log, `logs/emcc.log`, made at the first start. A new file is begun at 20 MB; older ones are kept 14 days, at most 280 MB. Send `emcc.log` with a problem report. |',
  '| `plugins/` | The installed plugins. |',
  '| `settings/` | The settings (`emcc.properties`), the credentials (`credentials/`), terrain\'s height data (`terrain/`) and fmv\'s imagery (`imagery/`), both read by default. |',
  '| `runtime/` | The Java runtime; no Java needs to be installed. |',
  ...(service ? ['| `service/` | procrun (Apache Commons Daemon), which runs emcc as a Windows service. |'] : []),
  ...(manual ? ['| `manual/` | The user manual; open `manual/index.html`. |'] : []),
  '',
  '## When it does not start',
  '',
  '- **"The port must be a number"** or a port that is taken: start with another port, for example `' + start + ' -standalone 9090`.',
  '- **"settings/emcc.properties sets no login"** and the server stops: set the login in the settings, give Keycloak on the command line, or start with `-standalone`.',
  '- **"Give the realm after the Keycloak"**: Keycloak and the realm come together.',
  '- **"No client secret"**: see "With Keycloak", point 2.',
  '- **The server stops at once with login:** Keycloak is not running or not at the address given, or the realm does not exist. The log says which.',
  '- **"Invalid parameter: redirect_uri" at Keycloak:** the client does not allow the address you opened; see "With Keycloak", point 1.',
  '- **"invalid_token_response" after logging in at Keycloak** (an error page, and a 401 in the log): the client secret does not match the secret of the client in that realm. Copy the secret again from Keycloak (the client `emc2`, Credentials) and start again.',
  '- **"EMCC_JAVA_HOME is set, but there is no …"**: it must name a Java\'s home folder (the one with `bin` in it), 25 or later.',
  '- **"There is no app folder (or runtime folder) next to this script":** the script was started from inside the zip, which unpacks only the script. Unpack the whole zip first, then start the script in the unpacked folder.',
  '- **"This folder is too deep for Windows":** the folder\'s path is so long that some of emcc\'s files would pass 260 characters, which Windows does not find. The script names the folder and the longest it may be. Unpack the zip into a short folder, e.g. `C:\\emcc`, and start it there.',
  ...(service ? [
    '- **The service does not start:** see `logs/emcc.log`, then `logs/procrun.<date>.log`. A service that stops at once and again after 10 s and 30 s usually lacks the login or its secret (see "As a Windows service").',
    '- **"Run this as administrator"** from `service-install.bat`: right-click it, Run as administrator.',
  ] : []),
  '- **"Found settings\\emcc.properties.txt":** Windows hides the `.txt` ending, so the file is not read. Rename it to `emcc.properties`.',
  '',
].join(nl));

if (isWindows) {
  const bat = join(stage, 'start.bat');
  const deepest = deepestLength(listFiles(stage)); // '/' and '\' count the same
  writeFileSync(bat, readFileSync(bat, 'utf8').replace(DEPTH_CHECK, () => depthCheckLines(deepest).join('\r\n')));
  console.log(`start.bat: the deepest file has ${deepest} characters below the release folder`);
}

mkdirSync(join(root, 'releases'), { recursive: true });
const zipFile = join(root, 'releases', `${name}.zip`);
console.log(`\n==> zip: ${zipFile}`);
const result = zipDirectory(stage, zipFile, name);
console.log(`\nOK: ${result.files} files, ${(result.bytes / 1024 / 1024).toFixed(1)} MB`);
if (ffmpeg) {
  // The LGPL's source, offline and next to the release (CR-0045 point 1): the exact tarball, the build script, BUILD.txt.
  const srcName = `${name}-ffmpeg-source`;
  const srcStage = join(root, 'build', 'release', srcName);
  rmSync(srcStage, { recursive: true, force: true });
  mkdirSync(srcStage, { recursive: true });
  for (const [from, to] of ffmpegSource) cpSync(from, join(srcStage, to));
  const srcZip = join(root, 'releases', `${srcName}.zip`);
  const src = zipDirectory(srcStage, srcZip, srcName);
  console.log(`ffmpeg source: ${srcZip} (${(src.bytes / 1024 / 1024).toFixed(1)} MB)`);
}
// B5 (G1): the SDK kit next to the release, for plugins built outside this repository.
try {
  buildSdkKit({ name: `emcc-sdk-${sdkVersions().web}-${day}-${commit}${dirty ? '-dirty' : ''}` });
} catch (e) {
  fail(e.message);
}
if (dirty) console.warn('Note: the working tree had uncommitted changes; the name says "-dirty".');
