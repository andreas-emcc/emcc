// A grid column of this plugin's panels has a minimum width made of rows (`--emc2-size-row`), which grows with the density. In
// comfortable density that minimum is wider than the left pane, and the form overflowed (PCA-coordinates found it in its panel,
// 2026-10-21). Layout is not computed in jsdom, so this checks the rule that prevents it: a column's minimum never exceeds the
// container (`min(100%, ...)`).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The `minmax(<min>, <max>)` column minimums of every `grid-template-columns` that are not capped at the container's width. */
export function uncappedColumnMinimums(css: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: string[] = [];
  for (const rule of withoutComments.matchAll(/grid-template-columns\s*:\s*([^;{}]+)(?=[;}])/gi)) {
    const value = rule[1] ?? '';
    for (const call of value.matchAll(/minmax\(/gi)) {
      const minimum = value.slice(call.index + call[0].length).trim();
      // `minmax(0, 1fr)` and other minimums that cannot be wide are fine; a minimum made of tokens or lengths must be capped
      if (/^(?:0|0px|auto|min-content)\s*,/i.test(minimum)) continue;
      if (!/^min\(\s*100%\s*,/i.test(minimum)) found.push(value.trim());
    }
  }
  return found;
}

describe('the grids of the panels never need more room than their container has', () => {
  const css = readFileSync(join(import.meta.dirname, '../src/draw-symbols.css'), 'utf8');

  it('caps every column minimum at 100% of the container', () => {
    expect(uncappedColumnMinimums(css)).toEqual([]);
  });

  it('the check can fail', () => {
    expect(uncappedColumnMinimums('.a { grid-template-columns: repeat(auto-fit, minmax(calc(var(--emc2-size-row) * 8), 1fr)); }')).toHaveLength(1);
    expect(uncappedColumnMinimums('.a { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)) }')).toHaveLength(1);
    expect(uncappedColumnMinimums('.a { grid-template-columns: repeat(auto-fit, minmax(min(100%, calc(var(--emc2-size-row) * 8)), 1fr)); }')).toEqual([]);
    expect(uncappedColumnMinimums('.a { grid-template-columns: max-content minmax(0, 1fr); }')).toEqual([]);
    // every minmax of a declaration counts, not only the first
    expect(uncappedColumnMinimums('.a { grid-template-columns: minmax(0, 1fr) minmax(120px, 1fr); }')).toHaveLength(1);
  });
});
