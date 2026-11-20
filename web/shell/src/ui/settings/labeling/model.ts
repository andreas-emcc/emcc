/**
 * Settings › Labeling (T-170, M6): the premade security labels, per policy, as `GET` and `PUT
 * /api/settings/labeling` carry them (server/ecore `Labeling`), and the definitions they are made
 * from (`labelDefinitions` in `GET /api/config`; round 3b, owner OY and OZ A). Pure functions only:
 * the label text, the groups by section and classification (highest first, owner OI A), and the checks the entry makes
 * before the server's (no value twice, no label twice whatever the order of its values; both
 * ignoring case). In M6 the labels are cosmetic and connected to nothing (owner, 2026-11-10).
 */
import type { SecurityLabel } from '@emc2/plugin-sdk';

/** The category a premade label's releasability is in (owner, 2026-11-10). */
export const RELEASABLE_TO = 'Releasable To';
/** The longest value, as the model's category values. */
export const MAX_VALUE_LENGTH = 128;

export interface PolicyLabels {
  /** The values its labels may be released to: nation codes, or texts naming a group or context. */
  readonly releasableTo: readonly string[];
  readonly labels: readonly SecurityLabel[];
}

export interface Premade {
  readonly policies: Readonly<Record<string, PolicyLabels>>;
}

/** A classification of a set: its name and its colour (`#rrggbb`). */
export interface Classification {
  readonly name: string;
  readonly color: string;
}

/** A classification set: its classifications, highest first. */
export interface ClassificationSet {
  readonly id: string;
  readonly name: string;
  readonly classifications: readonly Classification[];
}

/** A policy and the sets it offers, its sections, in order. */
export interface LabelPolicy {
  readonly name: string;
  readonly classificationSets: readonly string[];
}

/** The server's labeling definitions (`labeling-definitions.json`). */
export interface LabelDefinitions {
  readonly classificationSets: readonly ClassificationSet[];
  readonly policies: readonly LabelPolicy[];
}

export const NO_DEFINITIONS: LabelDefinitions = { classificationSets: [], policies: [] };

/** The colour of a classification no longer defined (round 2's grey, A4). */
export const UNDEFINED_COLOR = '#555d68';

/** The policy's sections: its sets, in its order; none for a policy not defined. */
export function sectionsOf(definitions: LabelDefinitions, policy: string): readonly ClassificationSet[] {
  const named = definitions.policies.find((p) => p.name === policy)?.classificationSets ?? [];
  return named.flatMap((id) => definitions.classificationSets.find((s) => s.id === id) ?? []);
}

/** The classification's colour in the policy's sections, or {@link UNDEFINED_COLOR}. */
export function colorOf(sections: readonly ClassificationSet[], classification: string): string {
  for (const set of sections) {
    const found = set.classifications.find((c) => c.name === classification);
    if (found !== undefined) return found.color;
  }
  return UNDEFINED_COLOR;
}

/** How a label is written as text (`labelFormat` in `GET /api/config`, `emc2.labeling.*`). */
export interface LabelFormat {
  readonly fieldSeparator: string;
  readonly releasableToSeparator: string;
  readonly releasableToPrefix: string;
}

export const DEFAULT_FORMAT: LabelFormat = { fieldSeparator: ' · ', releasableToSeparator: ', ', releasableToPrefix: 'REL TO' };
export const NO_LABELS: Premade = { policies: {} };
const EMPTY: PolicyLabels = { releasableTo: [], labels: [] };

/** The values a label is released to (its Releasable To category's), in its order. */
export function releasedTo(label: SecurityLabel): readonly string[] {
  return label.categories?.find((c) => c.tagName === RELEASABLE_TO)?.values ?? [];
}

/** The two parts of a label's text: `NATO SECRET`, and `REL TO SWE, NOR, FIN` or null when released to none. */
export function labelParts(label: SecurityLabel, format: LabelFormat): { readonly classification: string; readonly releasable: string | null } {
  const values = releasedTo(label);
  return {
    classification: `${label.policyIdentifier.name} ${label.classification}`,
    releasable: values.length === 0 ? null : `${format.releasableToPrefix} ${values.join(format.releasableToSeparator)}`,
  };
}

/**
 * E.g. `NATO SECRET · REL TO SWE, NOR, FIN`; a label released to none ends after its
 * classification. It starts with the policy's name, also in another policy's section (T-170 3b Q2).
 */
export function labelText(label: SecurityLabel, format: LabelFormat): string {
  const parts = labelParts(label, format);
  return parts.releasable === null ? parts.classification : `${parts.classification}${format.fieldSeparator}${parts.releasable}`;
}

/** A premade label of `policy`; its values in the policy's list order, so that labels read alike. */
export function makeLabel(policy: string, classification: string, values: ReadonlySet<string>, list: readonly string[]): SecurityLabel {
  const ordered = list.filter((v) => values.has(v));
  return {
    policyIdentifier: { name: policy },
    classification,
    ...(ordered.length === 0 ? {} : { categories: [{ tagName: RELEASABLE_TO, type: 'permissive', values: ordered }] }),
  };
}

const key = (value: string) => value.toLowerCase();

