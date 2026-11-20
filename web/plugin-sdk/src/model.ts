/**
 * TypeScript types of the common data model 1.9.0 (`model/`, ADR-0007). Written by hand and checked
 * against `model/examples/` by the SDK's contract test. Coordinates are always
 * **longitude, latitude**.
 *
 * @example
 * const point: Point = { type: 'Point', coordinates: [18.0686, 59.3293] };
 */

/** A UUID in lowercase canonical form. */
export type Uuid = string;

/** RFC 3339 in UTC with a trailing Z, millisecond precision, e.g. `2026-10-03T08:15:30.250Z`. */
export type Timestamp = string;

/** `[longitude, latitude]` or `[longitude, latitude, altitude]`; altitude in metres above the WGS84 ellipsoid. */
export type Position = readonly [longitude: number, latitude: number] | readonly [longitude: number, latitude: number, altitude: number];

export interface Point {
  readonly type: 'Point';
  readonly coordinates: Position;
}
export interface MultiPoint {
  readonly type: 'MultiPoint';
  readonly coordinates: readonly Position[];
}
export interface LineString {
  readonly type: 'LineString';
  readonly coordinates: readonly Position[];
}
/** The first ring is the exterior, further rings are holes. Rings are closed (model rule 1). */
export interface Polygon {
  readonly type: 'Polygon';
  readonly coordinates: readonly (readonly Position[])[];
}
export interface Circle {
  readonly type: 'Circle';
  readonly center: Position;
  /** Geodesic metres. */
  readonly radius: number;
}
export interface Ellipse {
  readonly type: 'Ellipse';
  readonly center: Position;
  readonly semiMajorAxis: number;
  readonly semiMinorAxis: number;
  /** Bearing of the major axis, degrees clockwise from true north. */
  readonly rotation: number;
}
export interface Corridor {
  readonly type: 'Corridor';
  readonly coordinates: readonly Position[];
  /** Total width in metres. */
  readonly width: number;
}
/** The area between two radii, clockwise from startBearing to endBearing. A sector has innerRadius 0. */
export interface ArcBand {
  readonly type: 'ArcBand';
  readonly center: Position;
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly startBearing: number;
  readonly endBearing: number;
}

/** Edges between consecutive positions are the shorter geodesic (model rule 10). */
export type Geometry = Point | MultiPoint | LineString | Polygon | Circle | Ellipse | Corridor | ArcBand;

/**
 * The APP-6 edition of a symbol code, or (SDK 1.4.0, ADR-0047) `vessel`: emc2's own vessel symbols,
 * whose `sidc` holds 4 digits: APP-6D's context, its standard identity, then the AIS ship type
 * (`vesselSidc`, e.g. `0470`). `symbology` draws them.
 */
export type SymbolStandard = 'APP-6B' | 'APP-6D' | 'APP-6E' | 'vessel';

/**
 * The text amplifiers of the data model, named as in milsymbol. SDK 1.4.0 (CR-0030 part 2) adds the
 * ones tactical graphics use: `targetNumber` (AP), `uniqueDesignation1` (T1), `uniqueDesignation2`
 * (T2) and `dtg1` (W1). Single-point symbols ignore them.
 */
export type TextModifierName =
  | 'additionalInformation' | 'altitudeDepth' | 'auxiliaryEquipmentIndicator' | 'combatEffectiveness' | 'commonIdentifier'
  | 'country' | 'dtg' | 'engagementBar' | 'engagementType' | 'equipmentTeardownTime' | 'evaluationRating' | 'guardedUnit'
  | 'headquartersElement' | 'higherFormation' | 'hostile' | 'iffSif' | 'installationComposition' | 'location' | 'platformType'
  | 'quantity' | 'reinforcedReduced' | 'sigint' | 'signatureEquipment' | 'specialDesignator' | 'specialHeadquarters'
  | 'staffComments' | 'type' | 'uniqueDesignation'
  | 'dtg1' | 'targetNumber' | 'uniqueDesignation1' | 'uniqueDesignation2';

