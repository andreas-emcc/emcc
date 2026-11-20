// Criterion 14 and 24, ADR-0034: the plugin's CSS only arranges content. Every colour, font, size,
// space, corner radius and shadow is a design token; the classes start with the plugin id; nothing
// is global. The check is the SDK test kit's `checkLookCss`, the CSS part of the conformance
// reviewer's check 9 (brief, function 15).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkLookCss } from '@emc2/plugin-sdk/testing';

const css = readFileSync(join(import.meta.dirname, '../src/draw-shapes.css'), 'utf8');

describe('the look (criteria 14 and 24)', () => {
  it('takes its look from the design tokens only', () => {
    expect(checkLookCss(css, { pluginId: 'draw-shapes' })).toEqual([]);
  });

  it('has no !important, no :root and no rule on an element, as the reviewer\u2019s check 9 also wants', () => {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(bare).not.toMatch(/!important/);
    expect(bare).not.toMatch(/:root/);
    const selectors = [...bare.matchAll(/([^{}]+)\{/g)].flatMap((m) => (m[1] ?? '').split(',').map((x) => x.trim()));
    expect(selectors.filter((x) => !x.startsWith('.draw-shapes-') && !x.startsWith('@'))).toEqual([]);
  });

  it('the check finds what it should: a literal colour, a fixed length and a foreign class', () => {
    const findings = checkLookCss('.draw-shapes-x { color: #fff; padding: 12px; }\n.other { margin: 0; }', { pluginId: 'draw-shapes' });
    expect(findings.map((f) => f.rule).sort()).toEqual(['class', 'colour', 'length']);
  });
});
