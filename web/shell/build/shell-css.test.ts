// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The shell's CSS, its layout (CDA) and its look (UXA; T-199); read from the files here, with Node's types, as the build does. */
const read = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
const css = read('shell.css');
const look = read('shell-look.css');

/**
 * Which file a property belongs in (T-199; owner, 2026-11-13). Each property is in one file only, so
 * that loading shell-look.css right after shell.css keeps every property's cascade as one file had it.
 */
const LOOK = /^(color|background(-.*)?|border(?!-collapse)(-.*)?|box-shadow|outline(-.*)?|font(-.*)?|line-height|letter-spacing|text-align|text-transform|text-decoration(-.*)?|list-style(-.*)?|cursor|opacity|animation(-.*)?|stroke(-.*)?|padding(-.*)?|margin(-.*)?|gap|column-gap|row-gap)$/;
const LAYOUT = /^(display|flex(-.*)?|grid(-.*)?|align-.*|justify-.*|place-.*|order|position|inset|top|right|bottom|left|width|height|(min|max)-(width|height|inline-size|block-size)|aspect-ratio|overflow(-x|-y)?|white-space|text-overflow|overflow-wrap|vertical-align|transform|z-index|isolation|pointer-events|touch-action|clip-path|box-sizing|border-collapse|container-type)$/;

/** The properties a file declares, comments left out. */
function properties(text: string): string[] {
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...bare.matchAll(/(?:^|[{;\s])([a-z-]+)\s*:[^;{}]*;/g)].map((m) => m[1]);
}

/** The declarations of the rule for exactly this selector. */
function rule(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  return css.slice(at, css.indexOf('}', at));
}

describe("the shell's CSS", () => {
  it('keeps layout in shell.css and the look in shell-look.css, each property in one file only (T-199)', () => {
    const layoutProps = properties(css);
    const lookProps = properties(look);
    expect(layoutProps.length).toBeGreaterThan(300);
    expect(lookProps.length).toBeGreaterThan(400);
    expect(layoutProps.filter((p) => !LAYOUT.test(p)), 'not layout, in shell.css').toEqual([]);
    expect(lookProps.filter((p) => !LOOK.test(p)), 'not look, in shell-look.css').toEqual([]);
    expect(css, 'the animations are the look').not.toMatch(/@keyframes/);
  });

  it('loads the look right after the layout, so that the cascade stays as it was', () => {
    expect(read('main.tsx')).toContain("import './shell.css';\nimport './shell-look.css';");
  });

  it("caps a plugin's top bar item without clipping what it draws outside its box (PCA-bookmarks' menus)", () => {
    const item = rule('.top-bar-item');
    expect(item).toContain('max-width: 12rem');
    expect(item).not.toMatch(/overflow/);
  });

  it('keeps the view tabs in one row: the right of the top bar gives way, not the tabs', () => {
    expect(rule('.view-nav')).toContain('flex: 1 0 auto');
  });

  it('scrolls each open panel inside itself, not the pane, and keeps a panel foot in sight (T-203)', () => {
    expect(rule('.pane-body > .panel > .panel-body')).toContain('overflow-y: auto');
    expect(rule('.pane-body > .panel[data-open]')).toContain('min-height: var(--shell-panel-head)');
    expect(rule('.pane-body > .panel[data-open]')).toContain('max-height: max-content');
    expect(rule('.panel .emc2-panel-foot')).toContain('position: sticky');
    expect(rule('.bottom-panel')).toContain('overflow: auto');
  });

  it("keeps View's panels under Settings and Monitor, whatever z-index a panel uses (object-list's sticky toolbar)", () => {
    expect(rule('.view-map')).toContain('isolation: isolate');
  });
});
