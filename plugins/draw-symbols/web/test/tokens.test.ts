// ADR-0034: a plugin takes colours, fonts, sizes, spacing, corner radii and shadows from the shell's design tokens only; its CSS only
// arranges the content. This is the web SDK's shared look check (`checkLookCss`, SDK 1.2.0: the CSS part of the conformance reviewer's
// check 9), so that every plugin's test follows one rule (T-085, brief function 22 and criterion 33).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkLookCss } from '@emc2/plugin-sdk/testing';

describe('the plugin\'s CSS takes its look from the design tokens only (ADR-0034)', () => {
  const css = readFileSync(join(import.meta.dirname, '../src/draw-symbols.css'), 'utf8');

  it('passes the shared look check', () => {
    expect(checkLookCss(css, { pluginId: 'draw-symbols' })).toEqual([]);
  });

  it('does use the tokens it relies on', () => {
    for (const token of ['--emc2-color-text', '--emc2-color-border', '--emc2-color-accent-soft', '--emc2-size-text', '--emc2-space-gap', '--emc2-radius', '--emc2-focus-color']) {
      expect(css).toContain(`var(${token})`);
    }
  });

  it('would notice a literal colour, a literal length and a class of another plugin (the check can fail)', () => {
    const rules = new Set(checkLookCss('.draw-symbols-a { color: #fff; padding: 8px; } .other-b { margin: 0; }', { pluginId: 'draw-symbols' }).map((f) => f.rule));
    expect(rules).toEqual(new Set(['colour', 'length', 'class']));
  });
});