/**
 * Text amplifiers (1 to 128 characters), plus direction (degrees from true north) and speed (m/s).
 * SDK 1.4.0 adds the numbers of tactical graphics, each in the order the graphic defines (its
 * {@link GraphicCatalogEntry}): `distances` (AM, metres, 0 to 20 000 000) and `azimuths` (AN, degrees
 * clockwise from true north, 0 to 360), 1 to 64 values each. Single-point symbols ignore them.
 */
export type Modifiers = { readonly [K in TextModifierName]?: string } & {
  readonly direction?: number;
  readonly speed?: number;
  readonly distances?: readonly number[];
  readonly azimuths?: readonly number[];
};

/** SDK 1.4.0: the name of any amplifier in {@link Modifiers}. */
export type ModifierName = TextModifierName | 'direction' | 'speed' | 'distances' | 'azimuths';

export interface MilSymbol {
  readonly standard: SymbolStandard;
  readonly sidc: string;
  readonly modifiers?: Modifiers;
}

export interface Style {
  readonly strokeColor?: string;
  readonly strokeWidth?: number;
  readonly strokeOpacity?: number;
  readonly strokeDash?: 'solid' | 'dash' | 'dot';
  readonly fillColor?: string;
  readonly fillOpacity?: number;
  /** Data model 1.1.0: `hatch` fills an area with diagonal lines in `fillColor`; absent means `solid`. */
  readonly fillPattern?: 'solid' | 'hatch';
  /** Data model 1.1.0: `end` draws an arrowhead at a line's last point; absent means `none`. */
  readonly arrowhead?: 'none' | 'end';
  /** Data model 1.1.0: `circle` marks every point of a line (a route); absent means `none`. */
  readonly pointMarkers?: 'none' | 'circle';
}

export interface ObjectProperties {
  readonly name?: string;
  readonly description?: string;
}

export interface SecurityLabel {
  readonly policyIdentifier: { readonly name: string; readonly uri?: string };
  readonly classification: string;
  readonly categories?: readonly {
    readonly tagName: string;
    readonly type: 'permissive' | 'restrictive' | 'informative';
    readonly uri?: string;
    readonly values: readonly string[];
  }[];
  readonly creationDateTime?: Timestamp;
  readonly reviewDateTime?: Timestamp;
}

/** Any JSON value. Extension data is opaque to everyone but its owner and forwarded untouched. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** Plugin id → that plugin's data. */
export type Extensions = { readonly [pluginId: string]: { readonly [key: string]: JsonValue } };

/**
 * SDK 1.2.0: one declared field to set in a change request (ADR-0038; data model 1.2.0). The store
 * checks it against its declaration and applies it after the content; `null` removes it unless the
 * field is required.
 */
export interface FieldValue {
  readonly plugin: string;
  readonly name: string;
  readonly value: string | number | boolean | null;
}

export interface Actor {
  readonly plugin: string;
  readonly user?: string;
  readonly system?: string;
}

export interface Audit {
  readonly at: Timestamp;
  readonly by: Actor;
}

/** An object's identity in an external system, e.g. `{ system: 'cot', id: uid }`. Unique among existing objects (model rule 16). */
export interface ExternalRef {
  readonly system: string;
  readonly id: string;
}

export interface Meta {
  readonly created: Audit;
  readonly modified: Audit;
  /** Copied from the create request's `externalRef`; never changes. */
  readonly externalRef?: ExternalRef;
}

/** Time attributes (model rule 15), e.g. from CoT's `time`, `start` and `stale`. */
export interface TimeAttributes {
  readonly observed?: Timestamp;
  /** Not after `expires`. */
  readonly validFrom?: Timestamp;
  readonly expires?: Timestamp;
}

/** The built-in data type (ADR-0023). */
export const GENERAL_DATA_TYPE = 'core.general';

/** The data source of objects that users draw (ADR-0023). */
export const MANUAL_DATA_SOURCE = 'manual';

