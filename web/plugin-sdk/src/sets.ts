/**
 * SDK 1.4.0 part 3 (CR-0030 part 3, CR-0031): field sets (ADR-0050), relations between objects
 * (ADR-0051) and vessel codes (ADR-0047). SDK 1.5.0 part 1 (CR-0038): a data type's sets.
 */
import type { Relation } from './model.ts';

/** The most field sets one data type names (data model 1.5.0). */
export const MAX_DATA_TYPE_FIELD_SETS = 8;

/**
 * SDK 1.5.0 (CR-0038 points 3 and 4, model rule 21): `objectSets` followed by the sets of
 * `dataType` that it lacks, in the data type's order: the sets the object store gives a
 * `core.symbol` object on a create, or on an update that changes its data type to `dataType`
 * (shapes and graphics get none in 1.5.0, owner NO A). An editor shows them as soon
 * as the user chooses the type, before it sends; it need not send them, the store adds them.
 *
 * @example
 * const type = ctx.dataTypes.find((t) => t.id === content.dataType);
 * <DeclaredFields objectSets={withDataTypeSets(added, type)} ... />
 */
export function withDataTypeSets(objectSets: readonly string[] | undefined, dataType: { readonly fieldSets?: readonly string[] } | undefined): string[] {
  return [...new Set([...(objectSets ?? []), ...(dataType?.fieldSets ?? [])])];
}

/**
 * SDK 1.5.0 (CR-0038 point 6): the data types an editor's data type select offers, in
 * `dataTypes`' order: those users make by hand (`manual` not `false`), and `current`, the type the
 * edited object already has, even when it is not, so that an edit does not change it unseen. The
 * declaring plugin keeps the list; no editor names another plugin's types.
 *
 * @example
 * const options = choosableDataTypes(ctx.dataTypes, object?.dataType).map((t) => ({ value: t.id, label: t.name }));
 */
export function choosableDataTypes<T extends { readonly id: string; readonly manual?: boolean }>(dataTypes: readonly T[], current?: string): T[] {
  return dataTypes.filter((t) => t.manual !== false || t.id === current);
}

/** The most field sets one object carries (data model 1.4.0). */
export const MAX_FIELD_SETS = 64;

/** The most relations one object carries (data model 1.4.0; CR-0031, the owner's Q1). */
export const MAX_RELATIONS = 1024;

/**
 * A field set a loaded plugin declares in its manifest's `fieldSets` (ADR-0050; `ctx.fieldSets`): a
 * named group of that plugin's own declared fields. Objects list the sets they carry in
 * `fieldSets`, by `id`.
 */
export interface FieldSet {
  /** The full id, `<plugin>.<name>`, e.g. `cot.unit`: what objects list. */
  readonly id: string;
  readonly plugin: string;
  /** The manifest's `id`, the set's name within its plugin, e.g. `unit`. */
  readonly name: string;
  /** The group's heading and the editor's choice, e.g. `CoT unit`. */
  readonly label: string;
  /** The names of the plugin's own declared fields in the set, in the order editors show them. */
  readonly fields: readonly string[];
}

/** How the map view draws a relation's line, in the shape style's words. */
export interface RelationLine {
  /** `#RRGGBB`. */
  readonly strokeColor: string;
  /** Screen pixels, 0.5 to 10; the shell fills in the default 1. */
  readonly strokeWidth: number;
  /** The shell fills in the default `solid`. */
  readonly strokeDash: 'solid' | 'dash' | 'dot';
  /** An arrowhead at the other object; the shell fills in the default `none`. */
  readonly arrowhead: 'none' | 'end';
  /**
   * SDK 1.6.0 (CR-0041 part C; T-181): a JSON Pointer into the declaring plugin's settings to a
   * `#RRGGBB` string, e.g. `/pairingColour`, that gives the line's colour; `strokeColor` is the
   * fallback while that setting is missing or not a colour. Absent: the colour is `strokeColor`.
   */
  readonly strokeColorSetting?: string;
}

/**
 * SDK 1.6.0 (CR-0041 part C): the value at a JSON Pointer (RFC 6901) in `value`, or undefined.
 *
 * @example
 * settingAt({ links: [{ port: 8087 }] }, '/links/0/port');   // 8087
 */