function sameKey(label: SecurityLabel): string {
  return [label.classification, ...releasedTo(label).map(key).sort()].join('\n');
}

/** The index of another label of `labels` that is the same as `label`, whatever the order of the values; else -1. */
export function sameAs(labels: readonly SecurityLabel[], label: SecurityLabel, except = -1): number {
  const wanted = sameKey(label);
  return labels.findIndex((l, i) => i !== except && sameKey(l) === wanted);
}

/** Why `value` cannot be added to (or renamed in) `list`, or null; `except` is the value being renamed. */
export function valueProblem(list: readonly string[], value: string, except?: string): string | null {
  const v = value.trim();
  if (v.length === 0) return 'Write a value: a three-letter nation code, or a text naming a group.';
  if (v.length > MAX_VALUE_LENGTH) return `A value has at most ${String(MAX_VALUE_LENGTH)} characters.`;
  if (list.some((x) => x !== except && key(x) === key(v))) return `${v} is in the list already.`;
  return null;
}

/** The policy's part, or an empty one. */
export function policyOf(premade: Premade, policy: string): PolicyLabels {
  return Object.hasOwn(premade.policies, policy) ? premade.policies[policy] ?? EMPTY : EMPTY;
}

/** `premade` with the policy's part replaced; a part left empty is dropped. */
export function withPolicy(premade: Premade, policy: string, part: PolicyLabels): Premade {
  const others = Object.entries(premade.policies).filter(([name]) => name !== policy);
  const empty = part.releasableTo.length === 0 && part.labels.length === 0;
  // In place, so that a policy keeps its place in the stored order.
  const at = Object.keys(premade.policies).indexOf(policy);
  const entries: [string, PolicyLabels][] = empty ? others : [...others.slice(0, at < 0 ? others.length : at), [policy, part], ...others.slice(at < 0 ? others.length : at)];
  return { policies: Object.fromEntries(entries) };
}

/** The policies shown: the defined ones in their order, then stored ones the definitions no longer have. */
export function shownPolicies(premade: Premade, definitions: LabelDefinitions): readonly string[] {
  const configured = definitions.policies.map((p) => p.name);
  return [...configured, ...Object.keys(premade.policies).filter((p) => !configured.includes(p))];
}

export interface LabelGroup {
  /** The classification, or null for the labels whose classification the configuration no longer has. */
  readonly classification: string | null;
  /** Each label with its index in the policy's list. */
  readonly labels: readonly { readonly label: SecurityLabel; readonly index: number }[];
}

export interface LabelSection {
  /** The section's set, or null for the labels whose classification no section has. */
  readonly set: ClassificationSet | null;
  readonly groups: readonly LabelGroup[];
}

/**
 * The labels by section, in the policy's order, and in each by classification, highest first, as
 * the classifications lists (owner OI A; A3); then one section of those whose classification no
 * section has. Sections and groups without labels are left out.
 */
export function sections(labels: readonly SecurityLabel[], sets: readonly ClassificationSet[]): readonly LabelSection[] {
  const indexed = labels.map((label, index) => ({ label, index }));
  const out: LabelSection[] = sets.map((set) => ({
    set,
    groups: set.classifications
      .map((c) => ({ classification: c.name, labels: indexed.filter((l) => l.label.classification === c.name) }))
      .filter((g) => g.labels.length > 0),
  })).filter((s) => s.groups.length > 0);
  const known = new Set(sets.flatMap((s) => s.classifications.map((c) => c.name)));
  const outside = indexed.filter((l) => !known.has(l.label.classification));
  if (outside.length > 0) out.push({ set: null, groups: [{ classification: null, labels: outside }] });
  return out;
}

/** The labels that use `value`. */
export function usedBy(labels: readonly SecurityLabel[], value: string): number {
  return labels.filter((l) => releasedTo(l).includes(value)).length;
}

/** The policy's part with `from` renamed to `to`, in the list and in every label. */
export function renamed(part: PolicyLabels, from: string, to: string): PolicyLabels {
  const swap = (v: string) => (v === from ? to : v);
  return {
    releasableTo: part.releasableTo.map(swap),
    labels: part.labels.map((l) => (releasedTo(l).includes(from)
      ? { ...l, categories: (l.categories ?? []).map((c) => (c.tagName === RELEASABLE_TO ? { ...c, values: c.values.map(swap) } : c)) }
      : l)),
  };
}

/** The premade labels from the server's answer, or none if it is not of their form. */
export function premadeOf(value: unknown): Premade {
  if (typeof value !== 'object' || value === null || !('policies' in value)) return NO_LABELS;
  const policies = value.policies;
  if (typeof policies !== 'object' || policies === null || Array.isArray(policies)) return NO_LABELS;
  const out: Record<string, PolicyLabels> = {};
  for (const [name, part] of Object.entries(policies as Record<string, unknown>)) {
    const p = (typeof part === 'object' && part !== null ? part : {}) as Partial<PolicyLabels>;
    out[name] = { releasableTo: Array.isArray(p.releasableTo) ? p.releasableTo : [], labels: Array.isArray(p.labels) ? p.labels : [] };
  }
  return { policies: out };
}
