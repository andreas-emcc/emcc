import { useEffect, useMemo, useRef } from 'react';
import type { MilSymbol, SymbolService } from '@emc2/plugin-sdk';

/**
 * The symbol of a row as a small image (brief, function 4). The service's image is shared and
 * read-only, so it is drawn onto this component's own canvas. A symbol the service cannot draw leaves
 * the cell empty; the name beside it says what the object is.
 */
export function RowImage(props: { readonly symbols: SymbolService; readonly symbol: MilSymbol; readonly size: number }) {
  const { symbols, symbol, size } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useMemo(() => {
    try {
      return symbols.render({ standard: symbol.standard, sidc: symbol.sidc, size, ...(symbol.modifiers !== undefined ? { modifiers: symbol.modifiers } : {}) });
    } catch {
      return null;
    }
  }, [symbols, symbol, size]);

  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context || !image) return;
    context.clearRect(0, 0, image.width, image.height);
    context.drawImage(image.image, 0, 0);
  }, [image]);

  if (!image) return null;
  return <canvas ref={canvas} className="object-list-image" width={image.width} height={image.height} aria-hidden="true" />;
}
