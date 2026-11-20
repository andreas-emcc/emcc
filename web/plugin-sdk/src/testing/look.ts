/**
 * SDK 1.2.0 (CR-0025 part 1): the shared look check, the CSS part of the conformance reviewer's
 * check 9 (`.claude/agents/conformance-reviewer.md`; ADR-0029, ADR-0034), so that every plugin's
 * token test follows one rule. The reviewer's text stays the rule; this follows it.
 *
 * Inline styles and what a plugin draws itself stay with the reviewer's search, not this check.
 *
 * @example
 * import { readFileSync } from 'node:fs';
 * import { checkLookCss } from '@emc2/plugin-sdk/testing';
 *
 * it('takes its look from the design tokens only', () => {
 *   const css = readFileSync(new URL('../src/draw-shapes.css', import.meta.url), 'utf8');
 *   expect(checkLookCss(css, { pluginId: 'draw-shapes' })).toEqual([]);
 * });
 */
import { TOKEN_ALIASES, TOKENS } from '../theme.ts';

/** Which part of check 9 a finding breaks. */
export type LookRule =
  /** A literal colour: a hex value, a colour function with literal values, a named colour, or a CSS system colour outside `@media (forced-colors: active)`. */
  | 'colour'
  /** A length with a unit in a property whose size comes from the tokens. */
  | 'length'
  /** A font family that is not a token, in `font-family` or the `font` shorthand (a system font such as `menu` too). */
  | 'font-family'
  /** A `var(--…)` that is neither a token nor the plugin's own `--<id>-…`. */
  | 'unknown-property'
  /** A definition of an `--emc2-` property in plugin CSS. */
  | 'emc2-definition'
  /** One of the 1.0 alias tokens (`TOKEN_ALIASES`). */
  | 'alias'
  /** A class that does not start with the plugin's id, or a rule on the shared components' `emc2-` classes. */
  | 'class';

export interface LookFinding {
  /** 1-based line in the CSS where the declaration or selector starts. */
  readonly line: number;
  /** The property, or `selector` for a class finding. */
  readonly property: string;
  /** The declaration's value, or the selector. */
  readonly value: string;
  readonly rule: LookRule;
}

export interface LookCheckOptions {
  /** The plugin's id: its classes start with `<id>-`, its own custom properties with `--<id>-`. */
  readonly pluginId: string;
  /**
   * Literal colours that pass, compared without regard to case or spacing: those fixed in every look
   * (the APP-6 affiliation colours, the selection highlight; ADR-0034), as check 9 lets them pass.
   * A hex value, a named colour, or a whole colour function as written, e.g. `rgb(255 128 128)`.
   */
  readonly allow?: readonly string[];
  /**
   * Class prefixes of a library the plugin draws with, which its CSS may style, e.g. `['ol-']` for
   * OpenLayers' controls in the map view. The reviewer judges each (check 9); `emc2-` never passes.
   */
  readonly allowClasses?: readonly string[];
}

const TOKEN_PROPERTIES = new Set<string>(Object.values(TOKENS));
const ALIAS_PROPERTIES = new Set<string>(Object.keys(TOKEN_ALIASES));

/** CSS's named colours (CSS Color 4), without the keywords that pass (`transparent`, `currentColor`). */
const NAMED_COLOURS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse ' +
    'chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta ' +
    'darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet ' +
    'deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green ' +
    'greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey ' +
    'lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive ' +
    'olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
    'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey ' +
    'snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
);

