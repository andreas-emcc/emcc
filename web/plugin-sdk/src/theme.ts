/**
 * Design tokens (ADR-0029, ADR-0034, CR-0015 items 18 and 19): the names of the CSS custom
 * properties the shell provides. A look (Night Watch, Chart Room, Signal), light or dark, and a
 * density only change their values (`docs/architecture/looks.md`); the shell swaps them at once.
 * **Plugins take colours, fonts, sizes, spacing, corner radii and shadows from these tokens only**,
 * and never choose a look. Renaming or removing a token is a breaking change.
 *
 * @example
 * // in a plugin's CSS
 * .layer-panel-row { height: var(--emc2-size-row); color: var(--emc2-color-text); }
 * // for what a plugin draws on canvas
 * const text = ctx.theme.tokens().colorText;
 * ctx.theme.onChange(() => redraw());
 */
import type { Unsubscribe } from './events.ts';

/** Token → its CSS custom property. */
export const TOKENS = {
  // Colours (looks.md, "Colours")
  colorGround: '--emc2-color-ground',
  colorPane: '--emc2-color-pane',
  colorPanel: '--emc2-color-panel',
  colorBorder: '--emc2-color-border',
  colorFieldBorder: '--emc2-color-field-border',
  colorText: '--emc2-color-text',
  colorMuted: '--emc2-color-muted',
  colorAccent: '--emc2-color-accent',
  colorOnAccent: '--emc2-color-on-accent',
  colorAccentSoft: '--emc2-color-accent-soft',
  colorOk: '--emc2-color-ok',
  colorWarning: '--emc2-color-warning',
  colorError: '--emc2-color-error',
  /** The dialog backdrop, the same in every look (looks.md: rgba(0,0,0,0.45)). */
  colorBackdrop: '--emc2-color-backdrop',
  /** SDK 1.8.0 (CR-0043 part B; ADR-0056 point 1): the line that tells a pane or panel from what is behind it, at least 3:1. */
  colorEdge: '--emc2-color-edge',
  /** SDK 1.8.0: the card look's quieter edge and frame (Settings and the Monitor; ADR-0056's second value). */
  colorEdgeCard: '--emc2-color-edge-card',
  /** SDK 1.8.0: a surface above the panel, such as a card, a menu or a tile. */
  colorRaised: '--emc2-color-raised',
  // Fonts and headings
  fontText: '--emc2-font-text',
  fontData: '--emc2-font-data',
  fontHeading: '--emc2-font-heading',
  /** A `text-transform` value: `uppercase` or `none`. */
  headingCase: '--emc2-heading-case',
  headingLetterSpacing: '--emc2-heading-letter-spacing',
  headingWeight: '--emc2-heading-weight',
  /** SDK 1.8.0 (CR-0043 part B; ADR-0056 point 1): a field label's font, the text or the data font. */
  fontLabel: '--emc2-font-label',
  /** SDK 1.8.0: a field label's `text-transform`: `uppercase` or `none`. */
  labelCase: '--emc2-label-case',
  labelLetterSpacing: '--emc2-label-letter-spacing',
  labelWeight: '--emc2-label-weight',
  // Shape
  /** The corner radius of panes, panels and cards. */
  radius: '--emc2-radius',
  /** SDK 1.8.0 (CR-0043 part B; ADR-0056 point 1): the corner radius of buttons, fields, chips, tabs and tiles. */
  radiusControl: '--emc2-radius-control',
  /** SDK 1.8.0: the width of edges, e.g. `1px` or `2px`. */
  edgeWidth: '--emc2-edge-width',
  shadowCard: '--emc2-shadow-card',
  shadowMenu: '--emc2-shadow-menu',
  /** The focus style: a 2 px outline in the accent colour, 2 px outside the element (ADR-0029 point 1, looks.md). */
  focusColor: '--emc2-focus-color',
  focusWidth: '--emc2-focus-width',
  focusOffset: '--emc2-focus-offset',
  // Plugin sizes of the density table (looks.md, "Density")
  sizeText: '--emc2-size-text',
  sizeTextSmall: '--emc2-size-text-small',
  sizeRow: '--emc2-size-row',
  sizeField: '--emc2-size-field',
  sizeIcon: '--emc2-size-icon',
  spacePadding: '--emc2-space-padding',
  spaceGap: '--emc2-space-gap',
} as const;

export type TokenName = keyof typeof TOKENS;

/** `var(--emc2-…)` for a token, for inline styles where a CSS file cannot reach. */
export function tokenVar(name: TokenName): string {
  return `var(${TOKENS[name]})`;
}

/** The SDK 1.0.0 tokens, which the shell keeps as aliases of the 1.1.0 ones, so plugins built for 1.0.0 keep their look. */
export const TOKEN_ALIASES: { readonly [oldProperty: string]: TokenName } = {
  '--shell-bg': 'colorGround',
  '--shell-fg': 'colorText',
  '--pane-border': 'colorBorder',
  '--control-pane-bg': 'colorPane',
  '--muted': 'colorMuted',
  '--ok': 'colorOk',
  '--warning': 'colorWarning',
  '--error': 'colorError',
  '--notification-bg': 'colorPanel',
};

export type Look = 'night-watch' | 'chart-room' | 'signal';
export type ColourScheme = 'light' | 'dark';
export type Density = 'compact' | 'comfortable';

/** The user's current look, as their setup holds it (ADR-0034). */
export interface ThemeState {
  readonly look: Look;
  readonly scheme: ColourScheme;
  readonly density: Density;
}

/**
 * The current look and the current token values (CR-0015 item 19), for what a plugin draws on canvas
 * (the map view's label text, cluster counts). CSS needs neither: `var(--emc2-…)` follows by itself.
 */
export interface Theme {
  readonly current: ThemeState;
  /** The current value of every token, e.g. `{ colorText: '#e3e8ef', sizeText: '12.5px', … }`. */
  tokens(): Readonly<Record<TokenName, string>>;
  /** Called after the look, light or dark, or the density changed; the tokens then have their new values. */
  onChange(listener: (state: ThemeState) => void): Unsubscribe;
}
