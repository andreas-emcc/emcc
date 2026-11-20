// @vitest-environment node
/**
 * The plugin's CSS takes its look from the shell's design tokens only (brief function 21, ADR-0029,
 * ADR-0034): the SDK test kit's checkLookCss, the CSS part of the conformance reviewer's check 9
 * (T-057, CR-0025 part 1). OpenLayers' own controls (`ol-` classes) may be styled.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkLookCss } from '@emc2/plugin-sdk/testing';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../src/map-view-2d.css', import.meta.url)), 'utf-8');

describe('the plugin CSS (brief function 21)', () => {
  it('takes its look from the design tokens only (check 9)', () => {
    expect(checkLookCss(css, { pluginId: 'map-view-2d', allowClasses: ['ol-'] })).toEqual([]);
  });

  it("finds what check 9 fails in this plugin's CSS, so the check runs on it", () => {
    const broken = `${css}\n.map-view-2d-x { color: var(--shell-fg); padding: 2px; background: #fff; }\n.emc2-button { margin: 0; }`;
    expect(checkLookCss(broken, { pluginId: 'map-view-2d', allowClasses: ['ol-'] }).map((f) => f.rule).sort()).toEqual(['alias', 'class', 'colour', 'length']);
  });
});
