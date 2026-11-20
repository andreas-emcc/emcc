/**
 * The layer pickers' "+" (SDK 1.4.0, CR-0030 part 1a; ADR-0037 point 2 as noted, T-133): creates a
 * layer in View at once, on top of View's layers, with the server's default label, as `core-shell`
 * with the admin's own permission, and answers it with its id, so that the picker saves it picked
 * with its id. Without `layers.edit` the pickers offer no "+" (the ACA's R6); the server checks it
 * anyway (overview 4.4).
 *
 * SDK 1.5.0 part 4 (T-133 with T-171; owner Q46 A, A4): the dialog offers the default label's
 * policy's classifications ({@link LayerCreator.classifications}), and the layer gets the default
 * label with the chosen one, every other part unchanged. Labels stay cosmetic (owner, 2026-11-10).
 */
import {
  changeRequests, classificationOrder, PERMISSIONS, uuidv7, VIEW_WORKSPACE, type ClassificationOrders, type SecurityLabel, type User, type Uuid,
} from '@emc2/plugin-sdk';
import { send, type Submitter } from '../actions/batch.ts';
import type { KnownLayers } from './known.ts';

/** The longest name of a layer (`LayerContent`). */
const MAX_NAME = 256;

export type Created = { readonly ok: true; readonly id: Uuid; readonly name: string } | { readonly ok: false; readonly reason: string };

export interface LayerCreatorOptions {
  /** The logged-in user, once the configuration has arrived. */
  readonly user: () => User;
  readonly layers: KnownLayers;
  /** The server's default label (`/api/config`), once it has arrived. */
  readonly label: () => SecurityLabel | null;
  /** SDK 1.5.0 part 4: each policy's classifications, lowest first (`/api/config`); `{}` before it arrives. */
  readonly orders?: () => ClassificationOrders;
  readonly connection: Submitter;
}

export class LayerCreator {
  constructor(private readonly options: LayerCreatorOptions) {}

  /** Whether the user may create a layer in View: `layers.edit`. */
  get allowed(): boolean {
    return this.options.user().has(PERMISSIONS.layersEdit);
  }

  /**
   * What the dialog's "Classification" offers: the default label's policy's order (its name ignoring
   * case), lowest first, and the default's classification; null without an order or with the
   * default's classification outside it, and then the dialog has no select (as T-171's).
   */
  classifications(): { readonly order: readonly string[]; readonly chosen: string } | null {
    const label = this.options.label();
    if (label === null) return null;
    const order = classificationOrder(this.options.orders?.() ?? {}, label.policyIdentifier.name);
    return order.includes(label.classification) ? { order, chosen: label.classification } : null;
  }

  /**
   * Creates a layer named `name` in View, on top, with the default label, or with its
   * `classification` when given (one of {@link classifications}); answers its id, or why not.
   */
  async create(name: string, classification?: string): Promise<Created> {
    const trimmed = name.trim();
    if (trimmed === '') return { ok: false, reason: 'Name the new layer.' };
    if (trimmed.length > MAX_NAME) return { ok: false, reason: `At most ${String(MAX_NAME)} characters.` };
    const given = this.options.label();
    if (given === null) return { ok: false, reason: 'The server\'s configuration has not arrived yet; try again.' };
    const offered = this.classifications();
    if (classification !== undefined && offered?.order.includes(classification) !== true) {
      return { ok: false, reason: `${classification} is not a classification of ${given.policyIdentifier.name}.` };
    }
    const label: SecurityLabel = classification === undefined ? given : { ...given, classification };
    const known = this.options.layers;
    const inView = known.getState().layers.filter((l) => (known.workspaceOf(l.id) ?? VIEW_WORKSPACE) === VIEW_WORKSPACE);
    const top = inView.reduce((most, l) => Math.max(most, l.drawOrder), Number.NEGATIVE_INFINITY);
    const id = uuidv7();
    const sent = await send(this.options.connection, changeRequests.createLayer(id, {
      name: trimmed, drawOrder: Number.isFinite(top) ? top + 1 : 0, visible: true, label, extensions: {},
    }), 'it may have been created');
    return sent.ok ? { ok: true, id, name: trimmed } : { ok: false, reason: `The layer was not created: ${sent.reason}.` };
  }
}
