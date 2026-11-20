import { useEffect, useState } from 'react';
import type { CoordinateService, CurrentWorkspace, MapView, Position, SharedState } from '@emc2/plugin-sdk';
import type { Settings } from './settings.ts';
import { useSharedState } from './state.ts';

/** A Map Pane overlay: the position under the pointer, in the user's chosen format. */
export function CursorPosition(props: {
  readonly map: MapView;
  readonly service: CoordinateService;
  readonly settings: SharedState<Settings>;
  readonly workspace: CurrentWorkspace;
}) {
  const { map, service, workspace } = props;
  const format = useSharedState(service.chosenFormat);
  useSharedState(props.settings); // draws again when a precision setting changes
  const [position, setPosition] = useState<Position | null>(null);

  useEffect(
    () =>
      map.onPointer((event) => {
        setPosition(event.position);
      }),
    [map],
  );

  // The shell mounts the display again on a switch (SDK CurrentWorkspace), so it starts at "–". A
  // shell that kept it mounted would show a position on the other workspace's map; it shows "–" until
  // the pointer moves over the new one (owner, 2026-10-28; kept, 2026-10-29).
  useEffect(
    () =>
      workspace.onChange(() => {
        setPosition(null);
      }),
    [workspace],
  );

  return (
    <div className="coordinates-cursor" aria-label="Pointer position">
      {position === null ? '–' : service.format(position, format)}
    </div>
  );
}
