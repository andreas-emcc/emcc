// Makes the closed table that turns an APP-6D or APP-6E symbol (a 20-digit SIDC) into a CoT function, for the object to CoT
// direction of the codec (brief function 17). Run it after changing the APP-6B table in CotSymbols.java or when milsymbol changes:
//   node plugins/cot/generate-app6d-table.mjs            writes server/src/main/java/dev/emcc/plugins/cot/codec/CotSymbolsNumeric.java
//   node plugins/cot/generate-app6d-table.mjs --check    fails if the file differs from what it would write (no file is touched)
//
// How: milsymbol draws a symbol from icon parts. For every numeric SIDC (symbol set + the six digits of entity, type and subtype)
// and every letter SIDC (APP-6B / MIL-STD-2525B function code) it knows, the script collects the *names* of the icon parts. Where a
// numeric symbol and a letter symbol of the same battle dimension are drawn from the same icon parts, they are the same symbol, and
// the letter function is the CoT function. Only the functions of the closed table in CotSymbols.java count (the ones the receiving
// side knows, up to three characters); of several that match, the shortest wins. Nothing is guessed from names.
//
// The table is committed; this script and milsymbol (a dev-only dependency of the repository) are not needed to build the plugin.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const msRoot = dirname(require.resolve('milsymbol/package.json'));
const out = join(here, 'server/src/main/java/dev/emcc/plugins/cot/codec/CotSymbolsNumeric.java');
const source = readFileSync(join(here, 'server/src/main/java/dev/emcc/plugins/cot/codec/CotSymbols.java'), 'utf8');

// The names the plugin knows: icon parts are looked up by name, so a proxy that returns the name collects them.
const cache = new Map();
const names = new Proxy({}, { get: (_, key) => cache.get(key) ?? cache.set(key, { part: String(key) }).get(key) });
/** What a symbol is drawn from, as text: the part names, and how they are moved or scaled. */
const signature = (parts) => JSON.stringify(parts, (key, value) => (key === 'non_scaling_stroke' ? undefined : value));
const load = async (relative) => (await import(pathToFileURL(join(msRoot, 'src', relative)).href)).default;