export function settingAt(value: unknown, pointer: string): unknown {
  if (pointer === '') return value;
  if (!pointer.startsWith('/')) return undefined;
  let at: unknown = value;
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.split('~1').join('/').split('~0').join('~');
    if (Array.isArray(at)) {
      if (!/^(0|[1-9][0-9]*)$/.test(key)) return undefined;
      at = at[Number(key)];
    } else if (at !== null && typeof at === 'object' && Object.prototype.hasOwnProperty.call(at, key)) {
      at = (at as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return at;
}

/**
 * SDK 1.6.0 (CR-0041 part C; T-181): each kind's line with its colour taken from the declaring
 * plugin's current settings (`strokeColorSetting`), else its manifest's `strokeColor`. The shell
 * gives the result as `ctx.relationLines`, again after each settings change; the map view draws
 * with it. `settingsOf` gives a plugin's current settings by its id.
 *
 * @example
 * const lines = resolveRelationLines(ctx.relationKinds, (plugin) => settingsByPlugin[plugin]);
 * lines['gmti.pairing'].strokeColor;   // '#FFFF00', or the admin's colour
 */
export function resolveRelationLines(kinds: readonly RelationKind[], settingsOf: (pluginId: string) => unknown): Readonly<Record<string, RelationLine>> {
  const lines: Record<string, RelationLine> = {};
  for (const kind of kinds) {
    const pointer = kind.line.strokeColorSetting;
    const value = pointer === undefined ? undefined : settingAt(settingsOf(kind.id.slice(0, kind.id.indexOf('.'))), pointer);
    const colour = typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : kind.line.strokeColor;
    lines[kind.id] = Object.freeze({ ...kind.line, strokeColor: colour });
  }
  return Object.freeze(lines);
}

/**
 * A kind of relation a loaded plugin declares in its manifest's `relationKinds` (ADR-0051 point 2;
 * `ctx.relationKinds`). The map view draws each kind's lines as `line` says, when the user's switch
 * for it is on (`display.relations`, part 5).
 */
export interface RelationKind {
  /** `<plugin-id>.<name>`, e.g. `gmti.pairing`. */
  readonly id: string;
  /** Shown at the user's switch, e.g. `GMTI Pairing`. */
  readonly label: string;
  readonly line: RelationLine;
  /** The default of the user's switch. */
  readonly defaultOn: boolean;
}

/**
 * The `stored` list with the entries of `kind` replaced by one entry per id in `objectIds` (in their
 * order, each once). The entries of other kinds are kept, before the new ones. An update replaces
 * the whole list (model rule 5), so a writer uses this to keep what other plugins wrote.
 *
 * @throws Error when the result has more than {@link MAX_RELATIONS} entries
 *
 * @example
 * const relations = replaceRelations(platform.relations, 'gmti.pairing', detected.map((t) => t.id));
 * await ctx.changes.submit(changeRequests.updateObject(platform, { ...content, relations }));
 */
export function replaceRelations(stored: readonly Relation[] | undefined, kind: string, objectIds: readonly string[]): Relation[] {
  const kept = (stored ?? []).filter((r) => r.kind !== kind);
  const added = [...new Set(objectIds)].map((objectId) => ({ kind, objectId }));
  const result = [...kept, ...added];
  if (result.length > MAX_RELATIONS) throw new Error(`an object carries at most ${MAX_RELATIONS} relations: ${result.length}`);
  return result;
}

/** The parts of a vessel code (data model 1.4.0, ADR-0047). */
export interface VesselCode {
  /** APP-6D's context: 0 reality, 1 exercise, 2 simulation. */
  readonly context: 0 | 1 | 2;
  /** APP-6D's standard identity: 0 pending to 6 hostile. */
  readonly identity: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** The AIS ship and cargo type, 0 to 99 (ITU-R M.1371; 0 "not available"). */
  readonly shipType: number;
}

const VESSEL = /^([0-2])([0-6])(\d{2})$/;

/**
 * A vessel symbol's `sidc`: 4 digits, context, identity, then the ship type.
 *
 * @example
 * vesselSidc({ context: 0, identity: 4, shipType: 70 }) // '0470', a real neutral cargo ship
 */
export function vesselSidc(code: VesselCode): string {
  if (!Number.isInteger(code.shipType) || code.shipType < 0 || code.shipType > 99) throw new Error(`a ship type is 0 to 99: ${code.shipType}`);
  return `${code.context}${code.identity}${String(code.shipType).padStart(2, '0')}`;
}

/** The parts of a vessel symbol's `sidc`, or null when it is not one. */
export function parseVesselSidc(sidc: string): VesselCode | null {
  const m = VESSEL.exec(sidc);
  if (m === null) return null;
  return { context: Number(m[1]) as VesselCode['context'], identity: Number(m[2]) as VesselCode['identity'], shipType: Number(m[3]) };
}
