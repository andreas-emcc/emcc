// A minimal zip writer and reader for the release and notices tools: plain Node.js, no dependencies (zlib only).
// Writes a standard zip (deflate, UTF-8 names) that Windows Explorer, tar and unzip can open; reads jars.
// Limits: no Zip64, so fewer than 65 535 entries and less than 4 GiB in total.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * The entries of a zip (or jar) held in memory, from its central directory: [{ name, read() }],
 * where read() returns the entry's uncompressed bytes. Stored and deflated entries are supported.
 */
export function readZipEntries(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('unexpected zip layout (Zip64 is not supported)');
    const method = buf.readUInt16LE(at + 10);
    const packed = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLength);
    entries.push({
      name,
      read() {
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const body = buf.subarray(start, start + packed);
        if (method === 0) return Buffer.from(body);
        if (method === 8) return inflateRawSync(body);
        throw new Error(`${name}: unsupported compression method ${method}`);
      },
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const MAX = 0xffffffff;

/** MS-DOS date and time of a Date, as the zip format stores them (two-second resolution). */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** All files below `dir`, as paths relative to it with forward slashes, sorted. */
export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Zips the files below `dir` into `zipFile`, each under `prefix/` (the folder the zip unpacks to).
 * `date` is used for every entry, so the same input gives the same zip.
 */
export function zipDirectory(dir, zipFile, prefix, date = new Date()) {
  const { time, date: day } = dosDateTime(date);
  const locals = [];
  const centrals = [];
  let offset = 0;
  const files = listFiles(dir);
  if (files.length >= 0xffff) throw new Error(`too many files for a zip without Zip64: ${files.length}`);
  for (const file of files) {
    const data = readFileSync(join(dir, file));
    const packed = deflateRawSync(data, { level: 9 });
    const stored = packed.length >= data.length;
    const body = stored ? data : packed;
    const name = Buffer.from(`${prefix}/${file}`, 'utf8');
    const crc = crc32(data);
    if (data.length > MAX || offset > MAX) throw new Error('the release is too large for a zip without Zip64');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header
    central.writeUInt16LE(20, 4); // made by: 2.0, MS-DOS attributes
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(zipFile, Buffer.concat([...locals, ...centrals, end]));
  return { files: files.length, bytes: statSync(zipFile).size };
}
