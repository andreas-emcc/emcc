// The picture on a Graphics tile (T-204): the graphic drawn small through sample points by the symbology
// service, or its kind's icon while it loads, when it does not draw, and when the browser cannot tell that
// the tile is in view. It asks only once the tile is near the screen, so a long "All graphics" list does not
// start hundreds of drawings at once.
import { useEffect, useRef, useState } from 'react';
import { CircleDot, MoveUpRight, Pentagon, Route } from 'lucide-react';
import { Icon } from '@emc2/plugin-sdk';
import type { GraphicCatalogEntry } from '@emc2/plugin-sdk';
import type { GraphicsController } from './controller.ts';
import { THUMB_HEIGHT, THUMB_WIDTH } from './thumb.ts';
import type { ThumbModel } from './thumb.ts';

/** How far outside the screen a tile still counts as near, so that its picture is there when it scrolls in. */
const NEAR_MARGIN = '120px';

const KIND_ICONS = { line: Route, area: Pentagon, arrow: MoveUpRight, points: CircleDot } as const;

/**
 * The paper the graphic is drawn on: APP-6's colours are made for a light ground, so a tile's picture is a light
 * patch in every look, as the map's own drawing is the same in every look (ADR-0034). It is the drawing's ground,
 * not a colour of the look.
 */
const PAPER = '#f4f1e6';

export function GraphicThumb(props: { readonly controller: GraphicsController; readonly entry: GraphicCatalogEntry }) {
  const { controller, entry } = props;
  const holder = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
  // The picture belongs to the graphic it was drawn for, so a tile that gets another graphic shows its icon until that one is drawn.
  const [drawn, setDrawn] = useState<{ readonly entry: GraphicCatalogEntry; readonly model: ThumbModel | null } | null>(null);
  const model = drawn !== null && drawn.entry === entry ? drawn.model : null;

  useEffect(() => {
    const node = holder.current;
    if (near || node === null || typeof IntersectionObserver === 'undefined') return undefined;
    const watcher = new IntersectionObserver(
      (seen) => {
        if (seen.some((s) => s.isIntersecting)) setNear(true);
      },
      { rootMargin: NEAR_MARGIN },
    );
    watcher.observe(node);
    return () => {
      watcher.disconnect();
    };
  }, [near]);

  useEffect(() => {
    if (!near) return undefined;
    let live = true;
    void controller.thumb(entry).then((picture) => {
      if (live) setDrawn({ entry, model: picture });
    });
    return () => {
      live = false;
    };
  }, [near, controller, entry]);

  return (
    <span ref={holder} className="draw-tactical-thumb">
      {model === null ? (
        <Icon icon={KIND_ICONS[entry.kind]} />
      ) : (
        <svg className="draw-tactical-thumb-picture" viewBox={`0 0 ${String(THUMB_WIDTH)} ${String(THUMB_HEIGHT)}`} aria-hidden="true" focusable="false">
          <rect width={THUMB_WIDTH} height={THUMB_HEIGHT} fill={PAPER} />
          {model.fills.map((f, i) => (
            <path key={`f${String(i)}`} d={f.d} fill={f.color} fillOpacity={f.hatch ? Math.min(f.opacity, 0.35) : f.opacity} fillRule="evenodd" />
          ))}
          {model.lines.map((l, i) => (
            <path
              key={`l${String(i)}`}
              d={l.d}
              fill="none"
              stroke={l.color}
              strokeOpacity={l.opacity}
              strokeWidth={l.width}
              strokeDasharray={l.dash ?? undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {model.labels.map((l, i) => (
            <text
              className="draw-tactical-thumb-label"
              key={`t${String(i)}`}
              x={l.x}
              y={l.y}
              fill={l.color}
              fontSize={l.size}
              textAnchor={l.anchor}
              dominantBaseline="central"
              transform={l.angle === 0 ? undefined : `rotate(${String(l.angle)} ${String(l.x)} ${String(l.y)})`}
            >
              {l.text}
            </text>
          ))}
        </svg>
      )}
    </span>
  );
}
