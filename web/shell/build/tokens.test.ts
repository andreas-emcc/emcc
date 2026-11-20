// @vitest-environment node
import { readFileSync } from 'node:fs';
import { TOKEN_ALIASES, TOKENS } from '@emc2/plugin-sdk';
import { describe, expect, it } from 'vitest';
import { DENSITY_SIZES } from '../src/ui/layout.ts';
import { LOOKS } from '../src/ui/theme.ts';

/** The shell's token values, and the reference they follow; read from the files, as the build does. */
const css = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8');
const looksMd = readFileSync(new URL('../../../docs/architecture/looks.md', import.meta.url), 'utf8');

const SCHEMES = ['light', 'dark'] as const;
const DENSITIES = ['compact', 'comfortable'] as const;

/** The properties of a block of tokens.css, found by its comment (e.g. "colours: signal dark"). */
function block(name: string): Map<string, string> {
  const at = css.indexOf(`/* ${name}`);
  if (at < 0) throw new Error(`no block ${name}`);
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  return new Map(Array.from(body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g), (m: RegExpMatchArray): [string, string] => [m[1], m[2].trim()]));
}

/** The first `:root { … }` block: what is the same in every look. */
const everyLook = (() => {
  const body = css.slice(css.indexOf(':root {') + 7, css.indexOf('}', css.indexOf(':root {')));
  return new Set(Array.from(body.matchAll(/(--[a-z0-9-]+)\s*:/g), (m: RegExpMatchArray) => m[1]));
})();

