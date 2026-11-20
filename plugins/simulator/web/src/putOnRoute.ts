// "Put on route" and "Take off route" (brief function 10; A28, A29): object actions in Simulation
// that send the server part's commands. "Put on route" opens a small dialog over the map's right edge
// (from M4, A68) to pick the route, the kind and a convoy's spacing; "Take off route" sends at once.
import { parseFieldNumber } from '@emc2/plugin-sdk';
import type { Notification, Unsubscribe, Uuid } from '@emc2/plugin-sdk';
import { Model } from './model.ts';
import type { Failure } from './model.ts';
import type { SimulationPicture } from './picture.ts';
import type { SimulatorServer } from './server.ts';

export type GroupKind = 'single' | 'convoy' | 'formation';

/** The server part's limits on a convoy's spacing, in metres (the plugin's README, "The route's extension"). */
export const MIN_SPACING = 1;
export const MAX_SPACING = 100_000;
/** A28. */
export const DEFAULT_SPACING = '50';

export interface PutState {
  /** Whether the dialog is open. */
  readonly open: boolean;
  readonly objects: readonly Uuid[];
  readonly route: Uuid | null;
  readonly kind: GroupKind;
  /** As typed, in metres. */
  readonly spacing: string;
  readonly failure: Failure | null;
  readonly busy: boolean;
}

export class PutOnRouteModel extends Model<PutState> {
  private remove: Unsubscribe | null = null;

  constructor(
    private readonly server: SimulatorServer,
    private readonly picture: SimulationPicture,
    /** Adds the dialog over the map and returns what removes it; called each time it opens. */
    private readonly addDialog: () => Unsubscribe,
  ) {
    super({ open: false, objects: [], route: null, kind: 'single', spacing: DEFAULT_SPACING, failure: null, busy: false });
  }

  /** From the object action: the chosen objects. The route chosen last stays chosen while it exists. */
  open(objects: readonly Uuid[]): void {
    const routes = this.picture.routes();
    const kept = this.getState().route;
    const route = routes.some((r) => r.object.id === kept) ? kept : (routes[0]?.object.id ?? null);
    this.update({ open: true, objects, route, failure: null, busy: false });
    this.remove ??= this.addDialog();
  }

  close(): void {
    this.remove?.();
    this.remove = null;
    this.update({ open: false, objects: [], failure: null, busy: false });
  }

  dismissFailure(): void {
    this.update({ failure: null });
  }

  setRoute(route: Uuid): void {
    this.update({ route });
  }

  setKind(kind: GroupKind): void {
    this.update({ kind });
  }

  setSpacing(spacing: string): void {
    this.update({ spacing });
  }

  /** Why the spacing cannot be sent, or null; only a convoy has one. */
  spacingProblem(): string | null {
    const { kind, spacing } = this.getState();
    if (kind !== 'convoy') return null;
    const value = parseFieldNumber(spacing);
    if (value === null) return 'Type the spacing';
    if (!Number.isFinite(value)) return 'The spacing must be a number';
    if (value < MIN_SPACING || value > MAX_SPACING) return `The spacing must be from ${String(MIN_SPACING)} to ${String(MAX_SPACING)} m`;
    return null;
  }

  /** Why the dialog cannot send, or null. */
  problem(): string | null {
    const { route, objects } = this.getState();
    if (objects.length === 0) return 'No objects chosen';
    if (route === null || !this.picture.routes().some((r) => r.object.id === route)) return 'Choose a route';
    return this.spacingProblem();
  }

  async submit(): Promise<void> {
    if (this.problem() !== null || this.getState().busy) return;
    const { route, kind, spacing, objects } = this.getState();
    const body = kind === 'convoy' ? { route, kind, spacing: parseFieldNumber(spacing), objects } : { route, kind, objects };
    this.update({ busy: true, failure: null });
    const answer = await this.server.post('put-on-route', body);
    if (answer.ok) {
      this.close();
      return;
    }
    this.update({ busy: false, failure: { message: answer.message, retry: answer.retry ? () => void this.submit() : null } });
  }
}

/** "Take off route": sends at once; a failure is shown as a notification, since no dialog is open. */
export async function takeOffRoute(server: SimulatorServer, objects: readonly Uuid[], notify: (n: Notification) => void): Promise<void> {
  const answer = await server.post('take-off-route', { objects });
  if (!answer.ok) notify({ severity: 'error', message: `Take off route: ${answer.message}` });
}
