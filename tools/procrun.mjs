// procrun (Apache Commons Daemon), the Windows service wrapper of ADR-0063 (M9 B2; owner, plan Q1 A): the pinned
// binary, its notice, and the two scripts the release ships, service-install.bat and service-uninstall.bat.
// The binary is not built: the official Windows binaries of the pinned release, downloaded and checked against the ASF's
// signature and SHA-512 once (owner, 2026-11-17), are unpacked in DEFAULT_PROCRUN_DIR; the release checks the one file it
// ships against PRUNSRV_SHA256 below.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILD_DIR, sha256 } from './ffmpeg-build.mjs';

export const PROCRUN_VERSION = '1.6.1';
/** The ASF's SHA-512 of commons-daemon-1.6.1-bin-windows.zip (from its .sha512 file), for the record. */
export const ZIP_SHA512 =
  'a878177edc92e663c1113858f8903451ec02b5b033bca373bea4f8761d9196323771301fcd6a7b8387d8e2300f7a1056b9e08e83fca9703df32ac3ecd5b129f7';
/** SHA-256 of amd64/prunsrv.exe in that zip: the one file the release ships. */
export const PRUNSRV_SHA256 = '1fa76275ddd7ccf6f476bef81f343ab95c91d4b7c810e6d1936bc82588a09fe5';
export const DEFAULT_PROCRUN_DIR = join(BUILD_DIR, 'procrun', PROCRUN_VERSION);

/** The service's name, and the virtual account it runs as (ADR-0063 points 1 and 5). */
export const SERVICE = 'emcc';
export const ACCOUNT = `NT SERVICE\\${SERVICE}`;
/** procrun's settings for the CDA's entry (server/README.md, "The Windows service's entry"; M9 C4). */
export const STOP_TIMEOUT_S = 60;

/** The files to ship from the unpacked zip, checked; throws with the reason when something is missing or different. */
export function procrunFiles(dir) {
  const exe = join(dir, 'amd64', 'prunsrv.exe');
  for (const f of [exe, join(dir, 'LICENSE.txt'), join(dir, 'NOTICE.txt')]) {
    if (!existsSync(f)) throw new Error(`procrun: no ${f} (unpack commons-daemon-${PROCRUN_VERSION}-bin-windows.zip there)`);
  }
  const actual = sha256(exe);
  if (actual !== PRUNSRV_SHA256) throw new Error(`procrun: ${exe} has SHA-256 ${actual}, expected ${PRUNSRV_SHA256}`);
  return { exe, license: join(dir, 'LICENSE.txt'), notice: join(dir, 'NOTICE.txt') };
}

/** The block for THIRD-PARTY-NOTICES.txt: procrun's NOTICE and its Apache-2.0 text. */
export function procrunNotice(files) {
  return [
    '',
    '================================================================================',
    `Apache Commons Daemon (procrun) ${PROCRUN_VERSION}: service/prunsrv.exe, unmodified (amd64)`,
    'Licence: Apache-2.0. Runs emcc as a Windows service (ADR-0063).',
    '--------------------------------------------------------------------------------',
    readFileSync(files.notice, 'utf8').trim(),
    '--------------------------------------------------------------------------------',
    readFileSync(files.license, 'utf8').trim(),
    '',
  ].join('\n');
}

const crlf = (lines) => lines.join('\r\n');