/** The fields of a map object its creator controls. On update they are replaced as a whole (model rule 5). */
export interface MapObjectContent {
  /** What the object is on the map: `core.symbol`, `core.multipoint`, `core.shape`, from 1.6.0 `core.text`, or `<plugin-id>.<name>`. */
  readonly type: string;
  /**
   * What kind of information it is (ADR-0023): `core.general` or a data type a plugin declares,
   * `<plugin-id>.<name>`. Must be available when the object is created or its data type changed (model rule 14).
   */
  readonly dataType: string;
  /** Where it came from: `manual` for drawn objects, otherwise a stream's name. Fixed at creation; an update sends it unchanged (model rule 14). */
  readonly dataSource: string;
  readonly time?: TimeAttributes;
  readonly layerId: Uuid;
  readonly geometry: Geometry;
  readonly symbol?: MilSymbol;
  /**
   * Data model 1.6.0 (CR-0041 part D; T-182, owner Q58 A): what the object is for the user's display
   * filters, e.g. `gmti`'s dwell areas and coverage. The map view hides it while the user's switch for
   * that class is off (`ctx.display.classes`). Absent: no class, always shown. Editors forward it.
   */
  readonly displayClass?: DisplayClass;
  /** Data model 1.6.0 (CR-0041 part A): a `core.text`'s text, required for it and absent for every other type. */
  readonly text?: TextContent;
  readonly style?: Style;
  readonly properties?: ObjectProperties;
  readonly label: SecurityLabel;
  readonly extensions?: Extensions;
  /**
   * SDK 1.4.0 (ADR-0050): the field sets the object carries, full ids `<plugin-id>.<set>`, each once,
   * at most 64. On update an absent list keeps the stored sets and a listed set is added; nothing
   * removes one (model rule 5's third exception). A set a request adds must be in `ctx.fieldSets`
   * (rule 18). Add sets with `changeRequests.withFieldSets`.
   */
  readonly fieldSets?: readonly string[];
  /**
   * SDK 1.4.0 (ADR-0051, CR-0031): the relations to other objects, each once, at most 1 024.
   * Replaced as a whole on update (rule 5): an editor forwards the list it read, and a writer keeps
   * other kinds' entries (`replaceRelations`). Kinds are checked by rule 17; the other object never.
   */
  readonly relations?: readonly Relation[];
}

/**
 * Data model 1.6.0 (CR-0041 part A; ADR-0055 point 4): the text of a `core.text` object, centred on
 * its `Point`, in `style.strokeColor` or the map view's label colour, with the label halo
 * (`map-view-2d` function 45).
 *
 * @example
 * const content = { type: CORE_TEXT, geometry: { type: 'Point', coordinates: [15.2, 58.4] }, text: { value: 'Bridge 12', rotation: 30 }, ... };
 */
export interface TextContent {
  /** 1 to {@link TEXT_MAX_LENGTH} characters; a line break starts a new line. */
  readonly value: string;
  /** Degrees clockwise from true north at the point, 0 to under 360; absent means 0. */
  readonly rotation?: number;
  /** CSS pixels, {@link TEXT_SIZE_MIN} to {@link TEXT_SIZE_MAX}; absent means {@link TEXT_SIZE_DEFAULT}. */
  readonly size?: number;
}

/** Data model 1.6.0 (CR-0041 part D): the display classes, a fixed list; the labels are `DISPLAY_CLASSES`'. */
export const DISPLAY_CLASS_IDS = Object.freeze(['dwell-area', 'sensor-coverage'] as const);

/** A display class: what a shape or an overlay item is for the user's display filters. */
export type DisplayClass = (typeof DISPLAY_CLASS_IDS)[number];

/** Data model 1.6.0: the type of a text object. */
export const CORE_TEXT = 'core.text';
export const TEXT_MAX_LENGTH = 1024;
export const TEXT_SIZE_MIN = 8;
export const TEXT_SIZE_MAX = 48;
export const TEXT_SIZE_DEFAULT = 14;

/** SDK 1.4.0: a relation to another object: a kind in `ctx.relationKinds` and the other object's id. */
export interface Relation {
  /** `<plugin-id>.<name>`, e.g. `gmti.pairing`. */
  readonly kind: string;
  readonly objectId: Uuid;
}

export interface MapObject extends MapObjectContent {
  readonly id: Uuid;
  readonly version: number;
  readonly meta: Meta;
}

