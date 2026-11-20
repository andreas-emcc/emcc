import { Select } from '@emc2/plugin-sdk';
import { useModel } from './model.ts';
import { ALTITUDE_UNITS, SPEED_UNITS } from './units.ts';
import type { UnitsModel } from './unitsModel.ts';

/** The user's speed and altitude units (brief function 8). Display only, so read-only users pick them too. */
export function UnitFields(props: { readonly units: UnitsModel }) {
  const units = useModel(props.units);
  return (
    <div className="simulator-units">
      <Select label="Speed unit" value={units.speed} options={SPEED_UNITS} onChange={(speed) => { props.units.set({ speed }); }} />
      <Select label="Altitude unit" value={units.altitude} options={ALTITUDE_UNITS} onChange={(altitude) => { props.units.set({ altitude }); }} />
    </div>
  );
}