/** service-install.bat: the whole service definition in one readable, commented file (ADR-0063 point 2). */
export function installScript() {
  const prunsrv = '"%EMCC%\\service\\prunsrv.exe"';
  return crlf([
    '@echo off',
    `rem Installs emcc as the Windows service "${SERVICE}" (ADR-0063). Run it as administrator, in the unpacked emcc folder.`,
    'rem The service:',
    'rem   - runs the same server, Java and settings as start.bat: settings\\emcc.properties decides the login, the port',
    'rem     and HTTPS; the Java is EMCC_JAVA_HOME when it is set here, else the runtime folder;',
    `rem   - starts at boot (delayed) and runs with no user logged in, as the virtual account ${ACCOUNT};`,
    'rem   - restarts after a failure: after 10 s, 30 s, then every 60 s; the count starts again after a day;',
    `rem   - stops with the server's orderly shutdown, as Ctrl+C does, and is killed only after ${STOP_TIMEOUT_S} s;`,
    'rem   - logs to logs\\emcc.log as always; procrun\'s own log is logs\\procrun.<date>.log.',
    'rem No secret goes into the service\'s definition: the login\'s secret stays in settings\\credentials\\ (ADR-0060).',
    'rem The account may read this folder, change data\\ and logs\\, and read settings\\credentials\\, which only it,',
    'rem administrators and SYSTEM may then read. Another account: change it in the Services console afterwards.',
    'rem To change the service: service-uninstall.bat, then this script again.',
    'setlocal',
    'cd /d "%~dp0"',
    'set "EMCC=%CD%"',
    'net session >nul 2>&1 || (echo Run this as administrator: right-click service-install.bat, Run as administrator.& exit /b 1)',
    'if not exist "app\\emcc-service.jar" (echo There is no app folder next to this script, so the zip is not unpacked. Unpack the whole zip first.& exit /b 1)',
    'if not exist "service\\prunsrv.exe" (echo There is no service\\prunsrv.exe next to this script.& exit /b 1)',
    `sc query ${SERVICE} >nul 2>&1 && (echo The service ${SERVICE} is installed already. Remove it first with service-uninstall.bat.& exit /b 1)`,
    'set "JVM=%EMCC%\\runtime\\bin\\server\\jvm.dll"',
    'if defined EMCC_JAVA_HOME set "JVM=%EMCC_JAVA_HOME%\\bin\\server\\jvm.dll"',
    'if not exist "%JVM%" (echo There is no "%JVM%". EMCC_JAVA_HOME must name a Java 25 or later, or be unset to use the runtime folder.& exit /b 1)',
    // The login: as start.bat without arguments, the settings decide; the service has no -standalone and no command line,
    // and an admin's environment does not reach it, so the settings must name the login and the secret must be in its file.
    'findstr /r /c:"^emc2.login.mode=none" settings\\emcc.properties >nul 2>&1 && goto loginok',
    'findstr /r /c:"^emc2.login.oidc.issuer-uri=." settings\\emcc.properties >nul 2>&1 || (echo settings\\emcc.properties sets no login. Set emc2.login.oidc.issuer-uri there, or emc2.login.mode=none for no login on this computer only, then install again.& exit /b 1)',
    'findstr /r /c:"^emc2.login.oidc.client-secret=." settings\\credentials\\login.properties >nul 2>&1 || (echo No client secret: put emc2.login.oidc.client-secret in settings\\credentials\\login.properties. The service does not see environment variables set here.& exit /b 1)',
    ':loginok',
    'if exist application-local.properties echo Also read: application-local.properties, which is deprecated: move its lines to settings\\emcc.properties and its secrets to settings\\credentials\\.',
    'if not exist data mkdir data',
    'if not exist logs mkdir logs',
    `echo Installing the service ${SERVICE} with "%JVM%"`,
    `${prunsrv} //IS//${SERVICE} --DisplayName=emcc --Description="emcc command and control server (ADR-0063)" ^`,
    '  --Install="%EMCC%\\service\\prunsrv.exe" --Startup=auto --Jvm="%JVM%" ^',
    '  --Classpath="%EMCC%\\app\\emc2-app.jar;%EMCC%\\app\\emcc-service.jar" ^',
    '  --StartMode=jvm --StartClass=dev.emcc.service.Service --StartMethod=start --StartPath="%EMCC%" ^',
    `  --StopMode=jvm --StopClass=dev.emcc.service.Service --StopMethod=stop --StopPath="%EMCC%" --StopTimeout=${STOP_TIMEOUT_S} ^`,
    '  --LogPath="%EMCC%\\logs" --LogPrefix=procrun --LogLevel=Info --StdError=auto',
    `if errorlevel 1 (echo procrun could not install the service.& exit /b 1)`,
    // Delayed start, the virtual account (no password) and the restart policy: Windows' own service settings.
    `sc config ${SERVICE} start= delayed-auto obj= "${ACCOUNT}" >nul || (echo Could not set the start and the account.& goto undo)`,
    `sc failure ${SERVICE} reset= 86400 actions= restart/10000/restart/30000/restart/60000 >nul || (echo Could not set the restart after a failure.& goto undo)`,
    `sc failureflag ${SERVICE} 1 >nul`,
    `icacls "%EMCC%" /grant "${ACCOUNT}:(OI)(CI)RX" /q >nul || (echo Could not let ${ACCOUNT} read this folder.& goto undo)`,
    `icacls "%EMCC%\\data" /grant "${ACCOUNT}:(OI)(CI)M" /q >nul || (echo Could not let ${ACCOUNT} change data.& goto undo)`,
    `icacls "%EMCC%\\logs" /grant "${ACCOUNT}:(OI)(CI)M" /q >nul || (echo Could not let ${ACCOUNT} change logs.& goto undo)`,
    `icacls "%EMCC%\\settings\\credentials" /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "${ACCOUNT}:(OI)(CI)R" /q >nul || (echo Could not limit settings\\credentials.& goto undo)`,
    `sc start ${SERVICE} >nul || (echo Installed, but it did not start: see logs\\emcc.log and logs\\procrun.*.log.& exit /b 1)`,
    `echo The service ${SERVICE} is installed and starting. When it is ready, logs\\emcc.log says "emcc ready at <address>".`,
    'echo It starts at every boot. Stop or start it in the Services console, or with: sc stop emcc / sc start emcc',
    'exit /b 0',
    ':undo',
    `${prunsrv} //DS//${SERVICE} >nul 2>&1`,
    'echo The service was not installed.',
    'exit /b 1',
    '',
  ]);
}

/** service-uninstall.bat: stops the service (the orderly shutdown), takes back the account's rights and removes it. */
export function uninstallScript() {
  return crlf([
    '@echo off',
    `rem Removes the Windows service "${SERVICE}" (ADR-0063). Run it as administrator. The data, logs and settings stay.`,
    'setlocal',
    'cd /d "%~dp0"',
    'set "EMCC=%CD%"',
    'net session >nul 2>&1 || (echo Run this as administrator: right-click service-uninstall.bat, Run as administrator.& exit /b 1)',
    `sc query ${SERVICE} >nul 2>&1 || (echo There is no service ${SERVICE}.& exit /b 1)`,
    `echo Stopping ${SERVICE} (the server shuts down in order; at most ${STOP_TIMEOUT_S} s)`,
    `"%EMCC%\\service\\prunsrv.exe" //SS//${SERVICE}`,
    // The account's rights go before the service: once it is deleted, Windows no longer knows the name.
    `icacls "%EMCC%" /remove "${ACCOUNT}" /t /c /q >nul 2>&1`,
    `"%EMCC%\\service\\prunsrv.exe" //DS//${SERVICE} || (echo procrun could not remove the service.& exit /b 1)`,
    `echo The service ${SERVICE} is removed. data\\, logs\\ and settings\\ are kept; settings\\credentials\\ stays readable`,
    'echo by administrators only. Start emcc in a window again with start.bat.',
    'exit /b 0',
    '',
  ]);
}
