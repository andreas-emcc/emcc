/**
 * The width of a text as the browser draws it (SN A, owner, 2026-11-12): a text object is picked and highlighted on a box
 * that fits its text, so a long text, a narrow one ("iii") and a wide or non-ASCII one ("WWW", "日本語", "ÅÄÖ") all
 * have the box they are drawn in. The width comes from the canvas' `measureText` in the very font the text is drawn in
 * and is kept per font and line, because a pick asks for it at every pointer move over the map.
 */

/** A 2D canvas context as far as measuring goes. */
export interface MeasuringContext {
  font: string;
  measureText(text: string): { readonly width: number };
}

/** How many measured lines are kept; the cache starts over when it is full (a map has few text objects, a long session many texts). */
export const MEASURE_CACHE_LIMIT = 2000;

/** The width of a character in em when the browser cannot measure (no 2D canvas): a guess, as before SN A. */
export const ESTIMATED_EM_PER_CHARACTER = 0.6;

export class TextMeter {
  private readonly cache = new Map<string, number>();
  private context: MeasuringContext | null | undefined;

  /** `createContext` gives a 2D context (null where the browser has none). */
  constructor(private readonly createContext: () => MeasuringContext | null) {}

  /** The width in pixels of the widest line of `text` in `font` (a CSS font shorthand with its size in pixels, `size` as well). */
  width(text: string, font: string, size: number): number {
    let widest = 0;
    for (const line of text.split('\n')) widest = Math.max(widest, this.line(line, font, size));
    return widest;
  }

  /** Forgets the measured widths, for when a font has arrived that was not there when they were measured. */
  clear(): void {
    this.cache.clear();
  }

  private line(line: string, font: string, size: number): number {
    const key = `${font}\n${line}`;
    const known = this.cache.get(key);
    if (known !== undefined) return known;
    const context = this.contextNow();
    let width = Number.NaN;
    if (context !== null) {
      context.font = font;
      width = context.measureText(line).width;
    }
    // A browser that measures nothing (no canvas; or a width that is not a number) gets the guess, which is not kept.
    if (!Number.isFinite(width)) return Array.from(line).length * size * ESTIMATED_EM_PER_CHARACTER;
    if (this.cache.size >= MEASURE_CACHE_LIMIT) this.cache.clear();
    this.cache.set(key, width);
    return width;
  }

  private contextNow(): MeasuringContext | null {
    if (this.context === undefined) {
      try {
        this.context = this.createContext();
      } catch {
        this.context = null;
      }
    }
    return this.context;
  }
}
