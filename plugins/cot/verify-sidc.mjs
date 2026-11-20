// Checks the closed table of CoT functions in CotSymbols.java against milsymbol, with the symbology plugin's rule
// (plugins/symbology/web/src/validate.ts): the model's APP-6B pattern, then milsymbol's own validity check.
// Run it after changing the table, from anywhere in the repository (milsymbol is in the root node_modules):
//   node plugins/cot/verify-sidc.mjs
// It reads the table from the Java source, so the table in the code is the one that is checked.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ms = require('milsymbol');
const source = readFileSync(join(here, 'server/src/main/java/dev/emcc/plugins/cot/codec/CotSymbols.java'), 'utf8');

const PATTERN = /^[A-Z0-9*-]{15}$/; // model/schemas/map-object.schema.json, APP-6B
const valid = (sidc) => PATTERN.test(sidc) && new ms.Symbol(sidc, { standard: 'APP6' }).isValid() === true;

const tables = {};
for (const m of source.matchAll(/'([GASUPF])',\s*words\(((?:\s*"[^"]*"\s*\+?)+)\)/g)) {
  const text = [...m[2].matchAll(/"([^"]*)"/g)].map((s) => s[1]).join('');
  tables[m[1]] = text.trim().split(/\s+/);
}
if (Object.keys(tables).length !== 6) {
  console.error(`expected the functions of 6 battle dimensions in CotSymbols.java, found ${Object.keys(tables).join('')}`);
  process.exit(2);
}

let checked = 0;
const bad = [];
for (const [dimension, functions] of Object.entries(tables)) {
  for (const affiliation of 'PUAFNSHJK') {
    for (const fn of ['', ...functions]) {
      const sidc = `S${affiliation}${dimension}P${fn.padEnd(6, '-')}-----`;
      checked++;
      if (!valid(sidc)) bad.push(sidc);
    }
  }
}
const point = /POINT_SIDC = "([A-Z0-9*-]{15})"/.exec(source)?.[1];
checked++;
if (point === undefined || !valid(point)) bad.push(`POINT_SIDC ${point}`);
for (const unknown of ['SFZP-----------', 'SUZP-----------']) {
  checked++;
  if (!valid(unknown)) bad.push(unknown);
}

if (bad.length > 0) {
  console.error(`${bad.length} of ${checked} SIDCs are not valid for milsymbol ${ms.version}:\n${bad.join('\n')}`);
  process.exit(1);
}
console.log(`ok: ${checked} SIDCs (every function, every affiliation, the generic symbols and the map point) are valid for milsymbol ${ms.version}`);