const COLOUR_FUNCTION = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi;
const HEX = /#[0-9a-f]{3,8}\b/gi;
const LENGTH = /(?<![\w.#-])-?(?:\d+\.?\d*|\.\d+)(px|em|rem|pt|pc|ch|ex|cap|ic|lh|rlh|[sld]?v(?:h|w|i|b|min|max)|cq(?:w|h|i|b|min|max)|cm|mm|q|in)\b/gi;
const VAR = /var\(\s*(--[A-Za-z0-9_-]+)/g;
/**
 * CSS system colours (CSS Color 4, the deprecated ones included), in lower case. They come from the
 * browser, not from the looks, so they fail, except inside `@media (forced-colors: active)`.
 */
const SYSTEM_COLOURS = new Set(
  (
    'canvas canvastext buttonborder buttonface buttontext field fieldtext highlight highlighttext selecteditem selecteditemtext ' +
    'graytext linktext visitedtext activetext mark marktext accentcolor accentcolortext ' +
    'activeborder activecaption appworkspace background buttonhighlight buttonshadow captiontext inactiveborder inactivecaption ' +
    'inactivecaptiontext infobackground infotext menu menutext scrollbar threeddarkshadow threedface threedhighlight ' +
    'threedlightshadow threedshadow window windowframe windowtext'
  ).split(' '),
);

/**
 * Properties whose words are names, not colours, so a system colour's name there means no colour
 * (`transition: background`, `grid-area: mark`); fonts too, where `menu` is a system font. Every
 * other property is scanned for system colours. Custom properties are checked where they are used.
 */
const NAME_ONLY_PROPERTY =
  /^(transition(-.*)?|will-change|grid(-.*)?|animation(-.*)?|content|quotes|counter-(reset|increment|set)|list-style|list-style-type|page|src|font(-.*)?|.*-name|container(-.*)?|view-transition-.*|--.*)$/;

/** A media query for the browser's forced (high-contrast) colours. */
const FORCED_COLOURS = /^@media\b[^{]*\bforced-colors\s*:\s*active\b/i;
/** A query list that is not one plain `and`-chain: negated, joined with `or`, or several queries. */
const NOT_ONE_CHAIN = /(^@media\s+not\b|\bnot\s*\(|\bor\b|,)/i;
const forcedColours = (head: string) => FORCED_COLOURS.test(head) && !NOT_ONE_CHAIN.test(head);

/** Words of the `font` shorthand that are not a family: styles, weights, variants, stretches and size keywords. */
const FONT_KEYWORDS = new Set(
  (
    'normal italic oblique bold bolder lighter small-caps inherit initial unset revert revert-layer ' +
    'ultra-condensed extra-condensed condensed semi-condensed semi-expanded expanded extra-expanded ultra-expanded ' +
    'xx-small x-small small medium large x-large xx-large xxx-large smaller larger'
  ).split(' '),
);

/** At-rules whose block holds rules. */
const GROUPING = /^@(media|supports|layer|container|document|scope|starting-style|(-webkit-)?keyframes)\b/i;

/** Whether `property` takes its size from the tokens (check 9's list, with longhands, logical variants and old aliases). */
function sizedByTokens(property: string): boolean {
  return (
    /^(font|font-size|line-height|gap|row-gap|column-gap|grid-gap|grid-row-gap|grid-column-gap|height|min-height|max-height|block-size|min-block-size|max-block-size|box-shadow)$/.test(property) ||
    /^(padding|margin)(-(top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end))?$/.test(property) ||
    /^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/.test(property)
  );
}

/** 1 px hairlines pass in a `box-shadow` ring and a divider's `height` (borders and outlines are not checked). */
function hairlineAllowed(property: string): boolean {
  return property === 'box-shadow' || property === 'height' || property === 'block-size';
}

/**
 * The value with each `var(--name` taken out and its fallback kept, so that the literal checks see
 * what a fallback holds: `var(--emc2-color-text, #000)` still has `#000`.
 */
function literalPart(value: string): string {
  return value.replace(/var\(\s*--[A-Za-z0-9_-]+\s*,?/g, '(');
}

/** Comments, the text of strings and of `url(...)` blanked, offsets and lines kept. */
function blankNonCss(css: string): string {
  const keep = (s: string) => s.replace(/[^\n]/g, ' ');
  // One scan, so that a string holding "/*" is not read as a comment, nor a comment's quote as a string.
  return css
    .replace(/\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, (s) => (s.startsWith('/*') ? keep(s) : s[0] + keep(s.slice(1, -1)) + s[0]))
    .replace(/url\(([^)]*)\)/gi, (_s, inner: string) => `url(${keep(inner)})`);
}

const normalise = (colour: string) => colour.toLowerCase().replace(/\s+/g, ' ').trim();

interface Declaration {
  readonly property: string;
  /** As written, for the finding. */
  readonly value: string;
  /** With comments, strings and `url(...)` blanked, for the checks. */
  readonly blanked: string;
  readonly line: number;
  /** Inside `@media (forced-colors: active)`, where system colours pass. */
  readonly forced: boolean;
}

interface Rule {
  readonly selector: string;
  readonly line: number;
  readonly declarations: readonly Declaration[];
  /** False for the declarations of a grouping at-rule nested in a rule: its selector is checked once, with the rule. */
  readonly checkSelector: boolean;
}

/**
 * Reads the style rules of `css`: those inside grouping at-rules (`@media`, `@supports`, `@layer`,
 * `@container`, `@scope`, `@starting-style`, `@keyframes`) and nested rules included. Statement
 * at-rules (`@import`, `@charset`, `@layer a, b;`) are skipped; other at-rules with declarations
 * (`@font-face`) are read as rules.
 */
function readRules(css: string): Rule[] {
  const text = blankNonCss(css);
  const lineAt = (offset: number) => text.slice(0, offset).split('\n').length;
  const rules: Rule[] = [];
  const matching = (open: number, to: number) => {
    let depth = 0;
    for (let k = open; k < to; k++) {
      if (text[k] === '{') depth++;
      else if (text[k] === '}' && --depth === 0) return k;
    }
    return to;
  };
  const start = (from: number) => from + (text.slice(from).length - text.slice(from).trimStart().length);
  const block = (selector: string, line: number, from: number, to: number, checkSelector = true, forced = false) => {
    const declarations: Declaration[] = [];
    let i = from;
    while (i < to) {
      const semi = text.indexOf(';', i);
      const open = text.indexOf('{', i);
      const end = semi < 0 || semi > to ? to : semi;
      if (open >= 0 && open < end) {
        // A nested rule, or a nested grouping at-rule whose declarations belong to this selector.
        const close = matching(open, to);
        const head = text.slice(i, open).trim();
        if (GROUPING.test(head)) block(selector, line, open + 1, close, false, forced || forcedColours(head));
        else block(head, lineAt(start(i)), open + 1, close, true, forced);
        i = close + 1;
        continue;
      }
      const part = text.slice(i, end);
      const colon = part.indexOf(':');
      if (colon > 0) {
        const at = start(i);
        const valueFrom = i + colon + 1;
        const important = /\s*!\s*important\s*$/i;
        declarations.push({
          property: part.slice(0, colon).trim().toLowerCase(),
          value: css.slice(valueFrom, end).trim().replace(important, ''),
          blanked: text.slice(valueFrom, end).trim().replace(important, ''),
          line: lineAt(at),
          forced,
        });
      }
      i = end + 1;
    }
    rules.push({ selector, line, declarations, checkSelector });
  };
  const list = (from: number, to: number, forced = false) => {
    let i = from;
    while (i < to) {
      i = start(i);
      if (i >= to) return;
      const open = text.indexOf('{', i);
      const semi = text.indexOf(';', i);
      if (text[i] === '@' && semi >= 0 && semi < to && (open < 0 || semi < open)) {
        i = semi + 1; // a statement at-rule
        continue;
      }
      if (open < 0 || open >= to) return;
      const close = matching(open, to);
      const head = text.slice(i, open).trim();
      if (GROUPING.test(head)) list(open + 1, close, forced || forcedColours(head));
      else block(head, lineAt(i), open + 1, close, true, forced);
      i = close + 1;
    }
  };
  list(0, text.length);
  return rules;
}

/**
 * The CSS part of check 9 for one plugin's CSS file. Returns the findings in the order of the file;
 * a plugin's test expects none.
 *
 * What passes, as in check 9: `0`, percentages, `auto`, `inherit`, `transparent`, `currentColor`,
 * unitless numbers, `calc()` and `color-mix()` of tokens, 1 px hairlines (borders and outlines are
 * not checked; a `box-shadow` ring and a divider's `height`), and the colours named in `allow`. Not
 * checked: `width` and its variants, border and outline widths, `font-weight` and keyword font sizes.
 *
 * A literal in a `var()` fallback counts as a literal. CSS system colours (`Canvas`, `Highlight`, …)
 * are literal colours in every property but those whose words are names (`transition`, `grid-area`,
 * fonts, …), except inside a plain `@media (forced-colors: active)` (not negated, nor joined with
 * `or` or a comma); in an own custom property they count where it is used. `!important` is ignored. A family in the `font` shorthand counts as for `font-family`, a system font too.
 *
 * The plugin's own custom properties (`--<id>-…`) pass when defined from tokens or measured at run
 * time: a colour in their definition fails; where one is used in a token-sized property or for a
 * font family, its definitions in the same file are checked for lengths and families too. Used for a
 * width, its length passes, as widths are not checked.
 */
export function checkLookCss(css: string, options: LookCheckOptions): readonly LookFinding[] {
  const ownProperty = `--${options.pluginId}-`;
  const allowed = new Set((options.allow ?? []).map(normalise));
  const findings: LookFinding[] = [];
  const rules = readRules(css);
  // The plugin's own custom properties, as this file defines them (L1, L4).
  const definitions = new Map<string, Declaration[]>();
  for (const rule of rules) {
    for (const d of rule.declarations) {
      if (d.property.startsWith(ownProperty)) definitions.set(d.property, [...(definitions.get(d.property) ?? []), d]);
    }
  }
  /** Whether a definition of an own property used in `blanked` (or one it uses in turn) fails `test`. */
  const ownDefinitionFails = (blanked: string, test: (definition: Declaration) => boolean, seen = new Set<string>()): boolean => {
    for (const v of blanked.matchAll(VAR)) {
      const name = v[1]!;
      if (!name.startsWith(ownProperty) || seen.has(name)) continue;
      seen.add(name);
      for (const def of definitions.get(name) ?? []) {
        if (test(def) || ownDefinitionFails(def.blanked, test, seen)) return true;
      }
    }
    return false;
  };
  for (const rule of rules) {
    // Attribute selectors and their strings hold no classes.
    for (const cls of (rule.checkSelector ? rule.selector : '').replace(/\[[^\]]*\]/g, ' ').matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
      const name = cls[1]!;
      const ownClass = name === options.pluginId || name.startsWith(`${options.pluginId}-`);
      const library = !name.startsWith('emc2-') && (options.allowClasses ?? []).some((prefix) => name.startsWith(prefix));
      if (!ownClass && !library) {
        findings.push({ line: rule.line, property: 'selector', value: rule.selector, rule: 'class' });
        break;
      }
    }
    for (const d of rule.declarations) {
      const push = (r: LookRule) => findings.push({ line: d.line, property: d.property, value: d.value, rule: r });
      if (d.property.startsWith('--emc2-')) push('emc2-definition');
      for (const v of d.blanked.matchAll(VAR)) {
        const name = v[1]!;
        if (ALIAS_PROPERTIES.has(name)) push('alias');
        else if (!TOKEN_PROPERTIES.has(name) && !name.startsWith(ownProperty)) push('unknown-property');
      }
      const literal = literalPart(d.blanked);
      const colours = [
        ...[...literal.matchAll(HEX)].map((m) => m[0]),
        ...literalColourFunctions(literal),
        ...literal.split(/[\s,()/]+/).filter((w) => NAMED_COLOURS.has(w.toLowerCase())),
        ...(d.forced || NAME_ONLY_PROPERTY.test(d.property) ? [] : systemColours(literal)),
      ].filter((c) => !allowed.has(normalise(c)));
      const systemInOwn =
        !d.forced && !NAME_ONLY_PROPERTY.test(d.property) && ownDefinitionFails(d.blanked, (def) => systemColours(literalPart(def.blanked)).some((c) => !allowed.has(normalise(c))));
      if (colours.length > 0 || systemInOwn) push('colour');
      if (d.property.startsWith('--')) continue;
      const hasLength = (value: string) =>
        [...literalPart(value).matchAll(LENGTH)].some((m) => !(hairlineAllowed(d.property) && /^-?1px$/i.test(m[0])));
      if (sizedByTokens(d.property) && (hasLength(d.blanked) || ownDefinitionFails(d.blanked, (def) => hasLength(def.blanked)))) push('length');
      if (d.property === 'font-family' || d.property === 'font') {
        const shorthand = d.property === 'font';
        if (familyLiteral(d.blanked, shorthand) || ownDefinitionFails(d.blanked, (def) => familyLiteral(def.blanked, shorthand))) push('font-family');
      }
    }
  }
  return findings;
}

/**
 * The colour functions in `literal` that hold a literal colour (a number that is not a percentage),
 * each as written, so that `allow` can name it: `rgb(var(--x))` or `hsl(var(--h) 50% 40%)` hold none.
 */
function literalColourFunctions(literal: string): string[] {
  const found: string[] = [];
  for (const m of literal.matchAll(COLOUR_FUNCTION)) {
    const from = m.index ?? 0;
    const start = from + m[0].length;
    let depth = 1;
    let j = start;
    for (; j < literal.length && depth > 0; j++) {
      if (literal[j] === '(') depth++;
      else if (literal[j] === ')') depth--;
    }
    const args = literal.slice(start, j - 1);
    // A relative colour (`hsl(from var(--emc2-color-accent) h s l / 0.5)`) takes its colour from its
    // origin: its numbers adjust a token. A literal origin (a hex value, a named or a nested colour
    // function) is found on its own by the other scans.
    if (/^\s*from\b/i.test(args)) continue;
    if (/\d/.test(args.replace(/\d+(?:\.\d+)?%/g, ''))) found.push(literal.slice(from, j));
  }
  return found;
}

/**
 * Whether a `font-family` value (or, with `shorthand`, a `font` value) names a family that is not a
 * token: anything but `var(...)` and `inherit`, or, in the shorthand, the style, weight, variant,
 * stretch and size words and sizes. A system font (`font: menu`) is a family that is not a token.
 */
function familyLiteral(blanked: string, shorthand: boolean): boolean {
  let rest = blanked;
  // Every var(...) with its fallback: a fallback's own family is a literal too, so it is kept apart.
  const fallbacks: string[] = [];
  for (;;) {
    const at = rest.search(/var\(/);
    if (at < 0) break;
    let depth = 0;
    let j = at + 3;
    for (; j < rest.length; j++) {
      if (rest[j] === '(') depth++;
      else if (rest[j] === ')' && --depth === 0) break;
    }
    const inner = rest.slice(at + 4, j);
    const comma = inner.indexOf(',');
    if (comma >= 0) fallbacks.push(inner.slice(comma + 1));
    rest = rest.slice(0, at) + ' ' + rest.slice(j + 1);
  }
  // A size in the shorthand may be a calc(), min(), max() or clamp() of tokens: one size, no family.
  // Innermost groups first, so that `calc((a + 2) * 1.5)` goes too.
  for (let before = ''; before !== rest; ) {
    before = rest;
    rest = rest.replace(/(?:\b(?:calc|min|max|clamp))?\([^()]*\)/gi, ' 0 ');
  }
  const words = (text: string) => text.split(/[\s,/]+/).filter((w) => w !== '');
  const isFamily = (w: string) => {
    if (/^["']/.test(w)) return true;
    if (!shorthand) return !/^(inherit|initial|unset|revert|revert-layer)$/i.test(w);
    if (FONT_KEYWORDS.has(w.toLowerCase())) return false;
    return !/^-?(\d+\.?\d*|\.\d+)([a-z%]+)?$/i.test(w);
  };
  return words(rest).some(isFamily) || fallbacks.some((f) => words(f).some((w) => /^["']/.test(w) || !/^(var|inherit)/i.test(w)));
}

/** The CSS system colours among the words of `literal`. */
function systemColours(literal: string): string[] {
  return literal.split(/[\s,()/]+/).filter((w) => SYSTEM_COLOURS.has(w.toLowerCase()));
}
