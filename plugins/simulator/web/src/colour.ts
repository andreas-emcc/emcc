// The routes' colour (T-088; the owner's BE a, Q17 and A62): one colour for every route, shared by
// every user because it is each route object's `style.strokeColor`, changed through change requests.
// The colour shown is the routes' own; with no routes yet, a choice is kept here for the next new
// route drawn in this browser.
import { changeRequests, OutcomeUnknownError } from '@emc2/plugin-sdk';
import type { Changes } from '@emc2/plugin-sdk';
import { DEFAULT_ROUTE_COLOUR } from './editor.ts';
import { Model } from './model.ts';
import type { Failure } from './model.ts';
import type { SimulationPicture } from './picture.ts';
import { contentOf, rejectionMessage } from './routes.ts';

const HEX = /^#[0-9a-f]{6}$/;

export interface ColourState {
  readonly busy: boolean;
  readonly failure: Failure | null;
  /** The colour chosen while there were no routes. */
  readonly chosen: string | null;
}

export class RouteColourModel extends Model<ColourState> {
  constructor(
    private readonly picture: SimulationPicture,
    private readonly changes: Changes,
  ) {
    super({ busy: false, failure: null, chosen: null });
  }

  /** The routes' colour: the most common one when they differ; with no routes, the one chosen, or the default. */
  readonly colour = (): string => {
    const counts = new Map<string, number>();
    for (const route of this.picture.routes()) {
      const colour = route.object.style?.strokeColor?.toLowerCase();
      if (colour !== undefined && HEX.test(colour)) counts.set(colour, (counts.get(colour) ?? 0) + 1);
    }
    let best: string | null = null;
    for (const [colour, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = colour;
    return best ?? this.getState().chosen ?? DEFAULT_ROUTE_COLOUR;
  };

  /** Gives every route `colour`: one update per route of another colour, one after another (A62). */
  async choose(colour: string): Promise<void> {
    const wanted = colour.toLowerCase();
    if (!HEX.test(wanted)) return;
    this.update({ busy: true, failure: null, chosen: wanted });
    let failed = 0;
    let first: string | null = null;
    const routes = this.picture.routes().filter((r) => r.object.style?.strokeColor?.toLowerCase() !== wanted);
    for (const { object: route } of routes) {
      try {
        const outcome = await this.changes.submit(changeRequests.updateObject(route, { ...contentOf(route), style: { ...route.style, strokeColor: wanted } }));
        if (outcome.outcome === 'applied') continue;
        first ??= rejectionMessage(outcome.rejection.code, outcome.rejection.message);
      } catch (e) {
        first ??= e instanceof OutcomeUnknownError ? 'No answer from the server; the change may have been made' : `The change failed: ${String(e)}`;
      }
      failed++;
    }
    const failure = first === null ? null : { message: `${String(failed)} of ${String(routes.length)} routes kept their colour: ${first}`, retry: () => void this.choose(wanted) };
    this.update({ busy: false, failure });
  }

  dismissFailure(): void {
    this.update({ failure: null });
  }
}