/** A table of looks.md as rows of cells, found by the heading above it. */
function table(heading: string): string[][] {
  const at = looksMd.indexOf(heading);
  const rows: string[][] = [];
  for (const line of looksMd.slice(at).split('\n')) {
    if (!line.startsWith('|')) {
      if (rows.length > 0) break; // the table's end
      continue;
    }
    rows.push(line.split('|').slice(1, -1).map((c) => c.trim().replace(/`/g, '')));
  }
  return rows.filter((r) => !r.every((c) => /^-+$/.test(c)));
}

const COLOUR_ROWS: Readonly<Partial<Record<string, string>>> = {
  Ground: 'ground', Pane: 'pane', 'Panel head, menu': 'panel', Border: 'border', 'Field border': 'field-border', Text: 'text',
  'Muted text': 'muted', Accent: 'accent', 'On accent': 'on-accent', 'Accent soft (selected rows)': 'accent-soft', OK: 'ok',
  Warning: 'warning', Error: 'error',
  // SDK 1.8.0 (CR-0043 part B; T-205)
  Edge: 'edge', 'Edge in cards': 'edge-card', Raised: 'raised',
};
/** The columns of looks.md's colour table: A dark, A light, B light, B dark, C dark, C light. */
const COLOUR_COLUMNS = ['night-watch dark', 'night-watch light', 'chart-room light', 'chart-room dark', 'signal dark', 'signal light'];
const DENSITY_ROWS: Readonly<Partial<Record<string, string>>> = {
  Text: '--emc2-size-text', 'Small text': '--emc2-size-text-small', 'Row (list, table, menu item)': '--emc2-size-row',
  'Input field height': '--emc2-size-field', Padding: '--emc2-space-padding', Gap: '--emc2-space-gap', Icon: '--emc2-size-icon',
  'Panel head': '--shell-panel-head', 'Top bar': '--shell-top-bar',
};

describe('the looks (tokens.css)', () => {
  it('gives every token of the SDK a value in every look, scheme and density, and keeps the SDK 1.0.0 names', () => {
    for (const look of LOOKS) {
      for (const scheme of SCHEMES) {
        for (const density of DENSITIES) {
          const set = new Set([...everyLook, ...block(`look: ${look}`).keys(), ...block(`colours: ${look} ${scheme}`).keys(), ...block(`density: ${density}`).keys()]);
          expect(Object.values(TOKENS).filter((p) => !set.has(p)), `${look} ${scheme} ${density}`).toEqual([]);
        }
      }
    }
    expect(Object.keys(TOKEN_ALIASES).filter((p) => !everyLook.has(p))).toEqual([]);
  });

  it("has looks.md's colours, every one of the six palettes", () => {
    const rows = table('## Colours');
    let checked = 0;
    for (const row of rows.slice(1)) {
      const token = COLOUR_ROWS[row[0] ?? ''];
      if (token === undefined) continue;
      COLOUR_COLUMNS.forEach((palette, i) => {
        expect(block(`colours: ${palette}`).get(`--emc2-color-${token}`), `${palette} ${token}`).toBe(row[i + 1]);
        checked++;
      });
    }
    expect(checked).toBe(16 * 6);
  });

  it("has looks.md's sizes for both densities, the shell's own as well", () => {
    const rows = table('## Density');
    let checked = 0;
    for (const row of rows.slice(1)) {
      const property = DENSITY_ROWS[row[0] ?? ''];
      if (property === undefined) continue;
      expect(block('density: compact').get(property), `compact ${property}`).toBe(row[1]?.replace(' ', ''));
      expect(block('density: comfortable').get(property), `comfortable ${property}`).toBe(row[2]?.replace(' ', ''));
      checked++;
    }
    expect(checked).toBe(9);
  });

  it("before the theme has run, is Night Watch as dark as the computer is: the same values as Night Watch dark (review F4)", () => {
    expect(block('Before the theme')).toEqual(block('colours: night-watch dark'));
  });

  it("has looks.md's default pane sizes for both densities (review F5)", () => {
    const rows = table('## Density');
    const px = (cell: string | undefined) => (cell ?? '').split(',').map((v) => Number.parseFloat(v));
    const widths = rows.find((r) => r[0]?.startsWith('Default pane widths'));
    const height = rows.find((r) => r[0] === 'Default bottom pane height');
    expect([DENSITY_SIZES.compact.left, DENSITY_SIZES.compact.right]).toEqual(px(widths?.[1]));
    expect([DENSITY_SIZES.comfortable.left, DENSITY_SIZES.comfortable.right]).toEqual(px(widths?.[2]));
    expect([DENSITY_SIZES.compact.bottom, DENSITY_SIZES.comfortable.bottom]).toEqual([...px(height?.[1]), ...px(height?.[2])]);
  });

  it("has each look's shadows and headings", () => {
    expect(block('look: night-watch').get('--emc2-shadow-card')).toBe('none');
    expect(block('look: chart-room').get('--emc2-shadow-menu')).toBe('0 8px 24px rgba(20, 30, 40, 0.18)');
    expect([...LOOKS].map((l) => block(`look: ${l}`).get('--emc2-heading-case'))).toEqual(['uppercase', 'none', 'uppercase']);
    expect([...LOOKS].map((l) => block(`look: ${l}`).get('--emc2-heading-letter-spacing'))).toEqual(['0.06em', 'normal', '0.1em']);
    expect([...LOOKS].map((l) => block(`look: ${l}`).get('--emc2-heading-weight'))).toEqual(['600', '600', '700']);
    expect(block('look: signal').get('--emc2-font-heading')).toBe("Bahnschrift, 'DIN Alternate', 'Arial Narrow', sans-serif");
  });

  it("has looks.md's corners, edges, control corners and field labels for each look (SDK 1.8.0, T-205; T-203)", () => {
    const rows = table('## What a look sets');
    const row = (name: string) => {
      const found = rows.find((r) => r[0]?.startsWith(name));
      if (found === undefined) throw new Error(`no row ${name} in looks.md`);
      return found.slice(1);
    };
    const px = (cell: string) => `${/^(\d+) px/.exec(cell)?.[1] ?? cell}px`;
    // The "Corners" row is the source, as the colour table is: the UXA changes values without a test edit (T-203)
    expect([...LOOKS].map((l) => block(`look: ${l}`).get('--emc2-radius'))).toEqual(row('Corners').map(px));
    expect([...LOOKS].map((l) => block(`look: ${l}`).get('--emc2-edge-width'))).toEqual(row('Edges').map(px));
    expect([...LOOKS].map((l) => block(`look: ${l}`).get('--emc2-radius-control'))).toEqual(row('Control corners').map(px));
    // "The text font, sentence case" or "The data font in capitals, letter spacing 0.04 em"
    const labels = row('Field labels').map((cell) => [
      /data font/.test(cell) ? 'var(--emc2-font-data)' : 'var(--emc2-font-text)',
      /capitals/.test(cell) ? 'uppercase' : 'none',
      /letter spacing ([\d.]+) em/.exec(cell)?.[1]?.concat('em') ?? 'normal',
    ]);
    expect([...LOOKS].map((l) => ['--emc2-font-label', '--emc2-label-case', '--emc2-label-letter-spacing'].map((t) => block(`look: ${l}`).get(t))))
      .toEqual(labels);
  });
});
