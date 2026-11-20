/**
 * The order of each security policy's classifications, lowest first, from the server's
 * configuration (`classificationOrders` in `GET /api/config`; ADR-0031 point 3). "Lower" means
 * earlier in the label's own policy's order; a label of a policy without an order, or with a
 * classification outside it, has no place in any order.
 */
import type { SecurityLabel } from '@emc2/plugin-sdk';

/** Policy name → its classifications, lowest first. */
export type ClassificationOrders = Readonly<Record<string, readonly string[]>>;

/** The order of the label's policy, if the label's classification is in it; else null. */
export function orderOf(orders: ClassificationOrders, label: SecurityLabel): readonly string[] | null {
  const order = Object.hasOwn(orders, label.policyIdentifier.name) ? orders[label.policyIdentifier.name] : undefined;
  return order?.includes(label.classification) === true ? order : null;
}

/**
 * Where an object's label stands to the classification `to` of the policy `policy`: `lower` (to be
 * raised), `same-or-higher`, or `outside` (another policy, or a classification outside the order),
 * which a raise leaves alone and counts (owner, 2026-10-14).
 */
export function compare(orders: ClassificationOrders, label: SecurityLabel, policy: string, to: string): 'lower' | 'same-or-higher' | 'outside' {
  const order = orderOf(orders, label);
  if (order === null || label.policyIdentifier.name !== policy || !order.includes(to)) return 'outside';
  return order.indexOf(label.classification) < order.indexOf(to) ? 'lower' : 'same-or-higher';
}

/** The label with another classification; everything else in it stays as it is (ADR-0031 point 3). */
export function withClassification(label: SecurityLabel, classification: string): SecurityLabel {
  return { ...label, classification };
}
