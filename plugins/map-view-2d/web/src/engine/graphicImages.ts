/**
 * The images inside tactical graphics, decoded (brief function 37; SDK 1.5.0 part 2). An `svg` is the
 * source of an image element and nothing else: the main thread decodes it (a worker cannot), never as
 * markup in the page, and the same `svg` text is decoded once, however many graphics carry it. While
 * it decodes the graphic draws without it; when it is ready, `onReady` asks for a redraw. The source is
 * always a `data:image/svg+xml` URI (checked in `core/graphicImages.ts`), so no request leaves the page.
 */
import { isSvgDataUri } from '../core/graphicImages.ts';

/** The most different `svg` texts kept; the oldest go first. */
const MAX_KEPT = 256;

type Entry = { readonly image: HTMLImageElement; state: 'loading' | 'ready' | 'failed' };

export class GraphicImageCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly onReady: () => void,
    private readonly createImage: () => HTMLImageElement = () => new Image(),
  ) {}

  /** The decoded image, or null while it decodes, when it failed, or when `svg` is not an SVG data URI (no request is made for that). */
  get(svg: string): HTMLImageElement | null {
    if (!isSvgDataUri(svg)) return null;
    const known = this.entries.get(svg);
    if (known !== undefined) return known.state === 'ready' ? known.image : null;
    const image = this.createImage();
    const entry: Entry = { image, state: 'loading' };
    image.onload = () => {
      entry.state = 'ready';
      this.onReady();
    };
    image.onerror = () => {
      entry.state = 'failed';
    };
    this.entries.set(svg, entry);
    if (this.entries.size > MAX_KEPT) {
      const oldest = this.entries.keys().next();
      if (oldest.done !== true) this.entries.delete(oldest.value);
    }
    image.src = svg;
    return null;
  }

  /** How many different `svg` texts are held (tests). */
  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
