// ADR-0034 and the conformance reviewer's check 9: the plugin's CSS only arranges content. The shared look
// check (SDK 1.2.0) does the work; a few lines keep what it leaves to the reviewer: nothing global.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkLookCss } from '@emc2/plugin-sdk/testing';

const src = join(import.meta.dirname, '../src');
const css = readFileSync(join(src, 'fmv.css'), 'utf8');

describe('the CSS (ADR-0034, check 9)', () => {
  it('passes the shared look check', () => {
    expect(checkLookCss(css, { pluginId: 'fmv' })).toEqual([]);
  });

  it('has rules, no :root, no !important and only selectors that start with an fmv class', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...code.matchAll(/([^{}]+)\{/g)].map((m) => (m[1] ?? '').trim());
    expect(rules.length).toBeGreaterThan(4);
    for (const selector of rules) {
      for (const part of selector.split(',')) expect(part.trim(), `selector "${part.trim()}"`).toMatch(/^\.fmv-[a-z-]+/);
    }
    expect(code).not.toContain(':root');
    expect(code).not.toContain('!important');
  });

  it('has no inline style and no shared emc2- class in its TSX', () => {
    for (const f of readdirSync(src).filter((n) => n.endsWith('.tsx'))) {
      const text = readFileSync(join(src, f), 'utf8');
      expect(text, f).not.toMatch(/style=\{/);
      expect(text, f).not.toMatch(/className="[^"]*emc2-/);
    }
  });
});
