/**
 * What the shell keeps current for every web part (SDK v1): the data types with their effective
 * behaviour (`ctx.dataTypes`) and each plugin's settings (`ctx.settings`). Both are complete values,
 * replaced as a whole. Also the declared fields (`ctx.declaredFields`, SDK 1.2.0), and from SDK 1.4.0
 * the field sets and relation kinds (`ctx.fieldSets`, `ctx.relationKinds`), which come once, with
 * `/api/config`, and stay as they are while the page lives. SDK 1.6.0 (CR-0041 part C; T-181): the
 * relation kinds' lines with their colours from the declaring plugins' settings (`ctx.relationLines`,
 * `resolveRelationLines`), worked out again when such a plugin's settings change. SDK 1.7.0
 * (CR-0042; T-192): the data types' stepped fades (`DataType.fade`, `withSteppedFades`) from the
 * declaring plugins' settings in the same way; `ctx.onDataTypesChange` is told when a fade changes.
 *
 * They come twice: over HTTP when the page loads (`/api/config`, `/api/plugins`), and over the live
 * picture's socket right after `welcome` and after each change (server/live-picture-protocol.md).
 * A socket message always counts; an HTTP value only where no socket message has set it yet, so an
 * answer that left the server earlier never replaces a newer message.
 */
import {
  resolveRelationLines, withSteppedFades, type DataType, type DeclaredField, type FieldSet, type ReadonlyState, type RelationKind, type RelationLine, type Settings,
  type Unsubscribe,
} from '@emc2/plugin-sdk';
import { deepFreeze } from '../live/picture.ts';

