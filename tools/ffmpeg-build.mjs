// Builds the minimal LGPL ffmpeg that ECore runs to convert MPEG-2 FMV to H.264 (CR-0045, ADR-0057 point 8).
// It uses one pinned, unmodified ffmpeg release, checks its SHA-256, and configures only what the conversion
// needs: the MPEG-TS demuxer and muxer, the MPEG-2 decoder, Windows' own H.264 encoder (h264_mf, owner VN A),
// the pipe protocol and the few filters the ffmpeg program needs. No GPL, non-free or LGPL-3.0 parts.
//
// Usage (Windows, with MSYS2 and its MinGW-w64 GCC, make and pkgconf; owner WK A):
//   node tools/ffmpeg-build.mjs [--source <folder with the tarball>] [--msys <MSYS2 root>] [--jobs N]
// Output: tools/ffmpeg/out/ (ignored by git): ffmpeg.exe, BUILD.txt (version, configure line, toolchain),
// COPYING.LGPLv2.1. The tarball is downloaded beforehand, with the owner's approval (CR-0045 point 2).
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The pinned release (owner WI A: the newest 9.0.x), its tarball and the tarball's SHA-256 (checked against the release key). */
export const FFMPEG_VERSION = '9.0.2';
export const TARBALL = `ffmpeg-${FFMPEG_VERSION}.tar.xz`;
export const TARBALL_SHA256 = '8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e';
/** The key whose signature (ffmpeg-9.0.2.tar.xz.asc) was checked by hand before the hash was pinned: FFmpeg release signing key. */
export const RELEASE_KEY = 'FCF9 86EA 15E6 E293 A564 4F10 B432 2F04 D676 58D8';

/** A fixed install prefix, so the configure line and the binary name no machine's folders (installed under DESTDIR). */
export const PREFIX = '/opt/emcc-ffmpeg';

/** What the conversion and the raw-picture encoder need, and nothing else (CR-0045 point 2, CR-0053). */
export const COMPONENTS = {
  demuxer: ['mpegts', 'rawvideo'],
  muxer: ['mpegts', 'h264'],
  decoder: ['mpeg2video', 'rawvideo'],
  encoder: ['h264_mf'],
  parser: ['mpegvideo', 'h264'],
  bsf: ['h264_mp4toannexb', 'h264_metadata'],
  protocol: ['pipe'],
  filter: ['buffer', 'buffersink', 'format', 'scale', 'null', 'abuffer', 'abuffersink', 'anull', 'aformat', 'aresample'],
};

/** The configure arguments: everything off, then the components above; Media Foundation for h264_mf. */
export function configureArgs(prefix) {
  const args = [
    `--prefix=${prefix}`,
    '--disable-everything',
    '--disable-autodetect', // only what is named here; nothing the build machine happens to have
    '--disable-doc',
    '--disable-programs',
    '--enable-ffmpeg',
    '--disable-network',
    '--disable-debug',
    '--disable-x86asm', // no NASM in the toolchain; the C decoder is fast enough for a few streams (S9)
    '--enable-mediafoundation',
    '--enable-d3d11va', // h264_mf's source needs the D3D11 types (Windows' own headers); no hardware decoding is used
    '--enable-static',
    '--disable-shared',
    '--extra-ldflags=-static', // no MinGW runtime DLLs beside ffmpeg.exe; Media Foundation is Windows' own
  ];
  for (const [kind, names] of Object.entries(COMPONENTS)) args.push(`--enable-${kind}=${names.join(',')}`);
  return args;
}

/** Throws unless the arguments keep the build LGPL-2.1-or-later (CLAUDE.md section 4, CR-0045 point 1). */
export function assertLgpl21(args) {
  for (const bad of ['--enable-gpl', '--enable-nonfree', '--enable-version3']) {
    if (args.includes(bad)) throw new Error(`${bad} is not allowed (CR-0045): the build must stay LGPL-2.1-or-later`);
  }
}

export function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** A Windows path as MSYS2's bash sees it (C:\a\b → /c/a/b). */
export function msysPath(p) {
  return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
}

/** Where the build puts its output, and where the release looks for it. */
export function ffmpegOutDir(root) {
  return join(root, 'tools', 'ffmpeg', 'out');
}

/**
 * The folder outside the repository that holds what the builds download (ffmpeg's tarball, procrun):
 * EMCC_BUILD_DIR, else `emc2-build` next to the repository's folder.
 */
export const BUILD_DIR = process.env.EMCC_BUILD_DIR || fileURLToPath(new URL('../../emc2-build', import.meta.url));

/** The default folder of the downloaded tarball. */
export const DEFAULT_SOURCE_DIR = join(BUILD_DIR, 'ffmpeg');

/** The third-party notice for the shipped ffmpeg: what it is, where its source is, and the LGPL-2.1 text. */
export function ffmpegNotice(outDir) {
  return [
    '',
    '='.repeat(78),
    `ffmpeg ${FFMPEG_VERSION} (tools/ffmpeg/ffmpeg.exe), LGPL-2.1-or-later (CR-0045)`,
    'Copyright (c) the FFmpeg developers, https://ffmpeg.org/',
    'A minimal build of the unmodified release, run by emcc as a separate program to convert MPEG-2 video.',
    'Its complete source, with the build script and the configure line (tools/ffmpeg/BUILD.txt), ships as',
    '<release name>-ffmpeg-source.zip next to this release.',
    '-'.repeat(78),
    readFileSync(join(outDir, 'COPYING.LGPLv2.1'), 'utf8').replace(/\r?\n/g, '\n'),
  ].join('\n');
}

