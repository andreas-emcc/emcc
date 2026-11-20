// Tests for tools/ffmpeg-build.mjs: the minimal LGPL ffmpeg of CR-0045.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertLgpl21, COMPONENTS, configureArgs, FFMPEG_VERSION, ffmpegNotice, ffmpegSourceFiles, msysPath, sha256, TARBALL, TARBALL_SHA256 } from './ffmpeg-build.mjs';

test('the release is pinned exactly, with a full SHA-256', () => {
  assert.match(FFMPEG_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(TARBALL, `ffmpeg-${FFMPEG_VERSION}.tar.xz`);
  assert.match(TARBALL_SHA256, /^[0-9a-f]{64}$/);
});

test('the configure line disables everything and enables only the conversion\'s parts', () => {
  const args = configureArgs('/x');
  assert.equal(args.filter((a) => a === '--disable-everything').length, 1);
  assert.ok(args.indexOf('--disable-everything') < args.findIndex((a) => a.startsWith('--enable-decoder=')));
  assert.ok(args.includes('--disable-autodetect'));
  assert.ok(args.includes('--disable-network'));
  // One --enable-<kind>= per kind, naming all its parts (CR-0045 point 2, CR-0053).
  const enabled = (kind) => args.find((a) => a.startsWith(`--enable-${kind}=`))?.split('=')[1].split(',');
  assert.deepEqual(enabled('decoder'), ['mpeg2video', 'rawvideo']);
  assert.deepEqual(enabled('demuxer'), COMPONENTS.demuxer);
  assert.ok(COMPONENTS.demuxer.includes('rawvideo'));
  assert.ok(COMPONENTS.muxer.includes('h264'));
  assert.ok(COMPONENTS.bsf.includes('h264_metadata'));
  assert.deepEqual(enabled('encoder'), ['h264_mf']);
  assert.ok(enabled('protocol').includes('pipe'));
  assert.deepEqual(COMPONENTS.encoder, ['h264_mf'], 'one H.264 encoder, Windows\' own (owner VN A)');
  assert.ok(!COMPONENTS.protocol.some((p) => /http|tcp|udp|rtp|file/.test(p)), 'no network or file protocols');
});

test('the build stays LGPL-2.1-or-later', () => {
  assert.doesNotThrow(() => assertLgpl21(configureArgs('/x')));
  for (const bad of ['--enable-gpl', '--enable-nonfree', '--enable-version3']) {
    assert.throws(() => assertLgpl21([...configureArgs('/x'), bad]), /CR-0045/);
  }
});

test('Windows paths become MSYS2 paths', () => {
  assert.equal(msysPath('C:\\emcc-build'), '/c/emcc-build');
  assert.equal(msysPath('D:/x y/z'), '/d/x y/z');
});

test('sha256 hashes a file', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'emc2-ffmpeg-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'a'), 'abc');
  assert.equal(sha256(join(dir, 'a')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('the notice names the build, its source zip and carries the LGPL text', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'emc2-ffmpeg-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'COPYING.LGPLv2.1'), 'GNU LESSER GENERAL PUBLIC LICENSE\r\nVersion 2.1\r\n');
  const notice = ffmpegNotice(dir);
  assert.ok(notice.includes(`ffmpeg ${FFMPEG_VERSION} (tools/ffmpeg/ffmpeg.exe), LGPL-2.1-or-later`));
  assert.match(notice, /-ffmpeg-source\.zip next to this release/);
  assert.match(notice, /GNU LESSER GENERAL PUBLIC LICENSE\nVersion 2\.1\n/);
});

test('a release with the binary needs the exact source tarball', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'emc2-ffmpeg-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => ffmpegSourceFiles(dir, dir, dir), /source must too/);
  writeFileSync(join(dir, TARBALL), 'not the release');
  assert.throws(() => ffmpegSourceFiles(dir, dir, dir), /not the pinned/);
});
