// A TAK test double (T-043; the cot brief's criteria 1-10 and 12): a stand-in for a TAK Server's CoT
// streaming input. emc2's cot plugin connects to it as a client, plain TCP or TLS with a client
// certificate, and the test scripts what it sends: CoT events (TAK protocol version 0, XML events
// one after another without a separator), broken or hostile input, a steady rate, and the server
// going away. It records what clients send (the presence event of the brief's function 9, and
// since M3 what cot's out links send, read back with `receivedEvents()`), and with `relay` it passes
// each event a client sends on to the other clients, as a TAK Server does (or to all of them,
// the sender included: an echo). Plain Node.js; also usable from the command line
// (tests/integration/tak-double.mjs).
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';
import { serverTlsOptions } from './test-certs.mjs';

const UNKNOWN = 9999999.0; // CoT's "unknown" for hae, ce and le

function attr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A number as CoT writes it: "unknown" as 9999999.0, as TAK does. */
function num(value) {
  return value === UNKNOWN ? '9999999.0' : String(value);
}

function iso(date) {
  return new Date(date).toISOString();
}

/**
 * One CoT event as XML text. `lon` and `lat` are required (keep them different, ADR-0007); `time`
 * defaults to now, `start` to `time`, `stale` to `time` plus 5 minutes. `detail` is raw XML put into
 * `<detail>` after contact, track and remarks (e.g. a private element the plugin must keep).
 */