export interface LayerContent {
  /**
   * SDK 1.2.0 (ADR-0039): the workspace the layer belongs to, e.g. `simulator.simulation`. Absent
   * means View (`core.view`), which the store keeps as absent. Set it on create (the layer panel's
   * "New layer" passes `ctx.workspace.current.id`); on update leave it out to keep the stored one,
   * since an explicit other one is rejected: a layer stays in its workspace.
   */
  readonly workspace?: string;
  readonly name: string;
  /** Higher values are drawn on top; ties are broken by id. */
  readonly drawOrder: number;
  /** The default visibility for new sessions. */
  readonly visible: boolean;
  readonly label: SecurityLabel;
  readonly extensions?: Extensions;
  /**
   * SDK 1.3.0 (ADR-0042): the layer is locked. Absent and `false` both mean not locked; the store
   * keeps `false` as absent. On update leave it out to keep the stored lock (an exception to model
   * rule 5); send `true` to lock and `false` to unlock. Setting or clearing it needs the layer's
   * edit permission. While it is set, the store refuses a user's change to the layer's content with
   * `LAYER_LOCKED`: any change to its objects, a move into or out of it, and the layer's update or
   * delete, except an update that changes only `locked` and `drawOrder`. Every request from a web
   * part is a user's, so editors treat a locked layer's objects as read only and do not place into it.
   */
  readonly locked?: boolean;
}

export interface Layer extends LayerContent {
  readonly id: Uuid;
  readonly version: number;
  readonly meta: Meta;
}

export type EntityType = 'object' | 'layer';
export type Operation = 'create' | 'update' | 'delete';

interface ChangeRequestBase {
  readonly requestId: Uuid;
  readonly entityId: Uuid;
  /** The version the change is based on. Recorded, not enforced in 1.0.0. */
  readonly baseVersion?: number;
  readonly source: Actor;
}

/** A request to the object store. Answered by exactly one change event or change rejection (model rule 12). */
export type ChangeRequest =
  | (ChangeRequestBase & {
      readonly entityType: 'object';
      readonly operation: 'create';
      readonly data: MapObjectContent;
      readonly externalRef?: ExternalRef;
      /** SDK 1.2.0: declared fields to set (`changeRequests.withFields`). */
      readonly fields?: readonly FieldValue[];
    })
  | (ChangeRequestBase & { readonly entityType: 'object'; readonly operation: 'update'; readonly data: MapObjectContent; readonly fields?: readonly FieldValue[] })
  | (ChangeRequestBase & { readonly entityType: 'layer'; readonly operation: 'create' | 'update'; readonly data: LayerContent })
  | (ChangeRequestBase & { readonly entityType: EntityType; readonly operation: 'delete' });

/** Published on `objects.changed` after a change was applied. */
export interface ChangeEvent {
  readonly sequenceNo: number;
  readonly requestId: Uuid;
  readonly entityType: EntityType;
  readonly operation: Operation;
  readonly entityId: Uuid;
  readonly version: number;
  readonly previousVersion: number | null;
  readonly baseVersion?: number;
  /** The complete state after the change; null for delete. */
  readonly state: MapObject | Layer | null;
  readonly label: SecurityLabel;
  readonly at: Timestamp;
  readonly by: Actor;
}

/**
 * Why the object store refused a request (`model/schemas/change-rejection.schema.json`). SDK 1.3.0
 * adds `LAYER_LOCKED` (ADR-0042): a user's change to a locked layer's content. Its one detail names
 * the layer; its path is `/data/layerId` when the request carries the layer's id there, else empty.
 */
export type RejectionCode =
  | 'VALIDATION_FAILED' | 'ENTITY_NOT_FOUND' | 'ENTITY_EXISTS' | 'EXTERNAL_REF_EXISTS' | 'LAYER_NOT_FOUND' | 'LAYER_NOT_EMPTY' | 'PERMISSION_DENIED' | 'INTERNAL_ERROR'
  | 'LAYER_LOCKED';

/** Sent to the requester when the object store does not apply a request. */
export interface ChangeRejection {
  readonly requestId: Uuid;
  readonly entityType: EntityType;
  readonly operation: Operation;
  readonly entityId: Uuid;
  readonly code: RejectionCode;
  readonly message: string;
  readonly details?: readonly { readonly path: string; readonly problem: string }[];
  readonly at: Timestamp;
}
