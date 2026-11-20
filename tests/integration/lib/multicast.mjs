// The network interface the multicast tests use (owner, 2026-10-27, for T-086): a link that
// receives multicast needs an interface an admin names (the ACA's P2-1, ADR-0036's index row).
// By default the loopback interface, when Java says it supports multicast (Windows: yes; Linux's lo
// only after "ip link set lo multicast on"), so nothing leaves the computer; run.mjs
// --multicast-interface <name> names another. Without one, the multicast tests are skipped and the
// reason printed. Plain Node.js.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const helper = join(dirname(fileURLToPath(import.meta.url)), 'MulticastInterface.java');

/**
 * Asks Java (as ECore and cot name interfaces) for the named interface, or the loopback one:
 * { name, address } with its IPv4 address for Node's sockets, or { skip } with the reason.
 */
export function findMulticastInterface(name) {
  let line;
  try {
    line = execFileSync('java', [helper, ...(name ? [name] : [])], { encoding: 'utf8', timeout: 60_000 }).trim();
  } catch (error) {
    return { skip: `the multicast interface could not be looked up with java: ${error.message}` };
  }
  if (line.startsWith('NONE ')) return { skip: line.slice('NONE '.length) };
  const [found, address] = line.split(' ');
  return { name: found, address };
}

/** The environment run.mjs passes to the specs. */
export function multicastEnvironment(found) {
  return found.skip ? { EMC2_MULTICAST_SKIP: found.skip } : { EMC2_MULTICAST_INTERFACE: found.name, EMC2_MULTICAST_ADDRESS: found.address };
}

/**
 * For a spec: { name, address } of the run's multicast interface, or { skip } with the reason
 * (also when the spec runs outside run.mjs).
 */
export function multicastInterface() {
  const name = process.env.EMC2_MULTICAST_INTERFACE;
  const address = process.env.EMC2_MULTICAST_ADDRESS;
  if (name && address) return { name, address };
  return { skip: `no multicast interface: ${process.env.EMC2_MULTICAST_SKIP || 'run through tests/integration/run.mjs'}` };
}
