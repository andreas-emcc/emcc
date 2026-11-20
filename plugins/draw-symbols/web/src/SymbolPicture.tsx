import { useEffect, useMemo, useRef } from 'react';
import type { Modifiers, SymbolService, SymbolStandard } from '@emc2/plugin-sdk';

/**
 * A symbol as an image. The service's image is shared and read-only, so it is drawn onto this
 * component's own canvas.
 */
export function SymbolPicture(props: {
  readonly symbols: SymbolService;
  readonly standard: SymbolStandard;
  readonly sidc: string;
  readonly modifiers?: Modifiers | undefined;
  readonly size: number;
  readonly withText?: boolean;
  /** The accessible name, or null if the text next to the image already says it. */
  readonly label: string | null;
}) {
  const { symbols, standard, sidc, modifiers, size, withText, label } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useMemo(() => {
    try {
      return symbols.render({ standard, sidc, size, ...(modifiers !== undefined ? { modifiers } : {}), ...(withText === true ? { withText } : {}) });
    } catch {
      return null; // a size the service refuses: show the placeholder
    }
  }, [symbols, standard, sidc, modifiers, size, withText]);

  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context || !image) return;
    context.clearRect(0, 0, image.width, image.height);
    context.drawImage(image.image, 0, 0);
  }, [image]);

  const accessible = label === null ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label };
  if (!image) return <span className="draw-symbols-picture-missing" {...accessible}>?</span>;
  return <canvas ref={canvas} className="draw-symbols-picture" width={image.width} height={image.height} {...accessible} />;
}
