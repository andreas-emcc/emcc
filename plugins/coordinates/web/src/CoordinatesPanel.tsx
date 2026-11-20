import { useEffect, useId, useState } from 'react';
import { LocateFixed } from 'lucide-react';
import { Button, Notice, Select, type CoordinateFormat, type CoordinateService, type CurrentWorkspace, type MapView, type SharedState } from '@emc2/plugin-sdk';
import { distanceMetres } from './distance.ts';
import { FORMATS, type Settings } from './settings.ts';
import { useSharedState } from './state.ts';

/** A centre within a metre of the requested point is the point: projecting there and back moves it far less. */
const SAME_PLACE_METRES = 1;

const FORMAT_NAMES: Readonly<Record<CoordinateFormat, string>> = {
  dms: 'Degrees, minutes, seconds (DMS)',
  dd: 'Decimal degrees (DD)',
  utm: 'UTM/UPS',
  mgrs: 'MGRS',
};

const FORMAT_OPTIONS = FORMATS.map((f) => ({ value: f, label: FORMAT_NAMES[f] }));

type Outcome = { readonly kind: 'error' | 'done'; readonly text: string } | null;

/**
 * The window's content (brief function 8): the display format, and "go to" a typed position.
 * The controls are the SDK's shared components, except the "go to" field: it keeps the browser's
 * spell check off, which the SDK's TextField cannot (owner, 2026-10-21), and looks like it.
 */
export function CoordinatesPanel(props: {
  readonly service: CoordinateService;
  readonly mapView: SharedState<MapView | null>;
  readonly settings: SharedState<Settings>;
  readonly workspace: CurrentWorkspace;
}) {
  const { service, workspace } = props;
  const format = useSharedState(service.chosenFormat);
  useSharedState(props.settings); // the example in the field follows the precision settings
  const map = useSharedState(props.mapView);
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState<Outcome>(null);
  const inputId = useId();

  // The shell mounts the window again on a switch (SDK CurrentWorkspace), so it starts empty. A shell
  // that kept it mounted would show a message about the other workspace's map, as each workspace has
  // its own map state; the message goes, the typed text stays (owner, 2026-10-28; kept, 2026-10-29).
  useEffect(
    () =>
      workspace.onChange(() => {
        setOutcome(null);
      }),
    [workspace],
  );

  const goTo = () => {
    if (map === null) return;
    const result = service.parse(text);
    if ('error' in result) {
      setOutcome({ kind: 'error', text: result.error });
      return;
    }
    map.goTo(result.position);
    // The map view centres on the nearest point its projection can show, and its viewport gives that
    // centre as soon as goTo returns (map-view-2d README; owner, 2026-10-12). Report where the map went.
    const shown = map.viewport.center;
    const requested = service.format(result.position, format);
    setOutcome({
      kind: 'done',
      text:
        distanceMetres(shown, result.position) <= SAME_PLACE_METRES
          ? `Centred on ${requested}`
          : `Centred on ${service.format(shown, format)}, the nearest point this map (${map.viewport.projection}) can show to ${requested}`,
    });
  };

  return (
    <div className="coordinates-panel">
      <div className="coordinates-controls">
        <Select
          label="Format"
          value={format}
          options={FORMAT_OPTIONS}
          onChange={(value) => {
            service.chosenFormat.set(value);
          }}
        />
        <form
          className="coordinates-goto"
          onSubmit={(event) => {
            event.preventDefault();
            goTo();
          }}
        >
          <div className="coordinates-field">
            <label className="coordinates-label" htmlFor={inputId}>
              Go to
            </label>
            <input
              id={inputId}
              className="coordinates-input"
              type="text"
              value={text}
              placeholder={service.format([15.654321, 60.123456], format)}
              spellCheck={false}
              aria-invalid={outcome?.kind === 'error' ? true : undefined}
              onChange={(event) => {
                setText(event.target.value);
                setOutcome(null);
              }}
            />
          </div>
          <Button type="submit" variant="primary" icon={LocateFixed} disabled={map === null}>
            Go
          </Button>
        </form>
      </div>
      {map === null && <Notice severity="warning">The map view is not available.</Notice>}
      {outcome?.kind === 'error' && <Notice severity="error">{outcome.text}</Notice>}
      {outcome?.kind === 'done' && <Notice>{outcome.text}</Notice>}
    </div>
  );
}
