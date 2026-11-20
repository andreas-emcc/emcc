// A minimal WebSocket client on a plain TCP socket, for the cases Node's WebSocket cannot produce:
// a client that stops reading. No extensions are offered, so the server's frames are uncompressed.
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';

/** Opens a raw WebSocket connection to /api/live and resolves when the server accepted it. */
export function openRaw(baseUrl) {
  const { hostname, port } = new URL(baseUrl);
  return new Promise((resolveOpen, reject) => {
    const socket = connect({ host: hostname, port: Number(port) }, () => {
      socket.write(
        [
          'GET /api/live HTTP/1.1',
          `Host: ${hostname}:${port}`,
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Version: 13',
          `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
          '',
          '',
        ].join('\r\n'),
      );
    });
    let head = Buffer.alloc(0);
    const onData = (chunk) => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) return;
      socket.off('data', onData);
      const status = head.subarray(0, head.indexOf('\r\n')).toString();
      if (!status.includes(' 101 ')) {
        socket.destroy();
        reject(new Error(`handshake refused: ${status}`));
        return;
      }
      socket.pause();
      resolveOpen(new RawClient(socket, head.subarray(end + 4)));
    };
    socket.on('data', onData);
    socket.once('error', reject);
    // After the handshake an error (e.g. a reset when the server closes) must not become an
    // uncaught exception; the close it causes is what the tests look at.
    socket.on('error', () => undefined);
  });
}

export class RawClient {
  constructor(socket, rest) {
    this.socket = socket;
    this.buffer = rest;
    this.textFrames = 0;
  }

  /** Sends one masked text frame (clients must mask). */
  sendText(text) {
    const payload = Buffer.from(text);
    const length = payload.length;
    const header =
      length < 126
        ? Buffer.from([0x81, 0x80 | length])
        : length < 65536
          ? Buffer.from([0x81, 0x80 | 126, length >> 8, length & 0xff])
          : Buffer.concat([Buffer.from([0x81, 0x80 | 127]), bigLength(length)]);
    const mask = randomBytes(4);
    const masked = Buffer.alloc(length);
    for (let i = 0; i < length; i++) masked[i] = payload[i] ^ mask[i % 4];
    return new Promise((resolveWrite) => this.socket.write(Buffer.concat([header, mask, masked]), resolveWrite));
  }

  /**
   * Starts reading again and resolves with the status code of the server's close frame, or with
   * 'no close frame' if the connection ended without one. Text frames are counted, not kept.
   */
  readUntilClose(timeoutMs) {
    return new Promise((resolveClose) => {
      const timer = setTimeout(() => finish('timeout'), timeoutMs);
      const finish = (result) => {
        clearTimeout(timer);
        this.socket.removeAllListeners('data');
        this.socket.destroy();
        resolveClose(result);
      };
      const parse = () => {
        for (;;) {
          if (this.buffer.length < 2) return;
          const opcode = this.buffer[0] & 0x0f;
          let length = this.buffer[1] & 0x7f;
          let offset = 2;
          if (length === 126) {
            if (this.buffer.length < 4) return;
            length = this.buffer.readUInt16BE(2);
            offset = 4;
          } else if (length === 127) {
            if (this.buffer.length < 10) return;
            length = Number(this.buffer.readBigUInt64BE(2));
            offset = 10;
          }
          if (this.buffer.length < offset + length) return;
          const payload = this.buffer.subarray(offset, offset + length);
          this.buffer = this.buffer.subarray(offset + length);
          if (opcode === 0x8) {
            finish(payload.length >= 2 ? payload.readUInt16BE(0) : 'close frame without code');
            return;
          }
          if (opcode === 0x1) this.textFrames++;
        }
      };
      this.socket.on('data', (chunk) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        parse();
      });
      this.socket.once('close', () => finish('no close frame'));
      this.socket.resume();
      parse();
    });
  }
}

function bigLength(length) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(length));
  return bytes;
}