/** A relation kind as `/api/config` may send it: the line's members other than the colour, and `defaultOn`, may be absent. */
export type RelationKindJson = Omit<RelationKind, 'line' | 'defaultOn'> & {
  readonly line: Pick<RelationLine, 'strokeColor'> & Partial<RelationLine>;
  readonly defaultOn?: boolean;
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export class SharedState {
  /** The data types as the server sent them, `fadeSetting` kept; `dataTypesValue` adds their fades. */
  private declaredDataTypes: readonly DataType[] = Object.freeze([]);
  private dataTypesValue: readonly DataType[] = Object.freeze([]);
  private dataTypesFromSocket = false;
  private readonly settings = new Map<string, Settings>();
  private readonly settingsFromSocket = new Set<string>();
  private readonly dataTypeListeners = new Set<(dataTypes: readonly DataType[]) => void>();
  private readonly settingsListeners = new Map<string, Set<(settings: Settings) => void>>();
  private declaredFieldsValue: readonly DeclaredField[] = Object.freeze([]);
  private readonly declaredFieldListeners = new Set<() => void>();
  private fieldSetsValue: readonly FieldSet[] = Object.freeze([]);
  private relationKindsValue: readonly RelationKind[] = Object.freeze([]);
  private relationLinesValue: Readonly<Record<string, RelationLine>> = Object.freeze({});
  private readonly relationLineListeners = new Set<(lines: Readonly<Record<string, RelationLine>>) => void>();

  /** SDK 1.6.0: `ctx.relationLines`, each kind's line in its current colour; empty until `/api/config` has come. */
  readonly relationLines: ReadonlyState<Readonly<Record<string, RelationLine>>> = new StateView(() => this.relationLinesValue, (listener) => {
    this.relationLineListeners.add(listener);
    return () => { this.relationLineListeners.delete(listener); };
  });

  get dataTypes(): readonly DataType[] {
    return this.dataTypesValue;
  }

  /** Every loaded plugin's declared fields; empty until `/api/config` has come. */
  get declaredFields(): readonly DeclaredField[] {
    return this.declaredFieldsValue;
  }

  /** The declared fields of `/api/config`: fixed while the server runs, so they are set once. */
  initialDeclaredFields(fields: readonly DeclaredField[]): void {
    if (this.declaredFieldsValue.length > 0 || fields.length === 0) return;
    this.declaredFieldsValue = deepFreeze(structuredClone(fields));
    for (const listener of [...this.declaredFieldListeners]) listener();
  }

  /** SDK 1.4.0: every loaded plugin's field sets (ADR-0050); empty until `/api/config` has come. */
  get fieldSets(): readonly FieldSet[] {
    return this.fieldSetsValue;
  }

  /** SDK 1.4.0: every loaded plugin's relation kinds (ADR-0051), each line complete; empty until `/api/config` has come. */
  get relationKinds(): readonly RelationKind[] {
    return this.relationKindsValue;
  }

  /**
   * The field sets and relation kinds of `/api/config`: fixed while the server runs, so they are set
   * once, before the plugins activate. A line's absent members get their defaults (width 1, solid,
   * no arrowhead), as the server fills them in already.
   */
  initialSetsAndKinds(sets: readonly FieldSet[], kinds: readonly RelationKindJson[]): void {
    if (this.fieldSetsValue.length === 0) this.fieldSetsValue = deepFreeze(structuredClone([...sets]));
    if (this.relationKindsValue.length === 0) {
      this.relationKindsValue = deepFreeze(kinds.map((k) => ({
        id: k.id, label: k.label, defaultOn: k.defaultOn === true,
        line: {
          strokeColor: k.line.strokeColor, strokeWidth: k.line.strokeWidth ?? 1, strokeDash: k.line.strokeDash ?? 'solid', arrowhead: k.line.arrowhead ?? 'none',
          ...(k.line.strokeColorSetting === undefined ? {} : { strokeColorSetting: k.line.strokeColorSetting }), // SDK 1.6.0, kept
        },
      })));
      this.resolveLines();
    }
  }

  /** The lines as they are now, again after the kinds came or a declaring plugin's settings changed; told only on a change. */
  private resolveLines(): void {
    const lines = resolveRelationLines(this.relationKindsValue, (pluginId) => this.settingsOf(pluginId));
    if (same(lines, this.relationLinesValue)) return;
    this.relationLinesValue = lines;
    for (const listener of [...this.relationLineListeners]) listener(lines);
  }

  /** Called once the declared fields have come; for `useSyncExternalStore`. */
  readonly onDeclaredFields = (listener: () => void): Unsubscribe => {
    this.declaredFieldListeners.add(listener);
    return () => { this.declaredFieldListeners.delete(listener); };
  };

  settingsOf(pluginId: string): Settings {
    return this.settings.get(pluginId) ?? EMPTY;
  }

  /** The data types the page loaded over HTTP (`/api/config`). */
  initialDataTypes(dataTypes: readonly DataType[]): void {
    if (!this.dataTypesFromSocket) this.putDataTypes(dataTypes);
  }

  /** A plugin's settings as the page loaded them over HTTP (`/api/plugins`). */
  initialSettings(pluginId: string, values: Settings): void {
    if (!this.settingsFromSocket.has(pluginId)) this.putSettings(pluginId, values);
  }

  /** A `data-types` message. */
  dataTypesChanged(dataTypes: readonly DataType[]): void {
    this.dataTypesFromSocket = true;
    this.putDataTypes(dataTypes);
  }

  /** A `settings` message. */
  settingsChanged(pluginId: string, values: Settings): void {
    this.settingsFromSocket.add(pluginId);
    this.putSettings(pluginId, values);
  }

  onDataTypes(listener: (dataTypes: readonly DataType[]) => void): Unsubscribe {
    this.dataTypeListeners.add(listener);
    return () => { this.dataTypeListeners.delete(listener); };
  }

  onSettings(pluginId: string, listener: (settings: Settings) => void): Unsubscribe {
    const listeners = this.settingsListeners.get(pluginId) ?? new Set();
    this.settingsListeners.set(pluginId, listeners);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  private putDataTypes(given: readonly DataType[]): void {
    // SDK 1.5.0 (CR-0038): every data type carries its field sets and whether it is made by hand,
    // also from a server or a test that leaves them out.
    // SDK 1.7.0: a fade is the shell's to work out, never the server's.
    this.declaredDataTypes = given.map((t) => {
      const declared: { -readonly [K in keyof DataType]: DataType[K] } = { ...t, fieldSets: t.fieldSets ?? [], manual: t.manual ?? true };
      delete declared.fade;
      return declared;
    });
    this.resolveDataTypes();
  }

  /** The data types with their fades as the declaring plugins' settings are now; told only on a change. */
  private resolveDataTypes(): void {
    const dataTypes = withSteppedFades(this.declaredDataTypes, (pluginId) => this.settingsOf(pluginId));
    if (same(dataTypes, this.dataTypesValue)) return;
    this.dataTypesValue = deepFreeze(structuredClone(dataTypes));
    for (const listener of [...this.dataTypeListeners]) listener(this.dataTypesValue);
  }

  private putSettings(pluginId: string, values: Settings): void {
    if (same(values, this.settings.get(pluginId))) return;
    const frozen = deepFreeze(structuredClone(values));
    this.settings.set(pluginId, frozen);
    for (const listener of [...(this.settingsListeners.get(pluginId) ?? [])]) listener(frozen);
    if (this.relationKindsValue.some((k) => k.line.strokeColorSetting !== undefined && k.id.startsWith(`${pluginId}.`))) this.resolveLines();
    if (this.declaredDataTypes.some((t) => t.fadeSetting !== undefined && t.declaredBy === pluginId)) this.resolveDataTypes();
  }
}

const EMPTY: Settings = Object.freeze({});

/** A value read through a function, as a `ReadonlyState` (`ctx.relationLines`). */
class StateView<T> implements ReadonlyState<T> {
  constructor(private readonly read: () => T, readonly onChange: (listener: (value: T) => void) => Unsubscribe) {}

  get value(): T {
    return this.read();
  }
}
