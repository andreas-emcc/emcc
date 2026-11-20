// The shared look check (SDK 1.2.0, CR-0025 part 1): each rule of the conformance reviewer's
// check 9, CSS part, with a case that passes and one that fails.
import { describe, expect, it } from 'vitest';
import { checkLookCss, type LookRule } from '../src/testing/index.ts';

const rules = (css: string, allow?: readonly string[]): LookRule[] =>
  checkLookCss(css, { pluginId: 'demo', ...(allow === undefined ? {} : { allow }) }).map((f) => f.rule);

describe('checkLookCss', () => {
  it('passes CSS that only arranges and takes its look from the tokens', () => {
    const css = `
      /* a comment with #ff0000 and 12px in it */
      .demo-panel { display: flex; gap: var(--emc2-space-gap); padding: 0 var(--emc2-space-padding); }
      .demo-row { height: var(--emc2-size-row); color: var(--emc2-color-text); line-height: 1.4; flex: 1; }
      .demo-row:hover { background: color-mix(in srgb, var(--emc2-color-accent) 12%, transparent); }
      .demo-divider { height: 1px; background: var(--emc2-color-border); margin: 0; }
      .demo-ring { box-shadow: 0 0 0 1px var(--emc2-focus-color); border: 1px solid var(--emc2-color-border); }
      .demo-wide { width: 240px; font-weight: 600; font-size: small; color: currentColor; }
      .demo-own { --demo-offset: calc(var(--emc2-space-gap) * 2); margin-top: var(--demo-offset); max-height: 50%; }
      @media (max-width: 400px) { .demo-panel { padding: var(--emc2-space-gap); } }
    `;
    expect(checkLookCss(css, { pluginId: 'demo' })).toEqual([]);
  });

  it('fails literal colours: hex, colour functions with numbers, and named colours', () => {
    expect(rules('.demo-a { color: #1F3A93; }')).toEqual(['colour']);
    expect(rules('.demo-a { background: rgb(0 0 0 / 40%); }')).toEqual(['colour']);
    expect(rules('.demo-a { border-color: hsl(210 50% 40%); }')).toEqual(['colour']);
    expect(rules('.demo-a { outline-color: red; }')).toEqual(['colour']);
    expect(rules('.demo-a { color: rgb(var(--demo-rgb)); }')).toEqual([]);
  });

  it('lets the colours fixed in every look pass when the plugin allows them', () => {
    expect(rules('.demo-hostile { fill: #FF8080; }', ['#ff8080'])).toEqual([]);
    expect(rules('.demo-hostile { fill: #FF8080; color: #000; }', ['#ff8080'])).toEqual(['colour']);
  });

  it('fails a length with a unit in a property the tokens size, also in calc() and logical variants', () => {
    expect(rules('.demo-a { padding: 4px; }')).toEqual(['length']);
    expect(rules('.demo-a { padding-inline: 0.5rem; }')).toEqual(['length']);
    expect(rules('.demo-a { border-top-left-radius: 3px; }')).toEqual(['length']);
    expect(rules('.demo-a { font-size: 13px; }')).toEqual(['length']);
    expect(rules('.demo-a { min-height: calc(100% - 8px); }')).toEqual(['length']);
    expect(rules('.demo-a { gap: 1px; }')).toEqual(['length']);
    expect(rules('.demo-a { box-shadow: 0 2px 4px var(--emc2-color-border); }')).toEqual(['length']);
  });

  it('fails a font-family that is not a token', () => {
    expect(rules('.demo-a { font-family: Arial, sans-serif; }')).toEqual(['font-family']);
    expect(rules('.demo-a { font-family: var(--emc2-font-data); }')).toEqual([]);
  });

  it('fails a property that is neither a token nor the plugin\'s own, and defining an --emc2- property', () => {
    expect(rules('.demo-a { color: var(--other-plugin-text); }')).toEqual(['unknown-property']);
    expect(rules('.demo-a { --emc2-color-text: var(--emc2-color-muted); }')).toEqual(['emc2-definition']);
  });

  it('fails the 1.0 alias tokens', () => {
    expect(rules('.demo-a { color: var(--muted); }')).toEqual(['alias']);
    expect(rules('.demo-a { background: var(--shell-bg); }')).toEqual(['alias']);
  });

  it("fails classes that do not start with the plugin's id, and rules on the shared components' classes", () => {
    expect(rules('.panel { display: flex; }')).toEqual(['class']);
    expect(rules('.demo-panel .emc2-button { margin: 0; }')).toEqual(['class']);
    expect(rules('.demo-panel > .demo-row:focus-visible { outline: 1px solid var(--emc2-focus-color); }')).toEqual([]);
    expect(rules('.demo { display: grid; }')).toEqual([]);
  });

  it("lets a library's classes pass only when the plugin names their prefix, and never emc2-", () => {
    const css = '.demo-map .ol-dragzoom { border-color: var(--emc2-color-accent); }';
    expect(rules(css)).toEqual(['class']);
    expect(checkLookCss(css, { pluginId: 'demo', allowClasses: ['ol-'] })).toEqual([]);
    expect(checkLookCss('.demo-map .emc2-button { margin: 0; }', { pluginId: 'demo', allowClasses: ['emc2-'] }).map((f) => f.rule)).toEqual(['class']);
  });

  it('reads the rule after a statement at-rule, and inside @keyframes, @layer blocks and nested rules', () => {
    expect(rules('@import "base.css";\n.demo-a { color: red; }')).toEqual(['colour']);
    expect(rules('@layer base, demo;\n.demo-a { color: red; }')).toEqual(['colour']);
    expect(rules('@keyframes demo-pulse { from { color: red; } to { opacity: 0; } }')).toEqual(['colour']);
    expect(rules('@layer demo { .demo-a { padding: 4px; } }')).toEqual(['length']);
    expect(rules('.demo-a { display: flex; .demo-b { padding: 4px; } }')).toEqual(['length']);
    expect(rules('.demo-a { .other { display: block; } }')).toEqual(['class']);
    expect(rules('.demo-a { @media (width > 400px) { color: #fff; } }')).toEqual(['colour']);
  });

  it('fails a literal in a var() fallback', () => {
    expect(rules('.demo-a { color: var(--emc2-color-text, #000); }')).toEqual(['colour']);
    expect(rules('.demo-a { padding: var(--emc2-space-padding, 8px); }')).toEqual(['length']);
    expect(rules('.demo-a { color: var(--emc2-color-text, var(--emc2-color-muted)); }')).toEqual([]);
  });

  it("fails a colour in the plugin's own custom property, not a length (it may be a width)", () => {
    expect(rules('.demo-a { --demo-bg: #ff0000; background: var(--demo-bg); }')).toEqual(['colour']);
    expect(rules('.demo-a { --demo-column: 240px; width: var(--demo-column); }')).toEqual([]);
  });

  it('ignores strings, url() and attribute selectors', () => {
    expect(rules('.demo-link[href$=".pdf"] { color: var(--emc2-color-accent); }')).toEqual([]);
    expect(rules('.demo-a { mask: url(#demo-mask); }')).toEqual([]);
    expect(rules('.demo-a { background-image: url(red/x.png); }')).toEqual([]);
    expect(rules('.demo-a::after { content: "red 4px #fff"; padding: 0; }')).toEqual([]);
    expect(rules('.demo-a { content: "/*"; color: red; } .demo-b { padding: 4px; } /* end */')).toEqual(['colour', 'length']);
  });

  it('reports a rule\'s class once, also with a grouping at-rule nested in it', () => {
    expect(rules('.panel { display: flex; @media (width > 400px) { display: grid; } }')).toEqual(['class']);
  });

  it('knows container and small, large and dynamic viewport units, and the old grid-gap', () => {
    expect(rules('.demo-a { padding: 4cqw; }')).toEqual(['length']);
    expect(rules('.demo-a { max-height: 50dvmin; }')).toEqual(['length']);
    expect(rules('.demo-a { grid-gap: 4px; }')).toEqual(['length']);
  });

  it('lets a whole colour function pass when allow names it', () => {
    expect(rules('.demo-a { fill: rgb(255 128 128); }', ['RGB(255  128 128)'])).toEqual([]);
    expect(rules('.demo-a { fill: rgb(255 128 128); }')).toEqual(['colour']);
  });

  it('fails a family in the font shorthand that is not a token, a system font too (L1)', () => {
    expect(rules('.demo-a { font: var(--emc2-size-text) Arial, sans-serif; }')).toEqual(['font-family']);
    expect(rules('.demo-a { font: menu; }')).toEqual(['font-family']);
    expect(rules('.demo-a { font: italic 600 var(--emc2-size-text)/1.4 var(--emc2-font-text); }')).toEqual([]);
    expect(rules('.demo-a { font: inherit; }')).toEqual([]);
    expect(rules('.demo-a { font: 600 calc(var(--emc2-size-text) * 1.3) / 1 var(--emc2-font-text); }')).toEqual([]);
    expect(rules('.demo-a { font: calc(var(--emc2-size-text) * 2) Arial; }')).toEqual(['font-family']);
    expect(rules('.demo-a { font-family: var(--emc2-font-text, "Comic Sans MS"); }')).toEqual(['font-family']);
  });

  it("checks an own property's definition where it is used for a size or a family (L1, L4), not for a width", () => {
    expect(rules('.demo-a { --demo-pad: 12px; padding: var(--demo-pad); }')).toEqual(['length']);
    expect(rules('.demo-a { --demo-pad: var(--emc2-space-padding); padding: var(--demo-pad); }')).toEqual([]);
    expect(rules('.demo-a { --demo-font: "Comic Sans MS"; } .demo-b { font-family: var(--demo-font); }')).toEqual(['font-family']);
    expect(rules('.demo-a { --demo-inner: 12px; --demo-pad: var(--demo-inner); margin: var(--demo-pad); }')).toEqual(['length']);
    expect(rules('.demo-a { --demo-column: 240px; width: var(--demo-column); }')).toEqual([]);
    expect(rules('.demo-a { margin: var(--demo-measured); }')).toEqual([]);
  });

  it('fails CSS system colours where a colour is taken, except under forced colours (L3)', () => {
    expect(rules('.demo-a { color: CanvasText; background: Canvas; }')).toEqual(['colour', 'colour']);
    expect(rules('.demo-a { border: 1px solid ButtonBorder; }')).toEqual(['colour']);
    expect(rules('@media (forced-colors: active) { .demo-a { color: CanvasText; outline-color: Highlight; } }')).toEqual([]);
    expect(rules('.demo-a { @media (forced-colors: active) { color: LinkText; } }')).toEqual([]);
    expect(rules('.demo-a { transition: background 0.2s; will-change: background; }')).toEqual([]);
  });

  it('lets a relative colour from a token pass, with its literal channels and alpha (L5)', () => {
    expect(rules('.demo-a { background: hsl(from var(--emc2-color-accent) h s l / 0.5); }')).toEqual([]);
    expect(rules('.demo-a { background: rgb(from #1f3a93 r g b / 0.5); }')).toEqual(['colour']);
  });

  it('ignores !important, and reads calc() with inner parentheses in the font shorthand', () => {
    expect(rules('.demo-a { font: var(--emc2-size-text) var(--emc2-font-text) !important; }')).toEqual([]);
    expect(rules('.demo-a { font-family: var(--emc2-font-text) !important; color: red !important; }')).toEqual(['colour']);
    expect(rules('.demo-a { font: calc((var(--emc2-size-text) + 2) * 1.5) var(--emc2-font-text); }')).toEqual([]);
    expect(rules('.demo-a { font: var(--emc2-size-text) var(--emc2-font-text, Arial); }')).toEqual(['font-family']);
  });

  it('finds system colours wherever a colour can go, and in own properties where they are used', () => {
    expect(rules('.demo-a { background-image: linear-gradient(Canvas, transparent); }')).toEqual(['colour']);
    expect(rules('.demo-a { filter: drop-shadow(0 0 1px Canvas); }')).toEqual(['colour']);
    expect(rules('.demo-a { --demo-area: mark; grid-area: var(--demo-area); }')).toEqual([]);
    expect(rules('.demo-a { --demo-bg: Canvas; background: var(--demo-bg); }')).toEqual(['colour']);
    expect(rules('.demo-a { grid-template-areas: "mark field"; animation-name: highlight; }')).toEqual([]);
    expect(rules('.demo-a { list-style: window inside; page: mark; }')).toEqual([]);
  });

  it('passes system colours only under a plain forced-colors query', () => {
    expect(rules('@media screen and (forced-colors: active) { .demo-a { color: CanvasText; } }')).toEqual([]);
    expect(rules('@media not (forced-colors: active) { .demo-a { color: CanvasText; } }')).toEqual(['colour']);
    expect(rules('@media (forced-colors: active), print { .demo-a { color: CanvasText; } }')).toEqual(['colour']);
    expect(rules('@media (forced-colors: active) or (min-width: 1px) { .demo-a { color: CanvasText; } }')).toEqual(['colour']);
  });

  it('ends on own properties that refer to each other', () => {
    expect(rules('.demo-a { --demo-a: var(--demo-b); --demo-b: var(--demo-a); padding: var(--demo-a); }')).toEqual([]);
  });

  it('gives each finding its line, property and value', () => {
    const findings = checkLookCss('.demo-a {\n  display: block;\n  color: #fff;\n}\n', { pluginId: 'demo' });
    expect(findings).toEqual([{ line: 3, property: 'color', value: '#fff', rule: 'colour' }]);
  });
});