/**
 * The files of the source zip that the LGPL asks for: the exact tarball, the build script and BUILD.txt.
 * Throws when the tarball is missing or not the pinned one, since a release with the binary needs its source.
 */
export function ffmpegSourceFiles(root, sourceDir, outDir) {
  const tarball = join(sourceDir, TARBALL);
  if (!existsSync(tarball)) throw new Error(`ffmpeg ships, so its source must too: ${tarball} not found`);
  if (sha256(tarball) !== TARBALL_SHA256) throw new Error(`${tarball} is not the pinned ${TARBALL}`);
  return [
    [tarball, TARBALL],
    [join(root, 'tools', 'ffmpeg-build.mjs'), 'ffmpeg-build.mjs'],
    [join(outDir, 'BUILD.txt'), 'BUILD.txt'],
  ];
}

function parseArgs(argv) {
  const opts = { source: DEFAULT_SOURCE_DIR, msys: 'C:\\msys64', jobs: Math.max(1, cpus().length - 1) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') opts.source = argv[++i];
    else if (a === '--msys') opts.msys = argv[++i];
    else if (a === '--jobs') opts.jobs = Number(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

function main() {
  if (process.platform !== 'win32') throw new Error('the M8 build is Windows only (CR-0045: h264_mf); Linux chooses again in M9');
  const opts = parseArgs(process.argv.slice(2));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const out = ffmpegOutDir(root);
  const work = join(root, 'tools', 'ffmpeg', 'work');
  const bash = join(opts.msys, 'usr', 'bin', 'bash.exe');
  const tarball = join(opts.source, TARBALL);
  if (!existsSync(bash)) throw new Error(`MSYS2 not found: ${bash}`);
  if (!existsSync(tarball)) throw new Error(`source not found: ${tarball} (download it first, with the owner's approval)`);
  const sum = sha256(tarball);
  if (sum !== TARBALL_SHA256) throw new Error(`${TARBALL}: SHA-256 ${sum}, expected ${TARBALL_SHA256}`);

  const args = configureArgs(PREFIX);
  assertLgpl21(args);
  rmSync(work, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  mkdirSync(out, { recursive: true });

  const src = `${msysPath(work)}/ffmpeg-${FFMPEG_VERSION}`;
  const quoted = args.map((a) => `'${a}'`).join(' ');
  const script = [
    'set -e',
    `cd '${msysPath(work)}'`,
    `tar -xJf '${msysPath(tarball)}'`,
    `cd '${src}'`,
    `./configure ${quoted}`,
    `make -j${opts.jobs}`,
    `make install DESTDIR='${msysPath(join(work, 'install'))}'`,
    'echo "gcc: $(gcc --version | head -1)"',
    'echo "make: $(make --version | head -1)"',
    'echo "pkgconf: $(pkgconf --version)"',
    'echo "diffutils: $(cmp --version | head -1)"',
  ].join(' && ');
  const env = { ...process.env, MSYSTEM: 'MINGW64', CHERE_INVOKING: '1', SOURCE_DATE_EPOCH: '0' };
  const r = spawnSync(bash, ['-lc', script], { cwd: work, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const log = (r.stdout ?? '') + (r.stderr ?? '');
  writeFileSync(join(work, 'build.log'), log);
  if (r.status !== 0) throw new Error(`the build failed (exit ${r.status}); see ${join(work, 'build.log')}`);

  const exe = join(work, 'install', ...PREFIX.split('/').filter(Boolean), 'bin', 'ffmpeg.exe');
  copyFileSync(exe, join(out, 'ffmpeg.exe'));
  copyFileSync(join(work, `ffmpeg-${FFMPEG_VERSION}`, 'COPYING.LGPLv2.1'), join(out, 'COPYING.LGPLv2.1'));
  const tools = log.split('\n').filter((l) => /^(gcc|make|pkgconf|diffutils): /.test(l));
  writeFileSync(join(out, 'BUILD.txt'), [
    `ffmpeg ${FFMPEG_VERSION}, built for emcc (CR-0045): unmodified source ${TARBALL}, SHA-256 ${TARBALL_SHA256}.`,
    `The tarball's signature was checked against the FFmpeg release signing key ${RELEASE_KEY} before its hash was pinned.`,
    'Licence: LGPL-2.1-or-later (COPYING.LGPLv2.1). No GPL, non-free or LGPL-3.0 parts.',
    'Its source ships as a zip next to the release. To use your own build, replace ffmpeg.exe with one that has',
    'the same components; ECore runs it as a separate process through pipes only.',
    '',
    `configure ${args.join(' ')}`,
    '',
    'Toolchain (MSYS2 MINGW64):',
    ...tools.map((t) => `  ${t}`),
    `ffmpeg.exe SHA-256: ${sha256(join(out, 'ffmpeg.exe'))}`,
    '',
  ].join('\r\n'));
  console.log(`ffmpeg ${FFMPEG_VERSION} built: ${join(out, 'ffmpeg.exe')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
