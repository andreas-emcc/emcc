// UDP and multicast test peers for the cot plugin's links (T-086; the cot brief's criteria 14 and
// 23; ADR-0036): a peer receives datagrams on its port, or as a member of a multicast group on the
// run's multicast interface (lib/multicast.mjs), records them, and sends CoT events one per
// datagram, as TAK's UDP and mesh SA inputs carry them. Plain Node.js (dgram).
import dgram from 'node:dgram';
import { cotEvent, parseEvents } from './tak-double.mjs';

/** A UDP port that is free on 127.0.0.1 now (for a link that binds the port itself). */
export async function freeUdpPort() {
  const socket = dgram.createSocket('udp4');
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve));
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

/**
 * Starts a peer. Without `multicast` it binds a free port on 127.0.0.1 and sends from it. With
 * `multicast: { group, address }` (`address`: the IPv4 address of the interface, from
 * multicastInterface()) it joins the group on a free port (or `port`) on that interface, and sends
 * to the group there with TTL 1.
 */
export async function startUdpPeer({ multicast, port = 0 } = {}) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: Boolean(multicast) });
  const received = [];
  socket.on('message', (message, from) => received.push({ text: message.toString('utf8'), from: `${from.address}:${from.port}`, at: Date.now() }));
  socket.on('error', () => undefined);
  // A multicast member binds the wildcard address (Windows cannot bind a group address).
  await new Promise((resolve) => socket.bind(port, multicast ? undefined : '127.0.0.1', resolve));
  if (multicast) {
    socket.addMembership(multicast.group, multicast.address);
    socket.setMulticastInterface(multicast.address);
    socket.setMulticastTTL(1);
    socket.setMulticastLoopback(true);
  }
  const bound = socket.address().port;
  return {
    port: bound,
    received,

    /** The events received so far, one or more per datagram (parseEvents). */
    events() {
      return received.flatMap((r) => parseEvents(r.text));
    },

    /** Sends one CoT event (cotEvent's fields, or XML text) as one datagram to `port` on `host`, or to the group. */
    async send(event, { port: to, host = '127.0.0.1' }) {
      const text = typeof event === 'string' ? event : cotEvent(event);
      await new Promise((resolve, reject) => socket.send(text, to, multicast ? multicast.group : host, (error) => (error ? reject(error) : resolve())));
    },

    async close() {
      await new Promise((resolve) => socket.close(resolve));
    },
  };
}
