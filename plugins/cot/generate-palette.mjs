// Makes the manifest's palette "CoT" (brief function 32, T-156) from the closed APP-6D and APP-6E table (CotSymbolsNumeric.java):
//   node plugins/cot/generate-palette.mjs            writes the "symbolPalettes" block of plugins/cot/plugin.json
//   node plugins/cot/generate-palette.mjs --check    fails if the block differs from what it would write (no file is touched)
//
// One symbol per row of the table, in the table's order: standard APP-6D, the code of the row's 20 digits with the standard identity
// friend and status present (draw-symbols sets the identity the user chooses), and the label "<CoT type without its affiliation> –
// <the entity's name>", e.g. "G-U-C-I – Infantry" (the owner's assumption C1). The names are mil-sym-ts's (2.10.9, Apache-2.0, the
// repository's own dependency): MSLookup's name of the row's entity. The block is committed; the check test
// (check/palette.test.mjs) and the Java PaletteTest keep it in step with the table.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifestFile = join(here, 'plugin.json');
const tableFile = join(here, 'server/src/main/java/dev/emcc/plugins/cot/codec/CotSymbolsNumeric.java');

/** The rows of the table, in its order: [{ key: '10121100', cot: 'GUCI' }]. */
export function tableRows() {
  const text = readFileSync(tableFile, 'utf8');
  const block = /ROWS = """\r?\n([\s\S]*?)"""/.exec(text);
  if (block === null) throw new Error('no ROWS block in CotSymbolsNumeric.java');
  return block[1].split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '').map((l) => {
    const [key, cot] = l.split('=');
    if (!/^\d{8}$/.test(key) || !/^[A-Z]+$/.test(cot)) throw new Error(`odd row: ${l}`);
    return { key, cot };
  });
}

/** The code of a row: version 10, context reality, identity friend, the symbol set, present, no HQ, no amplifier, the entity, no sectors. */
export const codeOf = (key) => `1003${key.slice(0, 2)}0000${key.slice(2)}0000`;

/** The label's first part: the CoT type without its affiliation, e.g. G-U-C-I for a-f-G-U-C-I. */
export const typeOf = (cot) => cot.split('').join('-');

/** The label: the type and the name; a name over the schema's 128 characters loses its last " / " alternatives, then is cut with an ellipsis. */
export function label(type, name) {
  if (!name) return type;
  let n = name;
  while (`${type} – ${n}`.length > 128 && n.includes(' / ')) n = n.slice(0, n.lastIndexOf(' / '));
  const text = `${type} – ${n}`;
  return text.length > 128 ? `${text.slice(0, 127)}…` : text;
}

/** The rows mil-sym-ts's table has no name for (their label is the CoT type alone). */
export const unnamed = [];

export async function palette() {
  const { MSLookup } = await import('@armyc2.c5isr.renderer/mil-sym-ts-web');
  const lookup = MSLookup.getInstance();
  unnamed.length = 0;
  return tableRows().map(({ key, cot }) => {
    const code = codeOf(key);
    const info = lookup.getMSLInfo(code.padEnd(30, '0'));
    const name = info?.getName?.();
    if (!name) unnamed.push(`${key}=${cot}`);
    return { standard: 'APP-6D', code, label: label(typeOf(cot), name) }; // a row mil-sym-ts has no name for: the type alone
  });
}

const START = '  "symbolPalettes": [';
const END = '\n  ],\n';

/** The text of the block: one symbol per line. */
export function block(symbols) {
  const lines = symbols.map((s) => `        { "standard": "${s.standard}", "code": "${s.code}", "label": ${JSON.stringify(s.label)} }`);
  return `${START}\n    {\n      "id": "cot",\n      "name": "CoT",\n      "symbols": [\n${lines.join(',\n')}\n      ]\n    }${END}`;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const wanted = block(await palette());
  const current = readFileSync(manifestFile, 'utf8');
  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  const text = current.replace(/\r\n/g, '\n');
  const from = text.indexOf(START);
  let next;
  if (from >= 0) {
    const to = text.indexOf(END, from);
    if (to < 0) throw new Error('the symbolPalettes block has no end');
    next = text.slice(0, from) + wanted + text.slice(to + END.length);
  } else {
    const at = text.indexOf('\n  "fieldSets": [') + 1; // the top-level one, not the data type's
    if (at < 1) throw new Error('no place for the block: no "fieldSets" in plugin.json');
    next = text.slice(0, at) + wanted + text.slice(at);
  }
  JSON.parse(next); // it must stay valid JSON
  if (process.argv.includes('--check')) {
    if (next !== text) {
      console.error('plugins/cot/plugin.json: the symbolPalettes block differs from what the generator writes');
      process.exit(1);
    }
    console.log(`ok: the palette "CoT" is up to date (${tableRows().length} symbols; no name for ${unnamed.join(', ') || 'none'})`);
  } else {
    writeFileSync(manifestFile, next.replace(/\n/g, eol));
    console.log(`wrote the palette "CoT" (${tableRows().length} symbols; no name for ${unnamed.join(', ') || 'none'}) into plugins/cot/plugin.json`);
  }
}
