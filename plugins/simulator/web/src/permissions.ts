// The simulator's permissions (the manifest; brief, "Permissions"). The panels use them to show
// read-only panels and disabled controls (function 23; A32); the server checks every command and
// change anyway (overview 4.4).
export const VIEW = 'plugin.simulator.view';
export const EDIT = 'plugin.simulator.edit';
export const RUN = 'plugin.simulator.run';

export const EDIT_HINT = 'You may not change the simulation';
export const RUN_HINT = 'You may not start, pause or reset the simulation';

/** A route in a locked layer is read only (brief function 25, A81). */
export const lockedHint = (layerName: string): string => `Layer "${layerName}" is locked`;

/** What the user may do, fixed for the session (ADR-0022). */
export interface Rights {
  readonly edit: boolean;
  readonly run: boolean;
}
