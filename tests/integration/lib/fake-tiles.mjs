// A local stand-in for the OpenStreetMap tile server, so that basemap-osm can be tested offline.
// It answers GET /{z}/{x}/{y}.png with a small PNG of one colour per zoom level and counts the
// requests. GET /_requests returns the paths it served, as JSON. `setDelay(ms)` makes it answer
// tiles only after a delay (a slow upstream); `refuseConnections()` makes it reset every connection
// at once (an upstream that cannot be reached), while it keeps its port, so nothing else can get
// that port, and counts the attempts in `refused`. Nothing is fetched from anywhere.
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';

const TILE = /^\/(\d+)\/(\d+)\/(\d+)\.png$/;

/** Starts the fake tile server on 127.0.0.1 and a free port. */
export function startFakeTiles() {
  const requests = [];
  const pngs = new Map();
  let delayMs = 0;
  let refusing = false;
  const refused = { count: 0 };
  const server = createServer((req, res) => {
    if (req.url === '/_requests') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(requests));
      return;
    }
    const match = TILE.exec(req.url ?? '');
    if (req.method !== 'GET' || !match) {
      res.writeHead(404);
      res.end();
      return;
    }
    requests.push(req.url);
    const z = Number(match[1]);
    if (!pngs.has(z)) pngs.set(z, solidPng(256, 256, colourFor(z)));
    const answer = () => {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(pngs.get(z));
    };
    if (delayMs > 0) setTimeout(answer, delayMs);
    else answer();
  });
  server.on('connection', (socket) => {
    if (!refusing) return;
    refused.count++;
    socket.destroy();
  });
  return new Promise((resolveStart, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolveStart({
        port,
        url: `http://127.0.0.1:${port}`,
        template: `http://127.0.0.1:${port}/{z}/{x}/{y}.png`,
        requests,
        setDelay: (ms) => {
          delayMs = ms;
        },
        refuseConnections: () => {
          refusing = true;
        },
        refused,
        close: () =>
          new Promise((resolveClose) => {
            server.closeAllConnections();
            server.close(() => resolveClose());
          }),
      });
    });
  });
}

/** A recognisable colour per zoom level (RGB), so a test can tell that tiles are drawn. */
export function colourFor(z) {
  return [200, 220 - (z % 8) * 10, 160];
}

/** An RGB PNG of one colour, written by hand (signature, IHDR, IDAT, IEND). */
export function solidPng(width, height, [r, g, b]) {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits per channel, RGB, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
