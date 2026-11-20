// ADR-0034 and the conformance reviewer's check 9 (T-057): the plugin's CSS only arranges content. The CSS
// is checked by the SDK's shared look check (SDK 1.2.0); what it leaves to the reviewer is kept here in a few
// lines: nothing global in the CSS, and the TSX has no inline style and no shared `emc2-` class.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkLookCss } from '@emc2/plugin-sdk/testing';

const src = join(import.meta.dirname, '../src');
const css = readFileSync(join(src, 'bookmarks.css'), 'utf8');

describe('the CSS (ADR-0034, check 9)', () => {
  it('passes the shared look check', () => {
    expect(checkLookCss(css, { pluginId: 'bookmarks' })).toEqual([]);
  });

  it('has rules, no :root, no !important and no selector that starts with an element', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...code.matchAll(/([^{}]+)\{/g)].map((m) => (m[1] ?? '').trim());
    expect(rules.length).toBeGreaterThan(4);
    for (const selector of rules) {
      for (const part of selector.split(',')) expect(part.trim(), `selector "${part.trim()}"`).toMatch(/^\.bookmarks-[a-z-]+/);
    }
    expect(code).not.toContain(':root');
    expect(code).not.toContain('!important');
  });

  it('would fail on what check 9 forbids (the shared check can fail)', () => {
    expect(checkLookCss('.bookmarks-x { color: #fff; padding: 4px; }', { pluginId: 'bookmarks' }).map((f) => f.rule)).toEqual(['colour', 'length']);
    expect(checkLookCss('.emc2-button { color: var(--emc2-color-text); }', { pluginId: 'bookmarks' }).map((f) => f.rule)).toEqual(['class']);
  });
});

describe('the components (check 9 for the TSX)', () => {
  const files = readdirSync(src).filter((f) => f.endsWith('.tsx'));

  it('has components to look at', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('has no inline style, no literal colour, no shared emc2- class and no 1.0 alias', async () => {
    const { TOKEN_ALIASES } = await import('@emc2/plugin-sdk');
    for (const file of files) {
      const text = readFileSync(join(src, file), 'utf8');
      expect(text, `${file}: inline style`).not.toMatch(/\bstyle\s*=/);
      expect(text, `${file}: style property`).not.toMatch(/\.style\b|setProperty/);
      expect(text, `${file}: literal colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(/);
      expect(text, `${file}: emc2- class`).not.toMatch(/className=[^>]*['"` ]emc2-/);
      for (const alias of Object.keys(TOKEN_ALIASES)) expect(text, `${file}: ${alias}`).not.toContain(alias);
      for (const cls of text.matchAll(/className=(?:"([^"]*)"|\{?['"`]([^'"`]*)['"`])/g)) {
        for (const name of (cls[1] ?? cls[2] ?? '').split(/\s+/).filter((n) => n !== '')) expect(name, `${file}: class ${name}`).toMatch(/^bookmarks-/);
      }
    }
  });
});
