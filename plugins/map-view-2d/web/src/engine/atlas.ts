/**
 * The sprite atlas of symbol images for the WebGL layers (spike S2): every appearance is drawn
 * once into one canvas; a feature only carries its offset, size and anchor in it. The atlas grows
 * downwards, so entries keep their place.
 */
import type { SymbolImage } from '@emc2/plugin-sdk';

export interface AtlasEntry {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The anchor (the pixel at the object's position) inside the image. */
  readonly ax: number;
  readonly ay: number;
}

const PADDING = 1;

/** Places rectangles in rows (shelves) of a fixed width. */
export class ShelfPacker {
  private shelfY = 0;
  private shelfHeight = 0;
  private cursorX = 0;

  constructor(
    readonly width: number,
    readonly maxHeight: number,
  ) {}

  /** The top left corner for a w × h rectangle, or null if it does not fit any more. */
  place(w: number, h: number): { x: number; y: number } | null {
    const pw = Math.ceil(w) + PADDING;
    const ph = Math.ceil(h) + PADDING;
    if (pw > this.width) return null;
    if (this.cursorX + pw > this.width) {
      this.shelfY += this.shelfHeight;
      this.shelfHeight = 0;
      this.cursorX = 0;
    }
    if (this.shelfY + ph > this.maxHeight) return null;
    const spot = { x: this.cursorX, y: this.shelfY };
    this.cursorX += pw;
    this.shelfHeight = Math.max(this.shelfHeight, ph);
    return spot;
  }

  /** The height used so far. */
  get height(): number {
    return this.shelfY + this.shelfHeight;
  }
}

export class SymbolAtlas {
  private readonly packer: ShelfPacker;
  private readonly entries = new Map<string, AtlasEntry | null>();
  /** The `version` each entry came in with: the atlas image of that version or a later one holds it (T-200). */
  private readonly stamps = new Map<string, number>();
  private canvas: HTMLCanvasElement;
  private cachedUrl: string | null = null;
  /** Increases with every added entry. */
  version = 0;

  constructor(
    private readonly createCanvas: () => HTMLCanvasElement,
    width = 2048,
    maxHeight = 4096,
  ) {
    this.packer = new ShelfPacker(width, maxHeight);
    this.canvas = this.sized(width, 256);
  }

  /** The entry of an appearance: undefined if not tried yet, null if it could not be added. */
  get(key: string): AtlasEntry | null | undefined {
    return this.entries.get(key);
  }

  /** Adds an image under a key; null if the atlas is full (the symbol is then drawn as a marker). */
  add(key: string, image: SymbolImage): AtlasEntry | null {
    const spot = this.packer.place(image.width, image.height);
    if (spot === null) {
      this.entries.set(key, null);
      return null;
    }
    if (this.packer.height > this.canvas.height) this.grow();
    this.canvas.getContext('2d')?.drawImage(image.image, spot.x, spot.y);
    const entry: AtlasEntry = { x: spot.x, y: spot.y, w: image.width, h: image.height, ax: image.anchor[0], ay: image.anchor[1] };
    this.entries.set(key, entry);
    this.version++;
    this.stamps.set(key, this.version);
    this.cachedUrl = null;
    return entry;
  }

  /** The version of the atlas image that first holds an entry; 0 for a key that has none. */
  stampOf(key: string): number {
    return this.stamps.get(key) ?? 0;
  }

  /** Remembers that an appearance cannot be drawn (e.g. the SymbolService refused it). */
  refuse(key: string): void {
    this.entries.set(key, null);
  }

  /** The atlas as an image URL for the WebGL style (`data:` is allowed by the CSP for images). */
  url(): string {
    this.cachedUrl ??= this.canvas.toDataURL('image/png');
    return this.cachedUrl;
  }

  get isEmpty(): boolean {
    return this.version === 0;
  }

  private grow(): void {
    let height = this.canvas.height;
    while (height < this.packer.height) height *= 2;
    const bigger = this.sized(this.canvas.width, Math.min(height, this.packer.maxHeight));
    bigger.getContext('2d')?.drawImage(this.canvas, 0, 0);
    this.canvas = bigger;
  }

