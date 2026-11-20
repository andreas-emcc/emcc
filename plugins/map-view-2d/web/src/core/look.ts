/**
 * What the map view writes on canvas in the look's colours and fonts (brief function 21, ADR-0034):
 * shape labels and the counts on clusters. CSS follows the tokens by itself; the canvas reads their
 * values and is drawn again when the look, light or dark, or the density changes. The sizes stay the
 * map view's own (the density does not change symbols or labels), and the affiliation colours and
 * the selection highlight stay fixed.
 */
import type { TokenName } from '@emc2/plugin-sdk';
import type { Rgba } from './appearance.ts';

export interface TextLook {
  /** The text: the look's text colour. */
  readonly text: Rgba;
  /** The halo round the text: the look's ground colour, so the text stands out from any map. */
  readonly halo: Rgba;
  /** Shape labels: the look's text font. */
  readonly font: string;
  /** Cluster counts: the look's data font (looks.md: counts are data). */
  readonly dataFont: string;
}

/** Until the shell's tokens are read: dark text on a white halo, as before the looks. */
export const DEFAULT_TEXT_LOOK: TextLook = { text: [26, 26, 26, 1], halo: [255, 255, 255, 1], font: 'sans-serif', dataFont: 'monospace' };

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i;

/**
 * A token's colour as the shell's CSS gives it: `#rgb` (the built CSS shortens `#111111`; review
 * finding 1, part F2), `#rrggbb`, `rgb(…)` or `rgba(…)`. Null for anything else.
 */
export function tokenColour(value: string): Rgba | null {
  const text = value.trim();
  if (HEX.test(text)) {
    const digits = text.length === 4 ? text.slice(1).replace(/./g, '$&$&') : text.slice(1);
    const n = Number.parseInt(digits, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const match = RGB.exec(text);
  if (match === null) return null;
  const [r, g, b] = [match[1], match[2], match[3]].map(Number);
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if ([r, g, b].some((v) => v === undefined || v > 255) || !Number.isFinite(alpha)) return null;
  return [r ?? 0, g ?? 0, b ?? 0, Math.min(1, Math.max(0, alpha))];
}

/** The text look from the current token values; a colour it cannot read or an empty font keeps the default. */
export function textLookFrom(tokens: Readonly<Record<TokenName, string>>): TextLook {
  const colour = (value: string, fallback: Rgba): Rgba => tokenColour(value) ?? fallback;
  const font = (value: string, fallback: string): string => (value.trim() === '' ? fallback : value.trim());
  return {
    text: colour(tokens.colorText, DEFAULT_TEXT_LOOK.text),
    halo: colour(tokens.colorGround, DEFAULT_TEXT_LOOK.halo),
    font: font(tokens.fontText, DEFAULT_TEXT_LOOK.font),
    dataFont: font(tokens.fontData, DEFAULT_TEXT_LOOK.dataFont),
  };
}

/** Whether two text looks draw the same, so a change of density alone draws nothing again. */
export function sameTextLook(a: TextLook, b: TextLook): boolean {
  return a.font === b.font && a.dataFont === b.dataFont && a.text.every((v, i) => v === b.text[i]) && a.halo.every((v, i) => v === b.halo[i]);
}
