// Tests for tools/zip.mjs: the written zip is read back with a small independent reader.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { crc32, inflateRawSync } from 'node:zlib';
import { listFiles, readZipEntries, zipDirectory } from './zip.mjs';

/** A new temporary folder, removed when the test ends. */
function tempDir(t, prefix = 'emc2-zip-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Reads every entry of a zip through its central directory: { name: Buffer }. */
function readZip(file) {
  const zip = readFileSync(file);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'end of central directory');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries = {};
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const packed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    assert.equal(zip.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(start, start + packed);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    assert.equal(data.length, size, `size of ${name}`);
    assert.equal(crc32(data), crc, `crc of ${name}`);
    entries[name] = data;
    at += 46 + nameLength;
  }
  return entries;
}

test('a folder round-trips through the zip, under the prefix, with nested folders and UTF-8 names', (t) => {
  const dir = tempDir(t);
  mkdirSync(join(dir, 'a', 'b'), { recursive: true });
  writeFileSync(join(dir, 'start.bat'), '@echo off\r\necho hi\r\n');
  writeFileSync(join(dir, 'a', 'b', 'big.txt'), 'x'.repeat(100_000));
  writeFileSync(join(dir, 'a', 'random.bin'), Buffer.from(Array.from({ length: 256 }, (_, i) => (i * 97) % 256)));
  writeFileSync(join(dir, 'a', 'Göteborg.txt'), 'lon 11.97, lat 57.71');
  const out = join(tempDir(t, 'emc2-zip-out-'), 'test.zip');

  const result = zipDirectory(dir, out, 'emc2-M0');

  assert.equal(result.files, 4);
  const entries = readZip(out);
  assert.deepEqual(Object.keys(entries).sort(), [
    'emc2-M0/a/Göteborg.txt',
    'emc2-M0/a/b/big.txt',
    'emc2-M0/a/random.bin',
    'emc2-M0/start.bat',
  ]);
  assert.equal(entries['emc2-M0/start.bat'].toString(), '@echo off\r\necho hi\r\n');
  assert.equal(entries['emc2-M0/a/b/big.txt'].length, 100_000);
  assert.equal(entries['emc2-M0/a/Göteborg.txt'].toString(), 'lon 11.97, lat 57.71');
  assert.ok(result.bytes < 100_000, 'the repeated text is compressed');
});

test('the same input and date give the same zip', (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, 'f.txt'), 'same');
  const date = new Date(2026, 9, 9, 12, 0, 0);
  const out = tempDir(t, 'emc2-zip-out-');
  const a = join(out, 'a.zip');
  const b = join(out, 'b.zip');
  zipDirectory(dir, a, 'p', date);
  zipDirectory(dir, b, 'p', date);
  assert.deepEqual(readFileSync(a), readFileSync(b));
});

test('readZipEntries reads back what zipDirectory wrote, stored and deflated', (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, 'tiny.txt'), 'x'); // too small to compress: stored
  writeFileSync(join(dir, 'LICENSE'), 'MIT License\n'.repeat(200)); // deflated
  const out = join(tempDir(t, 'emc2-zip-out-'), 'r.zip');
  zipDirectory(dir, out, 'p');
  const entries = Object.fromEntries(readZipEntries(readFileSync(out)).map((e) => [e.name, e.read().toString()]));
  assert.deepEqual(entries, { 'p/LICENSE': 'MIT License\n'.repeat(200), 'p/tiny.txt': 'x' });
});

test('listFiles walks nested folders and returns sorted relative paths', (t) => {
  const dir = tempDir(t);
  mkdirSync(join(dir, 'z'));
  writeFileSync(join(dir, 'z', '1'), '');
  writeFileSync(join(dir, 'a'), '');
  assert.deepEqual(listFiles(dir), ['a', 'z/1']);
});