// ---- the closed table of the plugin (CotSymbols.java): battle dimension to its functions
const known = {};
for (const m of source.matchAll(/'([GASUPF])',\s*words\(((?:\s*"[^"]*"\s*\+?)+)\)/g)) {
  known[m[1]] = new Set([...m[2].matchAll(/"([^"]*)"/g)].map((s) => s[1]).join('').trim().split(/\s+/));
}

// ---- the letter symbols (APP-6B): dimension and function letters to the icon part names
const letterModules = ['ground', 'equipment', 'installations', 'air', 'sea', 'subsurface', 'space', 'sof'];
const letter = new Map(); // `${dimension}|${key}` -> parts text
for (const name of letterModules) {
  const module = await load(`lettersidc/sidc/${name}.js`);
  const sId = {};
  module.icons(sId, {}, names, {});
  for (const [key, parts] of Object.entries(sId)) {
    const m = /^S-([GASUPF])-([A-Z-]{6})$/.exec(key.length === 10 ? key.slice(0, 4) + key.slice(4) : key);
    if (!m || parts.length === 0) continue;
    const functionLetters = m[2].replace(/-+$/, '');
    if (!known[m[1]]?.has(functionLetters)) continue;
    const id = signature(parts);
    const slot = `${m[1]}|${functionLetters[0]}|${id}`;
    const entry = letter.get(slot);
    if (entry === undefined || functionLetters.length < entry.length || (functionLetters.length === entry.length && functionLetters < entry)) {
      letter.set(slot, functionLetters);
    }
  }
}

// ---- the numeric symbols (APP-6D, APP-6E): symbol set and entity to the icon part names
// `first` is what the CoT function must begin with, so that a unit is not matched to an equipment that looks the same
// (the tank icon is both an armour unit, GUCA, and an armoured vehicle, GEVA).
const numericModules = {
  landunit: { sets: ['10'], dimension: 'G', first: 'U' },
  landequipment: { sets: ['15'], dimension: 'G', first: 'E' },
  landinstallation: { sets: ['20'], dimension: 'G', first: 'I' },
  air: { sets: ['01'], dimension: 'A' },
  airmissile: { sets: ['02'], dimension: 'A' },
  space: { sets: ['05'], dimension: 'P' },
  spacemissile: { sets: ['06'], dimension: 'P' },
  sea: { sets: ['30'], dimension: 'S' },
  subsurface: { sets: ['35'], dimension: 'U' },
  minewarfare: { sets: ['36'], dimension: 'U' },
};
/** For the symbol sets that are a whole dimension: the shortest function whatever its first letter. */
const firstOf = (dimension, parts) => {
  const found = [...letter.entries()].filter(([slot]) => slot.startsWith(`${dimension}|`) && slot.endsWith(`|${signature(parts)}`)).map(([, fn]) => fn);
  return found.sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
};
const rows = [];
for (const [name, { sets, dimension, first }] of Object.entries(numericModules)) {
  const module = await load(`numbersidc/sidc/${name}.js`);
  for (const set of sets) {
    const sId = {};
    module.icons(sId, {}, {}, {}, set, names, undefined, 'D');
    for (const [entity, parts] of Object.entries(sId)) {
      if (!/^[0-9]{6}$/.test(entity) || parts.length === 0) continue;
      const fn = first === undefined ? firstOf(dimension, parts) : letter.get(`${dimension}|${first}|${signature(parts)}`);
      if (fn !== undefined) rows.push({ set, entity, dimension, fn });
    }
  }
}
rows.sort((a, b) => (a.set + a.entity).localeCompare(b.set + b.entity));

// ---- the Java file
const lines = rows.map((r) => `      ${r.set}${r.entity}=${r.dimension}${r.fn}`);
const java = `package dev.emcc.plugins.cot.codec;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * GENERATED by {@code plugins/cot/generate-app6d-table.mjs}: do not edit by hand. The closed table that turns an
 * APP-6D or APP-6E symbol into a CoT battle dimension and function, for the object to CoT direction of the
 * codec (brief function 17).
 *
 * <p>A row is the symbol set (two digits) and the entity, type and subtype (six digits), then {@code =}, the
 * CoT battle dimension and the function letters: {@code 10121100=GUCI} is a land unit, infantry, which CoT
 * writes {@code a-f-G-U-C-I}. A symbol belongs to a row when milsymbol draws it from the same icon parts as the
 * APP-6B symbol of that function; only the functions of {@link CotSymbols}' own table are used. {@value #COUNT} rows.
 */
final class CotSymbolsNumeric {

  static final int COUNT = ${rows.length};

  private static final String ROWS = """
${lines.join('\n')}
      """;

  private static final Map<String, String> TABLE = parse();

  private CotSymbolsNumeric() {}

  /** The rows in the table's order, each as {@code setAndEntity=function}, e.g. {@code 10121100=GUCI} (the palette "CoT" of the manifest follows them). */
  static List<String> rows() {
    return ROWS.lines().map(String::strip).filter(row -> !row.isEmpty()).toList();
  }

  /** The CoT dimension and function ({@code GUCI}) of a symbol set and an entity ({@code 10121100}), or {@code null}. */
  static String of(String symbolSetAndEntity) {
    return TABLE.get(symbolSetAndEntity);
  }

  private static Map<String, String> parse() {
    var table = new HashMap<String, String>();
    for (String line : ROWS.split("\\n")) {
      String row = line.strip();
      if (!row.isEmpty()) {
        int equals = row.indexOf('=');
        table.put(row.substring(0, equals), row.substring(equals + 1));
      }
    }
    return Map.copyOf(table);
  }
}
`;
if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(out, 'utf8'); } catch { /* missing */ }
  if (current !== java) {
    console.error('CotSymbolsNumeric.java is not what the script writes: run node plugins/cot/generate-app6d-table.mjs');
    process.exit(1);
  }
  console.log(`ok: CotSymbolsNumeric.java is up to date (${rows.length} rows)`);
} else {
  writeFileSync(out, java, { encoding: 'utf8' });
  const bySet = {};
  for (const r of rows) bySet[r.set] = (bySet[r.set] ?? 0) + 1;
  console.log(`wrote ${rows.length} rows to ${out}: ${JSON.stringify(bySet)}`);
}