  private sized(width: number, height: number): HTMLCanvasElement {
    const canvas = this.createCanvas();
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
}

/**
 * A symbol's image with text, without the symbol itself: what is left is the text. It is drawn on
 * the text layer above all object layers, while the symbol stays on its own layer's WebGL layer,
 * so the layer order decides which symbols lie on top (T-087). A faded symbol's text is drawn at
 * its opacity, so the symbol is faded once and its text alike (brief function 13). The two images
 * are aligned at their anchors.
 */
export function textOnly(createCanvas: () => HTMLCanvasElement, withText: SymbolImage, plain: SymbolImage): SymbolImage {
  const canvas = createCanvas();
  canvas.width = withText.width;
  canvas.height = withText.height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return withText;
  ctx.drawImage(withText.image, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(plain.image, withText.anchor[0] - plain.anchor[0], withText.anchor[1] - plain.anchor[1]);
  return { image: canvas, width: withText.width, height: withText.height, anchor: withText.anchor };
}

/**
 * The direction-of-movement arrow, pointing up, as an image: a dark line with a head and a light
 * halo so it shows on any background. The anchor is the bottom centre (the arrow's start).
 */
export function arrowImage(createCanvas: () => HTMLCanvasElement, length: number): { canvas: HTMLCanvasElement; anchor: readonly [number, number] } {
  const width = 12;
  const canvas = createCanvas();
  canvas.width = width;
  canvas.height = Math.ceil(length);
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    const cx = width / 2;
    const draw = (color: string, lineWidth: number) => {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, length - 1);
      ctx.lineTo(cx, 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, 1);
      ctx.lineTo(cx - 5, 10);
      ctx.lineTo(cx + 5, 10);
      ctx.closePath();
      ctx.fill();
    };
    draw('rgba(255, 255, 255, 0.85)', 4);
    draw('#000000', 2);
  }
  return { canvas, anchor: [width / 2, Math.ceil(length)] };
}

/** The hatch tile's size in CSS pixels: 45° lines about 8 px apart (11 / √2). */
export const HATCH_TILE = 11;
export const HATCH_LINE_WIDTH = 1.5;

/**
 * The tile of a hatched fill (data model 1.1.0 `fillPattern: 'hatch'`): white 45° lines on
 * transparent, which the WebGL fill tints with the shape's fill colour and opacity. It repeats
 * without seams and is laid out in screen pixels, so the lines look the same at every zoom
 * (owner, 2026-10-16).
 */
export function hatchImage(createCanvas: () => HTMLCanvasElement): HTMLCanvasElement {
  const size = HATCH_TILE;
  const canvas = createCanvas();
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = HATCH_LINE_WIDTH;
    ctx.beginPath();
    // From bottom left to top right; the pieces in two corners continue the neighbours' lines.
    for (const offset of [-size, 0, size]) {
      ctx.moveTo(offset, size);
      ctx.lineTo(offset + size, 0);
    }
    ctx.stroke();
  }
  return canvas;
}

/** The arrowhead image's size in CSS pixels; the WebGL style scales it to the line's width. */
export const ARROWHEAD = { length: 48, width: 34 } as const;

/**
 * The arrowhead at a line's last point (data model 1.1.0 `arrowhead: 'end'`): a white triangle
 * pointing up with its tip at the top centre, which the WebGL style tints with the line's colour,
 * turns along the last segment and scales with the line width (owner, 2026-10-16).
 */
export function arrowheadImage(createCanvas: () => HTMLCanvasElement): HTMLCanvasElement {
  const canvas = createCanvas();
  canvas.width = ARROWHEAD.width;
  canvas.height = ARROWHEAD.length;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(ARROWHEAD.width / 2, 0);
    ctx.lineTo(ARROWHEAD.width, ARROWHEAD.length);
    ctx.lineTo(0, ARROWHEAD.length);
    ctx.closePath();
    ctx.fill();
  }
  return canvas;
}

/**
 * Loads and decodes images, so that a WebGL style that names them next finds them ready (T-200): OpenLayers makes a new
 * `Image` for each `icon-src` at every `setStyle` and draws nothing of it until it has loaded, but a browser gives an image
 * it has decoded already for the same URL at once. Resolves when all are decoded, or when one cannot be (the style is
 * swapped then all the same). null where the browser has no `decode` (a test's DOM): nothing to wait for.
 */
export function loadImages(urls: readonly string[]): Promise<void> | null {
  if (typeof Image === 'undefined' || !('decode' in Image.prototype)) return null;
  const images = urls.map((url) => {
    const image = new Image();
    image.crossOrigin = 'anonymous'; // as OpenLayers asks, so the browser's cache key is the same
    image.src = url;
    return image;
  });
  return Promise.all(images.map((image) => image.decode())).then(() => {
    images.length = 0; // held until now, so that none is dropped from the cache before the style uses it
  });
}

/** A new canvas element, for the engine's images. */
export function createCanvas(): HTMLCanvasElement {
  return document.createElement('canvas');
}
