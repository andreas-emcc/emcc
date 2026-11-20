// The TAK test double from the command line (lib/tak-double.mjs), for checks by hand and for
// PCA-cot: start it, point an incoming cot link at it, and script what it sends. Runs until Ctrl+C.
//
// Usage: node tests/integration/tak-double.mjs [--port N] [--tls] [--certs DIR] [--name NAME]
//          [--script FILE] [--rate N --uids N --seconds N]
//   --port N     listen on this port (default: a free one, printed)
//   --tls        TLS with a client certificate; makes a CA, a server and a client certificate in
//                --certs (default: a new temporary folder) and prints the emc2 server options for
//                the listener credentials NAME (--name, default "ita-tak")
//   --script F   after the first connection, sends what F says, one JSON object per line:
//                {"after": ms, "event": {cotEvent fields}} | {"after": ms, "raw": "text"}
//                | {"after": ms, "hostile": "malformed" | "truncated" | "huge" | "externalEntity" | "entityExpansion"}
//                | {"after": ms, "goAway": true | "reset"} | {"after": ms, "comeBack": true}
//   --rate N     after the first connection (and the script), N events per second over --uids uids
//                (default 10 000) for --seconds seconds (default 60)
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { hostile, startTakDouble } from './lib/tak-double.mjs';
import { listenerCredentialArgs, makeTestCertificates } from './lib/test-certs.mjs';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '0' },
    tls: { type: 'boolean', default: false },
    certs: { type: 'string' },
    name: { type: 'string', default: 'ita-tak' },
    script: { type: 'string' },
    rate: { type: 'string' },
    uids: { type: 'string', default: '10000' },
    seconds: { type: 'string', default: '60' },
  },
});

let certs;
if (values.tls) {
  certs = makeTestCertificates(values.certs ?? mkdtempSync(join(tmpdir(), 'emc2-tak-certs-')));
  console.log(`Certificates (made now, never commit them): ${certs.folder}`);
  console.log(`emc2 server options for the listener credentials "${values.name}":`);
  for (const line of listenerCredentialArgs(certs, values.name)) console.log(`  ${line}`);
}
const double = await startTakDouble({ certs, port: Number(values.port) });
console.log(`TAK test double (${double.transport}) on ${double.host}:${double.port}; external entities would be fetched from ${double.entityUrl}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let seen = 0;
setInterval(() => {
  for (const c of double.connections.slice(seen)) console.log(`connection ${c.id} from ${c.socket.remoteAddress}:${c.socket.remotePort}${c.peer ? ` (client certificate ${c.peer})` : ''}`);
  seen = double.connections.length;
}, 250).unref();

await double.waitForConnections(1, 24 * 3600_000);
if (values.script) {
  for (const line of readFileSync(values.script, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '')) {
    const step = JSON.parse(line);
    await sleep(step.after ?? 0);
    if (step.event) console.log(`sent event ${step.event.uid} to ${double.send(step.event)} connection(s)`);
    else if (step.raw !== undefined) double.sendRaw(step.raw);
    else if (step.hostile === 'externalEntity') double.sendRaw(hostile.externalEntity(double.entityUrl));
    else if (step.hostile) double.sendRaw(hostile[step.hostile]());
    else if (step.goAway) await double.goAway(step.goAway === 'reset' ? 'reset' : 'closed');
    else if (step.comeBack) await double.comeBack();
    if (step.hostile || step.goAway || step.comeBack) console.log(`step: ${JSON.stringify(step)}`);
  }
}
if (values.rate) {
  const result = await double.stream({ rate: Number(values.rate), uids: Number(values.uids), seconds: Number(values.seconds) });
  console.log(`streamed ${result.sent} events, ${Math.round(result.ratePerSecond)} per second`);
}
console.log(`Running; entity requests so far: ${double.entityRequests.length}. Ctrl+C to stop.`);
process.on('SIGINT', async () => {
  const text = double.receivedText();
  console.log(`\nclients wrote ${text.length} characters${text ? `: ${text.slice(0, 500)}` : ''}`);
  await double.close();
  process.exitCode = 0;
});