export function cotEvent({
  uid,
  type = 'a-f-G-U-C-I',
  how = 'm-g',
  lon,
  lat,
  hae = UNKNOWN,
  ce = UNKNOWN,
  le = UNKNOWN,
  time = Date.now(),
  start,
  stale,
  callsign,
  remarks,
  course,
  speed,
  detail = '',
  access,
  qos,
  opex,
  declaration = false,
}) {
  if (uid === undefined || lon === undefined || lat === undefined) throw new Error('cotEvent needs uid, lon and lat');
  if (lon === lat) throw new Error(`cotEvent: latitude equals longitude (${lat}); tests keep them different (ADR-0007)`);
  const t = new Date(time).getTime();
  const track = [course !== undefined ? ` course="${attr(course)}"` : '', speed !== undefined ? ` speed="${attr(speed)}"` : ''].join('');
  const parts = [
    callsign !== undefined ? `<contact callsign="${attr(callsign)}"/>` : '',
    track ? `<track${track}/>` : '',
    remarks !== undefined ? `<remarks>${attr(remarks)}</remarks>` : '',
    detail,
  ].join('');
  return (
    (declaration ? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' : '') +
    `<event version="2.0" uid="${attr(uid)}" type="${attr(type)}" how="${attr(how)}"` +
    ` time="${iso(t)}" start="${iso(start ?? t)}" stale="${iso(stale ?? t + 5 * 60_000)}"` +
    (access !== undefined ? ` access="${attr(access)}"` : '') +
    (qos !== undefined ? ` qos="${attr(qos)}"` : '') +
    (opex !== undefined ? ` opex="${attr(opex)}"` : '') +
    `><point lat="${num(lat)}" lon="${num(lon)}" hae="${num(hae)}" ce="${num(ce)}" le="${num(le)}"/>` +
    `<detail>${parts}</detail></event>`
  );
}

const unescape = (text) => text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** The attributes of the first `<name …>` start tag in `xml`, unescaped; null if there is none. */
function attributesOf(xml, name) {
  const tag = new RegExp(`<${name}(\\s[^>]*?)?/?>`).exec(xml);
  if (!tag) return null;
  const attributes = {};
  for (const m of (tag[1] ?? '').matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attributes[m[1]] = unescape(m[2]);
  return attributes;
}

const number = (value) => (value === undefined ? undefined : Number(value));

/**
 * The CoT events in a text of events one after another (what a client sent): for each, the fields
 * the tests compare, and its XML. Enough for what cot writes; not a general XML parser.
 */
export function parseEvents(text) {
  const events = [];
  for (const m of text.matchAll(/<event(?=[\s>])[\s\S]*?<\/event>/g)) {
    const xml = m[0];
    const event = attributesOf(xml, 'event') ?? {};
    const point = attributesOf(xml, 'point') ?? {};
    const contact = attributesOf(xml, 'contact') ?? {};
    const track = attributesOf(xml, 'track') ?? {};
    const group = attributesOf(xml, '__group') ?? {};
    events.push({
      uid: event.uid,
      type: event.type,
      how: event.how,
      time: event.time,
      start: event.start,
      stale: event.stale,
      lat: number(point.lat),
      lon: number(point.lon),
      hae: number(point.hae),
      callsign: contact.callsign,
      course: number(track.course),
      speed: number(track.speed),
      team: group.name,
      role: group.role,
      xml,
    });
  }
  return events;
}

/** Input a CoT reader must survive (the cot brief's criterion 6): each is dropped, the stream continues. */
export const hostile = {
  /**
   * Not well-formed, but complete: it ends with </event>, so a reader that frames on the end tag
   * can drop this one event and read the next (the point's attribute list is never closed).
   */
  malformed: (uid = 'ita-malformed') =>
    `<event version="2.0" uid="${uid}" type="a-f-G" how="m-g" time="${iso(Date.now())}"><point lat="59.1" lon="18.1"<detail/></event>`,
  /** Cut off: no end tag at all, as from a sender that died mid-event. Whatever follows is glued to it. */
  truncated: (uid = 'ita-truncated') => `<event version="2.0" uid="${uid}" type="a-f-G" how="m-g" time="${iso(Date.now())}"><point lat="59.1" lon="18.1"`,
  /** A well-formed event of about `bytes` (default 1 MB), in its remarks. */
  huge: (uid = 'ita-huge', bytes = 1_000_000) => cotEvent({ uid, lon: 18.2, lat: 59.2, remarks: 'x'.repeat(bytes) }),
  /**
   * A document with a DTD and an external entity pointing at `entityUrl` (the double's own
   * `entityUrl`, which counts requests): a reader that resolves entities fetches it.
   */
  externalEntity: (entityUrl, uid = 'ita-xxe') =>
    `<?xml version="1.0"?><!DOCTYPE event [<!ENTITY xxe SYSTEM "${entityUrl}">]>` + cotEvent({ uid, lon: 18.3, lat: 59.3, remarks: '&xxe;' }).replace('&amp;xxe;', '&xxe;'),
  /** A DTD with an internal entity that expands exponentially ("billion laughs"). */
  entityExpansion: (uid = 'ita-laughs') => {
    const levels = ['<!ENTITY l0 "ha">'];
    for (let i = 1; i <= 9; i++) levels.push(`<!ENTITY l${i} "${`&l${i - 1};`.repeat(10)}">`);
    return `<?xml version="1.0"?><!DOCTYPE event [${levels.join('')}]>` + cotEvent({ uid, lon: 18.4, lat: 59.4, remarks: 'L9' }).replace('L9', '&l9;');
  },
};

/**
 * Starts a TAK test double on 127.0.0.1. `certs` (lib/test-certs.mjs) makes it TLS: it presents the
 * server certificate and requires a client certificate signed by the CA, as a TAK Server's port
 * 8089 does. Without `certs` it is plain TCP. `relay: 'others'` passes each complete event a client
 * sends on to the other open connections, as a TAK Server does; `relay: 'all'` to the sender too
 * (a double that echoes).
 */
export async function startTakDouble({ certs, port = 0, host = '127.0.0.1', relay } = {}) {
  const connections = [];
  const refused = { count: 0, times: [] };
  const rejected = []; // TLS clients without a valid certificate
  let refusing = false;
  let nextId = 1;
  const waiters = [];

  const accept = (socket) => {
    if (refusing) {
      refused.count++;
      refused.times.push(Date.now());
      socket.destroy();
      return;
    }
    const connection = {
      id: nextId++,
      openedAt: Date.now(),
      closedAt: null,
      authorized: certs ? socket.authorized : null,
      peer: certs ? (socket.getPeerCertificate()?.subject?.CN ?? null) : null,
      received: [],
      pending: '',
      socket,
    };
    connections.push(connection);
    socket.on('data', (chunk) => {
      connection.received.push(chunk);
      if (!relay) return;
      // Whole events only, as TAK Server relays them; a chunk may end inside one.
      connection.pending += chunk.toString('utf8');
      let end;
      while ((end = connection.pending.indexOf('</event>')) >= 0) {
        const event = connection.pending.slice(0, end + '</event>'.length);
        connection.pending = connection.pending.slice(end + '</event>'.length);
        for (const c of open()) if (relay === 'all' || c !== connection) c.socket.write(event);
      }
    });
    socket.on('error', () => undefined); // a client that resets; recorded as closed
    socket.on('close', () => (connection.closedAt = Date.now()));
    for (const w of waiters.splice(0)) w();
  };

  const server = certs
    ? createTlsServer({ ...serverTlsOptions(certs), requestCert: true, rejectUnauthorized: true }, accept)
    : createTcpServer(accept);
  if (certs) server.on('tlsClientError', (error) => rejected.push(error.code ?? error.message));
  const listen = (on) =>
    new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(on, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
  await listen(port);
  const boundPort = server.address().port;

  // Counts requests for external entities (hostile.externalEntity): none may arrive.
  const entityRequests = [];
  const entityServer = createHttpServer((req, res) => {
    entityRequests.push(req.url);
    res.end('resolved');
  });
  await new Promise((resolve) => entityServer.listen(0, host, resolve));

  const open = () => connections.filter((c) => c.closedAt === null);
  const write = (data) => {
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    for (const c of open()) c.socket.write(bytes);
    return open().length;
  };

  const double = {
    host,
    port: boundPort,
    transport: certs ? 'tls' : 'tcp',
    connections,
    refused,
    rejected,
    entityRequests,
    entityUrl: `http://${host}:${entityServer.address().port}/entity`,

    /** Connections that are open now. */
    open,

    /** Resolves when `count` connections have been accepted in all (not only open ones). */
    async waitForConnections(count = 1, timeoutMs = 30_000) {
      const deadline = Date.now() + timeoutMs;
      while (connections.length < count) {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`TAK double: ${connections.length} of ${count} connections within ${timeoutMs} ms`);
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, left);
          waiters.push(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      return connections[count - 1];
    },

    /** Sends a CoT event (from cotEvent's fields, or XML text) to every open connection; returns how many. */
    send(event) {
      return write(typeof event === 'string' ? event : cotEvent(event));
    },

    /** Sends raw bytes or text, exactly as given (split events, hostile input). */
    sendRaw: write,

    /**
     * Sends `rate` events per second for `seconds`, cycling over `uids` uids, each moving a little;
     * `make(uid, i)` may return the event's fields. Resolves with what was sent and the rate reached.
     */
    async stream({ rate = 1_000, uids = 10_000, seconds = 10, make } = {}) {
      const started = Date.now();
      let sent = 0;
      while (Date.now() - started < seconds * 1000) {
        const due = Math.floor(((Date.now() - started) / 1000) * rate);
        const chunk = [];
        for (; sent < due; sent++) {
          const n = sent % uids;
          const fields = make?.(`ita-${n}`, sent) ?? { uid: `ita-${n}`, lon: 10 + (n % 100) / 10, lat: 55 + Math.floor(n / 100) / 20 + (sent % 7) / 10_000 };
          chunk.push(cotEvent(fields));
        }
        if (chunk.length > 0) write(chunk.join(''));
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      // What is still due after the last tick, so exactly rate x seconds events go out.
      const rest = [];
      for (; sent < Math.round(rate * seconds); sent++) {
        const n = sent % uids;
        rest.push(cotEvent(make?.(`ita-${n}`, sent) ?? { uid: `ita-${n}`, lon: 10 + (n % 100) / 10, lat: 55 + Math.floor(n / 100) / 20 + (sent % 7) / 10_000 }));
      }
      if (rest.length > 0) write(rest.join(''));
      const elapsed = (Date.now() - started) / 1000;
      return { sent, seconds: elapsed, ratePerSecond: sent / elapsed };
    },

    /** What clients have written so far, as text (all connections, in order). */
    receivedText() {
      return connections.map((c) => Buffer.concat(c.received).toString('utf8')).join('');
    },

    /** The events clients have written so far (parseEvents), the presence events included. */
    receivedEvents() {
      return connections.flatMap((c) => parseEvents(Buffer.concat(c.received).toString('utf8')));
    },

    /**
     * The TAK system goes away: open connections are reset. Then, by default (`'closed'`), the port
     * is closed, so new connections are refused by the system, as when a TAK Server is down; the
     * double sees no attempts. With `'reset'` it keeps listening and resets every new connection
     * right after accepting it, recording each attempt's time in `refused.times`: that shows a
     * client's back-off (the cot brief's function 8).
     */
    async goAway(how = 'closed') {
      refusing = true;
      for (const c of open()) c.socket.destroy();
      if (how === 'closed') await new Promise((resolve) => server.close(resolve));
    },

    /** Comes back on the same port. */
    async comeBack() {
      refusing = false;
      if (!server.listening) await listen(boundPort);
    },

    async close() {
      for (const c of open()) c.socket.destroy();
      await Promise.all([server.listening ? new Promise((resolve) => server.close(resolve)) : undefined, new Promise((resolve) => entityServer.close(resolve))]);
    },
  };
  return double;
}
